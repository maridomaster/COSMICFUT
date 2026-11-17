/**
 * Dia de mercado da IA (chamado por advanceDay quando a SeasonState tem `market`). (Etapa 5) Janelas POR REGIÃO do
 * clube comprador (timeline.ts: Europa 01/07–01/09 e 01/01–02/02; Arábia 01/07–01/09 e 01/01–31/01; América do Sul
 * jan–mar e jul–set). Fora da janela do comprador não há inscrição (só livres e pré-contratos).
 *
 *  1. empréstimos que terminam: o clube da IA que recebeu pode exercer a opção de compra; senão o jogador volta
 *  2. ofertas vencidas / janela do comprador fechada → expiram
 *  3. dia 1 do mês — gestão de contratos da IA: renova peças-chave nos últimos 12 meses (salário de mercado no patamar
 *     do clube; evita a queda das folhas da IA), deixa vencer os excedentes; elencos inchados (> 28) põem reservas na
 *     lista de venda e jovens excedentes na lista de empréstimo; pré-contratos da IA (jogadores nos últimos 6 meses)
 *  4. livres: clubes com carência contratam (a qualquer momento); veteranos livres atraem a Arábia
 *  5. janela aberta (por região do comprador): tentativas de compra IA × IA com perfis
 *     - necessidade: posição mais fraca/carente (ou reposição de quem foi vendido: clubes grandes)
 *     - Europa: garimpo de jovens (≤ 23) sul-americanos de overall/potencial alto
 *     - Arábia (PIF): veteranos (29+) de destaque da Europa com salário acima do mercado
 *     - empréstimos: clubes menores pegam excedentes listados por clubes grandes
 *     - a elite sul-americana vende para a Europa (perfil vendedor no preço e venda mesmo sendo mais forte)
 *  6. ofertas pelos jogadores do humano (listados ~30%/dia; destaques ~1,2%/dia; listados para empréstimo; e, raro, a
 *     multa rescisória de um craque quando ela é baixa)
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { SeasonState, TransferOffer } from '../contract';
import { Rng } from '../rng';
import { applyTransfer, contractEndsSeason, renewInPlace, signingBonus } from './actions';
import {
  addDaysIso, clubName, clubWageBill, countByPosition, loanOutWages, currentClubOf, fmtMoneyPt, FREE, freeAgents, isHumanClub, MARKET, marketSquadsCache,
  squadStrength, marketWindow, type Squads,
} from './market';
import { clubView, contractDemand, evaluateOffer, askingPrice, expectedRole, playerAppeal, APPEAL_MIN, MONEY_TALKS, type ClubView } from './valuation';
import { careerValue, careerWorth, monthsLeftOf, releaseClauseOf } from './value';
import { checkWageCeiling } from '../season/econ';
import { monthlyWage, squadScales } from '../season/players';
import { chargeLuva, FINANCE } from '../season/finance';
import type { Region } from '../season/timeline';

const POSITIONS: Position[] = ['GK', 'FB', 'CB', 'MF', 'FW'];
const STARTERS_BY_POS: Record<Position, number> = { GK: 1, FB: 2, CB: 2, MF: 3, FW: 2 };
const OFFER_KEEP = 150;

/** (Etapa 5) Parâmetros do mercado da IA (calibrados nas simulações de 3 temporadas; ver nota 33). */
export const AI_MARKET = {
  /** tentativas de compra por dia com a janela da região aberta */
  attempts: { SA: 10, EU: 16, SAU: 3.5 } as Record<Region, number>,
  /** última semana da janela: mais tentativas */
  lastWeekBoost: 1.6,
  /** fatia das tentativas europeias que garimpam jovens sul-americanos */
  prospectShare: 0.3,
  /** fatia das tentativas sauditas atrás de veteranos europeus (PIF: o dobro do peso) */
  veteranShare: 0.6,
  /** fatia das tentativas de clubes menores que procuram empréstimos */
  loanShare: 0.3,
  /** candidatos avaliados por tentativa */
  sample: 50,
  /** chance mensal de renovar uma peça-chave nos últimos 12 meses */
  renewMonthly: 0.35,
  /** compradores da IA que procuram pré-contratos por rodada (dias 1 e 15) */
  preContractBuyers: 8,
  /** elenco inchado: acima disto lista excedentes */
  bloated: 28,
  /** salário dos veteranos na Arábia: × o pedido */
  saudiWage: [1.5, 2.3] as [number, number],
  /** folha-alvo da IA nas contratações: × a folha inicial dos dados (W0), dentro do teto da diretoria */
  wageTarget: 1.07,
  /** clubes do PIF: folha-alvo maior (o aporte do dono acompanha a folha) */
  pifWageExtra: 0.25,
  /** renovações da IA só aumentam o salário com a folha abaixo de W0 × isto */
  renewTarget: 1.02,
  /** reserva de caixa da IA (× receita) que não vai para compras */
  cashReserve: 0.05,
};

/**
 * (Etapa 5) Folha da IA: além do teto da diretoria, a IA mira a folha inicial dos dados (W0 × 1,03) — a receita é
 * fixa, então a folha não pode crescer sem fim. Operações que reduzem a folha sempre passam.
 */
export function aiWageOk(state: SeasonState, clubId: string, squad: Player[], add: number, remove = 0, target = AI_MARKET.wageTarget, loanOut?: number): boolean {
  if (add - remove <= 0) return true;
  if (!state.career || !state.clubInfo?.[clubId]?.wageBill) return checkWageCeiling(state, clubId, squad, add, remove).ok;
  return add - remove <= aiWageRoom(state, clubId, squad, target, loanOut);
}

/**
 * Espaço mensal na folha-alvo da IA (Infinity sem a folha dos dados). Clube com caixa folgado (vendeu bem) reinveste
 * em salários: até +15% na folha-alvo (caixa acima de 30% da receita).
 */
export function aiWageRoom(state: SeasonState, clubId: string, squad: Player[], target = AI_MARKET.wageTarget, loanOut?: number): number {
  const info = state.clubInfo?.[clubId];
  const W0 = info?.wageBill;
  if (!state.career || !W0 || !info) {
    const ceiling = info?.wageCeiling ?? 0;
    return ceiling > 0 ? ceiling / 12 - clubWageBill(state, clubId, squad, loanOut) : Infinity;
  }
  const ceiling = info.wageCeiling ?? Infinity;
  const R = info.revenue ?? 0;
  const bal = state.clubs[clubId]?.balance ?? 0;
  const boost = target > AI_MARKET.renewTarget && R > 0 ? Math.min(0.15, Math.max(0, (bal / R - 0.3) * 0.3)) : 0;
  // PIF: o aporte do dono acompanha a folha — espaço extra para as estrelas veteranas
  const pif = info.ownerBacked && target > AI_MARKET.renewTarget ? AI_MARKET.pifWageExtra : 0;
  return Math.min(ceiling, W0 * (target + boost + pif)) / 12 - clubWageBill(state, clubId, squad, loanOut);
}

/** Nível do titular na posição (média dos k melhores). */
export function positionLevel(squad: Player[], pos: Position): number {
  const k = STARTERS_BY_POS[pos];
  const top = squad.filter((p) => p.position === pos).map((p) => p.overall).sort((a, b) => b - a).slice(0, k);
  if (!top.length) return 0;
  return top.reduce((s, v) => s + v, 0) / k;
}

/** Posição mais carente: abaixo do mínimo; senão a de titular mais fraco (sorteio entre as 2 piores). */
export function positionNeed(squad: Player[], rng: Rng): { pos: Position; level: number; shortage: boolean } {
  const counts = countByPosition(squad);
  for (const pos of POSITIONS) if (counts[pos] < MARKET.minByPosition[pos]) return { pos, level: positionLevel(squad, pos), shortage: true };
  const ranked = POSITIONS.map((pos) => ({ pos, level: positionLevel(squad, pos) })).sort((a, b) => a.level - b.level);
  const pick = ranked[rng.chance(0.65) ? 0 : 1];
  return { ...pick, shortage: false };
}

const round50k = (v: number) => Math.max(0, Math.round(v / 50_000) * 50_000);

/**
 * Orçamento de uma compra da IA: 40% do caixa (+ 10% da receita anual, na escala real), limitado ao caixa.
 * Ex.: Bayern (caixa 130 M, receita 860 M) → 130 M; clube da Série B (caixa 2,5 M, receita 18 M) → 2,5 M.
 */
export function aiBudget(state: SeasonState, clubId: string): number {
  const bal = Math.max(0, state.clubs[clubId]?.balance ?? 0);
  const rev = state.clubInfo?.[clubId]?.revenue ?? 0;
  // (Etapa 5) carreira: uma reserva de caixa (5% da receita) não vai para compras — o mercado completo é bem mais
  // movimentado e, sem a reserva, os grandes gastavam todo o caixa (Real Madrid no vermelho em 3 temporadas)
  const reserve = state.career ? AI_MARKET.cashReserve * rev : 0;
  return Math.max(0, Math.min(bal - reserve, bal * 0.4 + rev * 0.1));
}

/**
 * (Etapa 4, mantido) Vendedor sul-americano × comprador europeu com receita ≥ 2× a do vendedor: a venda acontece
 * mesmo que o vendedor seja mais forte (a elite sul-americana vive de vender para a Europa).
 */
export function sellsToRicher(state: SeasonState, sellerId: string, buyerId: string): boolean {
  const s = state.clubInfo?.[sellerId], b = state.clubInfo?.[buyerId];
  if (!s || !b || s.region !== 'SA' || b.region !== 'EU') return false;
  return (b.revenue ?? 0) >= 2 * (s.revenue ?? Infinity);
}

/** (13/11, desempenho) `squadStrength` memorizado por elenco (identidade do array) durante UM dia de mercado. */
function strengthMemo(): (squad: Player[]) => number {
  const memo = new WeakMap<Player[], number>();
  return (squad) => {
    let v = memo.get(squad);
    if (v === undefined) memo.set(squad, (v = squadStrength(squad)));
    return v;
  };
}

/** Pura: devolve uma nova SeasonState com o dia de mercado aplicado (sem avançar a data). */
export function marketDay(input: SeasonState, baseSquads: Squads): SeasonState {
  if (!input.market) return input;
  const state = JSON.parse(JSON.stringify(input)) as SeasonState;
  runMarketDay(state, baseSquads);
  return state;
}

/* ═════════════════════ contexto do dia ═════════════════════ */

interface Ctx {
  state: SeasonState;
  squads: Squads;
  refresh: (ids: Iterable<string>) => void;
  rng: Rng;
  strength: (s: Player[]) => number;
  aiClubs: string[];
  /** janela aberta por clube (memorizado pela região) */
  open: (clubId: string) => boolean;
  /** overall corrente (evolução mensal) */
  ovr: (p: Player) => number;
  /** jogador com o overall corrente */
  live: (p: Player) => Player;
  /** jogadores que já mudaram hoje */
  moved: Set<string>;
  /** clubes vendedores (IA, com divisão nacional, sem convidados), opcionalmente de uma região */
  sellerPool: (region: Region | null) => string[];
  /** listas de venda/empréstimo como conjuntos (refeitos quando a lista muda) */
  listed: () => Set<string>;
  loanListed: () => Set<string>;
  /** parte dos salários dos emprestados paga pelo dono, por clube (refeito a cada mudança de elencos) */
  loanOut: (clubId: string) => number;
}

function makeCtx(state: SeasonState, baseSquads: Squads): Ctx {
  const rng = new Rng(`${state.seed ?? 'season'}:market:${state.date}`);
  const cache = marketSquadsCache(state, baseSquads);
  const winMemo = new Map<string, boolean>();
  const evo = state.career?.evo;
  const ovr = (p: Player) => {
    const e = evo?.[p.id];
    return e === undefined ? p.overall : Math.max(1, Math.min(99, Math.round(e)));
  };
  const aiClubs = Object.keys(state.clubs).filter((id) => !isHumanClub(state, id));
  const pools = new Map<string, string[]>();
  const m = state.market!;
  let tlRef: string[] | null = null, tlSet = new Set<string>();
  let llRef: string[] | null = null, llSet = new Set<string>();
  let lo: Map<string, number> | null = null;
  return {
    state, squads: cache.squads, refresh: (ids) => { lo = null; cache.invalidate(ids); }, rng, strength: strengthMemo(),
    loanOut: (clubId) => (lo ??= loanOutWages(state)).get(clubId) ?? 0,
    aiClubs,
    sellerPool: (region) => {
      const key = region ?? '*';
      let p = pools.get(key);
      if (!p) {
        p = aiClubs.filter((id) => {
          const i = state.clubInfo?.[id];
          if (i?.guest) return false;
          if (state.career && i?.division === undefined) return false;
          return !region || i?.region === region;
        });
        pools.set(key, p);
      }
      return p;
    },
    listed: () => {
      if (tlRef !== m.transferList) { tlRef = m.transferList; tlSet = new Set(tlRef); }
      return tlSet;
    },
    loanListed: () => {
      const l = m.loanList ?? [];
      if (llRef !== l) { llRef = l; llSet = new Set(l); }
      return llSet;
    },
    open: (clubId) => {
      const key = state.segment ? state.clubInfo?.[clubId]?.region ?? '-' : '-';
      let v = winMemo.get(key);
      if (v === undefined) winMemo.set(key, (v = marketWindow(state, clubId).open));
      return v;
    },
    ovr,
    live: (p) => {
      const o = ovr(p);
      return o === p.overall ? p : { ...p, overall: o };
    },
    moved: new Set(),
  };
}

/**
 * Versão mutável (usada por advanceDay sobre o clone do dia). Retorna os elencos efetivos do mercado ao fim do dia
 * (memorizados; válidos até a próxima mudança em `state.market`) — advanceDay reaproveita (13/11, desempenho).
 */
export function runMarketDay(state: SeasonState, baseSquads: Squads): Squads | undefined {
  const m = state.market;
  if (!m) return undefined;
  const date = state.date;
  // janela exibida na UI: a da região do humano (as regras usam a região de cada comprador)
  m.window = marketWindow(state);
  const c = makeCtx(state, baseSquads);

  // 1) empréstimos encerrados (opção de compra da IA antes da volta)
  returnLoans(c);

  // 2) ofertas vencidas e janela do comprador fechada
  for (const o of m.offers) {
    if (o.status === 'pending' && o.expiresOn && o.expiresOn < date) {
      o.status = 'expired';
      o.updatedOn = date;
    } else if (o.kind !== 'free' && o.kind !== 'precontract' && (o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending') && !c.open(o.toClubId)) {
      o.status = 'expired';
      o.updatedOn = date;
    }
  }
  pruneOffers(m.offers);
  if (m.needs) for (const id of Object.keys(m.needs)) if (!c.open(id)) delete m.needs[id];

  // 3) gestão de contratos e listas (dia 1); pré-contratos (dias 1 e 15) — só na carreira
  if (state.career) {
    if (date.endsWith('-01')) {
      aiRenewals(c);
      aiListings(c);
    }
    if (date.endsWith('-01') || date.endsWith('-15')) aiPreContracts(c);
  }

  // 4) livres (a qualquer momento)
  aiFreeAgents(c);

  // 5) compras e empréstimos IA × IA, por região do comprador com a janela aberta
  const regions: Region[] = state.segment ? ['SA', 'EU', 'SAU'] : ['SA'];
  for (const region of regions) {
    // (o tamanho do elenco é conferido na tentativa: montar todos os elencos aqui custaria caro todo dia)
    const buyers = c.aiClubs.filter((id) => (state.segment ? state.clubInfo?.[id]?.region === region : true) && c.open(id) && canBuy(c, id, false));
    if (!buyers.length) continue;
    const w = marketWindow(state, buyers[0]);
    const lastWeek = !!w.closesOn && w.closesOn <= addDaysIso(date, 7);
    const mean = (state.segment ? AI_MARKET.attempts[region] : 1) * (lastWeek ? AI_MARKET.lastWeekBoost : 1);
    // nº de tentativas: média `mean` (parte inteira + sorteio da fração)
    const n = Math.floor(mean) + (c.rng.chance(mean - Math.floor(mean)) ? 1 : 0) + (state.segment ? 0 : c.rng.int(0, 1));
    const weights = buyers.map((id) => buyerWeight(state, id));
    for (let a = 0; a < n; a++) {
      const buyerId = buyers[c.rng.weightedIndex(weights)];
      const moved = aiTransferAttempt(c, buyerId, region);
      if (moved) c.refresh(moved);
    }
  }

  // 6) ofertas pelos jogadores do humano
  for (const human of state.humanClubIds) aiOffersForHuman(c, human);
  return c.squads;
}

function canBuy(c: Ctx, id: string, checkSquad = true): boolean {
  const info = c.state.clubInfo?.[id];
  if (info?.guest) return false;
  // clubes só estaduais e convidados não vão ao mercado (temporada de carreira); temporada avulsa: todos
  if (c.state.career && info?.division === undefined) return false;
  return !checkSquad || c.squads(id).length < c.state.market!.rules.maxSquad;
}

function buyerWeight(state: SeasonState, id: string): number {
  const i = state.clubInfo?.[id];
  const rep = i?.reputation ?? 2;
  const div = i?.division ?? 1;
  // (Etapa 5) caixa folgado em relação à receita compra mais (o dinheiro das vendas volta a circular)
  const R = i?.revenue ?? 0;
  const bal = state.clubs[id]?.balance ?? 0;
  const cash = state.career && R > 0 ? Math.min(3, Math.max(0.3, 0.3 + bal / (0.25 * R))) : 1;
  return (1 + rep) * (div === 1 ? 1.5 : 1) * (i?.ownerBacked ? 2 : 1) * cash;
}

function pruneOffers(offers: TransferOffer[]): void {
  const active = (o: TransferOffer) => o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending';
  let closed = 0;
  for (let i = 0; i < offers.length; i++) {
    if (active(offers[i])) continue;
    if (++closed > OFFER_KEEP) {
      offers.splice(i, 1);
      i--;
    }
  }
}

/* ═════════════════════ 1) empréstimos ═════════════════════ */

function returnLoans(c: Ctx): void {
  const { state } = c;
  const m = state.market!;
  const date = state.date;
  const returning = Object.entries(m.contracts).filter(([, k]) => k.kind === 'loan' && k.loanUntil && k.loanFrom && k.loanUntil <= date);
  if (!returning.length) return;
  const touched = new Set<string>();
  for (const [pid, k] of returning) {
    const p = m.players[pid];
    const holder = m.moves[pid];
    if (!p || holder === undefined) continue;
    touched.add(holder).add(k.loanFrom!);
    // (Etapa 5) opção de compra: a IA exerce se o jogador é titular e cabe no orçamento e na folha
    if (k.purchaseOption !== undefined && !isHumanClub(state, holder) && state.clubs[holder] && state.career) {
      const sq = c.squads(holder);
      const live = c.live(p);
      const fits = k.purchaseOption <= aiBudget(state, holder) && aiWageOk(state, holder, sq, Math.round((p.wage * (100 - (k.wageShare ?? 100))) / 100), 0, AI_MARKET.wageTarget, c.loanOut(holder));
      if (fits && expectedRole(sq, live) === 'starter' && k.purchaseOption <= 1.3 * careerValue(state, live, holder)) {
        delete m.contracts[pid];
        applyTransfer(state, { player: p, fromClubId: k.loanFrom!, toClubId: holder, fee: k.purchaseOption, wage: p.wage, years: 3, kind: 'transfer', via: 'option', quiet: !isHumanClub(state, k.loanFrom!) && p.overall < 75 });
        continue;
      }
    }
    const human = isHumanClub(state, holder) || isHumanClub(state, k.loanFrom!);
    applyTransfer(state, { player: p, fromClubId: holder, toClubId: k.loanFrom!, fee: 0, wage: p.wage, years: 0, kind: 'loan-return', quiet: !human });
  }
  c.refresh(touched);
}

/* ═════════════════════ 3) contratos, listas e pré-contratos da IA ═════════════════════ */

/** Salário de mercado no patamar do clube (mediana salário ÷ genérico do elenco). */
function clubMarketWage(state: SeasonState, squad: Player[], clubId: string, p: Player): number {
  const rep = state.clubInfo?.[clubId]?.reputation ?? 2;
  const scale = Math.min(5, Math.max(0.2, squadScales(squad, rep).wageScale ?? 1));
  return Math.round((monthlyWage(p.age, p.overall, rep) * scale) / 100) * 100;
}

/**
 * Renovações da IA (dia 1): peças-chave (14 melhores, < 33 anos, ou acima do nível do elenco) nos últimos 12 meses
 * renovam com 35% de chance ao mês — salário = max(atual, mercado no patamar do clube) × 1,05–1,15; 2–4 anos.
 * Excedentes ficam para vencer (saem livres na virada).
 */
function aiRenewals(c: Ctx): void {
  const { state, rng } = c;
  const m = state.market!;
  for (const clubId of c.aiClubs) {
    if (state.clubInfo?.[clubId]?.guest) continue;
    const sq = c.squads(clubId);
    if (sq.length < 11) continue;
    const ranked = sq.map((p) => c.live(p)).sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    const key = new Set(ranked.slice(0, 14).filter((p) => p.age < 33).map((p) => p.id));
    let room = Number.NaN;
    for (const p of ranked) {
      if (!key.has(p.id) || m.preContracts?.[p.id]) continue;
      const k = m.contracts[p.id];
      if (k?.kind === 'loan') continue;
      const months = monthsLeftOf(state, p, clubId);
      if (months === null || months > 12) continue;
      if (!rng.chance(AI_MARKET.renewMonthly)) continue;
      let wage = Math.round(Math.max(p.wage, clubMarketWage(state, sq, clubId, p)) * rng.range(1.0, 1.08) / 100) * 100;
      // sem espaço na folha-alvo das renovações: renova pelo salário atual
      if (Number.isNaN(room)) room = aiWageRoom(state, clubId, sq, AI_MARKET.renewTarget, c.loanOut(clubId));
      if (wage > p.wage) {
        if (wage - p.wage <= room) room -= wage - p.wage;
        else wage = p.wage;
      }
      const years = p.age <= 26 ? rng.int(3, 4) : p.age <= 30 ? rng.int(2, 3) : 2;
      renewInPlace(state, clubId, p, wage, years);
    }
  }
  // renovações não mudam elencos (só salários): os elencos memorizados ficam com o salário antigo até o próximo dia
  c.refresh(c.aiClubs);
}

/**
 * Listas da IA (dia 1): elencos com mais de 22 jogadores põem excedentes (fora dos 20 melhores) à venda — jovens
 * (≤ 22) vão para a lista de empréstimo; elencos inchados (> 28) listam mais. Gera oferta de reservas dos clubes
 * grandes para os menores (e receita de vendas para os grandes).
 */
function aiListings(c: Ctx): void {
  const { state } = c;
  const m = state.market!;
  const tl = new Set(m.transferList.filter((id) => isHumanClub(state, currentClubOf(state, id))));
  const ll = new Set((m.loanList ?? []).filter((id) => isHumanClub(state, currentClubOf(state, id))));
  for (const clubId of c.aiClubs) {
    const info = state.clubInfo?.[clubId];
    if (info?.guest || info?.division === undefined) continue;
    const sq = c.squads(clubId);
    const extra = sq.length > AI_MARKET.bloated ? sq.length - AI_MARKET.bloated + 2 : sq.length - 22;
    if (extra <= 0) continue;
    const counts = countByPosition(sq);
    const ranked = sq.map((p) => c.live(p)).sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    const top = new Set(ranked.slice(0, 20).map((p) => p.id));
    const worst = ranked.slice().reverse().filter((p) => !top.has(p.id));
    let listed = 0;
    for (const p of worst) {
      if (listed >= extra) break;
      if (counts[p.position] <= MARKET.minByPosition[p.position] + 1) continue;
      if (m.contracts[p.id]?.kind === 'loan') continue;
      if (p.age <= 22) ll.add(p.id);
      else tl.add(p.id);
      counts[p.position]--;
      listed++;
    }
  }
  m.transferList = [...tl];
  m.loanList = [...ll];
}

/**
 * Pré-contratos da IA (dias 1 e 15): alguns compradores procuram, na posição carente, jogadores de outros clubes
 * nos últimos 6 meses de contrato (inclusive do humano) que melhorem o time; sem taxa, com luvas.
 */
function aiPreContracts(c: Ctx): void {
  const { state, rng } = c;
  const m = state.market!;
  // jogadores elegíveis (todos os clubes da temporada): ≤ 6 meses, sem empréstimo, sem pré-contrato
  const pool: { p: Player; club: string }[] = [];
  for (const clubId of Object.keys(state.clubs)) {
    if (state.clubInfo?.[clubId]?.guest) continue;
    for (const p0 of c.squads(clubId)) {
      if (m.preContracts?.[p0.id] || m.contracts[p0.id]?.kind === 'loan' || p0.age > 34) continue;
      const months = monthsLeftOf(state, p0, clubId);
      if (months === null || months > MARKET.preContractMonths) continue;
      pool.push({ p: c.live(p0), club: clubId });
    }
  }
  if (!pool.length) return;
  const buyers = c.aiClubs.filter((id) => canBuy(c, id));
  if (!buyers.length) return;
  const weights = buyers.map((id) => buyerWeight(state, id));
  for (let k = 0; k < AI_MARKET.preContractBuyers; k++) {
    const buyerId = buyers[rng.weightedIndex(weights)];
    const bSq = c.squads(buyerId);
    const need = positionNeed(bSq, rng);
    const cands = pool.filter((x) => x.club !== buyerId && x.p.position === need.pos && x.p.overall >= need.level + 1 && !m.preContracts?.[x.p.id]);
    if (!cands.length) continue;
    const pick = cands.sort((a, b) => b.p.overall - a.p.overall || (a.p.id < b.p.id ? -1 : 1))[0];
    const buyer = clubView(state, c.squads, buyerId);
    const from = clubView(state, c.squads, pick.club);
    const input = { player: pick.p, buyer, fromReputation: from.reputation, fromLeague: from.league, kind: 'precontract' as const };
    const demand = contractDemand(state, input);
    const appeal = playerAppeal(state, input);
    if (appeal.score < APPEAL_MIN) continue;
    const wage = Math.max(demand.wage, clubMarketWage(state, bSq, buyerId, pick.p));
    if (!aiWageOk(state, buyerId, bSq, wage, 0, AI_MARKET.wageTarget, c.loanOut(buyerId))) continue;
    const bonus = signingBonus(state, pick.p, buyerId);
    if (bonus > aiBudget(state, buyerId)) continue;
    const years = Math.min(demand.maxYears, demand.minYears + 1);
    (m.preContracts ??= {})[pick.p.id] = {
      playerId: pick.p.id, playerName: pick.p.name, fromClubId: pick.club, toClubId: buyerId, toName: clubName(state, buyerId),
      wage, years, signedOn: state.date,
    };
    if (m.tally) m.tally.precontracts++;
    // a notícia da luva da IA não interessa; a do pré-contrato sim, para o humano e grandes nomes
    const nNews = state.news.length;
    chargeLuva(state, buyerId, { ...pick.p, value: bonus / FINANCE.luvaShare }, 0);
    state.news.length = nNews;
    if (isHumanClub(state, pick.club) || pick.p.overall >= 78) {
      state.news.push({ date: state.date, text: `Pré-contrato: ${pick.p.name} assina com o ${clubName(state, buyerId)} e deixa o ${clubName(state, pick.club)} no fim do contrato.`, clubId: isHumanClub(state, pick.club) ? pick.club : buyerId });
    }
  }
}

/* ═════════════════════ 4) livres ═════════════════════ */

function aiFreeAgents(c: Ctx): void {
  const { state, rng } = c;
  const m = state.market!;
  let free = freeAgents(state);
  if (!free.length) return;
  // lista calculada uma vez por dia (antes era recalculada por clube: O(clubes × movimentos))
  free = free.filter((p) => p.age <= 34).sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
  for (const clubId of c.aiClubs) {
    const sq = c.squads(clubId);
    if (sq.length >= m.rules.maxSquad) continue;
    // atalho (Fase 2, mesmo consumo de RNG de positionNeed): sem carência e com ≥ 20, não é urgente
    if (sq.length >= 20) {
      const counts = countByPosition(sq);
      if (!POSITIONS.some((pos) => counts[pos] < MARKET.minByPosition[pos])) { rng.chance(0.65); continue; }
    }
    const need = positionNeed(sq, rng);
    const urgent = sq.length < 20 || need.shortage;
    if (!urgent || !rng.chance(0.35)) continue;
    const p = free.find((x) => x.position === need.pos);
    if (!p) continue;
    free = free.filter((x) => x !== p);
    const buyer = clubView(state, c.squads, clubId);
    const demand = contractDemand(state, { player: p, buyer, fromReputation: 1, kind: 'free' }).wage;
    // (Etapa 5) salário no patamar do clube (as folhas da IA não caem com o tempo)
    const wage = state.career ? Math.max(demand, Math.round(clubMarketWage(state, sq, clubId, p) * 0.9)) : demand;
    // (Etapa 4) teto da folha: só passa dele para completar um elenco abaixo do mínimo
    if (sq.length >= m.rules.minSquad && !aiWageOk(state, clubId, sq, wage, 0, AI_MARKET.wageTarget, c.loanOut(clubId))) continue;
    applyTransfer(state, { player: p, fromClubId: FREE, toClubId: clubId, fee: 0, wage, years: p.age >= 31 ? 1 : 2, kind: 'free', quiet: p.overall < 75 });
    c.refresh([clubId]);
  }
}

/* ═════════════════════ 5) compras IA × IA ═════════════════════ */

type Mode = 'need' | 'replace' | 'prospect' | 'veteran' | 'loan';

function pickMode(c: Ctx, buyerId: string, region: Region): Mode {
  const { state, rng } = c;
  const info = state.clubInfo?.[buyerId];
  if (!state.career) return 'need';
  if (state.market!.needs?.[buyerId]?.length && rng.chance(0.7)) return 'replace';
  if (region === 'EU' && (info?.reputation ?? 0) >= 2.5 && rng.chance(AI_MARKET.prospectShare)) return 'prospect';
  if (region === 'SAU' && rng.chance(AI_MARKET.veteranShare * (info?.ownerBacked ? 1.4 : 0.8))) return 'veteran';
  if (((info?.reputation ?? 2) <= 2.5 || (info?.division ?? 1) >= 2) && rng.chance(AI_MARKET.loanShare)) return 'loan';
  return 'need';
}

/** Uma tentativa de compra/empréstimo IA × IA. Retorna os clubes cujo elenco mudou (comprador, vendedor) ou null. */
function aiTransferAttempt(c: Ctx, buyerId: string, region: Region): string[] | null {
  const { state, rng } = c;
  const m = state.market!;
  const bSquad = c.squads(buyerId);
  if (bSquad.length >= m.rules.maxSquad) return null;
  const bStr = c.strength(bSquad);
  const budget = aiBudget(state, buyerId);
  const mode = pickMode(c, buyerId, region);
  let need = positionNeed(bSquad, rng);
  if (mode === 'replace') {
    const list = m.needs![buyerId];
    const pos = list[0];
    need = { pos, level: positionLevel(bSquad, pos), shortage: false };
  }
  const buyerInfo = state.clubInfo?.[buyerId];
  const minLevel = mode === 'replace' ? need.level - 1 : need.level ? need.level + 1 : bStr - 4;
  if (mode !== 'loan' && budget < 200_000) return null;

  // candidatos: amostra dos clubes vendedores (com divisão nacional); na "necessidade", 70% das vezes só a região do
  // comprador (a maioria das transferências é doméstica/regional)
  let best: { p: Player; seller: string; score: number } | null = null;
  const sameRegion = mode === 'need' || mode === 'replace' ? rng.chance(0.7) : false;
  const sellers = c.sellerPool(mode === 'prospect' ? 'SA' : mode === 'veteran' ? 'EU' : sameRegion && state.segment ? region : null);
  const tries = Math.min(sellers.length, 300);
  const start = rng.int(0, Math.max(0, sellers.length - 1));
  const stride = [7, 11, 13, 17, 19, 23].find((s) => sellers.length % s !== 0) ?? 1;
  const listedSet = c.listed();
  const loanSet = c.loanListed();
  const recent = addDaysIso(state.date, -120);
  // (Etapa 5) só candidatos que cabem no orçamento e na folha (o melhor "possível", não o melhor do mundo)
  const room = aiWageRoom(state, buyerId, bSquad, AI_MARKET.wageTarget, c.loanOut(buyerId));
  if (room <= 0 && mode !== 'loan') return null;
  let found = 0;
  for (let i = 0; i < tries && found < AI_MARKET.sample; i++) {
    const sellerId = sellers[(start + i * stride) % sellers.length];
    if (sellerId === buyerId) continue;
    const sInfo = state.clubInfo?.[sellerId];
    const sSquad = c.squads(sellerId);
    if (sSquad.length - 1 < m.rules.minSquad) continue;
    const sStr = c.strength(sSquad);
    // clubes fracos vendem para os fortes (ou quem está no vermelho vende); a elite sul-americana vende para a Europa
    const sells = sStr <= bStr + 1 || state.clubs[sellerId].balance < 0 || sellsToRicher(state, sellerId, buyerId)
      || mode === 'veteran' || (mode === 'prospect' && (buyerInfo?.revenue ?? 0) >= 1.5 * (sInfo?.revenue ?? Infinity));
    for (const p0 of sSquad) {
      if (p0.position !== need.pos || c.moved.has(p0.id) || m.preContracts?.[p0.id]) continue;
      const k = m.contracts[p0.id];
      if (k?.kind === 'loan') continue;
      // recém-contratado não é revendido na mesma janela
      if (k && k.kind !== 'renewal' && k.since >= recent) continue;
      const o = c.ovr(p0);
      const isListed = listedSet.has(p0.id);
      if (mode === 'loan') {
        if (!loanSet.has(p0.id) || o < minLevel - 3 || sStr <= bStr) continue;
      } else if (mode === 'prospect') {
        if (p0.age > 23 || o < need.level - 6 || p0.potential < Math.max(need.level + 2, 74)) continue;
      } else if (mode === 'veteran') {
        if (p0.age < 29 || p0.age > 34 || o < Math.max(minLevel, 78)) continue;
      } else {
        if (!sells && !isListed) continue;
        if (o < minLevel || o > bStr + 10 || p0.age > 32) continue;
        // a Arábia raramente tira jovens da Europa fora do perfil "veterano"
        if (region === 'SAU' && sInfo?.region === 'EU' && p0.age < 27 && !isListed) continue;
      }
      if (mode !== 'loan') {
        if (p0.wage > room * (mode === 'veteran' ? 0.6 : 1.1)) continue;
        if (careerValue(state, p0.overall === o ? p0 : { ...p0, overall: o }, sellerId) * 1.05 > budget) continue;
      } else if (p0.wage * 0.4 > room) continue;
      found++;
      const score = mode === 'prospect'
        ? (p0.potential - need.level) * 2 + (o - need.level) + rng.next() * 4
        : (o - minLevel) * 3 - Math.max(0, p0.age - 28) * (mode === 'veteran' ? 0 : 1.5) + (isListed ? 5 : 0) + rng.next() * 4;
      if (!best || score > best.score) best = { p: c.live(p0), seller: sellerId, score };
    }
  }
  if (!best) return null;
  const seller = clubView(state, c.squads, best.seller);
  const buyer = clubView(state, c.squads, buyerId);
  const p = best.p;

  if (mode === 'loan') return aiLoanDeal(c, p, seller, buyer);

  const value = careerValue(state, p, best.seller);
  if (value * 0.9 > budget) return null;
  const ask = askingPrice(state, p, seller, buyer).ask;
  let fee = round50k(ask * rng.range(0.85, 1.02));
  const d1 = evaluateOffer(state, { player: p, fee, round: 1, seller, buyer });
  if (d1.decision === 'counter' && d1.counterFee && d1.counterFee <= budget) fee = d1.counterFee;
  else if (d1.decision !== 'accept') return null;
  if (fee > budget) return null;
  // contrato: o jogador decide (interesse) e o salário tem de caber no teto
  const input = { player: p, buyer, fromReputation: seller.reputation, fromLeague: seller.league };
  const demand = contractDemand(state, input);
  let wage = state.career ? Math.max(demand.wage, clubMarketWage(state, buyer.squad, buyerId, p)) : demand.wage;
  if (mode === 'veteran') wage = Math.round(wage * rng.range(AI_MARKET.saudiWage[0], AI_MARKET.saudiWage[1]) / 1000) * 1000;
  const appeal = playerAppeal(state, input);
  if (appeal.score < APPEAL_MIN && wage < demand.wage * MONEY_TALKS) return null;
  // (Etapa 4) a IA também respeita o teto da folha da sua diretoria
  if (!aiWageOk(state, buyerId, buyer.squad, wage, 0, AI_MARKET.wageTarget, c.loanOut(buyerId))) return null;
  const years = mode === 'veteran' ? rng.int(2, 3) : Math.floor((demand.minYears + demand.maxYears) / 2);
  const clause = state.career ? Math.round(careerWorth(state, p, buyerId) * rng.range(2.2, 3.5) / 100_000) * 100_000 : undefined;
  applyTransfer(state, {
    player: p, fromClubId: best.seller, toClubId: buyerId, fee, wage, years, kind: 'transfer', releaseClause: clause,
    quiet: !(fee >= 20_000_000 || p.overall >= 78 || (mode === 'veteran' && p.overall >= 80)),
  });
  c.moved.add(p.id);
  if (mode === 'replace') m.needs![buyerId].shift();
  if (m.needs?.[buyerId] && !m.needs[buyerId].length) delete m.needs[buyerId];
  return [best.seller, buyerId];
}

/** Empréstimo IA × IA de um jovem/excedente listado. */
function aiLoanDeal(c: Ctx, p: Player, seller: ClubView, buyer: ClubView): string[] | null {
  const { state, rng } = c;
  const share = rng.chance(0.5) ? 50 : rng.chance(0.5) ? 75 : 100;
  const option = rng.chance(0.25) ? round50k(careerValue(state, p, seller.clubId) * rng.range(1.0, 1.4)) : undefined;
  const loan = { wageShare: share, ...(option ? { purchaseOption: Math.max(100_000, option) } : {}) };
  const d = evaluateOffer(state, { player: p, fee: 0, round: 1, kind: 'loan', seller, buyer, loan });
  let terms = loan;
  let fee = 0;
  if (d.decision === 'counter' && d.counterLoan) {
    terms = d.counterLoan;
    fee = d.counterFee ?? 0;
    if (fee > aiBudget(state, buyer.clubId)) return null;
  } else if (d.decision !== 'accept') return null;
  const wagePart = Math.round((p.wage * terms.wageShare) / 100);
  if (!aiWageOk(state, buyer.clubId, buyer.squad, wagePart, 0, AI_MARKET.wageTarget, c.loanOut(buyer.clubId))) return null;
  const appeal = playerAppeal(state, { player: p, buyer, fromReputation: seller.reputation, fromLeague: seller.league, kind: 'loan' });
  if (appeal.score < APPEAL_MIN) return null;
  applyTransfer(state, { player: p, fromClubId: seller.clubId, toClubId: buyer.clubId, fee, wage: p.wage, years: 1, kind: 'loan', loan: terms, quiet: p.overall < 76 });
  c.moved.add(p.id);
  return [seller.clubId, buyer.clubId];
}

/* ═════════════════════ 6) ofertas pelos jogadores do humano ═════════════════════ */

function aiOffersForHuman(c: Ctx, human: string): void {
  const { state, rng } = c;
  const m = state.market!;
  const pending = () => m.offers.filter((o) => o.fromClubId === human && o.status === 'pending');
  if (pending().length >= 6) return;
  const hSquad = c.squads(human);
  const listed = new Set(m.transferList.filter((pid) => currentClubOf(state, pid) === human));
  const loanListed = new Set((m.loanList ?? []).filter((pid) => currentClubOf(state, pid) === human));
  const topUnlisted = hSquad
    .filter((p) => !listed.has(p.id) && !loanListed.has(p.id))
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))
    .slice(0, 3);
  const targets: { p: Player; listed: boolean; loan: boolean }[] = [
    ...hSquad.filter((p) => listed.has(p.id)).map((p) => ({ p, listed: true, loan: false })),
    ...hSquad.filter((p) => loanListed.has(p.id) && !listed.has(p.id)).map((p) => ({ p, listed: true, loan: true })),
    ...topUnlisted.map((p) => ({ p, listed: false, loan: false })),
  ];
  for (const { p: p0, listed: isListed, loan } of targets) {
    if (pending().length >= 6) break;
    if (m.contracts[p0.id]?.kind === 'loan' && m.contracts[p0.id].loanFrom !== human) continue; // emprestado ao humano
    if (m.preContracts?.[p0.id]) continue;
    if (!rng.chance(isListed ? (loan ? 0.2 : 0.3) : 0.012)) continue;
    if (m.offers.filter((o) => o.playerId === p0.id && o.status === 'pending').length >= 2) continue;
    const p = c.live(p0);
    const already = new Set(m.offers.filter((o) => o.playerId === p.id && o.status === 'pending').map((o) => o.toClubId));
    const seller = clubView(state, c.squads, human);
    const value = careerValue(state, p, human);
    // compradores: janela aberta, caixa, vaga no elenco e o jogador melhora a posição (ou quase)
    const cands = c.aiClubs.filter((id) => {
      if (already.has(id) || !c.open(id) || !canBuy(c, id)) return false;
      const sq = c.squads(id);
      if (sq.length >= m.rules.maxSquad) return false;
      const bal = state.clubs[id].balance;
      if (!loan && bal * 0.6 < value * 0.7) return false;
      if (loan) return p.overall >= positionLevel(sq, p.position) - 8 && (state.clubInfo?.[id]?.reputation ?? 2) <= (state.clubInfo?.[human]?.reputation ?? 2);
      // listados: interessa a quem ganharia uma opção útil de elenco; não listados: só se melhorar o XI
      return isListed
        ? p.overall >= positionLevel(sq, p.position) - 6 || p.overall >= c.strength(sq) - 6
        : p.overall >= positionLevel(sq, p.position) - 2;
    });
    if (!cands.length) continue;
    const buyerId = cands[rng.weightedIndex(cands.map((id) => 1 + Math.max(0, state.clubs[id].balance) / 5e6))];
    const buyer = clubView(state, c.squads, buyerId);
    if (loan) {
      const share = rng.chance(0.5) ? 100 : 75;
      pushIncoming(c, human, buyerId, p, 0, 'loan', { wageShare: share }, 0);
      continue;
    }
    const ask = askingPrice(state, p, seller, buyer).ask;
    const budget = Math.min(aiBudget(state, buyerId), state.clubs[buyerId].balance * 0.6);
    // (Etapa 5) craque com multa baixa: um clube rico deposita a multa (venda forçada)
    if (!isListed && state.career) {
      const clause = releaseClauseOf(state, p, human);
      if (clause <= budget && clause <= ask * 1.3 && rng.chance(0.25)) {
        const offer = pushIncoming(c, human, buyerId, p, clause, 'transfer', undefined, clause);
        offer.clause = true;
        offer.status = 'pending';
        // multa: o clube do humano não pode recusar; segue direto para o jogador
        forceClauseSale(c, offer);
        continue;
      }
    }
    const fee = round50k(ask * (isListed ? rng.range(0.78, 1.0) : rng.range(1.0, 1.2)));
    if (fee <= 0 || fee > budget) continue;
    const maxFee = Math.max(fee, Math.min(budget, round50k(ask * (isListed ? 1.1 : 1.3))));
    pushIncoming(c, human, buyerId, p, fee, 'transfer', undefined, maxFee);
  }
}

function pushIncoming(c: Ctx, human: string, buyerId: string, p: Player, fee: number, kind: 'transfer' | 'loan', loan: TransferOffer['loan'], maxFee: number): TransferOffer {
  const { state } = c;
  const m = state.market!;
  const offer: TransferOffer = {
    id: `o${++m.seq}`,
    kind,
    playerId: p.id,
    player: { ...p },
    fromClubId: human,
    fromName: clubName(state, human),
    toClubId: buyerId,
    toName: clubName(state, buyerId),
    fee,
    round: 1,
    contractRound: 0,
    status: 'pending',
    createdOn: state.date,
    updatedOn: state.date,
    expiresOn: addDaysIso(state.date, MARKET.offerTtlDays),
    log: [{ by: 'buyer', fee, date: state.date, ...(loan ? { text: `Empréstimo: ${loan.wageShare}% do salário pagos pelo ${clubName(state, buyerId)}.` } : {}) }],
    ...(loan ? { loan } : {}),
    ...(kind === 'transfer' ? { maxFee } : {}),
  };
  m.offers.unshift(offer);
  state.news.push({
    date: state.date,
    text: kind === 'loan'
      ? `Proposta recebida: o ${offer.toName} quer ${p.name} emprestado (${loan!.wageShare}% do salário pago por eles).`
      : `Proposta recebida: o ${offer.toName} oferece ${fmtMoneyPt(fee)} por ${p.name}.`,
    clubId: human,
  });
  return offer;
}

/** Multa depositada pela IA por um jogador do humano: o clube não pode recusar; o jogador decide. */
function forceClauseSale(c: Ctx, offer: TransferOffer): void {
  const { state } = c;
  const date = state.date;
  const m = state.market!;
  const sq = c.squads(offer.fromClubId);
  if (sq.length - 1 < m.rules.minSquad) { offer.status = 'expired'; return; }
  const player = sq.find((x) => x.id === offer.playerId) ?? offer.player;
  const buyer = clubView(state, c.squads, offer.toClubId);
  const seller = clubView(state, c.squads, offer.fromClubId);
  const input = { player, buyer, fromReputation: seller.reputation, fromLeague: seller.league };
  const demand = contractDemand(state, input);
  const appeal = playerAppeal(state, input);
  offer.log.push({ by: 'seller', decision: 'accept', fee: offer.fee, date, text: 'Multa rescisória depositada: venda obrigatória.' });
  if (appeal.score < APPEAL_MIN) {
    offer.status = 'collapsed';
    offer.log.push({ by: 'player', decision: 'reject', date, text: `${player.name} recusou o ${offer.toName}: ${appeal.reason}.` });
    state.news.push({ date, text: `O ${offer.toName} pagou a multa de ${player.name}, mas o jogador recusou a transferência e fica.`, clubId: offer.fromClubId });
    return;
  }
  const years = Math.min(demand.maxYears, demand.minYears + 1);
  offer.status = 'completed';
  offer.wage = demand.wage;
  offer.years = years;
  offer.log.push({ by: 'player', decision: 'accept', wage: demand.wage, years, date });
  applyTransfer(state, { player, fromClubId: offer.fromClubId, toClubId: offer.toClubId, fee: offer.fee, wage: demand.wage, years, kind: 'transfer', via: 'clause' });
  c.moved.add(player.id);
  c.refresh([offer.fromClubId, offer.toClubId]);
}

/** (Etapa 5) Exportado para testes: temporada final de um contrato assinado hoje. */
export { contractEndsSeason };
