import { FaceGrinning, FaceNeutral, FaceSlightlyFrowning, FaceSlightlySmiling } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * (Atualização 41 — visual compacto) Família única de chips de status de jogador/time.
 * Todos têm 20px de altura (h-5), raio de 6px, texto de 10–11px e ícone de 12px:
 *   OvrBadge (bits) · PositionChip (bits) · AgeChip · StaminaBar (barra) · CardIcon/YellowsChip · MoraleChip · InjuryIcon (status)
 * Os detalhes ficam no tooltip (`title`), não em linhas extras.
 */

const CHIP = 'tabular inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--radius-chip)] px-1.5 text-[11px] leading-none font-bold';

/** Idade compacta ("23a"). */
export function AgeChip({ age, className }: { age: number; className?: string }) {
  return (
    <span title={`${age} anos`} className={cn(CHIP, 'bg-surface-3/70 font-semibold text-fg-muted', className)}>
      {age}
      <span className="text-[9px] font-medium text-fg-subtle">a</span>
    </span>
  );
}

/** Faixas da moral (0..100) — as mesmas do card do Dashboard. */
export function moraleMeta(v: number): { text: string; color: string; Icon: typeof FaceSlightlySmiling } {
  if (v >= 90) return { text: 'Excelente', color: 'var(--color-success)', Icon: FaceGrinning };
  if (v >= 75) return { text: 'Alta', color: 'var(--color-success)', Icon: FaceSlightlySmiling };
  if (v >= 55) return { text: 'Boa', color: 'var(--club-accent)', Icon: FaceSlightlySmiling };
  if (v >= 35) return { text: 'Instável', color: 'var(--color-warning)', Icon: FaceNeutral };
  return { text: 'Baixa', color: 'var(--color-danger)', Icon: FaceSlightlyFrowning };
}

/** Moral do time: ícone + número (o rótulo vai no tooltip, ou visível com `label`). */
export function MoraleChip({ value, label, className }: { value: number; label?: boolean; className?: string }) {
  const v = Math.round(value);
  const m = moraleMeta(v);
  return (
    <span
      title={`Moral do time: ${v} (${m.text}) — oscila com resultados, minutagem e salários em dia`}
      className={cn(CHIP, className)}
      style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.color} 30%, transparent)` }}
    >
      <m.Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {v}
      {label && <span className="font-semibold">· {m.text}</span>}
    </span>
  );
}

/** Amarelos acumulados na competição do próximo jogo (3 = 1 jogo de suspensão). */
export function YellowsChip({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} ${count === 1 ? 'cartão amarelo' : 'cartões amarelos'} na competição do próximo jogo — com 3, cumpre 1 jogo de suspensão`}
      className={cn('tabular inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-[#facc15]', className)}
    >
      <span className="inline-block h-3 w-2 rounded-[2px] bg-[#facc15] shadow-[0_1px_2px_rgb(0_0_0/0.5)]" aria-hidden />
      {count}
    </span>
  );
}
