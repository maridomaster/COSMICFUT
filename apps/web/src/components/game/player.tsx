import type { Player, Trait } from '@cosmicfut/shared';
import { STATUS_META, type LineupStatus } from '@/lib/lineup';
import { cn } from '@/lib/utils';
import { PlayerTierStar } from './TierStar';
import { PlayerHonors } from './HonorBall';

/** Chips com os nomes das características (traits) do jogador. */
export function TraitChips({ player, traits, className, max }: { player: Player; traits: Map<number, Trait>; className?: string; max?: number }) {
  const list = player.traits.slice(0, max ?? player.traits.length);
  if (!list.length) return <span className={cn('text-xs text-fg-subtle', className)}>—</span>;
  return (
    <span className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {list.map((id) => (
        <span
          key={id}
          className="inline-flex h-5 items-center rounded-md border border-line-strong/70 bg-surface-3/70 px-1.5 text-[10px] font-semibold whitespace-nowrap text-fg-muted"
        >
          {traits.get(id)?.label ?? `#${id}`}
        </span>
      ))}
    </span>
  );
}

/** Situação na escalação: titular / reserva / fora. */
export function StatusChip({ status, compact, className }: { status: LineupStatus; compact?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-bold tracking-wide uppercase', className)}
      style={{
        color: meta.color,
        background: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${meta.color} 30%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
      {compact ? meta.short : meta.label}
    </span>
  );
}

/** (18/11) Estrela 3D ao lado do nome: vermelha = Top Mundial (91+), amarela = Destaque (88–90). */
export function PlayerFlags({ player, className }: { player: Player; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <PlayerTierStar overall={player.overall} size={15} />
      <PlayerHonors playerId={player.id} size={15} />
    </span>
  );
}
