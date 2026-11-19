/**
 * (Prêmios) Fim de temporada: SELEÇÃO DO MUNDO (time da temporada de todos os clubes do jogo), TIME DO CAMPEONATO
 * (a liga de cada clube humano) e a BOLA DE OURO (pódio dos 3 melhores do mundo; e o craque de cada campeonato).
 *
 * Base: as linhas de carreira da temporada (`WorldState.records.players`, despejadas na virada) — jogos, gols,
 * assistências e nota média de TODAS as competições. A janela é a temporada que acabou de fechar e a do outro
 * calendário que terminou nos 12 meses anteriores (virada de 31/12: "2026" + "2025/26"; de 30/06: "2026/27" + "2026"),
 * para comparar sul-americanos e europeus na mesma premiação. No time do campeonato só contam os jogos pelos clubes
 * daquela liga, na temporada dela.
 *
 * Nota de cada jogador (determinística):
 *   (nota média − 6) × 14 + gols × peso da posição + assistências × 0,35 + jogos × 0,06 (até 50) + overall × 0,3
 *   + títulos do clube na janela (continental +5, liga da 1ª divisão +3, copa nacional +1,5)
 * Mínimo de jogos: 18 no mundo, 12 no campeonato. Formação 4-3-3 (GOL, 2 LAT, 2 ZAG, 3 MEI, 3 ATA).
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { AwardPlayer, CareerRecords, ChampionRecord, PlayerSeasonLine, SeasonAwards, SeasonState, WorldState } from '../contract';
import { flushLines } from './records';
import { baseClubOf } from '../transfers/market';
import { cycleSeason, seasonLabel, type Cycle } from './timeline';

export const AWARDS = {
  minGamesWorld: 18,
  minGamesLeague: 12,
  xi: { GK: 1, FB: 2, CB: 2, MF: 3, FW: 3 } as Record<Position, number>,
  goalWeight: { GK: 0, CB: 0.7, FB: 0.6, MF: 0.5, FW: 0.4 } as Record<Position, number>,
  assistWeight: 0.35,
  ratingWeight: 14,
  gamesWeight: 0.06,
  gamesCap: 50,
  overallWeight: 0.3,
  title: { continental: 5, league: 3, cup: 1.5 },
  /** premiações guardadas no mundo (as mais recentes) */
  keep: 30,
};

/** Temporadas consideradas: a que fechou + a do outro calendário encerrada nos 12 meses anteriores. */
export function awardWindow(cycle: Cycle, season: number): string[] {
  return cycle === 'calendar'
    ? [seasonLabel('calendar', season), seasonLabel('split', season - 1)]
    : [seasonLabel('split', season), seasonLabel('calendar', season)];
}

type Agg = { games: number; goals: number; assists: number; rt: number; clubs: Set<string> };

function aggregate(lines: readonly PlayerSeasonLine[] | undefined, pid: string, ok: (label: string, club: string) => boolean): Agg | null {
  if (!lines) return null;
  let a: Agg | null = null;
  for (const l of lines) {
    const club = l[1] === '' ? baseClubOf(pid) : l[1];
    if (!ok(l[0], club) || l[2] <= 0) continue;
    a ??= { games: 0, goals: 0, assists: 0, rt: 0, clubs: new Set() };
    a.games += l[2];
    a.goals += l[3];
    a.assists += l[4];
    a.rt += l[5] * l[2];
    a.clubs.add(club);
  }
  return a;
}

/** Bônus de títulos dos clubes do jogador nas temporadas informadas. */
function titleBonus(history: readonly ChampionRecord[], labels: Set<string>, clubs: Set<string>): number {
  let b = 0;
  for (const r of history) {
    if (!r.championId || !clubs.has(r.championId)) continue;
    const label = r.seasonLabel ?? String(r.season);
    if (!labels.has(label)) continue;
    if (r.type === 'continental') b += AWARDS.title.continental;
    else if (r.type === 'league' && (r.division === undefined || r.division === 1) && r.countryId !== undefined) b += AWARDS.title.league;
    else if (r.type === 'cup' && r.countryId !== undefined) b += AWARDS.title.cup;
  }
  return b;
}

function award(p: Player, clubId: string, a: Agg, bonus: number): AwardPlayer {
  const avg = a.rt / a.games / 10;
  const score =
    (avg - 6) * AWARDS.ratingWeight + a.goals * AWARDS.goalWeight[p.position] + a.assists * AWARDS.assistWeight +
    Math.min(a.games, AWARDS.gamesCap) * AWARDS.gamesWeight + p.overall * AWARDS.overallWeight + bonus;
  return {
    playerId: p.id, name: p.name, clubId, position: p.position, age: p.age, overall: p.overall, nationalityId: p.nationalityId,
    games: a.games, goals: a.goals, assists: a.assists, rating: Math.round(avg * 10) / 10, score: Math.round(score * 100) / 100,
  };
}

const byScore = (x: AwardPlayer, y: AwardPlayer) => y.score - x.score || y.overall - x.overall || (x.playerId < y.playerId ? -1 : 1);

/** Time da temporada (4-3-3) a partir dos candidatos já pontuados. */
export function pickTeam(cands: readonly AwardPlayer[]): AwardPlayer[] {
  const sorted = cands.slice().sort(byScore);
  const out: AwardPlayer[] = [];
  for (const pos of ['GK', 'FB', 'CB', 'MF', 'FW'] as Position[]) out.push(...sorted.filter((c) => c.position === pos).slice(0, AWARDS.xi[pos]));
  return out;
}

/**
 * Calcula a premiação. `squads`: elencos (o clube exibido é o atual); `clubIds`: todos os clubes da temporada;
 * `leagues`: os campeonatos premiados (com os clubes e o rótulo da temporada deles).
 */
export function computeSeasonAwards(
  world: Pick<WorldState, 'records' | 'history'>,
  squads: (clubId: string) => readonly Player[],
  clubIds: readonly string[],
  o: { cycle: Cycle; season: number; date: string; leagues: { competitionId: string; name: string; seasonLabel: string; clubIds: string[] }[] },
): SeasonAwards {
  const labels = new Set(awardWindow(o.cycle, o.season));
  const recs = world.records?.players ?? {};
  const worldCands: AwardPlayer[] = [];
  const leagueCands = o.leagues.map(() => [] as AwardPlayer[]);
  const leagueSets = o.leagues.map((l) => new Set(l.clubIds));
  const seen = new Set<string>();
  for (const clubId of clubIds) {
    for (const p of squads(clubId)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const lines = recs[p.id];
      if (!lines) continue;
      const a = aggregate(lines, p.id, (label) => labels.has(label));
      if (a && a.games >= AWARDS.minGamesWorld && a.rt > 0) worldCands.push(award(p, clubId, a, titleBonus(world.history, labels, a.clubs)));
      o.leagues.forEach((lg, i) => {
        const la = aggregate(lines, p.id, (label, club) => label === lg.seasonLabel && leagueSets[i].has(club));
        if (!la || la.games < AWARDS.minGamesLeague || la.rt <= 0) return;
        const club = [...la.clubs][la.clubs.size - 1];
        leagueCands[i].push(award(p, club, la, titleBonus(world.history, new Set([lg.seasonLabel]), la.clubs)));
      });
    }
  }
  return {
    label: seasonLabel(o.cycle, o.season),
    date: o.date,
    ballonDor: worldCands.slice().sort(byScore).slice(0, 3),
    world: pickTeam(worldCands),
    leagues: o.leagues.map((lg, i) => ({
      competitionId: lg.competitionId, name: lg.name, seasonLabel: lg.seasonLabel,
      best: leagueCands[i].slice().sort(byScore)[0] ?? null,
      xi: pickTeam(leagueCands[i]),
    })),
  };
}

/** (19/11) Temporadas em andamento na data: a do calendário (ano) e a europeia (jul–jun). */
export function raceLabels(date: string): string[] {
  return (['calendar', 'split'] as Cycle[]).map((c) => seasonLabel(c, cycleSeason(c, date)));
}

/**
 * (19/11) CORRIDA da Bola de Ouro, no meio da temporada: a mesma nota da premiação, com os números já gravados
 * (`world.records`) + os da temporada em curso (`state.career.lines`, ainda não despejados). Não muta nada.
 * Mínimo de jogos proporcional (40% de quem mais jogou, até o mínimo da premiação), para valer desde o começo.
 * Janela: as temporadas EM ANDAMENTO nos dois calendários na data do jogo (ex.: "2026" + "2025/26").
 */
export function ballonRace(
  world: Pick<WorldState, 'records' | 'history'>,
  state: SeasonState,
  squads: (clubId: string) => readonly Player[],
  clubIds: readonly string[],
  o: { top?: number } = {},
): AwardPlayer[] {
  const labels = new Set(raceLabels(state.date));
  const records: CareerRecords = { ...(world.records ?? { players: {} }), players: { ...(world.records?.players ?? {}) } } as CareerRecords;
  // copia só as listas que a temporada em curso vai somar (flushLines muta)
  for (const k of Object.keys(state.career?.lines ?? {})) {
    const pid = k.slice(0, k.lastIndexOf('|'));
    const cur = records.players[pid];
    if (cur && world.records?.players?.[pid] === cur) records.players[pid] = cur.map((l) => l.slice() as PlayerSeasonLine);
  }
  flushLines(records, state, state.date);
  const cands: { p: Player; clubId: string; a: Agg }[] = [];
  const seen = new Set<string>();
  let maxGames = 0;
  for (const clubId of clubIds) {
    for (const p of squads(clubId)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const a = aggregate(records.players[p.id], p.id, (label) => labels.has(label));
      if (!a || a.rt <= 0) continue;
      maxGames = Math.max(maxGames, a.games);
      cands.push({ p, clubId, a });
    }
  }
  const minGames = Math.max(1, Math.min(AWARDS.minGamesWorld, Math.floor(maxGames * 0.4)));
  return cands
    .filter((c) => c.a.games >= minGames)
    .map((c) => award(c.p, c.clubId, c.a, titleBonus(world.history, labels, c.a.clubs)))
    .sort(byScore)
    .slice(0, o.top ?? 10);
}
