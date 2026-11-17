/**
 * Estado da temporada.
 *
 * SOLO = CARREIRA (Fase 1): `world` (WorldState) + `state` (SeasonState) vivem num Web Worker
 * (career/career.worker.ts) que roda `advanceDay` com `inPlace`, para em jogo humano / notícia
 * importante / fim de temporada, faz a virada (`nextSeason`) e grava os dois JUNTOS no IndexedDB
 * (slot ativo: chave `career:<slotId>`, save v2; índice em `careers:index`, ver career/slots.ts).
 * Este store guarda a última cópia recebida do worker para a UI.
 *  - O store leve (`useGame`, localStorage por slot) guarda clube, tática e escalação.
 *  - Elencos efetivos: data/squads (`careerSquads(state, worldSquads(world, base))`).
 *  - Saves antigos (v1, só a liga — chave `save:current`) recebem um aviso e podem ser descartados.
 *
 * ONLINE: a SeasonState vem do servidor (`useOnlineSeason`, somente leitura).
 */
import { create } from 'zustand';
import {
  DEFAULT_TACTIC, normalizePresets, autoTurnoverDue, seasonOver, type HotseatManager, type HotseatState, type CoachActionResult, type Fixture, type MatchResult, type MarketResult, type SeasonState, type SeasonSummary,
  type SkipReason, type SkipStops, type WorldState,
} from '@cosmicfut/engine';
import { loadClub } from '@/data/source';
import { ensureBundles, setCareerBase, syncSeason } from '@/data/squads';
import { ensureClubIndex } from '@/data/clubIndex';
import { careerBase, loadMarketSquads } from '@/career/data';
import { careerCall, onCareerSaved } from '@/career/client';
import type { BalancePoint as WorkerBalancePoint, CoachAction, CoachPatch, RenewInput, SnapshotPayload, StopReason } from '@/career/protocol';
import { type SeasonBuildProgress, SEASON_YEAR } from '@/season/setup';
import { fixtureToday, humanIdOf } from '@/season/view';
import { newSlotId, removeSlotPrefs, useSoloGame } from './game';
import { isOnline, useIsOnline, useMode } from './mode';

export type BalancePoint = WorkerBalancePoint;

export interface SaveGame {
  v: number;
  /** slot de carreira (solo) */
  slotId?: string;
  clubId: string;
  /** identifica a carreira (useGame.startedAt); escolher o clube de novo começa outra */
  startedAt: string | null;
  season: SeasonState;
  /** saldo do clube humano dia a dia (para o gráfico de Finanças) */
  history: BalancePoint[];
  savedAt: string;
  /** (carreira) mundo persistente: divisões, histórico de campeões, jogadores evoluídos */
  world?: WorldState;
  /** (carreira) resumo da última virada de temporada */
  summary?: SeasonSummary | null;
}

export interface DaySummary {
  date: string;
  played: { fixture: Fixture; result: MatchResult }[];
}

export interface AdvanceProgress {
  day: number;
  total: number;
  date: string;
  /** simulação até o fim (dev) */
  toEnd?: boolean;
  /** (Calendário) salto no tempo em andamento (até `until`) */
  skip?: { until: string };
}

/** (Calendário) Resultado do último salto no tempo (o modal mostra por que parou). */
export interface SkipOutcome {
  reason: SkipReason;
  note?: string;
  from: string;
  until: string;
  /** data em que parou */
  date: string;
  days: number;
  games: number;
  turnovers: number;
  ms: number;
  simMs: number;
  bytes: number;
  stops: Partial<SkipStops>;
}

export interface SeasonMetrics {
  saveBytes: number;
  lastContinueMs: number;
  lastContinueDays: number;
  lastContinueGames?: number;
  /** só os advanceDay no worker */
  lastSimMs?: number;
  /** gravação no IndexedDB (worker) */
  lastSaveMs?: number;
  /** boot / criação da carreira / virada */
  bootMs?: number;
  createMs?: number;
  rolloverMs?: number;
}

export interface StopNotice {
  reason: StopReason;
  note?: string;
  at: number;
  /** (Calendário) motivo da parada do salto no tempo (reason 'skip') */
  skip?: SkipReason;
}

/** 'legacy-career' (Etapa 1): o slot tem uma carreira de versão anterior (não migra; iniciar nova carreira). */
type Status = 'idle' | 'loading' | 'ready' | 'unsupported' | 'legacy' | 'legacy-career' | 'error';
export type ContinueResult = 'matchday' | 'advanced' | 'idle' | 'season-over' | 'fired' | 'job';

/** (Fase 3) Tela dramática "Você foi demitido!" (até o jogador dispensar). */
export interface FiredNotice {
  clubId: string;
  clubName: string;
  date: string;
  body: string;
  subject: string;
}

interface SeasonStore {
  status: Status;
  error: string | null;
  bootProgress: SeasonBuildProgress | null;
  save: SaveGame | null;
  advancing: AdvanceProgress | null;
  /** último dia de jogo do humano processado (resumo da rodada no pós-jogo) */
  lastHumanDay: DaySummary | null;
  /** tamanho aproximado do save (bytes, JSON) e tempos */
  metrics: SeasonMetrics | null;
  /** por que o último Continuar parou (notícia importante, oferta…) */
  lastStop: StopNotice | null;
  /** virada em andamento */
  rolling: boolean;
  /** último salvamento confirmado do slot ativo (ISO) */
  lastSavedAt: string | null;
  /** "Salvar agora" em andamento */
  saving: boolean;
  /** falha ao gravar (quota → sugerir exportar/excluir) */
  saveError: { quota: boolean; message: string } | null;
  /** (Fase 3) técnico demitido (tela dramática) */
  fired: FiredNotice | null;
  /** (Fase 3) troca de clube em andamento (carregando o elenco do novo clube) */
  switching: boolean;

  boot: (clubId: string) => Promise<void>;
  /** (Fase 3) Ação da carreira do técnico (candidatura, interesse, proposta, demissão...). Troca de clube incluída. */
  coachAction: (action: CoachAction) => Promise<CoachActionResult>;
  /** (Fase 3) Desempregado: avança dias até chegar proposta/resposta (com virada automática). */
  continueJobless: () => Promise<ContinueResult>;
  dismissFired: () => void;
  /** Grava o slot ativo agora. */
  saveNow: () => Promise<boolean>;
  dismissSaveError: () => void;
  /** Solta a carreira em memória (troca de slot); o slot continua salvo. */
  unload: () => Promise<void>;
  /** Avança dia a dia até o próximo jogo do clube humano (ou notícia importante / fim de temporada). */
  continueToMatch: () => Promise<ContinueResult>;
  /** (dev) Simula até o fim da temporada, inclusive os jogos do humano (quickSimulate). */
  simulateToEnd: () => Promise<void>;
  /** Processa o dia de jogo do humano com o resultado da partida ao vivo. */
  finishMatchDay: (fixtureId: string, result: MatchResult) => Promise<DaySummary | null>;
  /** Virada: renova os escolhidos (ids, ou mapa id → { wage, years }) e começa a temporada seguinte. */
  rollover: (renew: RenewInput) => Promise<SeasonSummary | null>;
  /** Save antigo: descarta e começa uma carreira nova com o mesmo clube. */
  startFresh: () => Promise<void>;
  /** Exclui o slot ativo (clube sem competição) e limpa a memória. */
  discard: () => Promise<void>;
  dismissStop: () => void;
  /** Aplica uma ação do mercado (makeOffer, proposeContract…) sobre a temporada atual e salva. */
  market: (action: (s: SeasonState) => MarketResult | SeasonState) => MarketResult | null;
  /** (Calendário) último salto no tempo (resultado) */
  lastSkip: SkipOutcome | null;
  /** (Calendário) Simula até `until` com o assistente (só carreira solo). */
  skipTo: (until: string, stops: Partial<SkipStops>) => Promise<SkipOutcome | null>;
  /** (Calendário) Cancela o salto em andamento (para no fim do dia atual; o estado é salvo). */
  cancelSkip: () => void;
  dismissSkip: () => void;
}

let bootToken = 0;
/** clube|carreira do boot em andamento (evita boot duplicado) */
let bootClub = '';

function humanSetup() {
  const { tactic, lineup, presets } = useSoloGame.getState();
  return { tactic: { ...tactic }, lineup, presets };
}

function seedOf(clubId: string, startedAt: string | null) {
  return `${clubId}:${startedAt ?? 'cf'}`;
}

onCareerSaved((ev) => {
  const st = useSoloSeason.getState();
  // evento de outro slot (gravação pendente do slot anterior durante a troca): ignora na UI
  if (ev.slotId !== st.save?.slotId && ev.slotId !== useSoloGame.getState().slotId) return;
  if (ev.t === 'saveError') {
    useSoloSeason.setState({ saveError: { quota: ev.quota, message: ev.message } });
    return;
  }
  const m = st.metrics;
  useSoloSeason.setState({
    lastSavedAt: ev.meta.savedAt,
    saveError: null,
    metrics: { ...(m ?? { saveBytes: 0, lastContinueMs: 0, lastContinueDays: 0 }), saveBytes: ev.bytes, lastSaveMs: ev.ms },
  });
});

function fromSnapshot(p: SnapshotPayload, slotId: string, clubId: string, startedAt: string | null): SaveGame {
  return { v: 3, slotId, clubId, startedAt, season: p.state, world: p.world, history: p.history, summary: p.summary, savedAt: new Date().toISOString() };
}

/** (Fase 3) Aplica o pedaço da carreira do técnico que veio do worker sobre o mundo da UI. */
function patchWorld(w: WorldState | undefined, patch: CoachPatch | undefined): WorldState | undefined {
  if (!w || !patch) return w;
  return { ...w, coach: patch.coach ?? undefined, humanClubIds: patch.humanClubIds };
}

/** (Fase 3) O técnico estava empregado e deixou de estar por demissão: monta a tela dramática a partir do e-mail. */
function firedFrom(prev: WorldState | undefined, next: WorldState | undefined): FiredNotice | null {
  const was = prev?.coach?.coach.clubId;
  const now = next?.coach?.coach.clubId;
  if (!was || now) return null;
  const msg = next!.coach!.inbox.find((m) => m.kind === 'fired' || m.kind === 'contract');
  if (!msg || msg.kind !== 'fired') return null;
  const item = [...next!.coach!.coach.history].reverse().find((h) => h.clubId === was);
  return { clubId: was, clubName: item?.name ?? was, date: msg.date, body: msg.body, subject: msg.subject };
}

/** (Calendário) Texto da parada do salto no tempo. */
export function skipNote(o: Pick<SkipOutcome, 'reason' | 'note' | 'days' | 'date'>): string {
  const d = `${o.date.slice(8, 10)}/${o.date.slice(5, 7)}/${o.date.slice(0, 4)}`;
  switch (o.reason) {
    case 'done': return `Salto concluído: ${o.days} dia(s) simulados, chegamos a ${d}.`;
    case 'cancelled': return `Salto cancelado em ${d} (${o.days} dia(s) simulados). O jogo foi salvo.`;
    case 'fired': return `Salto interrompido em ${d}: você foi demitido.`;
    case 'job': return `Salto interrompido em ${d}: ${o.note ?? 'nova proposta de emprego.'}`;
    case 'offer': return `Salto interrompido em ${d}: ${o.note ?? 'proposta por um jogador.'}`;
    case 'season-end': return `Salto interrompido em ${d}: fim de temporada. Faça as renovações e retome o salto pelo calendário.`;
    case 'limit': return `Salto interrompido em ${d}: limite de dias atingido.`;
  }
}

/** Clube humano atual da temporada ('' = técnico desempregado). */
const currentHuman = (s: SeasonState) => s.humanClubIds[0] ?? '';

const EMPTY_SESSION = {
  status: 'idle' as Status,
  save: null,
  error: null,
  bootProgress: null,
  advancing: null,
  lastHumanDay: null,
  metrics: null,
  lastStop: null,
  rolling: false,
  lastSavedAt: null,
  saving: false,
  saveError: null,
  fired: null,
  switching: false,
  lastSkip: null,
} satisfies Partial<SeasonStore>;

/** Carreira SOLO (worker + IndexedDB). */
export const useSoloSeason = create<SeasonStore>()((set, get) => ({
  status: 'idle',
  error: null,
  bootProgress: null,
  save: null,
  advancing: null,
  lastHumanDay: null,
  metrics: null,
  lastStop: null,
  rolling: false,
  lastSavedAt: null,
  saving: false,
  saveError: null,
  fired: null,
  switching: false,
  lastSkip: null,

  skipTo: async (until, stops) => {
    const save = get().save;
    if (!save || get().advancing || get().rolling || isOnline()) return null;
    const from = save.season.date;
    if (until <= from) return null;
    set({ advancing: { day: 0, total: 1, date: from, skip: { until } }, lastStop: null, lastSkip: null });
    try {
      const r = await careerCall<'skipped'>({ t: 'skip', setup: humanSetup(), until, stops }, (p) =>
        set({ advancing: { day: p.day, total: p.total, date: p.date, skip: { until } } }),
      );
      const cur = get().save;
      if (!cur) return null;
      const next = fromSnapshot(r.payload, cur.slotId ?? '', cur.clubId, cur.startedAt);
      const outcome: SkipOutcome = {
        reason: r.reason, note: r.note, from, until, date: r.payload.state.date, days: r.days, games: r.games, turnovers: r.turnovers,
        ms: r.ms, simMs: r.simMs, bytes: r.bytes, stops,
      };
      const m = get().metrics;
      set({
        save: next,
        advancing: null,
        lastHumanDay: null,
        lastSkip: outcome,
        fired: firedFrom(cur.world, next.world) ?? get().fired,
        lastStop: { reason: 'skip', skip: r.reason, note: skipNote(outcome), at: Date.now() },
        metrics: { ...(m ?? { saveBytes: 0 }), lastContinueMs: r.ms, lastContinueDays: r.days, lastContinueGames: r.games, lastSimMs: r.simMs, saveBytes: r.bytes },
      });
      if (import.meta.env.DEV) console.info(`[carreira] Salto: ${r.days} dia(s), ${r.games} jogos, ${r.turnovers} virada(s), sim ${r.simMs.toFixed(0)} ms, total ${r.ms.toFixed(0)} ms → ${r.reason}`);
      return outcome;
    } catch (e) {
      set({ advancing: null, lastStop: { reason: 'idle', note: e instanceof Error ? e.message : String(e), at: Date.now() } });
      return null;
    }
  },

  cancelSkip: () => {
    if (!get().advancing?.skip) return;
    void careerCall<'ok'>({ t: 'skipCancel' }).catch(() => undefined);
  },

  dismissSkip: () => set({ lastSkip: null }),

  boot: async (requestedClubId) => {
    let game = useSoloGame.getState();
    // carreira sem slot (não deveria ocorrer depois da migração): ganha um
    if (!game.slotId) {
      useSoloGame.setState({ slotId: newSlotId() });
      game = useSoloGame.getState();
    }
    const slotId = game.slotId!;
    const cur = get().save;
    if (cur && cur.slotId === slotId && cur.clubId === requestedClubId && get().status === 'ready') return;
    if (get().status === 'loading' && cur === null && bootClub === slotId) return;
    bootClub = slotId;
    const token = ++bootToken;
    const t0 = performance.now();
    set({ ...EMPTY_SESSION, status: 'loading', bootProgress: { stage: 'dados', done: 0, total: 3 }, metrics: get().metrics });
    const alive = () => token === bootToken;
    try {
      // a identidade do slot (índice no IndexedDB) manda: corrige o estado leve se divergir
      const peek = await careerCall<'slot'>({ t: 'slots:get', slotId });
      if (!alive()) return;
      let clubId = requestedClubId;
      if (peek.meta && peek.meta.club.id !== clubId) {
        clubId = peek.meta.club.id;
        useSoloGame.getState().openSlot(slotId, { clubId, clubPreview: peek.meta.club, startedAt: peek.meta.createdAt });
      }
      const startedAt = useSoloGame.getState().startedAt;
      if (peek.meta) set({ lastSavedAt: peek.meta.savedAt });
      // índice de clubes (nomes/escudos de ≈690 clubes) + bundle completo do humano
      const [{ data: human, origin }] = await Promise.all([loadClub(clubId), ensureClubIndex(), ensureBundles([clubId])]);
      if (!alive()) return;
      if (origin !== 'real') throw new Error('dados reais indisponíveis (public/data): a carreira precisa do pipeline gerado');
      set({ bootProgress: { stage: 'elencos', done: 1, total: 3 } });
      // elencos base: players-market (aqui) + o mesmo no worker
      const [market] = await Promise.all([
        loadMarketSquads(),
        careerCall<'ok'>({ t: 'init', clubId, humanPlayers: human.players }),
      ]);
      if (!alive()) return;
      setCareerBase(careerBase(market, clubId, human.players));
      const loaded = await careerCall<'loaded'>({ t: 'load', slotId, clubId });
      if (!alive()) return;
      let save: SaveGame;
      let createMs: number | undefined;
      if (loaded.save) {
        save = fromSnapshot(loaded.save, slotId, clubId, startedAt);
      } else if (loaded.legacyCareer) {
        set({ status: 'legacy-career', bootProgress: null });
        return;
      } else if (loaded.legacy) {
        set({ status: 'legacy', bootProgress: null });
        return;
      } else {
        set({ bootProgress: { stage: 'calendário', done: 2, total: 3 } });
        const preview = useSoloGame.getState().clubPreview;
        const club = preview && preview.id === clubId
          ? { id: clubId, name: preview.name, colors: preview.colors, crestMini: preview.crestMini }
          : { id: clubId, name: human.club.name, colors: human.club.colors, crestMini: human.club.crestMini };
        // (17/11) hot-seat: técnicos locais escolhidos na Escolha de Clube (o 1º é o deste slot)
        const hot = pendingHotseat && pendingHotseat[0]?.clubId === clubId && pendingHotseat.length > 1 ? pendingHotseat : undefined;
        pendingHotseat = null;
        const r = await careerCall<'snapshot'>({
          t: 'create', slotId, clubId, name: `${club.name} ${SEASON_YEAR}${hot ? ` · ${hot.length} técnicos` : ''}`, club, startedAt, season: SEASON_YEAR, seed: seedOf(clubId, startedAt),
          ...(hot ? { hotseat: hot } : {}),
        });
        if (!alive()) return;
        createMs = r.ms;
        save = fromSnapshot(r.payload, slotId, clubId, startedAt);
      }
      // clube sem competição na carreira (país sem divisões): não jogável nesta versão — o slot é removido
      // (Fase 3: um técnico desempregado mantém o último clube como referência do slot — não é "sem competição")
      // (17/11) hot-seat com regiões misturadas: um europeu começa em 01/01 sem competição (pré-temporada até julho)
      if (!save.world?.coach && !save.world?.hotseat && !save.season.competitions.some((c) => c.clubIds.includes(clubId))) {
        await careerCall<'slots'>({ t: 'slots:delete', slotId });
        set({ status: 'unsupported', error: `${human.club.name} não disputa nenhuma competição na carreira desta versão`, bootProgress: null });
        return;
      }
      set({
        status: 'ready',
        save,
        bootProgress: null,
        // save da Fase 1 migrado: aviso único (o worker já gravou a versão migrada)
        ...(loaded.migrated
          ? { lastStop: { reason: 'migrated' as const, note: 'Competições continentais começam na próxima temporada.', at: Date.now() } }
          : loaded.coachCreated
            ? { lastStop: { reason: 'coach' as const, note: 'Carreira do técnico ativada: estabilidade, metas da diretoria e Central de Empregos.', at: Date.now() } }
            : loaded.econMigrated
              ? { lastStop: { reason: 'idle' as const, note: 'Economia atualizada: valores em euros, TV mensal, prêmios por fase, teto da folha e Moral da Torcida (veja Finanças).', at: Date.now() } }
              : {}),
        metrics: { ...(get().metrics ?? { saveBytes: 0 }), lastContinueMs: 0, lastContinueDays: 0, bootMs: performance.now() - t0, createMs },
      });
      applyHotseatActive(save.season, save.world?.hotseat, clubId);
    } catch (e) {
      if (!alive()) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), bootProgress: null });
    }
  },

  continueToMatch: async () => {
    const save = get().save;
    if (!save || get().advancing || get().rolling) return 'idle';
    const human = currentHuman(save.season);
    // (Fase 3) desempregado: procura emprego (avança até proposta/resposta)
    if (!human && save.world?.coach) return runContinue('job');
    if (seasonOver(save.season)) return 'season-over';
    // (Etapa 1) virada regional sem o humano pendente: o worker faz antes de qualquer jogo
    if (autoTurnoverDue(save.season)) return runContinue('match');
    if (fixtureToday(save.season, human)) return 'matchday';
    return runContinue('match');
  },

  continueJobless: async () => {
    const save = get().save;
    if (!save || get().advancing || get().rolling) return 'idle';
    return runContinue('job');
  },

  coachAction: async (action) => {
    const save = get().save;
    if (!save || get().advancing || get().rolling) return { ok: false, error: 'Aguarde a simulação terminar.' };
    const r = await careerCall<'coachDone'>({ t: 'coach', action });
    const cur = get().save;
    if (!cur) return r.result;
    const world = patchWorld(cur.world, r.coach);
    set({ save: { ...cur, season: r.state, world, savedAt: new Date().toISOString() }, ...(r.meta ? { lastSavedAt: r.meta.savedAt } : {}) });
    if (r.result.clubChanged) await switchClub(r.result.clubChanged);
    return r.result;
  },

  dismissFired: () => set({ fired: null }),

  simulateToEnd: async () => {
    const save = get().save;
    if (!save || get().advancing || get().rolling || seasonOver(save.season)) return;
    await runContinue('end');
  },

  finishMatchDay: async (fixtureId, result) => {
    const save = get().save;
    if (!save) return null;
    const date = save.season.date;
    const r = await careerCall<'advanced'>({ t: 'finishDay', setup: humanSetup(), fixtureId, result });
    const cur = get().save;
    if (!cur) return null;
    const world = patchWorld(cur.world, r.coach);
    const next: SaveGame = { ...cur, season: r.state, world, history: r.history, savedAt: new Date().toISOString() };
    const summary: DaySummary = { date, played: r.played ?? [] };
    // (Fase 3) a demissão aparece depois do resumo da rodada (a tela dramática fica guardada no store)
    set({ save: next, lastHumanDay: summary, fired: firedFrom(cur.world, world) ?? get().fired });
    return summary;
  },

  rollover: async (renew) => {
    const save = get().save;
    if (!save || get().rolling || !seasonOver(save.season)) return null;
    set({ rolling: true });
    try {
      const r = await careerCall<'snapshot'>({ t: 'rollover', renew });
      const next = fromSnapshot(r.payload, save.slotId ?? '', save.clubId, save.startedAt);
      set({
        save: next, lastHumanDay: null, lastStop: null, fired: firedFrom(save.world, next.world) ?? get().fired,
        metrics: { ...(get().metrics ?? { saveBytes: 0, lastContinueMs: 0, lastContinueDays: 0 }), rolloverMs: r.ms },
      });
      return next.summary ?? null;
    } finally {
      set({ rolling: false });
    }
  },

  startFresh: async () => {
    const { clubId, slotId } = useSoloGame.getState();
    await careerCall<'ok'>({ t: 'discard', slotId, legacy: true });
    bootClub = '';
    set({ status: 'idle', save: null });
    if (clubId) await get().boot(clubId);
  },

  saveNow: async () => {
    if (!get().save || get().saving) return false;
    set({ saving: true });
    try {
      await careerCall<'ok'>({ t: 'save' });
      return true;
    } catch (e) {
      set({ saveError: { quota: /espaço|quota/i.test(String(e)), message: e instanceof Error ? e.message : String(e) } });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  dismissSaveError: () => set({ saveError: null }),

  unload: async () => {
    bootToken++;
    bootClub = '';
    set({ ...EMPTY_SESSION });
    // limpa as visões derivadas da carreira anterior (elencos efetivos, índice do mercado)
    setCareerBase(null);
    await careerCall<'ok'>({ t: 'unload' }).catch(() => undefined);
  },

  market: (action) => {
    const save = get().save;
    if (!save || get().advancing || get().rolling) return null;
    const out = action(save.season);
    const r: MarketResult = 'competitions' in out ? { state: out } : out;
    if (r.state === save.season) return r;
    const bal = r.state.clubs[currentHuman(r.state) || save.clubId]?.balance ?? 0;
    const history = save.history[save.history.length - 1]?.balance === bal ? save.history : [...save.history, { date: r.state.date, balance: bal }];
    const next: SaveGame = { ...save, season: r.state, history, savedAt: new Date().toISOString() };
    set({ save: next });
    // o worker é o dono do estado: recebe a cópia (e grava com debounce)
    void careerCall<'ok'>({ t: 'setState', state: r.state }).catch((e) => console.warn('[carreira] setState', e));
    return r;
  },

  dismissStop: () => set({ lastStop: null }),

  discard: async () => {
    bootToken++;
    bootClub = '';
    const slotId = get().save?.slotId ?? useSoloGame.getState().slotId;
    set({ ...EMPTY_SESSION });
    setCareerBase(null);
    if (slotId) {
      await careerCall<'slots'>({ t: 'slots:delete', slotId }).catch(() => undefined);
      removeSlotPrefs(slotId);
    }
  },
}));

/**
 * (Fase 3) O técnico assumiu outro clube: elenco completo do novo clube no worker e no thread principal (mesma base),
 * estado leve do slot (tática/escalação/observados) zerado e tema nas cores do novo clube.
 */
async function switchClub(clubId: string): Promise<void> {
  useSoloSeason.setState({ switching: true });
  try {
    const [{ data: human }] = await Promise.all([loadClub(clubId), ensureBundles([clubId]), ensureClubIndex()]);
    const [market] = await Promise.all([loadMarketSquads(), careerCall<'ok'>({ t: 'init', clubId, humanPlayers: human.players })]);
    setCareerBase(careerBase(market, clubId, human.players));
    const cur = useSoloSeason.getState().save;
    // primeiro o save (o boot do AppShell vê o mesmo clube e não recarrega), depois o estado leve
    if (cur) useSoloSeason.setState({ save: { ...cur, clubId, history: [] }, lastStop: null });
    useSoloGame.setState({
      clubId,
      clubPreview: { id: clubId, name: human.club.name, colors: human.club.colors, crestMini: human.club.crestMini },
      tactic: { ...DEFAULT_TACTIC },
      lineup: null,
      shortlist: [],
    });
  } finally {
    useSoloSeason.setState({ switching: false });
  }
}

/* ───────── (17/11) hot-seat: vários técnicos no mesmo computador ───────── */

let pendingHotseat: HotseatManager[] | null = null;

/** Técnicos da próxima carreira criada (Escolha de Clube); o 1º é o clube do slot. */
export function setPendingHotseat(managers: HotseatManager[] | null): void {
  pendingHotseat = managers && managers.length > 1 ? managers.map((m) => ({ ...m })) : null;
}

/** As telas passam a mostrar o técnico ativo: clube (activeClubId), tática e escalação dele. */
function applyHotseatActive(state: SeasonState, hs: HotseatState | undefined, slotClubId: string): void {
  if (!hs) {
    if (useSoloGame.getState().activeClubId) useSoloGame.setState({ activeClubId: null });
    return;
  }
  const id = hs.managers[hs.active]?.clubId ?? slotClubId;
  const club = state.clubs[id];
  const g = useSoloGame.getState();
  const wanted = id === slotClubId ? null : id;
  if ((g.activeClubId ?? null) === wanted && state.humanClubIds[0] === id && g.lineup === (club?.lineup ?? null)) return;
  useSoloGame.setState({ activeClubId: wanted, tactic: club?.tactic ? { ...club.tactic } : { ...DEFAULT_TACTIC }, lineup: club?.lineup ?? null,
    // (Táticas) vagas do técnico ativo; save antigo sem vagas no clube do slot ⇒ mantém as do localStorage
    presets: club?.tacticPresets ? normalizePresets(club.tacticPresets) : id === slotClubId ? g.presets : normalizePresets(null) });
}

/**
 * Hot-seat: "Concluir vez" (passa ao próximo técnico; depois do último o controle volta ao 1º e o Continuar avança o
 * dia) ou passar o controle a um técnico. A tática/escalação do técnico que sai fica no clube dele.
 */
export async function hotseatAction(action: 'end-turn' | 'activate', index?: number): Promise<{ roundDone: boolean } | null> {
  const st = useSoloSeason.getState();
  const save = st.save;
  if (!save?.world?.hotseat || st.advancing || st.rolling) return null;
  const before = save.world.hotseat;
  const r = await careerCall<'snapshot'>({ t: 'hotseat', setup: humanSetup(), action, ...(index !== undefined ? { index } : {}) });
  const next = fromSnapshot(r.payload, save.slotId ?? '', save.clubId, save.startedAt);
  useSoloSeason.setState({ save: { ...next, history: save.history } });
  applyHotseatActive(next.season, next.world?.hotseat, save.clubId);
  return { roundDone: action === 'end-turn' && (next.world?.hotseat?.done.length ?? 0) === 0 && before.done.length + 1 >= before.managers.length };
}

async function runContinue(mode: 'match' | 'end' | 'job'): Promise<ContinueResult> {
  const st = useSoloSeason.getState();
  const save = st.save!;
  const t0 = performance.now();
  useSoloSeason.setState({ advancing: { day: 0, total: 1, date: save.season.date, toEnd: mode === 'end' }, lastStop: null });
  try {
    const r = await careerCall<'advanced'>({ t: 'continue', setup: humanSetup(), mode }, (p) =>
      useSoloSeason.setState({ advancing: { day: p.day, total: p.total, date: p.date, toEnd: mode === 'end' } }),
    );
    const cur = useSoloSeason.getState().save;
    if (!cur) return 'idle';
    const t1 = performance.now();
    let world = r.world ?? patchWorld(cur.world, r.coach);
    // (17/11) hot-seat: no dia de jogo o controle pode ter passado a quem joga
    if (r.hotseat && world) {
      world = { ...world, hotseat: r.hotseat, humanClubIds: r.state.humanClubIds.slice() };
      applyHotseatActive(r.state, r.hotseat, cur.clubId);
    }
    const next: SaveGame = {
      ...cur, season: r.state, world, history: r.history, savedAt: new Date().toISOString(),
      ...(r.world ? { summary: r.summary ?? null } : {}),
    };
    const m = useSoloSeason.getState().metrics;
    const stopNote = r.reason === 'news' || r.reason === 'offer' || r.reason === 'job' || (r.reason === 'limit' && mode === 'job');
    useSoloSeason.setState({
      save: next,
      advancing: null,
      fired: firedFrom(cur.world, world) ?? useSoloSeason.getState().fired,
      lastStop: stopNote
        ? { reason: r.reason, note: r.note ?? (r.reason === 'limit' ? 'Nenhuma proposta nos últimos dias. Candidate-se a mais vagas.' : undefined), at: Date.now() }
        : null,
      metrics: {
        ...(m ?? { saveBytes: 0 }),
        lastContinueMs: t1 - t0,
        lastContinueDays: r.days,
        lastContinueGames: r.games,
        lastSimMs: r.simMs,
      },
    });
    if (import.meta.env.DEV) console.info(`[carreira] Continuar: ${r.days} dia(s), ${r.games} jogos, sim ${r.simMs.toFixed(0)} ms, total ${(t1 - t0).toFixed(0)} ms → ${r.reason}`);
    if (r.reason === 'matchday') return 'matchday';
    if (r.reason === 'season-over') return 'season-over';
    if (r.reason === 'fired') return 'fired';
    if (r.reason === 'job') return 'job';
    return 'advanced';
  } catch (e) {
    useSoloSeason.setState({ advancing: null, lastStop: { reason: 'idle', note: e instanceof Error ? e.message : String(e), at: Date.now() } });
    return 'idle';
  }
}

/**
 * Temporada do modo ONLINE: a SeasonState vem do servidor (`season:snapshot`, ver store/online.ts),
 * que a coloca aqui já como "visão" do jogador (o clube dele é `humanClubIds[0]`). Somente leitura:
 * avançar dias, partidas e mercado são do servidor.
 */
export const useOnlineSeason = create<SeasonStore>()((set) => ({
  status: 'idle',
  error: null,
  bootProgress: null,
  save: null,
  advancing: null,
  lastHumanDay: null,
  metrics: null,
  lastStop: null,
  rolling: false,
  lastSavedAt: null,
  saving: false,
  saveError: null,
  fired: null,
  switching: false,
  coachAction: async () => ({ ok: false, error: 'Carreira do técnico indisponível no modo online.' }),
  continueJobless: async () => 'idle',
  dismissFired: () => undefined,
  boot: async () => undefined,
  saveNow: async () => false,
  dismissSaveError: () => undefined,
  unload: async () => undefined,
  continueToMatch: async () => 'idle',
  simulateToEnd: async () => undefined,
  finishMatchDay: async () => null,
  rollover: async () => null,
  startFresh: async () => undefined,
  market: () => null,
  dismissStop: () => undefined,
  // (Calendário) sem salto no tempo no modo online
  lastSkip: null,
  skipTo: async () => null,
  cancelSkip: () => undefined,
  dismissSkip: () => undefined,
  discard: async () => set({ status: 'idle', save: null, error: null, bootProgress: null, advancing: null, lastHumanDay: null, metrics: null }),
}));

const activeSeason = () => (isOnline() ? useOnlineSeason : useSoloSeason);

function useSeasonProxy<T>(selector: (s: SeasonStore) => T): T {
  const online = useIsOnline();
  const solo = useSoloSeason(selector);
  const net = useOnlineSeason(selector);
  return online ? net : solo;
}

/** Temporada do MODO ATIVO (solo ou online), com a API de um hook Zustand. */
export const useSeason = Object.assign(useSeasonProxy, {
  getState: (): SeasonStore => activeSeason().getState(),
  subscribe: (listener: (s: SeasonStore, prev: SeasonStore) => void) => activeSeason().subscribe(listener),
});

// Mantém a visão de elencos efetivos (data/squads) em sincronia com a temporada do modo ativo.
// Registrado antes de qualquer componente: roda antes dos re-renders do React.
let synced: SeasonState | null | undefined;
let syncedWorld: WorldState | null | undefined;
let syncedOnline: boolean | undefined;
function resync() {
  const online = isOnline();
  const save = (online ? useOnlineSeason : useSoloSeason).getState().save;
  const s = save?.season;
  const w = save?.world ?? null;
  if (s === synced && w === syncedWorld && online === syncedOnline) return;
  synced = s;
  syncedWorld = w;
  syncedOnline = online;
  syncSeason(s, w, online ? 'online' : 'solo');
}
useSoloSeason.subscribe(resync);
useOnlineSeason.subscribe(resync);
useMode.subscribe(resync);

/** SeasonState pronta (use dentro do AppShell, que só renderiza as páginas quando status === 'ready'). */
export function useSeasonState(): SeasonState {
  const s = useSeason((st) => st.save?.season);
  if (!s) throw new Error('Temporada não carregada');
  return s;
}

/** WorldState da carreira do modo ativo (solo: worker; online: último `worldGz` do servidor). */
export function useWorld(): WorldState | null {
  return useSeason((st) => st.save?.world ?? null);
}

/** Temporada encerrada (todas as competições)? Solo e online (no online a virada é do servidor). */
export function useSeasonOver(): boolean {
  const online = useIsOnline();
  const over = useSoloSeason((s) => (s.save?.world ? seasonOver(s.save.season) : false));
  const overOnline = useOnlineSeason((s) => (s.save?.world ? seasonOver(s.save.season) : false));
  return online ? overOnline : over;
}

export { humanIdOf };

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // inspeção no navegador (tempos, tamanho do save)
  (window as unknown as { __cf: unknown }).__cf = { season: useSoloSeason, game: useSoloGame };
}
