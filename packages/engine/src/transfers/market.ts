/**
 * Mercado de transferências — estado, janelas e elenco efetivo.
 * Puro e determinístico: nada de Math.random / Date.now.
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { ClubEconomyInfo, FinanceLedger, MarketRules, MarketState, SeasonState, TransferWindow } from '../contract';
import { fmtMoneyShort } from '../money';
import { clubSeason, primaryRegion, regionOfClub, windowFor } from '../season/timeline';

export type Squads = (clubId: string) => Player[];

export const FREE = '';

/** Parâmetros globais do mercado (ajustáveis). */
export const MARKET = {
  minSquad: 18,
  maxSquad: 32,
  /** rodadas de negociação com o clube e com o jogador */
  maxRounds: 3,
  /** saldo negativo permitido ao humano (0 = só compra com caixa) */
  overdraft: 0,
  /** ofertas recebidas pelo humano valem por N dias */
  offerTtlDays: 5,
  historyCap: 500,
  /** (Etapa 5) pré-contrato: só nos últimos N meses do contrato */
  preContractMonths: 6,
  /** contagem mínima por posição que a IA tenta manter */
  minByPosition: { GK: 2, FB: 3, CB: 3, MF: 5, FW: 3 } as Record<Position, number>,
};

/* ───────────── janelas ───────────── */

/**
 * (Etapa 1) Janela do mercado na SeasonState: carreira com linha do tempo global ⇒ janela da REGIÃO do clube
 * (`clubId`; padrão: o 1º humano) — `windowFor` (Europa 01/07–01/09 e 01/01–02/02; Arábia parecida; América do Sul
 * jan–mar e jul–set). Temporadas avulsas/antigas ⇒ `transferWindow(date)`.
 */
export function marketWindow(state: SeasonState, clubId?: string | null): TransferWindow {
  if (!state.segment) return transferWindow(state.date);
  const r = (clubId ? regionOfClub(state, clubId) : null) ?? primaryRegion(state);
  return windowFor(r, state.date);
}

export interface WindowBanner {
  open: boolean;
  /** aberta: data em que fecha */
  closesOn: string | null;
  /** próxima abertura (aberta: a seguinte ao fechamento; fechada: a próxima) */
  nextOpen: string;
  region: string | null;
}

/**
 * (Mercado e Orçamentos) Faixa da janela do clube: aberta/fechada, fechamento da atual e abertura da próxima
 * (janelas regionais de `TRANSFER_WINDOWS`). Ex.: aberta até 31/08 → próxima abertura 01/01.
 */
export function windowBanner(state: SeasonState, clubId?: string | null): WindowBanner {
  const w = marketWindow(state, clubId);
  const region = (clubId ? regionOfClub(state, clubId) : null) ?? (state.segment ? primaryRegion(state) : null);
  const after = (iso: string) => (state.segment ? windowFor(region, addDaysIso(iso, 1)) : transferWindow(addDaysIso(iso, 1)));
  if (w.open) {
    const nx = after(w.closesOn!);
    return { open: true, closesOn: w.closesOn, nextOpen: nx.opensOn ?? addDaysIso(w.closesOn!, 1), region };
  }
  return { open: false, closesOn: null, nextOpen: w.opensOn ?? state.date, region };
}

/** Janelas (temporada avulsa/antiga): do início da temporada até 31/03 e de 01/07 a 31/08. */
export function transferWindow(date: string): TransferWindow {
  const y = Number(date.slice(0, 4));
  const md = date.slice(5);
  if (md <= '03-31') return { open: true, closesOn: `${y}-03-31`, opensOn: null };
  if (md < '07-01') return { open: false, closesOn: null, opensOn: `${y}-07-01` };
  if (md <= '08-31') return { open: true, closesOn: `${y}-08-31`, opensOn: null };
  return { open: false, closesOn: null, opensOn: `${y + 1}-01-01` };
}

/* ───────────── clubes / jogadores ───────────── */

/** Clube de origem nos dados base: id do jogador = `${clubId}:${index}`. */
export function baseClubOf(playerId: string): string {
  const i = playerId.lastIndexOf(':');
  return i > 0 ? playerId.slice(0, i) : '';
}

/** Clube atual do jogador ('' = livre). */
export function currentClubOf(state: SeasonState, playerId: string): string {
  const m = state.market?.moves[playerId];
  return m !== undefined ? m : baseClubOf(playerId);
}

export function isHumanClub(state: SeasonState, clubId: string): boolean {
  return state.humanClubIds.includes(clubId);
}

export function clubName(state: SeasonState, clubId: string, ext?: ClubEconomyInfo): string {
  if (clubId === FREE) return 'Sem clube';
  return state.clubInfo?.[clubId]?.name ?? ext?.name ?? clubId;
}

/** Aplica o mercado a um elenco (base OU já efetivo — a função é idempotente). */
function applyMarket(m: MarketState, squad: Player[], clubId: string, incoming: string[] | undefined): Player[] {
  const out: Player[] = [];
  const seen = new Set<string>();
  for (const p of squad) {
    const mv = m.moves[p.id];
    if (mv !== undefined && mv !== clubId) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const snap = m.players[p.id];
    if (snap) { out.push(snap); continue; }
    // (Etapa 5) renovação no clube de origem: só o contrato muda (salário novo), sem cópia do jogador
    const c = m.contracts[p.id];
    out.push(c && c.kind === 'renewal' && c.wage !== p.wage ? { ...p, wage: c.wage } : p);
  }
  if (incoming) {
    for (const pid of incoming) {
      if (seen.has(pid)) continue;
      const snap = m.players[pid];
      if (!snap) continue;
      seen.add(pid);
      out.push(snap);
    }
  }
  return out;
}

function incomingIndex(m: MarketState): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const [pid, c] of Object.entries(m.moves)) {
    // inclui retornos ao clube de origem: o elenco recebido pode ser um efetivo antigo sem o jogador
    if (c === FREE) continue;
    let arr = idx.get(c);
    if (!arr) idx.set(c, (arr = []));
    arr.push(pid);
  }
  return idx;
}

/** Elenco efetivo do clube: elenco base sem quem saiu + quem chegou (com o salário do contrato novo). */
export function effectiveSquad(state: SeasonState, baseSquads: Squads, clubId: string): Player[] {
  const m = state.market;
  const base = baseSquads(clubId);
  if (!m) return base;
  return applyMarket(m, base, clubId, incomingIndex(m).get(clubId));
}

/**
 * `squads()` efetivo e memorizado para a SeasonState informada.
 * Use no web para montar a função passada ao advanceDay e para as telas (Elenco/Táticas).
 */
export function marketSquads(state: SeasonState, baseSquads: Squads): Squads {
  const m = state.market;
  if (!m) return baseSquads;
  const idx = incomingIndex(m);
  const cache = new Map<string, Player[]>();
  return (clubId: string) => {
    let s = cache.get(clubId);
    if (!s) {
      s = applyMarket(m, baseSquads(clubId), clubId, idx.get(clubId));
      cache.set(clubId, s);
    }
    return s;
  };
}

/**
 * (13/11, desempenho) `marketSquads` com invalidação seletiva: depois de `applyTransfer`, só os elencos dos clubes
 * envolvidos (origem, destino, dono do empréstimo) mudam — os outros continuam na memória. O índice de chegadas é
 * refeito por inteiro (barato) para manter exatamente a mesma ordem de `marketSquads`. Mesmo resultado que recriar
 * `marketSquads(state, base)` após cada transferência.
 */
export function marketSquadsCache(state: SeasonState, baseSquads: Squads): { squads: Squads; invalidate: (clubIds: Iterable<string>) => void } {
  const m = state.market;
  if (!m) return { squads: baseSquads, invalidate: () => {} };
  let idx = incomingIndex(m);
  const cache = new Map<string, Player[]>();
  return {
    squads: (clubId: string) => {
      let s = cache.get(clubId);
      if (!s) {
        s = applyMarket(m, baseSquads(clubId), clubId, idx.get(clubId));
        cache.set(clubId, s);
      }
      return s;
    },
    invalidate: (clubIds: Iterable<string>) => {
      idx = incomingIndex(m);
      for (const c of clubIds) cache.delete(c);
    },
  };
}

/** Jogadores sem clube (dispensados). */
export function freeAgents(state: SeasonState): Player[] {
  const m = state.market;
  if (!m) return [];
  const out: Player[] = [];
  for (const [pid, c] of Object.entries(m.moves)) if (c === FREE && m.players[pid]) out.push(m.players[pid]);
  return out;
}

/** Contrato termina em (temporada, inclusive). Jogadores sem contrato novo recebem um prazo determinístico. */
export function contractEnd(state: SeasonState, p: Player): number {
  const c = state.market?.contracts[p.id];
  if (c) return c.endsSeason;
  const career = state.career;
  if (career) {
    // carreira: contrato persistido no mundo, ou o padrão determinístico fixado no 1º ano
    const w = career.contractEnds?.[p.id];
    if (w !== undefined) return w;
    return defaultContractEnd(p.id, p.age - (career.agedYears ?? state.season - career.startSeason), career.startSeason);
  }
  return defaultContractEnd(p.id, p.age, state.season);
}

/**
 * (Etapa 1) Temporada contratual atual do clube do jogador (ciclo da região: Europa 2026/27 → 2026). Anos restantes
 * de contrato = contractEnd − isto. Sem linha do tempo global ⇒ state.season.
 */
export function contractSeasonOf(state: SeasonState, clubId: string | null | undefined): number {
  return clubSeason(state, clubId);
}

/** Fim de contrato padrão (determinístico pelo id): 1..4 temporadas a partir de `season`, pela idade nela. */
export function defaultContractEnd(playerId: string, age: number, season: number): number {
  let h = 2166136261;
  for (let i = 0; i < playerId.length; i++) h = Math.imul(h ^ playerId.charCodeAt(i), 16777619);
  const r = (h >>> 0) % 4;
  // temporadas de contrato restantes (incluindo a atual): 1..4
  const span = age >= 33 ? 1 : age >= 29 ? 1 + (r % 2) : 1 + r;
  return season + span - 1;
}

/* ───────────── (Etapa 5) folha com empréstimos ───────────── */

/** % do salário pago pelo clube que tem o jogador (empréstimo: `wageShare`; senão 100). */
export function wageShareOf(state: SeasonState, playerId: string, holderId: string): number {
  const c = state.market?.contracts[playerId];
  if (c?.kind === 'loan' && c.loanFrom && c.loanFrom !== holderId && c.wageShare !== undefined) return Math.max(0, Math.min(100, c.wageShare));
  return 100;
}

/**
 * Parte do salário que cada clube DONO ainda paga pelos seus emprestados (todos os clubes; sem cache — o mercado
 * muda no lugar durante o dia).
 */
export function loanOutWages(state: SeasonState): Map<string, number> {
  const m = state.market;
  const out = new Map<string, number>();
  if (!m) return out;
  for (const pid in m.contracts) {
    const c = m.contracts[pid];
    if (c.kind !== 'loan' || !c.loanFrom || c.wageShare === undefined || c.wageShare >= 100) continue;
    const w = m.players[pid]?.wage ?? c.wage;
    out.set(c.loanFrom, (out.get(c.loanFrom) ?? 0) + Math.round((w * (100 - c.wageShare)) / 100));
  }
  return out;
}

/** Parte dos salários dos emprestados que o clube dono ainda paga. */
export function loanOutWage(state: SeasonState, clubId: string): number {
  const m = state.market;
  if (!m) return 0;
  let t = 0;
  for (const pid in m.contracts) {
    const c = m.contracts[pid];
    if (c.kind !== 'loan' || c.loanFrom !== clubId || c.wageShare === undefined || c.wageShare >= 100) continue;
    t += Math.round(((m.players[pid]?.wage ?? c.wage) * (100 - c.wageShare)) / 100);
  }
  return t;
}

/**
 * Folha mensal de um clube: salários do elenco (emprestados recebidos pela parte do `wageShare`) + a parte dos
 * emprestados a outros clubes que o dono continua pagando (`loanOut`: valor pré-calculado de `loanOutWages`).
 */
export function clubWageBill(state: SeasonState, clubId: string, squad: Pick<Player, 'id' | 'wage'>[], loanOut?: number): number {
  let t = 0;
  for (const p of squad) {
    const share = wageShareOf(state, p.id, clubId);
    t += share >= 100 ? p.wage || 0 : Math.round(((p.wage || 0) * share) / 100);
  }
  return t + (loanOut ?? loanOutWage(state, clubId));
}

/* ───────────── (Etapa 5) estatísticas ───────────── */

export function emptyTally(): import('../contract').MarketTally {
  return { transfers: 0, loans: 0, free: 0, precontracts: 0, clauses: 0, renewals: 0, options: 0, fees: 0, saToEu: 0, saToEuFees: 0, euToSau: 0, youngSaToEu: 0 };
}

export function ledgerOf(state: SeasonState, clubId: string): FinanceLedger | undefined {
  const c = state.clubs[clubId];
  if (!c) return undefined;
  c.finance ??= { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 };
  return c.finance;
}

/* ───────────── criação ───────────── */

/**
 * Cria o mercado. Clubes da IA com mais de `maxSquad` jogadores dispensam o excedente
 * (os de menor overall/mais velhos) — eles viram jogadores livres.
 */
export function createMarket(state: SeasonState, squads: Squads, rules: Partial<MarketRules> = {}): MarketState {
  const r: MarketRules = { overdraft: MARKET.overdraft, minSquad: MARKET.minSquad, maxSquad: MARKET.maxSquad, ...rules };
  const m: MarketState = {
    window: marketWindow(state),
    moves: {},
    contracts: {},
    players: {},
    offers: [],
    transferList: [],
    history: [],
    rules: r,
    seq: 0,
  };
  for (const clubId of Object.keys(state.clubs)) {
    if (isHumanClub(state, clubId)) continue;
    const squad = squads(clubId);
    if (squad.length <= r.maxSquad) continue;
    const surplus = squad.length - r.maxSquad;
    const counts = countByPosition(squad);
    const ranked = squad
      .slice()
      .sort((a, b) => a.overall - b.overall || b.age - a.age || (a.id < b.id ? -1 : 1));
    let released = 0;
    for (const p of ranked) {
      if (released >= surplus) break;
      if (counts[p.position] <= MARKET.minByPosition[p.position]) continue;
      counts[p.position]--;
      m.moves[p.id] = FREE;
      m.players[p.id] = { ...p };
      released++;
    }
  }
  return m;
}

/** Garante `state.market` (saves antigos). Não muta a entrada. */
export function ensureMarket(state: SeasonState, squads: Squads, rules?: Partial<MarketRules>): SeasonState {
  if (state.market) return state;
  return { ...state, market: createMarket(state, squads, rules) };
}

export function countByPosition(squad: Player[]): Record<Position, number> {
  const c: Record<Position, number> = { GK: 0, FB: 0, CB: 0, MF: 0, FW: 0 };
  for (const p of squad) c[p.position]++;
  return c;
}

/** Força do elenco: média dos 14 melhores overall. */
export function squadStrength(squad: Player[]): number {
  if (!squad.length) return 0;
  const top = squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 14);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "$ 1,05 bi", "$ 120 mi", "$ 850 mil" (ver money.ts). */
export function fmtMoneyPt(v: number): string {
  return fmtMoneyShort(v);
}
