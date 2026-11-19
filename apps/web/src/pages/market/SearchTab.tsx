import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FitScroll } from '@/components/ui/fit-scroll';
import { useFitHeight } from '@/lib/useFitHeight';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, FilterX, Gauge, Loader2, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import type { ClubIndexEntry, Country, Position } from '@cosmicfut/shared';
import { useLeagueMap } from '@/data/hooks';
import { POSITION_META, POSITION_ORDER } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { DualRange } from '@/components/ui/range';
import { Flag, FootChip, OvrBadge, PositionChip, potentialClass, potentialMaxed } from '@/components/game/bits';
import { ClubMini, money, VALUE_STEPS } from './common';
import { searchMarket, useSearchStatus } from './searchClient';
import type { MarketRowOut, SearchQuery, SortDir, SortKey } from './searchTypes';

const CHUNK = 120;

export interface SearchFilters {
  name: string;
  positions: Position[];
  ovr: [number, number];
  pot: [number, number];
  age: [number, number];
  /** índices em VALUE_STEPS */
  value: [number, number];
  clubCountry: number | null;
  nat: number | null;
  league: string | null;
  club: string | null;
  budget: boolean;
  freeOnly: boolean;
  /** (18/11) pé bom: 'R' destro, 'L' canhoto */
  foot: 'R' | 'L' | null;
  hideMine: boolean;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_FILTERS: SearchFilters = {
  name: '',
  positions: [],
  ovr: [40, 99],
  pot: [40, 99],
  age: [17, 45],
  value: [0, VALUE_STEPS.length - 1],
  clubCountry: null,
  nat: null,
  league: null,
  club: null,
  budget: false,
  freeOnly: false,
  foot: null,
  hideMine: true,
  sort: 'ovr',
  dir: 'desc',
};

const COLS: { key: SortKey; label: string; dir: SortDir; className?: string; right?: boolean }[] = [
  { key: 'club', label: 'Clube', dir: 'asc' },
  { key: 'nat', label: 'Nac', dir: 'asc' },
  { key: 'pos', label: 'Pos', dir: 'asc' },
  { key: 'name', label: 'Jogador', dir: 'asc' },
  { key: 'age', label: 'Id.', dir: 'asc', right: true },
  { key: 'ovr', label: 'OVR', dir: 'desc' },
  { key: 'pot', label: 'Pot.', dir: 'desc', right: true },
  { key: 'value', label: 'Valor', dir: 'desc', right: true },
  { key: 'wage', label: 'Salário', dir: 'desc', right: true, className: 'hidden xl:flex' },
];

// (18/11) em telas médias o salário some (aparece no xl) para sobrar espaço ao nome do jogador
export const ROW_GRID = 'md:grid-cols-[1.25rem_1.5rem_3.5rem_minmax(6rem,1fr)_2.25rem_2.75rem_2.25rem_4.75rem_2rem] xl:grid-cols-[1.25rem_1.5rem_3.5rem_minmax(0,1fr)_2.25rem_2.75rem_2.25rem_4.75rem_4.5rem_2rem]';

export function SearchTab({
  filters,
  setFilters,
  humanId,
  balance,
  countries,
  clubMeta,
  onOpen,
}: {
  filters: SearchFilters;
  setFilters: (f: SearchFilters | ((f: SearchFilters) => SearchFilters)) => void;
  humanId: string;
  balance: number;
  countries: Map<number, Country>;
  clubMeta: Map<string, ClubIndexEntry>;
  onOpen: (id: string) => void;
}) {
  const status = useSearchStatus();
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState(filters.name);
  // nome com debounce curto; os demais filtros consultam na hora
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.name === name ? f : { ...f, name })), 140);
    return () => clearTimeout(t);
  }, [name, setFilters]);

  const query = useMemo<SearchQuery>(
    () => ({
      name: filters.name,
      positions: filters.positions,
      ovr: filters.ovr,
      pot: filters.pot,
      age: filters.age,
      value: [VALUE_STEPS[filters.value[0]], filters.value[1] >= VALUE_STEPS.length - 1 ? null : VALUE_STEPS[filters.value[1]]],
      clubCountry: filters.clubCountry,
      nat: filters.nat,
      league: filters.league,
      club: filters.club,
      maxValue: filters.budget ? Math.max(0, balance) : null,
      freeOnly: filters.freeOnly,
      foot: filters.foot ?? null,
      excludeClub: filters.hideMine ? humanId : null,
      sort: filters.sort,
      dir: filters.dir,
    }),
    [filters, balance, humanId],
  );

  const { rows, total, ms, roundTrip, loading, ensureRange } = useResults(query, status.status === 'ready', status.rev);
  const active = JSON.stringify({ ...filters, sort: 0, dir: 0 }) !== JSON.stringify({ ...DEFAULT_FILTERS, sort: 0, dir: 0 });
  const activeCount =
    (filters.positions.length ? 1 : 0) +
    (filters.ovr.join() !== DEFAULT_FILTERS.ovr.join() ? 1 : 0) +
    (filters.pot.join() !== DEFAULT_FILTERS.pot.join() ? 1 : 0) +
    (filters.age.join() !== DEFAULT_FILTERS.age.join() ? 1 : 0) +
    (filters.value.join() !== DEFAULT_FILTERS.value.join() ? 1 : 0) +
    [filters.clubCountry, filters.nat, filters.league, filters.club].filter((v) => v !== null).length +
    (filters.budget ? 1 : 0) +
    (filters.freeOnly ? 1 : 0) +
    (filters.foot ? 1 : 0);

  const toggleSort = (key: SortKey) =>
    setFilters((f) => (f.sort === key ? { ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' } : { ...f, sort: key, dir: COLS.find((c) => c.key === key)!.dir }));
  const clear = () => {
    setName('');
    setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir });
  };

  const panel = <FilterPanel filters={filters} setFilters={setFilters} countries={countries} clubMeta={clubMeta} balance={balance} />;
  // (Atualização 41) no desktop a lista rola dentro do card (até o fim da tela); no celular, a página
  const boxRef = useRef<HTMLDivElement>(null);
  useFitHeight(boxRef, { bottom: 28, min: 320 });

  return (
    <div className="space-y-2.5">
      {/* barra de busca */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Buscar entre todos os jogadores do mundo…" className="pl-9" aria-label="Buscar jogador por nome" />
          {name && (
            <button aria-label="Limpar busca" onClick={() => setName('')} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-subtle hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" className="relative lg:hidden" onClick={() => setSheet(true)} aria-label="Abrir filtros">
          <SlidersHorizontal /> <span className="hidden sm:inline">Filtros</span>
          {activeCount > 0 && <span className="tabular grid size-5 place-items-center rounded-full bg-club-accent text-[10px] font-black text-club-on-accent">{activeCount}</span>}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        {/* filtros (desktop): rolam por dentro se não couberem */}
        <Card className="hidden p-0 lg:block">
          <FitScroll className="p-3" bottom={20}>{panel}</FitScroll>
        </Card>

        <Card className="min-w-0 px-1.5 pt-1.5 pb-1 sm:px-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1.5">
            <div className="flex items-center gap-2 text-xs text-fg-muted" aria-live="polite">
              {status.status === 'loading' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Carregando a base de jogadores do mundo…
                </>
              ) : status.status === 'error' ? (
                <span className="text-danger">Não foi possível carregar a busca ({status.error}). Recarregue a página para tentar de novo.</span>
              ) : (
                <>
                  <span>
                    <b className="tabular text-fg">{total.toLocaleString('pt-BR')}</b> {total === 1 ? 'jogador' : 'jogadores'}
                  </span>
                  {import.meta.env.DEV && (
                    <span className="hidden items-center gap-1 text-fg-subtle sm:inline-flex" title="(dev) tempo do filtro no worker · ida e volta">
                      <Gauge className="size-3.5" /> {ms.toFixed(1)} ms · {roundTrip.toFixed(0)} ms
                    </span>
                  )}
                  {loading && <Loader2 className="size-3.5 animate-spin" />}
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 md:hidden">
                <NativeSelect
                  aria-label="Ordenar por"
                  value={filters.sort}
                  onChange={(e) => {
                    const key = e.target.value as SortKey;
                    setFilters((f) => ({ ...f, sort: key, dir: COLS.find((c) => c.key === key)!.dir }));
                  }}
                  className="w-32 [&_select]:h-8 [&_select]:text-xs"
                >
                  {COLS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button variant="outline" size="sm" className="w-8 px-0" aria-label={filters.dir === 'asc' ? 'Crescente' : 'Decrescente'} onClick={() => setFilters((f) => ({ ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' }))}>
                  {filters.dir === 'asc' ? <ArrowUp /> : <ArrowDown />}
                </Button>
              </div>
              {active && (
                <Button variant="ghost" size="sm" onClick={clear}>
                  <FilterX /> Limpar
                </Button>
              )}
            </div>
          </div>

          <div ref={boxRef} className="scrollbar-thin lg:overflow-y-auto" data-testid="market-results">
          {/* cabeçalho (desktop) */}
          <div role="row" className={cn('cf-label sticky top-0 z-[1] hidden items-center gap-2 border-y border-line bg-surface px-2 py-1.5 md:grid', ROW_GRID)}>
            {COLS.map((c) => {
              const on = filters.sort === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="columnheader"
                  aria-sort={on ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => toggleSort(c.key)}
                  className={cn('group flex items-center gap-0.5 uppercase hover:text-fg', c.right && 'justify-end', on && 'text-club-accent', c.className)}
                  title={`Ordenar por ${c.label}`}
                >
                  <span className="whitespace-nowrap">{c.key === 'club' ? '' : c.label}</span>
                  {on ? filters.dir === 'asc' ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" /> : <ArrowUpDown className="hidden size-3 shrink-0 opacity-60 group-hover:inline" />}
                </button>
              );
            })}
            <span />
          </div>

          {status.status === 'ready' && total === 0 && !loading ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-sm text-fg-muted">
              <Eye className="size-8 text-fg-subtle" />
              Nenhum jogador com esses filtros.
              <Button variant="outline" size="sm" onClick={clear}>
                Limpar filtros
              </Button>
            </div>
          ) : (
            <VirtualList total={status.status === 'ready' ? total : 12} rows={rows} ensureRange={ensureRange} onOpen={onOpen} countries={countries} clubMeta={clubMeta} boxRef={boxRef} />
          )}
          </div>
        </Card>
      </div>

      {/* filtros (mobile): bottom sheet */}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filtros" footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={clear}>
            <FilterX /> Limpar
          </Button>
          <Button variant="club" className="flex-1" onClick={() => setSheet(false)}>
            Ver {total.toLocaleString('pt-BR')}
          </Button>
        </div>
      }>
        {panel}
      </Sheet>
    </div>
  );
}

/* ───────────── resultados incrementais ───────────── */

function useResults(query: SearchQuery, ready: boolean, rev: number) {
  const [state, setState] = useState<{ key: string; rows: Map<number, MarketRowOut>; total: number; ms: number; roundTrip: number; loading: boolean }>({
    key: '',
    rows: new Map(),
    total: 0,
    ms: 0,
    roundTrip: 0,
    loading: true,
  });
  // a revisão do índice de mercado entra na chave: depois de um Continuar/virada a consulta é refeita
  const key = JSON.stringify(query) + '#' + rev;
  const inflight = useRef(new Set<string>());
  const keyRef = useRef(key);
  keyRef.current = key;

  const fetchChunk = useCallback(
    (offset: number, reset: boolean) => {
      const k = keyRef.current;
      const tag = `${k}@${offset}`;
      if (inflight.current.has(tag)) return;
      inflight.current.add(tag);
      if (reset) setState((s) => ({ ...s, loading: true }));
      void searchMarket(JSON.parse(k.slice(0, k.lastIndexOf('#'))) as SearchQuery, offset, CHUNK).then((r) => {
        inflight.current.delete(tag);
        if (keyRef.current !== k) return;
        setState((s) => {
          const rows = reset || s.key !== k ? new Map<number, MarketRowOut>() : new Map(s.rows);
          r.rows.forEach((row, i) => rows.set(offset + i, row));
          return { key: k, rows, total: r.total, ms: reset ? r.ms : s.ms, roundTrip: reset ? r.roundTripMs : s.roundTrip, loading: false };
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    fetchChunk(0, true);
  }, [key, ready, fetchChunk]);

  const ensureRange = useCallback(
    (start: number, end: number) => {
      if (!ready || state.key !== keyRef.current) return;
      for (let c = Math.floor(start / CHUNK) * CHUNK; c < Math.min(end, state.total); c += CHUNK) {
        if (!state.rows.has(c)) fetchChunk(c, false);
      }
    },
    [ready, state, fetchChunk],
  );

  return { rows: state.rows, total: state.total, ms: state.ms, roundTrip: state.roundTrip, loading: state.loading, ensureRange };
}

/* ───────────── lista virtualizada (rolagem da janela) ───────────── */

function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setD(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}

function VirtualList({
  total,
  rows,
  ensureRange,
  onOpen,
  countries,
  clubMeta,
  boxRef,
}: {
  total: number;
  rows: Map<number, MarketRowOut>;
  ensureRange: (a: number, b: number) => void;
  onOpen: (id: string) => void;
  countries: Map<number, Country>;
  clubMeta: Map<string, ClubIndexEntry>;
  /** (Atualização 41) caixa de rolagem do desktop (lista dentro do card); sem limite, rola a janela */
  boxRef?: RefObject<HTMLDivElement | null>;
}) {
  const desktop = useIsDesktop();
  // (Atualização 41) linhas densas: 36px no desktop (antes 48), 60px no celular (antes 76)
  const h = desktop ? 36 : 60;
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 30]);
  useLayoutEffect(() => {
    const box = boxRef?.current ?? null;
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      // caixa com rolagem própria (desktop) ou a janela (celular)
      const boxed = !!box && box.scrollHeight > box.clientHeight + 1;
      const viewTop = boxed ? box.getBoundingClientRect().top : 0;
      const top = el.getBoundingClientRect().top - viewTop;
      const vh = boxed ? box.clientHeight : window.innerHeight;
      const start = Math.max(0, Math.floor(-top / h) - 6);
      const end = Math.min(total, Math.ceil((vh - top) / h) + 6);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, Math.max(start, end)]));
    };
    calc();
    const late = window.setTimeout(calc, 500);
    window.addEventListener('scroll', calc, { passive: true });
    window.addEventListener('resize', calc);
    box?.addEventListener('scroll', calc, { passive: true });
    return () => {
      window.clearTimeout(late);
      window.removeEventListener('scroll', calc);
      window.removeEventListener('resize', calc);
      box?.removeEventListener('scroll', calc);
    };
  }, [h, total, boxRef]);
  useEffect(() => ensureRange(range[0], range[1] + 40), [range, ensureRange]);

  const shortlist = useGame((s) => s.shortlist);
  const items: ReactNode[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const r = rows.get(i);
    items.push(
      <div key={r ? r.id : `sk${i}`} className="absolute inset-x-0" style={{ top: i * h, height: h }}>
        {r ? <ResultRow row={r} onOpen={onOpen} country={countries.get(r.nat)} clubMeta={clubMeta} watched={shortlist.includes(r.id)} /> : <SkeletonRow />}
      </div>,
    );
  }
  return (
    <div ref={ref} className="relative" style={{ height: Math.max(1, total) * h }} role="rowgroup" aria-rowcount={total}>
      {items}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex h-full items-center gap-3 px-3">
      <div className="size-5 rounded bg-surface-3" />
      <div className="h-3 flex-1 animate-pulse rounded bg-surface-3/70" />
      <div className="h-3 w-16 animate-pulse rounded bg-surface-3/70" />
    </div>
  );
}

export function ResultRow({
  row: r,
  onOpen,
  country,
  clubMeta,
  watched,
  trailing,
}: {
  row: MarketRowOut;
  onOpen: (id: string) => void;
  country: Country | undefined;
  clubMeta: Map<string, ClubIndexEntry>;
  watched?: boolean;
  trailing?: ReactNode;
}) {
  const toggle = useGame((s) => s.toggleShortlist);
  return (
    <div role="row" className="group relative h-full">
      <button
        type="button"
        onClick={() => onOpen(r.id)}
        className={cn(
          'h-full w-full cursor-pointer rounded-md px-2 text-left transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2/70 focus-visible:outline-none',
          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:gap-2',
          ROW_GRID,
        )}
      >
        {/* mobile: card */}
        <div className="flex min-w-0 items-center gap-2.5 md:hidden">
          <ClubMini id={r.clubId} meta={clubMeta} size={28} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <PositionChip position={r.pos} className="h-4 w-8 text-[9px]" />
              {r.foot && <FootChip side={r.foot} compact className="h-4 text-[9px]" />}
              <span className="truncate text-sm font-semibold">{r.name}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
              <Flag country={country} />
              <span className="tabular shrink-0">{r.age}a</span>
              <span>·</span>
              <span className="truncate">{r.clubId ? (clubMeta.get(r.clubId)?.name ?? r.clubId) : <span className="text-success">Livre</span>}</span>
            </div>
          </div>
        </div>
        <div className="text-right md:hidden">
          <div className="tabular flex items-center justify-end leading-none font-black">
            <OvrBadge value={r.ovr} size="md" />
            <span className={cn('ml-1 text-[10px] font-semibold', potentialClass(r.age, r.ovr, r.pot, 'text-fg-subtle'))} title={potentialMaxed(r.age, r.ovr, r.pot) ? 'Potencial esgotado' : undefined}>/{r.pot}</span>
          </div>
          <div className="tabular mt-1 text-[11px] text-fg-muted">{money(r.value)}</div>
        </div>

        {/* desktop: linha */}
        <span className="hidden md:block">
          <ClubMini id={r.clubId} meta={clubMeta} size={20} />
        </span>
        <span className="hidden md:block">
          <Flag country={country} />
        </span>
        <span className="hidden items-center gap-1 md:flex">
          <PositionChip position={r.pos} />
          {r.foot && <FootChip side={r.foot} compact />}
        </span>
        <span className="hidden min-w-0 md:block">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] leading-4 font-semibold">{r.name}</span>
            {r.youth && r.age <= 20 && <span className="rounded bg-success/15 px-1 text-[9px] font-bold text-success">BASE</span>}
          </span>
          <span className="block truncate text-[10.5px] leading-3.5 text-fg-subtle">{r.clubId ? (clubMeta.get(r.clubId)?.name ?? r.clubId) : 'Sem clube'}</span>
        </span>
        <span className="tabular hidden text-right text-[13px] md:block">{r.age}</span>
        <span className="hidden md:flex">
          <OvrBadge value={r.ovr} />
        </span>
        <span className={cn('tabular hidden text-right text-[13px] md:block', potentialClass(r.age, r.ovr, r.pot))} title={potentialMaxed(r.age, r.ovr, r.pot) ? 'Potencial esgotado' : undefined}>{r.pot}</span>
        <span className="tabular hidden text-right text-[13px] whitespace-nowrap md:block">{money(r.value)}</span>
        <span className="tabular hidden text-right text-[13px] whitespace-nowrap text-fg-muted xl:block">{money(r.wage)}</span>
        <span className="hidden md:block" />
      </button>
      <div className="absolute top-1/2 right-2 hidden -translate-y-1/2 items-center gap-1 md:flex">
        {trailing}
        <button
          type="button"
          aria-label={watched ? `Deixar de observar ${r.name}` : `Observar ${r.name}`}
          aria-pressed={watched}
          onClick={() => toggle(r.id)}
          className={cn('grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-3', watched ? 'text-warning' : 'text-fg-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <Star className="size-4" fill={watched ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
}

/* ───────────── painel de filtros ───────────── */

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  const c = color ?? 'var(--club-accent)';
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('h-7 rounded-md px-2 text-[11px] font-bold tracking-wide transition-all', on ? '' : 'text-fg-muted hover:text-fg')}
      style={{
        color: on ? c : undefined,
        background: on ? `color-mix(in oklab, ${c} 16%, transparent)` : 'var(--color-surface-2)',
        boxShadow: `inset 0 0 0 1px ${on ? `color-mix(in oklab, ${c} 55%, transparent)` : 'var(--color-line)'}`,
      }}
    >
      {children}
    </button>
  );
}

function FilterPanel({
  filters: f,
  setFilters,
  countries,
  clubMeta,
  balance,
}: {
  filters: SearchFilters;
  setFilters: (f: SearchFilters | ((f: SearchFilters) => SearchFilters)) => void;
  countries: Map<number, Country>;
  clubMeta: Map<string, ClubIndexEntry>;
  balance: number;
}) {
  const facets = useSearchStatus((s) => s.facets);
  const leagueMap = useLeagueMap();
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((x) => ({ ...x, [k]: v }));
  const byName = (ids: number[]) => ids.map((id) => countries.get(id)).filter((c): c is Country => !!c).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const clubCountries = useMemo(() => byName(facets?.clubCountries ?? []), [facets, countries]); // eslint-disable-line react-hooks/exhaustive-deps
  const nats = useMemo(() => byName(facets?.nats ?? []), [facets, countries]); // eslint-disable-line react-hooks/exhaustive-deps
  const leagues = useMemo(
    () =>
      (facets?.leagues ?? [])
        .map((id) => leagueMap.get(id))
        .filter((d): d is NonNullable<typeof d> => !!d && (f.clubCountry === null || d.countryId === f.clubCountry))
        .sort((a, b) => a.countryId - b.countryId || a.division - b.division),
    [facets, leagueMap, f.clubCountry],
  );
  const clubsOfLeague = useMemo(
    () => (f.league ? [...clubMeta.values()].filter((c) => c.leagueId === f.league).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : []),
    [clubMeta, f.league],
  );
  const vfmt = (i: number) => (i >= VALUE_STEPS.length - 1 ? 'máx' : money(VALUE_STEPS[i]).replace(/^(R\$|€) /, ''));

  return (
    <div className="space-y-3">
      <div>
        <div className="cf-label mb-1 text-fg-muted">Posição</div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por posição">
          {POSITION_ORDER.map((p) => (
            <Chip key={p} on={f.positions.includes(p)} color={POSITION_META[p].color} onClick={() => set('positions', f.positions.includes(p) ? f.positions.filter((x) => x !== p) : [...f.positions, p])}>
              {POSITION_META[p].short}
            </Chip>
          ))}
        </div>
      </div>
      <DualRange label="Overall" min={40} max={99} value={f.ovr} onChange={(v) => set('ovr', v)} />
      <DualRange label="Potencial" min={40} max={99} value={f.pot} onChange={(v) => set('pot', v)} />
      <DualRange label="Idade" min={17} max={45} value={f.age} onChange={(v) => set('age', v)} />
      <DualRange label="Valor" min={0} max={VALUE_STEPS.length - 1} value={f.value} onChange={(v) => set('value', v)} format={vfmt} />

      <div className="space-y-2">
        <SelectWithFlag label="País do clube" country={f.clubCountry !== null ? countries.get(f.clubCountry) : undefined}>
          <NativeSelect aria-label="País do clube" value={f.clubCountry ?? ''} onChange={(e) => setFilters((x) => ({ ...x, clubCountry: e.target.value === '' ? null : Number(e.target.value), league: null, club: null }))}>
            <option value="">Todos os países</option>
            {clubCountries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </SelectWithFlag>
        <NativeSelect aria-label="Liga" value={f.league ?? ''} onChange={(e) => setFilters((x) => ({ ...x, league: e.target.value || null, club: null }))}>
          <option value="">Todas as ligas</option>
          {leagues.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.divisionName}
            </option>
          ))}
        </NativeSelect>
        {f.league && (
          <NativeSelect aria-label="Clube" value={f.club ?? ''} onChange={(e) => set('club', e.target.value || null)}>
            <option value="">Todos os clubes da liga</option>
            {clubsOfLeague.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <SelectWithFlag label="Nacionalidade" country={f.nat !== null ? countries.get(f.nat) : undefined}>
          <NativeSelect aria-label="Nacionalidade" value={f.nat ?? ''} onChange={(e) => set('nat', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Todas as nacionalidades</option>
            {nats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </SelectWithFlag>
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip on={f.budget} onClick={() => set('budget', !f.budget)}>
          Cabe no orçamento{f.budget ? ` (${money(Math.max(0, balance))})` : ''}
        </Chip>
        <Chip on={f.freeOnly} onClick={() => set('freeOnly', !f.freeOnly)}>
          Só livres
        </Chip>
        <Chip on={f.foot === 'R'} onClick={() => set('foot', f.foot === 'R' ? null : 'R')}>
          Destros
        </Chip>
        <Chip on={f.foot === 'L'} onClick={() => set('foot', f.foot === 'L' ? null : 'L')}>
          Canhotos
        </Chip>
        <Chip on={!f.hideMine} onClick={() => set('hideMine', !f.hideMine)}>
          Incluir meu elenco
        </Chip>
      </div>
    </div>
  );
}

function SelectWithFlag({ label, country, children }: { label: string; country: Country | undefined; children: ReactNode }) {
  return (
    <div>
      <div className="cf-label mb-1 flex items-center gap-1.5 text-fg-muted">
        {label} {country && <Flag country={country} />}
      </div>
      {children}
    </div>
  );
}

/* ───────────── bottom sheet ───────────── */

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="s" className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            key="p"
            role="dialog"
            aria-modal
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-line-strong" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2">
              <h2 className="text-base font-bold">{title}</h2>
              <button aria-label="Fechar" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2">
                <X className="size-5" />
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            {footer && <div className="border-t border-line p-3">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
