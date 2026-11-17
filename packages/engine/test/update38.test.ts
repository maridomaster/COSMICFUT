/**
 * Atualização 38: curva de stamina (fim dos 90', recuperação, calendário congestionado) e disciplina por competição
 * (expulsão/amarelos valem só na competição em que aconteceram; migração dos saves antigos).
 */
import { describe, expect, it } from 'vitest';
import type { Competition, MatchResult, SeasonState } from '../src/contract';
import { MatchSimulation } from '../src/match/simulation';
import { dailyRecovery, staminaFactor } from '../src/match/model';
import { addDays } from '../src/season/schedule';
import { advanceDay, buildTeamInput, createSeason, nextFixtureFor, unavailablePlayers } from '../src/season/season';
import {
  applyMatchDiscipline, isSuspendedFor, migrateDiscipline, suspendedPlayers, yellowsIn, moveDiscipline,
} from '../src/season/discipline';
import { config, makeSquad } from './helpers';

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/** stamina final dos titulares de linha que jogaram os 90' (não saíram) */
function fullTimeOutfield(seed: string, fitness: Record<string, number> = {}, tactic?: Partial<{ tempo: 'slow' | 'normal' | 'fast'; pressing: 'low' | 'medium' | 'high' }>) {
  const cfg = config(seed);
  cfg.home.fitness = fitness; cfg.away.fitness = fitness;
  if (tactic) { Object.assign(cfg.home.tactic, tactic); Object.assign(cfg.away.tactic, tactic); }
  const sim = new MatchSimulation(cfg, { narrate: false });
  const r = sim.runToEnd();
  const out: number[] = [];
  for (const side of ['home', 'away'] as const) {
    const t = cfg[side];
    for (const l of sim.state.players[side]) {
      if (!t.lineup!.starters.includes(l.id) || !l.onPitch) continue;
      if (t.players.find((p) => p.id === l.id)!.position === 'GK') continue;
      out.push(l.stamina);
    }
  }
  return { out, r, cfg };
}

describe('Atualização 38 — stamina', () => {
  it("titular de linha termina os 90' entre 65% e 75% (tática normal) e acima de 60% com ritmo/pressão máximos", () => {
    const normal: number[] = [];
    const intense: number[] = [];
    for (let i = 0; i < 60; i++) {
      normal.push(...fullTimeOutfield('st' + i).out);
      intense.push(...fullTimeOutfield('st' + i, {}, { tempo: 'fast', pressing: 'high' }).out);
    }
    const n = avg(normal), x = avg(intense);
    expect(n).toBeGreaterThanOrEqual(65);
    expect(n).toBeLessThanOrEqual(76);
    expect(x).toBeGreaterThanOrEqual(62);
    expect(x).toBeLessThan(n);
  });

  it('recuperação: de ~74% volta a 90–100% em 3–4 dias; mais rápida quando muito cansado', () => {
    let f = 74;
    const days = [f];
    for (let d = 0; d < 4; d++) days.push((f = dailyRecovery(f)));
    expect(days[3]).toBeGreaterThanOrEqual(90);
    expect(days[4]).toBeGreaterThanOrEqual(97);
    expect(days[4]).toBeLessThanOrEqual(100);
    // nunca mais lenta que a regra antiga (+9/dia) para quem está muito cansado
    expect(dailyRecovery(50)).toBeGreaterThan(59);
    expect(dailyRecovery(99.5)).toBe(100);
  });

  it('jogo a cada 3 dias por um mês: cai devagar, sem exaustão', () => {
    let fit: Record<string, number> = {};
    const starts: number[] = [];
    const ends: number[] = [];
    for (let g = 0; g < 10; g++) {
      const { r, cfg } = fullTimeOutfield('cong' + g, fit);
      const st = cfg.home.lineup!.starters;
      starts.push(avg(st.map((id) => fit[id] ?? 100)));
      const next = { ...fit };
      for (const id of r.appearances!.home) {
        const a = r.fitnessAfter![id];
        if (a !== undefined) next[id] = Math.min(a, next[id] ?? 100);
      }
      ends.push(avg(st.map((id) => next[id] ?? 100)));
      for (const id of Object.keys(next)) {
        let v = next[id];
        for (let d = 0; d < 3; d++) v = dailyRecovery(v);
        if (v >= 100) delete next[id]; else next[id] = v;
      }
      fit = next;
    }
    // início do jogo nunca abaixo de 90 e fim do jogo nunca abaixo de 65 (média do XI)
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(90);
    expect(Math.min(...ends)).toBeGreaterThanOrEqual(65);
    // degrada (ou se mantém), não melhora
    expect(starts[starts.length - 1]).toBeLessThanOrEqual(starts[0]);
  });

  it('pior caso: o mesmo XI sem substituições a cada 3 dias estabiliza longe da exaustão', () => {
    // modelo puro: perda de 26 pontos por jogo (tática normal) e 3 dias de recuperação
    let start = 100;
    const s: number[] = [];
    for (let g = 0; g < 10; g++) {
      let v = start - 26;
      for (let d = 0; d < 3; d++) v = dailyRecovery(v);
      start = v;
      s.push(start);
    }
    expect(Math.min(...s)).toBeGreaterThan(85);
    expect(s[9]).toBeLessThan(100);
  });

  it('rendimento: sem perda acima de 85%, perda forte abaixo de 25%', () => {
    expect(staminaFactor(90)).toBe(1);
    expect(staminaFactor(70)).toBeGreaterThan(0.9);
    expect(staminaFactor(20)).toBeLessThan(0.6);
  });
});

describe('Atualização 38 — posições vigentes no estado da partida', () => {
  it('state.slots acompanha set-shape (campo ao vivo) e o resultado continua determinístico', () => {
    const run = () => {
      const sim = new MatchSimulation(config('shape-ui'), { narrate: false });
      for (let i = 0; i < 20; i++) sim.tick();
      const before = sim.state.slots!.home;
      const positions = before.map((_s, i) => (i === 10 ? { x: 0.5, y: 0.6 } : null));
      expect(sim.apply({ type: 'set-shape', side: 'home', positions })).toBeNull();
      const after = sim.state.slots!.home;
      expect(after).not.toBe(before);
      expect(after[10].y).toBeCloseTo(0.6, 5);
      return { r: sim.runToEnd(), slots: JSON.stringify(sim.state.slots) };
    };
    const a = run(), b = run();
    expect(a.slots).toBe(b.slots);
    expect([a.r.homeGoals, a.r.awayGoals]).toEqual([b.r.homeGoals, b.r.awayGoals]);
  });
});

/* ───────────── disciplina por competição ───────────── */

const clubs = ['c0', 'c1', 'c2', 'c3'];
const squads = new Map(clubs.map((c, i) => [c, makeSquad(c, 70 + i)]));
const sq = (id: string) => squads.get(id)!;

/** liga 'A' (semanal) + copa 'B' com os mesmos confrontos 3 dias depois de cada rodada da liga */
function twoComps(): SeasonState {
  const s = createSeason({
    season: 2026, startDate: '2026-01-01',
    divisions: [{ id: 'A', name: 'Liga A', clubIds: clubs, doubleRound: true, relegated: 0, promoted: 0 }],
    humanClubIds: ['c0'],
    clubBalances: Object.fromEntries(clubs.map((c) => [c, 1_000_000])),
    seed: 'disc',
    clubInfo: Object.fromEntries(clubs.map((c) => [c, { capacity: 20000, reputation: 3, sponsorPerSeason: 1_200_000, name: c.toUpperCase() }])),
  });
  const a = s.competitions[0];
  const b: Competition = {
    ...a, id: 'B', name: 'Copa B', type: 'cup',
    fixtures: a.fixtures.map((f) => ({ ...f, id: f.id.replace(/^A:/, 'B:'), competitionId: 'B', date: addDays(f.date, 3) })),
  };
  s.competitions.push(b);
  return s;
}

function fake(cards: MatchResult['cards'], home: string[] = []): MatchResult {
  return {
    homeGoals: 1, awayGoals: 0, winner: 'home', scorers: [], ratings: {}, cards, injuries: [],
    stats: {} as never, attendance: 1000, appearances: { home, away: [] },
  };
}

function nextOf(s: SeasonState, comp: string, club = 'c0') {
  let best = null as SeasonState['competitions'][number]['fixtures'][number] | null;
  for (const f of s.competitions.find((c) => c.id === comp)!.fixtures) {
    if (f.result || f.date < s.date || (f.homeId !== club && f.awayId !== club)) continue;
    if (!best || f.date < best.date) best = f;
  }
  return best!;
}

function playUntil(s: SeasonState, date: string): SeasonState {
  while (s.date < date) s = advanceDay(s, sq).state;
  return s;
}

describe('Atualização 38 — suspensões por competição', () => {
  // o melhor jogador de linha do c0 (sempre titular)
  const star = sq('c0').filter((p) => p.position !== 'GK').sort((x, y) => y.overall - x.overall)[0].id;

  it('expulso na competição A: livre na B, suspenso no próximo jogo da A (e cumpre lá)', () => {
    let s = twoComps();
    const a1 = nextOf(s, 'A');
    s = playUntil(s, a1.date);
    const side = a1.homeId === 'c0' ? 'home' : 'away';
    // 2º amarelo ⇒ 1 jogo (determinístico)
    s = advanceDay(s, sq, { [a1.id]: fake([
      { side, playerId: star, minute: 20, color: 'yellow' }, { side, playerId: star, minute: 60, color: 'red' },
    ]) }).state;
    const club = s.clubs.c0;
    expect(club.bans?.A?.[star]).toBe(1);
    expect(isSuspendedFor(club, star, 'A')).toBe(true);
    expect(isSuspendedFor(club, star, 'B')).toBe(false);
    expect(unavailablePlayers(club, 'B').has(star)).toBe(false);
    expect(unavailablePlayers(club, 'A').has(star)).toBe(true);
    expect(s.news.some((n) => n.text.includes('Liga A'))).toBe(true);

    // jogo da B (simulado pela IA/autoPick): o jogador está disponível e joga; a suspensão da A continua
    const b1 = nextOf(s, 'B');
    expect(b1.date < nextOf(s, 'A').date).toBe(true);
    s = playUntil(s, b1.date);
    expect(nextFixtureFor(s, 'c0')!.competitionId).toBe('B');
    const inp = buildTeamInput(s, 'c0', sq('c0'), b1.homeId === 'c0');
    expect(inp.players.some((p) => p.id === star)).toBe(true);
    let out = advanceDay(s, sq);
    const pb = out.played.find((p) => p.fixture.id === b1.id)!;
    expect(pb.result.appearances![b1.homeId === 'c0' ? 'home' : 'away']).toContain(star);
    s = out.state;
    expect(s.clubs.c0.bans?.A?.[star]).toBe(1);

    // próximo jogo da A: fora (IA respeita) e a suspensão é cumprida
    const a2 = nextOf(s, 'A');
    s = playUntil(s, a2.date);
    const inpA = buildTeamInput(s, 'c0', sq('c0'), a2.homeId === 'c0');
    expect(inpA.players.some((p) => p.id === star)).toBe(false);
    out = advanceDay(s, sq);
    const pa = out.played.find((p) => p.fixture.id === a2.id)!;
    expect(pa.result.appearances![a2.homeId === 'c0' ? 'home' : 'away']).not.toContain(star);
    expect(out.state.clubs.c0.bans?.A?.[star]).toBeUndefined();
  });

  it('amarelos acumulam por competição: 2 na A + 1 na B não suspendem; o 3º na A suspende só na A', () => {
    const club = twoComps().clubs.c0;
    const y = (pid: string) => [{ playerId: pid, color: 'yellow' as const }];
    const red = () => 1;
    applyMatchDiscipline(club, 'A', y(star), red);
    applyMatchDiscipline(club, 'A', y(star), red);
    expect(yellowsIn(club, star, 'A')).toBe(2);
    expect(applyMatchDiscipline(club, 'B', y(star), red)).toEqual([]);
    expect(yellowsIn(club, star, 'B')).toBe(1);
    expect(isSuspendedFor(club, star, 'A')).toBe(false);
    const ev = applyMatchDiscipline(club, 'A', y(star), red);
    expect(ev).toEqual([{ playerId: star, kind: 'yellows', games: 1 }]);
    expect(yellowsIn(club, star, 'A')).toBe(0);
    expect(yellowsIn(club, star, 'B')).toBe(1);
    expect(isSuspendedFor(club, star, 'A')).toBe(true);
    expect(isSuspendedFor(club, star, 'B')).toBe(false);
    // jogo da B não cumpre a suspensão da A
    applyMatchDiscipline(club, 'B', [], red);
    expect(isSuspendedFor(club, star, 'A')).toBe(true);
    applyMatchDiscipline(club, 'A', [], red);
    expect(isSuspendedFor(club, star, 'A')).toBe(false);
  });

  it('transferência leva a suspensão por competição', () => {
    const s = twoComps();
    applyMatchDiscipline(s.clubs.c0, 'A', [{ playerId: star, color: 'red' }], () => 2);
    moveDiscipline(s.clubs.c0, s.clubs.c1, star);
    expect(isSuspendedFor(s.clubs.c0, star, 'A')).toBe(false);
    expect(s.clubs.c1.bans?.A?.[star]).toBe(2);
  });

  it('migração: suspensão antiga vai para a competição do último jogo (se ainda há jogo dela), senão a do próximo jogo', () => {
    let s = twoComps();
    const a1 = nextOf(s, 'A');
    s = playUntil(s, a1.date);
    s = advanceDay(s, sq, { [a1.id]: fake([]) }).state;
    // save antigo: mapas por jogador
    const other = sq('c0')[5].id;
    s.clubs.c0.bans = undefined; s.clubs.c0.cards = undefined;
    s.clubs.c0.suspensions = { [star]: 1 };
    s.clubs.c0.yellowCards = { [other]: 2 };
    // c1 nunca jogou: vai para a competição do próximo jogo (B, 3 dias depois)
    s.clubs.c1.suspensions = { [star]: 2 };
    s.clubs.c1.yellowCards = {};
    const changed = migrateDiscipline(s);
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(s.clubs.c0.bans).toEqual({ A: { [star]: 1 } });
    expect(s.clubs.c0.cards).toEqual({ A: { [other]: 2 } });
    expect(s.clubs.c0.suspensions).toEqual({});
    expect(s.clubs.c0.yellowCards).toEqual({});
    // c1 jogou a A1 também (todos jogam na rodada): a suspensão vai para A
    expect(Object.keys(s.clubs.c1.bans ?? {})).toEqual(['A']);
    // idempotente
    const again = JSON.stringify(s.clubs);
    migrateDiscipline(s);
    expect(JSON.stringify(s.clubs)).toBe(again);
  });

  it('migração sem jogo disputado: competição do próximo jogo do clube', () => {
    const s = twoComps();
    s.clubs.c2.suspensions = { x: 1 };
    migrateDiscipline(s);
    const next = nextFixtureFor(s, 'c2')!;
    expect(s.clubs.c2.bans).toEqual({ [next.competitionId]: { x: 1 } });
    expect(suspendedPlayers(s.clubs.c2, next.competitionId).has('x')).toBe(true);
  });
});
