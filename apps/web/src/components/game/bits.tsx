import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, Footprints, Star } from 'lucide-react';
import { EVOLUTION } from '@cosmicfut/engine';
import type { Country, Position, Side } from '@cosmicfut/shared';
import { assetUrl } from '@/data/source';
import { cardTier, cardTierMeta, overallColor, POSITION_META } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Nível em estrelas (aceita meia estrela). */
export function Stars({ value, max = 5, size = 14, className }: { value: number; max?: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${value} de ${max} estrelas`}>
      {Array.from({ length: max }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-fg-subtle/50" style={{ width: size, height: size }} strokeWidth={1.5} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="text-warning" style={{ width: size, height: size }} fill="currentColor" strokeWidth={1.5} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Pé bom do jogador: "D" (destro) ou "E" (canhoto). */
export function FootChip({ side, compact, className }: { side: Side; compact?: boolean; className?: string }) {
  const left = side === 'L';
  if (compact) {
    return (
      <span
        title={left ? 'Pé bom: esquerdo (canhoto)' : 'Pé bom: direito (destro)'}
        aria-label={left ? 'Canhoto' : 'Destro'}
        data-testid="foot-chip"
        className={cn(
          'inline-grid h-5 w-4 shrink-0 place-items-center rounded-[var(--radius-chip)] text-[10px] font-bold',
          left ? 'bg-sky-500/12 text-sky-400 ring-1 ring-sky-500/35 ring-inset' : 'bg-surface-3/60 text-fg-muted ring-1 ring-line ring-inset',
          className,
        )}
      >
        {left ? 'E' : 'D'}
      </span>
    );
  }
  return (
    <span
      title={left ? 'Pé bom: esquerdo (canhoto)' : 'Pé bom: direito (destro)'}
      aria-label={left ? 'Canhoto' : 'Destro'}
      data-testid="foot-chip"
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-[var(--radius-chip)] px-1 text-[10px] font-bold',
        left ? 'bg-sky-500/12 text-sky-400 ring-1 ring-sky-500/35 ring-inset' : 'bg-surface-3/60 text-fg-muted ring-1 ring-line ring-inset',
        className,
      )}
    >
      <Footprints className={cn('size-3', left && '-scale-x-100')} />
      {left ? 'E' : 'D'}
    </span>
  );
}

/** Chip da posição; com `foot`, mostra também o pé bom ao lado. */
export function PositionChip({ position, foot, className }: { position: Position; foot?: Side; className?: string }) {
  if (foot) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <PositionChip position={position} className={className} />
        <FootChip side={foot} className={className?.includes('h-4') ? 'h-4 text-[9px]' : undefined} />
      </span>
    );
  }
  const meta = POSITION_META[position];
  return (
    <span
      title={meta.label}
      className={cn('inline-flex h-5 w-9 shrink-0 items-center justify-center rounded-[var(--radius-chip)] text-[10px] font-bold tracking-wider', className)}
      style={{
        color: meta.color,
        background: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${meta.color} 35%, transparent)`,
      }}
    >
      {meta.short}
    </span>
  );
}

const OVR_BADGE_SIZE = {
  xs: 'h-[18px] min-w-[1.6rem] px-1 text-[11px] rounded-[4px]',
  sm: 'h-5 min-w-[1.85rem] px-1 text-xs rounded-[5px]',
  md: 'h-6 min-w-[2.2rem] px-1.5 text-sm rounded-md',
  lg: 'h-9 min-w-[3rem] px-2 text-xl rounded-lg',
} as const;

/** (Etapa 3) Overall como carta FC: ouro ≥ 75, prata 65–74, bronze ≤ 64 (fundo metálico, número escuro). */
export function OvrBadge({ value, size = 'sm', className }: { value: number; size?: keyof typeof OVR_BADGE_SIZE; className?: string }) {
  const m = cardTierMeta(value);
  return (
    <span
      title={`Carta ${m.label} (${m.range})`}
      data-card={cardTier(value)}
      className={cn('tabular inline-flex shrink-0 items-center justify-center leading-none font-black', OVR_BADGE_SIZE[size], className)}
      style={{
        color: m.ink,
        background: `linear-gradient(155deg, ${m.from} 0%, ${m.via} 52%, ${m.to} 100%)`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.55), inset 0 -1px 0 rgb(0 0 0 / 0.25), 0 0 0 1px color-mix(in oklab, ${m.to} 70%, transparent)`,
      }}
    >
      {value}
    </span>
  );
}

/** Barra de overall com número (número na carta FC). */
export function OverallBar({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const color = overallColor(value);
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <OvrBadge value={value} size="xs" />
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 55%, transparent), ${color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(4, value)}%` }}
          transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

/** Bandeira (asset) com fallback para a sigla do país. */
export function Flag({ country, className }: { country: Country | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = assetUrl(country?.flag);
  if (!country) return null;
  if (!url || failed) {
    return (
      <span
        title={country.name}
        className={cn('inline-flex h-3.5 min-w-6 items-center justify-center rounded-[3px] bg-surface-3 px-1 text-[9px] font-bold text-fg-muted', className)}
      >
        {country.code ?? country.name.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={country.name}
      title={country.name}
      onError={() => setFailed(true)}
      className={cn('crest-smooth inline-block h-3.5 w-auto rounded-[2px] object-contain', className)}
    />
  );
}

export function StatTile({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    // (Atualização 41) compacto: 10px de rótulo, número de 18px, dica em 11px (≈ 52px de altura; antes 76px)
    <div className={cn('rounded-lg border border-line bg-surface-2/60 px-3 py-1.5', className)}>
      <div className="cf-label truncate text-fg-muted">{label}</div>
      <div className="tabular truncate text-lg leading-tight font-bold tracking-tight text-fg">{value}</div>
      {hint && <div className="truncate text-meta text-fg-subtle">{hint}</div>}
    </div>
  );
}

/**
 * (18/11) Potencial esgotado: já chegou ao máximo (potencial ≤ overall) ou velho demais para crescer (30+). A UI
 * mostra o número em vermelho.
 */
export function potentialMaxed(age: number, overall: number, potential: number): boolean {
  return potential <= overall || age >= 30;
}

/** (18/11) Queda de overall por ano pela idade (0 = ainda não está em declínio). Segue a evolução mensal da engine. */
export function declinePerYear(age: number): number {
  let d = 0;
  for (const [a, v] of EVOLUTION.decline) if (age >= a) d = v;
  return -d * 12;
}

/** (18/11) Seta para baixo ao lado do potencial: jogador em declínio por causa da idade. */
export function DeclineArrow({ age, className }: { age: number; className?: string }) {
  const d = declinePerYear(age);
  if (d <= 0) return null;
  const label = `Em declínio pela idade: perde ~${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de overall por ano`;
  return (
    <span title={label} aria-label={label} data-testid="decline-arrow" className={cn('inline-flex shrink-0 align-[-1px] text-danger', className)}>
      <ArrowDown className="size-3" strokeWidth={3} />
    </span>
  );
}

/** Classe do número de potencial (vermelho quando esgotado). */
export function potentialClass(age: number, overall: number, potential: number, base = 'text-fg-muted'): string {
  return potentialMaxed(age, overall, potential) ? 'font-semibold text-danger' : base;
}
