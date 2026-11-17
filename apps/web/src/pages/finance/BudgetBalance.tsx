/**
 * (Mercado e Orçamentos) Orçamentos separados e o equilíbrio entre eles (slider bidirecional), usado em Finanças e no
 * Mercado. € 1 mi de transferências ⇄ € 50 mil/mês de folha; a folha nunca fica abaixo da comprometida. Solo: engine
 * local; online: 'market:budget' (o servidor valida as mesmas regras).
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Scale, Wallet } from 'lucide-react';
import { BUDGET, budgetView, previewRebalance, type SeasonState } from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { fmtMoney, fmtMoneySigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMarketActions } from '@/pages/market/actions';

export function useBudgetView(season: SeasonState, clubId: string) {
  // o elenco efetivo muda junto com a SeasonState (a visão `squads` acompanha)
  return useMemo(() => budgetView(season, squads, clubId), [season, clubId]);
}

/** Valores dos orçamentos (linha compacta para cabeçalhos). */
export function BudgetChips({ season, clubId, className }: { season: SeasonState; clubId: string; className?: string }) {
  const v = useBudgetView(season, clubId);
  if (!v) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs', className)}>
      <span className="inline-flex items-center gap-1"><Wallet className="size-3.5 text-club-accent" /> Transferências <b className={cn('tabular', v.transfer < 0 && 'text-danger')}>{fmtMoney(v.transfer)}</b></span>
      <span className="inline-flex items-center gap-1"><Banknote className="size-3.5 text-club-accent" /> Folha <b className={cn('tabular', v.committed > v.wage && 'text-danger')}>{fmtMoney(v.committed)}</b><span className="text-fg-subtle">/ {fmtMoney(v.wage)} por mês</span></span>
    </span>
  );
}

export function BudgetBalance({ season, clubId, compact }: { season: SeasonState; clubId: string; compact?: boolean }) {
  const v = useBudgetView(season, clubId);
  const actions = useMarketActions();
  const [delta, setDelta] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // estado mudou (compra, venda, outro ajuste): a prévia volta ao zero se ficou fora dos limites
  useEffect(() => {
    if (v && (delta > v.maxToWage || delta < -v.maxToTransfer)) setDelta(0);
  }, [v, delta]);
  if (!v) return null;
  const next = previewRebalance(v, delta);
  const wageRoom = next.wage - v.committed;
  const min = -v.maxToTransfer;
  const max = v.maxToWage;
  const apply = async () => {
    setBusy(true);
    setMsg(null);
    const r = await actions.budget(delta);
    setBusy(false);
    if (r.error) setMsg({ ok: false, text: r.error });
    else {
      setMsg({ ok: true, text: delta > 0 ? `${fmtMoney(delta)} foram para a folha.` : `${fmtMoney(-delta)} voltaram para as transferências.` });
      setDelta(0);
    }
  };
  return (
    <div className={cn('space-y-2', compact ? '' : '')}>
      <div className="grid grid-cols-2 gap-2">
        <BudgetBox label="Orçamento de transferências" value={next.transfer} now={v.transfer} hint={`definido pela diretoria: ${fmtMoney(v.baseTransfer)}`} />
        <BudgetBox label="Orçamento salarial (mês)" value={next.wage} now={v.wage} hint={`comprometido: ${fmtMoney(v.committed)} · folga ${fmtMoney(Math.max(0, wageRoom))}`} warn={wageRoom < 0} />
      </div>
      <div>
        <div className="mb-0.5 flex items-center justify-between text-[11px] font-semibold text-fg-muted">
          <span>← Mais transferências</span>
          <span className="tabular text-fg">{delta === 0 ? 'sem mudança' : delta > 0 ? `${fmtMoney(delta)} → folha (+${fmtMoney(delta * BUDGET.wagePerTransfer)}/mês)` : `${fmtMoney(-delta * BUDGET.wagePerTransfer)}/mês → ${fmtMoney(-delta)}`}</span>
          <span>Mais folha →</span>
        </div>
        <input
          type="range"
          aria-label="Equilíbrio entre orçamento de transferências e salarial"
          min={min}
          max={Math.max(max, min + BUDGET.step)}
          step={BUDGET.step}
          value={delta}
          disabled={!!actions.blocked || busy || (min === 0 && max === 0)}
          onChange={(e) => setDelta(Number(e.target.value))}
          className="w-full accent-[var(--club-accent)]"
        />
      </div>
      {/* (Atualização 41) razão + ações numa linha; a regra completa fica no tooltip */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-[11px] text-fg-subtle" title="O orçamento salarial é o teto da diretoria e nunca fica abaixo da folha comprometida.">
          <Scale className="mr-1 inline size-3" />
          Cada {fmtMoney(1_000_000)} de transferências equivale a {fmtMoney(1_000_000 * BUDGET.wagePerTransfer)}/mês de folha.
        </p>
        {msg && <span className={cn('text-xs', msg.ok ? 'text-success' : 'text-danger')} role="status">{msg.text}</span>}
        {actions.blocked && <span className="text-xs text-warning">{actions.blocked}</span>}
        <Button variant="ghost" size="sm" disabled={delta === 0 || busy} onClick={() => setDelta(0)}>Zerar</Button>
        <Button variant="club" size="sm" disabled={delta === 0 || busy || !!actions.blocked} onClick={() => void apply()}>
          <ArrowLeftRight /> Aplicar equilíbrio
        </Button>
      </div>
    </div>
  );
}

function BudgetBox({ label, value, now, hint, warn }: { label: string; value: number; now: number; hint: string; warn?: boolean }) {
  const diff = value - now;
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5">
      <div className="cf-label text-fg-muted">{label}</div>
      <div className="tabular flex items-baseline gap-1.5 text-base font-bold">
        <span className={cn(value < 0 && 'text-danger', warn && 'text-warning')}>{fmtMoney(value)}</span>
        {diff !== 0 && <span className={cn('text-xs', diff > 0 ? 'text-success' : 'text-danger')}>{fmtMoneySigned(diff)}</span>}
      </div>
      <div className="truncate text-[10px] text-fg-subtle">{hint}</div>
    </div>
  );
}
