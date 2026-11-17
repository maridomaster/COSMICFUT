import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

/**
 * (Atualização 41 — visual compacto) Cabeçalho único das páginas: título de 20–24px numa linha, com o contexto
 * ("Gestão", temporada…) como rótulo ao lado, um resumo curto (`meta`) e a explicação longa (`description`) num
 * tooltip de ícone — antes eram 3 linhas (sobrelinha + h1 30px + frase) ≈ 90px; agora ≈ 32px.
 */
export function PageHeader({
  title,
  eyebrow,
  meta,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  /** contexto curto, em caixa alta, ao lado do título */
  eyebrow?: ReactNode;
  /** resumo dinâmico curto (ex.: "32 jogadores · 2 indisponíveis") */
  meta?: ReactNode;
  /** explicação longa: vai para o tooltip do ícone (i) */
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">{title}</h1>
        {eyebrow && <span className="cf-label text-club-accent">{eyebrow}</span>}
        {description && (
          <Tooltip content={description} align="start" className="max-sm:hidden">
            <button type="button" aria-label={description} className="grid size-5 cursor-help place-items-center rounded-full text-fg-subtle hover:text-fg-muted">
              <Info className="size-3.5" />
            </button>
          </Tooltip>
        )}
        {meta && <span className="w-full text-meta text-fg-muted sm:w-auto">{meta}</span>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>}
    </header>
  );
}
