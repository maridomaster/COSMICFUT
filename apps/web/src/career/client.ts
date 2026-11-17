/**
 * Cliente (thread principal) do worker da carreira: RPC com promessas + progresso do Continuar.
 * Singleton: o worker vive enquanto a aba estiver aberta (o estado da carreira fica carregado nele).
 */
import type { FromWorker, ToWorker } from './protocol';

type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void; onProgress?: (m: Extract<FromWorker, { t: 'progress' }>) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
export type SaveEvent = Extract<FromWorker, { t: 'saved' } | { t: 'saveError' }>;
const saveListeners = new Set<(m: SaveEvent) => void>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./career.worker.ts', import.meta.url), { type: 'module', name: 'cosmicfut-carreira' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.t === 'saved' || m.t === 'saveError') {
      for (const fn of saveListeners) fn(m);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    if (m.t === 'progress') {
      p.onProgress?.(m);
      return;
    }
    pending.delete(m.id);
    if (m.t === 'error') p.reject(new Error(m.message));
    else p.resolve(m);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'falha no worker da carreira');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

type Req = ToWorker extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export function careerCall<R extends FromWorker['t']>(
  msg: Req,
  onProgress?: Pending['onProgress'],
): Promise<Extract<FromWorker, { t: R }>> {
  const id = ++seq;
  const w = ensure();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (m: FromWorker) => void, reject, onProgress });
    w.postMessage({ ...msg, id } as ToWorker);
  });
}

/** Eventos de gravação do worker (autosave, "Salvar agora", erro de quota). Devolve a função de remoção. */
export function onCareerSaved(fn: (m: SaveEvent) => void): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}
