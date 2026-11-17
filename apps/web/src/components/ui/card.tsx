import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * (Atualização 41 — visual compacto) padding único dos cards: 16px nas laterais, 12px no topo/base
 * (antes 20/20). Cabeçalho com ícone de 14px numa caixa de 24px e título de 13px.
 */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('cf-card', className)} {...props} />;
}

export function CardHeader({
  className,
  icon,
  title,
  action,
  subtitle,
}: {
  className?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 px-4 pt-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon && (
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-club-accent/25 bg-club-accent/10 text-club-accent [&_svg]:size-3.5">
            {icon}
          </span>
        )}
        <div className="flex min-w-0 items-baseline gap-x-2">
          <h3 className="max-w-full shrink-0 truncate text-body font-semibold tracking-tight text-fg">{title}</h3>
          {subtitle && (
            <p className="min-w-0 truncate text-meta text-fg-subtle" title={typeof subtitle === 'string' ? subtitle : undefined}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center whitespace-nowrap">{action}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}
