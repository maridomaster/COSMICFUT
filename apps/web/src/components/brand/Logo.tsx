import { cn } from '@/lib/utils';

/** Marca COSMICFUT: bola em órbita. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id="cf-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6cff" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="14.5" ry="6" fill="none" stroke="url(#cf-logo-g)" strokeWidth="1.8" transform="rotate(-28 16 16)" />
      <circle cx="16" cy="16" r="7.2" fill="#e8ecf4" />
      <path d="M16 11.6 L19.6 14.2 L18.2 18.4 H13.8 L12.4 14.2 Z" fill="#0f141e" />
      <circle cx="27.3" cy="10" r="1.7" fill="#2dd4bf" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[15px] font-extrabold tracking-[0.14em] text-fg">
        COSMIC<span className="bg-linear-to-r from-brand to-brand-2 bg-clip-text text-transparent">FUT</span>
      </span>
    </div>
  );
}
