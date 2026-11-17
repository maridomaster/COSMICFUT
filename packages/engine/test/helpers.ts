import type { Player, Position } from '@cosmicfut/shared';
import { Rng } from '../src/rng';
import { autoPickLineup, DEFAULT_TACTIC } from '../src/tactics';
import type { MatchConfig, MatchTeamInput } from '../src/contract';

const SHAPE: Position[] = ['GK', 'GK', 'FB', 'FB', 'FB', 'FB', 'CB', 'CB', 'CB', 'CB', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW', 'FW', 'MF'];

/** elenco sintético determinístico (22 jogadores) */
export function makeSquad(clubId: string, base = 75): Player[] {
  const r = new Rng('squad:' + clubId);
  return SHAPE.map((position, i) => ({
    id: `${clubId}:${i}`,
    name: `${clubId.toUpperCase()} Jogador ${i}`,
    position,
    age: 20 + r.int(0, 13),
    nationalityId: 29,
    side: r.chance(0.5) ? 'L' : 'R',
    traits: position === 'GK' ? [r.int(0, 3)] : [r.int(4, 13), r.int(4, 13)],
    star: false,
    highlight: false,
    worldClass: false,
    overall: base + r.int(-6, 6) - (i % 2 === 1 ? 4 : 0),
    potential: base + 5,
    wage: 10000 + r.int(0, 20000),
    value: 1_000_000,
    youth: false,
    tmId: null,
  }));
}

export function team(clubId: string, isHome: boolean, base = 75, control: 'ai' | 'human' = 'ai'): MatchTeamInput {
  const players = makeSquad(clubId, base);
  return {
    clubId, name: clubId, players, lineup: autoPickLineup(players, DEFAULT_TACTIC),
    tactic: { ...DEFAULT_TACTIC }, isHome, control, morale: 50,
  };
}

export function config(seed: string, opts: Partial<MatchConfig> = {}, control: 'ai' | 'human' = 'ai'): MatchConfig {
  return { seed, home: team('casa', true, 76, control), away: team('fora', false, 74, control), ...opts };
}
