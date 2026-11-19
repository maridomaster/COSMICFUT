/** (Premiação) tabela de prêmios da tela de Competições: por fase, por posição e só o campeão. */
import { describe, expect, it } from 'vitest';
import type { Competition, SeasonState } from '../src/contract';
import { prizeTable } from '../src/season/prizes';

const comp = (o: Partial<Competition>) => ({ id: 'X', name: 'X', type: 'cup', clubIds: ['a', 'b'], fixtures: [], ...o }) as unknown as Competition;
const state = (econ: unknown, prizes: Record<string, number> = {}) =>
  ({ career: { econ, prizes, prizeMode: 'champion' }, clubInfo: {} }) as unknown as SeasonState;

describe('prizeTable', () => {
  it('copa: participação, fases na ordem, título; marca o que o clube já recebeu', () => {
    const econ = { merit: {}, competitionPrizes: { X: { participation: 10, win: 3, draw: 1, reach: { final: 50, r16: 20, qf: 30 }, champion: 100 } } };
    const t = prizeTable(state(econ), comp({ paid: ['participation:a', 'r16:a'] }), 'a');
    expect(t.kind).toBe('phases');
    expect(t.rows.map((r) => r.key)).toEqual(['participation', 'r16', 'qf', 'final', 'champion']);
    expect(t.rows.filter((r) => r.mine).map((r) => r.key)).toEqual(['participation', 'r16']);
    expect(t.earned).toBe(30);
    expect(t.perMatch).toEqual({ win: 3, draw: 1 });
    expect(t.rows.find((r) => r.key === 'qf')?.label).toBe('Chegar às quartas de final');
  });

  it('liga com mérito: valor por posição, só até a última paga', () => {
    const econ = { merit: { X: { first: 100, last: 10, paid: 4 } }, competitionPrizes: {} };
    const t = prizeTable(state(econ), comp({ type: 'league' }), 'a');
    expect(t.kind).toBe('merit');
    expect(t.rows.map((r) => r.value)).toEqual([100, 70, 40, 10]);
  });

  it('sem tabela: prêmio do campeão do original', () => {
    const t = prizeTable(state(undefined, { EST: 5_000_000 }), comp({ type: 'state', prizeKey: 'EST', championId: 'a' }), 'a');
    expect(t).toMatchObject({ kind: 'champion', earned: 5_000_000 });
    expect(prizeTable(state(undefined), comp({}), 'a').kind).toBe('none');
  });
});
