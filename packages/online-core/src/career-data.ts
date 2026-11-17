/**
 * Dados estáticos da CARREIRA online (equivalente de apps/web/src/career/data.ts), independentes de onde vêm:
 * disco (servidor Node: `apps/server/src/career-data.ts`) ou `/data` via HTTP (anfitrião no navegador).
 *
 *  - `CareerSource`: leitor síncrono de JSON relativo à pasta de dados (`clubs-index.json`, `clubs/<id>.json`…)
 *  - `loadCareerData(src)`   → CareerData (clubs-index, leagues, states, formats, competitions, calendars, economy, countries)
 *  - `loadMarketSquads(src)` → elencos base de TODOS os clubes (players-market.json, ≈84 mil jogadores)
 *  - `careerBase(...)`       → `base(clubId)`: bundle completo dos clubes HUMANOS + mercado para os demais
 *  - `loadNamePools(src, codes)` → names/<CODE>.json (juniores gerados na virada)
 *  - `playableClubs(data, countryId)` → regra de "clube jogável" do web (careerPlayableClubs)
 *
 * IMPORTANTE: o `base` precisa ser IDÊNTICO em todo lugar que aplica worldSquads/careerSquads sobre ele.
 */
import type { ClubBundle, NamePool, Player, PlayersMarket } from '@cosmicfut/shared';
import { squadsFromMarket, type CareerData, type NamePools } from '@cosmicfut/engine';

export type BaseSquads = (clubId: string) => Player[];

/** Leitor de JSON da pasta de dados. `null` = arquivo inexistente. Lança se o JSON for inválido. */
export interface CareerSource {
  readJson<T>(rel: string): T | null;
}

const CLUB_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CODE_RE = /^[A-Z0-9]{2,4}$/;
const EMPTY: Player[] = [];

/** Brasil (índice de países do original). */
export const BRAZIL_ID = 29;

const must = <T>(src: CareerSource, rel: string): T => {
  const v = src.readJson<T>(rel);
  if (v === null) throw new Error(`dados ausentes: ${rel}`);
  return v;
};

/** Arquivos da carreira lidos no início (o anfitrião do navegador baixa estes antes de começar). */
export const CAREER_FILES = ['clubs-index.json', 'leagues.json', 'states.json', 'formats.json', 'competitions.json', 'calendars.json', 'economy.json', 'countries.json', 'players-market.json'] as const;

export function loadCareerData(src: CareerSource): CareerData {
  return {
    clubs: must(src, 'clubs-index.json'),
    leagues: must(src, 'leagues.json'),
    states: must(src, 'states.json'),
    formats: must(src, 'formats.json'),
    competitions: must(src, 'competitions.json'),
    calendars: must(src, 'calendars.json'),
    economy: must(src, 'economy.json'),
    countries: must(src, 'countries.json'),
  };
}

export function loadMarketSquads(src: CareerSource): Map<string, Player[]> {
  return squadsFromMarket(must<PlayersMarket>(src, 'players-market.json'));
}

export function loadBundle(src: CareerSource, clubId: string): ClubBundle | null {
  if (!CLUB_ID_RE.test(clubId)) return null;
  try {
    return src.readJson<ClubBundle>(`clubs/${clubId}.json`);
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

/** names/<CODE>.json para as siglas pedidas (as que faltam são ignoradas). */
export function loadNamePools(src: CareerSource, codes: string[], cache?: Map<string, NamePool | null>): NamePools {
  const out: NamePools = {};
  for (const code of codes) {
    if (!CODE_RE.test(code)) continue;
    let p = cache?.get(code);
    if (p === undefined) {
      try {
        p = src.readJson<NamePool>(`names/${code}.json`);
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
