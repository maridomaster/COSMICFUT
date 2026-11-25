import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, BarChart3, Map as MapIcon, MessageSquareText, Pause, Play, Radio, SkipForward, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { getFormationSlots, shapeSlots, type LivePlayerState, type MatchConfig, type MatchState, type Side, type TeamLiveStats } from '@cosmicfut/engine';
import { assetUrl } from '@/data/source';
import { shortName } from '@/lib/lineup';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { useMatch, type FeedItem, type Speed } from '@/store/match';
import { Button } from '@/components/ui/button';
import { Kbd, Tooltip } from '@/components/ui/tooltip';
import { CardIcon, ClubCrest, clubColors, clubLabel, InjuryIcon } from '@/components/game/status';
import { StaminaBar } from '@/components/game/StaminaBar';
import { ChangesPanel } from './ChangesPanel';
import { EventIcon, minuteLabel, PHASE_LABEL, usePlayerMap, useMatchColors, type SideTheme } from './shared';
import { useMatchView } from './view';

type MobileTab = 'feed' | 'stats' | 'pitch' | 'others';

/**
 * Partida ao vivo (visual). Lê a partida de `useMatchView()` — serve ao solo e ao online.
 *  - `top`: faixa acima do placar (online: "VOCÊ x AMIGO");
 *  - `controls`: controles abaixo do placar (padrão: controles do solo);
 *  - `aside` / `asideLabel`: painel extra na coluna do campo (online: "Outros jogos").
 */
export function LiveMatch({ top, controls, aside, asideLabel = 'Outros' }: { top?: ReactNode; controls?: ReactNode; aside?: ReactNode; asideLabel?: string } = {}) {
  const view = useMatchView();
  const { state, config, humanSide, panel, feed, readOnly } = view;
  const colors = useMatchColors(clubColors(config.home.clubId), clubColors(config.away.clubId));
  const players = usePlayerMap(config);
  const [tab, setTab] = useState<MobileTab>('feed');
  const flash = useMatchEffects(config, humanSide, colors);
  const tabs = (
    [
      ['feed', 'Narração', MessageSquareText],
      ['stats', 'Estatísticas', BarChart3],
      ['pitch', 'Campo', MapIcon],
      ...(aside ? ([['others', asideLabel, Radio]] as const) : []),
    ] as const
  );

  return (
    // (Atualização 41) no desktop a partida ocupa exatamente a altura da tela: placar e controles em cima, as três
    // colunas (estatísticas · narração · campo) dividem o resto e rolam por dentro — nada de rolar a página
    <div className="relative pb-24 lg:flex lg:h-[calc(100dvh_-_var(--topbar-h)_-_2rem)] lg:min-h-[34rem] lg:flex-col lg:pb-0">
      <GoalFlash flash={flash} />
      <Toasts colors={colors} />

      {/* placar fixo no topo (mobile) / destaque (desktop) */}
      <div className="sticky top-[var(--topbar-h)] z-10 -mx-3 bg-bg/85 px-3 pt-1 pb-2 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {top}
        <Scoreboard state={state} config={config} colors={colors} goalKey={flash?.key ?? 0} />
        {controls ?? <Controls />}
      </div>

      {/* abas (mobile) */}
      <div role="tablist" aria-label="Painéis da partida" className={cn('mt-2 grid gap-0.5 rounded-lg border border-line bg-surface-2/60 p-0.5 lg:hidden', aside ? 'grid-cols-4' : 'grid-cols-3')}>
        {tabs.map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors', tab === k ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg')}
          >
            <Icon className={cn('size-4', aside && 'max-[420px]:hidden')} /> {label}
          </button>
        ))}
      </div>

      <div className="mt-2 grid gap-3 lg:mt-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,24rem)]" data-testid="live-columns">
        <section className={cn('cf-card scrollbar-thin p-3 lg:overflow-y-auto', tab !== 'stats' && 'hidden lg:block')} aria-label="Estatísticas">
          <StatsPanel state={state} colors={colors} config={config} />
        </section>
        <section className={cn('cf-card flex min-h-[22rem] flex-col p-0 lg:min-h-0', tab !== 'feed' && 'hidden lg:flex')} aria-label="Narração">
          <Feed feed={feed} config={config} colors={colors} players={players} />
        </section>
        <div className={cn('scrollbar-thin flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto', tab !== 'pitch' && tab !== 'others' && 'hidden lg:flex')}>
          <section className={cn('cf-card p-2.5', tab !== 'pitch' && 'hidden lg:block')} aria-label="Campo">
            <MiniPitch state={state} config={config} colors={colors} players={players} humanSide={humanSide} />
            <BenchStamina state={state} side={humanSide} players={players} />
          </section>
          {aside && (
            <section className={cn('cf-card p-2.5', tab !== 'others' && 'hidden lg:block')} aria-label={asideLabel}>
              {aside}
            </section>
          )}
        </div>
      </div>

      {/* botão flutuante de mudanças (mobile) — não existe só assistindo (Rodada ao vivo) */}
      {!readOnly && (
        <div className="fixed right-4 bottom-4 z-30 lg:hidden">
          <ChangesButton floating />
        </div>
      )}

      <AnimatePresence>{panel && !readOnly && <ChangesPanel key="panel" />}</AnimatePresence>
    </div>
  );
}

/* ───────────── efeitos: som, flash, toasts ───────────── */

const SOUNDS = {
  goal: 'audio/gol1.wav',
  goalAgainst: 'audio/goladv.wav',
  half: 'audio/intervalo.wav',
  end: 'audio/fimjogo.wav',
  red: 'audio/expulsao.wav',
  injury: 'audio/contusao.wav',
  penalty: 'audio/penalty.wav',
} as const;
const audioCache = new Map<string, HTMLAudioElement>();
function playSound(key: keyof typeof SOUNDS) {
  const url = assetUrl(SOUNDS[key]);
  if (!url) return;
  let a = audioCache.get(url);
  if (!a) {
    a = new Audio(url);
    a.volume = 0.6;
    audioCache.set(url, a);
  }
  a.currentTime = 0;
  a.play().catch(() => undefined);
}

function useMatchEffects(config: MatchConfig, humanSide: Side, colors: Record<Side, SideTheme>) {
  const { batch, toast, online } = useMatchView();
  // online: sempre mudo (nenhum som toca no modo online)
  const muted = useGame((s) => s.muted) || online;
  const [flash, setFlash] = useState<{ key: number; side: Side; color: string; color2: string } | null>(null);
  const seen = useRef(0);
  const players = usePlayerMap(config);
  useEffect(() => {
    if (!batch || batch.key === seen.current) return;
    seen.current = batch.key;
    const name = (id?: string) => (id ? (players.get(id)?.name ?? '') : '');
    for (const e of batch.events) {
      const side = e.side;
      const mine = side === humanSide;
      if (e.type === 'goal' || e.type === 'own-goal') {
        // na engine, `side` do gol (inclusive contra) é o lado beneficiado; no gol contra o playerId é do adversário
        const scoringSide: Side = side ?? 'home';
        if (!batch.silent) {
          setFlash({ key: Date.now(), side: scoringSide, color: colors[scoringSide].primary, color2: colors[scoringSide].secondary });
          toast({ kind: 'goal', title: 'GOL!', text: `${name(e.playerId)}${e.type === 'own-goal' ? ' (contra)' : ''} — ${clubLabel(config[scoringSide].clubId)}`, side: scoringSide });
          if (!muted) playSound(scoringSide === humanSide ? 'goal' : 'goalAgainst');
        }
      } else if (batch.silent) {
        continue;
      } else if (e.type === 'red' || e.type === 'second-yellow') {
        toast({ kind: 'red', title: 'Expulsão', text: `${name(e.playerId)} (${clubLabel(config[side ?? 'home'].clubId, true)})`, side });
        if (!muted) playSound('red');
      } else if (e.type === 'injury') {
        toast({ kind: 'injury', title: mine ? 'Lesão no seu time' : 'Lesão', text: mine ? `${name(e.playerId)} se machucou — abra Mudanças para substituir.` : name(e.playerId), side });
        if (!muted) playSound('injury');
      } else if (e.type === 'penalty-awarded') {
        if (!muted) playSound('penalty');
      } else if (e.type === 'half-time') {
        if (!muted) playSound('half');
      } else if (e.type === 'full-time') {
        if (!muted) playSound('end');
      }
    }
  }, [batch, colors, config, humanSide, muted, players, toast]);
  return flash;
}

function GoalFlash({ flash }: { flash: { key: number; color: string; color2: string } | null }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash.key}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.55, 0.15, 0.4, 0] }}
          transition={{ duration: 1.6, times: [0, 0.12, 0.35, 0.5, 1] }}
          style={{
            background: `radial-gradient(80% 60% at 50% 30%, ${flash.color}, transparent 70%), linear-gradient(135deg, color-mix(in oklab, ${flash.color} 60%, transparent), color-mix(in oklab, ${flash.color2} 45%, transparent))`,
          }}
        />
      )}
    </AnimatePresence>
  );
}

function Toasts({ colors }: { colors: Record<Side, SideTheme> }) {
  const { toasts, dismissToast: dismiss } = useMatchView();
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:right-5 sm:bottom-5" aria-live="polite" data-testid="match-toasts">
      <AnimatePresence>
        {toasts.map((t) =>
          t.kind === 'goal' ? (
            <motion.button
              key={t.id}
              onClick={() => dismiss(t.id)}
              initial={{ opacity: 0, scale: 0.6, x: 24 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              className="pointer-events-auto rounded-xl px-4 py-1.5 text-center shadow-xl"
              style={{ background: t.side ? colors[t.side].primary : 'var(--club-accent)', color: t.side ? colors[t.side].onAccent : 'var(--club-on-accent)' }}
            >
              <div className="text-xl leading-none font-black tracking-tight italic sm:text-2xl">{t.title}</div>
              {t.text && <div className="mt-0.5 text-[11px] font-semibold opacity-90">{t.text}</div>}
            </motion.button>
          ) : (
            <motion.button
              key={t.id}
              onClick={() => dismiss(t.id)}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm shadow-xl backdrop-blur-xl',
                t.kind === 'error' ? 'border-danger/40 bg-[#2a1215]/95 text-danger' : 'border-line-strong bg-surface-2/95 text-fg',
              )}
            >
              {t.kind === 'red' ? <CardIcon color="red" /> : t.kind === 'injury' ? <InjuryIcon /> : null}
              <span>
                <b className="font-bold">{t.title}</b>
                {t.text && <span className="text-fg-muted"> — {t.text}</span>}
              </span>
            </motion.button>
          ),
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── placar e controles ───────────── */

function Scoreboard({ state, config, colors, goalKey }: { state: MatchState; config: MatchConfig; colors: Record<Side, SideTheme>; goalKey: number }) {
  const live = state.phase === 'first-half' || state.phase === 'second-half' || state.phase === 'extra-time';
  return (
    <div className="cf-card relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${colors.home.primary} 32%, transparent), transparent 40%, transparent 60%, color-mix(in oklab, ${colors.away.primary} 32%, transparent))` }}
      />
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 sm:px-5">
        <TeamSide id={config.home.clubId} align="right" />
        <div className="flex flex-col items-center">
          <motion.div
            key={`${state.score.home}-${state.score.away}`}
            initial={goalKey ? { scale: 1.5 } : false}
            animate={{ scale: [1.35, 0.95, 1.08, 1] }}
            transition={{ duration: 0.8, ease: EASE_OUT }}
            className="tabular flex items-center gap-2 text-4xl leading-none font-black tracking-tight sm:gap-3 sm:text-5xl"
            aria-label={`Placar ${state.score.home} a ${state.score.away}`}
          >
            <span>{state.score.home}</span>
            <span className="text-2xl text-fg-subtle sm:text-3xl">:</span>
            <span>{state.score.away}</span>
          </motion.div>
          {config.aggregate && (
            <div className="tabular text-[11px] font-semibold text-fg-muted" title="Placar somado das duas partidas">
              agregado {config.aggregate.home + state.score.home} x {config.aggregate.away + state.score.away}
            </div>
          )}
          {state.penaltyScore && (
            <div className="tabular text-[11px] font-semibold text-warning">
              pên. {state.penaltyScore.home} x {state.penaltyScore.away}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5">
            <span className="tabular rounded-md bg-black/40 px-2 py-0.5 text-sm font-bold text-fg">
              {state.phase === 'pre' ? "0'" : minuteLabel(state.minute, state.extra)}
            </span>
            <span
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                live ? 'bg-danger/20 text-danger' : 'bg-surface-3 text-fg-muted',
              )}
            >
              {live && <span className="size-1.5 animate-pulse rounded-full bg-danger" />}
              {PHASE_LABEL[state.phase]}
            </span>
          </div>
        </div>
        <TeamSide id={config.away.clubId} align="left" />
      </div>
      {config.knockout && state.phase !== 'penalties' && !state.penaltyScore && (
        <div className="relative pb-1.5 text-center text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
          mata-mata · empate {config.aggregate ? 'no agregado ' : ''}→ {config.extraTime ? 'prorrogação e pênaltis' : 'pênaltis'}
        </div>
      )}
      <Shootout state={state} colors={colors} />
      <MomentumBar value={state.momentum} colors={colors} />
    </div>
  );
}

/** Disputa de pênaltis animada: uma bolinha por cobrança (entra a cada tick do relógio). */
function Shootout({ state, colors }: { state: MatchState; colors: Record<Side, SideTheme> }) {
  const { feed } = useMatchView();
  const kicks = useMemo(() => feed.filter((e) => e.type === 'penalty-shootout-kick'), [feed]);
  if (!state.penaltyScore && state.phase !== 'penalties') return null;
  const bySide = (side: Side) => kicks.filter((k) => k.side === side);
  const rows = (['home', 'away'] as Side[]).map((side) => {
    const list = bySide(side);
    const slots = Math.max(5, list.length);
    return (
      <div key={side} className="flex items-center gap-1.5">
        <span className="h-3 w-1 rounded-full" style={{ background: colors[side].primary }} />
        <div className="flex gap-1">
          {Array.from({ length: slots }, (_, i) => {
            const k = list[i];
            return (
              <motion.span
                key={i}
                initial={k ? { scale: 0.2, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                title={k?.text}
                className={cn(
                  'grid size-4 place-items-center rounded-full text-[9px] font-black sm:size-5',
                  !k ? 'border border-dashed border-line-strong' : k.scored ? 'bg-success text-[#052e1c]' : 'bg-danger text-white',
                )}
              >
                {k ? (k.scored ? '✓' : '✕') : ''}
              </motion.span>
            );
          })}
        </div>
      </div>
    );
  });
  const last = kicks[kicks.length - 1];
  return (
    <div className="relative border-t border-line/60 bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5">
        <span className="text-[10px] font-bold tracking-[0.2em] text-warning uppercase">Pênaltis</span>
        {rows}
      </div>
      <AnimatePresence mode="wait">
        {last && (
          <motion.p key={kicks.length} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 truncate text-center text-[11px] text-fg-muted">
            {last.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeamSide({ id, align }: { id: string; align: 'left' | 'right' }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-1 text-center sm:gap-3', align === 'right' ? 'sm:flex-row-reverse sm:text-right' : 'sm:flex-row sm:text-left')}>
      <ClubCrest id={id} size={44} className="max-sm:!size-8" />
      <div className="max-w-full min-w-0">
        <div className="truncate text-[11px] font-extrabold tracking-tight sm:text-lg">{clubLabel(id, true)}</div>
      </div>
    </div>
  );
}

/** Momentum −1 (visitante) .. +1 (mandante): barra que "empurra" a partir do centro. */
function MomentumBar({ value, colors }: { value: number; colors: Record<Side, SideTheme> }) {
  const pct = Math.abs(value) * 50;
  return (
    <div className="relative h-1.5 bg-surface-3" title={`Momentum ${value > 0.05 ? 'mandante' : value < -0.05 ? 'visitante' : 'equilibrado'}`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-fg-subtle" />
      <motion.div
        className="absolute inset-y-0"
        animate={{ left: value >= 0 ? `${50 - pct}%` : '50%', width: `${pct}%`, background: value >= 0 ? colors.home.primary : colors.away.primary }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

/** Controles do Match Day solo (relógio local). */
export function Controls() {
  const running = useMatch((s) => s.running);
  const speed0 = useMatch((s) => s.speed);
  const isFinal = useMatch((s) => s.isFinal);
  const speed = speed0;
  const play = useMatch((s) => s.play);
  const pause = useMatch((s) => s.pause);
  const setSpeed = useMatch((s) => s.setSpeed);
  const skip = useMatch((s) => s.skipToEnd);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Tooltip side="top" content={<span className="flex items-center gap-1.5">{running ? 'Pausar' : 'Retomar'} <Kbd>Espaço</Kbd></span>}>
        <Button variant={running ? 'outline' : 'club'} size="sm" onClick={running ? pause : play} aria-label={running ? 'Pausar' : 'Retomar'} aria-keyshortcuts="Space" className="w-24">
          {running ? <Pause /> : <Play fill="currentColor" />} {running ? 'Pausar' : 'Jogar'}
        </Button>
      </Tooltip>
      <div role="radiogroup" aria-label="Velocidade" className="flex rounded-lg border border-line bg-surface-2/60 p-0.5">
        {([1, 2, 4] as Speed[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={speed === s}
            onClick={() => setSpeed(s)}
            className={cn('tabular h-6 rounded-md px-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40', speed === s ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg')}
          >
            {s}x
          </button>
        ))}
      </div>
      {isFinal && <span className="text-[11px] font-bold uppercase tracking-wide text-club-accent">Final</span>}
      <Button variant="ghost" size="sm" onClick={skip} title="Simula o restante da partida">
        <SkipForward /> <span className="hidden sm:inline">Pular para o fim</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setMuted(!muted)} aria-label={muted ? 'Ativar som' : 'Silenciar'} className="w-7 px-0">
        {muted ? <VolumeX /> : <Volume2 />}
      </Button>
      <div className="ml-auto hidden lg:block">
        <ChangesButton />
      </div>
    </div>
  );
}

export function ChangesButton({ floating }: { floating?: boolean }) {
  const { openPanel: open, state, humanSide } = useMatchView();
  const subs = state.stats[humanSide].subsUsed;
  return (
    <Button
      variant="club"
      size={floating ? 'lg' : 'sm'}
      onClick={() => open('changes')}
      title="Substituir, mexer no time e táticas — a partida pausa enquanto o painel estiver aberto"
      data-testid="open-changes"
      className={cn(floating && 'rounded-full shadow-[0_10px_30px_-8px_var(--club-accent)]')}
    >
      <SlidersHorizontal /> Mudanças
      <span className="tabular rounded-md bg-black/20 px-1.5 text-[10px]">{subs}/5</span>
    </Button>
  );
}

/* ───────────── narração ───────────── */

const QUIET = new Set(['commentary', 'foul', 'chance', 'shot', 'corner', 'offside']);

function Feed({ feed, config, colors, players }: { feed: FeedItem[]; config: MatchConfig; colors: Record<Side, SideTheme>; players: Map<string, Player> }) {
  // (18/11) "Só lances principais" começa sempre marcado
  const [onlyKey, setOnlyKey] = useState(true);
  const items = useMemo(() => {
    const list = onlyKey ? feed.filter((e) => !QUIET.has(e.type)) : feed;
    return list.slice(-150).reverse();
  }, [feed, onlyKey]);
  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Activity className="size-3.5 text-club-accent" /> Narração
        </h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-fg-muted select-none">
          <input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} className="accent-[var(--club-accent)]" />
          Só lances principais
        </label>
      </div>
      <ol className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-live="off">
        {items.length === 0 && <li className="py-10 text-center text-sm text-fg-subtle">A bola vai rolar…</li>}
        <AnimatePresence initial={false}>
          {items.map((e) => {
            const goal = e.type === 'goal' || e.type === 'own-goal';
            const side = e.side;
            const c = side ? colors[side].primary : undefined;
            const big = goal || e.type === 'red' || e.type === 'second-yellow' || e.type === 'half-time' || e.type === 'full-time' || e.type === 'kickoff';
            return (
              <motion.li
                key={e.key}
                initial={{ opacity: 0, x: side === 'away' ? 16 : -16, scale: goal ? 0.9 : 1 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
                className={cn(
                  'relative flex gap-2 overflow-hidden rounded-lg border px-2.5',
                  big ? 'py-1.5' : 'py-1',
                  goal ? 'border-transparent' : e.type === 'half-time' || e.type === 'full-time' || e.type === 'kickoff' ? 'border-line-strong bg-surface-3/70' : 'border-line/50 bg-surface-2/35',
                )}
                style={goal && c ? { background: `linear-gradient(90deg, color-mix(in oklab, ${c} 45%, transparent), color-mix(in oklab, ${c} 12%, transparent))`, boxShadow: `inset 3px 0 0 ${c}` } : side && c ? { boxShadow: `inset 2px 0 0 color-mix(in oklab, ${c} 70%, transparent)` } : undefined}
              >
                <span className="tabular w-9 shrink-0 pt-0.5 text-[11px] font-bold text-fg-muted">{minuteLabel(e.minute, e.extra)}</span>
                <span className={cn('grid size-5 shrink-0 place-items-center pt-0.5', goal ? 'text-white' : 'text-fg-muted')}>
                  <EventIcon type={e.type} />
                </span>
                <div className="min-w-0 flex-1">
                  {goal && (
                    <div className="text-[11px] font-black tracking-[0.2em] text-white uppercase">
                      Gol {e.type === 'own-goal' ? 'contra ' : ''}· {clubLabel(config[side ?? 'home'].clubId, true)}
                    </div>
                  )}
                  <p className={cn('text-[12.5px] leading-snug', goal ? 'font-semibold text-white' : big ? 'font-semibold text-fg' : 'text-fg/90')}>{e.text}</p>
                  {e.type === 'substitution' && e.playerOutId && (
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      <span className="text-success">▲ {shortName(players.get(e.playerId ?? '')?.name ?? '')}</span>{' '}
                      <span className="text-danger">▼ {shortName(players.get(e.playerOutId)?.name ?? '')}</span>
                    </p>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </>
  );
}

/* ───────────── estatísticas ───────────── */

function StatsPanel({ state, colors, config }: { state: MatchState; colors: Record<Side, SideTheme>; config: MatchConfig }) {
  const h = state.stats.home;
  const a = state.stats.away;
  const poss = Math.round(h.possession);
  const rows: [string, keyof TeamLiveStats | 'xg', (s: TeamLiveStats) => number, (v: number) => string][] = [
    ['Finalizações', 'shots', (s) => s.shots, String],
    ['No alvo', 'shotsOnTarget', (s) => s.shotsOnTarget, String],
    ['xG', 'xg', (s) => s.xg, (v) => v.toFixed(2)],
    ['Escanteios', 'corners', (s) => s.corners, String],
    ['Faltas', 'fouls', (s) => s.fouls, String],
    ['Amarelos', 'yellows', (s) => s.yellows, String],
    ['Vermelhos', 'reds', (s) => s.reds, String],
    ['Impedimentos', 'offsides', (s) => s.offsides, String],
    ['Passes certos', 'passesCompleted', (s) => s.passesCompleted, String],
  ];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <ClubCrest id={config.home.clubId} size={18} /> {clubLabel(config.home.clubId, true)}
        </span>
        <span className="flex items-center gap-1.5">
          {clubLabel(config.away.clubId, true)} <ClubCrest id={config.away.clubId} size={18} />
        </span>
      </div>
      <div className="mb-1 text-center text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Posse de bola</div>
      <div className="flex items-center gap-2">
        <span className="tabular w-9 text-sm font-extrabold">{poss}%</span>
        <div className="flex h-2.5 flex-1 gap-[2px] overflow-hidden rounded-full">
          <motion.div className="h-full rounded-l-full" style={{ background: colors.home.primary }} animate={{ width: `${poss}%` }} transition={{ duration: 0.4 }} />
          <div className="h-full flex-1 rounded-r-full" style={{ background: colors.away.primary }} />
        </div>
        <span className="tabular w-9 text-right text-sm font-extrabold">{100 - poss}%</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map(([label, key, get, fmt]) => {
          const hv = get(h);
          const av = get(a);
          const tot = hv + av || 1;
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between text-xs">
                <span className={cn('tabular font-bold', hv > av ? 'text-fg' : 'text-fg-muted')}>{fmt(hv)}</span>
                <span className="text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{label}</span>
                <span className={cn('tabular font-bold', av > hv ? 'text-fg' : 'text-fg-muted')}>{fmt(av)}</span>
              </div>
              <div className="mt-0.5 grid grid-cols-2 gap-1">
                <div className="flex h-1 justify-end overflow-hidden rounded-full bg-surface-3">
                  <motion.div className="h-full rounded-full" style={{ background: colors.home.primary }} animate={{ width: `${(hv / tot) * 100}%` }} transition={{ duration: 0.4 }} />
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                  <motion.div className="h-full rounded-full" style={{ background: colors.away.primary }} animate={{ width: `${(av / tot) * 100}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-center text-[11px] text-fg-muted">
        <span className="rounded-md border border-line bg-surface-2/50 py-1">
          {state.tactic.home.formation} · subs {h.subsUsed}/5
        </span>
        <span className="rounded-md border border-line bg-surface-2/50 py-1">
          {state.tactic.away.formation} · subs {a.subsUsed}/5
        </span>
      </div>
    </div>
  );
}

/* ───────────── mini campo ───────────── */

export function MiniPitch({
  state,
  config,
  colors,
  players,
  humanSide,
}: {
  state: MatchState;
  config: MatchConfig;
  colors: Record<Side, SideTheme>;
  players: Map<string, Player>;
  humanSide: Side;
}) {
  // humano sempre embaixo, atacando para cima
  const bottom = humanSide;
  const top: Side = bottom === 'home' ? 'away' : 'home';
  const tokens = (side: Side, flip: boolean) => {
    // (Atualização 38) posições vigentes (formação personalizada / set-shape / predefinição); fallback: a da escalação
    const slots = state.slots?.[side] ?? shapeSlots(state.tactic[side].formation, config[side].lineup?.positions) ?? getFormationSlots(state.tactic[side].formation);
    return state.players[side]
      .filter((l) => l.onPitch && l.slotIndex !== null)
      .map((l) => {
        const s = slots[l.slotIndex!];
        // metade do campo para cada time: y 0..1 → 0.04..0.48 (de baixo) ou espelhado (de cima)
        const yy = 0.04 + s.y * 0.44;
        return { l, x: flip ? 1 - s.x : s.x, y: flip ? 1 - yy : yy, role: s.role };
      });
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: colors[top].primary }} /> {clubLabel(config[top].clubId, true)}
        </span>
        <span className="text-[10px] text-fg-subtle">{state.tactic[top].formation}</span>
      </div>
      <div className="relative mx-auto aspect-[68/100] w-full max-w-[380px] overflow-hidden rounded-lg border border-white/10 lg:max-w-[min(380px,calc((100dvh_-_var(--topbar-h)_-_16.5rem)_*_0.68))]" style={{ background: 'repeating-linear-gradient(180deg, #0f3b2b 0 10%, #0c3324 10% 20%)' }}>
        <svg viewBox="0 0 68 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          {(() => {
            const line = { stroke: 'rgb(255 255 255 / 0.28)', strokeWidth: 1, fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
            return (
              <>
                <rect x="1.5" y="1.5" width="65" height="97" {...line} />
                <line x1="1.5" y1="50" x2="66.5" y2="50" {...line} />
                <circle cx="34" cy="50" r="8" {...line} />
                <rect x="14" y="1.5" width="40" height="15" {...line} />
                <rect x="14" y="83.5" width="40" height="15" {...line} />
                <rect x="25" y="1.5" width="18" height="5.5" {...line} />
                <rect x="25" y="93" width="18" height="5.5" {...line} />
              </>
            );
          })()}
        </svg>
        {[...tokens(bottom, false), ...tokens(top, true)].map(({ l, x, y }) => {
          const side: Side = state.players.home.includes(l) ? 'home' : 'away';
          return <Token key={l.id} l={l} x={x} y={y} color={colors[side]} name={players.get(l.id)?.name ?? ''} />;
        })}
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: colors[bottom].primary }} /> {clubLabel(config[bottom].clubId, true)}
        </span>
        <span className="text-[10px] text-fg-subtle">{state.tactic[bottom].formation}</span>
      </div>
    </div>
  );
}

function Token({ l, x, y, color, name }: { l: LivePlayerState; x: number; y: number; color: SideTheme; name: string }) {
  return (
    <motion.div
      className="absolute z-10 flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      initial={false}
      animate={{ left: `${6 + x * 88}%`, top: `${(1 - y) * 100}%` }}
      transition={{ type: 'spring', stiffness: 200, damping: 26 }}
      title={`${name} · nota ${l.rating.toFixed(1)} · físico ${Math.round(l.stamina)}%`}
    >
      <span className="relative">
        <span
          className="grid size-7 place-items-center rounded-full border-2 text-[10px] font-black shadow-md"
          style={{ background: color.primary, borderColor: color.secondary, color: color.onAccent }}
        >
          {l.rating.toFixed(1)}
        </span>
        {l.yellow > 0 && <CardIcon color="yellow" className="absolute -top-1 -right-1.5 h-3 w-2" />}
        {l.injured && <InjuryIcon className="absolute -bottom-1 -left-1.5 size-3.5" />}
      </span>
      <span className="mt-0.5 max-w-full truncate rounded bg-black/60 px-1 text-[9px] leading-tight font-semibold text-white">{shortName(name)}</span>
      {/* (Atualização 38) stamina sob o nome */}
      <StaminaBar value={l.stamina} className="mt-0.5 w-11 rounded bg-black/50 px-0.5" />
    </motion.div>
  );
}

/** (Atualização 38) Banco do humano com a stamina de cada reserva (quem já saiu fica de fora). */
function BenchStamina({ state, side, players }: { state: MatchState; side: Side; players: Map<string, Player> }) {
  const { getAppeared } = useMatchView();
  const appeared = new Set(getAppeared());
  const bench = state.players[side].filter((l) => !l.onPitch && !l.sentOff && !appeared.has(l.id));
  if (!bench.length) return null;
  return (
    <div className="mt-2 border-t border-line/60 pt-1.5" data-testid="bench-stamina">
      <div className="cf-label mb-1 px-1">Banco · condição física</div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 px-1 sm:grid-cols-3 lg:grid-cols-2">
        {bench.map((l) => (
          <li key={l.id} className="min-w-0">
            <div className="truncate text-[11px] font-medium">{shortName(players.get(l.id)?.name ?? l.id)}</div>
            <StaminaBar value={l.stamina} showLabel className="w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
