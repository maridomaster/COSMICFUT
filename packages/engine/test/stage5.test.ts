/**
 * Etapa 5 — transferências e IA de mercado: curva de valor (idade, contrato, liga, potencial, reputação), negociação
 * (contrapropostas, recusa do jogador, multa rescisória), empréstimos (divisão do salário, opção de compra, volta na
 * virada), livres e pré-contratos, janelas por região do comprador, comportamento da IA (estatística de uma temporada)
 * e renovações da IA. Usa os dados reais de apps/web/public/data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { CareerData, SeasonState, TransferRecord, WorldState } from '../src/contract';
import { careerSquads, createCareer, migrateCareer, worldSquads } from '../src/season/career';
import { advanceDay } from '../src/season/season';
import { nextSeason } from '../src/season/rollover';
import { turnoverDue } from '../src/season/timeline';
import {
  ageMultiplier, careerValue, careerWorth, contractFactor, leagueMultiplier, monthsLeftOf, neutralValue, releaseClauseOf,
  reputationFactor, valueFormula, LEAGUE_MULT,
} from '../src/transfers/value';
import {
  askingPrice, clubView, contractDemand, evaluateContract, playerAppeal, APPEAL_MIN,
} from '../src/transfers/valuation';
import {
  exercisePurchaseOption, makeOffer, preContractOpen, proposeContract, recallLoan, renewContract, renewalAsk, signingBonus,
} from '../src/transfers/actions';
import { clubWageBill, currentClubOf, FREE } from '../src/transfers/market';
import { marketDay } from '../src/transfers/ai';
import { loadBase, loadData, loadPools } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let world: WorldState;
/** 10/02/2026: janela sul-americana aberta, europeia fechada (fechou em 02/02) */
let S1: SeasonState;
/** 10/04/2026: todas as janelas fechadas */
let S2: SeasonState;
let start: SeasonState;
const H = 'flarj';

const sqOf = (s: SeasonState) => careerSquads(s, worldSquads(world, base));
const advance = (s: SeasonState, until: string): SeasonState => {
  let st = JSON.parse(JSON.stringify(s)) as SeasonState;
  const sq = worldSquads(world, base);
  while (st.date < until) st = advanceDay(st, sq, {}, { inPlace: true }).state;
  return st;
};

beforeAll(() => {
  data = loadData();
  base = loadBase();
  const c = createCareer({ data, humanClubIds: [H], season: 2026, seed: 'stage5', squads: base, options: { light: 'all' } });
  world = c.world;
  start = c.state;
  S1 = advance(start, '2026-02-10');
  S2 = advance(S1, '2026-04-10');
}, 240_000);

describe('Etapa 5: curva de valor', () => {
  it('idade: jovem de overall alto vale muito mais; 32+ despenca mesmo com overall alto', () => {
    const v = (age: number, ovr = 82, pot = ovr) => valueFormula({ age, overall: ovr, potential: pot, league: 1 });
    expect(v(21)).toBeGreaterThan(v(26) * 1.3);
    expect(v(20, 85)).toBeGreaterThan(v(27, 85) * 1.5);
    expect(v(33) / v(29)).toBeLessThan(0.4);
    expect(v(35) / v(30)).toBeLessThan(0.25);
    for (let a = 27; a < 38; a++) expect(ageMultiplier(a + 1)).toBeLessThanOrEqual(ageMultiplier(a));
    // potencial alto: prêmio para o jovem, nenhum para o veterano
    expect(v(19, 72, 88)).toBeGreaterThan(v(19, 72, 74) * 1.8);
    expect(v(28, 80, 88)).toBe(v(28, 80, 80));
    // curva exponencial no overall
    expect(neutralValue(26, 85, 85)).toBeGreaterThan(neutralValue(26, 80, 80) * 2);
  });

  it('contrato: menos tempo = taxa menor; nos últimos 6 meses quase zero', () => {
    let prev = -1;
    for (const m of [0, 3, 6, 9, 12, 18, 24, 30, 36, 48]) {
      expect(contractFactor(m)).toBeGreaterThanOrEqual(prev);
      prev = contractFactor(m);
    }
    expect(contractFactor(6)).toBeLessThanOrEqual(0.15);
    expect(contractFactor(2)).toBeLessThan(0.07);
    expect(contractFactor(36)).toBe(1);
    expect(contractFactor(null)).toBe(1);
  });

  it('liga: Premier League > outras top-5 > Portugal/Holanda/Arábia > Brasil > resto da América do Sul', () => {
    const L = (k: string) => leagueMultiplier(k);
    expect(L('ING-1')).toBeGreaterThan(L('ESP-1'));
    for (const k of ['ESP-1', 'ITA-1', 'ALE-1', 'FRA-1']) {
      expect(L(k)).toBeLessThan(L('ING-1'));
      for (const m of ['POR-1', 'HOL-1', 'ARS-1']) expect(L(k)).toBeGreaterThan(L(m));
    }
    for (const m of ['POR-1', 'HOL-1', 'ARS-1']) expect(L(m)).toBeGreaterThan(L('BRA-1'));
    for (const k of ['ARG-1', 'URU-1', 'COL-1', 'CHI-1', 'PAR-1', 'EQU-1']) expect(L('BRA-1')).toBeGreaterThan(L(k));
    expect(L('BRA-1')).toBeGreaterThan(L('BRA-2'));
    expect(Object.keys(LEAGUE_MULT).length).toBeGreaterThan(25);
  });

  it('fator de reputação: f0 no início e decai 25% por temporada em direção a 1', () => {
    expect(reputationFactor(3, 1, 0)).toBeCloseTo(3, 6);
    expect(reputationFactor(3, 1, 1)).toBeCloseTo(1 + 2 * 0.75, 6);
    expect(reputationFactor(3, 1, 4)).toBeCloseTo(1 + 2 * 0.75 ** 4, 6);
    expect(reputationFactor(0.5, 1, 2)).toBeCloseTo(1 - 0.5 * 0.5625, 6);
    expect(reputationFactor(undefined, 1, 0)).toBe(1);
  });

  it('carreira: no 1º dia o valor é o dos dados (curado) para quem tem contrato longo; depois a fórmula recalcula', () => {
    const sq = sqOf(start);
    const raw = new Map(base(H).map((p) => [p.id, p]));
    let checked = 0;
    for (const p of sq(H)) {
      const r = raw.get(p.id);
      if (!r || r.value < 1_000_000) continue;
      const months = monthsLeftOf(start, p, H)!;
      // contrato padrão do início: o fator do contrato entra no f0, então o valor bate com o dos dados
      expect(p.value / r.value, `${p.name} (${months.toFixed(0)} meses)`).toBeGreaterThan(0.93);
      expect(p.value / r.value).toBeLessThan(1.07);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // dois meses depois: o contrato encurtou e o valor (de transferência) caiu um pouco para quem está no fim
    const later = sqOf(S2)(H);
    const short = later.find((p) => (monthsLeftOf(S2, p, H) ?? 99) < 12 && raw.get(p.id)?.value);
    if (short) expect(short.value).toBeLessThan(raw.get(short.id)!.value);
    // o valor sem contrato (luvas/multa) não depende dos meses restantes
    const p0 = later[0];
    expect(careerWorth(S2, p0, H)).toBeGreaterThanOrEqual(careerValue(S2, p0, H));
  });
});

describe('Etapa 5: negociação', () => {
  const target = (s: SeasonState, club: string) => sqOf(s)(club).filter((p) => !p.youth && p.age < 30 && p.value > 500_000).sort((a, b) => b.overall - a.overall)[3];

  it('valor ao clube: recusa, contraproposta e acordo; contrato: contraproposta e assinatura', () => {
    // (nota 37) o orçamento de transferências do Flamengo não cobre este alvo: folga para testar a negociação
    const S1b = JSON.parse(JSON.stringify(S1)) as SeasonState;
    S1b.clubs[H].budget!.transfer = 500_000_000;
    const sq = sqOf(S1b);
    const p = target(S1b, 'palmeiras');
    const ask = askingPrice(S1b, p, clubView(S1b, sq, 'palmeiras'), clubView(S1b, sq, H)).ask;
    const r1 = makeOffer(S1b, sq, { buyerId: H, player: p, fee: Math.round(ask * 0.5) });
    expect(r1.error).toBeUndefined();
    expect(r1.club!.decision).toBe('reject');
    const r2 = makeOffer(r1.state, sq, { buyerId: H, player: p, fee: Math.round(ask * 0.9), offerId: r1.offer!.id });
    expect(r2.club!.decision).toBe('counter');
    expect(r2.club!.counterFee!).toBeGreaterThan(ask * 0.9);
    const r3 = makeOffer(r2.state, sq, { buyerId: H, player: p, fee: r2.club!.counterFee!, offerId: r1.offer!.id });
    expect(r3.offer!.status).toBe('agreed');
    const s3 = r3.state;
    const sq3 = sqOf(s3);
    const c1 = proposeContract(s3, sq3, { offerId: r1.offer!.id, wage: Math.round(p.wage * 0.9), years: 3, releaseClause: 80_000_000 });
    expect(['counter', 'reject']).toContain(c1.contract!.decision);
    const asked = c1.offer!.askedWage ?? c1.contract!.demand.wage;
    const c2 = proposeContract(c1.state, sqOf(c1.state), { offerId: r1.offer!.id, wage: asked, years: 3, releaseClause: 80_000_000 });
    expect(c2.contract!.decision).toBe('accept');
    expect(currentClubOf(c2.state, p.id)).toBe(H);
    expect(c2.state.market!.contracts[p.id].releaseClause).toBe(80_000_000);
    expect(releaseClauseOf(c2.state, p, H)).toBe(80_000_000);
    // histórico da negociação (clube → jogador)
    const log = c2.offer!.log.map((l) => l.by);
    expect(log).toContain('seller');
    expect(log).toContain('player');
  });

  it('multa rescisória: o depósito força a venda; o jogador ainda decide', () => {
    const sq = sqOf(S1);
    const p = target(S1, 'corinthians-bra');
    const clause = releaseClauseOf(S1, p, 'corinthians-bra');
    expect(clause).toBeGreaterThan(careerValue(S1, p, 'corinthians-bra'));
    const s = JSON.parse(JSON.stringify(S1)) as SeasonState;
    s.clubs[H].balance = clause + 50_000_000;
    const r = makeOffer(s, sq, { buyerId: H, player: p, fee: 0, clause: true });
    expect(r.error).toBeUndefined();
    expect(r.club!.clause).toBe(true);
    expect(r.offer!.status).toBe('agreed');
    expect(r.offer!.fee).toBe(clause);
    const d = contractDemand(r.state, { player: p, buyer: clubView(r.state, sq, H), fromReputation: clubView(r.state, sq, 'corinthians-bra').reputation, fromLeague: clubView(r.state, sq, 'corinthians-bra').league });
    const c = proposeContract(r.state, sq, { offerId: r.offer!.id, wage: Math.round(d.wage * 1.2), years: 3 });
    expect(c.record?.via).toBe('clause');
    expect(c.state.clubs['corinthians-bra'].balance).toBe(s.clubs['corinthians-bra'].balance + clause);
  });

  it('o jogador pode recusar o clube (reputação/liga/minutos), salvo com salário muito acima ("o dinheiro fala")', () => {
    const sq = sqOf(S1);
    const star = sq('realmadrid-esp').filter((p) => p.age < 29).sort((a, b) => b.overall - a.overall)[0];
    const small = Object.keys(S1.clubs).find((id) => S1.clubInfo?.[id]?.leagueKey === 'BRA-2' && (S1.clubInfo?.[id]?.reputation ?? 3) <= 2)!;
    const buyer = clubView(S1, sq, small);
    const from = clubView(S1, sq, 'realmadrid-esp');
    const input = { player: star, buyer, fromReputation: from.reputation, fromLeague: from.league };
    expect(playerAppeal(S1, input).score).toBeLessThan(APPEAL_MIN);
    const d = contractDemand(S1, input, 3);
    const no = evaluateContract(S1, { ...input, wage: d.wage, years: 3, round: 1 });
    expect(no.decision).toBe('reject');
    expect(no.refusedClub).toBe(true);
    expect(no.final).toBe(true);
    expect(evaluateContract(S1, { ...input, wage: d.wage * 2, years: 3, round: 1 }).decision).toBe('accept');
    // clube grande, liga melhor: muito mais interesse
    // (mesmo elenco/papel; só reputação, liga e continental mudam)
    const big = { ...buyer, reputation: 5, league: leagueMultiplier('ING-1'), continental: true };
    expect(playerAppeal(S1, { ...input, buyer: big }).score).toBeGreaterThan(playerAppeal(S1, input).score + 2);
    // minutos pesam: banco é pior que titular
    const bench = playerAppeal(S1, { ...input, buyer: { ...big, squad: sq('realmadrid-esp').filter((x) => x.id !== star.id) } });
    expect(bench.score).toBeLessThanOrEqual(playerAppeal(S1, { ...input, buyer: big }).score);
  });
});

describe('Etapa 5: empréstimos', () => {
  it('divisão do salário, opção de compra e volta ao fim do empréstimo', () => {
    const sq = sqOf(S1);
    const reserve = sq('palmeiras').filter((p) => !p.youth && p.age >= 22).sort((a, b) => a.overall - b.overall)[0];
    let r = makeOffer(S1, sq, { buyerId: H, player: reserve, fee: 0, kind: 'loan', loan: { wageShare: 30, purchaseOption: 1 } });
    expect(r.error).toBeUndefined();
    if (r.club!.decision === 'counter') {
      expect(r.offer!.counterLoan!.wageShare).toBeGreaterThan(30);
      r = makeOffer(r.state, sq, { buyerId: H, player: reserve, fee: r.club!.counterFee ?? 0, kind: 'loan', loan: r.offer!.counterLoan!, offerId: r.offer!.id });
    }
    expect(r.record?.kind).toBe('loan');
    const s = r.state;
    const k = s.market!.contracts[reserve.id];
    expect(k.loanFrom).toBe('palmeiras');
    expect(k.loanUntil).toBe('2026-12-31'); // fim da temporada da região de quem recebe (virada de dezembro)
    expect(k.wageShare).toBeGreaterThanOrEqual(30);
    expect(k.purchaseOption).toBeGreaterThan(0);
    // folha: quem recebe paga a parte combinada; o dono paga o resto
    const sq2 = sqOf(s);
    const before = { h: clubWageBill(S1, H, sq(H)), p: clubWageBill(S1, 'palmeiras', sq('palmeiras')) };
    const after = { h: clubWageBill(s, H, sq2(H)), p: clubWageBill(s, 'palmeiras', sq2('palmeiras')) };
    const share = k.wageShare! / 100;
    expect(after.h - before.h).toBeCloseTo(reserve.wage * share, -2);
    expect(after.p - before.p).toBeCloseTo(-reserve.wage * share, -2);
    // opção de compra: paga o valor fixo ao dono e o jogador fica
    const s2 = JSON.parse(JSON.stringify(s)) as SeasonState;
    s2.clubs[H].balance = k.purchaseOption! + 10_000_000;
    const o = exercisePurchaseOption(s2, sq2, H, reserve.id);
    expect(o.error).toBeUndefined();
    expect(o.record?.via).toBe('option');
    expect(o.state.market!.contracts[reserve.id].kind).toBe('transfer');
    expect(o.state.clubs.palmeiras.balance).toBe(s2.clubs.palmeiras.balance + k.purchaseOption!);
    // sem opção exercida: no fim do empréstimo o jogador volta ao dono (com o contrato original)
    const s3 = JSON.parse(JSON.stringify(s)) as SeasonState;
    s3.date = k.loanUntil!;
    const back = marketDay(s3, worldSquads(world, base));
    expect(currentClubOf(back, reserve.id)).toBe('palmeiras');
    expect(back.market!.contracts[reserve.id]?.kind ?? 'renewal').not.toBe('loan');
    // retorno antecipado só se previsto
    expect(recallLoan(s, sq2, 'palmeiras', reserve.id).error).toMatch(/retorno antecipado/);
  });
});

describe('Etapa 5: livres, pré-contratos e janelas', () => {
  it('janela da região do COMPRADOR: em 10/02 a América do Sul compra e a Europa não', () => {
    const sq = sqOf(S1);
    const p = sqOf(S1)('santos').filter((x) => !x.youth)[5];
    expect(makeOffer(S1, sq, { buyerId: 'realmadrid-esp', player: p, fee: 1e6 }).error).toMatch(/janela/i);
    expect(makeOffer(S1, sq, { buyerId: H, player: p, fee: 1e6 }).error).toBeUndefined();
    // abril: tudo fechado para o Flamengo
    expect(makeOffer(S2, sqOf(S2), { buyerId: H, player: sqOf(S2)('santos')[6], fee: 1e6 }).error).toMatch(/janela/i);
  });

  it('livre: assina fora da janela, com luvas (25% do valor sem contrato) e salário', () => {
    const sq = sqOf(S2);
    const free = Object.entries(S2.market!.moves).filter(([, c]) => c === FREE).map(([id]) => S2.market!.players[id]).filter((p): p is Player => !!p && p.age < 31)
      .sort((a, b) => b.overall - a.overall)[0];
    expect(free).toBeTruthy();
    const o = makeOffer(S2, sq, { buyerId: H, player: free, fee: 0 });
    expect(o.offer!.kind).toBe('free');
    const bonus = signingBonus(S2, free, H);
    expect(bonus).toBeGreaterThan(0);
    const d = contractDemand(o.state, { player: free, buyer: clubView(o.state, sq, H), fromReputation: 1, kind: 'free' }, 2);
    const c = proposeContract(o.state, sq, { offerId: o.offer!.id, wage: d.wage, years: 2, luva: 0 });
    expect(c.error).toBeUndefined();
    expect(c.record?.kind).toBe('free');
    expect(c.state.clubs[H].balance).toBe(S2.clubs[H].balance - bonus);
  });

  it('renovação durante a temporada (humano): o jogador pede o salário de mercado; com pré-contrato não renova', () => {
    const sq = sqOf(S2);
    const p = sq(H).filter((x) => !x.youth).sort((a, b) => (monthsLeftOf(S2, a, H) ?? 0) - (monthsLeftOf(S2, b, H) ?? 0))[0];
    const ask = renewalAsk(S2, sq, H, p, 3);
    expect(renewContract(S2, sq, H, p.id, ask.wage - 1000, 3).error).toMatch(/pede/);
    const ok = renewContract(S2, sq, H, p.id, ask.wage, 3);
    expect(ok.error).toBeUndefined();
    expect(ok.state.market!.contracts[p.id].kind).toBe('renewal');
    expect(monthsLeftOf(ok.state, { ...p, wage: ask.wage }, H)!).toBeGreaterThan(24);
  });
});

describe('Etapa 5: IA do mercado (uma temporada simulada)', () => {
  let records: TransferRecord[] = [];
  let end: SeasonState;
  let w: WorldState;
  beforeAll(() => {
    // de 10/04/2026 a 01/10/2026: virada europeia, janela europeia de verão e a sul-americana de julho
    let s = JSON.parse(JSON.stringify(S2)) as SeasonState;
    w = world;
    let sq = worldSquads(w, base);
    const pools = loadPools(data);
    while (s.date < '2026-10-01') {
      if (turnoverDue(s)) {
        const r = nextSeason(w, s, base, data, pools, {});
        w = r.world; s = r.state; sq = worldSquads(w, base);
        continue;
      }
      const d = s.date;
      s = advanceDay(s, sq, {}, { inPlace: true }).state;
      for (const r of s.market!.history) { if (r.date !== d) break; records.push(r); }
    }
    end = s;
  }, 300_000);

  it('volume: centenas de movimentações; nenhuma inscrição fora da janela do comprador', () => {
    const moves = records.filter((r) => r.kind === 'transfer' || r.kind === 'loan');
    expect(moves.length).toBeGreaterThan(150);
    for (const r of moves) {
      // (25/11) opção de compra exercida no fim do empréstimo vale fora da janela (é cláusula do contrato)
      if (r.via === 'option') continue;
      const md = r.date.slice(5);
      if (r.toRegion === 'EU') expect(md >= '07-01' && md <= '09-01', `${r.playerName} ${r.date} → ${r.toName}`).toBe(true);
      if (r.toRegion === 'SA') expect(md <= '03-31' || (md >= '07-01' && md <= '09-30'), `${r.date}`).toBe(true);
    }
  });

  it('Europa garimpa jovens sul-americanos; a elite sul-americana vende para a Europa', () => {
    const saEu = records.filter((r) => r.kind === 'transfer' && r.fromRegion === 'SA' && r.toRegion === 'EU' && r.fee > 0);
    expect(saEu.length).toBeGreaterThan(10);
    expect(saEu.filter((r) => r.age <= 23).length / saEu.length).toBeGreaterThan(0.5);
    const euSa = records.filter((r) => r.kind === 'transfer' && r.fromRegion === 'EU' && r.toRegion === 'SA' && r.fee > 0);
    expect(saEu.reduce((t, r) => t + r.fee, 0)).toBeGreaterThan(euSa.reduce((t, r) => t + r.fee, 0));
  });

  it('Arábia (PIF) contrata veteranos da Europa com salário acima do mercado', () => {
    const sau = records.filter((r) => (r.kind === 'transfer' || r.kind === 'free') && r.fromRegion === 'EU' && r.toRegion === 'SAU');
    expect(sau.length).toBeGreaterThan(0);
    const vets = sau.filter((r) => r.age >= 29);
    expect(vets.length / sau.length).toBeGreaterThanOrEqual(0.5);
  });

  it('elencos inchados listam reservas e oferecem jovens por empréstimo; empréstimos acontecem', () => {
    expect(end.market!.transferList.length).toBeGreaterThan(50);
    expect((end.market!.loanList ?? []).length).toBeGreaterThan(10);
    expect(records.filter((r) => r.kind === 'loan').length).toBeGreaterThan(15);
  });

  it('pré-contrato: só nos últimos 6 meses; o jogador chega na virada da região do clube dele', () => {
    const sq = careerSquads(end, worldSquads(w, base));
    // em 01/10 os contratos sul-americanos de 2026 terminam em 31/12 (≤ 3 meses)
    const saClubs = Object.keys(end.clubs).filter((id) => id !== H && end.clubInfo?.[id]?.region === 'SA' && end.clubInfo?.[id]?.division === 1);
    let target: { p: Player; club: string } | null = null;
    for (const club of saClubs) {
      const p = sq(club).find((x) => !x.youth && x.age <= 30 && x.overall >= 68 && preContractOpen(end, x, club));
      if (p) { target = { p, club }; break; }
    }
    expect(target).toBeTruthy();
    const { p, club } = target!;
    // longe do fim: não pode
    const longC = sq('palmeiras').find((x) => (monthsLeftOf(end, x, 'palmeiras') ?? 0) > 12)!;
    expect(makeOffer(end, sq, { buyerId: H, player: longC, fee: 0, kind: 'precontract' }).error).toMatch(/Pré-contrato/);
    const o = makeOffer(end, sq, { buyerId: H, player: p, fee: 0, kind: 'precontract' });
    expect(o.error).toBeUndefined();
    expect(o.offer!.status).toBe('agreed');
    const d = contractDemand(o.state, { player: p, buyer: clubView(o.state, sq, H), fromReputation: clubView(o.state, sq, club).reputation, fromLeague: clubView(o.state, sq, club).league, kind: 'precontract' }, 3);
    const c = proposeContract(o.state, sq, { offerId: o.offer!.id, wage: Math.round(d.wage * 1.7), years: 3, luva: 12 });
    expect(c.error).toBeUndefined();
    expect(c.offer!.status).toBe('completed');
    expect(c.preContract?.toClubId).toBe(H);
    expect(currentClubOf(c.state, p.id)).toBe(club); // ainda no clube atual
    expect(c.state.clubs[H].luvaDebts?.some((x) => x.playerId === p.id)).toBe(true);
    // até a virada sul-americana (31/12) e a virada em si
    let s = JSON.parse(JSON.stringify(c.state)) as SeasonState;
    const wsq = worldSquads(w, base);
    while (!turnoverDue(s)) s = advanceDay(s, wsq, {}, { inPlace: true }).state;
    expect(turnoverDue(s)).toBe('calendar');
    expect(s.market!.preContracts?.[p.id]?.toClubId).toBe(H);
    const r = nextSeason(w, s, base, data, loadPools(data), {});
    expect(r.world.players.club[p.id]).toBe(H);
    expect(r.summary.contracts.preContracts?.some((x) => x.playerId === p.id && x.to === H)).toBe(true);
    expect(currentClubOf(r.state, p.id)).toBe(H);
  }, 180_000);

  it('IA renova peças-chave (contratos novos no meio da temporada) e a folha não cai', () => {
    expect((S2.market!.tally?.renewals ?? 0)).toBeGreaterThan(100);
    const renewed = Object.entries(S2.market!.contracts).filter(([, c]) => c.kind === 'renewal');
    expect(renewed.length).toBeGreaterThan(100);
    // folha da Série A da IA: estável (± 12%) entre o início e o fim do período
    const a0 = sqOf(start), a1 = careerSquads(end, worldSquads(w, base));
    const serieA = Object.keys(start.clubs).filter((id) => start.clubInfo?.[id]?.leagueKey === 'BRA-1' && id !== H);
    const tot = (f: (id: string) => Player[]) => serieA.reduce((t, id) => t + f(id).reduce((x, p) => x + p.wage, 0), 0);
    const ratio = tot(a1) / tot(a0);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.12);
  });
});

describe('Etapa 5: saves das Etapas 1–4', () => {
  it('migração: liga dos dados nos clubes; contratos/multas/fatores com padrão; sem mudar CAREER_REV', () => {
    const old = JSON.parse(JSON.stringify(S1)) as SeasonState;
    for (const i of Object.values(old.clubInfo!)) delete i.dataLeague;
    delete old.market!.preContracts;
    delete old.market!.loanList;
    delete old.market!.tally;
    for (const p of Object.values(old.market!.players)) delete p.rep0;
    const m = migrateCareer(world, old, { data });
    expect(m.marketMigrated).toBe(true);
    expect(m.state!.clubInfo![H].dataLeague).toBe('BRA-1');
    expect(m.world.rev).toBe(world.rev);
    // idempotente e jogável
    expect(migrateCareer(m.world, m.state, { data }).marketMigrated).toBeUndefined();
    const sq = careerSquads(m.state!, worldSquads(world, base));
    const p = sq(H)[0];
    expect(releaseClauseOf(m.state!, p, H)).toBeGreaterThan(0);
    expect(advanceDay(m.state!, worldSquads(world, base)).state.date).toBe('2026-02-11');
  });
});
