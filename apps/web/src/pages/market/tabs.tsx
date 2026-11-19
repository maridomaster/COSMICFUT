import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MoneyField } from '@/components/ui/money-field';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Clock, FileClock, Handshake, Inbox, ListX, Star, Tag, UserPlus, X } from 'lucide-react';
import type { ClubIndexEntry, Country, Player } from '@cosmicfut/shared';
import { loansOf, monthsLeftOf, preContractOpen, releaseClauseOf, type SeasonState, type TransferOffer, type TransferRecord } from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { fmtDate, fmtMoney } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { useOnline } from '@/store/online';
import { daysBetween } from '@/season/view';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/range';
import { Flag, OvrBadge, PositionChip } from '@/components/game/bits';
import { AgeChip } from '@/components/game/chips';
import { FitScroll } from '@/components/ui/fit-scroll';
import { useMarketActions } from './actions';
import { RenewForm } from '@/components/game/market';
import { ClubMini } from './common';
import { ResultRow } from './SearchTab';
import { fetchRows, useSearchStatus } from './searchClient';
import type { MarketRowOut } from './searchTypes';

function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-fg-subtle [&_svg]:size-6">{icon}</span>
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

const STATUS_LABEL: Record<TransferOffer['status'], { label: string; tone: string }> = {
  negotiating: { label: 'Negociando', tone: 'var(--color-warning)' },
  agreed: { label: 'Acordo com o clube', tone: 'var(--club-accent)' },
  completed: { label: 'Concluída', tone: 'var(--color-success)' },
  collapsed: { label: 'Jogador recusou', tone: 'var(--color-danger)' },
  rejected: { label: 'Recusada', tone: 'var(--color-danger)' },
  withdrawn: { label: 'Desistência', tone: 'var(--color-fg-subtle)' },
  expired: { label: 'Expirada', tone: 'var(--color-fg-subtle)' },
  pending: { label: 'Aguardando você', tone: 'var(--color-warning)' },
};

export function StatusPill({ status, outgoing }: { status: TransferOffer['status']; outgoing?: boolean }) {
  // (online) minha proposta a outro humano, pendente: quem precisa agir é o dono do jogador
  const m = outgoing && status === 'pending' ? { label: 'Aguardando o dono', tone: 'var(--color-warning)' } : STATUS_LABEL[status];
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-bold tracking-wide uppercase"
      style={{ color: m.tone, background: `color-mix(in oklab, ${m.tone} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.tone} 30%, transparent)` }}
    >
      {m.label}
    </span>
  );
}

/* ───────────── Observados ───────────── */

export function ShortlistTab({ onOpen, countries, clubMeta, moves }: { onOpen: (id: string) => void; countries: Map<number, Country>; clubMeta: Map<string, ClubIndexEntry>; moves: Record<string, string> | undefined }) {
  const shortlist = useGame((s) => s.shortlist);
  const ready = useSearchStatus((s) => s.status === 'ready');
  const rev = useSearchStatus((s) => s.rev);
  const [rows, setRows] = useState<MarketRowOut[]>([]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void fetchRows(shortlist).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [shortlist, ready, moves, rev]);
  if (!shortlist.length) return <Card><Empty icon={<Star />} title="Nenhum jogador observado" hint="Toque na estrela de um jogador na busca (ou no card dele) para acompanhá-lo aqui." /></Card>;
  return (
    <Card className="px-1.5 py-1 sm:px-2">
      <FitScroll bottom={28}>
      <ul className="divide-y divide-line/40">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="h-[60px] md:h-9">
              <ResultRow row={r} onOpen={onOpen} country={countries.get(r.nat)} clubMeta={clubMeta} watched />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      </FitScroll>
    </Card>
  );
}

/* ───────────── Minhas negociações ───────────── */

export function NegotiationsTab({ season, humanId, clubMeta, onContinue }: { season: SeasonState; humanId: string; clubMeta: Map<string, ClubIndexEntry>; onContinue: (o: TransferOffer) => void }) {
  const offers = useMemo(() => (season.market?.offers ?? []).filter((o) => o.toClubId === humanId), [season.market?.offers, humanId]);
  if (!offers.length) return <Card><Empty icon={<Handshake />} title="Nenhuma negociação ainda" hint="Busque um jogador e clique em “Fazer proposta”." /></Card>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {offers.map((o, i) => {
        const waiting = o.status === 'pending';
        const open = o.status === 'negotiating' || o.status === 'agreed' || waiting;
        const last = [...o.log].reverse().find((l) => l.by !== 'buyer');
        return (
          <motion.div key={o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, ease: EASE_OUT }}>
            <Card className={cn('h-full p-3', open && 'ring-1 ring-club-accent/30')}>
              <div className="flex items-start gap-3">
                <ClubMini id={o.fromClubId} meta={clubMeta} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <PositionChip position={o.player.position} foot={o.player.side} className="h-4 w-8 text-[9px]" />
                    <span className="truncate font-semibold">{o.player.name}</span>
                    <OvrBadge value={o.player.overall} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-fg-muted">
                    {o.fromName} · {o.kind === 'free' ? 'jogador livre' : o.kind === 'loan' ? 'empréstimo' : 'compra'}
                  </div>
                </div>
                <StatusPill status={o.status} outgoing />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Kv k="Sua proposta" v={fmtMoney(o.fee)} />
                <Kv k={o.counterFee ? 'Pedida' : 'Rodada'} v={o.counterFee ? fmtMoney(o.counterFee) : `${o.round}/3`} />
                <Kv k={o.wage ? 'Salário' : 'Atualizada'} v={o.wage ? `${fmtMoney(o.wage)}/mês` : fmtDate(o.updatedOn, { day: '2-digit', month: 'short' })} />
              </div>
              {last?.text && <p className="mt-2 line-clamp-2 text-xs text-fg-muted">“{last.text}”</p>}
              {open && (
                <Button variant="club" size="sm" className="mt-3 w-full" onClick={() => onContinue(o)}>
                  {waiting ? 'Ver proposta' : o.status === 'agreed' ? 'Negociar contrato' : 'Continuar negociação'} <ArrowRight />
                </Button>
              )}
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line/70 bg-surface-2/40 px-2 py-1.5">
      <div className="truncate text-[10px] tracking-wide text-fg-subtle uppercase">{k}</div>
      <div className="tabular truncate font-semibold">{v}</div>
    </div>
  );
}

/* ───────────── Ofertas recebidas ───────────── */

export function IncomingTab({ season, humanId, clubMeta, onOpen }: { season: SeasonState; humanId: string; clubMeta: Map<string, ClubIndexEntry>; onOpen?: (id: string) => void }) {
  const actions = useMarketActions();
  const players = useOnline((s) => s.room?.players);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [counter, setCounter] = useState<Record<string, number>>({});
  const all = season.market?.offers.filter((o) => o.fromClubId === humanId) ?? [];
  const pending = all.filter((o) => o.status === 'pending');
  const past = all.filter((o) => o.status !== 'pending').slice(0, 12);
  const balance = season.clubs[humanId]?.balance ?? 0;
  const wageBill = squads(humanId).reduce((t, p) => t + p.wage, 0);
  /** (online) o comprador é outro técnico humano da sala */
  const coach = (clubId: string) => (actions.online ? (players?.find((p) => p.clubId === clubId)?.nickname ?? null) : null);
  const done = (o: TransferOffer, after: TransferOffer | undefined, accept: boolean, error?: string) => {
    if (error) return setMsg({ id: o.id, text: error, ok: false });
    const st = after?.status;
    if (st === 'collapsed') return setMsg({ id: o.id, text: after?.log.at(-1)?.text ?? `${o.player.name} não quis ir.`, ok: false });
    if (st === 'completed') return setMsg({ id: o.id, text: `${o.player.name} foi ${o.kind === 'loan' ? 'emprestado' : 'vendido'} ao ${o.toName}${o.kind === 'loan' ? '' : ` por ${fmtMoney(after?.fee ?? o.fee)}`}.`, ok: true });
    if (st === 'pending') return setMsg({ id: o.id, text: after?.log.at(-1)?.text ?? 'O comprador respondeu.', ok: true });
    if (st === 'agreed') return setMsg({ id: o.id, text: `Acordo com o ${o.toName}: agora ele negocia salário e anos com ${o.player.name}.`, ok: true });
    setMsg({ id: o.id, text: accept ? (after?.log.at(-1)?.text ?? 'Negociação encerrada.') : `Oferta do ${o.toName} recusada.`, ok: false });
  };
  const respond = async (o: TransferOffer, accept: boolean) => {
    setBusy(o.id);
    const r = await actions.respond(o.id, accept);
    setBusy(null);
    done(o, r.offer, accept, r.error);
  };
  const sendCounter = async (o: TransferOffer) => {
    const fee = counter[o.id];
    if (!fee) return;
    setBusy(o.id);
    const r = await actions.counter(o.id, fee);
    setBusy(null);
    done(o, r.offer, true, r.error);
  };
  return (
    <div className="space-y-2.5">
      <AnimatePresence>
        {msg && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm', msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-line bg-surface-2 text-fg-muted')} role="status">
            {msg.ok ? <Check className="size-4" /> : <Inbox className="size-4" />} {msg.text}
            <button aria-label="Fechar aviso" className="ml-auto" onClick={() => setMsg(null)}>
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!pending.length ? (
        <Card><Empty icon={<Inbox />} title="Nenhuma oferta pendente" hint="Coloque jogadores na lista de transferências: clubes da IA fazem ofertas durante a janela. Seus destaques também podem atrair propostas." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {pending.map((o) => {
              const days = o.expiresOn ? Math.max(0, daysBetween(season.date, o.expiresOn)) : null;
              const ratio = o.player.value ? o.fee / o.player.value : 1;
              return (
                <motion.div key={o.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 40 }} transition={{ ease: EASE_OUT }}>
                  <Card className="h-full p-3 ring-1 ring-warning/30">
                    <div className="flex items-center gap-3">
                      <ClubMini id={o.toClubId} meta={clubMeta} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-fg-muted">
                          {coach(o.toClubId) ? <><b className="text-club-accent">{coach(o.toClubId)}</b> ({o.toName})</> : o.toName} quer{o.kind === 'loan' ? ' emprestado' : ''}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <PositionChip position={o.player.position} foot={o.player.side} className="h-4 w-8 text-[9px]" />
                          {/* (19/11) clicar no nome abre a ficha com as estatísticas */}
                          <button type="button" className="cursor-pointer truncate font-semibold underline-offset-2 hover:text-club-accent hover:underline" onClick={() => onOpen?.(o.playerId)} title={`Ver ficha de ${o.player.name}`} data-testid="incoming-player">
                            {o.player.name}
                          </button>
                          <OvrBadge value={o.player.overall} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-lg font-black text-success">{o.kind === 'loan' ? `${o.loan?.wageShare ?? 100}%` : fmtMoney(o.fee)}</div>
                        <div className={cn('text-[10px] font-semibold', ratio >= 1 ? 'text-success' : 'text-fg-subtle')}>{o.kind === 'loan' ? 'do salário pago por eles' : `${Math.round(ratio * 100)}% do valor`}</div>
                        {/* (18/11) quanto o jogador vale no mercado, para comparar com a oferta */}
                        <div className="text-[11px] text-fg-muted" data-testid="offer-player-value">
                          Vale <b className="tabular font-bold text-fg">{fmtMoney(o.player.value)}</b>
                        </div>
                      </div>
                    </div>
                    {/* (Etapa 5) etapas: você (clube) → o jogador decide se vai */}
                    <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] font-semibold text-fg-subtle">
                      <span className="rounded-lg border border-club-accent/40 bg-club-accent/10 px-2 py-1 text-fg">1 · Você responde ao clube</span>
                      <span className="rounded-lg border border-line px-2 py-1">2 · {o.player.name.split(' ')[0]} aceita ou não o {o.toName}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <Kv k="Caixa" v={<span>{fmtMoney(balance)} → <b className="text-success">{fmtMoney(balance + o.fee)}</b></span>} />
                      <Kv k="Folha/mês" v={<span>{fmtMoney(wageBill)} → <b className="text-success">{fmtMoney(wageBill - (o.kind === 'loan' ? Math.round((o.player.wage * (o.loan?.wageShare ?? 100)) / 100) : o.player.wage))}</b></span>} />
                    </div>
                    {o.log.length > 1 && <p className="mt-2 line-clamp-2 text-[11px] text-fg-muted">“{o.log.at(-1)?.text ?? ''}”</p>}
                    {o.kind !== 'loan' && !coach(o.toClubId) && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs font-bold text-fg-muted">€</span>
                        <MoneyField value={counter[o.id] || 0} className="flex-1">
                          <input
                            inputMode="numeric"
                            aria-label={`Contraproposta por ${o.player.name}`}
                            placeholder={fmtMoney(Math.round((o.fee * 1.2) / 50_000) * 50_000)}
                            value={counter[o.id] ? counter[o.id].toLocaleString('pt-BR') : ''}
                            onChange={(e) => setCounter((c) => ({ ...c, [o.id]: Number(e.target.value.replace(/\D/g, '')) || 0 }))}
                            className="tabular h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-sm"
                          />
                        </MoneyField>
                        <Button size="sm" variant="outline" disabled={busy === o.id || !!actions.blocked || !counter[o.id]} onClick={() => void sendCounter(o)}>
                          Contrapropor
                        </Button>
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      {coach(o.toClubId) ? (
                        <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                          <Clock className="size-3.5" /> responda até o fim do planejamento
                        </span>
                      ) : days !== null && (
                        <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                          <Clock className="size-3.5" /> expira em {days === 1 ? '1 dia' : `${days} dias`}
                        </span>
                      )}
                      <Button size="sm" variant="outline" disabled={busy === o.id || !!actions.blocked} onClick={() => void respond(o, false)}>
                        <X /> Recusar
                      </Button>
                      <Button size="sm" variant="club" disabled={busy === o.id || !!actions.blocked} onClick={() => void respond(o, true)}>
                        <Check /> Aceitar
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      {past.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Respondidas / expiradas</h3>
          <ul className="divide-y divide-line/50 text-sm">
            {past.map((o) => (
              <li key={o.id} className="flex items-center gap-2 py-2">
                <ClubMini id={o.toClubId} meta={clubMeta} />
                <span className="min-w-0 flex-1 truncate">
                  {o.player.name} <span className="text-fg-subtle">· {o.toName}</span>
                </span>
                <span className="tabular text-xs">{fmtMoney(o.fee)}</span>
                <StatusPill status={o.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ───────────── Lista de transferências ───────────── */

export function TransferListTab({ season, humanId, players, countries, onOpen }: { season: SeasonState; humanId: string; players: Player[]; countries: Map<number, Country>; onOpen: (id: string) => void }) {
  const actions = useMarketActions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (ids: string[], on: boolean) => {
    setBusy(true);
    const r = await actions.setListed(ids, on);
    setBusy(false);
    setErr(r.error ?? null);
  };
  const actLoan = async (id: string, on: boolean) => {
    setBusy(true);
    const r = await actions.setLoanListed([id], on);
    setBusy(false);
    setErr(r.error ?? null);
  };
  const listed = new Set((season.market?.transferList ?? []).filter((id) => players.some((p) => p.id === id)));
  const loanListed = new Set(season.market?.loanList ?? []);
  const offersBy = new Map<string, number>();
  for (const o of season.market?.offers ?? []) if (o.fromClubId === humanId && o.status === 'pending') offersBy.set(o.playerId, (offersBy.get(o.playerId) ?? 0) + 1);
  const sorted = [...players].sort((a, b) => Number(listed.has(b.id)) - Number(listed.has(a.id)) || b.overall - a.overall);
  const min = season.market?.rules.minSquad ?? 18;
  return (
    <Card className="px-1.5 py-1.5 sm:px-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1.5 text-xs text-fg-muted">
        <span>
          <b className="text-fg">{listed.size}</b> à venda · elenco com <b className="text-fg">{players.length}</b> (mínimo {min})
        </span>
        {listed.size > 0 && (
          <Button size="sm" variant="ghost" disabled={busy || !!actions.blocked} onClick={() => void act([...listed].filter((id) => players.some((p) => p.id === id)), false)}>
            <ListX /> Limpar lista
          </Button>
        )}
      </div>
      {(err || actions.blocked) && <p className="px-2 pb-2 text-xs text-warning" role="status">{err ?? actions.blocked}</p>}
      <FitScroll bottom={28}>
      <ul className="divide-y divide-line/40">
        {sorted.map((p) => {
          const on = listed.has(p.id);
          const n = offersBy.get(p.id) ?? 0;
          return (
            <li key={p.id} className={cn('cf-row flex items-center gap-2 px-1.5 py-1', on && 'bg-warning/5')}>
              <PositionChip position={p.position} foot={p.side} />
              <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpen(p.id)} title={`${p.name} — ${p.age} anos · valor ${fmtMoney(p.value)} · ${fmtMoney(p.wage)}/mês`}>
                <span className="truncate text-[13px] font-semibold">{p.name}</span>
                <Flag country={countries.get(p.nationalityId)} />
                {n > 0 && <span className="rounded-full bg-warning px-1.5 text-[10px] font-black whitespace-nowrap text-bg">{n} oferta{n > 1 ? 's' : ''}</span>}
              </button>
              <AgeChip age={p.age} />
              <span className="tabular hidden w-16 text-right text-xs text-fg-muted sm:block">{fmtMoney(p.value)}</span>
              <span className="tabular hidden w-16 text-right text-xs text-fg-muted lg:block">{fmtMoney(p.wage)}</span>
              <OvrBadge value={p.overall} />
              <Button size="sm" variant={loanListed.has(p.id) ? 'outline' : 'ghost'} className="hidden w-[6.5rem] shrink-0 sm:inline-flex" disabled={busy || !!actions.blocked} onClick={() => void actLoan(p.id, !loanListed.has(p.id))} aria-pressed={loanListed.has(p.id)} title="Clubes da IA fazem propostas de empréstimo durante a janela">
                <ArrowRight /> {loanListed.has(p.id) ? 'Emprestável' : 'Emprestar'}
              </Button>
              <Button size="sm" variant={on ? 'outline' : 'ghost'} className="w-[5.5rem] shrink-0" disabled={busy || !!actions.blocked} onClick={() => void act([p.id], !on)} aria-pressed={on}>
                <Tag /> {on ? 'À venda' : 'Vender'}
              </Button>
            </li>
          );
        })}
      </ul>
      </FitScroll>
    </Card>
  );
}

/* ───────────── Movimentações ───────────── */

export function HistoryTab({ season, humanId, clubMeta }: { season: SeasonState; humanId: string; clubMeta: Map<string, ClubIndexEntry> }) {
  const [scope, setScope] = useState<'all' | 'mine' | 'big'>('all');
  const list = (season.market?.history ?? []).filter((r) =>
    scope === 'mine' ? r.fromClubId === humanId || r.toClubId === humanId : scope === 'big' ? r.fee >= 5_000_000 || r.overall >= 78 : true,
  );
  const spent = (season.market?.history ?? []).reduce((t, r) => t + (r.kind === 'transfer' || r.kind === 'loan' ? r.fee : 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <Segmented id="hist" label="Filtrar movimentações" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Todas' }, { value: 'mine', label: 'Minhas' }, { value: 'big', label: 'Destaques' }]} />
        </div>
        <span className="text-xs text-fg-muted">
          {(season.market?.history ?? []).length} movimentações · {fmtMoney(spent)} movimentados
        </span>
      </div>
      {!list.length ? (
        <Card><Empty icon={<ArrowRight />} title="Nenhuma movimentação" hint="Durante a janela, os clubes da IA compram e vendem a cada dia. Avance no calendário para ver o mercado se mexer." /></Card>
      ) : (
        <Card className="px-1.5 py-1 sm:px-2">
          <FitScroll bottom={28}>
          <ul className="divide-y divide-line/40">
            {list.slice(0, 200).map((r, i) => (
              <HistoryRow key={`${r.playerId}:${r.date}:${i}`} r={r} mine={r.fromClubId === humanId || r.toClubId === humanId} clubMeta={clubMeta} />
            ))}
          </ul>
          </FitScroll>
        </Card>
      )}
    </div>
  );
}

function HistoryRow({ r, mine, clubMeta }: { r: TransferRecord; mine: boolean; clubMeta: Map<string, ClubIndexEntry> }) {
  const kind = r.via === 'clause' ? 'multa paga' : r.via === 'option' ? 'opção de compra' : r.via === 'recall' ? 'retorno antecipado'
    : r.kind === 'transfer' ? null : r.kind === 'free' || r.kind === 'precontract' ? 'livre' : r.kind === 'loan' ? 'empréstimo' : r.kind === 'release' ? 'dispensa' : 'fim de empréstimo';
  return (
    <li className={cn('grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 sm:grid-cols-[3.25rem_minmax(0,1fr)_14rem_6rem]', mine && 'bg-club-accent/5')}>
      <span className="tabular text-[11px] text-fg-subtle">{fmtDate(r.date, { day: '2-digit', month: 'short' })}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <PositionChip position={r.position} className="h-4 w-8 text-[9px]" />
          <span className="truncate text-[13px] font-semibold">{r.playerName}</span>
          <OvrBadge value={r.overall} size="xs" />
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-fg-muted sm:hidden">
          <span className="truncate">{r.fromName}</span> <ArrowRight className="size-3 shrink-0" /> <span className="truncate">{r.toName || 'Livre'}</span>
        </div>
      </div>
      <div className="hidden min-w-0 items-center gap-1.5 text-xs sm:flex">
        <ClubMini id={r.fromClubId} meta={clubMeta} />
        <span className="truncate text-fg-muted">{r.fromName}</span>
        <ArrowRight className="size-3 shrink-0 text-fg-subtle" />
        <ClubMini id={r.toClubId} meta={clubMeta} />
        <span className="truncate">{r.toName || 'Livre'}</span>
      </div>
      <div className="text-right">
        <div className="tabular text-[13px] leading-tight font-bold">{r.fee ? fmtMoney(r.fee) : '—'}</div>
        {kind && <div className="text-[10px] leading-tight text-fg-subtle">{kind}</div>}
      </div>
    </li>
  );
}

/* ───────────── (Etapa 5) Livres e pré-contratos ───────────── */

export function FreeAgentsTab({ season, humanId, clubMeta, countries, onOpen }: { season: SeasonState; humanId: string; clubMeta: Map<string, ClubIndexEntry>; countries: Map<number, Country>; onOpen: (id: string) => void }) {
  const m = season.market;
  const free = useMemo(
    () => Object.entries(m?.moves ?? {}).filter(([, c]) => c === '').map(([id]) => m!.players[id]).filter((p): p is Player => !!p).sort((a, b) => b.overall - a.overall).slice(0, 80),
    [m],
  );
  // jogadores nos últimos 6 meses de contrato (clubes com divisão nacional): calculado só com a aba aberta
  const expiring = useMemo(() => {
    const out: { p: Player; clubId: string; months: number }[] = [];
    for (const clubId of Object.keys(season.clubs)) {
      if (clubId === humanId || season.clubInfo?.[clubId]?.division === undefined || season.clubInfo?.[clubId]?.guest) continue;
      for (const p of squads(clubId)) {
        if (p.youth || !preContractOpen(season, p, clubId)) continue;
        out.push({ p, clubId, months: monthsLeftOf(season, p, clubId) ?? 0 });
      }
    }
    return out.sort((a, b) => b.p.overall - a.p.overall).slice(0, 80);
  }, [season, humanId]);
  const mine = Object.values(m?.preContracts ?? {}).filter((pc) => pc.toClubId === humanId || pc.fromClubId === humanId);
  return (
    <div className="space-y-2.5">
      {mine.length > 0 && (
        <Card className="p-3">
          <h3 className="cf-label mb-1 text-fg-muted">Pré-contratos assinados</h3>
          <ul className="divide-y divide-line/50 text-sm">
            {mine.map((pc) => (
              <li key={pc.playerId} className="flex items-center gap-2 py-1">
                <ClubMini id={pc.fromClubId} meta={clubMeta} />
                <ArrowRight className="size-3 text-fg-subtle" />
                <ClubMini id={pc.toClubId} meta={clubMeta} />
                <span className="min-w-0 flex-1 truncate font-semibold">{pc.playerName}</span>
                <span className="text-xs text-fg-muted">{pc.toClubId === humanId ? 'chega' : 'sai'} no fim do contrato · {fmtMoney(pc.wage)}/mês · {pc.years} {pc.years > 1 ? 'anos' : 'ano'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card className="px-1.5 py-1.5 sm:px-2">
          <h3 className="cf-label px-1.5 pb-1 text-fg-muted">Sem clube · {free.length}</h3>
          {!free.length ? <Empty icon={<UserPlus />} title="Nenhum jogador livre agora" hint="Dispensados e contratos que venceram na virada aparecem aqui. Livres assinam a qualquer momento, com luvas." /> : (
            <FitScroll bottom={30}>
              <ul className="divide-y divide-line/40">
                {free.map((p) => <MiniRow key={p.id} p={p} country={countries.get(p.nationalityId)} onOpen={onOpen} right={<span className="w-10 text-right text-[11px] text-success">livre</span>} />)}
              </ul>
            </FitScroll>
          )}
        </Card>
        <Card className="px-1.5 py-1.5 sm:px-2">
          <h3 className="cf-label px-1.5 pb-1 text-fg-muted">Últimos 6 meses de contrato · pré-contrato</h3>
          {!expiring.length ? <Empty icon={<FileClock />} title="Ninguém nos últimos 6 meses" hint="Na Europa os contratos terminam em 30/06; na América do Sul, em 31/12. Nos 6 meses anteriores dá para assinar pré-contrato, sem taxa." /> : (
            <FitScroll bottom={30}>
              <ul className="divide-y divide-line/40">
                {expiring.map(({ p, clubId, months }) => (
                  <MiniRow key={p.id} p={p} country={countries.get(p.nationalityId)} onOpen={onOpen} right={<span className="flex w-12 items-center justify-end gap-1 text-[11px] text-warning" title={`${Math.max(0, Math.round(months))} meses de contrato`}><ClubMini id={clubId} meta={clubMeta} />{Math.max(0, Math.round(months))}m</span>} />
                ))}
              </ul>
            </FitScroll>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniRow({ p, country, onOpen, right }: { p: Player; country: Country | undefined; onOpen: (id: string) => void; right: ReactNode }) {
  return (
    <li>
      <button className="cf-row flex w-full items-center gap-2 px-1.5 py-1 text-left" onClick={() => onOpen(p.id)} title={`${p.name} — ${p.age} anos · valor ${fmtMoney(p.value)} · ${fmtMoney(p.wage)}/mês`}>
        <PositionChip position={p.position} foot={p.side} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold">{p.name}</span>
          <Flag country={country} />
        </span>
        <AgeChip age={p.age} />
        <span className="tabular hidden w-16 text-right text-xs text-fg-muted sm:block">{fmtMoney(p.value)}</span>
        <OvrBadge value={p.overall} />
        {right}
      </button>
    </li>
  );
}

/* ───────────── (Etapa 5) Empréstimos e contratos ───────────── */

export function LoansTab({ season, humanId, clubMeta, players }: { season: SeasonState; humanId: string; clubMeta: Map<string, ClubIndexEntry>; players: Player[] }) {
  const actions = useMarketActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [renew, setRenew] = useState<{ id: string } | null>(null);
  const m = season.market;
  const { incoming, outgoing } = loansOf(season, humanId);
  const all = (id: string) => players.find((p) => p.id === id) ?? m?.players[id];
  const run = async (id: string, fn: () => Promise<{ error?: string }>, ok: string) => {
    setBusy(id);
    const r = await fn();
    setBusy(null);
    setMsg(r.error ? { text: r.error, ok: false } : { text: ok, ok: true });
  };
  const expiring = players
    .map((p) => ({ p, months: monthsLeftOf(season, p, humanId) ?? 99 }))
    .filter((x) => x.months <= 18 && m?.contracts[x.p.id]?.kind !== 'loan')
    .sort((a, b) => a.months - b.months);
  const openRenew = (p: Player) => setRenew({ id: p.id });
  return (
    <div className="space-y-2.5">
      <AnimatePresence>
        {msg && (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('rounded-xl border px-3.5 py-2.5 text-sm', msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger')} role="status">
            {msg.text}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Card className="p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Emprestados ao seu clube</h3>
          {!incoming.length ? <p className="text-xs text-fg-muted">Nenhum. Peça um jogador emprestado em “Fazer proposta → Empréstimo”.</p> : (
            <ul className="divide-y divide-line/50 text-sm">
              {incoming.map((id) => {
                const c = m!.contracts[id];
                const p = all(id);
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 py-2">
                    <ClubMini id={c.loanFrom!} meta={clubMeta} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{p?.name ?? id}</span>
                    <span className="text-[11px] text-fg-muted">até {fmtDate(c.loanUntil!, { day: '2-digit', month: 'short', year: 'numeric' })} · {c.wageShare ?? 100}% do salário</span>
                    {c.purchaseOption !== undefined && (
                      <Button size="sm" variant="club" disabled={busy === id || !!actions.blocked} onClick={() => void run(id, () => actions.option(id), `Opção exercida: ${p?.name} fica no clube.`)}>
                        Comprar · {fmtMoney(c.purchaseOption)}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Seus jogadores emprestados</h3>
          {!outgoing.length ? <p className="text-xs text-fg-muted">Nenhum. Marque “Emprestar” na aba À venda: clubes da IA fazem propostas na janela.</p> : (
            <ul className="divide-y divide-line/50 text-sm">
              {outgoing.map((id) => {
                const c = m!.contracts[id];
                const holder = m!.moves[id];
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 py-2">
                    <ClubMini id={holder} meta={clubMeta} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{m!.players[id]?.name ?? id}</span>
                    <span className="text-[11px] text-fg-muted">volta em {fmtDate(c.loanUntil!, { day: '2-digit', month: 'short' })} · você paga {100 - (c.wageShare ?? 100)}%</span>
                    {c.recall && (
                      <Button size="sm" variant="outline" disabled={busy === id || !!actions.blocked} onClick={() => void run(id, () => actions.recall(id), 'Jogador chamado de volta.')}>
                        Chamar de volta
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <Card className="p-3">
        <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Contratos terminando (até 18 meses)</h3>
        <p className="mb-2 text-[11px] text-fg-subtle">Nos últimos 6 meses outros clubes podem assinar pré-contrato com eles. Renove antes, pelo salário que o jogador pede.</p>
        {!expiring.length ? <p className="text-xs text-fg-muted">Nenhum contrato perto do fim.</p> : (
          <ul className="divide-y divide-line/50 text-sm">
            {expiring.map(({ p, months }) => {
              const pc = m?.preContracts?.[p.id];
              const open = renew?.id === p.id;
              return (
                <li key={p.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PositionChip position={p.position} foot={p.side} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                    <OvrBadge value={p.overall} />
                    <span className={cn('tabular text-[11px]', months <= 6 ? 'font-semibold text-warning' : 'text-fg-muted')}>{months < 1 ? 'último mês' : `${Math.round(months)} meses`}</span>
                    <span className="hidden text-[11px] text-fg-subtle sm:inline">multa {fmtMoney(releaseClauseOf(season, p, humanId))}</span>
                    {pc ? (
                      <span className="text-[11px] font-semibold text-danger">pré-contrato com o {pc.toName}</span>
                    ) : (
                      <Button size="sm" variant={open ? 'outline' : 'ghost'} onClick={() => (open ? setRenew(null) : openRenew(p))}>
                        <FileClock /> Renovar
                      </Button>
                    )}
                  </div>
                  {open && <RenewForm player={p} clubId={humanId} className="mt-2" onDone={(r) => { setMsg(r); setRenew(null); }} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
