/** Monta o MatchConfig do Match Day a partir da temporada + tática/escalação do humano. */
import type { Player } from '@cosmicfut/shared';
import { autoPickLineup, buildTeamInput, fixtureMatchRules, type Fixture, type Lineup, type MatchConfig, type SeasonState, type Side, type Tactic } from '@cosmicfut/engine';
import { squads } from '@/data/squads';

/** Escalação do humano é jogável com os disponíveis? (11 titulares disponíveis, sem repetição). */
export function lineupIssues(lineup: Lineup | null, available: Player[]): string[] {
  if (!lineup) return ['Sem escalação definida'];
  const ids = new Set(available.map((p) => p.id));
  const out: string[] = [];
  const missing = lineup.starters.filter((id) => !ids.has(id));
  if (lineup.starters.length !== 11) out.push(`Escalação incompleta (${lineup.starters.length}/11)`);
  if (missing.length) out.push(`${missing.length} titular(es) lesionado(s) ou suspenso(s)`);
  if (new Set(lineup.starters).size !== lineup.starters.length) out.push('Jogador repetido na escalação');
  return out;
}

/** Remove indisponíveis do banco; se os titulares não fecham, cai no autoPick (sem indisponíveis). */
export function playableLineup(lineup: Lineup | null, available: Player[], tactic: Tactic, fitness?: Record<string, number>): { lineup: Lineup; auto: boolean } {
  if (lineup && lineupIssues(lineup, available).length === 0) {
    const ids = new Set(available.map((p) => p.id));
    const starters = new Set(lineup.starters);
    return { lineup: { ...lineup, bench: lineup.bench.filter((id) => ids.has(id) && !starters.has(id)).slice(0, 9) }, auto: false };
  }
  return { lineup: autoPickLineup(available, tactic, undefined, { fitness }), auto: true };
}

export interface MatchSetup {
  config: MatchConfig;
  humanSide: Side;
  autoLineup: boolean;
}

export function buildMatchSetup(state: SeasonState, fixture: Fixture, humanId: string, tactic: Tactic, lineup: Lineup | null): MatchSetup {
  const humanSide: Side = fixture.homeId === humanId ? 'home' : 'away';
  const home = buildTeamInput(state, fixture.homeId, squads(fixture.homeId), true, fixture);
  const away = buildTeamInput(state, fixture.awayId, squads(fixture.awayId), false);
  const human = humanSide === 'home' ? home : away;
  // buildTeamInput já filtrou lesionados/suspensos em `players`
  const pick = playableLineup(lineup, human.players, tactic, human.fitness);
  const humanInput = { ...human, tactic: { ...tactic }, lineup: pick.lineup, control: 'human' as const };
  const aiInput = { ...(humanSide === 'home' ? away : home), control: 'ai' as const };
  return {
    config: {
      seed: `${fixture.id}:${state.season}`,
      home: humanSide === 'home' ? humanInput : aiInput,
      away: humanSide === 'away' ? humanInput : aiInput,
      // mata-mata (Fase 1): pênaltis/prorrogação/agregado conforme o formato da competição
      ...fixtureMatchRules(state, fixture),
    },
    humanSide,
    autoLineup: pick.auto,
  };
}
