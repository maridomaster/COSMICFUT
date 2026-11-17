import { useMemo } from 'react';
import type { Player } from '@cosmicfut/shared';
import type { MatchConfig, MatchEventType, MatchState, Side } from '@cosmicfut/engine';
import {
  ArrowRightLeft, Ban, Clock, CornerDownRight, Crosshair, Flag, Footprints, Hand, Megaphone, ShieldAlert, SlidersHorizontal, Target, Timer, Volleyball, X,
} from 'lucide-react';
import { computeClubTheme, contrastRatio } from '@/lib/color';
import { cn } from '@/lib/utils';
import { CardIcon, InjuryIcon } from '@/components/game/status';

export const PHASE_LABEL: Record<MatchState['phase'], string> = {
  pre: 'Pré-jogo',
  'first-half': '1º tempo',
  'half-time': 'Intervalo',
  'second-half': '2º tempo',
  'extra-time': 'Prorrogação',
  penalties: 'Pênaltis',
  finished: 'Encerrado',
};

export function minuteLabel(minute: number, extra?: number): string {
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

export interface SideTheme {
  primary: string;
  secondary: string;
  accent: string;
  onAccent: string;
}

/** Cores dos dois lados, garantindo que não fiquem parecidas demais (visitante cai na secundária). */
export function useMatchColors(home: { primary: string; secondary: string }, away: { primary: string; secondary: string }): Record<Side, SideTheme> {
  return useMemo(() => {
    const h = computeClubTheme(home);
    const a = computeClubTheme(away);
    const awayMain = contrastRatio(h.primary, a.primary) < 1.5 && contrastRatio(h.primary, a.secondary) > contrastRatio(h.primary, a.primary) ? a.secondary : a.primary;
    return {
      home: { primary: h.primary, secondary: h.secondary, accent: h.accent, onAccent: h.onAccent },
      away: { primary: awayMain, secondary: a.secondary, accent: awayMain, onAccent: computeClubTheme({ primary: awayMain, secondary: a.secondary }).onAccent },
    };
  }, [home.primary, home.secondary, away.primary, away.secondary]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** id → jogador (dos dois elencos da partida). */
export function usePlayerMap(config: MatchConfig | null): Map<string, Player> {
  return useMemo(() => new Map([...(config?.home.players ?? []), ...(config?.away.players ?? [])].map((p) => [p.id, p])), [config]);
}

export function ratingColor(r: number): string {
  if (r >= 8) return '#34d399';
  if (r >= 7) return '#a3e635';
  if (r >= 6.3) return '#e8ecf4';
  if (r >= 5.6) return '#fbbf24';
  return '#f87171';
}

export function RatingChip({ value, className }: { value: number; className?: string }) {
  const c = ratingColor(value);
  return (
    <span
      className={cn('tabular inline-flex h-5 min-w-8 items-center justify-center rounded-md px-1 text-[11px] font-extrabold', className)}
      style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} 35%, transparent)` }}
    >
      {value.toFixed(1)}
    </span>
  );
}

/** Ícone por tipo de evento da narração. */
export function EventIcon({ type, className }: { type: MatchEventType; className?: string }) {
  const cls = cn('size-4', className);
  switch (type) {
    case 'goal':
    case 'own-goal':
      return <Volleyball className={cls} />;
    case 'yellow':
      return <CardIcon color="yellow" />;
    case 'red':
    case 'second-yellow':
      return <CardIcon color="red" />;
    case 'injury':
      return <InjuryIcon />;
    case 'substitution':
      return <ArrowRightLeft className={cls} />;
    case 'save':
      return <Hand className={cls} />;
    case 'chance':
    case 'shot':
    case 'shot-on-target':
      return <Crosshair className={cls} />;
    case 'woodwork':
      return <ShieldAlert className={cls} />;
    case 'corner':
      return <CornerDownRight className={cls} />;
    case 'offside':
      return <Flag className={cls} />;
    case 'foul':
      return <Footprints className={cls} />;
    case 'penalty-awarded':
    case 'penalties':
    case 'penalty-shootout-kick':
      return <Target className={cls} />;
    case 'penalty-missed':
      return <X className={cls} />;
    case 'kickoff':
    case 'second-half':
    case 'extra-time':
      return <Timer className={cls} />;
    case 'half-time':
    case 'full-time':
      return <Clock className={cls} />;
    case 'tactic-change':
      return <SlidersHorizontal className={cls} />;
    case 'commentary':
      return <Megaphone className={cls} />;
    default:
      return <Ban className={cls} />;
  }
}
