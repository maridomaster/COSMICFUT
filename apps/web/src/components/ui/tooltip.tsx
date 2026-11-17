import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Tecla de atalho ("Espaço"). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-surface-3 px-1.5 font-sans text-[10px] font-semibold text-fg', className)}>
      {children}
    </kbd>
  );
}

/**
 * Tooltip leve (CSS): aparece ao passar o mouse ou com foco de teclado no elemento filho.
 * Só em telas com ponteiro fino (no toque não há hover). O conteúdo é `aria-hidden`: o rótulo
 * acessível continua no próprio botão (aria-label/aria-keyshortcuts).
 */
export function Tooltip({ content, children, side = 'bottom', align = 'end', className }: { content: ReactNode; children: ReactNode; side?: 'bottom' | 'top'; align?: 'start' | 'end'; className?: string }) {
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute z-50 hidden w-max max-w-64 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-fg-muted opacity-0 shadow-xl transition-opacity duration-150 [@media(hover:hover)]:block',
          'group-hover/tt:opacity-100 group-has-[:focus-visible]/tt:opacity-100',
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          align === 'end' ? 'right-0' : 'left-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
