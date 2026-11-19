/**
 * (18/11) Piso salarial pelo overall: vale nos contratos novos e nas renovações; não mexe em empréstimos nem na Base.
 */
import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { SeasonState } from '../src/contract';
import { createSeason } from '../src/season/index';
import { applyTransfer, clubView, contractDemand, ensureMarket, renewInPlace, wageFloor } from '../src/transfers/index';
import { makeSquad } from './helpers';

const clubs = ['c0', 'c1', 'c2', 'c3'];
const base = new Map<string, Player[]>(clubs.map((c) => [c, makeSquad(c, 74)]));
const sq = (id: string) => base.get(id) ?? [];

function mk(): SeasonState {
  const s = createSeason({
    season: 2026, startDate: '2026-01-18',
    divisions: [{ id: 'BRA-1', name: 'Liga', clubIds: clubs, doubleRound: true, relegated: 1, promoted: 0 }],
    humanClubIds: ['c0'],
    clubBalances: Object.fromEntries(clubs.map((c) => [c, 50_000_000])),
    seed: 'piso',
    clubInfo: Object.fromEntries(clubs.map((c) => [c, { capacity: 20000, reputation: 3, sponsorPerSeason: 1_200_000, name: c.toUpperCase(), division: 1 }])),
  });
  return ensureMarket(s, sq);
}

/** jogador bom com salário "de Portugal" */
const cheapStar = (): Player => ({ ...sq('c1')[0], overall: 80, age: 27, wage: 49_000 });

describe('piso salarial pelo overall', () => {
  it('curva cresce com o overall e jovens têm piso menor', () => {
    let prev = 0;
    for (let o = 40; o <= 99; o++) {
      const w = wageFloor(27, o);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(wageFloor(27, 80)).toBe(209_000);
    expect(wageFloor(20, 80)).toBe(Math.round(209_000 * 0.5));
    expect(wageFloor(22, 80)).toBe(Math.round(209_000 * 0.75 / 100) * 100);
    expect(wageFloor(27, 30)).toBe(500);
  });

  it('o pedido do jogador já parte do piso', () => {
    const s = mk();
    const d = contractDemand(s, { player: cheapStar(), buyer: clubView(s, sq, 'c0'), fromReputation: 3, kind: 'transfer' });
    expect(d.wage).toBeGreaterThanOrEqual(wageFloor(27, 80) * 0.9);
  });

  it('transferência/livre respeitam o piso; empréstimo mantém o salário', () => {
    const s = mk();
    const p = cheapStar();
    applyTransfer(s, { player: p, fromClubId: 'c1', toClubId: 'c2', fee: 1_000_000, wage: 49_000, years: 3, kind: 'transfer', quiet: true });
    expect(s.market!.contracts[p.id].wage).toBe(209_000);
    expect(s.market!.players[p.id].wage).toBe(209_000);
    const q = { ...sq('c1')[1], overall: 80, age: 27, wage: 49_000 };
    applyTransfer(s, { player: q, fromClubId: 'c1', toClubId: 'c3', fee: 0, wage: 49_000, years: 1, kind: 'loan', quiet: true });
    expect(s.market!.players[q.id].wage).toBe(49_000);
  });

  it('renovação respeita o piso; salário acima do piso não muda', () => {
    const s = mk();
    const p = cheapStar();
    renewInPlace(s, 'c1', p, 49_000, 3);
    expect(s.market!.contracts[p.id].wage).toBe(209_000);
    const rich = { ...p, id: 'c1:rich', wage: 500_000 };
    renewInPlace(s, 'c1', rich, 520_000, 3);
    expect(s.market!.contracts[rich.id].wage).toBe(520_000);
  });
});
