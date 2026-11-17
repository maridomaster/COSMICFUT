import { describe, expect, it } from 'vitest';
import { autoPickLineup, DEFAULT_TACTIC, FORMATIONS, getFormationSlots, slotFit } from '../src/tactics';
import { makeSquad } from './helpers';

describe('formações', () => {
  it('cada formação tem 11 slots, 1 GK e coordenadas normalizadas', () => {
    expect(FORMATIONS).toHaveLength(7);
    for (const f of FORMATIONS) {
      const slots = getFormationSlots(f);
      expect(slots).toHaveLength(11);
      expect(slots.filter((s) => s.role === 'GK')).toHaveLength(1);
      expect(slots[0].role).toBe('GK');
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(1);
        expect(s.natural.length).toBeGreaterThan(0);
      }
      // quantidade de defensores/atacantes coerente com o nome
      const [d] = f.split('-').map(Number);
      const defs = slots.filter((s) => s.role !== 'GK' && s.y < 0.35).length;
      expect(defs).toBe(d);
    }
  });

  it('slotFit: natural 1, adjacente ~0.85, GK fora do gol 0.2', () => {
    const sq = makeSquad('x');
    const gk = sq.find((p) => p.position === 'GK')!;
    const cb = sq.find((p) => p.position === 'CB')!;
    const [gkSlot, , cbSlot] = getFormationSlots('4-4-2');
    expect(slotFit(gk, gkSlot)).toBe(1);
    expect(slotFit(cb, cbSlot)).toBe(1);
    expect(slotFit(gk, cbSlot)).toBeCloseTo(0.2);
    expect(slotFit(cb, gkSlot)).toBeCloseTo(0.2);
    const lb = getFormationSlots('4-4-2')[1];
    expect(slotFit(cb, lb)).toBeGreaterThan(0.75);
    expect(slotFit(cb, lb)).toBeLessThan(1);
  });
});

describe('autoPickLineup', () => {
  it('escala 11 únicos, exatamente 1 goleiro no slot GK', () => {
    const sq = makeSquad('a');
    for (const f of FORMATIONS) {
      const l = autoPickLineup(sq, { ...DEFAULT_TACTIC, formation: f });
      expect(l.starters).toHaveLength(11);
      expect(new Set(l.starters).size).toBe(11);
      const pos = l.starters.map((id) => sq.find((p) => p.id === id)!.position);
      expect(pos.filter((p) => p === 'GK')).toHaveLength(1);
      expect(pos[0]).toBe('GK');
      expect(l.bench.length).toBeLessThanOrEqual(9);
      expect(l.bench.some((id) => l.starters.includes(id))).toBe(false);
      expect(l.captainId && l.starters.includes(l.captainId)).toBeTruthy();
      expect(l.penaltyTakerId && l.starters.includes(l.penaltyTakerId)).toBeTruthy();
    }
  });

  it('nunca usa lesionados/suspensos', () => {
    const sq = makeSquad('b');
    const first = autoPickLineup(sq, DEFAULT_TACTIC);
    // titular do gol fora: o reserva (único GK restante) deve assumir
    const out = new Set([first.starters[0], first.starters[3], first.starters[9], first.bench[1]]);
    const l = autoPickLineup(sq, DEFAULT_TACTIC, out);
    for (const id of out) {
      expect(l.starters).not.toContain(id);
      expect(l.bench).not.toContain(id);
    }
    const pos = l.starters.map((id) => sq.find((p) => p.id === id)!.position);
    expect(pos.filter((p) => p === 'GK')).toHaveLength(1);
  });

  it('é determinístico', () => {
    const sq = makeSquad('c');
    expect(autoPickLineup(sq, DEFAULT_TACTIC)).toEqual(autoPickLineup(sq.slice().reverse(), DEFAULT_TACTIC));
  });

  it('prefere jogadores descansados quando há fitness', () => {
    const sq = makeSquad('d');
    const l = autoPickLineup(sq, DEFAULT_TACTIC);
    const tired = l.starters[10];
    const l2 = autoPickLineup(sq, DEFAULT_TACTIC, undefined, { fitness: { [tired]: 40 } });
    expect(l2.starters).not.toContain(tired);
  });
});
