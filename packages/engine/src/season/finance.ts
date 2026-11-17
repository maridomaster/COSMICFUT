/**
 * Economia fiel (Fase 2, spec §5.3–5.5) — funções PURAS (devolvem uma nova SeasonState; a entrada não muda).
 *
 *  - Ingresso: o humano define o preço (`setTicketPrice`); `suggestedTicketPrice` é o preço que a engine já
 *    usava (ECONOMY.ticketPrice × reputação). O público responde ao preço (`ticketDemandFactor`):
 *    acima do sugerido perde 50% do público por 100% de aumento (elasticidade da spec); abaixo ganha até +30%
 *    (limitado à capacidade). Renda = público × preço (mandante; campo neutro 50/50).
 *  - Empréstimo bancário (`takeLoan`/`repayLoan`): blocos de R$ 500 mil, juros de 5% ao mês sobre a dívida,
 *    cobrados no dia 1 (`EXE:"Juros mensais (5%): "`). Teto `getMaxLoanForReputation` = 2M × (rep + 1).
 *  - Expansão do estádio (`expandStadium`): R$ 1.000 por lugar ("1 milhão/1000 lugares"), pago na hora;
 *    obra de 30 + 10 × ⌈lugares/1000⌉ dias (proposta, confiança Baixa); uma obra por vez.
 *  - Luvas (`LuvaDebt`): 80% do valor de mercado ("80% do passe"), à vista ou em 6/12 parcelas sem juros,
 *    cobradas no dia 1; a dívida continua se o jogador sair; `payOffLuva` quita o restante.
 *    Integração com o mercado: `proposeContract(..., { luva: 0 | 6 | 12 })` (só jogadores livres).
 */
import type { Player } from '@cosmicfut/shared';
import type { ClubSeasonState, FinanceLedger, LuvaDebt, MatchResult, SeasonState } from '../contract';
import { ECONOMY, hasRealEconomy, realTicketPrice } from './economy';
import { boardWageCeiling, currentMonthFlow, ECON, hasEcon } from './econ';
import { fmtMoneyShort } from '../money';
import { addDays } from './schedule';

export const FINANCE = {
  /** bloco mínimo do empréstimo; (Etapa 4) o bloco do clube é 2,5% da receita anual (`loanBlockFor`) */
  loanBlock: 500_000,
  /** (Etapa 4) juros do empréstimo bancário: 1,2% ao mês (~15% ao ano); antes 5% (original). O cheque especial é 2,5%. */
  loanMonthlyRate: 0.012,
  /** teto do empréstimo = loanMaxBase × (reputação + 1) */
  loanMaxBase: 2_000_000,
  /** (escala real) teto alternativo = 35% da receita anual (o maior dos dois) */
  loanRevenueShare: 0.35,
  /** (Etapa 4) € por lugar novo (padrão; por região em `seatCostFor`: Europa 6.500, Arábia 5.000, América do Sul 3.500) */
  seatCost: 5_000,
  seatCostByRegion: { EU: 6_500, SAU: 5_000, SA: 3_500 } as Record<string, number>,
  worksBaseDays: 30,
  worksDaysPer1000: 10,
  /** limite de lugares por obra */
  maxSeatsPerWork: 50_000,
  /** (Etapa 4) luva = 25% do valor de mercado (antes 80%): o clube economiza a transferência do jogador livre */
  luvaShare: 0.25,
  luvaInstallments: [0, 6, 12] as const,
  /** elasticidade: perda de público por 100% acima do sugerido */
  priceElasticity: 0.5,
  /** ganho máximo de público com preço baixo */
  cheapBoost: 0.3,
  minTicketShare: 0.2,
  maxTicketShare: 5,
};

export interface FinanceResult {
  state: SeasonState;
  error?: string;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const byDiv = (t: Record<string, number>, div: number | undefined) => t[String(div ?? 'default')] ?? t.default;

function ledger(c: ClubSeasonState): FinanceLedger {
  return (c.finance ??= { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0, transfers: 0 });
}

/** Copia só o clube alterado (o resto é compartilhado com a entrada). */
function withClub(state: SeasonState, clubId: string, fn: (c: ClubSeasonState, s: SeasonState) => string | void): FinanceResult {
  const c0 = state.clubs[clubId];
  if (!c0) return { state, error: 'Clube fora da temporada.' };
  const c = clone(c0);
  const next: SeasonState = { ...state, clubs: { ...state.clubs, [clubId]: c }, news: state.news.slice() };
  const err = fn(c, next);
  if (err) return { state, error: err };
  return { state: next };
}

/* ───────────── ingresso ───────────── */

/** Preço sugerido (o que a engine cobra por padrão): ECONOMY.ticketPrice[div] × (1 + 0,1 × (rep − 2,5)). */
export function suggestedTicketPrice(state: SeasonState, clubId: string): number {
  const info = state.clubInfo?.[clubId];
  // (Etapa 4) preço-base do perfil econômico (bilheteria ≈ fatia de bilheteria da receita do clube)
  if (hasEcon(info)) return info.basePrice;
  // (escala real) preço calibrado pela receita do clube (REAL_ECONOMY.matchdayShare), capacidade e reputação
  if (hasRealEconomy(info)) return realTicketPrice(info);
  const p = byDiv(ECONOMY.ticketPrice, info?.division) * (1 + ECONOMY.ticketRepK * ((info?.reputation ?? 2.5) - 2.5));
  return Math.round(Math.max(0.2, p) * 100) / 100;
}

/** Preço efetivo do clube (definido pelo humano ou sugerido). */
export function ticketPriceOf(state: SeasonState, clubId: string): number {
  const p = state.clubs[clubId]?.ticketPrice;
  return p != null && p > 0 ? p : suggestedTicketPrice(state, clubId);
}

/** Multiplicador de público pelo preço (1 = preço sugerido). */
export function ticketDemandFactor(price: number, suggested: number): number {
  if (suggested <= 0) return 1;
  const r = price / suggested;
  if (r >= 1) return Math.max(0.05, 1 - FINANCE.priceElasticity * (r - 1));
  return 1 + FINANCE.cheapBoost * (1 - r);
}

/**
 * Público e renda de um jogo com o preço do clube. `attendance` é o público da simulação (ao preço sugerido).
 * Retorna o público ajustado (≤ capacidade) e a renda bruta.
 */
export function ticketSales(state: SeasonState, clubId: string, attendance: number): { attendance: number; revenue: number; price: number } {
  const sug = suggestedTicketPrice(state, clubId);
  const price = ticketPriceOf(state, clubId);
  const cap = state.clubInfo?.[clubId]?.capacity ?? Infinity;
  const att = Math.round(Math.min(cap, attendance * ticketDemandFactor(price, sug)));
  return { attendance: att, revenue: Math.round(att * price * ECONOMY.revenueMultiplier), price };
}

/**
 * (13/11) Fator de público do mandante pelo preço definido pelo humano (`MatchTeamInput.ticketDemand`).
 * `undefined` quando o clube usa o preço sugerido (fator 1).
 */
export function homeTicketDemand(state: SeasonState, clubId: string): number | undefined {
  const p = state.clubs[clubId]?.ticketPrice;
  if (p == null || !(p > 0)) return undefined;
  return ticketDemandFactor(p, suggestedTicketPrice(state, clubId));
}

/**
 * (13/11) Público pagante de um resultado, com o preço do mandante. Idempotente: se o resultado já traz o preço
 * aplicado (`result.ticketDemand`, simulação com `home.ticketDemand` ou resultado devolvido por advanceDay),
 * devolve `result.attendance` como está.
 */
export function resultAttendance(state: SeasonState, homeId: string, result: Pick<MatchResult, 'attendance' | 'ticketDemand'>): number {
  if (result.ticketDemand !== undefined) return result.attendance;
  if (homeTicketDemand(state, homeId) === undefined) return result.attendance;
  return ticketSales(state, homeId, result.attendance).attendance;
}

/** Define o preço do ingresso (null = voltar ao sugerido). Faixa: 20%–500% do sugerido. */
export function setTicketPrice(state: SeasonState, clubId: string, price: number | null): FinanceResult {
  const sug = suggestedTicketPrice(state, clubId);
  if (price !== null && (!(price > 0) || price < sug * FINANCE.minTicketShare || price > sug * FINANCE.maxTicketShare)) {
    return { state, error: `Preço fora da faixa permitida (${(sug * FINANCE.minTicketShare).toFixed(2)} a ${(sug * FINANCE.maxTicketShare).toFixed(2)}).` };
  }
  return withClub(state, clubId, (c) => {
    c.ticketPrice = price === null ? null : Math.round(price * 100) / 100;
  });
}

/* ───────────── empréstimo bancário ───────────── */

/** (Etapa 4) Bloco do empréstimo do clube: 2,5% da receita anual em valor "redondo" (mín. 500 mil). */
export function loanBlockFor(revenue: number | undefined): number {
  if (!(revenue && revenue > 0)) return FINANCE.loanBlock;
  const raw = Math.max(FINANCE.loanBlock, revenue / 40);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), mag);
  return Math.round(step);
}

const blockOf = (state: SeasonState, clubId: string) => loanBlockFor(state.clubInfo?.[clubId]?.revenue);

/** getMaxLoanForReputation: 2M × (rep + 1); (escala real) ou 35% da receita, em blocos do clube. */
export function maxLoan(reputation: number | undefined, revenue?: number): number {
  const base = FINANCE.loanMaxBase * (Math.max(0, reputation ?? 2) + 1);
  if (!(revenue && revenue > 0)) return base;
  const block = loanBlockFor(revenue);
  return Math.max(base, Math.floor((revenue * FINANCE.loanRevenueShare) / block) * block);
}

/** Juros do próximo mês (1,2% da dívida). */
export function loanInterest(loan: number | undefined): number {
  return Math.round((loan ?? 0) * FINANCE.loanMonthlyRate);
}

const ratePct = () => `${(FINANCE.loanMonthlyRate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** "Pegar empréstimo": toma `blocks` blocos (bloco do clube, `loanBlockFor`). */
export function takeLoan(state: SeasonState, clubId: string, blocks = 1): FinanceResult {
  const n = Math.floor(blocks);
  const block = blockOf(state, clubId);
  if (n < 1) return { state, error: `Informe ao menos 1 bloco de ${fmt(block)}.` };
  const cap = maxLoan(state.clubInfo?.[clubId]?.reputation, state.clubInfo?.[clubId]?.revenue);
  return withClub(state, clubId, (c, s) => {
    const amount = n * block;
    if ((c.loan ?? 0) + amount > cap) return `Limite de empréstimo atingido (máximo de ${fmt(cap)} para o clube).`;
    c.loan = (c.loan ?? 0) + amount;
    c.balance += amount;
    s.news.push({ date: s.date, text: `Empréstimo bancário de ${fmt(amount)} contratado. Dívida: ${fmt(c.loan)} (juros de ${ratePct()} ao mês).`, clubId });
  });
}

/** "Pagar": amortiza `blocks` blocos (o último bloco pode ser menor, se a dívida for menor). */
export function repayLoan(state: SeasonState, clubId: string, blocks = 1): FinanceResult {
  const n = Math.floor(blocks);
  const block = blockOf(state, clubId);
  if (n < 1) return { state, error: `Informe ao menos 1 bloco de ${fmt(block)}.` };
  return withClub(state, clubId, (c, s) => {
    const debt = c.loan ?? 0;
    if (debt <= 0) return 'O clube não tem empréstimo a pagar.';
    const amount = Math.min(debt, n * block);
    if (c.balance < amount) return `Saldo insuficiente para pagar ${fmt(amount)}.`;
    c.balance -= amount;
    c.loan = debt - amount;
    s.news.push({ date: s.date, text: `Pagamento de ${fmt(amount)} do empréstimo. Dívida restante: ${fmt(c.loan)}.`, clubId });
  });
}

/* ───────────── estádio ───────────── */

export function stadiumWorkDays(seats: number): number {
  return FINANCE.worksBaseDays + FINANCE.worksDaysPer1000 * Math.ceil(seats / 1000);
}

/** (Etapa 4) Custo por lugar novo na região do clube (€ 3,5–6,5 mil). */
export function seatCostFor(region: string | undefined): number {
  return FINANCE.seatCostByRegion[region ?? ''] ?? FINANCE.seatCost;
}

/** Custo da expansão (lugares × custo por lugar da região). */
export function stadiumExpansionCost(seats: number, region?: string): number {
  return Math.max(0, Math.round(seats)) * seatCostFor(region);
}

/** Expande o estádio em `seats` lugares: paga na hora; os lugares entram ao fim da obra. */
export function expandStadium(state: SeasonState, clubId: string, seats: number): FinanceResult {
  const n = Math.round(seats);
  if (!(n > 0)) return { state, error: 'Informe a quantidade de lugares.' };
  if (n > FINANCE.maxSeatsPerWork) return { state, error: `Máximo de ${FINANCE.maxSeatsPerWork.toLocaleString('pt-BR')} lugares por obra.` };
  const cost = stadiumExpansionCost(n, state.clubInfo?.[clubId]?.region);
  return withClub(state, clubId, (c, s) => {
    if (c.stadiumWork) return 'Já existe uma obra em andamento no estádio.';
    if (c.balance < cost) return `Saldo insuficiente: a obra custa ${fmt(cost)}.`;
    c.balance -= cost;
    const l = ledger(c);
    l.stadium = (l.stadium ?? 0) - cost;
    const until = addDays(s.date, stadiumWorkDays(n));
    c.stadiumWork = { seats: n, cost, started: s.date, until };
    s.news.push({ date: s.date, text: `Obra de expansão do estádio iniciada: +${n.toLocaleString('pt-BR')} lugares por ${fmt(cost)}. Previsão de entrega: ${until.slice(8, 10)}/${until.slice(5, 7)}/${until.slice(0, 4)}.`, clubId });
  });
}

/* ───────────── luvas ───────────── */

/** Valor da luva de assinatura: 25% do valor de mercado (Etapa 4; antes 80%). */
export function luvaAmount(player: Pick<Player, 'value'>): number {
  return Math.round((player.value * FINANCE.luvaShare) / 1000) * 1000;
}

/**
 * Registra/paga a luva (MUTA `state`; usada por proposeContract). `installments` 0 = à vista.
 * Retorna erro se não houver caixa para o pagamento à vista.
 */
export function chargeLuva(state: SeasonState, clubId: string, player: Pick<Player, 'id' | 'name' | 'value'>, installments: number): string | null {
  const c = state.clubs[clubId];
  if (!c) return 'Clube fora da temporada.';
  const total = luvaAmount(player);
  if (total <= 0) return null;
  const n = Math.max(0, Math.round(installments));
  if (n === 0) {
    c.balance -= total;
    const l = ledger(c);
    l.luvas = (l.luvas ?? 0) - total;
    state.news.push({ date: state.date, text: `Luva de ${fmt(total)} paga à vista a ${player.name}.`, clubId });
    return null;
  }
  const monthly = Math.ceil(total / n);
  (c.luvaDebts ??= []).push({ playerId: player.id, playerName: player.name, total, monthly, remainingInstallments: n });
  state.news.push({ date: state.date, text: `Luva de ${fmt(total)} de ${player.name} parcelada em ${n}x de ${fmt(monthly)}.`, clubId });
  return null;
}

/** "Quitar Luva": paga as parcelas restantes de uma vez. */
export function payOffLuva(state: SeasonState, clubId: string, playerId: string): FinanceResult {
  return withClub(state, clubId, (c, s) => {
    const d = c.luvaDebts?.find((x) => x.playerId === playerId);
    if (!d) return 'Não há luva parcelada deste jogador.';
    const rest = Math.max(0, d.total - (d.paid ?? 0));
    if (c.balance < rest) return `Saldo insuficiente para quitar ${fmt(rest)}.`;
    c.balance -= rest;
    const l = ledger(c);
    l.luvas = (l.luvas ?? 0) - rest;
    c.luvaDebts = c.luvaDebts!.filter((x) => x !== d);
    s.news.push({ date: s.date, text: `Luva de ${d.playerName ?? playerId} quitada (${fmt(rest)}).`, clubId });
  });
}

/** Parcelas de luvas do mês (getMonthlyLuvas). */
export function monthlyLuvas(c: Pick<ClubSeasonState, 'luvaDebts'>): number {
  return (c.luvaDebts ?? []).reduce((s, d) => s + d.monthly, 0);
}

/* ───────────── processamento (chamado por advanceDay) ───────────── */

/** Dia 1: juros do empréstimo e parcelas de luvas (MUTA o clube). Retorna o total cobrado. */
export function processMonthlyFinance(c: ClubSeasonState): { interest: number; luvas: number } {
  const interest = loanInterest(c.loan);
  let luvas = 0;
  if (c.luvaDebts?.length) {
    for (const d of c.luvaDebts) {
      const v = Math.max(0, Math.min(d.monthly, d.total - (d.paid ?? 0)));
      luvas += v;
      d.paid = (d.paid ?? 0) + v;
      d.remainingInstallments--;
    }
    c.luvaDebts = c.luvaDebts.filter((d) => d.remainingInstallments > 0);
  }
  if (interest || luvas) {
    c.balance -= interest + luvas;
    const l = ledger(c);
    if (interest) l.loanInterest = (l.loanInterest ?? 0) - interest;
    if (luvas) l.luvas = (l.luvas ?? 0) - luvas;
  }
  return { interest, luvas };
}

/**
 * Diário: conclui a obra do estádio (MUTA `state`: troca `clubInfo` por uma cópia — ele é compartilhado
 * entre cópias da temporada). Retorna os clubes cujo estádio cresceu.
 */
export function processStadiumWorks(state: SeasonState): string[] {
  const done: string[] = [];
  for (const c of Object.values(state.clubs)) {
    const w = c.stadiumWork;
    if (!w || w.until > state.date) continue;
    const info = state.clubInfo?.[c.clubId];
    const capacity = (info?.capacity ?? 0) + w.seats;
    state.clubInfo = { ...(state.clubInfo ?? {}), [c.clubId]: { ...(info ?? {}), capacity } };
    c.stadiumWork = null;
    done.push(c.clubId);
    if (state.humanClubIds.includes(c.clubId)) {
      state.news.push({ date: state.date, text: `Obra concluída! O estádio ganhou ${w.seats.toLocaleString('pt-BR')} lugares (capacidade total: ${capacity.toLocaleString('pt-BR')}).`, clubId: c.clubId });
    }
  }
  return done;
}

/** Resumo financeiro do clube para a UI. */
export function financeOverview(state: SeasonState, clubId: string) {
  const c = state.clubs[clubId];
  const info = state.clubInfo?.[clubId];
  const rep = info?.reputation;
  const econ = hasEcon(info);
  return {
    /* (Etapa 4) perfil econômico (ausentes em saves antigos sem receita) */
    econ,
    fanMorale: c?.fanMorale ?? ECON.fanDefault,
    // (Mercado e Orçamentos) o orçamento salarial do humano é o teto (ajustável pelo equilíbrio)
    wageCeiling: boardWageCeiling(state, clubId),
    creditLimit: info?.creditLimit ?? 0,
    overdraftRate: ECON.overdraftRate,
    loanBlock: loanBlockFor(info?.revenue),
    loanRate: FINANCE.loanMonthlyRate,
    seatCost: seatCostFor(info?.region),
    tvMonthly: econ ? Math.round(info.tvPerSeason / 12) : 0,
    sponsorMonthly: econ ? Math.round(info.sponsorPerSeason / 12) : 0,
    ownerMonthly: econ ? Math.round(info.ownerPerSeason / 12) : 0,
    staffMonthly: econ ? Math.round(info.staffPerSeason / 12) : 0,
    maintenanceMonthly: econ ? Math.round(info.maintenancePerSeason / 12) : 0,
    opexMonthly: econ ? Math.round(info.opexPerSeason / 12) : 0,
    coachMonthly: info?.coachMonthly ?? 0,
    gates: c?.gates ?? [],
    months: c?.months ?? [],
    currentMonth: currentMonthFlow(c, state.date),
    leagueKey: info?.leagueKey,
    balance: c?.balance ?? 0,
    ticketPrice: ticketPriceOf(state, clubId),
    suggestedTicketPrice: suggestedTicketPrice(state, clubId),
    customTicketPrice: c?.ticketPrice ?? null,
    loan: c?.loan ?? 0,
    maxLoan: maxLoan(rep, state.clubInfo?.[clubId]?.revenue),
    /** (escala real) receita anual de referência e folha inicial (undefined em saves antigos) */
    revenue: state.clubInfo?.[clubId]?.revenue,
    wageBill: state.clubInfo?.[clubId]?.wageBill,
    monthlyInterest: loanInterest(c?.loan),
    luvaDebts: (c?.luvaDebts ?? []) as LuvaDebt[],
    monthlyLuvas: c ? monthlyLuvas(c) : 0,
    capacity: state.clubInfo?.[clubId]?.capacity ?? 0,
    stadiumWork: c?.stadiumWork ?? null,
  };
}

function fmt(v: number): string {
  return fmtMoneyShort(v);
}
