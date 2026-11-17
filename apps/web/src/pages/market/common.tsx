import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { ClubIndexEntry, Country, Player } from '@cosmicfut/shared';
import { baseClubOf, currentClubOf, type ExternalClubInfo, type SeasonState } from '@cosmicfut/engine';
import { useClubIndex } from '@/data/hooks';
import { cachedBundle, ensureBundles, squads } from '@/data/squads';
import { EASE_OUT } from '@/lib/motion';
import { fmtMoney, overallColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Crest } from '@/components/game/Crest';
import { Flag } from '@/components/game/bits';

/** Índice de clubes (id → entrada) para escudos/nomes de qualquer clube do mundo. */
export function useClubMeta(): Map<string, ClubIndexEntry> {
  const { data } = useClubIndex();
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

export function ClubMini({ id, meta, size = 18, withName, className }: { id: string; meta: Map<string, ClubIndexEntry>; size?: number; withName?: boolean; className?: string }) {
  if (!id) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
        <span className="grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-[8px] font-black text-fg-subtle" style={{ width: size, height: size }}>
          L
        </span>
        {withName && <span className="truncate text-success">Livre</span>}
      </span>
    );
  }
  const c = meta.get(id);
  const b = cachedBundle(id)?.club;
  const name = b?.name ?? c?.name ?? id;
  const paths = size > 24 && b?.crest ? [b.crest, b.crestMini ?? ''] : [c?.crestMini ?? b?.crestMini ?? ''];
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={name}>
      <Crest path={paths.filter(Boolean)} name={name} colors={c?.colors ?? b?.colors ?? { primary: '#555', secondary: '#999' }} size={size} />
      {withName && <span className="truncate">{name}</span>}
    </span>
  );
}

export function clubDisplayName(id: string, meta: Map<string, ClubIndexEntry>): string {
  if (!id) return 'Sem clube';
  return cachedBundle(id)?.club.name ?? meta.get(id)?.name ?? id;
}

/** Bandeira + nome do país (para selects e legendas). */
export function CountryLabel({ country }: { country: Country | undefined }) {
  if (!country) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag country={country} /> {country.name}
    </span>
  );
}

export interface ResolvedPlayer {
  player: Player;
  /** clube atual efetivo ('' = livre) */
  clubId: string;
  /** dados do vendedor quando ele não está na temporada */
  sellerInfo?: ExternalClubInfo;
}

/**
 * Jogador completo (traits, lado, etc.) a partir do id: usa o snapshot do mercado se ele
 * mudou de clube; senão carrega o bundle do clube de origem. Também carrega o elenco do
 * clube atual (a engine usa para avaliar titularidade e o mínimo de 18).
 */
export async function resolvePlayer(state: SeasonState, id: string): Promise<ResolvedPlayer | null> {
  const base = baseClubOf(id);
  const clubId = currentClubOf(state, id);
  await ensureBundles([base, clubId].filter(Boolean));
  const raw = state.market?.players[id] ?? cachedBundle(base)?.players.find((p) => p.id === id);
  // carreira: idade/overall/salário evoluídos (WorldState + evolução mensal) vêm do elenco efetivo;
  // o bundle completa traits/lado/flags (o players-market não tem)
  const live = clubId ? squads(clubId).find((p) => p.id === id) : undefined;
  // (Etapa 5) `rep0` (fator de reputação do valor) vem do elenco efetivo: sem ele o valor/preço sairia só da fórmula
  const player = live && raw
    ? { ...raw, age: live.age, overall: live.overall, potential: live.potential, wage: live.wage, value: live.value, youth: live.youth, ...(live.rep0 !== undefined ? { rep0: live.rep0 } : {}) }
    : (raw ?? live);
  if (!player) return null;
  let sellerInfo: ExternalClubInfo | undefined;
  if (clubId && !state.clubs[clubId]) {
    const c = cachedBundle(clubId)?.club;
    if (c) sellerInfo = { name: c.name, reputation: c.reputation, division: c.division ?? 1, balance: c.finances.balance, capacity: c.stadium.capacity };
  }
  return { player, clubId, sellerInfo };
}

/** Barra comparativa (jogador alvo × seu titular). */
export function CompareBar({ label, a, b, fmt = (v: number) => String(v), invert, delay = 0 }: { label: string; a: number; b: number | undefined; fmt?: (v: number) => string; invert?: boolean; delay?: number }) {
  const max = Math.max(1, a, b ?? 0);
  const better = b === undefined ? null : invert ? a < b : a > b;
  const diff = b === undefined ? 0 : a - b;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold tracking-wider text-fg-muted uppercase">{label}</span>
        {b !== undefined && diff !== 0 && (
          <span className={cn('tabular font-bold', better ? 'text-success' : 'text-danger')}>
            {diff > 0 ? '+' : '−'}
            {fmt(Math.abs(diff))}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full rounded-full bg-club-accent" initial={{ width: 0 }} animate={{ width: `${(a / max) * 100}%` }} transition={{ duration: 0.6, delay, ease: EASE_OUT }} />
          </div>
          <span className="tabular w-12 text-right text-xs font-bold">{fmt(a)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.div className="h-full rounded-full bg-fg-subtle" initial={{ width: 0 }} animate={{ width: `${((b ?? 0) / max) * 100}%` }} transition={{ duration: 0.6, delay: delay + 0.05, ease: EASE_OUT }} />
          </div>
          <span className="tabular w-12 text-right text-xs text-fg-muted">{b === undefined ? '—' : fmt(b)}</span>
        </div>
      </div>
    </div>
  );
}

export const money = (v: number) => fmtMoney(v);
export const ovrStyle = (v: number) => ({ color: overallColor(v) });

/** Escala logarítmica de valores para o slider de valor. */
export const VALUE_STEPS = [0, 50e3, 100e3, 250e3, 500e3, 1e6, 2e6, 3e6, 5e6, 7.5e6, 10e6, 15e6, 20e6, 30e6, 50e6, 75e6, 100e6, 150e6, 250e6];
