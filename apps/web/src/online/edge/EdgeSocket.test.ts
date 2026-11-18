/**
 * EdgeSocket (transporte do online grátis) com WebSocket e fetch falsos: o bug "Maximum call stack size exceeded"
 * ao criar sala (ack pendente do room:leave reentrando em closeWs), conexões recusadas/instáveis e hello sem resposta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Ack = { ok: boolean; data?: any; error?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWS[] = [];
  /** como o "servidor" responde a cada conexão */
  static behavior: (ws: FakeWS) => void = (ws) => ws.autoWelcome();
  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
    FakeWS.behavior(this);
  }
  send(d: string): void {
    this.sent.push(d);
    this.onSend?.(d);
  }
  onSend: ((d: string) => void) | null = null;
  close(code = 1000): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code }), 0);
  }
  /** fecha "pelo servidor" */
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  msg(m: unknown): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  open(): void {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  /** abre e responde o hello com welcome; intenções ficam sem resposta (como o room:leave hoje) */
  autoWelcome(): void {
    this.open();
    this.onSend = (d) => {
      const m = JSON.parse(d);
      if (m.t === 'hello') setTimeout(() => this.msg({ t: 'welcome', code: 'X', playerId: 'p1', token: 'tok-0123456789abcdef', data: {} }), 0);
    };
  }
}

const ack = (sock: { emit: (ev: string, ...a: unknown[]) => unknown }, ev: string, p?: unknown) =>
  new Promise<Ack>((resolve) => (p === undefined ? sock.emit(ev, resolve) : sock.emit(ev, p, resolve)));

let codeN = 0;
beforeEach(() => {
  FakeWS.all = [];
  FakeWS.behavior = (ws) => ws.autoWelcome();
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ ok: true, data: { code: `ROOM${String(++codeN).padStart(2, '0')}` } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function newSocket() {
  const { EdgeSocket } = await import('./EdgeSocket');
  const s = new EdgeSocket();
  s.connect();
  return s;
}

describe('EdgeSocket', () => {
  it('sair da sala e criar outra não estoura a pilha (ack do room:leave pendente)', async () => {
    const s = await newSocket();
    const j = await ack(s, 'room:join', { code: 'ABCDEF', nickname: 'Ana' });
    expect(j.ok).toBe(true);
    // o relay nunca entregava o ack do room:leave (a conexão deixou a vaga): o store desistia por tempo (10 s) e o
    // ack ficava pendente; criar outra sala reentrava em closeWs sem fim
    s.emit('room:leave', () => undefined);
    await new Promise((r) => setTimeout(r, 20));
    const c = await ack(s, 'room:create', { nickname: 'Ana' });
    expect(c.error).toBeUndefined();
    expect(c.ok).toBe(true);
    expect(c.data.code).toMatch(/^ROOM\d\d$/);
  });

  it('intenções pendentes ao trocar de sala falham uma vez só, sem reentrar', async () => {
    const s = await newSocket();
    await ack(s, 'room:join', { code: 'ABCDEF', nickname: 'Ana' });
    let calls = 0;
    let depth = 0;
    let maxDepth = 0;
    // um handler que, ao falhar, tenta de novo na hora (padrão de "retry" ingênuo)
    const retry = (r: Ack) => {
      calls++;
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      if (!r.ok && calls < 50) s.emit('chat:send', { text: 'oi' }, retry);
      depth--;
    };
    s.emit('chat:send', { text: 'oi' }, retry);
    const c = await ack(s, 'room:create', { nickname: 'Ana' });
    expect(c.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(maxDepth).toBe(1); // a falha volta sempre de forma assíncrona

  });

  it('WebSocket recusado (origem não permitida / http): erro claro em pt-BR, sem exceção crua', async () => {
    FakeWS.behavior = (ws) => setTimeout(() => ws.serverClose(1006), 0);
    const s = await newSocket();
    const c = await ack(s, 'room:create', { nickname: 'Ana' });
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/conex|servidor/i);
    expect(c.error).not.toMatch(/Maximum|stack|undefined/i);
  });

  it('POST /rooms recusado pela origem: mensagem do servidor (pt-BR)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false, error: 'Origem não permitida.' }) })));
    const s = await newSocket();
    const c = await ack(s, 'room:create', { nickname: 'Ana' });
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/Origem não permitida|https/);
  });

  it('exceção inesperada vira mensagem amigável', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => { throw new RangeError('Maximum call stack size exceeded'); } })));
    const s = await newSocket();
    const c = await ack(s, 'room:create', { nickname: 'Ana' });
    expect(c.ok).toBe(false);
    expect(c.error).not.toMatch(/Maximum call stack/);
  });

  it('hello sem resposta: tempo esgotado', async () => {
    vi.useFakeTimers();
    FakeWS.behavior = (ws) => ws.open(); // abre mas nunca responde
    const { EdgeSocket } = await import('./EdgeSocket');
    const s = new EdgeSocket();
    s.connect();
    const p = ack(s, 'room:join', { code: 'ABCDEF', nickname: 'Ana' });
    await vi.advanceTimersByTimeAsync(21_000);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/não respondeu/);
  });

  it('conexão instável: reconecta com espera crescente (assíncrona), sem recursão', async () => {
    vi.useFakeTimers();
    const { EdgeSocket } = await import('./EdgeSocket');
    const s = new EdgeSocket();
    s.connect();
    const p = ack(s, 'room:join', { code: 'ABCDEF', nickname: 'Ana' });
    await vi.advanceTimersByTimeAsync(10);
    expect((await p).ok).toBe(true);
    const errors: unknown[] = [];
    s.on('connect_error', (e: unknown) => errors.push(e));
    // daqui em diante toda tentativa cai antes do welcome
    FakeWS.behavior = (ws) => setTimeout(() => ws.serverClose(1006), 0);
    FakeWS.all.at(-1)!.serverClose(1006);
    const before = FakeWS.all.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWS.all.length).toBe(before); // nada síncrono: a 1ª tentativa espera
    await vi.advanceTimersByTimeAsync(30_000);
    const tries = FakeWS.all.length - before;
    expect(tries).toBeGreaterThan(2);
    expect(tries).toBeLessThan(20); // espera crescente (até 4 s), não um laço
    expect(errors.length).toBe(tries);
    // volta a funcionar
    FakeWS.behavior = (ws) => ws.autoWelcome();
    const connected = new Promise<void>((r) => s.once('connect', () => r()));
    await vi.advanceTimersByTimeAsync(10_000);
    await connected;
    s.disconnect();
  });
});
