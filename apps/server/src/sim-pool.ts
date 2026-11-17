/**
 * Executor das operações de carreira das salas.
 *
 *  - `WorkerSimPool` (padrão): N worker_threads (SIM_WORKERS, padrão min(4, núcleos − 1)). Cada sala é presa a um
 *    worker (o de menos salas na hora da criação/restauração), que guarda o world/state dela. O event loop
 *    principal nunca roda advanceDay (~15–160 ms por dia) nem serializa a carreira (~90 ms de structuredClone).
 *  - `InlineSimRunner` (SIM_WORKERS=0): o mesmo CareerSimulator no thread principal (depuração/ambientes sem
 *    worker_threads). Mesma API assíncrona e mesmos resultados (a engine é determinística).
 *
 * Se um worker morrer, as chamadas pendentes falham com `SimCrashError`, o worker é recriado e as salas presas
 * a ele recebem `onLost(room)` — a sala se reidrata com o último snapshot (gzip) que tem em memória.
 */
import { Worker } from 'node:worker_threads';
import { InlineSimRunner as CoreInlineSimRunner, SimCrashError, SimOpError, type SimCallEvents, type SimRunner } from '@cosmicfut/online-core/sim-runner';
import { CareerSimulator, type DayPlayed, type PackedSnapshot, type SimRequest, type SimResponse } from './sim-core.ts';

export { SimCrashError, SimOpError, type SimCallEvents, type SimRunner };

/* ───────────────────────── inline ───────────────────────── */

/** O simulador no thread principal (SIM_WORKERS=0), lendo a pasta de dados. */
export class InlineSimRunner extends CoreInlineSimRunner {
  constructor(dataDir: string) {
    super(new CareerSimulator(dataDir));
  }
}
/* ───────────────────────── pool de workers ───────────────────────── */

interface Pending {
  resolve(r: SimResponse): void;
  reject(e: Error): void;
  ev: SimCallEvents;
  /** espera o snapshot que vem depois do resultado */
  wantsSnapshot: boolean;
}

interface Slot {
  index: number;
  worker: Worker;
  rooms: Set<string>;
  pending: Map<number, Pending>;
  alive: boolean;
}

export class WorkerSimPool implements SimRunner {
  readonly mode = 'worker' as const;
  readonly size: number;
  private readonly dataDir: string;
  private readonly slots: Slot[] = [];
  private readonly roomSlot = new Map<string, Slot>();
  private seq = 0;
  private closed = false;
  private lost: ((room: string) => void) | null = null;
  private readonly log: (msg: string, extra?: Record<string, unknown>) => void;

  constructor(dataDir: string, size: number, log: (msg: string, extra?: Record<string, unknown>) => void = () => undefined) {
    this.dataDir = dataDir;
    this.size = Math.max(1, size);
    this.log = log;
    for (let i = 0; i < this.size; i++) this.slots.push(this.spawn(i));
  }

  private spawn(index: number): Slot {
    const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { workerData: { dataDir: this.dataDir }, name: `cosmicfut-sim-${index}` });
    const slot: Slot = { index, worker, rooms: this.slots[index]?.rooms ?? new Set(), pending: new Map(), alive: true };
    worker.on('message', (m: { t: string; id: number; [k: string]: unknown }) => this.onMessage(slot, m));
    worker.on('error', (e: unknown) => this.onCrash(slot, e instanceof Error ? e : new Error(String(e))));
    worker.on('exit', (code) => {
      if (!this.closed && slot.alive) this.onCrash(slot, new Error(`worker saiu (código ${code})`));
    });
    return slot;
  }

  private onMessage(slot: Slot, m: { t: string; id: number; [k: string]: unknown }): void {
    if (m.t === 'ready') return;
    const p = slot.pending.get(m.id);
    if (!p) return;
    switch (m.t) {
      case 'day':
        p.ev.day?.(m.day as DayPlayed);
        return;
      case 'result':
        if (!p.wantsSnapshot) slot.pending.delete(m.id);
        p.resolve(m.res as SimResponse);
        return;
      case 'snapshot':
        slot.pending.delete(m.id);
        if (m.snap) p.ev.snapshot?.(m.snap as PackedSnapshot);
        return;
      case 'error':
        slot.pending.delete(m.id);
        p.reject(new SimOpError(String(m.message), String(m.code)));
        return;
    }
  }

  private onCrash(slot: Slot, err: Error): void {
    if (!slot.alive) return;
    slot.alive = false;
    this.log('sim worker crashed', { index: slot.index, error: String(err) });
    for (const p of slot.pending.values()) p.reject(new SimCrashError(`simulador reiniciado: ${err.message}`));
    slot.pending.clear();
    void slot.worker.terminate().catch(() => undefined);
    if (this.closed) return;
    const fresh = this.spawn(slot.index);
    this.slots[slot.index] = fresh;
    for (const room of fresh.rooms) {
      this.roomSlot.set(room, fresh);
      this.lost?.(room);
    }
  }

  private slotFor(room: string): Slot {
    let s = this.roomSlot.get(room);
    if (s && this.slots[s.index] === s) return s;
    s = this.slots.slice().sort((a, b) => a.rooms.size - b.rooms.size || a.index - b.index)[0];
    s.rooms.add(room);
    this.roomSlot.set(room, s);
    return s;
  }

  call<T extends SimResponse = SimResponse>(room: string, req: SimRequest, ev: SimCallEvents = {}): Promise<T> {
    if (this.closed) return Promise.reject(new SimCrashError('simulador encerrado'));
    const slot = this.slotFor(room);
    const id = ++this.seq;
    const wantsSnapshot = CareerSimulator.mayPack(req);
    return new Promise<T>((resolve, reject) => {
      slot.pending.set(id, { resolve: resolve as (r: SimResponse) => void, reject, ev, wantsSnapshot });
      slot.worker.postMessage({ id, req });
    });
  }

  release(room: string): void {
    const s = this.roomSlot.get(room);
    if (!s) return;
    this.roomSlot.delete(room);
    s.rooms.delete(room);
    if (s.alive) s.worker.postMessage({ id: ++this.seq, req: { op: 'drop', room } });
  }

  onLost(fn: (room: string) => void): void {
    this.lost = fn;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      this.slots.map(async (s) => {
        s.alive = false;
        for (const p of s.pending.values()) p.reject(new SimCrashError('simulador encerrado'));
        s.pending.clear();
        await s.worker.terminate().catch(() => undefined);
      }),
    );
  }
}

export function createSimRunner(dataDir: string, workers: number, log?: (msg: string, extra?: Record<string, unknown>) => void): SimRunner {
  if (workers <= 0) return new InlineSimRunner(dataDir);
  try {
    return new WorkerSimPool(dataDir, workers, log);
  } catch (e) {
    log?.('worker_threads indisponível; simulação inline', { error: String(e) });
    return new InlineSimRunner(dataDir);
  }
}
