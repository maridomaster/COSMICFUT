/**
 * Transporte do modo online GRÁTIS (Cloudflare): imita a parte do `Socket` do socket.io-client que o store usa
 * (`on/off/emit` com ack, `connected`, `active`, `connect()`, eventos 'connect'/'disconnect'/'connect_error'), em
 * cima do WebSocket do relay (Durable Object). Assim `store/online.ts` quase não muda.
 *
 *  - Entrar numa sala abre o WebSocket dela (`/rooms/CODIGO/ws`) e manda o `hello` (create/join/rejoin/claim);
 *    o relay devolve `welcome` (vaga + token durável) ou `denied`.
 *  - Intenções (eventos do Socket.io) viram `{t:'i', ev, a, k}`; o ack volta do anfitrião (ou do relay).
 *  - Eventos do anfitrião chegam em LOTES binários (ticks ao vivo a cada ~1 s); o cliente reproduz cada lote no
 *    ritmo original (`dt`), então a partida anda lisa mesmo com poucas mensagens.
 *  - Se ESTE navegador for eleito anfitrião da simulação (`role`), sobe o Web Worker do anfitrião (HostBridge)
 *    e passa a encaminhar as mensagens do relay para ele.
 *  - Queda: reconecta sozinho com o token (rejoin) e avisa o store com 'disconnect'/'connect' (banner
 *    "Reconectando…").
 */
import { decodeBundle, Reassembler, T_BUNDLE, T_CKPT, T_FRAG, WIRE_VERSION, type ClientHello, type RelayToHost } from '@cosmicfut/online-core/wire';
import { EDGE_HTTP, EDGE_WS, insecurePageMessage } from '../config';
import { HostBridge, type HostStatus } from './HostBridge';

type Listener = (...a: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
type AckFn = (r: { ok: true; data: unknown } | { ok: false; error: string }) => void;

/** Informação do anfitrião da simulação para a UI. */
export interface SimHostInfo {
  playerId: string | null;
  nickname: string | null;
  me: boolean;
  state: 'ok' | 'lost' | 'resuming';
  epoch: number;
}

const HOST_MSGS = new Set(['i', 'join', 'attach', 'detach', 'claim', 'ended', 'demoted']);
const PING_MS = 25_000;
/** espera máxima pelo ack do room:leave (o relay antigo não o entregava): depois fecha mesmo assim */
const LEAVE_ACK_MS = 2500;

/** Erro "nosso" (mensagem pt-BR pronta para a UI). Qualquer outro vira uma mensagem genérica. */
export class EdgeError extends Error {}

/** a tentativa de entrar foi trocada por outra (criar/entrar em outra sala) — não é um erro para a UI */
export const REPLACED = 'Conexão substituída.';

/** Mensagem para a UI: nossos erros como vieram; exceções inesperadas (RangeError…) viram texto amigável. */
export function edgeErrorMessage(e: unknown, fallback = 'Falha inesperada na conexão com a sala. Tente de novo.'): string {
  if (e instanceof EdgeError) return e.message;
  console.error('[online] erro inesperado', e);
  return fallback;
}

const noConnection = () => new EdgeError(insecurePageMessage() ?? 'Sem conexão com o servidor.');

export class EdgeSocket {
  connected = false;
  active = false;
  private ls = new Map<string, Set<Listener>>();
  private ws: WebSocket | null = null;
  private code: string | null = null;
  private token: string | null = null;
  private welcomed = false;
  private hello: { resolve: (w: Record<string, unknown>) => void; reject: (e: Error) => void } | null = null;
  private k = 0;
  private acks = new Map<number, AckFn>();
  private frag = new Reassembler();
  private queue: { at: number; ev: string; a: unknown }[] = [];
  private lastAt = 0;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private host: HostBridge | null = null;
  /** bytes do backup a restaurar (create + restore): entregues ao anfitrião desta aba */
  private restoreBytes: Uint8Array | null = null;
  private generation = 0;

  /* ── API estilo socket.io ── */

  on(ev: string, fn: Listener): this {
    let s = this.ls.get(ev);
    if (!s) this.ls.set(ev, (s = new Set()));
    s.add(fn);
    return this;
  }

  off(ev: string, fn?: Listener): this {
    if (!fn) this.ls.delete(ev);
    else this.ls.get(ev)?.delete(fn);
    return this;
  }

  once(ev: string, fn: Listener): this {
    const w: Listener = (...a) => {
      this.off(ev, w);
      fn(...a);
    };
    return this.on(ev, w);
  }

  removeAllListeners(): this {
    this.ls.clear();
    return this;
  }

  private fireDepth = 0;

  private fire(ev: string, ...a: unknown[]): void {
    // proteção contra laços de eventos (um handler que dispara o mesmo evento de novo, sem fim)
    if (this.fireDepth > 16) {
      console.error('[online] laço de eventos interrompido', ev);
      return;
    }
    this.fireDepth++;
    try {
      for (const fn of [...(this.ls.get(ev) ?? [])]) {
        try {
          fn(...a);
        } catch (e) {
          console.error('[online] handler', ev, e);
        }
      }
    } finally {
      this.fireDepth--;
    }
  }

  /** "Conecta" o transporte (o WebSocket só abre ao entrar numa sala). */
  connect(): this {
    if (this.connected) return this;
    this.active = true;
    this.connected = true;
    queueMicrotask(() => this.fire('connect'));
    return this;
  }

  disconnect(): this {
    this.closeWs();
    this.code = null;
    this.token = null;
    this.connected = false;
    this.active = false;
    this.fire('disconnect', 'io client disconnect');
    return this;
  }

  emit(ev: string, ...args: unknown[]): this {
    const last = args[args.length - 1];
    const ack: AckFn = typeof last === 'function' ? (last as AckFn) : () => undefined;
    if (typeof last === 'function') args.pop();
    const p = (args[0] ?? {}) as Record<string, unknown>;
    const fail = (error: string) => ack({ ok: false, error });
    const failWith = (e: unknown) => fail(edgeErrorMessage(e));
    switch (ev) {
      case 'room:create':
      case 'room:restore':
        void this.create(p, ev === 'room:restore').then((d) => ack({ ok: true, data: d }), failWith);
        return this;
      case 'room:join':
        void this.open(String(p.code ?? ''), { mode: 'join', nickname: p.nickname as string, ...(p.spectator ? { spectator: true } : {}) })
          .then((w) => ack({ ok: true, data: { ...(w.data as object), playerId: w.playerId, token: w.token } }), failWith);
        return this;
      case 'room:rejoin': {
        const code = String(p.code ?? '');
        const token = String(p.token ?? '');
        // `fresh`: a entrada travou (o anfitrião não mandou a sala): abre uma conexão nova (novo attach)
        if (!p.fresh && this.ws && this.welcomed && this.code === code && this.token === token) {
          ack({ ok: true, data: { playerId: this.playerId } });
          return this;
        }
        void this.open(code, { mode: 'rejoin', token }).then((w) => ack({ ok: true, data: { playerId: w.playerId } }), failWith);
        return this;
      }
      case 'room:claim-seat':
        void this.open(String(p.code ?? ''), { mode: 'claim', seatCode: p.seatCode as string, ...(p.nickname ? { nickname: p.nickname as string } : {}) })
          .then((w) => ack({ ok: true, data: { playerId: w.playerId, token: w.token } }), failWith);
        return this;
      case 'room:leave': {
        if (!this.ws || !this.welcomed) {
          queueMicrotask(() => ack({ ok: true, data: undefined }));
          return this;
        }
        // (bug "Maximum call stack size exceeded") o relay antigo não entregava este ack (a conexão já tinha deixado
        // a vaga): ele ficava pendurado e reentrava em closeWs ao criar/entrar em outra sala. Agora fecha depois de
        // um tempo de qualquer jeito, e uma vez só.
        const gen = this.generation;
        let done = false;
        const finish = (r: Parameters<AckFn>[0]) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          if (gen === this.generation) {
            this.closeWs();
            this.code = null;
            this.token = null;
          }
          ack(r.ok ? r : { ok: true, data: undefined });
        };
        const t = setTimeout(() => finish({ ok: true, data: undefined }), LEAVE_ACK_MS);
        this.intent('room:leave', undefined, finish);
        return this;
      }
      case 'room:list':
        void fetch(`${EDGE_HTTP}/rooms`).then((r) => r.json()).then((j) => ack(j as { ok: true; data: unknown }), () => fail(insecurePageMessage() ?? 'Servidor indisponível.'));
        return this;
      default:
        this.intent(ev, args.length ? args[0] : undefined, ack);
        return this;
    }
  }

  private playerId = '';

  private intent(ev: string, a: unknown, ack: AckFn): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.welcomed) {
      // sempre assíncrono: um handler que tenta de novo na falha não vira recursão síncrona
      queueMicrotask(() => ack({ ok: false, error: 'Sem conexão com a sala.' }));
      return;
    }
    const k = ++this.k;
    this.acks.set(k, ack);
    ws.send(JSON.stringify({ t: 'i', ev, ...(a !== undefined ? { a } : {}), k }));
  }

  /* ── sala ── */

  private async create(p: Record<string, unknown>, restore: boolean): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${EDGE_HTTP}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch {
      // CORS recusado (origem fora da lista, ex.: página aberta em http://) também cai aqui
      throw new EdgeError(insecurePageMessage() ?? 'Servidor indisponível. Verifique sua internet e tente de novo.');
    }
    const j = (await res.json().catch(() => null)) as { ok: boolean; data?: { code: string }; error?: string } | null;
    if (!j?.ok || !j.data) {
      const err = typeof j?.error === 'string' ? j.error : 'Não foi possível criar a sala.';
      throw new EdgeError(/origem/i.test(err) ? (insecurePageMessage() ?? `${err} Abra o jogo pelo endereço oficial (https).`) : err);
    }
    if (restore) {
      const file = p.file as Blob | undefined;
      if (!file) throw new EdgeError('Arquivo de backup não encontrado.');
      this.restoreBytes = new Uint8Array(await file.arrayBuffer());
    }
    const nickname = (p.nickname as string) || 'Host';
    const w = await this.open(j.data.code, { mode: 'create', nickname, ...(p.settings ? { settings: p.settings as Record<string, unknown> } : {}), ...(restore ? { restore: true } : {}) });
    return { ...(w.data as object), code: j.data.code, playerId: w.playerId, token: w.token };
  }

  /** Abre o WebSocket da sala e espera o welcome. */
  private open(code: string, hello: Omit<ClientHello, 't' | 'v'>): Promise<Record<string, unknown> & { playerId: string; token?: string }> {
    if (!/^[A-Z0-9]{6}$/.test(code)) return Promise.reject(new EdgeError('Código inválido.'));
    this.closeWs();
    const prevHello = this.hello;
    this.hello = null;
    prevHello?.reject(new EdgeError(REPLACED));
    const gen = ++this.generation;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${EDGE_WS}/rooms/${code}/ws`);
    } catch {
      // URL bloqueada (conteúdo misto http/https, endereço inválido): erro claro, sem exceção crua
      return Promise.reject(noConnection());
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.welcomed = false;
    this.code = code;
    let own: { resolve: (w: Record<string, unknown>) => void; reject: (e: Error) => void } | null = null;
    const p = new Promise<Record<string, unknown> & { playerId: string; token?: string }>((resolve, reject) => {
      own = { resolve: resolve as (w: Record<string, unknown>) => void, reject };
      this.hello = own;
    });
    // o tempo esgotado rejeita só ESTA tentativa (nunca a de uma conexão mais nova)
    const timer = setTimeout(() => {
      if (this.hello === own) this.hello = null;
      own?.reject(new EdgeError('O servidor não respondeu a tempo.'));
    }, 20_000);
    ws.onopen = () => {
      if (gen === this.generation) ws.send(JSON.stringify({ t: 'hello', v: WIRE_VERSION, ...hello }));
    };
    ws.onmessage = (e) => {
      if (gen !== this.generation) return;
      try {
        this.onData(e.data as string | ArrayBuffer);
      } catch (err) {
        console.error('[online] mensagem do relay', err);
      }
    };
    ws.onerror = () => undefined;
    ws.onclose = (e) => {
      if (gen !== this.generation) return;
      this.onClosed(e.code, hello.mode);
    };
    return p
      .then((w) => {
        clearTimeout(timer);
        this.welcomed = true;
        this.retries = 0;
        this.playerId = w.playerId;
        this.token = (w.token as string | undefined) ?? hello.token ?? this.token;
        this.connected = true;
        this.startPing();
        return w;
      })
      .catch((e: unknown) => {
        clearTimeout(timer);
        if (gen === this.generation) {
          this.closeWs();
          this.code = null;
        }
        throw e;
      });
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      // respondido pelo próprio Cloudflare (auto-resposta), sem acordar o Durable Object
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, PING_MS);
  }

  private closeWs(): void {
    this.generation++;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try {
        ws.close(1000, 'bye');
      } catch {
        /* ignore */
      }
    }
    this.stopHost();
    this.failAcks('Conexão encerrada.');
  }

  /**
   * Falha os acks pendentes. (bug "Maximum call stack size exceeded") a lista é ESVAZIADA antes, e cada ack roda à
   * parte (microtarefa): um ack que fecha a conexão de novo (room:leave) ou tenta de novo não reentra aqui.
   */
  private failAcks(error: string): void {
    if (!this.acks.size) return;
    const list = [...this.acks.values()];
    this.acks.clear();
    for (const ack of list) {
      queueMicrotask(() => {
        try {
          ack({ ok: false, error });
        } catch (e) {
          console.error('[online] ack', e);
        }
      });
    }
  }

  private stopHost(): void {
    if (!this.host) return;
    this.host.stop();
    this.host = null;
    this.fire('edge:hoststatus', { state: 'stopped' } satisfies HostStatus);
  }

  /** Queda inesperada (ou o relay fechou). */
  private onClosed(code: number, _mode: ClientHello['mode']): void {
    const wasWelcomed = this.welcomed;
    this.ws = null;
    this.welcomed = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.stopHost();
    this.failAcks('Conexão perdida.');
    if (this.hello || !wasWelcomed) {
      // ainda entrando: quem chamou open trata o erro (denied chega antes do fechamento)
      const h = this.hello;
      this.hello = null;
      h?.reject(code === 4000 ? new EdgeError('Recusado pelo servidor.') : noConnection());
      return;
    }
    // 4000 recusado · 4001 substituído · 4002 encerrada · 4003 saiu/expulso: sem reconexão automática
    if (code >= 4000 && code <= 4003) {
      this.connected = false;
      return;
    }
    if (!this.code || !this.token) return;
    this.connected = false;
    this.fire('disconnect', 'transport close');
    this.scheduleReconnect(this.code, this.token);
  }

  /** Reconexão SEMPRE assíncrona, com espera crescente (0,5 s → 4 s, com variação) e uma tentativa por vez. */
  private scheduleReconnect(code6: string, token: string): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const n = Math.min(this.retries++, 6);
    const wait = Math.min(4000, 500 * 2 ** n) + Math.floor(Math.random() * 250);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.active) return; // desconectou de vez enquanto esperava
      void this.open(code6, { mode: 'rejoin', token }).then(
        () => this.fire('connect'),
        (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === REPLACED) return; // outra conexão (criar/entrar) assumiu: esta tentativa morre aqui
          if (/inválid|não encontrada|Recusado/i.test(msg)) {
            this.connected = false;
            this.fire('error', { code: 'kicked', message: 'Não foi possível voltar à sala (vaga inválida ou sala encerrada).' });
          } else {
            this.fire('connect_error', e instanceof EdgeError ? e : new EdgeError(edgeErrorMessage(e)));
            if (this.retryTimer || this.ws) return; // alguém já abriu outra conexão
            this.code = code6;
            this.token = token;
            this.scheduleReconnect(code6, token);
          }
        },
      );
    }, wait);
  }
  /* ── recebimento ── */

  private onData(d: string | ArrayBuffer): void {
    if (typeof d !== 'string') {
      const b = new Uint8Array(d);
      if (b[0] === T_CKPT) {
        this.host?.postBinary(b);
        return;
      }
      const frame = b[0] === T_FRAG ? this.frag.push(b) : b;
      if (!frame || frame[0] !== T_BUNDLE) return;
      let msgs;
      try {
        msgs = decodeBundle(frame);
      } catch (e) {
        console.warn('[online] lote inválido', e);
        return;
      }
      // reprodução no ritmo original (ticks ao vivo vêm em lotes de ~1 s)
      const now = performance.now();
      const start = Math.max(now, this.lastAt);
      for (const m of msgs) {
        const at = start + (m.dt ?? 0);
        this.lastAt = at;
        this.queue.push({ at, ev: m.ev, a: m.a });
      }
      this.pump();
      return;
    }
    if (d === 'pong') return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(d) as Record<string, unknown>;
    } catch {
      return;
    }
    const t = m.t as string;
    if (t === 'welcome') {
      const h = this.hello;
      this.hello = null;
      h?.resolve(m);
    } else if (t === 'denied') {
      const h = this.hello;
      this.hello = null;
      h?.reject(new EdgeError(String(m.error ?? 'Recusado.')));
    } else if (t === 'ack') {
      this.takeAck(m.k as number, m.r);
    } else if (t === 'ev') {
      this.enqueueNow(m.ev as string, m.a);
    } else if (t === 'host') {
      this.fire('edge:host', { playerId: m.playerId, nickname: m.nickname, me: m.me, state: m.state, epoch: m.epoch } as SimHostInfo);
    } else if (t === 'role') {
      this.startHost(m as unknown as RelayToHost);
    } else if (HOST_MSGS.has(t)) {
      this.host?.post(m as unknown as RelayToHost);
    }
  }

  private takeAck(k: number, r: unknown): void {
    const fn = this.acks.get(k);
    if (!fn) return;
    this.acks.delete(k);
    try {
      fn(r as { ok: true; data: unknown });
    } catch (e) {
      console.error('[online] ack', e);
    }
  }

  /** evento de controle do relay: entra na fila (não passa na frente dos lotes já agendados) */
  private enqueueNow(ev: string, a: unknown): void {
    this.queue.push({ at: Math.max(performance.now(), this.lastAt), ev, a });
    this.pump();
  }

  private pump(): void {
    if (this.pumpTimer) return;
    const now = performance.now();
    while (this.queue.length && this.queue[0].at <= now + 1) {
      const m = this.queue.shift()!;
      try {
        if (m.ev === '@ack') {
          const x = m.a as { k: number; r: unknown };
          this.takeAck(x.k, x.r);
        } else this.fire(m.ev, m.a);
      } catch (e) {
        console.error('[online] evento', m.ev, e);
      }
    }
    if (this.queue.length) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null;
        this.pump();
      }, Math.max(0, this.queue[0].at - performance.now()));
    }
  }

  private startHost(role: RelayToHost): void {
    this.stopHost();
    const ws = this.ws;
    if (!ws) return;
    const restore = this.restoreBytes;
    this.restoreBytes = null;
    this.host = new HostBridge({
      send: (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      },
      restoreBytes: restore,
      onStatus: (s) => this.fire('edge:hoststatus', s),
    });
    this.host.post(role);
  }
}
