import { forwardRef, useState } from 'react';
import type React from 'react';
import { motion } from 'motion/react';
import type { Player } from '@cosmicfut/shared';
import { detectRole, improvisation, slotFit, ZONE_BOUNDS, type FormationSlot, type Lineup, type SlotPos } from '@cosmicfut/engine';
import { StaminaBar } from '@/components/game/StaminaBar';
import { FIT_META, fitLevel, ROLE_LABEL, shortName } from '@/lib/lineup';
import { cn } from '@/lib/utils';
import { cardTierMeta } from '@/lib/format';
import { CardIcon, InjuryIcon, type PlayerStatus } from '@/components/game/status';
import type { useDragSwap } from './useDragSwap';

type Dnd = ReturnType<typeof useDragSwap>;

/** Posição normalizada do slot → % no campo (gol próprio embaixo). */
export const slotLeft = (x: number) => 8 + x * 84;
export const slotTop = (y: number) => 94 - y * 86;
/** Inverso: ponto (% do campo) → posição normalizada do slot. */
export const pitchToSlot = (leftPct: number, topPct: number) => ({ x: (leftPct - 8) / 84, y: (94 - topPct) / 86 });

/**
 * (Táticas) pontos de encaixe do arrasto: 5 corredores × 5 linhas. Cada ponto cai numa zona tática
 * (detectRole); ao soltar, o jogador encaixa no ponto mais próximo.
 */
const SPOT_X = [0.12, 0.32, 0.5, 0.68, 0.88] as const;
const SPOT_Y = [0.24, 0.39, 0.52, 0.66, 0.82] as const;
export const DROP_SPOTS: readonly SlotPos[] = SPOT_Y.flatMap((y) => SPOT_X.map((x) => ({ x, y })));
const GK_SPOT: SlotPos = { x: 0.5, y: 0.06 };

/** Ponto de encaixe mais próximo de uma posição normalizada (distância no campo real 68×88). */
export function snapToSpot(pos: SlotPos): SlotPos {
  let best = DROP_SPOTS[0];
  let bd = Infinity;
  for (const s of DROP_SPOTS) {
    const d = Math.hypot((s.x - pos.x) * 68, (s.y - pos.y) * 88);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

const sameSpot = (a: SlotPos | null | undefined, b: SlotPos) => !!a && Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02;

/** Cor do ponto pela penalidade de improviso do jogador arrastado naquela zona. */
function spotTone(penalty: number) {
  if (penalty <= 0) return { color: '#22c55e', label: 'Posição ideal' };
  if (penalty <= 5) return { color: '#a3e635', label: 'Adaptado' };
  if (penalty <= 12) return { color: '#f97316', label: 'Improvisado' };
  return { color: '#ef4444', label: 'Fora de posição' };
}

/** (Táticas) círculos onde o jogador pode ser solto, coloridos pelo rendimento dele em cada ponto. */
function DropSpots({ player, hover: dragHover, occupied, onPick }: { player: Player; hover: SlotPos | null; occupied: readonly SlotPos[]; onPick?: (pos: SlotPos) => void }) {
  // modo clique: o jogador está selecionado e o técnico toca no círculo de destino
  const [pickHover, setPickHover] = useState<SlotPos | null>(null);
  const hover = onPick ? pickHover : dragHover;
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden={!onPick} data-testid="drop-spots">
      {/* área do goleiro: proibida para jogador de linha */}
      <div
        className="absolute grid -translate-1/2 place-items-center rounded-full border-2 border-dashed border-red-500/70 bg-red-500/15 text-red-300"
        style={{ left: `${slotLeft(GK_SPOT.x)}%`, top: `${slotTop(GK_SPOT.y)}%`, width: '3.2rem', height: '3.2rem' }}
        title="Só o goleiro"
      >
        <span className="text-lg leading-none font-black">✕</span>
      </div>
      {DROP_SPOTS.map((s) => {
        const role = detectRole(s.x, s.y);
        const pen = improvisation(player, { role, x: s.x, y: s.y, natural: [] }).penalty;
        const tone = spotTone(pen);
        const isHover = sameSpot(hover, s);
        const taken = occupied.some((o) => Math.hypot((o.x - s.x) * 68, (o.y - s.y) * 88) < 4);
        // ocupado: deixa o clique passar para o jogador que está ali (troca)
        const clickable = !!onPick && !taken;
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={`${s.x}-${s.y}`}
            {...(clickable
              ? {
                  type: 'button' as const,
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    onPick!(s);
                  },
                  onPointerEnter: () => setPickHover(s),
                  onPointerLeave: () => setPickHover((h) => (h && sameSpot(h, s) ? null : h)),
                  'aria-label': `Mover para ${ROLE_LABEL[role]} (${tone.label}${pen > 0 ? `, −${pen}` : ''})`,
                  'data-testid': 'move-spot',
                }
              : {})}
            className={cn(
              'absolute flex -translate-1/2 flex-col items-center justify-center rounded-full border-2 transition-transform duration-100',
              clickable && 'pointer-events-auto cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white',
            )}
            style={{
              left: `${slotLeft(s.x)}%`,
              top: `${slotTop(s.y)}%`,
              width: '2.6rem',
              height: '2.6rem',
              borderColor: tone.color,
              borderStyle: taken ? 'dashed' : 'solid',
              background: `color-mix(in oklab, ${tone.color} ${isHover ? 45 : 18}%, transparent)`,
              transform: `translate(-50%, -50%) scale(${isHover ? 1.25 : 1})`,
              boxShadow: isHover ? `0 0 0 3px #fff, 0 0 18px ${tone.color}` : undefined,
              opacity: taken && !isHover ? 0.55 : 1,
            }}
            title={`${ROLE_LABEL[role]} · ${tone.label}${pen > 0 ? ` (−${pen})` : ''}`}
          >
            <span className="text-[10px] leading-none font-black text-white drop-shadow">{ROLE_LABEL[role]}</span>
            {pen > 0 && <span className="mt-0.5 text-[9px] leading-none font-bold text-white/90">−{pen}</span>}
          </Tag>
        );
      })}
      {onPick && !hover && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-2 py-1 text-center text-[11px] font-semibold whitespace-nowrap text-white">
          {shortName(player.name)}: toque num círculo para mover · noutro jogador para trocar
        </div>
      )}
      {hover && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-2 py-1 text-[11px] font-semibold text-white">
          {(() => {
            const role = detectRole(hover.x, hover.y);
            const pen = improvisation(player, { role, x: hover.x, y: hover.y, natural: [] }).penalty;
            return `${shortName(player.name)} → ${ROLE_LABEL[role]} · ${spotTone(pen).label}${pen > 0 ? ` −${pen}` : ''}`;
          })()}
        </div>
      )}
      <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-2 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
        {[
          ['#22c55e', 'Ideal'],
          ['#a3e635', 'Adaptado'],
          ['#f97316', 'Improvisado'],
          ['#ef4444', 'Fora'],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** (Táticas) grade das zonas, visível durante o arrasto. */
function ZoneGrid() {
  const B = ZONE_BOUNDS;
  const rows = [B.gk, B.def, B.wingBack, B.mid, B.attMid];
  const line = 'absolute border-white/25';
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {rows.map((y) => (
        <div key={y} className={`${line} border-t border-dashed`} style={{ left: '2%', right: '2%', top: `${slotTop(y)}%` }} />
      ))}
      {[B.wide, 1 - B.wide].map((x) => (
        <div key={x} className={`${line} border-l border-dashed`} style={{ top: `${slotTop(B.attMid)}%`, bottom: `${100 - slotTop(B.gk)}%`, left: `${slotLeft(x)}%` }} />
      ))}
      {[B.wideAtt, 1 - B.wideAtt].map((x) => (
        <div key={x} className={`${line} border-l border-dashed`} style={{ top: '2%', bottom: `${100 - slotTop(B.attMid)}%`, left: `${slotLeft(x)}%` }} />
      ))}
    </div>
  );
}

/** Gramado estilizado (proporção 68×88: campo levemente encurtado para caber na tela). */
function PitchSurface() {
  const line = { stroke: 'rgb(255 255 255 / 0.32)', strokeWidth: 1.4, fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
  return (
    <>
      {/* grama + listras + brilho do clube */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(70% 45% at 50% 0%, color-mix(in oklab, var(--club-primary) 30%, transparent), transparent 70%)',
            'radial-gradient(60% 40% at 50% 100%, color-mix(in oklab, var(--club-secondary) 18%, transparent), transparent 70%)',
            'repeating-linear-gradient(180deg, rgb(255 255 255 / 0.035) 0 8.33%, transparent 8.33% 16.66%)',
            'linear-gradient(180deg, #0f3b2b 0%, #0c3324 50%, #0f3b2b 100%)',
          ].join(','),
        }}
      />
      <div className="absolute inset-0 shadow-[inset_0_0_80px_rgb(0_0_0/0.55)]" />
      <svg viewBox="0 0 68 88" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        <rect x="1.5" y="1.5" width="65" height="85" {...line} />
        <line x1="1.5" y1="44" x2="66.5" y2="44" {...line} />
        <ellipse cx="34" cy="44" rx="9.15" ry="9.15" {...line} />
        <circle cx="34" cy="44" r="0.6" fill="rgb(255 255 255 / 0.4)" />
        {/* área do gol próprio (embaixo) */}
        <rect x="13.84" y="70" width="40.32" height="16.5" {...line} />
        <rect x="24.84" y="81" width="18.32" height="5.5" {...line} />
        <circle cx="34" cy="75.5" r="0.5" fill="rgb(255 255 255 / 0.4)" />
        <path d="M 26.69 70 A 9.15 9.15 0 0 1 41.31 70" {...line} />
        <rect x="30.34" y="86.5" width="7.32" height="1.2" {...line} />
        {/* área adversária (em cima) */}
        <rect x="13.84" y="1.5" width="40.32" height="16.5" {...line} />
        <rect x="24.84" y="1.5" width="18.32" height="5.5" {...line} />
        <circle cx="34" cy="12.5" r="0.5" fill="rgb(255 255 255 / 0.4)" />
        <path d="M 26.69 18 A 9.15 9.15 0 0 0 41.31 18" {...line} />
        <rect x="30.34" y="0.3" width="7.32" height="1.2" {...line} />
        {/* escanteios */}
        <path d="M 1.5 2.5 A 1 1 0 0 0 2.5 1.5" {...line} />
        <path d="M 65.5 1.5 A 1 1 0 0 0 66.5 2.5" {...line} />
        <path d="M 1.5 85.5 A 1 1 0 0 1 2.5 86.5" {...line} />
        <path d="M 65.5 86.5 A 1 1 0 0 1 66.5 85.5" {...line} />
      </svg>
    </>
  );
}

export const Pitch = forwardRef<HTMLDivElement, {
  slots: readonly FormationSlot[];
  lineup: Lineup | null;
  byId: Map<string, Player>;
  dnd: Dnd;
  selectedId: string | null;
  status?: Map<string, PlayerStatus>;
  /** condição física 0..100 por jogador */
  fitness?: Record<string, number>;
  /** slots movidos pelo técnico (formação personalizada) */
  moved?: ReadonlySet<number>;
  /** ponto de encaixe sob o ponteiro durante o arrasto */
  hoverSpot?: SlotPos | null;
  /** (Táticas) modo clique: titular selecionado → tocar num círculo move o jogador para lá */
  onMoveSelected?: (pos: SlotPos) => void;
}>(function Pitch({ slots, lineup, byId, dnd, selectedId, status, fitness, moved, hoverSpot, onMoveSelected }, ref) {
  const dragIdx = dnd.dragId && lineup ? lineup.starters.indexOf(dnd.dragId) : -1;
  const dragging = dragIdx >= 0;
  // sem arrasto: o titular selecionado (por clique) também mostra os círculos, agora clicáveis
  const selIdx = !dragging && selectedId && lineup && onMoveSelected ? lineup.starters.indexOf(selectedId) : -1;
  const dragIndex = dragging ? dragIdx : selIdx;
  const dragPlayer = dragIndex >= 0 ? byId.get(lineup!.starters[dragIndex]) : undefined;
  const picking = !dragging && selIdx >= 0;
  const showSpots = !!dragPlayer && slots[dragIndex]?.role !== 'GK';
  const occupied = showSpots ? slots.filter((_, i) => i !== dragIndex).map((s) => ({ x: s.x, y: s.y })) : [];
  return (
    <div
      ref={ref}
      data-drop-zone="pitch"
      data-testid="tactics-pitch"
      className="relative mx-auto aspect-[68/88] w-full max-w-[560px] overflow-hidden rounded-xl border border-white/10 select-none lg:max-w-[min(560px,calc((100dvh_-_var(--topbar-h)_-_17rem)_*_0.7727))]"
      style={{ boxShadow: '0 0 0 1px rgb(0 0 0 / 0.4), 0 24px 60px -30px color-mix(in oklab, var(--club-primary) 70%, transparent)' }}
    >
      <PitchSurface />
      {dragging && !showSpots && <ZoneGrid />}
      {showSpots && <DropSpots player={dragPlayer!} hover={hoverSpot ?? null} occupied={occupied} onPick={picking ? onMoveSelected : undefined} />}
      {/* rótulos fantasmas dos slots (aparecem se faltar jogador) */}
      {slots.map((slot, i) =>
        lineup?.starters[i] && byId.get(lineup.starters[i]) ? null : (
          <div
            key={`empty-${i}`}
            className="absolute grid size-11 -translate-1/2 place-items-center rounded-full border-2 border-dashed border-white/30 text-[10px] font-bold text-white/60"
            style={{ left: `${slotLeft(slot.x)}%`, top: `${slotTop(slot.y)}%` }}
          >
            {ROLE_LABEL[slot.role]}
          </div>
        ),
      )}
      {lineup &&
        slots.map((slot, i) => {
          const p = byId.get(lineup.starters[i]);
          if (!p) return null;
          return (
            <PitchToken
              key={p.id}
              player={p}
              slot={slot}
              dnd={dnd}
              selected={selectedId === p.id}
              captain={lineup.captainId === p.id}
              penalty={lineup.penaltyTakerId === p.id}
              status={status?.get(p.id)}
              fitness={fitness?.[p.id]}
              moved={!!moved?.has(i)}
              dimmed={showSpots && i !== dragIndex}
            />
          );
        })}
    </div>
  );
});

function PitchToken({
  player: p,
  slot,
  dnd,
  selected,
  captain,
  penalty,
  status,
  fitness,
  moved,
  dimmed,
}: {
  dimmed?: boolean;
  player: Player;
  slot: FormationSlot;
  dnd: Dnd;
  selected: boolean;
  captain: boolean;
  penalty: boolean;
  status?: PlayerStatus;
  fitness?: number;
  moved?: boolean;
}) {
  const fit = slotFit(p, slot);
  const imp = improvisation(p, slot);
  const level = fitLevel(fit);
  const ring = FIT_META[level].color;
  const dragging = dnd.dragId === p.id;
  const over = dnd.isOver({ kind: 'player', id: p.id });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: dragging ? 0.35 : dimmed && !over ? 0.3 : 1, scale: over ? 1.14 : 1 }}
      transition={{ layout: { type: 'spring', stiffness: 260, damping: 28 }, default: { duration: 0.2 } }}
      className="absolute z-10 size-0"
      style={{ left: `${slotLeft(slot.x)}%`, top: `${slotTop(slot.y)}%` }}
    >
      <button
        type="button"
        {...dnd.bind(p.id)}
        data-drop-id={p.id}
        aria-pressed={selected}
        aria-label={`${p.name}, ${ROLE_LABEL[slot.role]}, overall ${p.overall}, ${FIT_META[level].label}`}
        className="group absolute top-0 left-0 flex w-[5rem] -translate-x-1/2 -translate-y-[1.35rem] cursor-grab touch-none flex-col items-center outline-none active:cursor-grabbing sm:w-[5.75rem] sm:-translate-y-6"
      >
        <span className="relative">
          {/* anel de adequação */}
          <span
            className={cn(
              'relative grid size-11 place-items-center rounded-full p-[2.5px] transition-shadow sm:size-12',
              selected && 'animate-pulse',
            )}
            style={{
              background: `conic-gradient(${ring} ${Math.round(fit * 360)}deg, color-mix(in oklab, ${ring} 25%, transparent) 0)`,
              boxShadow: selected
                ? `0 0 0 3px var(--club-accent), 0 0 22px 4px color-mix(in oklab, var(--club-accent) 60%, transparent)`
                : over
                  ? '0 0 0 3px #fff, 0 0 20px rgb(255 255 255 / 0.5)'
                  : `0 6px 16px -6px rgb(0 0 0 / 0.8), 0 0 14px -4px ${ring}`,
            }}
          >
            <span className="grid size-full place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,color-mix(in_oklab,var(--club-primary)_70%,#1c2433),#0b0f17_85%)] group-focus-visible:ring-2 group-focus-visible:ring-white">
              <span className="tabular text-[15px] leading-none font-black sm:text-base" style={{ color: cardTierMeta(p.overall).text }} title={`Carta ${cardTierMeta(p.overall).label}`}>
                {p.overall}
              </span>
            </span>
          </span>
          {captain && (
            <span className="absolute -top-1 -right-1.5 grid size-[18px] place-items-center rounded-full bg-club-accent text-[10px] font-black text-club-on-accent ring-2 ring-[#0c3324]" title="Capitão">
              C
            </span>
          )}
          {!!status?.injury && <InjuryIcon className="absolute -bottom-1 -left-1.5 ring-2 ring-[#0c3324]" title={`Lesionado — ${status.injury} ${status.injury === 1 ? 'dia' : 'dias'}`} />}
          {!!status?.suspension && <CardIcon color="red" className="absolute -right-1 -bottom-1 ring-2 ring-[#0c3324]" title={`Suspenso — ${status.suspension} ${status.suspension === 1 ? 'jogo' : 'jogos'}`} />}
          {penalty && (
            <span className="absolute -top-1 -left-1.5 grid size-[18px] place-items-center rounded-full bg-fg text-[10px] font-black text-bg ring-2 ring-[#0c3324]" title="Batedor de pênalti">
              P
            </span>
          )}
        </span>
        <span className="mt-1 max-w-full truncate rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight font-semibold text-white backdrop-blur-sm sm:text-[11px]">
          {shortName(p.name)}
        </span>
        <StaminaBar value={fitness ?? status?.fitness ?? 100} className="mt-0.5 w-10 sm:w-12" />
        <span className="mt-0.5 flex items-center gap-1 text-[9px] leading-none font-bold tracking-wider" style={{ color: ring }}>
          <span className={cn('hidden sm:inline', moved && 'underline decoration-dotted underline-offset-2')} title={moved ? 'Posição personalizada' : undefined}>
            {ROLE_LABEL[slot.role]}
          </span>
          {imp.penalty > 0 && (
            <span className="rounded bg-black/70 px-1 py-px text-[9px] text-white" title={`Improvisado: −${imp.penalty} de overall nesta posição`} data-testid="improv-badge">
              −{imp.penalty}
            </span>
          )}
        </span>
      </button>
    </motion.div>
  );
}
