/**
 * (28/11) Final em jogo único: campo neutro sem vantagem de mando e estádio de um terceiro clube que faz sentido.
 */
import { describe, expect, it } from 'vitest';
import { quickSimulate } from '../src/match/index';
import { neutralVenue } from '../src/season/season';
import type { Fixture, SeasonState } from '../src/contract';
import { team } from './helpers';

describe('campo neutro', () => {
  it('sem vantagem de mando: o "mandante" não vence mais que o visitante', () => {
    let homeN = 0, awayN = 0, homeH = 0, awayH = 0;
    for (let i = 0; i < 1500; i++) {
      const n = quickSimulate({ seed: 'n' + i, home: team('a', true, 75), away: team('b', false, 75), neutral: true });
      const h = quickSimulate({ seed: 'n' + i, home: team('a', true, 75), away: team('b', false, 75) });
      if (n.homeGoals > n.awayGoals) homeN++; else if (n.awayGoals > n.homeGoals) awayN++;
      if (h.homeGoals > h.awayGoals) homeH++; else if (h.awayGoals > h.homeGoals) awayH++;
    }
    expect(homeH - awayH).toBeGreaterThan(homeN - awayN + 80);
  });

  it('estádio: do país (copa nacional) ou da confederação (continental), nunca dos finalistas', () => {
    const clubInfo = {
      a: { capacity: 80000, region: 'SA', countryId: 1 }, b: { capacity: 78000, region: 'SA', countryId: 1 },
      c: { capacity: 70000, region: 'SA', countryId: 1 }, d: { capacity: 60000, region: 'SA', countryId: 2 },
      e: { capacity: 90000, region: 'EU', countryId: 9 },
    };
    const s = { clubInfo, competitions: [
      { id: 'BRA-CUP', type: 'cup', countryId: 1, fixtures: [] },
      { id: 'LIBERTADORES', type: 'continental', region: 'SA', fixtures: [] },
    ] } as unknown as SeasonState;
    const f = (comp: string, id: string): Fixture => ({ id, competitionId: comp, homeId: 'a', awayId: 'b', neutral: true } as Fixture);
    expect(neutralVenue(s, { ...f('BRA-CUP', 'x'), neutral: false })).toBeNull();
    for (let i = 0; i < 20; i++) {
      const cup = neutralVenue(s, f('BRA-CUP', 'cup' + i))!;
      expect(cup.clubId).toBe('c');
      const lib = neutralVenue(s, f('LIBERTADORES', 'lib' + i))!;
      expect(['c', 'd']).toContain(lib.clubId);
    }
  });
});
