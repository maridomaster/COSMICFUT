import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpDown, Crown, FilterX, Search, Target, Users } from 'lucide-react';
import type { Country, Player, Position, Trait } from '@cosmicfut/shared';
import { useCurrentClub } from '@/app/ClubContext';
import { useCountryMap, useTraitMap } from '@/data/hooks';
import { summarizeSquad } from '@/data/derive';
import { fmtMoney, POSITION_META, POSITION_ORDER } from '@/lib/format';
import { STATUS_META, statusOf, type LineupStatus } from '@/lib/lineup';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn, normalizeSearch } from '@/lib/utils';
import { useGame } from '@/store/game';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { DualRange } from '@/components/ui/range';
import { Button } from '@/components/ui/button';
import { Flag, OvrBadge, PositionChip } from '@/components/game/bits';
import { MoraleChip } from '@/components/game/chips';
import { PageHeader } from '@/components/ui/page-header';
import { useFitHeight } from '@/lib/useFitHeight';
import { useSeason } from '@/store/season';
import { PlayerFlags, StatusChip, TraitChips } from '@/components/game/player';
import { PlayerDrawer } from '@/components/game/PlayerDrawer';
import { AvailabilityBadges, useHumanStatus, type PlayerStatus } from '@/components/game/status';
import { StaminaBar } from '@/components/game/StaminaBar';
import { ForSaleBadge, ListForSaleButton, useTransferListed } from '@/components/game/market';

type SortKey = 'position' | 'name' | 'age' | 'nationality' | 'overall' | 'potential' | 'traits' | 'wage' | 'value' | 'status';
type Dir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; defaultDir: Dir; className?: string; align?: 'right' }[] = [
  { key: 'position', label: 'Pos', defaultDir: 'asc' },
  { key: 'name', label: 'Jogador', defaultDir: 'asc' },
  { key: 'age', label: 'Id.', defaultDir: 'asc', className: 'hidden md:flex', align: 'right' },
  { key: 'nationality', label: 'Nac', defaultDir: 'asc', className: 'hidden md:flex' },
  { key: 'overall', label: 'OVR', defaultDir: 'desc' },
  { key: 'potential', label: 'Pot', defaultDir: 'desc', className: 'hidden md:flex', align: 'right' },
  { key: 'traits', label: 'Características', defaultDir: 'desc', className: 'hidden xl:flex' },
  { key: 'wage', label: 'Salário', defaultDir: 'desc', className: 'hidden lg:flex', align: 'right' },
  { key: 'value', label: 'Valor', defaultDir: 'desc', className: 'hidden lg:flex', align: 'right' },
  { key: 'status', label: 'Status', defaultDir: 'asc' },
];

/** Grid compartilhado por cabeçalho e linhas (colunas somem por breakpoint). */
const GRID =
  'grid-cols-[2.25rem_minmax(0,1fr)_2.25rem_3.25rem] ' +
  'md:grid-cols-[2.25rem_minmax(0,1fr)_2.5rem_2rem_3.25rem_2.25rem_5.5rem] ' +
  'lg:grid-cols-[2.25rem_minmax(0,1fr)_2.5rem_2rem_3.25rem_2.25rem_4.75rem_4.75rem_5.5rem] ' +
  'xl:grid-cols-[2.25rem_minmax(0,1fr)_2.5rem_2rem_3.25rem_2.25rem_11rem_4.75rem_4.75rem_5.5rem]';

const STATUS_ORDER: LineupStatus[] = ['starter', 'bench', 'out'];

export function SquadPage() {
  const { bundle } = useCurrentClub();
  const players = bundle.players;
  const lineup = useGame((s) => s.lineup);
  const countries = useCountryMap();
  const traits = useTraitMap();
  const summary = useMemo(() => summarizeSquad(players), [players]);
  const statusMap = useHumanStatus();
  const listed = useTransferListed();
  const outCount = [...statusMap.values()].filter((s) => s.injury || s.suspension).length;
  const morale = useSeason((s) => s.save?.season.clubs[bundle.club.id]?.morale);
  const tableRef = useRef<HTMLDivElement>(null);
  useFitHeight(tableRef, { bottom: 18 });

  const bounds = useMemo(() => {
    const ovr = players.map((p) => p.overall);
    const age = players.map((p) => p.age);
    return {
      ovr: [Math.min(...ovr), Math.max(...ovr)] as [number, number],
      age: [Math.min(...age), Math.max(...age)] as [number, number],
    };
  }, [players]);

  const [query, setQuery] = useState('');
  const [positions, setPositions] = useState<Set<Position>>(new Set());
  const [statuses, setStatuses] = useState<Set<LineupStatus>>(new Set());
  const [ovr, setOvr] = useState<[number, number]>(bounds.ovr);
  const [age, setAge] = useState<[number, number]>(bounds.age);
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'position', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtersActive =
    query !== '' || positions.size > 0 || statuses.size > 0 || ovr[0] !== bounds.ovr[0] || ovr[1] !== bounds.ovr[1] || age[0] !== bounds.age[0] || age[1] !== bounds.age[1];

  const clearFilters = () => {
    setQuery('');
    setPositions(new Set());
    setStatuses(new Set());
    setOvr(bounds.ovr);
    setAge(bounds.age);
  };

  const rows = useMemo(() => {
    const q = normalizeSearch(query);
    const filtered = players.filter(
      (p) =>
        (!q || normalizeSearch(p.name).includes(q)) &&
        (positions.size === 0 || positions.has(p.position)) &&
        (statuses.size === 0 || statuses.has(statusOf(lineup, p.id))) &&
        p.overall >= ovr[0] &&
        p.overall <= ovr[1] &&
        p.age >= age[0] &&
        p.age <= age[1],
    );
    return sortPlayers(filtered, sort.key, sort.dir, { lineup, countries, traits });
  }, [players, query, positions, statuses, ovr, age, sort, lineup, countries, traits]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: COLUMNS.find((c) => c.key === key)!.defaultDir }));

  const toggleIn = <T,>(set: Set<T>, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  const selected = selectedId ? (players.find((p) => p.id === selectedId) ?? null) : null;
  const closeDrawer = useCallback(() => setSelectedId(null), []);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const captain = lineup?.captainId ? byId.get(lineup.captainId) : undefined;
  const penalty = lineup?.penaltyTakerId ? byId.get(lineup.penaltyTakerId) : undefined;

  return (
    // (Atualização 41) Elenco compacto: cabeçalho de 1 linha com os números do elenco em chips, filtros numa barra só e
    // tabela densa (linhas de 36px, 1 linha por jogador) que rola por dentro no desktop, com cabeçalho fixo.
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.div variants={fadeUp}>
        <PageHeader
          title="Elenco"
          eyebrow="Gestão"
          meta={`${players.length} jogadores${outCount ? ` · ${outCount} indisponíve${outCount > 1 ? 'is' : 'l'}` : ''}`}
          description="Clique em um jogador para ver o card completo (atributos, contrato, colocar à venda). Passe o mouse para ver características e detalhes."
          actions={
            <div className="flex items-center gap-1.5 max-sm:-mx-3 max-sm:w-[calc(100%+1.5rem)] max-sm:overflow-x-auto max-sm:px-3 sm:flex-wrap" style={{ scrollbarWidth: 'none' }}>
              <Kpi label="OVR médio" value={summary.avgOverall.toFixed(1)} />
              <Kpi label="Idade" value={summary.avgAge.toFixed(1)} />
              <Kpi label="Folha/mês" value={fmtMoney(summary.wageBill)} />
              <Kpi label="Valor" value={fmtMoney(summary.squadValue)} />
              {morale !== undefined && <MoraleChip value={morale} label className="h-7 px-2 whitespace-nowrap" />}
            </div>
          }
        />
      </motion.div>

      {/* Filtros: uma barra só */}
      <motion.div variants={fadeUp}>
        <Card className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="relative w-full sm:w-52">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome…" className="h-8 pl-8 text-[13px]" aria-label="Buscar jogador" />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por posição">
              {POSITION_ORDER.map((pos) => {
                const on = positions.has(pos);
                const meta = POSITION_META[pos];
                return (
                  <button
                    key={pos}
                    type="button"
                    aria-pressed={on}
                    title={meta.label}
                    onClick={() => setPositions((s) => toggleIn(s, pos))}
                    className={cn('h-7 rounded-md px-2 text-[11px] font-bold tracking-wider transition-colors', on ? '' : 'text-fg-muted hover:text-fg')}
                    style={{
                      color: on ? meta.color : undefined,
                      background: on ? `color-mix(in oklab, ${meta.color} 16%, transparent)` : 'var(--color-surface-2)',
                      boxShadow: `inset 0 0 0 1px ${on ? `color-mix(in oklab, ${meta.color} 55%, transparent)` : 'var(--color-line)'}`,
                    }}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por situação">
              {STATUS_ORDER.map((st) => {
                const on = statuses.has(st);
                const meta = STATUS_META[st];
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStatuses((s) => toggleIn(s, st))}
                    className={cn('h-7 rounded-md px-2 text-[11px] font-semibold transition-colors', on ? '' : 'text-fg-muted hover:text-fg')}
                    style={{
                      color: on ? meta.color : undefined,
                      background: on ? `color-mix(in oklab, ${meta.color} 14%, transparent)` : 'var(--color-surface-2)',
                      boxShadow: `inset 0 0 0 1px ${on ? `color-mix(in oklab, ${meta.color} 45%, transparent)` : 'var(--color-line)'}`,
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <DualRange label="Overall" min={bounds.ovr[0]} max={bounds.ovr[1]} value={ovr} onChange={setOvr} className="w-[calc(50%-0.4rem)] sm:w-36" />
            <DualRange label="Idade" min={bounds.age[0]} max={bounds.age[1]} value={age} onChange={setAge} className="w-[calc(50%-0.4rem)] sm:w-36" />
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span>
                <span className="tabular font-bold text-fg">{rows.length}</span>/{players.length}
              </span>
              {captain && (
                <span className="flex items-center gap-1" title={`Capitão: ${captain.name}`}>
                  <Crown className="size-3.5 text-club-accent" /> <span className="max-w-[8rem] truncate">{captain.name}</span>
                </span>
              )}
              {penalty && (
                <span className="flex items-center gap-1" title={`Batedor de pênalti: ${penalty.name}`}>
                  <Target className="size-3.5 text-club-accent" /> <span className="max-w-[8rem] truncate">{penalty.name}</span>
                </span>
              )}
              {/* ordenação no mobile (no desktop: cabeçalhos clicáveis) */}
              <div className="flex items-center gap-1.5 md:hidden">
                <NativeSelect
                  aria-label="Ordenar por"
                  value={sort.key}
                  onChange={(e) => {
                    const key = e.target.value as SortKey;
                    setSort({ key, dir: COLUMNS.find((c) => c.key === key)!.defaultDir });
                  }}
                  className="w-32 [&_select]:h-7 [&_select]:text-xs"
                >
                  {COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-7 px-0"
                  aria-label={sort.dir === 'asc' ? 'Crescente' : 'Decrescente'}
                  onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
                >
                  {sort.dir === 'asc' ? <ArrowUp /> : <ArrowDown />}
                </Button>
              </div>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <FilterX /> Limpar
                </Button>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Tabela */}
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden px-1.5 sm:px-2">
          <div ref={tableRef} className="scrollbar-thin overflow-y-auto" data-testid="squad-table">
            <div
              role="row"
              className={cn('cf-label sticky top-0 z-[1] hidden items-center gap-2 border-b border-line bg-surface px-2 py-1.5 md:grid', GRID)}
            >
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="columnheader"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleSort(c.key)}
                    className={cn(
                      'group flex items-center gap-0.5 uppercase transition-colors hover:text-fg',
                      c.align === 'right' && 'justify-end',
                      active && 'text-club-accent',
                      c.className,
                    )}
                  >
                    <span className="whitespace-nowrap">{c.label}</span>
                    {active ? (
                      sort.dir === 'asc' ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" />
                    ) : (
                      <ArrowUpDown className="hidden size-3 shrink-0 opacity-60 group-hover:inline" />
                    )}
                  </button>
                );
              })}
            </div>
            {rows.length === 0 ? (
              <div className="grid place-items-center gap-2 py-10 text-center text-sm text-fg-muted">
                <Users className="size-6 text-fg-subtle" />
                Nenhum jogador com esses filtros.
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-line/40 py-0.5">
                <AnimatePresence initial={false} mode="popLayout">
                  {rows.map((p, i) => (
                    <SquadRow
                      key={p.id}
                      player={p}
                      index={i}
                      status={statusOf(lineup, p.id)}
                      country={countries.get(p.nationalityId)}
                      traits={traits}
                      availability={statusMap.get(p.id)}
                      forSale={listed.has(p.id)}
                      onOpen={() => setSelectedId(p.id)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </Card>
      </motion.div>

      <PlayerDrawer
        player={selected}
        onClose={closeDrawer}
        countries={countries}
        traits={traits}
        actions={selected ? <ListForSaleButton playerId={selected.id} /> : undefined}
      />
    </motion.div>
  );
}

/** Número-chave compacto do cabeçalho (rótulo 10px + valor 13px numa pílula de 28px). */
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-2 whitespace-nowrap">
      <span className="cf-label">{label}</span>
      <span className="tabular text-[13px] font-bold text-fg">{value}</span>
    </span>
  );
}

function SquadRow({
  player: p,
  index,
  status,
  country,
  traits,
  availability,
  forSale,
  onOpen,
}: {
  player: Player;
  index: number;
  status: LineupStatus;
  country: Country | undefined;
  traits: Map<number, Trait>;
  availability?: PlayerStatus;
  forSale?: boolean;
  onOpen: () => void;
}) {
  const delay = Math.min(index, 18) * 0.012;
  const traitText = p.traits.map((t) => traits.get(t)?.label).filter(Boolean).join(' · ');
  // detalhes secundários no tooltip (antes: 2ª linha de cada jogador)
  const tip = [`${p.name} — ${p.age} anos · ${country?.name ?? '—'} · ${p.side === 'L' ? 'canhoto' : 'destro'}`, `Overall ${p.overall} · potencial ${p.potential}`, traitText && `Características: ${traitText}`, `Salário ${fmtMoney(p.wage)}/mês · valor ${fmtMoney(p.value)}`]
    .filter(Boolean)
    .join('\n');
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, delay, ease: EASE_OUT, layout: { duration: 0.3, ease: EASE_OUT } }}
    >
      <button
        type="button"
        onClick={onOpen}
        title={tip}
        className={cn('cf-row grid w-full cursor-pointer items-center gap-2 px-2 py-1 text-left transition-colors focus-visible:bg-surface-2/70 focus-visible:outline-none md:h-9 md:py-0', GRID)}
      >
        <PositionChip position={p.position} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-body font-semibold">{p.name}</span>
            <PlayerFlags player={p} />
            <AvailabilityBadges status={availability} />
            {forSale && <ForSaleBadge />}
            <StaminaBar value={availability?.fitness ?? 100} className="ml-auto hidden w-12 shrink-0 md:inline-flex" />
          </div>
          {/* mobile: idade, país e stamina numa 2ª linha curta */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-muted md:hidden">
            <Flag country={country} /> <span className="tabular">{p.age}a</span> · pot {p.potential}
            <StaminaBar value={availability?.fitness ?? 100} className="w-12 shrink-0" />
          </div>
        </div>
        <span className="tabular hidden text-right text-[13px] md:block">{p.age}</span>
        <span className="hidden md:flex">
          <Flag country={country} />
        </span>
        <span className="flex justify-end md:justify-start">
          <OvrBadge value={p.overall} size="sm" />
        </span>
        <span className="tabular hidden text-right text-[13px] text-fg-muted md:block">{p.potential}</span>
        <TraitChips player={p} traits={traits} className="hidden flex-nowrap overflow-hidden xl:flex" />
        <span className="tabular hidden text-right text-[13px] text-fg-muted lg:block">{fmtMoney(p.wage)}</span>
        <span className="tabular hidden text-right text-[13px] text-fg-muted lg:block">{fmtMoney(p.value)}</span>
        <span className="flex justify-end md:justify-start">
          <StatusChip status={status} compact className="md:hidden" />
          <StatusChip status={status} className="hidden md:inline-flex" />
        </span>
      </button>
    </motion.li>
  );
}
function sortPlayers(
  players: Player[],
  key: SortKey,
  dir: Dir,
  ctx: { lineup: ReturnType<typeof useGame.getState>['lineup']; countries: Map<number, Country>; traits: Map<number, Trait> },
): Player[] {
  const m = dir === 'asc' ? 1 : -1;
  const statusRank = (p: Player) => {
    const s = statusOf(ctx.lineup, p.id);
    if (s === 'starter') return ctx.lineup!.starters.indexOf(p.id);
    if (s === 'bench') return 100 + ctx.lineup!.bench.indexOf(p.id);
    return 1000;
  };
  const val = (p: Player): number | string => {
    switch (key) {
      case 'position':
        return POSITION_ORDER.indexOf(p.position);
      case 'name':
        return p.name;
      case 'age':
        return p.age;
      case 'nationality':
        return ctx.countries.get(p.nationalityId)?.name ?? '';
      case 'overall':
        return p.overall;
      case 'potential':
        return p.potential;
      case 'traits':
        return p.traits.length;
      case 'wage':
        return p.wage;
      case 'value':
        return p.value;
      case 'status':
        return statusRank(p);
    }
  };
  return [...players].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const d = typeof va === 'string' ? va.localeCompare(vb as string, 'pt-BR') : va - (vb as number);
    return d * m || b.overall - a.overall || a.name.localeCompare(b.name, 'pt-BR');
  });
}
