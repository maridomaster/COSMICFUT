import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, Check, Pause, Play, Repeat2, SlidersHorizontal, X } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { FORMATIONS, getFormationSlots, type LivePlayerState, type Tactic } from '@cosmicfut/engine';
import { MENTALITIES, PASSINGS, PRESSINGS, ROLE_LABEL, shortName, TEMPOS } from '@/lib/lineup';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useMatchView } from './view';
import { Button } from '@/components/ui/button';
import { Segmented, StepSlider } from '@/components/ui/range';
import { OvrBadge, PositionChip } from '@/components/game/bits';
import { CardIcon, ClubCrest, clubLabel, InjuryIcon } from '@/components/game/status';
import { StaminaBar } from '@/components/game/StaminaBar';
import { FormationPicker } from '@/pages/tactics/panels';
import { MatchPresetBar } from '@/pages/tactics/presets';
import { minuteLabel, RatingChip, usePlayerMap } from './shared';

type Tab = 'subs' | 'tactic' | 'swap';
const MAX_SUBS = 5;

/** Painel "Mudanças": substituições, postura tática e troca de posições. Pausa a partida. */
export function ChangesPanel() {
  const view = useMatchView();
  const { config, state, panel, closePanel: close, command, toast, getAppeared } = view;
  const side = view.humanSide;
  const players = usePlayerMap(config);
  const [tab, setTab] = useState<Tab>('subs');
  const halftime = panel === 'halftime';
  const subsUsed = state.stats[side].subsUsed;
  // (Atualização 38) papéis das posições vigentes (formação personalizada / set-shape)
  const slots = state.slots?.[side] ?? getFormationSlots(state.tactic[side].formation);
  const live = state.players[side];
  const onPitch = live.filter((l) => l.onPitch && l.slotIndex !== null).sort((a, b) => a.slotIndex! - b.slotIndex!);
  const appeared = useMemo(() => new Set(getAppeared()), [getAppeared, side, state.minute, subsUsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const bench = live.filter((l) => !l.onPitch && !l.sentOff && !appeared.has(l.id));

  const resume = view.resume;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        role="dialog"
        aria-modal
        aria-label="Mudanças"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-surface shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <ClubCrest id={config[side].clubId} size={28} />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 truncate text-base font-bold">
              {halftime ? 'Vestiário · Intervalo' : 'Mudanças'}
              {/* (Atualização 38) o relógio para enquanto o painel está aberto */}
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-warning uppercase" data-testid="match-paused">
                <Pause className="size-3" /> {view.pausedLabel ?? 'Partida pausada'}
              </span>
            </h2>
            <p className="text-[11px] text-fg-muted">
              {minuteLabel(state.minute, state.extra)} · {state.score.home} x {state.score.away} · substituições {subsUsed}/{MAX_SUBS}
            </p>
          </div>
          <button aria-label="Fechar" onClick={close} className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-5" />
          </button>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {halftime && <HalftimeSummary />}
          <Segmented
            id="changes-tab"
            label="Tipo de mudança"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'subs', label: 'Substituições' },
              { value: 'tactic', label: 'Postura' },
              { value: 'swap', label: 'Posições' },
            ]}
          />
          <div className="mt-4">
            {tab === 'subs' && (
              <SubsTab
                onPitch={onPitch}
                bench={bench}
                players={players}
                slots={slots.map((s) => ROLE_LABEL[s.role])}
                subsLeft={MAX_SUBS - subsUsed}
                onSub={async (outId, inId) => {
                  const err = await command({ type: 'substitute', side, outId, inId });
                  if (!err) toast({ kind: 'info', title: 'Substituição', text: `${shortName(players.get(inId)?.name ?? '')} entra no lugar de ${shortName(players.get(outId)?.name ?? '')}` });
                  return !err;
                }}
              />
            )}
            {tab === 'tactic' && (
              <MatchPresetBar side={side} command={command} onApplied={(name) => toast({ kind: 'info', title: 'Predefinição aplicada', text: name })} />
            )}
            {tab === 'tactic' && (
              <TacticTab
                current={state.tactic[side]}
                onApply={async (patch) => {
                  const err = await command({ type: 'set-tactic', side, tactic: patch });
                  if (!err) toast({ kind: 'info', title: 'Postura ajustada', text: 'A equipe recebeu as novas instruções.' });
                }}
              />
            )}
            {tab === 'swap' && (
              <SwapTab
                onPitch={onPitch}
                players={players}
                slots={slots.map((s) => ROLE_LABEL[s.role])}
                onSwap={async (a, b) => {
                  const err = await command({ type: 'swap-slots', side, aId: a, bId: b });
                  if (!err) toast({ kind: 'info', title: 'Posições trocadas', text: `${shortName(players.get(a)?.name ?? '')} ⇄ ${shortName(players.get(b)?.name ?? '')}` });
                  return !err;
                }}
              />
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          {view.panelNote && <div className="mr-auto min-w-0 flex-1 basis-full text-xs text-fg-muted sm:basis-auto">{view.panelNote}</div>}
          <Button variant="ghost" onClick={close}>
            Fechar
          </Button>
          <Button variant="club" onClick={resume} disabled={view.resumeDisabled}>
            <Play fill="currentColor" /> {view.resumeLabel ?? (halftime ? 'Iniciar 2º Tempo' : 'Voltar ao jogo')}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}

function HalftimeSummary() {
  const { config, state: st, getScorers } = useMatchView();
  const players = usePlayerMap(config);
  const goals = getScorers();
  const h = st.stats.home;
  const a = st.stats.away;
  const line = (label: string, hv: string | number, av: string | number) => (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
      <span className="tabular text-right font-bold">{hv}</span>
      <span className="w-24 text-center text-[10px] tracking-wider text-fg-subtle uppercase">{label}</span>
      <span className="tabular font-bold">{av}</span>
    </div>
  );
  return (
    <div className="mb-5 rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="text-center text-[10px] font-semibold tracking-[0.2em] text-club-accent uppercase">Resumo do 1º tempo</div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="flex items-center justify-end gap-2 truncate text-sm font-bold">
          {clubLabel(config.home.clubId, true)} <ClubCrest id={config.home.clubId} size={24} />
        </span>
        <span className="tabular text-3xl font-black">
          {st.score.home} : {st.score.away}
        </span>
        <span className="flex items-center gap-2 truncate text-sm font-bold">
          <ClubCrest id={config.away.clubId} size={24} /> {clubLabel(config.away.clubId, true)}
        </span>
      </div>
      {goals.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-center text-[11px] text-fg-muted">
          {goals.map((g, i) => (
            <li key={i}>
              ⚽ {players.get(g.playerId)?.name} {g.minute}'{g.ownGoal ? ' (contra)' : g.penalty ? ' (pên.)' : ''} — {clubLabel(config[g.side].clubId, true)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 space-y-1">
        {line('Posse', `${Math.round(h.possession)}%`, `${Math.round(a.possession)}%`)}
        {line('Finalizações', h.shots, a.shots)}
        {line('No alvo', h.shotsOnTarget, a.shotsOnTarget)}
        {line('xG', h.xg.toFixed(2), a.xg.toFixed(2))}
      </div>
    </div>
  );
}

function PlayerLine({
  l,
  p,
  role,
  selected,
  disabled,
  onClick,
  showRating = true,
}: {
  l: LivePlayerState;
  p: Player | undefined;
  role?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  showRating?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        selected ? 'border-club-accent bg-club-accent/12' : 'border-line/70 bg-surface-2/40 hover:border-line-strong',
      )}
    >
      {role && <span className="w-8 shrink-0 text-[10px] font-bold text-fg-subtle">{role}</span>}
      {p && <PositionChip position={p.position} className="hidden sm:inline-flex" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{p?.name ?? l.id}</span>
          {l.yellow > 0 && <CardIcon color="yellow" />}
          {l.injured && <InjuryIcon />}
        </span>
        <span className="mt-1 flex items-center">
          <StaminaBar value={l.stamina} showLabel className="w-24" />
        </span>
      </span>
      {p && (
        <OvrBadge value={p.overall} size="xs" />
      )}
      {showRating && <RatingChip value={l.rating} />}
    </button>
  );
}

function SubsTab({
  onPitch,
  bench,
  players,
  slots,
  subsLeft,
  onSub,
}: {
  onPitch: LivePlayerState[];
  bench: LivePlayerState[];
  players: Map<string, Player>;
  slots: string[];
  subsLeft: number;
  onSub: (outId: string, inId: string) => Promise<boolean>;
}) {
  const [out, setOut] = useState<string | null>(null);
  const [inc, setInc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!out || !inc || busy) return;
    setBusy(true);
    const ok = await onSub(out, inc);
    setBusy(false);
    if (ok) {
      setOut(null);
      setInc(null);
    }
  };
  return (
    <div>
      {subsLeft <= 0 && <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Limite de {MAX_SUBS} substituições atingido.</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-danger uppercase">▼ Sai (em campo)</h3>
          <div className="space-y-1.5">
            {onPitch.map((l) => (
              <PlayerLine key={l.id} l={l} p={players.get(l.id)} role={slots[l.slotIndex!]} selected={out === l.id} onClick={() => setOut(out === l.id ? null : l.id)} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-success uppercase">▲ Entra (banco)</h3>
          <div className="space-y-1.5">
            {bench.length === 0 && <p className="text-xs text-fg-subtle">Ninguém disponível no banco.</p>}
            {bench.map((l) => (
              <PlayerLine key={l.id} l={l} p={players.get(l.id)} selected={inc === l.id} disabled={subsLeft <= 0} showRating={false} onClick={() => setInc(inc === l.id ? null : l.id)} />
            ))}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/95 px-3 py-2.5 backdrop-blur">
        <Repeat2 className="size-4 text-club-accent" />
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {out ? <b className="text-danger">{shortName(players.get(out)?.name ?? '')}</b> : 'escolha quem sai'} →{' '}
          {inc ? <b className="text-success">{shortName(players.get(inc)?.name ?? '')}</b> : 'escolha quem entra'}
        </span>
        <Button size="sm" variant="club" disabled={!out || !inc || subsLeft <= 0 || busy} onClick={() => void confirm()}>
          <Check /> Confirmar
        </Button>
      </div>
    </div>
  );
}

function TacticTab({ current, onApply }: { current: Tactic; onApply: (patch: Partial<Tactic>) => void | Promise<void> }) {
  const [draft, setDraft] = useState<Tactic>({ ...current });
  const changed = (Object.keys(draft) as (keyof Tactic)[]).filter((k) => draft[k] !== current[k]);
  const set = (patch: Partial<Tactic>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Formação</div>
        <FormationPicker formations={FORMATIONS} value={draft.formation} onChange={(f) => set({ formation: f })} />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Mentalidade</div>
        <StepSlider label="Mentalidade" options={MENTALITIES} value={draft.mentality} onChange={(v) => set({ mentality: v })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Ritmo</div>
          <Segmented id="live-tempo" label="Ritmo" options={TEMPOS} value={draft.tempo} onChange={(v) => set({ tempo: v })} />
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Pressão</div>
          <Segmented id="live-press" label="Pressão" options={PRESSINGS} value={draft.pressing} onChange={(v) => set({ pressing: v })} />
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Passe</div>
          <Segmented id="live-pass" label="Passe" options={PASSINGS} value={draft.passing} onChange={(v) => set({ passing: v })} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-fg-muted">{changed.length ? (changed.length === 1 ? '1 alteração' : `${changed.length} alterações`) : 'Sem alterações'}</span>
        <Button size="sm" variant="outline" disabled={!changed.length} onClick={() => setDraft({ ...current })}>
          Desfazer
        </Button>
        <Button
          size="sm"
          variant="club"
          disabled={!changed.length}
          onClick={() => onApply(Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<Tactic>)}
        >
          <SlidersHorizontal /> Aplicar postura
        </Button>
      </div>
    </div>
  );
}

function SwapTab({
  onPitch,
  players,
  slots,
  onSwap,
}: {
  onPitch: LivePlayerState[];
  players: Map<string, Player>;
  slots: string[];
  onSwap: (a: string, b: string) => Promise<boolean>;
}) {
  const [a, setA] = useState<string | null>(null);
  const pick = async (id: string) => {
    if (!a) return setA(id);
    if (a === id) return setA(null);
    if (await onSwap(a, id)) setA(null);
  };
  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-xs text-fg-muted">
        <ArrowLeftRight className="size-3.5 text-club-accent" /> Toque em dois jogadores em campo para trocá-los de posição.
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {onPitch.map((l) => (
          <PlayerLine key={l.id} l={l} p={players.get(l.id)} role={slots[l.slotIndex!]} selected={a === l.id} onClick={() => void pick(l.id)} />
        ))}
      </div>
    </div>
  );
}

