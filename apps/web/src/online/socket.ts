/**
 * Cliente Socket.io tipado (singleton) do modo online.
 *  - Reconexão automática (socket.io-client) e, a cada (re)conexão, `room:rejoin` com o
 *    `{ code, token }` salvo no localStorage → o servidor devolve room:state, season:snapshot e,
 *    se houver partida, match:start com o minuto atual (+ match:pause).
 *  - `call()` transforma emit+ack em Promise<Ack<T>> com timeout.
 */
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientEvents, ServerEvents } from '@cosmicfut/shared';
import { SERVER_URL } from './config';

export type GameSocket = Socket<ServerEvents, ClientEvents>;

/* ───────── sessão (credencial de reconexão) ───────── */

export interface OnlineSession {
  code: string;
  token: string;
  playerId: string;
}

const SESSION_KEY = 'cosmicfut:online-session';
const NICK_KEY = 'cosmicfut:online-nick';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadSession(): OnlineSession | null {
  const s = readJson<OnlineSession>(SESSION_KEY);
  return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
}

export function saveSession(s: OnlineSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* modo privado: segue sem persistir */
  }
}

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(nick: string): void {
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    /* ignore */
  }
}

/* ───────── socket ───────── */

let socket: GameSocket | null = null;

/** Socket único da aba (criado sob demanda; conecta sozinho). */
export function getSocket(): GameSocket {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 8000,
      autoConnect: true,
    });
  }
  return socket;
}

export function hasSocket(): boolean {
  return !!socket;
}

/** Fecha a conexão (sair do modo online). */
export function closeSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

type EventName = keyof ClientEvents;

/** emit + ack como Promise. Sem resposta em `timeoutMs`, devolve erro (não rejeita). */
export function call<T = void>(event: EventName, ...args: unknown[]): Promise<Ack<T>> {
  return callWithTimeout<T>(10_000, event, ...args);
}

/** Igual a `call`, com tempo limite próprio (operações longas: avanço rápido de dev, virada). */
export function callWithTimeout<T = void>(timeoutMs: number, event: EventName, ...args: unknown[]): Promise<Ack<T>> {
  const s = getSocket();
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: s.connected ? 'O servidor não respondeu a tempo.' : 'Sem conexão com o servidor.' });
    }, timeoutMs);
    (s.emit as (e: string, ...a: unknown[]) => void)(event, ...args, (r: Ack<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** GET /rooms/:code — prévia pública da sala. */
export async function fetchRoomPreview<T>(code: string): Promise<Ack<T>> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
    return (await res.json()) as Ack<T>;
  } catch {
    return { ok: false, error: 'Servidor indisponível.' };
  }
}
