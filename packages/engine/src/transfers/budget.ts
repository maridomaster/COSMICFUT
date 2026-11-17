/**
 * (Mercado e Orçamentos) Orçamentos separados do clube humano: transferências (€) e salarial (€/mês).
 *
 *  - A diretoria define os dois no início da temporada DO CLUBE (virada da região; e na criação da carreira):
 *      transferências = máx(0, mín(caixa − 5% da receita, 40% do caixa + 10% da receita))  (a fórmula da IA, aiBudget)
 *      salarial       = Teto da Folha do perfil econômico (season/econ.ts) ÷ 12
 *    Na virada do OUTRO ciclo (trecho de 6 meses) os orçamentos atravessam como estão.
 *  - O orçamento salarial É o teto da folha da diretoria enquanto existir (`boardWageCeiling`): contratações,
 *    empréstimos, opções e renovações que aumentem a folha acima dele são vetadas (como na Etapa 4).
 *  - Compras (taxa, multa, empréstimo com taxa, opção de compra) são validadas contra o orçamento de transferências e o
 *    reduzem; vendas o aumentam (100% da taxa). O caixa e o cheque especial continuam valendo à parte.
 *  - Equilíbrio (slider): € 1 mi de transferências ⇄ € 50 mil/mês de folha. O orçamento salarial nunca fica abaixo da
 *    folha já comprometida (salários atuais).
 *  - Só clubes humanos de carreira com perfil econômico (teto > 0). Sem isso (saves antigos/temporadas avulsas), não
 *    há orçamento e valem só o caixa e o teto antigo.
 */
import type { ClubBudget, SeasonState } from '../contract';
import { boardWageCeiling } from '../season/econ';
import { cycleOfRegion, regionOfClub } from '../season/timeline';
import { clubWageBill, fmtMoneyPt, isHumanClub, type Squads } from './market';

export { boardWageCeiling };

export const BUDGET = {
  /** € de folha MENSAL por € 1 de orçamento de transferências (€ 1 mi ⇒ € 50 mil/mês) */
  wagePerTransfer: 0.05,
  /** fatia da taxa de venda que volta ao orçamento de transferências */
  saleShare: 1,
  /** reserva de caixa (× receita) que fica fora do orçamento (a mesma da IA) */
  cashReserve: 0.05,
  cashShare: 0.4,
  revenueShare: 0.1,
  /** passo do equilíbrio (em € de transferências) */
  step: 50_000,
};

const r50k = (v: number) => Math.round(v / 50_000) * 50_000;
const r1k = (v: number) => Math.round(v / 1000) * 1000;

/** O clube tem orçamentos separados? (humano, carreira, perfil econômico com teto) */
export function budgetsApply(state: SeasonState, clubId: string): boolean {
  return !!state.career && !!clubId && isHumanClub(state, clubId) && !!state.clubs[clubId] && (state.clubInfo?.[clubId]?.wageCeiling ?? 0) > 0;
}

/** Orçamentos que a diretoria define agora (caixa, receita e teto do perfil). */
export function deriveBudget(state: SeasonState, clubId: string): ClubBudget {
  const bal = Math.max(0, state.clubs[clubId]?.balance ?? 0);
  const info = state.clubInfo?.[clubId];
  const R = info?.revenue ?? 0;
  const transfer = Math.max(0, r50k(Math.min(bal - BUDGET.cashReserve * R, bal * BUDGET.cashShare + R * BUDGET.revenueShare)));
  const wage = r1k((info?.wageCeiling ?? 0) / 12);
  return { transfer, wage, baseTransfer: transfer, baseWage: wage, since: state.date };
}

/** Orçamento do clube (MUTA: cria o derivado se faltar). `undefined` = o clube não tem orçamentos. */
export function ensureBudget(state: SeasonState, clubId: string): ClubBudget | undefined {
  if (!budgetsApply(state, clubId)) return undefined;
  const c = state.clubs[clubId];
  if (!c.budget) {
    c.budget = deriveBudget(state, clubId);
    syncCeiling(state, clubId);
  }
  return c.budget;
}

/** Orçamento (sem mutar): o gravado ou o que a diretoria definiria agora. */
export function budgetOf(state: SeasonState, clubId: string): ClubBudget | null {
  if (!budgetsApply(state, clubId)) return null;
  return state.clubs[clubId].budget ?? deriveBudget(state, clubId);
}

/** O teto do perfil acompanha o orçamento salarial (consumidores antigos leem `clubInfo.wageCeiling`). MUTA. */
function syncCeiling(state: SeasonState, clubId: string): void {
  const b = state.clubs[clubId]?.budget;
  const info = state.clubInfo?.[clubId];
  if (b && info) info.wageCeiling = Math.round(b.wage * 12);
}

/** Todos os humanos sem orçamento recebem o derivado (migração de saves; idempotente). MUTA. Devolve quantos criou. */
export function ensureBudgets(state: SeasonState): number {
  let n = 0;
  for (const id of state.humanClubIds) {
    if (!state.clubs[id]) continue;
    if (state.clubs[id].budget) syncCeiling(state, id);
    else if (ensureBudget(state, id)) n++;
  }
  return n;
}

/**
 * Trecho novo (createSeasonFromWorld): humano cuja temporada começa agora (região do ciclo que abre) recebe orçamentos
 * novos da diretoria; os outros continuam com os do trecho anterior. MUTA `state`.
 */
export function carryBudgets(state: SeasonState, carry: SeasonState | undefined, opens: 'calendar' | 'split' | null): void {
  for (const id of state.humanClubIds) {
    if (!budgetsApply(state, id)) continue;
    const prev = carry?.clubs[id]?.budget;
    const region = regionOfClub(state, id);
    const keep = !!prev && (!opens || cycleOfRegion(region) !== opens);
    state.clubs[id].budget = keep ? { ...prev! } : deriveBudget(state, id);
    syncCeiling(state, id);
  }
}

/** Erro se a taxa passar do orçamento de transferências do comprador (null = ok ou sem orçamento). */
export function transferBudgetError(state: SeasonState, buyerId: string, fee: number): string | null {
  if (!(fee > 0)) return null;
  const b = budgetOf(state, buyerId);
  if (!b || fee <= b.transfer) return null;
  return `Orçamento de transferências insuficiente: disponível ${fmtMoneyPt(Math.max(0, b.transfer))}, a operação custa ${fmtMoneyPt(fee)}. Ajuste o equilíbrio de orçamentos (Mercado ou Finanças) ou venda jogadores.`;
}

/** Dinheiro de uma transferência nos orçamentos (MUTA): o comprador gasta, o vendedor recebe. */
export function budgetOnTransfer(state: SeasonState, buyerId: string, sellerId: string, fee: number): void {
  if (!(fee > 0)) return;
  const b = buyerId ? ensureBudget(state, buyerId) : undefined;
  if (b) b.transfer -= fee;
  const s = sellerId ? ensureBudget(state, sellerId) : undefined;
  if (s) s.transfer += Math.round(fee * BUDGET.saleShare);
}

export interface BudgetView extends ClubBudget {
  /** folha mensal comprometida (salários atuais; emprestados pela parte combinada) */
  committed: number;
  /** máximo que dá para mover para a folha (em € de transferências) e para as transferências (idem) */
  maxToWage: number;
  maxToTransfer: number;
  /** € de folha mensal por € de transferências */
  ratio: number;
}

/** Orçamentos + limites do equilíbrio (para a UI). null = o clube não tem orçamentos. */
export function budgetView(state: SeasonState, squads: Squads, clubId: string): BudgetView | null {
  const b = budgetOf(state, clubId);
  if (!b) return null;
  const committed = state.market ? clubWageBill(state, clubId, squads(clubId)) : squads(clubId).reduce((s, p) => s + (p.wage || 0), 0);
  const maxToWage = Math.max(0, Math.floor(b.transfer / BUDGET.step) * BUDGET.step);
  const maxToTransfer = Math.max(0, Math.floor((b.wage - committed) / BUDGET.wagePerTransfer / BUDGET.step) * BUDGET.step);
  return { ...b, committed, maxToWage, maxToTransfer, ratio: BUDGET.wagePerTransfer };
}

/** Prévia do equilíbrio: orçamentos depois de mover `toWage` € de transferências para a folha (negativo = o contrário). */
export function previewRebalance(b: Pick<ClubBudget, 'transfer' | 'wage'>, toWage: number): { transfer: number; wage: number } {
  return { transfer: b.transfer - toWage, wage: r1k(b.wage + toWage * BUDGET.wagePerTransfer) };
}

/**
 * Equilíbrio de orçamentos: move `toWage` € do orçamento de transferências para o salarial (negativo = da folha para
 * as transferências), na razão € 1 mi ⇄ € 50 mil/mês. Pura (devolve cópia). O orçamento salarial não fica abaixo da
 * folha comprometida; o de transferências, abaixo de zero.
 */
export function rebalanceBudgets(input: SeasonState, squads: Squads, clubId: string, toWage: number): { state: SeasonState; error?: string } {
  if (!budgetsApply(input, clubId)) return { state: input, error: 'Este clube não tem orçamentos separados (carreira sem economia).' };
  const amount = Math.round(toWage / 10_000) * 10_000;
  if (!Number.isFinite(amount) || amount === 0) return { state: input };
  const v = budgetView(input, squads, clubId)!;
  const next = previewRebalance(v, amount);
  if (amount > 0 && next.transfer < 0) return { state: input, error: `O orçamento de transferências é de ${fmtMoneyPt(Math.max(0, v.transfer))}.` };
  if (amount < 0 && next.wage < v.committed) {
    return { state: input, error: `O orçamento salarial não pode ficar abaixo da folha comprometida (${fmtMoneyPt(v.committed)}/mês).` };
  }
  const state = JSON.parse(JSON.stringify(input)) as SeasonState;
  const b = ensureBudget(state, clubId)!;
  b.transfer = next.transfer;
  b.wage = next.wage;
  syncCeiling(state, clubId);
  return { state };
}
