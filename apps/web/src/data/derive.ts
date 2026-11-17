import type { Player, Position } from '@cosmicfut/shared';
import { POSITION_ORDER } from '@/lib/format';

export interface SquadSummary {
  size: number;
  avgOverall: number;
  avgAge: number;
  top: Player[];
  byPosition: Record<Position, number>;
  wageBill: number; // mensal
  squadValue: number;
}

export function summarizeSquad(players: Player[]): SquadSummary {
  const size = players.length || 1;
  const byPosition = Object.fromEntries(POSITION_ORDER.map((p) => [p, 0])) as Record<Position, number>;
  let ovr = 0;
  let age = 0;
  let wage = 0;
  let value = 0;
  for (const p of players) {
    byPosition[p.position]++;
    ovr += p.overall;
    age += p.age;
    wage += p.wage;
    value += p.value;
  }
  return {
    size: players.length,
    avgOverall: ovr / size,
    avgAge: age / size,
    top: [...players].sort((a, b) => b.overall - a.overall).slice(0, 5),
    byPosition,
    wageBill: wage,
    squadValue: value,
  };
}
