/** (Fase 3) Caixa de Entrada do escritório: e-mails da diretoria, torcida, convites e respostas de candidaturas. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, Briefcase, CheckCheck, Inbox, Landmark, Mail, MailOpen, Megaphone, PartyPopper, Target, UserX } from 'lucide-react';
import type { InboxMessage } from '@cosmicfut/engine';
import { useSeason } from '@/store/season';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ClubCrest } from '@/components/game/status';
import { OfferCard, useCoachAction, useCoachCareer } from './shared';

const ICON: Record<InboxMessage['kind'], typeof Mail> = {
  welcome: PartyPopper, goal: Target, warning: AlertTriangle, board: Landmark, fans: Megaphone, offer: Briefcase,
  application: Mail, fired: UserX, contract: Landmark, interest: Megaphone, info: Mail,
};

type Filter = 'all' | 'unread' | 'jobs';

export function InboxPage() {
  const cc = useCoachCareer();
  const date = useSeason((s) => s.save?.season.date ?? '');
  const { run } = useCoachAction();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => {
    const all = cc?.inbox ?? [];
    if (filter === 'unread') return all.filter((m) => !m.read);
    if (filter === 'jobs') return all.filter((m) => m.kind === 'offer' || m.kind === 'application' || m.kind === 'interest');
    return all;
  }, [cc, filter]);
  const open = list.find((m) => m.id === openId) ?? null;
  const unread = cc?.inbox.filter((m) => !m.read).length ?? 0;

  // abrir marca como lido
  useEffect(() => {
    if (open && !open.read) void run('read', { type: 'read', ids: [open.id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);

  if (!cc) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <Inbox className="mx-auto size-8 text-fg-subtle" />
        <p className="mt-3 text-sm text-fg-muted">A caixa de entrada faz parte da carreira do técnico (carreira solo).</p>
      </Card>
    );
  }
  const offer = open?.offerId ? cc.offers.find((o) => o.id === open.offerId && o.status === 'pending' && o.expiresAt >= date) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Caixa de Entrada</h1>
          <p className="text-sm text-fg-muted">
            E-mails da diretoria, da torcida e de clubes interessados. {unread > 0 ? `${unread} não lido${unread > 1 ? 's' : ''}.` : 'Tudo lido.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface-2/60 p-0.5 text-xs font-semibold" role="tablist" aria-label="Filtro">
            {(['all', 'unread', 'jobs'] as Filter[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn('rounded-lg px-3 py-1.5', filter === f ? 'bg-club-accent text-club-on-accent' : 'text-fg-muted hover:text-fg')}
              >
                {f === 'all' ? 'Todos' : f === 'unread' ? 'Não lidos' : 'Empregos'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={!unread} onClick={() => void run('read-all', { type: 'read' })}>
            <CheckCheck /> Marcar todos como lidos
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className={cn('overflow-hidden', open && 'hidden lg:block')}>
          {list.length === 0 ? (
            <p className="p-6 text-center text-sm text-fg-muted">Nenhuma mensagem.</p>
          ) : (
            <ul className="scrollbar-thin max-h-[70vh] divide-y divide-line overflow-y-auto" aria-label="Mensagens">
              {list.map((m) => {
                const Icon = ICON[m.kind] ?? Mail;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => setOpenId(m.id)}
                      className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70', m.id === openId && 'bg-club-accent/10')}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border',
                          m.tone === 'bad' ? 'border-danger/30 bg-danger/10 text-danger' : m.tone === 'good' ? 'border-success/30 bg-success/10 text-success' : 'border-line bg-surface-2 text-fg-muted',
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('min-w-0 flex-1 truncate text-sm', m.read ? 'text-fg-muted' : 'font-bold text-fg')}>{m.subject}</span>
                          {!m.read && <span className="size-2 shrink-0 rounded-full bg-club-accent" aria-label="não lido" />}
                        </span>
                        <span className="block truncate text-xs text-fg-subtle">
                          {m.from} · {fmtDate(m.date, { day: '2-digit', month: 'short' })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className={cn('min-h-64 p-5', !open && 'hidden lg:block')}>
          {open ? (
            <article>
              <button className="mb-3 flex items-center gap-1 text-xs font-semibold text-club-accent lg:hidden" onClick={() => setOpenId(null)}>
                <ArrowLeft className="size-3.5" /> Voltar
              </button>
              <div className="flex items-start gap-3">
                {open.clubId ? <ClubCrest id={open.clubId} size={40} /> : <MailOpen className="size-9 text-fg-subtle" />}
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight">{open.subject}</h2>
                  <p className="text-xs text-fg-muted">
                    De: {open.from} · {fmtDate(open.date)}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed whitespace-pre-line">{open.body}</p>
              {offer && (
                <div className="mt-5">
                  <OfferCard offer={offer} />
                </div>
              )}
              {open.kind === 'fired' && (
                <Button asChild variant="club" className="mt-5">
                  <Link to="/empregos">
                    <Briefcase /> Central de Empregos
                  </Link>
                </Button>
              )}
            </article>
          ) : (
            <div className="grid h-full min-h-56 place-items-center text-center text-sm text-fg-muted">
              <div>
                <Mail className="mx-auto size-8 text-fg-subtle" />
                <p className="mt-2">Selecione uma mensagem.</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
