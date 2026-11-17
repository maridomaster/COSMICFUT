/**
 * Camada de dados: busca /data/*.json (gerado pelo pipeline em public/data) e,
 * em qualquer falha (404, resposta não-JSON, erro de rede), cai na fixture de dev.
 */
import type { Calendar, ClubBundle, ClubIndexEntry, Country, Division, Economy, StateChampionship, Trait } from '@cosmicfut/shared';

type Fixtures = typeof import('@/dev/fixtures');
/** Fixture carregada sob demanda: com dados reais ela nem chega a ser baixada. */
let fixtures: Promise<Fixtures> | null = null;
const getFixtures = () => (fixtures ??= import('@/dev/fixtures'));
let fixtureBundleIds: Set<string> | null = null;

export type DataOrigin = 'real' | 'fixture';
export interface Sourced<T> {
  data: T;
  origin: DataOrigin;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const dataUrl = (path: string) => `${BASE}/data/${path.replace(/^\//, '')}`;

/** Caminho relativo de asset (ex.: 'crests/palmeiras.png') → URL pública '/assets/crests/palmeiras.png'. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${BASE}/assets/${path.replace(/^\/?(assets\/)?/, '')}`;
}

/**
 * O índice só traz `crestMini` (18x18). Pela convenção do pipeline o escudo grande (60x60)
 * fica em crests/<id>.png; a UI tenta o grande e cai no mini e depois no SVG gerado.
 */
export function indexCrestPaths(e: Pick<ClubIndexEntry, 'id' | 'crestMini'>): string[] {
  if (!e.crestMini) return [`crests/${e.id}.png`];
  const big = e.crestMini.replace(/^crests-mini\//, 'crests/');
  return big !== e.crestMini ? [big, e.crestMini] : [e.crestMini];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  // O dev server do Vite pode responder index.html (200) para caminhos inexistentes.
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(`não-JSON em ${path}`);
  return (await res.json()) as T;
}

const cache = new Map<string, Promise<Sourced<unknown>>>();

function withFallback<T>(path: string, fallback: (f: Fixtures) => T | null): Promise<Sourced<T>> {
  const hit = cache.get(path);
  if (hit) return hit as Promise<Sourced<T>>;
  const p = fetchJson<T>(path)
    .then((data): Sourced<T> => ({ data, origin: 'real' }))
    .catch(async (err): Promise<Sourced<T>> => {
      const f = await getFixtures();
      fixtureBundleIds ??= new Set(f.FIXTURE_BUNDLES.map((b) => b.club.id));
      const fb = fallback(f);
      if (fb === null) throw err;
      if (import.meta.env.DEV) console.info(`[data] ${path} indisponível → fixture`);
      return { data: fb, origin: 'fixture' };
    });
  cache.set(path, p as Promise<Sourced<unknown>>);
  // Não "envenena" o cache com falhas definitivas.
  p.catch(() => cache.delete(path));
  return p;
}

export const loadClubIndex = () => withFallback<ClubIndexEntry[]>('clubs-index.json', (f) => f.FIXTURE_INDEX);
export const loadCountries = () => withFallback<Country[]>('countries.json', (f) => f.FIXTURE_COUNTRIES);
export const loadTraits = () => withFallback<Trait[]>('traits.json', (f) => f.FIXTURE_TRAITS);
export const loadLeagues = () => withFallback<Division[]>('leagues.json', (f) => f.FIXTURE_LEAGUES);
export const loadEconomy = () => withFallback<Economy>('economy.json', (f) => f.FIXTURE_ECONOMY);
/** Estaduais (Fase 1: clubes que só jogam o estadual também têm carreira). Sem fixture: lista vazia. */
export const loadStates = () => withFallback<StateChampionship[]>('states.json', () => []);
/** Sem calendário na fixture: a engine cai no espaçamento semanal. */
export const loadCalendars = () => withFallback<Calendar[]>('calendars.json', () => []);
export const loadClub = (id: string) =>
  withFallback<ClubBundle>(`clubs/${encodeURIComponent(id)}.json`, (f) => f.FIXTURE_BUNDLES.find((b) => b.club.id === id) ?? null);

/** Na fixture só alguns clubes do índice têm elenco; com dados reais, todos têm. */
export function clubHasBundle(id: string, origin: DataOrigin): boolean {
  return origin === 'real' || (fixtureBundleIds?.has(id) ?? false);
}
