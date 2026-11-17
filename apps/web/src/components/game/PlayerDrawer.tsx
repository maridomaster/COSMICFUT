import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Crown, Gem, History, Sparkles, Sprout, Star, Target, TrendingUp, X, Zap } from 'lucide-react';
import { playerCareer } from '@cosmicfut/engine';
import { useSeason, useWorld } from '@/store/season';
import { Segmented } from '@/components/ui/range';
import { ClubCrest, clubLabel } from './status';
import type { Country, Player, Trait } from '@cosmicfut/shared';
import { displayAttributes } from '@/lib/attributes';
import { cardTierMeta, fmtMoney, overallColor, POSITION_META } from '@/lib/format';
import { statusOf } from '@/lib/lineup';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useGame } from '@/store/game';
import { Badge } from '@/components/ui/badge';
import { Flag, PositionChip, StatTile } from './bits';
import { StatusChip, TraitChips } from './player';

export interface PlayerDrawerExtras {
  /** botões de ação (ex.: Fazer proposta, Observar, Colocar à venda) */
  actions?: ReactNode;
  /** seções extras no fim do card (ex.: comparação com o titular) */
  extra?: ReactNode;
  /** linha sob o nome (ex.: clube atual) */
  context?: ReactNode;
  /** mostra titular/reserva da sua escalação (padrão: true) */
  showLineupStatus?: boolean;
}

/** Painel lateral com o card completo do jogador. */
export function PlayerDrawer({
  player,
  onClose,
  countries,
  traits,
  ...extras
}: {
  player: Player | null;
  onClose: () => void;
  countries: Map<number, Country>;
  traits: Map<number, Trait>;
} & PlayerDrawerExtras) {
  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, onClose]);

  // portal: o conteúdo das páginas fica dentro de um motion.div com transform, que quebraria o `fixed`
  return createPortal(
    <AnimatePresence>
      {player && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="panel"
            role="dialog"
            aria-modal
            aria-label={`Card de ${player.name}`}
            className="scrollbar-thin fixed inset-y-0 right-0 z-50 w-[min(26rem,100vw)] overflow-y-auto border-l border-line bg-surface shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <PlayerCard player={player} countries={countries} traits={traits} onClose={onClose} {...extras} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PlayerCard({
  player: p,
  countries,
  traits,
  onClose,
  actions,
  extra,
  context,
  showLineupStatus = true,
}: {
  player: Player;
  countries: Map<number, Country>;
  traits: Map<number, Trait>;
  onClose: () => void;
} & PlayerDrawerExtras) {
  const gameLineup = useGame((s) => s.lineup);
  const lineup = showLineupStatus ? gameLineup : null;
  const status = statusOf(lineup, p.id);
  const country = countries.get(p.nationalityId);
  const attrs = displayAttributes(p);
  const card = cardTierMeta(p.overall);
  const growth = Math.max(0, p.potential - p.overall);
  const [tab, setTab] = useState<'card' | 'carreira'>('card');

  return (
    <div className="pb-8">
      {/* Cabeçalho do card */}
      <div className="relative overflow-hidden border-b border-line px-5 pt-5 pb-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--club-primary) 38%, transparent), transparent 60%), radial-gradient(80% 80% at 0% 100%, color-mix(in oklab, var(--club-secondary) 18%, transparent), transparent 70%)',
          }}
        />
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-5" />
        </button>
        <div className="relative flex items-end gap-4">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.08 }}
            className="grid size-24 shrink-0 place-items-center rounded-2xl bg-bg/60 backdrop-blur"
            title={`Carta ${card.label} (${card.range})`}
            data-card={card.label}
            style={{
              background: `linear-gradient(160deg, color-mix(in oklab, ${card.from} 22%, transparent), color-mix(in oklab, ${card.to} 30%, var(--color-bg, #0b0f17)))`,
              boxShadow: `inset 0 0 0 2px ${card.via}, inset 0 1px 0 2px color-mix(in oklab, ${card.from} 60%, transparent), 0 14px 40px -16px ${card.via}`,
            }}
          >
            <div className="text-center leading-none">
              <div className="tabular text-5xl font-black tracking-tighter" style={{ color: card.text }}>
                {p.overall}
              </div>
              <div className="mt-1 text-[10px] font-bold tracking-[0.2em] text-fg-muted">
                {POSITION_META[p.position].short} · <span style={{ color: card.text }}>{card.label.toUpperCase()}</span>
              </div>
            </div>
          </motion.div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-2">
              <PositionChip position={p.position} />
              {showLineupStatus && <StatusChip status={status} />}
            </div>
            <h2 className="mt-2 text-xl leading-tight font-extrabold tracking-tight">{p.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <span className="flex items-center gap-1.5">
                <Flag country={country} />
                {country?.name ?? '—'}
              </span>
              <span>·</span>
              <span className="tabular">{p.age} anos</span>
              <span>·</span>
              <span>{p.side === 'L' ? 'Canhoto' : 'Destro'}</span>
            </div>
            {context && <div className="mt-1.5 text-xs text-fg-muted">{context}</div>}
          </div>
        </div>
        {(p.worldClass || p.star || p.highlight || p.youth || lineup?.captainId === p.id || lineup?.penaltyTakerId === p.id) && (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {p.worldClass && (
              <Badge variant="club">
                <Sparkles className="size-3" /> Elite mundial
              </Badge>
            )}
            {p.star && (
              <Badge variant="warning">
                <Star className="size-3" fill="currentColor" /> Craque
              </Badge>
            )}
            {p.highlight && (
              <Badge>
                <Gem className="size-3" /> Destaque
              </Badge>
            )}
            {p.youth && (
              <Badge variant="success">
                <Sprout className="size-3" /> Base
              </Badge>
            )}
            {lineup?.captainId === p.id && (
              <Badge variant="club">
                <Crown className="size-3" /> Capitão
              </Badge>
            )}
            {lineup?.penaltyTakerId === p.id && (
              <Badge variant="club">
                <Target className="size-3" /> Pênaltis
              </Badge>
            )}
          </div>
        )}
      </div>

      {actions && <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3.5">{actions}</div>}

      {/* (Registros) abas: card × carreira (temporadas, clubes, jogos, gols, assistências) */}
      <div className="px-5 pt-4">
        <Segmented
          id={`pd-tab-${p.id}`}
          label="Seção"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'card', label: 'Atributos' },
            { value: 'carreira', label: 'Carreira' },
          ]}
        />
      </div>
      {tab === 'carreira' ? (
        <CareerTab playerId={p.id} />
      ) : (
      <>
      {/* Atributos de exibição */}
      <section className="px-5 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Atributos</h3>
          <span className="text-[10px] text-fg-subtle" title="Derivados do overall e das características do jogador">
            estimados
          </span>
        </div>
        <div className="space-y-2.5">
          {attrs.map((a, i) => {
            const c = overallColor(a.value);
            return (
              <div key={a.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3">
                <span className={cn('flex items-center gap-1 truncate text-xs', a.boosted ? 'font-semibold text-fg' : 'text-fg-muted')}>
                  {a.label}
                  {a.boosted && <Zap className="size-3 shrink-0 text-club-accent" fill="currentColor" aria-label="bônus de característica" />}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${c} 50%, transparent), ${c})` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${a.value}%` }}
                    transition={{ duration: 0.7, delay: 0.1 + i * 0.05, ease: EASE_OUT }}
                  />
                </div>
                <span className="tabular text-right text-sm font-bold" style={{ color: c }}>
                  {a.value}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Potencial */}
      <section className="px-5 pt-6">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <h3 className="flex items-center gap-1.5 font-semibold tracking-wider text-fg-muted uppercase">
            <TrendingUp className="size-3.5" /> Potencial
          </h3>
          <span className="tabular font-semibold text-fg">
            {p.overall} → <span className="text-club-accent">{p.potential}</span>
            {growth > 0 && <span className="text-success"> (+{growth})</span>}
          </span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-club-accent/30"
            initial={{ width: 0 }}
            animate={{ width: `${p.potential}%` }}
            transition={{ duration: 0.8, delay: 0.2, ease: EASE_OUT }}
          />
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-club-accent"
            initial={{ width: 0 }}
            animate={{ width: `${p.overall}%` }}
            transition={{ duration: 0.8, delay: 0.1, ease: EASE_OUT }}
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5 px-5 pt-6">
        <StatTile label="Valor de mercado" value={fmtMoney(p.value)} />
        <StatTile label="Salário" value={fmtMoney(p.wage)} hint="por mês" />
      </section>

      <section className="px-5 pt-6">
        <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">Características</h3>
        <TraitChips player={p} traits={traits} />
      </section>
      {extra}
      </>
      )}
    </div>
  );
}

/** (Registros) Carreira do jogador: temporada × clube (empréstimos marcados), com a temporada em andamento. */
function CareerTab({ playerId }: { playerId: string }) {
  const world = useWorld();
  const season = useSeason((s) => s.save?.season ?? null);
  const rows = useMemo(() => playerCareer(world, season, playerId).slice().reverse(), [world, season, playerId]);
  const tot = rows.reduce((a, r) => ({ g: a.g + r.games, gl: a.gl + r.goals, as: a.as + r.assists, rt: a.rt + r.rating * r.games }), { g: 0, gl: 0, as: 0, rt: 0 });
  return (
    <section className="px-5 pt-5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
        <History className="size-3.5" /> Carreira na simulação
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum jogo registrado ainda. Jogos, gols e assistências de todas as competições aparecem aqui, temporada a temporada.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] tracking-wider text-fg-subtle uppercase">
              <th className="py-1 text-left font-semibold">Temp.</th>
              <th className="py-1 text-left font-semibold">Clube</th>
              <th className="py-1 text-right font-semibold" title="Jogos">J</th>
              <th className="py-1 text-right font-semibold" title="Gols">G</th>
              <th className="py-1 text-right font-semibold" title="Assistências">A</th>
              <th className="py-1 text-right font-semibold" title="Nota média">Nota</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.season}|${r.clubId}`} className="odd:bg-surface-2/40">
                <td className="tabular py-1 pr-1 font-semibold whitespace-nowrap">
                  {r.season}
                  {r.live && <span className="ml-1 text-[9px] font-bold text-club-accent" title="Temporada em andamento">●</span>}
                </td>
                <td className="py-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ClubCrest id={r.clubId} size={16} />
                    <span className="truncate">{clubLabel(r.clubId, true)}</span>
                    {r.loan && <span className="shrink-0 rounded bg-surface-3 px-1 text-[9px] font-bold text-fg-muted" title="Emprestado">EMP</span>}
                  </span>
                </td>
                <td className="tabular py-1 text-right">{r.games}</td>
                <td className="tabular py-1 text-right font-bold">{r.goals}</td>
                <td className="tabular py-1 text-right">{r.assists}</td>
                <td className="tabular py-1 text-right">{r.rating.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-bold">
              <td className="py-1" colSpan={2}>Total</td>
              <td className="tabular py-1 text-right">{tot.g}</td>
              <td className="tabular py-1 text-right">{tot.gl}</td>
              <td className="tabular py-1 text-right">{tot.as}</td>
              <td className="tabular py-1 text-right">{tot.g ? (tot.rt / tot.g).toFixed(1) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
