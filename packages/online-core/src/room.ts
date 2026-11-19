/**
 * Sala online: jogadores, lobby, CARREIRA autoritativa e ciclo de rodadas/partidas/viradas.
 *
 * Fases: lobby → planning ⇄ (simulating → matchday) → … → season-end → (virada) → planning …
 *
 * A carreira (WorldState + SeasonState, 2–7 MB) vive no simulador (worker_threads, ver sim-pool.ts); a sala
 * guarda só metadados (data, versões, ids dos elencos humanos), a escalação de cada humano e o último
 * snapshot já comprimido (gzip) — que vai para os clientes e para o disco sem passar por JSON no thread principal.
 * As operações no simulador são enfileiradas por sala (uma por vez).
 */
import { defer, fromBase64, fromUtf8, gunzip, randomBytes, toBase64, toBase64Url, toHex } from './platform.ts';
import type { CoreIO } from './io.ts';
import type { Fixture, MatchResult } from '@cosmicfut/engine';
import {
  COUNTDOWN_MS, MAX_SPECTATORS, PICK_SECONDS, PLAYER_COLORS, REACTIONS, snakeOrder, VOTE_SECONDS,
  type DraftState, type FriendsLeague, type LiveMatchInfo, type MarketActionResult, type MatchPreviewPayload, type NetRenewTerms,
  type PublicRoomInfo, type Reaction, type RoomPhase, type RoomPlayer, type RoomSettings, type RoomSummary, type SeasonEndPayload,
  type SeasonSnapshotPayload, type SkipEndPayload, type SkipProgress, type TurnFeedItem, type TurnState, type VoteState,
} from '@cosmicfut/shared';
import type { RoomOptions } from './options.ts';
import { closeSeason, computeFriendsLeague, emptyFriends, endTenure, pushFeed, recordH2H, startTenure, updateFromMeta, type FriendsStore } from './friends.ts';
import { jobsView, pendingOfferCount, sanitizeJobs, type JobEvent, type OnlineJobs } from './jobs.ts';
import type { JobsAction, JobsResponse, ManagerSeed } from './sim-core.ts';
import type { JobsPayload } from '@cosmicfut/shared';
import { applySettingsPatch, bestAvailable, fullSettings, isColor, randomInBand, shuffle, type FullSettings } from './lobby.ts';
import type { GameData } from './data.ts';
import { LiveMatch } from './live-match.ts';
import { fixtureInfo } from './match-config.ts';
import type {
  CareerMeta, ClubSetup, DayPlayed, ExpiringInfo, LiveFixture, MarketAction, MarketResponse, PackedSnapshot, RolloverResponse,
  RoundResponse, RoundUntil, SeasonEndResponse, SeasonPreview, SimRequest, SimResponse, SkipResponse,
} from './sim-core.ts';
import { SimCrashError, type SimRunner } from './sim-runner.ts';
import * as V from './validate.ts';

export type IO = CoreIO;

export class GameError extends Error {}
const fail = (msg: string): never => {
  throw new GameError(msg);
};

export interface PlayerRec {
  id: string;
  token: string;
  nickname: string;
  clubId: string | null;
  ready: boolean;
  connected: boolean;
  /** desconectado além do tempo de tolerância: o clube passa a ser comandado pela IA */
  ai: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
  /** (13/11) caiu há pouco: a rodada espera por ele até este epoch ms (PLANNING_GRACE_MS) */
  graceUntil: number | null;
  chat: number[];
  graceTimer: ReturnType<typeof setTimeout> | null;
  /* ── (17/11) ── */
  color: string;
  /** espectador: assiste e conversa (sem clube) */
  spectator: boolean;
  /** rodadas seguidas sem agir (cronômetro/ausência) */
  missed: number;
  /** regra AFK: o assistente faz as vezes dele até ele agir */
  afk: boolean;
  react: number[];
  /* ── (carreira online salva) ── */
  /** última vez conectado (epoch ms) */
  lastSeen: number | null;
  /** código de vaga gerado pelo host (uso único) para assumir este lugar em outro aparelho */
  seatCode: { code: string; expiresAt: number } | null;
}

/** (carreira online) uma vez desempregado sem proposta: a vez é pulada; com proposta, no máximo isto */
export const JOBLESS_TURN_MS = 90_000;
const SEAT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEAT_CODE_TTL_MS = 24 * 3600_000;

/** Fim de temporada em andamento (fase 'season-end'). */
interface SeasonEndState {
  season: number;
  preview: SeasonPreview;
  expiring: Record<string, ExpiringInfo[]>;
  deadline: number;
  /** playerId (da sala) → renovações enviadas */
  renew: Record<string, Record<string, NetRenewTerms>>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Snapshot em disco (v2 = carreira). Ver persist.ts. */
export interface RoomSnapshot {
  v: 2;
  code: string;
  createdAt: number;
  savedAt: number;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: {
    id: string; token: string; nickname: string; clubId: string | null; ai: boolean; color?: string; spectator?: boolean; missed?: number; afk?: boolean;
    lastSeen?: number | null; seatCode?: { code: string; expiresAt: number } | null;
  }[];
  /** (17/11) */
  round?: number;
  draftOrder?: string[] | null;
  friends?: FriendsStore;
  /** (carreira online salva) última atividade (epoch ms) */
  lastActivity?: number;
  career: null | {
    humanClubIds: string[];
    season: number;
    date: string;
    version: number;
    worldVersion: number;
    /** JSON+gzip em base64 */
    worldGz: string;
    stateGz: string;
    setups: Record<string, ClubSetup>;
    seasonEnd: null | { season: number; preview: SeasonPreview; expiring: Record<string, ExpiringInfo[]>; renew: Record<string, Record<string, NetRenewTerms>> };
    /** (carreira online) Central de Empregos */
    jobs?: OnlineJobs | null;
  };
  lastMatches: LiveMatchInfo[];
}

/** Formato antigo (temporada `createSeason`, só ligas). */
export interface LegacyRoomSnapshot {
  v: 1;
  code: string;
  createdAt: number;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: { id: string; token: string; nickname: string; clubId: string | null; ai: boolean }[];
  season: unknown;
}

export interface RoomContext {
  io: IO;
  data: GameData;
  opts: RoomOptions;
  sim: SimRunner;
  persist(room: Room): void;
  destroy(room: Room): void;
  /** (carreira online salva) tira a sala da memória (fica no disco) */
  unload?(room: Room): void;
  /**
   * (online grátis) chamado logo antes de a rodada começar a simular (planejamento → simulando): o anfitrião do
   * navegador grava o checkpoint do planejamento (failover rejoga o dia a partir dele).
   */
  beforeAdvance?(room: Room): void;
  log(msg: string, extra?: Record<string, unknown>): void;
}

export const DEFAULT_SETTINGS: RoomSettings = fullSettings(undefined);
const REACT_GAP_MS = 700;
/** salto votado: dias por pedaço (entre pedaços: progresso, cancelamento) */
const SKIP_CHUNK_DAYS = 15;
const MAX_SKIP_DAYS = 3 * 366;
const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX = 5;
const MAX_SIM_DAYS = 400;
/** humano ausente/sem resposta na virada: renova (aceitando o pedido) quem tem menos que isto */
export const AUTO_RENEW_MAX_AGE = 33;
const MAX_RENEW_WAGE = 100_000_000;

const MAX_FEE = 2_000_000_000;
const MAX_WAGE = 100_000_000;

/** Valida o payload de uma ação de mercado (o simulador valida as regras do jogo). */
function parseMarketAction(type: MarketAction['type'], raw: unknown): MarketAction {
  const o = V.obj(raw);
  const money = (v: unknown, what: string, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${what} inválido.`);
    return V.intIn(Math.round(v), what, min, max);
  };
  const optId = (v: unknown, what: string) => (v === undefined || v === null ? undefined : V.id(v, what));
  switch (type) {
    case 'offer': {
      const kind = o.kind ?? 'transfer';
      if (kind !== 'transfer' && kind !== 'loan' && kind !== 'precontract') fail('Tipo de proposta inválido (transfer | loan | precontract).');
      // (Etapa 5) termos do empréstimo e depósito da multa
      let loan: { wageShare: number; purchaseOption?: number; recall?: boolean } | undefined;
      if (o.loan !== undefined && o.loan !== null) {
        const l = V.obj(o.loan);
        loan = {
          wageShare: V.intIn(Math.round(Number(l.wageShare ?? 100)), '% do salário', 0, 100),
          ...(l.purchaseOption !== undefined && l.purchaseOption !== null ? { purchaseOption: money(l.purchaseOption, 'Opção de compra', 0, MAX_FEE) } : {}),
          ...(l.recall === true ? { recall: true } : {}),
        };
      }
      if (o.clause !== undefined && typeof o.clause !== 'boolean') fail('clause inválido.');
      return {
        type, playerId: V.id(o.playerId, 'Jogador'), fee: money(o.fee, 'Valor', 0, MAX_FEE), kind: kind as 'transfer' | 'loan' | 'precontract',
        offerId: optId(o.offerId, 'Negociação'), ...(loan ? { loan } : {}), ...(o.clause === true ? { clause: true } : {}),
      };
    }
    case 'contract': {
      const offerId = optId(o.offerId, 'Negociação');
      const playerId = optId(o.playerId, 'Jogador');
      if (!offerId && !playerId) fail('Informe a negociação ou o jogador.');
      const luva = o.luva === undefined || o.luva === null ? undefined : money(o.luva, 'Luva', 0, 12);
      if (luva !== undefined && luva !== 0 && luva !== 6 && luva !== 12) fail('Luva: à vista (0) ou 6/12 parcelas.');
      const releaseClause = o.releaseClause === undefined || o.releaseClause === null ? undefined : money(o.releaseClause, 'Multa rescisória', 0, MAX_FEE);
      return { type, offerId, playerId, wage: money(o.wage, 'Salário', 1, MAX_WAGE), years: V.intIn(o.years, 'Anos', 1, 5), luva, ...(releaseClause ? { releaseClause } : {}) };
    }
    case 'counter':
      return { type, offerId: V.id(o.offerId, 'Oferta'), fee: money(o.fee, 'Valor', 0, MAX_FEE) };
    case 'loanlist': {
      const ids = Array.isArray(o.playerIds) ? o.playerIds : o.playerId !== undefined ? [o.playerId] : fail('playerIds inválido.');
      if (!ids.length || ids.length > 60) fail('Lista de jogadores inválida.');
      if (typeof o.listed !== 'boolean') fail('listed inválido.');
      const months = o.months === undefined || o.months === null ? undefined : V.intIn(o.months, 'Meses', 6, 24);
      return { type, playerIds: ids.map((x) => V.id(x, 'Jogador')), listed: o.listed as boolean, ...(months ? { months } : {}) };
    }
    case 'option':
    case 'recall':
      return { type, playerId: V.id(o.playerId, 'Jogador') };
    case 'renew': {
      const releaseClause = o.releaseClause === undefined || o.releaseClause === null ? undefined : money(o.releaseClause, 'Multa rescisória', 0, MAX_FEE);
      return { type, playerId: V.id(o.playerId, 'Jogador'), wage: money(o.wage, 'Salário', 1, MAX_WAGE), years: V.intIn(o.years, 'Anos', 1, 5), ...(releaseClause ? { releaseClause } : {}) };
    }
    case 'respond':
      if (typeof o.accept !== 'boolean') fail('accept inválido.');
      return { type, offerId: V.id(o.offerId, 'Oferta'), accept: o.accept as boolean };
    case 'withdraw':
      return { type, offerId: V.id(o.offerId, 'Negociação') };
    case 'list': {
      const ids = Array.isArray(o.playerIds) ? o.playerIds : o.playerId !== undefined ? [o.playerId] : fail('playerIds inválido.');
      if (!ids.length || ids.length > 60) fail('Lista de jogadores inválida.');
      if (typeof o.listed !== 'boolean') fail('listed inválido.');
      return { type, playerIds: ids.map((x) => V.id(x, 'Jogador')), listed: o.listed as boolean };
    }
    case 'release':
      return { type, playerId: V.id(o.playerId, 'Jogador') };
    /* (Base) promover / dispensar revelado da base */
    case 'promote':
    case 'dismiss':
      return { type, playerId: V.id(o.playerId, 'Jogador') };
    /* (Treino) jogadores no Centro de Treinamento (até 3) */
    case 'train': {
      if (!Array.isArray(o.playerIds) || o.playerIds.length > 3) fail('Lista de jogadores inválida (até 3).');
      return { type, playerIds: (o.playerIds as unknown[]).map((x) => V.id(x, 'Jogador')) };
    }
    /* (Mercado e Orçamentos) equilíbrio de orçamentos */
    case 'budget':
      return { type, toWage: money(o.toWage, 'Valor', -MAX_FEE, MAX_FEE) };
  }
}

/** "€ 12,5 mi" (o thread principal não carrega a engine) */
function fmtMoneyShort(v: number): string {
  const a = Math.abs(v);
  const f = (n: number, d: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
  const s = a >= 1e9 ? `${f(a / 1e9, 2)} bi` : a >= 1e6 ? `${f(a / 1e6, 1)} mi` : a >= 1e3 ? `${f(a / 1e3, 0)} mil` : f(a, 0);
  return `${v < 0 ? '−' : ''}€ ${s}`;
}

export const newId = (prefix: string) => `${prefix}${toHex(randomBytes(6))}`;
export const newToken = () => toBase64Url(randomBytes(24));
const b64 = (u: Uint8Array) => toBase64(u);

/**
 * (Etapa 1) Revisão mínima do mundo salvo (= CAREER_REV da engine; o thread principal da sala não carrega a engine,
 * que roda no simulador — o teste de servidor confere que os dois batem).
 */
export const ROOM_CAREER_REV = 3;
const CAREER_REV = ROOM_CAREER_REV;

/** (Etapa 1) O mundo salvo (gzip base64) é de uma revisão anterior à linha do tempo global (rev < 3)? */
function isLegacyWorldGz(worldB64: string): boolean {
  try {
    const w = JSON.parse(fromUtf8(gunzip(fromBase64(worldB64)))) as { rev?: number };
    return (w.rev ?? 1) < CAREER_REV;
  } catch {
    return false;
  }
}

export class Room {
  readonly code: string;
  readonly createdAt: number;
  hostId = '';
  phase: RoomPhase = 'lobby';
  settings: FullSettings;
  /* ── (17/11) online 6 jogadores ── */
  /** planejamentos abertos desde o início (gira quem começa a rodada) */
  round = 0;
  draft: DraftState | null = null;
  /** ordem final do draft (vira a ordem das vezes, em serpentina) */
  draftOrder: string[] | null = null;
  turn: TurnState | null = null;
  countdown: { endsAt: number } | null = null;
  planningDeadline: number | null = null;
  vote: VoteState | null = null;
  skip: SkipProgress | null = null;
  friends: FriendsStore = emptyFriends();
  /** propostas humano × humano ainda não vistas pelo dono na vez dele (offerId → clube vendedor) */
  private unseenOffers = new Map<string, string>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private planningTimer: ReturnType<typeof setTimeout> | null = null;
  private voteTimer: ReturnType<typeof setTimeout> | null = null;
  private skipCancel = false;
  /** já avisou "confirmou a escalação" nesta vez */
  private lineupFed = false;
  players: PlayerRec[] = [];
  /** metadados da carreira (o estado em si está no simulador) */
  career: CareerMeta | null = null;
  humanClubIds: string[] = [];
  /** último snapshot comprimido (estado e mundo mais recentes) */
  snap: { version: number; worldVersion: number; season: number; date: string; stateGz: Uint8Array; worldGz: Uint8Array | null; stats: PackedSnapshot['stats']; worldStats?: { json: number; gz: number } } | null = null;
  /** tática/escalação de cada clube humano (reaplicadas se o simulador precisar se reidratar) */
  setups: Record<string, ClubSetup> = {};
  seasonEnd: SeasonEndState | null = null;
  /** resultado da última virada (reenviado no rejoin enquanto a nova temporada não andou) */
  lastRollover: { date: string; payload: SeasonEndPayload; releasedByClub: Record<string, string[]> } | null = null;
  /** pré-jogo em curso: partidas criadas, match:start em `startsAt` */
  preview: { startsAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** espera de quem caiu no planejamento (reavalia o "pronto" quando a tolerância acaba) */
  private graceWait: ReturnType<typeof setTimeout> | null = null;
  /** partidas humanas do dia em andamento */
  matches = new Map<string, LiveMatch>();
  /** resumo das partidas da rodada atual (ou da última, durante o planning) */
  matchInfos: LiveMatchInfo[] = [];
  private playedResults: Record<string, MatchResult> = {};
  emptySince: number | null = null;
  /** (carreira online) Central de Empregos (espelho do simulador, vem no meta) */
  jobs: OnlineJobs | null = null;
  /** (carreira online salva) última atividade (epoch ms): lista "Minhas carreiras online" */
  lastActivity = Date.now();
  /** métricas */
  lastSnapshotBytes = 0;
  lastAdvanceMs = 0;
  lastRound: { days: number; games: number; simMs: number; maxDayMs: number } | null = null;
  /** o simulador perdeu o estado desta sala (worker reiniciado / sala restaurada do disco) */
  needsHydrate = false;
  private starting = false;
  private hydrating: Promise<void> | null = null;
  private readonly ctx: RoomContext;
  private disposed = false;
  private chain: Promise<unknown> = Promise.resolve();
  private b64cache: { version: number; worldVersion: number; state: string; world: string } | null = null;

  constructor(ctx: RoomContext, code: string, settings: Partial<RoomSettings>, createdAt = Date.now()) {
    this.ctx = ctx;
    this.code = code;
    this.settings = fullSettings(settings);
    this.createdAt = createdAt;
  }

  /** (carreira online) técnico sem clube numa carreira em andamento */
  isUnemployed(p: PlayerRec): boolean {
    return !p.spectator && this.phase !== 'lobby' && !!this.career && !p.clubId;
  }

  /** Técnicos (sem os espectadores). */
  managers(): PlayerRec[] {
    return this.players.filter((p) => !p.spectator);
  }

  connectedManagers(): PlayerRec[] {
    return this.players.filter((p) => p.connected && !p.spectator);
  }

  private isTurns(): boolean {
    return this.settings.turnMode !== 'simultaneous';
  }

  publicInfo(): PublicRoomInfo {
    const host = this.player(this.hostId);
    return {
      code: this.code, host: host?.nickname ?? '?', hostClubId: host?.clubId ?? null, players: this.managers().length,
      maxPlayers: this.ctx.opts.maxPlayers, preset: this.settings.preset, turnMode: this.settings.turnMode, pickMode: this.settings.pickMode,
      createdAt: this.createdAt,
    };
  }

  /** Aparece em "Salas abertas": pública, no lobby, destrancada e com vaga. */
  listed(): boolean {
    return this.phase === 'lobby' && this.settings.isPublic && !this.settings.locked && this.managers().length < this.ctx.opts.maxPlayers && this.connectedManagers().length > 0;
  }

  /* ───────────── canais ───────────── */

  get channel(): string {
    return `room:${this.code}`;
  }

  matchChannel(matchId: string): string {
    return `match:${this.code}:${matchId}`;
  }

  /* ───────────── consultas ───────────── */

  player(id: string | null | undefined): PlayerRec | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  byToken(token: string): PlayerRec | undefined {
    return this.players.find((p) => p.token === token);
  }

  ownerOf(clubId: string): PlayerRec | undefined {
    return this.players.find((p) => p.clubId === clubId);
  }

  connectedPlayers(): PlayerRec[] {
    return this.players.filter((p) => p.connected);
  }

  private present(p: PlayerRec | undefined | null): boolean {
    return !!p && p.connected && !p.ai;
  }

  /** Caiu há pouco (recarregou a página): a rodada ainda espera por ele. */
  private inGrace(p: PlayerRec): boolean {
    return !p.connected && !p.ai && p.graceUntil !== null && p.graceUntil > Date.now();
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map(
        (p): RoomPlayer => ({
          playerId: p.id, nickname: p.nickname, clubId: p.clubId, ready: p.ready, connected: p.connected, isHost: p.id === this.hostId,
          ...(this.inGrace(p) ? { graceUntil: p.graceUntil } : {}),
          color: p.color,
          ...(p.spectator ? { spectator: true } : {}),
          ...(p.afk ? { afk: true } : {}),
          ...(this.isUnemployed(p) ? { unemployed: true, jobOffers: pendingOfferCount(this.jobs, p.id, this.career?.date ?? null) } : {}),
          lastSeen: p.connected ? Date.now() : p.lastSeen,
        }),
      ),
      settings: { ...this.settings, divisionIds: this.settings.divisionIds.slice() },
      date: this.career?.date ?? null,
      matches: this.matches.size ? [...this.matches.values()].map((m) => m.info()) : this.matchInfos.slice(),
      season: this.career?.season ?? null,
      seasonEnd: this.seasonEnd ? { season: this.seasonEnd.season, deadline: this.seasonEnd.deadline, waitingFor: this.renewWaiting() } : null,
      maxPlayers: this.ctx.opts.maxPlayers,
      draft: this.draft ? { ...this.draft, order: this.draft.order.slice(), picks: this.draft.picks.slice() } : null,
      turn: this.turn ? { ...this.turn, order: this.turn.order.slice(), done: this.turn.done.slice() } : null,
      countdown: this.countdown,
      planningDeadline: this.planningDeadline,
      vote: this.vote ? { ...this.vote, yes: this.vote.yes.slice(), no: this.vote.no.slice() } : null,
      skip: this.skip,
      round: this.round,
    };
  }

  broadcastState(): void {
    this.ctx.io.to(this.channel).emit('room:state', this.summary());
  }

  /** season:snapshot: estado sempre; mundo quando `withWorld` (join/rejoin/sync) ou quando acabou de mudar. */
  private snapshotPayload(withWorld: boolean): SeasonSnapshotPayload | null {
    const s = this.snap;
    if (!s) return null;
    const out: SeasonSnapshotPayload = {
      version: s.version, encoding: 'gzip-json', stateGz: s.stateGz, worldVersion: s.worldVersion,
      season: s.season, date: s.date,
      bytes: { state: s.stats.stateJson, stateGz: s.stats.stateGz },
    };
    if (withWorld && s.worldGz) {
      out.worldGz = s.worldGz;
      if (s.worldStats) Object.assign(out.bytes!, { world: s.worldStats.json, worldGz: s.worldStats.gz });
    }
    return out;
  }

  sendSnapshot(target?: string, withWorld = false): void {
    const payload = this.snapshotPayload(withWorld);
    if (!payload) return;
    // já comprimido: não deixa o perMessageDeflate do ws recomprimir
    this.ctx.io.to(target ?? this.channel).compress(false).emit('season:snapshot', payload);
  }

  /** Snapshot novo vindo do simulador (depois de create/round/rollover/hydrate). */
  private onSnapshot(s: PackedSnapshot, broadcast: boolean): void {
    if (this.disposed) return;
    if (this.snap && s.version < this.snap.version) return;
    const worldChanged = !!s.worldGz && (!this.snap || s.worldVersion !== this.snap.worldVersion || !this.snap.worldGz);
    this.snap = {
      version: s.version,
      worldVersion: s.worldVersion,
      season: s.season,
      date: s.date,
      stateGz: s.stateGz,
      worldGz: s.worldGz ?? this.snap?.worldGz ?? null,
      stats: s.stats,
      worldStats: s.worldGz ? { json: s.stats.worldJson ?? 0, gz: s.stats.worldGz ?? 0 } : this.snap?.worldStats,
    };
    this.lastSnapshotBytes = s.stats.stateGz + (worldChanged ? s.stats.worldGz ?? 0 : 0);
    this.ctx.log('season:snapshot', { room: this.code, version: s.version, ...s.stats });
    if (broadcast) this.sendSnapshot(undefined, worldChanged);
    this.ctx.persist(this);
  }

  private changed(): void {
    this.lastActivity = Date.now();
    this.broadcastState();
    this.ctx.persist(this);
  }

  /* ───────────── (carreira online) Central de Empregos ───────────── */

  /** Técnicos para o modelo de empregos. */
  private managerSeeds(): ManagerSeed[] {
    return this.managers().map((p) => ({ id: p.id, name: p.nickname, clubId: p.clubId }));
  }

  /** dono atual (playerId) de um clube humano */
  private ownerIdOf = (clubId: string): string | null => this.ownerOf(clubId)?.id ?? null;

  /**
   * Meta novo do simulador: clubes humanos (contratações/demissões), Central de Empregos e eventos (feed da vez, Liga
   * dos Amigos, 'jobs:update' de cada técnico).
   */
  private syncJobs(meta: CareerMeta): void {
    if (this.disposed) return;
    if (meta.humanClubIds) this.humanClubIds = meta.humanClubIds.slice();
    if (!meta.jobs) return;
    this.jobs = meta.jobs;
    const date = meta.date;
    let roster = false;
    for (const p of this.managers()) {
      const m = meta.jobs.managers[p.id];
      if (!m || m.clubId === p.clubId) continue;
      if (p.clubId) endTenure(this.friends, p.id, p.clubId, date);
      p.clubId = m.clubId;
      if (m.clubId) startTenure(this.friends, p.id, m.clubId, date);
      roster = true;
    }
    for (const id of Object.keys(this.setups)) if (!this.humanClubIds.includes(id)) delete this.setups[id];
    for (const ev of meta.jobEvents ?? []) this.jobEvent(ev);
    if (roster) {
      this.broadcastState();
      this.emitFriends();
    }
    this.emitJobs();
  }

  private jobEvent(ev: JobEvent): void {
    const p = this.player(ev.managerId);
    if (!p) return;
    const club = this.ctx.data.club(ev.clubId)?.name ?? ev.clubId;
    const friend = (kind: 'fired' | 'hired', text: string) => {
      pushFeed(this.friends, { at: Date.now(), date: ev.date, kind, text, clubIds: [ev.clubId] });
      this.feed(p, 'info', text);
    };
    if (ev.type === 'fired') friend('fired', `${p.nickname} foi demitido do ${club}.`);
    else if (ev.type === 'hired') friend('hired', `${p.nickname} assumiu o ${club}.`);
    else if (ev.type === 'offer' && p.socketId) this.ctx.io.to(p.socketId).emit('turn:feed', { playerId: p.id, clubId: ev.clubId, text: `Proposta de emprego: o ${club} quer você como técnico.`, at: Date.now(), kind: 'info' });
    else if (ev.type === 'answer' && p.socketId) this.ctx.io.to(p.socketId).emit('turn:feed', { playerId: p.id, clubId: ev.clubId, text: ev.approved ? `O ${club} aprovou a sua candidatura: veja a proposta na Central de Empregos.` : `O ${club} recusou a sua candidatura.`, at: Date.now(), kind: 'info' });
  }

  jobsPayload(p: PlayerRec | null): JobsPayload {
    return jobsView(this.jobs, p && !p.spectator ? p.id : null, this.career?.date ?? null);
  }

  /** 'jobs:update' para cada técnico conectado (ou só `only`). */
  emitJobs(only?: PlayerRec): void {
    if (!this.career || !this.jobs) return;
    for (const p of only ? [only] : this.players) if (p.socketId) this.ctx.io.to(p.socketId).emit('jobs:update', this.jobsPayload(p));
  }

  /** Chama a Central de Empregos no simulador (fila da sala). */
  private async jobsCall(action: JobsAction): Promise<JobsResponse> {
    if (!this.career) fail('A carreira ainda não começou.');
    const res = await this.enqueue(() => this.simCall<JobsResponse>({ op: 'jobs', room: this.code, action }));
    if (this.disposed) fail('Sala encerrada.');
    this.career = res.meta;
    this.ctx.persist(this);
    return res;
  }

  /** 'jobs:apply' / 'jobs:accept' / 'jobs:decline' */
  async jobsAction(p: PlayerRec, type: 'apply' | 'accept' | 'decline', raw: unknown): Promise<{ message: string; clubId?: string }> {
    if (p.spectator) fail('Espectadores não têm carreira de técnico.');
    if (!this.career || this.phase === 'lobby') fail('A carreira ainda não começou.');
    if (type !== 'decline' && this.phase !== 'planning' && this.phase !== 'season-end') fail('Aguarde o fim da rodada (planejamento).');
    const o = V.obj(raw);
    const action: JobsAction = type === 'apply'
      ? { type, managerId: p.id, vacancyId: V.id(o.vacancyId, 'Vaga') }
      : { type, managerId: p.id, offerId: V.id(o.offerId, 'Proposta') };
    const res = await this.jobsCall(action);
    if (!res.ok) fail(res.error ?? 'Não foi possível.');
    this.acted(p);
    if (type === 'accept' && res.clubId) {
      // modo turnos: quem assumiu um clube no meio da vez segue com a vez (já com o clube); senão, joga na próxima rodada
      this.broadcastState();
    }
    return { message: res.message ?? 'ok', ...(res.clubId ? { clubId: res.clubId } : {}) };
  }

  /** Técnico novo numa carreira em andamento: entra desempregado. */
  async registerLateJoiner(p: PlayerRec): Promise<void> {
    if (!this.career) return;
    try {
      await this.jobsCall({ type: 'register', manager: { id: p.id, name: p.nickname, clubId: null } });
    } catch (e) {
      this.ctx.log('register late joiner failed', { room: this.code, error: String(e) });
    }
    pushFeed(this.friends, { at: Date.now(), date: this.career?.date ?? null, kind: 'joined', text: `${p.nickname} entrou na carreira (desempregado).`, clubIds: [] });
    this.feed(p, 'info', `${p.nickname} entrou na carreira (desempregado).`);
    this.emitFriends();
    this.changed();
  }

  /* ───────────── (carreira online salva) códigos de vaga ───────────── */

  /** Host: código de 6 caracteres, uso único, 24 h, para assumir a vaga de `playerId` em outro aparelho. */
  makeSeatCode(host: PlayerRec, raw: unknown): { seatCode: string; expiresAt: number } {
    if (host.id !== this.hostId) fail('Só o host gera códigos de vaga.');
    const target = this.player(V.id(V.obj(raw).playerId, 'Jogador'));
    if (!target || target.spectator) fail('Escolha um técnico da sala.');
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) code += SEAT_CODE_ALPHABET[bytes[i] % SEAT_CODE_ALPHABET.length];
    const expiresAt = Date.now() + SEAT_CODE_TTL_MS;
    target!.seatCode = { code, expiresAt };
    this.ctx.persist(this);
    return { seatCode: code, expiresAt };
  }

  /**
   * Assume a vaga do código: token novo (o antigo deixa de valer; a conexão antiga cai) e, opcionalmente, apelido
   * novo (vaga reatribuída a outra pessoa).
   */
  claimSeat(seatCodeRaw: unknown, nickRaw: unknown): PlayerRec {
    const seat = typeof seatCodeRaw === 'string' ? seatCodeRaw.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{6}$/.test(seat)) fail('Código de vaga inválido (6 caracteres).');
    const now = Date.now();
    const p = this.players.find((x) => x.seatCode && x.seatCode.code === seat && x.seatCode.expiresAt > now);
    if (!p) fail('Código de vaga inválido ou expirado. Peça um novo ao host.');
    return this.reassignSeat(p!, nickRaw);
  }

  /**
   * Vaga reatribuída (código de vaga já conferido — aqui ou no relay da Cloudflare): token novo, conexão antiga
   * derrubada e, opcionalmente, apelido novo.
   */
  reassignSeat(p: PlayerRec, nickRaw: unknown): PlayerRec {
    p.seatCode = null;
    p.token = newToken();
    if (p!.socketId) {
      const old = this.ctx.io.sockets.sockets.get(p!.socketId);
      old?.emit('error', { code: 'replaced', message: 'Sua vaga foi assumida em outro aparelho.' });
      if (old) {
        old.data.code = null;
        old.data.playerId = null;
        old.disconnect(true);
      }
      p!.socketId = null;
      p!.connected = false;
    }
    if (nickRaw !== undefined && nickRaw !== null && nickRaw !== '') {
      const nick = V.nickname(nickRaw);
      if (this.players.some((x) => x !== p && x.nickname.toLowerCase() === nick.toLowerCase())) fail('Já há alguém com este apelido na sala.');
      p!.nickname = nick;
      if (this.career) void this.enqueue(() => this.simCall({ op: 'jobs', room: this.code, action: { type: 'rename', managerId: p!.id, name: nick } })).catch(() => undefined);
    }
    this.ctx.persist(this);
    return p!;
  }

  /* ───────────── simulador (fila por sala) ───────────── */

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Chama o simulador (reidrata antes, se preciso). Use dentro de `enqueue`. */
  private async simCall<T extends SimResponse>(req: SimRequest, onDay?: (d: DayPlayed) => void, broadcast = true): Promise<T> {
    if (this.needsHydrate) await this.hydrate();
    try {
      const res = await this.ctx.sim.call<T>(this.code, req, { day: onDay, snapshot: (s) => this.onSnapshot(s, broadcast) });
      // (carreira online) clubes humanos e Central de Empregos vêm em todo meta
      const meta = (res as { meta?: CareerMeta }).meta;
      if (meta?.jobs) this.syncJobs(meta);
      return res;
    } catch (e) {
      if (e instanceof SimCrashError) this.needsHydrate = true;
      throw e;
    }
  }

  private hydrate(): Promise<void> {
    this.hydrating ??= this.doHydrate().finally(() => (this.hydrating = null));
    return this.hydrating;
  }

  private async doHydrate(): Promise<void> {
    if (!this.snap?.worldGz) throw new Error('sem snapshot para reidratar a carreira');
    let gotSnap!: () => void;
    const snapP = new Promise<void>((r) => (gotSnap = r));
    const res = await this.ctx.sim.call<{ meta: CareerMeta; migrated: boolean }>(
      this.code,
      {
        op: 'hydrate', room: this.code, humanClubIds: this.humanClubIds, worldGz: this.snap.worldGz, stateGz: this.snap.stateGz,
        version: this.snap.version, worldVersion: this.snap.worldVersion, setups: this.setups,
        // (carreira online) Central de Empregos salva; sala antiga sem ela: criada com os técnicos atuais
        jobs: this.jobs, managers: this.managerSeeds(), firing: this.settings.firing,
      },
      {
        snapshot: (s) => {
          // snapshot re-serializado pelo simulador (mundo já migrado)
          this.onSnapshot(s, false);
          gotSnap();
        },
      },
    );
    await snapP;
    this.needsHydrate = false;
    this.career = res.meta;
    if (res.meta.jobs) this.syncJobs(res.meta);
    if (res.migrated) this.ctx.log('career migrated (migrateCareer)', { room: this.code });
  }

  /** Sala restaurada do disco: reidrata o simulador já (para validar escalações sem esperar a 1ª rodada). */
  restore(): Promise<void> {
    if (!this.needsHydrate) return Promise.resolve();
    if (this.restoring) return this.restoring;
    this.restoring = this.enqueue(() => this.hydrate())
      .catch((e) => {
        this.ctx.log('hydrate failed: room reset to lobby', { room: this.code, error: String(e) });
        this.resetToLobby();
      })
      .finally(() => (this.restoring = null));
    return this.restoring;
  }

  /** reidratação pedida (na fila) ou em andamento */
  private restoring: Promise<void> | null = null;

  /** Volta ao lobby mantendo jogadores e clubes (carreira perdida/irrecuperável). */
  resetToLobby(): void {
    this.clearPreview();
    for (const m of this.matches.values()) m.stop();
    this.matches.clear();
    this.clearSeasonEnd();
    this.career = null;
    this.snap = null;
    this.setups = {};
    this.humanClubIds = [];
    this.needsHydrate = false;
    this.phase = 'lobby';
    this.settings.divisionIds = [];
    this.clearRoundFlow();
    this.round = 0;
    this.friends = emptyFriends();
    for (const p of this.players) {
      p.ready = false;
      if (p.clubId && !this.ctx.data.playableAll().has(p.clubId)) p.clubId = null;
    }
    this.changed();
  }

  /* ───────────── entrada/saída ───────────── */

  /**
   * Entra na sala. (17/11) Até `maxPlayers` (6) técnicos; `spectator` entra como espectador (até 4, também depois do
   * início). Sala trancada não aceita ninguém novo.
   */
  addPlayer(nickname: string, opts: { spectator?: boolean; id?: string; force?: boolean } = {}): PlayerRec {
    const spectator = !!opts.spectator;
    if (opts.id && this.player(opts.id)) fail('Jogador já está na sala.');
    if (opts.force) {
      // (online grátis) vaga que o relay conhece e o checkpoint não tem (entrou depois do último checkpoint)
    } else if (this.settings.locked) fail('Sala trancada pelo host.');
    else if (spectator) {
      if (this.players.filter((p) => p.spectator).length >= MAX_SPECTATORS) fail(`Já há ${MAX_SPECTATORS} espectadores nesta sala.`);
    } else {
      // (carreira online) com a temporada em andamento, quem entra é técnico DESEMPREGADO (recebe propostas)
      if (this.phase !== 'lobby' && (!this.career || this.settings.lateJoin === false)) fail('A temporada desta sala já começou; só quem já estava pode voltar (ou entre como espectador).');
      if (this.managers().length >= this.ctx.opts.maxPlayers) fail(`Sala cheia (máximo ${this.ctx.opts.maxPlayers} técnicos). Entre como espectador.`);
    }
    let nick = nickname;
    for (let i = 2; this.players.some((p) => p.nickname.toLowerCase() === nick.toLowerCase()); i++) nick = `${nickname.slice(0, 17)} ${i}`;
    const used = new Set(this.players.map((p) => p.color));
    const p: PlayerRec = {
      id: opts.id ?? newId('p_'), token: newToken(), nickname: nick, clubId: null, ready: false,
      connected: false, ai: false, socketId: null, disconnectedAt: null, graceUntil: null, chat: [], graceTimer: null,
      color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.length % PLAYER_COLORS.length],
      spectator, missed: 0, afk: false, react: [], lastSeen: Date.now(), seatCode: null,
    };
    this.players.push(p);
    if (!this.hostId && !spectator) this.hostId = p.id;
    return p;
  }

  /** Liga o socket ao jogador (join/rejoin). Derruba uma conexão antiga do mesmo jogador. */
  attach(p: PlayerRec, socketId: string): void {
    const io = this.ctx.io;
    if (p.socketId && p.socketId !== socketId) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) {
        old.emit('error', { code: 'replaced', message: 'Você entrou na sala por outra conexão.' });
        old.data.code = null;
        old.data.playerId = null;
        old.disconnect(true);
      }
    }
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    const wasWaited = p.graceUntil !== null;
    p.graceUntil = null;
    this.emptySince = null;
    const wasAi = p.ai;
    p.ai = false;
    const sock = io.sockets.sockets.get(socketId);
    sock?.join(this.channel);
    for (const m of this.matches.values()) {
      const side = m.sideOf(p.id);
      if (!side) continue;
      sock?.join(this.matchChannel(m.id));
      if (wasAi && !m.finished) m.setControl(side, 'human');
    }
    if (!this.player(this.hostId) && !p.spectator) this.hostId = p.id;
    p.lastSeen = Date.now();
    // (carreira online salva) sala carregada do disco: reidrata o simulador agora (primeiro a voltar)
    if (this.needsHydrate && !this.hydrating) void this.restore();
    this.changed();
    // (carreira online salva) carreira pausada (sala vazia): retoma cronômetros no mesmo ponto
    this.resumeIfPaused();
    if (this.career) defer(() => this.emitJobs(p));
    // voltou dentro da tolerância e já estava pronto (ou era o último esperado): a rodada pode seguir
    if (wasWaited) defer(() => this.tryAdvance());
    // (17/11) modo turnos: sala restaurada do disco (sem vez em curso) ou rodada parada porque ninguém estava conectado
    if (!p.spectator && this.phase === 'planning' && this.career && this.isTurns()) {
      defer(() => {
        if (this.disposed || this.phase !== 'planning') return;
        if (!this.turn) this.startTurns();
        else if (this.turn.playerId === null) this.nextTurn(false);
        else if (this.turn.playerId === p.id) this.armTurnTimers();
      });
    }
  }

  /** Envia tudo que um cliente precisa ao (re)entrar: sala, carreira (mundo + estado), partidas, fim de temporada. */
  sendFullState(p: PlayerRec): void {
    if (!p.socketId) return;
    const io = this.ctx.io;
    io.to(p.socketId).emit('room:state', this.summary());
    const pending = this.hydrating ?? this.restoring;
    if (pending) {
      // sala recém-restaurada: manda o snapshot já migrado quando o simulador terminar de reidratar
      const sid = p.socketId;
      void pending.then(() => {
        this.sendSnapshot(sid, true);
        this.ctx.io.to(sid).emit('room:state', this.summary());
        if (this.career) this.emitJobs(p);
      }, () => undefined);
    } else this.sendSnapshot(p.socketId, true);
    for (const m of this.matches.values()) {
      const side = m.sideOf(p.id);
      if (m.finished) continue;
      // pré-jogo em curso: a partida ainda não começou
      if (!m.started) {
        if (side && this.preview) io.to(p.socketId).emit('match:preview', this.previewPayload(m, side, this.preview.startsAt));
        continue;
      }
      // (Rodada ao vivo) quem não joga recebe as partidas em andamento só para assistir (side null)
      io.to(p.socketId).emit('match:start', this.startPayload(m, side));
      const pause = m.pauseState();
      if (pause) io.to(p.socketId).emit('match:pause', pause);
    }
    if (this.phase === 'season-end' && this.seasonEnd) io.to(p.socketId).emit('season:end', this.seasonEndPayload());
    // (a data, e não a versão: ações de mercado sobem a versão sem a temporada andar)
    else if (this.lastRollover && this.career && this.lastRollover.date === this.career.date) io.to(p.socketId).emit('season:end', this.rolloverPayloadFor(p));
  }

  /**
   * Socket caiu: depois da tolerância o clube vira IA. No planejamento a rodada ESPERA por ele até
   * `planningGraceMs` (recarregar a página não faz perder a partida); depois disso ele não trava mais a sala.
   */
  detach(p: PlayerRec): void {
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = Date.now();
    p.lastSeen = p.disconnectedAt;
    const grace = Math.min(this.ctx.opts.planningGraceMs, this.ctx.opts.disconnectGraceMs);
    p.graceUntil = grace > 0 ? p.disconnectedAt + grace : null;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = setTimeout(() => this.goAi(p), this.ctx.opts.disconnectGraceMs);
    if (!this.connectedPlayers().length) this.emptySince = Date.now();
    for (const m of this.matches.values()) m.refreshGate();
    this.changed();
    this.tryAdvance();
    this.tryRollover();
    // (17/11) era a vez dele: espera a tolerância; depois o assistente conclui a vez
    if (this.turn?.playerId === p.id) this.armTurnTimers();
    this.checkVote();
  }

  private goAi(p: PlayerRec): void {
    p.graceTimer = null;
    if (this.disposed || p.connected || !this.players.includes(p)) return;
    // no lobby quem some de vez é retirado (libera o clube e não trava o início)
    if (this.phase === 'lobby') return this.leave(p);
    p.ai = true;
    for (const m of this.matches.values()) {
      const side = m.sideOf(p.id);
      if (side && !m.finished) m.setControl(side, 'ai');
    }
    if (this.hostId === p.id) this.transferHost();
    this.ctx.log('player -> ai', { room: this.code, player: p.id });
    this.changed();
  }

  private transferHost(): void {
    const ms = this.managers();
    const next = ms.find((x) => x.connected && x.id !== this.hostId) ?? ms.find((x) => x.id !== this.hostId);
    if (next) this.hostId = next.id;
  }

  /** Saída voluntária. No lobby libera o clube; depois do início o clube segue com a IA. */
  leave(p: PlayerRec): void {
    if (p.graceTimer) clearTimeout(p.graceTimer);
    const sock = p.socketId ? this.ctx.io.sockets.sockets.get(p.socketId) : undefined;
    if (sock) {
      sock.leave(this.channel);
      for (const m of this.matches.values()) sock.leave(this.matchChannel(m.id));
      sock.data.code = null;
      sock.data.playerId = null;
    }
    for (const m of this.matches.values()) {
      const side = m.sideOf(p.id);
      if (side && !m.finished) m.setControl(side, 'ai');
    }
    if (this.hostId === p.id) this.transferHost();
    this.players = this.players.filter((x) => x !== p);
    if (!this.managers().length) {
      // (carreira online salva) carreira em andamento nunca some por ficar vazia (só o host a encerra)
      if (this.phase === 'lobby' || !this.career) {
        this.ctx.destroy(this);
        return;
      }
    }
    if (!this.player(this.hostId) && this.managers().length) this.hostId = this.managers()[0].id;
    if (!this.connectedPlayers().length) this.emptySince = Date.now();
    for (const m of this.matches.values()) m.refreshGate();
    // (17/11) draft: quem sai deixa a fila; vez em curso passa adiante
    if (this.draft) {
      const wasCurrent = this.draft.current === p.id;
      this.draft.order = this.draft.order.filter((x) => x !== p.id);
      if (wasCurrent || this.draft.pick >= this.draft.order.length) this.draftNext(false);
    }
    if (this.turn?.playerId === p.id) this.nextTurn(true);
    this.changed();
    this.tryAdvance();
    this.tryRollover();
    this.checkVote();
  }

  /* ───────────── (17/11) host: expulsar, passar o host, cor, reações ───────────── */

  kick(host: PlayerRec, raw: unknown): void {
    if (host.id !== this.hostId) fail('Só o host pode remover jogadores.');
    const target = this.player(V.id(V.obj(raw).playerId, 'Jogador'));
    if (!target) fail('Jogador não encontrado.');
    if (target === host) fail('Use "Sair da sala" para sair.');
    const sid = target!.socketId;
    // (carreira online) o clube do expulso volta à IA (vaga aberta) e ele sai da Central de Empregos
    if (this.career && !target!.spectator) {
      const id = target!.id;
      void this.jobsCall({ type: 'release', managerId: id, remove: true }).catch((e) => this.ctx.log('kick release failed', { room: this.code, error: String(e) }));
    }
    this.leave(target!);
    if (sid) {
      const s = this.ctx.io.sockets.sockets.get(sid);
      s?.emit('error', { code: 'kicked', message: 'O host removeu você da sala.' });
    }
    this.ctx.log('player kicked', { room: this.code, player: target!.id });
  }

  setHost(host: PlayerRec, raw: unknown): void {
    if (host.id !== this.hostId) fail('Só o host pode passar o comando.');
    const target = this.player(V.id(V.obj(raw).playerId, 'Jogador'));
    if (!target || target.spectator) fail('Escolha um técnico da sala.');
    if (!target!.connected) fail(`${target!.nickname} está desconectado.`);
    this.hostId = target!.id;
    this.changed();
  }

  setColor(p: PlayerRec, raw: unknown): void {
    const color = V.obj(raw).color;
    if (!isColor(color)) fail('Cor inválida.');
    const other = this.players.find((x) => x !== p && x.color === color);
    if (other) fail(`${other.nickname} já usa esta cor.`);
    p.color = color as string;
    this.changed();
  }

  react(p: PlayerRec, raw: unknown): void {
    const emoji = V.obj(raw).emoji;
    if (typeof emoji !== 'string' || !(REACTIONS as readonly string[]).includes(emoji)) fail('Reação inválida.');
    const now = Date.now();
    if (p.react.length && now - p.react[p.react.length - 1] < REACT_GAP_MS) fail('Calma com as reações!');
    p.react = [...p.react.slice(-4), now];
    this.ctx.io.to(this.channel).emit('room:reaction', { playerId: p.id, emoji: emoji as Reaction, at: now });
  }

  /* ───────────── lobby ───────────── */

  updateSettings(p: PlayerRec, raw: unknown): void {
    if (p.id !== this.hostId) fail('Só o host altera as configurações.');
    const changed = applySettingsPatch(this.settings, raw, this.phase === 'lobby');
    // mudou o modo de escolha: draft/sorteio em curso caem
    if (changed.includes('pickMode')) this.cancelDraft();
    // velocidade: vale também para as partidas que já estão rolando
    if (changed.includes('matchSpeedMs')) for (const m of this.matches.values()) m.setSpeed(this.settings.matchSpeedMs);
    if (changed.includes('timerSec') && this.phase === 'planning') {
      // vale a partir da próxima vez/rodada
    }
    this.changed();
  }

  /**
   * (17/11) Qualquer clube jogável de qualquer região em escopo (Europa, América do Sul, Arábia): divisão nacional
   * real ou, no Brasil, divisão estadual. Clubes únicos na sala. Draft: só quem está na vez; sorteio: só o host sorteia.
   */
  pickClub(p: PlayerRec, raw: unknown): void {
    if (this.phase !== 'lobby') fail('Clubes só podem ser escolhidos no lobby.');
    if (p.spectator) fail('Espectadores não escolhem clube.');
    const clubId = V.id(V.obj(raw).clubId, 'Clube');
    const club = this.ctx.data.club(clubId);
    if (!club) fail('Clube não encontrado.');
    // (Etapa 2) clubes convidados (fora do escopo, só continentais) nunca são clubes humanos
    if (club!.guest) fail('Clube convidado (só disputa competições continentais) não pode ser escolhido.');
    if (!this.ctx.data.playableAll().has(clubId)) fail('Este clube não disputa nenhuma competição da carreira (divisão nacional ou estadual).');
    const other = this.ownerOf(clubId);
    if (other && other !== p) fail(`${other.nickname} já escolheu este clube.`);
    if (this.settings.pickMode === 'lottery') fail('Nesta sala os clubes são sorteados pelo host.');
    if (this.settings.pickMode === 'draft') {
      if (!this.draft || this.draft.current === null) fail(this.draftOrder ? 'O draft já terminou.' : 'Aguarde o host começar o draft.');
      if (this.draft!.current !== p.id) fail('Não é a sua vez no draft.');
      this.draftPick(p, clubId, false);
      return;
    }
    p.clubId = clubId;
    this.changed();
  }

  /* ───────────── (17/11) draft em serpentina e sorteio ───────────── */

  private cancelDraft(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    this.draft = null;
    this.draftOrder = null;
  }

  /** Host: ordem sorteada, uma escolha por técnico (a serpentina vale para as vezes da temporada). 45 s por escolha. */
  startDraft(host: PlayerRec): void {
    if (host.id !== this.hostId) fail('Só o host começa o draft.');
    if (this.phase !== 'lobby') fail('O draft é no lobby.');
    if (this.settings.pickMode !== 'draft') fail('Mude o modo de escolha para "Draft (serpentina)".');
    if (this.draft?.current) fail('O draft já está em andamento.');
    const ms = this.managers();
    for (const x of ms) x.clubId = null;
    const order = snakeOrder(shuffle(ms.map((x) => x.id)), 1);
    this.draftOrder = null;
    this.draft = { order, pick: -1, current: null, deadline: null, picks: [] };
    this.draftNext(true);
  }

  /** Próxima escolha do draft (pula quem saiu da sala). */
  private draftNext(broadcast: boolean): void {
    const d = this.draft;
    if (!d) return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    d.pick++;
    while (d.pick < d.order.length && !this.player(d.order[d.pick])) d.pick++;
    if (d.pick >= d.order.length) {
      d.current = null;
      d.deadline = null;
      this.draftOrder = d.order.filter((id) => this.player(id));
      this.ctx.log('draft done', { room: this.code });
    } else {
      d.current = d.order[d.pick];
      d.deadline = Date.now() + PICK_SECONDS * 1000;
      const pid = d.current;
      this.draftTimer = setTimeout(() => this.draftAutoPick(pid), this.ctx.opts.pickMs ?? PICK_SECONDS * 1000);
    }
    if (broadcast) this.changed();
  }

  private draftPick(p: PlayerRec, clubId: string, auto: boolean): void {
    p.clubId = clubId;
    this.draft!.picks.push({ playerId: p.id, clubId, ...(auto ? { auto: true } : {}) });
    this.draftNext(true);
  }

  /** Tempo esgotado: o melhor clube disponível (maior força: nível + reputação + orçamento). */
  private draftAutoPick(playerId: string): void {
    this.draftTimer = null;
    if (this.disposed || !this.draft || this.draft.current !== playerId) return;
    const p = this.player(playerId);
    if (!p) return this.draftNext(true);
    const taken = new Set(this.players.map((x) => x.clubId).filter((x): x is string => !!x));
    const best = bestAvailable(this.ctx.data.playableEntries(), taken);
    if (!best) return this.draftNext(true);
    this.draftPick(p, best.id, true);
  }

  /** Host: sorteia um clube para cada técnico dentro da faixa de dificuldade. */
  runLottery(host: PlayerRec): void {
    if (host.id !== this.hostId) fail('Só o host sorteia.');
    if (this.phase !== 'lobby') fail('O sorteio é no lobby.');
    if (this.settings.pickMode !== 'lottery') fail('Mude o modo de escolha para "Sorteio".');
    const taken = new Set<string>();
    const picks = new Map<PlayerRec, string>();
    for (const x of shuffle(this.managers())) {
      const c = randomInBand(this.ctx.data.playableEntries(), taken, this.settings.lotteryBand);
      if (!c) fail('Não há clubes suficientes nesta faixa de dificuldade.');
      taken.add(c!.id);
      picks.set(x, c!.id);
    }
    for (const [x, id] of picks) x.clubId = id;
    this.changed();
  }

  /** Ordem das vezes da rodada: a do draft em serpentina; sem draft, a ordem de entrada girando quem começa. */
  private turnOrder(): string[] {
    const humans = this.managers().filter((x) => x.clubId && this.humanClubIds.includes(x.clubId)).map((x) => x.id);
    // (carreira online) desempregado com proposta pendente ganha uma vez curta (no fim da ordem); sem proposta, é pulado
    const date = this.career?.date ?? null;
    const jobless = this.managers().filter((x) => this.isUnemployed(x) && pendingOfferCount(this.jobs, x.id, date) > 0).map((x) => x.id);
    const draft = (this.draftOrder ?? []).filter((id) => humans.includes(id));
    if (draft.length === humans.length && draft.length) return [...(this.round % 2 === 1 ? draft : draft.slice().reverse()), ...jobless];
    if (!humans.length) return jobless;
    const k = (Math.max(1, this.round) - 1) % humans.length;
    return [...humans.slice(k), ...humans.slice(0, k), ...jobless];
  }

  /** (carreira online salva) Sala sem técnico conectado: a carreira fica parada (cronômetros não andam). */
  private paused(): boolean {
    return !this.connectedManagers().length;
  }

  /** Alguém voltou: retoma os cronômetros parados no mesmo ponto. */
  private resumeIfPaused(): void {
    if (this.disposed || this.paused()) return;
    if (this.phase === 'planning' && this.career && !this.isTurns() && !this.planningTimer && !this.countdown) {
      const ms = this.ctx.opts.timerMs ?? this.settings.timerSec * 1000;
      if (ms > 0) {
        this.armPlanningTimer();
        this.broadcastState();
      }
    }
    if (this.phase === 'season-end' && this.seasonEnd && !this.seasonEnd.timer) {
      this.seasonEnd.deadline = Date.now() + this.ctx.opts.seasonEndTimeoutMs;
      this.armSeasonEndTimer();
      this.broadcastState();
    }
  }

  /** Host: cria a carreira (createCareer no simulador). Resolve quando a carreira existe. */
  async start(p: PlayerRec): Promise<void> {
    if (p.id !== this.hostId) fail('Só o host pode iniciar.');
    if (this.phase !== 'lobby' || this.starting) fail('A temporada já começou.');
    if (this.settings.pickMode === 'draft' && (!this.draftOrder || this.draft?.current)) fail('Termine o draft antes de iniciar.');
    const missing = this.managers().filter((x) => !x.clubId);
    if (missing.length) fail(`Falta escolher clube: ${missing.map((x) => x.nickname).join(', ')}.`);
    const humanClubIds = this.managers().map((x) => x.clubId!);
    if (new Set(humanClubIds).size !== humanClubIds.length) fail('Há clubes repetidos na sala.');
    const seed = this.ctx.opts.seedFor?.(this.code) ?? `${this.code}:${toHex(randomBytes(8))}`;
    this.starting = true;
    const t0 = performance.now();
    try {
      // (17/11) humanos de regiões diferentes: a carreira começa na data mais cedo entre os clubes (createCareer)
      const countryId = this.ctx.data.club(humanClubIds[0])?.countryId ?? this.settings.countryId;
      const res = await this.enqueue(() =>
        this.simCall<{ meta: CareerMeta }>({
          op: 'create', room: this.code, humanClubIds, season: this.ctx.opts.startSeason, seed, countryId,
          managers: this.managerSeeds(), firing: this.settings.firing,
        }),
      );
      if (this.disposed) return;
      this.humanClubIds = humanClubIds;
      this.career = res.meta;
      this.setups = {};
      this.settings.divisionIds = res.meta.divisionIds.slice();
      this.settings.countryId = countryId;
      if (this.draftTimer) clearTimeout(this.draftTimer);
      this.draft = null;
      this.friends = emptyFriends();
      for (const m of this.managers()) if (m.clubId) startTenure(this.friends, m.id, m.clubId, res.meta.date);
      this.onMeta(res.meta);
      this.ctx.log('career created', { room: this.code, humans: humanClubIds, ms: Math.round(performance.now() - t0) });
      this.toPlanning();
    } catch (e) {
      this.ctx.log('career create failed', { room: this.code, error: String(e) });
      fail('Falha ao criar a carreira.');
    } finally {
      this.starting = false;
    }
  }

  /* ───────────── planning ───────────── */

  setLineup(p: PlayerRec, raw: unknown): void {
    if (this.phase !== 'planning' || !this.career) fail('A escalação só pode ser alterada no planejamento.');
    if (!p.clubId) fail('Você não tem clube.');
    this.requireTurn(p);
    const squad = this.career!.humanSquads[p.clubId!];
    if (!squad) fail('Clube fora da temporada.');
    const o = V.obj(raw);
    const tactic = V.tactic(o.tactic);
    const lineup = o.lineup === null ? null : V.lineup(o.lineup, new Set(squad), tactic.formation);
    const clubId = p.clubId!;
    // (Táticas) predefinições: ausentes no payload ⇒ mantém as que o servidor já tem
    const presets = o.presets === undefined ? this.setups[clubId]?.presets : V.presets(o.presets, new Set(squad));
    const setup: ClubSetup = { tactic, lineup, ...(presets ? { presets } : {}) };
    this.setups[clubId] = setup;
    void this.enqueue(() => this.simCall({ op: 'set-lineup', room: this.code, clubId, setup })).catch((e) =>
      this.ctx.log('set-lineup failed', { room: this.code, error: String(e) }),
    );
    this.acted(p);
    if (this.isTurns() && !this.lineupFed) {
      this.lineupFed = true;
      this.feed(p, 'lineup', `${p.nickname} mexeu na escalação e na tática.`);
    }
    this.ctx.persist(this);
  }

  /** (17/11) Modo turnos: só o técnico da vez mexe no clube (escalação, mercado). */
  private requireTurn(p: PlayerRec): void {
    if (!this.isTurns()) return;
    if (this.turn?.playerId !== p.id) {
      const cur = this.player(this.turn?.playerId);
      fail(cur ? `Aguarde a sua vez (agora é a vez de ${cur.nickname}).` : 'Aguarde a sua vez.');
    }
  }

  /** Agiu: zera a contagem AFK. */
  private acted(p: PlayerRec): void {
    p.missed = 0;
    if (p.afk) {
      p.afk = false;
      this.broadcastState();
    }
  }

  private markMissed(p: PlayerRec): void {
    p.missed++;
    const n = this.settings.afkRounds;
    if (n > 0 && p.missed >= n && !p.afk) {
      p.afk = true;
      this.feed(p, 'info', `${p.nickname} ficou ${n} ${n > 1 ? 'rodadas' : 'rodada'} sem agir: o assistente assume até ele voltar.`);
    }
  }

  private feed(p: PlayerRec | null, kind: TurnFeedItem['kind'], text: string): void {
    this.ctx.io.to(this.channel).emit('turn:feed', { playerId: p?.id ?? '', clubId: p?.clubId ?? null, text, at: Date.now(), kind });
  }

  setReady(p: PlayerRec, raw: unknown): void {
    const ready = V.obj(raw).ready;
    if (typeof ready !== 'boolean') fail('ready inválido.');
    if (this.phase === 'season-end') {
      p.ready = ready as boolean;
      this.broadcastState();
      this.tryRollover();
      return;
    }
    if (this.phase !== 'planning') fail('Não há rodada aguardando "pronto".');
    if (p.spectator) fail('Espectadores não marcam pronto.');
    // (17/11) modo turnos: "pronto" de quem está na vez = concluir a vez
    if (this.isTurns()) {
      if (ready && this.turn?.playerId === p.id) this.endTurn(p, 'done');
      return;
    }
    p.ready = ready as boolean;
    if (ready) this.acted(p);
    this.broadcastState();
    this.tryAdvance();
  }

  /** (17/11) 'turn:end': conclui a minha vez. */
  endMyTurn(p: PlayerRec): void {
    if (this.phase !== 'planning' || !this.isTurns()) fail('Não há vez em andamento.');
    if (this.turn?.playerId !== p.id) fail('Não é a sua vez.');
    this.endTurn(p, 'done');
  }

  /** (17/11) Host força o avanço. */
  force(host: PlayerRec): void {
    if (host.id !== this.hostId) fail('Só o host pode forçar o avanço.');
    if (this.phase !== 'planning') fail('Só no planejamento.');
    if (this.isTurns()) {
      const cur = this.player(this.turn?.playerId);
      if (!cur) fail('Não há vez em andamento.');
      if (cur !== host && this.turn!.deadline && Date.now() < this.turn!.deadline) fail('Aguarde o cronômetro da vez acabar.');
      this.endTurn(cur!, cur === host ? 'done' : 'force');
      return;
    }
    if (this.planningDeadline && Date.now() < this.planningDeadline) fail('Aguarde o cronômetro do planejamento acabar.');
    this.autoReadyAll();
    this.advanceNow();
  }

  /* ───────────── (17/11) modo turnos (estilo Brasfoot) ───────────── */

  /** Pode jogar a vez agora: presente (ou recarregando a página, dentro da tolerância) e fora da regra AFK. */
  private canPlayTurn(p: PlayerRec): boolean {
    // todos os conectados AFK: ninguém é pulado na hora (senão as rodadas correriam sozinhas); o cronômetro decide
    return (!p.afk || this.allAfk()) && !p.spectator && (this.present(p) || this.inGrace(p));
  }

  private allAfk(): boolean {
    const on = this.connectedManagers();
    return on.length > 0 && on.every((x) => x.afk);
  }

  /** Simultâneo: AFK conta como pronto (salvo se todos os conectados estão AFK); desempregado não trava a rodada. */
  private readyOrAfk(x: PlayerRec): boolean {
    return x.ready || (x.afk && !this.allAfk()) || (this.isUnemployed(x) && this.connectedManagers().some((m) => !this.isUnemployed(m)));
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private startTurns(): void {
    this.clearTurnTimer();
    this.turn = { round: this.round, order: this.turnOrder(), index: -1, playerId: null, startedAt: Date.now(), deadline: null, done: [] };
    this.nextTurn(true);
  }

  /**
   * Passa a vez ao próximo técnico que pode jogar; quem está ausente/AFK tem a vez feita pelo assistente na hora.
   * Acabou a ordem: a rodada avança para todos. Ninguém conectado: a rodada para até alguém voltar.
   */
  private nextTurn(advance: boolean): void {
    const t = this.turn;
    if (!t || this.phase !== 'planning' || this.disposed) return;
    this.clearTurnTimer();
    if (advance) t.index++;
    t.playerId = null;
    t.deadline = null;
    if (!this.connectedManagers().length) {
      this.changed();
      return;
    }
    while (t.index < t.order.length) {
      const p = this.player(t.order[t.index]);
      if (p && !t.done.includes(p.id) && this.canPlayTurn(p)) break;
      if (p && !t.done.includes(p.id) && this.isUnemployed(p)) {
        // desempregado ausente: sem assistente e sem AFK (as propostas esperam até vencer)
        t.done.push(p.id);
      } else if (p && !t.done.includes(p.id)) {
        t.done.push(p.id);
        this.markMissed(p);
        this.seeOffers(p);
        this.feed(p, 'turn', `O assistente cuidou da vez de ${p.nickname}${p.afk ? ' (AFK)' : ' (ausente)'}.`);
      }
      t.index++;
    }
    if (t.index >= t.order.length) {
      this.changed();
      this.advanceNow();
      return;
    }
    const p = this.player(t.order[t.index])!;
    t.playerId = p.id;
    t.startedAt = Date.now();
    let ms = this.ctx.opts.timerMs ?? this.settings.timerSec * 1000;
    // (carreira online) vez de desempregado é curta: responder às propostas sem travar os outros
    if (this.isUnemployed(p)) {
      const cap = this.ctx.opts.joblessTurnMs ?? JOBLESS_TURN_MS;
      ms = ms > 0 ? Math.min(ms, cap) : cap;
    }
    t.deadline = ms > 0 ? t.startedAt + ms : null;
    this.lineupFed = false;
    this.seeOffers(p);
    this.armTurnTimers();
    this.feed(p, 'turn', `Vez de ${p.nickname}.`);
    this.changed();
  }

  /** Cronômetro da vez e tolerância de quem caiu na própria vez. */
  private armTurnTimers(): void {
    this.clearTurnTimer();
    const t = this.turn;
    const p = this.player(t?.playerId);
    if (!t || !p) return;
    const now = Date.now();
    let at = t.deadline ?? Infinity;
    let why: 'timeout' | 'absent' = 'timeout';
    if (!p.connected) {
      const g = this.inGrace(p) ? p.graceUntil! : now;
      if (g < at) {
        at = g;
        why = 'absent';
      }
    }
    if (at === Infinity) return;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (this.turn?.playerId !== p.id) return;
      if (why === 'absent' && p.connected) return this.armTurnTimers();
      this.endTurn(p, why);
    }, Math.max(0, at - now) + 5);
  }

  /** Fim da vez: concluída, cronômetro, ausência ou forçada pelo host (o assistente cuida do resto). */
  private endTurn(p: PlayerRec, how: 'done' | 'timeout' | 'absent' | 'force'): void {
    const t = this.turn;
    if (!t || t.playerId !== p.id) return;
    this.clearTurnTimer();
    t.done.push(p.id);
    if (how === 'done') {
      this.acted(p);
      this.feed(p, 'turn', `${p.nickname} concluiu a vez.`);
    } else if (this.isUnemployed(p)) {
      this.feed(p, 'turn', `${p.nickname} (sem clube): a vez acabou — as propostas continuam valendo até o prazo.`);
    } else {
      this.markMissed(p);
      const why = how === 'timeout' ? 'o tempo acabou' : how === 'absent' ? 'saiu da sala' : 'o host avançou';
      this.feed(p, 'turn', `${p.nickname}: ${why} — o assistente concluiu a vez.`);
    }
    this.nextTurn(true);
  }

  /** Propostas de outros técnicos pelos jogadores de `p` ficam visíveis (já pode responder; expiram no fim da rodada). */
  private seeOffers(p: PlayerRec): void {
    for (const [oid, seller] of this.unseenOffers) if (seller === p.clubId) this.unseenOffers.delete(oid);
  }

  /* ───────────── (17/11) modo simultâneo: cronômetro e contagem ───────────── */

  private clearPlanningTimers(): void {
    if (this.planningTimer) clearTimeout(this.planningTimer);
    this.planningTimer = null;
    this.planningDeadline = null;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.countdown = null;
  }

  private armPlanningTimer(): void {
    const ms = this.ctx.opts.timerMs ?? this.settings.timerSec * 1000;
    if (ms <= 0) return;
    this.planningDeadline = Date.now() + ms;
    this.planningTimer = setTimeout(() => {
      this.planningTimer = null;
      if (this.phase !== 'planning' || this.isTurns()) return;
      // (carreira online salva) ninguém conectado: pausa (retoma quando alguém voltar)
      if (this.paused()) {
        this.planningDeadline = null;
        return;
      }
      // tempo esgotado: quem não marcou pronto é marcado (o assistente escala) e a rodada segue
      this.autoReadyAll();
      this.advanceNow();
    }, ms);
  }

  private autoReadyAll(): void {
    for (const x of this.connectedManagers()) {
      if (x.ready) continue;
      x.ready = true;
      this.markMissed(x);
      this.feed(x, 'info', `${x.nickname} não marcou pronto a tempo: o assistente cuidou da escalação.`);
    }
  }

  /** Limpa vez, cronômetros, contagem e votação (a rodada vai começar / a sala voltou ao lobby). */
  private clearRoundFlow(): void {
    this.clearTurnTimer();
    this.turn = null;
    this.clearPlanningTimers();
    this.clearVote();
  }

  /* ───────────── mercado (só no planejamento) ───────────── */

  /**
   * Ação de mercado do clube do jogador: roda no simulador (engine) e, se mudou o estado, manda 'market:update'
   * (market + clubes envolvidos + notícias novas, gzip) para a sala inteira. O snapshot completo guardado pela sala
   * (rejoin/disco/reidratação) é atualizado pelo simulador sem broadcast.
   */
  async marketAction(p: PlayerRec, type: MarketAction['type'], raw: unknown): Promise<MarketActionResult> {
    const notPlanning = 'O mercado só funciona no planejamento (entre as rodadas).';
    if (this.phase !== 'planning' || !this.career) fail(notPlanning);
    const clubId = p.clubId;
    if (!clubId || !this.humanClubIds.includes(clubId)) fail('Você não tem clube nesta temporada.');
    this.requireTurn(p);
    const action = parseMarketAction(type, raw);
    const res = await this.enqueue(() => {
      // a rodada pode ter começado enquanto a ação esperava na fila
      if (this.phase !== 'planning') fail(notPlanning);
      return this.simCall<MarketResponse>({ op: 'market', room: this.code, clubId: clubId!, action, noHumanDeals: !this.settings.h2hTransfers }, undefined, false);
    });
    if (this.disposed) fail('Sala encerrada.');
    this.career = res.meta;
    if (res.changed) {
      this.acted(p);
      this.marketFeed(p, type, res);
      // modo turnos: a proposta a outro técnico espera a vez dele (não expira antes de ele ver)
      const o = res.offer as { id: string; fromClubId: string } | undefined;
      // (fica "não vista" até a próxima vez do dono começar — nesta rodada, se ele ainda vai jogar; senão na seguinte)
      if (res.pendingHuman && o && this.isTurns()) this.unseenOffers.set(o.id, o.fromClubId);
    }
    if (res.changed && res.patch) {
      // escalação salva com quem saiu do elenco: cai (o cliente reescala; a reidratação não usa ids inválidos)
      for (const id of res.touched) {
        const s = this.setups[id];
        const squad = new Set(res.meta.humanSquads[id] ?? []);
        if (s?.lineup && [...s.lineup.starters, ...s.lineup.bench].some((x) => !squad.has(x))) this.setups[id] = { ...s, lineup: null };
      }
      this.ctx.io.to(this.channel).compress(false).emit('market:update', {
        version: res.patch.version, date: res.patch.date, encoding: 'gzip-json', patchGz: res.patch.gz, by: p.id, action: type,
        bytes: { json: res.patch.json, gz: res.patch.gz.byteLength },
      });
      this.ctx.log('market', { room: this.code, player: p.id, action: type, version: res.patch.version, json: res.patch.json, gz: res.patch.gz.byteLength });
    }
    if (!res.ok) fail(res.error ?? 'Ação recusada.');
    const out: MarketActionResult = { version: res.meta.version };
    if (res.offer) out.offer = res.offer;
    if (res.club) out.club = res.club;
    if (res.contract) out.contract = res.contract;
    if (res.record) out.record = res.record;
    if (res.pendingHuman) out.pendingHuman = true;
    return out;
  }

  /**
   * Todos os humanos CONECTADOS prontos ⇒ avança. Quem caiu há pouco (recarregou a página) ainda é esperado até
   * `graceUntil`; depois disso os desconectados não travam a sala.
   */
  tryAdvance(): void {
    if (this.phase !== 'planning' || !this.career || this.disposed || this.isTurns()) return;
    const online = this.connectedManagers();
    if (!online.length || !online.every((x) => this.readyOrAfk(x))) {
      // alguém desmarcou durante a contagem: cancela
      if (this.countdown) {
        if (this.countdownTimer) clearTimeout(this.countdownTimer);
        this.countdownTimer = null;
        this.countdown = null;
        this.broadcastState();
      }
      return;
    }
    const waiting = this.players.filter((x) => this.inGrace(x));
    if (waiting.length) {
      // reavalia quando a tolerância do primeiro acabar (ou antes, se ele voltar: attach chama tryAdvance)
      const until = Math.min(...waiting.map((x) => x.graceUntil!));
      if (this.graceWait) clearTimeout(this.graceWait);
      this.graceWait = setTimeout(() => {
        this.graceWait = null;
        this.broadcastState();
        this.tryAdvance();
      }, Math.max(0, until - Date.now()) + 5);
      return;
    }
    if (this.graceWait) clearTimeout(this.graceWait);
    this.graceWait = null;
    // (17/11) todos prontos: contagem 3-2-1 (cancelada se alguém desmarcar)
    if (this.countdown) return;
    const ms = this.ctx.opts.countdownMs ?? COUNTDOWN_MS;
    if (ms <= 0) return this.advanceNow();
    this.countdown = { endsAt: Date.now() + ms };
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      this.countdown = null;
      if (this.phase !== 'planning') return;
      const on = this.connectedManagers();
      if (on.length && on.every((x) => this.readyOrAfk(x))) this.advanceNow();
      else this.broadcastState();
    }, ms);
    this.broadcastState();
  }

  /** Começa a rodada já (todos prontos / última vez concluída / cronômetro / host). */
  private advanceNow(): void {
    if (this.phase !== 'planning' || !this.career || this.disposed) return;
    this.ctx.beforeAdvance?.(this);
    this.clearRoundFlow();
    if (this.graceWait) clearTimeout(this.graceWait);
    this.graceWait = null;
    this.phase = 'simulating';
    this.broadcastState();
    const t0 = performance.now();
    // (17/11) partidas rápidas: os jogos dos humanos são simulados (a rodada joga o dia e para no próximo dia de jogo)
    if (this.settings.matchMode === 'quick') {
      void this.runRound({ kind: 'next-match' }, [], t0).catch(() => undefined);
      return;
    }
    const live = this.humanClubIds.filter((c) => this.present(this.ownerOf(c)));
    void this.runRound({ kind: 'match' }, live, t0).catch(() => undefined);
  }

  /**
   * (online grátis) Failover: o anfitrião anterior caiu no meio da rodada (simulando / dia de jogo). O novo anfitrião
   * carregou o checkpoint do planejamento e REJOGA o dia (engine determinística: sem comandos humanos, mesmo placar).
   */
  async replayAdvance(): Promise<boolean> {
    if (this.needsHydrate) await this.restore();
    if (this.phase !== 'planning' || !this.career || this.disposed) return false;
    this.ctx.log('failover: rejogando a rodada a partir do checkpoint', { room: this.code });
    this.advanceNow();
    return true;
  }

  /** Texto público (nível "rival") de uma ação de mercado, para o feed da vez e a Liga dos Amigos. */
  private marketFeed(p: PlayerRec, type: MarketAction['type'], res: MarketResponse): void {
    const money = (v: number) => fmtMoneyShort(v);
    const rec = res.record;
    const o = res.offer;
    let text: string | null = null;
    let kind: TurnFeedItem['kind'] = 'offer';
    if (rec && rec.toClubId === p.clubId) {
      kind = 'signing';
      text = rec.kind === 'loan' ? `${p.nickname} pegou ${rec.playerName} emprestado do ${rec.fromName || 'mercado'}.` : `${p.nickname} contratou ${rec.playerName}${rec.fromName ? ` (${rec.fromName})` : ''}${rec.fee > 0 ? ` por ${money(rec.fee)}` : ' (livre)'}.`;
      pushFeed(this.friends, { at: Date.now(), date: this.career?.date ?? null, kind: 'signing', text, clubIds: [p.clubId!] });
      this.emitFriends();
    } else if (rec && rec.fromClubId === p.clubId && rec.toClubId) {
      kind = 'sale';
      text = `${p.nickname} vendeu ${rec.playerName} ao ${rec.toName}${rec.fee > 0 ? ` por ${money(rec.fee)}` : ''}.`;
      pushFeed(this.friends, { at: Date.now(), date: this.career?.date ?? null, kind: 'sale', text, clubIds: [p.clubId!] });
      this.emitFriends();
    } else if (type === 'offer' && o) {
      text = `${p.nickname} fez uma proposta por ${o.player.name} (${o.fromName || 'livre'}).`;
    } else if (type === 'list' || type === 'loanlist') {
      kind = 'list';
      text = `${p.nickname} mexeu na lista de ${type === 'list' ? 'transferências' : 'empréstimos'}.`;
    } else if (type === 'promote') {
      kind = 'signing';
      text = `${p.nickname} promoveu um jogador da base.`;
    } else if (type === 'release') {
      kind = 'sale';
      text = `${p.nickname} rescindiu um contrato.`;
    } else if (type === 'renew') {
      text = `${p.nickname} renovou um contrato.`;
    } else if (type === 'budget') {
      kind = 'list';
      text = `${p.nickname} reequilibrou os orçamentos do clube.`;
    } else if (type === 'respond' && o) {
      text = `${p.nickname} respondeu a uma proposta por ${o.player.name}.`;
    }
    if (text) this.feed(p, kind, text);
  }

  /** Avança dias no simulador; para no próximo dia com jogo humano ao vivo, no fim da temporada ou no `until`. */
  private async runRound(until: RoundUntil, live: string[], t0: number): Promise<RoundResponse> {
    try {
      const res = await this.enqueue(() =>
        this.simCall<RoundResponse>(
          { op: 'round', room: this.code, live, until, maxDays: MAX_SIM_DAYS, keepOffers: [...this.unseenOffers.keys()], firing: this.settings.firing },
          (d) => this.emitResults(d),
        ),
      );
      if (this.disposed) return res;
      this.career = res.meta;
      this.onMeta(res.meta);
      this.lastRound = { days: res.days, games: res.games, simMs: Math.round(res.simMs), maxDayMs: Math.round(res.maxDayMs) };
      this.ctx.log('round advanced', { room: this.code, reason: res.reason, ...this.lastRound, ms: Math.round(performance.now() - t0) });
      if (res.reason === 'matchday' && res.matches.length) {
        this.startMatchday(res.matches);
        this.lastAdvanceMs = performance.now() - t0;
        this.ctx.log('ready -> match:start', { room: this.code, ms: Math.round(this.lastAdvanceMs) });
      } else if (res.meta.over) {
        await this.enterSeasonEnd();
      } else {
        this.toPlanning();
      }
      return res;
    } catch (e) {
      this.simFailure('runRound', e);
      throw e;
    }
  }

  private simFailure(where: string, e: unknown): void {
    this.ctx.log(`${where} error`, { room: this.code, error: String(e) });
    if (this.disposed) return;
    this.clearPreview();
    for (const m of this.matches.values()) m.stop();
    this.matches.clear();
    this.phase = this.career ? 'planning' : 'lobby';
    for (const x of this.players) x.ready = false;
    this.ctx.io.to(this.channel).emit('error', { code: 'simulation', message: 'Falha ao simular a rodada.' });
    this.changed();
  }

  /** Novo planejamento: rodada +1; turnos ⇒ primeira vez; simultâneo ⇒ cronômetro. */
  private toPlanning(): void {
    this.phase = 'planning';
    this.round++;
    this.clearRoundFlow();
    for (const x of this.players) x.ready = false;
    if (this.isTurns()) {
      this.startTurns(); // (já faz changed)
      if (this.phase !== 'planning') return;
    } else {
      this.armPlanningTimer();
    }
    this.changed();
  }

  private emitResults(d: DayPlayed): void {
    if (this.disposed) return;
    this.ctx.io.to(this.channel).emit('round:results', d);
    // (17/11) Liga dos Amigos: confrontos diretos entre humanos
    let h2h = false;
    for (const r of d.results) {
      if (!this.humanClubIds.includes(r.homeId) || !this.humanClubIds.includes(r.awayId)) continue;
      recordH2H(this.friends, r.homeId, r.awayId, r.home, r.away, d.date, (id) => this.nameOf(id), this.ownerIdOf);
      h2h = true;
    }
    if (h2h) this.emitFriends();
  }

  /* ───────────── (17/11) Liga dos Amigos ───────────── */

  /** "Apelido (Clube)" do dono humano, ou o nome do clube. */
  private nameOf(clubId: string): string {
    const owner = this.ownerOf(clubId);
    const club = this.ctx.data.club(clubId)?.name ?? clubId;
    return owner ? `${owner.nickname} (${club})` : club;
  }

  private onMeta(meta: CareerMeta): void {
    updateFromMeta(this.friends, meta.humans, meta.season, meta.date, (id) => this.nameOf(id), this.ownerIdOf);
    this.emitFriends();
  }

  friendsLeague(): FriendsLeague {
    // (carreira online) técnicos desempregados também aparecem (com o que conquistaram nos clubes anteriores)
    const ps = this.managers()
      .filter((p) => (p.clubId && this.humanClubIds.includes(p.clubId)) || (this.isUnemployed(p) && !!this.jobs?.managers[p.id]))
      .map((p) => ({ playerId: p.id, nickname: p.nickname, clubId: p.clubId && this.humanClubIds.includes(p.clubId) ? p.clubId : null, color: p.color }));
    return computeFriendsLeague(this.friends, ps);
  }

  private emitFriends(): void {
    if (this.disposed || !this.career) return;
    this.ctx.io.to(this.channel).emit('friends:update', this.friendsLeague());
  }

  /* ───────────── (17/11) votações: pular no tempo e pausar ───────────── */

  private clearVote(): void {
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.voteTimer = null;
    this.vote = null;
  }

  /** Maioria dos técnicos conectados. */
  private votesNeeded(): number {
    return Math.floor(this.connectedManagers().length / 2) + 1;
  }

  propose(p: PlayerRec, raw: unknown): void {
    if (p.spectator) fail('Espectadores não votam.');
    if (this.vote) fail('Já há uma votação em andamento.');
    const o = V.obj(raw);
    const kind = o.kind;
    if (kind === 'skip') {
      if (!this.settings.skipVotes) fail('Votação para pular desligada nesta sala.');
      if (this.phase !== 'planning' || !this.career) fail('Só dá para pular no planejamento.');
      const until = typeof o.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.until) ? o.until : fail('Data inválida.');
      const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${this.career!.date}T00:00:00Z`)) / 86_400_000;
      if (!(days >= 1)) fail('Escolha uma data depois de hoje.');
      if (days > MAX_SKIP_DAYS) fail('No máximo 3 anos por salto.');
      const label = o.label === undefined ? undefined : V.cleanText(V.str(o.label, 'Rótulo', 60));
      this.openVote({ kind: 'skip', by: p.id, until, ...(label ? { label } : {}) });
    } else if (kind === 'pause') {
      if (!this.settings.pauseVotes) fail('Votação para pausar desligada nesta sala.');
      if (this.phase !== 'matchday' || ![...this.matches.values()].some((m) => m.started && !m.finished)) fail('Não há partida ao vivo.');
      this.openVote({ kind: 'pause', by: p.id });
    } else fail('Votação inválida.');
  }

  private openVote(v: { kind: 'skip' | 'pause'; by: string; until?: string; label?: string }): void {
    const ms = this.ctx.opts.voteMs ?? VOTE_SECONDS * 1000;
    this.vote = { id: newId('v_'), ...v, deadline: Date.now() + ms, yes: [v.by], no: [], needed: this.votesNeeded() };
    this.voteTimer = setTimeout(() => this.resolveVote(true), ms);
    this.broadcastState();
    this.checkVote();
  }

  cast(p: PlayerRec, raw: unknown): void {
    const o = V.obj(raw);
    const v = this.vote;
    if (!v || v.id !== o.id) fail('Votação encerrada.');
    if (p.spectator) fail('Espectadores não votam.');
    if (typeof o.yes !== 'boolean') fail('Voto inválido.');
    v!.yes = v!.yes.filter((x) => x !== p.id);
    v!.no = v!.no.filter((x) => x !== p.id);
    (o.yes ? v!.yes : v!.no).push(p.id);
    this.broadcastState();
    this.checkVote();
  }

  /** Decide quando já dá: maioria atingida, ou impossível atingir. */
  private checkVote(): void {
    const v = this.vote;
    if (!v) return;
    const online = new Set(this.connectedManagers().map((x) => x.id));
    v.needed = this.votesNeeded();
    const yes = v.yes.filter((x) => online.has(x)).length;
    const pending = [...online].filter((x) => !v.yes.includes(x) && !v.no.includes(x)).length;
    if (yes >= v.needed || yes + pending < v.needed) this.resolveVote(false);
  }

  private resolveVote(timeout: boolean): void {
    const v = this.vote;
    if (!v) return;
    const online = new Set(this.connectedManagers().map((x) => x.id));
    const yes = v.yes.filter((x) => online.has(x)).length;
    const needed = this.votesNeeded();
    const passed = yes >= needed;
    this.clearVote();
    this.ctx.io.to(this.channel).emit('vote:result', { id: v.id, kind: v.kind, passed, yes, needed });
    this.ctx.log('vote', { room: this.code, kind: v.kind, passed, yes, needed, timeout });
    if (passed && v.kind === 'skip' && this.phase === 'planning' && v.until) void this.runSkip(v.until, v.by);
    else if (passed && v.kind === 'pause') {
      for (const m of this.matches.values()) m.forcePause(this.ctx.opts.pauseTimeoutMs);
      this.broadcastState();
    } else this.broadcastState();
  }

  /** Host cancela o salto (para no fim do pedaço atual). */
  cancelSkip(host: PlayerRec): void {
    if (host.id !== this.hostId) fail('Só o host cancela o salto.');
    if (!this.skip) fail('Não há salto em andamento.');
    this.skipCancel = true;
  }

  /**
   * Salto votado: pedaços de 15 dias com o assistente em todos os humanos (mesma lógica do salto solo). Para no fim de
   * temporada de qualquer humano ou numa proposta grande por um jogador humano (banner de quem é a parada).
   */
  private async runSkip(until: string, by: string): Promise<void> {
    if (!this.career) return;
    this.clearRoundFlow();
    this.phase = 'simulating';
    this.skipCancel = false;
    const from = this.career.date;
    const wv0 = this.snap?.worldVersion ?? 0;
    this.skip = { from, until, date: from, by, startedAt: Date.now() };
    for (const x of this.players) x.ready = false;
    this.broadcastState();
    let end: SkipEndPayload = { reason: 'done', date: from, days: 0 };
    let days = 0;
    try {
      for (;;) {
        // (carreira online salva) todo mundo saiu: o salto para (a carreira pausa)
        if (this.skipCancel || this.paused()) {
          end = { reason: 'cancelled', date: this.career.date, days };
          break;
        }
        const res = await this.enqueue(() =>
          this.simCall<SkipResponse>({ op: 'skip', room: this.code, until, days: SKIP_CHUNK_DAYS, playerOfferPct: this.ctx.opts.skipOfferPct }, (d) => this.emitResults(d), false),
        );
        if (this.disposed) return;
        this.career = res.meta;
        this.onMeta(res.meta);
        days += res.days;
        this.skip = { ...this.skip!, date: res.meta.date };
        this.ctx.io.to(this.channel).emit('skip:progress', this.skip);
        if (res.reason) {
          const owner = res.stopClubId ? this.ownerOf(res.stopClubId) : null;
          end = { reason: res.reason, ...(res.note ? { note: owner ? `${owner.nickname}: ${res.note}` : res.note } : {}), clubId: res.stopClubId, playerId: owner?.id ?? null, date: res.meta.date, days };
          break;
        }
        if (days > MAX_SKIP_DAYS + 30) {
          end = { reason: 'limit', date: res.meta.date, days };
          break;
        }
      }
    } catch (e) {
      this.ctx.log('skip error', { room: this.code, error: String(e) });
      end = { reason: 'error', note: 'Falha ao simular o salto.', date: this.career?.date ?? from, days };
    }
    this.skip = null;
    // o salto não manda snapshot a cada pedaço: agora sim (com o mundo se houve virada). O snapshot do último pedaço
    // chega do simulador logo depois da resposta: espera por ele.
    const want = this.career?.version ?? 0;
    for (let i = 0; i < 500 && (this.snap?.version ?? 0) < want && !this.disposed; i++) await new Promise((r) => setTimeout(r, 20));
    this.sendSnapshot(undefined, (this.snap?.worldVersion ?? 0) !== wv0);
    this.ctx.io.to(this.channel).emit('skip:end', end);
    this.ctx.log('skip done', { room: this.code, ...end });
    if (this.disposed) return;
    if (end.reason === 'season-end') await this.enterSeasonEnd();
    else this.toPlanning();
  }

  /** (dev) avanço rápido do host — simula também os jogos humanos. */
  async devAdvance(p: PlayerRec, raw: unknown): Promise<{ date: string; days: number }> {
    if (!this.ctx.opts.devCommands) fail('Comandos de desenvolvimento desligados (DEV_COMMANDS=1).');
    if (p.id !== this.hostId) fail('Só o host pode avançar.');
    if (this.phase !== 'planning' || !this.career) fail('Só no planejamento.');
    const u = V.obj(raw).until;
    let until: RoundUntil;
    if (u === 'next-match') until = { kind: 'next-match' };
    else if (u === 'season-end') until = { kind: 'season-end' };
    else if (typeof u === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u)) until = { kind: 'date', date: u };
    else return fail('until inválido.');
    this.clearRoundFlow();
    this.phase = 'simulating';
    for (const x of this.players) x.ready = false;
    this.broadcastState();
    const res = await this.runRound(until, [], performance.now());
    return { date: res.meta.date, days: res.days };
  }

  /* ───────────── matchday ───────────── */

  private startPayload(m: LiveMatch, side: 'home' | 'away' | null) {
    return {
      matchId: m.id, config: m.publicConfig(), state: m.sim.state, side,
      homePlayerId: m.homePlayerId, awayPlayerId: m.awayPlayerId, speedMs: m.speedMs, fixture: fixtureInfo(m.fixture),
    };
  }

  private startMatchday(fixtures: LiveFixture[]): void {
    this.phase = 'matchday';
    this.playedResults = {};
    this.matches.clear();
    const io = this.ctx.io;
    const created: LiveMatch[] = [];
    for (const { fixture: f, config } of fixtures) {
      const homeP = this.ownerOf(f.homeId) ?? null;
      const awayP = this.ownerOf(f.awayId) ?? null;
      config.home.control = this.present(homeP) ? 'human' : 'ai';
      config.away.control = this.present(awayP) ? 'human' : 'ai';
      const m = new LiveMatch(
        f as Fixture, config, { home: homeP?.id ?? null, away: awayP?.id ?? null },
        { speedMs: this.settings.matchSpeedMs, halfTimeTimeoutMs: this.ctx.opts.halfTimeTimeoutMs, pauseTimeoutMs: this.ctx.opts.pauseTimeoutMs },
        {
          // (Rodada ao vivo) ticks, pausas e fim vão para a SALA inteira (técnicos de folga, desempregados,
          // espectadores): um lote por janela para "todos" — o relay replica a saída sem custo de requisição
          tick: (_mm, t) => io.to(this.channel).emit('match:tick', t),
          info: (mm) => io.to(this.channel).emit('match:info', mm.info()),
          pause: (_mm, p) => io.to(this.channel).emit('match:pause', p),
          end: (mm, r) => this.onMatchEnd(mm, r),
          activeHumans: (mm) => [mm.homePlayerId, mm.awayPlayerId].filter((id): id is string => this.present(this.player(id))),
        },
      );
      this.matches.set(m.id, m);
      created.push(m);
    }
    this.matchInfos = created.map((m) => m.info());
    this.ctx.persist(this);
    this.broadcastState();
    for (const m of created) {
      for (const pid of [m.homePlayerId, m.awayPlayerId]) {
        const p = this.player(pid);
        if (!p?.socketId) continue;
        io.sockets.sockets.get(p.socketId)?.join(this.matchChannel(m.id));
      }
    }
    // pré-jogo: confronto + escalações agora, a bola rola em `preMatchMs` (as partidas já existem; rejoin recebe o preview)
    const delay = this.ctx.opts.preMatchMs;
    const hasHuman = created.some((m) => [m.homePlayerId, m.awayPlayerId].some((id) => this.present(this.player(id))));
    if (delay > 0 && hasHuman) {
      const startsAt = Date.now() + delay;
      for (const m of created) {
        for (const pid of [m.homePlayerId, m.awayPlayerId]) {
          const p = this.player(pid);
          if (p?.socketId) io.to(p.socketId).emit('match:preview', this.previewPayload(m, m.sideOf(p.id), startsAt));
        }
      }
      this.preview = { startsAt, timer: setTimeout(() => this.kickOff(created), delay) };
      return;
    }
    this.kickOff(created);
  }

  private previewPayload(m: LiveMatch, side: 'home' | 'away' | null, startsAt: number): MatchPreviewPayload {
    return {
      matchId: m.id, fixture: fixtureInfo(m.fixture), config: m.publicConfig(), side,
      homePlayerId: m.homePlayerId, awayPlayerId: m.awayPlayerId, startsAt,
      // quanto falta no envio: o relógio de quem simula (anfitrião no navegador) não é o do cliente
      inMs: Math.max(0, startsAt - Date.now()),
    };
  }

  /** Fim do pré-jogo: match:start para os humanos (os que estão conectados agora) e a bola rola. */
  private kickOff(created: LiveMatch[]): void {
    if (this.preview) clearTimeout(this.preview.timer);
    this.preview = null;
    if (this.disposed || this.phase !== 'matchday') return;
    const io = this.ctx.io;
    for (const m of created) {
      if (!this.matches.has(m.id)) continue;
      // quem caiu durante o pré-jogo começa com a IA (volta ao controle no rejoin)
      for (const side of ['home', 'away'] as const) {
        const p = this.player(side === 'home' ? m.homePlayerId : m.awayPlayerId);
        if (p && !this.present(p)) m.setControl(side, 'ai');
      }
      for (const pid of [m.homePlayerId, m.awayPlayerId]) {
        const p = this.player(pid);
        if (!p?.socketId) continue;
        io.to(p.socketId).emit('match:start', this.startPayload(m, m.sideOf(p.id)));
      }
      // (Rodada ao vivo) a mesma partida, só leitura (side null), para a sala inteira assistir
      io.to(this.channel).emit('match:start', this.startPayload(m, null));
    }
    for (const m of created) if (this.matches.has(m.id)) m.start();
  }

  private onMatchEnd(m: LiveMatch, result: MatchResult): void {
    this.playedResults[m.id] = result;
    this.ctx.io.to(this.channel).emit('match:end', {
      matchId: m.id, result,
      ...(result.aggregate ? { aggregate: { ...result.aggregate } } : {}),
      ...(result.advancing ? { advancing: result.advancing } : {}),
      ...(result.penalties ? { penalties: { ...result.penalties } } : {}),
    });
    if ([...this.matches.values()].every((x) => x.finished)) defer(() => void this.finishMatchday());
  }

  /** Fecha o dia de jogo no simulador (resultados ao vivo + jogos simulados do dia). */
  private async finishMatchday(): Promise<void> {
    if (this.disposed || this.phase !== 'matchday' || !this.career) return;
    const results = this.playedResults;
    let res: RoundResponse;
    try {
      res = await this.enqueue(() =>
        this.simCall<RoundResponse>(
          // (18/11) fecha o dia e já avança até o próximo dia de jogo de um humano: o planejamento é no dia do jogo
          { op: 'round', room: this.code, results, live: [], until: { kind: 'prep' }, maxDays: MAX_SIM_DAYS, firing: this.settings.firing },
          (d) => this.emitResults(d),
        ),
      );
    } catch (e) {
      // volta ao planejamento do mesmo dia (a rodada pode ser refeita: engine determinística)
      this.simFailure('finishMatchday', e);
      return;
    }
    if (this.disposed) return;
    this.career = res.meta;
    this.onMeta(res.meta);
    this.matchInfos = [...this.matches.values()].map((m) => m.info());
    for (const m of this.matches.values()) {
      m.stop();
      this.ctx.io.in(this.matchChannel(m.id)).socketsLeave(this.matchChannel(m.id));
    }
    this.matches.clear();
    this.playedResults = {};
    if (res.meta.over) await this.enterSeasonEnd();
    else this.toPlanning();
  }

  private matchOf(p: PlayerRec, raw: unknown): LiveMatch {
    const matchId = V.id(V.obj(raw).matchId, 'matchId');
    const m = this.matches.get(matchId);
    if (!m) fail('Partida não encontrada.');
    if (!m!.sideOf(p.id)) fail('Você não está nesta partida.');
    return m!;
  }

  command(p: PlayerRec, raw: unknown): void {
    if (this.phase !== 'matchday') fail('Não há partida em andamento.');
    const m = this.matchOf(p, raw);
    const cmd = V.matchCommand(V.obj(raw).command, m.sideOf(p.id)!);
    const err = m.command(p.id, cmd);
    if (err) fail(err);
  }

  resume(p: PlayerRec, raw: unknown): void {
    const m = this.matchOf(p, raw);
    const err = m.resume(p.id);
    if (err) fail(err);
  }

  pauseRequest(p: PlayerRec, raw: unknown): void {
    const m = this.matchOf(p, raw);
    // (Atualização 38) `kind: 'changes'`: abriu o painel de mudanças — pausa imediata, com cota por tempo
    const err = V.obj(raw).kind === 'changes' ? m.requestChangesPause(p.id) : m.requestPause(p.id);
    if (err) fail(err);
  }

  /* ───────────── fim de temporada / virada ───────────── */

  private renewWaiting(): string[] {
    if (!this.seasonEnd) return [];
    return this.players.filter((p) => p.clubId && !p.ready).map((p) => p.id);
  }

  private seasonEndPayload(): SeasonEndPayload {
    const se = this.seasonEnd!;
    return { season: se.season, stage: 'review', preview: se.preview, expiring: se.expiring, deadline: se.deadline, waitingFor: this.renewWaiting() };
  }

  /** 'season:end' stage 'done' do jogador: `summary.contracts.humanReleased` filtrado para o clube dele. */
  private rolloverPayloadFor(p: PlayerRec): SeasonEndPayload {
    const lr = this.lastRollover!;
    const summary = lr.payload.summary as { contracts: { humanReleased: string[] } } & Record<string, unknown>;
    const mine = (p.clubId && lr.releasedByClub[p.clubId]) || [];
    return { ...lr.payload, summary: { ...summary, contracts: { ...summary.contracts, humanReleased: mine.slice() } } };
  }

  private clearSeasonEnd(): void {
    if (this.seasonEnd?.timer) clearTimeout(this.seasonEnd.timer);
    this.seasonEnd = null;
  }

  private armSeasonEndTimer(): void {
    const se = this.seasonEnd!;
    if (se.timer) clearTimeout(se.timer);
    se.timer = setTimeout(() => {
      se.timer = null;
      // (carreira online salva) ninguém conectado: o prazo para; recomeça quando alguém voltar
      if (this.paused()) return;
      this.tryRollover(true);
    }, Math.max(0, se.deadline - Date.now()));
  }

  /** Temporada encerrada: prévia da virada + contratos vencendo → fase 'season-end'. */
  private async enterSeasonEnd(): Promise<void> {
    let res: SeasonEndResponse;
    try {
      res = await this.enqueue(() => this.simCall<SeasonEndResponse>({ op: 'season-end', room: this.code }));
    } catch (e) {
      this.simFailure('seasonEnd', e);
      return;
    }
    if (this.disposed) return;
    this.career = res.meta;
    this.clearSeasonEnd();
    this.seasonEnd = {
      season: res.meta.season, preview: res.preview, expiring: res.expiring,
      deadline: Date.now() + this.ctx.opts.seasonEndTimeoutMs, renew: {}, timer: null,
    };
    this.phase = 'season-end';
    for (const x of this.players) x.ready = false;
    this.armSeasonEndTimer();
    this.ctx.log('season over', { room: this.code, season: res.meta.season });
    this.changed();
    this.ctx.io.to(this.channel).emit('season:end', this.seasonEndPayload());
  }

  /** 'season:renew': renovações do próprio clube (validadas contra os contratos vencendo). */
  renew(p: PlayerRec, raw: unknown): { accepted: number } {
    if (this.phase !== 'season-end' || !this.seasonEnd) fail('Não é fim de temporada.');
    if (!p.clubId) fail('Você não tem clube.');
    const o = V.obj(raw);
    const expiring = new Map((this.seasonEnd!.expiring[p.clubId!] ?? []).map((x) => [x.playerId, x]));
    const map = V.obj(o.renew ?? {}, 'Renovações');
    const keys = Object.keys(map);
    if (keys.length > 200) fail('Renovações demais.');
    const out: Record<string, NetRenewTerms> = {};
    for (const pid of keys) {
      V.id(pid, 'Jogador');
      if (!expiring.has(pid)) fail(`Jogador ${pid} não tem contrato vencendo no seu clube.`);
      const t = map[pid];
      if (t === true) {
        out[pid] = true;
        continue;
      }
      const to = V.obj(t, 'Termos');
      const wage = V.intIn(to.wage, 'Salário', 1, MAX_RENEW_WAGE);
      const years = V.intIn(to.years, 'Anos', 1, 5);
      out[pid] = { wage, years };
    }
    const ready = o.ready === undefined ? true : o.ready;
    if (typeof ready !== 'boolean') fail('ready inválido.');
    this.seasonEnd!.renew[p.id] = out;
    p.ready = ready as boolean;
    this.changed();
    this.tryRollover();
    return { accepted: Object.keys(out).length };
  }

  /** Renovações finais: as enviadas; para quem não enviou/ausente, aceita o pedido dos jogadores < 33 anos. */
  private mergedRenewals(): Record<string, NetRenewTerms> {
    const se = this.seasonEnd!;
    const out: Record<string, NetRenewTerms> = {};
    for (const [clubId, list] of Object.entries(se.expiring)) {
      const owner = this.ownerOf(clubId);
      const sent = owner ? se.renew[owner.id] : undefined;
      if (sent) Object.assign(out, sent);
      else for (const x of list) if (x.age < AUTO_RENEW_MAX_AGE) out[x.playerId] = true;
    }
    return out;
  }

  /** Todos os humanos conectados prontos (ou timeout) ⇒ virada (nextSeason) e volta ao planejamento. */
  tryRollover(force = false): void {
    if (this.phase !== 'season-end' || !this.seasonEnd || this.disposed) return;
    if (!force) {
      const online = this.connectedManagers();
      // (desempregado não tem renovações: não trava a virada)
      if (!online.length || !online.every((x) => x.ready || !x.clubId)) return;
    }
    const renew = this.mergedRenewals();
    const season = this.seasonEnd.season;
    // (17/11) Liga dos Amigos: posição final e copas da temporada que fecha
    closeSeason(this.friends, season, this.ownerIdOf);
    this.unseenOffers.clear();
    this.clearSeasonEnd();
    this.phase = 'simulating';
    this.broadcastState();
    const t0 = performance.now();
    void this.enqueue(() => this.simCall<RolloverResponse>({ op: 'rollover', room: this.code, renew }))
      .then((res) => {
        if (this.disposed) return;
        this.career = res.meta;
        this.onMeta(res.meta);
        this.settings.divisionIds = res.meta.divisionIds.slice();
        const payload: SeasonEndPayload = { season, stage: 'done', summary: res.summary, humanReleasedByClub: res.releasedByClub };
        this.lastRollover = { date: res.meta.date, payload, releasedByClub: res.releasedByClub };
        this.ctx.log('season rollover', { room: this.code, season: res.meta.season, renewed: Object.keys(renew).length, ms: Math.round(performance.now() - t0) });
        // cada humano recebe as saídas do PRÓPRIO clube em summary.contracts.humanReleased
        for (const p of this.players) if (p.socketId) this.ctx.io.to(p.socketId).emit('season:end', this.rolloverPayloadFor(p));
        this.toPlanning();
      })
      .catch((e) => {
        this.ctx.log('rollover error', { room: this.code, error: String(e) });
        if (this.disposed) return;
        // volta ao fim de temporada (pode tentar de novo)
        void this.enterSeasonEnd();
      });
  }

  /* ───────────── chat ───────────── */

  chat(p: PlayerRec, raw: unknown): void {
    const now = Date.now();
    p.chat = p.chat.filter((t) => now - t < CHAT_WINDOW_MS);
    if (p.chat.length >= CHAT_MAX) fail('Calma! Muitas mensagens em pouco tempo.');
    const text = V.cleanText(V.str(V.obj(raw).text, 'Mensagem', 500)).slice(0, 280);
    if (!text) fail('Mensagem vazia.');
    p.chat.push(now);
    this.ctx.io.to(this.channel).emit('chat:message', { playerId: p.id, nickname: p.nickname, text, at: now });
  }

  /* ───────────── persistência ───────────── */

  toSnapshot(): RoomSnapshot {
    let career: RoomSnapshot['career'] = null;
    const s = this.snap;
    if (this.career && s?.worldGz) {
      let c = this.b64cache;
      if (!c || c.version !== s.version || c.worldVersion !== s.worldVersion) {
        c = this.b64cache = {
          version: s.version, worldVersion: s.worldVersion, state: b64(s.stateGz),
          world: c && c.worldVersion === s.worldVersion ? c.world : b64(s.worldGz),
        };
      }
      const se = this.seasonEnd;
      career = {
        humanClubIds: this.humanClubIds.slice(), season: this.career.season, date: this.career.date,
        version: s.version, worldVersion: s.worldVersion, worldGz: c.world, stateGz: c.state, setups: this.setups,
        seasonEnd: se ? { season: se.season, preview: se.preview, expiring: se.expiring, renew: se.renew } : null,
        jobs: this.jobs,
      };
    }
    // partida em andamento não é salva: ao voltar, a rodada recomeça do planejamento (engine determinística)
    let phase: RoomPhase = this.phase === 'simulating' || this.phase === 'matchday' ? 'planning' : this.phase;
    if (phase !== 'lobby' && !career) phase = 'lobby';
    return {
      v: 2,
      code: this.code,
      createdAt: this.createdAt,
      savedAt: Date.now(),
      hostId: this.hostId,
      phase,
      settings: this.settings,
      players: this.players.map((p) => ({
        id: p.id, token: p.token, nickname: p.nickname, clubId: p.clubId, ai: p.ai, color: p.color, spectator: p.spectator, missed: p.missed, afk: p.afk,
        lastSeen: p.connected ? Date.now() : p.lastSeen, seatCode: p.seatCode,
      })),
      round: this.round,
      draftOrder: this.draftOrder,
      friends: this.friends,
      lastActivity: this.lastActivity,
      career,
      lastMatches: this.phase === 'matchday' ? [] : this.matchInfos,
    };
  }

  /**
   * Restaura do disco. v2 (carreira): o simulador é reidratado com o snapshot gzip (migrateCareer). v1 (temporada
   * antiga só com ligas): não dá para converter numa carreira — a sala volta ao LOBBY mantendo jogadores, tokens e
   * clubes (o host inicia de novo). Lança se o arquivo for inválido (o chamador descarta com log).
   */
  static fromSnapshot(ctx: RoomContext, raw: RoomSnapshot | LegacyRoomSnapshot): Room {
    if (!raw || typeof raw.code !== 'string' || !Array.isArray(raw.players)) throw new Error('snapshot inválido');
    const r = new Room(ctx, raw.code, { ...raw.settings, allowSameClub: false }, raw.createdAt);
    r.hostId = raw.hostId;
    r.players = raw.players.map((p, i) => ({
      // ninguém está conectado após o reinício: clubes ficam com a IA até o dono voltar
      ...p, ai: true, ready: false, connected: false, socketId: null, disconnectedAt: Date.now(), graceUntil: null, chat: [], graceTimer: null,
      color: 'color' in p && p.color ? p.color : PLAYER_COLORS[i % PLAYER_COLORS.length],
      spectator: 'spectator' in p ? !!p.spectator : false,
      missed: 'missed' in p ? p.missed ?? 0 : 0,
      afk: 'afk' in p ? !!p.afk : false,
      react: [],
      lastSeen: 'lastSeen' in p && typeof p.lastSeen === 'number' ? p.lastSeen : null,
      seatCode: 'seatCode' in p && p.seatCode && typeof p.seatCode.code === 'string' ? { code: p.seatCode.code, expiresAt: Number(p.seatCode.expiresAt) || 0 } : null,
    }));
    if (raw.v === 2) {
      r.round = raw.round ?? 0;
      r.draftOrder = raw.draftOrder ?? null;
      if (raw.friends) r.friends = { ...emptyFriends(), ...raw.friends };
      if (typeof raw.lastActivity === 'number') r.lastActivity = raw.lastActivity;
      else if (typeof (raw as { savedAt?: number }).savedAt === 'number') r.lastActivity = (raw as { savedAt: number }).savedAt;
    }
    r.emptySince = Date.now();
    if (raw.v === 2 && raw.career && isLegacyWorldGz(raw.career.worldGz)) {
      // (Etapa 1) carreira de revisão anterior (ano civil, um país): não migra — "legado — iniciar nova carreira":
      // a sala volta ao lobby com os mesmos jogadores (clubes fora do escopo são liberados)
      r.phase = 'lobby';
      r.settings.divisionIds = [];
      if (!ctx.data.leagues().some((d) => d.countryId === r.settings.countryId)) r.settings.countryId = DEFAULT_SETTINGS.countryId;
      const playable = ctx.data.playableAll();
      for (const p of r.players) if (p.clubId && !playable.has(p.clubId)) p.clubId = null;
      ctx.log('legacy career room (rev < 3): legado — iniciar nova carreira; sala volta ao lobby', { room: raw.code });
      return r;
    }
    if (raw.v === 2 && raw.career) {
      const c = raw.career;
      r.humanClubIds = c.humanClubIds.slice();
      r.setups = c.setups ?? {};
      r.snap = {
        version: c.version, worldVersion: c.worldVersion, season: c.season, date: c.date,
        stateGz: fromBase64(c.stateGz), worldGz: fromBase64(c.worldGz),
        stats: { stateJson: 0, stateGz: 0, ms: 0 },
      };
      r.career = {
        season: c.season, date: c.date, version: c.version, worldVersion: c.worldVersion, over: false, humanSquads: {},
        divisionIds: raw.settings?.divisionIds ?? [],
      };
      r.needsHydrate = true;
      r.jobs = sanitizeJobs(c.jobs);
      r.phase = raw.phase === 'simulating' || raw.phase === 'matchday' || raw.phase === 'lobby' ? 'planning' : raw.phase;
      r.matchInfos = raw.lastMatches ?? [];
      if (c.seasonEnd && r.phase === 'season-end') {
        // (carreira online salva) o prazo da virada só corre com alguém conectado (armado no primeiro attach)
        r.seasonEnd = { ...c.seasonEnd, deadline: Date.now() + ctx.opts.seasonEndTimeoutMs, timer: null };
      } else if (r.phase === 'season-end') {
        r.phase = 'planning';
      }
      return r;
    }
    if (raw.v === 2) {
      r.phase = 'lobby';
      return r;
    }
    if (raw.v === 1) {
      // formato antigo: sem conversão possível da temporada → lobby com os mesmos jogadores/clubes
      r.phase = 'lobby';
      r.settings.divisionIds = [];
      const playable = ctx.data.playableAll();
      for (const p of r.players) if (p.clubId && !playable.has(p.clubId)) p.clubId = null;
      if (raw.season) ctx.log('legacy room (v1, temporada antiga): carreira descartada, sala volta ao lobby', { room: raw.code });
      return r;
    }
    throw new Error(`versão de snapshot desconhecida: ${(raw as { v?: unknown }).v}`);
  }

  private clearPreview(): void {
    if (this.preview) clearTimeout(this.preview.timer);
    this.preview = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearPreview();
    if (this.graceWait) clearTimeout(this.graceWait);
    this.graceWait = null;
    for (const m of this.matches.values()) m.stop();
    for (const p of this.players) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.clearSeasonEnd();
    this.clearRoundFlow();
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.skipCancel = true;
    this.ctx.sim.release(this.code);
  }
}
