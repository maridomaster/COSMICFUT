/**
 * Dados estáticos da CARREIRA no servidor (equivalente Node de apps/web/src/career/data.ts — replicado, não importado).
 *
 *  - `loadCareerData(dir)`   → CareerData (clubs-index, leagues, states, formats, competitions, calendars, economy, countries)
 *  - `loadMarketSquads(dir)` → elencos base de TODOS os clubes (players-market.json, ≈84 mil jogadores)
 *  - `careerBase(...)`       → `base(clubId)`: bundle completo (clubs/<id>.json) dos clubes HUMANOS + mercado para os demais
 *  - `loadNamePools(dir, codes)` → names/<CODE>.json (juniores gerados na virada)
 *  - `playableClubs(data, countryId)` → regra de "clube jogável" do web (careerPlayableClubs)
 *
 * IMPORTANTE: o `base` precisa ser IDÊNTICO em todo lugar que aplica worldSquads/careerSquads sobre ele
 * (worker de simulação, modo inline, testes). Por isso ele depende só de (dir, humanClubIds).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClubBundle, NamePool, Player, PlayersMarket } from '@cosmicfut/shared';
import { squadsFromMarket, type CareerData, type NamePools } from '@cosmicfut/engine';

export type BaseSquads = (clubId: string) => Player[];

const CLUB_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CODE_RE = /^[A-Z0-9]{2,4}$/;
const EMPTY: Player[] = [];

/** Brasil (índice de países do original). */
export const BRAZIL_ID = 29;

const readJson = <T>(dir: string, rel: string): T => JSON.parse(readFileSync(resolve(dir, rel), 'utf8')) as T;

export function loadCareerData(dir: string): CareerData {
  return {
    clubs: readJson(dir, 'clubs-index.json'),
    leagues: readJson(dir, 'leagues.json'),
    states: readJson(dir, 'states.json'),
    formats: readJson(dir, 'formats.json'),
    competitions: readJson(dir, 'competitions.json'),
    calendars: readJson(dir, 'calendars.json'),
    economy: readJson(dir, 'economy.json'),
    countries: readJson(dir, 'countries.json'),
  };
}

export function loadMarketSquads(dir: string): Map<string, Player[]> {
  return squadsFromMarket(readJson<PlayersMarket>(dir, 'players-market.json'));
}

export function loadBundle(dir: string, clubId: string): ClubBundle | null {
  if (!CLUB_ID_RE.test(clubId)) return null;
  const f = resolve(dir, 'clubs', `${clubId}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as ClubBundle;
  } catch {
    return null;
  }
}

/**
 * Base de elencos da carreira online: bundle completo dos clubes humanos (traits, lado, flags) e
 * players-market para os demais. Sem bundle (ou bundle vazio) o humano cai no mercado.
 */
export function careerBase(market: Map<string, Player[]>, humanBundles: Map<string, Player[]>): BaseSquads {
  return (clubId) => {
    const h = humanBundles.get(clubId);
    return h && h.length ? h : market.get(clubId) ?? EMPTY;
  };
}

/** names/<CODE>.json para as siglas pedidas (as que faltam no disco são ignoradas). */
export function loadNamePools(dir: string, codes: string[], cache?: Map<string, NamePool | null>): NamePools {
  const out: NamePools = {};
  for (const code of codes) {
    if (!CODE_RE.test(code)) continue;
    let p = cache?.get(code);
    if (p === undefined) {
      try {
        p = readJson<NamePool>(dir, `names/${code}.json`);
      } catch {
        p = null;
      }
      cache?.set(code, p);
    }
    if (p) out[code] = p;
  }
  return out;
}

/**
 * Clubes com carreira (mesma regra de `careerPlayableClubs` do web):
 *  - divisões nacionais reais (não fictícias, ≥ 2 clubes) do país;
 *  - no Brasil, também qualquer clube de divisão estadual (≥ 2 clubes) — os que só jogam o estadual.
 */
export function playableClubs(data: Pick<CareerData, 'leagues' | 'states'>, countryId: number): { all: Set<string>; stateOnly: Set<string> } {
  const national = new Set<string>();
  for (const d of data.leagues) {
    if (d.countryId !== countryId || d.fictional || d.clubIds.length < 2) continue;
    d.clubIds.forEach((id) => national.add(id));
  }
  const all = new Set(national);
  const stateOnly = new Set<string>();
  if (countryId === BRAZIL_ID) {
    for (const s of data.states) {
      for (const d of s.divisions) {
        if (d.clubIds.length < 2) continue;
        for (const id of d.clubIds) {
          all.add(id);
          if (!national.has(id)) stateOnly.add(id);
        }
      }
    }
  }
  return { all, stateOnly };
}

/** País com carreira disponível (alguma divisão nacional real). */
export function countryPlayable(data: Pick<CareerData, 'leagues'>, countryId: number): boolean {
  return data.leagues.some((d) => d.countryId === countryId && !d.fictional && d.clubIds.length >= 2);
}
