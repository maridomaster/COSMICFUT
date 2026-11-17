/**
 * Partes PÚBLICAS de uma partida ao vivo. O MatchConfig em si é montado no simulador
 * (sim-core.ts → careerMatchConfig: elencos da carreira + fixtureMatchRules), fora do thread principal.
 */
import type { Fixture, MatchConfig } from '@cosmicfut/engine';
import type { NetFixtureInfo } from '@cosmicfut/shared';

/** Config enviada ao cliente: elencos reduzidos aos relacionados (titulares + banco) + regras do mata-mata. */
export function publicConfig(cfg: MatchConfig): unknown {
  const team = (t: MatchConfig['home']) => {
    const ids = new Set([...t.lineup.starters, ...t.lineup.bench]);
    return { ...t, players: t.players.filter((p) => ids.has(p.id)) };
  };
  return {
    seed: cfg.seed,
    knockout: cfg.knockout ?? false,
    extraTime: cfg.extraTime ?? (cfg.knockout ? true : false),
    ...(cfg.aggregate ? { aggregate: { ...cfg.aggregate } } : {}),
    maxSubs: cfg.maxSubs ?? 5,
    home: team(cfg.home),
    away: team(cfg.away),
  };
}

export function fixtureInfo(f: Fixture): NetFixtureInfo {
  const out: NetFixtureInfo = { id: f.id, competitionId: f.competitionId, round: f.round, date: f.date, homeId: f.homeId, awayId: f.awayId };
  if (f.stageId !== undefined) out.stageId = f.stageId;
  if (f.label !== undefined) out.label = f.label;
  if (f.leg !== undefined) out.leg = f.leg;
  if (f.tieId !== undefined) out.tieId = f.tieId;
  if (f.knockout !== undefined) out.knockout = f.knockout;
  if (f.extraTime !== undefined) out.extraTime = f.extraTime;
  if (f.neutral !== undefined) out.neutral = f.neutral;
  return out;
}
