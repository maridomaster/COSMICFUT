import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import { FORMATIONS, getFormationSlots, formationSlotsRef } from '../src/tactics';
import {
  applyPreset, detectRole, detectZone, lineupEffectiveSum, makePreset, normalizePresets, pickBestXI, pickRestXI,
  rolePenalty, sanitizePositions, shapeBalance, shapeSlots, ZONE_ROLE,
} from '../src/match/shape';
import { MatchSimulation } from '../src/match/simulation';
import { quickSimulate } from '../src/match/quick';
import type { Lineup, MatchConfig, SlotPos, SlotRole } from '../src/contract';
import { config, makeSquad } from './helpers';

const P = (id: string, position: Player['position'], overall: number, side: 'L' | 'R' = 'R'): Player => ({
  id, name: id, position, age: 26, nationalityId: 29, side, traits: [], star: false, highlight: false, worldClass: false,
  overall, potential: overall, wage: 1, value: 1, youth: false, tmId: null,
});

describe('zonas táticas', () => {
  it('detecta as 10 zonas da UI', () => {
    expect(detectZone(0.5, 0.05)).toBe('GOL');
    expect(detectZone(0.5, 0.2)).toBe('ZAG');
    expect(detectZone(0.1, 0.22)).toBe('LE');
    expect(detectZone(0.9, 0.22)).toBe('LD');
    expect(detectZone(0.5, 0.4)).toBe('VOL');
    expect(detectZone(0.5, 0.5)).toBe('MC');
    expect(detectZone(0.5, 0.66)).toBe('MEI');
    expect(detectZone(0.1, 0.8)).toBe('PE');
    expect(detectZone(0.9, 0.8)).toBe('PD');
    expect(detectZone(0.5, 0.85)).toBe('ATA');
    for (const [z, r] of Object.entries(ZONE_ROLE)) expect(typeof r).toBe('string'), expect(z.length).toBeGreaterThan(1);
  });

  it('as posições padrão das formações caem no próprio papel (exceto alas em faixas ambíguas)', () => {
    let mismatches = 0;
    for (const f of FORMATIONS) {
      for (const s of getFormationSlots(f)) {
        if (detectRole(s.x, s.y) !== s.role) {
          mismatches++;
          // 3-5-2 (ALE na linha do meio) e 5-3-2 (ALE na linha da defesa): ambíguos por geometria
          expect(['LWB', 'RWB']).toContain(s.role);
        }
      }
    }
    expect(mismatches).toBe(4);
  });

  it('sanitizePositions: 11 entradas, goleiro fixo, ninguém de linha na zona do gol', () => {
    expect(sanitizePositions([{ x: 0.5, y: 0.5 }])).toBeNull();
    const pos: (SlotPos | null)[] = Array(11).fill(null);
    pos[0] = { x: 0.5, y: 0.9 };
    pos[3] = { x: 2, y: 0.01 };
    const s = sanitizePositions(pos)!;
    expect(s[0]).toBeNull();
    expect(s[3]).toEqual({ x: 0.97, y: 0.13 });
    expect(detectRole(s[3]!.x, s[3]!.y)).not.toBe('GK');
    expect(() => sanitizePositions(pos, '4-4-2', true)).toThrow();
    expect(shapeSlots('4-4-2', null)).toBe(formationSlotsRef('4-4-2'));
  });
});

describe('improvisação', () => {
  it('penalidade cresce com a distância da posição natural', () => {
    const cb = P('cb', 'CB', 80);
    const fbR = P('ld', 'FB', 80, 'R');
    const fw = P('fw', 'FW', 80);
    const chain = (p: Player, roles: SlotRole[]) => {
      const pens = roles.map((r) => rolePenalty(p, r));
      for (let i = 1; i < pens.length; i++) expect(pens[i]).toBeGreaterThanOrEqual(pens[i - 1]);
      return pens;
    };
    const zag = chain(cb, ['CB', 'LB', 'CM', 'LM', 'ST']);
    expect(zag[0]).toBe(0);
    expect(zag[4]).toBeGreaterThanOrEqual(35); // ZAG no ATA: grande
    const ld = chain(fbR, ['RB', 'LB', 'CB', 'CM', 'ST']);
    expect(ld[1]).toBeGreaterThan(0); // LD na LE: pequena
    expect(ld[1]).toBeLessThanOrEqual(5);
    chain(fw, ['ST', 'AM', 'CM', 'LB', 'CB']);
  });
});

/** Desenho "tudo ao ataque" no 4-4-2: laterais e meias abertos viram pontas (2 def, 2 meio, 6 ataque). */
function allAttack(): (SlotPos | null)[] {
  const p: (SlotPos | null)[] = Array(11).fill(null);
  p[1] = { x: 0.12, y: 0.8 }; // LE → PE
  p[4] = { x: 0.88, y: 0.8 }; // LD → PD
  p[5] = { x: 0.2, y: 0.68 }; // ME → PE
  p[8] = { x: 0.8, y: 0.68 }; // MD → PD
  return p;
}

describe('equilíbrio de setores', () => {
  it('formações padrão são neutras (motor idêntico ao anterior)', () => {
    for (const f of FORMATIONS) expect(shapeBalance(formationSlotsRef(f)).neutral).toBe(true);
  });

  it('desenho tudo-ao-ataque: penaliza meio e defesa', () => {
    const b = shapeBalance(shapeSlots('4-4-2', allAttack()));
    expect(b.counts).toEqual({ def: 2, mid: 2, att: 6 });
    expect(b.mid).toBeLessThan(0.9);
    expect(b.def).toBeLessThan(0.85);
    expect(b.issues.length).toBeGreaterThan(0);
  });

  it('sem posições personalizadas, o resultado é o mesmo de antes (determinismo)', () => {
    const a = quickSimulate(config('shape-det'));
    const cfg = config('shape-det');
    cfg.home.lineup = { ...cfg.home.lineup, positions: Array(11).fill(null) };
    expect(quickSimulate(cfg)).toEqual(a);
  });

  it('em N jogos, tudo-ao-ataque sofre mais gols e rende menos pontos que o desenho equilibrado', () => {
    const N = 400;
    const run = (positions: (SlotPos | null)[] | null) => {
      let ga = 0, gf = 0, pts = 0, poss = 0;
      for (let i = 0; i < N; i++) {
        const cfg: MatchConfig = config(`bal:${i}`);
        // mesmo nível dos dois lados
        cfg.away = { ...cfg.away, players: makeSquad('fora', 76) };
        cfg.away.lineup = config(`x`).away.lineup;
        if (positions) cfg.home = { ...cfg.home, lineup: { ...cfg.home.lineup, positions } };
        const r = quickSimulate(cfg);
        gf += r.homeGoals; ga += r.awayGoals; poss += r.stats.home.possession;
        pts += r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
      }
      return { gf: gf / N, ga: ga / N, pts: pts / N, poss: poss / N };
    };
    const bal = run(null);
    const att = run(allAttack());
    // 4-2-4 moderado: só os meias abertos sobem para as pontas (4 def, 2 meio, 4 ataque)
    const p424: (SlotPos | null)[] = Array(11).fill(null);
    p424[5] = { x: 0.15, y: 0.75 };
    p424[8] = { x: 0.85, y: 0.75 };
    const mod = run(p424);
    // eslint-disable-next-line no-console
    console.log('[shape] equilibrado', bal, '4-2-4', mod, 'tudo-ao-ataque', att);
    expect(mod.ga).toBeGreaterThan(bal.ga);
    expect(mod.pts).toBeGreaterThan(att.pts);
    expect(att.ga).toBeGreaterThan(bal.ga * 1.15);
    expect(att.pts).toBeLessThan(bal.pts);
    expect(att.poss).toBeLessThan(bal.poss);
  });

  it('comando set-shape durante o jogo é aceito e determinístico', () => {
    const go = () => {
      const sim = new MatchSimulation(config('shape-live'), { narrate: false });
      for (let i = 0; i < 30; i++) sim.tick();
      expect(sim.apply({ type: 'set-shape', side: 'home', positions: allAttack() })).toBeNull();
      return sim.runToEnd();
    };
    expect(go()).toEqual(go());
  });
});

describe('escalação automática', () => {
  const squad = (): Player[] => [
    P('g1', 'GK', 70), P('g2', 'GK', 80),
    P('c1', 'CB', 75), P('c2', 'CB', 74), P('c3', 'CB', 90),
    P('f1', 'FB', 72, 'L'), P('f2', 'FB', 73, 'R'), P('f3', 'FB', 60, 'R'),
    P('m1', 'MF', 76), P('m2', 'MF', 77), P('m3', 'MF', 78), P('m4', 'MF', 79), P('m5', 'MF', 65),
    P('a1', 'FW', 81), P('a2', 'FW', 82), P('a3', 'FW', 70),
  ];

  it('Melhor Elenco: ótimo (força bruta num caso pequeno) e sem suspensos/lesionados', () => {
    const players = squad();
    const slots = formationSlotsRef('4-4-2');
    const unavailable = new Set(['c3', 'a2']);
    const l = pickBestXI(players, slots, { unavailable });
    expect(l.starters).toHaveLength(11);
    expect(l.starters).not.toContain('c3');
    expect(l.starters).not.toContain('a2');
    expect(players.find((p) => p.id === l.starters[0])!.position).toBe('GK');
    expect(l.starters[0]).toBe('g2');
    // ótimo: nenhuma troca entre 2 slots ou com um reserva disponível melhora a soma
    const avail = players.filter((p) => !unavailable.has(p.id));
    const best = lineupEffectiveSum(avail, slots, l.starters);
    for (let i = 0; i < 11; i++) {
      for (let j = i + 1; j < 11; j++) {
        const s = l.starters.slice();
        [s[i], s[j]] = [s[j], s[i]];
        expect(lineupEffectiveSum(avail, slots, s)).toBeLessThanOrEqual(best + 1e-9);
      }
      for (const p of avail) {
        if (l.starters.includes(p.id) || (i === 0) !== (p.position === 'GK')) continue;
        const s = l.starters.slice();
        s[i] = p.id;
        expect(lineupEffectiveSum(avail, slots, s)).toBeLessThanOrEqual(best + 1e-9);
      }
    }
  });

  it('Melhor Elenco: com stamina baixa, troca o titular cansado', () => {
    const players = squad();
    const l = pickBestXI(players, formationSlotsRef('4-4-2'), { fitness: { a2: 30 } });
    expect(l.starters).not.toContain('a2');
  });

  it('Descansar Time: prioriza os descansados e nunca põe goleiro na linha', () => {
    const players = squad();
    const fitness: Record<string, number> = {};
    for (const p of players) fitness[p.id] = 70;
    fitness.g1 = 100; fitness.f3 = 100; fitness.m5 = 100; fitness.a3 = 100;
    for (const f of FORMATIONS) {
      const slots = formationSlotsRef(f);
      const l = pickRestXI(players, slots, { fitness });
      const byId = new Map(players.map((p) => [p.id, p]));
      l.starters.forEach((id, i) => {
        const isGk = byId.get(id)!.position === 'GK';
        expect(isGk).toBe(slots[i].role === 'GK');
      });
      expect(l.starters[0]).toBe('g1');
      expect(l.starters).toContain('m5');
      expect(l.starters).toContain('a3');
    }
    // mesmo sem nenhum goleiro disponível, o gol não recebe um... goleiro na linha
    const noGk = pickRestXI(players.filter((p) => p.position !== 'GK').concat(P('g9', 'GK', 50)), formationSlotsRef('4-4-2'), { fitness });
    expect(noGk.starters[0]).toBe('g9');
  });

  it('mantém posições personalizadas, capitão e batedor quando continuam no XI', () => {
    const players = squad();
    const cur: Lineup = { starters: [], bench: [], captainId: 'g2', positions: allAttack() };
    const l = pickBestXI(players, shapeSlots('4-4-2', cur.positions), { current: cur });
    expect(l.captainId).toBe('g2');
    expect(l.positions).toEqual(allAttack());
  });
});

describe('predefinições', () => {
  it('salva, carrega e migra (save antigo sem vagas ⇒ 3 vazias)', () => {
    expect(normalizePresets(undefined)).toEqual([null, null, null]);
    const players = makeSquad('pre');
    const base = config('pre').home.lineup;
    const lineup: Lineup = { ...base, starters: players.slice(0, 11).map((p) => p.id), positions: allAttack() };
    const tactic = { formation: '4-4-2' as const, mentality: 'all-out' as const, tempo: 'fast' as const, pressing: 'high' as const, passing: 'direct' as const };
    const preset = makePreset('  Pressão​ Total <b> ', tactic, lineup, true, '2026-11-17');
    expect(preset.name).toBe('Pressão Total b');
    const saved = JSON.parse(JSON.stringify([preset, null, { name: 'x', tactic: { formation: '9-9-9' } }]));
    const loaded = normalizePresets(saved, new Set(players.map((p) => p.id)));
    expect(loaded[0]).toEqual(preset);
    expect(loaded[1]).toBeNull();
    expect(loaded[2]).toBeNull();
    // XI com jogador que saiu do elenco: XI descartado, tática mantida
    const gone = normalizePresets(saved, new Set(players.slice(1).map((p) => p.id)));
    expect(gone[0]!.starters).toBeUndefined();
    expect(gone[0]!.tactic).toEqual(tactic);
    // aplicar: tática + posições; indisponível no XI é substituído por alguém da mesma função de gol/linha
    const cur: Lineup = { starters: players.slice(11, 22).map((p) => p.id), bench: [] };
    const out = applyPreset(preset, cur, players, { unavailable: new Set([players[2].id]) });
    expect(out.tactic).toEqual(tactic);
    expect(out.lineup!.positions).toEqual(sanitizePositions(allAttack()));
    expect(out.lineup!.starters).toHaveLength(11);
    expect(out.lineup!.starters).not.toContain(players[2].id);
    expect(new Set(out.lineup!.starters).size).toBe(11);
  });
});
