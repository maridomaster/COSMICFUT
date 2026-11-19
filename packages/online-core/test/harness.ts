/**
 * Harness em processo do modo online grátis: o RELAY de verdade (apps/edge/src/relay.ts, com armazenamento em
 * memória no lugar do SQLite do Durable Object) + clientes que falam o protocolo de fio, e o anfitrião eleito roda
 * o `HostRuntime` (a mesma sala autoritativa do servidor) — exatamente o fluxo do navegador, sem rede.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { RoomRelay, type Attachment, type RelayEnv, type RelaySocket, type RelayStorage } from '../../../apps/edge/src/relay.ts';
import { setCodec } from '../src/platform.ts';
import type { CareerSource } from '../src/career-data.ts';
import { GameData } from '../src/data.ts';
import { CareerSimulator } from '../src/sim-core.ts';
import { InlineSimRunner } from '../src/sim-runner.ts';
import { HostRuntime } from '../src/host.ts';
import { decodeBundle, Reassembler, T_BUNDLE, T_CKPT, T_FRAG, type ClientHello, type RelayToHost } from '../src/wire.ts';
import type { RoomOptions } from '../src/options.ts';

setCodec({
  gzip: (d, level = 6) => new Uint8Array(gzipSync(d, { level })),
  gunzip: (d) => new Uint8Array(gunzipSync(d)),
});

export const DATA_DIR = fileURLToPath(new URL('../../../apps/web/public/data/', import.meta.url));

export function fsSource(dir: string): CareerSource {
  const cache = new Map<string, unknown>();
  return {
    readJson<T>(rel: string): T | null {
      if (cache.has(rel)) return cache.get(rel) as T;
      const f = resolve(dir, rel);
      if (!existsSync(f)) return null;
      const v = JSON.parse(readFileSync(f, 'utf8')) as T;
      if (!rel.startsWith('clubs/')) cache.set(rel, v);
      return v;
    },
  };
}

const sharedSource = fsSource(DATA_DIR);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MemStorage implements RelayStorage {
  kv = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
  /** linhas gravadas como o SQLite do DO cobra: chave nova 2, atualização 1, remoção 2 */
  rowsWritten = 0;
  get = (k: string) => this.kv.get(k) ?? null;
  put = (k: string, v: string) => {
    this.rowsWritten += this.kv.has(k) ? 1 : 2;
    this.kv.set(k, v);
  };
  del = (k: string) => {
    if (this.kv.delete(k)) this.rowsWritten += 2;
  };
  keys = (p: string) => [...this.kv.keys()].filter((k) => k.startsWith(p)).sort();
  getBlob = (k: string) => this.blobs.get(k) ?? null;
  putBlob = (k: string, v: Uint8Array) => {
    this.rowsWritten += this.blobs.has(k) ? 1 : 2;
    this.blobs.set(k, v.slice());
  };
  delBlob = (k: string) => {
    if (this.blobs.delete(k)) this.rowsWritten += 2;
  };
  delBlobs = (p: string) => {
    for (const k of [...this.blobs.keys()]) if (k.startsWith(p)) this.delBlob(k);
  };
  transaction = (fn: () => void) => fn();
  deleteAll = () => {
    this.rowsWritten += 2 * (this.kv.size + this.blobs.size);
    this.kv.clear();
    this.blobs.clear();
  };
  clone(): MemStorage {
    const s = new MemStorage();
    s.kv = new Map(this.kv);
    s.blobs = new Map([...this.blobs].map(([k, v]) => [k, v.slice()]));
    return s;
  }
}

/** "Durable Object" em memória: um relay por sala, alarme por timer real. */
export class EdgeSim implements RelayEnv {
  readonly storage: MemStorage;
  readonly relay: RoomRelay;
  socks: Sock[] = [];
  private alarmTimer: ReturnType<typeof setTimeout> | null = null;
  published: unknown[] = [];

  constructor(code: string, storage = new MemStorage()) {
    this.storage = storage;
    this.relay = new RoomRelay(code, this);
  }

  sockets(): RelaySocket[] {
    return this.socks.filter((s) => !s.closed);
  }
  setAlarm(at: number | null): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    this.alarmTimer = at === null ? null : setTimeout(() => void this.relay.onAlarm(), Math.max(0, at - Date.now()));
  }
  now(): number {
    return Date.now();
  }
  random(n: number): Uint8Array {
    return webcrypto.getRandomValues(new Uint8Array(n));
  }
  async sha256(s: string): Promise<string> {
    const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  publish(_code: string, info: unknown): void {
    this.published.push(info);
  }
  stop(): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    for (const s of this.socks) s.client.stopHost();
  }
}

/** Lado servidor do WebSocket (o que o relay vê). As mensagens chegam ao cliente de forma assíncrona. */
class Sock implements RelaySocket {
  att: Attachment = { c: '', p: null, hello: null, at: 0 };
  closed = false;
  readonly client: EdgeClient;
  constructor(client: EdgeClient) {
    this.client = client;
  }
  setAtt(a: Attachment): void {
    this.att = { ...a };
  }
  send(d: string | Uint8Array): void {
    if (this.closed) throw new Error('fechado');
    const copy = typeof d === 'string' ? d : d.slice();
    setImmediate(() => this.client.receive(copy));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.onServerClose();
  }
}

type Handler = (a: any) => void;

export interface HostOpts {
  opts?: Partial<RoomOptions>;
  flushMs?: number;
  liveFlushMs?: number;
  ckptDelayMs?: number;
  ckptFastMs?: number;
}

/** Cliente do protocolo de fio (o que o EdgeSocket do web faz), com o anfitrião embutido quando eleito. */
export class EdgeClient {
  readonly name: string;
  private edge: EdgeSim | null = null;
  private sock: Sock | null = null;
  private k = 0;
  private acks = new Map<number, (r: any) => void>();
  private handlers = new Map<string, Set<Handler>>();
  private frag = new Reassembler();
  private welcome: ((w: any) => void) | null = null;
  host: HostRuntime | null = null;
  hostInfo: { playerId: string | null; me: boolean; state: string; epoch: number } | null = null;
  token = '';
  playerId = '';
  room: any = null;
  events: { ev: string; a: any }[] = [];
  /** quantas mensagens este cliente mandou ao relay (orçamento de requisições) */
  sentMsgs = 0;
  private hostCfg: HostOpts;
  private chain: Promise<void> = Promise.resolve();

  constructor(name: string, hostCfg: HostOpts = {}) {
    this.name = name;
    this.hostCfg = hostCfg;
    this.on('room:state', (r) => (this.room = r));
  }

  on(ev: string, fn: Handler): void {
    let s = this.handlers.get(ev);
    if (!s) this.handlers.set(ev, (s = new Set()));
    s.add(fn);
  }

  private emitLocal(ev: string, a: unknown): void {
    this.events.push({ ev, a });
    for (const fn of this.handlers.get(ev) ?? []) fn(a);
  }

  /** Abre o WebSocket da sala e manda o hello; resolve com o welcome (ou lança com o denied). */
  async connect(edge: EdgeSim, hello: Omit<ClientHello, 't' | 'v'>): Promise<any> {
    this.edge = edge;
    const s = new Sock(this);
    this.sock = s;
    edge.socks.push(s);
    edge.relay.onOpen(s);
    const w = new Promise<any>((res, rej) => {
      this.welcome = (m) => (m.t === 'welcome' ? res(m) : rej(new Error(m.error)));
    });
    this.sendText({ t: 'hello', v: 1, ...hello });
    const m = await w;
    this.playerId = m.playerId;
    if (m.token) this.token = m.token;
    return m;
  }

  private sendText(m: unknown): void {
    if (!this.sock || this.sock.closed || !this.edge) return;
    this.sentMsgs++;
    const txt = JSON.stringify(m);
    const sock = this.sock;
    const edge = this.edge;
    setImmediate(() => void edge.relay.onMessage(sock, txt));
  }

  call<T = any>(ev: string, a?: unknown, timeoutMs = 120_000): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const k = ++this.k;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout no ack de ${ev}`)), timeoutMs);
      this.acks.set(k, (r) => {
        clearTimeout(t);
        res(r);
      });
      this.sendText({ t: 'i', ev, ...(a !== undefined ? { a } : {}), k });
    });
  }

  async ok<T = any>(ev: string, a?: unknown, timeoutMs?: number): Promise<T> {
    const r = await this.call<T>(ev, a, timeoutMs);
    if (!r.ok) throw new Error(`${this.name}: ${ev} falhou: ${r.error}`);
    return r.data;
  }

  receive(d: string | Uint8Array): void {
    // ordem preservada (o anfitrião processa em fila)
    this.chain = this.chain.then(() => this.dispatch(d)).catch((e) => console.error(`[${this.name}]`, e));
  }

  private async dispatch(d: string | Uint8Array): Promise<void> {
    if (process.env.DEBUG_EDGE) console.log(`[${this.name}] <- ${typeof d === 'string' ? d.slice(0, 80) : `bin ${d[0]} ${d.byteLength}`}`);
    if (typeof d !== 'string') {
      if (d[0] === T_CKPT) {
        await this.host?.handle(d);
        return;
      }
      let frame: Uint8Array | null = d;
      if (d[0] === T_FRAG) frame = this.frag.push(d);
      if (!frame || frame[0] !== T_BUNDLE) return;
      const msgs = decodeBundle(frame);
      if (process.env.DEBUG_EDGE) console.log(`[${this.name}] evs ${msgs.map((x) => x.ev).join(',')}`);
      for (const m of msgs) {
        if (m.ev === '@ack') this.acks.get((m.a as { k: number }).k)?.((m.a as { r: unknown }).r);
        else this.emitLocal(m.ev, m.a);
      }
      return;
    }
    const m = JSON.parse(d) as Record<string, any>;
    switch (m.t) {
      case 'welcome':
      case 'denied':
        this.welcome?.(m);
        this.welcome = null;
        return;
      case 'ack':
        this.acks.get(m.k)?.(m.r);
        return;
      case 'ev':
        this.emitLocal(m.ev, m.a);
        return;
      case 'host':
        this.hostInfo = { playerId: m.playerId, me: m.me, state: m.state, epoch: m.epoch };
        this.emitLocal('edge:host', m);
        return;
      case 'role':
        this.startHost();
        void this.host!.handle(m as RelayToHost);
        return;
      default:
        // mensagens para o anfitrião (i, join, attach, detach, claim, ended, demoted)
        void this.host?.handle(m as RelayToHost);
    }
  }

  private startHost(): void {
    this.host?.stop();
    const sock = this.sock!;
    const edge = this.edge!;
    this.host = new HostRuntime({
      data: new GameData(sharedSource),
      sim: new InlineSimRunner(new CareerSimulator(sharedSource)),
      opts: this.hostCfg.opts,
      flushMs: this.hostCfg.flushMs ?? 5,
      liveFlushMs: this.hostCfg.liveFlushMs ?? 200,
      ckptDelayMs: this.hostCfg.ckptDelayMs ?? 100,
      ckptFastMs: this.hostCfg.ckptFastMs,
      send: (frame) => {
        if (process.env.DEBUG_EDGE) console.log(`[${this.name}] host -> ${frame.byteLength}`);
        if (sock.closed) return;
        this.sentMsgs++;
        const copy = frame.slice();
        setImmediate(() => void edge.relay.onMessage(sock, copy));
      },
      log: () => undefined,
    });
  }

  stopHost(): void {
    this.host?.stop();
    this.host = null;
  }

  /** O relay derrubou a conexão. */
  onServerClose(): void {
    this.stopHost();
  }

  /** Fecha a aba (o relay recebe webSocketClose). */
  drop(): void {
    this.stopHost();
    const s = this.sock;
    if (!s || s.closed || !this.edge) return;
    s.closed = true;
    this.edge.relay.onClose(s);
  }

  async waitRoom(pred: (r: any) => boolean, timeoutMs = 60_000): Promise<any> {
    const t0 = Date.now();
    for (;;) {
      if (this.room && pred(this.room)) return this.room;
      if (Date.now() - t0 > timeoutMs) throw new Error(`${this.name}: timeout esperando room:state (fase ${this.room?.phase}, data ${this.room?.date})`);
      await sleep(10);
    }
  }

  async waitEvent(ev: string, pred: (a: any) => boolean = () => true, timeoutMs = 60_000, from = 0): Promise<any> {
    const t0 = Date.now();
    for (;;) {
      const hit = this.events.slice(from).find((e) => e.ev === ev && pred(e.a));
      if (hit) return hit.a;
      if (Date.now() - t0 > timeoutMs) throw new Error(`${this.name}: timeout esperando ${ev}`);
      await sleep(10);
    }
  }
}

export { sleep };
