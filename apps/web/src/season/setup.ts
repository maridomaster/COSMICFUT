/**
 * Criação da temporada real a partir dos dados (leagues.json, calendars.json, ClubBundles).
 */
import type { ClubBundle, Division } from '@cosmicfut/shared';
import { createSeason, ensureMarket, type ClubEconomyInfo, type SeasonState } from '@cosmicfut/engine';
import { loadCalendars, loadLeagues } from '@/data/source';
import { baseSquadOf, cachedBundle, ensureBundles } from '@/data/squads';

export const SEASON_YEAR = 2026;
export const SEASON_START = '2026-01-18';
/** Ligas maiores que isso (ex.: BRA-4 com 96 clubes em grupos) não são suportadas nesta versão. */
export const MAX_LEAGUE_CLUBS = 40;
/** Quantas divisões do mesmo país simular junto com a do clube humano. */
export const MAX_DIVISIONS = 4;

export function isLeagueSupported(d: Division | undefined): d is Division {
  return !!d && d.clubIds.length >= 2 && d.clubIds.length <= MAX_LEAGUE_CLUBS;
}

/** Divisão do humano + as mais próximas (por número) do mesmo país, até MAX_DIVISIONS. */
export function pickDivisions(all: Division[], human: Division, max = MAX_DIVISIONS): Division[] {
  const taken = new Set(human.clubIds);
  const others = all
    .filter((d) => d.countryId === human.countryId && d.id !== human.id && isLeagueSupported(d))
    .sort((a, b) => Math.abs(a.division - human.division) - Math.abs(b.division - human.division) || a.division - b.division);
  const out = [human];
  for (const d of others) {
    if (out.length >= max) break;
    // um clube não pode estar em duas divisões da mesma temporada
    if (d.clubIds.some((id) => taken.has(id))) continue;
    d.clubIds.forEach((id) => taken.add(id));
    out.push(d);
  }
  return out.sort((a, b) => a.division - b.division);
}

export function competitionName(d: Division): string {
  return `${d.name} · ${d.divisionName}`;
}

export interface SeasonBuildProgress {
  stage: 'dados' | 'elencos' | 'calendário';
  done: number;
  total: number;
}

export class UnsupportedClubError extends Error {
  constructor(public readonly clubName: string) {
    super(`${clubName} não disputa uma liga nacional nesta versão`);
  }
}

export async function buildSeason(
  human: ClubBundle,
  seed: string,
  onProgress?: (p: SeasonBuildProgress) => void,
): Promise<SeasonState> {
  onProgress?.({ stage: 'dados', done: 0, total: 1 });
  const [{ data: leagues }, calendars] = await Promise.all([loadLeagues(), loadCalendars().catch(() => ({ data: [] }))]);
  const division = leagues.find((d) => d.id === human.club.leagueId && d.clubIds.includes(human.club.id));
  if (!isLeagueSupported(division)) throw new UnsupportedClubError(human.club.name);

  const divisions = pickDivisions(leagues, division);
  const ids = divisions.flatMap((d) => d.clubIds);
  await ensureBundles(ids, (done, total) => onProgress?.({ stage: 'elencos', done, total }));
  onProgress?.({ stage: 'calendário', done: 0, total: 1 });

  const clubInfo: Record<string, ClubEconomyInfo> = {};
  const clubBalances: Record<string, number> = {};
  for (const d of divisions) {
    for (const id of d.clubIds) {
      const club = cachedBundle(id)?.club;
      clubInfo[id] = {
        name: club?.name ?? id,
        capacity: club?.stadium.capacity,
        reputation: club?.reputation,
        sponsorPerSeason: club?.finances.sponsorPerSeason,
        division: d.division,
      };
      clubBalances[id] = club?.finances.balance ?? 0;
    }
  }

  const nacional = calendars.data.find((c) => c.id === 'nacional');
  const season = createSeason({
    season: SEASON_YEAR,
    startDate: SEASON_START,
    divisions: divisions.map((d) => ({
      id: d.id,
      name: competitionName(d),
      clubIds: d.clubIds,
      doubleRound: d.doubleRound,
      relegated: d.relegated,
      promoted: d.promoted,
    })),
    calendarDates: nacional?.dates,
    humanClubIds: [human.club.id],
    clubBalances,
    seed,
    clubInfo,
  });
  // mercado de transferências (excedentes acima de 32 viram jogadores livres)
  return ensureMarket(season, baseSquadOf);
}
