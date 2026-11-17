/**
 * (Mercado e Orçamentos) Faixa fixa da janela de transferências no topo do Mercado: selo verde "JANELA ABERTA" ou
 * vermelho "JANELA FECHADA", fechamento da janela atual e abertura da próxima (janelas regionais do clube), as outras
 * regiões e os orçamentos (com o equilíbrio num painel recolhível).
 */
import { useState } from 'react';
import { CalendarClock, ChevronDown, Scale } from 'lucide-react';
import { MARKET, budgetsApply, ddmm, windowBanner, windowFor, type SeasonState } from '@cosmicfut/engine';
import { REGION_LABEL, daysBetween } from '@/season/view';
import { cn } from '@/lib/utils';
import { BudgetBalance, BudgetChips } from '@/pages/finance/BudgetBalance';

export function WindowBanner({ season, clubId }: { season: SeasonState; clubId: string }) {
  const w = windowBanner(season, clubId);
  const [open, setOpen] = useState(false);
  const budgets = budgetsApply(season, clubId);
  const region = w.region as 'EU' | 'SA' | 'SAU' | null;
  const days = daysBetween(season.date, (w.open ? w.closesOn : w.nextOpen) ?? season.date);
  // (Atualização 41) faixa compacta (≈ 40px): selo, datas e orçamentos numa linha; outras regiões no fim da mesma
  // linha (ou na 2ª, se não couber). Fica presa logo abaixo do topo do app (--topbar-h), não por baixo dele.
  const others = season.segment
    ? (['EU', 'SA', 'SAU'] as const)
        .filter((r) => r !== region)
        .map((r) => {
          const o = windowFor(r, season.date);
          return `${REGION_LABEL[r]}: ${o.open ? `aberta até ${ddmm(o.closesOn!)}` : `abre ${ddmm(o.opensOn!)}`}`;
        })
    : [];
  return (
    <div className="sticky top-[var(--topbar-h)] z-20 -mx-1 px-1 pt-0.5" data-testid="window-banner">
      <div
        role="status"
        aria-live="polite"
        className={cn('rounded-lg border-2 bg-surface/95 shadow-lg backdrop-blur', w.open ? 'border-success/60' : 'border-danger/60')}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-black tracking-wide uppercase',
              w.open ? 'bg-success text-bg' : 'bg-danger text-white',
            )}
          >
            <span className={cn('size-1.5 rounded-full bg-current', w.open && 'animate-pulse')} />
            {w.open ? 'Janela aberta - Período de Transferências' : 'Janela fechada'}
          </span>
          <span className="tabular flex items-center gap-1.5 text-[13px] font-semibold">
            <CalendarClock className="size-3.5 text-fg-muted" />
            {w.open ? (
              <>Fecha em: {ddmm(w.closesOn!)} <span className="text-fg-subtle">|</span> Próxima abertura: {ddmm(w.nextOpen)}</>
            ) : (
              <>Próxima abertura: {ddmm(w.nextOpen)}</>
            )}
            <span className="text-[11px] font-normal text-fg-muted">({w.open ? `faltam ${days} dias` : `em ${days} dias`}{region ? ` · ${REGION_LABEL[region]}` : ''})</span>
          </span>
          {others.length > 0 && <span className="text-[11px] text-fg-subtle" title="Janelas das outras regiões">{others.join(' · ')}</span>}
          {budgets && (
            <span className="ml-auto flex items-center gap-2">
              <BudgetChips season={season} clubId={clubId} />
              <button
                type="button"
                onClick={() => setOpen((x) => !x)}
                aria-expanded={open}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-muted hover:text-fg"
              >
                <Scale className="size-3.5" /> Equilibrar <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
              </button>
            </span>
          )}
        </div>
        {!w.open && (
          <div className="border-t border-line/70 px-2.5 py-1 text-[11px] text-warning">
            Fora da janela: só jogadores livres e pré-contratos (últimos {MARKET.preContractMonths} meses de contrato).
          </div>
        )}
        {budgets && open && (
          <div className="border-t border-line/70 px-3 py-2.5">
            <BudgetBalance season={season} clubId={clubId} compact />
          </div>
        )}
      </div>
    </div>
  );
}