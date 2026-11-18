/**
 * "Fonte" da partida para os componentes do Match Day (Live, ChangesPanel, PostMatch).
 *
 * Os componentes visuais leem daqui em vez de `useMatch` direto, para servir aos dois modos:
 *  - SOLO: `SoloMatchView` adapta `useMatch` (MatchSimulation local, tick a tick);
 *  - ONLINE: `OnlineMatchView` (pages/online) adapta `useOnline` (estado vindo dos ticks do servidor).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { MatchCommand, MatchConfig, MatchEvent, MatchResult, MatchState, Side } from '@cosmicfut/engine';
import { useMatch, type FeedItem, type MatchToast } from '@/store/match';

export type Scorer = MatchResult['scorers'][number];

export interface MatchView {
  online: boolean;
  state: MatchState;
  config: MatchConfig;
  humanSide: Side;
  feed: FeedItem[];
  batch: { key: number; events: MatchEvent[]; silent: boolean } | null;
  panel: null | 'changes' | 'halftime';
  toasts: MatchToast[];
  result: MatchResult | null;
  /** quem já entrou em campo pelo lado humano (não pode voltar) */
  getAppeared: () => string[];
  /** gols até agora (resumo do intervalo) */
  getScorers: () => Scorer[];
  openPanel: (p: 'changes' | 'halftime') => void;
  closePanel: () => void;
  /** fecha o painel e volta ao jogo (solo: retoma o relógio; online: match:resume no intervalo) */
  resume: () => void;
  /** aplica um comando; devolve o erro (ou null) */
  command: (cmd: MatchCommand) => Promise<string | null>;
  toast: (t: Omit<MatchToast, 'id'>) => void;
  dismissToast: (id: number) => void;
  /** pós-jogo → próximo passo */
  finish: () => void;
  finishing: boolean;
  /** rótulo do botão de voltar ao jogo no painel (ex.: intervalo) */
  resumeLabel?: string;
  /** aviso extra no rodapé do painel (online: "Aguardando adversário…") */
  panelNote?: ReactNode;
  /** desabilita o botão de voltar (online: já confirmei, aguardando o outro) */
  resumeDisabled?: boolean;
  /** (Atualização 38) selo do painel aberto (padrão 'Partida pausada') */
  pausedLabel?: string;
  /** (Rodada ao vivo) partida de outros técnicos: só assistir (sem Mudanças) */
  readOnly?: boolean;
}

const Ctx = createContext<MatchView | null>(null);

export function MatchViewProvider({ value, children }: { value: MatchView; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMatchView(): MatchView {
  const v = useContext(Ctx);
  if (!v) throw new Error('MatchView ausente: envolva com SoloMatchView/OnlineMatchView');
  return v;
}

/** Adaptador do Match Day solo (useMatch + MatchSimulation local). */
export function SoloMatchView({ children }: { children: ReactNode }) {
  const sim = useMatch((s) => s.sim);
  const config = useMatch((s) => s.config);
  const version = useMatch((s) => s.version);
  const humanSide = useMatch((s) => s.humanSide);
  const feed = useMatch((s) => s.feed);
  const batch = useMatch((s) => s.batch);
  const panel = useMatch((s) => s.panel);
  const toasts = useMatch((s) => s.toasts);
  const result = useMatch((s) => s.result);
  const finishing = useMatch((s) => s.finishing);
  const value = useMemo<MatchView | null>(() => {
    if (!sim || !config) return null;
    const m = useMatch.getState();
    return {
      online: false,
      state: sim.state,
      config,
      humanSide,
      feed,
      batch,
      panel,
      toasts,
      result,
      getAppeared: () => sim.result().appearances?.[humanSide] ?? [],
      getScorers: () => sim.result().scorers,
      openPanel: m.openPanel,
      // (Atualização 38) fechar o painel também retoma o relógio (se ele estava rodando ao abrir, ou no intervalo)
      closePanel: m.closePanelAndResume,
      resume: () => {
        m.closePanel();
        m.play();
      },
      command: async (cmd) => m.command(cmd),
      toast: m.toast,
      dismissToast: m.dismissToast,
      finish: () => void m.finishDay(),
      finishing,
      resumeLabel: panel === 'halftime' ? 'Iniciar 2º Tempo' : 'Voltar ao jogo',
    };
    // version: a engine muta sim.state no lugar; o contador força um novo valor a cada minuto
  }, [sim, config, version, humanSide, feed, batch, panel, toasts, result, finishing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!value) return null;
  return <MatchViewProvider value={value}>{children}</MatchViewProvider>;
}
