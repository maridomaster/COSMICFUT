import { useCallback, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useCurrentClub } from '@/app/ClubContext';
import { useCountryMap, useLeagueMap, useTraits } from '@/data/hooks';
import { summarizeSquad } from '@/data/derive';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { Link } from 'react-router';
import { ChevronRight, Trophy } from 'lucide-react';
import { seasonLabel, turnoverInfo } from '@cosmicfut/engine';
import { useSeasonOver, useSeasonState, useWorld } from '@/store/season';
import { competitionOf, upcomingFixtures } from '@/season/view';
import { ClubHero } from './Hero';
import { CoachCard, FinanceCard, FixturesCard, MyCompetitionsCard, NewsCard, SquadOverviewCard, StadiumCard, StandingsMiniCard } from './Cards';
import { MarketAlert } from './MarketAlert';
import { ContinentalMatchBanner } from './ContinentalBanner';
import { PlayerDrawer } from '@/components/game/PlayerDrawer';
import { BoardCard, HumanCoachCard } from '@/pages/coach/BoardCard';
import { useCoachCareer } from '@/pages/coach/shared';

export function DashboardPage() {
  const { bundle } = useCurrentClub();
  const { club, players } = bundle;
  const season = useSeasonState();
  const career = !!useWorld();
  const coach = useCoachCareer();
  const over = useSeasonOver();
  const clubState = season.clubs[club.id];
  const { data: traitList } = useTraits();
  const countries = useCountryMap();
  const leagues = useLeagueMap();

  const summary = useMemo(() => summarizeSquad(players), [players]);
  // (Etapa 1) virada pendente da região do humano (rótulo "2026" ou "2026/27")
  const ti = useMemo(() => turnoverInfo(season), [season]);
  const comp = useMemo(() => competitionOf(season, club.id), [season, club.id]);
  const matches = useMemo(() => upcomingFixtures(season, club.id, 5), [season, club.id]);
  const traits = useMemo(() => new Map((traitList ?? []).map((t) => [t.id, t])), [traitList]);
  const [cardId, setCardId] = useState<string | null>(null);
  const closeCard = useCallback(() => setCardId(null), []);

  return (
    // (Atualização 41) layout compacto: faixa do clube de ~92px, grade de 3 colunas com espaçamento de 12px e
    // sem a tabela "Elenco completo" (duplicava a página Elenco; o Top 5 abre o card do jogador)
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.div variants={fadeUp}>
        <ClubHero
          club={club}
          country={countries.get(club.countryId)}
          league={club.leagueId ? leagues.get(club.leagueId) : undefined}
          leagueLabel={career ? (comp?.name ?? 'Estadual') : undefined}
          summary={summary}
          morale={clubState?.morale ?? 50}
        />
      </motion.div>

      {career && <ContinentalMatchBanner season={season} clubId={club.id} />}
      <MarketAlert clubId={club.id} />
      {over && (
        <motion.div variants={fadeUp}>
          <Link to="/fim-de-temporada" className="flex items-center gap-2.5 rounded-xl border border-warning/45 bg-warning/10 px-3 py-2 text-sm hover:bg-warning/15">
            <Trophy className="size-4 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">
              <b>Temporada {ti.label} encerrada.</b> Veja os campeões, renove contratos e comece {seasonLabel(ti.cycle, ti.season + 1)}.
            </span>
            <ChevronRight className="size-4" />
          </Link>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <motion.div variants={fadeUp}>
          <FixturesCard clubId={club.id} fixtures={matches} today={season.date} compName={career ? 'Todas as competições' : (comp?.name ?? 'Temporada')} season={season} />
        </motion.div>
        {career ? (
          <motion.div variants={fadeUp}>
            <MyCompetitionsCard season={season} clubId={club.id} />
          </motion.div>
        ) : (
          <motion.div variants={fadeUp}>{comp && <StandingsMiniCard comp={comp} clubId={club.id} />}</motion.div>
        )}
        {career && comp && (
          <motion.div variants={fadeUp} className="xl:row-span-2">
            <StandingsMiniCard comp={comp} clubId={club.id} season={season} />
          </motion.div>
        )}
        <motion.div variants={fadeUp} className={career ? 'md:col-span-2' : 'md:col-span-2 xl:col-span-1'}>
          <SquadOverviewCard summary={summary} onSelect={setCardId} />
        </motion.div>
        {coach?.board && (
          <motion.div variants={fadeUp}>
            <BoardCard cc={coach} season={season} />
          </motion.div>
        )}
        <motion.div variants={fadeUp} className={coach?.board ? 'md:col-span-1 xl:col-span-2' : 'md:col-span-2 xl:col-span-2'}>
          <NewsCard season={season} clubId={club.id} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <FinanceCard club={club} wageBill={summary.wageBill} balance={clubState?.balance ?? club.finances.balance} ledger={clubState?.finance} ceiling={season.clubInfo?.[club.id]?.wageCeiling} fanMorale={season.career?.econ ? clubState?.fanMorale ?? 60 : undefined} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StadiumCard club={club} capacity={season.clubInfo?.[club.id]?.capacity} work={clubState?.stadiumWork} />
        </motion.div>
        <motion.div variants={fadeUp}>
          {coach ? (
            <HumanCoachCard cc={coach} country={countries.get(coach.coach.nationalityId)} />
          ) : (
            <CoachCard club={club} country={countries.get(club.coach.nationalityId)} />
          )}
        </motion.div>
      </div>

      <PlayerDrawer player={cardId ? (players.find((p) => p.id === cardId) ?? null) : null} onClose={closeCard} countries={countries} traits={traits} />
    </motion.div>
  );
}