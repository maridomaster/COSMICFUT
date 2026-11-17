/**
 * (Etapa 1) Utilitários de teste para a linha do tempo global: dados reais de apps/web/public/data e um laço que
 * avança a carreira fazendo as viradas automáticas (sem humanos) até a virada do humano (seasonOver) ou uma data.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { advanceDay } from '../src/season/season';
import { scopeNamePoolCodes, seasonOver, squadsFromMarket, worldSquads } from '../src/season/career';
import { nextSeason, type RolloverOptions } from '../src/season/rollover';
import { autoTurnoverDue, turnoverDue } from '../src/season/timeline';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA = resolve(here, '../../../apps/web/public/data');
export const rj = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

export function loadData(): CareerData {
  return {
    clubs: rj('clubs-index.json'), leagues: rj('leagues.json'), states: rj('states.json'), formats: rj('formats.json'),
    competitions: rj('competitions.json'), calendars: rj('calendars.json'), economy: rj('economy.json'), countries: rj('countries.json'),
  };
}

export function loadBase(): (id: string) => Player[] {
  const pm = squadsFromMarket(rj('players-market.json'));
  return (id) => pm.get(id) ?? [];
}

/** Pools de nomes de todos os países em escopo (viradas automáticas geram juniores de qualquer região). */
export function loadPools(data: CareerData): Record<string, NamePool> {
  const out: Record<string, NamePool> = {};
  for (const c of scopeNamePoolCodes(data)) {
    try { out[c] = rj(`names/${c}.json`); } catch { /* sem pool: nomes genéricos */ }
  }
  return out;
}

export interface AutoTurnover {
  /** SeasonState/WorldState imediatamente antes da virada */
  before: SeasonState;
  worldBefore: WorldState;
  summary: SeasonSummary;
  after: SeasonState;
  world: WorldState;
}

/**
 * Avança (inPlace) até a virada do humano (`seasonOver`) ou até `until` (exclusive). Viradas sem humanos são feitas
 * automaticamente (`nextSeason` sem renovações) e registradas em `autos`.
 */
export function runCareer(
  world: WorldState, state: SeasonState, base: (id: string) => Player[], data: CareerData, pools: Record<string, NamePool>,
  o: { until?: string; renewAuto?: RolloverOptions } = {},
): { world: WorldState; state: SeasonState; autos: AutoTurnover[] } {
  const autos: AutoTurnover[] = [];
  let sq = worldSquads(world, base);
  const until = o.until ?? '9999-12-31';
  while (state.date < until) {
    if (turnoverDue(state)) {
      if (!autoTurnoverDue(state)) break;
      const before = JSON.parse(JSON.stringify(state)) as SeasonState;
      const r = nextSeason(world, state, base, data, pools, o.renewAuto ?? {});
      // `after` é uma cópia: o laço continua avançando `state` no lugar
      autos.push({ before, worldBefore: world, summary: r.summary, after: JSON.parse(JSON.stringify(r.state)) as SeasonState, world: r.world });
      world = r.world;
      state = r.state;
      sq = worldSquads(world, base);
      continue;
    }
    if (seasonOver(state)) break;
    state = advanceDay(state, sq, {}, { inPlace: true }).state;
  }
  return { world, state, autos };
}
