import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { AlertTriangle, Landmark, Pencil, Play, Shirt, Swords, Wand2 } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { getFormationSlots, type Competition, type Fixture, type Lineup, type MatchConfig, type MatchTeamInput, type SeasonState, type Side } from '@cosmicfut/engine';
import { cachedBundle, ensureBundles, squadOf } from '@/data/squads';
import { clubIndexEntry } from '@/data/clubIndex';
import { fixtureInfo } from '@/season/comps';
import { fmtPrice, gateEstimate } from '@/season/finance';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { fmtDate, fmtInt } from '@/lib/format';
import { computeIndicators, ROLE_LABEL, shortName } from '@/lib/lineup';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { useMatch } from '@/store/match';
import { positionOf } from '@/season/view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FitScroll } from '@/components/ui/fit-scroll';
import { OvrBadge, PositionChip } from '@/components/game/bits';
import { FormDots } from '@/components/game/standings';
import { AvailabilityBadges, ClubCrest, clubColors, clubLabel, useHumanStatus } from '@/components/game/status';
import { StaminaBar } from '@/components/game/StaminaBar';
import { buildMatchSetup, lineupIssues } from './setup';
import { useMatchColors } from './shared';

/**
 * Pré-jogo. Solo: monta o MatchConfig local e tem o botão "Começar partida".
 * Online (`preset` + `footer`): o MatchConfig vem do servidor (match:preview, escalações finais) e o rodapé é a
 * contagem regressiva até o match:start — sem botão de começar nem correção de escalação.
 */
export function PreMatch({ season, fixture, humanId, preset, footer }: {
  season: SeasonState;
  fixture: Fixture;
  humanId: string;
  preset?: { config: MatchConfig; humanSide: Side };
  footer?: ReactNode;
}) {
  const tactic = useGame((s) => s.tactic);
  const lineup = useGame((s) => s.lineup);
  const autoPick = useGame((s) => s.autoPick);
  const start = useMatch((s) => s.start);
  // (Atualização 38) suspensões da competição DESTE jogo
  const status = useHumanStatus(fixture.competitionId);

  const setup = useMemo(
    () => (preset ? { ...preset, autoLineup: false } : buildMatchSetup(season, fixture, humanId, tactic, lineup)),
    [preset, season, fixture, humanId, tactic, lineup],
  );
  // bundles completos dos dois clubes só para exibição (nome curto, estádio, escudo grande)
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    void ensureBundles([fixture.homeId, fixture.awayId]).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [fixture.homeId, fixture.awayId]);
  const humanSide = setup.humanSide;
  const human = setup.config[humanSide];
  const ai = setup.config[humanSide === 'home' ? 'away' : 'home'];
  const issues = lineupIssues(lineup, human.players);
  const info = useMemo(() => fixtureInfo(season, fixture), [season, fixture]);
  const comp = info.comp;
  const colors = useMatchColors(clubColors(fixture.homeId), clubColors(fixture.awayId));
  const homeClub = cachedBundle(fixture.homeId)?.club;
  // (Fase 2) capacidade da temporada (inclui ampliações do estádio)
  const homeCap = season.clubInfo?.[fixture.homeId]?.capacity ?? homeClub?.stadium.capacity ?? clubIndexEntry(fixture.homeId)?.capacity;
  // mandante humano (carreira): público esperado com o preço do ingresso
  const gate = humanId === fixture.homeId && !fixture.neutral && season.career ? gateEstimate(season, fixture.homeId, fixture.awayId, undefined, fixture) : null;
  const continental = comp?.type === 'continental';
  const rules = setup.config;

  const ind = (t: MatchTeamInput) => computeIndicators(t.lineup, getFormationSlots(t.tactic.formation), new Map(t.players.map((p) => [p.id, p])));
  const indHome = ind(setup.config.home);
  const indAway = ind(setup.config.away);

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      {/* Confronto — (Atualização 41) compacto: escudos de 56px, sem respiro excessivo (339px → ~190px) */}
      <motion.section variants={fadeUp} className="cf-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(100deg, color-mix(in oklab, ${colors.home.primary} 30%, transparent) 0%, transparent 42%, transparent 58%, color-mix(in oklab, ${colors.away.primary} 30%, transparent) 100%)`,
          }}
        />
        <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 64px)' }} />
        <div className="relative px-3 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-center text-xs text-fg-muted">
            {continental && comp && (
              <motion.span initial={{ scale: 0.6, rotate: -15, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 15 }} className="inline-flex">
                <ContinentalSeal compId={comp.id} size={32} title={comp.name} />
              </motion.span>
            )}
            <span className="font-semibold tracking-[0.18em] text-club-accent uppercase">{continental ? 'Noite continental' : 'Match Day'}</span>
            <span>·</span>
            <span className="font-semibold text-fg">{comp?.name ?? info.compName}</span>
            <span>·</span>
            <span>{info.phase}</span>
            {info.legLabel && (
              <>
                <span>·</span>
                <span className="rounded bg-club-accent/15 px-1.5 font-bold text-club-accent">{info.legLabel}</span>
              </>
            )}
            <span>·</span>
            <span>{fmtDate(fixture.date, { weekday: 'long', day: '2-digit', month: 'long' })}</span>
          </div>
          {(info.firstLeg?.result || rules.knockout) && (
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
              {info.firstLeg?.result && (
                <span className="tabular rounded-lg border border-line-strong bg-surface-2/70 px-2 py-0.5 font-semibold">
                  Ida: {clubLabel(info.firstLeg.homeId, true)} {info.firstLeg.result.home} x {info.firstLeg.result.away} {clubLabel(info.firstLeg.awayId, true)}
                </span>
              )}
              {rules.knockout && (
                <span className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-0.5 font-semibold text-warning">
                  {rules.aggregate ? 'Decide no agregado' : 'Jogo decisivo'} · empate → {rules.extraTime ? 'prorrogação e pênaltis' : 'pênaltis (sem prorrogação)'}
                </span>
              )}
              {fixture.neutral && <span className="rounded-lg border border-line px-2 py-0.5 text-fg-muted">Campo neutro</span>}
            </div>
          )}
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
            <TeamBlock id={fixture.homeId} season={season} comp={comp} side={fixture.neutral ? 'Mandante (neutro)' : 'Mandante'} human={humanId === fixture.homeId} />
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 18 }}
              className="grid size-9 place-items-center rounded-full border border-line-strong bg-surface-2/80 text-xs font-black tracking-wider text-fg-muted sm:size-11 sm:text-sm"
            >
              VS
            </motion.div>
            <TeamBlock id={fixture.awayId} season={season} comp={comp} side="Visitante" human={humanId === fixture.awayId} />
          </div>
          {(homeClub || homeCap) && (
            <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-fg-muted">
              <Landmark className="size-3.5" /> {homeClub ? `${homeClub.stadium.name} · ` : `Casa do ${clubLabel(fixture.homeId, true)} · `}
              {fmtInt(homeCap ?? 0)} lugares
              {gate && (
                <span className="text-fg-subtle">
                  · público esperado ~{fmtInt(gate.attendance)} com ingresso a {fmtPrice(gate.price)}{' '}
                  <Link to="/financas?tab=gestao" className="font-semibold text-club-accent hover:underline">
                    ajustar
                  </Link>
                </span>
              )}
            </p>
          )}
        </div>
      </motion.section>

      {/* Avisos + começar (online: contagem regressiva do servidor) */}
      {footer ? (
        <motion.div variants={fadeUp}>{footer}</motion.div>
      ) : (
      <motion.div variants={fadeUp} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          {issues.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/35 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{issues.join(' · ')} — a escalação automática será usada.</span>
              <Button size="sm" variant="outline" onClick={() => autoPick(squadOf(humanId), new Set([...status].filter(([, s]) => s.injury || s.suspension).map(([id]) => id)))}>
                <Wand2 /> Corrigir agora
              </Button>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">
              Escalação pronta no <b className="text-fg">{tactic.formation}</b>. Ajustes finos em{' '}
              <Link to="/taticas" className="font-semibold text-club-accent hover:underline">
                Táticas
              </Link>
              .
            </p>
          )}
        </div>
        <Button
          variant="club"
          className="w-full sm:w-auto"
          onClick={() => start(setup.config, fixture.id, setup.humanSide)}
        >
          <Play fill="currentColor" /> Começar partida
        </Button>
      </motion.div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)_minmax(0,1fr)]">
        <motion.div variants={fadeUp} className={cn(humanSide === 'away' && 'lg:order-3')}>
          <LineupCard team={human} title="Sua escalação" human statusMap={status} />
        </motion.div>
        <motion.div variants={fadeUp} className="lg:order-2">
          <Card>
            <CardHeader icon={<Swords />} title="Comparação de forças" subtitle="Titulares × adequação aos setores" />
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <ClubCrest id={fixture.homeId} size={18} /> {clubLabel(fixture.homeId, true)}
                </span>
                <span className="flex items-center gap-1.5">
                  {clubLabel(fixture.awayId, true)} <ClubCrest id={fixture.awayId} size={18} />
                </span>
              </div>
              {(
                [
                  ['Overall', indHome.avgOverall, indAway.avgOverall],
                  ['Defesa', indHome.defense, indAway.defense],
                  ['Meio', indHome.midfield, indAway.midfield],
                  ['Ataque', indHome.attack, indAway.attack],
                  ['Moral', setup.config.home.morale ?? 50, setup.config.away.morale ?? 50],
                ] as const
              ).map(([label, h, a], i) => (
                <CompareBar key={label} label={label} home={h} away={a} colors={[colors.home.primary, colors.away.primary]} delay={i * 0.06} />
              ))}
              <div className="grid grid-cols-2 gap-1.5 text-center text-[11px] text-fg-muted">
                <span className="rounded-md border border-line bg-surface-2/50 py-1">{setup.config.home.tactic.formation} · {mentalityLabel(setup.config.home.tactic.mentality)}</span>
                <span className="rounded-md border border-line bg-surface-2/50 py-1">{setup.config.away.tactic.formation} · {mentalityLabel(setup.config.away.tactic.mentality)}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp} className={cn(humanSide === 'away' ? 'lg:order-1' : 'lg:order-3')}>
          <LineupCard team={ai} title={`Provável ${clubLabel(ai.clubId, true)}`} />
        </motion.div>
      </div>
    </motion.div>
  );
}

const MENT: Record<string, string> = { 'ultra-defensive': 'Retranca', defensive: 'Defensiva', balanced: 'Equilibrada', attacking: 'Ofensiva', 'all-out': 'Tudo ao ataque' };
const mentalityLabel = (m: string) => MENT[m] ?? m;

function TeamBlock({ id, season, comp, side, human }: { id: string; season: SeasonState; comp?: Competition; side: string; human: boolean }) {
  // posição na fase de tabela desta competição (em mata-mata, a tabela da fase anterior, se houver)
  const pos = positionOf(season, id, comp);
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }}>
        <ClubCrest id={id} size={56} className="drop-shadow-[0_6px_16px_rgb(0_0_0/0.55)] max-sm:!size-10" />
      </motion.div>
      <div className="mt-1 max-w-full truncate text-sm font-extrabold tracking-tight sm:text-lg">{clubLabel(id)}</div>
      <div className="text-[11px] text-fg-muted">
        {side}
        {human && <span className="ml-1 rounded bg-club-accent/15 px-1 font-bold text-club-accent">VOCÊ</span>}
      </div>
      {pos && (
        <div className="mt-1 flex items-center gap-2">
          <span className="tabular text-xs font-semibold">
            {pos.row.played ? `${pos.pos}º · ${pos.row.points} pts` : 'Estreia na competição'}
          </span>
          <FormDots form={pos.row.form} size="sm" />
        </div>
      )}
    </div>
  );
}

function CompareBar({ label, home, away, colors, delay }: { label: string; home: number; away: number; colors: [string, string]; delay: number }) {
  const total = Math.max(1, home + away);
  const hp = (home / total) * 100;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className={cn('tabular font-bold', home >= away ? 'text-fg' : 'text-fg-muted')}>{home.toFixed(0)}</span>
        <span className="text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">{label}</span>
        <span className={cn('tabular font-bold', away >= home ? 'text-fg' : 'text-fg-muted')}>{away.toFixed(0)}</span>
      </div>
      <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-surface-3">
        <motion.div className="h-full rounded-l-full" style={{ background: colors[0] }} initial={{ width: '50%' }} animate={{ width: `${hp}%` }} transition={{ duration: 0.7, delay, ease: EASE_OUT }} />
        <div className="h-full flex-1 rounded-r-full" style={{ background: colors[1] }} />
      </div>
    </div>
  );
}

function LineupCard({ team, title, human, statusMap }: { team: MatchTeamInput; title: string; human?: boolean; statusMap?: ReturnType<typeof useHumanStatus> }) {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const slots = getFormationSlots(team.tactic.formation);
  const starters = team.lineup.starters.map((id, i) => ({ p: byId.get(id), role: slots[i]?.role })).filter((x): x is { p: Player; role: NonNullable<typeof x.role> } => !!x.p);
  const bench = team.lineup.bench.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Shirt />}
        title={title}
        subtitle={`${team.tactic.formation} · ${team.name}`}
        action={
          human ? (
            <Link to="/taticas" className="flex items-center gap-1 text-xs font-semibold text-club-accent hover:underline">
              <Pencil className="size-3" /> Táticas
            </Link>
          ) : undefined
        }
      />
      {/* (Atualização 41) no desktop a escalação rola dentro do card para o pré-jogo caber na tela */}
      <FitScroll bottom={30} min={220}>
      <CardContent className="space-y-0.5 pt-2">
        {starters.map(({ p, role }) => (
          <LineRow key={p.id} p={p} role={ROLE_LABEL[role]} lineup={team.lineup} status={statusMap?.get(p.id)} fitness={team.fitness?.[p.id]} />
        ))}
        {bench.length > 0 && (
          <>
            <div className="cf-label pt-1.5 pb-0.5">Banco</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-2">
              {bench.map((p) => (
                <span key={p.id} className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] odd:bg-surface-2/35" title={`${p.name} · ${p.position} · overall ${p.overall}`}>
                  <span className="min-w-0 flex-1 truncate font-medium">{shortName(p.name)}</span>
                  <AvailabilityBadges status={statusMap?.get(p.id)} compact />
                  {/* (Atualização 38) stamina de todo o banco */}
                  <StaminaBar value={team.fitness?.[p.id] ?? 100} className="w-8 shrink-0" />
                  <OvrBadge value={p.overall} size="xs" />
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
      </FitScroll>
    </Card>
  );
}

function LineRow({ p, role, lineup, status, fitness }: { p: Player; role: string; lineup: Lineup; status?: ReturnType<ReturnType<typeof useHumanStatus>['get']>; fitness?: number }) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md px-1.5 odd:bg-surface-2/35">
      <span className="w-7 text-[10px] font-bold text-fg-subtle">{role}</span>
      <PositionChip position={p.position} className="hidden sm:inline-flex" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={p.name}>
        {p.name}
        {lineup.captainId === p.id && <span className="ml-1 rounded bg-club-accent/20 px-1 text-[9px] font-black text-club-accent">C</span>}
      </span>
      <AvailabilityBadges status={status} compact />
      {/* (Atualização 38) stamina de cada titular (na mesma linha desde a Atualização 41) */}
      <StaminaBar value={fitness ?? 100} className="w-10 shrink-0" />
      <OvrBadge value={p.overall} size="xs" />
    </div>
  );
}
