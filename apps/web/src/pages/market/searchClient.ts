/**
 * Cliente do worker de busca (singleton: os 84 mil jogadores ficam carregados entre visitas à página).
 */
import { create } from 'zustand';
import type { SeasonState, WorldState } from '@cosmicfut/engine';
import { dataUrl } from '@/data/source';
import { useOnlineSeason, useSeason, useSoloSeason } from '@/store/season';
import { buildMarketIndex } from './marketIndex';
import type { Facets, FromWorker, MarketRowOut, SearchQuery, ToWorker } from './searchTypes';

interface SearchStatus {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  facets: Facets | null;
  total: number;
  loadMs: number;
  /** revisão do índice de mercado aplicado (muda a cada Continuar/virada → refaz a consulta) */
  rev: number;
  /** tempos do índice: montagem (thread principal) e aplicação (worker) */
  indexBuildMs: number;
  indexApplyMs: number;
  added: number;
  removed: number;
}

export const useSearchStatus = create<SearchStatus>()(() => ({
  status: 'idle', error: null, facets: null, total: 0, loadMs: 0, rev: 0, indexBuildMs: 0, indexApplyMs: 0, added: 0, removed: 0,
}));

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: FromWorker) => void>();

function post(m: ToWorker) {
  ensureWorker().postMessage(m);
}

export function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  useSearchStatus.setState({ status: 'loading', error: null });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.t === 'ready') useSearchStatus.setState({ status: 'ready', facets: m.facets, total: m.total, loadMs: m.ms });
    else if (m.t === 'indexed') {
      useSearchStatus.setState({ rev: m.rev, total: m.total, indexApplyMs: m.ms, added: m.added, removed: m.removed });
      if (import.meta.env.DEV) console.info(`[mercado] índice aplicado: +${m.added} novos, −${m.removed} aposentados, ${m.ms.toFixed(0)} ms`);
    } else if (m.t === 'error') {
      if (useSearchStatus.getState().status !== 'ready') useSearchStatus.setState({ status: 'error', error: m.message });
      else console.warn('[mercado] worker:', m.message);
    } else {
      const cb = pending.get(m.id);
      if (cb) {
        pending.delete(m.id);
        cb(m);
      }
    }
  };
  worker.onerror = (e) => {
    if (import.meta.env.DEV) console.warn('[mercado] worker:', e.message);
    useSearchStatus.setState({ status: 'error', error: 'a busca de jogadores parou de responder' });
  };
  worker.postMessage({ t: 'init', marketUrl: dataUrl('players-market.json'), clubsUrl: dataUrl('clubs-index.json'), feetUrl: dataUrl('players-feet.json') } satisfies ToWorker);
  return worker;
}

export interface SearchResult {
  rows: MarketRowOut[];
  total: number;
  offset: number;
  ms: number;
  /** ida e volta (main thread → worker → main thread) */
  roundTripMs: number;
}

export function searchMarket(q: SearchQuery, offset: number, limit: number): Promise<SearchResult> {
  const id = ++seq;
  const t0 = performance.now();
  return new Promise((resolve) => {
    pending.set(id, (m) => {
      if (m.t === 'result') resolve({ rows: m.rows, total: m.total, offset: m.offset, ms: m.ms, roundTripMs: performance.now() - t0 });
    });
    post({ t: 'query', id, q, offset, limit });
  });
}

export function fetchRows(ids: string[]): Promise<MarketRowOut[]> {
  if (!ids.length) return Promise.resolve([]);
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, (m) => {
      if (m.t === 'ids') resolve(m.rows);
    });
    post({ t: 'ids', id, ids });
  });
}

/**
 * Envia ao worker o índice de mercado da temporada/mundo atuais (idempotente: só reenvia quando a
 * SeasonState ou o WorldState mudam — cada Continuar, partida, ação de mercado ou virada).
 */
export function syncMarketIndex(state: SeasonState | null | undefined, world: WorldState | null | undefined): void {
  if (!state || (state === lastState && (world ?? null) === lastWorld)) return;
  lastState = state;
  lastWorld = world ?? null;
  const t0 = performance.now();
  const index = buildMarketIndex(state, lastWorld);
  useSearchStatus.setState({ indexBuildMs: performance.now() - t0 });
  post({ t: 'index', index });
}

let lastState: SeasonState | null = null;
let lastWorld: WorldState | null = null;

/**
 * Troca de slot de carreira: esquece o último índice enviado (o próximo `syncMarketIndex` reenvia tudo)
 * e volta o worker de busca para a base pura até a carreira nova carregar. O índice é sempre aplicado
 * do zero sobre a base (search.worker `applyIndex`), então nada da carreira anterior sobra.
 */
export function resetMarketIndex(): void {
  lastState = null;
  lastWorld = null;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (worker) post({ t: 'index', index: { ids: [], vals: new Float64Array(0), info: [], clubs: {}, removed: [], ovr: {} } });
}
let syncTimer: ReturnType<typeof setTimeout> | null = null;

// Depois que o worker existe, acompanha a temporada do modo ativo (Continuar, virada…) em segundo plano.
function scheduleSync() {
  if (!worker || syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const save = useSeason.getState().save;
    syncMarketIndex(save?.season, save?.world ?? null);
  }, 300);
}
useSoloSeason.subscribe(scheduleSync);
useOnlineSeason.subscribe(scheduleSync);
