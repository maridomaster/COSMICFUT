/**
 * (Etapa 1) Linha do tempo global com calendário duplo.
 *
 * Escopo geográfico (espelha packages/data/src/scope.mjs):
 *  - EU  (Europa)         → ciclo 'split'    (temporada cruzada, agosto–maio, rótulo "2026/27"), virada em 30/06;
 *  - SAU (Arábia Saudita) → ciclo 'split'    (como a Europa);
 *  - SA  (América do Sul) → ciclo 'calendar' (ano civil, janeiro–dezembro, rótulo "2026"), virada em 31/12.
 *
 * Relógio único: `SeasonState.date`. Uma SeasonState cobre um TRECHO (`SeasonState.segment`) entre duas viradas:
 *  - 01/01–30/06 do ano Y → depois dele vira o ciclo 'split' (fecha a temporada (Y−1)/Y; abre Y/(Y+1));
 *  - 01/07–31/12 do ano Y → depois dele vira o ciclo 'calendar' (fecha Y; abre Y+1).
 * Competições do outro ciclo atravessam a virada sem reiniciar (são copiadas para o trecho seguinte).
 * Envelhecimento/evolução anual: na virada de 30/06 → 01/07. Contratos vencem na virada da região do clube.
 *
 * Temporada de um ciclo (`cycleSeason`): 'calendar' = o ano; 'split' = o ano em que a temporada começa
 * (2026/27 → 2026). Contratos (`endsSeason`) usam a temporada do ciclo da região do clube: na Europa
 * "2026" = até 30/06/2027; na América do Sul "2026" = até 31/12/2026.
 */
import type { CareerData, SeasonState, TransferWindow } from '../contract';
import { addDays } from './schedule';

export type Cycle = 'calendar' | 'split';
export type Region = 'EU' | 'SA' | 'SAU';

/** Regiões em escopo e os seus países (siglas de countries.json). */
export const SCOPE_REGIONS: Record<Region, { cycle: Cycle; countries: string[]; name: string }> = {
  EU: { cycle: 'split', countries: ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'], name: 'Europa' },
  SA: { cycle: 'calendar', countries: ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'EQU'], name: 'América do Sul' },
  SAU: { cycle: 'split', countries: ['ARS'], name: 'Arábia Saudita' },
};
export const REGIONS: Region[] = ['SA', 'EU', 'SAU'];
export const SCOPE_CODES: string[] = REGIONS.flatMap((r) => SCOPE_REGIONS[r].countries);

/** Região de uma sigla de país (null = fora do escopo). */
export function regionOfCode(code: string | null | undefined): Region | null {
  if (!code) return null;
  for (const r of REGIONS) if (SCOPE_REGIONS[r].countries.includes(code)) return r;
  return null;
}

export function cycleOfRegion(r: Region | null | undefined): Cycle {
  return r ? SCOPE_REGIONS[r].cycle : 'calendar';
}

export function regionsOfCycle(c: Cycle): Region[] {
  return REGIONS.filter((r) => SCOPE_REGIONS[r].cycle === c);
}

/** Temporada do ciclo na data: 'calendar' = ano; 'split' = ano de início (jul–dez → Y; jan–jun → Y−1). */
export function cycleSeason(cycle: Cycle, date: string): number {
  const y = Number(date.slice(0, 4));
  if (cycle === 'calendar') return y;
  return date.slice(5) >= '07-01' ? y : y - 1;
}

/** Rótulo da temporada: "2026" (ano civil) ou "2026/27" (cruzada). */
export function seasonLabel(cycle: Cycle, season: number): string {
  return cycle === 'calendar' ? String(season) : `${season}/${String((season + 1) % 100).padStart(2, '0')}`;
}

/** Primeiro e último dia de uma temporada do ciclo. */
export function cycleStart(cycle: Cycle, season: number): string {
  return cycle === 'calendar' ? `${season}-01-01` : `${season}-07-01`;
}
export function cycleEnd(cycle: Cycle, season: number): string {
  return cycle === 'calendar' ? `${season}-12-31` : `${season + 1}-06-30`;
}

/**
 * Trecho da linha do tempo que começa em `start` (01/01 ou 01/07): vai até a próxima virada (30/06 ou 31/12) e
 * fecha o ciclo cuja temporada termina nesse dia.
 */
export function segmentFrom(start: string): { start: string; end: string; closes: Cycle } {
  const y = Number(start.slice(0, 4));
  return start.slice(5) < '07-01'
    ? { start, end: `${y}-06-30`, closes: 'split' }
    : { start, end: `${y}-12-31`, closes: 'calendar' };
}

/**
 * Semana do ano (1–52) para a UI: dia do ano / 7, arredondado para cima; os 1–2 últimos dias do ano ficam na 52.
 * (Não é a semana ISO: a semana 1 sempre começa em 01/01.)
 */
export function weekOfYear(date: string): number {
  const t = Date.parse(date.slice(0, 10) + 'T00:00:00Z');
  const y0 = Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`);
  const doy = Math.floor((t - y0) / 86400000) + 1;
  return Math.min(52, Math.max(1, Math.ceil(doy / 7)));
}

/* ═════════════════════ janelas de transferência por região ═════════════════════ */

/** Janelas por região ('MM-DD', inclusive). Europa: 01/07–01/09 e 01/01–02/02; Arábia: 01/07–01/09 e 01/01–31/01;
 * América do Sul: janeiro–março e julho–setembro. */
export const TRANSFER_WINDOWS: Record<Region, [string, string][]> = {
  EU: [['01-01', '02-02'], ['07-01', '09-01']],
  SAU: [['01-01', '01-31'], ['07-01', '09-01']],
  SA: [['01-01', '03-31'], ['07-01', '09-30']],
};

/** Estado da janela de transferências da região na data. */
export function windowFor(region: Region | null | undefined, date: string): TransferWindow {
  const wins = TRANSFER_WINDOWS[region ?? 'SA'];
  const y = Number(date.slice(0, 4));
  const md = date.slice(5, 10);
  for (const [a, b] of wins) if (md >= a && md <= b) return { open: true, closesOn: `${y}-${b}`, opensOn: null };
  const next = wins.find(([a]) => a > md);
  return { open: false, closesOn: null, opensOn: next ? `${y}-${next[0]}` : `${y + 1}-${wins[0][0]}` };
}

/* ═════════════════════ clubes na SeasonState ═════════════════════ */

/** Região do clube (ClubEconomyInfo.region; saves/temporadas avulsas sem região ⇒ null). */
export function regionOfClub(state: SeasonState, clubId: string): Region | null {
  return (state.clubInfo?.[clubId]?.region as Region | undefined) ?? null;
}

/**
 * Temporada "contratual" do clube na data (ciclo da sua região). Sem região (temporada avulsa/antiga) ⇒ state.season.
 * Use para `endsSeason` de contratos e anos restantes.
 */
export function clubSeason(state: SeasonState, clubId: string | null | undefined, date = state.date): number {
  const r = clubId ? regionOfClub(state, clubId) : null;
  if (!r || !state.segment) return state.season;
  return cycleSeason(cycleOfRegion(r), date);
}

/** Região "principal" da SeasonState (1º humano; sem humanos ⇒ SA). Janela do mercado da IA. */
export function primaryRegion(state: SeasonState): Region {
  for (const id of state.humanClubIds) {
    const r = regionOfClub(state, id);
    if (r) return r;
  }
  return 'SA';
}

/** Data de fim padrão de empréstimo a partir de `date`, pelo ciclo da região (fim do semestre da temporada). */
export function defaultLoanUntil(state: SeasonState, clubId: string | null | undefined): string {
  const r = clubId ? regionOfClub(state, clubId) : null;
  if (!r || !state.segment) return `${state.season}-12-15`;
  const cyc = cycleOfRegion(r);
  const s = cycleSeason(cyc, state.date);
  return addDays(cycleEnd(cyc, s), -15);
}

/* ═════════════════════ viradas ═════════════════════ */

/** Ciclo cuja virada já é devida (a data passou do fim do trecho), ou null. */
export function turnoverDue(state: SeasonState): Cycle | null {
  const seg = state.segment;
  if (!seg) return null;
  return state.date > seg.end ? seg.closes : null;
}

/** A virada do ciclo afeta algum clube humano (região do clube nesse ciclo)? */
export function turnoverAffectsHumans(state: SeasonState, cycle: Cycle): boolean {
  return state.humanClubIds.some((id) => cycleOfRegion(regionOfClub(state, id)) === cycle && regionOfClub(state, id) !== null);
}

/** Virada devida que NÃO envolve humanos (UI/servidor fazem sozinhos, sem tela de fim de temporada). */
export function autoTurnoverDue(state: SeasonState): boolean {
  const due = turnoverDue(state);
  return due !== null && !turnoverAffectsHumans(state, due);
}

/** Ciclo de uma competição (ausente ⇒ 'calendar', como as temporadas antigas de ano civil). */
export function cycleOfCompetition(c: { cycle?: Cycle }): Cycle {
  return c.cycle ?? 'calendar';
}

/* ═════════════════════ calendários reais ═════════════════════ */

const DAY = 86400000;

/**
 * Desloca datas ISO de `from` para `to` temporadas por SEMANAS inteiras (mantém o dia da semana): desvio ≤ 3 dias em
 * relação ao mesmo dia/mês. Datas ficam dentro da temporada do ciclo (`clamp`).
 */
export function shiftDates(dates: string[], from: number, to: number, clamp?: [string, string]): string[] {
  const weeks = Math.round(((to - from) * 365.2425) / 7);
  const out = dates.map((d) => new Date(Date.parse(d + 'T00:00:00Z') + weeks * 7 * DAY).toISOString().slice(0, 10));
  const c = clamp ? out.map((d) => (d < clamp[0] ? clamp[0] : d > clamp[1] ? clamp[1] : d)) : out;
  return Array.from(new Set(c)).sort();
}

/**
 * Datas de um calendário para a temporada `season` do ciclo. Procura `real:<key>` (datas completas, temporada-base
 * `entry.season`) e desloca por semanas; sem ele, usa o calendário 'MM-DD' `fallback` do original (ano civil: o
 * próprio ano; temporada cruzada: julho–dezembro no ano de início e janeiro–junho no seguinte). Ordenado, sem repetir.
 */
export function cycleCalendar(data: Pick<CareerData, 'calendars'>, key: string, cycle: Cycle, season: number, fallback?: string): string[] {
  const real = data.calendars.find((c) => c.id === `real:${key}`) as (CareerData['calendars'][number] & { season?: number }) | undefined;
  const lo = addDays(cycleStart(cycle, season), 1), hi = addDays(cycleEnd(cycle, season), -1);
  if (real?.dates.length && /^\d{4}-/.test(real.dates[0])) {
    const base = real.season ?? Number(real.dates[0].slice(0, 4));
    return shiftDates(real.dates, base, season, [lo, hi]);
  }
  const md = data.calendars.find((c) => c.id === (fallback ?? key))?.dates ?? [];
  const out = md.map((x) => (cycle === 'calendar' || x >= '07-01' ? `${season}-${x}` : `${season + 1}-${x}`)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return Array.from(new Set(out)).sort();
}
