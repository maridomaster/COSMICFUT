/** (18/11) Empréstimo com prazo (6 meses a 2 anos): o clube que recebe paga o salário inteiro. */
import { describe, expect, it } from 'vitest';
import { careerSquads, createCareer, worldSquads } from '../src/season/career';
import { applyTransfer, loanEndByMonths, setLoanListed } from '../src/transfers/actions';
import { loadBase, loadData } from './career-helpers';

describe('empréstimo com prazo', () => {
  const data = loadData();
  const base = loadBase();
  const human = 'santos';
  const c = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'emprestimo', squads: base });
  const sq = careerSquads(c.state, worldSquads(c.world, base));
  const p = sq(human).slice().sort((a, b) => a.age - b.age)[0];

  it('lista de empréstimo guarda o prazo (múltiplo de 6, entre 6 e 24)', () => {
    let s = setLoanListed(c.state, p.id, true, 18);
    expect(s.market!.loanList).toContain(p.id);
    expect(s.market!.loanMonths?.[p.id]).toBe(18);
    s = setLoanListed(s, p.id, true, 40);
    expect(s.market!.loanMonths?.[p.id]).toBe(24);
    s = setLoanListed(s, p.id, false);
    expect(s.market!.loanList).not.toContain(p.id);
    expect(s.market!.loanMonths?.[p.id]).toBeUndefined();
  });

  it('volta na data combinada (nunca depois do contrato) e quem recebe paga 100%', () => {
    const s = JSON.parse(JSON.stringify(c.state)) as typeof c.state;
    const to = 'saopaulo-bra';
    const want = loanEndByMonths(s, p, human, 6);
    expect(want > s.date).toBe(true);
    expect(want <= '2026-07-31').toBe(true);
    applyTransfer(s, { player: p, fromClubId: human, toClubId: to, fee: 0, wage: p.wage, years: 1, kind: 'loan', loan: { wageShare: 100, months: 6 } });
    const k = s.market!.contracts[p.id];
    expect(k.kind).toBe('loan');
    expect(k.loanUntil).toBe(want);
    expect(k.wageShare).toBe(100);
    // 2 anos: limitado ao fim do contrato com o dono
    const long = loanEndByMonths(c.state, p, human, 24);
    expect(long >= want).toBe(true);
  });
});
