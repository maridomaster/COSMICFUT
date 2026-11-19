import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, ChevronRight, ListOrdered } from 'lucide-react';
import type { Country, Player, Trait } from '@cosmicfut/shared';
import { fmtMoney, POSITION_ORDER } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { DeclineArrow, Flag, OverallBar, PositionChip, potentialClass } from '@/components/game/bits';
import { PlayerFlags, StatusChip } from '@/components/game/player';
import { statusOf } from '@/lib/lineup';
import { useGame } from '@/store/game';

type SortKey = 'overall' | 'position' | 'age';
type Dir = 'asc' | 'desc';

const SORTS: { key: SortKey; label: string; defaultDir: Dir }[] = [
  { key: 'overall', label: 'Overall', defaultDir: 'desc' },
  { key: 'position', label: 'Posição', defaultDir: 'asc' },
  { key: 'age', label: 'Idade', defaultDir: 'asc' },
];

function sortPlayers(players: Player[], key: SortKey, dir: Dir): Player[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...players].sort((a, b) => {
    let d = 0;
    if (key === 'overall') d = a.overall - b.overall;
    else if (key === 'age') d = a.age - b.age;
    else d = POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
    // desempate: overall desc, depois nome
    return d * m || b.overall - a.overall || a.name.localeCompare(b.name, 'pt-BR');
  });
}

const COLS = 'grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_3.25rem] md:grid-cols-[4.5rem_minmax(0,1fr)_7.5rem_3.5rem_11rem_3rem_5.5rem_5.5rem]';

export function SquadTable({
  players,
  countries,
  traits,
  onSelect,
}: {
  players: Player[];
  countries: Map<number, Country>;
  traits: Map<number, Trait>;
  /** abre o card do jogador (mesmo drawer da página Elenco) */
  onSelect?: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'overall', dir: 'desc' });
  const lineup = useGame((s) => s.lineup);
  const rows = useMemo(() => sortPlayers(players, sort.key, sort.dir), [players, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: SORTS.find((x) => x.key === key)!.defaultDir },
    );

  return (
    <Card>
      <CardHeader
        icon={<ListOrdered />}
        title="Elenco completo"
        subtitle={`${players.length} jogadores`}
        action={
          <div role="group" aria-label="Ordenar elenco" className="flex shrink-0 rounded-xl border border-line bg-surface-2/60 p-1">
            {SORTS.map((s) => {
              const active = sort.key === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => toggle(s.key)}
                  aria-pressed={active}
                  className={cn(
                    'relative flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors sm:px-2.5',
                    active ? 'text-club-on-accent' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span layoutId="squad-sort" className="absolute inset-0 rounded-lg bg-club-accent" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
                  )}
                  <span className="relative">{s.label}</span>
                  {active && (sort.dir === 'asc' ? <ArrowUp className="relative size-3" /> : <ArrowDown className="relative size-3" />)}
                </button>
              );
            })}
          </div>
        }
        className="flex-wrap"
      />
      <div className="mt-4 px-2 pb-3 sm:px-3">
        <div className={cn('grid items-center gap-3 border-b border-line px-3 pb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase', COLS)}>
          <span>Pos</span>
          <span>Jogador</span>
          <span className="hidden md:block">Nacionalidade</span>
          <span className="hidden text-right md:block">Idade</span>
          <span className="md:pl-1">Overall</span>
          <span className="hidden text-right md:block">Pot</span>
          <span className="hidden text-right md:block">Salário</span>
          <span className="text-right">Status</span>
        </div>
        <motion.ul layout className="divide-y divide-line/50">
          {rows.map((p, i) => {
            const country = countries.get(p.nationalityId);
            const traitLabels = p.traits.map((t) => traits.get(t)?.label).filter(Boolean);
            return (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(i, 20) * 0.02, ease: EASE_OUT, layout: { duration: 0.35, ease: EASE_OUT } }}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(p.id) : undefined}
                onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(p.id)) : undefined}
                className={cn(
                  'grid items-center gap-3 rounded-lg px-3 py-2.5 transition-colors outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2/60',
                  onSelect && 'cursor-pointer',
                  COLS,
                )}
              >
                <PositionChip position={p.position} foot={p.side} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <PlayerFlags player={p} />
                  </div>
                  {/* mobile: idade + país; desktop: características */}
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-fg-muted md:hidden">
                    <Flag country={country} /> {p.age} anos · {p.side === 'L' ? 'Canhoto' : 'Destro'}
                  </div>
                  <div className="mt-0.5 hidden truncate text-[11px] text-fg-subtle md:block">
                    {traitLabels.join(' · ') || '—'} · {p.side === 'L' ? 'Canhoto' : 'Destro'}
                  </div>
                </div>
                <span className="hidden min-w-0 items-center gap-1.5 text-xs text-fg-muted md:flex">
                  <Flag country={country} />
                  <span className="truncate">{country?.name ?? '—'}</span>
                </span>
                <span className="tabular hidden text-right text-sm md:block">{p.age}</span>
                <OverallBar value={p.overall} delay={Math.min(i, 20) * 0.02} />
                <span className={cn('tabular hidden text-right text-sm md:block', potentialClass(p.age, p.overall, p.potential))}>{p.potential}<DeclineArrow age={p.age} className="ml-0.5" /></span>
                <span className="tabular hidden text-right text-sm text-fg-muted md:block">{fmtMoney(p.wage)}</span>
                <span className="flex justify-end">
                  <StatusChip status={statusOf(lineup, p.id)} compact className="md:hidden" />
                  <StatusChip status={statusOf(lineup, p.id)} className="hidden md:inline-flex" />
                </span>
              </motion.li>
            );
          })}
        </motion.ul>
        <div className="flex justify-end px-3 pt-3">
          <Link to="/elenco" className="flex items-center gap-1 text-xs font-semibold text-club-accent hover:underline">
            Gerenciar elenco <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
