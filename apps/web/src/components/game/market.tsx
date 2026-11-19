import { useMemo, useState } from 'react';
import { ArrowRightLeft, Check, FileClock, Handshake, Tag, Tags } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { contractEndDate, monthsLeftOf, ownerContractEnd, releaseClauseOf, renewalAsk, type SeasonState } from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { fmtDate, fmtMoney } from '@/lib/format';
import { MoneyField } from '@/components/ui/money-field';
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

/** (19/11) Selo "empréstimo" (lista de empréstimo), ao lado do nome como o de venda. */
export function LoanListBadge({ months, className }: { months?: number; className?: string }) {
  return (
    <span
      title={`Na lista de empréstimo${months ? ` (${loanLabel(months)})` : ''}`}
      className={cn('inline-flex h-4 shrink-0 items-center gap-0.5 rounded-md bg-brand/15 px-1 text-[9px] font-black tracking-wider text-brand uppercase', className)}
      data-testid="loan-list-badge"
    >
      <ArrowRightLeft className="size-2.5" /> empréstimo
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

/** (19/11) Fim do contrato com o seu clube (data ISO) e meses restantes; null = sem contrato próprio (emprestado ao clube). */
export function contractInfo(season: SeasonState, p: Player, clubId: string): { end: string; months: number } | null {
  const c = season.market?.contracts[p.id];
  if (c?.kind === 'loan' && c.loanFrom && c.loanFrom !== clubId) return null;
  const o = ownerContractEnd(season, p);
  return { end: contractEndDate(season, o.clubId ?? clubId, o.endsSeason), months: monthsLeftOf(season, p, clubId) ?? 0 };
}

/**
 * (19/11) Renovação de contrato (Elenco/ficha e Mercado → Empréstimos e contratos): salário (o jogador aceita ≥ o que
 * pede), anos e multa rescisória.
 */
export function RenewForm({ player: p, clubId, onDone, className }: { player: Player; clubId: string; onDone?: (msg: { text: string; ok: boolean }) => void; className?: string }) {
  const season = useSeason((s) => s.save?.season);
  const actions = useMarketActions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const init = useMemo(() => {
    if (!season) return null;
    const ask = renewalAsk(season, squads, clubId, p, 3);
    return { wage: ask.wage, years: Math.min(ask.maxYears, Math.max(ask.minYears, 3)), clause: Math.round((releaseClauseOf(season, p, clubId) || p.value * 3) / 100_000) * 100_000 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, clubId]);
  const [r, setR] = useState(init);
  if (!season || !r) return null;
  const pc = season.market?.preContracts?.[p.id];
  if (pc) return <p className={cn('text-xs font-semibold text-danger', className)}>Já assinou pré-contrato com o {pc.toName}: não renova.</p>;
  const asks = renewalAsk(season, squads, clubId, p, r.years).wage;
  const submit = async () => {
    setBusy(true);
    const res = await actions.renew(p.id, r.wage, r.years, r.clause || undefined);
    setBusy(false);
    if (res.error) setErr(res.error);
    else onDone?.({ text: `${p.name} renovou por ${r.years} ${r.years > 1 ? 'anos' : 'ano'}.`, ok: true });
  };
  return (
    <div className={cn('flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2/40 p-3 text-xs', className)} data-testid="renew-form">
      <label className="grid gap-1">
        <span className="text-fg-muted">Salário/mês (pede {fmtMoney(asks)})</span>
        <MoneyField value={r.wage || 0} className="w-44 shrink-0">
          <input inputMode="numeric" aria-label="Salário da renovação" value={r.wage.toLocaleString('pt-BR')} onChange={(e) => setR({ ...r, wage: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="tabular h-8 w-32 rounded-lg border border-line bg-surface px-2" />
        </MoneyField>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-muted">Anos</span>
        <select aria-label="Anos da renovação" value={r.years} onChange={(e) => setR({ ...r, years: Number(e.target.value) })} className="h-8 rounded-lg border border-line bg-surface px-2">
          {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-muted">Multa rescisória</span>
        <MoneyField value={r.clause || 0} className="w-44 shrink-0">
          <input inputMode="numeric" aria-label="Multa da renovação" value={r.clause.toLocaleString('pt-BR')} onChange={(e) => setR({ ...r, clause: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="tabular h-8 w-36 rounded-lg border border-line bg-surface px-2" />
        </MoneyField>
      </label>
      <Button size="sm" variant="club" disabled={busy || !!actions.blocked} title={actions.blocked ?? undefined} onClick={() => void submit()} data-testid="renew-submit">
        <Check /> Propor renovação
      </Button>
      {err && <p className="basis-full text-danger" role="status">{err}</p>}
    </div>
  );
}

/** (19/11) Contrato na ficha do jogador do seu clube: até quando vai e o botão Renovar. */
export function ContractRenew({ player, clubId }: { player: Player; clubId: string }) {
  const season = useSeason((s) => s.save?.season);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const info = season ? contractInfo(season, player, clubId) : null;
  if (!season || !info) return null;
  return (
    <div className="basis-full space-y-2" data-testid="contract-renew">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FileClock className="size-3.5 text-fg-muted" />
        <span className="text-fg-muted">Contrato até</span>
        <b className={contractTone(info.months)}>{fmtDate(info.end)}</b>
        <span className="text-fg-subtle">({monthsLabel(info.months)})</span>
        <Button size="sm" variant={open ? 'outline' : 'ghost'} className="ml-auto" onClick={() => { setOpen(!open); setMsg(null); }} data-testid="renew-open">
          <FileClock /> Renovar
        </Button>
      </div>
      {msg && <p className={cn('text-xs', msg.ok ? 'text-success' : 'text-danger')} role="status">{msg.text}</p>}
      {open && <RenewForm player={player} clubId={clubId} onDone={(m) => { setMsg(m); setOpen(false); }} />}
    </div>
  );
}

export const contractTone = (months: number) => (months <= 6 ? 'text-danger' : months <= 12 ? 'text-warning' : 'text-fg');
export const monthsLabel = (months: number) => (months < 1 ? 'último mês' : months < 24 ? `${Math.round(months)} meses` : `${Math.floor(months / 12)} anos e ${Math.round(months % 12)} meses`.replace(' e 0 meses', ''));
