/**
 * (Fase 3) Central de Empregos (`JobsCenterScreen` do original): vagas de clubes e seleções, candidatura por e-mail
 * (resposta em 7 dias), declaração pública de interesse (bloqueio de 6 meses), propostas recebidas e trocas de técnicos.
 */
import { useMemo, useState } from 'react';
import { Briefcase, Clock, Loader2, Mail, Megaphone, Search, ShieldAlert, Users } from 'lucide-react';
import { COACH, coachReputation, jobCenter, mainCompetition, type CoachListing, type JobListing } from '@cosmicfut/engine';
import { useSeason } from '@/store/season';
import { useCareerData } from '@/career/useCareerData';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/confirm';
import { ClubCrest } from '@/components/game/status';
import { BandChip, Feedback, NationalBadge, OfferCard, StabilityBar, reputationLabel, useCoachAction, useCoachCareer, usePendingOffers } from './shared';

const STATUS_LABEL: Record<JobListing['status'], string> = {
  ok: 'Aberta', applied: 'Candidatura enviada', offer: 'Proposta recebida', blocked: 'Saiu há < 30 dias', current: 'Seu cargo',
};

export function JobsPage() {
  const cc = useCoachCareer();
  const season = useSeason((s) => s.save?.season);
  const data = useCareerData();
  const offers = usePendingOffers();
  const { run, busy, feedback, clearFeedback } = useCoachAction();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [query, setQuery] = useState('');
  const [divFilter, setDivFilter] = useState<'all' | '1' | '2' | '3' | '4' | 'danger'>('all');
  const world = useSeason((s) => s.save?.world);
  const center = useMemo(() => (cc && world && season && data ? jobCenter(world, season, data) : null), [cc, world, season, data]);
  const compName = useMemo(() => {
    const m = new Map<string, string>();
    return (id: string) => {
      let v = m.get(id);
      if (v === undefined && season) m.set(id, (v = mainCompetition(season, id)?.name ?? '—'));
      return v ?? '—';
    };
  }, [season]);

  if (!cc || !season) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center text-sm text-fg-muted">A Central de Empregos faz parte da carreira do técnico (carreira solo).</Card>
    );
  }
  const rep = coachReputation(cc.coach);
  const employedAt = cc.coach.clubId;
  const pendingApps = cc.applications.filter((a) => a.status === 'pending');
  const cooldown = center?.cooldown ?? 0;
  const q = query.trim().toLowerCase();
  const coaches = (center?.coaches ?? []).filter((c) => {
    if (divFilter === 'danger' && c.coach.stability >= COACH.danger) return false;
    if (divFilter !== 'all' && divFilter !== 'danger' && String(c.division ?? '') !== divFilter) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.coach.name.toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 40);

  const apply = (l: JobListing) => {
    setConfirm({
      title: `Candidatar-se: ${l.vacancy.name}`,
      body: (
        <div className="space-y-2">
          <p>Enviar um e-mail demonstrando seu interesse na vaga de treinador do {l.vacancy.name}?</p>
          <p className="text-xs">A diretoria responde em 7 dias. A chance depende da sua reputação ({rep}) contra a exigida ({l.vacancy.minReputation}).</p>
        </div>
      ),
      confirmLabel: 'Enviar e-mail',
      onConfirm: () => void run(`apply:${l.vacancy.id}`, { type: 'apply', vacancyId: l.vacancy.id }),
    });
  };
  const declare = (c: CoachListing) => {
    setConfirm({
      title: `Declarar interesse no ${c.name}?`,
      body: (
        <div className="space-y-2">
          <p>
            Deseja declarar publicamente interesse no comando do {c.name}? Isso pode pressionar o técnico atual ({c.coach.name}, estabilidade {Math.round(c.coach.stability)}%), mas se ele tiver um status
            muito maior que o seu, a diretoria ficará a favor dele.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>A estabilidade dele cai drasticamente; se ficar abaixo de 43% após o próximo jogo, a diretoria pode demiti-lo e chamar você.</li>
            <li>Essa ação te bloqueia de declarar interesse novamente por 6 meses.</li>
            {employedAt && <li>A diretoria e a torcida do seu clube atual não vão gostar (−8 de confiança da diretoria, −5 da torcida).</li>}
          </ul>
        </div>
      ),
      confirmLabel: 'Declarar interesse',
      irreversible: true,
      onConfirm: () => void run(`declare:${c.clubId}`, { type: 'declare', clubId: c.clubId }),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Central de Empregos</h1>
          <p className="text-sm text-fg-muted">(Você pode se candidatar a assumir times ou seleções da lista que buscam novos técnicos)</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-xl border border-line bg-surface-2/60 px-3 py-1.5">
            Reputação <b className="tabular text-fg">{rep}</b> · {reputationLabel(rep)}
          </span>
          <span className={cn('rounded-xl border px-3 py-1.5', employedAt ? 'border-line bg-surface-2/60' : 'border-warning/40 bg-warning/10 font-semibold text-warning')}>
            {employedAt ? `Técnico do ${season.clubInfo?.[employedAt]?.name ?? employedAt}` : 'Desempregado'}
          </span>
        </div>
      </div>

      <Feedback feedback={feedback} onClose={clearFeedback} />

      {!employedAt && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <b>Você está sem clube.</b> Candidate-se às vagas abaixo e use <b>Continuar</b> (barra superior) para avançar os dias até chegar uma proposta ou a
          resposta de uma candidatura. O mundo segue sendo simulado.
        </div>
      )}

      {offers.length > 0 && (
        <section aria-labelledby="offers-h">
          <h2 id="offers-h" className="mb-2 text-sm font-bold tracking-tight">Propostas recebidas</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {offers.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader icon={<Briefcase />} title="Vagas abertas" subtitle="Clubes e seleções que buscam técnico" />
          <CardContent className="pt-3">
            {!center ? (
              <Loader2 className="mx-auto size-6 animate-spin text-fg-subtle" />
            ) : center.vacancies.length === 0 ? (
              <p className="text-sm text-fg-muted">Nenhuma vaga aberta no momento. Volte depois de algumas rodadas.</p>
            ) : (
              <ul className="divide-y divide-line">
                {center.vacancies.map((l) => (
                  <li key={l.vacancy.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    {l.vacancy.clubId ? <ClubCrest id={l.vacancy.clubId} size={32} /> : <NationalBadge size={32} />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{l.vacancy.name}</div>
                      <div className="truncate text-[11px] text-fg-muted">
                        {l.vacancy.clubId ? compName(l.vacancy.clubId) : 'Seleção nacional (sem jogos nesta versão)'} · aberta em {fmtDate(l.vacancy.openedOn, { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    <div className="text-right text-[11px] leading-tight">
                      <div className={cn('tabular font-bold', l.qualified ? 'text-success' : 'text-warning')}>rep. {l.vacancy.minReputation}+</div>
                      <div className="text-fg-subtle">{STATUS_LABEL[l.status]}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={l.qualified ? 'club' : 'outline'}
                      disabled={l.status !== 'ok' || !!busy}
                      onClick={() => apply(l)}
                      aria-label={`Candidatar-se ao ${l.vacancy.name}`}
                    >
                      {busy === `apply:${l.vacancy.id}` ? <Loader2 className="animate-spin" /> : <Mail />}
                      <span className="hidden sm:inline">Candidatar-se</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {pendingApps.length > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">
                  <Clock className="size-3.5" /> Candidaturas aguardando resposta
                </div>
                <ul className="mt-1.5 space-y-1 text-xs">
                  {pendingApps.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span className="truncate">{a.name}</span>
                      <span className="tabular shrink-0 text-fg-muted">resposta em {fmtDate(a.answerOn, { day: '2-digit', month: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader icon={<Megaphone />} title="Declarar interesse publicamente" subtitle="Pressione o técnico de um clube que você quer treinar" />
          <CardContent className="space-y-3 pt-3">
            <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-xs', cooldown ? 'border-warning/40 bg-warning/10' : 'border-line bg-surface-2/50 text-fg-muted')}>
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {cooldown
                  ? `Aguarde 6 meses desde o seu último interesse para tentar novamente (faltam ${cooldown} dias).`
                  : 'Declarar interesse derruba a estabilidade do técnico atual e bloqueia uma nova declaração por 6 meses. Técnicos acima de 79% não podem ser pressionados.'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar clube ou técnico"
                  className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pr-2 pl-8 text-xs outline-none focus:border-club-accent/60"
                  aria-label="Buscar clube ou técnico"
                />
              </label>
              <select
                value={divFilter}
                onChange={(e) => setDivFilter(e.target.value as typeof divFilter)}
                className="h-8 rounded-lg border border-line bg-surface-2/60 px-2 text-xs"
                aria-label="Filtrar"
              >
                <option value="all">Todas as divisões</option>
                <option value="1">Série A</option>
                <option value="2">Série B</option>
                <option value="3">Série C</option>
                <option value="4">Série D</option>
                <option value="danger">Prestes a cair (&lt; 43%)</option>
              </select>
            </div>
            <ul className="scrollbar-thin max-h-[480px] divide-y divide-line overflow-y-auto">
              {coaches.map((c) => (
                <li key={c.clubId} className="flex items-center gap-3 py-2">
                  <ClubCrest id={c.clubId} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                      {c.pressured && <span className="shrink-0 text-[10px] font-bold text-warning uppercase">pressionado</span>}
                    </div>
                    <div className="truncate text-[11px] text-fg-muted">
                      {c.coach.name} · {Math.round(c.coach.stability)}%
                    </div>
                    <StabilityBar value={c.coach.stability} size="sm" className="mt-1 max-w-48" label={`Estabilidade de ${c.coach.name}`} />
                  </div>
                  <BandChip value={c.coach.stability} className="hidden sm:inline-flex" />
                  <Button size="sm" variant="outline" disabled={!c.canDeclare || !!busy} onClick={() => declare(c)} title={c.coach.stability > COACH.shielded ? 'O técnico está com muita estabilidade (Acima de 79%).' : undefined}>
                    {busy === `declare:${c.clubId}` ? <Loader2 className="animate-spin" /> : <Megaphone />}
                    <span className="hidden sm:inline">Declarar interesse</span>
                  </Button>
                </li>
              ))}
              {coaches.length === 0 && <li className="py-4 text-center text-sm text-fg-muted">Nenhum clube encontrado.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Users />} title="Últimas trocas de técnicos" />
        <CardContent className="pt-3">
          {cc.changes.length === 0 ? (
            <p className="text-sm text-fg-muted">Nenhuma troca ainda.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {cc.changes.slice(0, 16).map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2">
                  {c.clubId ? <ClubCrest id={c.clubId} size={18} /> : <NationalBadge size={18} />}
                  <span className="min-w-0 flex-1 truncate">
                    <b>{c.name}</b>: {c.out ? <s className="text-fg-subtle">{c.out}</s> : '—'} → {c.in ?? <i className="text-warning">vaga aberta</i>}
                  </span>
                  <span className="tabular shrink-0 text-fg-subtle">{fmtDate(c.date, { day: '2-digit', month: 'short' })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
