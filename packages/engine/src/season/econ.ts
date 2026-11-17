/**
 * (Etapa 4) Economia dos clubes — fluxo de caixa mensal e por jogo, em EUROS (1 "$" antigo = 1 €).
 *
 * Perfil econômico de cada clube (`clubEconomyProfile`, calculado na criação de cada trecho e gravado em
 * `ClubEconomyInfo`), a partir da receita anual R e da folha inicial W0 dos dados (pipeline) e das tabelas reais de
 * economy.json (packages/data/src/prizes.mjs):
 *
 *   TV (anual, 12 parcelas)   = tv[liga].min + (max − min) × posição do clube no ranking de receita da divisão
 *   bilheteria esperada       = jogos em casa × capacidade × ocupação-base × preço-base (preço-base calibrado para a
 *                               bilheteria ser ≈ matchday[país] × R)
 *   patrocínio (12 parcelas)  = max(8% R, R − TV(liga dos dados) − merit esperado − bilheteria esperada − prêmios-base)
 *   comissão/funcionários     = 6% R + salário do técnico (≈ 1,1% R)
 *   manutenção do estádio     = lugares × €/lugar/mês (região) × classe de idade do estádio
 *   despesas operacionais     = max(5% R, 98% R − W0 − comissão − manutenção)   (administração, viagens, base)
 *   aporte (donos)            = déficit estrutural com W0 (PIF/sauditas; clubes grandes europeus não precisam)
 *   teto da folha             = max(1,08 W0', min(R' × cap[liga], 1,35 W0'))   (R' com a TV atual; W0' = W0 × R'/R)
 *   limite do cheque especial = max(250 mil, 20% R); juros de 2,5% ao mês sobre o saldo negativo
 *
 * Bilheteria por jogo (`matchGate`):
 *   público = capacidade × min(1, ocupação-base × demanda(preço) × torcida × fase × importância × visitante)
 *   renda   = público × preço × importância × gasto por torcedor(moral)
 * Importância: amistoso 0,5 < estadual 0,75 < liga 1 < clássico 1,3 < mata-mata de copa 0,9–1,7 < continental
 * (grupos 1,35, mata-mata 1,6) < final 2,0.
 *
 * Funções puras sobre os dados; as que recebem `state`/`club` e dizem "MUTA" alteram o objeto recebido (usadas por
 * advanceDay sobre a cópia do dia).
 */
import type { Player } from '@cosmicfut/shared';
import type {
  ClubEconomyInfo, ClubSeasonState, Competition, EconTables, FinanceLedger, Fixture, GateRecord, MonthFlow, PrizeSchedule, SeasonState,
} from '../contract';
import { BRL_PER_EUR, fmtMoneyShort } from '../money';
import { clubWageBill } from '../transfers/market';

/* ═════════════════════ constantes ═════════════════════ */

export const ECON = {
  /** câmbio fixo exibido na UI (1 € = R$ 6,30) */
  brlPerEur: BRL_PER_EUR,
  staffShare: 0.06,
  coachShare: 0.011,
  coachMinMonthly: 4_000,
  coachMaxMonthly: 1_200_000,
  opexMinShare: 0.05,
  /** superávit estrutural com a folha inicial (2% da receita) */
  targetMargin: 0.02,
  sponsorMinShare: 0.08,
  /** €/lugar/mês por região */
  maintenancePerSeat: { EU: 8, SAU: 6, SA: 3, default: 3 } as Record<string, number>,
  ageClass: { new: 1.25, standard: 1, old: 0.8 },
  overdraftRate: 0.025,
  creditShare: 0.2,
  creditMin: 250_000,
  ceilingFloor: 1.08,
  ceilingSpan: 1.35,
  /** jogos em casa além da liga (copas, estaduais, continentais) — calibra o preço-base */
  extraHomeGames: { BRA: 8, EU: 0, SAU: 0, SA: 4, default: 4 } as Record<string, number>,
  /**
   * jogos em casa por temporada medidos na simulação (liga com formato próprio, estaduais, copas, continentais),
   * por liga; as demais: min(n − 1, 19) + extra (2ªs divisões sul-americanas: sem extra)
   */
  homeGames: { 'BRA-1': 34, 'BRA-2': 22, 'BRA-state': 3.2, 'ARG-1': 16 } as Record<string, number>,
  /** importância média dos jogos em casa (clássicos, copas e continentais pesam mais que a liga) */
  impAvg: 1.12,
  ticketRange: { EU: [10, 200], SAU: [3, 40], SA: [3, 60], 'BRA-state': [2, 15], default: [3, 80] } as Record<string, [number, number]>,
  fill: { base: 0.38, perRep: 0.09, min: 0.15, max: 0.97, boost: { ING: 0.25, ALE: 0.25, ESP: 0.12, ITA: 0.05, FRA: 0.12, HOL: 0.2, ARG: 0.15, ARS: -0.1 } as Record<string, number> },
  fanDefault: 60,
  /** histórico guardado nos clubes humanos */
  gatesKept: 12,
  monthsKept: 24,
};

/** Prêmios-base esperados (fatia da receita) — parte do faturamento real que vem de premiações. */
function prizeBaselineShare(region: string | undefined, rep: number, code: string | null, stateOnly = false, firstDiv = true): number {
  // Europa: dinheiro da UEFA (clubes de reputação 4–5 jogam a Liga dos Campeões quase todo ano)
  if (region === 'EU') return !firstDiv ? 0.01 : rep >= 4.5 ? 0.1 : rep >= 3.5 ? 0.08 : rep >= 2.5 ? 0.03 : 0.01;
  // América do Sul: o dinheiro da CONMEBOL pesa muito na receita dos clubes fora do Brasil
  if (region === 'SA' && code !== 'BRA') return firstDiv ? (code === 'ARG' ? 0.05 : 0.17) : 0.01;
  // Brasil: Copa do Brasil paga muito por fase (pesa mais nos clubes menores) + Libertadores/Sul-Americana
  if (region === 'SA') return stateOnly ? 0.01 : !firstDiv ? 0.08 : rep >= 3.5 ? 0.06 : 0.05;
  return 0.02;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/* ═════════════════════ perfil econômico ═════════════════════ */

export interface EconProfileInput {
  id: string;
  revenue: number;
  /** folha anual inicial do elenco (dados) */
  wageBill: number;
  capacity: number;
  reputation: number;
  code: string | null;
  region?: string;
  /** chave da liga ATUAL (ex.: 'BRA-1', 'BRA-state', 'guest') e posição 0..1 no ranking de receita (1 = maior) */
  leagueNow?: string;
  shareNow: number;
  /** liga dos dados (pipeline) e posição — patrocínio estável quando o clube sobe/cai */
  leagueData?: string;
  shareData: number;
  /** nº de clubes da divisão atual (jogos em casa) */
  divisionSize: number;
  guest?: boolean;
}

export type EconProfile = Required<Pick<ClubEconomyInfo,
  'tvPerSeason' | 'sponsorPerSeason' | 'staffPerSeason' | 'coachMonthly' | 'maintenancePerSeason' | 'opexPerSeason' | 'ownerPerSeason' |
  'wageCeiling' | 'creditLimit' | 'basePrice' | 'fill0' | 'gatePerSeason' | 'ownerBacked'>>;

export function tvFor(t: EconTables, key: string | undefined, share: number, revenue: number): number {
  const row = key ? t.tv[key] : undefined;
  if (!row) return Math.round(0.3 * revenue);
  return Math.round(row.min + (row.max - row.min) * clamp(share, 0, 1));
}

/** Merit esperado (média da premiação por posição da liga). */
export function expectedMerit(t: EconTables, key: string | undefined, n: number): number {
  const m = key ? t.merit[key] : undefined;
  if (!m || n <= 0) return 0;
  let sum = 0;
  for (let i = 1; i <= Math.min(m.paid, n); i++) sum += meritAt(m, i);
  return Math.round(sum / n);
}

export function meritAt(m: { first: number; last: number; paid: number }, pos: number): number {
  if (pos > m.paid || pos < 1) return 0;
  if (m.paid <= 1) return m.first;
  return Math.round(m.first + ((m.last - m.first) * (pos - 1)) / (m.paid - 1));
}

export function wageRatioFor(t: EconTables, code: string | null | undefined, league: string | undefined, owner: boolean): { target: number; cap: number } {
  if (owner && t.wageRatio.owner) return t.wageRatio.owner;
  return (league && t.wageRatio[league]) || (code && t.wageRatio[code]) || t.wageRatio.default || { target: 0.5, cap: 0.6 };
}

export function baseFill(code: string | null | undefined, reputation: number): number {
  const f = ECON.fill;
  return clamp(f.base + f.perRep * reputation + (f.boost[code ?? ''] ?? 0), f.min, f.max);
}

/**
 * Jogos em casa esperados na temporada (sem o peso da importância): liga + copas/estaduais + os continentais que um
 * clube daquele porte costuma jogar (reputação).
 */
export function homeGamesFor(code: string | null | undefined, region: string | undefined, n: number, league?: string, reputation = 2): number {
  const first = !league || /-1$/.test(league);
  const cont = !first ? 0 : region === 'EU' || region === 'SAU'
    ? reputation >= 4.5 ? 8 : reputation >= 3.5 ? 7 : reputation >= 2.5 ? 1 : 0
    : code === 'BRA' ? reputation >= 4 ? 4 : reputation < 3 ? -3 : 0
      : reputation >= 3.5 ? 3 : 0;
  const fixed = league ? ECON.homeGames[league] : undefined;
  if (fixed !== undefined) return Math.max(2, fixed + (league === 'BRA-state' ? 0 : cont));
  const second = !!league && /-2$/.test(league) && region === 'SA';
  const extra = second ? 0 : ECON.extraHomeGames[code ?? ''] ?? ECON.extraHomeGames[region ?? ''] ?? ECON.extraHomeGames.default;
  return Math.max(4, Math.min(Math.max(1, n - 1), 19) + extra + cont);
}

export function coachMonthlyFor(revenue: number): number {
  return roundTo(clamp((ECON.coachShare * revenue) / 12, ECON.coachMinMonthly, ECON.coachMaxMonthly), 500);
}

/** Classe de idade do estádio (sem dado real: arenas grandes de clubes de ponta = novas; clubes pequenos = antigos). */
export function stadiumAgeClass(capacity: number, reputation: number, region?: string): keyof typeof ECON.ageClass {
  if ((region === 'EU' || region === 'SAU') && reputation >= 4) return 'new';
  if (capacity >= 50_000 && reputation >= 4) return 'new';
  if (reputation <= 1) return 'old';
  return 'standard';
}

export function clubEconomyProfile(t: EconTables, c: EconProfileInput): EconProfile {
  const R = Math.max(1, c.revenue);
  const W0 = Math.max(0, c.wageBill);
  const owner = t.ownerBacked.includes(c.id);
  const tvNowRaw = c.guest ? 0 : tvFor(t, c.leagueNow, c.shareNow, R);
  const tvDataRaw = c.guest ? 0 : tvFor(t, c.leagueData ?? c.leagueNow, c.shareData, R);
  const meritData = expectedMerit(t, c.leagueData ?? c.leagueNow, c.divisionSize);
  const fill0 = baseFill(c.code, c.reputation);
  const cap = Math.max(1000, c.capacity || 10_000);
  // jogos em casa ponderados pela importância média (a liga dos dados calibra o preço; o patrocínio fica estável)
  const games = homeGamesFor(c.code, c.region, c.divisionSize, c.leagueData ?? c.leagueNow, c.reputation) * ECON.impAvg;
  const share = t.matchday[c.code ?? ''] ?? t.matchday.default ?? 0.12;
  const [lo, hi] = ECON.ticketRange[c.leagueData === 'BRA-state' ? 'BRA-state' : c.region ?? ''] ?? ECON.ticketRange.default;
  const basePrice = Math.round(clamp((share * R) / (games * cap * fill0), lo, hi) * 2) / 2;
  const gate = Math.round(games * cap * fill0 * basePrice);
  const lgData = c.leagueData ?? c.leagueNow;
  const prizeBase = Math.round(R * prizeBaselineShare(c.region, c.reputation, c.code, lgData === 'BRA-state', !lgData || /-1$/.test(lgData)));
  // a receita anual dos dados ancora tudo: se a tabela de TV passa do que sobra da receita (clubes pequenos de ligas
  // com TV alta em relação ao faturamento), a TV do clube é reduzida na mesma proporção (inclusive após acesso/queda)
  const room = Math.max(0, (1 - ECON.sponsorMinShare) * R - meritData - gate - prizeBase);
  const k = tvDataRaw > room && tvDataRaw > 0 ? room / tvDataRaw : 1;
  const tvData = Math.round(tvDataRaw * k);
  const tvNow = Math.round(tvNowRaw * k);
  const sponsor = Math.round(Math.max(ECON.sponsorMinShare * R, R - tvData - meritData - gate - prizeBase));
  const coachMonthly = coachMonthlyFor(R);
  const staff0 = Math.round(ECON.staffShare * R + coachMonthly * 12);
  const perSeat = ECON.maintenancePerSeat[c.region ?? ''] ?? ECON.maintenancePerSeat.default;
  const maintenance = Math.round(cap * perSeat * ECON.ageClass[stadiumAgeClass(cap, c.reputation, c.region)] * 12);
  const opex0 = Math.round(Math.max(ECON.opexMinShare * R, (1 - ECON.targetMargin) * R - W0 - staff0 - maintenance));
  const income = sponsor + tvData + meritData + gate + prizeBase;
  const ownerPerSeason = Math.round(Math.max(0, W0 + staff0 + maintenance + opex0 - (1 - ECON.targetMargin) * income));
  // receita com a TV atual (sobe/cai de divisão): comissão e operação acompanham (corte de custos no rebaixamento)
  const Reff = Math.max(0.3 * R, R + (tvNow - tvData));
  const f = clamp(Reff / R, 0.5, 1.5);
  const staff = Math.round(staff0 * f);
  const opex = Math.round(opex0 * f);
  const base = W0 * clamp(Reff / R, 0.5, 1.5);
  const ratio = wageRatioFor(t, c.code, c.leagueNow, owner);
  const wageCeiling = roundTo(Math.max(base * ECON.ceilingFloor, Math.min(Reff * ratio.cap, base * ECON.ceilingSpan)), 10_000);
  return {
    tvPerSeason: tvNow,
    sponsorPerSeason: sponsor,
    staffPerSeason: staff,
    coachMonthly,
    maintenancePerSeason: maintenance,
    opexPerSeason: opex,
    ownerPerSeason,
    wageCeiling,
    creditLimit: roundTo(Math.max(ECON.creditMin, ECON.creditShare * R), 10_000),
    basePrice,
    fill0: Math.round(fill0 * 1000) / 1000,
    gatePerSeason: gate,
    ownerBacked: owner,
  };
}

/** O clube usa a economia da Etapa 4 (perfil calculado)? */
export const hasEcon = (info: ClubEconomyInfo | undefined): info is ClubEconomyInfo & EconProfile =>
  !!info && typeof info.tvPerSeason === 'number' && typeof info.basePrice === 'number';

/**
 * Perfis de todos os clubes de uma temporada (MUTA `clubInfo`). `divisions`: divisões atuais (id → clubes);
 * `dataLeague`: liga de cada clube nos dados; `meta`: receita/folha/capacidade/reputação/país dos dados.
 */
export function applyEconomyProfiles(
  t: EconTables,
  clubInfo: Record<string, ClubEconomyInfo>,
  o: {
    divisions: Record<string, string[]>;
    dataDivisions: Record<string, string[]>;
    codeOf: (clubId: string) => string | null;
    guest: (clubId: string) => boolean;
    stateOnly: (clubId: string) => boolean;
  },
): void {
  const rev = (id: string) => clubInfo[id]?.revenue ?? 0;
  const rankShares = (groups: Record<string, string[]>) => {
    const out = new Map<string, { key: string; share: number; n: number }>();
    for (const [key, ids] of Object.entries(groups)) {
      const sorted = ids.slice().sort((a, b) => rev(b) - rev(a) || (a < b ? -1 : 1));
      const n = sorted.length;
      sorted.forEach((id, i) => out.set(id, { key, share: n > 1 ? 1 - i / (n - 1) : 1, n }));
    }
    return out;
  };
  const now = rankShares(o.divisions);
  const dat = rankShares(o.dataDivisions);
  for (const [id, info] of Object.entries(clubInfo)) {
    if (!info.revenue) continue;
    const code = o.codeOf(id);
    const guest = o.guest(id);
    const n0 = now.get(id);
    const d0 = dat.get(id);
    const stateKey = o.stateOnly(id) ? 'BRA-state' : undefined;
    const leagueNow = guest ? 'guest' : n0?.key ?? stateKey;
    const leagueData = guest ? 'guest' : d0?.key ?? stateKey;
    const p = clubEconomyProfile(t, {
      id, revenue: info.revenue, wageBill: info.wageBill ?? 0.5 * info.revenue, capacity: info.capacity ?? 10_000, reputation: info.reputation ?? 2,
      code, region: info.region, leagueNow, shareNow: n0?.share ?? 0.5, leagueData, shareData: d0?.share ?? n0?.share ?? 0.5,
      divisionSize: n0?.n ?? d0?.n ?? 16, guest,
    });
    Object.assign(info, p, { leagueKey: leagueNow, ...(leagueData ? { dataLeague: leagueData } : {}), ...(code ? { code } : {}), ...(guest ? { guest: true } : {}) });
  }
}

/* ═════════════════════ importância e bilheteria ═════════════════════ */

export const IMPORTANCE = {
  friendly: 0.5, state: 0.75, stateKnockout: 0.9, stateFinal: 1.3, league: 1, classic: 1.3, playoff: 1.4,
  cupEarly: 0.9, cupQF: 1.25, cupSF: 1.4, cupFinal: 1.7, supercup: 1.25,
  contQualifier: 1.2, contGroup: 1.35, contKnockout: 1.6, final: 2.0,
};

export interface MatchImportance {
  value: number;
  label: string;
  /** chave da fase (prêmios): 'groups', 'r16', 'final'... */
  phase?: string | null;
}

/** Distância até a final de uma rodada da fase do campeão → chave de prêmio. */
const TO_FINAL = ['final', 'sf', 'qf', 'r16', 'r32', 'r64', 'r128'];

/** Chave da fase (prêmios/importância) de um jogo/rodada de mata-mata ou de tabela. */
export function phaseKeyOf(comp: Competition, stageId: string | undefined, round?: number, roundName?: string): string | null {
  const def = comp.format?.stages.find((s) => s.id === stageId);
  if (!def) return null;
  if (def.kind === 'table') return 'groups';
  const name = roundName ?? def.rounds[round ?? 0]?.name ?? def.name;
  if (/3º Lugar/i.test(name)) return null;
  if (comp.format?.champion === def.id && round !== undefined) {
    const k = def.rounds.length - 1 - round;
    if (k >= 0 && k < TO_FINAL.length) return TO_FINAL[k];
  }
  const s = `${name} ${def.name}`;
  if (/play-?off/i.test(s)) return 'playoff';
  if (/(^|\s)(1ª|primeira|preliminar)/i.test(s)) return 'q1';
  if (/(^|\s)(2ª|segunda)/i.test(s)) return 'q2';
  if (/(^|\s)(3ª|terceira)/i.test(s)) return 'q3';
  if (/(^|\s)4ª/i.test(s)) return 'q4';
  if (/final$/i.test(name)) return 'final';
  return null;
}

/** Rodada (índice) do confronto de um jogo de mata-mata. */
function tieRound(comp: Competition, f: Fixture): number | undefined {
  if (!f.tieId || !f.stageId) return undefined;
  return comp.stages?.[f.stageId]?.ties?.find((t) => t.id === f.tieId)?.round;
}

/** Clássico/dérbi: mesmo país e ambos de reputação ≥ 4; no Brasil, mesma UF e ambos ≥ 3. */
export function isClassic(state: SeasonState, a: string, b: string): boolean {
  const A = state.clubInfo?.[a], B = state.clubInfo?.[b];
  if (!A || !B || A.countryId === undefined || A.countryId !== B.countryId) return false;
  const ra = A.reputation ?? 0, rb = B.reputation ?? 0;
  if (A.uf && A.uf === B.uf) return ra >= 3 && rb >= 3;
  return ra >= 4 && rb >= 4;
}

export function matchImportance(state: SeasonState, comp: Competition | undefined, f: Fixture): MatchImportance {
  const I = IMPORTANCE;
  if (!comp) return { value: I.friendly, label: 'Amistoso' };
  const classic = isClassic(state, f.homeId, f.awayId);
  const round = tieRound(comp, f);
  const phase = comp.format ? phaseKeyOf(comp, f.stageId, round, f.label) : null;
  const ko = !!f.tieId;
  let v: number, label: string;
  switch (comp.type) {
    case 'state':
      if (ko && phase === 'final') { v = I.stateFinal; label = 'Final do estadual'; }
      else if (ko) { v = I.stateKnockout; label = 'Estadual (mata-mata)'; }
      else { v = I.state; label = 'Estadual'; }
      break;
    case 'cup':
      if (phase === 'final') { v = I.cupFinal; label = 'Final de copa'; }
      else if (phase === 'sf') { v = I.cupSF; label = 'Semifinal de copa'; }
      else if (phase === 'qf') { v = I.cupQF; label = 'Quartas de copa'; }
      else { v = I.cupEarly; label = 'Copa (fase inicial)'; }
      break;
    case 'supercup':
      v = I.supercup; label = 'Supercopa';
      break;
    case 'continental':
      if (phase === 'final') { v = I.final; label = 'Final continental'; }
      else if (phase === 'groups') { v = I.contGroup; label = 'Continental (fase de grupos/liga)'; }
      else if (phase && /^q\d$/.test(phase)) { v = I.contQualifier; label = 'Continental (fase preliminar)'; }
      else { v = I.contKnockout; label = 'Continental (mata-mata)'; }
      break;
    default:
      if (ko) { v = I.playoff; label = 'Playoff'; }
      else { v = I.league; label = 'Liga'; }
  }
  if (classic && v < I.classic) { v = I.classic; label = `Clássico (${label.toLowerCase()})`; }
  return { value: v, label, phase };
}

/** Multiplicador de público pelo preço (1 = preço-base): −50% a cada +100%; até +30% com preço baixo. */
export function priceDemand(price: number, base: number): number {
  if (base <= 0) return 1;
  const r = price / base;
  if (r >= 1) return Math.max(0.05, 1 - 0.5 * (r - 1));
  return 1 + 0.3 * (1 - r);
}

export interface GateInput {
  capacity: number;
  fill0: number;
  basePrice: number;
  price: number;
  importance: number;
  fanMorale: number;
  /** moral do elenco 0..100 (fase) */
  form: number;
  awayReputation: number;
  /** ruído determinístico (−1..1) */
  noise?: number;
}

export interface GateResult {
  attendance: number;
  revenue: number;
  occupancy: number;
  demand: number;
}

/**
 * Bilheteria de um jogo: público = capacidade × ocupação; renda = público × preço × importância × gasto por torcedor.
 * Monotônica (não decrescente) na importância e na moral da torcida; o público cai com o preço.
 */
export function gateRevenue(g: GateInput): GateResult {
  const demand = priceDemand(g.price, g.basePrice);
  const fans = 0.76 + 0.4 * (clamp(g.fanMorale, 0, 100) / 100);
  const form = 0.94 + 0.12 * (clamp(g.form, 0, 100) / 100);
  const imp = 0.55 + 0.45 * g.importance;
  const away = 1 + 0.03 * ((g.awayReputation ?? 2.5) - 2.5);
  const noise = 1 + 0.04 * clamp(g.noise ?? 0, -1, 1);
  const occupancy = clamp(g.fill0 * demand * fans * form * imp * away * noise, 0.03, 1);
  const attendance = Math.round(Math.max(1000, g.capacity) * occupancy);
  const spend = 0.88 + 0.2 * (clamp(g.fanMorale, 0, 100) / 100);
  const revenue = Math.round(attendance * g.price * g.importance * spend);
  return { attendance, revenue, occupancy, demand };
}

/** Hash determinístico (FNV-1a) → −1..1. */
function noiseOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

export function ticketPriceFor(state: SeasonState, clubId: string): number {
  const p = state.clubs[clubId]?.ticketPrice;
  const info = state.clubInfo?.[clubId];
  return p != null && p > 0 ? p : info?.basePrice ?? 0;
}

export interface MatchGate extends GateResult {
  homeId: string;
  capacity: number;
  price: number;
  importance: MatchImportance;
  fanMorale: number;
}

/** Bilheteria do mandante num jogo (economia da Etapa 4; `null` sem perfil). */
export function matchGate(state: SeasonState, comp: Competition | undefined, f: Fixture): MatchGate | null {
  const info = state.clubInfo?.[f.homeId];
  if (!hasEcon(info)) return null;
  const club = state.clubs[f.homeId];
  const imp = matchImportance(state, comp, f);
  const price = ticketPriceFor(state, f.homeId);
  const fanMorale = club?.fanMorale ?? ECON.fanDefault;
  const capacity = info.capacity ?? 10_000;
  const g = gateRevenue({
    capacity, fill0: info.fill0, basePrice: info.basePrice, price, importance: imp.value, fanMorale,
    form: club?.morale ?? 50, awayReputation: state.clubInfo?.[f.awayId]?.reputation ?? 2.5, noise: noiseOf(f.id),
  });
  return { ...g, homeId: f.homeId, capacity, price, importance: imp, fanMorale };
}

/** Grava a bilheteria no histórico do clube humano (últimos jogos em casa). MUTA o clube. */
export function recordGate(club: ClubSeasonState, f: Fixture, comp: Competition | undefined, g: MatchGate, revenue: number): void {
  const rec: GateRecord = {
    date: f.date, fixtureId: f.id, opponentId: f.awayId, competition: comp?.name ?? f.competitionId,
    attendance: g.attendance, capacity: g.capacity, price: g.price, importance: Math.round(g.importance.value * 100) / 100,
    importanceLabel: g.importance.label, fanMorale: Math.round(g.fanMorale), revenue, ...(f.neutral ? { neutral: true } : {}),
  };
  const list = (club.gates ??= []);
  list.unshift(rec);
  if (list.length > ECON.gatesKept) list.length = ECON.gatesKept;
}

/* ═════════════════════ moral da torcida ═════════════════════ */

export const FANS = {
  drift: 0.004, win: 1.4, draw: 0.1, loss: -1.8, bigMargin: 0.6,
  title: 15, vice: 4, relegation: -20, promotion: 12, eliminated: -2,
  starSigning: 4, starSale: -4, priceStep: 4,
};

export function bumpFans(club: ClubSeasonState | undefined, delta: number): void {
  if (!club || !delta) return;
  club.fanMorale = Math.round(clamp((club.fanMorale ?? ECON.fanDefault) + delta, 0, 100) * 10) / 10;
}

/** Resultado de um jogo na moral da torcida (peso pela importância). */
export function fanResultDelta(won: boolean, lost: boolean, margin: number, importance: number): number {
  const w = 0.6 + 0.4 * importance;
  const base = won ? FANS.win : lost ? FANS.loss : FANS.draw;
  return (base + Math.sign(base) * Math.min(3, Math.max(0, Math.abs(margin) - 2)) * FANS.bigMargin) * w;
}

/** Efeito mensal do preço do ingresso (caro irrita, barato agrada). */
export function fanPriceDelta(price: number, base: number): number {
  if (!(base > 0) || !(price > 0)) return 0;
  const r = price / base;
  if (r > 1.15) return -clamp((r - 1) * FANS.priceStep, 0, 5);
  if (r < 0.85) return clamp((1 - r) * FANS.priceStep, 0, 2);
  return 0;
}

/* ═════════════════════ prêmios ═════════════════════ */

export function prizeScheduleOf(t: EconTables | undefined, comp: Competition): PrizeSchedule | undefined {
  if (!t) return undefined;
  return t.competitionPrizes[comp.id] ?? (comp.prizeKey ? t.competitionPrizes[comp.prizeKey] : undefined);
}

export const PHASE_LABEL: Record<string, string> = {
  participation: 'participação', groups: 'fase de grupos/liga', playoff: 'playoff', q1: '1ª fase', q2: '2ª fase', q3: '3ª fase', q4: '4ª fase',
  r128: '128-avos', r64: '64-avos', r32: '16-avos', r16: 'oitavas de final', qf: 'quartas de final', sf: 'semifinal', final: 'final', champion: 'título',
};

/**
 * Prêmios por fase alcançada (participação + `reach`), pagos uma vez por clube e fase (`comp.paid`). MUTA o estado.
 * `pay(clubId, valor, motivo)` credita o caixa e o livro.
 */
export function payPhasePrizes(comp: Competition, sched: PrizeSchedule, pay: (clubId: string, v: number, why: string) => void): void {
  if (!comp.stages || !comp.format) return;
  const paid = new Set(comp.paid ?? []);
  const add = (clubId: string, key: string, v: number | undefined) => {
    if (!clubId || !v || v <= 0) return;
    const k = `${key}:${clubId}`;
    if (paid.has(k)) return;
    paid.add(k);
    pay(clubId, v, key);
  };
  for (const def of comp.format.stages) {
    const st = comp.stages[def.id];
    if (!st || st.status === 'pending') continue;
    if (def.kind === 'table') {
      const ids = st.groups ? st.groups.flat() : st.seeds;
      for (const id of ids) {
        add(id, 'participation', sched.participation);
        add(id, 'groups', sched.reach?.groups);
      }
    } else {
      for (const tie of st.ties ?? []) {
        if (tie.thirdPlace) continue;
        const key = phaseKeyOf(comp, def.id, tie.round, tie.roundName);
        for (const id of [tie.a, tie.b]) {
          add(id, 'participation', sched.participation);
          if (key) add(id, key, sched.reach?.[key]);
        }
      }
    }
  }
  comp.paid = [...paid];
}

/** Bônus por jogo (vitória/empate) na fase de tabela de uma competição com tabela de prêmios. */
export function matchBonus(comp: Competition, sched: PrizeSchedule | undefined, f: Fixture, homeGoals: number, awayGoals: number): { clubId: string; v: number; why: string }[] {
  if (!sched || (!sched.win && !sched.draw)) return [];
  const def = comp.format?.stages.find((s) => s.id === f.stageId);
  if (!def || def.kind !== 'table') return [];
  if (homeGoals > awayGoals) return sched.win ? [{ clubId: f.homeId, v: sched.win, why: 'vitória' }] : [];
  if (awayGoals > homeGoals) return sched.win ? [{ clubId: f.awayId, v: sched.win, why: 'vitória' }] : [];
  return sched.draw ? [{ clubId: f.homeId, v: sched.draw, why: 'empate' }, { clubId: f.awayId, v: sched.draw, why: 'empate' }] : [];
}

/* ═════════════════════ folha e teto ═════════════════════ */

export const wageBillOf = (squad: Pick<Player, 'wage'>[]): number => squad.reduce((s, p) => s + (p.wage || 0), 0);

/**
 * (Mercado e Orçamentos) Teto da Folha da diretoria (anual): o orçamento salarial do clube humano (× 12) quando
 * existir — ele é o teto, ajustável pelo equilíbrio de orçamentos —; senão o teto do perfil econômico.
 */
export function boardWageCeiling(state: SeasonState, clubId: string): number {
  const b = state.clubs[clubId]?.budget;
  if (b) return Math.round(b.wage * 12);
  return state.clubInfo?.[clubId]?.wageCeiling ?? 0;
}

export interface CeilingCheck {
  ok: boolean;
  /** folha mensal atual, depois da operação e teto (anual) */
  monthly: number;
  after: number;
  ceiling: number;
  /** uso do teto depois (0..) */
  usage: number;
}

/**
 * Teto da folha salarial (diretoria): a folha ANUAL depois da operação (+`addMonthly` − `removeMonthly`) não pode
 * passar do teto. Sem perfil (saves antigos sem receita), sempre ok.
 */
export function checkWageCeiling(state: SeasonState, clubId: string, squad: Pick<Player, 'id' | 'wage'>[], addMonthly: number, removeMonthly = 0): CeilingCheck {
  const ceiling = boardWageCeiling(state, clubId);
  // (Etapa 5) emprestados contam pela parte do salário que cada clube paga
  const monthly = state.market ? clubWageBill(state, clubId, squad) : wageBillOf(squad);
  const after = Math.max(0, monthly + addMonthly - removeMonthly);
  if (!(ceiling > 0)) return { ok: true, monthly, after, ceiling: 0, usage: 0 };
  // só bloqueia o que AUMENTA a folha acima do teto
  const ok = after * 12 <= ceiling || addMonthly - removeMonthly <= 0;
  return { ok, monthly, after, ceiling, usage: (after * 12) / ceiling };
}

export function ceilingError(c: CeilingCheck): string {
  return `A diretoria vetou: a folha salarial passaria para ${fmtMoneyShort(c.after * 12)}/ano, acima do teto de ${fmtMoneyShort(c.ceiling)} (${Math.round(c.usage * 100)}%).`;
}

/* ═════════════════════ fluxo mensal ═════════════════════ */

export interface MonthlyResult {
  tv: number; sponsor: number; owner: number; wages: number; staff: number; maintenance: number; opex: number; overdraft: number; matchday: number;
}

/**
 * Dia 1 (economia da Etapa 4): TV, patrocínio e aporte entram; salários, comissão técnica/funcionários, manutenção do
 * estádio e despesas operacionais saem; saldo negativo paga juros do cheque especial. MUTA o clube.
 */
export function monthlyCashFlow(club: ClubSeasonState, info: ClubEconomyInfo & EconProfile, wages: number): MonthlyResult {
  const tv = Math.round(info.tvPerSeason / 12);
  const sponsor = Math.round(info.sponsorPerSeason / 12);
  // dono-investidor (PIF): o aporte acompanha a folha atual (cobre aumentos; diminui se a folha cair)
  const owner = info.ownerBacked
    ? Math.max(0, Math.round(info.ownerPerSeason / 12 + wages - (info.wageBill ?? 0) / 12))
    : Math.round(info.ownerPerSeason / 12);
  const staff = Math.round(info.staffPerSeason / 12);
  const maintenance = Math.round(info.maintenancePerSeason / 12);
  const opex = Math.round(info.opexPerSeason / 12);
  // convidados (fora do escopo) quase não jogam em casa: a bilheteria esperada entra por mês
  const matchday = info.guest ? Math.round(info.gatePerSeason / 12) : 0;
  club.balance += tv + sponsor + owner + matchday - wages - staff - maintenance - opex;
  const overdraft = club.balance < 0 ? Math.round(-club.balance * ECON.overdraftRate) : 0;
  club.balance -= overdraft;
  const fin = (club.finance ??= { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 });
  fin.tv += tv;
  fin.sponsor += sponsor;
  if (owner) fin.owner = (fin.owner ?? 0) + owner;
  if (matchday) fin.tickets += matchday;
  fin.wages -= wages;
  fin.staff = (fin.staff ?? 0) - staff;
  fin.maintenance = (fin.maintenance ?? 0) - maintenance;
  fin.operating = (fin.operating ?? 0) - opex;
  if (overdraft) fin.overdraft = (fin.overdraft ?? 0) - overdraft;
  return { tv, sponsor, owner, wages, staff, maintenance, opex, overdraft, matchday };
}

/* ═════════════════════ demonstrativo mensal (clubes humanos) ═════════════════════ */

const LEDGER_KEYS: (keyof FinanceLedger)[] = [
  'tickets', 'tv', 'sponsor', 'prizes', 'wages', 'transfers', 'loanInterest', 'luvas', 'stadium', 'operating', 'owner', 'staff', 'maintenance', 'overdraft', 'sales', 'purchases',
];

export function ledgerDiff(a: FinanceLedger, b: FinanceLedger | undefined): Partial<FinanceLedger> {
  const out: Partial<FinanceLedger> = {};
  for (const k of LEDGER_KEYS) {
    const v = ((a[k] as number | undefined) ?? 0) - (((b?.[k]) as number | undefined) ?? 0);
    if (v) (out as Record<string, number>)[k] = v;
  }
  return out;
}

const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * Fecha o mês anterior do demonstrativo (MUTA o clube): no 1º dia de cada mês, o que o livro-caixa mudou desde o
 * início do mês anterior vira uma linha de `club.months`.
 */
export function rollMonth(club: ClubSeasonState, date: string): void {
  const m = monthOf(date);
  const ledger = club.finance ?? { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 };
  const ms = club.monthStart;
  if (ms && ms.month === m) return;
  if (ms) pushMonth(club, { month: ms.month, flow: ledgerDiff(ledger, ms.ledger), balance: club.balance });
  club.monthStart = { month: m, ledger: { ...ledger } };
}

export function pushMonth(club: ClubSeasonState, row: MonthFlow): void {
  const list = (club.months ??= []);
  const i = list.findIndex((x) => x.month === row.month);
  if (i >= 0) list[i] = row;
  else list.push(row);
  list.sort((a, b) => (a.month < b.month ? -1 : 1));
  if (list.length > ECON.monthsKept) list.splice(0, list.length - ECON.monthsKept);
}

/** Mês em andamento (desde o dia 1) — para a UI. */
export function currentMonthFlow(club: ClubSeasonState | undefined, date: string): MonthFlow | null {
  if (!club?.finance) return null;
  const ms = club.monthStart;
  return { month: ms?.month ?? monthOf(date), flow: ledgerDiff(club.finance, ms?.ledger), balance: club.balance };
}

/** Formata em reais (câmbio fixo): "R$ 756 mi". */
export function toBrl(v: number): number {
  return v * ECON.brlPerEur;
}
