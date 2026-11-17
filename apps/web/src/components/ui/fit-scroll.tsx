import { useRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { useFitHeight } from '@/lib/useFitHeight';

/**
 * (Atualização 41) Área de rolagem que vai até o fim da tela no desktop (≥ 1024px): a lista/tabela rola por dentro,
 * com o cabeçalho `sticky top-0`, e a página não rola. No celular é um bloco normal.
 */
export function FitScroll({ className, bottom = 18, min = 260, ...props }: HTMLAttributes<HTMLDivElement> & { bottom?: number; min?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitHeight(ref, { bottom, min });
  return <div ref={ref} className={cn('scrollbar-thin overflow-y-auto', className)} {...props} />;
}
