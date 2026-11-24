/**
 * RELAY de uma sala (lógica pura, testável sem o runtime da Cloudflare). O Durable Object (`index.ts`) só adapta
 * WebSocket/SQLite/alarme para estas interfaces.
 *
 * O relay NÃO simula: o anfitrião da simulação é um dos navegadores (Web Worker). O relay:
 *  - autentica vagas: tokens duráveis (só o hash SHA-256 fica guardado), códigos de vaga (hash), limite de 6
 *    técnicos e 4 espectadores, expulsão (vaga revogada quando o anfitrião informa a saída);
 *  - presença (on/off-line por vaga, última atividade) com WebSocket Hibernation;
 *  - elege o anfitrião (dono da sala, senão o 1º técnico conectado) e faz o failover com tolerância curta;
 *  - repassa intenções (cliente → anfitrião, com a vaga carimbada pelo relay) e eventos (anfitrião → clientes),
 *    lendo só um cabeçalho JSON pequeno — os corpos binários passam direto;
 *  - guarda o checkpoint (bytes opacos, em pedaços) e o resumo da sala (lista pública, "Minhas carreiras online");
 *  - regras sem simular: só o anfitrião eleito transmite estado/checkpoint; só o dono da vaga manda intenções dela;
 *    administração só do dono da sala; limites de chat/reações/mensagens por segundo; tamanho e forma de toda
 *    mensagem recebida.
 */
import {
  CKPT_CHUNK, encodeCkptChunk, MAX_CKPT_BYTES, MAX_CLIENT_MSG, MAX_HOST_FRAME, readHostHeader, WIRE_VERSION,
  type ClientHello, type HostHeader, type RelayToClient, type RelayToHost, type RoomMetaLite, type SeatInfo,
} from '@cosmicfut/online-core/wire';

/* ───────────── limites ───────────── */

export const MAX_MANAGERS = 6;
export const MAX_SPECTATORS = 4;
/** anfitrião caiu: espera isto antes de eleger outro (recarregar a página volta para o mesmo) */
export const HOST_GRACE_MS = 3_000;
/** sala no lobby sem ninguém conectado expira depois disto */
export const LOBBY_TTL_MS = 6 * 3600_000;
/** sala criada (POST /rooms) e nunca aberta */
export const INIT_TTL_MS = 15 * 60_000;
export const SEAT_CODE_TTL_MS = 24 * 3600_000;
export const MSGS_PER_SEC = 30;
export const CHAT_WINDOW_MS = 10_000;
export const CHAT_MAX = 5;
export const REACT_GAP_MS = 700;

const SEAT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Eventos que um cliente pode mandar (o resto é descartado). */
export const CLIENT_EVENTS = new Set([
  'room:leave', 'room:rejoin', 'room:pick-club', 'room:start', 'room:update-settings', 'room:set-color', 'room:kick', 'room:transfer-host',
  'room:react', 'room:seat-code', 'room:end', 'room:backup', 'room:list',
  'round:set-lineup', 'round:ready', 'round:force', 'turn:end', 'draft:start', 'lottery:run',
  'match:command', 'match:pause-request', 'match:resume', 'chat:send', 'season:renew', 'season:sync',
  'vote:propose', 'vote:cast', 'skip:cancel', 'friends:get', 'jobs:get', 'jobs:apply', 'jobs:accept', 'jobs:decline',
  'market:offer', 'market:contract', 'market:respond', 'market:withdraw', 'market:list', 'market:release', 'market:counter',
  'market:loanlist', 'market:option', 'market:recall', 'market:renew', 'market:budget', 'market:promote', 'market:dismiss', 'market:train',
  // só com DEV_COMMANDS no anfitrião (desligado no navegador); testes
  'dev:advance',
]);

/** Administração: só o dono da sala (o "host" do lobby, não necessariamente o anfitrião da simulação). */
export const OWNER_EVENTS = new Set(['room:kick', 'room:transfer-host', 'room:update-settings', 'room:seat-code', 'room:end', 'room:backup', 'room:start', 'draft:start', 'lottery:run', 'dev:advance']);

/* ───────────── portas ───────────── */

export interface Attachment {
  /** id da conexão */
  c: string;
  /** vaga autenticada */
  p: string | null;
  /** entrada pendente (aguardando o anfitrião) */
  hello?: { mode: 'create' | 'join'; j: number; pid: string; nick: string; spec: boolean } | null;
  at: number;
  /** saiu da sala (room:leave): ainda recebe o ack da saída, nada mais fala pela vaga */
  lv?: 1;
}

export interface RelaySocket {
  readonly att: Attachment;
  setAtt(a: Attachment): void;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Armazenamento síncrono (SQLite do DO; Map nos testes). */
export interface RelayStorage {
  get(key: string): string | null;
  put(key: string, value: string): void;
  del(key: string): void;
  keys(prefix: string): string[];
  getBlob(key: string): Uint8Array | null;
  putBlob(key: string, value: Uint8Array): void;
  delBlobs(prefix: string): void;
  /** apaga uma linha de blob (chave exata) */
  delBlob(key: string): void;
  transaction(fn: () => void): void;
  deleteAll(): void;
}

export interface RelayEnv {
  storage: RelayStorage;
  sockets(): RelaySocket[];
  setAlarm(at: number | null): void;
  now(): number;
  random(n: number): Uint8Array;
  sha256(s: string): Promise<string>;
  /** "Salas abertas": registro global (null = sai da lista) */
  publish(code: string, info: (NonNullable<RoomMetaLite['pub']> & { code: string }) | null): void | Promise<void>;
  log?(msg: string, extra?: Record<string, unknown>): void;
}

export interface Seat {
  p: string;
  nick: string;
  spec: boolean;
  /** hash do token (null = vaga sem dono: restaurada de backup, só por código de vaga) */
  th: string | null;
  sc: { h: string; exp: number } | null;
  at: number;
  ls: number | null;
}

interface RoomRec {
  code: string;
  state: 'init' | 'live';
  createdAt: number;
  create?: { settings: Record<string, unknown>; restore?: boolean } | null;
}

interface HostRec {
  c: string | null;
  p: string | null;
  epoch: number;
  lostAt?: number | null;
}

interface CkRec {
  id: string;
  /** pedaços de CKPT_CHUNK enviados ao anfitrião eleito */
  n: number;
  size: number;
  at: number;
  /** linhas `ck:k` no SQLite (de até CKPT_ROW bytes). Ausente = formato antigo: uma linha por pedaço (r = n). */
  r?: number;
}

/**
 * Bytes do checkpoint por linha do SQLite (o limite do DO é 2 MB por linha). Linhas grandes = menos `rows_written`
 * (o plano Free permite 100 mil por dia): um checkpoint de 2,4 MB vira 2 linhas, não 10.
 */
export const CKPT_ROW = 1536 * 1024;
/** `lastActivity` do resumo da sala: precisão de 10 min basta */
const META_ACTIVITY_MS = 10 * 60_000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** base64url sem spread (`String.fromCharCode(...b)` estoura a pilha com arrays grandes) */
const b64url = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const NICK_RE = /^[^\u0000-\u001f<>]{1,20}$/u;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Apelido: mesmas regras do servidor (1–20, sem controle nem < >). */
export function cleanNick(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return NICK_RE.test(s) ? s : null;
}

/* ───────────── relay ───────────── */

export class RoomRelay {
  readonly code: string;
  private readonly env: RelayEnv;
  /** limites por conexão (em memória: zera se o DO hibernar, o que só acontece com a sala parada) */
  private readonly rl = new Map<string, { t: number; n: number; chat: number[]; react: number }>();
  /** contadores (testes / orçamento) */
  readonly stats = { clientMsgs: 0, hostFrames: 0, ckptChunks: 0, toClients: 0 };
  /**
   * Checkpoint chegando (pedaços em memória até o último: nada é gravado antes). Os pedaços de um checkpoint vêm
   * em sequência, no mesmo flush do anfitrião; se o DO for despejado no meio, o checkpoint é ignorado e o anterior
   * continua valendo (o anfitrião manda outro no próximo).
   */
  private staging: { id: string; n: number; size: number; parts: (Uint8Array | null)[]; got: number } | null = null;

  constructor(code: string, env: RelayEnv) {
    this.code = code;
    this.env = env;
  }

  /* ── armazenamento ── */

  private getJson<T>(key: string): T | null {
    const v = this.env.storage.get(key);
    if (v === null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  private putJson(key: string, v: unknown): void {
    this.env.storage.put(key, JSON.stringify(v));
  }

  room(): RoomRec | null {
    return this.getJson<RoomRec>('room');
  }

  meta(): RoomMetaLite | null {
    return this.getJson<RoomMetaLite>('meta');
  }

  seats(): Seat[] {
    return this.env.storage.keys('seat:').map((k) => this.getJson<Seat>(k)).filter((s): s is Seat => !!s).sort((a, b) => a.at - b.at);
  }

  seat(p: string): Seat | null {
    return this.getJson<Seat>(`seat:${p}`);
  }

  private host(): HostRec {
    return this.getJson<HostRec>('host') ?? { c: null, p: null, epoch: 0 };
  }

  private ck(): CkRec | null {
    return this.getJson<CkRec>('ck');
  }

  /** Dono da sala: o do resumo do anfitrião; sem resumo, o 1º técnico. */
  owner(): string | null {
    return this.meta()?.hostId ?? this.seats().find((s) => !s.spec)?.p ?? null;
  }

  /* ── HTTP (via Worker) ── */

  /** POST /rooms → reserva o código. false se já existe. */
  init(): boolean {
    if (this.room()) return false;
    const now = this.env.now();
    this.putJson('room', { code: this.code, state: 'init', createdAt: now } satisfies RoomRec);
    this.scheduleExpiry(now + INIT_TTL_MS);
    return true;
  }

  preview(): unknown {
    const r = this.room();
    if (!r || r.state === 'init') return null;
    const m = this.meta();
    const online = this.onlinePids();
    return {
      code: this.code,
      phase: m?.phase ?? 'lobby',
      players: (m?.players ?? []).filter((p) => !p.spectator).map((p) => ({ nickname: p.nickname, clubId: p.clubId, connected: online.has(p.id) })),
      settings: m?.settings ?? {},
      maxPlayers: MAX_MANAGERS,
    };
  }

  /** Situação da carreira para o dono do token (nunca devolve tokens). */
  async status(token: unknown): Promise<Record<string, unknown>> {
    const notFound = { code: this.code, found: false };
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return notFound;
    const r = this.room();
    if (!r || r.state === 'init') return notFound;
    const th = await this.env.sha256(token);
    const me = this.seats().find((s) => s.th === th);
    if (!me) return notFound;
    const m = this.meta();
    const online = this.onlinePids();
    const mine = m?.players.find((p) => p.id === me.p);
    return {
      code: this.code, found: true, phase: m?.phase ?? 'lobby', season: m?.season ?? null, date: m?.date ?? null,
      me: { playerId: me.p, nickname: mine?.nickname ?? me.nick, clubId: mine?.clubId ?? null, isHost: this.owner() === me.p, ...(me.spec ? { spectator: true } : {}) },
      managers: (m?.players ?? []).filter((p) => !p.spectator).map((p) => ({
        nickname: p.nickname, clubId: p.clubId, ...(p.color ? { color: p.color } : {}), online: online.has(p.id), ...(p.unemployed ? { unemployed: true } : {}),
      })),
      lastActivity: m?.lastActivity ?? r.createdAt,
      turnOf: m?.turnOf ?? null,
    };
  }

  /* ── conexões ── */

  private onlinePids(): Set<string> {
    return new Set(this.env.sockets().map((s) => s.att.p).filter((p): p is string => !!p));
  }

  private sockByConn(c: string): RelaySocket | undefined {
    return this.env.sockets().find((s) => s.att.c === c);
  }

  private bound(p: string): RelaySocket[] {
    return this.env.sockets().filter((s) => s.att.p === p);
  }

  /** id de entrada pendente (aleatório: sobrevive à hibernação do DO sem colidir) */
  private newJ(): number {
    const b = this.env.random(4);
    return (((b[0] & 0x7f) << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }

  private sendJson(ws: RelaySocket, m: RelayToClient | RelayToHost): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* conexão fechando */
    }
  }

  newConnId(): string {
    return b64url(this.env.random(6));
  }

  private toClient(ws: RelaySocket, m: RelayToClient): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* conexão fechando */
    }
  }

  private toHost(m: RelayToHost): boolean {
    const h = this.host();
    const ws = h.c ? this.sockByConn(h.c) : undefined;
    if (!ws || h.lostAt) return false;
    this.sendJson(ws, m);
    return true;
  }

  private isHost(ws: RelaySocket): boolean {
    const h = this.host();
    return !!h.c && h.c === ws.att.c && !h.lostAt;
  }

  private deny(ws: RelaySocket, error: string): void {
    this.toClient(ws, { t: 'denied', error });
    ws.close(4000, 'denied');
  }

  /** WebSocket aceito (o Worker já conferiu origem e código). */
  onOpen(ws: RelaySocket): void {
    ws.setAtt({ c: this.newConnId(), p: null, hello: null, at: this.env.now() });
    this.clearExpiry();
  }

  async onMessage(ws: RelaySocket, data: string | ArrayBuffer | Uint8Array): Promise<void> {
    if (typeof data !== 'string') {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!this.isHost(ws) || buf.byteLength > MAX_HOST_FRAME) return;
      this.stats.hostFrames++;
      await this.onHostFrame(buf);
      return;
    }
    this.stats.clientMsgs++;
    if (data.length > MAX_CLIENT_MSG) return this.deny(ws, 'Mensagem grande demais.');
    let msg: Record<string, unknown>;
    try {
      const v = JSON.parse(data) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      msg = v as Record<string, unknown>;
    } catch {
      return this.deny(ws, 'Mensagem inválida.');
    }
    const att = ws.att;
    if (msg.t === 'hello') {
      if (att.p || att.hello) return; // já entrou
      return this.onHello(ws, msg as unknown as ClientHello);
    }
    if (msg.t === 'i') return this.onIntent(ws, msg);
  }

  /* ── entrada ── */

  private async onHello(ws: RelaySocket, h: ClientHello): Promise<void> {
    if (h.v !== WIRE_VERSION) return this.deny(ws, 'Versão do jogo desatualizada: recarregue a página.');
    const room = this.room();
    if (!room) return this.deny(ws, 'Sala não encontrada.');
    const now = this.env.now();
    switch (h.mode) {
      case 'create': {
        if (room.state !== 'init' || this.seats().length || this.env.sockets().some((s) => s !== ws && s.att.hello)) return this.deny(ws, 'Sala já existe.');
        const nick = cleanNick(h.nickname);
        if (!nick) return this.deny(ws, 'Apelido inválido (1 a 20 caracteres).');
        const settings = h.settings && typeof h.settings === 'object' && !Array.isArray(h.settings) && JSON.stringify(h.settings).length < 4096 ? h.settings : {};
        this.putJson('room', { ...room, create: { settings, ...(h.restore === true ? { restore: true } : {}) } } satisfies RoomRec);
        ws.setAtt({ ...ws.att, hello: { mode: 'create', j: this.newJ(), pid: `p_${hex(this.env.random(6))}`, nick, spec: false } });
        return this.forwardJoin(ws);
      }
      case 'join': {
        if (room.state === 'init') return this.deny(ws, 'Sala não encontrada.');
        const nick = cleanNick(h.nickname);
        if (!nick) return this.deny(ws, 'Apelido inválido (1 a 20 caracteres).');
        if (h.spectator !== undefined && typeof h.spectator !== 'boolean') return this.deny(ws, 'spectator inválido.');
        const spec = h.spectator === true;
        const pending = this.env.sockets().filter((s) => s.att.hello && s !== ws).map((s) => s.att.hello!);
        const seats = this.seats();
        const managers = seats.filter((s) => !s.spec).length + pending.filter((x) => !x.spec).length;
        const specs = seats.filter((s) => s.spec).length + pending.filter((x) => x.spec).length;
        if (!spec && managers >= MAX_MANAGERS) return this.deny(ws, `Sala cheia (máximo ${MAX_MANAGERS} técnicos). Entre como espectador.`);
        if (spec && specs >= MAX_SPECTATORS) return this.deny(ws, `Já há ${MAX_SPECTATORS} espectadores nesta sala.`);
        ws.setAtt({ ...ws.att, hello: { mode: 'join', j: this.newJ(), pid: `p_${hex(this.env.random(6))}`, nick, spec } });
        return this.forwardJoin(ws);
      }
      case 'rejoin': {
        if (typeof h.token !== 'string' || h.token.length < 16 || h.token.length > 128) return this.deny(ws, 'Token inválido para esta sala.');
        const th = await this.env.sha256(h.token);
        const seat = this.seats().find((s) => s.th === th);
        if (!seat) return this.deny(ws, 'Token inválido para esta sala.');
        return this.bind(ws, seat, undefined, now);
      }
      case 'claim': {
        const code = typeof h.seatCode === 'string' ? h.seatCode.trim().toUpperCase() : '';
        if (!/^[A-Z0-9]{6}$/.test(code)) return this.deny(ws, 'Código de vaga inválido (6 caracteres).');
        const sh = await this.env.sha256(`seat:${code}`);
        const seat = this.seats().find((s) => s.sc && s.sc.h === sh && s.sc.exp > now);
        if (!seat) return this.deny(ws, 'Código de vaga inválido ou expirado. Peça um novo ao host.');
        let nick: string | undefined;
        if (h.nickname !== undefined && h.nickname !== null && h.nickname !== '') {
          const n = cleanNick(h.nickname);
          if (!n) return this.deny(ws, 'Apelido inválido (1 a 20 caracteres).');
          const m = this.meta();
          if ((m?.players ?? []).some((x) => x.id !== seat.p && x.nickname.toLowerCase() === n.toLowerCase())) return this.deny(ws, 'Já há alguém com este apelido na sala.');
          nick = n;
        }
        const token = b64url(this.env.random(24));
        const upd: Seat = { ...seat, th: await this.env.sha256(token), sc: null, ...(nick ? { nick } : {}) };
        this.putJson(`seat:${seat.p}`, upd);
        return this.bind(ws, upd, token, now, nick ?? '');
      }
      default:
        return this.deny(ws, 'Entrada inválida.');
    }
  }

  /** Liga a conexão a uma vaga existente (rejoin / código de vaga). */
  private bind(ws: RelaySocket, seat: Seat, token: string | undefined, now: number, claimNick?: string): void {
    for (const old of this.bound(seat.p)) {
      if (old === ws) continue;
      this.toClient(old, { t: 'ev', ev: 'error', a: { code: 'replaced', message: token ? 'Sua vaga foi assumida em outro aparelho.' : 'Você entrou na sala por outra conexão.' } });
      old.setAtt({ ...old.att, p: null });
      old.close(4001, 'replaced');
    }
    ws.setAtt({ ...ws.att, p: seat.p, hello: null, at: now });
    this.toClient(ws, { t: 'welcome', code: this.code, playerId: seat.p, ...(token ? { token } : {}) });
    const h = this.host();
    if (!h.c || h.lostAt || !this.sockByConn(h.c)) {
      if (!h.lostAt) this.elect();
      // anfitrião caído: a eleição (alarme) manda a vaga já conectada na lista `seats`
      return;
    }
    if (h.c === ws.att.c) return;
    if (claimNick !== undefined) this.toHost({ t: 'claim', c: ws.att.c, p: seat.p, ...(claimNick ? { nick: claimNick } : {}) });
    else this.toHost({ t: 'attach', c: ws.att.c, p: seat.p, nick: seat.nick, spec: seat.spec });
    this.sendHostInfo(ws);
  }

  private forwardJoin(ws: RelaySocket): void {
    const h = this.host();
    if (!h.c || h.lostAt || !this.sockByConn(h.c)) {
      if (h.lostAt && this.env.sockets().some((s) => s.att.c === h.c)) return; // eleição pendente: reenviado depois
      this.elect();
      return;
    }
    const x = ws.att.hello!;
    this.toHost({ t: 'join', j: x.j, c: ws.att.c, p: x.pid, nick: x.nick, spec: x.spec, ...(x.mode === 'create' ? { create: true } : {}) });
  }

  /* ── intenções ── */

  private limited(ws: RelaySocket, ev: string): string | null {
    const now = this.env.now();
    const c = ws.att.c;
    let r = this.rl.get(c);
    if (!r) this.rl.set(c, (r = { t: now, n: 0, chat: [], react: 0 }));
    if (now - r.t >= 1000) {
      r.t = now;
      r.n = 0;
    }
    if (++r.n > MSGS_PER_SEC) return 'Muitas requisições; aguarde um instante.';
    if (ev === 'chat:send') {
      r.chat = r.chat.filter((t) => now - t < CHAT_WINDOW_MS);
      if (r.chat.length >= CHAT_MAX) return 'Calma! Muitas mensagens seguidas.';
      r.chat.push(now);
    }
    if (ev === 'room:react') {
      if (now - r.react < REACT_GAP_MS) return 'Calma com as reações.';
      r.react = now;
    }
    return null;
  }

  private ack(ws: RelaySocket, k: number | undefined, r: { ok: true; data?: unknown } | { ok: false; error: string }): void {
    if (k !== undefined) this.toClient(ws, { t: 'ack', k, r });
    else if (!r.ok) this.toClient(ws, { t: 'ev', ev: 'error', a: { code: 'bad-request', message: r.error } });
  }

  private async onIntent(ws: RelaySocket, m: Record<string, unknown>): Promise<void> {
    const k = typeof m.k === 'number' && Number.isInteger(m.k) && m.k >= 0 && m.k < 2 ** 31 ? m.k : undefined;
    const ev = typeof m.ev === 'string' ? m.ev : '';
    const p = ws.att.p;
    if (!p) return this.ack(ws, k, { ok: false, error: 'Você não está em uma sala.' });
    if (!CLIENT_EVENTS.has(ev)) return this.ack(ws, k, { ok: false, error: 'Evento desconhecido.' });
    const lim = this.limited(ws, ev);
    if (lim) return this.ack(ws, k, { ok: false, error: lim });
    if (OWNER_EVENTS.has(ev) && this.owner() !== p) return this.ack(ws, k, { ok: false, error: 'Só o host da sala pode fazer isso.' });
    const a = m.a;
    if (ev === 'room:list') return this.ack(ws, k, { ok: false, error: 'Use a lista de salas abertas.' });
    if (ev === 'room:seat-code') return this.seatCode(ws, k, a);
    if (ev === 'room:end') return this.end(ws, k, a);
    if (!this.toHost({ t: 'i', c: ws.att.c, p, ev, ...(a !== undefined ? { a } : {}), ...(k !== undefined ? { k } : {}) })) {
      return this.ack(ws, k, { ok: false, error: 'Anfitrião da simulação reconectando… tente de novo em instantes.' });
    }
    if (ev === 'room:leave') {
      // a vaga fica (carreira) ou sai (lobby) conforme o anfitrião informar; a conexão deixa de falar pela vaga
      // (o ack da saída ainda chega: `lv`; antes ele se perdia e o cliente ficava esperando)
      ws.setAtt({ ...ws.att, p: null, lv: 1 });
    }
  }

  private async seatCode(ws: RelaySocket, k: number | undefined, a: unknown): Promise<void> {
    const pid = a && typeof a === 'object' ? (a as { playerId?: unknown }).playerId : undefined;
    const seat = typeof pid === 'string' && ID_RE.test(pid) ? this.seat(pid) : null;
    if (!seat || seat.spec) return this.ack(ws, k, { ok: false, error: 'Escolha um técnico da sala.' });
    this.ack(ws, k, { ok: true, data: await this.issueSeatCode(seat) });
  }

  /** Gera (e guarda só o hash de) um código de vaga de uso único para `seat`. */
  private async issueSeatCode(seat: Seat): Promise<{ seatCode: string; expiresAt: number }> {
    const bytes = this.env.random(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += SEAT_CODE_ALPHABET[bytes[i] % SEAT_CODE_ALPHABET.length];
    const exp = this.env.now() + SEAT_CODE_TTL_MS;
    this.putJson(`seat:${seat.p}`, { ...seat, sc: { h: await this.env.sha256(`seat:${code}`), exp } } satisfies Seat);
    return { seatCode: code, expiresAt: exp };
  }

  /**
   * Administração (dono do deploy, via ADMIN_KEY no Worker): código de vaga para um técnico mesmo com o dono da
   * sala desconectado (ex.: o próprio dono trocou de aparelho). Alvo pelo id da vaga ou pelo apelido exato
   * (sem diferenciar maiúsculas).
   */
  async adminSeatCode(target: unknown): Promise<{ ok: true; data: { playerId: string; nickname: string; seatCode: string; expiresAt: number } } | { ok: false; error: string }> {
    if (!this.room()) return { ok: false, error: 'Sala não encontrada.' };
    const t = typeof target === 'string' ? target.trim() : '';
    if (!t || t.length > 64) return { ok: false, error: 'Informe playerId ou nickname.' };
    const metaNick = new Map((this.meta()?.players ?? []).map((x) => [x.id, x.nickname]));
    const nickOf = (s: Seat) => metaNick.get(s.p) ?? s.nick;
    const managers = this.seats().filter((s) => !s.spec);
    const seat = managers.find((s) => s.p === t) ?? managers.find((s) => nickOf(s).toLowerCase() === t.toLowerCase());
    if (!seat) return { ok: false, error: `Técnico não encontrado. Vagas: ${managers.map((s) => `${nickOf(s)} (${s.p})`).join(', ')}` };
    const r = await this.issueSeatCode(seat);
    return { ok: true, data: { playerId: seat.p, nickname: nickOf(seat), ...r } };
  }

  private end(ws: RelaySocket, k: number | undefined, a: unknown): void {
    const confirm = a && typeof a === 'object' ? (a as { confirm?: unknown }).confirm : undefined;
    if (confirm !== this.code) return this.ack(ws, k, { ok: false, error: 'Confirme digitando o código da sala.' });
    const by = this.meta()?.players.find((p) => p.id === ws.att.p)?.nickname ?? this.seat(ws.att.p!)?.nick ?? '?';
    this.ack(ws, k, { ok: true });
    this.toHost({ t: 'ended' });
    for (const s of this.env.sockets()) {
      this.toClient(s, { t: 'ev', ev: 'room:ended', a: { code: this.code, by } });
      s.close(4002, 'ended');
    }
    this.wipe();
  }

  /* ── anfitrião ── */

  private async onHostFrame(buf: Uint8Array): Promise<void> {
    let hdr: HostHeader;
    let off: number;
    try {
      ({ hdr, offset: off } = readHostHeader(buf));
    } catch {
      return;
    }
    // corpos para os clientes (bytes repassados sem abrir)
    if (Array.isArray(hdr.o)) {
      for (const o of hdr.o.slice(0, 256)) {
        if (!o || !Number.isInteger(o.n) || o.n < 0 || off + o.n > buf.byteLength || !Array.isArray(o.to)) return;
        const body = buf.subarray(off, off + o.n);
        off += o.n;
        for (const c of o.to.slice(0, 32)) {
          if (typeof c !== 'string') continue;
          const s = this.sockByConn(c);
          if (!s || (!s.att.p && !s.att.hello && !s.att.lv)) continue;
          try {
            s.send(body);
            this.stats.toClients++;
          } catch {
            /* fechando */
          }
        }
      }
    }
    if (Array.isArray(hdr.joined)) for (const r of hdr.joined.slice(0, 16)) await this.onJoined(r);
    if (hdr.ck) this.onCkpt(hdr.ck, buf.subarray(off, off + (Number(hdr.ck.len) || 0)));
    if (hdr.meta) this.onMeta(hdr.meta);
    if (Array.isArray(hdr.drop)) for (const p of hdr.drop.slice(0, 16)) if (typeof p === 'string') this.revoke(p);
    if (Array.isArray(hdr.close)) {
      for (const c of hdr.close.slice(0, 16)) {
        const s = typeof c === 'string' ? this.sockByConn(c) : undefined;
        if (s && !this.isHost(s)) s.close(4001, 'replaced');
      }
    }
    if (hdr.destroyed === true) {
      const m = this.meta();
      if (!m || m.phase === 'lobby') this.wipe();
    }
  }

  private async onJoined(r: NonNullable<HostHeader['joined']>[number]): Promise<void> {
    if (!r || typeof r.j !== 'number') return;
    const ws = this.env.sockets().find((s) => s.att.hello?.j === r.j);
    if (!ws) return;
    const x = ws.att.hello!;
    if (!r.ok) {
      ws.setAtt({ ...ws.att, hello: null });
      this.deny(ws, typeof r.error === 'string' ? r.error.slice(0, 200) : 'Não foi possível entrar.');
      return;
    }
    // create + backup restaurado: o anfitrião devolve a vaga do host do backup
    const pid = x.mode === 'create' && typeof r.p === 'string' && ID_RE.test(r.p) ? r.p : x.pid;
    const token = b64url(this.env.random(24));
    const now = this.env.now();
    const prev = this.seat(pid);
    const seat: Seat = { p: pid, nick: x.nick, spec: x.spec, th: await this.env.sha256(token), sc: null, at: prev?.at ?? now, ls: null };
    this.putJson(`seat:${pid}`, seat);
    if (x.mode === 'create') {
      const room = this.room();
      if (room) this.putJson('room', { ...room, state: 'live', create: null } satisfies RoomRec);
    }
    ws.setAtt({ ...ws.att, p: pid, hello: null, at: now });
    const h = this.host();
    if (h.c === ws.att.c) this.putJson('host', { ...h, p: pid } satisfies HostRec);
    const data = r.data && typeof r.data === 'object' ? r.data : {};
    this.toClient(ws, { t: 'welcome', code: this.code, playerId: pid, token, data: { ...data, playerId: pid, token, ...(x.mode === 'create' ? { code: this.code } : {}) } });
    this.sendHostInfo(ws);
  }

  private onCkpt(ck: NonNullable<HostHeader['ck']>, bytes: Uint8Array): void {
    const id = typeof ck.id === 'string' && /^[0-9a-f]{1,32}$/.test(ck.id) ? ck.id : null;
    const n = Number(ck.n);
    const i = Number(ck.i);
    const size = Number(ck.size);
    if (!id || !Number.isInteger(n) || !Number.isInteger(i) || n < 1 || i < 0 || i >= n || size > MAX_CKPT_BYTES || n > Math.ceil(MAX_CKPT_BYTES / 1024)) return;
    if (bytes.byteLength !== Number(ck.len) || bytes.byteLength > CKPT_CHUNK * 4) return;
    let cur = this.staging && this.staging.id === id && this.staging.n === n ? this.staging : null;
    if (!cur) {
      // um pedaço do meio sem o começo (DO despejado durante o envio): ignora este checkpoint
      if (i !== 0) return;
      cur = this.staging = { id, n, size, parts: new Array<Uint8Array | null>(n).fill(null), got: 0 };
    }
    if (cur.parts[i]) return;
    cur.parts[i] = bytes.slice();
    cur.got++;
    this.stats.ckptChunks++;
    if (cur.got < n) return;
    this.staging = null;
    const all = new Uint8Array(cur.parts.reduce((s, p) => s + p!.byteLength, 0));
    let at = 0;
    for (const p of cur.parts) {
      all.set(p!, at);
      at += p!.byteLength;
    }
    if (all.byteLength !== size) return;
    // completo: troca atômica. Linhas grandes, regravadas no lugar (UPSERT de chave existente = 1 linha gravada);
    // só as linhas que sobraram do checkpoint anterior são apagadas.
    const st = this.env.storage;
    const prev = this.ck();
    const prevRows = prev ? prev.r ?? prev.n : 0;
    const rows = Math.max(1, Math.ceil(size / CKPT_ROW));
    st.transaction(() => {
      for (let k = 0; k < rows; k++) st.putBlob(`ck:${k}`, all.slice(k * CKPT_ROW, Math.min(size, (k + 1) * CKPT_ROW)));
      for (let k = rows; k < prevRows; k++) st.delBlob(`ck:${k}`);
      // staging persistido da versão antiga do relay
      if (st.get('cks') !== null) {
        st.delBlobs('cks:');
        st.del('cks');
      }
      this.putJson('ck', { id, n: Math.max(1, Math.ceil(size / CKPT_CHUNK)), size, at: this.env.now(), r: rows } satisfies CkRec);
    });
  }

  private onMeta(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as RoomMetaLite;
    if (typeof m.phase !== 'string' || !Array.isArray(m.players) || m.players.length > 12 || typeof m.hostId !== 'string') return;
    const json = JSON.stringify(m);
    if (json.length > 16 * 1024) return;
    const prev = this.meta();
    // só a "última atividade" mudou (cada ação do planejamento): regrava no máximo a cada 10 min (é só o
    // "atividade há X" de Minhas carreiras) — cada gravação é uma linha no orçamento diário do plano Free
    const sameButActivity =
      !!prev && JSON.stringify({ ...prev, lastActivity: 0 }) === JSON.stringify({ ...m, lastActivity: 0 }) && Math.abs((m.lastActivity ?? 0) - (prev.lastActivity ?? 0)) < META_ACTIVITY_MS;
    if (!sameButActivity) this.env.storage.put('meta', json);
    // vagas que o anfitrião conhece e o relay não (sala restaurada de backup): sem dono até alguém usar um código
    const now = this.env.now();
    for (const p of m.players.slice(0, 12)) {
      if (typeof p?.id !== 'string' || !ID_RE.test(p.id) || this.seat(p.id)) continue;
      if (this.seats().length >= MAX_MANAGERS + MAX_SPECTATORS) break;
      this.putJson(`seat:${p.id}`, { p: p.id, nick: cleanNick(p.nickname) ?? 'Técnico', spec: !!p.spectator, th: null, sc: null, at: now, ls: null } satisfies Seat);
    }
    const pubKey = JSON.stringify(m.pub ?? null);
    if (pubKey !== JSON.stringify(prev?.pub ?? null)) void this.env.publish(this.code, m.pub ? { ...m.pub, code: this.code } : null);
  }

  /** Vaga revogada (saiu no lobby / expulsa): some o token e a conexão cai. */
  private revoke(p: string): void {
    if (!this.seat(p)) return;
    this.env.storage.del(`seat:${p}`);
    for (const s of this.bound(p)) {
      s.setAtt({ ...s.att, p: null });
      if (!this.isHost(s)) s.close(4003, 'left');
    }
  }

  /* ── eleição / failover ── */

  /** Escolhe o anfitrião entre as conexões: dono da sala, técnicos (ordem de entrada), espectadores, pendentes. */
  elect(): void {
    const socks = this.env.sockets();
    const seats = new Map(this.seats().map((s) => [s.p, s]));
    const owner = this.owner();
    // [classe, ordem]: dono da sala → técnicos (ordem de entrada) → espectadores → entradas pendentes
    const rank = (s: RelaySocket): [number, number] => {
      if (s.att.p) {
        if (s.att.p === owner) return [0, 0];
        const seat = seats.get(s.att.p);
        return seat?.spec ? [2, seat.at] : [1, seat?.at ?? s.att.at];
      }
      return s.att.hello ? [3, s.att.at] : [9, 0];
    };
    const cands = socks.filter((s) => rank(s)[0] < 9).sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
    const prev = this.host();
    const st = this.env.storage;
    st.del('electAt');
    if (!cands.length) {
      this.putJson('host', { c: null, p: null, epoch: prev.epoch } satisfies HostRec);
      this.reschedule();
      return;
    }
    const ws = cands[0];
    const rec: HostRec = { c: ws.att.c, p: ws.att.p, epoch: prev.epoch + 1, lostAt: null };
    this.putJson('host', rec);
    const room = this.room();
    const ck = this.ck();
    const meta = this.meta();
    const online = new Map(socks.filter((s) => s.att.p).map((s) => [s.att.p!, s.att.c]));
    const seatList: SeatInfo[] = [...seats.values()].map((s) => ({ p: s.p, nick: s.nick, spec: s.spec, c: online.get(s.p) ?? null }));
    this.sendJson(ws, {
      t: 'role', epoch: rec.epoch, code: this.code, ckpt: ck ? { n: ck.n, size: ck.size } : null, seats: seatList,
      ...(room?.state === 'init' && room.create ? { create: room.create } : {}),
      replay: !!(ck && meta?.advancing),
    });
    if (ck) for (const [i, b] of this.ckChunks(ck)) ws.send(encodeCkptChunk(i, ck.n, b));
    // entradas pendentes vão para o novo anfitrião (a do próprio anfitrião também)
    for (const s of socks) if (s.att.hello) this.toHost({ t: 'join', j: s.att.hello.j, c: s.att.c, p: s.att.hello.pid, nick: s.att.hello.nick, spec: s.att.hello.spec, ...(s.att.hello.mode === 'create' ? { create: true } : {}) });
    const failover = prev.epoch > 0 && (prev.c !== rec.c || !!prev.lostAt);
    for (const s of socks) if (s.att.p || s.att.hello) this.sendHostInfo(s, failover ? 'resuming' : 'ok');
    this.env.log?.('host elected', { room: this.code, c: rec.c, p: rec.p, epoch: rec.epoch, failover, ckpt: ck?.size ?? 0 });
  }

  /** Pedaços do checkpoint guardado, no tamanho do fio (formato antigo: uma linha por pedaço). */
  private ckChunks(ck: CkRec): [number, Uint8Array][] {
    const st = this.env.storage;
    if (ck.r === undefined) {
      const out: [number, Uint8Array][] = [];
      for (let i = 0; i < ck.n; i++) {
        const b = st.getBlob(`ck:${i}`);
        if (b) out.push([i, b]);
      }
      return out;
    }
    const rows: Uint8Array[] = [];
    for (let k = 0; k < ck.r; k++) {
      const b = st.getBlob(`ck:${k}`);
      if (!b) return [];
      rows.push(b);
    }
    const all = rows.length === 1 ? rows[0] : new Uint8Array(rows.reduce((s, b) => s + b.byteLength, 0));
    if (rows.length > 1) {
      let at = 0;
      for (const b of rows) {
        all.set(b, at);
        at += b.byteLength;
      }
    }
    if (all.byteLength !== ck.size) return [];
    const out: [number, Uint8Array][] = [];
    for (let i = 0; i < ck.n; i++) out.push([i, all.subarray(i * CKPT_CHUNK, Math.min(ck.size, (i + 1) * CKPT_CHUNK))]);
    return out;
  }

  private sendHostInfo(ws: RelaySocket, state: 'ok' | 'lost' | 'resuming' = 'ok'): void {
    const h = this.host();
    const nick = h.p ? this.meta()?.players.find((x) => x.id === h.p)?.nickname ?? this.seat(h.p)?.nick ?? null : null;
    this.toClient(ws, { t: 'host', playerId: h.p, nickname: nick, me: !!h.c && h.c === ws.att.c, epoch: h.epoch, state: h.lostAt ? 'lost' : state });
  }

  onClose(ws: RelaySocket): void {
    const att = ws.att;
    const now = this.env.now();
    this.rl.delete(att.c);
    const others = this.env.sockets().filter((s) => s !== ws && s.att.c !== att.c);
    if (att.p) {
      const seat = this.seat(att.p);
      if (seat) this.putJson(`seat:${att.p}`, { ...seat, ls: now } satisfies Seat);
    }
    const h = this.host();
    if (h.c === att.c) {
      // anfitrião caiu: tolerância curta e eleição (o novo carrega o checkpoint)
      const live = others.filter((s) => s.att.p || s.att.hello);
      if (live.length) {
        this.putJson('host', { ...h, lostAt: now } satisfies HostRec);
        this.env.storage.put('electAt', String(now + HOST_GRACE_MS));
        for (const s of live) this.sendHostInfo(s, 'lost');
      } else {
        this.putJson('host', { c: null, p: null, epoch: h.epoch } satisfies HostRec);
      }
    } else if (att.p) {
      this.toHost({ t: 'detach', c: att.c, p: att.p });
    } else if (att.hello) {
      this.toHost({ t: 'detach', c: att.c, p: att.hello.pid });
    }
    if (!others.length) {
      const m = this.meta();
      const room = this.room();
      if (room && (!m || m.phase === 'lobby')) this.scheduleExpiry(now + (room.state === 'init' ? INIT_TTL_MS : LOBBY_TTL_MS));
      if (m?.pub) void this.env.publish(this.code, null);
    }
    this.reschedule();
  }

  async onAlarm(): Promise<void> {
    const now = this.env.now();
    const st = this.env.storage;
    const electAt = Number(st.get('electAt') ?? 0);
    if (electAt && electAt <= now) this.elect();
    const expireAt = Number(st.get('expireAt') ?? 0);
    if (expireAt && expireAt <= now) {
      st.del('expireAt');
      const m = this.meta();
      if (!this.env.sockets().length && (!m || m.phase === 'lobby')) {
        this.env.log?.('lobby expired', { room: this.code });
        this.wipe();
        return;
      }
    }
    this.reschedule();
  }

  private scheduleExpiry(at: number): void {
    this.env.storage.put('expireAt', String(at));
    this.reschedule();
  }

  private clearExpiry(): void {
    if (this.env.storage.get('expireAt') === null) return;
    this.env.storage.del('expireAt');
    this.reschedule();
  }

  private reschedule(): void {
    const st = this.env.storage;
    const times = [Number(st.get('electAt') ?? 0), Number(st.get('expireAt') ?? 0)].filter((x) => x > 0);
    let at: number | null = null;
    for (const t of times) if (at === null || t < at) at = t;
    this.env.setAlarm(at);
  }

  /** Apaga a sala (lobby expirado / carreira encerrada pelo host). */
  wipe(): void {
    void this.env.publish(this.code, null);
    this.env.storage.deleteAll();
    this.env.setAlarm(null);
    for (const s of this.env.sockets()) s.close(4002, 'ended');
  }
}
