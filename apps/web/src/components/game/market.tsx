import { useMemo, useState } from 'react';
import { Tag, Tags } from 'lucide-react';
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
