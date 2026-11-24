/**
 * (Carreira online) Central de Empregos: vagas abertas no mundo (demissões e saídas de técnicos da IA), as MINHAS
 * propostas (pela reputação do técnico) e candidaturas, a confiança da diretoria (empregado) e as trocas de técnico.
 * Mesmas regras da carreira solo (Fase 3): candidatura com resposta em dias, proposta com prazo, 30 dias para voltar a
 * um clube deixado. Aceitar uma proposta: o clube sai da IA e passa a ser seu na hora (joga a partir da próxima rodada).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Check, History, Loader2, Send, ShieldAlert, Star, X } from 'lucide-react';
import type { JobOfferInfo, JobVacancyInfo } from '@cosmicfut/shared';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useOnline, useMe } from '@/store/online';
import { Button } from '@/components/ui/button';
import { IndexCrest, useClubName } from './common';
import { ConfidenceRow, reputationLabel } from '@/pages/coach/shared';

const REASON: Record<JobVacancyInfo['reason'], string> = {
  fired: 'técnico demitido',
  left: 'técnico saiu',
  initial: 'sem técnico',
  'human-left': 'técnico da sala saiu',
};

const d = (iso: string) => fmtDate(iso, { day: '2-digit', month: 'short' });

export function OnlineJobsPage() {
  const jobs = useOnline((s) => s.jobs);
  const me = useMe();
  const phase = useOnline((s) => s.room?.phase);
  const navigate = useNavigate();
  const clubName = useClubName();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void import('@/online/socket').then(({ call }) => call('jobs:get').then((r) => r.ok && useOnline.setState({ jobs: r.data as never })));
  }, []);
  const act = async (key: string, type: 'apply' | 'accept' | 'decline', payload: Record<string, unknown>) => {
    setBusy(key);
    setMsg(null);
    const r = await useOnline.getState().jobsAct(type, payload);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: r.message ?? 'Feito.' } : { ok: false, text: r.error ?? 'Não foi possível.' });
    if (r.ok && type === 'accept') navigate('/dashboard');
  };
  if (!jobs || !me) {
    return (
      <div className="cf-card grid place-items-center p-10 text-sm text-fg-muted">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  const offers = jobs.offers.filter((o) => o.status === 'pending' && (!jobs.date || o.expiresAt >= jobs.date));
  const apps = jobs.applications;
  const unemployed = !me.clubId && !me.spectator;
  const rep = jobs.me?.reputation ?? 0;
  const actionable = phase === 'planning' || phase === 'season-end';
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-club-accent uppercase">Carreira do técnico · online</p>
          <h1 className="text-2xl font-extrabold tracking-tight">Central de Empregos</h1>
          <p className="text-sm text-fg-muted">
            {unemployed ? 'Você está sem clube. As propostas chegam dos clubes que precisam de técnico, conforme a sua reputação.' : 'Você está empregado. Fique de olho na confiança da diretoria.'}
          </p>
        </div>
        <div className="cf-card flex items-center gap-3 px-4 py-2.5">
          <Star className="size-5 text-warning" />
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Reputação</div>
            <div className="text-lg font-black tabular-nums">
              {rep} <span className="text-xs font-semibold text-fg-muted">{reputationLabel(rep)}</span>
            </div>
          </div>
        </div>
      </header>

      {msg && (
        <p role="status" className={cn('rounded-xl border px-3 py-2 text-sm', msg.ok ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
          {msg.text}
        </p>
      )}
      {!actionable && <p className="rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-xs text-fg-muted">Rodada em andamento: responda às propostas no próximo planejamento.</p>}

      {jobs.me?.board && me.clubId && (
        <section className="cf-card p-4" aria-label="Diretoria">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="size-4 text-club-accent" /> Diretoria do {clubName(me.clubId)}
          </h2>
          <div className="mt-2 max-w-md">
            <ConfidenceRow label="Confiança da diretoria" value={jobs.me.board.confidence} />
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            Meta: {jobs.me.board.goal ?? '—'} · {jobs.me.board.games} jogo(s) no cargo.{' '}
            {jobs.firing ? 'Abaixo de 20% (depois de 8 jogos) a diretoria demite.' : 'Demissões desligadas nesta sala.'}
          </p>
        </section>
      )}

      {(unemployed || offers.length > 0) && (
        <section className="cf-card p-4" aria-label="Propostas">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Briefcase className="size-4 text-club-accent" /> Propostas para você ({offers.length})
          </h2>
          {!unemployed && me.clubId && (
            <p className="mt-1 text-xs text-warning">Convite com você empregado: aceitar deixa o {clubName(me.clubId)} (o clube volta para a IA).</p>
          )}
          {offers.length === 0 ? (
            <p className="mt-2 text-xs text-fg-muted">Nenhuma proposta no momento. Elas chegam nos próximos dias; você também pode se candidatar às vagas abaixo.</p>
          ) : (
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {offers.map((o) => (
                <OfferItem key={o.id} o={o} busy={busy} disabled={!actionable} onAccept={() => {
                    if (!unemployed && me.clubId && !window.confirm(`Aceitar o ${o.name}? Você deixa o ${clubName(me.clubId)}.`)) return;
                    void act(`a${o.id}`, 'accept', { offerId: o.id });
                  }} onDecline={() => void act(`d${o.id}`, 'decline', { offerId: o.id })} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="cf-card p-4" aria-label="Vagas abertas">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Briefcase className="size-4 text-club-accent" /> Vagas abertas ({jobs.vacancies.length})
        </h2>
        {jobs.vacancies.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">Nenhum clube sem técnico agora.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {jobs.vacancies.map((v) => {
              const applied = apps.some((a) => a.vacancyId === v.id && a.status === 'pending');
              const fit = rep >= v.minReputation;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <IndexCrest id={v.clubId} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{v.name}</div>
                    <div className="text-[11px] text-fg-muted">
                      {v.division ? `${v.division}ª divisão · ` : ''}reputação {v.reputation.toFixed(1)} · {REASON[v.reason]}
                      {v.previousCoach ? ` (${v.previousCoach})` : ''} · desde {d(v.openedOn)}
                    </div>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', fit ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>{fit ? 'perfil compatível' : `pede ${v.minReputation}+`}</span>
                  {unemployed && (
                    <Button size="sm" variant="outline" disabled={!!busy || applied || !actionable} onClick={() => void act(`v${v.id}`, 'apply', { vacancyId: v.id })}>
                      {busy === `v${v.id}` ? <Loader2 className="animate-spin" /> : <Send />} {applied ? 'Candidatura enviada' : 'Candidatar-se'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {apps.length > 0 && (
        <section className="cf-card p-4" aria-label="Candidaturas">
          <h2 className="text-sm font-bold">Minhas candidaturas</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {apps.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <IndexCrest id={a.clubId} size={18} />
                <span className="flex-1 truncate">{a.name}</span>
                <span className={cn('font-semibold', a.status === 'approved' ? 'text-success' : a.status === 'rejected' ? 'text-danger' : 'text-fg-muted')}>
                  {a.status === 'pending' ? `resposta em ${d(a.answerOn)}` : a.status === 'approved' ? 'aprovada' : 'recusada'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cf-card p-4" aria-label="Seu histórico">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <History className="size-4 text-club-accent" /> Seu histórico nesta carreira
          </h2>
          {(jobs.me?.history.length ?? 0) === 0 ? (
            <p className="mt-2 text-xs text-fg-muted">Ainda sem clubes.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-xs">
              {jobs.me!.history.map((h, i) => (
                <li key={`${h.clubId}-${i}`} className="flex items-center gap-2">
                  <IndexCrest id={h.clubId} size={18} />
                  <span className="flex-1 truncate font-semibold">{h.name}</span>
                  <span className="text-fg-muted">
                    {d(h.from)} – {h.to ? d(h.to) : 'hoje'} · {h.won}V {h.drawn}E {h.lost}D{h.exit === 'fired' ? ' · demitido' : h.exit === 'left' ? ' · saiu' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="cf-card p-4" aria-label="Trocas de técnico">
          <h2 className="text-sm font-bold">Trocas de técnico no mundo</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {jobs.changes.slice(0, 12).map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-14 shrink-0 whitespace-nowrap text-fg-subtle">{d(c.date)}</span>
                <IndexCrest id={c.clubId} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  <b>{c.name}</b>: {c.in ? `${c.in} assumiu` : `${c.out ?? 'técnico'} saiu`} <span className="text-fg-muted">({c.reason})</span>
                </span>
              </li>
            ))}
            {jobs.changes.length === 0 && <li className="text-fg-muted">Nada por enquanto.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function OfferItem({ o, busy, disabled, onAccept, onDecline }: { o: JobOfferInfo; busy: string | null; disabled: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <li className="rounded-2xl border border-club-accent/30 bg-club-accent/5 p-4">
      <div className="flex items-start gap-3">
        <IndexCrest id={o.clubId} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold tracking-[0.16em] text-club-accent uppercase">{o.kind === 'application' ? 'Candidatura aprovada' : 'Convite'}</div>
          <div className="truncate text-base font-bold">{o.name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {o.division ? `${o.division}ª divisão · ` : ''}reputação {o.reputation.toFixed(1)}
            {o.goal ? ` · meta: ${o.goal}` : ''}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">Válida até {d(o.expiresAt)}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="club" size="sm" onClick={onAccept} disabled={!!busy || disabled}>
          {busy === `a${o.id}` ? <Loader2 className="animate-spin" /> : <Check />} Aceitar e assumir
        </Button>
        <Button variant="outline" size="sm" onClick={onDecline} disabled={!!busy}>
          {busy === `d${o.id}` ? <Loader2 className="animate-spin" /> : <X />} Recusar
        </Button>
      </div>
    </li>
  );
}
