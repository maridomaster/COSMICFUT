/**
 * Ações do mercado (humano e IA). Funções públicas são puras: recebem a SeasonState e devolvem
 * uma nova (a entrada não é mutada). `applyTransfer` é a primitiva mutável usada internamente.
 *
 * (Etapa 5) Etapas: clube → jogador.
 *  - Compra: valor ao clube (contrapropostas, até 3 rodadas; ou o depósito da multa rescisória, que força a venda) →
 *    contrato com o jogador (salário, anos e multa rescisória; ele pode recusar o clube).
 *  - Empréstimo (1 temporada, volta na virada da região de quem recebe): taxa + % do salário + opção de compra
 *    fixa opcional + retorno antecipado opcional → o jogador aceita ou não (interesse).
 *  - Livre: só contrato (salário + luvas). Pré-contrato: jogador nos últimos 6 meses de contrato em outro clube —
 *    sem taxa, só luvas e salário; ele chega na virada da região do clube atual.
 *  - Inscrição: transferências e empréstimos só com a JANELA DA REGIÃO DO COMPRADOR aberta (bloqueio; sem acordo
 *    antecipado). Livres e pré-contratos não dependem da janela (o pré-contrato se concretiza numa virada, quando a
 *    janela do comprador está aberta: 01/01 e 01/07).
 *  - Teto da folha (diretoria) e cheque especial (limite de crédito) valem para o humano.
 */
import type { Player } from '@cosmicfut/shared';
import type { LoanTerms, PreContract, SeasonState, TransferKind, TransferOffer, TransferRecord } from '../contract';
import {
  baseClubOf, clubName, contractSeasonOf, currentClubOf, emptyTally, fmtMoneyPt, FREE, isHumanClub, ledgerOf, MARKET,
  marketWindow, type Squads,
} from './market';
import { cycleEnd, cycleOfRegion, cycleSeason, defaultLoanUntil, regionOfClub } from '../season/timeline';
import {
  clubView, contractDemand, evaluateContract, evaluateOffer, playerAppeal, APPEAL_MIN, MONEY_TALKS,
  type ContractDecision, type ExternalClubInfo, type OfferDecision,
} from './valuation';
import { careerWorth, dataLeagueMult, monthsLeftOf, ownerContractEnd, releaseClauseOf, roundMoney } from './value';
import { chargeLuva, FINANCE } from '../season/finance';
import { bumpFans, ceilingError, checkWageCeiling, FANS } from '../season/econ';
import { monthlyWage } from '../season/players';
import { withWageFloor } from './wage-floor';
import { moveDiscipline } from '../season/discipline';
import { budgetOnTransfer, transferBudgetError } from './budget';
import { blockMessage, negotiationBlock, noteRejection } from './cooldown';

export const POS_PT: Record<Player['position'], string> = { GK: 'GOL', FB: 'LAT', CB: 'ZAG', MF: 'MEI', FW: 'ATA' };

export interface MarketResult {
  state: SeasonState;
  offer?: TransferOffer;
  /** resposta do clube (etapa 1) */
  club?: OfferDecision;
  /** resposta do jogador (etapa 2) */
  contract?: ContractDecision;
  /** transferência concluída nesta chamada */
  record?: TransferRecord;
  /** (Etapa 5) pré-contrato assinado nesta chamada */
  preContract?: PreContract;
  /** erro de validação (estado inalterado) */
  error?: string;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* ───────────── primitiva: aplicar a transferência ───────────── */

export interface ApplyTransferArgs {
  player: Player;
  fromClubId: string;
  toClubId: string;
  fee: number;
  wage: number;
  years: number;
  kind: TransferKind | 'release' | 'loan-return';
  loanUntil?: string;
  /** (externo) nome do clube vendedor fora da temporada */
  fromName?: string;
  toName?: string;
  /** suprime a notícia (ex.: transferências pequenas da IA) */
  quiet?: boolean;
  /* ── (Etapa 5) ── */
  /** termos do empréstimo (padrão: 100% do salário, sem opção) */
  loan?: LoanTerms;
  /** multa rescisória do contrato novo (ausente = padrão) */
  releaseClause?: number;
  /** multa paga, opção de compra exercida, empréstimo chamado de volta */
  via?: 'clause' | 'option' | 'recall';
}

/** (18/11) Durações de empréstimo oferecidas (meses). */
export const LOAN_MONTHS = [6, 12, 18, 24] as const;

/** Data ISO + n meses (dia limitado ao fim do mês). */
function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * (18/11) Fim de um empréstimo de `months` meses: a data combinada, nunca depois do fim do contrato do jogador com o
 * dono (temporada final do contrato, no calendário da região do dono).
 */
export function loanEndByMonths(state: SeasonState, p: Player, ownerId: string, months: number): string {
  const want = addMonthsIso(state.date, Math.max(1, Math.round(months)));
  const r = regionOfClub(state, ownerId);
  const cyc = cycleOfRegion(r ?? null);
  const ownerEnd = cycleEnd(cyc, ownerContractEnd(state, p).endsSeason);
  return want < ownerEnd ? want : ownerEnd;
}

/** (Etapa 5) Fim do empréstimo: último dia da temporada da região de quem recebe (volta na virada dela). */
export function loanEndDate(state: SeasonState, toClubId: string): string {
  const r = regionOfClub(state, toClubId);
  if (!r || !state.segment) return defaultLoanUntil(state, toClubId);
  const cyc = cycleOfRegion(r);
  return cycleEnd(cyc, cycleSeason(cyc, state.date));
}

/**
 * Temporada final de um contrato de `years` anos assinado hoje no clube: conta a temporada atual se ainda falta
 * pelo menos metade dela (senão o contrato começa a contar na próxima).
 */
export function contractEndsSeason(state: SeasonState, clubId: string, years: number): number {
  const cs = contractSeasonOf(state, clubId);
  const r = regionOfClub(state, clubId);
  if (!r || !state.segment) return cs + Math.max(1, years) - 1;
  const end = cycleEnd(cycleOfRegion(r), cs);
  const monthsToEnd = (Date.parse(end + 'T00:00:00Z') - Date.parse(state.date + 'T00:00:00Z')) / (86400000 * 30.4375);
  return cs + Math.max(1, years) - (monthsToEnd >= 6 ? 1 : 0);
}

/** Aplica a transferência (MUTA `state`). Move o jogador, ajusta caixas/livro, contrato, log e notícias. */
export function applyTransfer(state: SeasonState, a: ApplyTransferArgs): TransferRecord {
  const m = state.market!;
  const p = a.player;
  const pid = p.id;
  const date = state.date;
  // (18/11) contrato novo (transferência, livre, pré-contrato) respeita o piso salarial do overall
  const newContract = a.kind === 'transfer' || a.kind === 'free' || a.kind === 'precontract';
  const wage = newContract ? withWageFloor(a.wage, p.age, p.overall) : Math.round(a.wage);
  const prev = m.contracts[pid];

  // (Etapa 5) contrato com o dono, antes de o empréstimo substituí-lo
  const owner = a.kind === 'loan' ? ownerContractEnd(state, p) : null;
  m.moves[pid] = a.toClubId;
  m.players[pid] = { ...p, wage };
  if (a.toClubId === FREE) {
    delete m.contracts[pid];
  } else if (a.kind === 'loan-return') {
    // volta ao dono: o contrato original continua (com a multa que tinha)
    if (prev?.parentEnd !== undefined) {
      m.contracts[pid] = { wage, endsSeason: prev.parentEnd, since: date, fee: 0, kind: 'renewal', ...(prev.releaseClause ? { releaseClause: prev.releaseClause } : {}) };
    } else delete m.contracts[pid];
  } else if (a.kind === 'loan') {
    const cs = contractSeasonOf(state, a.toClubId);
    const terms = a.loan ?? { wageShare: 100 };
    m.contracts[pid] = {
      wage, endsSeason: cs, since: date, fee: a.fee, kind: 'loan',
      loanFrom: a.fromClubId, loanUntil: a.loanUntil ?? (terms.months ? loanEndByMonths(state, p, a.fromClubId, terms.months) : loanEndDate(state, a.toClubId)),
      wageShare: Math.max(0, Math.min(100, Math.round(terms.wageShare))),
      ...(terms.purchaseOption !== undefined ? { purchaseOption: Math.round(terms.purchaseOption) } : {}),
      ...(terms.recall ? { recall: true } : {}),
      parentEnd: owner!.endsSeason,
      ...(prev?.releaseClause ? { releaseClause: prev.releaseClause } : {}),
    };
  } else {
    // (Etapa 1) temporada contratual do clube de destino (Europa 2026/27 → 2026; América do Sul → o ano)
    m.contracts[pid] = {
      wage,
      endsSeason: contractEndsSeason(state, a.toClubId, a.years),
      since: date,
      fee: a.fee,
      kind: a.kind === 'release' ? 'free' : a.kind,
      ...(a.releaseClause ? { releaseClause: Math.round(a.releaseClause) } : {}),
    };
  }

  // dinheiro: comprador paga, vendedor recebe (clubes fora da temporada não têm caixa aqui)
  if (a.fee) {
    // (Mercado e Orçamentos) orçamentos de transferências dos humanos
    budgetOnTransfer(state, a.toClubId, a.fromClubId, a.fee);
    const buyer = state.clubs[a.toClubId];
    if (buyer) {
      buyer.balance -= a.fee;
      const l = ledgerOf(state, a.toClubId)!;
      l.transfers = (l.transfers ?? 0) - a.fee;
      l.purchases = (l.purchases ?? 0) - a.fee;
    }
    const seller = state.clubs[a.fromClubId];
    if (seller) {
      seller.balance += a.fee;
      const l = ledgerOf(state, a.fromClubId)!;
      l.transfers = (l.transfers ?? 0) + a.fee;
      l.sales = (l.sales ?? 0) + a.fee;
    }
    // (Etapa 4) Moral da Torcida: contratação de peso anima; venda de peso irrita (relativo à receita do clube)
    if (state.career?.econ && a.kind !== 'loan-return' && a.kind !== 'release') {
      const heavy = (clubId: string) => {
        const R = state.clubInfo?.[clubId]?.revenue ?? 0;
        return R > 0 ? (a.fee >= 0.15 * R ? 1.5 : a.fee >= 0.05 * R ? 1 : 0) : 0;
      };
      if (buyer) bumpFans(buyer, FANS.starSigning * heavy(a.toClubId));
      if (seller) bumpFans(seller, FANS.starSale * heavy(a.fromClubId));
    }
  }

  // estado do jogador acompanha (lesão/suspensão/físico); escalação salva do clube de origem cai
  const from = state.clubs[a.fromClubId];
  const to = state.clubs[a.toClubId];
  if (from) {
    for (const key of ['injuries', 'suspensions', 'yellowCards', 'fitness'] as const) {
      const v = from[key][pid];
      if (v !== undefined) {
        delete from[key][pid];
        if (to) to[key][pid] = v;
      }
    }
    moveDiscipline(from, to, pid); // (Atualização 38) suspensões/amarelos por competição acompanham o jogador
    if (from.lineup && (from.lineup.starters.includes(pid) || from.lineup.bench.includes(pid))) from.lineup = null;
  }

  m.transferList = m.transferList.filter((id) => id !== pid);
  if (m.loanList?.includes(pid)) m.loanList = m.loanList.filter((id) => id !== pid);
  if (m.preContracts?.[pid] && a.kind !== 'loan-return') delete m.preContracts[pid];
  for (const o of m.offers) {
    if (o.playerId === pid && (o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending')) {
      o.status = 'expired';
      o.updatedOn = date;
    }
  }
  // (Etapa 5) clube grande da IA que vendeu alguém precisa repor a posição
  if ((a.kind === 'transfer' || a.via === 'clause') && from && !isHumanClub(state, a.fromClubId) && (state.clubInfo?.[a.fromClubId]?.reputation ?? 0) >= 3.5) {
    const needs = (m.needs ??= {});
    const list = (needs[a.fromClubId] ??= []);
    if (list.length < 4) list.push(p.position);
  }

  const fromRegion = state.clubInfo?.[a.fromClubId]?.region;
  const toRegion = state.clubInfo?.[a.toClubId]?.region;
  const rec: TransferRecord = {
    date,
    playerId: pid,
    playerName: p.name,
    position: p.position,
    age: p.age,
    overall: p.overall,
    fromClubId: a.fromClubId,
    fromName: a.fromName ?? clubName(state, a.fromClubId),
    toClubId: a.toClubId,
    toName: a.toName ?? clubName(state, a.toClubId),
    fee: a.fee,
    wage,
    kind: a.kind,
    ...(a.via ? { via: a.via } : {}),
    ...(fromRegion ? { fromRegion } : {}),
    ...(toRegion ? { toRegion } : {}),
  };
  m.history.unshift(rec);
  if (m.history.length > MARKET.historyCap) m.history.length = MARKET.historyCap;
  tallyRecord(state, rec);

  if (!a.quiet) state.news.push({ date, text: transferHeadline(state, rec), clubId: isHumanClub(state, a.toClubId) ? a.toClubId : isHumanClub(state, a.fromClubId) ? a.fromClubId : a.toClubId || a.fromClubId });
  return rec;
}

/** (Etapa 5) Contadores do mercado (estatísticas do trecho). MUTA. */
function tallyRecord(state: SeasonState, r: TransferRecord): void {
  const t = (state.market!.tally ??= emptyTally());
  if (r.kind === 'transfer') {
    t.transfers++;
    t.fees += r.fee;
    if (r.via === 'clause') t.clauses++;
    if (r.via === 'option') t.options++;
    if (r.fromRegion === 'SA' && r.toRegion === 'EU' && r.fee > 0) {
      t.saToEu++;
      t.saToEuFees += r.fee;
      if (r.age <= 23) t.youngSaToEu++;
    }
    if (r.fromRegion === 'EU' && r.toRegion === 'SAU') t.euToSau++;
  } else if (r.kind === 'loan') {
    t.loans++;
    t.fees += r.fee;
  } else if (r.kind === 'free') {
    t.free++;
    if (r.fromRegion === 'EU' && r.toRegion === 'SAU') t.euToSau++;
  }
}

export function transferHeadline(state: SeasonState, r: TransferRecord): string {
  const who = `${r.playerName} (${POS_PT[r.position]}, ${r.overall})`;
  const humanIn = isHumanClub(state, r.toClubId);
  const humanOut = isHumanClub(state, r.fromClubId);
  switch (r.kind) {
    case 'release':
      return `${who} foi dispensado pelo ${r.fromName} e está livre no mercado.`;
    case 'loan-return':
      return r.via === 'recall' ? `${who} foi chamado de volta pelo ${r.toName} e deixa o ${r.fromName}.` : `${who} volta ao ${r.toName} após o fim do empréstimo.`;
    case 'loan':
      return `${who} é emprestado pelo ${r.fromName} ao ${r.toName}${r.fee ? ` (${fmtMoneyPt(r.fee)})` : ''}.`;
    case 'free':
    case 'precontract':
      return humanIn ? `Chegou! ${who} assina com o ${r.toName} sem custos de transferência.` : `${who}, que estava livre, assina com o ${r.toName}.`;
    default:
      if (r.via === 'option') return `${who} fica no ${r.toName}: opção de compra de ${fmtMoneyPt(r.fee)} exercida junto ao ${r.fromName}.`;
      if (r.via === 'clause') {
        if (humanOut) return `Multa paga! O ${r.toName} deposita ${fmtMoneyPt(r.fee)} e tira ${who} do ${r.fromName}.`;
        return `Multa rescisória: o ${r.toName} paga ${fmtMoneyPt(r.fee)} e leva ${who} do ${r.fromName}.`;
      }
      if (humanIn) return `Chegou! ${who} é o novo reforço do ${r.toName}: ${fmtMoneyPt(r.fee)} pagos ao ${r.fromName}.`;
      if (humanOut) return `Vendido! ${who} deixa o ${r.fromName} rumo ao ${r.toName} por ${fmtMoneyPt(r.fee)}.`;
      return `Mercado: ${who} troca o ${r.fromName} pelo ${r.toName} por ${fmtMoneyPt(r.fee)}.`;
  }
}

/* ───────────── utilidades (Etapa 5) ───────────── */

/** Luvas (bônus de assinatura) de livres e pré-contratos: 25% do valor sem contrato (na liga do comprador). */
export function signingBonus(state: SeasonState, p: Player, buyerId: string): number {
  const worth = state.career ? careerWorth(state, p, buyerId) : p.value;
  return Math.round((worth * FINANCE.luvaShare) / 1000) * 1000;
}

/** Pode assinar pré-contrato: tem clube, não está emprestado e faltam ≤ 6 meses de contrato. */
export function preContractOpen(state: SeasonState, p: Player, clubId: string): boolean {
  if (!clubId) return false;
  const c = state.market?.contracts[p.id];
  if (c?.kind === 'loan') return false;
  if (state.market?.preContracts?.[p.id]) return false;
  const m = monthsLeftOf(state, p, clubId);
  return m !== null && m <= MARKET.preContractMonths;
}

/** Multiplicador de liga do clube atual de um jogador (livre: a liga dos dados do clube de origem). */
function fromLeagueOf(state: SeasonState, squads: Squads, clubId: string, p: Player, ext?: ExternalClubInfo): number {
  if (!clubId) return dataLeagueMult(state, baseClubOf(p.id)) ?? 0.5;
  return clubView(state, squads, clubId, ext).league;
}

/* ───────────── etapa 1: proposta ao clube ───────────── */

export interface OfferRequest {
  buyerId: string;
  player: Player;
  fee: number;
  /** (Etapa 5) 'precontract' = jogador nos últimos 6 meses de contrato (sem taxa) */
  kind?: 'transfer' | 'loan' | 'precontract';
  /** continua uma negociação existente (próxima rodada) */
  offerId?: string;
  /** dados do vendedor quando ele não está na temporada (outro país) */
  sellerInfo?: ExternalClubInfo;
  /** (Etapa 5) termos do empréstimo */
  loan?: LoanTerms;
  /** (Etapa 5) deposita a multa rescisória (venda forçada; o valor é a multa vigente) */
  clause?: boolean;
}

function validateBuyer(state: SeasonState, squads: Squads, buyerId: string, fee: number, kind: TransferKind): string | null {
  const m = state.market!;
  // (Etapa 5) inscrição: janela da região do COMPRADOR; livres e pré-contratos não dependem dela
  if (kind !== 'free' && kind !== 'precontract' && !marketWindow(state, buyerId).open) {
    return 'A janela de transferências está fechada. Fora da janela só é possível contratar jogadores livres e assinar pré-contratos.';
  }
  const buyer = state.clubs[buyerId];
  if (!buyer) return 'Clube comprador fora da temporada.';
  // (Etapa 4) o humano pode usar o cheque especial até o limite do clube (juros de 2,5% ao mês)
  const credit = Math.max(m.rules.overdraft, state.clubInfo?.[buyerId]?.creditLimit ?? 0);
  if (isHumanClub(state, buyerId) && buyer.balance - fee < -credit) {
    return `Saldo insuficiente: o caixa é de ${fmtMoneyPt(buyer.balance)}${credit ? ` (limite do cheque especial: ${fmtMoneyPt(-credit)})` : ''}.`;
  }
  if (kind !== 'precontract' && squads(buyerId).length >= m.rules.maxSquad) return `O elenco já tem ${m.rules.maxSquad} jogadores (máximo).`;
  // (Mercado e Orçamentos) taxas e multas saem do orçamento de transferências do humano
  if (kind !== 'free' && kind !== 'precontract' && isHumanClub(state, buyerId)) {
    const be = transferBudgetError(state, buyerId, fee);
    if (be) return be;
  }
  return null;
}

export function makeOffer(input: SeasonState, squads: Squads, req: OfferRequest): MarketResult {
  if (!input.market) return { state: input, error: 'Mercado não inicializado.' };
  const player = req.player;
  const sellerId = currentClubOf(input, player.id);
  if (sellerId === req.buyerId) return { state: input, error: 'O jogador já é do seu clube.' };
  // (Etapa 5) pré-contrato não depende do clube (nem de um dono humano): a conversa é direto com o jogador
  if (sellerId !== FREE && isHumanClub(input, sellerId) && req.kind !== 'precontract') return { state: input, error: 'Negociação entre clubes humanos não suportada.' };
  const kind: TransferKind = sellerId === FREE ? 'free' : (req.kind ?? 'transfer');
  if (kind === 'precontract' && !preContractOpen(input, player, sellerId)) {
    return { state: input, error: `Pré-contrato só nos últimos ${MARKET.preContractMonths} meses de contrato (e com o jogador fora de empréstimo).` };
  }
  // (Mercado e Orçamentos) vendedor irritado com propostas insistentes: sem negociação até a data
  if (kind === 'transfer' || kind === 'loan') {
    const blk = negotiationBlock(input, player.id, req.buyerId);
    if (blk) return { state: input, error: blockMessage(blk.until) };
  }
  let fee = kind === 'free' || kind === 'precontract' ? 0 : Math.max(0, Math.round(req.fee));
  const clause = kind === 'transfer' && !!req.clause;
  if (clause) fee = releaseClauseOf(input, player, sellerId);

  const prev = req.offerId ? input.market.offers.find((o) => o.id === req.offerId) : undefined;
  if (req.offerId && (!prev || prev.status !== 'negotiating')) return { state: input, error: 'Esta negociação já foi encerrada.' };
  if (!prev && input.market.offers.some((o) => o.playerId === player.id && o.toClubId === req.buyerId && (o.status === 'negotiating' || o.status === 'agreed'))) {
    return { state: input, error: 'Já existe uma negociação aberta por este jogador.' };
  }
  const err = validateBuyer(input, squads, req.buyerId, fee, kind);
  if (err) return { state: input, error: err };

  const state = clone(input);
  const m = state.market!;
  const date = state.date;
  let offer: TransferOffer;
  if (prev) {
    offer = m.offers.find((o) => o.id === prev.id)!;
    offer.round += 1;
    offer.fee = fee;
    offer.updatedOn = date;
  } else {
    offer = {
      id: `o${++m.seq}`,
      kind,
      playerId: player.id,
      player: { ...player },
      fromClubId: sellerId,
      fromName: clubName(state, sellerId, req.sellerInfo),
      toClubId: req.buyerId,
      toName: clubName(state, req.buyerId),
      fee,
      round: 1,
      contractRound: 0,
      status: 'negotiating',
      createdOn: date,
      updatedOn: date,
      log: [],
    };
    m.offers.unshift(offer);
  }
  if (kind === 'loan') offer.loan = { wageShare: 100, ...(req.loan ?? {}) };
  if (clause) offer.clause = true;
  offer.log.push({ by: 'buyer', fee, date, ...(clause ? { text: 'Depósito da multa rescisória.' } : kind === 'loan' && offer.loan ? { text: loanText(offer.loan) } : {}) });

  if (kind === 'free' || kind === 'precontract') {
    offer.status = 'agreed';
    if (kind === 'precontract') offer.log.push({ by: 'seller', decision: 'accept', date, text: `Contrato com o ${offer.fromName} termina em ${monthsText(monthsLeftOf(state, player, sellerId))}: dá para negociar direto com o jogador.` });
    return { state, offer };
  }

  const seller = clubView(state, squads, sellerId, req.sellerInfo);
  const buyer = clubView(state, squads, req.buyerId);
  const decision = evaluateOffer(state, { player, fee, round: offer.round, kind, seller, buyer, loan: offer.loan, clause });
  offer.log.push({ by: 'seller', decision: decision.decision, fee: decision.counterFee, date, text: decision.reason });
  offer.counterFee = decision.counterFee;
  if (decision.counterLoan) offer.counterLoan = decision.counterLoan;
  if (decision.decision === 'accept') {
    if (decision.clause) offer.clause = true;
    if (kind === 'loan') {
      const terms = offer.loan!;
      const loanWage = Math.round((player.wage * terms.wageShare) / 100);
      // (Etapa 4) teto da folha da diretoria (o emprestado chega com a parte combinada do salário)
      if (isHumanClub(input, req.buyerId)) {
        const ck = checkWageCeiling(input, req.buyerId, squads(req.buyerId), loanWage);
        if (!ck.ok) return { state: input, error: ceilingError(ck) };
      }
      // o jogador topa ir emprestado? (interesse: liga, minutos, reputação)
      const appeal = playerAppeal(state, { player, buyer, fromReputation: seller.reputation, fromLeague: seller.league, kind: 'loan' });
      if (appeal.score < APPEAL_MIN) {
        offer.status = 'collapsed';
        offer.log.push({ by: 'player', decision: 'reject', date, text: `${player.name} não quis ir: ${appeal.reason}.` });
        return { state, offer, club: decision };
      }
      offer.status = 'completed';
      offer.wage = player.wage;
      offer.log.push({ by: 'player', decision: 'accept', date, text: `${player.name} topou o empréstimo.` });
      const record = applyTransfer(state, {
        player, fromClubId: sellerId, toClubId: req.buyerId, fee, wage: player.wage, years: 1, kind: 'loan', loan: terms,
        fromName: offer.fromName,
      });
      return { state, offer, club: decision, record };
    }
    offer.status = 'agreed';
  } else if (decision.final) {
    offer.status = 'rejected';
  }
  // (Mercado e Orçamentos) recusa conta para o vendedor se irritar (3ª na janela ⇒ 14 dias sem negociar)
  if (decision.decision === 'reject' && !clause) noteRejection(state, offer);
  return { state, offer, club: decision };
}

function loanText(l: LoanTerms): string {
  return `Empréstimo${l.months ? ` de ${l.months} meses` : ''}: ${l.wageShare}% do salário${l.purchaseOption ? `, opção de compra ${fmtMoneyPt(l.purchaseOption)}` : ''}${l.recall ? ', com retorno antecipado' : ''}.`;
}

function monthsText(m: number | null): string {
  if (m === null) return '—';
  const n = Math.max(0, Math.round(m));
  return n <= 1 ? 'menos de 1 mês' : `${n} meses`;
}

/* ───────────── etapa 2: contrato com o jogador ───────────── */

export interface ContractRequest {
  offerId: string;
  wage: number;
  years: number;
  sellerInfo?: ExternalClubInfo;
  /**
   * Luvas, só para LIVRES e PRÉ-CONTRATOS (25% do valor sem contrato): 0 = à vista, 6 ou 12 = parcelas mensais sem
   * juros (LuvaDebt). Ausente = sem luva (comportamento da Fase 1).
   */
  luva?: number;
  /** (Etapa 5) multa rescisória do contrato novo (ausente = a padrão: 2,2–4× o valor) */
  releaseClause?: number;
}

export function proposeContract(input: SeasonState, squads: Squads, req: ContractRequest): MarketResult {
  const o0 = input.market?.offers.find((o) => o.id === req.offerId);
  if (!o0 || o0.status !== 'agreed') return { state: input, error: 'Não há acordo com o clube para esta negociação.' };
  if (currentClubOf(input, o0.playerId) !== o0.fromClubId) return { state: input, error: 'O jogador já não está no mesmo clube.' };
  const err = validateBuyer(input, squads, o0.toClubId, o0.fee, o0.kind);
  if (err) return { state: input, error: err };
  if (req.releaseClause !== undefined && !(req.releaseClause >= 0)) return { state: input, error: 'Multa rescisória inválida.' };
  // (Etapa 4) teto da folha salarial definido pela diretoria: o contrato não pode levar a folha acima dele
  if (isHumanClub(input, o0.toClubId)) {
    const ck = checkWageCeiling(input, o0.toClubId, squads(o0.toClubId), Math.round(req.wage));
    if (!ck.ok) return { state: input, error: ceilingError(ck) };
  }
  const bonusKind = o0.kind === 'free' || o0.kind === 'precontract';
  const withLuva = bonusKind && req.luva !== undefined;
  if (withLuva && !FINANCE.luvaInstallments.includes(req.luva as 0 | 6 | 12)) return { state: input, error: 'Luva: escolha à vista (0) ou 6/12 parcelas.' };
  const luvaTotal = withLuva ? signingBonus(input, o0.player, o0.toClubId) : 0;
  if (withLuva && req.luva === 0) {
    const buyerState = input.clubs[o0.toClubId];
    const credit = Math.max(input.market?.rules.overdraft ?? 0, input.clubInfo?.[o0.toClubId]?.creditLimit ?? 0);
    if (buyerState && isHumanClub(input, o0.toClubId) && buyerState.balance - luvaTotal < -credit) {
      return { state: input, error: `Saldo insuficiente para pagar a luva à vista (${fmtMoneyPt(luvaTotal)}).` };
    }
  }

  const state = clone(input);
  const m = state.market!;
  const offer = m.offers.find((o) => o.id === req.offerId)!;
  const date = state.date;
  offer.contractRound += 1;
  offer.updatedOn = date;
  const years = Math.round(req.years);
  const wage = Math.round(req.wage);
  const releaseClause = req.releaseClause !== undefined ? Math.round(req.releaseClause) : undefined;
  offer.log.push({ by: 'buyer', wage, years, date, ...(releaseClause ? { text: `Multa rescisória: ${fmtMoneyPt(releaseClause)}.` } : {}) });
  const buyer = clubView(state, squads, offer.toClubId);
  const fromRep = offer.fromClubId === FREE ? 1 : clubView(state, squads, offer.fromClubId, req.sellerInfo).reputation;
  const fromLeague = fromLeagueOf(state, squads, offer.fromClubId, offer.player, req.sellerInfo);
  const decision = evaluateContract(state, {
    player: offer.player, buyer, fromReputation: fromRep, fromLeague, kind: offer.kind, wage, years, round: offer.contractRound, releaseClause,
  });
  offer.log.push({ by: 'player', decision: decision.decision, wage: decision.demand.wage, years: decision.demand.minYears, date, text: decision.reason });
  if (decision.decision === 'accept') {
    offer.status = 'completed';
    offer.wage = wage;
    offer.years = years;
    if (releaseClause) offer.releaseClause = releaseClause;
    if (withLuva) offer.luva = luvaTotal;
    if (offer.kind === 'precontract') {
      const pc: PreContract = {
        playerId: offer.playerId, playerName: offer.player.name, fromClubId: offer.fromClubId, toClubId: offer.toClubId, toName: offer.toName,
        wage, years, ...(releaseClause ? { releaseClause } : {}), signedOn: date,
      };
      (m.preContracts ??= {})[offer.playerId] = pc;
      (m.tally ??= emptyTally()).precontracts++;
      if (withLuva) chargeLuva(state, offer.toClubId, { ...offer.player, value: luvaTotal / FINANCE.luvaShare }, req.luva!);
      const when = regionOfClub(state, offer.fromClubId);
      state.news.push({
        date,
        text: `Pré-contrato! ${offer.player.name} assina com o ${offer.toName} e chega quando terminar o contrato com o ${offer.fromName}${when ? ` (virada de ${when === 'SA' ? 'dezembro' : 'junho'})` : ''}.`,
        clubId: isHumanClub(state, offer.toClubId) ? offer.toClubId : offer.fromClubId,
      });
      if (isHumanClub(state, offer.fromClubId) && isHumanClub(state, offer.toClubId)) {
        state.news.push({ date, text: `${offer.player.name} assinou pré-contrato com o ${offer.toName} e deixa o ${offer.fromName} no fim do contrato.`, clubId: offer.fromClubId });
      }
      return { state, offer, contract: decision, preContract: pc };
    }
    const record = applyTransfer(state, {
      player: offer.player, fromClubId: offer.fromClubId, toClubId: offer.toClubId, fee: offer.fee, wage, years,
      kind: offer.kind === 'free' ? 'free' : 'transfer', fromName: offer.fromName, releaseClause, ...(offer.clause ? { via: 'clause' as const } : {}),
    });
    if (withLuva) chargeLuva(state, offer.toClubId, { ...offer.player, value: luvaTotal / FINANCE.luvaShare }, req.luva!);
    return { state, offer, contract: decision, record };
  }
  offer.askedWage = decision.demand.wage;
  offer.askedYears = Math.min(decision.demand.maxYears, Math.max(decision.demand.minYears, years));
  if (decision.final) offer.status = 'collapsed';
  return { state, offer, contract: decision };
}

/** Sugestão de contrato para a UI (salário exigido e faixa de anos), sem alterar o estado. */
export function suggestContract(state: SeasonState, squads: Squads, offer: TransferOffer, years?: number, sellerInfo?: ExternalClubInfo, releaseClause?: number) {
  const buyer = clubView(state, squads, offer.toClubId);
  const fromRep = offer.fromClubId === FREE ? 1 : clubView(state, squads, offer.fromClubId, sellerInfo).reputation;
  const fromLeague = fromLeagueOf(state, squads, offer.fromClubId, offer.player, sellerInfo);
  return contractDemand(state, { player: offer.player, buyer, fromReputation: fromRep, fromLeague, kind: offer.kind, releaseClause }, years);
}

/** (Etapa 5) Interesse do jogador no clube comprador (para a UI avisar antes de propor). */
export function suggestAppeal(state: SeasonState, squads: Squads, offer: TransferOffer, sellerInfo?: ExternalClubInfo) {
  const buyer = clubView(state, squads, offer.toClubId);
  const fromRep = offer.fromClubId === FREE ? 1 : clubView(state, squads, offer.fromClubId, sellerInfo).reputation;
  const fromLeague = fromLeagueOf(state, squads, offer.fromClubId, offer.player, sellerInfo);
  const a = playerAppeal(state, { player: offer.player, buyer, fromReputation: fromRep, fromLeague, kind: offer.kind });
  return { ...a, refuses: a.score < APPEAL_MIN, moneyTalks: MONEY_TALKS };
}

/* ───────────── humano vendendo ───────────── */

/**
 * Etapa do jogador numa venda do humano para a IA (MUTA): o comprador oferece o salário pedido; o jogador pode
 * recusar o clube (interesse). Devolve o registro ou null (negócio desfeito).
 */
function completeSaleToAi(state: SeasonState, squads: Squads, offer: TransferOffer): TransferRecord | null {
  const date = state.date;
  const player = squads(offer.fromClubId).find((p) => p.id === offer.playerId) ?? offer.player;
  const buyer = clubView(state, squads, offer.toClubId);
  const seller = clubView(state, squads, offer.fromClubId);
  if (offer.kind === 'loan') {
    const terms = offer.loan ?? { wageShare: 100 };
    offer.status = 'completed';
    offer.wage = player.wage;
    offer.log.push({ by: 'player', decision: 'accept', date, text: `${player.name} topou o empréstimo.` });
    return applyTransfer(state, { player, fromClubId: offer.fromClubId, toClubId: offer.toClubId, fee: offer.fee, wage: player.wage, years: 1, kind: 'loan', loan: terms });
  }
  const input = { player, buyer, fromReputation: seller.reputation, fromLeague: seller.league };
  const demand = contractDemand(state, input);
  // a IA paga acima do pedido quando o clube é bancado (PIF) e o jogador é veterano
  const pif = !!state.clubInfo?.[offer.toClubId]?.ownerBacked;
  const wage = Math.round(demand.wage * (pif && player.age >= 29 ? 1.8 : 1));
  const appeal = playerAppeal(state, input);
  if (appeal.score < APPEAL_MIN && wage < demand.wage * MONEY_TALKS) {
    offer.status = 'collapsed';
    offer.log.push({ by: 'player', decision: 'reject', date, text: `${player.name} recusou o ${offer.toName}: ${appeal.reason}.` });
    state.news.push({ date, text: `Negócio desfeito: ${player.name} não quis se transferir para o ${offer.toName}.`, clubId: offer.fromClubId });
    return null;
  }
  const years = Math.min(demand.maxYears, demand.minYears + 1);
  offer.status = 'completed';
  offer.wage = wage;
  offer.years = years;
  offer.log.push({ by: 'player', decision: 'accept', wage, years, date, text: `${player.name} acertou com o ${offer.toName}.` });
  return applyTransfer(state, { player, fromClubId: offer.fromClubId, toClubId: offer.toClubId, fee: offer.fee, wage, years, kind: 'transfer', ...(offer.clause ? { via: 'clause' as const } : {}) });
}

function checkSale(state: SeasonState, squads: Squads, offer: TransferOffer): string | null {
  const m = state.market!;
  // (Etapa 5) inscrição: janela da região do COMPRADOR
  if (!marketWindow(state, offer.toClubId).open) return 'A janela do clube comprador fechou; a oferta expirou.';
  if (currentClubOf(state, offer.playerId) !== offer.fromClubId) return 'O jogador já não está no clube.';
  if (squads(offer.fromClubId).length - 1 < m.rules.minSquad) return `O elenco não pode ficar com menos de ${m.rules.minSquad} jogadores.`;
  const buyerState = state.clubs[offer.toClubId];
  if (buyerState && buyerState.balance < offer.fee) return `O ${offer.toName} não tem mais caixa para a compra.`;
  return null;
}

/** Humano aceita/recusa uma oferta recebida da IA. Aceita: etapa do jogador (ele pode recusar o clube). */
export function respondToOffer(input: SeasonState, squads: Squads, offerId: string, accept: boolean): MarketResult {
  const o0 = input.market?.offers.find((o) => o.id === offerId);
  if (!o0 || o0.status !== 'pending') return { state: input, error: 'Oferta não está mais disponível.' };
  const state = clone(input);
  const offer = state.market!.offers.find((o) => o.id === offerId)!;
  offer.updatedOn = state.date;
  if (!accept) {
    offer.status = 'rejected';
    offer.log.push({ by: 'seller', decision: 'reject', date: state.date });
    return { state, offer };
  }
  const bad = checkSale(state, squads, offer);
  if (bad) {
    if (bad.startsWith('O elenco')) return { state: input, error: bad };
    offer.status = 'expired';
    return { state, offer, error: bad };
  }
  offer.log.push({ by: 'seller', decision: 'accept', fee: offer.fee, date: state.date });
  const record = completeSaleToAi(state, squads, offer);
  return record ? { state, offer, record } : { state, offer };
}

/**
 * (Etapa 5) Humano faz uma contraproposta a uma oferta recebida da IA. Até o teto do comprador (`maxFee`), ele
 * aceita e o negócio segue para o jogador; acima, o comprador melhora a oferta (até 3 rodadas) ou desiste.
 */
export function counterIncoming(input: SeasonState, squads: Squads, offerId: string, fee: number): MarketResult {
  const o0 = input.market?.offers.find((o) => o.id === offerId);
  if (!o0 || o0.status !== 'pending') return { state: input, error: 'Oferta não está mais disponível.' };
  if (o0.kind === 'loan') return { state: input, error: 'Empréstimos: aceite ou recuse.' };
  if (isHumanClub(input, o0.toClubId)) return { state: input, error: 'Proposta de outro técnico: aceite ou recuse.' };
  const ask = Math.max(0, Math.round(fee));
  if (ask <= o0.fee) return respondToOffer(input, squads, offerId, true);
  const state = clone(input);
  const offer = state.market!.offers.find((o) => o.id === offerId)!;
  const date = state.date;
  offer.round += 1;
  offer.updatedOn = date;
  offer.log.push({ by: 'seller', decision: 'counter', fee: ask, date, text: `Você pediu ${fmtMoneyPt(ask)}.` });
  const max = offer.maxFee ?? offer.fee;
  if (ask <= max) {
    const bad = checkSale(state, squads, { ...offer, fee: ask });
    if (bad) {
      if (bad.startsWith('O elenco')) return { state: input, error: bad };
      offer.status = 'expired';
      return { state, offer, error: bad };
    }
    offer.fee = ask;
    offer.log.push({ by: 'buyer', decision: 'accept', fee: ask, date, text: `O ${offer.toName} aceitou pagar ${fmtMoneyPt(ask)}.` });
    const record = completeSaleToAi(state, squads, offer);
    return record ? { state, offer, record } : { state, offer };
  }
  if (offer.round >= MARKET.maxRounds) {
    offer.status = 'rejected';
    offer.log.push({ by: 'buyer', decision: 'reject', date, text: `O ${offer.toName} desistiu: não passa de ${fmtMoneyPt(max)}.` });
    return { state, offer };
  }
  // melhora a oferta: metade do caminho até o teto
  const better = Math.round((offer.fee + (max - offer.fee) * 0.6) / 50_000) * 50_000;
  offer.fee = Math.max(offer.fee, better);
  offer.log.push({ by: 'buyer', decision: 'counter', fee: offer.fee, date, text: `O ${offer.toName} melhora a oferta para ${fmtMoneyPt(offer.fee)}.` });
  return { state, offer };
}

/** Humano desiste de uma negociação aberta. */
export function withdrawOffer(input: SeasonState, offerId: string): MarketResult {
  const o0 = input.market?.offers.find((o) => o.id === offerId);
  if (!o0 || (o0.status !== 'negotiating' && o0.status !== 'agreed')) return { state: input, error: 'Negociação já encerrada.' };
  const state = clone(input);
  const offer = state.market!.offers.find((o) => o.id === offerId)!;
  offer.status = 'withdrawn';
  offer.updatedOn = state.date;
  return { state, offer };
}

/** Coloca/retira um jogador da lista de transferências. */
export function setTransferListed(input: SeasonState, playerId: string, listed: boolean): SeasonState {
  const m = input.market;
  if (!m) return input;
  const has = m.transferList.includes(playerId);
  if (has === listed) return input;
  const transferList = listed ? [...m.transferList, playerId] : m.transferList.filter((id) => id !== playerId);
  return { ...input, market: { ...m, transferList } };
}

/** (Etapa 5) Coloca/retira um jogador da lista de empréstimo (a IA faz propostas de empréstimo na janela). */
export function setLoanListed(input: SeasonState, playerId: string, listed: boolean, months?: number): SeasonState {
  const m = input.market;
  if (!m) return input;
  const cur = m.loanList ?? [];
  const has = cur.includes(playerId);
  // (18/11) duração pedida (6–24 meses); o clube que recebe paga o salário inteiro
  const mo = months !== undefined ? Math.min(24, Math.max(6, Math.round(months / 6) * 6)) : undefined;
  if (has === listed && (mo === undefined || m.loanMonths?.[playerId] === mo)) return input;
  const loanList = listed ? (has ? cur : [...cur, playerId]) : cur.filter((id) => id !== playerId);
  const loanMonths = { ...(m.loanMonths ?? {}) };
  if (listed && mo !== undefined) loanMonths[playerId] = mo;
  if (!listed) delete loanMonths[playerId];
  return { ...input, market: { ...m, loanList, loanMonths } };
}

/**
 * Rescinde o contrato: o jogador fica livre. O clube paga 3 salários de multa (categoria transferências).
 */
export function releasePlayer(input: SeasonState, squads: Squads, clubId: string, playerId: string): MarketResult {
  if (!input.market) return { state: input, error: 'Mercado não inicializado.' };
  const squad = squads(clubId);
  const p = squad.find((x) => x.id === playerId);
  if (!p) return { state: input, error: 'Jogador não está no elenco.' };
  if (squad.length - 1 < input.market.rules.minSquad) return { state: input, error: `O elenco não pode ficar com menos de ${input.market.rules.minSquad} jogadores.` };
  const c = input.market.contracts[playerId];
  if (c?.kind === 'loan' && c.loanFrom && c.loanFrom !== clubId) return { state: input, error: 'Jogador emprestado: não dá para rescindir (devolva ao fim do empréstimo).' };
  const state = clone(input);
  const fine = p.wage * 3;
  const club = state.clubs[clubId];
  if (club) {
    club.balance -= fine;
    const l = ledgerOf(state, clubId)!;
    l.transfers = (l.transfers ?? 0) - fine;
  }
  const record = applyTransfer(state, { player: p, fromClubId: clubId, toClubId: FREE, fee: 0, wage: p.wage, years: 0, kind: 'release', quiet: !isHumanClub(state, clubId) });
  return { state, record };
}

/* ───────────── (Etapa 5) empréstimos: opção de compra e retorno antecipado ───────────── */

/**
 * Exerce a opção de compra de um jogador emprestado ao clube (paga o valor fixo ao dono; contrato novo de `years`
 * anos pelo salário atual). Pode ser feito a qualquer momento do empréstimo (o jogador já está inscrito).
 */
export function exercisePurchaseOption(input: SeasonState, squads: Squads, clubId: string, playerId: string, years = 3): MarketResult {
  const c = input.market?.contracts[playerId];
  if (!c || c.kind !== 'loan' || !c.loanFrom || currentClubOf(input, playerId) !== clubId) return { state: input, error: 'Este jogador não está emprestado ao seu clube.' };
  if (c.purchaseOption === undefined) return { state: input, error: 'O empréstimo não tem opção de compra.' };
  const p = squads(clubId).find((x) => x.id === playerId) ?? input.market!.players[playerId];
  if (!p) return { state: input, error: 'Jogador não encontrado.' };
  const buyer = input.clubs[clubId];
  const credit = Math.max(input.market!.rules.overdraft, input.clubInfo?.[clubId]?.creditLimit ?? 0);
  if (buyer && isHumanClub(input, clubId) && buyer.balance - c.purchaseOption < -credit) return { state: input, error: `Saldo insuficiente para a opção de compra (${fmtMoneyPt(c.purchaseOption)}).` };
  if (isHumanClub(input, clubId)) {
    const be = transferBudgetError(input, clubId, c.purchaseOption);
    if (be) return { state: input, error: be };
  }
  if (isHumanClub(input, clubId) && (c.wageShare ?? 100) < 100) {
    const ck = checkWageCeiling(input, clubId, squads(clubId), Math.round((p.wage * (100 - (c.wageShare ?? 100))) / 100));
    if (!ck.ok) return { state: input, error: ceilingError(ck) };
  }
  const state = clone(input);
  delete state.market!.contracts[playerId];
  const record = applyTransfer(state, { player: p, fromClubId: c.loanFrom, toClubId: clubId, fee: c.purchaseOption, wage: p.wage, years: Math.max(1, Math.min(5, Math.round(years))), kind: 'transfer', via: 'option' });
  return { state, record };
}

/** Chama de volta um jogador emprestado (só com retorno antecipado no contrato e a janela do dono aberta). */
export function recallLoan(input: SeasonState, squads: Squads, ownerId: string, playerId: string): MarketResult {
  const m = input.market;
  const c = m?.contracts[playerId];
  if (!m || !c || c.kind !== 'loan' || c.loanFrom !== ownerId) return { state: input, error: 'Este jogador não está emprestado pelo seu clube.' };
  if (!c.recall) return { state: input, error: 'O empréstimo não prevê retorno antecipado.' };
  if (!marketWindow(input, ownerId).open) return { state: input, error: 'O retorno antecipado só pode ser feito com a janela aberta.' };
  const holder = currentClubOf(input, playerId);
  const p = squads(holder).find((x) => x.id === playerId) ?? m.players[playerId];
  if (!p) return { state: input, error: 'Jogador não encontrado.' };
  const state = clone(input);
  const record = applyTransfer(state, { player: p, fromClubId: holder, toClubId: ownerId, fee: 0, wage: p.wage, years: 0, kind: 'loan-return', via: 'recall' });
  return { state, record };
}

/* ───────────── (Etapa 5) renovação durante a temporada ───────────── */

/** Pedido do jogador para renovar com o próprio clube agora (salário de mercado no patamar atual). */
export function renewalAsk(state: SeasonState, squads: Squads, clubId: string, p: Player, years?: number) {
  const buyer = clubView(state, squads, clubId);
  const base = { ...p, wage: Math.max(p.wage, monthlyWage(p.age, p.overall, buyer.reputation)) };
  return contractDemand(state, { player: base, buyer, fromReputation: buyer.reputation, fromLeague: buyer.league, kind: 'loan' }, years);
}

/**
 * Renova o contrato de um jogador do clube durante a temporada (o humano pode se antecipar a um pré-contrato).
 * O jogador aceita salário ≥ pedido; jogador com pré-contrato assinado com outro clube não renova.
 */
export function renewContract(input: SeasonState, squads: Squads, clubId: string, playerId: string, wage: number, years: number, releaseClause?: number): MarketResult {
  const m = input.market;
  if (!m) return { state: input, error: 'Mercado não inicializado.' };
  const p = squads(clubId).find((x) => x.id === playerId);
  if (!p) return { state: input, error: 'Jogador não está no elenco.' };
  const c = m.contracts[playerId];
  if (c?.kind === 'loan' && c.loanFrom !== clubId) return { state: input, error: 'Jogador emprestado: a renovação é com o clube dono.' };
  if (m.preContracts?.[playerId]) return { state: input, error: `${p.name} já assinou pré-contrato com o ${m.preContracts[playerId].toName}.` };
  if (years < 1 || years > 5) return { state: input, error: 'Contratos vão de 1 a 5 anos.' };
  const ask = renewalAsk(input, squads, clubId, p, years);
  if (Math.round(wage) < ask.wage) return { state: input, error: `${p.name} pede ${fmtMoneyPt(ask.wage)}/mês para renovar por ${years} ${years > 1 ? 'anos' : 'ano'}.` };
  if (isHumanClub(input, clubId)) {
    const ck = checkWageCeiling(input, clubId, squads(clubId), Math.round(wage), p.wage);
    if (!ck.ok) return { state: input, error: ceilingError(ck) };
  }
  const state = clone(input);
  renewInPlace(state, clubId, p, Math.round(wage), years, releaseClause);
  state.news.push({ date: state.date, text: `${p.name} renovou com o ${clubName(state, clubId)} por ${years} ${years > 1 ? 'anos' : 'ano'} (${fmtMoneyPt(Math.round(wage))}/mês).`, clubId });
  return { state };
}

/** Renovação (MUTA): contrato novo no mesmo clube. Usada pelo humano e pela IA (contratos-chave). */
export function renewInPlace(state: SeasonState, clubId: string, p: Player, wage0: number, years: number, releaseClause?: number): void {
  const m = state.market!;
  // (18/11) renovação respeita o piso salarial do overall
  const wage = withWageFloor(wage0, p.age, p.overall);
  const prev = m.contracts[p.id];
  // a renovação nunca encurta o contrato vigente
  const current = ownerContractEnd(state, p).endsSeason;
  // jogador que já mudou de clube (tem cópia no mercado): a cópia leva o salário novo; no clube de origem, só o contrato
  if (m.players[p.id]) m.players[p.id] = { ...m.players[p.id], wage };
  m.contracts[p.id] = {
    wage, endsSeason: Math.max(current, contractEndsSeason(state, clubId, years)), since: state.date, fee: 0, kind: 'renewal',
    ...(releaseClause ? { releaseClause: Math.round(releaseClause) } : prev?.releaseClause ? { releaseClause: prev.releaseClause } : {}),
  };
  (m.tally ??= emptyTally()).renewals++;
}

/* ───────────── utilidades para a UI ───────────── */

/** Ofertas recebidas pendentes do clube. */
export function incomingOffers(state: SeasonState, clubId: string): TransferOffer[] {
  return state.market?.offers.filter((o) => o.fromClubId === clubId && o.status === 'pending') ?? [];
}

/** Anos de contrato restantes (além da temporada atual). */
export function contractYearsLeft(state: SeasonState, p: Player): number {
  const o = ownerContractEnd(state, p);
  return Math.max(0, o.endsSeason - contractSeasonOf(state, o.clubId ?? currentClubOf(state, p.id)));
}

/** (Etapa 5) Jogadores emprestados: os que o clube recebeu e os que cedeu. */
export function loansOf(state: SeasonState, clubId: string): { incoming: string[]; outgoing: string[] } {
  const m = state.market;
  const incoming: string[] = [], outgoing: string[] = [];
  if (!m) return { incoming, outgoing };
  for (const [pid, c] of Object.entries(m.contracts)) {
    if (c.kind !== 'loan' || !c.loanFrom) continue;
    if (c.loanFrom === clubId) outgoing.push(pid);
    else if (m.moves[pid] === clubId) incoming.push(pid);
  }
  return { incoming, outgoing };
}

/** (Etapa 5) Valor arredondado (reexport para a UI). */
export const roundValue = roundMoney;
