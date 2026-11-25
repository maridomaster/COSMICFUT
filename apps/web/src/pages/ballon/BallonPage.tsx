/**
 * (19/11) Bola de Ouro (mundial: todas as competições) e Bola de Prata (o campeonato nacional de cada país).
 * Cada aba: a CORRIDA da temporada em curso (top 10 pela nota da premiação, com os números até hoje), quem tem o
 * ícone agora (bônus nas partidas até a próxima premiação) e os vencedores anteriores.
 */
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Crown, Medal } from 'lucide-react';
import { ballonRace, isNationalLeague, raceLabels, silverRanking, type AwardPlayer, type Honor } from '@cosmicfut/engine';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState, useWorld } from '@/store/season';
import { squads } from '@/data/squads';
import { useCountryMap } from '@/data/hooks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/range';
import { Flag, PositionChip } from '@/components/game/bits';
import { ClubCrest, clubLabel } from '@/components/game/status';
import { HonorBallIcon, honorTitle } from '@/components/game/HonorBall';
import { AwardsSection, BallonHistory } from '@/pages/season-end/AwardsSection';

const MEDAL = ['text-[#f5c542]', 'text-[#c9d1d9]', 'text-[#d08b4f]'];

export function BallonPage() {
  const world = useWorld();
  const [view, setView] = useState<'ouro' | 'prata'>('ouro');

  if (!world) {
    return <div className="cf-card mx-auto mt-6 max-w-lg p-8 text-center text-sm text-fg-muted">A Bola de Ouro existe só no modo carreira.</div>;
  }

  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.06)} className="space-y-3">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cf-label text-club-accent">Prêmios</p>
          <h1 className="text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">Bola de Ouro e Bola de Prata</h1>
          <p className="text-xs text-fg-muted">
            Ouro: o melhor do mundo somando todas as competições. Prata: o melhor de cada campeonato nacional. Quem ganha leva o ícone até a próxima premiação.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Segmented
            id="ballon-view"
            label="Prêmio"
            value={view}
            onChange={setView}
            options={[
              { value: 'ouro', label: 'Bola de Ouro' },
              { value: 'prata', label: 'Bola de Prata' },
            ]}
          />
        </div>
      </motion.header>
      {view === 'ouro' ? <GoldView key="ouro" /> : <SilverView key="prata" />}
    </motion.div>
  );
}

function GoldView() {
  const state = useSeasonState();
  const world = useWorld()!;
  const race = useMemo<AwardPlayer[]>(() => (state.career ? ballonRace(world, state, squads, Object.keys(state.clubs), { top: 10 }) : []), [world, state]);
  const mine = new Set(world.humanClubIds);
  const label = raceLabels(state.date).join(' · ');
  const last = world.awards?.at(-1);
  const holder = state.career?.honors?.world;
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      {holder && <HolderCard h={holder} />}
      <motion.div variants={fadeUp}>
        <Card data-testid="ballon-race">
          <CardHeader icon={<Crown />} title={`Corrida da Bola de Ouro · ${label}`} subtitle="Desempenho em todas as competições (nota, gols, assistências; defensores pelos jogos sem sofrer gol, pesando o nível da liga) + títulos do clube: Liga dos Campeões vale o dobro da Libertadores" />
          <CardContent>
            {race.length === 0 ? <p className="text-sm text-fg-muted">Ainda não há jogos suficientes nesta temporada.</p> : <RaceTable race={race} mine={mine} />}
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

function SilverView() {
  const state = useSeasonState();
  const world = useWorld()!;
  const mine = new Set(world.humanClubIds);
  const leagues = useMemo(() => {
    const list = state.competitions.filter(isNationalLeague);
    const isMine = (id: string) => list.find((c) => c.id === id)?.clubIds.some((x) => mine.has(x));
    return list.slice().sort((a, b) => Number(!!isMine(b.id)) - Number(!!isMine(a.id)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.competitions, world.humanClubIds]);
  const [compId, setCompId] = useState(leagues[0]?.id ?? '');
  const comp = leagues.find((c) => c.id === compId) ?? leagues[0];
  const race = useMemo(() => (comp ? silverRanking(state, squads, comp.id).slice(0, 10) : []), [state, comp]);
  const holder = comp ? state.career?.honors?.national?.[comp.id] : undefined;
  const past = (world.silverBalls ?? []).filter((s) => s.competitionId === comp?.id).slice().reverse();

  if (!comp) return <p className="cf-card p-4 text-center text-sm text-fg-muted">Nenhum campeonato nacional nesta carreira.</p>;
  return (
    <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-3">
      <motion.div variants={fadeUp} className="w-full max-w-sm">
        <NativeSelect value={comp.id} onChange={(e) => setCompId(e.target.value)} aria-label="Campeonato nacional">
          {leagues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </motion.div>
      {holder && <HolderCard h={holder} />}
      <motion.div variants={fadeUp}>
        <Card data-testid="silver-race">
          <CardHeader icon={<Medal />} title={`Corrida da Bola de Prata · ${comp.name}`} subtitle="Só os jogos deste campeonato nacional" />
          <CardContent>
            {race.length === 0 ? <p className="text-sm text-fg-muted">Ainda não há jogos suficientes neste campeonato.</p> : <RaceTable race={race} mine={mine} />}
          </CardContent>
        </Card>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card data-testid="silver-history">
          <CardHeader icon={<Medal />} title={`Bola de Prata · ${comp.name} — vencedores`} subtitle={past.length ? `${past.length} temporadas` : 'A primeira sai no fim deste campeonato'} />
          {past.length > 0 && (
            <CardContent className="space-y-1.5">
              {past.map((s) => (
                <div key={`${s.date}-${s.label}`} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/35 px-2.5 py-1.5">
                  <span className="tabular w-16 shrink-0 text-xs font-bold text-fg-muted">{s.label}</span>
                  <ClubCrest id={s.best.clubId} size={18} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.best.name}</span>
                  <span className="tabular hidden text-[11px] text-fg-subtle sm:inline">
                    {s.best.games} j · {s.best.goals} g · {s.best.assists} a{s.best.cleanSheets ? ` · ${s.best.cleanSheets} SG` : ''} · nota {s.best.rating.toFixed(1)}
                  </span>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}

function HolderCard({ h }: { h: Honor }) {
  const gold = h.kind === 'world';
  return (
    <motion.div
      variants={fadeUp}
      className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', gold ? 'border-[#f5c542]/50 bg-[#f5c542]/10' : 'border-[#c9d1d9]/40 bg-[#c9d1d9]/5')}
      data-testid={`holder-${h.kind}`}
    >
      <HonorBallIcon kind={h.kind} size={28} />
      <div className="min-w-0 flex-1">
        <div className={cn('text-[11px] font-semibold tracking-wide uppercase', gold ? 'text-[#f5c542]' : 'text-[#c9d1d9]')}>
          {gold ? 'Bola de Ouro' : 'Bola de Prata'} {h.label} · ícone vigente
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
          <ClubCrest id={h.clubId} size={16} />
          <span className="truncate">{h.name}</span>
        </div>
        <div className="text-[11px] text-fg-muted">{honorTitle(h).split(': ')[1]}</div>
      </div>
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
            <th className="tabular py-1 pr-2 text-right" title="Jogos sem sofrer gol (conta para goleiros e defensores)">SG</th>
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
              <td className={cn('tabular py-1.5 pr-2 text-right', !['GK', 'CB', 'FB'].includes(p.position) && 'text-fg-subtle')}>{p.cleanSheets ?? 0}</td>
              <td className="tabular py-1.5 pr-2 text-right">{p.rating.toFixed(1)}</td>
              <td className="tabular py-1.5 text-right font-bold">{p.score.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
