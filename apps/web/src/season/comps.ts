/**
 * Leituras de competições com formato (Fase 1) para a UI: zonas de tabela derivadas do formato,
 * chave do mata-mata, situação do clube em cada competição, rótulos de jogos (fase, ida/volta, agregado).
 * Puras (sem React).
 */
import type { KnockoutStageDef, PickRule, StageDef, TableStageDef } from '@cosmicfut/shared';
import {
  aggregateBefore, finalRanking, groupName, stageGroupTables, tieSummaryOf,
  type Competition, type Fixture, type SeasonState, type StandingRow, type TieState, type TieSummary,
} from '@cosmicfut/engine';

/** 'playoff' = playoff contra o rebaixamento; (Etapa 2) 'koplayoff' = playoff das fases de liga (9º–24º);
 * 'promoplayoff' = playoff de acesso. */
export type CZone = 'champion' | 'promotion' | 'qualify' | 'playoff' | 'relegation' | 'koplayoff' | 'promoplayoff';

/* ═════════════════════ nomes e ordenação ═════════════════════ */

const TYPE_ORDER: Record<string, number> = { league: 0, continental: 1, cup: 2, supercup: 3, state: 4 };
const CONT_ORDER = ['LIBERTADORES', 'SULAMERICANA', 'RECOPA', 'UCL', 'UEL', 'UECL', 'UEFA-SUP', 'ACL', 'INTERCONTINENTAL', 'SUPERMUNDIAL'];
const contRank = (c: Competition) => (c.type === 'continental' ? (CONT_ORDER.indexOf(c.id) + 1 || 9) : 0);

/** Competições do clube, na ordem: liga nacional, continentais, copa, supercopa, estadual. */
export function myCompetitions(s: SeasonState, clubId: string): Competition[] {
  return s.competitions
    .filter((c) => c.clubIds.includes(clubId))
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || contRank(a) - contRank(b) || (a.division ?? 0) - (b.division ?? 0));
}

/** Nome curto (cards, chips). */
export function compShort(c: Competition): string {
  return c.name.replace(/^Brasileirão /, '').replace(/ CASASBAHIA$/i, '');
}

export function stageDefOf(c: Competition, stageId: string | undefined): StageDef | undefined {
  return stageId ? c.format?.stages.find((s) => s.id === stageId) : undefined;
}

export function stageTitle(def: StageDef): string {
  return def.label ? titleCase(def.label) : def.name;
}

const SMALL_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'a', 'o']);
/** "TAÇA GUANABARA" → "Taça Guanabara"; "QUADRANGULAR DO REBAIXAMENTO" → "Quadrangular do Rebaixamento". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/* ═════════════════════ zonas de tabela ═════════════════════ */

const stagesOf = (r: PickRule): string[] => ('stage' in r ? (Array.isArray(r.stage) ? r.stage : [r.stage]) : []);

/**
 * Zonas (classificação, acesso, rebaixamento, campeão) de uma tabela de fase, derivadas do formato.
 * `group`: índice do grupo; `groups`: quantos grupos a fase tem; `size`: clubes na tabela.
 */
export function stageZones(c: Competition, stageId: string, group: number, groups: number, size: number): (pos: number) => CZone | null {
  const f = c.format;
  const zones = new Map<number, CZone>();
  if (!f) return () => null;
  const set = (pos: number, z: CZone, strong = false) => {
    if (pos < 1 || pos > size) return;
    if (strong || !zones.has(pos)) zones.set(pos, z);
  };
  const appliesTo = (r: PickRule) => {
    if (!stagesOf(r).includes(stageId)) return false;
    if ('group' in r && r.group !== undefined) return r.group === group;
    return groups <= 1 || ('perGroup' in r && !!r.perGroup);
  };
  // classificados para as fases seguintes
  for (const s of f.stages) {
    if (s.id === stageId) continue;
    const rules = [...s.sources, ...(s.kind === 'table' ? (s.groupSources ?? []).flat() : [])];
    // (Etapa 2) playoff das fases de liga da UEFA (9º–24º) e playoff de acesso com cor própria
    const zone: CZone = s.relegationStage ? 'playoff'
      : s.kind === 'knockout' && s.seeding === 'uefa-playoff' ? 'koplayoff'
        : s.kind === 'knockout' && s.id === 'playoff' ? 'promoplayoff' : 'qualify';
    for (const r of rules) {
      if ('ranks' in r && appliesTo(r)) for (let p = r.ranks[0]; p <= r.ranks[1]; p++) set(p, zone);
      else if ('bestOfRank' in r && r.stage === stageId) set(r.bestOfRank, zone);
    }
  }
  for (const r of f.promotion ?? []) if ('ranks' in r && appliesTo(r)) for (let p = r.ranks[0]; p <= r.ranks[1]; p++) set(p, 'promotion', true);
  for (const r of f.relegation ?? []) if ('bottom' in r && 'stage' in r && appliesTo(r)) for (let p = size - r.bottom + 1; p <= size; p++) set(p, 'relegation', true);
  if (f.champion === stageId) set(1, 'champion', true);
  return (pos) => zones.get(pos) ?? null;
}

export interface GroupTable {
  name: string;
  rows: StandingRow[];
  zone: (pos: number) => CZone | null;
}

export function groupTables(c: Competition, stageId: string): GroupTable[] {
  const def = stageDefOf(c, stageId);
  if (!def || def.kind !== 'table') return [];
  const tables = stageGroupTables(c, stageId);
  return tables.map((rows, g) => ({
    name: tables.length > 1 ? groupName(def as TableStageDef, g) : stageTitle(def),
    rows,
    zone: stageZones(c, stageId, g, tables.length, rows.length),
  }));
}

/* ═════════════════════ mata-mata ═════════════════════ */

export interface TieView {
  tie: TieState;
  legs: Fixture[];
  agg: { a: number; b: number; played: boolean };
  /** pênaltis do jogo decisivo, do ponto de vista (a, b) */
  pens?: { a: number; b: number };
  anyPlayed: boolean;
  /** resumo completo da engine (advancing, decidedBy, gols fora…) */
  summary: TieSummary;
}

export interface BracketRound {
  name: string;
  index: number;
  ties: TieView[];
  /** confrontos ainda não sorteados nesta rodada */
  placeholders: number;
}

/** Confronto pela engine (`tieSummaryOf`: agregado, gols fora, pênaltis, quem avança e o critério). */
export function tieView(c: Competition, t: TieState): TieView {
  const s = tieSummaryOf(c, t);
  return {
    tie: t,
    legs: s.legs,
    agg: { a: s.aggregate.a, b: s.aggregate.b, played: s.played },
    pens: s.penalties,
    anyPlayed: s.legsPlayed > 0,
    summary: s,
  };
}

export function bracketOf(c: Competition, stageId: string): { rounds: BracketRound[]; third?: TieView } {
  const def = stageDefOf(c, stageId);
  const st = c.stages?.[stageId];
  if (!def || def.kind !== 'knockout') return { rounds: [] };
  const kd = def as KnockoutStageDef;
  const ties = st?.ties ?? [];
  const rounds: BracketRound[] = [];
  let expected = 0;
  kd.rounds.forEach((r, i) => {
    const list = ties.filter((t) => t.round === i && !t.thirdPlace).map((t) => tieView(c, t));
    if (i === 0) {
      const seeds = st?.seeds.length ?? 0;
      expected = list.length || Math.max(1, Math.floor((seeds - (kd.byes ?? 0)) / 2));
    } else {
      const prev = rounds[i - 1];
      const entrants = (prev.ties.length + prev.placeholders) + (i === 1 ? kd.byes ?? 0 : 0);
      expected = Math.max(1, Math.ceil(entrants / 2));
    }
    rounds.push({ name: r.name, index: i, ties: list, placeholders: Math.max(0, expected - list.length) });
  });
  const tp = ties.find((t) => t.thirdPlace);
  return { rounds, third: tp ? tieView(c, tp) : undefined };
}

/* ═════════════════════ situação do clube ═════════════════════ */

export interface ClubCompStatus {
  text: string;
  sub?: string;
  tone: 'gold' | 'good' | 'bad' | 'neutral';
}

function ordinal(n: number) {
  return `${n}º`;
}

export function clubStatusIn(c: Competition, clubId: string, name: (id: string) => string = (id) => id): ClubCompStatus {
  if (c.championId === clubId) return { text: 'Campeão', tone: 'gold' };
  const titles = (c.titles ?? []).filter((t) => t.clubId === clubId).map((t) => t.title);
  if (c.finished) {
    if (c.viceId === clubId) return { text: 'Vice-campeão', sub: titles.join(' · ') || undefined, tone: 'good' };
    if (c.relegatedIds?.includes(clubId)) return { text: 'Rebaixado', tone: 'bad' };
    if (c.promotedIds?.includes(clubId)) return { text: 'Acesso garantido', tone: 'good' };
    // copas: a fase em que caiu
    if (c.type !== 'league' && c.format && c.stages) {
      let lost: TieState | undefined;
      for (const s of c.format.stages) {
        if (s.kind !== 'knockout' || s.relegationStage) continue;
        for (const t of c.stages[s.id]?.ties ?? []) if (t.loser === clubId && !t.thirdPlace) lost = t;
      }
      if (lost) return { text: `Eliminado · ${lost.roundName}`, sub: titles.join(' · ') || undefined, tone: 'neutral' };
    }
    const pos = finalRanking(c).indexOf(clubId);
    return { text: pos >= 0 ? `${ordinal(pos + 1)} lugar (final)` : 'Encerrado', sub: titles.join(' · ') || undefined, tone: 'neutral' };
  }
  const f = c.format;
  if (!f || !c.stages) return { text: 'Em disputa', tone: 'neutral' };
  // fase mais adiantada em que o clube aparece
  for (let i = f.stages.length - 1; i >= 0; i--) {
    const def = f.stages[i];
    const st = c.stages[def.id];
    if (!st || st.status === 'pending') continue;
    if (def.kind === 'knockout') {
      const mine = (st.ties ?? []).filter((t) => t.a === clubId || t.b === clubId).sort((x, y) => y.round - x.round)[0];
      if (!mine) continue;
      const v = tieView(c, mine);
      const mineIsA = mine.a === clubId;
      const score = v.anyPlayed ? `${mineIsA ? v.agg.a : v.agg.b} x ${mineIsA ? v.agg.b : v.agg.a}${v.legs.length > 1 ? ' no agregado' : ''}` : undefined;
      if (mine.loser === clubId) return { text: `Eliminado · ${mine.roundName}`, sub: def.relegationStage ? 'Playoff de rebaixamento' : score, tone: 'bad' };
      if (mine.winner === clubId) return { text: `Classificado · ${mine.roundName}`, sub: score, tone: 'good' };
      return { text: mine.roundName, sub: score ?? `vs ${name(mineIsA ? mine.b : mine.a)}`, tone: 'neutral' };
    }
    const tables = stageGroupTables(c, def.id);
    const g = tables.findIndex((rows) => rows.some((r) => r.clubId === clubId));
    if (g < 0) continue;
    const rows = tables[g];
    const pos = rows.findIndex((r) => r.clubId === clubId) + 1;
    const zone = stageZones(c, def.id, g, tables.length, rows.length)(pos);
    const where = tables.length > 1 ? ` · ${groupName(def as TableStageDef, g)}` : '';
    const later = f.stages.slice(i + 1).some((s) => c.stages?.[s.id]?.seeds.includes(clubId));
    if (st.status === 'done' && !later && !zone) return { text: `Eliminado · ${def.name}`, sub: `${ordinal(pos)}${where}`, tone: 'bad' };
    if (!rows.some((r) => r.played > 0)) return { text: 'A estrear', sub: `${stageTitle(def)}${where}`, tone: 'neutral' };
    return {
      text: `${ordinal(pos)}${where}`,
      sub: `${rows[pos - 1].points} pts · ${rows[pos - 1].played} J · ${stageTitle(def)}`,
      tone: zone === 'relegation' ? 'bad' : zone ? 'good' : 'neutral',
    };
  }
  // ainda não estreou (ex.: pote 1 da Copa do Brasil entra nos 16-avos)
  const firstStage = f.stages.find((s) => s.sources.some((r) => 'entrants' in r && (c.entrants?.[r.entrants] ?? []).includes(clubId)));
  return { text: 'A estrear', sub: firstStage ? `entra em: ${firstStage.name}` : undefined, tone: 'neutral' };
}

/* ═════════════════════ jogo: rótulos ═════════════════════ */

export interface FixtureInfo {
  comp: Competition | undefined;
  compName: string;
  /** "Quartas de Final", "Fase de Grupos - Rodada 3"… */
  phase: string;
  legLabel?: 'Ida' | 'Volta' | 'Jogo único';
  tie?: TieState;
  /** placar das pernas anteriores do ponto de vista do mandante DESTE jogo */
  aggBefore?: { home: number; away: number };
  /** jogo de ida (quando este é a volta) */
  firstLeg?: Fixture;
}

export function fixtureInfo(s: SeasonState, f: Fixture): FixtureInfo {
  const comp = s.competitions.find((c) => c.id === f.competitionId);
  const def = comp ? stageDefOf(comp, f.stageId) : undefined;
  const tie = f.tieId ? comp?.stages?.[f.stageId ?? '']?.ties?.find((t) => t.id === f.tieId) : undefined;
  let phase = f.label ?? `Rodada ${f.round}`;
  if (tie) phase = def && def.name !== tie.roundName && (def as KnockoutStageDef).rounds?.length > 1 ? tie.roundName : f.label ?? tie.roundName;
  else if (def?.kind === 'table') {
    const grp = f.group !== undefined && (def as TableStageDef).groups && (def as TableStageDef).groups! > 1 ? ` · ${groupName(def as TableStageDef, f.group)}` : '';
    // rodada DENTRO da fase (o `round` do jogo é o índice global de datas da competição: grupos da Libertadores começam na 7)
    const rounds = comp ? [...new Set(comp.fixtures.filter((x) => x.stageId === f.stageId).map((x) => x.round))].sort((a, b) => a - b) : [];
    const r = rounds.indexOf(f.round) + 1 || f.round;
    phase = `${f.label ?? def.name}${grp} · Rodada ${r}`;
  }
  const legLabel = tie ? (tie.fixtureIds.length === 1 ? 'Jogo único' : f.leg === 2 ? 'Volta' : 'Ida') : undefined;
  const aggBefore = comp ? aggregateBefore(comp, f) : undefined;
  const firstLeg = tie && f.leg === 2 ? comp?.fixtures.find((x) => x.tieId === f.tieId && x.id !== f.id) : undefined;
  return { comp, compName: comp ? comp.name : f.competitionId, phase, legLabel, tie, aggBefore, firstLeg };
}

/** Linha curta: "Copa do Brasil · 3ª Fase (16-avos) · Volta". */
export function fixtureCaption(s: SeasonState, f: Fixture, withComp = true): string {
  const i = fixtureInfo(s, f);
  return [withComp ? compShort(i.comp ?? ({ name: i.compName } as Competition)) : null, i.phase, i.legLabel].filter(Boolean).join(' · ');
}

/** Artilharia: [{ playerId, clubId, goals }] ordenada. */
export function topScorers(c: Competition, n = 20): { playerId: string; clubId: string; goals: number }[] {
  return Object.entries(c.scorers ?? {})
    .map(([playerId, goals]) => ({ playerId, goals, clubId: c.scorerClubs?.[playerId] ?? playerId.split(':')[0] }))
    .sort((a, b) => b.goals - a.goals || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, n);
}

/** Fase "atual" de uma competição (a ativa mais adiantada; senão a última concluída; senão a 1ª). */
export function currentStageId(c: Competition): string | undefined {
  const f = c.format;
  if (!f) return undefined;
  // encerrada: a fase que decidiu o título
  if (c.finished && c.stages?.[f.champion]) return f.champion;
  const active = [...f.stages].reverse().find((s) => c.stages?.[s.id]?.status === 'active');
  if (active) return active.id;
  const done = [...f.stages].reverse().find((s) => c.stages?.[s.id]?.status === 'done');
  return (done ?? f.stages[0]).id;
}
