/**
 * Dados estáticos da carreira (Fase 1) — usados no thread principal E no worker da carreira.
 * Sem React, sem DOM: só `fetch` (disponível nos dois contextos).
 *
 *  - `loadCareerData()`  → CareerData (clubs-index, leagues, states, formats, competitions, calendars, economy, countries)
 *  - `loadMarketSquads()` → elencos base de TODOS os clubes a partir de players-market.json (síncrono depois de carregado)
 *  - `careerBase(market, humanId, humanPlayers)` → `base(clubId)`: bundle completo do humano + mercado para os demais.
 *
 * IMPORTANTE: o `base` precisa ser IDÊNTICO no worker e no thread principal (os dois aplicam
 * `worldSquads/careerSquads` sobre ele). Por isso ele NÃO usa o cache de bundles do mercado (data/squads).
 */
import type { NamePool, Player, PlayersMarket } from '@cosmicfut/shared';
import { squadsFromMarket, type CareerData } from '@cosmicfut/engine';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
export const careerDataUrl = (path: string) => `${BASE}/data/${path.replace(/^\//, '')}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(careerDataUrl(path), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(`não-JSON em ${path}`);
  return (await res.json()) as T;
}

let dataP: Promise<CareerData> | null = null;
export function loadCareerData(): Promise<CareerData> {
  dataP ??= Promise.all([
    getJson<CareerData['clubs']>('clubs-index.json'),
    getJson<CareerData['leagues']>('leagues.json'),
    getJson<CareerData['states']>('states.json'),
    getJson<CareerData['formats']>('formats.json'),
    getJson<CareerData['competitions']>('competitions.json'),
    getJson<CareerData['calendars']>('calendars.json'),
    getJson<CareerData['economy']>('economy.json'),
    getJson<CareerData['countries']>('countries.json'),
  ]).then(([clubs, leagues, states, formats, competitions, calendars, economy, countries]) => ({
    clubs, leagues, states, formats, competitions, calendars, economy, countries,
  }));
  dataP.catch(() => (dataP = null));
  return dataP;
}

let marketP: Promise<Map<string, Player[]>> | null = null;
/** players-market.json → elencos por clube (≈84 mil jogadores, ~60 ms). */
export function loadMarketSquads(): Promise<Map<string, Player[]>> {
  marketP ??= getJson<PlayersMarket>('players-market.json').then((pm) => squadsFromMarket(pm));
  marketP.catch(() => (marketP = null));
  return marketP;
}

const EMPTY: Player[] = [];
export type BaseSquads = (clubId: string) => Player[];

export function careerBase(market: Map<string, Player[]>, humanId: string, humanPlayers: Player[] | null): BaseSquads {
  return (clubId) => (clubId === humanId && humanPlayers?.length ? humanPlayers : market.get(clubId) ?? EMPTY);
}

/**
 * Base de elencos de uma SALA ONLINE: bundle completo de TODOS os humanos + mercado para os demais
 * (mesma regra de apps/server/src/career-data.ts `careerBase`: bundle vazio/ausente cai no mercado).
 */
export function careerBaseFor(market: Map<string, Player[]>, humanBundles: Map<string, Player[]>): BaseSquads {
  return (clubId) => {
    const h = humanBundles.get(clubId);
    return h && h.length ? h : market.get(clubId) ?? EMPTY;
  };
}

const pools = new Map<string, Promise<NamePool | null>>();
/** names/<CODE>.json (nomes dos juniores gerados na virada). */
export function loadNamePool(code: string): Promise<NamePool | null> {
  let p = pools.get(code);
  if (!p) {
    p = getJson<NamePool>(`names/${encodeURIComponent(code)}.json`).catch(() => null);
    pools.set(code, p);
  }
  return p;
}

/** Brasil (países: índice do original). */
export const BRAZIL_ID = 29;

/**
 * Clubes que têm carreira nesta versão (Fase 1):
 *  - Brasil: divisões nacionais reais (Séries A–D) OU qualquer divisão estadual (clubes que só jogam o estadual);
 *  - outros países: divisão nacional não fictícia do país (≥ 2 clubes). Sem divisão → sem carreira.
 */
export function careerPlayableClubs(data: Pick<CareerData, 'leagues' | 'states'>): { all: Set<string>; stateOnly: Set<string> } {
  const national = new Set<string>();
  for (const d of data.leagues) {
    if (d.fictional || d.clubIds.length < 2) continue;
    d.clubIds.forEach((id) => national.add(id));
  }
  const all = new Set(national);
  const stateOnly = new Set<string>();
  for (const s of data.states) {
    for (const d of s.divisions) {
      if (d.clubIds.length < 2) continue;
      for (const id of d.clubIds) {
        all.add(id);
        if (!national.has(id)) stateOnly.add(id);
      }
    }
  }
  return { all, stateOnly };
}
