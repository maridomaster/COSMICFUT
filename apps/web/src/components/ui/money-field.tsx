import type { ReactNode } from 'react';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * (18/11) Campo de dinheiro com a escala sempre à mostra: envolve o <input> e escreve, dentro dele à direita,
 * "850 mil" / "12,5 mi" conforme o valor digitado — para não confundir mil com milhão. O input recebe `pr-20`
 * para o texto não passar por baixo. Os valores dos campos são em euros (como o "€" ao lado).
 */
export function MoneyField({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative flex min-w-0 [&>input]:w-full [&>input]:pr-20', className)}>
      {children}
      {value > 0 && (
        <span data-testid="money-scale" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs font-bold whitespace-nowrap text-club-accent">
          {fmtCompact(value)}
        </span>
      )}
    </span>
  );
}
