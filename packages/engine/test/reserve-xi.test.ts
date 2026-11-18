import { describe, expect, it } from 'vitest';
import { pickBestXI, pickReserveXI, shapeSlots } from '../src/match/shape';
import { slotFit } from '../src/tactics';
import { makeSquad } from './helpers';

describe('(18/11) Time Reserva', () => {
  const players = makeSquad('res', 75);
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const f of ['4-4-2', '4-3-3', '3-5-2'] as const) {
    it(`${f}: mais fraco que o Melhor Elenco, sem improvisar e com os titulares no banco`, () => {
      const slots = shapeSlots(f);
      const best = pickBestXI(players, slots);
      const res = pickReserveXI(players, slots);
      expect(res.starters).toHaveLength(11);
      const sum = (ids: string[]) => ids.reduce((s, id) => s + byId.get(id)!.overall, 0);
      expect(sum(res.starters)).toBeLessThan(sum(best.starters));
      // goleiro no gol e ninguém fora de posição (o elenco de teste tem gente de todas as posições)
      res.starters.forEach((id, i) => {
        const p = byId.get(id)!;
        expect(p.position === 'GK').toBe(slots[i].role === 'GK');
        expect(slotFit(p, slots[i])).toBeGreaterThanOrEqual(0.85);
      });
      // a maioria dos titulares do Melhor Elenco vai para o banco
      const benchBest = best.starters.filter((id) => res.bench.includes(id)).length;
      expect(benchBest).toBeGreaterThanOrEqual(5);
    });
  }
  it('lesionados/suspensos não entram', () => {
    const slots = shapeSlots('4-4-2');
    const out = new Set(pickReserveXI(players, slots).starters.slice(0, 3));
    const res = pickReserveXI(players, slots, { unavailable: out });
    for (const id of out) expect(res.starters).not.toContain(id);
  });
});
