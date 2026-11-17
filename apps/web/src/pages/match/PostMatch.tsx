import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Award, ChevronRight, Home, ListOrdered, Loader2, Users, Volleyball } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { getFormationSlots, type MatchConfig, type MatchResult, type MatchState, type Side } from '@cosmicfut/engine';
import { ROLE_LABEL, shortName } from '@/lib/lineup';
import { EASE_OUT, fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useMatch } from '@/store/match';
import { useSeason, useSeasonState } from '@/store/season';
import { clubTable, competitionOf } from '@/season/view';
import { fixtureInfo } from '@/season/comps';
import { fmtPrice, paidAttendance } from '@/season/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FitScroll } from '@/components/ui/fit-scroll';
import { FixtureLine, StandingsTable, ZoneLegend, zonesIn } from '@/components/game/standings';
import { Bracket } from '@/pages/competitions/CompetitionsPage';
import { CardIcon, ClubCrest, clubColors, clubLabel, InjuryIcon } from '@/components/game/status';
import { RatingChip, usePlayerMap, useMatchColors } from './shared';
import { useMatchView } from './view';
import { MiniPitch } from './Live';

/** Fim de jogo: placar final, gols, cartões, notas e melhor em campo. */
export function PostMatch({ top }: { top?: ReactNode } = {}) {
  const view = useMatchView();
  const { config, humanSide, finishing, state } = view;
  const result = view.result!;
  const finishDay = view.finish;
  const players = usePlayerMap(config);
  const colors = useMatchColors(clubColors(config.home.clubId), clubColors(config.away.clubId));
  const mom = useMemo(() => manOfTheMatch(result, state), [result, state]);
  const humanGoals = humanSide === 'home' ? result.homeGoals : result.awayGoals;
  const oppGoals = humanSide === 'home' ? result.awayGoals : result.homeGoals;
  const pen = result.penalties;
  const humanPens = pen ? (humanSide === 'home' ? pen.home : pen.away) : 0;
  const oppPens = pen ? (humanSide === 'home' ? pen.away : pen.home) : 0;
  const outcome =
    humanGoals > oppGoals ? 'Vitória' : humanGoals < oppGoals ? 'Derrota' : pen && humanPens !== oppPens ? (humanPens > oppPens ? 'Vitória nos pênaltis' : 'Derrota nos pênaltis') : 'Empate';

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      {top}
      <motion.section variants={fadeUp} className="cf-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `linear-gradient(100deg, color-mix(in oklab, ${colors.home.primary} 30%, transparent), transparent 45%, transparent 55%, color-mix(in oklab, ${colors.away.primary} 30%, transparent))` }}
        />
        <div className="relative px-3 py-3 sm:px-5">
          <div className="text-center text-[11px] font-semibold tracking-[0.2em] text-fg-muted uppercase">
            Fim de jogo · <span className={cn(outcome.startsWith('Vitória') ? 'text-success' : outcome.startsWith('Derrota') ? 'text-danger' : 'text-fg')}>{outcome}</span>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              <ClubCrest id={config.home.clubId} size={52} className="max-sm:!size-10" />
              <span className="max-w-full truncate text-sm font-extrabold sm:text-lg">{clubLabel(config.home.clubId)}</span>
            </div>
            <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }} className="tabular text-4xl leading-none font-black tracking-tight sm:text-5xl">
              {result.homeGoals}
              <span className="mx-2 text-fg-subtle">:</span>
              {result.awayGoals}
            </motion.div>
            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              <ClubCrest id={config.away.clubId} size={52} className="max-sm:!size-10" />
              <span className="max-w-full truncate text-sm font-extrabold sm:text-lg">{clubLabel(config.away.clubId)}</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-4 text-xs sm:gap-8">
            {(['home', 'away'] as Side[]).map((side) => (
              <ul key={side} className={cn('space-y-1', side === 'home' ? 'text-right' : 'text-left')}>
                {result.scorers
                  .filter((g) => g.side === side)
                  .map((g, i) => (
                    <li key={i} className={cn('flex items-center gap-1.5', side === 'home' && 'justify-end')}>
                      <Volleyball className="size-3.5 text-fg-muted" />
                      <span className="font-semibold">{players.get(g.playerId)?.name}</span>
                      <span className="tabular text-fg-muted">
                        {g.minute}'{g.ownGoal ? ' (contra)' : g.penalty ? ' (pên.)' : ''}
                      </span>
                    </li>
                  ))}
                {result.cards
                  .filter((c) => c.side === side)
                  .map((c, i) => (
                    <li key={`c${i}`} className={cn('flex items-center gap-1.5 text-fg-muted', side === 'home' && 'justify-end')}>
                      <CardIcon color={c.color} className="h-3 w-2" />
                      <span>{shortName(players.get(c.playerId)?.name ?? '')}</span>
                      <span className="tabular">{c.minute}'</span>
                    </li>
                  ))}
                {result.injuries
                  .filter((c) => c.side === side)
                  .map((c, i) => (
                    <li key={`i${i}`} className={cn('flex items-center gap-1.5 text-fg-muted', side === 'home' && 'justify-end')}>
                      <InjuryIcon className="size-3.5" />
                      <span>{shortName(players.get(c.playerId)?.name ?? '')}</span>
                      <span className="tabular">{c.days}d</span>
                    </li>
                  ))}
              </ul>
            ))}
          </div>
          <TieResult config={config} result={result} />
          <Attendance homeId={config.home.clubId} result={result} />
        </div>
      </motion.section>

      <motion.div variants={fadeUp} className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center">
        {mom && (
          <div className="flex items-center gap-2.5 rounded-lg border border-warning/35 bg-warning/10 px-3 py-1.5">
            <Award className="size-5 text-warning" />
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-warning uppercase">Melhor em campo</div>
              <div className="flex items-center gap-2 text-sm font-bold">
                {players.get(mom.id)?.name} <RatingChip value={mom.rating} />
                <ClubCrest id={config[mom.side].clubId} size={18} />
              </div>
            </div>
          </div>
        )}
        <Button variant="club" size="lg" onClick={() => finishDay()} disabled={finishing}>
          {finishing ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continuar
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,22rem)]">
        {(['home', 'away'] as Side[]).map((side) => (
          <motion.div key={side} variants={fadeUp}>
            <RatingsCard side={side} config={config} state={state} result={result} players={players} momId={mom?.id} />
          </motion.div>
        ))}
        <motion.div variants={fadeUp} className="cf-card">
          <FitScroll className="p-2.5" bottom={20} min={260}>
            <MiniPitch state={state} config={config} colors={colors} players={players} humanSide={humanSide} />
          </FitScroll>
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Público pagante: com preço próprio do mandante, o público responde ao preço (o mesmo número da renda). */
function Attendance({ homeId, result }: { homeId: string; result: MatchResult }) {
  const season = useSeason((s) => s.save?.season);
  const paid = season ? paidAttendance(season, homeId, result) : result.attendance;
  // preço próprio do mandante: a engine ajustou o público (ticketDemand) ou a UI ajustou (resultado antigo)
  const adjusted = result.ticketDemand !== undefined || paid !== result.attendance;
  const price = season?.clubs[homeId]?.ticketPrice;
  return (
    <p className="mt-2 text-center text-[11px] text-fg-subtle">
      Público: {paid.toLocaleString('pt-BR')}
      {price != null && price > 0 && adjusted &&<> · ingresso a {fmtPrice(price)}</>}
    </p>
  );
}

/**
 * Mata-mata: agregado, pênaltis e quem avançou — direto do resultado da engine (Fase 2):
 * `result.aggregate` (placar somado do confronto) e `result.advancing`/`winner` (quem avança).
 */
function TieResult({ config, result }: { config: MatchConfig; result: MatchResult }) {
  if (!config.knockout && !result.aggregate && !result.penalties) return null;
  const agg = result.aggregate;
  const pens = result.penalties;
  const winner: Side | null = config.knockout ? (result.advancing ?? (result.winner !== 'draw' ? result.winner : null)) : null;
  const byPens = !!pens && (agg ? agg.home === agg.away : result.homeGoals === result.awayGoals);
  return (
    <div className="mt-2 flex flex-col items-center gap-1 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        {agg && (
          <span className="tabular rounded-lg border border-line-strong bg-surface-2/70 px-2.5 py-1 font-bold">
            Agregado {agg.home} x {agg.away}
          </span>
        )}
        {pens && (
          <span className="tabular rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1 font-bold text-warning">
            Pênaltis {pens.home} x {pens.away}
          </span>
        )}
        {result.extraTime && <span className="rounded-lg border border-line px-2.5 py-1 text-fg-muted">com prorrogação</span>}
      </div>
      {winner && (
        <div className="mt-1 flex items-center gap-2 text-sm font-extrabold">
          <ClubCrest id={config[winner].clubId} size={22} />
          {clubLabel(config[winner].clubId)} avança{byPens ? ' nos pênaltis' : ''}!
        </div>
      )}
    </div>
  );
}

function manOfTheMatch(result: MatchResult, state: MatchState): { id: string; rating: number; side: Side } | null {
  let best: { id: string; rating: number; side: Side; goals: number } | null = null;
  for (const side of ['home', 'away'] as Side[]) {
    for (const l of state.players[side]) {
      const r = result.ratings[l.id];
      if (r === undefined) continue;
      if (!best || r > best.rating || (r === best.rating && l.goals > best.goals)) best = { id: l.id, rating: r, side, goals: l.goals };
    }
  }
  return best;
}

function RatingsCard({
  side,
  config,
  state,
  result,
  players,
  momId,
}: {
  side: Side;
  config: MatchConfig;
  state: MatchState;
  result: MatchResult;
  players: Map<string, Player>;
  momId?: string;
}) {
  const slots = getFormationSlots(state.tactic[side].formation);
  const starters = new Set(config[side].lineup.starters);
  const rows = state.players[side]
    .filter((l) => result.ratings[l.id] !== undefined)
    .sort((a, b) => Number(starters.has(b.id)) - Number(starters.has(a.id)) || (a.slotIndex ?? 99) - (b.slotIndex ?? 99));
  return (
    <Card className="h-full">
      <CardHeader icon={<Users />} title={clubLabel(config[side].clubId)} subtitle={`Notas · ${state.tactic[side].formation}`} />
      <FitScroll bottom={30} min={220}>
      <CardContent className="space-y-0.5 pt-2">
        {rows.map((l) => {
          const p = players.get(l.id);
          const sub = !starters.has(l.id);
          return (
            <div key={l.id} className={cn('flex h-7 items-center gap-2 rounded-md px-2', l.id === momId ? 'bg-warning/10 ring-1 ring-warning/40' : 'odd:bg-surface-2/35')}>
              <span className="w-8 text-[10px] font-bold text-fg-subtle">{l.slotIndex !== null && l.onPitch ? ROLE_LABEL[slots[l.slotIndex].role] : l.sentOff ? 'EXP' : 'SAIU'}</span>
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', sub ? 'text-fg-muted' : 'font-medium')}>{p?.name}</span>
              {l.goals > 0 && (
                <span className="flex items-center gap-0.5 text-[11px] font-bold">
                  <Volleyball className="size-3" />
                  {l.goals > 1 && l.goals}
                </span>
              )}
              {l.assists > 0 && <span className="text-[10px] font-bold text-fg-muted">A{l.assists > 1 ? l.assists : ''}</span>}
              {l.yellow > 0 && !l.sentOff && <CardIcon color="yellow" className="h-3 w-2" />}
              {l.sentOff && <CardIcon color="red" className="h-3 w-2" />}
              {l.injured && <InjuryIcon className="size-3.5" />}
              <RatingChip value={result.ratings[l.id]} />
            </div>
          );
        })}
      </CardContent>
      </FitScroll>
    </Card>
  );
}

/** Após o advanceDay: resultados da rodada na divisão do humano e tabela atualizada. */
export function RoundSummary() {
  const navigate = useNavigate();
  const summary = useMatch((s) => s.summary);
  const reset = useMatch((s) => s.reset);
  const season = useSeasonState();
  const human = season.humanClubIds[0];
  // competição do jogo do humano no dia (carreira: liga, estadual ou copa)
  const myGame = (summary?.played ?? []).find((x) => x.fixture.homeId === human || x.fixture.awayId === human);
  const comp = (myGame && season.competitions.find((c) => c.id === myGame.fixture.competitionId)) ?? competitionOf(season, human);
  const continueToMatch = useSeason((s) => s.continueToMatch);
  const advancing = useSeason((s) => !!s.advancing);
  const navigateEnd = useNavigate();
  const games = (summary?.played ?? []).filter((x) => x.fixture.competitionId === comp?.id && (!myGame?.fixture.stageId || x.fixture.stageId === myGame.fixture.stageId));
  const others = (summary?.played ?? []).filter((x) => !games.includes(x));
  const round = games[0]?.fixture.round;
  const phase = myGame ? fixtureInfo(season, myGame.fixture) : null;
  const table = comp ? clubTable(comp, human) : null;
  const koStage = myGame?.fixture.tieId && comp ? myGame.fixture.stageId : undefined;

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">{comp?.name}</p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">{phase && comp?.format ? `Resumo · ${phase.phase}` : `Resumo da rodada ${round ?? ''}`}</h1>
          <p className="text-xs text-fg-muted">
            {games.length} jogos nesta fase{others.length ? ` · ${others.length} em outras competições/divisões` : ''}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={() => {
              reset();
              navigate('/dashboard');
            }}
          >
            <Home /> Painel
          </Button>
          <Button
            variant="club"
            className="flex-1 sm:flex-none"
            disabled={advancing}
            onClick={async () => {
              reset();
              const r = await continueToMatch();
              if (r === 'season-over') navigateEnd('/fim-de-temporada');
            }}
          >
            {advancing ? <Loader2 className="animate-spin" /> : <ChevronRight />} Próximo jogo
          </Button>
        </div>
      </motion.header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <motion.div variants={fadeUp}>
          <Card className="h-full">
            <CardHeader icon={<Volleyball />} title="Resultados" subtitle={comp?.name} />
            <CardContent className="space-y-2">
              {games.map(({ fixture }, i) => (
                <motion.div key={fixture.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: EASE_OUT }}>
                  <FixtureLine f={fixture} highlightId={human} />
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp}>
          {comp && koStage ? (
            <Bracket comp={comp} stageId={koStage} human={human} />
          ) : comp && table ? (
            <Card>
              <CardHeader
                icon={<ListOrdered />}
                title="Classificação atualizada"
                subtitle={table.label ? `${comp.name} · ${table.label}` : comp.name}
                action={<ZoneLegend comp={comp} zones={comp.format ? zonesIn(table.rows.length, table.zone) : undefined} />}
              />
              <CardContent className="px-2 sm:px-4">
                <StandingsTable comp={comp} rows={table.rows} zone={table.zone} highlightId={human} />
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      </div>
    </motion.div>
  );
}
