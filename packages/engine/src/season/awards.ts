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
 *   (gols/assistências/jogos sem sofrer gol no ritmo por jogo sobre no máximo 40 jogos — `volumeCap`)
 *   + títulos do clube na janela (Liga dos Campeões +14, Libertadores +7, Liga Europa +6, Sul-Americana +3,5…; liga da 1ª
 *     divisão 2 + 3 × nível da liga — Premier ~6, Brasileirão ~4; copa nacional +2) — (25/11)
 * Mínimo de jogos: 18 no mundo, 12 no campeonato. Formação 4-3-3 (GOL, 2 LAT, 2 ZAG, 3 MEI, 3 ATA).
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { AwardPlayer, CareerRecords, ChampionRecord, Competition, Honor, Honors, PlayerSeasonLine, SeasonAwards, SeasonState, SilverBall, WorldState } from '../contract';
import { flushLines } from './records';
import { baseClubOf } from '../transfers/market';
import { clubLeagueMult, leagueMultiplier } from '../transfers/value';
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
  /**
   * (19/11) gols, assistências e jogos sem sofrer gol contam no RITMO do jogador (por jogo) sobre no máximo 40 jogos:
   * os clubes sul-americanos jogam ~70 partidas no ano (estaduais + copas) e os europeus ~40 — sem isso só
   * sul-americanos ganhavam a Bola de Ouro pelo volume.
   */
  volumeCap: 40,
  overallWeight: 0.3,
  /** (19/11) jogos sem sofrer gol: o que mais pesa para os defensores */
  cleanSheetWeight: { GK: 0.6, CB: 0.4, FB: 0.3, MF: 0, FW: 0 } as Record<Position, number>,
  /**
   * (25/11) títulos pesam como no prêmio real: Liga dos Campeões vale o dobro da Libertadores; liga pelo nível dela
   * (Premier ~6, LaLiga ~5, Brasileirão ~4); continentais pelo id, os demais `continental`
   */
  title: { continental: 2, league: 3, cup: 2 },
  continentalTitle: {
    UCL: 14, LIBERTADORES: 7, SUPERMUNDIAL: 6, UEL: 6, INTERCONTINENTAL: 4, SULAMERICANA: 3.5, UECL: 3, ACL: 3, RECOPA: 1, NORDESTE: 0.5,
  } as Record<string, number>,
  /** liga nacional (1ª divisão): base + por ponto do fator da liga (LEAGUE_MULT) */
  leagueTitle: { base: 2, perMult: 3 },
  /** premiações guardadas no mundo (as mais recentes) */
  keep: 30,
  /** (19/11) Bolas de Prata guardadas (todas as ligas nacionais, as mais recentes) */
  silverKeep: 400,
};

/** Temporadas consideradas: a que fechou + a do outro calendário encerrada nos 12 meses anteriores. */
export function awardWindow(cycle: Cycle, season: number, startDate?: string): string[] {
  const out = cycle === 'calendar'
    ? [seasonLabel('calendar', season), seasonLabel('split', season - 1)]
    : [seasonLabel('split', season), seasonLabel('calendar', season)];
  // (19/11) 1ª premiação: a temporada do outro calendário começou ANTES da carreira (ex.: carreira em 01/01/2026, a
  // europeia 2025/26 só teve jan–jun no jogo). Entra também a seguinte, para os 12 meses completos de todo o mundo
  // (senão os europeus chegavam com metade dos jogos e dos gols e só os sul-americanos disputavam).
  const otherStart = cycle === 'calendar' ? `${season - 1}-07-01` : `${season}-01-01`;
  if (startDate && startDate > otherStart) out.push(cycle === 'calendar' ? seasonLabel('split', season) : seasonLabel('calendar', season + 1));
  return out;
}

/** (19/11) Ciclo e temporada a partir do rótulo da premiação ("2026" → ano civil 2026; "2026/27" → europeia 2026). */
export function awardCycleOf(label: string): { cycle: Cycle; season: number } {
  return { cycle: label.includes('/') ? 'split' : 'calendar', season: Number(label.slice(0, 4)) };
}

type Agg = { games: number; goals: number; assists: number; rt: number; cs: number; clubs: Set<string> };

function aggregate(lines: readonly PlayerSeasonLine[] | undefined, pid: string, ok: (label: string, club: string) => boolean): Agg | null {
  if (!lines) return null;
  let a: Agg | null = null;
  for (const l of lines) {
    const club = l[1] === '' ? baseClubOf(pid) : l[1];
    if (!ok(l[0], club) || l[2] <= 0) continue;
    a ??= { games: 0, goals: 0, assists: 0, rt: 0, cs: 0, clubs: new Set() };
    a.games += l[2];
    a.goals += l[3];
    a.assists += l[4];
    a.cs += l[7] ?? 0;
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
    if (r.type === 'continental') b += AWARDS.continentalTitle[r.competitionId] ?? AWARDS.title.continental;
    else if (r.type === 'league' && (r.division === undefined || r.division === 1) && r.countryId !== undefined) b += AWARDS.leagueTitle.base + AWARDS.leagueTitle.perMult * leagueMultiplier(r.competitionId);
    else if (r.type === 'cup' && r.countryId !== undefined) b += AWARDS.title.cup;
  }
  return b;
}

/**
 * (19/11) Peso do nível da liga no desempenho da Bola de Ouro (±10%): Premier League ~1,08, top-5 ~1,02, Brasil ~0,94,
 * Argentina ~0,91, resto da América do Sul ~0,87 — gol na Premier vale um pouco mais que no Argentino.
 */
export function leagueLevel(state: SeasonState, clubId: string): number {
  // (25/11) mais forte: Premier ~1,15, top-5 ~1,02, Brasil ~0,89, Argentina ~0,82, resto da América do Sul ~0,75
  return Math.min(1.15, Math.max(0.75, 0.6 + 0.4 * clubLeagueMult(state, clubId)));
}

function award(p: Player, clubId: string, a: Agg, bonus: number, level = 1): AwardPlayer {
  const avg = a.rt / a.games / 10;
  const k = Math.min(a.games, AWARDS.volumeCap) / a.games;
  const perf =
    (avg - 6) * AWARDS.ratingWeight + a.goals * k * AWARDS.goalWeight[p.position] + a.assists * k * AWARDS.assistWeight +
    a.cs * k * AWARDS.cleanSheetWeight[p.position];
  const score =
    perf * (perf > 0 ? level : 1) +
    Math.min(a.games, AWARDS.gamesCap) * AWARDS.gamesWeight + p.overall * AWARDS.overallWeight + bonus;
  return {
    playerId: p.id, name: p.name, clubId, position: p.position, age: p.age, overall: p.overall, nationalityId: p.nationalityId,
    games: a.games, goals: a.goals, assists: a.assists, ...(a.cs ? { cleanSheets: a.cs } : {}),
    rating: Math.round(avg * 10) / 10, score: Math.round(score * 100) / 100,
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
  world: Pick<WorldState, 'records' | 'history'> & { startDate?: string; prelude?: boolean },
  squads: (clubId: string) => readonly Player[],
  clubIds: readonly string[],
  o: { cycle: Cycle; season: number; date: string; leagues: { competitionId: string; name: string; seasonLabel: string; clubIds: string[] }[]; level?: (clubId: string) => number },
): SeasonAwards {
  // (23/11) com o prelúdio a Europa já jogou 2025/26 inteira: janela normal
  const labels = new Set(awardWindow(o.cycle, o.season, world.prelude ? undefined : world.startDate));
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
      if (a && a.games >= AWARDS.minGamesWorld && a.rt > 0) worldCands.push(award(p, clubId, a, titleBonus(world.history, labels, a.clubs), o.level?.(clubId)));
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
    .map((c) => award(c.p, c.clubId, c.a, titleBonus(world.history, labels, c.a.clubs), leagueLevel(state, c.clubId)))
    .sort(byScore)
    .slice(0, o.top ?? 10);
}

/* ═════════════════════ (19/11) Bola de Prata e ícones ═════════════════════ */

/** Bônus de quem tem o ícone, nas partidas, até a próxima premiação: overall a mais e fator do cansaço. */
export const HONOR = {
  world: { overall: 2, drain: 0.8 },
  national: { overall: 1, drain: 0.9 },
};

/** Bônus somados dos ícones do jogador (Bola de Ouro e/ou Prata); null se não tem nenhum. */
export function honorBonus(honors: Honors | undefined, pid: string): { overall: number; drain: number } | null {
  if (!honors) return null;
  let overall = 0, drain = 1;
  if (honors.world?.playerId === pid) { overall += HONOR.world.overall; drain *= HONOR.world.drain; }
  for (const h of Object.values(honors.national ?? {})) if (h.playerId === pid) { overall += HONOR.national.overall; drain *= HONOR.national.drain; }
  return overall ? { overall, drain } : null;
}

/** Ícones de um jogador (para a interface). */
export function honorsOf(honors: Honors | undefined, pid: string): Honor[] {
  if (!honors) return [];
  const out: Honor[] = [];
  if (honors.world?.playerId === pid) out.push(honors.world);
  for (const h of Object.values(honors.national ?? {})) if (h.playerId === pid) out.push(h);
  return out;
}

/**
 * Candidatos da Bola de Prata de um campeonato nacional (só os jogos dele, `state.career.leagueLines`), ordenados.
 * `minGames`: ausente ⇒ proporcional (40% de quem mais jogou, até `AWARDS.minGamesLeague`).
 */
export function silverRanking(
  state: SeasonState, squads: (clubId: string) => readonly Player[], competitionId: string, history: readonly ChampionRecord[] = [], minGames?: number,
): AwardPlayer[] {
  const suffix = `|${competitionId}`;
  const ll = state.career?.leagueLines ?? {};
  const byClub = new Map<string, Map<string, Player>>();
  const playerOf = (club: string, pid: string) => {
    let m = byClub.get(club);
    if (!m) byClub.set(club, (m = new Map(squads(club).map((p) => [p.id, p]))));
    return m.get(pid);
  };
  const cands: { p: Player; club: string; a: Agg }[] = [];
  let maxGames = 0;
  for (const [k, v] of Object.entries(ll)) {
    if (!k.endsWith(suffix)) continue;
    const pid = k.slice(0, k.length - suffix.length);
    const [g, gl, as, rt, cs, club] = v;
    if (g <= 0 || rt <= 0) continue;
    const p = playerOf(club, pid);
    if (!p) continue;
    maxGames = Math.max(maxGames, g);
    cands.push({ p, club, a: { games: g, goals: gl, assists: as, rt, cs, clubs: new Set([club]) } });
  }
  const min = minGames ?? Math.max(1, Math.min(AWARDS.minGamesLeague, Math.floor(maxGames * 0.4)));
  const label = new Set<string>();
  return cands
    .filter((c) => c.a.games >= min)
    .map((c) => award(c.p, c.club, c.a, titleBonus(history, label, c.a.clubs)))
    .sort(byScore);
}

/**
 * Bolas de Prata das ligas nacionais que fecham na virada. Mínimo de jogos: `AWARDS.minGamesLeague` (ou a metade dos
 * jogos de quem mais jogou, em ligas curtas).
 */
export function computeSilverBalls(
  state: SeasonState, squads: (clubId: string) => readonly Player[], leagues: readonly Competition[], label: string, date: string,
): SilverBall[] {
  const out: SilverBall[] = [];
  for (const c of leagues) {
    const all = silverRanking(state, squads, c.id, [], 1);
    const maxGames = all.reduce((m, x) => Math.max(m, x.games), 0);
    const min = Math.min(AWARDS.minGamesLeague, Math.max(1, Math.floor(maxGames / 2)));
    const best = all.find((x) => x.games >= min);
    if (best) out.push({ label, date, competitionId: c.id, name: c.name, best });
  }
  return out;
}
