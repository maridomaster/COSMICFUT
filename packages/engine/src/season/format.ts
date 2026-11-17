/**
 * Modelo declarativo de competição (Fase 1) — fases `table` (pontos corridos, grupos, grupo x grupo,
 * rodadas parciais) e `knockout` (ida e volta / jogo único, pênaltis, byes de playoff-semi, 3º lugar,
 * títulos secundários). É o `checkProgression()` do original: quando todos os jogos de uma fase têm
 * resultado, as fases seguintes são geradas (os confrontos não são conhecidos de antemão).
 *
 * Puro e determinístico. As funções que mudam a competição MUTAM o objeto recebido
 * (advanceDay trabalha sobre uma cópia).
 */
import type { FormatDef, KnockoutStageDef, PickRule, StageDef, TableStageDef, TieRule } from '@cosmicfut/shared';
import type { Competition, Fixture, SeasonState, StageState, StandingRow, TieState } from '../contract';
import { Rng } from '../rng';
import { addDays, generateRoundRobin } from './schedule';
import { computeStandings } from './standings';
import { swissSchedule } from './swiss';

export interface FormatContext {
  /** seed base (sorteios e mandos) */
  seed: string;
  /** novos jogos só depois desta data (ISO, exclusiva) */
  minDate: string;
  /** índice geográfico da UF do clube (agrupamento 'region') */
  regionOf?: (clubId: string) => number;
  /** (Fase 2) país do clube — sorteio de grupos com `avoidSameCountry` */
  countryOf?: (clubId: string) => number | undefined;
}

/**
 * (Fase 2) Sorteio de grupos com potes e restrição de país (`drawGroups` da spec §7.2): um clube de cada pote
 * por grupo; tenta (até 200 vezes, determinístico) evitar dois clubes do mesmo país no mesmo grupo. Se não
 * houver solução, aceita o sorteio com menos repetições.
 */
export function drawGroups(seeds: string[], groups: number, rng: Rng, countryOf?: (id: string) => number | undefined): string[][] {
  let best: string[][] | null = null;
  let bestClash = Infinity;
  for (let attempt = 0; attempt < (countryOf ? 200 : 1); attempt++) {
    const out: string[][] = Array.from({ length: groups }, () => []);
    let clash = 0;
    for (let p = 0; p < seeds.length; p += groups) {
      const pot = rng.shuffle(seeds.slice(p, p + groups));
      const free = rng.shuffle(Array.from({ length: groups }, (_, g) => g));
      for (const c of pot) {
        const k = countryOf?.(c);
        let gi = countryOf ? free.findIndex((g) => !out[g].some((x) => k !== undefined && countryOf(x) === k)) : 0;
        if (gi < 0) { gi = 0; clash++; }
        out[free[gi]].push(c);
        free.splice(gi, 1);
      }
    }
    if (clash < bestClash) { best = out; bestClash = clash; }
    if (clash === 0) break;
  }
  return best!;
}

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const groupName = (def: TableStageDef, g: number) => def.groupNames?.[g] ?? `Grupo ${GROUP_LETTERS[g] ?? g + 1}`;

/* ═════════════════════ consultas ═════════════════════ */

export function stageDef(comp: Competition, stageId: string): StageDef | undefined {
  return comp.format?.stages.find((s) => s.id === stageId);
}

export function stageFixtures(comp: Competition, stageId: string | string[]): Fixture[] {
  const ids = new Set(Array.isArray(stageId) ? stageId : [stageId]);
  return comp.fixtures.filter((f) => f.stageId !== undefined && ids.has(f.stageId));
}

/** Tabela de um conjunto de clubes considerando só os jogos informados. */
export function tableOf(clubIds: string[], fixtures: Fixture[]): StandingRow[] {
  const ids = new Set(clubIds);
  // Conta todo jogo da fase em que ao menos um clube do conjunto jogou: em formatos com grupos que
  // enfrentam o OUTRO grupo (ex.: Taça Guanabara do Carioca) os jogos são entre grupos diferentes e,
  // filtrando só jogos internos, a tabela ficava zerada (e a classificação para a fase seguinte errada).
  // Os adversários de fora entram só no cálculo e são removidos do resultado.
  const fx = fixtures.filter((f) => ids.has(f.homeId) || ids.has(f.awayId));
  const all = new Set(clubIds);
  for (const f of fx) { all.add(f.homeId); all.add(f.awayId); }
  return computeStandings({
    id: '', name: '', type: 'league', clubIds: [...all], doubleRound: false, relegated: 0, promoted: 0,
    fixtures: fx,
  }).filter((r) => ids.has(r.clubId));
}

/** Comparação entre linhas de grupos diferentes: pontos, vitórias, saldo, gols pró, id. */
export function compareRows(x: StandingRow, y: StandingRow): number {
  return y.points - x.points || y.won - x.won ||
    (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor ||
    (x.clubId < y.clubId ? -1 : 1);
}

/**
 * Classificação de uma fase de tabela. `group` = índice do grupo; omitido = todos os grupos juntos
 * (os clubes de grupos diferentes são comparados pelos critérios gerais).
 * Aceita várias fases (tabela somada, ex.: Apertura + Clausura).
 */
export function stageStandings(comp: Competition, stageId: string | string[], group?: number): StandingRow[] {
  const ids = Array.isArray(stageId) ? stageId : [stageId];
  if (ids.length === 1) {
    const st = comp.stages?.[ids[0]];
    const fx = stageFixtures(comp, ids[0]);
    const groups = st?.groups ?? (st ? [st.seeds] : []);
    const t = (g: string[]) => withCarry(comp, ids[0], tableOf(g, fx));
    if (group !== undefined) return groups[group] ? t(groups[group]) : [];
    if (groups.length <= 1) return t(groups[0] ?? []);
    return groups.flatMap((g) => t(g)).sort(compareRows);
  }
  const clubs = new Set<string>();
  for (const id of ids) for (const c of comp.stages?.[id]?.seeds ?? []) clubs.add(c);
  return tableOf([...clubs], stageFixtures(comp, ids));
}

/** Tabelas por grupo de uma fase. */
export function stageGroupTables(comp: Competition, stageId: string): StandingRow[][] {
  const st = comp.stages?.[stageId];
  if (!st) return [];
  const fx = stageFixtures(comp, stageId);
  return (st.groups ?? [st.seeds]).map((g) => withCarry(comp, stageId, tableOf(g, fx)));
}

/**
 * (Etapa 2) Fase com `carry` (LigaPro): soma os números da fase de origem (pontos, jogos, gols) aos da fase e
 * reordena. Sem `carry` devolve as linhas como vieram.
 */
function withCarry(comp: Competition, stageId: string, rows: StandingRow[]): StandingRow[] {
  const def = comp.format?.stages.find((s) => s.id === stageId);
  if (!def || def.kind !== 'table' || !def.carry || !comp.stages?.[def.carry]) return rows;
  const src = new Map(stageStandings(comp, def.carry).map((r) => [r.clubId, r]));
  return rows.map((r) => {
    const c = src.get(r.clubId);
    if (!c) return r;
    return {
      ...r, played: r.played + c.played, won: r.won + c.won, drawn: r.drawn + c.drawn, lost: r.lost + c.lost,
      goalsFor: r.goalsFor + c.goalsFor, goalsAgainst: r.goalsAgainst + c.goalsAgainst, points: r.points + c.points,
    };
  }).sort(compareRows);
}

/** Classificação geral (todos os jogos, incluindo mata-matas) — "CLASSIFICAÇÃO GERAL (incluindo mata-matas)". */
export function overallStandings(comp: Competition): StandingRow[] {
  return computeStandings(comp);
}

/**
 * Ordem final da competição: campeão, vice, depois pelo avanço no mata-mata principal
 * (quem caiu mais tarde fica à frente) e pela classificação geral.
 */
export function finalRanking(comp: Competition): string[] {
  const overall = overallStandings(comp);
  const pos = new Map(overall.map((r, i) => [r.clubId, i]));
  const depth = new Map<string, number>();
  if (comp.format && comp.stages) {
    // só o caminho do título principal: a fase do campeão e as fases de que ela depende
    const main = new Set<string>();
    const stack = [comp.format.champion];
    while (stack.length) {
      const id = stack.pop()!;
      if (main.has(id)) continue;
      main.add(id);
      const d = stageDef(comp, id);
      if (d) stack.push(...stageDeps(d));
    }
    comp.format.stages.forEach((def, si) => {
      if (def.kind !== 'knockout' || !main.has(def.id) || def.relegationStage) return;
      const st = comp.stages![def.id];
      for (const t of st?.ties ?? []) {
        if (t.thirdPlace) continue;
        const d = (si + 1) * 100 + t.round + 1;
        for (const c of [t.a, t.b]) depth.set(c, Math.max(depth.get(c) ?? 0, d));
        if (t.winner) depth.set(t.winner, Math.max(depth.get(t.winner) ?? 0, d + 0.5));
      }
    });
  }
  const order = comp.clubIds.slice().sort((a, b) =>
    (depth.get(b) ?? 0) - (depth.get(a) ?? 0) || (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
  const top = [comp.championId, comp.viceId].filter((x): x is string => !!x);
  return [...top, ...order.filter((c) => !top.includes(c))];
}

/* ═════════════════════ seleção (PickRule) ═════════════════════ */

function ranksPerGroup(tables: StandingRow[][], from: number, to: number): string[] {
  const out: string[] = [];
  for (let r = from; r <= to; r++) {
    const rows = tables.map((t) => t[r - 1]).filter((x): x is StandingRow => !!x).sort(compareRows);
    out.push(...rows.map((x) => x.clubId));
  }
  return out;
}

/** Avalia uma regra de seleção. Retorna clubes em ordem de semente (melhor primeiro). */
export function pick(comp: Competition, rule: PickRule): string[] {
  if ('entrants' in rule) {
    const list = rule.entrants === 'all' && !comp.entrants?.all ? comp.clubIds : comp.entrants?.[rule.entrants] ?? [];
    return list.slice((rule.from ?? 1) - 1, rule.to ?? list.length);
  }
  if ('overall' in rule) {
    const t = overallStandings(comp);
    return t.slice(Math.max(0, t.length - rule.bottom)).map((r) => r.clubId);
  }
  if ('winners' in rule || 'losers' in rule) {
    const st = comp.stages?.[rule.stage];
    if (!st) return [];
    const isWin = 'winners' in rule;
    if (!rule.round) return (isWin ? st.winners : st.losers)?.slice() ?? [];
    const seedIdx = new Map(st.seeds.map((c, i) => [c, i]));
    const ties = (st.ties ?? []).filter((t) => t.roundName === rule.round && !t.thirdPlace);
    return ties
      .map((t) => (isWin ? t.winner : t.loser))
      .filter((x): x is string => !!x)
      .sort((a, b) => (seedIdx.get(a) ?? 0) - (seedIdx.get(b) ?? 0));
  }
  if ('bestOfRank' in rule) {
    const tables = stageGroupTables(comp, rule.stage);
    return ranksPerGroup(tables, rule.bestOfRank, rule.bestOfRank).slice(0, rule.count);
  }
  if ('bestRest' in rule) {
    const taken = new Set<string>();
    for (const sid of rule.exclude) for (const c of comp.stages?.[sid]?.seeds ?? []) taken.add(c);
    return stageStandings(comp, rule.stage).map((r) => r.clubId).filter((c) => !taken.has(c)).slice(0, rule.bestRest);
  }
  if ('bottom' in rule) {
    if (rule.perGroup && !Array.isArray(rule.stage)) {
      const tables = stageGroupTables(comp, rule.stage);
      const out: string[] = [];
      for (const t of tables) out.push(...t.slice(Math.max(0, t.length - rule.bottom)).map((r) => r.clubId));
      return out;
    }
    const t = stageStandings(comp, rule.stage);
    return t.slice(Math.max(0, t.length - rule.bottom)).map((r) => r.clubId);
  }
  // ranks
  const [from, to] = rule.ranks;
  if (Array.isArray(rule.stage)) return stageStandings(comp, rule.stage).slice(from - 1, to).map((r) => r.clubId);
  if (rule.group !== undefined) return stageStandings(comp, rule.stage, rule.group).slice(from - 1, to).map((r) => r.clubId);
  if (rule.perGroup) return ranksPerGroup(stageGroupTables(comp, rule.stage), from, to);
  return stageStandings(comp, rule.stage).slice(from - 1, to).map((r) => r.clubId);
}

/** Avalia várias regras sem repetir clubes. */
export function pickAll(comp: Competition, rules: PickRule[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rules ?? []) for (const c of pick(comp, r)) if (!seen.has(c)) { seen.add(c); out.push(c); }
  return out;
}

function ruleStages(r: PickRule): string[] {
  if ('entrants' in r || 'overall' in r) return [];
  return Array.isArray(r.stage) ? r.stage : [r.stage];
}

/** Fases das quais a fase depende. */
export function stageDeps(def: StageDef): string[] {
  if (def.after) return def.after;
  const s = new Set<string>();
  for (const r of def.sources) for (const x of ruleStages(r)) s.add(x);
  if (def.kind === 'table') for (const g of def.groupSources ?? []) for (const r of g) for (const x of ruleStages(r)) s.add(x);
  return [...s];
}

/* ═════════════════════ calendário da competição ═════════════════════ */

/** Dias entre datas estendidas quando o calendário acaba. */
export const CALENDAR_EXTENSION_DAYS = 4;

/** Índice da 1ª data do calendário (>= start) posterior a `minDate`. Estende o calendário se preciso. */
function slotAfter(comp: Competition, minDate: string, start = 0): number {
  const cal = (comp.calendar ??= []);
  for (let i = Math.max(0, start); i < cal.length; i++) if (cal[i] > minDate) return i;
  let last = cal.length ? cal[cal.length - 1] : minDate;
  if (last < minDate) last = minDate;
  for (;;) {
    last = addDays(last, CALENDAR_EXTENSION_DAYS);
    cal.push(last);
    if (last > minDate && cal.length - 1 >= start) return cal.length - 1;
  }
}

/** `count` slots consecutivos a partir do 1º livre depois de minDate (e de `start`). */
function takeSlots(comp: Competition, minDate: string, count: number, start = 0): number[] {
  const out: number[] = [];
  let d = minDate;
  let s = start;
  for (let k = 0; k < count; k++) {
    const i = slotAfter(comp, d, s);
    out.push(i);
    d = comp.calendar![i];
    s = i + 1;
  }
  return out;
}

function lastDateOf(fixtures: Fixture[]): string {
  let m = '';
  for (const f of fixtures) if (f.date > m) m = f.date;
  return m;
}

/* ═════════════════════ geração de rodadas ═════════════════════ */

interface Pair { homeId: string; awayId: string }

/** Rodadas de um grupo em todos-contra-todos (opcionalmente parcial). */
function groupRounds(ids: string[], legs: 1 | 2, seed: string, partial?: number): Pair[][] {
  const rr = generateRoundRobin(ids, false, seed);
  const n = rr.reduce((m, x) => Math.max(m, x.round), 0);
  const rounds: Pair[][] = Array.from({ length: n }, () => []);
  for (const m of rr) rounds[m.round - 1].push({ homeId: m.homeId, awayId: m.awayId });
  const first = partial && partial < n ? rounds.slice(0, partial) : rounds;
  if (legs === 1) return first;
  return [...first, ...first.map((r) => r.map((p) => ({ homeId: p.awayId, awayId: p.homeId })))];
}

/** "Grupo x grupo": cada clube enfrenta todos os clubes dos outros grupos. */
function crossRounds(groups: string[][], legs: 1 | 2, seed: string): Pair[][] {
  let rounds: Pair[][];
  if (groups.length === 2 && groups[0].length === groups[1].length) {
    // bipartido completo: A_i × B_(i+r) — k rodadas exatas
    const [A, B] = groups;
    const k = A.length;
    rounds = [];
    for (let r = 0; r < k; r++) {
      const round: Pair[] = [];
      for (let i = 0; i < k; i++) {
        const a = A[i], b = B[(i + r) % k];
        round.push((i + r) % 2 === 0 ? { homeId: a, awayId: b } : { homeId: b, awayId: a });
      }
      rounds.push(round);
    }
  } else {
    const pairs: [string, string][] = [];
    for (let g = 0; g < groups.length; g++)
      for (let h = g + 1; h < groups.length; h++)
        for (const a of groups[g]) for (const b of groups[h]) pairs.push([a, b]);
    const degree = new Map<string, number>();
    for (const [a, b] of pairs) { degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1); }
    const target = Math.max(0, ...degree.values());
    const rng = new Rng(seed + ':cross');
    let best: [string, string][][] | null = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const order = rng.shuffle(pairs);
      const rs: [string, string][][] = [];
      const busy: Set<string>[] = [];
      for (const p of order) {
        let r = 0;
        while (r < rs.length && (busy[r].has(p[0]) || busy[r].has(p[1]))) r++;
        if (r === rs.length) { rs.push([]); busy.push(new Set()); }
        rs[r].push(p); busy[r].add(p[0]); busy[r].add(p[1]);
      }
      if (!best || rs.length < best.length) best = rs;
      if (rs.length <= target) break;
    }
    // mando equilibrado
    const bal = new Map<string, number>();
    rounds = (best ?? []).map((r) => r.map(([a, b]) => {
      const ba = bal.get(a) ?? 0, bb = bal.get(b) ?? 0;
      const [h, w] = ba <= bb ? [a, b] : [b, a];
      bal.set(h, (bal.get(h) ?? 0) + 1); bal.set(w, (bal.get(w) ?? 0) - 1);
      return { homeId: h, awayId: w };
    }));
  }
  if (legs === 1) return rounds;
  return [...rounds, ...rounds.map((r) => r.map((p) => ({ homeId: p.awayId, awayId: p.homeId })))];
}

/** Distribui participantes (em ordem de semente) em grupos. */
function distribute(seeds: string[], groups: number, mode: TableStageDef['grouping'], rng: Rng, regionOf?: (id: string) => number): string[][] {
  const out: string[][] = Array.from({ length: groups }, () => []);
  if (groups <= 1) return [seeds.slice()];
  if (mode === 'region') {
    const idx = new Map(seeds.map((c, i) => [c, i]));
    const sorted = seeds.slice().sort((a, b) => (regionOf?.(a) ?? 0) - (regionOf?.(b) ?? 0) || idx.get(a)! - idx.get(b)!);
    const size = Math.ceil(sorted.length / groups);
    sorted.forEach((c, i) => out[Math.min(groups - 1, Math.floor(i / size))].push(c));
    return out;
  }
  if (mode === 'order') {
    const size = Math.ceil(seeds.length / groups);
    seeds.forEach((c, i) => out[Math.min(groups - 1, Math.floor(i / size))].push(c));
    return out;
  }
  if (mode === 'draw') {
    // potes de `groups` clubes (pela semente), um de cada pote por grupo, sorteado
    for (let p = 0; p < seeds.length; p += groups) {
      const pot = rng.shuffle(seeds.slice(p, p + groups));
      const order = rng.shuffle(Array.from({ length: groups }, (_, g) => g));
      pot.forEach((c, i) => out[order[i]].push(c));
    }
    return out;
  }
  // snake (padrão)
  seeds.forEach((c, i) => {
    const row = Math.floor(i / groups), col = i % groups;
    out[row % 2 === 0 ? col : groups - 1 - col].push(c);
  });
  return out;
}

/* ═════════════════════ construção das fases ═════════════════════ */

function addFixture(comp: Competition, f: Omit<Fixture, 'id' | 'competitionId'>): Fixture {
  let id = `${comp.id}:${f.round}:${f.homeId}-${f.awayId}`;
  if (comp.fixtures.some((x) => x.id === id)) id += `:${f.stageId}`;
  const fx: Fixture = { id, competitionId: comp.id, ...f };
  comp.fixtures.push(fx);
  return fx;
}

function buildTable(comp: Competition, def: TableStageDef, ctx: FormatContext): StageState {
  const rng = new Rng(`${ctx.seed}:${comp.id}:${def.id}`);
  let groups: string[][];
  let seeds: string[];
  if (def.groupSources) {
    const used = new Set<string>();
    groups = def.groupSources.map((rules) => pickAll(comp, rules).filter((c) => !used.has(c) && (used.add(c), true)));
    seeds = groups.flat();
  } else {
    seeds = pickAll(comp, def.sources);
    groups = def.avoidSameCountry && (def.groups ?? 1) > 1
      ? drawGroups(seeds, def.groups!, rng, ctx.countryOf)
      : distribute(seeds, def.groups ?? 1, def.grouping, rng, ctx.regionOf);
  }
  const st: StageState = { id: def.id, status: 'active', seeds, groups: groups.length > 1 ? groups : undefined };
  let rounds: { pair: Pair; group?: number }[][];
  // (Etapa 2) modelo suíço por grupo (UEFA: fase inteira; AFC: Oeste e Leste); sem potes válidos, rodadas parciais
  const swiss = def.swiss
    ? groups.map((g, gi) => swissSchedule(g, def.swiss!.pots, def.swiss!.perPot, new Rng(`${ctx.seed}:${comp.id}:${def.id}:swiss:${gi}`), ctx.countryOf)
      ?? groupRounds(g, 1, `${ctx.seed}:${comp.id}:${def.id}:${gi}`, def.swiss!.pots * def.swiss!.perPot).map((r) => r.map((p) => [p.homeId, p.awayId] as [string, string])))
    : null;
  if (swiss) {
    const n = swiss.reduce((m, r) => Math.max(m, r.length), 0);
    rounds = Array.from({ length: n }, (_, r) => swiss.flatMap((g, gi) => (g[r] ?? []).map(([homeId, awayId]) => ({ pair: { homeId, awayId }, group: groups.length > 1 ? gi : undefined }))));
  } else if (def.crossGroups && groups.length > 1) {
    rounds = crossRounds(groups, def.legs, rng.next().toString()).map((r) => r.map((pair) => ({ pair })));
  } else {
    const per = groups.map((g, gi) => groupRounds(g, def.legs, `${ctx.seed}:${comp.id}:${def.id}:${gi}`, def.partialRounds));
    const n = per.reduce((m, r) => Math.max(m, r.length), 0);
    rounds = Array.from({ length: n }, (_, r) => per.flatMap((g, gi) => (g[r] ?? []).map((pair) => ({ pair, group: groups.length > 1 ? gi : undefined }))));
  }
  const slots = takeSlots(comp, ctx.minDate, rounds.length, def.slotStart ?? 0);
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((c) => groupOf.set(c, gi)));
  rounds.forEach((r, ri) => {
    for (const { pair } of r) {
      addFixture(comp, {
        round: slots[ri] + 1,
        date: comp.calendar![slots[ri]],
        homeId: pair.homeId,
        awayId: pair.awayId,
        stageId: def.id,
        group: groups.length > 1 && !def.crossGroups ? groupOf.get(pair.homeId) : undefined,
        label: def.label ?? def.name,
      });
    }
  });
  if (rounds.length === 0) st.status = 'done';
  return st;
}

/** Pareia participantes de uma rodada (em ordem de semente). Retorna pares [melhor, pior] e o eventual bye. */
function pairRound(list: string[], seeding: KnockoutStageDef['seeding'], first: boolean, rng: Rng, groupsHint?: string[][], countryOf?: (id: string) => number | undefined): { pairs: [string, string][]; bye: string[] } {
  const bye: string[] = [];
  const l = list.slice();
  if (l.length % 2 === 1) bye.push(l.shift()!); // melhor semente folga
  const pairs: [string, string][] = [];
  const mode = seeding ?? 'table';
  if (mode === 'draw') {
    const s = rng.shuffle(l);
    for (let i = 0; i < s.length; i += 2) pairs.push(order2(s[i], s[i + 1], l));
  } else if (mode === 'pots') {
    const half = l.length / 2;
    const top = l.slice(0, half);
    let bottom = rng.shuffle(l.slice(half));
    const t = rng.shuffle(top);
    if (countryOf) {
      // (Fase 2) evita confronto entre clubes do mesmo país (até 60 novos sorteios, determinísticos)
      const clashes = (b: string[]) => t.reduce((n, c, i) => n + (countryOf(c) !== undefined && countryOf(c) === countryOf(b[i]) ? 1 : 0), 0);
      let best = bottom, bc = clashes(bottom);
      for (let k = 0; k < 60 && bc > 0; k++) {
        const b = rng.shuffle(l.slice(half));
        const c = clashes(b);
        if (c < bc) { best = b; bc = c; }
      }
      bottom = best;
    }
    for (let i = 0; i < half; i++) pairs.push([t[i], bottom[i]]);
  } else if (mode === 'order') {
    for (let i = 0; i < l.length; i += 2) pairs.push([l[i], l[i + 1]]);
  } else if (mode === 'cross' && first && groupsHint && groupsHint.length === 2 &&
    l.filter((c) => groupsHint[0].includes(c)).length === l.filter((c) => groupsHint[1].includes(c)).length) {
    // A1×B(k), B1×A(k), A2×B(k-1), B2×A(k-1)...
    const [A, B] = groupsHint;
    const inA = l.filter((c) => A.includes(c)), inB = l.filter((c) => B.includes(c));
    const k = inA.length;
    for (let i = 0; i < Math.floor(k / 2); i++) {
      pairs.push(order2(inA[i], inB[k - 1 - i], l));
      pairs.push(order2(inB[i], inA[k - 1 - i], l));
    }
    if (k % 2 === 1) pairs.push(order2(inA[(k - 1) / 2], inB[(k - 1) / 2], l));
  } else {
    for (let i = 0; i < l.length / 2; i++) pairs.push([l[i], l[l.length - 1 - i]]);
  }
  return { pairs, bye };
}
function order2(a: string, b: string, seeds: string[]): [string, string] {
  return seeds.indexOf(a) <= seeds.indexOf(b) ? [a, b] : [b, a];
}

function createTie(comp: Competition, def: KnockoutStageDef, st: StageState, roundIdx: number, roundName: string, tie: TieRule, a: string, b: string, slots: number[], thirdPlace = false): TieState {
  const n = (st.ties ??= []).length;
  const t: TieState = { id: `${comp.id}:${def.id}:${roundIdx}:${n}`, round: roundIdx, roundName, a, b, fixtureIds: [], thirdPlace: thirdPlace || undefined };
  const label = `${def.label ?? def.title ?? def.name} - ${roundName}`;
  const penalties = tie.penalties !== false;
  if (tie.legs === 1) {
    const [h, w] = tie.home === 'worse' ? [b, a] : [a, b];
    const f = addFixture(comp, {
      round: slots[0] + 1, date: comp.calendar![slots[0]], homeId: h, awayId: w,
      stageId: def.id, tieId: t.id, leg: undefined, knockout: penalties || undefined,
      extraTime: tie.extraTime || undefined, neutral: tie.neutral || undefined, label,
    });
    t.fixtureIds.push(f.id);
  } else {
    // a melhor semente manda o 2º jogo
    const f1 = addFixture(comp, {
      round: slots[0] + 1, date: comp.calendar![slots[0]], homeId: b, awayId: a,
      stageId: def.id, tieId: t.id, leg: 1, label: `${label} (ida)`,
    });
    const f2 = addFixture(comp, {
      round: slots[1] + 1, date: comp.calendar![slots[1]], homeId: a, awayId: b,
      stageId: def.id, tieId: t.id, leg: 2, knockout: penalties || undefined,
      extraTime: tie.extraTime || undefined, label: `${label} (volta)`,
    });
    t.fixtureIds.push(f1.id, f2.id);
  }
  st.ties.push(t);
  return t;
}

function roundSlots(comp: Competition, def: KnockoutStageDef, roundIdx: number, minDate: string): number[] {
  const rd = def.rounds[roundIdx];
  const legs = rd.tie.legs;
  if (rd.slots && rd.slots.length >= legs) {
    const cal = comp.calendar ?? [];
    const ok = rd.slots.slice(0, legs).every((i, k, arr) => cal[i] !== undefined && cal[i] > minDate && (k === 0 || cal[i] > cal[arr[k - 1]]));
    if (ok) return rd.slots.slice(0, legs);
  }
  const start = roundIdx === 0 ? def.slotStart ?? 0 : 0;
  return takeSlots(comp, minDate, legs, start);
}

/**
 * (Etapa 2) Pareamento da UEFA a partir da tabela da fase de liga (`def.rankStage`):
 *  - 'uefa-playoff' (9º–24º): 9/10 × 23/24, 11/12 × 21/22, 13/14 × 19/20, 15/16 × 17/18 (sorteio dentro de cada
 *    bloco; o mais bem colocado decide em casa);
 *  - 'uefa-r16' (1º–8º + 8 vencedores do playoff): 1/2 × vencedores de 15/16 × 17/18, 3/4 × de 13/14 × 19/20,
 *    5/6 × de 11/12 × 21/22, 7/8 × de 9/10 × 23/24; confrontos criados na ordem da chave (1, 8, 4, 5, 2, 7, 3, 6:
 *    1º e 2º só se cruzam na final) — com `bracket`, as rodadas seguintes seguem a chave.
 * null = participantes fora do padrão (cai no pareamento por tabela).
 */
function uefaPairs(comp: Competition, def: KnockoutStageDef, participants: string[], rng: Rng): [string, string][] | null {
  if (!def.rankStage) return null;
  const table = stageStandings(comp, def.rankStage).map((r) => r.clubId);
  const rank = (id: string) => table.indexOf(id) + 1;
  // bloco do playoff (0 = 9/10×23/24 … 3 = 15/16×17/18) pela posição na liga
  const block = (r: number) => (r <= 16 ? Math.floor((r - 9) / 2) : Math.floor((24 - r) / 2));
  if (def.seeding === 'uefa-playoff') {
    if (participants.length !== 16 || participants.some((c) => rank(c) < 9 || rank(c) > 24)) return null;
    const out: [string, string][] = [];
    for (let s = 3; s >= 0; s--) {
      const seeded = participants.filter((c) => rank(c) <= 16 && block(rank(c)) === s).sort((a, b) => rank(a) - rank(b));
      const unseeded = rng.shuffle(participants.filter((c) => rank(c) > 16 && block(rank(c)) === s));
      if (seeded.length !== 2 || unseeded.length !== 2) return null;
      out.push([seeded[0], unseeded[0]], [seeded[1], unseeded[1]]);
    }
    return out;
  }
  if (participants.length !== 16) return null;
  const top = participants.filter((c) => rank(c) >= 1 && rank(c) <= 8);
  const ch = participants.filter((c) => rank(c) > 8);
  if (top.length !== 8 || ch.length !== 8) return null;
  const byTop = new Map<number, [string, string]>();
  for (let t = 0; t < 4; t++) {
    const tops = top.filter((c) => Math.floor((rank(c) - 1) / 2) === t).sort((a, b) => rank(a) - rank(b));
    const opp = rng.shuffle(ch.filter((c) => block(rank(c)) === 3 - t));
    if (tops.length !== 2 || opp.length !== 2) return null;
    tops.forEach((c, k) => byTop.set(rank(c), [c, opp[k]]));
  }
  return [1, 8, 4, 5, 2, 7, 3, 6].map((r) => byTop.get(r)!);
}

function buildKnockoutRound(comp: Competition, def: KnockoutStageDef, st: StageState, roundIdx: number, participants: string[], ctx: FormatContext, groupsHint?: string[][]): string[] {
  const rng = new Rng(`${ctx.seed}:${comp.id}:${def.id}:r${roundIdx}`);
  const rd = def.rounds[roundIdx];
  const uefa = (def.seeding === 'uefa-playoff' || def.seeding === 'uefa-r16') && roundIdx === (st.round ?? 0) && !(st.ties ?? []).length
    ? uefaPairs(comp, def, participants, rng) : null;
  const { pairs, bye } = uefa
    ? { pairs: uefa, bye: [] as string[] }
    : pairRound(participants, def.seeding?.startsWith('uefa') ? 'table' : def.seeding, roundIdx === 0, rng, groupsHint, def.avoidSameCountry && roundIdx === 0 ? ctx.countryOf : undefined);
  if (!pairs.length) return bye;
  const slots = roundSlots(comp, def, roundIdx, ctx.minDate);
  for (const [a, b] of pairs) createTie(comp, def, st, roundIdx, rd.name, rd.tie, a, b, slots);
  return bye;
}

function buildKnockout(comp: Competition, def: KnockoutStageDef, ctx: FormatContext): StageState {
  const seeds = pickAll(comp, def.sources);
  const st: StageState = { id: def.id, status: 'active', seeds, round: 0, ties: [] };
  if (seeds.length < 2 || !def.rounds.length) {
    st.status = 'done';
    st.winners = seeds.slice(0, 1);
    st.losers = [];
    return st;
  }
  const byes = Math.min(def.byes ?? 0, seeds.length - 2);
  const first = seeds.slice(byes);
  // menos participantes que o previsto: pula as rodadas iniciais (os nomes das últimas valem)
  if (!byes) {
    const need = Math.max(1, Math.ceil(Math.log2(first.length)));
    st.round = Math.max(0, def.rounds.length - need);
  }
  // dica de grupos para pareamento 'cross' (clubes vindos de uma fase de 2 grupos)
  let hint: string[][] | undefined;
  if (def.seeding === 'cross') {
    const src = def.sources.find((r) => 'stage' in r && !Array.isArray(r.stage)) as { stage: string } | undefined;
    hint = src ? comp.stages?.[src.stage]?.groups : undefined;
  }
  const bye = buildKnockoutRound(comp, def, st, st.round ?? 0, first, ctx, hint);
  (st as StageState & { byes?: string[] }).byes = [...seeds.slice(0, byes), ...bye];
  return st;
}

/* ═════════════════════ confrontos ═════════════════════ */

/** Gols de cada lado do confronto (a, b) e gols fora. */
export function tieAggregate(comp: Competition, t: TieState): { a: number; b: number; awayA: number; awayB: number; played: boolean } {
  let a = 0, b = 0, awayA = 0, awayB = 0, played = true;
  for (const id of t.fixtureIds) {
    const f = comp.fixtures.find((x) => x.id === id);
    if (!f?.result) { played = false; continue; }
    const ga = f.homeId === t.a ? f.result.home : f.result.away;
    const gb = f.homeId === t.a ? f.result.away : f.result.home;
    a += ga; b += gb;
    if (f.homeId === t.a) awayB += gb; else awayA += ga;
  }
  return { a, b, awayA, awayB, played };
}

/** Placar acumulado das pernas anteriores, do ponto de vista do jogo `f` (para MatchConfig.aggregate). */
export function aggregateBefore(comp: Competition, f: Fixture): { home: number; away: number } | undefined {
  if (!f.tieId || f.leg !== 2) return undefined;
  let home = 0, away = 0;
  for (const x of comp.fixtures) {
    if (x.tieId !== f.tieId || x.id === f.id || !x.result) continue;
    home += x.homeId === f.homeId ? x.result.home : x.result.away;
    away += x.homeId === f.homeId ? x.result.away : x.result.home;
  }
  return { home, away };
}

/** (13/11) Resumo consultável de um confronto de mata-mata (ver `tieSummary`). Ponto de vista (a, b): `a` é a melhor semente. */
export interface TieSummary {
  tieId: string;
  competitionId: string;
  stageId: string;
  round: number;
  roundName: string;
  a: string;
  b: string;
  thirdPlace?: boolean;
  /** jogos do confronto, em ordem (ida, volta) — jogo único: 1 */
  legs: Fixture[];
  /** gols somados das pernas JÁ disputadas */
  aggregate: { a: number; b: number };
  /** gols marcados fora de casa (pernas disputadas; jogo neutro conta como "fora" do visitante nominal) */
  awayGoals: { a: number; b: number };
  /** pênaltis do jogo decisivo (se houve) */
  penalties?: { a: number; b: number };
  /** todas as pernas disputadas */
  played: boolean;
  /** pernas disputadas */
  legsPlayed: number;
  /** clube que avança (null enquanto o confronto não terminou) */
  advancing: string | null;
  eliminated: string | null;
  /** critério que decidiu (null enquanto o confronto não terminou) */
  decidedBy: 'aggregate' | 'away-goals' | 'penalties' | null;
  /** o confronto tem regra de gol fora */
  awayGoalsRule: boolean;
}

/** Regra (TieRule) de um confronto, a partir do formato. */
function tieRuleOf(comp: Competition, stageId: string, t: TieState): TieRule | undefined {
  const def = comp.format?.stages.find((s) => s.id === stageId);
  if (!def || def.kind !== 'knockout') return undefined;
  return t.thirdPlace ? def.thirdPlace ?? def.rounds[t.round]?.tie : def.rounds[t.round]?.tie;
}

/** Resumo de um confronto de uma competição (agregado, quem avança e por qual critério). Puro. */
export function tieSummaryOf(comp: Competition, t: TieState, stageId?: string): TieSummary {
  const sid = stageId ?? Object.entries(comp.stages ?? {}).find(([, st]) => st.ties?.includes(t))?.[0] ?? t.id.split(':').slice(-3)[0];
  const byId = new Map(comp.fixtures.filter((f) => f.tieId === t.id).map((f) => [f.id, f]));
  const legs = t.fixtureIds.map((id) => byId.get(id) ?? comp.fixtures.find((f) => f.id === id)).filter((f): f is Fixture => !!f);
  const ag = tieAggregate(comp, t);
  const legsPlayed = legs.filter((f) => !!f.result).length;
  const rule = tieRuleOf(comp, sid, t);
  const awayGoalsRule = !!rule?.awayGoals;
  const last = legs[legs.length - 1];
  let penalties: TieSummary['penalties'];
  if (last?.result?.penalties) {
    const p = last.result.penalties;
    penalties = last.homeId === t.a ? { a: p.home, b: p.away } : { a: p.away, b: p.home };
  }
  let advancing: string | null = t.winner ?? null;
  let decidedBy: TieSummary['decidedBy'] = null;
  if (ag.played && legs.length) {
    if (ag.a !== ag.b) decidedBy = 'aggregate';
    else if (awayGoalsRule && ag.awayA !== ag.awayB) decidedBy = 'away-goals';
    else if (penalties && penalties.a !== penalties.b) decidedBy = 'penalties';
    if (!advancing && decidedBy) {
      const winA = decidedBy === 'aggregate' ? ag.a > ag.b : decidedBy === 'away-goals' ? ag.awayA > ag.awayB : penalties!.a > penalties!.b;
      advancing = winA ? t.a : t.b;
    }
    // confronto resolvido por outra via (encerramento forçado): o critério é o que o vencedor registrado indica
    if (advancing && !decidedBy) decidedBy = 'penalties';
  }
  const eliminated = advancing ? (advancing === t.a ? t.b : t.a) : null;
  return {
    tieId: t.id, competitionId: comp.id, stageId: sid, round: t.round, roundName: t.roundName, a: t.a, b: t.b,
    ...(t.thirdPlace ? { thirdPlace: true } : {}),
    legs, aggregate: { a: ag.a, b: ag.b }, awayGoals: { a: ag.awayA, b: ag.awayB }, ...(penalties ? { penalties } : {}),
    played: ag.played && legs.length > 0, legsPlayed, advancing, eliminated, decidedBy, awayGoalsRule,
  };
}

/**
 * (13/11) Resumo de um confronto da temporada pelo id (`Fixture.tieId` / `TieState.id`): pernas, agregado, quem
 * avança e o critério (`'aggregate' | 'away-goals' | 'penalties'`). `null` se o confronto não existir.
 * É a mesma regra de `resolveTie` (agregado → gol fora, se a regra mandar → pênaltis do jogo decisivo).
 */
export function tieSummary(state: Pick<SeasonState, 'competitions'>, tieId: string): TieSummary | null {
  const scan = (c: Competition): TieSummary | null => {
    for (const [sid, st] of Object.entries(c.stages ?? {})) {
      const t = st.ties?.find((x) => x.id === tieId);
      if (t) return tieSummaryOf(c, t, sid);
    }
    return null;
  };
  for (const c of state.competitions) if (tieId.startsWith(`${c.id}:`)) { const r = scan(c); if (r) return r; }
  for (const c of state.competitions) if (!tieId.startsWith(`${c.id}:`)) { const r = scan(c); if (r) return r; }
  return null;
}

/** Pênaltis sorteados (determinístico) para jogo decisivo que chegou sem disputa registrada. */
function synthPenalties(seed: string): { home: number; away: number } {
  const r = new Rng(seed);
  const homeWins = r.chance(0.5);
  const lo = r.int(2, 4);
  return homeWins ? { home: lo + 1, away: lo } : { home: lo, away: lo + 1 };
}

/** Resolve o confronto se todas as pernas foram jogadas. Agregado → (gols fora, se a regra mandar) → pênaltis. */
export function resolveTie(comp: Competition, t: TieState, rule: TieRule): boolean {
  if (t.winner) return true;
  const ag = tieAggregate(comp, t);
  if (!ag.played) return false;
  let winA: boolean | null = ag.a > ag.b ? true : ag.b > ag.a ? false : null;
  if (winA === null && rule.awayGoals && ag.awayA !== ag.awayB) winA = ag.awayA > ag.awayB;
  if (winA === null) {
    const last = comp.fixtures.find((x) => x.id === t.fixtureIds[t.fixtureIds.length - 1])!;
    const res = last.result!;
    if (!res.penalties || res.penalties.home === res.penalties.away) res.penalties = synthPenalties(`${t.id}:pen`);
    const homeWon = res.penalties.home > res.penalties.away;
    winA = (last.homeId === t.a) === homeWon;
  }
  t.winner = winA ? t.a : t.b;
  t.loser = winA ? t.b : t.a;
  return true;
}

/* ═════════════════════ progressão ═════════════════════ */

function stageDone(comp: Competition, def: StageDef, st: StageState): boolean {
  return comp.fixtures.every((f) => f.stageId !== def.id || !!f.result) && (def.kind === 'table' || (st.ties ?? []).every((t) => !!t.winner));
}

function advanceKnockout(comp: Competition, def: KnockoutStageDef, st: StageState, ctx: FormatContext): boolean {
  const r = st.round ?? 0;
  const ties = (st.ties ?? []).filter((t) => t.round === r);
  let all = true;
  for (const t of ties) if (!resolveTie(comp, t, t.thirdPlace ? def.thirdPlace ?? def.rounds[r].tie : def.rounds[r].tie)) all = false;
  if (!all) return false;
  const seedIdx = new Map(st.seeds.map((c, i) => [c, i]));
  const extra = st as StageState & { byes?: string[] };
  const advancing = [...(extra.byes ?? []), ...ties.filter((t) => !t.thirdPlace).map((t) => t.winner!)]
    .sort((a, b) => (seedIdx.get(a) ?? 0) - (seedIdx.get(b) ?? 0));
  extra.byes = [];
  const lastDate = lastDateOf(comp.fixtures.filter((f) => f.stageId === def.id));
  const minDate = lastDate > ctx.minDate ? lastDate : ctx.minDate;
  if (r + 1 < def.rounds.length && advancing.length > 1) {
    st.round = r + 1;
    const losers = ties.filter((t) => !t.thirdPlace).map((t) => t.loser!);
    const isFinal = r + 1 === def.rounds.length - 1;
    const sub: FormatContext = { ...ctx, minDate };
    const main0 = ties.filter((t) => !t.thirdPlace);
    if (def.bracket && !def.thirdPlace && advancing.length === main0.length && main0.length >= 2 && main0.length % 2 === 0) {
      // (Etapa 2) chave fixa: vencedor do confronto i × vencedor do i+1 (ordem de criação); melhor semente decide em casa
      const slots = roundSlots(comp, def, r + 1, minDate);
      for (let i = 0; i < main0.length; i += 2) {
        const [a, b] = [main0[i].winner!, main0[i + 1].winner!].sort((x, y) => (seedIdx.get(x) ?? 0) - (seedIdx.get(y) ?? 0));
        createTie(comp, def, st, r + 1, def.rounds[r + 1].name, def.rounds[r + 1].tie, a, b, slots);
      }
      return true;
    }
    const bye = buildKnockoutRound(comp, def, st, r + 1, advancing, sub);
    extra.byes = bye;
    if (isFinal && def.thirdPlace && losers.length === 2) {
      const fin = (st.ties ?? []).find((t) => t.round === r + 1 && !t.thirdPlace);
      const finSlots = fin ? fin.fixtureIds.map((id) => comp.fixtures.find((f) => f.id === id)!.round - 1) : roundSlots(comp, def, r + 1, minDate);
      const sorted = losers.sort((a, b) => (seedIdx.get(a) ?? 0) - (seedIdx.get(b) ?? 0));
      createTie(comp, def, st, r + 1, '3º Lugar', def.thirdPlace, sorted[0], sorted[1], finSlots.slice(0, def.thirdPlace.legs), true);
    }
    return true;
  }
  // fim da fase — (Etapa 2) quem folgou na última rodada também avança (antes era perdido: fase de 1 rodada com byes)
  const main = ties.filter((t) => !t.thirdPlace);
  st.winners = advancing;
  st.losers = main.map((t) => t.loser!);
  st.status = 'done';
  return true;
}

/**
 * `checkProgression()`: fecha fases terminadas, resolve confrontos, gera rodadas/fases seguintes.
 * Retorna true se algo mudou (novos jogos ou fases concluídas). Mutação in-place.
 */
export function progressCompetition(comp: Competition, ctx: FormatContext): boolean {
  const fmt = comp.format;
  if (!fmt || comp.finished) return false;
  comp.stages ??= {};
  let changed = false;
  for (let guard = 0; guard < 64; guard++) {
    let step = false;
    for (const def of fmt.stages) {
      const st = comp.stages[def.id];
      if (!st) {
        const deps = stageDeps(def);
        if (!deps.every((d) => comp.stages![d]?.status === 'done')) continue;
        // (Fase 2) repasses de outra competição ainda não chegaram
        if (def.requires?.some((r) => (comp.entrants?.[r.entrants]?.length ?? 0) < r.count)) continue;
        const depLast = lastDateOf(comp.fixtures.filter((f) => f.stageId !== undefined && deps.includes(f.stageId)));
        const sub: FormatContext = { ...ctx, minDate: depLast > ctx.minDate ? depLast : ctx.minDate };
        comp.stages[def.id] = def.kind === 'table' ? buildTable(comp, def, sub) : buildKnockout(comp, def, sub);
        step = true;
        continue;
      }
      if (st.status === 'done') continue;
      if (def.kind === 'table') {
        if (stageDone(comp, def, st)) { st.status = 'done'; step = true; }
      } else if (advanceKnockout(comp, def, st, ctx)) step = true;
    }
    if (!step) break;
    changed = true;
  }
  if (comp.relegatedIds === undefined && fmt.stages.every((d) => comp.stages![d.id]?.status === 'done')) {
    finishCompetition(comp);
    changed = true;
  }
  return changed;
}

/** Campeão/vice de uma fase. */
function stageTop2(comp: Competition, stageId: string): [string | undefined, string | undefined] {
  const def = stageDef(comp, stageId);
  const st = comp.stages?.[stageId];
  if (!def || !st) return [undefined, undefined];
  if (def.kind === 'table') {
    const t = stageStandings(comp, stageId);
    return [t[0]?.clubId, t[1]?.clubId];
  }
  const last = Math.max(-1, ...(st.ties ?? []).filter((t) => !t.thirdPlace).map((t) => t.round));
  const fin = (st.ties ?? []).filter((t) => t.round === last && !t.thirdPlace);
  if (fin.length === 1) return [fin[0].winner, fin[0].loser];
  return [st.winners?.[0], st.losers?.[0]];
}

/** Fecha a competição: campeão, vice, títulos secundários, rebaixados e promovidos. */
export function finishCompetition(comp: Competition): void {
  const fmt = comp.format!;
  const [ch, vi] = stageTop2(comp, fmt.champion);
  comp.championId = ch;
  comp.viceId = vi;
  comp.titles = [];
  for (const def of fmt.stages) {
    if (!def.title) continue;
    const [w, v] = stageTop2(comp, def.id);
    if (w) comp.titles.push({ title: def.title, clubId: w, viceId: v });
  }
  comp.relegatedIds = pickAll(comp, fmt.relegation);
  comp.promotedIds = pickAll(comp, fmt.promotion);
}

/**
 * (Fase 2) Encerra à força uma competição que não pode mais andar (fase à espera de participantes que não
 * vieram, calendário esgotado). Campeão = o da fase do campeão, se existir; senão o vencedor/líder da última
 * fase disputada. Nunca lança erro.
 */
export function forceFinishCompetition(comp: Competition): void {
  const fmt = comp.format;
  if (!fmt) return;
  comp.stages ??= {};
  for (const def of fmt.stages) {
    const st = comp.stages[def.id];
    if (st && st.status !== 'done' && def.kind === 'table' && stageDone(comp, def, st)) st.status = 'done';
    if (st && st.status !== 'done' && def.kind === 'knockout') {
      for (const t of st.ties ?? []) resolveTie(comp, t, def.rounds[t.round]?.tie ?? { legs: 1 });
    }
  }
  let [ch, vi] = comp.stages[fmt.champion] ? stageTop2(comp, fmt.champion) : [undefined, undefined];
  if (!ch) {
    for (const def of [...fmt.stages].reverse()) {
      if (!comp.stages[def.id]) continue;
      [ch, vi] = stageTop2(comp, def.id);
      if (ch) break;
    }
  }
  comp.championId = ch;
  comp.viceId = vi;
  comp.titles ??= [];
  comp.relegatedIds ??= [];
  comp.promotedIds ??= [];
}

/** Inicializa uma competição com formato (gera as fases iniciais). */
export function initCompetition(comp: Competition, ctx: FormatContext): Competition {
  comp.stages ??= {};
  progressCompetition(comp, ctx);
  return comp;
}

/** Nº de jogos que o formato gera para `n` clubes (estimativa usada em testes/validação). */
export function countPlayed(comp: Competition): number {
  return comp.fixtures.filter((f) => f.result).length;
}

/** Normaliza um FormatDef (validação leve): ids únicos e fase de campeão existente. */
export function validateFormat(fmt: FormatDef): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const s of fmt.stages) {
    if (ids.has(s.id)) errs.push(`fase duplicada ${s.id}`);
    ids.add(s.id);
  }
  if (!ids.has(fmt.champion)) errs.push(`fase do campeão inexistente: ${fmt.champion}`);
  for (const s of fmt.stages) for (const d of stageDeps(s)) if (!ids.has(d)) errs.push(`${s.id}: depende de ${d} (inexistente)`);
  return errs;
}
