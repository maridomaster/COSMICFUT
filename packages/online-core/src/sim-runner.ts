/**
 * Executor das operações de carreira de uma sala (interface comum).
 *  - Node: `WorkerSimPool` (worker_threads, apps/server/src/sim-pool.ts) ou `InlineSimRunner`.
 *  - Navegador (anfitrião da simulação): `InlineSimRunner` dentro do Web Worker do anfitrião.
 */
import { defer } from './platform.ts';
import { CareerSimulator, type DayPlayed, type PackedSnapshot, type SimRequest, type SimResponse } from './sim-core.ts';

export interface SimCallEvents {
  day?(d: DayPlayed): void;
  snapshot?(s: PackedSnapshot): void;
}

export interface SimRunner {
  readonly mode: 'inline' | 'worker';
  readonly size: number;
  call<T extends SimResponse = SimResponse>(room: string, req: SimRequest, ev?: SimCallEvents): Promise<T>;
  /** sala encerrada: libera o estado no worker */
  release(room: string): void;
  onLost(fn: (room: string) => void): void;
  close(): Promise<void>;
}

export class SimCrashError extends Error {}
export class SimOpError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** O mesmo CareerSimulator no thread atual. Mesma API assíncrona e mesmos resultados (a engine é determinística). */
export class InlineSimRunner implements SimRunner {
  readonly mode = 'inline' as const;
  readonly size = 0;
  readonly sim: CareerSimulator;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(sim: CareerSimulator) {
    this.sim = sim;
  }

  call<T extends SimResponse = SimResponse>(_room: string, req: SimRequest, ev: SimCallEvents = {}): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        defer(() => {
          try {
            const res = this.sim.run(req, { day: ev.day }) as T;
            resolve(res);
            if (CareerSimulator.snapshotAfter(req, res)) {
              const snap = this.sim.pack(req.room, req.op === 'hydrate');
              defer(() => ev.snapshot?.(snap));
            }
          } catch (e) {
            reject(new SimOpError(e instanceof Error ? e.message : String(e), 'error'));
          }
        });
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  release(room: string): void {
    this.sim.run({ op: 'drop', room });
  }

  onLost(): void {
    // inline: nunca perde estado
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}
