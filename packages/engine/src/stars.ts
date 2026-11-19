/**
 * (18/11) Estrelas dos jogadores, pelo overall ATUAL (vale para todos, inclusive quem evolui na carreira):
 *  - ESTRELA VERMELHA — TOP MUNDIAL (overall 91+)
 *  - ESTRELA AMARELA — DESTAQUE (overall 88–90)
 *
 * Efeitos (vermelha / amarela):
 *  - valor de mercado +20% / +10%;
 *  - "status" na partida +10% / +5% (overall efetivo no jogo, até 99);
 *  - meio-campo e ataque: +10% / +5% na conversão das finalizações;
 *  - defesa (goleiro, zagueiro, lateral): menos cartões (amarelo e vermelho ×0,6 / ×0,8), nota melhor (+0,3 / +0,15)
 *    e cansa menos (desgaste ×0,85 / ×0,92 — joga mais minutos antes de ser substituído).
 */
import type { Player, Position } from '@cosmicfut/shared';

export type StarTier = 'top' | 'highlight';

export const STARS = {
  topMin: 91,
  highlightMin: 88,
  value: { top: 1.2, highlight: 1.1 },
  status: { top: 0.1, highlight: 0.05 },
  goal: { top: 0.1, highlight: 0.05 },
  cards: { top: 0.6, highlight: 0.8 },
  rating: { top: 0.3, highlight: 0.15 },
  drain: { top: 0.85, highlight: 0.92 },
  label: { top: 'Top Mundial', highlight: 'Destaque' },
} as const;

/** Estrela do jogador pelo overall atual (null = sem estrela). */
export function starTier(p: Pick<Player, 'overall'>): StarTier | null {
  return p.overall >= STARS.topMin ? 'top' : p.overall >= STARS.highlightMin ? 'highlight' : null;
}

export const isDefensive = (pos: Position) => pos === 'GK' || pos === 'CB' || pos === 'FB';
export const isAttacking = (pos: Position) => pos === 'MF' || pos === 'FW';

/** Multiplicador do valor de mercado pela estrela. */
export function starValueMult(p: Pick<Player, 'overall'>): number {
  const t = starTier(p);
  return t ? STARS.value[t] : 1;
}

/** Overall efetivo na partida (status +10% / +5%, até 99). */
export function matchOverall(p: Pick<Player, 'overall'>): number {
  const t = starTier(p);
  return t ? Math.min(99, Math.round(p.overall * (1 + STARS.status[t]))) : p.overall;
}
