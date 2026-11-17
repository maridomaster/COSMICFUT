/** Durable Object de mentira para os testes do relay (armazenamento em memória, sockets que gravam o que recebem). */
import { RoomRelay, type Attachment, type RelayEnv, type RelaySocket, type RelayStorage } from '../src/relay.ts';

export class MemStorage implements RelayStorage {
  kv = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
  get(k: string) {
    return this.kv.get(k) ?? null;
  }
  put(k: string, v: string) {
    this.kv.set(k, v);
  }
  del(k: string) {
    this.kv.delete(k);
  }
  keys(prefix: string) {
    return [...this.kv.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  getBlob(k: string) {
    return this.blobs.get(k) ?? null;
  }
  putBlob(k: string, v: Uint8Array) {
    this.blobs.set(k, v);
  }
  delBlobs(prefix: string) {
    for (const k of [...this.blobs.keys()]) if (k.startsWith(prefix)) this.blobs.delete(k);
  }
  transaction(fn: () => void) {
    fn();
  }
  deleteAll() {
    this.kv.clear();
    this.blobs.clear();
  }
}

export class FakeSocket implements RelaySocket {
  private a: Attachment = { c: '', p: null, hello: null, at: 0 };
  sent: (string | Uint8Array)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  readonly env: FakeEnv;
  constructor(env: FakeEnv) {
    this.env = env;
  }
  get att() {
    return this.a;
  }
  setAtt(a: Attachment) {
    this.a = { ...a };
  }
  send(d: string | Uint8Array) {
    if (this.closed) throw new Error('fechado');
    this.sent.push(typeof d === 'string' ? d : d.slice());
  }
  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = { code, reason };
    this.env.list = this.env.list.filter((s) => s !== this);
    this.env.relay.onClose(this);
  }
  /** mensagens de texto recebidas (JSON) */
  json<T = Record<string, unknown>>(): T[] {
    return this.sent.filter((x): x is string => typeof x === 'string').map((x) => JSON.parse(x) as T);
  }
  bins(): Uint8Array[] {
    return this.sent.filter((x): x is Uint8Array => typeof x !== 'string');
  }
  last<T = Record<string, unknown>>(t: string): T | undefined {
    return this.json<{ t: string } & T>().filter((m) => m.t === t).pop();
  }
  clear() {
    this.sent = [];
  }
  async msg(m: unknown) {
    await this.env.relay.onMessage(this, JSON.stringify(m));
  }
  async bin(b: Uint8Array) {
    await this.env.relay.onMessage(this, b);
  }
  /** cliente fecha a conexão (o DO recebe webSocketClose) */
  drop() {
    if (this.closed) return;
    this.closed = { code: 1001, reason: 'client' };
    this.env.list = this.env.list.filter((s) => s !== this);
    this.env.relay.onClose(this);
  }
}

export class FakeEnv implements RelayEnv {
  storage = new MemStorage();
  list: FakeSocket[] = [];
  alarm: number | null = null;
  clock = 1_700_000_000_000;
  published: { code: string; info: unknown }[] = [];
  relay!: RoomRelay;
  logs: string[] = [];

  sockets() {
    return this.list.slice();
  }
  setAlarm(at: number | null) {
    this.alarm = at;
  }
  now() {
    return this.clock;
  }
  random(n: number) {
    return crypto.getRandomValues(new Uint8Array(n));
  }
  async sha256(s: string) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  publish(code: string, info: unknown) {
    this.published.push({ code, info });
  }
  log(msg: string) {
    this.logs.push(msg);
  }
  open(): FakeSocket {
    const s = new FakeSocket(this);
    this.list.push(s);
    this.relay.onOpen(s);
    return s;
  }
  /** avança o relógio e dispara o alarme se venceu */
  async tick(ms: number) {
    this.clock += ms;
    if (this.alarm !== null && this.alarm <= this.clock) {
      this.alarm = null;
      await this.relay.onAlarm();
    }
  }
}

export function makeRoom(code = 'ABCDEF'): FakeEnv {
  const env = new FakeEnv();
  env.relay = new RoomRelay(code, env);
  return env;
}
