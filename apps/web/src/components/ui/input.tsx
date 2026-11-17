import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'h-9 w-full rounded-lg border border-line bg-surface-2/70 px-3 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-club-accent/60 focus:ring-2 focus:ring-club-accent/20';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(fieldBase, 'cursor-pointer appearance-none pr-9 [&>option]:bg-surface')} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
