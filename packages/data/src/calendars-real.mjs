// COSMICFUT — calendários reais (Etapa 1: escopo geográfico e calendário duplo).
//
// Datas COMPLETAS (AAAA-MM-DD), uma por "slot" da competição, para a temporada-base:
//  - América do Sul: ano civil 2026 (cycle 'calendar', season 2026, rótulo "2026");
//  - Europa e Arábia: 2026/27 (cycle 'split', season 2026, rótulo "2026/27").
// Em anos seguintes a engine desloca as datas por semanas inteiras (mantém o dia da semana): ver
// packages/engine/src/season/timeline.ts (`cycleCalendar`).
//
// Saída: entradas `{ id: 'real:<chave>', cycle, season, dates }` acrescentadas a calendars.json (os calendários
// MM-DD do original continuam lá, sem uso pela carreira).
//
// Fontes: calendários oficiais/anunciados de 2026 e 2026/27 conforme o conhecimento disponível (datas exatas de
// rodadas intermediárias são aproximadas; início, fim e pausas seguem o anúncio).

const DAY = 86400000;
const toMs = (iso) => Date.parse(iso + 'T00:00:00Z');
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromMs(toMs(iso) + n * DAY);
/** 0 = domingo ... 6 = sábado */
export const dow = (iso) => new Date(toMs(iso)).getUTCDay();

function range(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
const inAny = (d, pauses) => pauses.some(([a, b]) => d >= a && d <= b);

/** `k` itens espalhados uniformemente de `arr` (mantém a ordem). */
function pickEven(arr, k) {
  if (k <= 0) return [];
  if (k >= arr.length) return arr.slice();
  if (k === 1) return [arr[Math.floor(arr.length / 2)]];
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (k - 1))]);
  return [...new Set(out)];
}

/**
 * Datas de uma liga: 1ª e última rodada fixas; o resto nos fins de semana (`weekend`, dia da semana) fora das
 * pausas; se faltar fim de semana, completa com rodadas no meio da semana (`midweek`), longe dos fins de semana.
 */
export function leagueDates({ start, end, rounds, weekend = 6, midweek = 3, pauses = [] }) {
  if (rounds <= 1) return [start];
  const inner = range(addDays(start, 1), addDays(end, -1)).filter((d) => !inAny(d, pauses));
  const weekends = inner.filter((d) => dow(d) === weekend && Math.abs(toMs(d) - toMs(start)) > 2 * DAY && Math.abs(toMs(end) - toMs(d)) > 2 * DAY);
  const need = rounds - 2;
  let picked;
  if (weekends.length >= need) picked = pickEven(weekends, need);
  else {
    const near = (d) => weekends.some((w) => Math.abs(toMs(w) - toMs(d)) <= 2 * DAY);
    const mids = inner.filter((d) => dow(d) === midweek && !near(d) && Math.abs(toMs(d) - toMs(start)) > 2 * DAY && Math.abs(toMs(end) - toMs(d)) > 2 * DAY);
    let extra = pickEven(mids, need - weekends.length);
    // ainda curto: completa com meios de semana restantes (sem repetir)
    if (weekends.length + extra.length < need) {
      const rest = inner.filter((d) => !weekends.includes(d) && !extra.includes(d) && dow(d) !== weekend && Math.abs(toMs(d) - toMs(start)) > 1 * DAY && Math.abs(toMs(end) - toMs(d)) > 1 * DAY);
      extra = [...extra, ...pickEven(rest, need - weekends.length - extra.length)];
    }
    picked = [...weekends, ...extra];
  }
  return [...new Set([start, ...picked, end])].sort();
}

/** Uma data a cada `step` dias entre `start` e `end` (inclusive; `end` sempre entra). */
export function everyDays(start, end, step, pauses = []) {
  const out = [];
  for (let d = start; d < end; d = addDays(d, step)) if (!inAny(d, pauses)) out.push(d);
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}

/** Nº de rodadas de pontos corridos (ímpar ⇒ folga). */
export const leagueRounds = (teams, doubleRound = true) => (teams % 2 === 0 ? teams - 1 : teams) * (doubleRound ? 2 : 1);

/* ═════════════════════ pausas ═════════════════════ */

/** Copa do Mundo 2026: sem jogos de clubes sul-americanos de 11/06 a 19/07. */
export const WORLD_CUP_2026 = ['2026-06-11', '2026-07-19'];
/** Datas Fifa 2026/27 (fins de semana sem rodada nas ligas europeias e na saudita). */
export const FIFA_WINDOWS_2026_27 = [
  ['2026-08-31', '2026-09-08'], ['2026-10-05', '2026-10-13'], ['2026-11-09', '2026-11-17'], ['2027-03-22', '2027-03-30'],
];
const BUNDESLIGA_WINTER = ['2026-12-21', '2027-01-08'];
const FRANCE_WINTER = ['2026-12-21', '2027-01-01'];
const HOLLAND_WINTER = ['2026-12-21', '2027-01-14'];
const ITALY_SPAIN_XMAS = ['2026-12-24', '2026-12-26'];
/** Copa da Ásia 2027 (na Arábia Saudita, 07/01–05/02): a Saudi Pro League para. */
const ASIAN_CUP_2027 = ['2026-12-28', '2027-02-07'];

/* ═════════════════════ especificações ═════════════════════ */

/**
 * Especificação por liga (ids de leagues.json). `rounds` sai do nº de clubes. Divisões fora desta tabela usam a
 * especificação genérica da região (`REGION_DEFAULT`).
 */
const EU = { cycle: 'split', season: 2026 };
const SA = { cycle: 'calendar', season: 2026 };
export const LEAGUE_SPECS = {
  // Europa 2026/27 — (Etapa 2) `extra` = datas dos playoffs de acesso/rebaixamento internos, depois da última rodada
  'ING-1': { ...EU, start: '2026-08-22', end: '2027-05-23', weekend: 6, midweek: 3, pauses: FIFA_WINDOWS_2026_27 },
  'ING-2': { ...EU, start: '2026-08-08', end: '2027-05-01', weekend: 6, midweek: 2, pauses: FIFA_WINDOWS_2026_27, extra: ['2027-05-07', '2027-05-11', '2027-05-24'] },
  'ESP-1': { ...EU, start: '2026-08-16', end: '2027-05-23', weekend: 0, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, ITALY_SPAIN_XMAS] },
  'ESP-2': { ...EU, start: '2026-08-15', end: '2027-05-30', weekend: 6, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, ITALY_SPAIN_XMAS], extra: ['2027-06-03', '2027-06-06', '2027-06-10', '2027-06-13'] },
  'ITA-1': { ...EU, start: '2026-08-23', end: '2027-05-23', weekend: 0, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, ITALY_SPAIN_XMAS] },
  'ITA-2': { ...EU, start: '2026-08-22', end: '2027-05-14', weekend: 6, midweek: 2, pauses: [...FIFA_WINDOWS_2026_27, ITALY_SPAIN_XMAS], extra: ['2027-05-18', '2027-05-21', '2027-05-25', '2027-05-28', '2027-06-01'] },
  'ALE-1': { ...EU, start: '2026-08-28', end: '2027-05-15', weekend: 6, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, BUNDESLIGA_WINTER] },
  'ALE-2': { ...EU, start: '2026-08-01', end: '2027-05-16', weekend: 0, midweek: 2, pauses: [...FIFA_WINDOWS_2026_27, BUNDESLIGA_WINTER] },
  'FRA-1': { ...EU, start: '2026-08-22', end: '2027-05-22', weekend: 0, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, FRANCE_WINTER] },
  'FRA-2': { ...EU, start: '2026-08-08', end: '2027-05-08', weekend: 6, midweek: 2, pauses: [...FIFA_WINDOWS_2026_27, FRANCE_WINTER], extra: ['2027-05-12', '2027-05-16'] },
  'POR-1': { ...EU, start: '2026-08-09', end: '2027-05-16', weekend: 0, midweek: 3, pauses: FIFA_WINDOWS_2026_27 },
  'POR-2': { ...EU, start: '2026-08-09', end: '2027-05-16', weekend: 6, midweek: 3, pauses: FIFA_WINDOWS_2026_27 },
  'HOL-1': { ...EU, start: '2026-08-08', end: '2027-05-16', weekend: 0, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, HOLLAND_WINTER] },
  'HOL-2': { ...EU, start: '2026-08-07', end: '2027-05-07', weekend: 5, midweek: 1, pauses: [...FIFA_WINDOWS_2026_27, HOLLAND_WINTER] },
  // Arábia Saudita 2026/27
  'ARS-1': { ...EU, start: '2026-08-27', end: '2027-05-20', weekend: 5, midweek: 2, pauses: [...FIFA_WINDOWS_2026_27, ASIAN_CUP_2027] },
  'ARS-2': { ...EU, start: '2026-09-04', end: '2027-05-15', weekend: 6, midweek: 3, pauses: [...FIFA_WINDOWS_2026_27, ASIAN_CUP_2027], extra: ['2027-05-19', '2027-05-23'] },
  // América do Sul 2026 (pausa da Copa do Mundo); `rounds` = datas do formato real quando não é pontos corridos
  'BRA-1': { ...SA, start: '2026-01-28', end: '2026-12-02', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026] },
  'BRA-2': { ...SA, start: '2026-03-21', end: '2026-11-28', weekend: 6, midweek: 2, pauses: [WORLD_CUP_2026], extra: ['2026-12-02', '2026-12-06'] },
  // Colômbia: Apertura (19 + 6 cuadrangulares + 2 final) e Finalización (idem) = 54 datas
  'COL-1': { ...SA, start: '2026-01-24', end: '2026-12-13', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026], rounds: 54 },
  'COL-2': { ...SA, start: '2026-02-01', end: '2026-11-29', weekend: 6, midweek: 3, pauses: [WORLD_CUP_2026] },
  'CHI-1': { ...SA, start: '2026-02-07', end: '2026-12-06', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026] },
  'CHI-2': { ...SA, start: '2026-02-14', end: '2026-11-28', weekend: 6, midweek: 3, pauses: [WORLD_CUP_2026], extra: ['2026-12-02', '2026-12-06', '2026-12-10', '2026-12-13'] },
  // Paraguai: Apertura e Clausura em ida e volta (12 clubes: 22 + 22)
  'PAR-1': { ...SA, start: '2026-01-30', end: '2026-12-06', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026], rounds: 44 },
  'PAR-2': { ...SA, start: '2026-03-07', end: '2026-11-21', weekend: 6, midweek: 3, pauses: [WORLD_CUP_2026] },
  // Equador (LigaPro): 1ª fase 30 + 2ª fase 10
  'EQU-1': { ...SA, start: '2026-02-20', end: '2026-12-06', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026], rounds: 40 },
  'ARG-2': { ...SA, start: '2026-02-07', end: '2026-11-28', weekend: 6, midweek: 3, pauses: [WORLD_CUP_2026], extra: ['2026-12-02', '2026-12-06'] },
  'URU-2': { ...SA, start: '2026-03-14', end: '2026-11-28', weekend: 6, midweek: 3, pauses: [WORLD_CUP_2026], extra: ['2026-12-02', '2026-12-06', '2026-12-10', '2026-12-13'] },
};
const REGION_DEFAULT = {
  EU: { ...EU, start: '2026-08-15', end: '2027-05-22', weekend: 6, midweek: 3, pauses: FIFA_WINDOWS_2026_27 },
  SAU: { ...EU, start: '2026-08-27', end: '2027-05-20', weekend: 5, midweek: 2, pauses: [...FIFA_WINDOWS_2026_27, ASIAN_CUP_2027] },
  SA: { ...SA, start: '2026-02-01', end: '2026-11-29', weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026] },
};

/** Calendários de competições com nº de datas fixo (formatos com `slots`). */
const FIXED = {
  // América do Sul 2026
  estaduais: { ...SA, dates: everyDays('2026-01-11', '2026-03-08', 3) },
  // (Etapa 2) Copa do Brasil 2026: 1ª a 4ª fases (JU), 5ª fase (16-avos, I/V), oitavas, quartas e semi I/V, final única
  'BRA-CUP': { ...SA, dates: ['2026-02-18', '2026-03-04', '2026-03-18', '2026-04-15', '2026-04-29', '2026-05-13', '2026-07-29', '2026-08-05', '2026-08-26', '2026-09-02', '2026-10-21', '2026-11-04', '2026-12-06'] },
  'BRA-SUP': { ...SA, dates: ['2026-02-01'] },
  libertadores: {
    ...SA,
    dates: ['2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-04-08', '2026-04-22', '2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27',
      '2026-08-12', '2026-08-19', '2026-09-16', '2026-09-23', '2026-10-21', '2026-10-28', '2026-11-28'],
  },
  sulamericana: {
    ...SA,
    dates: ['2026-03-05', '2026-04-09', '2026-04-23', '2026-05-07', '2026-05-14', '2026-05-21', '2026-05-28', '2026-07-22', '2026-07-29', '2026-08-13', '2026-08-20',
      '2026-09-17', '2026-09-24', '2026-10-22', '2026-10-29', '2026-11-21'],
  },
  recopa: { ...SA, dates: ['2026-02-19', '2026-02-26'] },
  nordeste: { ...SA, dates: ['2026-03-25', '2026-04-01', '2026-04-15', '2026-04-29', '2026-05-06', '2026-05-20', '2026-05-27', '2026-06-03', '2026-07-22', '2026-07-29'] },
  intercontinental: { ...SA, dates: ['2026-09-22', '2026-12-09', '2026-12-10', '2026-12-13', '2026-12-17'] },
  supermundial: { ...SA, dates: ['2026-06-15', '2026-06-19', '2026-06-23', '2026-06-28', '2026-07-02', '2026-07-07', '2026-07-12'] },
  apertura: { ...SA, dates: leagueDates({ start: '2026-01-24', end: '2026-05-31', rounds: 20, weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026] }) },
  clausura: { ...SA, dates: leagueDates({ start: '2026-07-25', end: '2026-12-06', rounds: 20, weekend: 0, midweek: 3, pauses: [WORLD_CUP_2026] }) },
  'cup-SA': { ...SA, dates: ['2026-02-25', '2026-04-01', '2026-05-06', '2026-08-05', '2026-09-09', '2026-10-07', '2026-11-04', '2026-11-18'] },
  'supercup-SA': { ...SA, dates: ['2026-01-25'] },
  // (Etapa 2) copas e supercopas reais da América do Sul 2026
  'ARG-CUP': { ...SA, dates: ['2026-03-04', '2026-05-13', '2026-08-05', '2026-09-09', '2026-10-14', '2026-11-11'] },
  'URU-CUP': { ...SA, dates: ['2026-07-29', '2026-08-19', '2026-09-09', '2026-09-30', '2026-10-21', '2026-11-11'] },
  'COL-CUP': { ...SA, dates: ['2026-03-04', '2026-04-15', '2026-07-29', '2026-08-12', '2026-09-09', '2026-09-23', '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-18'] },
  'CHI-CUP': { ...SA, dates: ['2026-04-15', '2026-07-29', '2026-09-09', '2026-10-14', '2026-10-28', '2026-11-18'] },
  'PAR-CUP': { ...SA, dates: ['2026-05-13', '2026-07-29', '2026-08-26', '2026-09-30', '2026-10-28'] },
  'EQU-CUP': { ...SA, dates: ['2026-04-15', '2026-07-29', '2026-08-12', '2026-09-09', '2026-09-23', '2026-10-21'] },
  'ARG-SUP': { ...SA, dates: ['2026-02-28'] },
  'URU-SUP': { ...SA, dates: ['2026-01-25'] },
  'COL-SUP': { ...SA, dates: ['2026-01-17', '2026-01-21'] },
  'CHI-SUP': { ...SA, dates: ['2026-01-18'] },
  'PAR-SUP': { ...SA, dates: ['2026-01-25'] },
  // Europa 2026/27
  'cup-EU': { ...EU, dates: ['2026-09-23', '2026-10-28', '2026-12-02', '2027-01-13', '2027-02-10', '2027-03-03', '2027-04-21', '2027-05-15'] },
  'supercup-EU': { ...EU, dates: ['2026-08-12'] },
  // (Etapa 2) copas nacionais (uma data por rodada; semifinais de ida e volta onde o real é assim)
  'ING-CUP': { ...EU, dates: ['2027-01-09', '2027-02-13', '2027-03-06', '2027-04-03', '2027-04-24', '2027-05-15'] },
  'ING-LCUP': { ...EU, dates: ['2026-08-26', '2026-09-23', '2026-10-28', '2026-12-16', '2027-01-13', '2027-02-03', '2027-03-21'] },
  'ESP-CUP': { ...EU, dates: ['2026-10-29', '2026-12-03', '2027-01-14', '2027-02-04', '2027-02-11', '2027-03-04', '2027-04-24'] },
  'ITA-CUP': { ...EU, dates: ['2026-08-15', '2026-09-23', '2026-12-02', '2027-02-04', '2027-03-03', '2027-04-21', '2027-05-13'] },
  'ALE-CUP': { ...EU, dates: ['2026-08-15', '2026-10-28', '2026-12-02', '2027-02-03', '2027-04-21', '2027-05-22'] },
  'FRA-CUP': { ...EU, dates: ['2026-12-19', '2027-01-16', '2027-02-06', '2027-03-03', '2027-04-21', '2027-05-15'] },
  'POR-CUP': { ...EU, dates: ['2026-10-17', '2026-11-21', '2027-01-13', '2027-02-04', '2027-03-03', '2027-04-21', '2027-05-23'] },
  'HOL-CUP': { ...EU, dates: ['2026-10-28', '2026-12-16', '2027-01-20', '2027-02-10', '2027-03-03', '2027-04-18'] },
  // supercopas (Supercopa de España e Supercoppa com 4 clubes: semifinais e final)
  'ING-SUP': { ...EU, dates: ['2026-08-16'] },
  'ESP-SUP': { ...EU, dates: ['2027-01-07', '2027-01-11'] },
  'ITA-SUP': { ...EU, dates: ['2026-12-18', '2026-12-22'] },
  'ALE-SUP': { ...EU, dates: ['2026-08-22'] },
  'FRA-SUP': { ...EU, dates: ['2027-01-06'] },
  'POR-SUP': { ...EU, dates: ['2026-08-01'] },
  'HOL-SUP': { ...EU, dates: ['2026-08-02'] },
  // playoffs de rebaixamento entre divisões (ida e volta)
  'ALE-PO': { ...EU, dates: ['2027-05-20', '2027-05-24'] },
  'FRA-PO': { ...EU, dates: ['2027-05-26', '2027-05-30'] },
  'POR-PO': { ...EU, dates: ['2027-05-26', '2027-05-30'] },
  'HOL-PO': { ...EU, dates: ['2027-05-20', '2027-05-24'] },
  // UEFA 2026/27: fase de liga (8 rodadas; Conferência 6), playoff, oitavas, quartas, semi (I/V) e final única
  UCL: {
    ...EU,
    dates: ['2026-09-16', '2026-09-30', '2026-10-21', '2026-11-04', '2026-11-25', '2026-12-09', '2027-01-20', '2027-01-27',
      '2027-02-17', '2027-02-24', '2027-03-10', '2027-03-17', '2027-04-07', '2027-04-14', '2027-04-28', '2027-05-05', '2027-05-29'],
  },
  UEL: {
    ...EU,
    dates: ['2026-09-24', '2026-10-01', '2026-10-22', '2026-11-05', '2026-11-26', '2026-12-10', '2027-01-21', '2027-01-28',
      '2027-02-18', '2027-02-25', '2027-03-11', '2027-03-18', '2027-04-08', '2027-04-15', '2027-04-29', '2027-05-06', '2027-05-26'],
  },
  UECL: {
    ...EU,
    dates: ['2026-10-01', '2026-10-22', '2026-11-05', '2026-11-26', '2026-12-10', '2026-12-17',
      '2027-02-18', '2027-02-25', '2027-03-11', '2027-03-18', '2027-04-08', '2027-04-15', '2027-04-29', '2027-05-06', '2027-05-19'],
  },
  'UEFA-SUP': { ...EU, dates: ['2026-08-12'] },
  // Arábia 2026/27
  'cup-SAU': { ...EU, dates: ['2026-09-24', '2026-10-29', '2026-12-03', '2027-02-18', '2027-03-11', '2027-04-15', '2027-05-29'] },
  'supercup-SAU': { ...EU, dates: ['2026-08-18'] },
  'ARS-CUP': { ...EU, dates: ['2026-09-22', '2026-10-27', '2026-11-25', '2027-02-11', '2027-04-13', '2027-05-29'] },
  'ARS-SUP': { ...EU, dates: ['2026-08-19', '2026-08-22'] },
  // AFC Champions League Elite 2026/27: playoff (Oeste) → fase de liga set–fev (pausa da Copa da Ásia) → oitavas I/V
  // em março → quartas, semi e final centralizadas em Jidá (abril)
  ACL: {
    ...EU,
    dates: ['2026-08-18', '2026-09-15', '2026-09-29', '2026-10-20', '2026-11-03', '2026-11-24', '2026-12-09', '2027-02-09', '2027-02-16',
      '2027-03-02', '2027-03-09', '2027-04-17', '2027-04-21', '2027-04-25'],
  },
};

/**
 * Calendários reais para as ligas mantidas (`leagues`: [{ id, teams, doubleRound, cfg }]) e regiões (`regionOf(id)`).
 * Ligas Apertura/Clausura usam `real:apertura` + `real:clausura`.
 */
export function buildRealCalendars(leagues, regionOf) {
  const out = [];
  for (const [key, c] of Object.entries(FIXED)) out.push({ id: `real:${key}`, cycle: c.cycle, season: c.season, dates: [...new Set(c.dates)].sort() });
  for (const d of leagues) {
    if (d.cfg?.aperturaClausura) continue;
    const spec = LEAGUE_SPECS[d.id] ?? REGION_DEFAULT[regionOf(d.id)];
    if (!spec) continue;
    const rounds = spec.rounds ?? leagueRounds(d.teams, d.doubleRound);
    const dates = [...new Set([...leagueDates({ ...spec, rounds }), ...(spec.extra ?? [])])].sort();
    out.push({ id: `real:${d.id}`, cycle: spec.cycle, season: spec.season, dates });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
