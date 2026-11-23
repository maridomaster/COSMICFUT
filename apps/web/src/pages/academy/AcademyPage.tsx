/**
 * (Base) Categorias de base do clube: de tempos em tempos a base revela um jogador (overall 60–82, potencial 75–95,
 * o topo é raro; salário sempre pequeno). O técnico promove ao elenco principal ou dispensa; sem decisão, o revelado
 * sai do clube depois de alguns meses. As ações passam pelo adaptador do mercado (solo e online).
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpCircle, Gem, Sprout, UserX } from 'lucide-react';
import { ACADEMY, type AcademyProspect } from '@cosmicfut/engine';
import { useCurrentClub } from '@/app/ClubContext';
import { useCountryMap } from '@/data/hooks';
import { fmtDate, fmtMoney } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState } from '@/store/season';
import { daysBetween } from '@/season/view';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Flag, OvrBadge, PositionChip } from '@/components/game/bits';
import { useMarketActions } from '@/pages/market/actions';

export function AcademyPage() {
  const { bundle } = useCurrentClub();
  const season = useSeasonState();
  const clubId = bundle.club.id;
  const academy = season.market?.academy?.[clubId];
  const prospects = academy?.prospects ?? [];
  const maxSquad = ACADEMY.squadCap;
  const squadSize = bundle.players.length;
  const actions = useMarketActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const run = async (id: string, fn: () => Promise<{ error?: string }>, ok: string) => {
    setBusy(id);
    const r = await fn();
    setBusy(null);
    setMsg(r.error ? { text: r.error, ok: false } : { text: ok, ok: true });
  };

  const nextIn = academy ? Math.max(0, daysBetween(season.date, academy.next)) : null;
  const meta = [
    `${prospects.length} ${prospects.length === 1 ? 'revelado' : 'revelados'}`,
    `elenco ${squadSize}/${maxSquad}`,
    academy ? (prospects.length >= ACADEMY.maxProspects ? 'base cheia' : nextIn === 0 ? 'nova revelação a qualquer momento' : `próxima revelação em ~${nextIn} dias`) : 'a base começa a revelar jogadores em breve',
  ].join(' · ');

  return (
    <motion.div variants={staggerContainer(0.05)} initial="hidden" animate="show" className="space-y-4" data-testid="academy-page">
      <motion.div variants={fadeUp}>
        <PageHeader
          title="Base"
          eyebrow="Categorias de base"
          meta={meta}
          description={`De tempos em tempos (a cada ${ACADEMY.gapDays[0]}–${ACADEMY.gapDays[1]} dias) a base revela um jogador de ${ACADEMY.age[0]}–${ACADEMY.age[1]} anos, com overall de ${ACADEMY.ovr[0]} a ${ACADEMY.ovr[1]} e potencial de ${ACADEMY.pot[0]} a ${ACADEMY.pot[1]} (joias raras até ${ACADEMY.gem[1]}) — os melhores são raros. Promova ao elenco principal (contrato de ${ACADEMY.contractYears} anos e salário pequeno) ou dispense. Sem decisão em ${ACADEMY.expireDays} dias, ele deixa o clube. Até ${ACADEMY.maxProspects} revelados esperando.`}
        />
      </motion.div>

      {msg && (
        <motion.p variants={fadeUp} className={cn('rounded-lg px-3 py-2 text-sm font-semibold', msg.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')} data-testid="academy-msg">
          {msg.text}
        </motion.p>
      )}
      {actions.blocked && <p className="text-sm text-fg-muted">{actions.blocked}</p>}

      {prospects.length === 0 ? (
        <motion.div variants={fadeUp} className="cf-card grid place-items-center gap-2 p-10 text-center">
          <Sprout className="size-9 text-club-accent" />
          <p className="font-bold">Nenhum jogador revelado agora</p>
          <p className="max-w-md text-sm text-fg-muted">
            {academy ? `A próxima revelação sai por volta de ${fmtDate(academy.next)}.` : 'Avance alguns dias: a base vai revelar o primeiro jogador.'} Você recebe uma notícia quando aparecer alguém.
          </p>
        </motion.div>
      ) : (
        <motion.div variants={fadeUp} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {prospects.map((x) => (
            <ProspectCard
              key={x.player.id}
              x={x}
              today={season.date}
              busy={busy === x.player.id}
              disabled={!!actions.blocked}
              onPromote={() => void run(x.player.id, () => actions.promote(x.player.id), `${x.player.name} subiu para o elenco principal.`)}
              onDismiss={() => void run(x.player.id, () => actions.dismiss(x.player.id), `${x.player.name} foi dispensado da base.`)}
            />
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

function ProspectCard({ x, today, busy, disabled, onPromote, onDismiss }: {
  x: AcademyProspect; today: string; busy: boolean; disabled: boolean; onPromote: () => void; onDismiss: () => void;
}) {
  const countries = useCountryMap();
  const p = x.player;
  const left = Math.max(0, daysBetween(today, x.expiresOn));
  const gem = p.potential >= 90;
  return (
    <div className={cn('cf-card flex flex-col gap-3 p-4', gem && 'ring-1 ring-club-accent/50')} data-testid="academy-prospect">
      <div className="flex items-start gap-3">
        <OvrBadge value={p.overall} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold">{p.name}</span>
            {gem && (
              <span title="Joia da base (potencial 90+)" className="inline-flex items-center gap-1 rounded-full bg-club-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-club-accent uppercase">
                <Gem className="size-3" /> Joia
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            <PositionChip position={p.position} foot={p.side} />
            <Flag country={countries.get(p.nationalityId)} />
            <span>{p.age} anos</span>
          </div>
        </div>
        <div className="text-right">
          <div className="cf-label">Potencial</div>
          <div className={cn('tabular text-2xl leading-none font-extrabold', gem ? 'text-club-accent' : 'text-fg')} data-testid="academy-pot">{p.potential}</div>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-fg-subtle">Salário</dt>
          <dd className="tabular font-semibold">{fmtMoney(p.wage)}/mês</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Valor</dt>
          <dd className="tabular font-semibold">{fmtMoney(p.value)}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Sai em</dt>
          <dd className={cn('tabular font-semibold', left <= 15 && 'text-warning')}>{left} dias</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button variant="club" size="sm" className="flex-1" disabled={busy || disabled} onClick={onPromote} data-testid="academy-promote">
          <ArrowUpCircle /> Promover
        </Button>
        <Button variant="outline" size="sm" disabled={busy || disabled} onClick={onDismiss} data-testid="academy-dismiss">
          <UserX /> Dispensar
        </Button>
      </div>
    </div>
  );
}
