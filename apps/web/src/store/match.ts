/**
 * Partida ao vivo (Match Day). Vive em memória (módulo + Zustand) para sobreviver à troca de página;
 * não é persistida: recarregar no meio do jogo volta ao pré-jogo do mesmo dia.
 *
 * A engine muta `sim.state` no lugar; a UI re-renderiza pelo contador `version`.
 */
import { create } from 'zustand';
import { isFinalFixture, MatchSimulation, type MatchCommand, type MatchConfig, type MatchEvent, type MatchResult, type Side } from '@cosmicfut/engine';
import { useSoloSeason, type DaySummary } from './season';

export type MatchPhase = 'idle' | 'live' | 'post' | 'done';
export type Speed = 1 | 2 | 4;
export const BASE_INTERVAL_MS = 400;

export interface FeedItem extends MatchEvent {
  key: number;
}

export interface MatchToast {
  id: number;
  kind: 'goal' | 'error' | 'info' | 'injury' | 'red';
  title: string;
  text?: string;
  side?: Side;
}

interface MatchStore {
  phase: MatchPhase;
  fixtureId: string | null;
  sim: MatchSimulation | null;
  config: MatchConfig | null;
  humanSide: Side;
  running: boolean;
  speed: Speed;
  /** (19/11) final de competição: velocidade travada no Normal (1x), para ter suspense */
  isFinal: boolean;
  version: number;
  feed: FeedItem[];
  /** último lote de eventos (efeitos: som, flash, toasts) */
  batch: { key: number; events: MatchEvent[]; silent: boolean } | null;
  panel: null | 'changes' | 'halftime';
  halftimeSeen: boolean;
  toasts: MatchToast[];
  result: MatchResult | null;
  summary: DaySummary | null;
  finishing: boolean;

  start: (config: MatchConfig, fixtureId: string, humanSide: Side) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (s: Speed) => void;
  skipToEnd: () => void;
  openPanel: (p: 'changes' | 'halftime') => void;
  closePanel: () => void;
  /** (Atualização 38) fecha o painel e retoma o relógio se ele rodava quando o painel abriu (ou no intervalo) */
  closePanelAndResume: () => void;
  /** (Atualização 38) o relógio rodava quando o painel de mudanças abriu */
  resumeOnClose: boolean;
  command: (cmd: MatchCommand) => string | null;
  toast: (t: Omit<MatchToast, 'id'>) => void;
  dismissToast: (id: number) => void;
  /** pós-jogo → advanceDay com o resultado e resumo da rodada */
  finishDay: () => Promise<void>;
  reset: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let timerMs = 0;
/** intervalo entre cobranças na disputa de pênaltis (1x) */
/** (19/11) pênaltis sempre devagar, para ter emoção — não acelera com a velocidade escolhida */
const PENALTY_INTERVAL_MS = 1500;
let feedKey = 0;
let toastId = 0;
const FEED_CAP = 400;

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const useMatch = create<MatchStore>()((set, get) => {
  /** Avança um minuto; devolve false quando deve parar (intervalo/fim). */
  const step = (silent = false): boolean => {
    const { sim, halftimeSeen } = get();
    if (!sim || sim.isFinished()) return false;
    // (Atualização 38) painel de mudanças/intervalo aberto = partida PAUSADA: nenhum minuto corre por trás dele
    if (!silent && get().panel) {
      stopTimer();
      if (get().running) set({ running: false });
      return false;
    }
    const events = sim.tick();
    const items = events.map((e) => ({ ...e, key: ++feedKey }));
    const phase = sim.state.phase;
    const patch: Partial<MatchStore> = {
      version: get().version + 1,
      feed: items.length ? [...get().feed, ...items].slice(-FEED_CAP) : get().feed,
      batch: events.length ? { key: feedKey, events, silent } : get().batch,
    };
    if (sim.isFinished()) {
      stopTimer();
      set({ ...patch, running: false, phase: 'post', result: sim.result(), panel: null });
      return false;
    }
    if (phase === 'half-time' && !halftimeSeen) {
      stopTimer();
      set({ ...patch, running: false, halftimeSeen: true, panel: 'halftime', resumeOnClose: true });
      return false;
    }
    set(patch);
    // disputa de pênaltis: uma cobrança por tick, num ritmo mais lento (suspense)
    if (!silent && timer && phase === 'penalties' && timerMs !== intervalFor(phase, get().speed)) startTimer();
    return true;
  };

  const intervalFor = (phase: string | undefined, speed: Speed) => (phase === 'penalties' ? PENALTY_INTERVAL_MS : BASE_INTERVAL_MS / (get().isFinal ? 1 : speed));

  const startTimer = () => {
    stopTimer();
    const ms = intervalFor(get().sim?.state.phase, get().speed);
    timerMs = ms;
    timer = setInterval(() => {
      if (!step()) stopTimer();
    }, ms);
  };

  return {
    phase: 'idle',
    fixtureId: null,
    sim: null,
    config: null,
    humanSide: 'home',
    running: false,
    speed: 1,
    isFinal: false,
    version: 0,
    feed: [],
    batch: null,
    panel: null,
    halftimeSeen: false,
    toasts: [],
    result: null,
    summary: null,
    finishing: false,
    resumeOnClose: false,

    start: (config, fixtureId, humanSide) => {
      stopTimer();
      const sim = new MatchSimulation(config);
      const season = useSoloSeason.getState().save?.season;
      const fx = season?.competitions.flatMap((c) => c.fixtures).find((f) => f.id === fixtureId);
      const isFinal = !!season && !!fx && isFinalFixture(season, fx);
      set({
        phase: 'live',
        fixtureId,
        isFinal,
        sim,
        config,
        humanSide,
        running: false,
        version: 0,
        feed: [],
        batch: null,
        panel: null,
        halftimeSeen: false,
        toasts: [],
        result: null,
        summary: null,
      });
      get().play();
    },
    play: () => {
      const { sim, phase } = get();
      if (!sim || phase !== 'live' || sim.isFinished()) return;
      set({ running: true, panel: null });
      // primeiro minuto imediato (resposta instantânea ao clique)
      if (step()) startTimer();
    },
    pause: () => {
      stopTimer();
      set({ running: false });
    },
    setSpeed: (speed) => {
      if (get().isFinal) return;
      set({ speed });
      if (get().running) startTimer();
    },
    skipToEnd: () => {
      stopTimer();
      set({ running: false, panel: null, halftimeSeen: true });
      const { sim } = get();
      if (!sim) return;
      let guard = 0;
      while (!sim.isFinished() && guard++ < 1000) {
        // o intervalo não pausa no "pular para o fim"
        step(true);
      }
    },
    openPanel: (panel) => {
      // (Atualização 38) pausa IMEDIATA ao abrir Substituir/Táticas: o timer para antes de qualquer outro minuto
      const wasRunning = get().running || !!timer;
      stopTimer();
      set({ running: false, panel, resumeOnClose: get().panel ? get().resumeOnClose : wasRunning || panel === 'halftime' });
    },
    closePanel: () => set({ panel: null }),
    closePanelAndResume: () => {
      const resume = get().resumeOnClose;
      set({ panel: null, resumeOnClose: false });
      if (resume) get().play();
    },
    command: (cmd) => {
      const { sim } = get();
      if (!sim) return 'Partida não iniciada.';
      const err = sim.apply(cmd);
      // eventos de comando (substituição, mudança tática) saem no próximo tick; força re-render
      set({ version: get().version + 1 });
      if (err) get().toast({ kind: 'error', title: 'Não foi possível', text: err });
      return err;
    },
    toast: (t) => {
      const id = ++toastId;
      set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
      setTimeout(() => get().dismissToast(id), t.kind === 'goal' ? 2600 : 3800);
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    finishDay: async () => {
      const { result, fixtureId, finishing } = get();
      if (!result || !fixtureId || finishing) return;
      set({ finishing: true });
      try {
        const summary = await useSoloSeason.getState().finishMatchDay(fixtureId, result);
        set({ phase: 'done', summary });
      } finally {
        set({ finishing: false });
      }
    },
    reset: () => {
      stopTimer();
      set({
        phase: 'idle',
        fixtureId: null,
        isFinal: false,
        sim: null,
        config: null,
        running: false,
        version: 0,
        feed: [],
        batch: null,
        panel: null,
        halftimeSeen: false,
        toasts: [],
        result: null,
        summary: null,
        finishing: false,
      });
    },
  };
});
