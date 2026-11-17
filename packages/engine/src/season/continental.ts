/**
 * Fase 2 — competições continentais e regionais (spec §2.5–2.10, §7.2).
 *
 * Competições (todas com FormatDef, datas de calendars.json, prioridade continental 4):
 *  - LIBERTADORES (19 datas): 1ª fase (6) → 2ª fase (13 + 3) → 3ª fase (8) I/V → grupos 8×4 I/V (28 diretos + 4)
 *    → oitavas, quartas, semi I/V → final única em campo neutro (01/12).
 *  - SULAMERICANA (16 datas): preliminar JU entre clubes do mesmo país (32) → grupos 8×4 I/V (12 diretos +
 *    16 + 4 perdedores da 3ª fase da Libertadores) → play-off de oitavas I/V (2ºs × 3ºs da Libertadores)
 *    → oitavas (1ºs × vencedores do play-off), quartas, semi I/V → final única neutra (11/11).
 *  - RECOPA (2 datas, I/V): campeões da Libertadores e da Sul-Americana do ano anterior.
 *  - INTERCONTINENTAL (5 datas, JU neutro): OFC×AFC → Dérbi das Américas (CONCACAF×CONMEBOL) →
 *    Copa África-Ásia-Pacífico (CAF × vencedor) → Challenger Cup → Final (UEFA × vencedor).
 *  - SUPERMUNDIAL (7 datas): 32 clubes, 8 grupos de 4 em turno único → oitavas, quartas, semi, final JU.
 *    Periodicidade por opção (padrão: a cada 4 anos a partir de 2029 — proposta da spec).
 *  - NORDESTE (10 datas): 16 clubes do Nordeste pelo ranking estadual → 4 grupos I/V → quartas JU → semi JU →
 *    final I/V. Prêmio ESTADUAL (premios.txt: "Regionais/Estaduais").
 *  - Ligas nacionais sul-americanas (1ª divisão de ARG, URU, PAR, CHI, COL, PER, EQU, BOL, VEN) disputadas na
 *    temporada, em simulação leve (Poisson) para os jogos sem clube brasileiro: geram a classificação que
 *    define as vagas do ano seguinte e fazem os elencos estrangeiros evoluírem (estão em state.clubs).
 *    Composição fixa (sem acesso/rebaixamento nos países estrangeiros).
 *
 * Repasses (`linkContinental`, chamado por advanceDay): perdedores da 3ª fase da Libertadores → grupos da
 * Sul-Americana; 3ºs dos grupos da Libertadores → play-off de oitavas da Sul-Americana; campeão da
 * Libertadores → Intercontinental (Dérbi das Américas).
 */
import type { ContinentalConfig, FormatDef, PickRule } from '@cosmicfut/shared';
import type { CareerData, Competition, ContinentalQualifiers, SeasonState, WorldState } from '../contract';
import { Rng } from '../rng';
import { initCompetition, pick, progressCompetition, stageStandings } from './format';
import { seasonDates } from './calendar';

/* ═════════════════════ configuração (fallback se competitions.json não trouxer) ═════════════════════ */

/**
 * Vagas (proposta fiel à regra CONMEBOL 2026, spec §2.6/2.7, confiança Baixa nos números):
 *  - Libertadores, 47 clubes: grupos 28 diretos = 2 campeões (Libertadores e Sul-Americana) + BRA 5
 *    (campeão da Copa do Brasil + Série A 1º–4º) + ARG 5 + 2 por país nos outros 8; 2ª fase 13 = BRA 2
 *    (Série A 5º e 6º) + ARG 1 + 3ºs dos 8 países + 4ºs de URU e COL; 1ª fase 6 = 4ºs de EQU, PAR, CHI, PER, BOL, VEN.
 *    (A spec propunha o 5º do Brasil direto na 3ª fase; isso não fecha a conta 6+13 → 8 → 28+4 do formato
 *    real de 19 datas, então o 5º vai à 2ª fase, como na CONMEBOL real.)
 *  - Sul-Americana, 44 clubes: BRA 6 (Série A, próximos 6 não classificados à Libertadores) e ARG 6 direto nos
 *    grupos; 4 por país nos outros 8 na preliminar (1º×4º e 2º×3º do país, jogo único).
 */
export const DEFAULT_CONTINENTAL: ContinentalConfig = {
  // (Etapa 1) escopo: sem Peru, Bolívia e Venezuela — vagas redistribuídas (mesmos totais do formato; a Etapa 2 refaz)
  conmebol: [
    { code: 'ARG', leagueId: 'ARG-1' }, { code: 'URU', leagueId: 'URU-1' }, { code: 'COL', leagueId: 'COL-1' },
    { code: 'PAR', leagueId: 'PAR-1' }, { code: 'CHI', leagueId: 'CHI-1' }, { code: 'EQU', leagueId: 'EQU-1' },
  ],
  libertadores: {
    BRA: { groups: 7, f2: 2, f1: 0, cupSlot: true }, ARG: { groups: 6, f2: 2, f1: 0 },
    URU: { groups: 3, f2: 2, f1: 1 }, COL: { groups: 3, f2: 2, f1: 1 },
    PAR: { groups: 2, f2: 2, f1: 1 }, CHI: { groups: 3, f2: 1, f1: 2 }, EQU: { groups: 2, f2: 2, f1: 1 },
  },
  sulamericana: {
    BRA: { groups: 6, prelim: 0 }, ARG: { groups: 6, prelim: 0 },
    URU: { groups: 0, prelim: 6 }, COL: { groups: 0, prelim: 8 }, PAR: { groups: 0, prelim: 6 }, CHI: { groups: 0, prelim: 6 },
    EQU: { groups: 0, prelim: 6 },
  },
  confederations: {
    UEFA: ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'],
    CONCACAF: [], CAF: [], AFC: ['ARS'], OFC: [],
  },
  nordeste: { ufs: ['BA', 'PE', 'CE', 'RN', 'PB', 'AL', 'SE', 'MA', 'PI'], teams: 16, priorityUfs: ['BA', 'PE', 'CE'] },
};

/**
 * Configuração continental (competitions.json, senão o padrão). (Etapa 1) Filtrada pelo escopo dos DADOS: só países
 * com liga em leagues.json (fora do escopo não há clubes), para nada referenciar clubes inexistentes.
 */
export function continentalConfig(data: CareerData): ContinentalConfig {
  const c = data.competitions.continental;
  const has = (code: string) => data.leagues.some((l) => l.id === `${code}-1`);
  const merged: ContinentalConfig = { ...DEFAULT_CONTINENTAL, ...(c ?? {}), confederations: c?.confederations ?? DEFAULT_CONTINENTAL.confederations, nordeste: c?.nordeste ?? DEFAULT_CONTINENTAL.nordeste };
  return {
    ...merged,
    conmebol: merged.conmebol.filter((x) => data.leagues.some((l) => l.id === x.leagueId)),
    confederations: Object.fromEntries(Object.entries(merged.confederations ?? {}).map(([k, v]) => [k, v.filter(has)])),
  };
}

/**
 * (Etapa 1) Confederações sem clubes no escopo (CONCACAF, CAF, OFC) mandam "convidados" de uma confederação em
 * escopo para o Intercontinental (sorteio entre os mais fortes, sem repetir clube). Provisório até a Etapa 2.
 */
export const CONFED_FALLBACK: Record<string, string> = { CONCACAF: 'AFC', CAF: 'AFC', OFC: 'AFC', AFC: 'UEFA' };

/** Supermundial: 'every4' (padrão, 2029, 2033...), 'yearly' (o original carrega datas todo ano) ou 'off'. */
export type SupermundialMode = 'every4' | 'yearly' | 'off';
export const SUPERMUNDIAL_FIRST = 2029;
export function supermundialYear(season: number, mode: SupermundialMode | undefined): boolean {
  const m = mode ?? 'every4';
  if (m === 'off') return false;
  if (m === 'yearly') return true;
  return season >= SUPERMUNDIAL_FIRST && (season - SUPERMUNDIAL_FIRST) % 4 === 0;
}

/* ═════════════════════ formatos ═════════════════════ */

const IV = { legs: 2 as const };
const JU_NEUTRAL = { legs: 1 as const, neutral: true };

/** Libertadores: 19 datas (2+2+2+6+2+2+2+1). */
export function libertadoresFormat(): FormatDef {
  return {
    id: 'LIBERTADORES', teams: 47,
    summary: '1ª fase (6) → 2ª fase (16) → 3ª fase (8) I/V → 8 grupos de 4 I/V → oitavas, quartas e semi I/V → final única neutra',
    stages: [
      { id: 'f1', kind: 'knockout', name: 'Primeira Fase', label: 'PRIMEIRA FASE (Preliminar)', sources: [{ entrants: 'f1' }], seeding: 'pots', avoidSameCountry: true, rounds: [{ name: '1ª Fase', tie: IV, slots: [0, 1] }] },
      { id: 'f2', kind: 'knockout', name: 'Segunda Fase', label: 'SEGUNDA FASE (Preliminar)', sources: [{ entrants: 'f2' }, { stage: 'f1', winners: true }], seeding: 'pots', avoidSameCountry: true, rounds: [{ name: '2ª Fase', tie: IV, slots: [2, 3] }] },
      { id: 'f3', kind: 'knockout', name: 'Terceira Fase', label: 'TERCEIRA FASE (Preliminar)', sources: [{ stage: 'f2', winners: true }], seeding: 'pots', avoidSameCountry: true, rounds: [{ name: '3ª Fase', tie: IV, slots: [4, 5] }] },
      { id: 'groups', kind: 'table', name: 'Fase de Grupos', groups: 8, legs: 2, grouping: 'draw', avoidSameCountry: true, slotStart: 6, sources: [{ entrants: 'groups' }, { stage: 'f3', winners: true }] },
      {
        id: 'ko', kind: 'knockout', name: 'Fase Final', sources: [{ stage: 'groups', ranks: [1, 2], perGroup: true }], seeding: 'pots', avoidSameCountry: false,
        rounds: [
          { name: 'Oitavas de Final', tie: IV, slots: [12, 13] }, { name: 'Quartas de Final', tie: IV, slots: [14, 15] },
          { name: 'Semifinal', tie: IV, slots: [16, 17] }, { name: 'Final', tie: JU_NEUTRAL, slots: [18] },
        ],
      },
    ],
    champion: 'ko',
  };
}

/** Sul-Americana: 16 datas (1+6+2+2+2+2+1). */
export function sulamericanaFormat(): FormatDef {
  return {
    id: 'SULAMERICANA', teams: 48,
    summary: 'preliminar JU entre clubes do mesmo país → 8 grupos de 4 I/V (+4 da Libertadores) → play-off de oitavas (2ºs × 3ºs da Libertadores) → oitavas, quartas e semi I/V → final única neutra',
    stages: [
      { id: 'prelim', kind: 'knockout', name: 'Fase Preliminar', label: 'Sulamericana (Preliminar)', sources: [{ entrants: 'prelim' }], seeding: 'order', rounds: [{ name: 'Preliminar', tie: { legs: 1 }, slots: [0] }] },
      {
        id: 'groups', kind: 'table', name: 'Fase de Grupos', groups: 8, legs: 2, grouping: 'draw', avoidSameCountry: true, slotStart: 1,
        sources: [{ entrants: 'groups' }, { stage: 'prelim', winners: true }, { entrants: 'lib3' }], requires: [{ entrants: 'lib3', count: 4 }],
      },
      {
        id: 'playoff', kind: 'knockout', name: 'Play-off de Oitavas', label: 'Sulamericana (Play-off de Oitavas)', seeding: 'pots', avoidSameCountry: true,
        sources: [{ stage: 'groups', ranks: [2, 2], perGroup: true }, { entrants: 'lib3rd' }], requires: [{ entrants: 'lib3rd', count: 8 }],
        rounds: [{ name: 'Play-off de Oitavas', tie: IV, slots: [7, 8] }],
      },
      {
        id: 'ko', kind: 'knockout', name: 'Fase Final', seeding: 'pots',
        sources: [{ stage: 'groups', ranks: [1, 1], perGroup: true }, { stage: 'playoff', winners: true }],
        rounds: [
          { name: 'Oitavas de Final', tie: IV, slots: [9, 10] }, { name: 'Quartas de Final', tie: IV, slots: [11, 12] },
          { name: 'Semifinal', tie: IV, slots: [13, 14] }, { name: 'Final', tie: JU_NEUTRAL, slots: [15] },
        ],
      },
    ],
    champion: 'ko',
  };
}

/** Recopa Sul-Americana: ida e volta (20/02 e 27/02). */
export function recopaFormat(): FormatDef {
  return {
    id: 'RECOPA', teams: 2, summary: 'ida e volta entre os campeões da Libertadores e da Sul-Americana; pênaltis',
    stages: [{ id: 'final', kind: 'knockout', name: 'Recopa', sources: [{ entrants: 'all' }], seeding: 'order', rounds: [{ name: 'Final', tie: IV, slots: [0, 1] }] }],
    champion: 'final',
  };
}

/**
 * Intercontinental FIFA (Etapa 2: formato real 2025/2026), 5 jogos únicos em campo neutro: play-off
 * África-Ásia-Pacífico (CAF × OFC, setembro) → Copa África-Ásia-Pacífico (AFC × vencedor) e Dérbi das Américas
 * (CONCACAF × CONMEBOL) → Challenger Cup → Final contra o campeão da Liga dos Campeões (dezembro).
 */
export function intercontinentalFormat(): FormatDef {
  const one = (name: string, slot: number) => [{ name, tie: JU_NEUTRAL, slots: [slot] }];
  return {
    id: 'INTERCONTINENTAL', teams: 6,
    summary: 'play-off CAF×OFC → Copa África-Ásia-Pacífico (AFC × vencedor) e Dérbi das Américas (CONCACAF×CONMEBOL) → Challenger Cup → Final contra o campeão da UEFA',
    stages: [
      { id: 'playoff', kind: 'knockout', name: 'Play-off África-Ásia-Pacífico', sources: [{ entrants: 'caf' }, { entrants: 'ofc' }], seeding: 'order', rounds: one('Play-off', 0) },
      { id: 'derbi', kind: 'knockout', name: 'Dérbi das Américas', title: 'Dérbi das Américas', sources: [{ entrants: 'conmebol' }, { entrants: 'concacaf' }], seeding: 'order', requires: [{ entrants: 'conmebol', count: 1 }], rounds: one('Dérbi das Américas', 1) },
      { id: 'aap', kind: 'knockout', name: 'Copa África-Ásia-Pacífico', title: 'Copa África-Ásia-Pacífico', sources: [{ entrants: 'afc' }, { stage: 'playoff', winners: true }], seeding: 'order', requires: [{ entrants: 'afc', count: 1 }], rounds: one('Copa África-Ásia-Pacífico', 2) },
      { id: 'challenger', kind: 'knockout', name: 'Challenger Cup', title: 'Challenger Cup', sources: [{ stage: 'derbi', winners: true }, { stage: 'aap', winners: true }], seeding: 'order', rounds: one('Challenger Cup', 3) },
      { id: 'final', kind: 'knockout', name: 'Final', sources: [{ entrants: 'uefa' }, { stage: 'challenger', winners: true }], seeding: 'order', requires: [{ entrants: 'uefa', count: 1 }], rounds: one('Final', 4) },
    ],
    champion: 'final',
  };
}

/** Supermundial: 32 clubes, 8 grupos de 4 em turno único → oitavas, quartas, semi e final (JU, neutro). */
export function supermundialFormat(): FormatDef {
  return {
    id: 'SUPERMUNDIAL', teams: 32,
    summary: '32 clubes em 8 grupos de 4 (turno único) → oitavas, quartas, semi e final em jogo único',
    stages: [
      { id: 'groups', kind: 'table', name: 'Fase de Grupos', groups: 8, legs: 1, grouping: 'draw', avoidSameCountry: true, sources: [{ entrants: 'all' }] },
      {
        id: 'ko', kind: 'knockout', name: 'Fase Final', seeding: 'pots', sources: [{ stage: 'groups', ranks: [1, 2], perGroup: true }],
        rounds: [
          { name: 'Oitavas de Final', tie: JU_NEUTRAL, slots: [3] }, { name: 'Quartas de Final', tie: JU_NEUTRAL, slots: [4] },
          { name: 'Semifinal', tie: JU_NEUTRAL, slots: [5] }, { name: 'Final', tie: JU_NEUTRAL, slots: [6] },
        ],
      },
    ],
    champion: 'ko',
  };
}

/**
 * Copa do Nordeste: 10 datas = grupos 6 (I/V) + quartas JU + semi JU + final I/V. A spec lista 5 datas até
 * 29/04 para os grupos, mas 4 grupos de 4 em I/V exigem 6: os grupos vão até 20/05 e a fase final usa
 * 27/05, 03/06 e 07/06–11/06 (todas as 10 datas, sem reserva).
 */
export function nordesteFormat(): FormatDef {
  return {
    id: 'NORDESTE', teams: 16,
    summary: '4 grupos de 4 I/V → quartas JU → semi JU → final I/V',
    stages: [
      { id: 'groups', kind: 'table', name: 'Fase de Grupos', groups: 4, legs: 2, grouping: 'draw', sources: [{ entrants: 'all' }] },
      {
        id: 'ko', kind: 'knockout', name: 'Fase Final', seeding: 'table', sources: [{ stage: 'groups', ranks: [1, 2], perGroup: true }],
        rounds: [
          { name: 'Quartas de Final', tie: { legs: 1 }, slots: [6] }, { name: 'Semifinal', tie: { legs: 1 }, slots: [7] },
          { name: 'Final', tie: IV, slots: [8, 9] },
        ],
      },
    ],
    champion: 'ko',
  };
}

/* ═════════════════════ classificação (vagas) ═════════════════════ */

type ClubMeta = CareerData['clubs'][number];

/** Força para ordenar clubes sem histórico: nível, reputação, id (determinístico). */
export function strengthSort(ids: string[], meta: Map<string, ClubMeta>): string[] {
  return ids.slice().sort((a, b) => {
    const x = meta.get(a), y = meta.get(b);
    return (y?.level ?? 0) - (x?.level ?? 0) || (y?.reputation ?? 0) - (x?.reputation ?? 0) || (a < b ? -1 : 1);
  });
}

/**
 * Ordem de classificação de um país para as vagas (do ano encerrado):
 * Apertura/Clausura: campeão do Apertura, campeão do Clausura, depois a tabela anual somada (`fillLibertadores`);
 * ligas comuns: classificação final.
 */
export function leagueQualificationOrder(comp: Competition): string[] {
  const fmt = comp.format;
  const tables = fmt?.stages.filter((s) => s.kind === 'table').map((s) => s.id) ?? [];
  let order: string[];
  const style = fmt?.style;
  const played = (ids: string[]) => ids.filter((t) => comp.stages?.[t]);
  if (fmt?.stages.some((s) => s.id === 'finalissima')) {
    const annual = stageStandings(comp, tables.filter((t) => comp.stages?.[t])).map((r) => r.clubId);
    const champs = (comp.titles ?? []).filter((t) => t.title === 'Apertura' || t.title === 'Clausura').map((t) => t.clubId);
    order = [...champs, ...annual];
  } else if ((style === 'col' || style === 'ac-tables') && fmt) {
    // (Etapa 2) Colômbia e Paraguai: campeões dos dois torneios, depois a tabela somada (reclasificación)
    const halves = style === 'col' ? ['a-liga', 'f-liga'] : ['a-liga', 'c-liga'];
    const ids = played(halves);
    const annual = ids.length ? stageStandings(comp, ids.length === 1 ? ids[0] : ids).map((r) => r.clubId) : [];
    const champs = [...(comp.titles ?? []).filter((t) => t.title === 'Apertura').map((t) => t.clubId), ...(comp.championId ? [comp.championId] : [])];
    order = [...champs, ...annual];
  } else if (style === 'equ' && fmt) {
    // (Etapa 2) LigaPro: hexagonal do título, grupo intermediário e quadrangular de baixo (com os pontos da 1ª fase)
    const phase2 = played(['hex', 'mid', 'low']);
    order = phase2.length ? phase2.flatMap((s) => stageStandings(comp, s).map((r) => r.clubId)) : stageStandings(comp, 'f1').map((r) => r.clubId);
    order.push(...stageStandings(comp, 'f1').map((r) => r.clubId));
  } else if (tables.length) {
    order = stageStandings(comp, tables[0]).map((r) => r.clubId);
  } else order = comp.clubIds.slice();
  const seen = new Set<string>();
  return order.filter((c) => comp.clubIds.includes(c) && !seen.has(c) && (seen.add(c), true));
}

export interface QualifyInput {
  /** ordem por país (sigla → clubIds). Ausente ⇒ força (1º ano). */
  orders?: Record<string, string[]>;
  /** campeão da copa nacional do país da carreira */
  cupHolder?: string | null;
  holders?: { LIBERTADORES?: string | null; SULAMERICANA?: string | null };
}

/** Ordem por força de cada país CONMEBOL, a partir de leagues.json (1º ano). */
function strengthOrders(data: CareerData, cfg: ContinentalConfig, meta: Map<string, ClubMeta>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { code, leagueId } of [{ code: 'BRA', leagueId: 'BRA-1' }, ...cfg.conmebol]) {
    const d = data.leagues.find((l) => l.id === leagueId);
    if (d) out[code] = strengthSort(d.clubIds, meta);
  }
  return out;
}

/**
 * `qualifyContinental` (fillLibertadores/fillSulamericana do original): preenche as vagas na ordem de prioridade,
 * com repasse — uma vaga cujo dono já está classificado desce na ordem do país.
 */
export function qualifyContinental(data: CareerData, season: number, input: QualifyInput): ContinentalQualifiers {
  const cfg = continentalConfig(data);
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  const strength = strengthOrders(data, cfg, meta);
  const source: Record<string, 'results' | 'strength'> = {};
  const orderOf = (code: string) => {
    const o = input.orders?.[code];
    if (o?.length) { source[code] = 'results'; return o; }
    source[code] = 'strength';
    return strength[code] ?? [];
  };
  const taken = new Set<string>();
  const reason: Record<string, string> = {};
  const position: Record<string, number> = {};
  const take = (id: string | null | undefined, why: string) => {
    if (!id || taken.has(id)) return false;
    taken.add(id);
    reason[id] = why;
    return true;
  };
  const label = (code: string) => leagueLabel(data, code);
  const lib = { groups: [] as string[], f2: [] as string[], f1: [] as string[] };
  const holders = { LIBERTADORES: input.holders?.LIBERTADORES ?? null, SULAMERICANA: input.holders?.SULAMERICANA ?? null };
  if (take(holders.LIBERTADORES, 'Campeão da Libertadores')) lib.groups.push(holders.LIBERTADORES!);
  if (take(holders.SULAMERICANA, 'Campeão da Sul-Americana')) lib.groups.push(holders.SULAMERICANA!);
  const codes = ['BRA', ...cfg.conmebol.map((c) => c.code)];
  const orders = Object.fromEntries(codes.map((c) => [c, orderOf(c)]));
  // posição de cada clube na ordem de classificação do seu país (1-based)
  for (const code of codes) orders[code].forEach((c, k) => { if (position[c] === undefined) position[c] = k + 1; });
  for (const code of codes) {
    const q = cfg.libertadores[code];
    if (!q) continue;
    const order = orders[code];
    let i = 0;
    const next = (phase: string) => {
      while (i < order.length) {
        const c = order[i++];
        if (take(c, `${label(code)} ${i}º → Libertadores (${phase})`)) return c;
      }
      return null;
    };
    let g = q.groups;
    if (q.cupSlot && input.cupHolder && take(input.cupHolder, 'Campeão da Copa Nacional')) { lib.groups.push(input.cupHolder); g--; }
    for (let k = 0; k < g; k++) { const c = next('grupos'); if (c) lib.groups.push(c); }
    for (let k = 0; k < q.f2; k++) { const c = next('2ª fase'); if (c) lib.f2.push(c); }
    for (let k = 0; k < q.f1; k++) { const c = next('1ª fase'); if (c) lib.f1.push(c); }
  }
  const sula = { groups: [] as string[], prelim: [] as string[] };
  for (const code of codes) {
    const q = cfg.sulamericana[code];
    if (!q) continue;
    const order = orders[code];
    const rest = order.filter((c) => !taken.has(c));
    const pos = (c: string) => order.indexOf(c) + 1;
    const g = rest.slice(0, q.groups);
    g.forEach((c) => take(c, `${label(code)} ${pos(c)}º → Sul-Americana (grupos)`));
    sula.groups.push(...g);
    const p = rest.slice(q.groups, q.groups + q.prelim);
    // pares do mesmo país: 1º×último, 2º×penúltimo... (13/11: com nº ímpar de clubes, o do meio fica de fora —
    // antes ele recebia o motivo da vaga sem estar em lista nenhuma)
    for (let k = 0; k < Math.floor(p.length / 2); k++) {
      const x = p[k], y = p[p.length - 1 - k];
      take(x, `${label(code)} ${pos(x)}º → Sul-Americana (preliminar)`);
      take(y, `${label(code)} ${pos(y)}º → Sul-Americana (preliminar)`);
      sula.prelim.push(x, y);
    }
  }
  // (13/11) listas na ordem da vaga: campeões continentais, campeão da copa, depois a posição na liga (por país,
  // na ordem CONMEBOL). Os potes dos sorteios (força) são calculados à parte por `continentalPots`.
  return {
    season,
    libertadores: { groups: lib.groups, f2: lib.f2, f1: lib.f1 },
    sulamericana: { groups: sula.groups, prelim: sula.prelim },
    holders, reason, source, position,
  };
}

/**
 * Rótulo curto da liga de um país para os motivos de vaga: "Série A" (Brasil), "Campeonato Argentino"...
 * (de competitions.json; senão leagues.json; senão a sigla).
 */
export function leagueLabel(data: CareerData, code: string): string {
  const reg = data.competitions.competitions.find((c) => c.id === `${code}-1`)?.name;
  const serie = reg ? /Série [A-D]/.exec(reg)?.[0] : undefined;
  if (serie) return serie;
  if (reg) return reg.split(' - ')[0].trim();
  const lg = data.leagues.find((l) => l.id === `${code}-1`)?.name;
  return lg ?? code;
}

/**
 * (13/11) Ordem de POTE das vagas (sorteios da Libertadores/Sul-Americana e pote 1 da Copa do Brasil): campeões
 * continentais primeiro, depois por força (nível/reputação). É a ordem que `ContinentalQualifiers` usava antes de
 * passar a vir pela colocação; independe da ordem de entrada (saves antigos dão o mesmo resultado).
 */
export function continentalPots(q: ContinentalQualifiers, data: CareerData | Map<string, ClubMeta>): ContinentalQualifiers {
  const meta = data instanceof Map ? data : new Map(data.clubs.map((c) => [c.id, c]));
  const holderIds = [q.holders.LIBERTADORES, q.holders.SULAMERICANA].filter((x): x is string => !!x);
  const sortPot = (ids: string[], keepFirst: string[] = []) => [...keepFirst.filter((x) => ids.includes(x)), ...strengthSort(ids.filter((x) => !keepFirst.includes(x)), meta)];
  return {
    ...q,
    libertadores: { groups: sortPot(q.libertadores.groups, holderIds), f2: sortPot(q.libertadores.f2), f1: sortPot(q.libertadores.f1) },
    sulamericana: { groups: sortPot(q.sulamericana.groups), prelim: q.sulamericana.prelim },
  };
}

/** Ordens por país a partir das competições da temporada encerrada (rollover). */
export function ordersFromSeason(state: SeasonState, world: WorldState, data: CareerData): Record<string, string[]> {
  const cfg = continentalConfig(data);
  const out: Record<string, string[]> = {};
  // (Etapa 1) Brasil sempre (não há mais "país da carreira" para as vagas)
  const br = world.lastRanking['BRA-1'];
  if (br?.length) out.BRA = br.slice();
  for (const { code, leagueId } of cfg.conmebol) {
    const c = state.competitions.find((x) => x.id === leagueId);
    if (c?.finished) out[code] = leagueQualificationOrder(c);
  }
  return out;
}

/** Clubes do país da carreira classificados (para a UI e para o pote 1 da Copa do Brasil). */
export function qualifiedFrom(q: ContinentalQualifiers | undefined, clubIds: Set<string> | ((id: string) => boolean)): { libertadores: string[]; sulamericana: string[] } {
  const has = typeof clubIds === 'function' ? clubIds : (id: string) => clubIds.has(id);
  if (!q) return { libertadores: [], sulamericana: [] };
  return {
    libertadores: [...q.libertadores.groups, ...q.libertadores.f2, ...q.libertadores.f1].filter(has),
    sulamericana: [...q.sulamericana.groups, ...q.sulamericana.prelim].filter(has),
  };
}

/* ═════════════════════ participantes de outras confederações ═════════════════════ */

function confedClubs(data: CareerData, codes: string[], meta: Map<string, ClubMeta>): string[] {
  const ids: string[] = [];
  for (const code of codes) {
    const d = data.leagues.find((l) => l.id === `${code}-1`);
    if (d) ids.push(...d.clubIds);
  }
  return strengthSort(ids, meta);
}

/** Campeão "simulado" de uma confederação não disputada: sorteio ponderado (5,4,3,2,1) entre os 5 mais fortes. */
export function confedChampion(data: CareerData, confed: string, seed: string, exclude: Set<string> = new Set()): string | null {
  const cfg = continentalConfig(data);
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  let top = confedClubs(data, cfg.confederations?.[confed] ?? [], meta).filter((c) => !exclude.has(c)).slice(0, 5);
  // (Etapa 1) confederação fora do escopo: convidado de uma confederação substituta
  for (let k = 0, sub = CONFED_FALLBACK[confed]; !top.length && sub && k < 3; k++, sub = CONFED_FALLBACK[sub]) {
    top = confedClubs(data, cfg.confederations?.[sub] ?? [], meta).filter((c) => !exclude.has(c)).slice(0, 5);
  }
  if (!top.length) return null;
  const r = new Rng(`${seed}:${confed}:champion`);
  return top[Math.max(0, r.weightedIndex(top.map((_, i) => 5 - i)))];
}

/** Participantes do Supermundial (32): UEFA 12, CONMEBOL 6, CONCACAF 4, CAF 4, AFC 4, OFC 1, país-sede 1. */
export function supermundialEntrants(data: CareerData, world: WorldState, season: number, host = 'EUA'): string[] {
  const cfg = continentalConfig(data);
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  const countryOf = (id: string) => meta.get(id)?.countryId;
  const out: string[] = [];
  const add = (pool: string[], n: number, perCountry = 2) => {
    const count = new Map<number | undefined, number>();
    for (const c of out) count.set(countryOf(c), (count.get(countryOf(c)) ?? 0) + 1);
    let k = 0;
    for (const c of pool) {
      if (k >= n) break;
      if (out.includes(c) || (count.get(countryOf(c)) ?? 0) >= perCountry) continue;
      out.push(c); k++;
      count.set(countryOf(c), (count.get(countryOf(c)) ?? 0) + 1);
    }
  };
  // CONMEBOL: campeões da Libertadores dos 4 últimos anos, depois força
  const libChamps = world.history.filter((h) => h.competitionId === 'LIBERTADORES' && h.season >= season - 4 && h.championId)
    .sort((a, b) => b.season - a.season).map((h) => h.championId!);
  const conmebol = confedClubs(data, ['BRA', ...cfg.conmebol.map((c) => c.code)], meta);
  for (const c of libChamps) if (!out.includes(c) && out.length < 6) out.push(c);
  add(conmebol, 6 - out.length);
  const conf = cfg.confederations ?? {};
  add(confedClubs(data, conf.UEFA ?? [], meta), 12, 3);
  add(confedClubs(data, conf.CONCACAF ?? [], meta), 4);
  add(confedClubs(data, conf.CAF ?? [], meta), 4);
  add(confedClubs(data, conf.AFC ?? [], meta), 4);
  add(confedClubs(data, conf.OFC ?? [], meta), 1);
  add(confedClubs(data, [host], meta), 1, 99);
  // completa até 32 com UEFA, se faltar algo nos dados
  if (out.length < 32) add(confedClubs(data, conf.UEFA ?? [], meta), 32 - out.length, 99);
  return strengthSort(out.slice(0, 32), meta);
}

/* ═════════════════════ Copa do Nordeste ═════════════════════ */

/**
 * 16 clubes (spec §2.5, proposta Baixa): o melhor de cada UF do Nordeste pelo ranking estadual mais recente;
 * depois o 2º de BA, PE e CE; depois o 2º das demais UFs pelo tamanho do estadual (máx. 2 por UF).
 */
export function nordesteEntrants(world: WorldState, data: CareerData): string[] {
  const cfg = continentalConfig(data).nordeste!;
  const out: string[] = [];
  const at = (uf: string, k: number) => (world.stateRanking[uf] ?? [])[k];
  for (const uf of cfg.ufs) { const c = at(uf, 0); if (c) out.push(c); }
  const size = (uf: string) => world.stateDivisions[`${uf}-1`]?.length ?? 0;
  const second = [...cfg.priorityUfs, ...cfg.ufs.filter((u) => !cfg.priorityUfs.includes(u)).sort((a, b) => size(b) - size(a) || a.localeCompare(b))];
  for (const uf of second) {
    if (out.length >= cfg.teams) break;
    const c = at(uf, 1);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, cfg.teams);
}

/* ═════════════════════ montagem das competições da temporada ═════════════════════ */

export interface ContinentalBuild {
  competitions: Competition[];
  /** clubes estrangeiros (fora do país da carreira) presentes na temporada */
  foreign: Set<string>;
}

function newComp(id: string, name: string, type: Competition['type'], clubIds: string[], extra: Partial<Competition>): Competition {
  return { id, name, type, clubIds: clubIds.slice(), doubleRound: false, relegated: 0, promoted: 0, fixtures: [], ...extra };
}

export interface ContinentalSeasonOptions {
  continental?: boolean;
  intercontinental?: boolean;
  supermundial?: SupermundialMode;
  regionalCups?: boolean;
}

/**
 * Competições da Fase 2 de uma temporada (Brasil): ligas sul-americanas, Libertadores, Sul-Americana, Recopa,
 * Intercontinental, Supermundial (se for ano) e Copa do Nordeste. Não inicializa (createSeasonFromWorld faz).
 */
export function continentalCompetitions(
  world: WorldState, data: CareerData, o: ContinentalSeasonOptions = {}, season = world.season,
  calendarOf?: (key: string, fallback?: string) => string[],
): ContinentalBuild {
  const reg = new Map(data.competitions.competitions.map((c) => [c.id, c]));
  // (Etapa 1) calendários reais (`real:<id>`) pelo chamador; sem ele, o MM-DD do original no ano civil
  const cal = (id: string) => (calendarOf ? calendarOf(id, id) : seasonDates(data.calendars.find((c) => c.id === id)?.dates, season));
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  const comps: Competition[] = [];
  const foreign = new Set<string>();
  const isForeign = (id: string) => (meta.get(id)?.countryId ?? world.countryId) !== world.countryId;
  const mark = (ids: string[]) => { for (const c of ids) if (isForeign(c)) foreign.add(c); };
  const regName = (id: string, d: string) => reg.get(id)?.name ?? d;
  const prio = (id: string) => reg.get(id)?.priority ?? 4;

  if (o.continental !== false) {
    // (Etapa 1) as ligas sul-americanas deixaram de ser montadas aqui: agora são divisões nacionais do mundo
    // (cycleCompetitions), com acesso e rebaixamento
    const q0 = world.continental?.season === season ? world.continental : qualifyContinental(data, season, { orders: { BRA: world.lastRanking['BRA-1'] ?? [] }, cupHolder: world.cupHolder });
    // sorteios por pote (força), como antes: a ordem das listas de vagas é a da colocação
    const q = continentalPots(q0, meta);
    // Libertadores
    const L = q.libertadores;
    const libAll = [...L.groups, ...L.f2, ...L.f1];
    comps.push(newComp('LIBERTADORES', regName('LIBERTADORES', 'Copa Libertadores'), 'continental', libAll, {
      format: libertadoresFormat(), entrants: { all: libAll, groups: L.groups, f2: L.f2, f1: L.f1 },
      calendar: cal('libertadores'), priority: prio('LIBERTADORES'), prizeKey: 'LIBERTADORES',
    }));
    mark(libAll);
    // Sul-Americana
    const S = q.sulamericana;
    const sulaAll = [...S.groups, ...S.prelim];
    comps.push(newComp('SULAMERICANA', regName('SULAMERICANA', 'Copa Sul-Americana'), 'continental', sulaAll, {
      format: sulamericanaFormat(), entrants: { all: sulaAll, groups: S.groups, prelim: S.prelim },
      calendar: cal('sulamericana'), priority: prio('SULAMERICANA'), prizeKey: 'SULAMERICANA',
    }));
    mark(sulaAll);
    // Recopa
    const { LIBERTADORES: lh, SULAMERICANA: sh } = q.holders;
    if (lh && sh && lh !== sh) {
      comps.push(newComp('RECOPA', regName('RECOPA', 'Recopa Sul-Americana'), 'continental', [lh, sh], {
        format: recopaFormat(), entrants: { all: [lh, sh] }, calendar: cal('recopa'), priority: prio('RECOPA'), prizeKey: 'RECOPA',
      }));
      mark([lh, sh]);
    }
    // (Etapa 2) Intercontinental e Supermundial saíram daqui: são competições da FIFA (confed.ts → worldCompetitions),
    // montadas uma vez por ano civil com os campeões de todas as confederações (convidados onde não há liga)
    for (const c of comps) c.confed = 'CONMEBOL';
  }
  // Copa do Nordeste (regional)
  if (o.regionalCups !== false && Object.keys(world.stateRanking).length) {
    const ids = nordesteEntrants(world, data);
    if (ids.length >= 8) {
      comps.push(newComp('NORDESTE', regName('NORDESTE', 'Copa do Nordeste'), 'cup', ids, {
        format: nordesteFormat(), entrants: { all: ids }, calendar: cal('nordeste'), priority: reg.get('NORDESTE')?.priority ?? 3,
        prizeKey: 'ESTADUAL', countryId: 29,
      }));
    }
  }
  return { competitions: comps, foreign };
}

/* ═════════════════════ repasses durante a temporada ═════════════════════ */

/** País de cada clube (para sorteios com restrição de país). */
export function continentalCountryOf(state: SeasonState): (id: string) => number | undefined {
  return (id: string) => state.clubInfo?.[id]?.countryId;
}

const deep = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Repasses entre competições (MUTA `state`). `shared` = competições ainda compartilhadas com a SeasonState de
 * entrada (advanceDay sem inPlace): elas são copiadas antes de mudar. Retorna true se gerou jogos novos.
 */
/**
 * Repassa `ids` como a lista de inscritos `key` da competição `targetId` (MUTA `state`; copia antes se a competição
 * ainda for compartilhada com a SeasonState de entrada) e faz a competição andar. Retorna true se gerou jogos.
 * (Etapa 2) Exportado: usado também pelos repasses genéricos (`Competition.links`, confed.ts).
 */
export function feedCompetition(state: SeasonState, targetId: string, key: string, ids: string[], date: string, shared: Competition[] | null): boolean {
  let t = state.competitions.find((c) => c.id === targetId);
  if (!t || t.finished || t.entrants?.[key]?.length) return false;
  // (13/11) repasse menor que o previsto (poucos clubes na origem): a exigência `requires` da fase passa a ser o
  // que veio — antes a fase esperava para sempre e a competição terminava à força sem campeão
  const short = (t.format?.stages ?? []).some((s) => s.requires?.some((r) => r.entrants === key && r.count > ids.length));
  if (!ids.length && (!short || t.entrants?.[key] !== undefined)) return false;
  if (shared?.includes(t)) {
    const copy = deep(t);
    state.competitions = state.competitions.map((c) => (c === t ? copy : c));
    t = copy;
  }
  (t.entrants ??= {})[key] = ids.slice();
  if (short) {
    t.format = { ...t.format!, stages: t.format!.stages.map((s) => (s.requires ? { ...s, requires: s.requires.map((r) => (r.entrants === key && r.count > ids.length ? { ...r, count: ids.length } : r)) } : s)) };
  }
  for (const c of ids) if (!t.clubIds.includes(c)) t.clubIds.push(c);
  const n = t.fixtures.length;
  progressCompetition(t, { seed: state.seed ?? 'season', minDate: date, countryOf: continentalCountryOf(state) });
  return t.fixtures.length > n;
}

export function linkContinental(state: SeasonState, date: string, shared: Competition[] | null): boolean {
  const lib = state.competitions.find((c) => c.id === 'LIBERTADORES');
  if (!lib) return false;
  let added = false;
  const f3 = lib.stages?.f3;
  if (f3?.status === 'done' && feedCompetition(state, 'SULAMERICANA', 'lib3', f3.losers ?? [], date, shared)) added = true;
  if (lib.stages?.groups?.status === 'done' && feedCompetition(state, 'SULAMERICANA', 'lib3rd', pick(lib, { stage: 'groups', ranks: [3, 3], perGroup: true } as PickRule), date, shared)) added = true;
  // (Etapa 2) campeão → Intercontinental: agora pelo repasse genérico (Competition.links, confed.ts)
  return added;
}

/** Inicializa (gera as fases iniciais) — usado pelos testes e por createSeasonFromWorld. */
export function initContinental(comps: Competition[], state: SeasonState, minDate: string): void {
  const ctx = { seed: state.seed ?? 'season', minDate, countryOf: continentalCountryOf(state) };
  for (const c of comps) initCompetition(c, ctx);
}
