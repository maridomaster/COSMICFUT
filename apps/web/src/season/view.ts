/** Leituras derivadas da SeasonState para a UI (puras). Servem à carreira (várias competições) e ao online (uma liga). */
import type { Competition, Fixture, Region, SeasonState, StandingRow } from '@cosmicfut/engine';
import { computeStandings, cycleOfRegion, cycleSeason, nextFixtureFor, regionOfClub, seasonLabel, stageGroupTables, unavailablePlayers, weekOfYear } from '@cosmicfut/engine';
import { stageZones, type CZone } from './comps';

export const humanIdOf = (s: SeasonState) => s.humanClubIds[0];

/* ── (Etapa 1) linha do tempo global: regiões, rótulos de temporada e semana do ano ── */

export const REGION_LABEL: Record<Region, string> = { SA: 'América do Sul', EU: 'Europa', SAU: 'Arábia Saudita' };

/** Região do clube humano (null em temporadas sem linha do tempo global, ex.: online antigo). */
export function humanRegionOf(s: SeasonState): Region | null {
  const id = humanIdOf(s);
  return id ? regionOfClub(s, id) : null;
}

/** Rótulo da temporada do humano na data ("2026" na América do Sul; "2026/27" na Europa/Arábia). */
export function humanSeasonLabel(s: SeasonState): string {
  const r = humanRegionOf(s);
  if (!r || !s.segment) return String(s.season);
  const cyc = cycleOfRegion(r);
  return seasonLabel(cyc, cycleSeason(cyc, s.date));
}

/** Rótulo da temporada de uma competição ("2026" / "2026/27"); vazio em temporadas antigas. */
export const compSeasonLabel = (c: Pick<Competition, 'seasonLabel'>) => c.seasonLabel ?? '';

/** Semana do ano (1–52) da data atual. */
export const weekOf = (date: string) => weekOfYear(date);

/**
 * Competição "principal" do clube: a liga nacional; sem liga, o estadual; senão a primeira em que aparece.
 * (Online/temporada antiga: a única liga do clube.)
 */
export function competitionOf(s: SeasonState, clubId: string): Competition | undefined {
  const mine = s.competitions.filter((c) => c.clubIds.includes(clubId));
  return mine.find((c) => c.type === 'league') ?? mine.find((c) => c.type === 'state') ?? mine[0];
}

const fixturesCache = new WeakMap<SeasonState, Map<string, Fixture[]>>();
/** Jogos do clube em TODAS as competições, por data. */
export function clubFixtures(s: SeasonState, clubId: string): Fixture[] {
  let m = fixturesCache.get(s);
  if (!m) fixturesCache.set(s, (m = new Map()));
  let out = m.get(clubId);
  if (!out) {
    out = [];
    for (const c of s.competitions) for (const f of c.fixtures) if (f.homeId === clubId || f.awayId === clubId) out.push(f);
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    m.set(clubId, out);
  }
  return out;
}

/** Jogo do clube na data atual ainda sem resultado (dia de jogo). */
export function fixtureToday(s: SeasonState, clubId: string): Fixture | null {
  return clubFixtures(s, clubId).find((f) => f.date === s.date && !f.result) ?? null;
}

export function upcomingFixtures(s: SeasonState, clubId: string, n = 5): Fixture[] {
  return clubFixtures(s, clubId)
    .filter((f) => !f.result && f.date >= s.date)
    .slice(0, n);
}

export function recentFixtures(s: SeasonState, clubId: string, n = 5): Fixture[] {
  return clubFixtures(s, clubId)
    .filter((f) => f.result)
    .slice(-n);
}

const standingsCache = new WeakMap<Competition, StandingRow[]>();
/** Classificação memorizada por objeto de competição (todos os jogos da competição). */
export function standingsOf(comp: Competition): StandingRow[] {
  let rows = standingsCache.get(comp);
  if (!rows) {
    rows = computeStandings(comp);
    standingsCache.set(comp, rows);
  }
  return rows;
}

export interface TableView {
  rows: StandingRow[];
  /** zona por posição (1-based) */
  zone: (pos: number) => Zone;
  /** rótulo da fase/grupo (competições com formato) */
  label?: string;
}

const tableCache = new WeakMap<Competition, Map<string, TableView>>();
/**
 * Tabela "do clube" numa competição: com formato, a fase de tabela mais adiantada em que ele está
 * (o grupo dele); sem formato, a classificação simples.
 */
export function clubTable(comp: Competition, clubId?: string): TableView {
  let m = tableCache.get(comp);
  if (!m) tableCache.set(comp, (m = new Map()));
  const key = clubId ?? '';
  const hit = m.get(key);
  if (hit) return hit;
  let out: TableView | null = null;
  const f = comp.format;
  if (f && comp.stages) {
    for (let i = f.stages.length - 1; i >= 0 && !out; i--) {
      const def = f.stages[i];
      const st = comp.stages[def.id];
      if (def.kind !== 'table' || !st || st.status === 'pending') continue;
      const tables = stageGroupTables(comp, def.id);
      let g = clubId ? tables.findIndex((rows) => rows.some((r) => r.clubId === clubId)) : 0;
      if (g < 0) {
        if (clubId) continue;
        g = 0;
      }
      const rows = tables[g] ?? [];
      const z = stageZones(comp, def.id, g, tables.length, rows.length);
      const gname = tables.length > 1 ? (def.groupNames?.[g] ?? `Grupo ${String.fromCharCode(65 + g)}`) : undefined;
      out = { rows, zone: (p) => czToZone(z(p)), label: [def.label ?? def.name, gname].filter(Boolean).join(' · ') };
    }
  }
  if (!out) {
    const rows = standingsOf(comp);
    out = { rows, zone: (p) => zoneOf(comp, p, rows.length) };
  }
  m.set(key, out);
  return out;
}

function czToZone(z: CZone | null): Zone {
  return z === 'playoff' ? 'relegation' : z;
}

export function positionOf(s: SeasonState, clubId: string, comp = competitionOf(s, clubId)): { pos: number; row: StandingRow; total: number } | null {
  if (!comp) return null;
  const t = clubTable(comp, clubId);
  // competição com formato sem fase de tabela para o clube (ex.: Copa do Brasil): sem "posição"
  if (comp.format && !t.label) return null;
  const rows = t.rows;
  const i = rows.findIndex((r) => r.clubId === clubId);
  return i >= 0 ? { pos: i + 1, row: rows[i], total: rows.length } : null;
}

/** (Fase 2) 'libertadores' / 'libpre' / 'sula': vagas continentais projetadas (Série A). */
export type Zone =
  | 'promotion' | 'relegation' | 'champion' | 'qualify' | 'libertadores' | 'libpre' | 'sula'
  /* (Etapa 2) vagas UEFA/AFC, playoffs de acesso e de rebaixamento, playoff das fases de liga (9º–24º) */
  | 'ucl' | 'uel' | 'uecl' | 'acl' | 'aclpo' | 'promoplayoff' | 'relplayoff' | 'koplayoff'
  | null;
/** Zonas coloridas: acesso (promoted) no topo das divisões inferiores, título na elite, rebaixamento embaixo. */
export function zoneOf(comp: Competition, pos: number, total: number): Zone {
  if (comp.relegated > 0 && pos > total - comp.relegated) return 'relegation';
  if (comp.promoted > 0 && pos <= comp.promoted) return 'promotion';
  if (pos === 1 && (comp.division ?? 1) === 1) return 'champion';
  return null;
}

export function roundsOf(comp: Competition): number {
  return comp.fixtures.reduce((m, f) => Math.max(m, f.round), 0);
}

/** Rodada "atual": a primeira com jogo pendente (ou a última). */
export function currentRound(comp: Competition): number {
  let min = Infinity;
  for (const f of comp.fixtures) if (!f.result && f.round < min) min = f.round;
  return Number.isFinite(min) ? min : roundsOf(comp);
}

export function unavailableOf(s: SeasonState, clubId: string): Set<string> {
  const c = s.clubs[clubId];
  // (Atualização 38) suspensão por competição: a do próximo jogo do clube
  return c ? unavailablePlayers(c, nextFixtureFor(s, clubId)?.competitionId) : new Set();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function resultFor(f: Fixture, clubId: string): 'W' | 'D' | 'L' | null {
  if (!f.result) return null;
  const mine = f.homeId === clubId ? f.result.home : f.result.away;
  const theirs = f.homeId === clubId ? f.result.away : f.result.home;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}
