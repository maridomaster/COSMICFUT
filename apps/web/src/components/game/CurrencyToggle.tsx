import { useSettings } from '@/store/settings';
import { EXCHANGE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * (Etapa 4) Alternância da moeda exibida: € (moeda do jogo) ou R$ (câmbio fixo, mostrado ao lado).
 * Preferência global e persistida (store/settings.ts).
 */
export function CurrencyToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const currency = useSettings((s) => s.currency);
  const setCurrency = useSettings((s) => s.setCurrency);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="group" aria-label="Moeda exibida" className="flex gap-0.5 rounded-lg border border-line bg-surface-2/60 p-0.5">
        {(['EUR', 'BRL'] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={currency === c}
            title={c === 'EUR' ? 'Euro (moeda do jogo)' : `Real (câmbio fixo: ${EXCHANGE_LABEL})`}
            onClick={() => setCurrency(c)}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-bold transition-colors',
              currency === c ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg',
            )}
          >
            {c === 'EUR' ? '€' : 'R$'}
          </button>
        ))}
      </div>
      {!compact && <span className="text-[10px] text-fg-subtle">{EXCHANGE_LABEL}</span>}
    </div>
  );
}
