/**
 * ANFITRIÃO DA SIMULAÇÃO (online grátis: GitHub Pages + Cloudflare). Roda a MESMA sala autoritativa do servidor
 * Node (`Room` + simulador inline) dentro do navegador de um dos jogadores (Web Worker) — ou no Node, nos testes.
 *
 * O relay (Durable Object) não simula nada: autentica as vagas, elege o anfitrião, repassa as intenções dos
 * clientes para cá e os nossos eventos para os clientes, e guarda o checkpoint.
 *
 *   DO ──RelayToHost (texto)──▶ HostRuntime.handle()  ─▶ Room (via VirtualIO = "Socket.io de mentira")
 *   DO ◀──quadro 0x20 (binário)── flush(): eventos em lote por destino + meta + checkpoint + vagas que saíram
 *
 * Checkpoint = gzip(JSON(RoomSnapshot)) — o mesmo snapshot do disco do servidor Node. É gravado no lobby, no
 * planejamento e no fim de temporada (com debounce) e LOGO ANTES de cada rodada começar a simular
 * (`ctx.beforeAdvance`): se o anfitrião cair no meio do dia, o próximo carrega esse checkpoint e rejoga o dia.
 */
import { applySettingsPatch, fullSettings } from './lobby.ts';
import { countryPlayable } from './career-data.ts';
import { makeBackup, parseBackup } from './backup.ts';
import type { GameData } from './data.ts';
import { roomIntent, runHandler, type AckResult } from './dispatch.ts';
import type { CoreBroadcast, CoreIO, CoreSocket } from './io.ts';
import { defaultRoomOptions, type RoomOptions } from './options.ts';
import { fromUtf8, gunzip, gzip, randomBytes, toHex, utf8 } from './platform.ts';
import type { SocketData } from './protocol.ts';
import { DEFAULT_SETTINGS, GameError, newToken, Room, type PlayerRec, type RoomContext, type RoomSnapshot } from './room.ts';
import type { SimRunner } from './sim-runner.ts';
import * as V from './validate.ts';
import {
  CKPT_CHUNK, decodeCkptChunk, encodeBundle, encodeHostFrame, fragment, FRAG_BYTES, MAX_HOST_FRAME, T_CKPT,
  type HostHeader, type RelayToHost, type RoomMetaLite, type SeatInfo, type WireMsg,
} from './wire.ts';

export interface HostEnv {
  data: GameData;
  sim: SimRunner;
  opts?: Partial<RoomOptions>;
  /** quadro binário para o relay (WebSocket) */
  send(frame: Uint8Array): void;
  log?(msg: string, extra?: Record<string, unknown>): void;
  /** create + restore: bytes do arquivo de backup escolhido por quem cria (só no navegador dele) */
  restoreBytes?(): Promise<Uint8Array | null>;
  maxBackupBytes?: number;
  /** janela de lote (ms): normal e com partidas ao vivo (ticks em lote; o cliente reproduz no ritmo original) */
  flushMs?: number;
  liveFlushMs?: number;
  /** intervalo mínimo entre checkpoints no mesmo dia/fase (padrão CKPT_DELAY_MS) */
  ckptDelayMs?: number;
  /** checkpoint logo depois de mudar de fase/dia (padrão CKPT_FAST_MS, nunca maior que ckptDelayMs) */
  ckptFastMs?: number;
  /** avisos para a UI do anfitrião (carregando, pronto, erro) */
  status?(s: { state: 'loading' | 'ready' | 'error' | 'stopped'; message?: string }): void;
}

/**
 * Checkpoint (cada um custa linhas gravadas no SQLite do Durable Object; o plano Free permite 100 mil por dia):
 * no mesmo dia/fase, no máximo um a cada CKPT_DELAY_MS — mexer na escalação o tempo todo não vira um checkpoint a
 * cada 1,5 s. Mudou de fase ou de dia (carreira começou, rodada terminou, virada): sai em CKPT_FAST_MS. Antes de
 * simular o dia (`beforeAdvance`) ele sai na hora, então uma queda do anfitrião perde no máximo isso do planejamento.
 */
export const CKPT_DELAY_MS = 20_000;
export const CKPT_FAST_MS = 1500;

interface OutItem {
  to: string[];
  msg: WireMsg;
  at: number;
}

/* ───────────── Socket.io de mentira ───────────── */

class VirtualSocket implements CoreSocket {
  readonly id: string;
  data: SocketData = { code: null, playerId: null };
  readonly rooms = new Set<string>();
  private readonly host: HostRuntime;

  constructor(id: string, host: HostRuntime) {
    this.id = id;
    this.host = host;
  }

  emit = ((ev: string, ...args: unknown[]) => {
    this.host.push([this.id], ev, args[0]);
    return true;
  }) as CoreSocket['emit'];

  join(ch: string): void {
    this.rooms.add(ch);
  }

  leave(ch: string): void {
    this.rooms.delete(ch);
  }

  disconnect(): void {
    this.host.dropSocket(this.id, true);
  }
}

class VirtualIO implements CoreIO {
  readonly socks = new Map<string, VirtualSocket>();
  readonly sockets = { sockets: { get: (id: string): CoreSocket | undefined => this.socks.get(id) } };
  private readonly host: HostRuntime;

  constructor(host: HostRuntime) {
    this.host = host;
  }

  /** conexão (id) ou canal (sala / partida) → ids de conexão */
  resolve(target: string): string[] {
    if (this.socks.has(target)) return [target];
    return [...this.socks.values()].filter((s) => s.rooms.has(target)).map((s) => s.id);
  }

  to(target: string): CoreBroadcast {
    const emit = ((ev: string, ...args: unknown[]) => {
      const to = this.resolve(target);
      if (to.length) this.host.push(to, ev, args[0]);
      return true;
    }) as CoreBroadcast['emit'];
    return { emit, compress: () => ({ emit }) };
  }

  in(target: string): { socketsLeave(ch: string): void } {
    return {
      socketsLeave: (ch: string) => {
        for (const id of this.resolve(target)) this.socks.get(id)?.leave(ch);
      },
    };
  }
}

/* ───────────── anfitrião ───────────── */

export class HostRuntime {
  room: Room | null = null;
  readonly io: VirtualIO;
  readonly opts: RoomOptions;
  private readonly env: HostEnv;
  private readonly ctx: RoomContext;
  private queue: OutItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ckptTimer: ReturnType<typeof setTimeout> | null = null;
  private ckptDirty = false;
  /** quando o timer do checkpoint vence (ms) */
  private ckptDue = 0;
  /** fase/temporada/dia do último checkpoint */
  private ckptKey = '';
  /** impressão digital do último checkpoint (sem horários): estado igual não é regravado */
  private ckptFp: { small: string; state: string | null; world: string | null; advancing: boolean } | null = null;
  private pendingCkpt: { id: string; size: number; chunks: Uint8Array[] } | null = null;
  /** a rodada começou a simular e o checkpoint pós-rodada ainda não saiu: failover rejoga o dia */
  private advancedSinceCkpt = false;
  private lastMeta = '';
  private joined: NonNullable<HostHeader['joined']> = [];
  private closeConns: string[] = [];
  private knownPids = new Set<string>();
  private destroyed = false;
  private stopped = false;
  private chain: Promise<unknown> = Promise.resolve();
  private loader: { n: number; size: number; got: number; parts: (Uint8Array | null)[]; done: (b: Uint8Array) => void } | null = null;
  private ckptBytes: Promise<Uint8Array> | null = null;
  private fragSeq = Math.floor(Math.random() * 1e9);
  /** métricas (testes / orçamento de requisições) */
  readonly stats = { frames: 0, bytes: 0, ckptFrames: 0, ckptBytes: 0, ckpts: 0, ckptSkipped: 0 };

  constructor(env: HostEnv) {
    this.env = env;
    this.opts = defaultRoomOptions(env.opts ?? {});
    this.io = new VirtualIO(this);
    this.ctx = {
      io: this.io, data: env.data, opts: this.opts, sim: env.sim,
      log: (msg, extra) => env.log?.(msg, extra),
      persist: () => this.markDirty(),
      destroy: (room) => {
        room.dispose();
        this.destroyed = true;
        this.scheduleFlush(0);
      },
      beforeAdvance: () => this.checkpointNow(true),
    };
  }

  private log(msg: string, extra?: Record<string, unknown>): void {
    this.env.log?.(msg, extra);
  }

  /* ── entrada (mensagens do relay) ── */

  /** Mensagem do relay: texto (JSON já parseado) ou binário (pedaço de checkpoint). Processadas em ordem. */
  handle(msg: RelayToHost | Uint8Array): Promise<void> {
    if (msg instanceof Uint8Array) {
      if (msg[0] === T_CKPT) this.onChunk(msg);
      return Promise.resolve();
    }
    if (msg.t === 'role' && msg.ckpt && msg.ckpt.n > 0) {
      // os pedaços chegam logo depois do 'role' (antes de ele ser processado): prepara a montagem já
      const n = msg.ckpt.n;
      this.ckptBytes = new Promise<Uint8Array>((done) => {
        this.loader = { n, size: msg.ckpt!.size, got: 0, parts: new Array(n).fill(null), done };
      });
    }
    const p = this.chain.then(() => this.process(msg)).catch((e) => this.log('host: erro processando mensagem', { t: msg.t, error: String(e) }));
    this.chain = p;
    return p;
  }

  private onChunk(buf: Uint8Array): void {
    const { i, n, bytes } = decodeCkptChunk(buf);
    const l = this.loader;
    if (!l || n !== l.n || l.parts[i]) return;
    l.parts[i] = bytes.slice();
    l.got++;
    if (l.got === l.n) {
      this.loader = null;
      const all = new Uint8Array(l.parts.reduce((s, p) => s + p!.byteLength, 0));
      let at = 0;
      for (const p of l.parts) {
        all.set(p!, at);
        at += p!.byteLength;
      }
      l.done(all);
    }
  }

  private async process(m: RelayToHost): Promise<void> {
    if (this.stopped) return;
    switch (m.t) {
      case 'role':
        return this.onRole(m);
      case 'join':
        return this.onJoin(m);
      case 'attach':
        return this.onAttach(m.c, m.p, m.nick, m.spec);
      case 'detach': {
        const p = this.room?.player(m.p);
        const s = this.io.socks.get(m.c);
        if (p && p.socketId === m.c) this.room!.detach(p);
        if (s) this.io.socks.delete(m.c);
        return;
      }
      case 'claim':
        return this.onClaim(m.c, m.p, m.nick);
      case 'i':
        return this.onIntent(m.c, m.p, m.ev, m.a, m.k);
      case 'ended':
      case 'demoted':
        this.stop();
        return;
    }
  }

  private async onRole(m: Extract<RelayToHost, { t: 'role' }>): Promise<void> {
    this.env.status?.({ state: 'loading' });
    let room: Room | null = null;
    try {
      if (m.ckpt && m.ckpt.n > 0) {
        const bytes = await this.ckptBytes!;
        this.ckptBytes = null;
        const snap = JSON.parse(fromUtf8(gunzip(bytes))) as RoomSnapshot;
        room = Room.fromSnapshot(this.ctx, { ...snap, code: m.code });
        if (room.needsHydrate) await room.restore();
      } else if (m.create?.restore) {
        const bytes = (await this.env.restoreBytes?.()) ?? null;
        if (!bytes) throw new GameError('Arquivo de backup não encontrado.');
        const snap = parseBackup(bytes, this.env.maxBackupBytes ?? 30 * 1024 * 1024);
        for (const p of snap.players) p.token = newToken();
        room = Room.fromSnapshot(this.ctx, { ...snap, code: m.code });
        if (snap.career && room.phase === 'lobby') throw new V.ValidationError('Carreira do backup é de uma versão antiga (não pode ser restaurada).');
        if (room.needsHydrate) {
          await room.restore();
          if (room.phase === 'lobby' && snap.career) throw new V.ValidationError('Não foi possível ler a carreira do backup.');
        }
        this.restoredFromBackup = true;
      } else {
        const settings = fullSettings(DEFAULT_SETTINGS);
        if (this.opts.roomDefaults) applySettingsPatch(settings, this.opts.roomDefaults, true);
        if (m.create?.settings) {
          try {
            applySettingsPatch(settings, V.obj(m.create.settings, 'Configurações'), true);
          } catch (e) {
            this.createError = e instanceof Error ? e.message : String(e);
          }
        }
        if (!countryPlayable({ leagues: this.env.data.leagues() }, settings.countryId)) settings.countryId = DEFAULT_SETTINGS.countryId;
        room = new Room(this.ctx, m.code, settings);
      }
    } catch (e) {
      const msg = e instanceof V.ValidationError || e instanceof GameError ? e.message : 'Não foi possível carregar a sala.';
      this.log('host: falha ao carregar a sala', { error: String(e) });
      this.env.status?.({ state: 'error', message: msg });
      this.createError = msg;
      if (!room) room = new Room(this.ctx, m.code, fullSettings(DEFAULT_SETTINGS));
    }
    this.room = room;
    for (const p of room.players) this.knownPids.add(p.id);
    // vagas que o relay conhece e o checkpoint não tem (entraram depois do último checkpoint)
    for (const s of m.seats) this.ensurePlayer(s.p, s.nick, s.spec);
    for (const s of m.seats.filter((x): x is SeatInfo & { c: string } => !!x.c)) this.attachConn(s.c, room.player(s.p)!);
    this.env.status?.({ state: 'ready' });
    if (m.replay && room.phase === 'planning' && room.career) {
      void room.replayAdvance().catch((e) => this.log('host: replay falhou', { error: String(e) }));
    }
    this.scheduleFlush(0);
  }

  private restoredFromBackup = false;
  private createError: string | null = null;

  private ensurePlayer(pid: string, nick: string, spec: boolean): PlayerRec {
    const room = this.room!;
    let p = room.player(pid);
    if (!p) {
      p = room.addPlayer(V.nickname(nick), { id: pid, spectator: spec, force: true });
      if (room.phase !== 'lobby' && room.career && !spec) void room.registerLateJoiner(p);
    }
    this.knownPids.add(pid);
    return p;
  }

  private sock(c: string): VirtualSocket {
    let s = this.io.socks.get(c);
    if (!s) {
      s = new VirtualSocket(c, this);
      this.io.socks.set(c, s);
    }
    return s;
  }

  private attachConn(c: string, p: PlayerRec): void {
    const room = this.room!;
    const s = this.sock(c);
    s.data.code = room.code;
    s.data.playerId = p.id;
    room.attach(p, c);
    room.sendFullState(p);
  }

  private onJoin(m: Extract<RelayToHost, { t: 'join' }>): void {
    const room = this.room;
    const reply = (r: NonNullable<HostHeader['joined']>[number]) => {
      this.joined.push(r);
      this.scheduleFlush(0);
    };
    if (!room) return reply({ j: m.j, ok: false, error: 'Sala indisponível.' });
    if (m.create && this.createError) return reply({ j: m.j, ok: false, error: this.createError });
    try {
      if (m.create && this.restoredFromBackup) {
        // quem restaura fica com a vaga do host do backup
        const host = room.player(room.hostId)!;
        const s = this.sock(m.c);
        s.data = { code: room.code, playerId: host.id };
        room.attach(host, m.c);
        room.sendFullState(host);
        this.knownPids.add(host.id);
        return reply({ j: m.j, ok: true, p: host.id, data: { code: room.code, playerId: host.id } });
      }
      const p = room.addPlayer(V.nickname(m.nick), { spectator: m.spec, id: m.p });
      this.knownPids.add(p.id);
      const s = this.sock(m.c);
      s.data = { code: room.code, playerId: p.id };
      room.attach(p, m.c);
      if (room.phase !== 'lobby') {
        room.sendFullState(p);
        if (!p.spectator) void room.registerLateJoiner(p);
      }
      const data: Record<string, unknown> = m.create
        ? { code: room.code, playerId: p.id }
        : { playerId: p.id, ...(p.spectator ? { spectator: true } : {}), ...(!p.spectator && room.phase !== 'lobby' ? { unemployed: true } : {}) };
      reply({ j: m.j, ok: true, p: p.id, data });
    } catch (e) {
      reply({ j: m.j, ok: false, error: e instanceof V.ValidationError || e instanceof GameError ? e.message : 'Não foi possível entrar.' });
    }
  }

  private onAttach(c: string, pid: string, nick: string, spec: boolean): void {
    if (!this.room) return;
    const p = this.ensurePlayer(pid, nick, spec);
    this.attachConn(c, p);
  }

  private onClaim(c: string, pid: string, nick?: string): void {
    if (!this.room) return;
    const p = this.room.player(pid) ?? this.ensurePlayer(pid, nick || 'Técnico', false);
    try {
      this.room.reassignSeat(p, nick);
    } catch {
      this.room.reassignSeat(p, undefined);
    }
    this.attachConn(c, p);
  }

  private ack(c: string, k: number | undefined, r: AckResult): void {
    if (k === undefined) return;
    this.push([c], '@ack', { k, r });
  }

  private onIntent(c: string, pid: string, ev: string, a: unknown, k: number | undefined): void {
    const room = this.room;
    const ack = (r: AckResult) => this.ack(c, k, r);
    const s = this.io.socks.get(c);
    const player = room?.player(pid);
    if (!room || !player || !s || s.data.playerId !== pid) return ack({ ok: false, error: 'Você não está em uma sala.' });
    const log = (msg: string, extra?: Record<string, unknown>) => this.log(msg, extra);
    const userError = k === undefined ? (message: string) => this.push([c], 'error', { code: 'bad-request', message }) : undefined;
    switch (ev) {
      case 'room:leave':
        // carreira em andamento: sair = desconectar mantendo a vaga (volta pela lista)
        if (player.socketId === c) {
          if (room.phase !== 'lobby' && room.career && !player.spectator) room.detach(player);
          else room.leave(player);
        }
        this.io.socks.delete(c);
        return ack({ ok: true, data: undefined });
      case 'room:rejoin':
        room.sendFullState(player);
        return ack({ ok: true, data: { playerId: player.id } });
      case 'room:backup':
        return runHandler(() => {
          if (player.id !== room.hostId) throw new GameError('Só o host baixa o backup.');
          const bytes = makeBackup(room.toSnapshot());
          const day = (room.career?.date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '');
          return { name: `cosmicfut-${room.code}-${day}.json.gz`, bytes };
        }, ack, log, userError);
      default:
        return runHandler(() => roomIntent(room, player, ev, a), ack, log, userError);
    }
  }

  /* ── saída ── */

  push(to: string[], ev: string, a: unknown): void {
    if (this.stopped) return;
    this.queue.push({ to, msg: { ev, a }, at: Date.now() });
    this.scheduleFlush();
  }

  dropSocket(id: string, close: boolean): void {
    this.io.socks.delete(id);
    if (close) this.closeConns.push(id);
    this.scheduleFlush(0);
  }

  private live(): boolean {
    return !!this.room && this.room.matches.size > 0;
  }

  private scheduleFlush(ms?: number): void {
    if (this.stopped) return;
    const wait = ms ?? (this.live() ? this.env.liveFlushMs ?? 1000 : this.env.flushMs ?? 50);
    if (this.flushTimer) {
      if (wait > 0) return;
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, wait);
  }

  meta(): RoomMetaLite | null {
    const r = this.room;
    if (!r) return null;
    return {
      phase: r.phase, season: r.career?.season ?? null, date: r.career?.date ?? null, hostId: r.hostId,
      turnOf: r.turn?.playerId ? r.player(r.turn.playerId)?.nickname ?? null : null,
      lastActivity: r.lastActivity,
      advancing: (this.advancedSinceCkpt || r.phase === 'simulating' || r.phase === 'matchday') && !r.skip && !!r.career,
      pub: r.listed() ? (({ code: _c, host, hostClubId, players, maxPlayers, preset, turnMode, pickMode, createdAt }) => ({ host, hostClubId, players, maxPlayers, preset, turnMode, pickMode, createdAt }))(r.publicInfo()) : null,
      players: r.players.map((p) => ({
        id: p.id, nickname: p.nickname, clubId: p.clubId, color: p.color,
        ...(p.spectator ? { spectator: true } : {}), ...(r.isUnemployed(p) ? { unemployed: true } : {}),
      })),
      settings: { ...r.settings, divisionIds: [] },
    };
  }

  /** Envia tudo o que está na fila (lotes por destino) + meta + respostas + checkpoint pendente. */
  flush(): void {
    if (this.stopped) return;
    const items = this.queue;
    this.queue = [];
    // lotes: itens consecutivos com o mesmo destino viram um corpo só
    const bodies: { to: string[]; bytes: Uint8Array }[] = [];
    let cur: { key: string; to: string[]; msgs: WireMsg[]; t0: number } | null = null;
    const close = () => {
      if (!cur) return;
      const frame = encodeBundle(cur.msgs);
      for (const f of fragment(frame, ++this.fragSeq, FRAG_BYTES)) bodies.push({ to: cur.to, bytes: f });
      cur = null;
    };
    for (const it of items) {
      const key = it.to.join(',');
      if (!cur || cur.key !== key) {
        close();
        cur = { key, to: it.to, msgs: [], t0: it.at };
      }
      cur.msgs.push({ ...it.msg, dt: it.at - cur.t0 });
    }
    close();

    const hdr: HostHeader = {};
    const meta = this.meta();
    const metaJson = meta ? JSON.stringify(meta) : '';
    if (meta && metaJson !== this.lastMeta) {
      hdr.meta = meta;
      this.lastMeta = metaJson;
    }
    if (this.joined.length) hdr.joined = this.joined.splice(0);
    if (this.closeConns.length) hdr.close = this.closeConns.splice(0);
    if (this.room) {
      const now = new Set(this.room.players.map((p) => p.id));
      const drop = [...this.knownPids].filter((p) => !now.has(p));
      if (drop.length) hdr.drop = drop;
      this.knownPids = now;
    }
    if (this.destroyed) hdr.destroyed = true;

    // quadros de no máximo MAX_HOST_FRAME; o cabeçalho (meta, respostas, vagas) vai no 1º
    const frames: { to: string[]; bytes: Uint8Array }[][] = [[]];
    let size = 0;
    for (const b of bodies) {
      if (size + b.bytes.byteLength > MAX_HOST_FRAME - 8192 && frames[frames.length - 1].length) {
        frames.push([]);
        size = 0;
      }
      frames[frames.length - 1].push(b);
      size += b.bytes.byteLength;
    }
    frames.forEach((batch, i) => {
      const h: HostHeader = i === 0 ? { ...hdr } : {};
      if (batch.length) h.o = batch.map((b) => ({ to: b.to, n: b.bytes.byteLength }));
      if (!Object.keys(h).length) return;
      this.emitFrame(encodeHostFrame(h, batch.map((b) => b.bytes)));
    });
    // checkpoint: um quadro por pedaço
    const ck = this.pendingCkpt;
    if (ck) {
      this.pendingCkpt = null;
      ck.chunks.forEach((chunk, i) => {
        const h: HostHeader = { ck: { id: ck.id, i, n: ck.chunks.length, size: ck.size, len: chunk.byteLength } };
        if (i === ck.chunks.length - 1) {
          // o meta vai junto do último pedaço (o DO grava os dois juntos)
          const m = this.meta();
          if (m) {
            h.meta = m;
            this.lastMeta = JSON.stringify(m);
          }
        }
        this.stats.ckptFrames++;
        this.stats.ckptBytes += chunk.byteLength;
        this.emitFrame(encodeHostFrame(h, [], chunk));
      });
    }
    if (this.destroyed) this.stop();
  }

  private emitFrame(f: Uint8Array): void {
    this.stats.frames++;
    this.stats.bytes += f.byteLength;
    try {
      this.env.send(f);
    } catch (e) {
      this.log('host: falha ao enviar quadro', { error: String(e) });
    }
  }

  /* ── checkpoint ── */

  private stageKey(): string {
    const r = this.room;
    return r ? `${r.phase}|${r.career?.season ?? ''}|${r.career?.date ?? ''}` : '';
  }

  private markDirty(): void {
    this.ckptDirty = true;
    if (this.stopped) return;
    const slow = this.env.ckptDelayMs ?? CKPT_DELAY_MS;
    const delay = this.stageKey() !== this.ckptKey ? Math.min(slow, this.env.ckptFastMs ?? CKPT_FAST_MS) : slow;
    const due = Date.now() + delay;
    if (this.ckptTimer) {
      if (this.ckptDue <= due) return;
      clearTimeout(this.ckptTimer);
    }
    this.ckptDue = due;
    this.ckptTimer = setTimeout(() => {
      this.ckptTimer = null;
      this.checkpointIfStable();
    }, delay);
    this.scheduleFlush();
  }

  private checkpointIfStable(): void {
    const r = this.room;
    if (!r || !this.ckptDirty || this.stopped || this.destroyed) return;
    const stable = (r.phase === 'lobby' || r.phase === 'planning' || r.phase === 'season-end') && !r.skip;
    if (!stable) {
      // rodada em andamento: o checkpoint do planejamento continua valendo; tenta de novo depois
      this.markDirty();
      return;
    }
    this.checkpointNow(false);
  }

  /** Grava o checkpoint agora (síncrono: toSnapshot + gzip) e o põe na fila do próximo flush. */
  checkpointNow(advancing: boolean): void {
    const r = this.room;
    if (!r || this.stopped || this.destroyed) return;
    const t0 = performance.now();
    const snap = r.toSnapshot();
    // o mesmo estado (só os horários mudaram) não é regravado
    const { savedAt: _savedAt, players, career, ...rest } = snap;
    const fp = {
      small: JSON.stringify({
        ...rest,
        players: players.map((p) => ({ ...p, lastSeen: null })),
        career: career ? { ...career, stateGz: career.stateGz.length, worldGz: career.worldGz.length } : null,
      }),
      state: career?.stateGz ?? null,
      world: career?.worldGz ?? null,
      advancing,
    };
    this.ckptDirty = false;
    this.ckptKey = this.stageKey();
    const prev = this.ckptFp;
    if (prev && prev.advancing === advancing && prev.small === fp.small && prev.state === fp.state && prev.world === fp.world) {
      this.stats.ckptSkipped++;
      return;
    }
    const bytes = gzip(utf8(JSON.stringify(snap)), 6);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.byteLength; i += CKPT_CHUNK) chunks.push(bytes.subarray(i, Math.min(bytes.byteLength, i + CKPT_CHUNK)));
    this.pendingCkpt = { id: toHex(randomBytes(6)), size: bytes.byteLength, chunks };
    this.ckptFp = fp;
    this.advancedSinceCkpt = advancing;
    this.stats.ckpts++;
    this.log('host: checkpoint', { bytes: bytes.byteLength, chunks: chunks.length, advancing, ms: Math.round(performance.now() - t0) });
    this.scheduleFlush(0);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.ckptTimer) clearTimeout(this.ckptTimer);
    this.room?.dispose();
    this.env.status?.({ state: 'stopped' });
  }
}

