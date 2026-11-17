import { gunzipSync } from 'node:zlib';
import { io as connect, type Socket } from 'socket.io-client';
import type { SeasonState, WorldState } from '@cosmicfut/engine';
import type { RoomSummary, SeasonEndPayload, SeasonSnapshotPayload } from '@cosmicfut/shared';
import { createServer, type CosmicServer } from '../src/server.ts';
import type { ServerOptions } from '../src/config.ts';
import type { Ack, ClientEvents, ServerEvents } from '../src/protocol.ts';

export type Client = Socket<ServerEvents, ClientEvents>;

/** Servidor de teste: seed fixa, comandos de dev ligados, 1 worker de simulação (o caminho real). */
export async function startServer(over: Partial<ServerOptions> = {}): Promise<{ srv: CosmicServer; url: string }> {
  // sem pré-jogo nos testes (o match:start sai na hora), salvo quando o teste pede
  // (17/11) os testes antigos usam o fluxo "pronto" (simultâneo) sem a contagem 3-2-1; os novos pedem o modo turnos
  const srv = createServer({
    logger: false, persistDir: null, publicUrlFile: null, seedFor: () => 'test-seed', devCommands: true, simWorkers: 1, preMatchMs: 0,
    countdownMs: 0, roomDefaults: { turnMode: 'simultaneous' }, ...over,
  });
  const port = await srv.listen(0, '127.0.0.1');
  return { srv, url: `http://127.0.0.1:${port}` };
}

export async function client(url: string): Promise<Client> {
  const s: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise<void>((res, rej) => {
    s.once('connect', () => res());
    s.once('connect_error', rej);
  });
  return s;
}

/** Emite com ack e devolve a resposta. */
export function call<T = unknown>(s: Client, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout no ack de ${event}`)), 60_000);
    (s.emit as (ev: string, ...a: unknown[]) => void)(event, ...args, (r: Ack<T>) => {
      clearTimeout(t);
      res(r);
    });
  });
}

export async function ok<T = unknown>(s: Client, event: string, ...args: unknown[]): Promise<T> {
  const r = await call<T>(s, event, ...args);
  if (!r.ok) throw new Error(`${event} falhou: ${r.error}`);
  return r.data;
}

/** Espera o próximo evento que satisfaça `pred`. */
export function waitFor<T = unknown>(s: Client, event: string, pred: (x: T) => boolean = () => true, timeoutMs = 30_000): Promise<T> {
  return new Promise((res, rej) => {
    const on = (x: T) => {
      if (!pred(x)) return;
      clearTimeout(t);
      (s.off as (ev: string, fn: unknown) => void)(event, on);
      res(x);
    };
    const t = setTimeout(() => {
      (s.off as (ev: string, fn: unknown) => void)(event, on);
      rej(new Error(`timeout esperando ${event}`));
    }, timeoutMs);
    (s.on as (ev: string, fn: unknown) => void)(event, on);
  });
}

/** Acumula todos os eventos `event` recebidos. */
export function collect<T = unknown>(s: Client, event: string): T[] {
  const out: T[] = [];
  (s.on as (ev: string, fn: unknown) => void)(event, (x: T) => out.push(x));
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── carreira: snapshots gzip ───────── */

export const gunzip = <T>(b: ArrayBuffer | Uint8Array): T =>
  JSON.parse(gunzipSync(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('utf8')) as T;

export interface DecodedSnap {
  raw: SeasonSnapshotPayload;
  version: number;
  worldVersion: number;
  state: SeasonState;
  world: WorldState | null;
}

export function decodeSnap(p: SeasonSnapshotPayload): DecodedSnap {
  return {
    raw: p,
    version: p.version,
    worldVersion: p.worldVersion ?? 0,
    state: gunzip<SeasonState>(p.stateGz!),
    world: p.worldGz ? gunzip<WorldState>(p.worldGz) : null,
  };
}

/**
 * Acompanha um cliente como o web faria: guarda o último room:state, o último snapshot decodificado
 * (e o último WorldState recebido) e o último season:end.
 */
export class Tracker {
  room: RoomSummary | null = null;
  snap: DecodedSnap | null = null;
  world: WorldState | null = null;
  seasonEnd: SeasonEndPayload | null = null;
  snaps: DecodedSnap[] = [];
  readonly s: Client;

  constructor(s: Client) {
    this.s = s;
    s.on('room:state', (r) => (this.room = r));
    s.on('season:snapshot', (p) => {
      const d = decodeSnap(p);
      if (d.world) this.world = d.world;
      if (!this.snap || d.version >= this.snap.version) this.snap = d;
      this.snaps.push(d);
    });
    s.on('season:end', (e) => (this.seasonEnd = e));
  }

  /** Espera (ou devolve na hora) um snapshot que satisfaça `pred`. */
  async waitSnap(pred: (d: DecodedSnap) => boolean, timeoutMs = 60_000): Promise<DecodedSnap> {
    const t0 = Date.now();
    for (;;) {
      const hit = [...this.snaps].reverse().find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout esperando snapshot');
      await sleep(10);
    }
  }

  async waitRoom(pred: (r: RoomSummary) => boolean, timeoutMs = 60_000): Promise<RoomSummary> {
    const t0 = Date.now();
    for (;;) {
      if (this.room && pred(this.room)) return this.room;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando room:state (fase atual ${this.room?.phase})`);
      await sleep(10);
    }
  }

  /** (dev) avança e devolve o snapshot do ponto de parada. */
  async devAdvance(until: string): Promise<DecodedSnap> {
    const prev = this.snap?.version ?? 0;
    const r = await ok<{ date: string; days: number }>(this.s, 'dev:advance', { until });
    return this.waitSnap((d) => d.version > prev && d.state.date === r.date);
  }
}

/** Jogos de hoje (não jogados) envolvendo `clubIds`. */
export function todays(state: SeasonState, clubIds: string[]) {
  return state.competitions.flatMap((c) => c.fixtures).filter((f) => f.date === state.date && !f.result && (clubIds.includes(f.homeId) || clubIds.includes(f.awayId)));
}

export function fixtureById(state: SeasonState, id: string) {
  for (const c of state.competitions) for (const f of c.fixtures) if (f.id === id) return f;
  return undefined;
}
