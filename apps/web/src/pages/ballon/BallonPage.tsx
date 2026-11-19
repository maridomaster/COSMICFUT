/**
 * (19/11) Bola de Ouro: a CORRIDA da temporada em curso (top 10 pela mesma nota da premiação, com os números até
 * hoje), a última premiação (pódio, Seleção do Mundo, time do campeonato) e os vencedores de cada temporada.
 */
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Crown } from 'lucide-react';
import { ballonRace, raceLabels, type AwardPlayer } from '@cosmicfut/engine';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState, useWorld } from '@/store/season';
import { squads } from '@/data/squads';
import { useCountryMap } from '@/data/hooks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Flag, PositionChip } from '@/components/game/bits';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { AwardsSection, BallonHistory } from '@/pages/season-end/AwardsSection';

const MEDAL = ['text-[#f5c542]', 'text-[#c9d1d9]', 'text-[#d08b4f]'];

export function BallonPage() {
  const state = useSeasonState();
  const world = useWorld();
  const race = useMemo<AwardPlayer[]>(() => {
    if (!world || !state.career) return [];
    return ballonRace(world, state, squads, Object.keys(state.clubs), { top: 10 });
  }, [world, state]);

  if (!world) {
    return <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center text-sm text-fg-muted">A Bola de Ouro existe só no modo carreira.</div>;
  }
  const mine = new Set(world.humanClubIds);
  const label = raceLabels(state.date).join(' · ');
  const last = world.awards?.at(-1);

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp}>
        <p className="cf-label text-club-accent">Prêmios</p>
        <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Bola de Ouro</h1>
        <p className="text-xs text-fg-muted">
          O melhor jogador do mundo na temporada: nota média, gols, assistências, jogos, overall e títulos do clube. A premiação sai na virada da temporada.
        </p>
      </motion.header>

      <motion.div variants={fadeUp}>
        <Card data-testid="ballon-race">
          <CardHeader icon={<Crown />} title={`Corrida da Bola de Ouro · ${label}`} subtitle="Os 10 favoritos com os números até hoje" />
          <CardContent>
            {race.length === 0 ? (
              <p className="text-sm text-fg-muted">Ainda não há jogos suficientes nesta temporada.</p>
            ) : (
              <RaceTable race={race} mine={mine} />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {last ? (
        <motion.div variants={fadeUp} className="space-y-3">
          <AwardsSection awards={last} clubIds={world.humanClubIds} />
          {world.awards!.length > 1 && <BallonHistory awards={world.awards!} />}
        </motion.div>
      ) : (
        <motion.p variants={fadeUp} className="cf-card p-4 text-center text-sm text-fg-muted">
          Nenhuma Bola de Ouro entregue ainda: a primeira sai no fim desta temporada.
        </motion.p>
      )}
    </motion.div>
  );
}

function RaceTable({ race, mine }: { race: AwardPlayer[]; mine: Set<string> }) {
  const countries = useCountryMap();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-fg-subtle uppercase">
            <th className="w-8 py-1 pr-2">#</th>
            <th className="py-1 pr-2">Jogador</th>
            <th className="hidden py-1 pr-2 sm:table-cell">Clube</th>
            <th className="tabular py-1 pr-2 text-right">J</th>
            <th className="tabular py-1 pr-2 text-right">G</th>
            <th className="tabular py-1 pr-2 text-right">A</th>
            <th className="tabular py-1 pr-2 text-right">Nota</th>
            <th className="tabular py-1 text-right">Pontos</th>
          </tr>
        </thead>
        <tbody>
          {race.map((p, i) => (
            <tr key={p.playerId} className={cn('border-t border-line/50', mine.has(p.clubId) && 'bg-club-accent/10')}>
              <td className={cn('tabular py-1.5 pr-2 font-bold', MEDAL[i] ?? 'text-fg-muted')}>{i + 1}</td>
              <td className="py-1.5 pr-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Flag country={countries.get(p.nationalityId)} />
                  <PositionChip position={p.position} />
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="tabular text-[11px] text-fg-subtle">{p.overall}</span>
                </div>
              </td>
              <td className="hidden py-1.5 pr-2 sm:table-cell">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ClubCrest id={p.clubId} size={16} />
                  <span className="truncate text-xs">{clubLabel(p.clubId)}</span>
                </div>
              </td>
              <td className="tabular py-1.5 pr-2 text-right">{p.games}</td>
              <td className="tabular py-1.5 pr-2 text-right">{p.goals}</td>
              <td className="tabular py-1.5 pr-2 text-right">{p.assists}</td>
              <td className="tabular py-1.5 pr-2 text-right">{p.rating.toFixed(1)}</td>
              <td className="tabular py-1.5 text-right font-bold">{p.score.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
