/**
 * Cache em memória dos ClubBundle usados pela temporada.
 * `advanceDay` pede elencos de forma síncrona (`squads(clubId)`), então os bundles das
 * divisões da temporada são carregados antes (ensureBundles) e lidos daqui.
 *
 * Mercado: `syncSeason(season)` (chamado pelo store da temporada a cada mudança) faz
 * `squadOf/squads` devolverem o elenco EFETIVO (com chegadas/saídas e salários dos contratos novos).
 * `baseSquadOf` devolve sempre os dados originais.
 *
 * Carreira (Fase 1): com `setCareerBase(base)` + `syncSeason(state, world)`, a visão efetiva passa a ser
 * `careerSquads(state, worldSquads(world, base))` — idades/overalls evoluídos, juniores gerados, mercado.
 * O `base` da carreira (players-market + bundle do humano) é o MESMO do worker, e não usa este cache.
 */
import type { ClubBundle, Player } from '@cosmicfut/shared';
import { careerSquads, marketSquads, worldSquads, type SeasonState, type WorldState } from '@cosmicfut/engine';
import { loadClub } from './source';

const bundles = new Map<string, ClubBundle>();
const EMPTY: Player[] = [];

export function cachedBundle(id: string): ClubBundle | undefined {
  return bundles.get(id);
}

/** Elenco dos dados base (sem o mercado). */
export function baseSquadOf(id: string): Player[] {
  return bundles.get(id)?.players ?? EMPTY;
}

/**
 * Escopo da visão: a carreira SOLO e a sala ONLINE têm bases diferentes (o online usa os bundles de TODOS os
 * humanos da sala, como o servidor). Cada uma registra a sua; a visão efetiva usa a do modo ativo
 * (`syncSeason(..., scope)` — chamado por store/season.ts ao trocar de modo).
 */
export type SquadScope = 'solo' | 'online';

let season: SeasonState | null = null;
let world: WorldState | null = null;
let scope: SquadScope = 'solo';
const careerBases: Record<SquadScope, ((clubId: string) => Player[]) | null> = { solo: null, online: null };
let view: ((clubId: string) => Player[]) | null = null;
let worldView: { world: WorldState; base: (clubId: string) => Player[]; fn: (clubId: string) => Player[] } | null = null;

function rebuild() {
  const careerBaseFn = careerBases[scope];
  if (season?.career && world && careerBaseFn) {
    if (!worldView || worldView.world !== world || worldView.base !== careerBaseFn) {
      worldView = { world, base: careerBaseFn, fn: worldSquads(world, careerBaseFn) };
    }
    view = careerSquads(season, worldView.fn);
    return;
  }
  view = season?.market ? marketSquads(season, baseSquadOf) : null;
}

/** Elencos base da carreira (players-market + bundle completo do(s) humano(s)). `null` desliga. */
export function setCareerBase(base: ((clubId: string) => Player[]) | null, forScope: SquadScope = 'solo'): void {
  careerBases[forScope] = base;
  if (forScope !== scope) return;
  worldView = null;
  rebuild();
}

/** Elencos base da carreira do escopo ativo (para `expiringContracts`, etc.). */
export function getCareerBase(): ((clubId: string) => Player[]) | null {
  return careerBases[scope];
}

/** Sincroniza a visão efetiva com a temporada atual (do modo ativo). */
export function syncSeason(next: SeasonState | null | undefined, nextWorld?: WorldState | null, nextScope: SquadScope = 'solo'): void {
  const prev = season;
  const prevWorld = world;
  const prevScope = scope;
  season = next ?? null;
  world = nextWorld ?? null;
  scope = nextScope;
  if (prevScope !== scope) worldView = null;
  if (season?.career) {
    // carreira: a SeasonState muda a cada operação (cópia do worker) → refaz (barato: memoização preguiçosa por clube)
    if (prev !== season || prevWorld !== world || prevScope !== scope) rebuild();
    return;
  }
  if (prev?.market !== season?.market || !!prev?.career || prevScope !== scope) rebuild();
}

/** Elenco efetivo do clube (vazio se ainda não carregado). */
export function squadOf(id: string): Player[] {
  return view ? view(id) : baseSquadOf(id);
}

/** Função `squads` no formato esperado pela engine (efetiva). */
export const squads = (clubId: string): Player[] => squadOf(clubId);

/**
 * Carrega (com concorrência limitada) os bundles que faltam no cache.
 * `onProgress(done, total)` permite mostrar progresso na UI.
 */
export async function ensureBundles(ids: string[], onProgress?: (done: number, total: number) => void, concurrency = 12): Promise<void> {
  const missing = Array.from(new Set(ids)).filter((id) => !bundles.has(id));
  let done = 0;
  const total = missing.length;
  onProgress?.(0, total);
  let cursor = 0;
  const worker = async () => {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      try {
        const { data } = await loadClub(id);
        bundles.set(id, data);
      } catch (e) {
        // Clube sem bundle: a temporada segue com elenco vazio para ele (a engine trata).
        if (import.meta.env.DEV) console.warn(`[squads] sem elenco para ${id}`, e);
      }
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, worker));
  // novos bundles mudam o elenco base: a visão efetiva memorizada precisa ser refeita
  // (na carreira o base não usa este cache, mas refazer é inofensivo)
  if (total) rebuild();
}

export function bundleCount(): number {
  return bundles.size;
}
