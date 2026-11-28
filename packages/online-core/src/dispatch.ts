/**
 * Eventos "dentro da sala" (o jogador já está ligado a uma sala): o mesmo mapeamento evento → método da Room no
 * servidor Node (server.ts, Socket.io) e no anfitrião da simulação do navegador (host.ts, relay da Cloudflare).
 * Os eventos de conexão (create/join/rejoin/claim/leave/end/list) ficam com cada transporte.
 */
import { GameError, type PlayerRec, type Room } from './room.ts';
import * as V from './validate.ts';

export type AckResult = { ok: true; data: unknown } | { ok: false; error: string };
export type AckFn = (r: AckResult) => void;

const MARKET = ['offer', 'contract', 'respond', 'withdraw', 'list', 'release', 'counter', 'loanlist', 'option', 'recall', 'renew', 'budget', 'promote', 'dismiss', 'train', 'finance'] as const;
const JOBS = ['apply', 'accept', 'decline'] as const;

/** Todos os eventos tratados por `roomIntent`. */
export const ROOM_INTENTS: readonly string[] = [
  ...JOBS.map((t) => `jobs:${t}`),
  'room:set-color', 'room:kick', 'room:transfer-host', 'room:react', 'draft:start', 'lottery:run', 'turn:end', 'round:force',
  'vote:propose', 'vote:cast', 'skip:cancel', 'friends:get', 'jobs:get', 'room:seat-code',
  'room:update-settings', 'room:pick-club', 'room:start', 'season:renew', 'season:sync', 'dev:advance',
  ...MARKET.map((t) => `market:${t}`),
  'round:set-lineup', 'round:ready', 'match:command', 'match:resume', 'match:pause-request', 'chat:send',
  'admin:job-offer',
];

/**
 * Executa um evento da sala para `player`. Retorno: `undefined`/`true` = ok sem dados; objeto = dados do ack;
 * Promise para os assíncronos. Lança `GameError`/`ValidationError` com a mensagem para o usuário.
 */
export function roomIntent(room: Room, player: PlayerRec, ev: string, raw: unknown): unknown {
  const out = intent(room, player, ev, raw);
  if (out instanceof Promise) return out.then((x) => (x === undefined ? true : x));
  return out === undefined ? true : out;
}

function intent(room: Room, player: PlayerRec, ev: string, raw: unknown): unknown {
  if (ev.startsWith('jobs:') && (JOBS as readonly string[]).includes(ev.slice(5))) return room.jobsAction(player, ev.slice(5) as (typeof JOBS)[number], raw);
  if (ev.startsWith('market:') && (MARKET as readonly string[]).includes(ev.slice(7))) return room.marketAction(player, ev.slice(7) as (typeof MARKET)[number], raw);
  switch (ev) {
    case 'room:set-color': return room.setColor(player, raw);
    case 'room:kick': return room.kick(player, raw);
    case 'room:transfer-host': return room.setHost(player, raw);
    case 'room:react': return room.react(player, raw);
    case 'draft:start': return room.startDraft(player);
    case 'lottery:run': return room.runLottery(player);
    case 'turn:end': return room.endMyTurn(player);
    case 'round:force': return room.force(player);
    case 'vote:propose': return room.propose(player, raw);
    case 'vote:cast': return room.cast(player, raw);
    case 'skip:cancel': return room.cancelSkip(player);
    case 'friends:get': return room.friendsLeague();
    case 'jobs:get': return room.jobsPayload(player);
    case 'room:seat-code': return room.makeSeatCode(player, raw);
    case 'room:update-settings': room.updateSettings(player, raw); return true;
    case 'room:pick-club': room.pickClub(player, raw); return true;
    case 'room:start': return room.start(player).then(() => true);
    case 'season:renew': return room.renew(player, raw);
    case 'season:sync':
      if (!room.snap) throw new GameError('Sem temporada.');
      room.sendSnapshot(player.socketId ?? undefined, true);
      return true;
    case 'dev:advance': return room.devAdvance(player, raw);
    case 'round:set-lineup': room.setLineup(player, raw); return true;
    case 'round:ready': room.setReady(player, raw); return true;
    case 'match:command': room.command(player, raw); return true;
    case 'match:resume': room.resume(player, raw); return true;
    case 'match:pause-request': room.pauseRequest(player, raw); return true;
    case 'chat:send': room.chat(player, raw); return true;
    // (host) no relay da Cloudflare só chega pela rota de administração (não é evento de cliente)
    case 'admin:job-offer': return room.adminJobOffer(player, raw);
  }
  throw new GameError('Evento desconhecido.');
}

/**
 * Roda um handler e responde o ack: erros de validação/jogo viram `{ok:false, error}`; outros viram "Erro interno."
 * (logados). `undefined` não responde (o handler já respondeu); `true` responde sem dados.
 */
export function runHandler(fn: () => unknown, ack: AckFn, log: (msg: string, extra?: Record<string, unknown>) => void, onUserError?: (msg: string) => void): void {
  const onError = (e: unknown) => {
    if (e instanceof V.ValidationError || e instanceof GameError) {
      ack({ ok: false, error: e.message });
      onUserError?.(e.message);
    } else {
      log('handler error', { error: String(e) });
      ack({ ok: false, error: 'Erro interno.' });
    }
  };
  const done = (out: unknown) => {
    if (out !== undefined) ack({ ok: true, data: out === true ? undefined : out });
  };
  try {
    const out = fn();
    if (out instanceof Promise) out.then(done, onError);
    else done(out);
  } catch (e) {
    onError(e);
  }
}
