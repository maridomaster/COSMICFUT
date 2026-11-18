/**
 * COSMICFUT — relay do modo online grátis (Cloudflare Workers + Durable Objects, plano gratuito).
 *
 * Worker (HTTP, CORS):
 *   GET  /health                 → { ok }
 *   GET  /rooms                  → salas públicas no lobby (DO Registry)
 *   POST /rooms                  → reserva um código novo (DO da sala) → { code }
 *   GET  /rooms/:code            → prévia da sala (sem tokens)
 *   GET  /rooms/:code/ws         → WebSocket da sala (DO RoomDO, API de hibernação)
 *   POST /careers/status         → "Minhas carreiras online" ({items:[{code, token}]}, até 30; nunca devolve tokens)
 *   GET  /public-url             → { url: null } (o link de convite usa a origem do GitHub Pages)
 *
 * Um Durable Object por sala (idFromName(código)), SQLite. Ver relay.ts. Nada aqui simula a carreira: cada
 * mensagem custa microssegundos de CPU (só cabeçalhos pequenos são lidos).
 */
import { RoomRelay, type Attachment, type RelaySocket } from './relay.ts';
import { RoomRegistry } from './registry.ts';
import { sqlStorage } from './sql-storage.ts';

export interface Env {
  ROOMS: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  /** origens liberadas (vírgulas). Vazio/"*" = todas (tokens não são cookies; ainda assim restrinja em produção). */
  ALLOWED_ORIGINS?: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{6}$/;
const VERSION = '1';

function originOk(env: Env, origin: string | null): boolean {
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length || list.includes('*') || !origin) return true;
  return list.includes(origin);
}

function cors(env: Env, req: Request, res: Response): Response {
  const origin = req.headers.get('Origin');
  if (!origin || !originOk(env, origin)) return res;
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'content-type');
  return new Response(res.body, { status: res.status, headers: h, webSocket: (res as Response & { webSocket?: WebSocket }).webSocket ?? null });
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function readJson(req: Request, max: number): Promise<unknown> {
  const text = await req.text();
  if (text.length > max) throw new Error('Pedido grande demais.');
  return JSON.parse(text);
}

function newCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return cors(env, req, new Response(null, { status: 204 }));
    if (!originOk(env, req.headers.get('Origin'))) {
      // a página consegue LER a recusa (só o erro) e mostrar uma mensagem clara (ex.: aberta por http:// em vez de https://)
      const origin = req.headers.get('Origin') ?? '';
      const res = json({ ok: false, error: origin.startsWith('http://') ? 'Origem não permitida: abra o jogo pelo endereço https://.' : 'Origem não permitida.' }, 403);
      if (origin && req.headers.get('Upgrade') !== 'websocket') res.headers.set('Access-Control-Allow-Origin', origin);
      return res;
    }
    try {
      if (path === '/health') return cors(env, req, json({ ok: true, edge: true, version: VERSION }));
      if (path === '/public-url') return cors(env, req, json({ url: null }));
      if (path === '/rooms' && req.method === 'GET') {
        const r = await env.REGISTRY.get(env.REGISTRY.idFromName('global')).fetch('https://registry/list');
        return cors(env, req, json({ ok: true, data: await r.json() }));
      }
      if (path === '/rooms' && req.method === 'POST') {
        for (let i = 0; i < 6; i++) {
          const code = newCode();
          const r = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(`https://room/${code}/init`, { method: 'POST' });
          if (r.status === 200) return cors(env, req, json({ ok: true, data: { code } }));
        }
        return cors(env, req, json({ ok: false, error: 'Não foi possível criar a sala.' }, 503));
      }
      if (path === '/careers/status' && req.method === 'POST') {
        const body = (await readJson(req, 16 * 1024)) as { items?: unknown };
        if (!Array.isArray(body?.items) || body.items.length > 30) return cors(env, req, json({ ok: false, error: 'items inválido (até 30).' }, 400));
        const out = await Promise.all(
          body.items.map(async (x: unknown) => {
            const it = (x ?? {}) as { code?: unknown; token?: unknown };
            const code = typeof it.code === 'string' ? it.code.toUpperCase() : '';
            if (!CODE_RE.test(code) || typeof it.token !== 'string') return { code, found: false };
            const r = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(`https://room/${code}/status`, { method: 'POST', body: JSON.stringify({ token: it.token }) });
            return r.json();
          }),
        );
        return cors(env, req, json({ ok: true, data: out }));
      }
      const m = /^\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/.exec(path);
      if (m) {
        const code = m[1].toUpperCase();
        if (!CODE_RE.test(code)) return cors(env, req, json({ ok: false, error: 'Código inválido.' }, 400));
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (m[2]) {
          if (req.headers.get('Upgrade') !== 'websocket') return json({ ok: false, error: 'WebSocket esperado.' }, 426);
          return stub.fetch(new Request(`https://room/${code}/ws`, req));
        }
        const r = await stub.fetch(`https://room/${code}/preview`);
        return cors(env, req, new Response(r.body, r));
      }
      return cors(env, req, json({ ok: false, error: 'Não encontrado.' }, 404));
    } catch (e) {
      return cors(env, req, json({ ok: false, error: e instanceof Error ? e.message : 'Pedido inválido.' }, 400));
    }
  },
} satisfies ExportedHandler<Env>;

/* ───────────── Durable Object da sala ───────────── */

export class RoomDO implements DurableObject {
  private readonly ctx: DurableObjectState;
  private relay: RoomRelay | null = null;
  private readonly env: Env;
  private readonly socks = new WeakMap<WebSocket, RelaySocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    // ping/pong do cliente sem acordar o DO (não conta como requisição)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private wrap(ws: WebSocket): RelaySocket {
    let s = this.socks.get(ws);
    if (!s) {
      s = {
        get att() {
          return (ws.deserializeAttachment() as Attachment | null) ?? { c: '', p: null, hello: null, at: 0 };
        },
        setAtt: (a: Attachment) => ws.serializeAttachment(a),
        send: (d: string | Uint8Array) => ws.send(d),
        close: (code?: number, reason?: string) => {
          try {
            ws.close(code, reason);
          } catch {
            /* já fechada */
          }
        },
      };
      this.socks.set(ws, s);
    }
    return s;
  }

  private r(code?: string): RoomRelay {
    if (this.relay) return this.relay;
    const storage = sqlStorage(this.ctx.storage);
    const c = code ?? (JSON.parse(storage.get('room') ?? '{}') as { code?: string }).code ?? '??????';
    this.relay = new RoomRelay(c, {
      storage,
      sockets: () => this.ctx.getWebSockets().filter((w) => w.readyState === 1).map((w) => this.wrap(w)),
      setAlarm: (at) => {
        if (at === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(at);
      },
      now: () => Date.now(),
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256: async (s) => {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
      },
      publish: async (code2, info) => {
        try {
          const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('global'));
          await reg.fetch('https://registry/put', { method: 'POST', body: JSON.stringify({ code: code2, info }) });
        } catch (e) {
          console.log('registry publish failed', String(e));
        }
      },
      log: (msg, extra) => console.log(msg, extra ?? {}),
    });
    return this.relay;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const [, code, op] = url.pathname.split('/');
    const relay = this.r(code);
    if (op === 'init') return relay.init() ? json({ ok: true }) : json({ ok: false }, 409);
    if (op === 'preview') {
      const p = relay.preview();
      return p ? json({ ok: true, data: p }) : json({ ok: false, error: 'Sala não encontrada.' }, 404);
    }
    if (op === 'status') {
      const body = (await readJson(req, 4096).catch(() => ({}))) as { token?: unknown };
      return json(await relay.status(body.token));
    }
    if (op === 'ws') {
      if (!relay.room()) return json({ ok: false, error: 'Sala não encontrada.' }, 404);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      relay.onOpen(this.wrap(server));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ ok: false, error: 'Não encontrado.' }, 404);
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    await this.r().onMessage(this.wrap(ws), msg);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.r().onClose(this.wrap(ws));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.r().onClose(this.wrap(ws));
  }

  async alarm(): Promise<void> {
    await this.r().onAlarm();
  }

}

/* ───────────── Durable Object do registro de salas públicas ───────────── */

export class Registry implements DurableObject {
  private readonly reg: RoomRegistry;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.reg = new RoomRegistry(sqlStorage(ctx.storage), () => Date.now());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/list') return json(this.reg.list());
    if (url.pathname === '/put' && req.method === 'POST') {
      const body = (await readJson(req, 4096)) as { code?: unknown; info?: unknown };
      if (typeof body.code === 'string') this.reg.put(body.code, body.info ?? null);
      return json({ ok: true });
    }
    return json({ ok: false }, 404);
  }
}
