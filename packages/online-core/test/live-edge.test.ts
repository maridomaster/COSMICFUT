/**
 * Teste contra um relay DE VERDADE (wrangler dev local — workerd/miniflare — ou o deploy na Cloudflare):
 *   EDGE_URL=http://127.0.0.1:8788 npx vitest run test/live-edge.test.ts
 * Sem EDGE_URL, é pulado. Usa WebSocket real; o cliente eleito roda o HostRuntime (como o Web Worker do navegador).
 */
import { describe, expect, it } from 'vitest';
import { GameData } from '../src/data.ts';
import { CareerSimulator } from '../src/sim-core.ts';
import { InlineSimRunner } from '../src/sim-runner.ts';
import { HostRuntime } from '../src/host.ts';
import { decodeBundle, Reassembler, T_BUNDLE, T_CKPT, T_FRAG, type RelayToHost } from '../src/wire.ts';
import { DATA_DIR, fsSource, sleep } from './harness.ts';

const EDGE = process.env.EDGE_URL?.replace(/\/+$/, '');
const source = fsSource(DATA_DIR);

class WsClient {
  ws!: WebSocket;
  name: string;
  room: any = null;
  events: { ev: string; a: any }[] = [];
  host: HostRuntime | null = null;
  hostInfo: any = null;
  playerId = '';
  token = '';
  private k = 0;
  private acks = new Map<number, (r: any) => void>();
  private frag = new Reassembler();
  private welcome: ((m: any) => void) | null = null;
  constructor(name: string) {
    this.name = name;
  }
  async connect(code: string, hello: Record<string, unknown>): Promise<any> {
    this.ws = new WebSocket(`${EDGE!.replace(/^http/, 'ws')}/rooms/${code}/ws`);
    this.ws.binaryType = 'arraybuffer';
    const w = new Promise<any>((res, rej) => (this.welcome = (m) => (m.t === 'welcome' ? res(m) : rej(new Error(m.error)))));
    this.ws.onmessage = (e) => this.onData(e.data);
    await new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws erro'));
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: 1, ...hello }));
    const m = await w;
    this.playerId = m.playerId;
    if (m.token) this.token = m.token;
    return m;
  }
  private onData(d: string | ArrayBuffer): void {
    if (typeof d !== 'string') {
      const b = new Uint8Array(d);
      if (b[0] === T_CKPT) return void this.host?.handle(b);
      const f = b[0] === T_FRAG ? this.frag.push(b) : b;
      if (!f || f[0] !== T_BUNDLE) return;
      for (const m of decodeBundle(f)) {
        if (m.ev === '@ack') this.acks.get((m.a as any).k)?.((m.a as any).r);
        else {
          this.events.push({ ev: m.ev, a: m.a });
          if (m.ev === 'room:state') this.room = m.a;
        }
      }
      return;
    }
    if (d === 'pong') return;
    const m = JSON.parse(d);
    if (m.t === 'welcome' || m.t === 'denied') {
      this.welcome?.(m);
      this.welcome = null;
    } else if (m.t === 'ack') this.acks.get(m.k)?.(m.r);
    else if (m.t === 'ev') this.events.push({ ev: m.ev, a: m.a });
    else if (m.t === 'host') this.hostInfo = m;
    else if (m.t === 'role') {
      this.host?.stop();
      this.host = new HostRuntime({
        data: new GameData(source),
        sim: new InlineSimRunner(new CareerSimulator(source)),
        opts: { seedFor: () => 'live-seed', preMatchMs: 0, countdownMs: 0, halfTimeTimeoutMs: 50, pauseTimeoutMs: 50, planningGraceMs: 300 },
        send: (f) => this.ws.readyState === 1 && this.ws.send(f),
      });
      void this.host.handle(m as RelayToHost);
    } else void this.host?.handle(m as RelayToHost);
  }
  call(ev: string, a?: unknown): Promise<any> {
    const k = ++this.k;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout ${ev}`)), 120_000);
      this.acks.set(k, (r) => {
        clearTimeout(t);
        res(r);
      });
      this.ws.send(JSON.stringify({ t: 'i', ev, ...(a !== undefined ? { a } : {}), k }));
    });
  }
  async ok(ev: string, a?: unknown): Promise<any> {
    const r = await this.call(ev, a);
    if (!r.ok) throw new Error(`${this.name}: ${ev}: ${r.error}`);
    return r.data;
  }
  close(): void {
    this.host?.stop();
    this.host = null;
    this.ws.close();
  }
  async waitRoom(pred: (r: any) => boolean, ms = 90_000): Promise<any> {
    const t0 = Date.now();
    while (!(this.room && pred(this.room))) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timeout room:state (${this.room?.phase} ${this.room?.date})`);
      await sleep(20);
    }
    return this.room;
  }
}

describe.runIf(!!EDGE)('relay real (EDGE_URL)', () => {
  it('cria, entra, joga rodadas, anfitrião cai e outro assume; volta pela lista de carreiras', async () => {
    const health = await (await fetch(`${EDGE}/health`)).json();
    expect(health.ok).toBe(true);
    const created = await (await fetch(`${EDGE}/rooms`, { method: 'POST', body: '{}' })).json();
    const code = created.data.code as string;
    const a = new WsClient('Ana');
    const b = new WsClient('Bia');
    await a.connect(code, { mode: 'create', nickname: 'Ana', settings: { turnMode: 'simultaneous', matchMode: 'quick' } });
    expect(a.host).not.toBeNull();
    await b.connect(code, { mode: 'join', nickname: 'Bia' });
    const prev = await (await fetch(`${EDGE}/rooms/${code}`)).json();
    expect(prev.data.players.length).toBeGreaterThanOrEqual(1);
    await a.ok('room:pick-club', { clubId: 'palmeiras' });
    await b.ok('room:pick-club', { clubId: 'santos' });
    await a.ok('room:start');
    await b.waitRoom((r) => r.phase === 'planning' && !!r.date);
    for (let i = 0; i < 200 && !b.events.some((e) => e.ev === 'season:snapshot'); i++) await sleep(50);
    expect(b.events.some((e) => e.ev === 'season:snapshot')).toBe(true);
    for (let i = 0; i < 2; i++) {
      const d = b.room.date;
      await a.ok('round:ready', { ready: true });
      await b.ok('round:ready', { ready: true });
      await b.waitRoom((r) => r.phase === 'planning' && r.date !== d);
    }
    const date = b.room.date;
    await sleep(2500); // checkpoint do planejamento (debounce)
    // anfitrião fecha a aba: Bia assume
    a.close();
    for (let i = 0; i < 200 && !b.host; i++) await sleep(50);
    expect(b.host).not.toBeNull();
    await b.waitRoom((r) => r.date === date && r.phase === 'planning');
    // Ana volta com o token: entra como cliente comum
    const a2 = new WsClient('Ana2');
    await a2.connect(code, { mode: 'rejoin', token: a.token });
    await a2.waitRoom((r) => r.date === date);
    const st = await (await fetch(`${EDGE}/careers/status`, { method: 'POST', body: JSON.stringify({ items: [{ code, token: a.token }] }) })).json();
    expect(st.data[0]).toMatchObject({ code, found: true, phase: 'planning', date });
    expect(JSON.stringify(st).includes(a.token)).toBe(false);
    // a rodada continua com o novo anfitrião
    await a2.ok('round:ready', { ready: true });
    await b.ok('round:ready', { ready: true });
    await b.waitRoom((r) => r.phase === 'planning' && r.date !== date);
    // encerra (dono = Ana)
    await a2.ok('room:end', { confirm: code });
    b.close();
    a2.close();
    const gone = await (await fetch(`${EDGE}/rooms/${code}`)).json();
    expect(gone.ok).toBe(false);
  }, 300_000);
});
