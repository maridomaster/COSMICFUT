/**
 * (Registros) Registro de tudo: gols e assistências de todos os jogos (inclusive os da simulação leve), artilharia e
 * assistências por competição e temporada, campanha de cada clube em cada competição (posição final e fase
 * alcançada), troféus e a carreira de cada jogador por temporada e clube (jogos, gols, assistências, nota média,
 * empréstimos e transferências).
 *
 * Onde fica cada coisa:
 *  - durante a temporada: `Competition.scorers` / `assists` / `scorerClubs` (tabelas vivas) e
 *    `SeasonState.career.lines` (`${jogador}|${clube}` → [jogos, gols, assistências, Σ notas×10, emprestado]);
 *  - na virada (rollover.ts): as competições que fecham viram `ChampionRecord` em `WorldState.history` com o top 20/10
 *    de artilharia e assistências, a ordem final (`table`) e a fase alcançada (`reach`); TODAS as linhas do trecho
 *    vão para `WorldState.records.players` (a virada seguinte começa com `lines` vazio).
 *
 * Por que as linhas não guardam a temporada no trecho: um trecho (01/01–30/06 ou 01/07–31/12) nunca cruza a virada
 * de nenhum ciclo, então a temporada de cada clube é fixa nele ("2026" na América do Sul; "2025/26" ou "2026/27" na
 * Europa/Arábia) e é calculada no despejo. Linhas do mesmo jogador/clube/temporada em trechos diferentes (ex.: um
 * brasileiro em jan–jun e jul–dez) são somadas.
 *
 * Tamanho do save: linhas compactas (arrays), o clube de origem do id vira '' e jogadores aposentados/sumidos sem
 * carreira relevante (menos de RECORDS.keepGames jogos e RECORDS.keepGoals gols, nunca num clube humano) são podados.
 */
import type {
  CareerRecords, ChampionRecord, Competition, MatchResult, PlayerSeasonLine, RecordRow, SeasonState, Side, WorldState,
} from '../contract';
import { baseClubOf } from '../transfers/market';
import { cycleOfRegion, cycleSeason, seasonLabel, type Region } from './timeline';
import { stageDef, stageDeps } from './format';

export const RECORDS = {
  /** artilharia/assistências gravadas por competição principal (continentais, copas, 1ª/2ª divisões, estadual A1) */
  topMajor: 20,
  /** nas demais (estaduais menores) */
  topMinor: 10,
  /** aposentado/sumido: a carreira fica gravada só com ≥ isto de jogos… */
  keepGames: 150,
  /** …ou de gols (ou se passou por um clube humano) */
  keepGoals: 40,
};

export const emptyRecords = (): CareerRecords => ({ players: {} });

/* ═════════════════════ durante a temporada ═════════════════════ */

/**
 * Gols e assistências de um jogo na tabela viva da competição (gol contra não conta). MUTA `comp`.
 * `scorerClubs` = clube do jogador no último gol/assistência.
 */
export function recordCompetitionGoals(comp: Competition, homeId: string, awayId: string, r: MatchResult): void {
  for (const s of r.scorers) {
    if (s.ownGoal) continue;
    const club = s.side === 'home' ? homeId : awayId;
    comp.scorers ??= {};
    comp.scorerClubs ??= {};
    comp.scorers[s.playerId] = (comp.scorers[s.playerId] ?? 0) + 1;
    comp.scorerClubs[s.playerId] = club;
    if (s.assistId) {
      comp.assists ??= {};
      comp.assists[s.assistId] = (comp.assists[s.assistId] ?? 0) + 1;
      comp.scorerClubs[s.assistId] = club;
    }
  }
}

/**
 * Linhas de carreira do jogo (jogos, gols, assistências, nota). `copy`: substitui os arrays em vez de mutar (o
 * advanceDay sem `inPlace` compartilha o objeto `lines` raso com a entrada). MUTA `state.career.lines`.
 */
export function recordLines(state: SeasonState, homeId: string, awayId: string, r: MatchResult, comp?: Competition): void {
  const c = state.career;
  if (!c) return;
  const lines = (c.lines ??= {});
  const contracts = state.market?.contracts;
  // (19/11) Bola de Prata: o campeonato nacional (liga da 1ª divisão de um país) também tem linhas próprias
  const league = comp && isNationalLeague(comp) ? comp.id : null;
  const ll = league ? (c.leagueLines ??= {}) : null;
  const bump = (pid: string, club: string, g: number, gl: number, a: number, rt: number, cs = 0) => {
    const k = `${pid}|${club}`;
    const prev = lines[k];
    if (prev) lines[k] = [prev[0] + g, prev[1] + gl, prev[2] + a, prev[3] + rt, prev[4], (prev[5] ?? 0) + cs];
    else {
      const ct = contracts?.[pid];
      lines[k] = [g, gl, a, rt, ct?.kind === 'loan' && ct.loanFrom && ct.loanFrom !== club ? 1 : 0, cs];
    }
    if (ll) {
      const lk = `${pid}|${league}`;
      const lp = ll[lk];
      ll[lk] = lp ? [lp[0] + g, lp[1] + gl, lp[2] + a, lp[3] + rt, lp[4] + cs, club] : [g, gl, a, rt, cs, club];
    }
  };
  for (const [side, clubId] of [['home', homeId], ['away', awayId]] as [Side, string][]) {
    if (!state.clubs[clubId]) continue;
    // jogo sem sofrer gol: conta para quem entrou em campo (o placar final do time)
    const cs = (side === 'home' ? r.awayGoals : r.homeGoals) === 0 ? 1 : 0;
    for (const pid of r.appearances?.[side] ?? []) bump(pid, clubId, 1, 0, 0, Math.round((r.ratings[pid] ?? 6.2) * 10), cs);
  }
  for (const s of r.scorers) {
    if (s.ownGoal) continue;
    const club = s.side === 'home' ? homeId : awayId;
    if (!state.clubs[club]) continue;
    if (lines[`${s.playerId}|${club}`]) bump(s.playerId, club, 0, 1, 0, 0);
    if (s.assistId && lines[`${s.assistId}|${club}`]) bump(s.assistId, club, 0, 0, 1, 0);
  }
}

/** (19/11) Campeonato nacional da Bola de Prata: liga da 1ª divisão de um país. */
export function isNationalLeague(comp: Pick<Competition, 'type' | 'countryId' | 'division' | 'id'>): boolean {
  return comp.type === 'league' && comp.countryId !== undefined && (comp.division ?? 1) === 1;
}

/* ═════════════════════ virada ═════════════════════ */

/** Rótulo da temporada de um clube num trecho (ciclo da região do clube; sem região ⇒ ano civil). */
export function clubSeasonLabelAt(state: SeasonState, clubId: string, date: string): string {
  const r = (state.clubInfo?.[clubId]?.region as Region | undefined) ?? null;
  const cyc = cycleOfRegion(r);
  return seasonLabel(cyc, cycleSeason(cyc, date));
}

const lineClubOf = (pid: string, club: string) => (club === '' ? baseClubOf(pid) : club);

/**
 * Despeja as linhas do trecho em `records.players` (soma na linha da mesma temporada/clube, se já existir). MUTA
 * `records`. `date` = um dia do trecho (o rótulo da temporada de cada clube é fixo nele).
 */
export function flushLines(records: CareerRecords, state: SeasonState, date: string): number {
  const lines = state.career?.lines;
  if (!lines) return 0;
  const labels = new Map<string, string>();
  let n = 0;
  for (const k of Object.keys(lines).sort()) {
    const [g, gl, a, rt, loan, cs = 0] = lines[k];
    if (g <= 0) continue;
    const bar = k.lastIndexOf('|');
    const pid = k.slice(0, bar), club = k.slice(bar + 1);
    let label = labels.get(club);
    if (!label) labels.set(club, (label = clubSeasonLabelAt(state, club, date)));
    const stored = club === baseClubOf(pid) ? '' : club;
    const list = (records.players[pid] ??= []);
    const prev = list.find((l) => l[0] === label && l[1] === stored);
    if (prev) {
      const games = prev[2] + g;
      prev[5] = Math.round((prev[5] * prev[2] + rt) / games);
      prev[2] = games; prev[3] += gl; prev[4] += a;
      if (loan && !prev[6]) prev[6] = 1;
      if (cs) { prev[6] ??= 0; prev[7] = (prev[7] ?? 0) + cs; }
    } else {
      const line: PlayerSeasonLine = [label, stored, g, gl, a, Math.round(rt / g)];
      if (loan || cs) line.push(loan ? 1 : 0);
      if (cs) line.push(cs);
      list.push(line);
    }
    n++;
  }
  return n;
}

/** Jogador aposentado/sumido: a carreira só fica gravada se for relevante (ver RECORDS). MUTA `records`. */
export function pruneRetired(records: CareerRecords, pid: string, humanClubs: Set<string>): void {
  const list = records.players[pid];
  if (!list) return;
  let games = 0, goals = 0;
  for (const l of list) {
    games += l[2]; goals += l[3];
    if (humanClubs.has(lineClubOf(pid, l[1]))) return;
  }
  if (games < RECORDS.keepGames && goals < RECORDS.keepGoals) delete records.players[pid];
}

/** Competição "principal" (grava top 20; demais, top 10). */
function isMajor(c: Pick<Competition, 'type' | 'division'>): boolean {
  if (c.type === 'continental' || c.type === 'cup' || c.type === 'supercup') return true;
  if (c.type === 'league') return (c.division ?? 1) <= 2;
  return (c.division ?? 1) === 1;
}

/** Top N de um mapa jogador → quantidade (desempate pelo id), com nome e clube. */
export function topRows(
  counts: Record<string, number> | undefined, clubs: Record<string, string> | undefined, n: number, nameOf: (pid: string, clubId: string) => string,
): RecordRow[] {
  if (!counts) return [];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([pid, v]) => {
      const club = clubs?.[pid] ?? baseClubOf(pid);
      return [pid, nameOf(pid, club), club, v];
    });
}

/**
 * Fase alcançada por clube no caminho do título principal (mata-mata): nome da rodada da eliminatória mais funda que o
 * clube disputou (sem a disputa de 3º lugar). Clubes que não chegaram ao mata-mata ficam de fora.
 */
export function campaignReach(comp: Competition): Record<string, string> {
  const out: Record<string, string> = {};
  if (!comp.format || !comp.stages) return out;
  const main = new Set<string>();
  const stack = [comp.format.champion];
  while (stack.length) {
    const id = stack.pop()!;
    if (main.has(id)) continue;
    main.add(id);
    const d = stageDef(comp, id);
    if (d) stack.push(...stageDeps(d));
  }
  const depth = new Map<string, number>();
  comp.format.stages.forEach((def, si) => {
    if (def.kind !== 'knockout' || !main.has(def.id) || def.relegationStage) return;
    for (const t of comp.stages![def.id]?.ties ?? []) {
      if (t.thirdPlace) continue;
      const d = (si + 1) * 100 + t.round;
      for (const c of [t.a, t.b]) {
        if (!c || (depth.get(c) ?? -1) >= d) continue;
        depth.set(c, d);
        out[c] = t.roundName;
      }
    }
  });
  return out;
}

/** Campos de registro de uma competição que fecha (artilharia, assistências, ordem final, fase alcançada). */
export function competitionRecord(comp: Competition, table: string[], nameOf: (pid: string, clubId: string) => string): Partial<ChampionRecord> {
  const n = isMajor(comp) ? RECORDS.topMajor : RECORDS.topMinor;
  const scorers = topRows(comp.scorers, comp.scorerClubs, n, nameOf);
  const assists = topRows(comp.assists, comp.scorerClubs, n, nameOf);
  const reach = campaignReach(comp);
  return {
    ...(scorers.length ? { scorers } : {}),
    ...(assists.length ? { assists } : {}),
    ...(table.length ? { table } : {}),
    ...(Object.keys(reach).length ? { reach } : {}),
    ...(comp.countryId !== undefined ? { countryId: comp.countryId } : {}),
    ...(comp.division !== undefined ? { division: comp.division } : {}),
  };
}

/* ═════════════════════ consultas (UI) ═════════════════════ */

/** Linha de carreira já resolvida para a UI. */
export interface PlayerCareerRow {
  season: string;
  clubId: string;
  games: number;
  goals: number;
  assists: number;
  /** nota média (0–10) */
  rating: number;
  loan: boolean;
  /** temporada em andamento (ainda não gravada pela virada) */
  live?: boolean;
}

/**
 * Carreira de um jogador: temporadas gravadas + o trecho em andamento (linhas vivas da SeasonState, já somadas à
 * mesma temporada/clube se houver). Ordem cronológica.
 */
export function playerCareer(world: Pick<WorldState, 'records'> | null | undefined, state: SeasonState | null | undefined, pid: string): PlayerCareerRow[] {
  const rows: PlayerCareerRow[] = (world?.records?.players[pid] ?? []).map((l) => ({
    season: l[0], clubId: lineClubOf(pid, l[1]), games: l[2], goals: l[3], assists: l[4], rating: l[5] / 10, loan: !!l[6],
  }));
  const lines = state?.career?.lines;
  if (lines && state) {
    const prefix = `${pid}|`;
    for (const k of Object.keys(lines)) {
      if (!k.startsWith(prefix)) continue;
      const club = k.slice(prefix.length);
      const [g, gl, a, rt, loan] = lines[k];
      if (g <= 0) continue;
      const season = clubSeasonLabelAt(state, club, state.segment?.start ?? state.date);
      const prev = rows.find((r) => r.season === season && r.clubId === club);
      if (prev) {
        const games = prev.games + g;
        prev.rating = Math.round(((prev.rating * 10 * prev.games + rt) / games)) / 10;
        prev.games = games; prev.goals += gl; prev.assists += a; prev.live = true;
        if (loan) prev.loan = true;
      } else rows.push({ season, clubId: club, games: g, goals: gl, assists: a, rating: Math.round(rt / g) / 10, loan: !!loan, live: true });
    }
  }
  return rows;
}

/** Campanha de um clube numa competição encerrada. */
export interface ClubCampaign {
  competitionId: string;
  name: string;
  type: ChampionRecord['type'];
  season: string;
  /** posição final (1 = campeão) */
  position?: number;
  /** fase alcançada no mata-mata */
  reach?: string;
  champion: boolean;
  vice: boolean;
  /** títulos secundários (Taça Rio, Apertura...) */
  titles: string[];
  /** participantes (para "3º de 20") */
  of?: number;
}

const labelOf = (r: ChampionRecord) => r.seasonLabel ?? String(r.season);

/** Histórico de um clube: campanhas por temporada (mais recente primeiro). */
export function clubHistory(world: Pick<WorldState, 'history'> | null | undefined, clubId: string): { season: string; campaigns: ClubCampaign[] }[] {
  const by = new Map<string, ClubCampaign[]>();
  for (const r of world?.history ?? []) {
    const pos = r.table ? r.table.indexOf(clubId) : -1;
    const titles = (r.titles ?? []).filter((t) => t.clubId === clubId).map((t) => t.title);
    const inIt = pos >= 0 || r.championId === clubId || r.viceId === clubId || titles.length > 0 || !!r.reach?.[clubId];
    if (!inIt) continue;
    const season = labelOf(r);
    const list = by.get(season) ?? by.set(season, []).get(season)!;
    list.push({
      competitionId: r.competitionId, name: r.name, type: r.type, season,
      ...(pos >= 0 ? { position: pos + 1, of: r.table!.length } : {}),
      ...(r.reach?.[clubId] ? { reach: r.reach[clubId] } : {}),
      champion: r.championId === clubId, vice: r.viceId === clubId, titles,
    });
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([season, campaigns]) => ({ season, campaigns }));
}

/** Troféus de um clube (títulos principais e secundários), mais recentes primeiro. */
export function clubTrophies(world: Pick<WorldState, 'history'> | null | undefined, clubId: string): { competitionId: string; name: string; season: string; type: ChampionRecord['type']; secondary?: string }[] {
  const out: { competitionId: string; name: string; season: string; type: ChampionRecord['type']; secondary?: string }[] = [];
  for (const r of world?.history ?? []) {
    if (r.championId === clubId) out.push({ competitionId: r.competitionId, name: r.name, season: labelOf(r), type: r.type });
    for (const t of r.titles ?? []) if (t.clubId === clubId) out.push({ competitionId: r.competitionId, name: r.name, season: labelOf(r), type: r.type, secondary: t.title });
  }
  return out.sort((a, b) => b.season.localeCompare(a.season));
}

/** Campeões de uma competição por temporada (mais recente primeiro). */
export function championsOf(world: Pick<WorldState, 'history'> | null | undefined, competitionId: string): ChampionRecord[] {
  return (world?.history ?? []).filter((r) => r.competitionId === competitionId).sort((a, b) => labelOf(b).localeCompare(labelOf(a)));
}
