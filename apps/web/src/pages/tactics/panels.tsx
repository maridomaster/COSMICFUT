import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertOctagon, AlertTriangle, Armchair, Crown, Gauge, GripVertical, Info, Plus, SlidersHorizontal, Target, UserMinus } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { getFormationSlots, type Formation, type Lineup, type Tactic } from '@cosmicfut/engine';
import { overallColor } from '@/lib/format';
import { MENTALITIES, PASSINGS, PRESSINGS, TEMPOS, type TeamIndicators } from '@/lib/lineup';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { MAX_BENCH } from '@/store/game';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Segmented, StepSlider } from '@/components/ui/range';
import { OvrBadge, PositionChip } from '@/components/game/bits';
import { PlayerFlags } from '@/components/game/player';
import { AvailabilityBadges, type PlayerStatus } from '@/components/game/status';
import { StaminaBar } from '@/components/game/StaminaBar';
import type { useDragSwap } from './useDragSwap';

type Dnd = ReturnType<typeof useDragSwap>;

/* ───────────── Seletor de formação com mini-campo ───────────── */
export function FormationPicker({ formations, value, onChange }: { formations: Formation[]; value: Formation; onChange: (f: Formation) => void }) {
  return (
    <div role="radiogroup" aria-label="Formação" className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
      {formations.map((f) => {
        const active = f === value;
        const slots = getFormationSlots(f);
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(f)}
            className={cn(
              'relative flex min-w-[3.25rem] flex-1 shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1 pt-1 pb-0.5 transition-colors',
              active ? 'border-club-accent/60 text-fg' : 'border-line bg-surface-2/50 text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId="formation-active"
                className="absolute inset-0 rounded-lg bg-club-accent/12"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <svg viewBox="0 0 34 44" className="relative h-6 w-[18px]" aria-hidden>
              <rect x="0.5" y="0.5" width="33" height="43" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.25" />
              {slots.map((s, i) => (
                <circle key={i} cx={3 + s.x * 28} cy={41 - s.y * 38} r="2.2" fill={active ? 'var(--club-accent)' : 'currentColor'} />
              ))}
            </svg>
            <span className="tabular relative text-[11px] leading-none font-bold whitespace-nowrap">{f}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Indicadores ───────────── */
function SectorBar({ label, value, delay }: { label: string; value: number; delay: number }) {
  const c = overallColor(Math.round(value));
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_2rem] items-center gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${c} 45%, transparent), ${c})` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(3, value)}%` }}
          transition={{ duration: 0.6, delay, ease: EASE_OUT }}
        />
      </div>
      <span className="tabular text-right text-sm font-bold" style={{ color: c }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

/** (Táticas) força por setor no motor (shapeStrength) + avisos do desenho + improvisados. */
export interface ShapeInfo {
  def: number;
  mid: number;
  att: number;
  issues: string[];
  improvised: { id: string; name: string; role: string; penalty: number }[];
}

export function IndicatorsCard({ ind, shape }: { ind: TeamIndicators; shape?: ShapeInfo }) {
  const fitPct = Math.round(ind.fit * 100);
  const fitColor = fitPct >= 95 ? 'var(--color-success)' : fitPct >= 85 ? 'var(--color-warning)' : 'var(--color-danger)';
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <Card>
      <CardHeader icon={<Gauge />} title="Força do time" subtitle="titulares" />
      <CardContent className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1">
            <div className="cf-label text-fg-muted">Overall médio</div>
            <motion.div
              key={ind.avgOverall.toFixed(1)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="tabular text-2xl leading-tight font-extrabold tracking-tight"
              style={{ color: overallColor(Math.round(ind.avgOverall)) }}
            >
              {ind.avgOverall.toFixed(1)}
            </motion.div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2 py-1" title="Adequação tática: quanto os titulares estão nas posições naturais">
            <svg viewBox="0 0 64 64" className="size-9 -rotate-90" aria-hidden>
              <circle cx="32" cy="32" r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth="7" />
              <motion.circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                stroke={fitColor}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={C}
                initial={false}
                animate={{ strokeDashoffset: C * (1 - ind.fit) }}
                transition={{ duration: 0.6, ease: EASE_OUT }}
              />
            </svg>
            <div>
              <div className="tabular text-lg leading-tight font-extrabold" style={{ color: fitColor }}>
                {fitPct}%
              </div>
              <div className="text-[10px] leading-tight text-fg-muted">
                Adequação
                <br />
                tática
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-1.5" data-testid="sector-bars" title="Força de cada setor como o motor da partida calcula (overall × adequação × físico × equilíbrio do desenho)">
          <SectorBar label="Defesa" value={shape?.def ?? ind.defense} delay={0.05} />
          <SectorBar label="Meio" value={shape?.mid ?? ind.midfield} delay={0.1} />
          <SectorBar label="Ataque" value={shape?.att ?? ind.attack} delay={0.15} />
        </div>
        {shape && (shape.issues.length > 0 || shape.improvised.length > 0) && (
          <ul className="space-y-1 text-[11px]" data-testid="shape-warnings">
            {shape.issues.map((t) => (
              <li key={t} className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger">
                <AlertOctagon className="mt-px size-3.5 shrink-0" /> {t}
              </li>
            ))}
            {shape.improvised.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {p.name} <span className="text-fg-muted">({p.role})</span>
                </span>
                <b className="tabular">improvisado −{p.penalty}</b>
              </li>
            ))}
          </ul>
        )}
        {ind.alerts.length > 0 ? (
          <ul className="space-y-1">
            {ind.alerts.map((a) => (
              <motion.li
                key={a.text}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  'flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-snug',
                  a.level === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
                  a.level === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
                  a.level === 'info' && 'border-line bg-surface-2/60 text-fg-muted',
                )}
              >
                {a.level === 'danger' ? (
                  <AlertOctagon className="mt-px size-3.5 shrink-0" />
                ) : a.level === 'warning' ? (
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                ) : (
                  <Info className="mt-px size-3.5 shrink-0" />
                )}
                {a.text}
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[11px] text-success">Tudo certo: todos em posição natural.</p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fg-subtle">
          <Legend color="var(--color-success)" label="Natural" />
          <Legend color="var(--color-warning)" label="Adaptado" />
          <Legend color="var(--color-danger)" label="Fora de posição" />
        </div>
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

/* ───────────── Estilo de jogo ───────────── */
export function StyleCard({ tactic, onChange }: { tactic: Tactic; onChange: (patch: Partial<Tactic>) => void }) {
  return (
    <Card>
      <CardHeader icon={<SlidersHorizontal />} title="Estilo de jogo" subtitle="instruções" />
      <CardContent className="space-y-2.5">
        <Field label="Mentalidade">
          <StepSlider label="Mentalidade" options={MENTALITIES} value={tactic.mentality} onChange={(v) => onChange({ mentality: v })} />
        </Field>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          <Field label="Ritmo" inline>
            <Segmented id="tempo" label="Ritmo" options={TEMPOS} value={tactic.tempo} onChange={(v) => onChange({ tempo: v })} />
          </Field>
          <Field label="Pressão" inline>
            <Segmented id="pressing" label="Pressão" options={PRESSINGS} value={tactic.pressing} onChange={(v) => onChange({ pressing: v })} />
          </Field>
          <Field label="Passe" inline>
            <Segmented id="passing" label="Passe" options={PASSINGS} value={tactic.passing} onChange={(v) => onChange({ passing: v })} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={cn(inline && 'lg:grid lg:grid-cols-[3.5rem_minmax(0,1fr)] lg:items-center lg:gap-2')}>
      <div className={cn('cf-label mb-1 text-fg-muted', inline && 'lg:mb-0')}>{label}</div>
      {children}
    </div>
  );
}

/* ───────────── Capitão e pênaltis ───────────── */
export function RolesCard({
  starters,
  lineup,
  onCaptain,
  onPenalty,
}: {
  starters: Player[];
  lineup: Lineup | null;
  onCaptain: (id: string | undefined) => void;
  onPenalty: (id: string | undefined) => void;
}) {
  const sel = (value: string | undefined, onSel: (id: string | undefined) => void, label: string) => (
    <NativeSelect aria-label={label} value={value && starters.some((p) => p.id === value) ? value : ''} onChange={(e) => onSel(e.target.value || undefined)}>
      <option value="">— escolher —</option>
      {starters.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.overall})
        </option>
      ))}
    </NativeSelect>
  );
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="cf-label mb-1 flex items-center gap-1 text-fg-muted">
            <Crown className="size-3.5 text-club-accent" /> Capitão
          </span>
          {sel(lineup?.captainId, onCaptain, 'Capitão')}
        </label>
        <label className="block">
          <span className="cf-label mb-1 flex items-center gap-1 text-fg-muted">
            <Target className="size-3.5 text-club-accent" /> Batedor de pênalti
          </span>
          {sel(lineup?.penaltyTakerId, onPenalty, 'Batedor de pênalti')}
        </label>
      </CardContent>
    </Card>
  );
}

/* ───────────── Banco e não relacionados ───────────── */
function ListRow({ player: p, dnd, selected, compact, status }: { player: Player; dnd: Dnd; selected: boolean; compact?: boolean; status?: PlayerStatus }) {
  const dragging = dnd.dragId === p.id;
  const over = dnd.isOver({ kind: 'player', id: p.id });
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 4 }} animate={{ opacity: dragging ? 0.35 : 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
      <div
        role="button"
        tabIndex={0}
        {...dnd.bind(p.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).click();
          }
        }}
        data-drop-id={p.id}
        aria-pressed={selected}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border pr-1.5 pl-0.5 transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-club-accent/60',
          compact && 'h-[30px]',
          selected
            ? 'border-club-accent bg-club-accent/12 shadow-[0_0_18px_-6px_var(--club-accent)]'
            : over
              ? 'scale-[1.02] border-fg/70 bg-surface-3'
              : 'border-line/70 bg-surface-2/40 hover:border-line-strong hover:bg-surface-2/80',
        )}
      >
        {/* alça: no toque, arrastar começa por aqui (o resto da linha continua rolando a página) */}
        <span className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fg-subtle hover:text-fg-muted active:cursor-grabbing" aria-hidden>
          <GripVertical className="size-3.5" />
        </span>
        <PositionChip position={p.position} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={`${p.name} · ${p.age} anos`}>{p.name}</span>
        <PlayerFlags player={p} />
        <AvailabilityBadges status={status} compact />
        <StaminaBar value={status?.fitness ?? 100} className="w-10" />
        <OvrBadge value={p.overall} />
      </div>
    </motion.li>
  );
}

export function BenchCard({
  bench,
  dnd,
  selectedId,
  onFreeSlot,
  status,
}: {
  bench: Player[];
  dnd: Dnd;
  selectedId: string | null;
  onFreeSlot: () => void;
  status?: Map<string, PlayerStatus>;
}) {
  const free = Math.max(0, MAX_BENCH - bench.length);
  const zoneOver = dnd.isOver({ kind: 'zone', zone: 'bench' });
  return (
    <Card data-drop-zone="bench" className={cn('shrink-0 transition-shadow', zoneOver && 'ring-2 ring-club-accent/70')}>
      <CardHeader icon={<Armchair />} title="Banco" subtitle={`${bench.length}/${MAX_BENCH} relacionados`} />
      <CardContent className="pt-2">
        <ul className="space-y-1">
          {bench.map((p) => (
            <ListRow key={p.id} player={p} dnd={dnd} selected={selectedId === p.id} status={status?.get(p.id)} />
          ))}
          {Array.from({ length: free }, (_, i) => (
            <li key={`free-${i}`}>
              <button
                type="button"
                data-drop-zone="bench"
                onClick={onFreeSlot}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-xs text-fg-subtle transition-colors hover:border-club-accent/50 hover:text-fg-muted"
              >
                <Plus className="size-3.5" /> Vaga livre
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function OutCard({ players, dnd, selectedId, status }: { players: Player[]; dnd: Dnd; selectedId: string | null; status?: Map<string, PlayerStatus> }) {
  const zoneOver = dnd.isOver({ kind: 'zone', zone: 'out' });
  return (
    <Card data-drop-zone="out" className={cn('flex min-h-0 flex-col transition-shadow lg:flex-1', zoneOver && 'ring-2 ring-club-accent/70')}>
      <CardHeader icon={<UserMinus />} title="Não relacionados" subtitle={`${players.length} · arraste um reserva para cá`} />
      <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
        {players.length === 0 ? (
          <p className="text-xs text-fg-subtle">Todo o elenco está relacionado.</p>
        ) : (
          <ul className="scrollbar-thin min-h-0 flex-1 space-y-1 lg:overflow-y-auto lg:pr-1">
            {players.map((p) => (
              <ListRow key={p.id} player={p} dnd={dnd} selected={selectedId === p.id} compact status={status?.get(p.id)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
