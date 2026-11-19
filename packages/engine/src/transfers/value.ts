/**
 * (Etapa 5) Valor de mercado dos jogadores — fórmula dinâmica (recalculada a cada consulta: overall da evolução
 * mensal, contrato restante, liga do clube atual, idade e potencial; o fator de reputação decai a cada 1º/07).
 *
 *   valor = CurvaExp(overall efetivo) × Idade × PrêmioJovem × Liga × Contrato × Reputação
 *
 *   CurvaExp(e)  = 2,5 M × e^(0,2 × (min(e, 85) − 70)) × e^(0,16 × max(0, e − 85))      (mais plana no topo)
 *   e (efetivo)  = overall + w × max(0, potencial − overall),  w = 0,5 até 19 anos → 0 aos 24 (potencial alto)
 *   Idade        = ≤19 1,30 · 20 1,28 · 21 1,24 · 22 1,18 · 23 1,12 · 24 1,06 · 25–27 1 · 28 0,92 · 29 0,82 · 30 0,70 ·
 *                  31 0,56 · 32 0,42 · 33 0,30 · 34 0,20 · 35+ 0,14 × 0,75^(idade − 35)        (32+ despenca)
 *   PrêmioJovem  = 1 + 0,35 × clamp((24 − idade)/6) × clamp((overall − 70)/15)        (revenda: jovem de overall alto)
 *   Liga         = LEAGUE_MULT (Premier League 1,4 > outras top-5 1,05–1,15 > Portugal 0,95 / Holanda 0,85 / Arábia 0,78
 *                  > Brasil 0,72 > Argentina 0,55 > resto da América do Sul 0,32–0,39; 2ªs divisões e só estaduais abaixo)
 *   Contrato     = meses restantes: ≥ 36 → 1 · 24–36 → 0,88–1 · 12–24 → 0,60–0,88 · 6–12 → 0,15–0,60 ·
 *                  últimos 6 meses → 0,02–0,15 (quase zero: o jogador pode assinar pré-contrato com outro clube)
 *   Reputação    = 1 + (f0 − 1) × 0,75^n,  n = temporadas desde o início (envelhecimentos de 1º/07)
 *                  f0 = valor dos DADOS ÷ (curva neutra × Liga dos dados × Contrato no início), limitado a 0,1–10
 *
 * Decisão do coordenador (fidelidade aos valores curados): no 1º dia o valor de cada jogador dos dados é exatamente o
 * dos dados (curado ou do pipeline); o fator f0 decai ~25% por temporada em direção a 1, e a fórmula assume. Juniores
 * gerados (sem dados) têm f0 = 1. O "valor sem contrato" (`careerWorth`) serve para luvas, salários e multas.
 */
import type { Player } from '@cosmicfut/shared';
import type { SeasonState } from '../contract';
import { cycleEnd, cycleOfRegion, regionOfClub } from '../season/timeline';
import { baseClubOf, contractEnd, defaultContractEnd } from './market';
import { realisticPotential } from '../season/players';
import { starValueMult } from '../stars';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const VALUATION = {
  base: 2_500_000,
  k: 0.2,
  kTop: 0.16,
  top: 85,
  pivot: 70,
  /** peso do potencial no overall efetivo aos 19 anos (cai a 0 aos 24) */
  potWeight: 0.5,
  /** prêmio de revenda do jovem de overall alto */
  youngStar: 0.35,
  /** decaimento anual do fator de reputação (25% por temporada) */
  repDecay: 0.75,
  repMin: 0.1,
  repMax: 10,
  min: 10_000,
};

/** Multiplicador de idade (revenda): jovens valem mais; a partir dos 32 o valor despenca. */
export function ageMultiplier(age: number): number {
  if (age <= 19) return 1.3;
  const t: Record<number, number> = { 20: 1.28, 21: 1.24, 22: 1.18, 23: 1.12, 24: 1.06, 25: 1, 26: 1, 27: 1, 28: 0.92, 29: 0.82, 30: 0.7, 31: 0.56, 32: 0.42, 33: 0.3, 34: 0.2 };
  if (age >= 35) return 0.14 * Math.pow(0.75, age - 35);
  return t[age] ?? 1;
}

/** Overall efetivo: o potencial pesa até os 23 anos. */
export function effectiveOverall(age: number, ovr: number, pot: number): number {
  const w = clamp((24 - age) / 5, 0, 1) * VALUATION.potWeight;
  return ovr + w * Math.max(0, pot - ovr);
}

export function expCurve(eff: number): number {
  const V = VALUATION;
  return V.base * Math.exp(V.k * (Math.min(eff, V.top) - V.pivot)) * Math.exp(V.kTop * Math.max(0, eff - V.top));
}

/** Prêmio de revenda: jovem (≤ 23) de overall alto. */
export function youngStarPremium(age: number, ovr: number): number {
  return 1 + VALUATION.youngStar * clamp((24 - age) / 6, 0, 1) * clamp((ovr - 70) / 15, 0, 1);
}

/** Curva neutra (sem liga, contrato e reputação). */
export function neutralValue(age: number, ovr: number, pot: number): number {
  return expCurve(effectiveOverall(age, ovr, pot)) * ageMultiplier(age) * youngStarPremium(age, ovr);
}

/**
 * Multiplicador de liga (chave `CÓDIGO-divisão`, 'BRA-state' ou 'guest'). Premier League > outras top-5 >
 * Portugal/Holanda/Arábia > Brasil > Argentina > resto da América do Sul; 2ªs divisões abaixo da 1ª do país.
 */
export const LEAGUE_MULT: Record<string, number> = {
  // calibrado pela mediana (valor dos dados ÷ curva neutra) dos jogadores de cada liga, respeitando a ordem pedida
  // (PL > top-5 > POR/HOL/Arábia > Brasil > resto da América do Sul): dados PL 1,36 · ITA 1,16 · FRA 1,08 · ALE 1,06 ·
  // ESP 1,00 · POR 0,95 · HOL 0,82 · ARS 0,66 · BRA 1,11 (acima da ordem: os curados brasileiros decaem até a fórmula)
  'ING-1': 1.4, 'ITA-1': 1.15, 'FRA-1': 1.05, 'ALE-1': 1.05, 'ESP-1': 1.05,
  'POR-1': 0.95, 'HOL-1': 0.85, 'ARS-1': 0.78,
  'BRA-1': 0.72, 'ARG-1': 0.55,
  'URU-1': 0.38, 'COL-1': 0.39, 'CHI-1': 0.33, 'PAR-1': 0.34, 'EQU-1': 0.32,
  'ING-2': 0.8, 'ALE-2': 0.75, 'ITA-2': 0.7, 'FRA-2': 0.62, 'ESP-2': 0.6, 'POR-2': 0.6, 'HOL-2': 0.55, 'ARS-2': 0.45,
  'BRA-2': 0.55, 'ARG-2': 0.38, 'URU-2': 0.26, 'COL-2': 0.26, 'CHI-2': 0.27, 'PAR-2': 0.21, 'EQU-2': 0.22,
  'BRA-state': 0.4,
  guest: 0.45,
};
const LEAGUE_DEFAULT = 0.5;

export function leagueMultiplier(key: string | null | undefined, code?: string | null): number {
  if (key && LEAGUE_MULT[key] !== undefined) return LEAGUE_MULT[key];
  if (code && LEAGUE_MULT[`${code}-1`] !== undefined) return LEAGUE_MULT[`${code}-1`] * 0.6;
  return LEAGUE_DEFAULT;
}

/** Fator do contrato pelos meses restantes (null = sem contrato/sem informação ⇒ 1). */
export function contractFactor(months: number | null | undefined): number {
  if (months === null || months === undefined) return 1;
  const m = months;
  if (m >= 36) return 1;
  if (m >= 24) return 0.88 + 0.12 * ((m - 24) / 12);
  if (m >= 12) return 0.6 + 0.28 * ((m - 12) / 12);
  if (m >= 6) return 0.15 + 0.45 * ((m - 6) / 6);
  return 0.02 + 0.13 * clamp(m / 6, 0, 1);
}

/** Fator de reputação: 1 + (f0 − 1) × 0,75^n (f0 = rep0 ÷ liga dos dados). */
export function reputationFactor(rep0: number | undefined, league0: number, seasons: number): number {
  if (!(rep0 && rep0 > 0) || !(league0 > 0)) return 1;
  const f0 = clamp(rep0 / league0, VALUATION.repMin, VALUATION.repMax);
  return 1 + (f0 - 1) * Math.pow(VALUATION.repDecay, Math.max(0, seasons));
}

/** Arredonda valores para números "redondos" (mesma regra dos dados). */
export function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 500_000) * 500_000;
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000;
  if (v >= 100_000) return Math.round(v / 10_000) * 10_000;
  if (v >= 10_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 100) * 100;
}

export interface ValueInput {
  age: number;
  overall: number;
  potential: number;
  /** multiplicador de liga do clube atual */
  league: number;
  /** meses de contrato restantes (null = sem contrato) */
  months?: number | null;
  /** fator de reputação (1 = só a fórmula) */
  reputation?: number;
}

/** Fórmula pura do valor de mercado. */
export function valueFormula(v: ValueInput): number {
  const raw = neutralValue(v.age, v.overall, v.potential) * v.league * contractFactor(v.months) * (v.reputation ?? 1);
  return Math.max(VALUATION.min, roundMoney(raw));
}

/**
 * `rep0` de um jogador dos DADOS (worldSquads): valor dos dados ÷ (curva neutra × fator do contrato padrão no início
 * da carreira). A liga dos dados entra depois (f0 = rep0 ÷ liga), pela `dataLeague` do clube de origem.
 */
export function rep0Of(p: Pick<Player, 'id' | 'age' | 'overall' | 'potential' | 'value'>, startSeason: number): number | undefined {
  if (!(p.value > 0)) return undefined;
  const span = defaultContractEnd(p.id, p.age, startSeason) - startSeason + 1;
  const n = neutralValue(p.age, p.overall, p.potential) * contractFactor(12 * span);
  return n > 0 ? Math.round((p.value / n) * 10000) / 10000 : undefined;
}

/* ═════════════════════ na SeasonState (carreira) ═════════════════════ */

const DAY = 86400000;

const dateMs = new Map<string, number>();
function msOf(d: string): number {
  let v = dateMs.get(d);
  if (v === undefined) {
    if (dateMs.size > 4000) dateMs.clear();
    dateMs.set(d, (v = Date.parse(d.slice(0, 10) + 'T00:00:00Z')));
  }
  return v;
}

/** Meses entre duas datas ISO (fracionário). */
export function monthsBetween(a: string, b: string): number {
  return (msOf(b) - msOf(a)) / (DAY * 30.4375);
}

/** Último dia do contrato que termina na temporada `endsSeason` do ciclo da região do clube. */
export function contractEndDate(state: SeasonState, clubId: string | null | undefined, endsSeason: number): string {
  const r = clubId ? regionOfClub(state, clubId) : null;
  if (!r || !state.segment) return `${endsSeason}-12-31`;
  return cycleEnd(cycleOfRegion(r), endsSeason);
}

/** Fim do contrato com o clube DONO (empréstimos: o contrato original). */
export function ownerContractEnd(state: SeasonState, p: Player): { clubId: string | null; endsSeason: number } {
  const c = state.market?.contracts[p.id];
  if (c?.kind === 'loan' && c.loanFrom) {
    const career = state.career;
    const end = c.parentEnd ?? career?.contractEnds?.[p.id]
      ?? (career ? defaultContractEnd(p.id, p.age - (career.agedYears ?? state.season - career.startSeason), career.startSeason) : state.season);
    return { clubId: c.loanFrom, endsSeason: end };
  }
  return { clubId: null, endsSeason: contractEnd(state, p) };
}

/** Meses de contrato restantes (null = livre). */
export function monthsLeftOf(state: SeasonState, p: Player, clubId: string | null | undefined): number | null {
  if (!clubId) return null;
  const o = ownerContractEnd(state, p);
  return Math.max(0, monthsBetween(state.date, contractEndDate(state, o.clubId ?? clubId, o.endsSeason)));
}

/** Multiplicador da liga ATUAL do clube (clubInfo.leagueKey; sem perfil: país + divisão). */
export function clubLeagueMult(state: SeasonState, clubId: string | null | undefined): number {
  const i = clubId ? state.clubInfo?.[clubId] : undefined;
  if (!i) return LEAGUE_DEFAULT;
  if (i.guest) return LEAGUE_MULT.guest;
  const key = i.leagueKey ?? (i.code && i.division ? `${i.code}-${i.division}` : undefined);
  return leagueMultiplier(key, i.code);
}

/** Multiplicador da liga do clube NOS DADOS (início da carreira); sem a informação, a liga atual. */
export function dataLeagueMult(state: SeasonState, clubId: string | null | undefined): number | null {
  const i = clubId ? state.clubInfo?.[clubId] : undefined;
  if (!i) return null;
  if (i.guest) return LEAGUE_MULT.guest;
  const key = i.dataLeague ?? i.leagueKey ?? (i.code && i.division ? `${i.code}-${i.division}` : undefined);
  return leagueMultiplier(key, i.code);
}

/** Temporadas desde o início da carreira (envelhecimentos de 1º/07). */
export function seasonsElapsed(state: SeasonState): number {
  const c = state.career;
  return c ? (c.agedYears ?? state.season - c.startSeason) : 0;
}

/** Liga usada para um jogador livre: a liga dos dados do clube de origem (ou a média). */
function freeLeague(state: SeasonState, p: Player): number {
  return dataLeagueMult(state, baseClubOf(p.id)) ?? LEAGUE_DEFAULT;
}

function careerRaw(state: SeasonState, p: Player, clubId: string | null | undefined, withContract: boolean): number {
  const L = clubId ? clubLeagueMult(state, clubId) : freeLeague(state, p);
  const L0 = dataLeagueMult(state, baseClubOf(p.id)) ?? L;
  // (18/11) potencial real pela idade (veterano não carrega potencial alto) e estrela (Top Mundial +20%, Destaque +10%)
  return roundMoney(starValueMult(p) * valueFormula({
    age: p.age, overall: p.overall, potential: realisticPotential(p.age, p.overall, p.potential), league: L,
    months: withContract ? monthsLeftOf(state, p, clubId) : null,
    reputation: reputationFactor(p.rep0, L0, seasonsElapsed(state)),
  }));
}

/**
 * Valor de mercado (transferência) do jogador no clube `clubId` ('' = livre). Fora da carreira (temporadas avulsas
 * e testes antigos) devolve `p.value` como está.
 */
export function careerValue(state: SeasonState, p: Player, clubId: string | null | undefined): number {
  if (!state.career) return p.value;
  return careerRaw(state, p, clubId, true);
}

/** Valor SEM o fator do contrato (luvas, multas, salários). Fora da carreira: `p.value`. */
export function careerWorth(state: SeasonState, p: Player, clubId: string | null | undefined): number {
  if (!state.career) return p.value;
  return careerRaw(state, p, clubId, false);
}

/* ═════════════════════ multa rescisória ═════════════════════ */

/** Multiplicador da multa padrão por região/país (Espanha: multas altas por lei). */
function clauseMult(state: SeasonState, clubId: string): number {
  const i = state.clubInfo?.[clubId];
  if (i?.code === 'ESP') return 4;
  if (i?.region === 'EU') return 3;
  if (i?.region === 'SAU') return 2.5;
  return 2.2;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * Multa rescisória padrão (contratos sem multa definida, inclusive de saves antigos): valor sem contrato × 2,2
 * (América do Sul, multa internacional) / 2,5 (Arábia) / 3 (Europa) / 4 (Espanha) × 0,85–1,25 (por jogador).
 */
export function defaultReleaseClause(state: SeasonState, p: Player, clubId: string): number {
  const worth = careerWorth(state, p, clubId);
  const v = Math.max(500_000, worth * clauseMult(state, clubId) * (0.85 + 0.4 * hash01(`clause:${p.id}`)));
  return roundMoney(v);
}

/** Multa rescisória vigente (a do contrato novo, ou a padrão). Emprestados: a multa do clube dono. */
export function releaseClauseOf(state: SeasonState, p: Player, clubId: string): number {
  const c = state.market?.contracts[p.id];
  // empréstimo: o contrato do empréstimo guarda a multa do contrato com o dono (se havia)
  if (c?.releaseClause) return c.releaseClause;
  const owner = c?.kind === 'loan' && c.loanFrom ? c.loanFrom : clubId;
  return defaultReleaseClause(state, p, owner);
}
