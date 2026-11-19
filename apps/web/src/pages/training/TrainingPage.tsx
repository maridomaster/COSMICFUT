/**
 * (Treino) Centro de Treinamento: até 3 jogadores do elenco em treino especial. O overall sobe aos poucos (+1 a cada
 * progresso completo, até o potencial real), e o treino gasta energia no dia do jogo e na véspera. As ações passam
 * pelo adaptador do mercado (solo e online).
 */
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Dumbbell, Plus, X } from 'lucide-react';
import type { Player } from '@cosmicfut/shared';
import { daysToNextMatch, realisticPotential, TRAINING, trainingCost, trainingEta, trainingRate } from '@cosmicfut/engine';
import { useCurrentClub } from '@/app/ClubContext';
import { fmtDate, POSITION_ORDER } from '@/lib/format';
import { fadeUp, staggerContainer } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useSeasonState } from '@/store/season';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { DeclineArrow, OvrBadge, PositionChip, potentialClass } from '@/components/game/bits';
import { useMarketActions } from '@/pages/market/actions';

export function TrainingPage() {
  const { bundle } = useCurrentClub();
  const season = useSeasonState();
  const clubId = bundle.club.id;
  const players = bundle.players;
  const t = season.market?.training?.[clubId];
  const selected = t?.players ?? [];
  const progress = t?.progress ?? {};
  const actions = useMarketActions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const cost = trainingCost(season, clubId);
  const nextIn = daysToNextMatch(season, clubId);
  const fitness = season.clubs[clubId]?.fitness ?? {};

  const save = async (ids: string[], ok: string) => {
    setBusy(true);
    const r = await actions.train(ids);
    setBusy(false);
    setMsg(r.error ? { text: r.error, ok: false } : { text: ok, ok: true });
  };
  const add = (p: Player) => {
    if (selected.length >= TRAINING.maxPlayers) return setMsg({ text: `No máximo ${TRAINING.maxPlayers} jogadores. Tire alguém do treino primeiro.`, ok: false });
    void save([...selected, p.id], `${p.name} começou a treinar.`);
  };
  const remove = (p: Player) => void save(selected.filter((id) => id !== p.id), `${p.name} saiu do treino.`);

  const trainees = selected.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const others = useMemo(
    () => players.filter((p) => !selected.includes(p.id)).sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || b.overall - a.overall),
    [players, selected],
  );

  return (
    <motion.div variants={staggerContainer(0.05)} initial="hidden" animate="show" className="space-y-4" data-testid="training-page">
      <motion.div variants={fadeUp}>
        <PageHeader
          title="Centro de Treinamento"
          eyebrow="Evolução"
          meta={`${trainees.length}/${TRAINING.maxPlayers} em treino${nextIn !== null ? ` · próximo jogo ${nextIn === 0 ? 'hoje' : nextIn === 1 ? 'amanhã' : `em ${nextIn} dias`}` : ''}`}
          description={`Até ${TRAINING.maxPlayers} jogadores em treino especial. Eles ganham overall aos poucos (mais rápido quanto mais jovens e quanto mais longe do potencial), até o potencial real. Treinar no dia do jogo custa ${TRAINING.matchDayCost} de energia e na véspera ${TRAINING.eveCost}; longe dos jogos o treino não cansa.`}
        />
      </motion.div>

      {cost > 0 && trainees.length > 0 && (
        <motion.div variants={fadeUp} className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="training-warning">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span>
            {nextIn === 0 ? 'Hoje tem jogo' : 'Amanhã tem jogo'}: quem treinar perde <b>{cost}</b> de energia. Tire do treino quem vai jogar.
          </span>
        </motion.div>
      )}
      {msg && (
        <motion.p variants={fadeUp} className={cn('rounded-lg px-3 py-2 text-sm font-semibold', msg.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
          {msg.text}
        </motion.p>
      )}
      {actions.blocked && <p className="text-sm text-fg-muted">{actions.blocked}</p>}

      <motion.div variants={fadeUp} className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: TRAINING.maxPlayers }, (_, i) => {
          const p = trainees[i];
          if (!p) {
            return (
              <div key={i} className="cf-card grid min-h-36 place-items-center p-4 text-center text-sm text-fg-subtle">
                <div>
                  <Dumbbell className="mx-auto mb-1 size-6" />
                  Vaga livre — escolha um jogador abaixo
                </div>
              </div>
            );
          }
          const prog = progress[p.id] ?? 0;
          const pot = realisticPotential(p.age, p.overall, p.potential);
          const rate = trainingRate(p);
          const eta = trainingEta(season, p, prog);
          return (
            <div key={p.id} className="cf-card flex flex-col gap-2 p-4" data-testid="trainee">
              <div className="flex items-center gap-2.5">
                <OvrBadge value={p.overall} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{p.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <PositionChip position={p.position} foot={p.side} />
                    <span>{p.age} anos</span>
                    <span>· pot <b className={potentialClass(p.age, p.overall, pot, 'text-fg')}>{pot}</b><DeclineArrow age={p.age} className="ml-0.5" /></span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Tirar ${p.name} do treino`} disabled={busy || !!actions.blocked} onClick={() => remove(p)}>
                  <X />
                </Button>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                  <span>Progresso até {p.overall + 1}</span>
                  <span className="tabular">{Math.round(prog * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-club-accent transition-[width]" style={{ width: `${Math.min(100, prog * 100)}%` }} />
                </div>
              </div>
              <div className="flex justify-between text-[11px] text-fg-muted">
                <span>{rate > 0 ? (eta ? `+1 por volta de ${fmtDate(eta, { day: '2-digit', month: 'short' })}` : '') : <span className="font-semibold text-danger">Já no potencial máximo</span>}</span>
                <span className="tabular">energia {Math.round(fitness[p.id] ?? 100)}%</span>
              </div>
            </div>
          );
        })}
      </motion.div>

      <motion.div variants={fadeUp} className="cf-card p-3">
        <div className="cf-label mb-2 px-1">Elenco</div>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {others.map((p) => {
            const pot = realisticPotential(p.age, p.overall, p.potential);
            const full = selected.length >= TRAINING.maxPlayers;
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/35 px-2.5 py-1.5">
                <PositionChip position={p.position} />
                <OvrBadge value={p.overall} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                <span className="tabular text-[11px] text-fg-subtle">{p.age}a · pot <span className={potentialClass(p.age, p.overall, pot, '')}>{pot}</span><DeclineArrow age={p.age} className="ml-0.5" /></span>
                <Button variant="outline" size="sm" disabled={busy || full || !!actions.blocked} onClick={() => add(p)} aria-label={`Treinar ${p.name}`} data-testid="train-add">
                  <Plus /> Treinar
                </Button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
