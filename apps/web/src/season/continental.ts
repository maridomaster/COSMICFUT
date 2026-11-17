/**
 * (Fase 2) Leituras das competições continentais/regionais/estrangeiras para a UI (puras, sem React):
 *  - categorias da página Competições (nacional, copa, estadual, continental, regional, estrangeira);
 *  - projeção das vagas continentais com a MESMA regra da engine (`qualifyContinental`), usada no card "Vagas",
 *    nas zonas da tabela da Série A e na prévia do fim de temporada;
 *  - textos amigáveis para os motivos de classificação (`ContinentalQualifiers.reason`).
 */
import {
  continentalConfig, qualificationZones, qualifyContinental,
  type CareerData, type Competition, type ContinentalQualifiers, type QualZoneInfo, type SeasonState, type WorldState,
} from '@cosmicfut/engine';
import type { Zone } from './view';

/* ═════════════════════ (Etapa 2) vagas de qualquer liga ═════════════════════ */

/** Zonas nominais da liga (engine `qualificationZones`) como zonas da tabela. */
export function leagueVagas(data: CareerData | null, comp: Competition): QualZoneInfo[] {
  if (!data || comp.type !== 'league') return [];
  return qualificationZones(data, comp.id, comp.clubIds.length);
}

export function vagasZone(zones: QualZoneInfo[]): (pos: number) => Zone {
  return (pos) => (zones.find((z) => pos >= z.from && pos <= z.to)?.zone ?? null) as Zone;
}

export interface ConfedRow {
  clubId: string;
  comp: string;
  why: string;
  zone: Exclude<Zone, null>;
}

const CONFED_COMP: Record<string, { name: string; zone: Exclude<Zone, null> }> = {
  UCL: { name: 'Liga dos Campeões', zone: 'ucl' },
  UEL: { name: 'Liga Europa', zone: 'uel' },
  UECL: { name: 'Liga Conferência', zone: 'uecl' },
  west: { name: 'AFC Elite (Oeste)', zone: 'acl' },
  east: { name: 'AFC Elite (Leste)', zone: 'acl' },
  playoff: { name: 'AFC Elite (playoff)', zone: 'aclpo' },
};

/**
 * Clubes de um país nas vagas UEFA/AFC gravadas no mundo (`world.uefa` / `world.afc`) com o motivo, e a temporada a
 * que se referem ("2026/27"). Vazio se o país não for UEFA/AFC em escopo.
 */
export function confedRows(world: WorldState | null | undefined, data: CareerData | null, countryId: number | undefined): { season: number | null; rows: ConfedRow[] } {
  if (!world || !data || countryId === undefined) return { season: null, rows: [] };
  const country = new Map(data.clubs.map((c) => [c.id, c.countryId]));
  for (const q of [world.uefa, world.afc]) {
    if (!q) continue;
    const rows: ConfedRow[] = [];
    for (const [k, list] of Object.entries(q.lists)) {
      for (const id of list) if (country.get(id) === countryId) rows.push({ clubId: id, comp: CONFED_COMP[k]?.name ?? k, why: q.reason[id] ?? '', zone: CONFED_COMP[k]?.zone ?? 'qualify' });
    }
    if (rows.length) return { season: q.season, rows };
  }
  return { season: null, rows: [] };
}

export const BRAZIL_COUNTRY_ID = 29;

export type CompCategory = 'nacional' | 'copa' | 'estadual' | 'continental' | 'regional' | 'estrangeira';

export const CATEGORY_LABEL: Record<CompCategory, string> = {
  nacional: 'Nacionais',
  copa: 'Copas',
  estadual: 'Estaduais',
  continental: 'Continentais',
  regional: 'Regionais',
  estrangeira: 'Estrangeiras',
};

/** Copas regionais conhecidas (a engine cria a do Nordeste; as demais são pendência da engine). */
const REGIONAL_IDS = new Set(['NORDESTE', 'COPA-VERDE', 'SUL-SUDESTE', 'VERDE', 'SULSUDESTE']);

/** Ordem de exibição das continentais. (Etapa 2) UEFA, AFC e FIFA. */
export const CONTINENTAL_ORDER = [
  'LIBERTADORES', 'SULAMERICANA', 'RECOPA', 'UCL', 'UEL', 'UECL', 'UEFA-SUP', 'ACL', 'INTERCONTINENTAL', 'SUPERMUNDIAL',
];

export const careerCountryOf = (s: SeasonState): number => s.career?.countryId ?? BRAZIL_COUNTRY_ID;

export function compCategory(c: Competition, careerCountry: number): CompCategory {
  if (c.type === 'continental' || c.confed) return 'continental';
  if (c.type === 'state') return 'estadual';
  if (REGIONAL_IDS.has(c.id) || (c.type === 'cup' && !/^[A-Z]{3}-/.test(c.id))) return 'regional';
  // (Etapa 1) ligas, copas e supercopas de outros países (todas as ligas em escopo rodam em paralelo)
  if (c.countryId !== undefined && c.countryId !== careerCountry) return 'estrangeira';
  if (c.type === 'league') return 'nacional';
  return 'copa';
}

export const isContinental = (c: Competition | undefined): boolean => c?.type === 'continental';

/** Estilo visual (não oficial) de cada continental: cores do selo e rótulo curto. */
export interface ContinentalStyle {
  /** cor principal do selo */
  main: string;
  /** cor de apoio (brilho/borda) */
  glow: string;
  short: string;
}

export function continentalStyle(id: string): ContinentalStyle {
  switch (id) {
    case 'LIBERTADORES':
      return { main: '#d4a72c', glow: '#f6d77a', short: 'LIB' };
    case 'SULAMERICANA':
      return { main: '#2f6fd6', glow: '#8fb8ff', short: 'SUL' };
    case 'RECOPA':
      return { main: '#7c5cd6', glow: '#c4b5fd', short: 'REC' };
    case 'INTERCONTINENTAL':
      return { main: '#0ea5a4', glow: '#7ee7e0', short: 'INT' };
    case 'SUPERMUNDIAL':
      return { main: '#e0592a', glow: '#ffb38f', short: 'MUN' };
    case 'NORDESTE':
      return { main: '#e08a1e', glow: '#ffd08a', short: 'NE' };
    // (Etapa 2) UEFA e AFC (cores não oficiais)
    case 'UCL':
      return { main: '#1e3a8a', glow: '#93c5fd', short: 'UCL' };
    case 'UEL':
      return { main: '#ea580c', glow: '#fdba74', short: 'UEL' };
    case 'UECL':
      return { main: '#15803d', glow: '#86efac', short: 'UECL' };
    case 'UEFA-SUP':
      return { main: '#334155', glow: '#cbd5e1', short: 'SUP' };
    case 'ACL':
      return { main: '#0369a1', glow: '#7dd3fc', short: 'ACL' };
    default:
      return { main: '#64748b', glow: '#cbd5e1', short: id.slice(0, 3) };
  }
}

/* ═════════════════════ vagas continentais ═════════════════════ */

export type QualZone = 'libertadores' | 'libpre' | 'sula';

const CUP_PLACEHOLDER = '__copa-nacional__';

export interface QualProjection {
  /** temporada em que as vagas serão disputadas */
  season: number;
  q: ContinentalQualifiers;
  /** clube → zona (só clubes do país da carreira) */
  zone: Map<string, QualZone>;
  /** a copa nacional ainda não tem campeão (a vaga dela está reservada) */
  cupPending: boolean;
}

/**
 * Projeção das vagas do ano seguinte com a regra da engine (`qualifyContinental`): campeões continentais e da
 * copa entram direto nos grupos; as demais vagas seguem a ordem da liga, com repasse.
 * `leagueOrder`: classificação da 1ª divisão do país (atual ou final).
 */
export function projectContinental(state: SeasonState, data: CareerData, code: string, leagueOrder: string[]): QualProjection {
  const cup = state.competitions.find((c) => c.id === `${code}-CUP`);
  const champ = (id: string) => state.competitions.find((c) => c.id === id)?.championId ?? null;
  const cupPending = !!cup && !cup.championId;
  const q = qualifyContinental(data, state.season + 1, {
    orders: { [code]: leagueOrder },
    // copa ainda em disputa: a vaga do campeão fica reservada (como no fim de temporada)
    cupHolder: cup?.championId ?? (cup ? CUP_PLACEHOLDER : null),
    holders: { LIBERTADORES: champ('LIBERTADORES'), SULAMERICANA: champ('SULAMERICANA') },
  });
  const mine = new Set(leagueOrder);
  const zone = new Map<string, QualZone>();
  for (const id of q.libertadores.groups) if (mine.has(id)) zone.set(id, 'libertadores');
  for (const id of [...q.libertadores.f2, ...q.libertadores.f1]) if (mine.has(id)) zone.set(id, 'libpre');
  for (const id of [...q.sulamericana.groups, ...q.sulamericana.prelim]) if (mine.has(id) && !zone.has(id)) zone.set(id, 'sula');
  return { season: state.season + 1, q, zone, cupPending };
}

/** Vagas por posição na liga (regra fixa do país, sem repasse) — para a legenda do card "Vagas". */
export function slotRules(data: CareerData, code: string): { libGroups: number; libF2: number; libF1: number; sulaGroups: number; sulaPrelim: number; cupSlot: boolean } {
  const cfg = continentalConfig(data);
  const l = cfg.libertadores[code];
  const s = cfg.sulamericana[code];
  const cupSlot = !!l?.cupSlot;
  return {
    libGroups: Math.max(0, (l?.groups ?? 0) - (cupSlot ? 1 : 0)),
    libF2: l?.f2 ?? 0,
    libF1: l?.f1 ?? 0,
    sulaGroups: s?.groups ?? 0,
    sulaPrelim: s?.prelim ?? 0,
    cupSlot,
  };
}

export interface QualifierRow {
  clubId: string;
  comp: 'Libertadores' | 'Sul-Americana';
  phase: string;
  /** motivo amigável: "3º no Brasileirão Série A", "Campeão da Copa do Brasil" */
  why: string;
  zone: QualZone;
}

/**
 * Linhas "quem se classificou e por quê" para os clubes do país da carreira.
 * `order`: ordem da liga (posição exibida quando o motivo da engine não traz a posição).
 */
export function qualifierRows(
  q: ContinentalQualifiers, clubIds: string[], ctx: { leagueName: string; cupName: string; order?: string[] },
): QualifierRow[] {
  const out: QualifierRow[] = [];
  const L = q.libertadores;
  const S = q.sulamericana;
  const why = (id: string) => {
    const raw = q.reason[id] ?? '';
    if (/^Campeão/i.test(raw)) return raw.replace('Copa Nacional', ctx.cupName);
    const pos = /\s(\d+)º\s/.exec(` ${raw} `)?.[1] ?? (ctx.order ? String(ctx.order.indexOf(id) + 1) : null);
    return pos && pos !== '0' ? `${pos}º no ${ctx.leagueName}` : `Pela tabela do ${ctx.leagueName}`;
  };
  const push = (id: string, comp: QualifierRow['comp'], phase: string, zone: QualZone) => {
    if (clubIds.includes(id) && !out.some((r) => r.clubId === id)) out.push({ clubId: id, comp, phase, why: why(id), zone });
  };
  for (const id of L.groups) push(id, 'Libertadores', 'Fase de grupos', 'libertadores');
  for (const id of L.f2) push(id, 'Libertadores', '2ª fase (preliminar)', 'libpre');
  for (const id of L.f1) push(id, 'Libertadores', '1ª fase (preliminar)', 'libpre');
  for (const id of S.groups) push(id, 'Sul-Americana', 'Fase de grupos', 'sula');
  for (const id of S.prelim) push(id, 'Sul-Americana', 'Fase preliminar', 'sula');
  // dentro de cada fase: campeões primeiro, depois a ordem da tabela (as listas da engine vêm por pote/força)
  if (ctx.order) {
    const pos = (id: string) => (ctx.order!.indexOf(id) + 1 || 999) + (/^Campeão/i.test(q.reason[id] ?? '') ? -1000 : 0);
    const key = (r: QualifierRow) => `${r.comp}|${r.phase}`;
    const groups = [...new Set(out.map(key))];
    return groups.flatMap((g) => out.filter((r) => key(r) === g).sort((a, b) => pos(a.clubId) - pos(b.clubId)));
  }
  return out;
}
