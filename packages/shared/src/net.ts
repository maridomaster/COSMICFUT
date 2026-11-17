/**
 * COSMICFUT — protocolo do modo online (Socket.io). Contrato definido pelo coordenador.
 *
 * Princípios:
 *  - Servidor AUTORITATIVO: mantém a SeasonState da sala e roda MatchSimulation dos confrontos PvP.
 *  - Engine determinística: jogos IA×IA e humano×IA podem rodar no servidor via quickSimulate/MatchSimulation;
 *    o cliente recebe resultados + eventos (não precisa confiar no cliente).
 *  - Fluxo por rodada: todos os humanos marcam "pronto" → servidor avança dias até o próximo dia de jogo
 *    → cada humano joga sua partida (PvE: ao vivo no servidor, transmitida só ao dono; PvP: sala de partida
 *    compartilhada) → todas finalizadas → advanceDay com playedResults → nova rodada.
 *  - Reconexão: o jogador volta com (roomCode, playerToken) e recebe snapshot completo.
 */

export type RoomCode = string; // 6 letras maiúsculas, ex 'KQZ4TM'

export interface RoomPlayer {
  playerId: string; // estável na sala
  nickname: string;
  clubId: string | null;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /**
   * (adição 13/11) desconectado há pouco (recarregou a página): a sala ESPERA este jogador até este epoch ms
   * antes de avançar a rodada sem ele (PLANNING_GRACE_MS). null/ausente = sem tolerância em curso.
   */
  graceUntil?: number | null;
  /* ── (17/11 · online 6 jogadores) ── */
  /** cor escolhida pelo jogador (PLAYER_COLORS) */
  color?: string;
  /** espectador: assiste e conversa, não tem clube */
  spectator?: boolean;
  /** regra AFK: o assistente joga as vezes dele até ele agir de novo */
  afk?: boolean;
  /* ── (Carreira online salva e entrada tardia) ── */
  /** técnico sem clube (entrou depois do início ou foi demitido): recebe propostas na Central de Empregos */
  unemployed?: boolean;
  /** propostas de emprego pendentes (só a contagem; os detalhes vão no 'jobs:update' de cada um) */
  jobOffers?: number;
  /** última vez conectado (epoch ms) */
  lastSeen?: number | null;
}

export type RoomPhase =
  | 'lobby' // escolhendo clubes
  | 'planning' // entre rodadas: escalação/táticas/mercado; aguardando "pronto"
  | 'simulating' // servidor avançando dias
  | 'matchday' // partidas humanas em andamento
  | 'finished'
  /** (carreira) temporada encerrada: resumo + renovações (season:end / season:renew) até a virada */
  | 'season-end';

export interface RoomSummary {
  code: RoomCode;
  phase: RoomPhase;
  hostId: string;
  players: RoomPlayer[];
  settings: RoomSettings;
  /** data atual da temporada (ISO) */
  date: string | null;
  /** fixtures humanas da rodada corrente e seu status */
  matches: LiveMatchInfo[];
  /** (carreira) temporada corrente */
  season?: number | null;
  /** (carreira) fase 'season-end': prazo e quem ainda não mandou as renovações */
  seasonEnd?: { season: number; deadline: number | null; waitingFor: string[] } | null;
  /* ── (17/11 · online 6 jogadores) ── */
  /** máximo de técnicos (6) */
  maxPlayers?: number;
  /** draft em andamento (modo de escolha 'draft') */
  draft?: DraftState | null;
  /** modo turnos: de quem é a vez */
  turn?: TurnState | null;
  /** modo simultâneo: contagem 3-2-1 antes de avançar */
  countdown?: { endsAt: number } | null;
  /** modo simultâneo: prazo do planejamento (epoch ms) */
  planningDeadline?: number | null;
  /** votação em andamento (pular / pausar) */
  vote?: VoteState | null;
  /** salto no tempo votado em andamento */
  skip?: SkipProgress | null;
  /** rodada (planejamentos concluídos desde o início) */
  round?: number;
}

export interface RoomSettings {
  countryId: number; // ex 29 (Brasil)
  divisionIds: string[]; // divisões incluídas na temporada
  matchSpeedMs: number; // ms por minuto simulado (padrão 400)
  allowSameClub: false;
  /* ── (17/11 · online 6 jogadores) — todos opcionais; o servidor sempre preenche ── */
  preset?: SettingsPreset;
  /** 'turns' (padrão, estilo Brasfoot: cada um na sua vez) ou 'simultaneous' (todos ao mesmo tempo + pronto) */
  turnMode?: TurnMode;
  /** partidas dos humanos ao vivo ou simuladas na hora */
  matchMode?: MatchMode;
  /** cronômetro (s): por vez no modo turnos; do planejamento no simultâneo. 0 = sem cronômetro */
  timerSec?: number;
  /** transferências entre técnicos */
  h2hTransfers?: boolean;
  /** votação para pausar as partidas ao vivo */
  pauseVotes?: boolean;
  /** votação para pular no tempo */
  skipVotes?: boolean;
  /** rodadas seguidas sem agir até o assistente assumir (0 = nunca) */
  afkRounds?: number;
  /** como os clubes são escolhidos */
  pickMode?: PickMode;
  /** sorteio: faixa de dificuldade */
  lotteryBand?: Difficulty | 'any';
  /** aparece em "Salas abertas" */
  isPublic?: boolean;
  /** trancada: ninguém novo entra */
  locked?: boolean;
  /** (carreira online) demissões de técnicos humanos pela diretoria (padrão: ligadas) */
  firing?: boolean;
  /** (carreira online) aceita técnicos novos (desempregados) com a temporada em andamento (padrão: sim) */
  lateJoin?: boolean;
}

/* ───────── Online 6 jogadores e lobby (17/11) ───────── */

export const MAX_MANAGERS = 6;
export const MAX_SPECTATORS = 4;
export type TurnMode = 'turns' | 'simultaneous';
export type PickMode = 'free' | 'draft' | 'lottery';
export type MatchMode = 'live' | 'quick';
export type SettingsPreset = 'rapido' | 'classico' | 'sem-pressa' | 'custom';
/** dificuldade do clube (reputação + nível + orçamento): Fácil = clube grande e rico; Lendário = pequeno e pobre */
export type Difficulty = 'facil' | 'medio' | 'dificil' | 'lendario';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil', lendario: 'Lendário' };
export const DIFFICULTY_ORDER: Difficulty[] = ['facil', 'medio', 'dificil', 'lendario'];
/** paleta das cores dos jogadores (slot, avatar, faixa da vez) */
export const PLAYER_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'] as const;
export const REACTIONS = ['⚽', '👏', '😂', '😡', '🔥', 'GG'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const PICK_SECONDS = 45;
export const VOTE_SECONDS = 30;
export const COUNTDOWN_MS = 3000;

/** Presets do host (os campos individuais mudam o preset para 'custom'). */
export const SETTINGS_PRESETS: Record<Exclude<SettingsPreset, 'custom'>, { matchMode: MatchMode; timerSec: number }> = {
  rapido: { matchMode: 'quick', timerSec: 60 },
  classico: { matchMode: 'live', timerSec: 120 },
  'sem-pressa': { matchMode: 'live', timerSec: 0 },
};

/** Força do clube (índice): nível + reputação + orçamento (receita). */
export function clubStrengthScore(c: { level: number; reputation?: number; finances?: { balance: number; revenue?: number } }): number {
  const rev = Math.max(1e5, c.finances?.revenue ?? (c.finances?.balance ?? 0) * 5);
  return c.level + 1.5 * (c.reputation ?? 1) + 2 * Math.log10(rev / 1e6);
}

export function clubDifficulty(c: Parameters<typeof clubStrengthScore>[0]): Difficulty {
  const s = clubStrengthScore(c);
  return s >= 30 ? 'facil' : s >= 22 ? 'medio' : s >= 14 ? 'dificil' : 'lendario';
}

/** Ordem em serpentina: rodada par na ordem, ímpar invertida (A B C · C B A · A B C…). */
export function snakeOrder<T>(order: T[], rounds: number): T[] {
  const out: T[] = [];
  for (let r = 0; r < rounds; r++) out.push(...(r % 2 === 0 ? order : order.slice().reverse()));
  return out;
}

export interface DraftState {
  /** ordem da serpentina (playerIds; uma escolha por técnico) */
  order: string[];
  /** índice da escolha atual */
  pick: number;
  /** quem escolhe agora (null = acabou) */
  current: string | null;
  /** prazo da escolha atual (epoch ms) */
  deadline: number | null;
  picks: { playerId: string; clubId: string; auto?: boolean }[];
}

export interface TurnState {
  round: number;
  /** ordem desta rodada (playerIds) */
  order: string[];
  index: number;
  /** de quem é a vez (null = rodada encerrando) */
  playerId: string | null;
  startedAt: number;
  /** cronômetro da vez (epoch ms) */
  deadline: number | null;
  /** já concluíram a vez nesta rodada */
  done: string[];
}

export interface VoteState {
  id: string;
  kind: 'skip' | 'pause';
  by: string;
  /** salto: data-alvo (ISO) e rótulo do atalho */
  until?: string;
  label?: string;
  deadline: number;
  yes: string[];
  no: string[];
  /** votos "sim" necessários (maioria dos técnicos conectados) */
  needed: number;
}

export interface SkipProgress {
  from: string;
  until: string;
  date: string;
  by: string;
  startedAt: number;
}

/** 'skip:end' — fim do salto votado (motivo, de quem é a parada). */
export interface SkipEndPayload {
  reason: 'done' | 'cancelled' | 'offer' | 'season-end' | 'limit' | 'error';
  note?: string;
  /** clube/técnico dono do evento que parou o salto */
  clubId?: string | null;
  playerId?: string | null;
  date: string;
  days: number;
}

/** 'turn:feed' — o que o técnico da vez está fazendo (nível público, como um rival veria). */
export interface TurnFeedItem {
  playerId: string;
  clubId: string | null;
  text: string;
  at: number;
  kind: 'lineup' | 'offer' | 'signing' | 'sale' | 'list' | 'turn' | 'info';
}

export interface ReactionPayload {
  playerId: string;
  emoji: Reaction;
  at: number;
}

/** Liga dos Amigos (calculada pelo servidor). */
export interface FriendsRow {
  playerId: string;
  nickname: string;
  /** clube atual (null = desempregado) */
  clubId: string | null;
  /** (carreira online) clubes que o técnico já comandou na sala (passagens), do mais antigo ao atual */
  tenures?: { clubId: string; from: string | null; to: string | null }[];
  color?: string;
  points: number;
  breakdown: { league: number; trophies: number; cups: number; profit: number; h2h: number };
  league: { name: string; pos: number; size: number } | null;
  titles: { season: number; name: string }[];
  profit: number;
  h2h: { w: number; d: number; l: number };
}

export interface FriendsFeedItem {
  at: number;
  date: string | null;
  kind: 'win' | 'draw' | 'signing' | 'title' | 'fired' | 'sale' | 'hired' | 'joined';
  text: string;
  clubIds: string[];
}

export interface FriendsLeague {
  rows: FriendsRow[];
  /** confrontos diretos: matrix[a][b] = campanha de a contra b */
  matrix: Record<string, Record<string, { w: number; d: number; l: number; gf: number; ga: number }>>;
  feed: FriendsFeedItem[];
  season: number | null;
}

/** GET /rooms (salas públicas no lobby). */
export interface PublicRoomInfo {
  code: RoomCode;
  host: string;
  hostClubId: string | null;
  players: number;
  maxPlayers: number;
  preset: SettingsPreset;
  turnMode: TurnMode;
  pickMode: PickMode;
  createdAt: number;
}

export interface LiveMatchInfo {
  matchId: string; // = fixture.id
  homeClubId: string;
  awayClubId: string;
  homePlayerId: string | null; // humano dono do mandante (ou null = IA)
  awayPlayerId: string | null;
  status: 'pending' | 'live' | 'half-time' | 'finished';
  minute: number;
  score: { home: number; away: number };
  /* ── (carreira) campos opcionais ── */
  competitionId?: string;
  /** Fixture.label (ex.: "Oitavas de Final - Volta") */
  label?: string;
  leg?: 1 | 2;
  /** jogo decisivo de mata-mata (empate → pênaltis, sem prorrogação) */
  knockout?: boolean;
  /** agregado ANTES deste jogo (pernas anteriores), do ponto de vista do mandante de hoje */
  aggregateBefore?: { home: number; away: number };
  penaltyScore?: { home: number; away: number };
}

/* ───────── Cliente → Servidor ───────── */
export interface ClientToServer {
  'room:create': (p: { nickname: string; settings?: Partial<RoomSettings> }, ack: (r: Ack<{ code: RoomCode; playerId: string; token: string }>) => void) => void;
  /** (17/11) `spectator: true` entra como espectador (até 4; também depois do início) */
  'room:join': (p: { code: RoomCode; nickname: string; spectator?: boolean }, ack: (r: Ack<{ playerId: string; token: string; spectator?: boolean }>) => void) => void;
  'room:rejoin': (p: { code: RoomCode; token: string }, ack: (r: Ack<{ playerId: string }>) => void) => void;
  'room:leave': () => void;
  'room:pick-club': (p: { clubId: string }, ack: (r: Ack) => void) => void;
  'room:start': (ack: (r: Ack) => void) => void; // host: lobby → planning (cria a temporada)
  'round:set-lineup': (p: { tactic: unknown /* engine Tactic */; lineup: unknown /* engine Lineup (+ positions) */; presets?: unknown /* (Táticas) engine TacticPreset[] (3 vagas) */ }, ack: (r: Ack) => void) => void;
  'round:ready': (p: { ready: boolean }) => void;
  'match:command': (p: { matchId: string; command: unknown /* engine MatchCommand (side é inferido pelo servidor) */ }, ack: (r: Ack) => void) => void;
  'match:pause-request': (p: { matchId: string }) => void; // PvP: pausa só no intervalo/ambos concordam
  'chat:send': (p: { text: string }) => void;
}

/* ───────── Servidor → Cliente ───────── */
export interface ServerToClient {
  'room:state': (s: RoomSummary) => void;
  /** snapshot da carreira (após rodada / ao reconectar). Ver SeasonSnapshotPayload (gzip binário). */
  'season:snapshot': (s: SeasonSnapshotPayload) => void;
  'round:results': (r: RoundResultsPayload) => void;
  /** partida ao vivo: estado inicial */
  'match:start': (m: { matchId: string; config: unknown /* MatchConfig sem elencos completos */; state: unknown /* MatchState */ }) => void;
  /** a cada minuto simulado */
  'match:tick': (t: { matchId: string; minute: number; extra: number; events: unknown[] /* MatchEvent[] */; score: { home: number; away: number }; momentum: number; stats: unknown }) => void;
  'match:end': (e: MatchEndPayload) => void;
  'chat:message': (m: { playerId: string; nickname: string; text: string; at: number }) => void;
  'error': (e: { code: string; message: string }) => void;
}

export type Ack<T = void> = { ok: true; data: T } | { ok: false; error: string };

/* ───────── Extensões (servidor apps/server + cliente web) ─────────
 * Antes viviam em apps/server/src/protocol.ts; movidas para cá para o cliente web usar o mesmo contrato.
 *  Cliente → Servidor
 *   - 'match:resume'          confirma a volta do intervalo / de uma pausa (ack)
 *   - 'room:update-settings'  host altera país/velocidade no lobby (ack)
 *   - acks OPCIONAIS em 'round:ready', 'chat:send', 'match:pause-request' e 'room:leave'
 *  Servidor → Cliente
 *   - 'match:info'   LiveMatchInfo resumido para TODOS da sala (placar ao vivo das outras partidas)
 *   - 'match:pause'  partida parada (intervalo ou pausa combinada) / retomada
 *   - 'match:tick'   ganha campos opcionais: phase, players, tactic, penaltyScore
 *   - 'match:start'  ganha campos opcionais: side (lado do receptor), homePlayerId, awayPlayerId, speedMs
 *  HTTP
 *   - GET /rooms/:code → Ack<RoomPreview> (prévia pública da sala)
 *
 * ───────── Carreira online (2026-11-13) — tudo opcional/aditivo ─────────
 *  O servidor roda a CARREIRA completa da engine (createCareer: Séries A–D, estaduais, Copa do Brasil, Supercopa,
 *  continentais, ligas sul-americanas, Nordeste) com virada de temporada, igual ao solo.
 *  - RoomPhase ganha 'season-end'.
 *  - 'season:snapshot' → SeasonSnapshotPayload: world/state em JSON+gzip binário (`stateGz`, `worldGz`), `worldVersion`.
 *  - 'season:end' (S→C) → SeasonEndPayload; 'season:renew' / 'season:sync' / 'dev:advance' (C→S).
 *  - 'match:start' ganha `fixture`; config traz knockout/extraTime/aggregate. 'match:end' ganha aggregate/advancing/penalties.
 *  - LiveMatchInfo ganha competitionId/label/leg/knockout/aggregateBefore/penaltyScore; RoomSummary ganha season/seasonEnd.
 *  - 'round:results' ganha competitionId e penalties por jogo.
 *  - 'room:pick-club': clube jogável = divisão nacional real do país OU (Brasil) qualquer divisão estadual.
 *
 * O shared não depende da engine: os tipos da engine aparecem como `unknown` ou como uniões literais
 * equivalentes (NetSide, NetMatchPhase). Quem consome faz o cast para os tipos da engine.
 */

/** = engine `Side` */
export type NetSide = 'home' | 'away';
/** = engine `MatchState['phase']` */
export type NetMatchPhase = 'pre' | 'first-half' | 'half-time' | 'second-half' | 'extra-time' | 'penalties' | 'finished';

export interface MatchTickPayload {
  matchId: string;
  minute: number;
  extra: number;
  events: unknown[] /* MatchEvent[] */;
  score: { home: number; away: number };
  momentum: number;
  stats: unknown /* MatchState['stats'] */;
  /** (adição) fase da partida */
  phase?: NetMatchPhase;
  /** (adição) estado ao vivo dos jogadores (stamina, nota, cartões…) = MatchState['players'] */
  players?: unknown;
  /** (adição) táticas vigentes = MatchState['tactic'] */
  tactic?: unknown;
  /** (Atualização 38) posições vigentes = MatchState['slots'] (formação personalizada / set-shape) */
  slots?: unknown;
  penaltyScore?: { home: number; away: number };
}

export interface MatchStartPayload {
  matchId: string;
  /** MatchConfig com `players` reduzido aos relacionados (titulares + banco). (carreira) inclui
   *  `knockout`, `extraTime` e `aggregate` (= fixtureMatchRules da engine). */
  config: unknown;
  /** MatchState atual (no rejoin, já com os eventos até o minuto corrente) */
  state: unknown;
  /** (adição) lado do jogador que recebe; null = espectador */
  side?: NetSide | null;
  homePlayerId?: string | null;
  awayPlayerId?: string | null;
  speedMs?: number;
  /** (carreira) a fixture do jogo: competição, fase/rótulo, perna, mata-mata */
  fixture?: NetFixtureInfo;
}

/** (carreira) dados da Fixture da engine relevantes para pré-jogo/placar. */
export interface NetFixtureInfo {
  id: string;
  competitionId: string;
  round: number;
  date: string;
  homeId: string;
  awayId: string;
  stageId?: string;
  label?: string;
  leg?: 1 | 2;
  tieId?: string;
  knockout?: boolean;
  extraTime?: boolean;
  neutral?: boolean;
}

/** 'match:end'. Em mata-mata decisivo `advancing` = lado que avança (agregado + pênaltis). */
export interface MatchEndPayload {
  matchId: string;
  result: unknown /* MatchResult */;
  /** (carreira) agregado do confronto incluindo este jogo (só 2ª perna) */
  aggregate?: { home: number; away: number };
  /** (carreira) lado que avança (só jogo decisivo de mata-mata) */
  advancing?: NetSide;
  penalties?: { home: number; away: number };
}

/** 'round:results': todos os jogos de um dia (IA×IA, simulados e os ao vivo). */
export interface RoundResultsPayload {
  date: string;
  results: {
    fixtureId: string;
    home: number;
    away: number;
    /** (carreira) */
    competitionId?: string;
    penalties?: { home: number; away: number };
    /** (17/11) clubes do jogo (Liga dos Amigos: confrontos entre humanos) */
    homeId?: string;
    awayId?: string;
  }[];
}

/**
 * (carreira) 'season:snapshot' — a carreira (WorldState + SeasonState, 2–7 MB em JSON) vai como JSON
 * comprimido com GZIP em campos BINÁRIOS (ArrayBuffer no navegador, Buffer no Node). Decodificar no cliente:
 *   const json = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 *   const state = JSON.parse(json);
 * - `stateGz` vem SEMPRE; `worldGz` só quando o mundo muda (início, virada), no join/rejoin e em 'season:sync'.
 *   Durante a temporada o WorldState não muda: o cliente guarda o último e confere `worldVersion`.
 *   Se receber `worldVersion` diferente do que tem e sem `worldGz`, peça 'season:sync'.
 * - `state` (objeto) é LEGADO e não é mais enviado.
 */
export interface SeasonSnapshotPayload {
  version: number;
  /** legado (temporada antiga sem carreira): não é mais enviado */
  state?: unknown;
  encoding?: 'gzip-json';
  /** SeasonState em JSON+gzip */
  stateGz?: ArrayBuffer | Uint8Array;
  /** versão do WorldState (muda na virada) */
  worldVersion?: number;
  /** WorldState em JSON+gzip (só quando mudou / join / rejoin / sync) */
  worldGz?: ArrayBuffer | Uint8Array;
  season?: number;
  date?: string;
  /** tamanhos em bytes (JSON cru e comprimido), para diagnóstico */
  bytes?: { state: number; stateGz: number; world?: number; worldGz?: number };
}

/** (carreira) jogador do humano com contrato vencendo (fim de temporada). */
export interface NetExpiringPlayer {
  playerId: string;
  name: string;
  position: string;
  age: number;
  overall: number;
  /** salário mensal atual */
  wage: number;
  /** pedido do jogador: salário mínimo aceito (oferta menor ⇒ recusa e sai livre) e faixa de anos */
  demand: { wage: number; minYears: number; maxYears: number };
}

/** (carreira) termos de renovação: salário mensal e anos (1..5); `true` = aceita o pedido do jogador. */
export type NetRenewTerms = { wage: number; years: number } | true;

/**
 * (carreira) 'season:end'.
 *  - stage 'review': a temporada acabou (fase 'season-end'). `preview` = campeões, acesso/rebaixamento
 *    (nacionais e estaduais), Série D e classificados às continentais (engine SeasonSummary parcial);
 *    `expiring` = contratos vencendo por clube humano; `deadline` = epoch ms do timeout da virada.
 *  - stage 'done': a virada rodou; `summary` = SeasonSummary completo da temporada encerrada
 *    (contratos renovados/recusados, aposentadorias, juniores…). Logo depois chega um 'season:snapshot' com o mundo novo.
 */
export interface SeasonEndPayload {
  season: number;
  stage: 'review' | 'done';
  preview?: unknown;
  expiring?: Record<string, NetExpiringPlayer[]>;
  deadline?: number | null;
  /** playerIds que ainda não mandaram 'season:renew' */
  waitingFor?: string[];
  /**
   * stage 'done'. (13/11) O servidor manda a cada jogador o `summary.contracts.humanReleased` JÁ FILTRADO para o
   * clube dele; aqui vão as saídas de todos os humanos separadas por clube (clubId → playerIds).
   */
  summary?: unknown;
  humanReleasedByClub?: Record<string, string[]>;
}

export interface MatchPausePayload {
  matchId: string;
  paused: boolean;
  /**
   * 'half-time' intervalo · 'requested' pausa combinada/votada · (Atualização 38) 'changes' um técnico abriu o painel
   * de mudanças (substituir/táticas) — limitado por time e por tempo de jogo.
   */
  reason: 'half-time' | 'requested' | 'changes';
  /** playerIds que ainda precisam mandar 'match:resume' */
  waitingFor: string[];
  /** epoch ms em que a partida volta sozinha (timeout) */
  resumeAt: number | null;
  /** (Atualização 38) quem pediu a pausa de mudanças */
  by?: string;
  /** (Atualização 38) pausas de mudanças restantes neste tempo, por playerId da partida */
  changesLeft?: Record<string, number>;
}

/** Eventos Servidor → Cliente (protocolo base + extensões). */
export interface ServerEvents extends Omit<ServerToClient, 'match:tick' | 'match:start'> {
  'match:tick': (t: MatchTickPayload) => void;
  'match:start': (m: MatchStartPayload) => void;
  'match:info': (m: LiveMatchInfo) => void;
  'match:pause': (p: MatchPausePayload) => void;
  /** (carreira) fim de temporada: resumo/renovações (stage 'review') e resultado da virada (stage 'done') */
  'season:end': (e: SeasonEndPayload) => void;
  /** (mercado online) estado do mercado depois de cada ação de qualquer humano da sala. Ver MarketUpdatePayload. */
  'market:update': (u: MarketUpdatePayload) => void;
  /** (pré-jogo) janela curta antes do match:start: confronto, escalações e quando a bola rola. */
  'match:preview': (p: MatchPreviewPayload) => void;
  /* ── (17/11 · online 6 jogadores) ── */
  'room:reaction': (r: ReactionPayload) => void;
  'turn:feed': (f: TurnFeedItem) => void;
  'friends:update': (l: FriendsLeague) => void;
  'skip:progress': (p: SkipProgress) => void;
  'skip:end': (e: SkipEndPayload) => void;
  'vote:result': (r: { id: string; kind: 'skip' | 'pause'; passed: boolean; yes: number; needed: number }) => void;
  /* ── (Carreira online salva e entrada tardia) ── */
  /** Central de Empregos do jogador (vagas públicas + as MINHAS propostas/candidaturas) */
  'jobs:update': (j: JobsPayload) => void;
  /** o host encerrou a carreira (a sala foi apagada no servidor) */
  'room:ended': (e: { code: RoomCode; by: string }) => void;
}

/** Eventos Cliente → Servidor, na visão tipada do cliente (protocolo base + extensões). */
export interface ClientEvents extends Omit<ClientToServer, 'round:ready' | 'chat:send' | 'match:pause-request' | 'room:leave'> {
  'round:ready': (p: { ready: boolean }, ack?: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack?: (r: Ack) => void) => void;
  /** (Atualização 38) kind: 'changes': pausa imediata ao abrir o painel de mudanças (limite por time e por tempo) */
  'match:pause-request': (p: { matchId: string; kind?: 'changes' }, ack?: (r: Ack) => void) => void;
  'room:leave': (ack?: (r: Ack) => void) => void;
  'match:resume': (p: { matchId: string }, ack?: (r: Ack) => void) => void;
  'room:update-settings': (p: Partial<Omit<RoomSettings, 'divisionIds' | 'allowSameClub'>>, ack?: (r: Ack) => void) => void;
  /* ── (17/11 · online 6 jogadores) ── */
  'room:set-color': (p: { color: string }, ack?: (r: Ack) => void) => void;
  'room:kick': (p: { playerId: string }, ack?: (r: Ack) => void) => void;
  'room:transfer-host': (p: { playerId: string }, ack?: (r: Ack) => void) => void;
  'room:react': (p: { emoji: string }, ack?: (r: Ack) => void) => void;
  'room:list': (ack?: (r: Ack<PublicRoomInfo[]>) => void) => void;
  /** host: começa o draft (ordem sorteada) */
  'draft:start': (ack?: (r: Ack) => void) => void;
  /** host: sorteia os clubes dentro da faixa de dificuldade (settings.lotteryBand) */
  'lottery:run': (ack?: (r: Ack) => void) => void;
  /** modo turnos: concluir a minha vez */
  'turn:end': (ack?: (r: Ack) => void) => void;
  /** host: força o avanço (simultâneo: depois do cronômetro ou sem ele; turnos: encerra a vez atual com o assistente) */
  'round:force': (ack?: (r: Ack) => void) => void;
  'vote:propose': (p: { kind: 'skip' | 'pause'; until?: string; label?: string }, ack?: (r: Ack) => void) => void;
  'vote:cast': (p: { id: string; yes: boolean }, ack?: (r: Ack) => void) => void;
  /** host: cancela o salto votado (para no fim do pedaço atual) */
  'skip:cancel': (ack?: (r: Ack) => void) => void;
  'friends:get': (ack?: (r: Ack<FriendsLeague>) => void) => void;
  /**
   * (carreira) fase 'season-end': renovações do PRÓPRIO clube — mapa playerId → {wage, years} | true.
   * Só ids de `expiring` do seu clube. `ready` (padrão true) marca pronto para a virada; pode reenviar até lá.
   * Quem não enviar até o prazo (ou estiver ausente) renova automaticamente, aceitando o pedido, os jogadores < 33 anos.
   */
  'season:renew': (p: { renew: Record<string, NetRenewTerms>; ready?: boolean }, ack?: (r: Ack<{ accepted: number }>) => void) => void;
  /** (carreira) pede de novo o snapshot completo (mundo + estado) */
  'season:sync': (ack?: (r: Ack) => void) => void;
  /**
   * (carreira, só com DEV_COMMANDS=1 no servidor) host avança rápido, simulando também os jogos humanos:
   * 'next-match' = até o próximo dia com jogo humano; 'season-end' = até o fim da temporada; ou uma data ISO.
   */
  'dev:advance': (p: { until: 'next-match' | 'season-end' | string }, ack?: (r: Ack<{ date: string; days: number }>) => void) => void;

  /* ── mercado online (só na fase 'planning'; o servidor valida janela, saldo e dono do clube) ── */
  /** proposta ao clube (etapa 1). `offerId` continua uma negociação. Vendedor humano: fica pendente para o dono. */
  'market:offer': (p: MarketOfferRequest, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** contrato com o jogador (etapa 2). Sem `offerId`: jogador LIVRE pelo `playerId` (abre e propõe numa ação só). */
  'market:contract': (p: MarketContractRequest, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** aceita/recusa uma oferta RECEBIDA (da IA ou de outro humano) */
  'market:respond': (p: { offerId: string; accept: boolean }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** desiste de uma negociação aberta (ou de uma proposta pendente a outro humano) */
  'market:withdraw': (p: { offerId: string }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** coloca/retira jogadores do próprio elenco da lista de transferências */
  'market:list': (p: { playerIds: string[]; listed: boolean }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** rescinde o contrato (multa de 3 salários) */
  'market:release': (p: { playerId: string }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /* ── (Etapa 5) ── */
  /** contraproposta a uma oferta recebida da IA (o comprador aceita até o teto dele, melhora ou desiste) */
  'market:counter': (p: { offerId: string; fee: number }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** coloca/retira jogadores do próprio elenco da lista de empréstimo */
  'market:loanlist': (p: { playerIds: string[]; listed: boolean }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** exerce a opção de compra de um emprestado ao clube */
  'market:option': (p: { playerId: string }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** chama de volta um jogador emprestado (retorno antecipado previsto no contrato; janela aberta) */
  'market:recall': (p: { playerId: string }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** renova o contrato de um jogador do elenco (salário ≥ pedido) */
  'market:renew': (p: { playerId: string; wage: number; years: number; releaseClause?: number }, ack?: (r: Ack<MarketActionResult>) => void) => void;
  /** (Mercado e Orçamentos) equilíbrio: move `toWage` € do orçamento de transferências para o salarial (€ 1 mi = € 50 mil/mês; negativo = o contrário) */
  'market:budget': (p: { toWage: number }, ack?: (r: Ack<MarketActionResult>) => void) => void;

  /* ── (Carreira online salva e entrada tardia) ── */
  /** Central de Empregos: candidatar-se a uma vaga, aceitar/recusar proposta */
  'jobs:apply': (p: { vacancyId: string }, ack?: (r: Ack<{ message: string }>) => void) => void;
  'jobs:accept': (p: { offerId: string }, ack?: (r: Ack<{ clubId: string; message: string }>) => void) => void;
  'jobs:decline': (p: { offerId: string }, ack?: (r: Ack) => void) => void;
  'jobs:get': (ack?: (r: Ack<JobsPayload>) => void) => void;
  /** host: código de 6 caracteres (uso único, 24 h) para recuperar/reatribuir a vaga de um técnico em outro aparelho */
  'room:seat-code': (p: { playerId: string }, ack?: (r: Ack<{ seatCode: string; expiresAt: number }>) => void) => void;
  /** qualquer um: assume uma vaga com o código do host (gera um token novo; o antigo deixa de valer) */
  'room:claim-seat': (p: { code: RoomCode; seatCode: string; nickname?: string }, ack?: (r: Ack<{ playerId: string; token: string }>) => void) => void;
  /** host: encerra a carreira (apaga a sala e o arquivo no servidor) */
  'room:end': (p: { confirm: RoomCode }, ack?: (r: Ack) => void) => void;
}

/* ───────── Carreira online salva e entrada tardia (17/11) ─────────
 * - A sala com a temporada iniciada NUNCA expira: sem ninguém conectado ela pausa (sem cronômetros, sem assistente
 *   avançando) e sai da memória; volta do disco quando alguém abre o código ou a lista "Minhas carreiras online".
 * - Identidade: token durável por navegador (localStorage por origem do servidor); em outro aparelho, o host gera um
 *   "código de vaga" (room:seat-code) e o jogador usa room:claim-seat.
 * - HTTP: POST /careers/status {items:[{code, token}]} → CareerStatus[] (nunca devolve tokens);
 *   POST /rooms/:code/backup {token} (host) → arquivo .json.gz sem tokens; POST /rooms/restore (corpo = o arquivo) → nova sala.
 * - Entrada tardia: room:join numa carreira em andamento entra DESEMPREGADO (sem clube) e recebe propostas de clubes
 *   da IA com vaga (demissões/saídas), conforme a reputação do técnico. 'jobs:*' acima.
 */

export interface JobVacancyInfo {
  id: string;
  clubId: string;
  name: string;
  /** reputação do clube 0..5 */
  reputation: number;
  division: number | null;
  /** reputação mínima do técnico (0..100) para ter boa chance */
  minReputation: number;
  openedOn: string;
  reason: 'fired' | 'left' | 'initial' | 'human-left';
  previousCoach: string | null;
}

export interface JobOfferInfo {
  id: string;
  clubId: string;
  name: string;
  reputation: number;
  division: number | null;
  kind: 'invite' | 'application';
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  /** meta da diretoria se assumir */
  goal?: string | null;
}

export interface JobApplicationInfo {
  id: string;
  vacancyId: string;
  clubId: string;
  name: string;
  appliedOn: string;
  answerOn: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ManagerCareerInfo {
  /** reputação 0..100 */
  reputation: number;
  clubId: string | null;
  /** confiança da diretoria 0..100 (empregado) */
  board: { confidence: number; goal: string | null; games: number } | null;
  history: { clubId: string; name: string; from: string; to: string | null; games: number; won: number; drawn: number; lost: number; exit?: 'fired' | 'left' | null }[];
}

export interface JobsPayload {
  date: string | null;
  firing: boolean;
  vacancies: JobVacancyInfo[];
  offers: JobOfferInfo[];
  applications: JobApplicationInfo[];
  me: ManagerCareerInfo | null;
  /** últimas trocas de técnico no mundo */
  changes: { date: string; clubId: string; name: string; out: string | null; in: string | null; reason: string }[];
}

/** POST /careers/status — situação de cada carreira guardada no navegador. */
export interface CareerStatus {
  code: RoomCode;
  /** false: sala não existe mais (encerrada/expirada) ou o token não vale mais */
  found: boolean;
  phase?: RoomPhase;
  season?: number | null;
  date?: string | null;
  me?: { playerId: string; nickname: string; clubId: string | null; isHost: boolean; spectator?: boolean };
  managers?: { nickname: string; clubId: string | null; color?: string; online: boolean; unemployed?: boolean }[];
  /** epoch ms da última atividade (save) */
  lastActivity?: number;
  /** modo turnos: de quem é a vez agora */
  turnOf?: string | null;
}

/* ───────── Mercado online (2026-11-13) ─────────
 * O servidor é autoritativo: cada ação roda no CareerSimulator (worker) sobre a SeasonState da sala com a API de
 * transferências da engine (makeOffer, proposeContract, respondToOffer, withdrawOffer, setTransferListed,
 * releasePlayer). Depois de uma ação que muda o estado, a sala recebe 'market:update' (NÃO um season:snapshot):
 * só `state.market` + os clubes envolvidos + as notícias novas, em JSON+gzip (≈ 10–60 KB contra 170–630 KB do
 * estado inteiro). O cliente aplica o patch sobre a SeasonState que tem (versão +1) e, se perder alguma versão,
 * pede 'season:sync'. O snapshot completo guardado pela sala (rejoin/disco) também é atualizado.
 *
 * Humano × humano: a proposta por jogador de outro humano vira uma oferta `pending` no clube dele (aparece em
 * "Ofertas recebidas"); o dono aceita/recusa com 'market:respond' até o fim do planejamento — sem resposta, a
 * proposta é recusada quando a rodada avança. (Etapa 5) Aceita: o acordo com o clube fica `agreed` e o COMPRADOR
 * negocia salário, anos e multa com o jogador ('market:contract', como numa compra da IA); empréstimo: conclui com
 * a % do salário proposta. Multa rescisória depositada: o dono não pode recusar (vai direto para o contrato).
 */

export interface MarketOfferRequest {
  playerId: string;
  fee: number;
  /** padrão 'transfer'; (Etapa 5) 'precontract' = últimos 6 meses de contrato, sem taxa */
  kind?: 'transfer' | 'loan' | 'precontract';
  /** próxima rodada de uma negociação aberta */
  offerId?: string;
  /** (Etapa 5) empréstimo: % do salário pago por quem recebe, opção de compra e retorno antecipado */
  loan?: { wageShare: number; purchaseOption?: number; recall?: boolean };
  /** (Etapa 5) deposita a multa rescisória (venda forçada) */
  clause?: boolean;
}

export interface MarketContractRequest {
  offerId?: string;
  /** jogador livre (sem offerId) */
  playerId?: string;
  wage: number;
  years: number;
  /** luvas (livres e pré-contratos): 0 = à vista, 6 ou 12 parcelas */
  luva?: number;
  /** (Etapa 5) multa rescisória do contrato novo */
  releaseClause?: number;
}

/** Ack das ações de mercado. */
export interface MarketActionResult {
  /** versão do estado depois da ação (o 'market:update' com esta versão traz o estado novo) */
  version: number;
  /** a oferta como ficou (engine TransferOffer) */
  offer?: unknown;
  /** resposta do clube (engine OfferDecision) */
  club?: unknown;
  /** resposta do jogador (engine ContractDecision) */
  contract?: unknown;
  /** transferência concluída (engine TransferRecord) */
  record?: unknown;
  /** proposta enviada a outro humano: aguarda a resposta dele */
  pendingHuman?: boolean;
}

/** 'market:update' — patch da SeasonState depois de uma ação de mercado. */
export interface MarketUpdatePayload {
  /** versão da SeasonState depois da ação (aplique só sobre a versão − 1) */
  version: number;
  date: string;
  encoding: 'gzip-json';
  /** MarketPatch em JSON+gzip (binário) */
  patchGz: ArrayBuffer | Uint8Array;
  /** quem agiu e o quê (para avisos) */
  by?: string;
  action?: 'offer' | 'contract' | 'respond' | 'withdraw' | 'list' | 'release' | 'counter' | 'loanlist' | 'option' | 'recall' | 'renew' | 'budget';
  bytes?: { json: number; gz: number };
}

/** Conteúdo de MarketUpdatePayload.patchGz. */
export interface MarketPatch {
  /** = SeasonState.market inteiro */
  market: unknown;
  /** SeasonState.clubs[id] dos clubes envolvidos (substituem os atuais) */
  clubs: Record<string, unknown>;
  /** notícias novas: SeasonState.news = news.slice(0, from).concat(items) */
  news: { from: number; items: unknown[] };
}

/**
 * 'match:preview' — pré-jogo online: chega quando a rodada para num dia com jogo do humano, `startsAt − now`
 * (PREMATCH_MS, padrão 8 s) antes do 'match:start'. `config` = MatchConfig público (elencos relacionados,
 * escalações, táticas, regras do mata-mata), igual ao do match:start.
 */
export interface MatchPreviewPayload {
  matchId: string;
  fixture: NetFixtureInfo;
  config: unknown;
  side: NetSide | null;
  homePlayerId: string | null;
  awayPlayerId: string | null;
  /** epoch ms do pontapé inicial (match:start) */
  startsAt: number;
}

/** GET /rooms/:code (data do Ack) — prévia pública para a tela de "entrar". */
export interface RoomPreview {
  code: RoomCode;
  phase: RoomPhase;
  players: { nickname: string; clubId: string | null; connected: boolean }[];
  settings: RoomSettings;
  maxPlayers: number;
}
