/**
 * Protocolo de fio do modo "online grátis" (GitHub Pages + Cloudflare Durable Object, anfitrião no navegador).
 * Puro (sem dependências): usado pelo relay (apps/edge), pelo anfitrião (host.ts) e pelo cliente web.
 *
 *   cliente ──texto JSON──▶ DO ──texto JSON──▶ anfitrião (Web Worker de um dos jogadores)
 *   cliente ◀──binário──── DO ◀──binário───── anfitrião     (o DO só lê o CABEÇALHO pequeno e repassa os bytes)
 *
 * Mensagens para os clientes são os MESMOS eventos do Socket.io (`packages/shared/src/net.ts`), em lotes:
 *   0x01 BUNDLE   [0x01][u32 len][json {m:[[ev, payload, dt]], b:[blobLen…]}][blobs…]   (Uint8Array → {"$b": i})
 *   0x02 FRAGMENT [0x02][u32 id][u16 i][u16 n][bytes]   (BUNDLE maior que FRAG_BYTES, remontado no cliente)
 * Do anfitrião para o DO:
 *   0x20 HOST     [0x20][u32 len][json HostHeader][corpos para os clientes…][pedaço de checkpoint]
 * Do DO para o anfitrião eleito:
 *   0x10 CKPT     [0x10][u16 i][u16 n][bytes]   (checkpoint gzip, em pedaços)
 */

export const WIRE_VERSION = 1;
export const T_BUNDLE = 0x01;
export const T_FRAG = 0x02;
export const T_CKPT = 0x10;
export const T_HOST = 0x20;

/** Maior mensagem de texto aceita de um cliente (intenções: escalação, mercado, chat…). */
export const MAX_CLIENT_MSG = 64 * 1024;
/** Maior quadro binário aceito do anfitrião (o limite de mensagem WebSocket da Cloudflare é 1 MiB). */
export const MAX_HOST_FRAME = 960 * 1024;
/** Corpos maiores que isto viram fragmentos (snapshot da temporada: 0,3–1 MB gzip). */
export const FRAG_BYTES = 240 * 1024;
/** Pedaço do checkpoint (WebSocket e linha do SQLite do DO; o valor máximo por linha é 2 MB). */
export const CKPT_CHUNK = 256 * 1024;
/** Checkpoint máximo guardado por sala. */
export const MAX_CKPT_BYTES = 24 * 1024 * 1024;

/* ───────────── mensagens de controle (texto JSON) ───────────── */

export type HelloMode = 'create' | 'join' | 'rejoin' | 'claim';

/** Primeira mensagem do cliente depois de abrir o WebSocket da sala. */
export interface ClientHello {
  t: 'hello';
  v: number;
  mode: HelloMode;
  nickname?: string;
  settings?: Record<string, unknown>;
  spectator?: boolean;
  token?: string;
  seatCode?: string;
  /** create: a sala nasce de um arquivo de backup (o anfitrião, que é quem envia, valida e restaura) */
  restore?: boolean;
}

/** Intenção do cliente (evento do Socket.io + ack). */
export interface ClientIntent {
  t: 'i';
  ev: string;
  a?: unknown;
  k?: number;
}

/** DO → cliente (texto). */
export type RelayToClient =
  | { t: 'welcome'; code: string; playerId: string; token?: string; data?: Record<string, unknown> }
  | { t: 'denied'; error: string }
  | { t: 'host'; playerId: string | null; nickname: string | null; me: boolean; epoch: number; state: 'ok' | 'lost' | 'resuming' }
  | { t: 'ack'; k: number; r: { ok: true; data?: unknown } | { ok: false; error: string } }
  | { t: 'ev'; ev: string; a?: unknown };

export interface SeatInfo {
  p: string;
  nick: string;
  spec: boolean;
  /** conexão atual (null = off-line) */
  c: string | null;
}

/** DO → anfitrião (texto). */
export type RelayToHost =
  | { t: 'role'; epoch: number; code: string; ckpt: { n: number; size: number } | null; seats: SeatInfo[]; create?: { settings: Record<string, unknown>; restore?: boolean }; replay: boolean }
  | { t: 'i'; c: string; p: string; ev: string; a?: unknown; k?: number }
  | { t: 'join'; j: number; c: string; p: string; nick: string; spec: boolean; create?: boolean }
  | { t: 'attach'; c: string; p: string; nick: string; spec: boolean }
  | { t: 'detach'; c: string; p: string }
  | { t: 'claim'; c: string; p: string; nick?: string }
  | { t: 'ended' }
  | { t: 'demoted' };

/** Resumo da sala que o anfitrião manda ao DO (lista de salas, "Minhas carreiras online", dono da sala). */
export interface RoomMetaLite {
  phase: string;
  season: number | null;
  date: string | null;
  /** dono da sala (host do lobby; administração) */
  hostId: string;
  turnOf: string | null;
  lastActivity: number;
  /** rodada sendo simulada/jogada agora: failover rejoga o dia a partir do checkpoint */
  advancing: boolean;
  /** "Salas abertas" (pública, no lobby, com vaga) */
  pub: null | { host: string; hostClubId: string | null; players: number; maxPlayers: number; preset: string; turnMode: string; pickMode: string; createdAt: number };
  players: { id: string; nickname: string; clubId: string | null; color?: string; spectator?: boolean; unemployed?: boolean }[];
  /** configurações da sala (prévia ao entrar pelo link) */
  settings?: Record<string, unknown>;
}

export interface HostHeader {
  /** corpos para os clientes: destinos (ids de conexão) e tamanho em bytes, na ordem do payload */
  o?: { to: string[]; n: number }[];
  /** pedaço de checkpoint (vem depois dos corpos) */
  ck?: { id: string; i: number; n: number; size: number; len: number };
  meta?: RoomMetaLite;
  /** respostas a 'join' */
  joined?: { j: number; ok: boolean; error?: string; p?: string; data?: Record<string, unknown> }[];
  /** jogadores que saíram da sala (vaga revogada no DO) */
  drop?: string[];
  /** conexões a derrubar (conexão antiga substituída) */
  close?: string[];
  /** sala apagada (lobby vazio) */
  destroyed?: boolean;
}

/* ───────────── bytes ───────────── */

const te = new TextEncoder();
const td = new TextDecoder();

function u32(v: number, out: Uint8Array, at: number): void {
  out[at] = (v >>> 24) & 255;
  out[at + 1] = (v >>> 16) & 255;
  out[at + 2] = (v >>> 8) & 255;
  out[at + 3] = v & 255;
}
const r32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const r16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

export const asBytes = (d: ArrayBuffer | ArrayBufferView): Uint8Array =>
  d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);

function concat(parts: Uint8Array[], total?: number): Uint8Array {
  const out = new Uint8Array(total ?? parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/* ───────────── lote de eventos (cliente) ───────────── */

export interface WireMsg {
  ev: string;
  a: unknown;
  /** ms desde o primeiro evento do lote (o cliente reproduz no mesmo ritmo: ticks ao vivo em lote) */
  dt?: number;
}

/** Codifica um lote de eventos; Uint8Array/ArrayBuffer dentro dos payloads vão como blobs binários. */
export function encodeBundle(msgs: WireMsg[]): Uint8Array {
  const blobs: Uint8Array[] = [];
  const json = JSON.stringify({ m: msgs.map((x) => [x.ev, x.a === undefined ? null : x.a, x.dt ?? 0]), b: [] as number[] }, (_k, v: unknown) => {
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
      blobs.push(asBytes(v));
      return { $b: blobs.length - 1 };
    }
    // Buffer do Node (toJSON antes do replacer): {type:'Buffer', data:[…]}
    if (v && typeof v === 'object' && (v as { type?: unknown }).type === 'Buffer' && Array.isArray((v as { data?: unknown }).data)) {
      blobs.push(Uint8Array.from((v as { data: number[] }).data));
      return { $b: blobs.length - 1 };
    }
    return v;
  });
  // os tamanhos dos blobs vão num sufixo do JSON (o replacer roda antes de sabermos todos)
  const body = te.encode(json.slice(0, -3) + JSON.stringify(blobs.map((b) => b.byteLength)) + '}');
  const head = new Uint8Array(5);
  head[0] = T_BUNDLE;
  u32(body.byteLength, head, 1);
  return concat([head, body, ...blobs]);
}

export function decodeBundle(buf: Uint8Array): WireMsg[] {
  if (buf[0] !== T_BUNDLE) throw new Error('lote inválido');
  const len = r32(buf, 1);
  const json = JSON.parse(td.decode(buf.subarray(5, 5 + len))) as { m: [string, unknown, number][]; b: number[] };
  const blobs: Uint8Array[] = [];
  let at = 5 + len;
  for (const n of json.b) {
    blobs.push(buf.slice(at, at + n));
    at += n;
  }
  const revive = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.$b === 'number' && Object.keys(o).length === 1) return blobs[o.$b];
      for (const k of Object.keys(o)) o[k] = revive(o[k]);
      return o;
    }
    return v;
  };
  return json.m.map(([ev, a, dt]) => ({ ev, a: blobs.length ? revive(a) : a, dt }));
}

/** Divide um quadro grande em fragmentos (cada um uma mensagem WebSocket). */
export function fragment(frame: Uint8Array, id: number, max = FRAG_BYTES): Uint8Array[] {
  if (frame.byteLength <= max) return [frame];
  const n = Math.ceil(frame.byteLength / max);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const part = frame.subarray(i * max, Math.min(frame.byteLength, (i + 1) * max));
    const f = new Uint8Array(9 + part.byteLength);
    f[0] = T_FRAG;
    u32(id >>> 0, f, 1);
    f[5] = (i >> 8) & 255;
    f[6] = i & 255;
    f[7] = (n >> 8) & 255;
    f[8] = n & 255;
    f.set(part, 9);
    out.push(f);
  }
  return out;
}

/** Remonta fragmentos (cliente). Devolve o quadro completo quando chega o último pedaço. */
export class Reassembler {
  private parts = new Map<number, { n: number; got: number; bufs: (Uint8Array | null)[]; at: number }>();

  push(frag: Uint8Array, now = Date.now()): Uint8Array | null {
    const id = r32(frag, 1);
    const i = r16(frag, 5);
    const n = r16(frag, 7);
    if (n < 1 || i >= n || n > 4096) return null;
    let e = this.parts.get(id);
    if (!e || e.n !== n) {
      e = { n, got: 0, bufs: new Array(n).fill(null), at: now };
      this.parts.set(id, e);
    }
    if (!e.bufs[i]) {
      e.bufs[i] = frag.slice(9);
      e.got++;
    }
    // descarta montagens antigas (conexão caiu no meio)
    for (const [k, v] of this.parts) if (now - v.at > 120_000) this.parts.delete(k);
    if (e.got < n) return null;
    this.parts.delete(id);
    return concat(e.bufs as Uint8Array[]);
  }
}

/* ───────────── anfitrião → DO ───────────── */

export function encodeHostFrame(hdr: HostHeader, bodies: Uint8Array[], ckpt?: Uint8Array): Uint8Array {
  const h = te.encode(JSON.stringify(hdr));
  const head = new Uint8Array(5);
  head[0] = T_HOST;
  u32(h.byteLength, head, 1);
  return concat([head, h, ...bodies, ...(ckpt ? [ckpt] : [])]);
}

/** Só o cabeçalho (o DO não toca no resto). */
export function readHostHeader(buf: Uint8Array): { hdr: HostHeader; offset: number } {
  if (buf.byteLength < 5 || buf[0] !== T_HOST) throw new Error('quadro do anfitrião inválido');
  const len = r32(buf, 1);
  if (len > 64 * 1024 || 5 + len > buf.byteLength) throw new Error('cabeçalho do anfitrião inválido');
  const hdr = JSON.parse(td.decode(buf.subarray(5, 5 + len))) as HostHeader;
  return { hdr, offset: 5 + len };
}

/* ───────────── DO → anfitrião: checkpoint ───────────── */

export function encodeCkptChunk(i: number, n: number, bytes: Uint8Array): Uint8Array {
  const f = new Uint8Array(5 + bytes.byteLength);
  f[0] = T_CKPT;
  f[1] = (i >> 8) & 255;
  f[2] = i & 255;
  f[3] = (n >> 8) & 255;
  f[4] = n & 255;
  f.set(bytes, 5);
  return f;
}

export function decodeCkptChunk(buf: Uint8Array): { i: number; n: number; bytes: Uint8Array } {
  if (buf[0] !== T_CKPT) throw new Error('pedaço de checkpoint inválido');
  return { i: r16(buf, 1), n: r16(buf, 3), bytes: buf.subarray(5) };
}

export const joinBytes = concat;
