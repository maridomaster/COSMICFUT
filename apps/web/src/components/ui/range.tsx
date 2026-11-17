import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

/* Inputs nativos (acessíveis, teclado e toque grátis) com visual próprio. */
const thumb =
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-club-accent [&::-webkit-slider-thumb]:bg-fg [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_color-mix(in_oklab,var(--club-accent)_20%,transparent)] ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-[14px] [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-club-accent [&::-moz-range-thumb]:bg-fg';
const inputBase = cn(
  'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-fg',
  thumb,
);

/** Faixa com dois cursores (mín/máx). */
export function DualRange({
  min,
  max,
  value,
  onChange,
  label,
  className,
  format,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  label: string;
  className?: string;
  /** rótulo dos valores (ex.: escala de dinheiro por índice) */
  format?: (v: number) => string;
}) {
  const [lo, hi] = value;
  const span = Math.max(1, max - min);
  const pct = (v: number) => ((v - min) / span) * 100;
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="cf-label">{label}</span>
        <span className="tabular font-semibold text-fg">
          {format ? format(lo) : lo}–{format ? format(hi) : hi}
        </span>
      </div>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-club-accent"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          aria-label={`${label} mínimo`}
          min={min}
          max={max}
          value={lo}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className={cn(inputBase, 'pointer-events-none')}
        />
        <input
          type="range"
          aria-label={`${label} máximo`}
          min={min}
          max={max}
          value={hi}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className={cn(inputBase, 'pointer-events-none')}
        />
      </div>
    </div>
  );
}

/** Slider discreto (passos) com rótulos. */
export function StepSlider<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div>
      <div className="relative h-6">
        <div className="absolute inset-x-[9px] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,#38bdf8,var(--color-surface-3)_50%,#fb7185)] opacity-60" />
        <div className="absolute inset-x-[9px] top-1/2 -translate-y-1/2">
          {options.map((o, i) => (
            <span
              key={o.value}
              className={cn('absolute top-1/2 size-2 -translate-1/2 rounded-full', i <= idx ? 'bg-fg/80' : 'bg-line-strong')}
              style={{ left: `${(i / (options.length - 1)) * 100}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label={label}
          aria-valuetext={options[idx]?.label}
          min={0}
          max={options.length - 1}
          step={1}
          value={idx}
          onChange={(e) => onChange(options[Number(e.target.value)].value)}
          className={inputBase}
        />
      </div>
      <div className="mt-1.5 grid text-[10px] font-medium text-fg-subtle" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'truncate px-0.5 transition-colors hover:text-fg',
              i === 0 ? 'text-left' : i === options.length - 1 ? 'text-right' : 'text-center',
              i === idx && 'font-bold text-club-accent',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Controle segmentado com destaque animado. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  id,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** id único (para não misturar indicadores entre controles) */
  id: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-lg border border-line bg-surface-2/60 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn('relative h-7 rounded-md px-2 text-xs font-semibold transition-colors', active ? 'text-club-on-accent' : 'text-fg-muted hover:text-fg')}
          >
            {active && <SegIndicator id={id} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SegIndicator({ id }: { id: string }) {
  return <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-md bg-club-accent" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />;
}
