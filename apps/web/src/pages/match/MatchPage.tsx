import { useEffect } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, ChevronRight, Loader2 } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { useMatch } from '@/store/match';
import { useSeason, useSeasonState } from '@/store/season';
import { daysBetween, fixtureToday, humanIdOf, upcomingFixtures } from '@/season/view';
import { Button } from '@/components/ui/button';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { PreMatch } from './PreMatch';
import { LiveMatch } from './Live';
import { PostMatch, RoundSummary } from './PostMatch';
import { SoloMatchView } from './view';

/**
 * MATCH DAY: pré-jogo → ao vivo (MatchSimulation, tick a tick) → pós-jogo → advanceDay + resumo da rodada.
 */
export function MatchPage() {
  const season = useSeasonState();
  const human = humanIdOf(season);
  const phase = useMatch((s) => s.phase);
  const fixtureId = useMatch((s) => s.fixtureId);
  const today = fixtureToday(season, human);

  // partida em memória de outro dia (ex.: carreira trocada): descarta
  useEffect(() => {
    if ((phase === 'live' || phase === 'post') && fixtureId && today?.id !== fixtureId) useMatch.getState().reset();
  }, [phase, fixtureId, today?.id]);

  // sair da página pausa o jogo (para não perder lances)
  useEffect(() => () => useMatch.getState().pause(), []);

  if (phase === 'done') return <RoundSummary />;
  if (phase === 'post' && fixtureId === today?.id) return <SoloMatchView><PostMatch /></SoloMatchView>;
  if (phase === 'live' && fixtureId === today?.id) return <SoloMatchView><LiveMatch /></SoloMatchView>;
  if (today) return <PreMatch season={season} fixture={today} humanId={human} />;
  return <NoMatchToday />;
}

function NoMatchToday() {
  const season = useSeasonState();
  const human = humanIdOf(season);
  const next = upcomingFixtures(season, human, 1)[0];
  const continueToMatch = useSeason((s) => s.continueToMatch);
  const advancing = useSeason((s) => !!s.advancing);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="cf-card mx-auto mt-6 max-w-lg p-8 text-center">
      <CalendarClock className="mx-auto size-10 text-club-accent" />
      <h1 className="mt-4 text-xl font-extrabold">Sem jogo hoje</h1>
      <p className="mt-1 text-sm text-fg-muted">{fmtDate(season.date, { weekday: 'long', day: '2-digit', month: 'long' })}</p>
      {next ? (
        <>
          <div className="mt-6 flex items-center justify-center gap-4">
            <ClubCrest id={next.homeId} size={48} />
            <span className="text-sm font-bold text-fg-muted">x</span>
            <ClubCrest id={next.awayId} size={48} />
          </div>
          <p className="mt-3 text-sm">
            <b>{clubLabel(next.homeId)}</b> x <b>{clubLabel(next.awayId)}</b>
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Rodada {next.round} · {fmtDate(next.date, { weekday: 'short', day: '2-digit', month: 'short' })} · em {daysBetween(season.date, next.date) === 1 ? '1 dia' : `${daysBetween(season.date, next.date)} dias`}
          </p>
          <Button variant="club" className="mt-6" disabled={advancing} onClick={() => void continueToMatch()}>
            {advancing ? <Loader2 className="animate-spin" /> : <ChevronRight />} Avançar até o jogo
          </Button>
        </>
      ) : (
        <p className="mt-4 text-sm text-fg-muted">A temporada terminou para o seu clube.</p>
      )}
    </motion.div>
  );
}
