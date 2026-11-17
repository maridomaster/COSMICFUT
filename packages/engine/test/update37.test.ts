/**
 * Atualização "Mercado e Orçamentos" (nota 37): recusas insistentes (3 recusas na janela ⇒ 14 dias sem negociar),
 * orçamentos separados (transferências × salarial), equilíbrio € 1 mi ⇄ € 50 mil/mês com piso na folha comprometida,
 * validação das compras pelo orçamento, migração de saves e faixa da janela. Usa os dados reais de apps/web/public/data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { CareerData, SeasonState, WorldState } from '../src/contract';
import { careerSquads, createCareer, migrateCareer, worldSquads } from '../src/season/career';
import { advanceDay } from '../src/season/season';
import { checkWageCeiling } from '../src/season/econ';
import { financeOverview } from '../src/season/finance';
import { applyTransfer, exercisePurchaseOption, makeOffer } from '../src/transfers/actions';
import {
  BUDGET, budgetView, carryBudgets, deriveBudget, previewRebalance, rebalanceBudgets, transferBudgetError,
} from '../src/transfers/budget';
import { COOLDOWN, negotiationBlock, rejectionCount } from '../src/transfers/cooldown';
import { addDaysIso, clubWageBill, windowBanner } from '../src/transfers/market';
import { loadBase, loadData } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let world: WorldState;
let start: SeasonState;
/** 10/02/2026: janela sul-americana aberta */
let S: SeasonState;
const H = 'flarj';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sqOf = (s: SeasonState) => careerSquads(s, worldSquads(world, base));

/** Clube da IA da liga do humano e um reserva dele (valor ≥ € 1 mi). */
function target(s: SeasonState): { seller: string; player: Player } {
  const sq = sqOf(s);
  const league = s.competitions.find((c) => c.type === 'league' && c.clubIds.includes(H) && c.clubIds.length >= 10)!;
  for (const id of league.clubIds) {
    if (id === H) continue;
    const squad = sq(id);
    if (squad.length < 24) continue;
    const p = squad.slice().sort((a, b) => b.overall - a.overall)[18];
    if (p && p.value >= 1_000_000) return { seller: id, player: p };
  }
  throw new Error('sem alvo');
}

beforeAll(() => {
  data = loadData();
  base = loadBase();
  const c = createCareer({ data, humanClubIds: [H], season: 2026, seed: 'update37', squads: base, options: { light: 'all' } });
  world = c.world;
  start = c.state;
  let st = clone(start);
  const sq = worldSquads(world, base);
  while (st.date < '2026-02-10') st = advanceDay(st, sq, {}, { inPlace: true }).state;
  S = st;
}, 240_000);

describe('orçamentos separados', () => {
  it('a diretoria define transferências (caixa/receita) e salarial (= teto da folha) na criação da carreira', () => {
    const b = start.clubs[H].budget!;
    expect(b).toBeDefined();
    const info = start.clubInfo![H];
    const bal = start.clubs[H].balance;
    const R = info.revenue!;
    const expected = Math.max(0, Math.round(Math.min(bal - 0.05 * R, bal * 0.4 + R * 0.1) / 50_000) * 50_000);
    expect(b.transfer).toBe(expected);
    expect(b.transfer).toBeGreaterThan(0);
    expect(b.wage).toBeGreaterThan(0);
    // o orçamento salarial É o teto da folha
    expect(info.wageCeiling).toBe(Math.round(b.wage * 12));
    expect(financeOverview(start, H).wageCeiling).toBe(Math.round(b.wage * 12));
    // clubes da IA não têm orçamento
    const ai = Object.keys(start.clubs).find((id) => id !== H)!;
    expect(start.clubs[ai].budget).toBeUndefined();
  });

  it('equilíbrio: € 1 mi de transferências = € 50 mil/mês de folha, nos dois sentidos', () => {
    const b0 = S.clubs[H].budget!;
    const up = rebalanceBudgets(S, sqOf(S), H, 1_000_000);
    expect(up.error).toBeUndefined();
    const b1 = up.state.clubs[H].budget!;
    expect(b1.transfer).toBe(b0.transfer - 1_000_000);
    expect(b1.wage).toBe(b0.wage + 50_000);
    expect(up.state.clubInfo![H].wageCeiling).toBe(b1.wage * 12);
    // pura: a entrada não muda
    expect(S.clubs[H].budget!.transfer).toBe(b0.transfer);
    // de volta
    const down = rebalanceBudgets(up.state, sqOf(up.state), H, -1_000_000);
    expect(down.state.clubs[H].budget!.transfer).toBe(b0.transfer);
    expect(down.state.clubs[H].budget!.wage).toBe(b0.wage);
    expect(previewRebalance({ transfer: 10e6, wage: 1e6 }, 2e6)).toEqual({ transfer: 8e6, wage: 1.1e6 });
    expect(BUDGET.wagePerTransfer).toBe(0.05);
  });

  it('equilíbrio: a folha nunca fica abaixo da comprometida; transferências não ficam negativas', () => {
    const sq = sqOf(S);
    const v = budgetView(S, sq, H)!;
    expect(v.committed).toBe(clubWageBill(S, H, sq(H)));
    // máximo permitido para as transferências: exatamente até o piso
    const toFloor = -v.maxToTransfer;
    const ok = rebalanceBudgets(S, sq, H, toFloor);
    expect(ok.error).toBeUndefined();
    expect(ok.state.clubs[H].budget!.wage).toBeGreaterThanOrEqual(v.committed);
    const tooMuch = rebalanceBudgets(S, sq, H, toFloor - 2_000_000);
    expect(tooMuch.error).toMatch(/folha comprometida/);
    expect(tooMuch.state).toBe(S);
    const over = rebalanceBudgets(S, sq, H, v.transfer + 1_000_000);
    expect(over.error).toMatch(/orçamento de transferências/i);
    // folha acima do orçamento (sem margem): nada vai para as transferências
    const tight = clone(S);
    tight.clubs[H].budget!.wage = v.committed - 10_000;
    expect(budgetView(tight, sq, H)!.maxToTransfer).toBe(0);
    expect(rebalanceBudgets(tight, sq, H, -100_000).error).toMatch(/folha comprometida/);
  });

  it('o orçamento salarial vira o teto: mais folha libera contratos que a diretoria vetaria', () => {
    const sq = sqOf(S);
    const v = budgetView(S, sq, H)!;
    const room = v.wage - v.committed;
    const add = Math.max(10_000, room + 40_000);
    expect(checkWageCeiling(S, H, sq(H), add).ok).toBe(false);
    const moved = rebalanceBudgets(S, sq, H, 2_000_000).state;
    expect(checkWageCeiling(moved, H, sqOf(moved)(H), add).ok).toBe(true);
  });

  it('compras validadas pelo orçamento de transferências; compras reduzem e vendas aumentam', () => {
    const { seller, player } = target(S);
    const poor = clone(S);
    poor.clubs[H].budget!.transfer = 300_000;
    const r = makeOffer(poor, sqOf(poor), { buyerId: H, player, fee: 1_000_000 });
    expect(r.error).toMatch(/Orçamento de transferências insuficiente/);
    expect(transferBudgetError(poor, H, 200_000)).toBeNull();
    // caixa sobrando não importa: o orçamento manda
    poor.clubs[H].balance = 500e6;
    expect(makeOffer(poor, sqOf(poor), { buyerId: H, player, fee: 1_000_000 }).error).toMatch(/Orçamento/);

    const s = clone(S);
    const b0 = s.clubs[H].budget!.transfer;
    applyTransfer(s, { player, fromClubId: seller, toClubId: H, fee: 2_000_000, wage: player.wage, years: 3, kind: 'transfer' });
    expect(s.clubs[H].budget!.transfer).toBe(b0 - 2_000_000);
    const mine = sqOf(s)(H).find((p) => p.id !== player.id)!;
    applyTransfer(s, { player: mine, fromClubId: H, toClubId: seller, fee: 3_000_000, wage: mine.wage, years: 3, kind: 'transfer' });
    expect(s.clubs[H].budget!.transfer).toBe(b0 + 1_000_000);
    // a IA vendedora/compradora não ganha orçamento
    expect(s.clubs[seller].budget).toBeUndefined();
  });

  it('opção de compra também respeita o orçamento', () => {
    const { seller, player } = target(S);
    const s = clone(S);
    applyTransfer(s, { player, fromClubId: seller, toClubId: H, fee: 0, wage: player.wage, years: 1, kind: 'loan', loan: { wageShare: 100, purchaseOption: 5_000_000 } });
    s.clubs[H].budget!.transfer = 1_000_000;
    const r = exercisePurchaseOption(s, sqOf(s), H, player.id);
    expect(r.error).toMatch(/Orçamento de transferências/);
    s.clubs[H].budget!.transfer = 6_000_000;
    const ok = exercisePurchaseOption(s, sqOf(s), H, player.id);
    expect(ok.error).toBeUndefined();
    expect(ok.state.clubs[H].budget!.transfer).toBe(1_000_000);
  });

  it('trecho novo: orçamentos atravessam a virada do outro ciclo e são redefinidos na temporada do clube', () => {
    const s = clone(S);
    s.clubs[H].budget!.transfer = 1_234_000;
    const prev = clone(s);
    // virada europeia (abre 'split'): o Flamengo (América do Sul) continua com o que tinha
    const keep = clone(s);
    delete keep.clubs[H].budget;
    carryBudgets(keep, prev, 'split');
    expect(keep.clubs[H].budget!.transfer).toBe(1_234_000);
    // virada sul-americana (abre 'calendar'): a diretoria define de novo
    const fresh = clone(s);
    delete fresh.clubs[H].budget;
    carryBudgets(fresh, prev, 'calendar');
    expect(fresh.clubs[H].budget!.transfer).toBe(deriveBudget(fresh, H).transfer);
  });
});

describe('recusas insistentes', () => {
  it('3 recusas na janela ⇒ 14 dias sem negociar; depois libera', () => {
    const { player } = target(S);
    let s = S;
    let offerId: string | undefined;
    for (let i = 1; i <= COOLDOWN.rejections; i++) {
      const r = makeOffer(s, sqOf(s), { buyerId: H, player, fee: 10_000, offerId });
      expect(r.error).toBeUndefined();
      expect(r.club!.decision).toBe('reject');
      s = r.state;
      offerId = r.offer!.status === 'negotiating' ? r.offer!.id : undefined;
      if (i < COOLDOWN.rejections) expect(rejectionCount(s, player.id, H)).toBe(i);
    }
    const blk = negotiationBlock(s, player.id, H)!;
    expect(blk).not.toBeNull();
    expect(blk.until).toBe(addDaysIso(S.date, COOLDOWN.days));
    expect(s.news.some((n) => n.text.includes('irritado'))).toBe(true);
    const again = makeOffer(s, sqOf(s), { buyerId: H, player, fee: player.value * 3 });
    expect(again.error).toBe(`Clube irritado com propostas insistentes. Disponível novamente em ${blk.until.slice(8, 10)}/${blk.until.slice(5, 7)}.`);
    // empréstimo também bloqueado
    expect(makeOffer(s, sqOf(s), { buyerId: H, player, fee: 0, kind: 'loan' }).error).toMatch(/irritado/);
    // um dia antes ainda bloqueado; na data, libera
    const before = clone(s);
    before.date = addDaysIso(blk.until, -1);
    expect(negotiationBlock(before, player.id, H)).not.toBeNull();
    const after = clone(s);
    after.date = blk.until;
    expect(negotiationBlock(after, player.id, H)).toBeNull();
    const ok = makeOffer(after, sqOf(after), { buyerId: H, player, fee: 10_000 });
    expect(ok.error).toBeUndefined();
    // a contagem recomeça depois do bloqueio
    expect(rejectionCount(ok.state, player.id, H)).toBe(1);
  });

  it('a contagem é por janela: recusas da janela anterior não somam', () => {
    const { player } = target(S);
    let s = S;
    for (let i = 0; i < 2; i++) {
      const r = makeOffer(s, sqOf(s), { buyerId: H, player, fee: 10_000 });
      s = r.state;
      // nova negociação a cada vez (encerra a anterior)
      for (const o of s.market!.offers) if (o.playerId === player.id && o.status === 'negotiating') o.status = 'withdrawn';
    }
    expect(rejectionCount(s, player.id, H)).toBe(2);
    // janela de julho (sul-americana 01/07–30/09)
    const jul = clone(s);
    jul.date = '2026-07-10';
    expect(rejectionCount(jul, player.id, H)).toBe(0);
    const r = makeOffer(jul, sqOf(jul), { buyerId: H, player, fee: 10_000 });
    expect(r.error).toBeUndefined();
    expect(negotiationBlock(r.state, player.id, H)).toBeNull();
    expect(rejectionCount(r.state, player.id, H)).toBe(1);
  });

  it('por comprador: outro clube não herda a irritação', () => {
    const { player } = target(S);
    const s = clone(S);
    s.market!.rejections = { [`${player.id}|${H}`]: { rejectedOffersCount: 0, window: '2026-03-31', sellerId: 'x', blockedUntil: '2026-02-20' } };
    expect(negotiationBlock(s, player.id, H)).not.toBeNull();
    expect(negotiationBlock(s, player.id, 'outro')).toBeNull();
  });
});

describe('migração e janela', () => {
  it('save sem orçamentos nem recusas: a migração cria os orçamentos (idempotente)', () => {
    const s = clone(S);
    delete s.clubs[H].budget;
    delete s.market!.rejections;
    const m = migrateCareer(world, s, { data });
    expect(m.budgetsMigrated).toBe(true);
    expect(m.state!.clubs[H].budget!.transfer).toBe(deriveBudget(m.state!, H).transfer);
    expect(m.state!.clubInfo![H].wageCeiling).toBe(m.state!.clubs[H].budget!.wage * 12);
    const again = migrateCareer(m.world, m.state, { data });
    expect(again.budgetsMigrated).toBeUndefined();
    // sem orçamento gravado (save antigo sem migração), o derivado vale na hora
    expect(transferBudgetError(s, H, 1e12)).toMatch(/Orçamento/);
  });

  it('faixa da janela: aberta com fechamento e próxima abertura; fechada com a abertura', () => {
    const open = windowBanner(S, H);
    expect(open).toMatchObject({ open: true, closesOn: '2026-03-31', nextOpen: '2026-07-01', region: 'SA' });
    const closed = clone(S);
    closed.date = '2026-05-10';
    expect(windowBanner(closed, H)).toMatchObject({ open: false, closesOn: null, nextOpen: '2026-07-01' });
    const jul = clone(S);
    jul.date = '2026-08-15';
    expect(windowBanner(jul, H)).toMatchObject({ open: true, closesOn: '2026-09-30', nextOpen: '2027-01-01' });
  });
});
