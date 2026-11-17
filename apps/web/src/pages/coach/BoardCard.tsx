/** (Fase 3) Dashboard: card "Diretoria" (estabilidade 43/79, confiança da diretoria e da torcida, meta) e o técnico humano. */
import { Link } from 'react-router';
import { ChevronRight, Landmark, Megaphone, Target, UserRound } from 'lucide-react';
import { COACH, coachReputation, currentPosition, stabilityBand, type CoachCareer, type SeasonState } from '@cosmicfut/engine';
import type { Country } from '@cosmicfut/shared';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Flag } from '@/components/game/bits';
import { clubInitials } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { BAND_META, ConfidenceRow, StabilityBar, reputationLabel } from './shared';

export function BoardCard({ cc, season }: { cc: CoachCareer; season: SeasonState }) {
  const b = cc.board;
  if (!b) return null;
  const band = stabilityBand(b.stability);
  const meta = BAND_META[band];
  const e = b.expectation;
  const pos = e ? currentPosition(season, b.clubId, e.competitionId) : null;
  const onTrack = pos !== null && e ? pos <= e.targetPos : null;
  return (
    <Card className="h-full" data-testid="board-card">
      <CardHeader
        icon={<Landmark />}
        title="Diretoria"
        subtitle="Estabilidade do técnico e meta da temporada"
        action={
          <Link to="/tecnico" className="flex items-center text-xs font-semibold text-club-accent hover:underline">
            Técnico <ChevronRight className="size-3.5" />
          </Link>
        }
      />
      <CardContent className="space-y-2.5">
        <div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="cf-label">Estabilidade</div>
              <div className="tabular text-2xl leading-tight font-extrabold tracking-tight" style={{ color: meta.color }}>
                {Math.round(b.stability)}%
              </div>
            </div>
            <span className={`mb-1 rounded-full border border-current/30 px-2 py-0.5 text-[11px] font-bold ${meta.text}`}>{meta.label}</span>
          </div>
          <StabilityBar value={b.stability} className="mt-1" />
          <div className="relative mt-1 h-3 text-[9px] text-fg-subtle">
            <span className="absolute -translate-x-1/2" style={{ left: `${COACH.danger}%` }}>43%</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${COACH.shielded}%` }}>79%</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            {band === 'shielded'
              ? 'Acima de 79%: ninguém consegue pressionar o seu cargo.'
              : band === 'stable'
                ? 'Cargo estável. Abaixo de 43% você fica prestes a cair.'
                : band === 'danger'
                  ? 'Abaixo de 43%: você está prestes a cair. Resultados já!'
                  : 'Abaixo de 20% o clube encerra o seu contrato.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ConfidenceRow label="Diretoria" value={b.boardConfidence} icon={<Landmark />} />
          <ConfidenceRow label="Torcida" value={b.fanConfidence} icon={<Megaphone />} />
        </div>
        {e && (
          <div className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5">
            <div className="cf-label flex items-center gap-1.5">
              <Target className="size-3.5 text-club-accent" /> Meta {e.season}
            </div>
            <div className="text-sm font-bold">{e.label}</div>
            <div className="mt-0.5 text-xs text-fg-muted">
              {e.competitionName}: até a {e.targetPos}ª posição
              {pos !== null && (
                <>
                  {' · '}agora <b className={onTrack ? 'text-success' : 'text-warning'}>{pos}º</b>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Card do técnico humano (substitui o técnico dos dados quando a carreira do técnico está ligada). */
export function HumanCoachCard({ cc, country }: { cc: CoachCareer; country: Country | undefined }) {
  const rep = coachReputation(cc.coach);
  return (
    <Card>
      <CardHeader icon={<UserRound />} title="Técnico" subtitle="Você" action={<Link to="/tecnico" className="text-xs font-semibold text-club-accent hover:underline">Perfil</Link>} />
      <CardContent className="flex items-center gap-3">
        <div className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-club-primary to-club-secondary p-[2px]">
          <div className="grid size-full place-items-center rounded-[10px] bg-surface text-sm font-extrabold text-fg">{clubInitials(cc.coach.name).slice(0, 2)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold tracking-tight">{cc.coach.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Flag country={country} /> {country?.name ?? '—'}
          </div>
          <div className="text-xs text-fg-muted">
            Reputação <b className="tabular text-fg">{rep}</b> · {reputationLabel(rep)}
            {cc.coach.contractUntil !== null && <> · contrato até {cc.coach.contractUntil}</>}
          </div>
          <div className="text-[11px] text-fg-subtle">Salário {fmtMoney(cc.coach.wage)}/mês</div>
        </div>
      </CardContent>
    </Card>
  );
}
