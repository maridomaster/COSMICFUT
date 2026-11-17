/**
 * Store do MODO ONLINE (Zustand, só em memória — não toca no save solo).
 *
 *  - conexão (status, erro) e sessão `{ code, token, playerId }` (localStorage, para o rejoin);
 *  - sala (`RoomSummary`), meu `playerId`, chat e toasts;
 *  - a CARREIRA AUTORITATIVA do servidor (`season:snapshot`): `SeasonState` + `WorldState` em JSON+gzip
 *    (`stateGz` sempre, `worldGz` só quando o mundo muda / join / rejoin / `season:sync`), decodificados com
 *    `DecompressionStream('gzip')`. Snapshots mais velhos que o atual são descartados; `worldVersion` novo sem
 *    `worldGz` ⇒ pede `season:sync`. Publicado em `useOnlineSeason` como "visão" do jogador (o clube dele vira
 *    `humanClubIds[0]`) com o `world` junto, para Dashboard/Calendário/Competições/Histórico/Elenco/Táticas
 *    lerem pelos mesmos hooks do solo;
 *  - elencos: `careerSquads(state, worldSquads(world, base))` com o `base` do servidor (bundles completos de
 *    TODOS os humanos da sala + players-market), registrado em data/squads no escopo 'online';
 *  - fim de temporada (`season:end` review/done) e renovações (`season:renew`);
 *  - tática/escalação em `useOnlineGame`; mudanças vão ao servidor com `round:set-lineup` (debounce);
 *  - partida ao vivo (`match:start` / `tick` / `pause` / `end`) montada a partir dos ticks (sem
 *    simulação local), com a fixture (competição, fase, agregado) e placares das outras partidas (`match:info`).
 */
import { create } from 'zustand';
import type {
  Ack, LiveMatchInfo, MarketActionResult, MarketPatch, MarketUpdatePayload, MatchEndPayload, MatchPausePayload, MatchPreviewPayload, MatchStartPayload,
  MatchTickPayload, NetFixtureInfo, NetRenewTerms, RoomPreview, RoomSummary, RoundResultsPayload, SeasonEndPayload, SeasonSnapshotPayload,
  FriendsLeague, PublicRoomInfo, ReactionPayload, RoomSettings, SkipEndPayload, TurnFeedItem, JobsPayload,
} from '@cosmicfut/shared';
import { forgetCareer, rememberCareer, savedCareer } from '@/online/careers';
import type {
  Fixture, MatchCommand, MatchConfig, MatchEvent, MatchResult, MatchState, SeasonState, SeasonSummary, Side, WorldState,
} from '@cosmicfut/engine';
import { normalizePresets } from '@cosmicfut/engine';
import { careerBaseFor, loadMarketSquads } from '@/career/data';
import { clubIndexEntry, ensureClubIndex, shortFromName } from '@/data/clubIndex';
import { fmtMoney } from '@/lib/format';
import { cachedBundle, ensureBundles, setCareerBase } from '@/data/squads';
import { SERVER_URL } from '@/online/config';
import { call, callWithTimeout, fetchRoomPreview, getSocket, hasSocket, loadNickname, loadSession, saveNickname, saveSession, type OnlineSession } from '@/online/socket';
import { useOnlineGame } from './game';
import { useMode } from './mode';
import { useOnlineSeason, type BalancePoint } from './season';
import type { FeedItem, MatchToast } from './match';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaced';

export interface ChatMessage {
  playerId: string;
  nickname: string;
  text: string;
  at: number;
}

export interface OnlineToast {
  id: number;
  kind: 'info' | 'error' | 'success' | 'result';
  title: string;
  text?: string;
  lines?: string[];
}

export type RoundResults = RoundResultsPayload;

/** Partida ao vivo do jogador (estado reconstruído a partir dos ticks do servidor). */
export interface OnlineLiveMatch {
  matchId: string;
  config: MatchConfig;
  state: MatchState;
  side: Side;
  homePlayerId: string | null;
  awayPlayerId: string | null;
  speedMs: number;
  /** data da temporada no dia do jogo */
  date: string | null;
  /** (carreira) a fixture: competição, fase/rótulo, perna, mata-mata */
  fixture: NetFixtureInfo | null;
  feed: FeedItem[];
  batch: { key: number; events: MatchEvent[]; silent: boolean } | null;
  /** live → post (fim de jogo) → summary (resumo da rodada) */
  phase: 'live' | 'post' | 'summary';
  result: MatchResult | null;
  pause: MatchPausePayload | null;
  panel: null | 'changes' | 'halftime';
  /** já mandei o match:resume da pausa atual */
  resumeSent: boolean;
  /** pedi pausa (aguardando o adversário concordar) */
  pauseRequested: boolean;
  toasts: MatchToast[];
}

/** Resultado da última virada (season:end stage 'done'). */
export interface OnlineSeasonSummary {
  season: number;
  /** `contracts.humanReleased` já vem filtrado pelo servidor para o MEU clube */
  summary: SeasonSummary;
  /** saídas de cada humano (clubId → playerIds), vindas do servidor */
  releasedByClub?: Record<string, string[]>;
}

/** Ações do mercado online (ver net.ts: market:*). */
export type MarketCallType = 'offer' | 'contract' | 'respond' | 'withdraw' | 'list' | 'release' | 'counter' | 'loanlist' | 'option' | 'recall' | 'renew' | 'budget';

/** Pré-jogo online (match:preview): confronto e escalações até o apito. */
export type OnlinePreview = MatchPreviewPayload & { config: MatchConfig };

interface OnlineStore {
  status: ConnStatus;
  error: string | null;
  session: OnlineSession | null;
  playerId: string | null;
  room: RoomSummary | null;
  /** SeasonState do servidor (como veio) */
  season: SeasonState | null;
  seasonVersion: number;
  /** worldVersion a que a `season` atual pertence */
  stateWorldVersion: number;
  /** WorldState do servidor (só muda na virada) */
  world: WorldState | null;
  worldVersion: number;
  /** progresso do carregamento da base de elencos */
  loadingSquads: { done: number; total: number } | null;
  /** fim de temporada em andamento (season:end stage 'review') */
  seasonEnd: SeasonEndPayload | null;
  /** última virada (season:end stage 'done') */
  seasonSummary: OnlineSeasonSummary | null;
  /** placar resumido das partidas humanas da rodada (match:info / room:state) */
  infos: Record<string, LiveMatchInfo>;
  live: OnlineLiveMatch | null;
  /** pré-jogo em curso (até o match:start) */
  matchPreview: OnlinePreview | null;
  results: RoundResults[];
  chat: ChatMessage[];
  toasts: OnlineToast[];
  readyBusy: boolean;
  renewBusy: boolean;
  devBusy: boolean;
  lineupSync: 'idle' | 'pending' | 'saving' | 'error';
  /* ── (17/11) online 6 jogadores ── */
  /** o que o técnico da vez está fazendo (e avisos da rodada) */
  feed: TurnFeedItem[];
  /** Liga dos Amigos (calculada pelo servidor) */
  friends: FriendsLeague | null;
  /** reações recentes (balões flutuantes) */
  reactions: (ReactionPayload & { key: number })[];
  /** fim do último salto votado (banner) */
  skipEnd: SkipEndPayload | null;
  /** sou espectador */
  spectator: boolean;
  /* ── (carreira online salva e entrada tardia) ── */
  /** Central de Empregos (vagas + as minhas propostas/candidaturas) */
  jobs: JobsPayload | null;
  /** volta a uma carreira da lista "Minhas carreiras online" (token salvo neste navegador) */
  resume: (code: string) => Promise<string | null>;
  /** assume uma vaga com o código do host (outro aparelho / vaga reatribuída) */
  claimSeat: (code: string, seatCode: string, nickname?: string) => Promise<string | null>;
  /** cria uma sala a partir de um arquivo de backup */
  restoreBackup: (file: File) => Promise<string | null>;
  /** host: baixa o backup da sala */
  downloadBackup: () => Promise<string | null>;
  /** host: código de vaga para um técnico */
  seatCode: (playerId: string) => Promise<{ seatCode: string; expiresAt: number } | string>;
  /** host: encerra a carreira (apaga no servidor) */
  endCareer: (confirmCode: string) => Promise<string | null>;
  /** Central de Empregos: candidatura e propostas */
  jobsAct: (type: 'apply' | 'accept' | 'decline', payload: Record<string, unknown>) => Promise<{ ok: boolean; message?: string; error?: string; clubId?: string }>;

  /** Liga o socket (e faz rejoin se houver sessão salva). Idempotente. */
  connect: () => void;
  create: (nickname: string, settings?: Partial<RoomSettings>) => Promise<string | null>;
  join: (code: string, nickname: string, spectator?: boolean) => Promise<string | null>;
  preview: (code: string) => Promise<RoomPreview | string>;
  /** salas públicas no lobby */
  listRooms: () => Promise<PublicRoomInfo[] | string>;
  leave: () => Promise<void>;
  pickClub: (clubId: string) => Promise<string | null>;
  start: () => Promise<string | null>;
  updateSettings: (p: Partial<Omit<RoomSettings, 'divisionIds' | 'allowSameClub'>>) => Promise<string | null>;
  /** ações simples do lobby/rodada (devolve o erro ou null) */
  act: (event: 'room:set-color' | 'room:kick' | 'room:transfer-host' | 'room:react' | 'draft:start' | 'lottery:run' | 'turn:end' | 'round:force' | 'vote:propose' | 'vote:cast' | 'skip:cancel', payload?: Record<string, unknown>) => Promise<string | null>;
  loadFriends: () => Promise<void>;
  dismissSkipEnd: () => void;
  setReady: (ready: boolean) => Promise<void>;
  /** Fim de temporada: renovações do meu clube (playerId → termos) e "pronto para a virada". */
  renew: (renew: Record<string, NetRenewTerms>, ready?: boolean) => Promise<string | null>;
  /** (dev, host, DEV_COMMANDS=1 no servidor) avanço rápido. */
  devAdvance: (until: 'next-match' | 'season-end' | string) => Promise<string | null>;
  /** pede de novo o snapshot completo (mundo + estado) */
  sync: () => Promise<void>;
  sendChat: (text: string) => Promise<string | null>;
  /**
   * Ação de mercado no servidor. Com sucesso, só resolve depois que o 'market:update' da ação foi aplicado
   * (a SeasonState local já reflete o resultado quando a Promise volta).
   */
  marketCall: (type: MarketCallType, payload: Record<string, unknown>) => Promise<Ack<MarketActionResult>>;
  /** força uma nova tentativa de conexão (após 'replaced' ou servidor fora) */
  retry: () => void;

  command: (cmd: MatchCommand) => Promise<string | null>;
  resumeMatch: () => Promise<void>;
  requestPause: () => Promise<void>;
  openPanel: (p: 'changes' | 'halftime') => void;
  closePanel: () => void;
  matchToast: (t: Omit<MatchToast, 'id'>) => void;
  dismissMatchToast: (id: number) => void;
  /** pós-jogo → resumo da rodada */
  toSummary: () => void;
  /** resumo visto → volta ao planejamento */
  closeLive: () => void;

  toast: (t: Omit<OnlineToast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;
let feedKey = 0;
let reactionKey = 0;
const FEED_ITEMS = 60;
const FEED_CAP = 400;
const CHAT_CAP = 120;
const HISTORY_CAP = 800;

/** JSON+gzip binário (ArrayBuffer no navegador) → objeto. */
async function gunzipJson<T>(buf: ArrayBuffer | Uint8Array): Promise<T> {
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}

export const useOnline = create<OnlineStore>()((set, get) => {
  /* ───────── helpers ───────── */

  const patchLive = (fn: (l: OnlineLiveMatch) => Partial<OnlineLiveMatch> | null) => {
    const l = get().live;
    if (!l) return;
    const p = fn(l);
    if (p) set({ live: { ...l, ...p } });
  };

  const nickOf = (playerId: string | null | undefined) => get().room?.players.find((p) => p.playerId === playerId)?.nickname ?? 'Adversário';

  const fail = (r: { ok: boolean; error?: string }): string | null => (r.ok ? null : (r.error ?? 'Erro.'));

  const enterRoom = (session: OnlineSession, activate = true) => {
    saveSession(session);
    // (carreira online salva) lista "Minhas carreiras online" deste navegador
    rememberCareer({ code: session.code, token: session.token, playerId: session.playerId, nickname: savedCareer(session.code)?.nickname ?? loadNickname() });
    set({ session, playerId: session.playerId, error: null });
    // o rejoin automático não troca o modo (quem está jogando solo continua no solo)
    if (activate) useMode.getState().setMode('online');
  };

  /** Esquece a carreira recebida (sala nova / sala voltou ao lobby). */
  const resetCareer = () => {
    epoch++;
    syncRequestedFor = -1;
    set({ season: null, seasonVersion: 0, stateWorldVersion: 0, world: null, worldVersion: 0, seasonEnd: null, seasonSummary: null, loadingSquads: null });
    lastPublished = { season: null, world: null, clubId: null, summary: null };
    history = [];
    baseKey = '';
    baseLoading = null;
    setCareerBase(null, 'online');
    useOnlineSeason.getState().discard();
  };

  const resetRoomState = () => {
    resetCareer();
    set({
      session: null, playerId: null, room: null, infos: {}, live: null, matchPreview: null, results: [], chat: [], readyBusy: false, renewBusy: false, devBusy: false, lineupSync: 'idle',
      feed: [], friends: null, reactions: [], skipEnd: null, spectator: false, jobs: null,
    });
    useOnlineGame.getState().resetGame();
  };

  const rejoin = async () => {
    const s = loadSession();
    if (!s) return;
    const r = await call<{ playerId: string }>('room:rejoin', { code: s.code, token: s.token });
    if (r.ok) {
      enterRoom({ ...s, playerId: r.data.playerId }, false);
    } else {
      // sala expirou / token inválido: limpa a sessão
      saveSession(null);
      resetRoomState();
      get().toast({ kind: 'error', title: 'Não foi possível voltar à sala', text: r.error });
    }
  };

  /* ───────── handlers do servidor ───────── */

  let bound = false;
  const bind = () => {
    if (bound) return;
    bound = true;
    const sock = getSocket();
    sock.on('connect', () => {
      set({ status: 'connected', error: null });
      void rejoin();
    });
    sock.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') set({ status: 'idle' });
      else if (get().status !== 'replaced') set({ status: 'reconnecting' });
    });
    sock.on('connect_error', (e) => set({ status: get().status === 'replaced' ? 'replaced' : 'reconnecting', error: e.message }));

    sock.on('room:state', (room) => {
      const prev = get().room;
      const infos: Record<string, LiveMatchInfo> = {};
      for (const m of room.matches) {
        const cur = get().infos[m.matchId];
        infos[m.matchId] = cur && isNewer(cur, m) ? cur : m;
      }
      set({ room, infos });
      // fui removido da sala (expirou no lobby)
      const me = get().playerId;
      if (me && !room.players.some((p) => p.playerId === me)) {
        saveSession(null);
        resetRoomState();
        get().toast({ kind: 'error', title: 'Você saiu da sala', text: 'A sala não tem mais o seu jogador.' });
        return;
      }
      // sala voltou ao lobby (carreira perdida no servidor): a próxima carreira recomeça as versões do zero
      if (room.phase === 'lobby' && get().season) resetCareer();
      // fase saiu do fim de temporada sem 'done' (ex.: rejoin depois da virada): esquece a revisão
      if (room.phase !== 'season-end' && get().seasonEnd) set({ seasonEnd: null });
      // pré-jogo só existe no dia de jogo
      if (room.phase !== 'matchday' && get().matchPreview) set({ matchPreview: null });
      if (prev?.phase !== room.phase && room.phase === 'planning') flushLineupSoon(0);
      // (17/11) modo turnos: a escalação mexida fora da vez vai ao servidor quando a minha vez começa
      if (room.turn?.playerId === me && prev?.turn?.playerId !== me) flushLineupSoon(0);
      const meRec = room.players.find((p) => p.playerId === me);
      if (!!meRec?.spectator !== get().spectator) set({ spectator: !!meRec?.spectator });
      // (carreira online) demitido / assumiu um clube
      const before = prev?.players.find((p) => p.playerId === me);
      if (before && meRec && prev?.code === room.code && before.clubId !== meRec.clubId) {
        if (before.clubId && !meRec.clubId) get().toast({ kind: 'error', title: 'Você foi demitido!', text: `A diretoria do ${clubName(before.clubId)} encerrou o seu contrato. Procure um novo clube na Central de Empregos.` });
        else if (meRec.clubId) get().toast({ kind: 'success', title: `Novo clube: ${clubName(meRec.clubId)}`, text: 'Você é o novo técnico. Bom trabalho!' });
      }
      publishSeason();
    });

    sock.on('season:snapshot', (p) => {
      snapChain = snapChain.then(() => onSnapshot(p)).catch((e) => {
        console.warn('[online] snapshot inválido', e);
        get().toast({ kind: 'error', title: 'Temporada', text: 'Não foi possível ler a temporada do servidor.' });
      });
    });

    sock.on('season:end', (e) => onSeasonEnd(e));

    // mercado: patch do estado (mesma fila dos snapshots: a ordem de versão é preservada)
    sock.on('market:update', (u) => {
      snapChain = snapChain.then(() => onMarketUpdate(u)).catch((e) => {
        console.warn('[online] market:update inválido', e);
        requestSync(get().worldVersion, true);
      });
    });

    sock.on('match:preview', (p) => {
      // reconexão no meio da partida já começada: ignora
      if (get().live?.matchId === p.matchId && get().live?.phase === 'live') return;
      set({ matchPreview: { ...p, config: p.config as MatchConfig } });
    });

    sock.on('round:results', (r) => {
      set({ results: [...get().results.slice(-30), r] });
      announceResults(r);
    });

    sock.on('match:start', (m) => onMatchStart(m));
    sock.on('match:tick', (t) => onTick(t));
    sock.on('match:pause', (p) => onPause(p));
    sock.on('match:end', (e) => onMatchEnd(e));
    sock.on('match:info', (info) => set({ infos: { ...get().infos, [info.matchId]: info } }));

    sock.on('chat:message', (m) => set({ chat: [...get().chat.slice(-(CHAT_CAP - 1)), m] }));
    /* ── (17/11) ── */
    sock.on('turn:feed', (f) => set({ feed: [...get().feed.slice(-(FEED_ITEMS - 1)), f] }));
    sock.on('friends:update', (l) => set({ friends: l }));
    sock.on('room:reaction', (r) => {
      const key = ++reactionKey;
      set({ reactions: [...get().reactions.slice(-11), { ...r, key }] });
      setTimeout(() => set({ reactions: get().reactions.filter((x) => x.key !== key) }), 2600);
    });
    sock.on('skip:end', (e) => {
      set({ skipEnd: e });
      const title = e.reason === 'done' ? 'Salto concluído' : e.reason === 'cancelled' ? 'Salto cancelado' : e.reason === 'season-end' ? 'Fim de temporada' : 'Salto interrompido';
      get().toast({ kind: e.reason === 'error' ? 'error' : 'info', title, text: e.note ?? `${e.days} dia(s) simulados.` });
    });
    sock.on('jobs:update', (j) => {
      set({ jobs: j });
      // desempregado: a "visão" usa o último clube (histórico) como referência
      if (!myClubId()) publishSeason();
    });
    sock.on('room:ended', (e) => {
      forgetCareer(e.code);
      if (get().session?.code !== e.code) return;
      saveSession(null);
      resetRoomState();
      useMode.getState().setMode('solo');
      get().toast({ kind: 'info', title: 'Carreira encerrada', text: `${e.by} (host) encerrou a carreira ${e.code}.` });
    });
    sock.on('vote:result', (r) => {
      if (!r.passed) get().toast({ kind: 'info', title: r.kind === 'skip' ? 'Salto recusado' : 'Pausa recusada', text: `${r.yes} de ${r.needed} votos necessários.` });
    });
    sock.on('error', (e) => {
      if (e.code === 'replaced') {
        set({ status: 'replaced', error: e.message });
        return;
      }
      if (e.code === 'kicked') {
        saveSession(null);
        resetRoomState();
        useMode.getState().setMode('solo');
        get().toast({ kind: 'error', title: 'Você foi removido da sala', text: e.message });
        return;
      }
      get().toast({ kind: 'error', title: 'Servidor', text: e.message });
    });
  };

  /* ───────── carreira: snapshot (gzip) ───────── */

  /** incrementa a cada reset: descarta decodificações em andamento de uma carreira anterior */
  let epoch = 0;
  /** snapshots processados em ordem de chegada (a decodificação é assíncrona) */
  let snapChain: Promise<void> = Promise.resolve();
  let syncRequestedFor = -1;

  const requestSync = (worldVersion: number, force = false) => {
    if (syncRequestedFor === worldVersion && !force) return;
    syncRequestedFor = worldVersion;
    void call('season:sync').then((r) => {
      if (!r.ok) syncRequestedFor = -1;
    });
  };

  /* ───────── versão da SeasonState: quem espera um market:update ───────── */

  const waiters: { v: number; done: () => void }[] = [];
  const notifyVersion = () => {
    const v = get().seasonVersion;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].v <= v) {
        waiters[i].done();
        waiters.splice(i, 1);
      }
    }
  };
  /** Resolve quando a SeasonState local chegar à versão `v` (true) ou no timeout (false). */
  const waitVersion = (v: number, ms = 8000): Promise<boolean> =>
    new Promise((resolve) => {
      if (get().seasonVersion >= v) return resolve(true);
      const w = {
        v,
        done: () => {
          clearTimeout(t);
          resolve(true);
        },
      };
      const t = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      }, ms);
      waiters.push(w);
    });

  /* ───────── mercado: patch (market:update) ───────── */

  const onMarketUpdate = async (u: MarketUpdatePayload) => {
    const my = epoch;
    if (!get().season || u.version <= get().seasonVersion) return;
    const patch = await gunzipJson<MarketPatch>(u.patchGz);
    if (my !== epoch) return;
    const s = get().season;
    if (!s || u.version <= get().seasonVersion) return;
    // perdeu alguma versão (ex.: reconectou no meio): pede o estado completo
    if (u.version !== get().seasonVersion + 1) {
      requestSync(get().worldVersion, true);
      return;
    }
    const next: SeasonState = {
      ...s,
      market: patch.market as SeasonState['market'],
      clubs: { ...s.clubs, ...(patch.clubs as SeasonState['clubs']) },
      news: s.news.slice(0, patch.news.from).concat(patch.news.items as SeasonState['news']),
    };
    set({ season: next, seasonVersion: u.version });
    publishSeason();
    notifyVersion();
    marketNotices(s, next);
  };

  /** Avisos de mercado do MEU clube: ofertas novas recebidas e respostas às minhas propostas a outros humanos. */
  const marketNotices = (prev: SeasonState, next: SeasonState) => {
    const me = myClubId();
    if (!me || !next.market) return;
    const before = new Map((prev.market?.offers ?? []).map((o) => [o.id, o.status]));
    const humans = new Set(next.humanClubIds);
    const nickOfClub = (clubId: string) => get().room?.players.find((p) => p.clubId === clubId)?.nickname;
    for (const o of next.market.offers) {
      const was = before.get(o.id);
      if (o.fromClubId === me && o.status === 'pending' && was !== 'pending') {
        const who = humans.has(o.toClubId) ? `${nickOfClub(o.toClubId) ?? o.toName} (${o.toName})` : o.toName;
        get().toast({ kind: 'info', title: 'Proposta recebida', text: `${who} oferece ${fmtMoney(o.fee)} por ${o.player.name}${o.kind === 'loan' ? ' (empréstimo)' : ''}. Responda em Mercado › Ofertas recebidas.` });
      } else if (o.toClubId === me && humans.has(o.fromClubId) && was === 'pending' && o.status !== 'pending' && o.status !== 'withdrawn') {
        const ok = o.status === 'completed';
        get().toast({ kind: ok ? 'success' : 'info', title: ok ? 'Proposta aceita!' : 'Proposta recusada', text: `${o.player.name} · ${o.fromName}${ok ? ` · ${fmtMoney(o.fee)}` : o.log.at(-1)?.text ? ` · ${o.log.at(-1)!.text}` : ''}` });
      }
    }
  };

  const onSnapshot = async (p: SeasonSnapshotPayload) => {
    const my = epoch;
    const cur = get();
    // fora de ordem / repetido (o rejoin manda de novo o mesmo estado, agora com o mundo)
    if (cur.season && p.version < cur.seasonVersion) return;
    if (cur.season && p.version === cur.seasonVersion && !p.worldGz) return;
    const t0 = performance.now();
    const [state, world] = await Promise.all([
      p.stateGz ? gunzipJson<SeasonState>(p.stateGz) : Promise.resolve((p.state as SeasonState | undefined) ?? null),
      p.worldGz ? gunzipJson<WorldState>(p.worldGz) : Promise.resolve(null),
    ]);
    if (my !== epoch) return;
    const wv = p.worldVersion ?? 0;
    const patch: Partial<OnlineStore> = {};
    if (world) {
      patch.world = world;
      patch.worldVersion = wv;
    }
    const prevState = get().stateWorldVersion === wv ? get().season : null;
    if (state) {
      patch.season = state;
      patch.seasonVersion = p.version;
      patch.stateWorldVersion = wv;
    }
    set(patch);
    notifyVersion();
    // ofertas novas da IA pelos meus jogadores (chegam com a rodada)
    if (prevState && state && prevState.date !== state.date) marketNotices(prevState, state);
    if (import.meta.env.DEV) {
      const kb = (n?: number) => (n ? `${Math.round(n / 1024)} KB` : '—');
      console.info(
        `[online] snapshot v${p.version} (mundo v${wv}${world ? ', novo' : ''}) · estado ${kb(p.bytes?.stateGz)} gz / ${kb(p.bytes?.state)}` +
          `${world ? ` · mundo ${kb(p.bytes?.worldGz)} gz / ${kb(p.bytes?.world)}` : ''} · decodificado em ${Math.round(performance.now() - t0)} ms`,
      );
    }
    // mundo novo (virada) que não veio junto: pede o snapshot completo
    if (!world && (get().worldVersion !== wv || !get().world)) requestSync(wv);
    publishSeason();
  };

  /* ───────── fim de temporada ───────── */

  const onSeasonEnd = (e: SeasonEndPayload) => {
    if (e.stage === 'review') {
      set({ seasonEnd: e, seasonSummary: null });
      return;
    }
    if (!e.summary) return;
    // (13/11) o servidor já filtra summary.contracts.humanReleased para o MEU clube e manda o mapa por clube
    set({ seasonEnd: null, seasonSummary: { season: e.season, summary: e.summary as SeasonSummary, releasedByClub: e.humanReleasedByClub } });
    publishSeason();
    get().toast({ kind: 'success', title: `Temporada ${e.season + 1} começou`, text: 'Virada concluída: veja o resumo em Fim de temporada.' });
  };

  /* ───────── partida ───────── */

  const onMatchStart = (m: MatchStartPayload) => {
    if (get().matchPreview) set({ matchPreview: null });
    const config = m.config as MatchConfig;
    const state = m.state as MatchState;
    const prev = get().live;
    const feed = state.events.map((e) => ({ ...e, key: ++feedKey }));
    const side: Side = m.side ?? (m.homePlayerId === get().playerId ? 'home' : 'away');
    set({
      live: {
        matchId: m.matchId,
        config,
        state,
        side,
        homePlayerId: m.homePlayerId ?? null,
        awayPlayerId: m.awayPlayerId ?? null,
        speedMs: m.speedMs ?? get().room?.settings.matchSpeedMs ?? 400,
        // o snapshot do dia de jogo pode chegar DEPOIS do match:start: a data vem da fixture / sala
        date: m.fixture?.date ?? get().room?.date ?? get().season?.date ?? null,
        fixture: m.fixture ?? (prev?.matchId === m.matchId ? prev.fixture : null),
        feed: feed.slice(-FEED_CAP),
        batch: null,
        phase: state.phase === 'finished' ? 'post' : 'live',
        result: null,
        pause: null,
        // mesmo jogo (reconexão): mantém o painel aberto; o match:pause que vem em seguida reabre o intervalo
        panel: prev?.matchId === m.matchId && prev.panel === 'changes' ? 'changes' : null,
        resumeSent: false,
        pauseRequested: false,
        toasts: prev?.matchId === m.matchId ? prev.toasts : [],
      },
    });
  };

  const onTick = (t: MatchTickPayload) => {
    const l = get().live;
    if (!l || l.matchId !== t.matchId) return;
    const events = t.events as MatchEvent[];
    const state: MatchState = {
      ...l.state,
      minute: t.minute,
      extra: t.extra,
      phase: t.phase ?? l.state.phase,
      score: t.score,
      momentum: t.momentum,
      stats: (t.stats as MatchState['stats']) ?? l.state.stats,
      players: (t.players as MatchState['players']) ?? l.state.players,
      tactic: (t.tactic as MatchState['tactic']) ?? l.state.tactic,
      slots: (t.slots as MatchState['slots']) ?? l.state.slots,
      penaltyScore: t.penaltyScore ?? l.state.penaltyScore,
      events: events.length ? l.state.events.concat(events) : l.state.events,
    };
    const items = events.map((e) => ({ ...e, key: ++feedKey }));
    set({
      live: {
        ...l,
        state,
        feed: items.length ? [...l.feed, ...items].slice(-FEED_CAP) : l.feed,
        batch: events.length ? { key: feedKey, events, silent: false } : l.batch,
      },
    });
    // PvP: avisa as mudanças do adversário (substituições e postura)
    const pvp = !!l.homePlayerId && !!l.awayPlayerId;
    if (pvp) {
      const oppSide: Side = l.side === 'home' ? 'away' : 'home';
      const opp = nickOf(oppSide === 'home' ? l.homePlayerId : l.awayPlayerId);
      const name = (id?: string) => (id ? (playerName(l.config, id) ?? '') : '');
      for (const e of events) {
        if (e.side !== oppSide) continue;
        if (e.type === 'substitution') {
          get().matchToast({ kind: 'info', title: `${opp} substituiu`, text: `▲ ${name(e.playerId)}  ▼ ${name(e.playerOutId)}`, side: oppSide });
        } else if (e.type === 'tactic-change') {
          get().matchToast({ kind: 'info', title: `${opp} mudou a postura`, text: e.text, side: oppSide });
        }
      }
    }
  };

  const onPause = (p: MatchPausePayload) => {
    patchLive((l) => {
      if (l.matchId !== p.matchId) return null;
      if (!p.paused) return { pause: null, panel: l.panel === 'halftime' ? null : l.panel, resumeSent: false, pauseRequested: false };
      const me = get().playerId ?? '';
      const resumeSent = !p.waitingFor.includes(me);
      const panel = p.reason === 'half-time' && !resumeSent ? 'halftime' : l.panel;
      return { pause: p, panel, resumeSent, pauseRequested: false };
    });
  };

  const onMatchEnd = (e: MatchEndPayload) => {
    patchLive((l) => {
      if (l.matchId !== e.matchId) return null;
      const base = e.result as MatchResult;
      // agregado / quem avança / pênaltis do confronto (o PostMatch lê do MatchResult)
      const result: MatchResult = {
        ...base,
        ...(e.aggregate ? { aggregate: e.aggregate } : {}),
        ...(e.advancing ? { advancing: e.advancing } : {}),
        ...(e.penalties ? { penalties: e.penalties } : {}),
      };
      return { phase: l.phase === 'summary' ? 'summary' : 'post', result, pause: null, panel: null, state: { ...l.state, phase: 'finished' } };
    });
  };

  /* ───────── resultados ───────── */

  const announceResults = (r: RoundResults) => {
    const season = get().season;
    if (!season) return;
    const humans = new Set(season.humanClubIds);
    const byId = fixtureIndex(season);
    const lines: string[] = [];
    for (const x of r.results) {
      const f = byId.get(x.fixtureId);
      if (!f || (!humans.has(f.homeId) && !humans.has(f.awayId))) continue;
      const pens = x.penalties ? ` (pên. ${x.penalties.home}-${x.penalties.away})` : '';
      lines.push(`${clubName(f.homeId)} ${x.home} x ${x.away} ${clubName(f.awayId)}${pens}`);
    }
    if (!lines.length) return;
    get().toast({ kind: 'result', title: `Resultados · ${fmtShortDate(r.date)}`, lines });
  };

  /* ───────── base de elencos da sala (bundles de todos os humanos + mercado) ───────── */

  let baseKey = '';
  let baseLoading: string | null = null;

  /** true quando a base dos humanos `ids` já está registrada; senão começa a carregar (e republica no fim). */
  const ensureBase = (ids: string[]): boolean => {
    const key = [...ids].sort().join('|');
    if (baseKey === key) return true;
    if (baseLoading === key) return false;
    baseLoading = key;
    const my = epoch;
    if (useOnlineSeason.getState().status !== 'ready') useOnlineSeason.setState({ status: 'loading', bootProgress: { stage: 'elencos', done: 0, total: ids.length + 1 } });
    const progress = (done: number) => {
      set({ loadingSquads: { done, total: ids.length + 1 } });
      if (useOnlineSeason.getState().status !== 'ready') useOnlineSeason.setState({ bootProgress: { stage: 'elencos', done, total: ids.length + 1 } });
    };
    let marketDone = 0;
    let bundlesDone = 0;
    void Promise.all([
      loadMarketSquads().then((m) => {
        marketDone = 1;
        progress(marketDone + bundlesDone);
        return m;
      }),
      ensureBundles(ids, (done) => {
        bundlesDone = done;
        progress(marketDone + bundlesDone);
      }),
      ensureClubIndex(),
    ])
      .then(([market]) => {
        if (my !== epoch) return;
        const humans = new Map(ids.map((id) => [id, cachedBundle(id)?.players ?? []]));
        setCareerBase(careerBaseFor(market, humans), 'online');
        baseKey = key;
        baseLoading = null;
        set({ loadingSquads: null });
        publishSeason();
      })
      .catch((e) => {
        if (my !== epoch) return;
        baseLoading = null;
        set({ loadingSquads: null });
        useOnlineSeason.setState({ status: 'error', error: `elencos indisponíveis: ${e instanceof Error ? e.message : String(e)}`, bootProgress: null });
      });
    return false;
  };

  /* ───────── temporada → stores proxy (useOnlineSeason / useOnlineGame) ───────── */

  let lastPublished: { season: SeasonState | null; world: WorldState | null; clubId: string | null; summary: SeasonSummary | null } = {
    season: null, world: null, clubId: null, summary: null,
  };
  let history: BalancePoint[] = [];

  const myClubId = () => get().room?.players.find((p) => p.playerId === get().playerId)?.clubId ?? null;

  /**
   * (carreira online) Técnico desempregado: a "visão" não tem clube humano (como o solo demitido) e usa um clube de
   * referência (o último que treinou; senão o de outro técnico da sala) só para tema/escudo do menu.
   */
  const joblessRef = (season: SeasonState, room: RoomSummary): string | null => {
    const me = room.players.find((p) => p.playerId === get().playerId);
    if (!me || me.spectator || me.clubId || room.phase === 'lobby') return null;
    const hist = get().jobs?.me?.history ?? [];
    const last = hist[hist.length - 1]?.clubId;
    if (last && season.clubs[last]) return last;
    return season.humanClubIds[0] ?? Object.keys(season.clubs).sort()[0] ?? null;
  };

  function publishSeason() {
    const { season, world, room } = get();
    const own = myClubId();
    const ref = !own && season && room ? joblessRef(season, room) : null;
    const clubId = own ?? ref;
    if (!season || !world || !room || !clubId || room.phase === 'lobby') return;
    // estado de outra temporada que o mundo atual (virada sem worldGz): espera o season:sync
    if (get().stateWorldVersion !== get().worldVersion) return;
    if (!ensureBase(season.humanClubIds)) return;
    const summary = get().seasonSummary?.summary ?? null;
    if (lastPublished.season === season && lastPublished.world === world && lastPublished.clubId === clubId && lastPublished.summary === summary) return;
    lastPublished = { season, world, clubId, summary };
    // visão do jogador: o clube dele é o "humano principal" (humanIdOf / fixtureToday / standings); desempregado: nenhum
    const view: SeasonState = { ...season, humanClubIds: own ? [own, ...season.humanClubIds.filter((id) => id !== own)] : [] };
    const balance = season.clubs[clubId]?.balance ?? 0;
    if (history[history.length - 1]?.date !== season.date) history = [...history, { date: season.date, balance }].slice(-HISTORY_CAP);
    const prevSave = useOnlineSeason.getState().save;
    useOnlineSeason.setState({
      status: 'ready',
      error: null,
      bootProgress: null,
      save: { v: 2, clubId, startedAt: `online:${room.code}`, season: view, world, history, summary, savedAt: new Date().toISOString() },
    });
    // tática/escalação: na 1ª vez (ou troca de clube) adota o que o servidor tem
    const g = useOnlineGame.getState();
    const club = season.clubs[clubId];
    if (g.clubId !== clubId || !prevSave) {
      const b = cachedBundle(clubId)?.club;
      applyingFromServer = true;
      useOnlineGame.setState({
        clubId,
        startedAt: `online:${room.code}`,
        clubPreview: b ? { id: b.id, name: b.name, colors: b.colors, crestMini: b.crestMini } : null,
        tactic: club?.tactic ?? g.tactic,
        lineup: club?.lineup ?? null,
        presets: normalizePresets(club?.tacticPresets),
      });
      applyingFromServer = false;
    }
  }

  /* ───────── escalação: round:set-lineup com debounce ───────── */

  let applyingFromServer = false;
  let lineupTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const sendLineup = async (): Promise<string | null> => {
    if (lineupTimer) clearTimeout(lineupTimer);
    lineupTimer = null;
    if (!dirty) return null;
    if (get().room?.phase !== 'planning') return null; // manda quando voltar ao planejamento
    // (17/11) modo turnos: só na minha vez (fica pendente até lá)
    const rm = get().room;
    if (rm && rm.settings.turnMode !== 'simultaneous' && rm.turn?.playerId !== get().playerId) return null;
    const { tactic, lineup, presets } = useOnlineGame.getState();
    dirty = false;
    set({ lineupSync: 'saving' });
    const r = await call('round:set-lineup', { tactic, lineup, presets });
    if (!r.ok) {
      set({ lineupSync: 'error' });
      get().toast({ kind: 'error', title: 'Escalação não salva', text: r.error });
      return r.error;
    }
    set({ lineupSync: dirty ? 'pending' : 'idle' });
    return null;
  };

  function flushLineupSoon(ms = 700) {
    if (!dirty) return;
    if (lineupTimer) clearTimeout(lineupTimer);
    lineupTimer = setTimeout(() => void sendLineup(), ms);
  }

  useOnlineGame.subscribe((s, prev) => {
    if (applyingFromServer || !get().session) return;
    // desempregado: o clube da visão é só referência (nada vai ao servidor)
    if (!myClubId()) return;
    if (s.clubId !== prev.clubId) return;
    if (s.tactic === prev.tactic && s.lineup === prev.lineup && s.presets === prev.presets) return;
    dirty = true;
    set({ lineupSync: 'pending' });
    flushLineupSoon();
  });

  /* ───────── API ───────── */

  return {
    status: 'idle',
    error: null,
    session: loadSession(),
    playerId: loadSession()?.playerId ?? null,
    room: null,
    season: null,
    seasonVersion: 0,
    stateWorldVersion: 0,
    world: null,
    worldVersion: 0,
    loadingSquads: null,
    seasonEnd: null,
    seasonSummary: null,
    infos: {},
    live: null,
    matchPreview: null,
    results: [],
    chat: [],
    toasts: [],
    readyBusy: false,
    renewBusy: false,
    devBusy: false,
    lineupSync: 'idle',
    feed: [],
    friends: null,
    reactions: [],
    skipEnd: null,
    spectator: false,
    jobs: null,

    resume: async (code) => {
      const c = savedCareer(code);
      if (!c) return 'Carreira não encontrada neste navegador.';
      get().connect();
      if (get().session?.code !== code) resetRoomState();
      const r = await call<{ playerId: string }>('room:rejoin', { code: c.code, token: c.token });
      if (!r.ok) return r.error;
      saveNickname(c.nickname);
      enterRoom({ code: c.code, token: c.token, playerId: r.data.playerId });
      return null;
    },

    claimSeat: async (code, seatCode, nickname) => {
      get().connect();
      resetRoomState();
      const r = await call<{ playerId: string; token: string }>('room:claim-seat', { code, seatCode, ...(nickname ? { nickname } : {}) });
      if (!r.ok) return r.error;
      if (nickname) saveNickname(nickname);
      enterRoom({ code, token: r.data.token, playerId: r.data.playerId });
      return null;
    },

    restoreBackup: async (file) => {
      try {
        const res = await fetch(`${SERVER_URL}/rooms/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/json' }, body: file });
        const j = (await res.json()) as Ack<{ code: string; playerId: string; token: string }>;
        if (!j.ok) return j.error;
        get().connect();
        resetRoomState();
        const r = await call<{ playerId: string }>('room:rejoin', { code: j.data.code, token: j.data.token });
        if (!r.ok) return r.error;
        enterRoom({ code: j.data.code, token: j.data.token, playerId: j.data.playerId });
        return null;
      } catch {
        return 'Servidor indisponível.';
      }
    },

    downloadBackup: async () => {
      const s = get().session;
      if (!s) return 'Sem sala.';
      try {
        const res = await fetch(`${SERVER_URL}/rooms/${s.code}/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: s.token }) });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          return j?.error ?? 'Não foi possível gerar o backup.';
        }
        const blob = await res.blob();
        const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `cosmicfut-${s.code}.json.gz`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return null;
      } catch {
        return 'Servidor indisponível.';
      }
    },

    seatCode: async (playerId) => {
      const r = await call<{ seatCode: string; expiresAt: number }>('room:seat-code', { playerId });
      return r.ok ? r.data : r.error;
    },

    endCareer: async (confirmCode) => {
      const s = get().session;
      const r = await call('room:end', { confirm: confirmCode });
      if (!r.ok) return r.error;
      if (s) forgetCareer(s.code);
      saveSession(null);
      resetRoomState();
      useMode.getState().setMode('solo');
      return null;
    },

    jobsAct: async (type, payload) => {
      const r = await callWithTimeout<{ message: string; clubId?: string }>(20_000, `jobs:${type}`, payload);
      return r.ok ? { ok: true, message: r.data?.message, clubId: r.data?.clubId } : { ok: false, error: r.error };
    },

    connect: () => {
      bind();
      const sock = getSocket();
      if (sock.connected) {
        if (get().status !== 'connected') set({ status: 'connected' });
        return;
      }
      if (get().status === 'idle') set({ status: 'connecting' });
      if (!sock.active) sock.connect();
    },

    retry: () => {
      const sock = getSocket();
      set({ status: 'connecting', error: null });
      if (sock.connected) void rejoin();
      else sock.connect();
    },

    create: async (nickname, settings) => {
      get().connect();
      saveNickname(nickname);
      // limpa ANTES: o room:state da sala nova chega antes do ack
      resetRoomState();
      const r = await call<{ code: string; playerId: string; token: string }>('room:create', { nickname, ...(settings ? { settings } : {}) });
      if (!r.ok) return r.error;
      enterRoom({ code: r.data.code, token: r.data.token, playerId: r.data.playerId });
      return null;
    },

    join: async (code, nickname, spectator) => {
      get().connect();
      saveNickname(nickname);
      const keep = { session: get().session, playerId: get().playerId };
      const r0 = get().session;
      resetRoomState();
      const r = await call<{ playerId: string; token: string }>('room:join', { code, nickname, ...(spectator ? { spectator: true } : {}) });
      if (!r.ok) {
        // continua na sala anterior (se havia)
        if (r0) set(keep);
        return r.error;
      }
      enterRoom({ code, token: r.data.token, playerId: r.data.playerId });
      return null;
    },

    preview: async (code) => {
      const r = await fetchRoomPreview<RoomPreview>(code);
      return r.ok ? r.data : r.error;
    },

    leave: async () => {
      if (hasSocket() && getSocket().connected) await call('room:leave');
      saveSession(null);
      resetRoomState();
      useMode.getState().setMode('solo');
    },

    listRooms: async () => {
      try {
        const res = await fetch(`${SERVER_URL}/rooms`, { headers: { Accept: 'application/json' } });
        const j = (await res.json()) as Ack<PublicRoomInfo[]>;
        return j.ok ? j.data : j.error;
      } catch {
        return 'Servidor indisponível.';
      }
    },

    act: async (event, payload) => {
      get().connect();
      const r = payload === undefined ? await call(event) : await call(event, payload);
      return fail(r);
    },

    loadFriends: async () => {
      const r = await call<FriendsLeague>('friends:get');
      if (r.ok) set({ friends: r.data });
    },

    dismissSkipEnd: () => set({ skipEnd: null }),

    pickClub: async (clubId) => fail(await call('room:pick-club', { clubId })),
    // criar a carreira no servidor leva alguns segundos
    start: async () => fail(await callWithTimeout(60_000, 'room:start')),
    updateSettings: async (p) => fail(await call('room:update-settings', p)),

    setReady: async (ready) => {
      if (get().readyBusy) return;
      set({ readyBusy: true });
      try {
        if (ready && get().room?.phase === 'planning') {
          dirty = dirty || get().lineupSync === 'error';
          const err = await sendLineup();
          if (err) return;
        }
        // (17/11) modo turnos: "Concluir vez"
        const rm = get().room;
        if (ready && rm?.phase === 'planning' && rm.settings.turnMode !== 'simultaneous') {
          const r = await call('turn:end');
          if (!r.ok) get().toast({ kind: 'error', title: 'Não foi possível', text: r.error });
          return;
        }
        const r = await call('round:ready', { ready });
        if (!r.ok) get().toast({ kind: 'error', title: 'Não foi possível', text: r.error });
      } finally {
        set({ readyBusy: false });
      }
    },

    renew: async (renew, ready = true) => {
      if (get().renewBusy) return null;
      set({ renewBusy: true });
      try {
        const r = await call<{ accepted: number }>('season:renew', { renew, ready });
        if (!r.ok) {
          get().toast({ kind: 'error', title: 'Renovações não enviadas', text: r.error });
          return r.error;
        }
        get().toast({ kind: 'success', title: 'Renovações enviadas', text: `${r.data.accepted} ${r.data.accepted === 1 ? 'proposta' : 'propostas'}${ready ? ' · pronto para a virada' : ''}` });
        return null;
      } finally {
        set({ renewBusy: false });
      }
    },

    devAdvance: async (until) => {
      if (get().devBusy) return null;
      set({ devBusy: true });
      try {
        const r = await callWithTimeout<{ date: string; days: number }>(180_000, 'dev:advance', { until });
        if (!r.ok) {
          get().toast({ kind: 'error', title: 'dev:advance', text: r.error });
          return r.error;
        }
        get().toast({ kind: 'info', title: 'dev: avançou', text: `${r.data.days} dia(s) · agora ${fmtShortDate(r.data.date)}` });
        return null;
      } finally {
        set({ devBusy: false });
      }
    },

    sync: async () => {
      const r = await call('season:sync');
      if (!r.ok) get().toast({ kind: 'error', title: 'Sincronizar', text: r.error });
    },

    sendChat: async (text) => fail(await call('chat:send', { text })),

    marketCall: async (type, payload) => {
      const r = await callWithTimeout<MarketActionResult>(20_000, `market:${type}`, payload);
      // o resultado só vale para a UI depois que o patch da ação chegou (o ack pode chegar antes da decodificação)
      if (r.ok && !(await waitVersion(r.data.version))) requestSync(get().worldVersion, true);
      return r;
    },

    command: async (cmd) => {
      const l = get().live;
      if (!l) return 'Nenhuma partida em andamento.';
      const r = await call('match:command', { matchId: l.matchId, command: cmd });
      if (!r.ok) get().matchToast({ kind: 'error', title: 'Não foi possível', text: r.error });
      return r.ok ? null : r.error;
    },

    resumeMatch: async () => {
      const l = get().live;
      if (!l) return;
      patchLive(() => ({ panel: null, resumeSent: true }));
      if (!l.pause) return;
      const r = await call('match:resume', { matchId: l.matchId });
      if (!r.ok) get().matchToast({ kind: 'error', title: 'Não foi possível', text: r.error });
    },

    requestPause: async () => {
      const l = get().live;
      if (!l || l.pause) return;
      patchLive(() => ({ pauseRequested: true }));
      const r = await call('match:pause-request', { matchId: l.matchId });
      if (!r.ok) {
        patchLive(() => ({ pauseRequested: false }));
        get().matchToast({ kind: 'error', title: 'Não foi possível', text: r.error });
      }
    },

    openPanel: (panel) => {
      patchLive(() => ({ panel }));
      // (Atualização 38) abrir Mudanças pausa o relógio compartilhado na hora (limite por time e por tempo; ver
      // live-match.ts). Sem pausa disponível, o painel abre e a partida segue (aviso).
      const l = get().live;
      if (panel !== 'changes' || !l || l.pause || l.state.phase === 'finished' || l.state.phase === 'penalties') return;
      void call('match:pause-request', { matchId: l.matchId, kind: 'changes' }).then((r) => {
        if (!r.ok) get().matchToast({ kind: 'error', title: 'Partida segue', text: r.error });
      });
    },
    closePanel: () => {
      const l = get().live;
      patchLive(() => ({ panel: null }));
      // (Atualização 38) fechar o painel libera a pausa de mudanças que eu pedi
      const me = get().playerId ?? '';
      if (l?.pause?.reason === 'changes' && l.pause.waitingFor.includes(me)) void call('match:resume', { matchId: l.matchId });
    },
    matchToast: (t) => {
      const id = ++toastId;
      patchLive((l) => ({ toasts: [...l.toasts.slice(-3), { ...t, id }] }));
      setTimeout(() => get().dismissMatchToast(id), t.kind === 'goal' ? 2600 : 4200);
    },
    dismissMatchToast: (id) => patchLive((l) => ({ toasts: l.toasts.filter((t) => t.id !== id) })),
    toSummary: () => patchLive(() => ({ phase: 'summary', panel: null })),
    closeLive: () => set({ live: null }),

    toast: (t) => {
      const id = ++toastId;
      set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
      setTimeout(() => get().dismissToast(id), t.kind === 'result' ? 7000 : 5000);
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  };
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // inspeção/testes no navegador (ex.: __cfOnline.getState().devAdvance('2027-05-01'))
  (window as unknown as { __cfOnline: unknown }).__cfOnline = useOnline;
}

/* ───────── utilidades ───────── */

/** match:info chega com mais frequência que room:state: fica com o mais avançado. */
function isNewer(a: LiveMatchInfo, b: LiveMatchInfo): boolean {
  return a.minute > b.minute || (a.status === 'finished' && b.status !== 'finished');
}

const fixtureCache = new WeakMap<SeasonState, Map<string, Fixture>>();
export function fixtureIndex(s: SeasonState): Map<string, Fixture> {
  let m = fixtureCache.get(s);
  if (!m) {
    m = new Map(s.competitions.flatMap((c) => c.fixtures.map((f) => [f.id, f] as const)));
    fixtureCache.set(s, m);
  }
  return m;
}

function clubName(id: string): string {
  const b = cachedBundle(id)?.club;
  if (b) return b.shortName ?? b.name;
  const e = clubIndexEntry(id);
  return e ? shortFromName(e.name) : id;
}

function playerName(config: MatchConfig, id: string): string | undefined {
  return [...config.home.players, ...config.away.players].find((p) => p.id === id)?.name;
}

function fmtShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/* ───────── seletores ───────── */

/** Meu registro na sala. */
export function useMe() {
  return useOnline((s) => s.room?.players.find((p) => p.playerId === s.playerId) ?? null);
}

/**
 * Apelidos de quem ainda falta: no planejamento, quem não marcou "pronto" (só conectados contam);
 * no fim de temporada, quem não mandou as renovações (`room.seasonEnd.waitingFor`).
 */
export function useWaitingFor(): string[] {
  const room = useOnline((s) => s.room);
  const me = useOnline((s) => s.playerId);
  if (!room) return [];
  if (room.phase === 'season-end') {
    const ids = room.seasonEnd?.waitingFor ?? room.players.filter((p) => !p.ready).map((p) => p.playerId);
    return room.players.filter((p) => ids.includes(p.playerId) && p.playerId !== me && p.connected).map((p) => p.nickname);
  }
  // (17/11) modo turnos: quem está na vez e quem ainda vai jogar
  if (room.phase === 'planning' && room.settings.turnMode !== 'simultaneous' && room.turn) {
    const t = room.turn;
    const left = t.order.slice(t.playerId ? t.order.indexOf(t.playerId) : t.index).filter((id) => id !== me && !t.done.includes(id));
    return left.map((id) => room.players.find((p) => p.playerId === id)?.nickname ?? '?');
  }
  return room.players.filter((p) => p.connected && !p.ready && !p.spectator && p.playerId !== me).map((p) => p.nickname);
}

/** (17/11) Modo turnos: é a minha vez? (modo simultâneo: sempre true no planejamento) */
export function useMyTurn(): { turns: boolean; mine: boolean; current: RoomSummary['players'][number] | null } {
  const room = useOnline((s) => s.room);
  const me = useOnline((s) => s.playerId);
  const turns = !!room && room.settings.turnMode !== 'simultaneous';
  const cur = room?.turn?.playerId ? (room.players.find((p) => p.playerId === room.turn!.playerId) ?? null) : null;
  return { turns, mine: !turns || (room?.phase === 'planning' && room.turn?.playerId === me), current: cur };
}
