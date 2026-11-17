/**
 * Fastify (HTTP: /health, /rooms/:code) + Socket.io (protocolo do jogo).
 * `createServer(opts)` não escuta porta; chame `listen()` (porta 0 = aleatória, usada nos testes).
 */
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { applySettingsPatch, fullSettings } from './lobby.ts';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { defaultOptions, type ServerOptions } from './config.ts';
import { GameData } from './data.ts';
import { PersistStore, tokenHash } from './persist.ts';
import type { CareerStatus, ServerEvents, ServerInboundEvents, SocketData } from './protocol.ts';
import { DEFAULT_SETTINGS, GameError, newToken, Room, type IO, type PlayerRec, type RoomContext } from './room.ts';
import { makeBackup, parseBackup } from './backup.ts';
import { countryPlayable } from './career-data.ts';
import { createSimRunner, type SimRunner } from './sim-pool.ts';
import * as V from './validate.ts';

type Sock = Socket<ServerInboundEvents, ServerEvents, Record<string, never>, SocketData>;
type AckFn = (r: { ok: true; data: unknown } | { ok: false; error: string }) => void;

/** limite geral de eventos por socket (anti-flood) */
const EVENTS_PER_SEC = 40;

export interface CosmicServer {
  app: FastifyInstance;
  io: IO;
  data: GameData;
  rooms: Map<string, Room>;
  opts: ServerOptions;
  /** simulação da carreira (worker_threads ou inline) */
  sim: SimRunner;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** (17/11) URL pública: PUBLIC_URL ou a 1ª linha do arquivo do lançador; só http(s) válida, sem barra no fim. */
export function readPublicUrl(opts: Pick<ServerOptions, 'publicUrl' | 'publicUrlFile'>): string | null {
  let raw = opts.publicUrl;
  if (!raw && opts.publicUrlFile) {
    try {
      raw = readFileSync(opts.publicUrlFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0]?.trim() ?? null;
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function createServer(over: Partial<ServerOptions> = {}): CosmicServer {
  const opts = defaultOptions(over);
  const data = new GameData(opts.dataDir);
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false });
  const rooms = new Map<string, Room>();
  const store = opts.persistDir ? new PersistStore(opts.persistDir) : null;

  const originOk = (origin: string | undefined) => !origin || opts.corsOrigins === '*' || opts.corsOrigins.includes(origin);

  /* ───────── HTTP ───────── */
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && originOk(origin)) {
      reply.header('Access-Control-Allow-Origin', opts.corsOrigins === '*' ? '*' : origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'content-type');
      reply.header('Access-Control-Expose-Headers', 'content-disposition');
    }
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });
  // (carreira online salva) backup enviado como arquivo (gzip/json binário)
  app.addContentTypeParser(['application/octet-stream', 'application/gzip', 'application/x-gzip'], { parseAs: 'buffer', bodyLimit: opts.maxBackupBytes }, (_req, body, done) => done(null, body));
  app.get('/health', async () => ({
    ok: true,
    rooms: rooms.size,
    careersOnDisk: store ? store.loadCodes().length : 0,
    players: [...rooms.values()].reduce((n, r) => n + r.connectedPlayers().length, 0),
    uptime: Math.round(process.uptime()),
    persist: !!store,
  }));
  /** prévia pública de uma sala (para a tela de "entrar" mostrar quem está lá) */
  app.get<{ Params: { code: string } }>('/rooms/:code', async (req, reply) => {
    let code: string;
    try {
      code = V.roomCode(req.params.code);
    } catch {
      return reply.code(400).send({ ok: false, error: 'Código inválido.' });
    }
    const r = getRoom(code);
    if (!r) return reply.code(404).send({ ok: false, error: 'Sala não encontrada.' });
    const s = r.summary();
    const managers = s.players.filter((p) => !p.spectator);
    return { ok: true, data: { code: s.code, phase: s.phase, players: managers.map((p) => ({ nickname: p.nickname, clubId: p.clubId, connected: p.connected })), settings: s.settings, maxPlayers: opts.maxPlayers } };
  });
  /** (17/11) "Salas abertas": salas públicas ainda no lobby */
  const publicRooms = () => [...rooms.values()].filter((r) => r.listed()).map((r) => r.publicInfo()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  app.get('/rooms', async () => ({ ok: true, data: publicRooms() }));
  /**
   * (17/11) URL pública do túnel (lançador scripts/online.ps1 grava <raiz>/.data/public-url.txt; some quando o túnel
   * fecha). PUBLIC_URL fixa tem prioridade. Lida a cada pedido (muda a cada execução).
   */
  app.get('/public-url', async () => ({ url: readPublicUrl(opts) }));

  /**
   * (Carreira online salva) "Minhas carreiras online": situação de cada carreira guardada no navegador. Recebe
   * {code, token} e devolve só o que o dono do token pode ver (nunca tokens). Salas fora da memória são lidas do
   * resumo no disco (<CODE>.meta.json), sem carregar a carreira.
   */
  app.post<{ Body: unknown }>('/careers/status', async (req, reply) => {
    let items: { code: string; token: string }[];
    try {
      const o = V.obj(req.body);
      if (!Array.isArray(o.items) || o.items.length > 30) throw new V.ValidationError('items inválido (até 30).');
      items = o.items.map((x) => {
        const it = V.obj(x, 'item');
        return { code: V.roomCode(it.code), token: V.token(it.token) };
      });
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : 'Pedido inválido.' });
    }
    const out: CareerStatus[] = items.map(({ code, token }) => careerStatus(code, token));
    return { ok: true, data: out };
  });

  /** (Carreira online salva) Host baixa o backup da sala (.json.gz, sem tokens). */
  app.post<{ Params: { code: string }; Body: unknown }>('/rooms/:code/backup', async (req, reply) => {
    let code: string;
    let token: string;
    try {
      code = V.roomCode(req.params.code);
      token = V.token(V.obj(req.body).token);
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : 'Pedido inválido.' });
    }
    const r = getRoom(code);
    const p = r?.byToken(token);
    if (!r || !p) return reply.code(404).send({ ok: false, error: 'Sala não encontrada.' });
    if (p.id !== r.hostId) return reply.code(403).send({ ok: false, error: 'Só o host baixa o backup.' });
    const buf = makeBackup(r.toSnapshot());
    const day = (r.career?.date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="cosmicfut-${code}-${day}.json.gz"`)
      .header('Cache-Control', 'no-store')
      .send(buf);
  });

  /**
   * (Carreira online salva) Restaura um backup: cria a sala (mesmo código, se livre) com os mesmos técnicos; quem envia
   * fica com a vaga do host (token novo); os outros entram pelos códigos de vaga que o host gerar.
   */
  app.post<{ Body: unknown }>('/rooms/restore', { bodyLimit: opts.maxBackupBytes }, async (req, reply) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? null));
      const snap = parseBackup(body, opts.maxBackupBytes);
      const code = rooms.has(snap.code) || store?.has(snap.code) ? newCode() : snap.code;
      for (const p of snap.players) p.token = newToken();
      const room = Room.fromSnapshot(ctx, { ...snap, code });
      if (snap.career && room.phase === 'lobby') throw new V.ValidationError('Carreira do backup é de uma versão antiga (não pode ser restaurada).');
      if (room.needsHydrate) {
        await room.restore();
        if (room.phase === 'lobby' && snap.career) {
          room.dispose();
          throw new V.ValidationError('Não foi possível ler a carreira do backup.');
        }
      }
      rooms.set(code, room);
      ctx.persist(room);
      const host = room.player(room.hostId)!;
      log('room restored from backup', { room: code });
      return { ok: true, data: { code, playerId: host.id, token: host.token } };
    } catch (e) {
      if (e instanceof V.ValidationError || e instanceof GameError) return reply.code(400).send({ ok: false, error: e.message });
      log('restore failed', { error: String(e) });
      return reply.code(400).send({ ok: false, error: 'Backup inválido.' });
    }
  });

  /* ───────── front estático (um processo, um túnel) ───────── */
  const webDist = opts.webDist && existsSync(join(opts.webDist, 'index.html')) ? opts.webDist : null;
  if (webDist) {
    const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i; // arquivos do Vite: nome-<hash>.ext
    void app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      setHeaders(res, filePath) {
        const p = filePath.replace(/\\/g, '/');
        let cc = 'public, max-age=3600';
        if (p.endsWith('/index.html')) cc = 'no-cache';
        else if (p.includes('/assets/') && HASHED.test(p)) cc = 'public, max-age=31536000, immutable';
        else if (p.includes('/data/') && p.endsWith('.json')) cc = 'public, max-age=300';
        else if (p.includes('/assets/')) cc = 'public, max-age=86400';
        res.header('Cache-Control', cc);
      },
    });
    // fallback SPA: rotas do app (ex.: /online/ABCDEF) devolvem o index.html; arquivos inexistentes (com extensão) dão 404
    app.setNotFoundHandler((req, reply) => {
      const path = req.raw.url?.split('?')[0] ?? '/';
      const api = /^\/(socket\.io|health|rooms|public-url|careers)(\/|$)/.test(path);
      const isFile = /\.[A-Za-z0-9]+$/.test(path);
      if ((req.method === 'GET' || req.method === 'HEAD') && !api && !isFile) {
        return reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html');
      }
      return reply.code(404).send({ ok: false, error: 'Não encontrado.' });
    });
  }

  /* ───────── Socket.io ───────── */
  const io: IO = new Server<ServerInboundEvents, ServerEvents, Record<string, never>, SocketData>({
    cors: { origin: opts.corsOrigins === '*' ? true : opts.corsOrigins, methods: ['GET', 'POST'] },
    // season:snapshot passa de 100 KB: compacta mensagens grandes no WebSocket
    perMessageDeflate: { threshold: 4096 },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  const log = (msg: string, extra?: Record<string, unknown>) => {
    if (opts.logger) app.log.info(extra ?? {}, msg);
  };

  const sim = createSimRunner(opts.dataDir, opts.simWorkers, log);
  sim.onLost((code) => {
    const r = rooms.get(code);
    if (r) r.needsHydrate = true;
  });

  const ctx: RoomContext = {
    io, data, opts, log, sim,
    persist: (room) => store?.schedule(room.code, () => room.toSnapshot()),
    destroy: (room) => {
      room.dispose();
      rooms.delete(room.code);
      store?.remove(room.code);
      io.in(room.channel).socketsLeave(room.channel);
      log('room destroyed', { room: room.code });
    },
    // (carreira online salva) grava e tira da memória; volta do disco quando alguém abrir o código
    unload: (room) => {
      if (!store) return;
      store.writeNow(room.code, room.toSnapshot());
      room.dispose();
      rooms.delete(room.code);
      log('room unloaded', { room: room.code });
    },
  };

  /** Salva no disco e vazia (ninguém conectado) desde o carregamento. */
  const loadSnapshot = (snap: ReturnType<PersistStore['loadAll']>[number]): Room | null => {
    try {
      // sala ainda no lobby e velha: expira (só salas com a temporada iniciada são guardadas para sempre)
      if (snap.phase === 'lobby' && Date.now() - ((snap as { savedAt?: number }).savedAt ?? 0) >= opts.roomTtlMs) {
        store?.remove(snap.code);
        log('lobby room expired on load', { room: snap.code });
        return null;
      }
      const room = Room.fromSnapshot(ctx, snap);
      rooms.set(room.code, room);
      // (carreira online salva) o simulador só é reidratado quando o primeiro técnico voltar (attach)
      return room;
    } catch (e) {
      log('snapshot descartado', { room: (snap as { code?: string }).code, error: String(e) });
      return null;
    }
  };

  // salas salvas em disco (sobrevivem a reinício); ninguém conectado ⇒ ficam paradas até alguém voltar
  if (store) for (const snap of store.loadAll(log)) loadSnapshot(snap);

  /** Sala na memória ou carregada do disco (carreira descarregada). */
  const getRoom = (code: string): Room | undefined => {
    const r = rooms.get(code);
    if (r || !store) return r;
    const snap = store.read(code, log);
    return snap ? (loadSnapshot(snap) ?? undefined) : undefined;
  };

  const newCode = (): string => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += V.ROOM_CODE_ALPHABET[randomInt(V.ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(c) && !store?.has(c)) return c;
    }
  };

  /** (carreira online salva) situação de uma carreira para o dono do token (sem tokens). */
  const careerStatus = (code: string, token: string): CareerStatus => {
    const r = rooms.get(code);
    if (r) {
      const me = r.byToken(token);
      if (!me) return { code, found: false };
      const turnOf = r.turn?.playerId ? r.player(r.turn.playerId)?.nickname ?? null : null;
      return {
        code, found: true, phase: r.phase, season: r.career?.season ?? null, date: r.career?.date ?? null,
        me: { playerId: me.id, nickname: me.nickname, clubId: me.clubId, isHost: me.id === r.hostId, ...(me.spectator ? { spectator: true } : {}) },
        managers: r.managers().map((p) => ({ nickname: p.nickname, clubId: p.clubId, color: p.color, online: p.connected, ...(r.isUnemployed(p) ? { unemployed: true } : {}) })),
        lastActivity: r.lastActivity, turnOf,
      };
    }
    const m = store?.readMeta(code);
    if (!m) return { code, found: false };
    const h = tokenHash(token);
    const me = m.players.find((p) => p.tokenHash === h);
    if (!me) return { code, found: false };
    return {
      code, found: true, phase: m.phase, season: m.season, date: m.date,
      me: { playerId: me.id, nickname: me.nickname, clubId: me.clubId, isHost: me.id === m.hostId, ...(me.spectator ? { spectator: true } : {}) },
      managers: m.players.filter((p) => !p.spectator).map((p) => ({ nickname: p.nickname, clubId: p.clubId, ...(p.color ? { color: p.color } : {}), online: false, ...(m.phase !== 'lobby' && !p.clubId ? { unemployed: true } : {}) })),
      lastActivity: m.lastActivity, turnOf: null,
    };
  };

  /** Envolve um handler: valida ack, captura erros, aplica anti-flood. */
  const handle = (socket: Sock, fn: (ack: AckFn, ...args: unknown[]) => unknown) => {
    return (...args: unknown[]) => {
      const last = args[args.length - 1];
      const ack: AckFn = typeof last === 'function' ? (last as AckFn) : () => undefined;
      if (typeof last === 'function') args.pop();
      const now = Date.now();
      const rl = (socket as unknown as { _rl?: { t: number; n: number } })._rl ?? { t: now, n: 0 };
      if (now - rl.t >= 1000) {
        rl.t = now;
        rl.n = 0;
      }
      rl.n++;
      (socket as unknown as { _rl: { t: number; n: number } })._rl = rl;
      if (rl.n > EVENTS_PER_SEC) {
        ack({ ok: false, error: 'Muitas requisições; aguarde um instante.' });
        if (rl.n === EVENTS_PER_SEC + 1) socket.emit('error', { code: 'rate-limited', message: 'Muitas requisições.' });
        return;
      }
      const onError = (e: unknown) => {
        if (e instanceof V.ValidationError || e instanceof GameError) {
          ack({ ok: false, error: e.message });
          if (typeof last !== 'function') socket.emit('error', { code: 'bad-request', message: e.message });
        } else {
          log('handler error', { error: String(e) });
          ack({ ok: false, error: 'Erro interno.' });
        }
      };
      const done = (out: unknown) => {
        if (out !== undefined) ack({ ok: true, data: out === true ? undefined : out });
      };
      try {
        const out = fn(ack, ...args);
        // handlers assíncronos (room:start, dev:advance): ack quando terminam
        if (out instanceof Promise) out.then(done, onError);
        else done(out);
      } catch (e) {
        onError(e);
      }
    };
  };

  const current = (socket: Sock): { room: Room; player: PlayerRec } => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const player = room?.player(socket.data.playerId);
    if (!room || !player) throw new GameError('Você não está em uma sala.');
    return { room, player };
  };

  const leaveCurrent = (socket: Sock) => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    const p = room?.player(socket.data.playerId);
    if (room && p && p.socketId === socket.id) {
      // (carreira online salva) carreira em andamento: sair = desconectar mantendo a vaga (volta pela lista)
      if (room.phase !== 'lobby' && room.career && !p.spectator) {
        socket.leave(room.channel);
        room.detach(p);
      } else room.leave(p);
    }
    socket.data.code = null;
    socket.data.playerId = null;
  };

  io.on('connection', (socket: Sock) => {
    socket.data.code = null;
    socket.data.playerId = null;

    socket.on('room:create', handle(socket, (_ack, raw) => {
      const o = V.obj(raw);
      const nick = V.nickname(o.nickname);
      const settings = fullSettings(DEFAULT_SETTINGS);
      if (opts.roomDefaults) applySettingsPatch(settings, opts.roomDefaults, true);
      if (o.settings !== undefined) applySettingsPatch(settings, V.obj(o.settings, 'Configurações'), true);
      if (!countryPlayable({ leagues: data.leagues() }, settings.countryId)) settings.countryId = DEFAULT_SETTINGS.countryId;
      leaveCurrent(socket);
      const room = new Room(ctx, newCode(), settings);
      rooms.set(room.code, room);
      const p = room.addPlayer(nick);
      socket.data.code = room.code;
      socket.data.playerId = p.id;
      room.attach(p, socket.id);
      log('room created', { room: room.code });
      return { code: room.code, playerId: p.id, token: p.token };
    }));

    socket.on('room:join', handle(socket, (_ack, raw) => {
      const o = V.obj(raw);
      const code = V.roomCode(o.code);
      const nick = V.nickname(o.nickname);
      const room = getRoom(code);
      if (!room) throw new GameError('Sala não encontrada.');
      if (o.spectator !== undefined && typeof o.spectator !== 'boolean') throw new GameError('spectator inválido.');
      // valida antes de sair da sala atual
      const p = room.addPlayer(nick, { spectator: o.spectator === true });
      leaveCurrent(socket);
      socket.data.code = room.code;
      socket.data.playerId = p.id;
      room.attach(p, socket.id);
      // espectador ou técnico novo (desempregado) que entra no meio da temporada recebe a carreira
      if (room.phase !== 'lobby') {
        room.sendFullState(p);
        if (!p.spectator) void room.registerLateJoiner(p);
      }
      return { playerId: p.id, token: p.token, ...(p.spectator ? { spectator: true } : {}), ...(!p.spectator && room.phase !== 'lobby' ? { unemployed: true } : {}) };
    }));

    /* ── (carreira online salva e entrada tardia) ── */
    socket.on('room:claim-seat', handle(socket, (_ack, raw) => {
      const o = V.obj(raw);
      const room = getRoom(V.roomCode(o.code));
      if (!room) throw new GameError('Sala não encontrada.');
      const p = room.claimSeat(o.seatCode, o.nickname);
      leaveCurrent(socket);
      socket.data.code = room.code;
      socket.data.playerId = p.id;
      room.attach(p, socket.id);
      room.sendFullState(p);
      log('seat claimed', { room: room.code, player: p.id });
      return { playerId: p.id, token: p.token };
    }));
    socket.on('room:end', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      if (player.id !== room.hostId) throw new GameError('Só o host encerra a carreira.');
      if (V.obj(raw).confirm !== room.code) throw new GameError('Confirme digitando o código da sala.');
      io.to(room.channel).emit('room:ended', { code: room.code, by: player.nickname });
      for (const p of room.players) {
        const s = p.socketId ? io.sockets.sockets.get(p.socketId) : undefined;
        if (s) {
          s.data.code = null;
          s.data.playerId = null;
        }
      }
      ctx.destroy(room);
      log('career ended by host', { room: room.code });
      return true;
    }));
    for (const type of ['apply', 'accept', 'decline'] as const) {
      socket.on(`jobs:${type}`, handle(socket, async (_ack, raw) => {
        const { room, player } = current(socket);
        return room.jobsAction(player, type, raw);
      }));
    }

    /* ── (17/11) online 6 jogadores ── */
    const simple = (ev: string, fn: (room: Room, player: PlayerRec, raw: unknown) => unknown) => {
      (socket.on as (e: string, h: (...a: unknown[]) => void) => void)(ev, handle(socket, (_ack, raw) => {
        const { room, player } = current(socket);
        const out = fn(room, player, raw);
        return out === undefined ? true : out;
      }));
    };
    simple('room:set-color', (r, p, raw) => r.setColor(p, raw));
    simple('room:kick', (r, p, raw) => r.kick(p, raw));
    simple('room:transfer-host', (r, p, raw) => r.setHost(p, raw));
    simple('room:react', (r, p, raw) => r.react(p, raw));
    simple('draft:start', (r, p) => r.startDraft(p));
    simple('lottery:run', (r, p) => r.runLottery(p));
    simple('turn:end', (r, p) => r.endMyTurn(p));
    simple('round:force', (r, p) => r.force(p));
    simple('vote:propose', (r, p, raw) => r.propose(p, raw));
    simple('vote:cast', (r, p, raw) => r.cast(p, raw));
    simple('skip:cancel', (r, p) => r.cancelSkip(p));
    simple('friends:get', (r) => r.friendsLeague());
    simple('jobs:get', (r, p) => r.jobsPayload(p));
    simple('room:seat-code', (r, p, raw) => r.makeSeatCode(p, raw));
    socket.on('room:list', handle(socket, () => publicRooms()));

    socket.on('room:rejoin', handle(socket, (ack, raw) => {
      const o = V.obj(raw);
      const code = V.roomCode(o.code);
      const token = V.token(o.token);
      const room = getRoom(code);
      if (!room) throw new GameError('Sala não encontrada (pode ter expirado).');
      const p = room.byToken(token);
      if (!p) throw new GameError('Token inválido para esta sala.');
      if (socket.data.code && (socket.data.code !== code || socket.data.playerId !== p.id)) leaveCurrent(socket);
      socket.data.code = room.code;
      socket.data.playerId = p.id;
      room.attach(p, socket.id);
      ack({ ok: true, data: { playerId: p.id } });
      room.sendFullState(p);
      return undefined;
    }));

    socket.on('room:leave', handle(socket, () => {
      leaveCurrent(socket);
      return true;
    }));

    socket.on('room:update-settings', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.updateSettings(player, raw);
      return true;
    }));

    socket.on('room:pick-club', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.pickClub(player, raw);
      return true;
    }));

    socket.on('room:start', handle(socket, async () => {
      const { room, player } = current(socket);
      await room.start(player);
      return true;
    }));

    socket.on('season:renew', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      return room.renew(player, raw);
    }));

    socket.on('season:sync', handle(socket, () => {
      const { room, player } = current(socket);
      if (!room.snap) throw new GameError('Sem temporada.');
      room.sendSnapshot(player.socketId ?? undefined, true);
      return true;
    }));

    socket.on('dev:advance', handle(socket, async (_ack, raw) => {
      const { room, player } = current(socket);
      return room.devAdvance(player, raw);
    }));

    // mercado online: ações sobre a carreira da sala (fase 'planning'); o ack traz a resposta da IA/do jogador
    for (const type of ['offer', 'contract', 'respond', 'withdraw', 'list', 'release', 'counter', 'loanlist', 'option', 'recall', 'renew', 'budget'] as const) {
      socket.on(`market:${type}`, handle(socket, async (_ack, raw) => {
        const { room, player } = current(socket);
        return room.marketAction(player, type, raw);
      }));
    }

    socket.on('round:set-lineup', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.setLineup(player, raw);
      return true;
    }));

    socket.on('round:ready', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.setReady(player, raw);
      return true;
    }));

    socket.on('match:command', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.command(player, raw);
      return true;
    }));

    socket.on('match:resume', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.resume(player, raw);
      return true;
    }));

    socket.on('match:pause-request', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.pauseRequest(player, raw);
      return true;
    }));

    socket.on('chat:send', handle(socket, (_ack, raw) => {
      const { room, player } = current(socket);
      room.chat(player, raw);
      return true;
    }));

    socket.on('disconnect', () => {
      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      const p = room?.player(socket.data.playerId);
      if (room && p && p.socketId === socket.id) room.detach(p);
    });
  });

  /* ───────── expiração ───────── */
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of [...rooms.values()]) {
      if (r.connectedPlayers().length || r.emptySince === null) continue;
      const idle = now - r.emptySince;
      // só a sala no lobby expira; a carreira (temporada iniciada) é guardada para sempre e só sai da memória
      if (r.phase === 'lobby' || !r.career) {
        if (idle >= opts.roomTtlMs) ctx.destroy(r);
      } else if (store && idle >= opts.unloadAfterMs && (r.phase === 'planning' || r.phase === 'season-end') && !r.skip) {
        ctx.unload!(r);
      }
    }
  }, opts.sweepIntervalMs);
  sweep.unref();

  let closed = false;
  return {
    app, io, data, rooms, opts, sim,
    async listen(port = opts.port, host = opts.host) {
      await app.ready();
      io.attach(app.server);
      await app.listen({ port, host });
      const addr = app.server.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      if (store) {
        for (const r of rooms.values()) ctx.persist(r);
        store.flush();
      }
      for (const r of rooms.values()) r.dispose();
      await sim.close();
      await new Promise<void>((res) => io.close(() => res()));
      await app.close().catch(() => undefined);
    },
  };
}
