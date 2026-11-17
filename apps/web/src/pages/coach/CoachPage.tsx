/**
 * (Fase 3) "Meu Técnico" (Perfil do Técnico do original): reputação, contrato, histórico de clubes e seleções com
 * títulos e aproveitamento, pedir demissão (multa de 6 meses) ou acordo mútuo (estabilidade ≤ 43%).
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Award, Briefcase, Check, DoorOpen, FlaskConical, Handshake, Landmark, Loader2, Pencil, Trophy, UserRound, Wallet } from 'lucide-react';
import { COACH, canMutualAgreement, coachReputation, resignationFine, type CoachExit, type CoachHistoryItem } from '@cosmicfut/engine';
import { useCountryMap } from '@/data/hooks';
import { useSeason } from '@/store/season';
import { fmtDate, fmtMoney } from '@/lib/format';
import { cn, clubInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, type ConfirmRequest } from '@/components/ui/confirm';
import { Flag } from '@/components/game/bits';
import { ClubCrest } from '@/components/game/status';
import { BandChip, ConfidenceRow, Feedback, NationalBadge, StabilityBar, reputationLabel, useCoachAction, useCoachCareer } from './shared';

const EXIT_LABEL: Record<CoachExit, string> = {
  fired: 'Demitido', resigned: 'Pediu demissão', mutual: 'Acordo mútuo', left: 'Trocou de clube', 'contract-end': 'Fim de contrato',
};

function pct(h: Pick<CoachHistoryItem, 'games' | 'won' | 'drawn'>): string {
  return h.games ? `${Math.round(((h.won * 3 + h.drawn) / (h.games * 3)) * 100)}%` : '—';
}

export function CoachPage() {
  const cc = useCoachCareer();
  const season = useSeason((s) => s.save?.season);
  const countries = useCountryMap();
  const { run, busy, feedback, clearFeedback } = useCoachAction();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!cc || !season) {
    return <Card className="mx-auto max-w-lg p-8 text-center text-sm text-fg-muted">O perfil do técnico faz parte da carreira solo.</Card>;
  }
  const c = cc.coach;
  const rep = coachReputation(c);
  const b = cc.board;
  const fine = resignationFine(c);
  const clubName = c.clubId ? (season.clubInfo?.[c.clubId]?.name ?? c.clubId) : null;
  const history = [...c.history].reverse();
  const titles = c.history.reduce((n, h) => n + h.titles.length, 0);
  const totals = c.history.reduce((t, h) => ({ games: t.games + h.games, won: t.won + h.won, drawn: t.drawn + h.drawn, lost: t.lost + h.lost }), { games: 0, won: 0, drawn: 0, lost: 0 });
  const country = countries.get(c.nationalityId);
  const nationalName = c.nationalTeamId !== null ? c.history.find((h) => h.kind === 'national' && h.nationalTeamId === c.nationalTeamId && !h.to)?.name : null;

  const resign = () =>
    setConfirm({
      title: 'Pedir demissão?',
      body: (
        <div className="space-y-2">
          <p>Deseja pedir demissão do {clubName}?</p>
          <p className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
            Multa de rescisão (6 meses): <b className="text-fg">{fmtMoney(fine)}</b>
            <br />
            Suas economias: {fmtMoney(c.savings)} → <b className="text-fg">{fmtMoney(c.savings - fine)}</b>
          </p>
          <p className="text-xs">Você ficará desempregado, perde um pouco de reputação e só poderá voltar a este clube depois de 30 dias.</p>
        </div>
      ),
      confirmLabel: 'Pagar a multa e sair',
      irreversible: true,
      onConfirm: () => void run('resign', { type: 'resign' }),
    });
  const mutual = () =>
    setConfirm({
      title: 'Acordo mútuo',
      body: (
        <p>
          Deseja pedir demissão por acordo mútuo? (Sem multa de rescisão — Estabilidade em {Math.round(b?.stability ?? 0)}%)
        </p>
      ),
      confirmLabel: 'Sair por acordo mútuo',
      irreversible: true,
      onConfirm: () => void run('mutual', { type: 'resign', mutual: true }),
    });

  return (
    <div className="space-y-3">
      <Feedback feedback={feedback} onClose={clearFeedback} />
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-linear-to-r from-club-primary via-club-accent to-club-secondary" />
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="grid size-20 shrink-0 place-items-center rounded-3xl bg-linear-to-br from-club-primary to-club-secondary p-[3px]">
              <div className="grid size-full place-items-center rounded-[21px] bg-surface text-2xl font-black">{clubInitials(c.name).slice(0, 2)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.18em] text-fg-subtle uppercase">Perfil do Técnico</div>
              {editing ? (
                <form
                  className="mt-1 flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await run('rename', { type: 'rename', name });
                    if (r?.ok) setEditing(false);
                  }}
                >
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                    aria-label="Nome do técnico"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-base font-bold outline-none focus:border-club-accent/60"
                  />
                  <Button size="sm" variant="club" type="submit" disabled={busy === 'rename'}>
                    <Check />
                  </Button>
                </form>
              ) : (
                <h1 className="flex items-center gap-2 truncate text-2xl font-extrabold tracking-tight">
                  {c.name}
                  <button
                    aria-label="Renomear técnico"
                    className="grid size-7 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
                    onClick={() => {
                      setName(c.name);
                      setEditing(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </h1>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <Flag country={country} /> {country?.name ?? '—'}
                </span>
                <span>{clubName ? `Técnico do ${clubName}` : <b className="text-warning">Desempregado</b>}</span>
                {nationalName && <span>· {nationalName}</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center md:w-[420px]">
            <Stat label="Reputação" value={String(rep)} hint={reputationLabel(rep)} />
            <Stat label="Títulos" value={String(titles)} hint={`${totals.games} jogos`} />
            <Stat label="Aproveit." value={pct(totals)} hint={`${totals.won}V ${totals.drawn}E ${totals.lost}D`} />
          </div>
        </CardContent>
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between text-[11px] text-fg-muted">
            <span>Reputação {rep}/100</span>
            <span>Pontos {Math.round(c.reputationPoints)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-club-accent" style={{ width: `${Math.max(2, rep)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">Cresce com vitórias (×divisão), títulos e acessos; cai 15% ao ano e com demissões. Clubes aceitam técnicos com reputação até 10 pontos abaixo da deles.</p>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Briefcase />} title="Contrato" />
          <CardContent className="space-y-3 pt-3 text-sm">
            {c.clubId && b ? (
              <>
                <div className="flex items-center gap-3">
                  <ClubCrest id={c.clubId} size={36} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{clubName}</div>
                    <div className="text-xs text-fg-muted">
                      desde {c.since ? fmtDate(c.since) : '—'} · até {c.contractUntil ?? '—'}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">Estabilidade</span>
                    <BandChip value={b.stability} />
                  </div>
                  <StabilityBar value={b.stability} className="mt-1.5" />
                  <div className="mt-1 text-right text-xs font-bold tabular">{Math.round(b.stability)}%</div>
                </div>
                <ConfidenceRow label="Diretoria" value={b.boardConfidence} />
                <ConfidenceRow label="Torcida" value={b.fanConfidence} />
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-fg-muted">Sem clube no momento.</p>
                <Button asChild variant="club" size="sm">
                  <Link to="/empregos">
                    <Briefcase /> Central de Empregos
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader icon={<Wallet />} title="Finanças pessoais" />
          <CardContent className="space-y-2 pt-3 text-sm">
            <Row label="Salário" value={`${fmtMoney(c.wage)}/mês`} />
            <Row label="Economias" value={fmtMoney(c.savings)} />
            <Row label="Multa rescisória (6 meses)" value={fmtMoney(fine)} />
            <p className="pt-1 text-[11px] text-fg-subtle">Demitido, o clube paga a multa a você. Pedindo demissão, você paga a multa ao clube.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader icon={<DoorOpen />} title="Deixar o cargo" />
          <CardContent className="space-y-2 pt-3">
            <Button variant="outline" className="w-full" disabled={!c.clubId || !!busy} onClick={resign}>
              {busy === 'resign' ? <Loader2 className="animate-spin" /> : <DoorOpen />} Pedir demissão
            </Button>
            <Button variant="outline" className="w-full" disabled={!c.clubId || !canMutualAgreement(cc) || !!busy} onClick={mutual}>
              {busy === 'mutual' ? <Loader2 className="animate-spin" /> : <Handshake />} Acordo mútuo (sem multa)
            </Button>
            <p className="text-[11px] text-fg-subtle">Acordo mútuo só com estabilidade abaixo de {COACH.danger}%.</p>
            {c.nationalTeamId !== null && (
              <Button variant="ghost" size="sm" className="w-full" disabled={!!busy} onClick={() => void run('national', { type: 'resign', national: true })}>
                Deixar a seleção
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Trophy />} title="Histórico" subtitle="Clubes e seleções que você treinou" />
        <CardContent className="pt-3">
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-[10px] tracking-wider text-fg-subtle uppercase">
                <tr className="border-b border-line text-left">
                  <th className="py-2 font-semibold">Clube</th>
                  <th className="py-2 font-semibold">Período</th>
                  <th className="py-2 text-center font-semibold">J</th>
                  <th className="py-2 text-center font-semibold">V-E-D</th>
                  <th className="py-2 text-center font-semibold">Aprov.</th>
                  <th className="py-2 font-semibold">Títulos</th>
                  <th className="py-2 font-semibold">Saída</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-line/60 align-top">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        {h.clubId ? <ClubCrest id={h.clubId} size={22} /> : <NationalBadge size={22} />}
                        <span className="font-semibold">{h.name}</span>
                      </span>
                    </td>
                    <td className="tabular py-2 text-xs text-fg-muted">
                      {fmtDate(h.from, { month: 'short', year: 'numeric' })} – {h.to ? fmtDate(h.to, { month: 'short', year: 'numeric' }) : 'atual'}
                    </td>
                    <td className="tabular py-2 text-center">{h.games}</td>
                    <td className="tabular py-2 text-center text-xs">
                      {h.won}-{h.drawn}-{h.lost}
                    </td>
                    <td className="tabular py-2 text-center">{pct(h)}</td>
                    <td className="py-2 text-xs">
                      {h.titles.length ? (
                        <ul className="space-y-0.5">
                          {h.titles.map((t, k) => (
                            <li key={k} className="flex items-center gap-1">
                              <Award className="size-3 text-warning" /> {t.name} {t.season}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className={cn('py-2 text-xs', h.exit === 'fired' ? 'text-danger' : 'text-fg-muted')}>{h.exit ? EXIT_LABEL[h.exit] : h.to ? '—' : 'no cargo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {import.meta.env.DEV && <DevTools />}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-2 py-2.5">
      <div className="text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{label}</div>
      <div className="tabular text-xl font-extrabold">{value}</div>
      <div className="truncate text-[10px] text-fg-muted">{hint}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

/** Somente em desenvolvimento: força a sequência ruim (estabilidade), a reputação e a demissão. */
function DevTools() {
  const { run, busy, feedback } = useCoachAction();
  return (
    <Card className="border-dashed">
      <CardHeader icon={<FlaskConical />} title="Ferramentas de desenvolvimento" subtitle="Somente em dev — carreira do técnico" />
      <CardContent className="flex flex-wrap gap-2 pt-3">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('d1', { type: 'dev', stability: 45, board: 45, fans: 45 })}>
          <Landmark /> Estabilidade 45%
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('d2', { type: 'dev', stability: 22, board: 30, fans: 30 })}>
          Estabilidade 22% (sequência ruim)
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('d3', { type: 'dev', fire: true })}>
          <UserRound /> Demitir no próximo jogo
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('d4', { type: 'dev', reputation: 90 })}>
          Reputação 90
        </Button>
        {feedback && <span className="self-center text-xs text-fg-muted">{feedback.text}</span>}
      </CardContent>
    </Card>
  );
}
