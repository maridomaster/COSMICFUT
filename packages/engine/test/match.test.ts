import { describe, expect, it } from 'vitest';
import { MatchSimulation, quickSimulate } from '../src/match/index';
import type { MatchCommand, MatchConfig } from '../src/contract';
import { config } from './helpers';

function runWith(cfg: MatchConfig, script: Record<number, MatchCommand[]>) {
  const sim = new MatchSimulation(cfg);
  let ticks = 0;
  while (!sim.isFinished()) {
    for (const c of script[ticks] ?? []) sim.apply(c);
    sim.tick();
    ticks++;
  }
  return sim;
}

describe('determinismo', () => {
  it('mesma seed + mesmos comandos ⇒ mesmo resultado e mesmos eventos', () => {
    const cfgA = config('det:1', {}, 'human');
    const cfgB = config('det:1', {}, 'human');
    const out = cfgA.home.lineup.starters[10];
    const inn = cfgA.home.lineup.bench.find((id) => id !== cfgA.home.lineup.bench[0])!;
    const script: Record<number, MatchCommand[]> = {
      30: [{ type: 'set-tactic', side: 'home', tactic: { mentality: 'attacking', formation: '4-3-3' } }],
      60: [{ type: 'substitute', side: 'home', outId: out, inId: inn }],
    };
    const a = runWith(cfgA, script);
    const b = runWith(cfgB, script);
    expect(a.result()).toEqual(b.result());
    expect(a.state.events).toEqual(b.state.events);
  });

  it('seeds diferentes produzem jogos diferentes', () => {
    const res = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = quickSimulate(config('var:' + i));
      res.add(`${r.homeGoals}-${r.awayGoals}-${r.stats.home.shots}`);
    }
    expect(res.size).toBeGreaterThan(5);
  });

  it('quickSimulate dá o mesmo resultado da partida narrada', () => {
    for (let i = 0; i < 10; i++) {
      const cfg = config('q:' + i);
      const live = new MatchSimulation(cfg).runToEnd();
      const quick = quickSimulate(cfg);
      expect(quick.homeGoals).toBe(live.homeGoals);
      expect(quick.awayGoals).toBe(live.awayGoals);
      expect(quick.stats).toEqual(live.stats);
      expect(quick.ratings).toEqual(live.ratings);
    }
  });

  it('não usa Math.random', () => {
    const orig = Math.random;
    Math.random = () => { throw new Error('Math.random usado'); };
    try {
      expect(() => new MatchSimulation(config('nr', { knockout: true })).runToEnd()).not.toThrow();
    } finally {
      Math.random = orig;
    }
  });
});

describe('partida', () => {
  it('eventos básicos: kickoff, intervalo, fim; notas e posse coerentes', () => {
    const sim = new MatchSimulation(config('ev:1'));
    const first = sim.tick();
    expect(first[0].type).toBe('kickoff');
    expect(sim.state.phase).toBe('first-half');
    const r = sim.runToEnd();
    const types = new Set(sim.state.events.map((e) => e.type));
    for (const t of ['kickoff', 'half-time', 'second-half', 'full-time']) expect(types.has(t as never)).toBe(true);
    expect(sim.state.events.every((e) => e.text.length > 0 && !e.text.includes('{'))).toBe(true);
    expect(r.stats.home.possession + r.stats.away.possession).toBe(100);
    for (const v of Object.values(r.ratings)) {
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(r.homeGoals).toBe(r.scorers.filter((s) => s.side === 'home').length);
    expect(sim.tick()).toEqual([]);
  });

  it('acréscimos e intervalo acontecem', () => {
    const sim = new MatchSimulation(config('st:1'));
    sim.runToEnd();
    const ht = sim.state.events.find((e) => e.type === 'half-time')!;
    expect(ht.minute).toBe(45);
    expect(ht.extra).toBeGreaterThanOrEqual(1);
    const ft = sim.state.events.find((e) => e.type === 'full-time')!;
    expect(ft.minute).toBe(90);
    expect(ft.extra).toBeGreaterThanOrEqual(3);
  });

  it('mata-mata empatado vai à prorrogação e pênaltis, sempre com vencedor', () => {
    let sawPens = false;
    for (let i = 0; i < 60; i++) {
      const sim = new MatchSimulation(config('ko:' + i, { knockout: true }));
      const r = sim.runToEnd();
      expect(r.winner).not.toBe('draw');
      if (r.penalties) {
        sawPens = true;
        expect(r.extraTime).toBe(true);
        expect(r.penalties.home).not.toBe(r.penalties.away);
        expect(sim.state.events.some((e) => e.type === 'penalty-shootout-kick')).toBe(true);
      }
    }
    expect(sawPens).toBe(true);
  });

  it('IA do técnico faz substituições no 2º tempo', () => {
    let subs = 0;
    for (let i = 0; i < 10; i++) {
      const r = new MatchSimulation(config('ai:' + i)).runToEnd();
      subs += r.stats.home.subsUsed + r.stats.away.subsUsed;
      expect(r.stats.home.subsUsed).toBeLessThanOrEqual(5);
    }
    expect(subs).toBeGreaterThan(20);
  });
});

describe('validação de comandos', () => {
  it('substituição: regras de banco, repetição e limite', () => {
    const cfg = config('cmd:1', { maxSubs: 2 }, 'human');
    const sim = new MatchSimulation(cfg);
    sim.tick();
    const st = cfg.home.lineup.starters;
    const bench = cfg.home.lineup.bench;
    expect(sim.apply({ type: 'substitute', side: 'home', outId: st[5], inId: st[6] })).toMatch(/já está em campo/);
    expect(sim.apply({ type: 'substitute', side: 'home', outId: bench[0], inId: bench[1] })).toMatch(/não está em campo/);
    expect(sim.apply({ type: 'substitute', side: 'home', outId: st[5], inId: 'inexistente' })).toMatch(/banco/);
    expect(sim.apply({ type: 'substitute', side: 'home', outId: st[5], inId: bench[1] })).toBeNull();
    // quem saiu não volta
    expect(sim.apply({ type: 'substitute', side: 'home', outId: bench[1], inId: st[5] })).not.toBeNull();
    expect(sim.apply({ type: 'substitute', side: 'home', outId: st[6], inId: bench[2] })).toBeNull();
    expect(sim.apply({ type: 'substitute', side: 'home', outId: st[7], inId: bench[3] })).toMatch(/Limite/);
    expect(sim.state.stats.home.subsUsed).toBe(2);
    expect(sim.state.players.home.find((p) => p.id === bench[1])!.onPitch).toBe(true);
  });

  it('tática e troca de posições', () => {
    const cfg = config('cmd:2', {}, 'human');
    const sim = new MatchSimulation(cfg);
    sim.tick();
    expect(sim.apply({ type: 'set-tactic', side: 'home', tactic: { formation: '9-9-9' as never } })).toMatch(/Formação/);
    expect(sim.apply({ type: 'set-tactic', side: 'home', tactic: { mentality: 'louca' as never } })).toMatch(/Mentalidade/);
    expect(sim.apply({ type: 'set-tactic', side: 'away', tactic: { formation: '3-5-2', pressing: 'high' } })).toBeNull();
    expect(sim.state.tactic.away.formation).toBe('3-5-2');
    const slots = sim.state.players.away.filter((p) => p.onPitch).map((p) => p.slotIndex);
    expect(new Set(slots).size).toBe(11);
    const gk = sim.state.players.away.find((p) => p.id === cfg.away.lineup.starters[0])!;
    expect(gk.slotIndex).toBe(0);
    const [a, b] = cfg.home.lineup.starters.slice(1, 3);
    const sa = sim.state.players.home.find((p) => p.id === a)!.slotIndex;
    expect(sim.apply({ type: 'swap-slots', side: 'home', aId: a, bId: b })).toBeNull();
    expect(sim.state.players.home.find((p) => p.id === b)!.slotIndex).toBe(sa);
    expect(sim.apply({ type: 'swap-slots', side: 'home', aId: a, bId: cfg.home.lineup.bench[0] })).toMatch(/em campo/);
    expect(sim.apply({ type: 'bogus', side: 'home' } as never)).toMatch(/desconhecido/);
    expect(sim.apply({ type: 'set-tactic', side: 'meio' as never, tactic: {} })).toMatch(/Lado/);
  });

  it('expulso não pode ser substituído; partida encerrada recusa comandos', () => {
    let checked = false;
    for (let i = 0; i < 300 && !checked; i++) {
      const cfg = config('red:' + i, {}, 'human');
      const sim = new MatchSimulation(cfg);
      while (!sim.isFinished()) {
        const ev = sim.tick();
        const red = ev.find((e) => (e.type === 'red' || e.type === 'second-yellow') && e.side === 'home');
        if (red) {
          const err = sim.apply({ type: 'substitute', side: 'home', outId: red.playerId!, inId: cfg.home.lineup.bench[2] });
          expect(err).toMatch(/expulso/);
          checked = true;
          break;
        }
      }
      if (checked) {
        sim.runToEnd();
        expect(sim.apply({ type: 'set-tactic', side: 'home', tactic: { mentality: 'defensive' } })).toMatch(/terminou/);
      }
    }
    expect(checked).toBe(true);
  });
});
