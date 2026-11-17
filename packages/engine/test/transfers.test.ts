import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { SeasonState } from '../src/contract';
import { advanceDay, createSeason } from '../src/season/index';
import {
  askingPrice, clubView, contractDemand, currentClubOf, effectiveSquad, ensureMarket, evaluateContract, evaluateOffer,
  FREE, makeOffer, marketDay, marketSquads, proposeContract, releasePlayer, respondToOffer, setTransferListed,
  transferWindow, withdrawOffer,
} from '../src/transfers/index';
import { makeSquad } from './helpers';

const clubs = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
/** elencos base com valores variados (o helper usa valor fixo) */
const base = new Map<string, Player[]>(
  clubs.map((c, i) => [
    c,
    makeSquad(c, 68 + i * 2).map((p) => ({ ...p, value: Math.round(p.overall ** 3 * 8), wage: Math.round(p.overall ** 2 * 4) })),
  ]),
);
const sq = (id: string) => base.get(id) ?? [];

function mk(startDate = '2026-01-18', balance = 20_000_000): SeasonState {
  const s = createSeason({
    season: 2026, startDate,
    divisions: [{ id: 'BRA-1', name: 'Liga', clubIds: clubs, doubleRound: true, relegated: 1, promoted: 0 }],
    humanClubIds: ['c0'],
    clubBalances: Object.fromEntries(clubs.map((c) => [c, balance])),
    seed: 'mercado',
    clubInfo: Object.fromEntries(clubs.map((c, i) => [c, { capacity: 20000, reputation: 1 + (i % 5), sponsorPerSeason: 1_200_000, name: c.toUpperCase(), division: 1 }])),
  });
  return ensureMarket(s, sq);
}

const best = (club: string) => sq(club).slice().sort((a, b) => b.overall - a.overall)[0];
const reserve = (club: string) => sq(club).slice().sort((a, b) => a.overall - b.overall)[0];

describe('janelas', () => {
  it('início até 31/03 e 01/07–31/08', () => {
    expect(transferWindow('2026-01-18')).toMatchObject({ open: true, closesOn: '2026-03-31' });
    expect(transferWindow('2026-03-31').open).toBe(true);
    expect(transferWindow('2026-04-01')).toMatchObject({ open: false, opensOn: '2026-07-01' });
    expect(transferWindow('2026-07-01')).toMatchObject({ open: true, closesOn: '2026-08-31' });
    expect(transferWindow('2026-09-01')).toMatchObject({ open: false, opensOn: '2027-01-01' });
  });
});

describe('avaliação do clube vendedor', () => {
  const s = mk();
  const p = best('c4');
  const seller = clubView(s, sq, 'c4');
  const buyer = clubView(s, sq, 'c0');
  const ask = askingPrice(s, p, seller, buyer).ask;

  it('preço pedido considera importância, idade e reputação', () => {
    const r = askingPrice(s, p, seller, buyer);
    expect(r.role).toBe('key');
    expect(r.factors.importance).toBe(1.35);
    // vendedor de reputação maior pede mais do que um comprador grande pagaria a um pequeno
    const fromWeak = askingPrice(s, best('c3'), clubView(s, sq, 'c3'), clubView(s, sq, 'c4'));
    expect(fromWeak.factors.reputation).toBeLessThan(1);
    expect(r.factors.reputation).toBeGreaterThan(1);
  });

  it('aceita, contrapropõe e recusa', () => {
    expect(evaluateOffer(s, { player: p, fee: ask, round: 1, seller, buyer }).decision).toBe('accept');
    const c = evaluateOffer(s, { player: p, fee: Math.round(ask * 0.9), round: 1, seller, buyer });
    expect(c.decision).toBe('counter');
    expect(c.counterFee!).toBeGreaterThan(ask * 0.9);
    const low = evaluateOffer(s, { player: p, fee: Math.round(ask * 0.5), round: 1, seller, buyer });
    expect(low.decision).toBe('reject');
    expect(low.final).toBe(false);
    // última rodada: ≥95% fecha, abaixo encerra
    expect(evaluateOffer(s, { player: p, fee: Math.round(ask * 0.96), round: 3, seller, buyer }).decision).toBe('accept');
    const end = evaluateOffer(s, { player: p, fee: Math.round(ask * 0.9), round: 3, seller, buyer });
    expect(end.decision).toBe('reject');
    expect(end.final).toBe(true);
  });

  it('não vende se o elenco ficar abaixo de 18', () => {
    const short = { ...seller, squad: seller.squad.slice(0, 18) };
    const d = evaluateOffer(s, { player: p, fee: ask * 3, round: 1, seller: short, buyer });
    expect(d.decision).toBe('reject');
    expect(d.final).toBe(true);
  });
});

describe('avaliação do jogador (contrato)', () => {
  const s = mk();
  const p = best('c5');
  it('aceita/contrapropõe/recusa e divisão inferior exige mais', () => {
    const buyer = clubView(s, sq, 'c0');
    const input = { player: p, buyer, fromReputation: 1 };
    const d = contractDemand(s, input, 3);
    expect(evaluateContract(s, { ...input, wage: d.wage, years: 3, round: 1 }).decision).toBe('accept');
    expect(evaluateContract(s, { ...input, wage: Math.round(d.wage * 0.9), years: 3, round: 1 }).decision).toBe('counter');
    expect(evaluateContract(s, { ...input, wage: Math.round(d.wage * 0.5), years: 3, round: 1 }).decision).toBe('reject');
    expect(evaluateContract(s, { ...input, wage: Math.round(d.wage * 0.9), years: 3, round: 3 }).final).toBe(true);
    const lower = contractDemand(s, { ...input, buyer: { ...buyer, division: 3 } }, 3);
    expect(lower.wage).toBeGreaterThan(d.wage);
    // reputação mais baixa que a do clube atual → pede mais
    const fromBig = contractDemand(s, { ...input, fromReputation: 5 }, 3);
    expect(fromBig.wage).toBeGreaterThan(d.wage);
  });
});

describe('fluxo de compra do humano', () => {
  it('recusa → contraproposta → acordo → contrato → elenco/caixa/notícia', () => {
    let s = mk();
    const p = best('c5');
    const ask = askingPrice(s, p, clubView(s, sq, 'c5'), clubView(s, sq, 'c0')).ask;
    const r1 = makeOffer(s, sq, { buyerId: 'c0', player: p, fee: Math.round(ask * 0.5) });
    expect(r1.error).toBeUndefined();
    expect(r1.club!.decision).toBe('reject');
    expect(r1.offer!.status).toBe('negotiating');
    const r2 = makeOffer(r1.state, sq, { buyerId: 'c0', player: p, fee: Math.round(ask * 0.9), offerId: r1.offer!.id });
    expect(r2.club!.decision).toBe('counter');
    const r3 = makeOffer(r2.state, sq, { buyerId: 'c0', player: p, fee: r2.club!.counterFee!, offerId: r1.offer!.id });
    expect(r3.club!.decision).toBe('accept');
    expect(r3.offer!.status).toBe('agreed');
    s = r3.state;
    const sqs = marketSquads(s, sq);
    expect(sqs('c0')).toHaveLength(22); // ainda não concluiu

    const demand = contractDemand(s, { player: p, buyer: clubView(s, sq, 'c0'), fromReputation: clubView(s, sq, 'c5').reputation }, 3);
    const c1 = proposeContract(s, sq, { offerId: r1.offer!.id, wage: Math.round(demand.wage * 0.88), years: 3 });
    expect(c1.contract!.decision).toBe('counter');
    const c2 = proposeContract(c1.state, sq, { offerId: r1.offer!.id, wage: c1.contract!.demand.wage, years: 3 });
    expect(c2.contract!.decision).toBe('accept');
    expect(c2.record).toBeDefined();
    const after = c2.state;
    const fee = r2.club!.counterFee!;
    expect(currentClubOf(after, p.id)).toBe('c0');
    expect(after.clubs.c0.balance).toBe(20_000_000 - fee);
    expect(after.clubs.c5.balance).toBe(20_000_000 + fee);
    expect(after.clubs.c0.finance!.transfers).toBe(-fee);
    expect(after.clubs.c5.finance!.transfers).toBe(fee);
    const mine = effectiveSquad(after, sq, 'c0');
    expect(mine).toHaveLength(23);
    expect(mine.find((x) => x.id === p.id)!.wage).toBe(c1.contract!.demand.wage);
    expect(effectiveSquad(after, sq, 'c5')).toHaveLength(21);
    expect(after.news.some((n) => n.text.includes(p.name) && n.text.includes('reforço'))).toBe(true);
    expect(after.market!.history[0].playerId).toBe(p.id);
    // a entrada não foi mutada
    expect(currentClubOf(s, p.id)).toBe('c5');
  });

  it('três recusas encerram; desistir fecha a negociação', () => {
    const s = mk();
    const p = best('c4');
    let r = makeOffer(s, sq, { buyerId: 'c0', player: p, fee: 1000 });
    r = makeOffer(r.state, sq, { buyerId: 'c0', player: p, fee: 2000, offerId: r.offer!.id });
    r = makeOffer(r.state, sq, { buyerId: 'c0', player: p, fee: 3000, offerId: r.offer!.id });
    expect(r.offer!.status).toBe('rejected');
    expect(makeOffer(r.state, sq, { buyerId: 'c0', player: p, fee: 1e9, offerId: r.offer!.id }).error).toBeTruthy();
    const w = makeOffer(s, sq, { buyerId: 'c0', player: best('c3'), fee: 1000 });
    expect(withdrawOffer(w.state, w.offer!.id).offer!.status).toBe('withdrawn');
  });

  it('valida janela e saldo (com cheque especial opcional)', () => {
    const closed = mk('2026-05-10');
    expect(makeOffer(closed, sq, { buyerId: 'c0', player: best('c5'), fee: 1e6 }).error).toMatch(/janela/i);
    const poor = mk('2026-01-18', 100_000);
    expect(makeOffer(poor, sq, { buyerId: 'c0', player: best('c5'), fee: 1e6 }).error).toMatch(/Saldo/);
    const credit = { ...poor, market: { ...poor.market!, rules: { ...poor.market!.rules, overdraft: 5e6 } } };
    expect(makeOffer(credit, sq, { buyerId: 'c0', player: best('c5'), fee: 1e6 }).error).toBeUndefined();
  });

  it('jogador livre: só contrato, inclusive fora da janela', () => {
    let s = mk('2026-05-10');
    const rel = releasePlayer(s, sq, 'c3', reserve('c3').id);
    expect(rel.error).toBeUndefined();
    s = rel.state;
    const p = reserve('c3');
    expect(currentClubOf(s, p.id)).toBe(FREE);
    const o = makeOffer(s, sq, { buyerId: 'c0', player: p, fee: 0 });
    expect(o.offer!.kind).toBe('free');
    expect(o.offer!.status).toBe('agreed');
    const c = proposeContract(o.state, sq, { offerId: o.offer!.id, wage: p.wage * 3, years: 2 });
    expect(c.contract!.decision).toBe('accept');
    expect(effectiveSquad(c.state, sq, 'c0').some((x) => x.id === p.id)).toBe(true);
    expect(c.state.clubs.c0.balance).toBe(s.clubs.c0.balance);
  });
});

describe('effectiveSquad', () => {
  it('aplica moves e é idempotente', () => {
    const s = mk();
    const p = reserve('c2');
    const st: SeasonState = JSON.parse(JSON.stringify(s));
    st.market!.moves[p.id] = 'c1';
    st.market!.players[p.id] = { ...p, wage: 777 };
    const eff = marketSquads(st, sq);
    expect(eff('c2').some((x) => x.id === p.id)).toBe(false);
    expect(eff('c1').find((x) => x.id === p.id)!.wage).toBe(777);
    const twice = marketSquads(st, eff);
    expect(twice('c1').map((x) => x.id)).toEqual(eff('c1').map((x) => x.id));
    expect(effectiveSquad(st, sq, 'c1')).toHaveLength(23);
  });
});

describe('IA no mercado', () => {
  const run = (days: number) => {
    let s = mk();
    for (let i = 0; i < days; i++) s = advanceDay(s, sq).state;
    return s;
  };

  it('determinismo: mesma seed ⇒ mesmo mercado', () => {
    const a = run(40);
    const b = run(40);
    expect(JSON.stringify(a.market)).toBe(JSON.stringify(b.market));
    expect(JSON.stringify(a.clubs)).toBe(JSON.stringify(b.clubs));
    expect(a.market!.history.length).toBeGreaterThan(0);
  });

  it('elencos ficam entre 18 e 32 durante a janela inteira', () => {
    let s = mk();
    for (let i = 0; i < 80; i++) {
      s = advanceDay(s, sq).state;
      const eff = marketSquads(s, sq);
      for (const c of clubs) {
        expect(eff(c).length).toBeGreaterThanOrEqual(18);
        expect(eff(c).length).toBeLessThanOrEqual(32);
      }
    }
    // dinheiro conserva entre os clubes nas transferências IA×IA
    const net = clubs.reduce((t, c) => t + (s.clubs[c].finance!.transfers ?? 0), 0);
    expect(net).toBe(0);
  });

  it('humano lista um reserva, recebe oferta e aceita', () => {
    let s = mk();
    const p = sq('c0').slice().sort((a, b) => a.overall - b.overall)[11];
    s = setTransferListed(s, p.id, true);
    let offerId: string | undefined;
    for (let i = 0; i < 30 && !offerId; i++) {
      s = advanceDay(s, sq).state;
      offerId = s.market!.offers.find((o) => o.playerId === p.id && o.status === 'pending')?.id;
    }
    expect(offerId).toBeDefined();
    const offer = s.market!.offers.find((o) => o.id === offerId)!;
    const before = s.clubs.c0.balance;
    const r = respondToOffer(s, marketSquads(s, sq), offerId!, true);
    expect(r.error).toBeUndefined();
    expect(currentClubOf(r.state, p.id)).toBe(offer.toClubId);
    expect(r.state.clubs.c0.balance).toBe(before + offer.fee);
    expect(r.state.market!.transferList).not.toContain(p.id);
    // recusar outra oferta
    const other = s.market!.offers.find((o) => o.status === 'pending' && o.id !== offerId);
    if (other) expect(respondToOffer(s, sq, other.id, false).offer!.status).toBe('rejected');
  });

  it('marketDay é puro', () => {
    const s = mk();
    const before = JSON.stringify(s);
    marketDay(s, sq);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('advanceDay continua funcionando com o mercado (temporada completa)', () => {
    let s = mk();
    let guard = 0;
    while (s.date < '2026-09-02' && guard++ < 400) s = advanceDay(s, sq).state;
    expect(s.competitions[0].finished).toBe(true);
    expect(s.market!.window.open).toBe(false);
    const eff = marketSquads(s, sq);
    for (const c of clubs) expect(eff(c).length).toBeGreaterThanOrEqual(18);
  });
});
