/**
 * (28/11) Patrocínio master: contrato padrão (sem perda de receita), propostas, assinatura, receita mensal e metas.
 */
import { describe, expect, it } from 'vitest';
import { createCareer, worldSquads } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { turnoverDue } from '../src/season/timeline';
import { advanceDay } from '../src/season/season';
import { signSponsor, sponsorMonthlyDelta, sponsorSlotMonthly, SPONSOR } from '../src/season/sponsor';
import { loadBase, loadData, loadPools } from './career-helpers';

describe('patrocínio master', () => {
  it('padrão sem perda; propostas chegam; assinar troca o contrato e muda a receita; metas avaliadas no fim da temporada', () => {
    const data = loadData();
    const base = loadBase();
    const human = 'flarj';
    const c = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'sponsor', squads: base, options: { light: 'all' } });
    const pools = loadPools(data);
    let state = c.state, world = c.world;
    let w = worldSquads(world, base);
    const step = (until: string) => {
      while (state.date < until) {
        if (turnoverDue(state)) { const r = nextSeason(world, state, base, data, pools, {}); world = r.world; state = r.state; w = worldSquads(world, base); continue; }
        state = advanceDay(state, w, {}, { inPlace: true }).state;
      }
    };
    step('2026-01-03');
    const st0 = state.market!.sponsor![human];
    expect(st0.deal?.default).toBe(true);
    expect(st0.deal?.end).toBe('2026-12-31');
    expect(sponsorMonthlyDelta(state, human)).toBe(0);
    step('2026-03-15');
    const st = state.market!.sponsor![human];
    expect(st.offers.length).toBeGreaterThan(0);
    const slot = sponsorSlotMonthly(state.clubInfo![human]);
    for (const o of st.offers) {
      expect(o.monthly).toBeGreaterThanOrEqual(Math.round((slot * SPONSOR.factor[0]) / 1000) * 1000 - 1000);
      expect(o.monthly).toBeLessThanOrEqual(Math.round((slot * SPONSOR.factor[1]) / 1000) * 1000 + 1000);
      expect(o.goals.some((g) => g.kind === 'position')).toBe(true);
    }
    const offer = st.offers[0];
    const r = signSponsor(state, human, offer.id);
    expect(r.error).toBeUndefined();
    state = r.state;
    expect(state.market!.sponsor![human].deal?.brand).toBe(offer.brand);
    expect(sponsorMonthlyDelta(state, human)).toBe(offer.monthly - slot);
    expect(signSponsor(state, human, 'nao-existe').error).toBeTruthy();
    // metas avaliadas no último dia da temporada (31/12)
    step('2026-12-31');
    state = advanceDay(state, w, {}, { inPlace: true }).state;
    const deal = state.market!.sponsor![human].deal!;
    expect(deal.goals.every((g) => g.done && typeof g.done['2026'] === 'boolean')).toBe(true);
    expect(state.news.some((n) => /Patrocínio master \(.*\): \d de \d metas/.test(n.text))).toBe(true);
  }, 600_000);
});
