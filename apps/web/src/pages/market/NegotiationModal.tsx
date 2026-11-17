import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Building2, Check, FileSignature, Handshake, History, Hourglass, Loader2, MessageSquareQuote, PartyPopper, ShieldAlert, User, X, XCircle } from 'lucide-react';
import type { ClubIndexEntry, Player } from '@cosmicfut/shared';
import {
  MARKET, blockMessage, boardWageCeiling, budgetOf, careerWorth, marketWindow, monthsLeftOf, negotiationBlock, preContractOpen, rejectionCount, releaseClauseOf,
  signingBonus, suggestAppeal, suggestContract,
  type ExternalClubInfo, type OfferRound, type TransferOffer,
} from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { fmtDate, fmtMoney, POSITION_META } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';
import { useOnline } from '@/store/online';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OvrBadge } from '@/components/game/bits';
import { Segmented } from '@/components/ui/range';
import { useMarketActions, type OfferKind } from './actions';
import { ClubMini, clubDisplayName } from './common';

export interface NegotiationTarget {
  player: Player;
  /** clube vendedor ('' = livre) */
  clubId: string;
  sellerInfo?: ExternalClubInfo;
  offerId?: string;
}

const THINK_MS = 700;
type Kind = OfferKind | 'clause';

export function NegotiationModal({ target, onClose, clubMeta }: { target: NegotiationTarget | null; onClose: () => void; clubMeta: Map<string, ClubIndexEntry> }) {
  useEffect(() => {
    if (!target) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [target, onClose]);
  return createPortal(
    <AnimatePresence>
      {target && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div key="wrap" className="pointer-events-none fixed inset-0 z-[61] grid place-items-end sm:place-items-center sm:p-4">
            <motion.div
              role="dialog"
              aria-modal
              aria-label={`Negociação: ${target.player.name}`}
              className="pointer-events-auto relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl"
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              <Negotiation target={target} onClose={onClose} clubMeta={clubMeta} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function Negotiation({ target, onClose, clubMeta }: { target: NegotiationTarget; onClose: () => void; clubMeta: Map<string, ClubIndexEntry> }) {
  // `useSeason` avalia o seletor nos dois stores (solo e online): sem `!` dentro do seletor (o online tem save null)
  const season = useSeason((s) => s.save?.season)!;
  const humanId = useSeason((s) => s.save?.season.humanClubIds[0] ?? s.save?.clubId ?? '');
  const actions = useMarketActions();
  const [offerId, setOfferId] = useState<string | undefined>(target.offerId);
  const offer = season.market?.offers.find((o) => o.id === offerId);
  const p = offer?.player ?? target.player;
  const free = target.clubId === '';
  // (online) vendedor é outro humano da sala: a proposta vai para ele responder até o fim do planejamento
  const sellerNick = useOnline((s) => (actions.online && target.clubId ? (s.room?.players.find((x) => x.clubId === target.clubId)?.nickname ?? null) : null));
  const humanSeller = !!sellerNick;
  const balance = season.clubs[humanId]?.balance ?? 0;
  const credit = season.clubInfo?.[humanId]?.creditLimit ?? 0;
  // (Etapa 5) janela da região do COMPRADOR (o clube humano)
  const win = marketWindow(season, humanId);
  const windowOpen = win.open;
  const months = target.clubId ? monthsLeftOf(season, p, target.clubId) : null;
  const canPre = !free && preContractOpen(season, p, target.clubId);
  const clause = target.clubId ? releaseClauseOf(season, p, target.clubId) : 0;
  const worth = careerWorth(season, p, humanId);
  // (Mercado e Orçamentos) vendedor irritado (3 recusas na janela) e orçamento de transferências
  const block = !free ? negotiationBlock(season, p.id, humanId) : null;
  const refusals = !free && !block ? rejectionCount(season, p.id, humanId) : 0;
  const budget = budgetOf(season, humanId);
  const budgetRows = (cost: number): [string, string, boolean?][] => (budget ? [['Orçamento de transferências', fmtMoney(budget.transfer)], ['Orçamento depois', fmtMoney(budget.transfer - cost), budget.transfer - cost < 0]] : []);

  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>(offer?.kind === 'loan' ? 'loan' : offer?.kind === 'precontract' ? 'precontract' : offer?.clause ? 'clause' : !windowOpen && canPre ? 'precontract' : 'transfer');
  const isPre = kind === 'precontract' || offer?.kind === 'precontract';
  const bonusKind = free || isPre;

  // etapa 1: valor (e termos do empréstimo)
  const suggestedFee = roundTo(offer?.counterFee ?? p.value, 50_000);
  const [fee, setFee] = useState(offer?.fee ?? roundTo(p.value * 0.85, 50_000));
  const feeMax = Math.max(1_000_000, roundTo(p.value * 2.5, 50_000), suggestedFee);
  const [share, setShare] = useState(offer?.loan?.wageShare ?? 100);
  const [withOption, setWithOption] = useState(offer?.loan?.purchaseOption !== undefined);
  const [option, setOption] = useState(offer?.loan?.purchaseOption ?? roundTo(Math.max(p.value * 1.1, 100_000), 50_000));
  const [recall, setRecall] = useState(!!offer?.loan?.recall);

  // etapa 2: contrato
  const [years, setYears] = useState(3);
  const [clauseNew, setClauseNew] = useState(roundTo(Math.max(1_000_000, worth * 3), 100_000));
  const demand = useMemo(
    () => (offer && offer.status === 'agreed' ? suggestContract(season, squads, offer, years, target.sellerInfo, clauseNew) : null),
    [offer, season, target.sellerInfo, years, clauseNew],
  );
  const appeal = useMemo(() => (offer && offer.status === 'agreed' ? suggestAppeal(season, squads, offer, target.sellerInfo) : null), [offer, season, target.sellerInfo]);
  const [wage, setWage] = useState(roundTo(p.wage * 1.05, 1000));
  // luvas (livres e pré-contratos): 25% do valor sem contrato, à vista ou em 6/12 parcelas sem juros
  const luvaTotal = bonusKind ? signingBonus(season, p, humanId) : 0;
  const [luva, setLuva] = useState<'0' | '6' | '12'>(() => (balance >= luvaTotal ? '0' : '12'));
  const wageMax = Math.max(10_000, Math.round(p.wage * 3.5), demand ? demand.wage * 2 : 0);
  const wageMin = Math.max(1_000, Math.round(p.wage * 0.4));
  useEffect(() => {
    if (demand) setYears((y) => Math.min(demand.maxYears, Math.max(demand.minYears, y)));
  }, [demand?.minYears, demand?.maxYears]); // eslint-disable-line react-hooks/exhaustive-deps

  const step: 'fee' | 'contract' | 'done' | 'closed' | 'waiting' = !offer
    ? free
      ? 'contract'
      : 'fee'
    : offer.status === 'agreed'
      ? 'contract'
      : offer.status === 'completed'
        ? 'done'
        : offer.status === 'negotiating'
          ? 'fee'
          : offer.status === 'pending' && offer.toClubId === humanId
            ? 'waiting'
            : 'closed';

  /** "pensando" (solo: a IA "analisa"; online: ida e volta ao servidor) e depois aplica a ação */
  const run = (fn: () => Promise<void>) => {
    setError(null);
    setThinking(true);
    window.setTimeout(() => {
      void fn()
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setThinking(false));
    }, actions.online ? THINK_MS / 2 : THINK_MS);
  };

  const sendFee = (value: number, loanTerms?: { wageShare: number; purchaseOption?: number; recall?: boolean }) =>
    run(async () => {
      const k: OfferKind = kind === 'clause' ? 'transfer' : kind;
      const r = await actions.offer({
        player: p, fee: kind === 'clause' ? clause : value, kind: k, offerId: offer?.status === 'negotiating' ? offer.id : undefined, sellerInfo: target.sellerInfo,
        ...(k === 'loan' ? { loan: loanTerms ?? { wageShare: share, ...(withOption ? { purchaseOption: option } : {}), ...(recall ? { recall: true } : {}) } } : {}),
        ...(kind === 'clause' ? { clause: true } : {}),
      });
      if (r.error) setError(r.error);
      if (r.offer) setOfferId(r.offer.id);
    });

  const sendContract = () =>
    run(async () => {
      const r = await actions.contract({
        offerId: offer?.id, player: p, wage, years, sellerInfo: target.sellerInfo, releaseClause: clauseNew,
        ...(bonusKind && luvaTotal > 0 ? { luva: Number(luva) } : {}),
      });
      if (r.offer) setOfferId(r.offer.id);
      if (r.error) setError(r.error);
    });

  const lastReply = useMemo(() => {
    const log = offer?.log ?? [];
    for (let i = log.length - 1; i >= 0; i--) if (log[i].by !== 'buyer') return { entry: log[i], idx: i };
    return null;
  }, [offer]);

  const wageNow = useMemo(() => squads(humanId).reduce((t, x) => t + x.wage, 0), [humanId, season]); // eslint-disable-line react-hooks/exhaustive-deps
  const ceiling = boardWageCeiling(season, humanId);
  const kindOptions = [
    { value: 'transfer', label: 'Compra' },
    { value: 'loan', label: 'Empréstimo' },
    { value: 'clause', label: 'Pagar multa' },
    ...(canPre ? [{ value: 'precontract', label: 'Pré-contrato' }] : []),
  ] as { value: Kind; label: string }[];

  return (
    <>
      {/* cabeçalho */}
      <div className="relative overflow-hidden border-b border-line px-5 pt-5 pb-4">
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(100% 120% at 100% 0%, color-mix(in oklab, var(--club-primary) 30%, transparent), transparent 60%)' }} />
        <button onClick={onClose} aria-label="Fechar negociação" className="absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
          <X className="size-5" />
        </button>
        <div className="relative flex items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-white/10 bg-bg/60">
            <div className="text-center leading-none">
              <OvrBadge value={p.overall} size="lg" />
              <div className="mt-0.5 text-[9px] font-bold tracking-[0.2em] text-fg-muted">{POSITION_META[p.position].short}</div>
            </div>
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <h2 className="truncate text-lg font-extrabold tracking-tight">{p.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <ClubMini id={target.clubId} meta={clubMeta} withName />
              <span>·</span>
              <span className="tabular">{p.age} anos</span>
              <span>·</span>
              <span className="tabular">valor {fmtMoney(p.value)}</span>
            </div>
            {!free && (
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-fg-subtle">
                <span className={cn(months !== null && months <= MARKET.preContractMonths && 'font-semibold text-warning')}>
                  contrato: {months === null ? '—' : months < 1 ? 'último mês' : `${Math.round(months)} meses`}
                </span>
                <span>multa: {fmtMoney(clause)}</span>
              </div>
            )}
          </div>
        </div>
        {/* passos: clube → jogador */}
        <div className="relative mt-4 grid grid-cols-2 gap-2 text-[11px] font-semibold">
          <StepPill n={1} label={free ? 'Sem clube: sem taxa' : isPre ? 'Pré-contrato: sem taxa' : kind === 'clause' ? 'Multa ao clube' : 'Valor ao clube'} icon={<Building2 />} state={free || isPre ? 'skip' : step === 'fee' || step === 'waiting' ? 'on' : 'done'} />
          <StepPill n={2} label={offer?.kind === 'loan' || kind === 'loan' ? 'Jogador aceita o empréstimo' : 'Contrato com o jogador'} icon={<User />} state={step === 'contract' ? 'on' : step === 'done' ? 'done' : 'off'} />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
        {/* resposta animada */}
        <AnimatePresence mode="wait">
          {thinking ? (
            <motion.div key="thinking" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" />
              {step === 'contract' ? `${p.name} está avaliando…` : `A diretoria do ${clubDisplayName(target.clubId, clubMeta)} está analisando…`}
            </motion.div>
          ) : lastReply && step !== 'done' ? (
            <Reply key={lastReply.idx} entry={lastReply.entry} />
          ) : null}
        </AnimatePresence>

        {error && (
          <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -5, 5, -3, 0] }} className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger" role="alert">
            {error}
          </motion.p>
        )}

        {actions.blocked && step !== 'done' && step !== 'closed' && (
          <p className="mb-4 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-sm text-fg-muted">{actions.blocked}</p>
        )}

        {step === 'waiting' && offer && (
          <div className="grid place-items-center gap-2 py-6 text-center" role="status">
            <Hourglass className="size-10 text-warning" />
            <p className="text-sm font-semibold">
              Proposta de {fmtMoney(offer.fee)}{offer.kind === 'loan' ? ' (empréstimo)' : ''} enviada{sellerNick ? ` a ${sellerNick}` : ''}.
            </p>
            <p className="max-w-sm text-xs text-fg-muted">
              O dono do {offer.fromName} responde até o fim do planejamento. Sem resposta, a proposta é recusada quando a rodada avançar. Aceita, você negocia salário, anos e multa com o jogador.
            </p>
          </div>
        )}

        {step === 'fee' && (
          <div className="space-y-4">
            {humanSeller && (
              <p className="rounded-xl border border-club-accent/40 bg-club-accent/10 px-3.5 py-2.5 text-sm">
                {p.name} é de <b>{sellerNick}</b>, outro técnico da sala: a proposta fica pendente até ele aceitar ou recusar (até o fim do planejamento). A multa rescisória ele não pode recusar.
              </p>
            )}
            {!windowOpen && (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
                Janela fechada{win.opensOn ? ` até ${fmtDate(win.opensOn, { day: '2-digit', month: 'short' })}` : ''}: só jogadores livres e pré-contratos (últimos {MARKET.preContractMonths} meses de contrato).
              </p>
            )}
            {block && kind !== 'precontract' && (
              <p className="rounded-xl border border-danger/50 bg-danger/10 px-3.5 py-2.5 text-sm font-semibold text-danger" role="alert">{blockMessage(block.until)}</p>
            )}
            {refusals > 0 && kind !== 'precontract' && (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2 text-xs text-warning">
                {refusals} proposta{refusals > 1 ? 's' : ''} recusada{refusals > 1 ? 's' : ''} nesta janela. Na 3ª recusa o clube se irrita e não negocia por 14 dias.
              </p>
            )}
            <Segmented id="neg-kind" label="Tipo" value={kind} onChange={(v) => setKind(v as Kind)} options={kindOptions} />
            {kind === 'precontract' ? (
              <div className="space-y-2 rounded-xl border border-line bg-surface-2/40 p-3.5 text-sm">
                <p>O contrato de {p.name} com o {clubDisplayName(target.clubId, clubMeta)} termina em {months === null ? '—' : `${Math.round(months)} meses`}: dá para negociar direto com ele, sem taxa de transferência.</p>
                <p className="text-xs text-fg-muted">Ele chega quando o contrato atual terminar (virada da região do clube dele). Há luvas de {fmtMoney(signingBonus(season, p, humanId))}.</p>
              </div>
            ) : kind === 'clause' ? (
              <div className="space-y-2 rounded-xl border border-line bg-surface-2/40 p-3.5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><ShieldAlert className="size-4 text-club-accent" /> Multa rescisória: {fmtMoney(clause)}</p>
                <p className="text-xs text-fg-muted">Depositada a multa, o clube é obrigado a liberar o jogador. Ainda é preciso acertar o contrato com ele (que pode recusar).</p>
                <Impact rows={[['Caixa hoje', fmtMoney(balance)], ['Depois da multa', fmtMoney(balance - clause), balance - clause < -credit], ...budgetRows(clause)]} />
              </div>
            ) : (
              <div>
                <div className="mb-1.5 flex items-end justify-between">
                  <span className="text-[11px] font-semibold tracking-wider text-fg-muted uppercase">{kind === 'loan' ? 'Taxa de empréstimo' : 'Proposta ao clube'}</span>
                  <Rounds round={(offer?.round ?? 0) + 1} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-fg-muted" title="valores em euros">€</span>
                  <Input
                    inputMode="numeric"
                    aria-label="Valor da proposta"
                    value={fee.toLocaleString('pt-BR')}
                    onChange={(e) => setFee(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
                    className="tabular h-12 text-xl font-bold"
                  />
                </div>
                <input
                  type="range"
                  aria-label="Ajustar valor"
                  min={0}
                  max={feeMax}
                  step={50_000}
                  value={Math.min(fee, feeMax)}
                  onChange={(e) => setFee(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--club-accent)]"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(kind === 'loan'
                    ? [{ label: 'Sem taxa', v: 0 }, { label: '5% do valor', v: p.value * 0.05 }, ...(offer?.counterFee ? [{ label: 'Pedida do clube', v: offer.counterFee }] : [])]
                    : [
                        { label: 'Valor de mercado', v: p.value },
                        { label: '90%', v: p.value * 0.9 },
                        { label: '+15%', v: p.value * 1.15 },
                        ...(offer?.counterFee ? [{ label: 'Pedida do clube', v: offer.counterFee }] : []),
                      ]
                  ).map((s) => (
                    <button key={s.label} type="button" onClick={() => setFee(roundTo(s.v, 50_000))} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-[11px] font-semibold text-fg-muted hover:text-fg">
                      {s.label} · {fmtMoney(s.v)}
                    </button>
                  ))}
                </div>
                {kind === 'loan' && (
                  <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                        <span>Salário pago por vocês</span>
                        <span className="tabular normal-case tracking-normal text-fg">{share}% · {fmtMoney(Math.round((p.wage * share) / 100))}/mês</span>
                      </div>
                      <input type="range" aria-label="Porcentagem do salário" min={0} max={100} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} className="w-full accent-[var(--club-accent)]" />
                      <p className="text-[11px] text-fg-subtle">O {clubDisplayName(target.clubId, clubMeta)} paga o resto. Empréstimo de 1 temporada: volta na virada da sua região.</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={withOption} onChange={(e) => setWithOption(e.target.checked)} className="accent-[var(--club-accent)]" />
                      Opção de compra fixa
                    </label>
                    {withOption && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-fg-muted">€</span>
                        <Input inputMode="numeric" aria-label="Valor da opção de compra" value={option.toLocaleString('pt-BR')} onChange={(e) => setOption(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} className="tabular h-10 font-bold" />
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={recall} onChange={(e) => setRecall(e.target.checked)} className="accent-[var(--club-accent)]" />
                      O dono pode chamar de volta na próxima janela
                    </label>
                  </div>
                )}
                <div className="mt-4">
                  <Impact rows={[['Caixa hoje', fmtMoney(balance)], ['Depois da proposta', fmtMoney(balance - fee), balance - fee < -credit], ...budgetRows(fee)]} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'contract' && (
          <div className="space-y-4">
            {offer && offer.fee > 0 && (
              <p className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-success">
                <Handshake className="size-4 shrink-0" /> {offer.clause ? `Multa de ${fmtMoney(offer.fee)} depositada.` : `Acordo com o clube por ${fmtMoney(offer.fee)}.`} Agora, convença o jogador.
              </p>
            )}
            {appeal?.refuses && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {p.name} não está animado: {appeal.reason}. Só aceita com salário muito acima do pedido (×{appeal.moneyTalks.toFixed(1)}).
              </p>
            )}
            <div>
              <div className="mb-1.5 flex items-end justify-between">
                <span className="text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Salário mensal</span>
                <Rounds round={(offer?.contractRound ?? 0) + 1} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-fg-muted" title="valores em euros">€</span>
                <Input inputMode="numeric" aria-label="Salário mensal" value={wage.toLocaleString('pt-BR')} onChange={(e) => setWage(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} className="tabular h-12 text-xl font-bold" />
              </div>
              <input type="range" aria-label="Ajustar salário" min={wageMin} max={wageMax} step={1000} value={Math.min(Math.max(wage, wageMin), wageMax)} onChange={(e) => setWage(Number(e.target.value))} className="mt-3 w-full accent-[var(--club-accent)]" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  { label: 'Salário atual', v: p.wage },
                  { label: '+15%', v: p.wage * 1.15 },
                  { label: '+30%', v: p.wage * 1.3 },
                  ...(offer?.askedWage ? [{ label: 'Pedida do jogador', v: offer.askedWage }] : []),
                ].map((s) => (
                  <button key={s.label} type="button" onClick={() => setWage(roundTo(s.v, 1000))} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-[11px] font-semibold text-fg-muted hover:text-fg">
                    {s.label} · {fmtMoney(s.v)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                <span>Duração</span>
                {demand && (
                  <span className="normal-case tracking-normal text-fg-subtle">
                    prefere {demand.minYears}–{demand.maxYears} anos{demand.role ? ` · ${demand.role === 'starter' ? 'seria titular' : demand.role === 'rotation' ? 'rodízio' : 'banco'}` : ''}
                  </span>
                )}
              </div>
              <Segmented id="neg-years" label="Duração do contrato" value={String(years)} onChange={(v) => setYears(Number(v))} options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y} ${y > 1 ? 'anos' : 'ano'}` }))} />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                <span>Multa rescisória</span>
                <span className="normal-case tracking-normal text-fg-subtle">{worth > 0 ? `${(clauseNew / worth).toFixed(1)}× o valor` : ''}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-fg-muted">€</span>
                <Input inputMode="numeric" aria-label="Multa rescisória" value={clauseNew.toLocaleString('pt-BR')} onChange={(e) => setClauseNew(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} className="tabular h-10 font-bold" />
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">Quem depositar esse valor leva o jogador sem negociar com você. Multa baixa agrada o jogador; muito alta, ele pede mais salário.</p>
            </div>
            {bonusKind && luvaTotal > 0 && (
              <div>
                <div className="mb-1.5 flex justify-between text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
                  <span>Luvas</span>
                  <span className="tabular normal-case tracking-normal text-fg">{fmtMoney(luvaTotal)}</span>
                </div>
                <Segmented
                  id="neg-luva"
                  label="Forma de pagamento das luvas"
                  value={luva}
                  onChange={setLuva}
                  options={[
                    { value: '0', label: 'À vista' },
                    { value: '6', label: `6x ${fmtMoney(Math.ceil(luvaTotal / 6))}` },
                    { value: '12', label: `12x ${fmtMoney(Math.ceil(luvaTotal / 12))}` },
                  ]}
                />
                <p className="mt-1.5 text-[11px] text-fg-subtle">
                  25% do valor do jogador, sem taxa de transferência. Parcelas sem juros, cobradas no dia 1; dá para quitar em Finanças.
                </p>
              </div>
            )}
            <Impact
              rows={[
                ['Folha atual', `${fmtMoney(wageNow)}/mês`],
                ['Com o reforço', `${fmtMoney(wageNow + wage)}/mês`, ceiling > 0 && (wageNow + wage) * 12 > ceiling],
                ...(ceiling > 0 ? ([['Teto da folha (diretoria)', `${fmtMoney(ceiling / 12)}/mês`]] as [string, string, boolean?][]) : []),
                ['Custo do contrato', fmtMoney(wage * 12 * years)],
                ...(bonusKind && luvaTotal > 0
                  ? luva === '0'
                    ? ([['Caixa após as luvas', fmtMoney(balance - luvaTotal), balance - luvaTotal < -credit]] as [string, string, boolean?][])
                    : ([['Luvas por mês', `${fmtMoney(Math.ceil(luvaTotal / Number(luva)))} × ${luva}`]] as [string, string, boolean?][])
                  : []),
              ]}
            />
          </div>
        )}

        {step === 'done' && offer && <Celebration offer={offer} onClose={onClose} clubMeta={clubMeta} />}

        {step === 'closed' && offer && (
          <div className="grid place-items-center gap-2 py-6 text-center">
            <XCircle className="size-10 text-danger" />
            <p className="text-sm font-semibold">
              {offer.status === 'collapsed' ? `${p.name} recusou.` : offer.status === 'withdrawn' ? 'Você desistiu da negociação.' : offer.status === 'expired' ? 'A negociação expirou.' : 'O clube encerrou as negociações.'}
            </p>
            {lastReply?.entry.text && <p className="text-xs text-fg-muted">{lastReply.entry.text}</p>}
          </div>
        )}

        {offer && offer.log.length > 1 && <NegotiationHistory offer={offer} />}
      </div>

      {/* ações */}
      {(step === 'fee' || step === 'contract' || step === 'closed' || step === 'waiting') && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {offer && (offer.status === 'negotiating' || offer.status === 'agreed' || step === 'waiting') && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              disabled={thinking || !!actions.blocked}
              onClick={() => {
                void actions.withdraw(offer.id);
                onClose();
              }}
            >
              {step === 'waiting' ? 'Retirar proposta' : 'Desistir'}
            </Button>
          )}
          {step === 'closed' || step === 'waiting' ? (
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          ) : step === 'fee' ? (
            <>
              {offer?.counterFee !== undefined && offer.status === 'negotiating' && !block && (
                <Button variant="outline" disabled={thinking || !!actions.blocked} onClick={() => {
                  setFee(offer.counterFee!);
                  if (offer.counterLoan) {
                    setShare(offer.counterLoan.wageShare);
                    if (offer.counterLoan.purchaseOption !== undefined) setOption(offer.counterLoan.purchaseOption);
                  }
                  sendFee(offer.counterFee!, offer.kind === 'loan' ? offer.counterLoan : undefined);
                }}>
                  <Check /> Aceitar {offer.kind === 'loan' && offer.counterLoan ? `${offer.counterLoan.wageShare}%${offer.counterFee ? ` + ${fmtMoney(offer.counterFee)}` : ''}` : fmtMoney(offer.counterFee)}
                </Button>
              )}
              <Button variant="club" disabled={thinking || (!windowOpen && kind !== 'precontract') || (!!block && kind !== 'precontract') || !!actions.blocked} onClick={() => sendFee(fee)}>
                <MessageSquareQuote /> {kind === 'precontract' ? 'Falar com o jogador' : kind === 'clause' ? 'Depositar a multa' : humanSeller ? `Enviar a ${sellerNick}` : offer ? 'Nova proposta' : 'Enviar proposta'}
              </Button>
            </>
          ) : (
            <Button variant="club" disabled={thinking || !!actions.blocked} onClick={sendContract}>
              <FileSignature /> {isPre ? 'Assinar pré-contrato' : 'Propor contrato'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function StepPill({ n, label, icon, state }: { n: number; label: string; icon: ReactNode; state: 'on' | 'done' | 'off' | 'skip' }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors [&_svg]:size-3.5',
        state === 'on' ? 'border-club-accent/50 bg-club-accent/10 text-fg' : state === 'done' ? 'border-success/40 bg-success/10 text-success' : 'border-line text-fg-subtle',
      )}
    >
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-black', state === 'on' ? 'bg-club-accent text-club-on-accent' : state === 'done' ? 'bg-success text-bg' : 'bg-surface-3')}>
        {state === 'done' ? <Check className="size-3" /> : n}
      </span>
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Rounds({ round }: { round: number }) {
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-fg-subtle" title={`Rodada ${Math.min(round, MARKET.maxRounds)} de ${MARKET.maxRounds}`}>
      rodada
      {Array.from({ length: MARKET.maxRounds }, (_, i) => (
        <span key={i} className={cn('size-1.5 rounded-full', i < round ? 'bg-club-accent' : 'bg-surface-3')} />
      ))}
    </span>
  );
}

function Reply({ entry }: { entry: OfferRound }) {
  const tone = entry.decision === 'accept' ? 'success' : entry.decision === 'counter' ? 'warning' : 'danger';
  const label = entry.decision === 'accept' ? 'Aceito!' : entry.decision === 'counter' ? 'Contraproposta' : 'Recusado';
  const Icon = entry.decision === 'accept' ? BadgeCheck : entry.decision === 'counter' ? MessageSquareQuote : XCircle;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      className="mb-4 rounded-xl border px-3.5 py-3"
      style={{ borderColor: `color-mix(in oklab, var(--color-${tone}) 45%, transparent)`, background: `color-mix(in oklab, var(--color-${tone}) 10%, transparent)` }}
      role="status"
    >
      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: `var(--color-${tone})` }}>
        <motion.span initial={{ rotate: -30, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.1, type: 'spring' }}>
          <Icon className="size-4" />
        </motion.span>
        {entry.by === 'player' ? 'Jogador' : 'Clube'}: {label}
        {entry.decision === 'counter' && entry.by !== 'player' && entry.fee ? <span className="tabular ml-auto">{fmtMoney(entry.fee)}</span> : null}
        {entry.decision === 'counter' && entry.by === 'player' && entry.wage ? <span className="tabular ml-auto">{fmtMoney(entry.wage)}/mês</span> : null}
      </div>
      {entry.text && <p className="mt-1 text-xs text-fg-muted">{entry.text}</p>}
    </motion.div>
  );
}

/** (Etapa 5) Histórico da negociação: cada proposta e resposta (clube → jogador). */
function NegotiationHistory({ offer }: { offer: TransferOffer }) {
  const who = (l: OfferRound) => (l.by === 'buyer' ? (offer.fromClubId && offer.toName ? offer.toName : 'Você') : l.by === 'seller' ? offer.fromName || 'Clube' : offer.player.name);
  return (
    <details className="mt-4 rounded-xl border border-line/70 bg-surface-2/30 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-fg-muted">
        <History className="size-3.5" /> Histórico ({offer.log.length})
      </summary>
      <ol className="mt-2 space-y-1.5">
        {offer.log.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="tabular w-12 shrink-0 text-fg-subtle">{fmtDate(l.date, { day: '2-digit', month: 'short' })}</span>
            <span className="min-w-0">
              <b className={l.by === 'buyer' ? 'text-club-accent' : l.by === 'player' ? 'text-fg' : 'text-fg-muted'}>{who(l)}</b>
              {l.fee !== undefined ? ` · ${fmtMoney(l.fee)}` : ''}
              {l.wage !== undefined ? ` · ${fmtMoney(l.wage)}/mês` : ''}
              {l.years !== undefined && l.by === 'buyer' ? ` · ${l.years} ${l.years > 1 ? 'anos' : 'ano'}` : ''}
              {l.decision ? ` · ${l.decision === 'accept' ? 'aceitou' : l.decision === 'counter' ? 'contrapropôs' : 'recusou'}` : ''}
              {l.text ? <span className="block text-fg-subtle">{l.text}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Impact({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-line/70 bg-surface-2/40 p-3 text-xs">
      {rows.map(([k, v, bad]) => (
        <div key={k} className="flex justify-between gap-3">
          <span className="text-fg-muted">{k}</span>
          <span className={cn('tabular font-semibold', bad && 'text-danger')}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Celebration({ offer, onClose, clubMeta }: { offer: TransferOffer; onClose: () => void; clubMeta: Map<string, ClubIndexEntry> }) {
  const navigate = useNavigate();
  const pieces = useRef(
    Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % 100, d: 0.2 + ((i * 13) % 10) / 20, r: (i * 47) % 360, c: i % 3 })),
  ).current;
  const pre = offer.kind === 'precontract';
  return (
    <div className="relative grid place-items-center overflow-hidden py-4 text-center">
      {pieces.map((pc, i) => (
        <motion.span
          key={i}
          className="pointer-events-none absolute top-0 h-2.5 w-1.5 rounded-sm"
          style={{ left: `${pc.x}%`, background: pc.c === 0 ? 'var(--club-primary)' : pc.c === 1 ? 'var(--club-accent)' : 'var(--club-secondary)' }}
          initial={{ y: -20, opacity: 0, rotate: 0 }}
          animate={{ y: 260, opacity: [0, 1, 1, 0], rotate: pc.r }}
          transition={{ duration: 1.6, delay: pc.d, ease: 'easeOut' }}
        />
      ))}
      <motion.div initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="grid size-20 place-items-center rounded-full bg-success/15 text-success ring-4 ring-success/20">
        <PartyPopper className="size-9" />
      </motion.div>
      <motion.h3 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-4 text-xl font-extrabold tracking-tight">
        {pre ? 'Pré-contrato assinado!' : 'Negócio fechado!'}
      </motion.h3>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-1 text-sm text-fg-muted">
        {pre ? `${offer.player.name} chega ao ${offer.toName} quando terminar o contrato com o ${offer.fromName}.` : `${offer.player.name} é o novo reforço do ${offer.toName}.`}
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="mt-4 flex items-center gap-3 text-xs">
        <ClubMini id={offer.fromClubId} meta={clubMeta} size={28} />
        <span className="text-fg-subtle">→</span>
        <ClubMini id={offer.toClubId} meta={clubMeta} size={28} />
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="mt-4 grid w-full grid-cols-3 gap-2 text-xs">
        <Mini label={offer.kind === 'loan' ? 'Empréstimo' : pre ? 'Luvas' : offer.clause ? 'Multa paga' : 'Transferência'} value={fmtMoney(pre ? offer.luva ?? 0 : offer.fee)} />
        <Mini label="Salário" value={`${fmtMoney(offer.wage ?? offer.player.wage)}/mês`} />
        <Mini label="Contrato" value={offer.kind === 'loan' ? `${offer.loan?.wageShare ?? 100}% do salário` : ((offer.years ?? 1) === 1 ? '1 ano' : `${offer.years} anos`)} />
      </motion.div>
      <div className="mt-5 flex gap-2">
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
        {!pre && (
          <Button
            variant="club"
            onClick={() => {
              onClose();
              navigate('/elenco');
            }}
          >
            Ver no elenco
          </Button>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-2 py-2">
      <div className="text-[10px] tracking-wide text-fg-subtle uppercase">{label}</div>
      <div className="tabular mt-0.5 font-bold">{value}</div>
    </div>
  );
}
