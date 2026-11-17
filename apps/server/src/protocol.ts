/**
 * Protocolo do servidor. O contrato (base + extensões: 'match:resume', 'room:update-settings',
 * 'match:info', 'match:pause', campos extras de 'match:tick'/'match:start', prévia de GET /rooms/:code)
 * vive em `packages/shared/src/net.ts` e é re-exportado daqui. Ficam locais apenas os tipos
 * exclusivos do servidor (eventos de entrada não confiáveis e dados do socket).
 */
import type { Ack, MatchTickPayload as NetMatchTickPayload, ServerEvents as NetServerEvents } from '@cosmicfut/shared';
import type { MatchConfig, MatchResult, MatchState } from '@cosmicfut/engine';

export type {
  Ack, ClientEvents, LiveMatchInfo, MatchEndPayload, MatchPausePayload, MatchStartPayload, RoomCode, RoomPreview, RoomSettings,
  RoundResultsPayload, SeasonEndPayload, SeasonSnapshotPayload, MarketActionResult, MarketPatch, MarketUpdatePayload, MatchPreviewPayload,
  FriendsLeague, PublicRoomInfo, SkipEndPayload, SkipProgress, TurnFeedItem, ReactionPayload,
  JobsPayload, CareerStatus,
} from '@cosmicfut/shared';

/** Tick com os campos da engine tipados (o shared usa `unknown` por não depender da engine). */
export interface MatchTickPayload extends NetMatchTickPayload {
  players?: MatchState['players'];
  tactic?: MatchState['tactic'];
}

export interface ServerEvents extends Omit<NetServerEvents, 'match:tick'> {
  'match:tick': (t: MatchTickPayload) => void;
}

/** Visão do SERVIDOR: payloads chegam como `unknown` e são validados. */
type AckFn = (r: Ack<unknown>) => void;
export interface ServerInboundEvents {
  'room:create': (p: unknown, ack?: AckFn) => void;
  'room:join': (p: unknown, ack?: AckFn) => void;
  'room:rejoin': (p: unknown, ack?: AckFn) => void;
  'room:leave': (ack?: AckFn) => void;
  'room:pick-club': (p: unknown, ack?: AckFn) => void;
  'room:start': (ack?: AckFn) => void;
  'room:update-settings': (p: unknown, ack?: AckFn) => void;
  'round:set-lineup': (p: unknown, ack?: AckFn) => void;
  'round:ready': (p: unknown, ack?: AckFn) => void;
  'match:command': (p: unknown, ack?: AckFn) => void;
  'match:pause-request': (p: unknown, ack?: AckFn) => void;
  'match:resume': (p: unknown, ack?: AckFn) => void;
  'chat:send': (p: unknown, ack?: AckFn) => void;
  'season:renew': (p: unknown, ack?: AckFn) => void;
  'season:sync': (ack?: AckFn) => void;
  'dev:advance': (p: unknown, ack?: AckFn) => void;
  'market:offer': (p: unknown, ack?: AckFn) => void;
  'market:contract': (p: unknown, ack?: AckFn) => void;
  'market:respond': (p: unknown, ack?: AckFn) => void;
  'market:withdraw': (p: unknown, ack?: AckFn) => void;
  'market:list': (p: unknown, ack?: AckFn) => void;
  'market:release': (p: unknown, ack?: AckFn) => void;
  /* (Etapa 5) */
  'market:counter': (p: unknown, ack?: AckFn) => void;
  'market:loanlist': (p: unknown, ack?: AckFn) => void;
  'market:option': (p: unknown, ack?: AckFn) => void;
  'market:recall': (p: unknown, ack?: AckFn) => void;
  'market:renew': (p: unknown, ack?: AckFn) => void;
  'market:budget': (p: unknown, ack?: AckFn) => void;
  /* (17/11) online 6 jogadores */
  'room:set-color': (p: unknown, ack?: AckFn) => void;
  'room:kick': (p: unknown, ack?: AckFn) => void;
  'room:transfer-host': (p: unknown, ack?: AckFn) => void;
  'room:react': (p: unknown, ack?: AckFn) => void;
  'room:list': (ack?: AckFn) => void;
  'draft:start': (ack?: AckFn) => void;
  'lottery:run': (ack?: AckFn) => void;
  'turn:end': (ack?: AckFn) => void;
  'round:force': (ack?: AckFn) => void;
  'vote:propose': (p: unknown, ack?: AckFn) => void;
  'vote:cast': (p: unknown, ack?: AckFn) => void;
  'skip:cancel': (ack?: AckFn) => void;
  'friends:get': (ack?: AckFn) => void;
  /* (carreira online salva e entrada tardia) */
  'jobs:apply': (p: unknown, ack?: AckFn) => void;
  'jobs:accept': (p: unknown, ack?: AckFn) => void;
  'jobs:decline': (p: unknown, ack?: AckFn) => void;
  'jobs:get': (ack?: AckFn) => void;
  'room:seat-code': (p: unknown, ack?: AckFn) => void;
  'room:claim-seat': (p: unknown, ack?: AckFn) => void;
  'room:end': (p: unknown, ack?: AckFn) => void;
}

export interface SocketData {
  code: string | null;
  playerId: string | null;
}

export type { MatchConfig, MatchResult, MatchState };
