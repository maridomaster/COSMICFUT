import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Barra de condição física (stamina) 0..100.
 *
 * Faixas de cor (spec da Atualização 38):
 *  - 100–75 verde `#22c55e`
 *  - 74–50 amarelo `#eab308`
 *  - 49–25 laranja `#f97316`
 *  - < 25 vermelho `#ef4444` + ícone de alerta (risco de lesão / queda forte de rendimento)
 *
 * Uso: `<StaminaBar value={f} size="sm" showLabel />`. Componente puro (sem store), pode ser
 * importado por qualquer tela (pré-jogo, partida ao vivo, tática, elenco).
 */
export interface StaminaBarProps {
  /** condição 0..100 (valores fora da faixa são limitados; ausente/NaN = 100) */
  value: number | undefined;
  size?: 'sm' | 'md';
  /** mostra o número "NN%" ao lado da barra */
  showLabel?: boolean;
  className?: string;
}

export const STAMINA_COLORS = {
  high: '#22c55e',
  mid: '#eab308',
  low: '#f97316',
  critical: '#ef4444',
} as const;

/** Cor da faixa para uma condição (0..100). */
export function staminaColor(value: number): string {
  const v = Math.round(value);
  if (v >= 75) return STAMINA_COLORS.high;
  if (v >= 50) return STAMINA_COLORS.mid;
  if (v >= 25) return STAMINA_COLORS.low;
  return STAMINA_COLORS.critical;
}

/** Texto do tooltip (pt-BR). */
export function staminaTitle(value: number): string {
  const v = Math.round(value);
  if (v < 25) return `Condição física ${v}% — exausto: alto risco de lesão e queda severa de rendimento`;
  if (v < 50) return `Condição física ${v}% — muito cansado: rendimento reduzido`;
  if (v < 75) return `Condição física ${v}% — cansado`;
  return `Condição física ${v}%`;
}

export function StaminaBar({ value, size = 'sm', showLabel, className }: StaminaBarProps) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 100;
  const v = Math.max(0, Math.min(100, Math.round(raw)));
  const color = staminaColor(v);
  const critical = v < 25;
  const title = staminaTitle(v);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1 align-middle', size === 'sm' ? 'w-14' : 'w-24', className)}
      title={title}
      role="meter"
      aria-label="Condição física"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      data-stamina={v}
    >
      <span className={cn('relative block min-w-0 flex-1 overflow-hidden rounded-full bg-black/35 ring-1 ring-white/10', size === 'sm' ? 'h-1' : 'h-1.5')}>
        <span className="absolute inset-y-0 left-0 block rounded-full transition-[width] duration-300" style={{ width: `${v}%`, backgroundColor: color }} />
      </span>
      {critical && <AlertTriangle aria-hidden className={cn('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5')} style={{ color }} strokeWidth={2.5} />}
      {showLabel && (
        <span className={cn('tabular shrink-0 font-semibold', size === 'sm' ? 'text-[9px]' : 'text-[10px]')} style={{ color }}>
          {v}%
        </span>
      )}
    </span>
  );
}
