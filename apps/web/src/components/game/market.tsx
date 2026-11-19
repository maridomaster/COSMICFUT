import { useMemo, useState } from 'react';
import { Handshake, Tag, Tags } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';
import { useMarketActions } from '@/pages/market/actions';
import { Button } from '@/components/ui/button';

/** Jogadores listados para venda (ids). */
export function useTransferListed(): Set<string> {
  const list = useSeason((s) => s.save?.season.market?.transferList);
  return useMemo(() => new Set(list ?? []), [list]);
}

/** Botão "Colocar à venda" / "Retirar da lista" (Elenco, drawer e Mercado). Solo: engine local; online: market:list. */
export function ListForSaleButton({ playerId, size = 'sm', className }: { playerId: string; size?: 'sm' | 'md'; className?: string }) {
  const listed = useTransferListed().has(playerId);
  const actions = useMarketActions();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={listed ? 'outline' : 'club'}
      className={className}
      disabled={busy || !!actions.blocked}
      title={actions.blocked ?? undefined}
      onClick={() => {
        setBusy(true);
        void actions.setListed([playerId], !listed).finally(() => setBusy(false));
      }}
      aria-pressed={listed}
    >
      {listed ? <Tags /> : <Tag />}
      {listed ? 'Retirar da lista' : 'Colocar à venda'}
    </Button>
  );
}

export function ForSaleBadge({ className }: { className?: string }) {
  return (
    <span
      title="Na lista de transferências"
      className={cn('inline-flex h-4 shrink-0 items-center gap-0.5 rounded-md bg-warning/15 px-1 text-[9px] font-black tracking-wider text-warning uppercase', className)}
    >
      <Tag className="size-2.5" /> venda
    </span>
  );
}

/** (18/11) Jogadores na lista de empréstimo (ids) e a duração pedida. */
export function useLoanListed(): { ids: Set<string>; months: Record<string, number> } {
  const list = useSeason((s) => s.save?.season.market?.loanList);
  const months = useSeason((s) => s.save?.season.market?.loanMonths);
  return useMemo(() => ({ ids: new Set(list ?? []), months: months ?? {} }), [list, months]);
}

const LOAN_OPTIONS = [6, 12, 18, 24] as const;
const loanLabel = (m: number) => (m === 12 ? '1 ano' : m === 24 ? '2 anos' : `${m} meses`);

/**
 * (18/11) "Emprestar" com o prazo (6 meses a 2 anos): o jogador vai para a lista de empréstimo e os clubes interessados
 * mandam propostas — quem recebe paga o salário inteiro. Listado: mostra o prazo e "Tirar do empréstimo".
 */
export function LoanOfferButton({ playerId, size = 'sm', className }: { playerId: string; size?: 'sm' | 'md'; className?: string }) {
  const { ids, months } = useLoanListed();
  const listed = ids.has(playerId);
  const actions = useMarketActions();
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<number>(months[playerId] ?? 12);
  const run = (on: boolean) => {
    setBusy(true);
    void actions.setLoanListed([playerId], on, on ? m : undefined).finally(() => setBusy(false));
  };
  if (listed) {
    return (
      <Button size={size} variant="outline" className={className} disabled={busy || !!actions.blocked} title={actions.blocked ?? undefined} onClick={() => run(false)} aria-pressed data-testid="loan-off">
        <Handshake /> Tirar do empréstimo ({loanLabel(months[playerId] ?? 12)})
      </Button>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <select
        aria-label="Prazo do empréstimo"
        value={m}
        onChange={(e) => setM(Number(e.target.value))}
        className="h-7 rounded-md border border-line-strong bg-surface-2/60 px-1.5 text-xs text-fg"
        data-testid="loan-months"
      >
        {LOAN_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {loanLabel(o)}
          </option>
        ))}
      </select>
      <Button
        size={size}
        variant="outline"
        disabled={busy || !!actions.blocked}
        title={actions.blocked ?? 'O clube que pegar emprestado paga o salário inteiro'}
        onClick={() => run(true)}
        data-testid="loan-on"
      >
        <Handshake /> Emprestar
      </Button>
    </span>
  );
}
