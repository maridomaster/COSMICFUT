import { motion } from 'motion/react';
import type { Competition, Fixture, StandingRow } from '@cosmicfut/engine';
import { fmtDate } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { standingsOf, zoneOf, type Zone } from '@/season/view';
import { ClubCrest, clubLabel } from './status';

const FORM_META = {
  W: { label: 'V', title: 'Vitória', cls: 'bg-success text-[#052e1c]' },
  D: { label: 'E', title: 'Empate', cls: 'bg-fg-subtle text-bg' },
  L: { label: 'D', title: 'Derrota', cls: 'bg-danger text-[#3b0a0a]' },
} as const;

/** Bolinhas de forma (V/E/D), mais antiga → mais recente. */
export function FormDots({ form, size = 'md', className }: { form: ('W' | 'D' | 'L')[]; size?: 'sm' | 'md'; className?: string }) {
  if (!form.length) return <span className={cn('text-[11px] text-fg-subtle', className)}>—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={`Forma: ${form.map((f) => FORM_META[f].label).join(' ')}`}>
      {form.map((f, i) => (
        <span
          key={i}
          title={FORM_META[f].title}
          className={cn(
            'grid place-items-center rounded-full font-black',
            size === 'sm' ? 'size-3.5 text-[8px]' : 'size-[18px] text-[9px]',
            FORM_META[f].cls,
            i === form.length - 1 && 'ring-2 ring-white/25',
          )}
        >
          {FORM_META[f].label}
        </span>
      ))}
    </span>
  );
}

export const ZONE_META: Record<Exclude<Zone, null>, { label: string; color: string }> = {
  champion: { label: 'Campeão', color: 'var(--color-warning)' },
  promotion: { label: 'Acesso', color: 'var(--color-success)' },
  qualify: { label: 'Classificação', color: '#38bdf8' },
  libertadores: { label: 'Libertadores', color: '#3b82f6' },
  libpre: { label: 'Libertadores (2ª fase)', color: '#a78bfa' },
  sula: { label: 'Sul-Americana', color: '#2dd4bf' },
  // (Etapa 2) vagas UEFA/AFC e playoffs
  ucl: { label: 'Liga dos Campeões', color: '#2563eb' },
  uel: { label: 'Liga Europa', color: '#f97316' },
  uecl: { label: 'Liga Conferência', color: '#22c55e' },
  acl: { label: 'AFC Elite', color: '#0ea5e9' },
  aclpo: { label: 'AFC Elite (playoff)', color: '#7dd3fc' },
  koplayoff: { label: 'Playoff das oitavas', color: '#a78bfa' },
  promoplayoff: { label: 'Playoff de acesso', color: '#84cc16' },
  relplayoff: { label: 'Playoff de rebaixamento', color: '#fb923c' },
  relegation: { label: 'Rebaixamento', color: 'var(--color-danger)' },
};

const ZONE_ORDER = [
  'champion', 'promotion', 'promoplayoff', 'qualify', 'koplayoff', 'ucl', 'uel', 'uecl', 'acl', 'aclpo', 'libertadores', 'libpre', 'sula', 'relplayoff', 'relegation',
] as const;

/**
 * Legenda das zonas. Com `zones` explícitas (competições com formato) mostra só elas; sem, deduz da
 * competição simples (promoted/relegated).
 */
export function ZoneLegend({ comp, zones: given }: { comp: Competition; zones?: Exclude<Zone, null>[] }) {
  const zones: Exclude<Zone, null>[] = given ? given.slice() : [];
  if (!given) {
    if ((comp.division ?? 1) === 1 || comp.promoted === 0) zones.push('champion');
    if (comp.promoted > 0) zones.push('promotion');
    if (comp.relegated > 0) zones.push('relegation');
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
      {zones.map((z) => (
        <span key={z} className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded-full" style={{ background: ZONE_META[z].color }} />
          {ZONE_META[z].label}
          {!given && z === 'promotion' && ` (${comp.promoted})`}
          {!given && z === 'relegation' && ` (${comp.relegated})`}
        </span>
      ))}
    </div>
  );
}

/** Zonas presentes numa tabela (para a legenda). */
export function zonesIn(total: number, zone: (pos: number) => Zone): Exclude<Zone, null>[] {
  const s = new Set<Exclude<Zone, null>>();
  for (let p = 1; p <= total; p++) {
    const z = zone(p);
    if (z) s.add(z);
  }
  return ZONE_ORDER.filter((z) => s.has(z));
}

/**
 * (Fase 2) Sobrepõe as vagas continentais projetadas (por clube) às zonas da tabela: título e rebaixamento
 * continuam valendo; nas demais posições vale a vaga do clube daquela posição.
 */
export function withQualZones(rows: StandingRow[], zone: (pos: number) => Zone, qual: Map<string, 'libertadores' | 'libpre' | 'sula'> | null | undefined): (pos: number) => Zone {
  if (!qual?.size) return zone;
  return (pos) => {
    const base = zone(pos);
    if (base === 'champion' || base === 'relegation') return base;
    return qual.get(rows[pos - 1]?.clubId ?? '') ?? base;
  };
}

/** Tabela de classificação completa ou compacta (mini card). */
export function StandingsTable({
  comp,
  highlightId,
  compact,
  rows: rowsProp,
  limitAround,
  zone: zoneProp,
}: {
  comp: Competition;
  highlightId?: string;
  compact?: boolean;
  rows?: StandingRow[];
  /** compacto: mostra só N linhas ao redor do clube destacado (+ líder) */
  limitAround?: number;
  /** zona por posição (competições com formato); padrão: deduzida de promoted/relegated */
  zone?: (pos: number) => Zone;
}) {
  const all = rowsProp ?? standingsOf(comp);
  const total = all.length;
  let visible = all.map((r, i) => ({ r, pos: i + 1 }));
  if (limitAround && highlightId) {
    const idx = all.findIndex((r) => r.clubId === highlightId);
    const start = Math.max(0, Math.min(idx - Math.floor(limitAround / 2), total - limitAround));
    visible = visible.slice(start, start + limitAround);
  }
  const grid = compact
    ? 'grid-cols-[1.5rem_minmax(0,1fr)_1.75rem_2rem_2.25rem]'
    : 'grid-cols-[1.75rem_minmax(0,1fr)_2rem_2.5rem] @lg:grid-cols-[2rem_minmax(0,1fr)_repeat(7,2rem)_2.5rem] @2xl:grid-cols-[2rem_minmax(0,1fr)_repeat(7,2.3rem)_2.75rem_6.5rem]';
  return (
    <div role="table" aria-label={`Classificação — ${comp.name}`} className={cn('@container', compact ? 'text-xs' : 'text-sm')}>
      <div role="row" className={cn('cf-label grid items-center gap-1.5 px-2 pb-1', grid)}>
        <span>#</span>
        <span>Clube</span>
        {compact ? (
          <>
            <span className="text-right">J</span>
            <span className="text-right">SG</span>
            <span className="text-right">Pts</span>
          </>
        ) : (
          <>
            <span className="text-right">J</span>
            <span className="hidden text-right @lg:block">V</span>
            <span className="hidden text-right @lg:block">E</span>
            <span className="hidden text-right @lg:block">D</span>
            <span className="hidden text-right @lg:block">GP</span>
            <span className="hidden text-right @lg:block">GC</span>
            <span className="hidden text-right @lg:block">SG</span>
            <span className="text-right">Pts</span>
            <span className="hidden pl-2 @2xl:block">Forma</span>
          </>
        )}
      </div>
      <ul className="space-y-0.5">
        {visible.map(({ r, pos }, i) => {
          const zone = zoneProp ? zoneProp(pos) : zoneOf(comp, pos, total);
          const me = r.clubId === highlightId;
          const sg = r.goalsFor - r.goalsAgainst;
          return (
            <motion.li
              key={r.clubId}
              layout="position"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i, 20) * 0.015, ease: EASE_OUT, layout: { duration: 0.4 } }}
              role="row"
              className={cn(
                cn('relative grid items-center gap-1.5 rounded-md px-2', compact ? 'py-[3px]' : 'py-1'),
                grid,
                me ? 'bg-club-accent/12 ring-1 ring-club-accent/45' : 'odd:bg-surface-2/35',
              )}
            >
              {zone && <span aria-hidden className="absolute top-1 bottom-1 left-0 w-[3px] rounded-r-full" style={{ background: ZONE_META[zone].color }} />}
              <span className={cn('tabular text-xs font-bold', me ? 'text-club-accent' : 'text-fg-muted')}>{pos}</span>
              <span className="flex min-w-0 items-center gap-2">
                <ClubCrest id={r.clubId} size={compact ? 18 : 22} />
                <span className={cn('truncate', me ? 'font-bold text-fg' : 'font-medium')}>{clubLabel(r.clubId, compact)}</span>
              </span>
              {compact ? (
                <>
                  <span className="tabular text-right text-xs text-fg-muted">{r.played}</span>
                  <span className="tabular text-right text-xs text-fg-muted">{sg > 0 ? `+${sg}` : sg}</span>
                  <span className="tabular text-right font-bold">{r.points}</span>
                </>
              ) : (
                <>
                  <span className="tabular text-right text-xs text-fg-muted">{r.played}</span>
                  <span className="tabular hidden text-right text-xs text-fg-muted @lg:block">{r.won}</span>
                  <span className="tabular hidden text-right text-xs text-fg-muted @lg:block">{r.drawn}</span>
                  <span className="tabular hidden text-right text-xs text-fg-muted @lg:block">{r.lost}</span>
                  <span className="tabular hidden text-right text-xs text-fg-muted @lg:block">{r.goalsFor}</span>
                  <span className="tabular hidden text-right text-xs text-fg-muted @lg:block">{r.goalsAgainst}</span>
                  <span className={cn('tabular hidden text-right text-xs @lg:block', sg > 0 ? 'text-success' : sg < 0 ? 'text-danger' : 'text-fg-muted')}>
                    {sg > 0 ? `+${sg}` : sg}
                  </span>
                  <span className="tabular text-right text-[15px] font-extrabold">{r.points}</span>
                  <span className="hidden pl-2 @2xl:block">
                    <FormDots form={r.form} size="sm" />
                  </span>
                </>
              )}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/** Linha de jogo (calendário, resumos): mandante – placar – visitante. */
export function FixtureLine({ f, highlightId, showDate, className }: { f: Fixture; highlightId?: string; showDate?: boolean; className?: string }) {
  const me = f.homeId === highlightId || f.awayId === highlightId;
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-2 sm:px-3',
        me ? 'border-club-accent/45 bg-club-accent/[0.08]' : 'border-line/60 bg-surface-2/40',
        className,
      )}
    >
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span className={cn('truncate text-sm', f.homeId === highlightId ? 'font-bold' : 'font-medium')}>{clubLabel(f.homeId, true)}</span>
        <ClubCrest id={f.homeId} size={24} />
      </span>
      <span className="flex min-w-[4.5rem] flex-col items-center">
        {f.result ? (
          <span className="tabular rounded-md bg-surface-3 px-2 py-0.5 text-sm font-extrabold tracking-wide">
            {f.result.home} <span className="text-fg-subtle">x</span> {f.result.away}
          </span>
        ) : (
          <span className="rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-fg-muted">x</span>
        )}
        {f.result?.penalties && (
          <span className="tabular mt-0.5 text-[10px] font-semibold text-fg-muted">
            pên. {f.result.penalties.home}x{f.result.penalties.away}
          </span>
        )}
        {showDate && <span className="mt-0.5 text-[10px] text-fg-subtle">{fmtDate(f.date, { day: '2-digit', month: 'short' })}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <ClubCrest id={f.awayId} size={24} />
        <span className={cn('truncate text-sm', f.awayId === highlightId ? 'font-bold' : 'font-medium')}>{clubLabel(f.awayId, true)}</span>
      </span>
    </div>
  );
}
