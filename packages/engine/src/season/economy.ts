/**
 * Receitas da temporada (a engine não altera o pipeline de dados; só adiciona receitas).
 * Calibrado por scripts/calibrate.ts para que um clube médio da Série A (folha ≈ 12,1M/ano,
 * patrocínio 6M) feche a temporada perto do equilíbrio.
 *
 *   receita = patrocínio (dado) + bilheteria + cota de TV + premiação por posição
 *   todas as receitas novas são multiplicadas por `revenueMultiplier`.
 */
export const ECONOMY = {
  /** botão global para as receitas da engine (bilheteria + TV + premiação) */
  revenueMultiplier: 1,
  /** preço médio do ingresso por divisão (moeda do jogo, mesma escala dos salários) */
  ticketPrice: { 1: 4.6, 2: 2.6, 3: 1.6, 4: 1.0, default: 0.8 } as Record<string, number>,
  /** +x por ponto de reputação acima de 2.5 */
  ticketRepK: 0.1,
  /** cota de TV por temporada, paga em 12 parcelas no dia 1 */
  tvPerSeason: { 1: 1.6e6, 2: 0.45e6, 3: 0.15e6, 4: 0.05e6, default: 0.02e6 } as Record<string, number>,
  /** premiação do campeão; o último recebe `prizeBottomShare` disso, linear entre */
  prizeChampion: { 1: 3.2e6, 2: 0.7e6, 3: 0.3e6, 4: 0.1e6, default: 0.05e6 } as Record<string, number>,
  prizeBottomShare: 0.08,
  /** patrocínio padrão quando o clube não informa (por divisão, por temporada) */
  sponsorDefault: { 1: 6e6, 2: 4.5e6, 3: 2.5e6, 4: 2e6, default: 1e6 } as Record<string, number>,
  /**
   * (Fase 2, ajuste de 2026-11-13) custos operacionais por temporada (manutenção do estádio, funcionários,
   * viagens — o expenseStadium/"Manutenção mensal" do original), cobrados em 12 parcelas no dia 1.
   * Calibrados com scripts/career.ts para que o clube MEDIANO de cada divisão feche o ano perto de zero
   * (prêmios incluídos): antes a Série A ganhava ~+4,5–7M/ano na mediana e o caixa médio ia de 15M a ~42M em
   * 3 anos. 'foreign' = clubes estrangeiros simulados (economia de 1ª divisão do seu país).
   */
  structureCost: { 1: 6.0e6, 2: 3.6e6, 3: 1.7e6, 4: 1.4e6, default: 0.75e6, foreign: 4.0e6 } as Record<string, number>,
};

/**
 * (Escala real, 13/11) Clubes com `ClubEconomyInfo.revenue` (dados reais ou fallback do pipeline, em euros; 1 "$" = 1 €)
 * usam receitas proporcionais à receita anual R, em vez das tabelas por divisão acima (que ficam para saves antigos):
 *   patrocínio = sponsorPerSeason (o pipeline grava 0,40 × R) · TV = tvShare × R · bilheteria ≈ matchdayShare × R
 *   (preço do ingresso calibrado pela capacidade/reputação e nº estimado de jogos em casa)
 *   custo operacional (funcionários, estrutura) = max(opexMinShare × R, breakEvenShare × R − W0)
 *   aporte do dono (clubes com folha acima da receita, ex.: sauditas) = max(0, W0 + opexMinShare × R − incomeShare × R)
 * W0 = folha anual do elenco nos dados (`wageBill`, soma dos salários dos jogadores × 12). Com a folha inicial, o caixa
 * fica ~estável: receita ≈ folha + custos + superávit de ~3% de R (+ prêmios ± transferências). Contratar acima da
 * folha inicial pesa no caixa (o custo operacional e o aporte não acompanham a folha nova).
 */
export const REAL_ECONOMY = {
  tvShare: 0.38,
  matchdayShare: 0.17,
  /** soma das receitas fixas esperadas (patrocínio 0,40 + TV + bilheteria) */
  incomeShare: 0.95,
  opexMinShare: 0.1,
  breakEvenShare: 0.92,
  /** jogos em casa estimados por temporada (estadual + liga + copa + continentais) para o preço do ingresso */
  homeGames: { 1: 30, 2: 26, 3: 18, 4: 14, default: 8 } as Record<string, number>,
  ticketMin: 2,
  ticketMax: 250,
};

export interface RealEconomyInfo {
  revenue?: number;
  wageBill?: number;
  sponsorPerSeason?: number;
  division?: number;
  capacity?: number;
  reputation?: number;
  foreign?: boolean;
}

/** O clube usa a economia em escala real? */
export const hasRealEconomy = (info: RealEconomyInfo | undefined): info is RealEconomyInfo & { revenue: number } =>
  !!info && typeof info.revenue === 'number' && info.revenue > 0;

/** Ocupação média esperada do estádio (mesma conta da simulação: 0,42 + 0,08 × rep + 0,03 × 2,5 do visitante). */
export function expectedFill(reputation: number | undefined): number {
  return Math.min(1, Math.max(0.12, 0.495 + 0.08 * (reputation ?? 2.5)));
}

/** Preço-base do ingresso na escala real: matchdayShare × R ÷ (jogos em casa × público esperado). */
export function realTicketPrice(info: RealEconomyInfo & { revenue: number }): number {
  const games = byDivNum(REAL_ECONOMY.homeGames, info.division);
  const att = Math.max(1000, (info.capacity || 10000) * expectedFill(info.reputation));
  const p = (REAL_ECONOMY.matchdayShare * info.revenue) / (games * att);
  return Math.round(Math.min(REAL_ECONOMY.ticketMax, Math.max(REAL_ECONOMY.ticketMin, p)) * 100) / 100;
}

/** Custo operacional anual na escala real. */
export function realOperatingPerSeason(info: RealEconomyInfo & { revenue: number }): number {
  const R = info.revenue, W0 = info.wageBill ?? 0.6 * R;
  return Math.max(REAL_ECONOMY.opexMinShare * R, REAL_ECONOMY.breakEvenShare * R - W0);
}

/** Aporte anual do dono/investidor (só quando a folha inicial passa do que a receita sustenta). */
export function ownerSupportPerSeason(info: RealEconomyInfo | undefined): number {
  if (!hasRealEconomy(info)) return 0;
  const R = info.revenue, W0 = info.wageBill ?? 0;
  return Math.max(0, W0 + REAL_ECONOMY.opexMinShare * R - REAL_ECONOMY.incomeShare * R);
}

/** Aporte mensal do dono (ver ownerSupportPerSeason). */
export function ownerMonthly(info: RealEconomyInfo | undefined): number {
  return Math.round(ownerSupportPerSeason(info) / 12);
}

/**
 * Bilheteria "fora dos jogos" de clubes estrangeiros (simulados só nas continentais): a fatia de bilheteria da
 * receita é paga por mês, já que quase não jogam em casa na temporada simulada.
 */
export function foreignMatchdayMonthly(info: RealEconomyInfo | undefined): number {
  if (!hasRealEconomy(info) || !info.foreign) return 0;
  return Math.round((REAL_ECONOMY.matchdayShare * info.revenue) / 12);
}

const byDivNum = (t: Record<string, number>, div: number | undefined) => t[String(div ?? 'default')] ?? t.default;

/** Constantes da Fase 1 (antes do ajuste de 2026-11-13), para comparação (`career.ts --economy legacy`). */
export const LEGACY_ECONOMY = { ...(JSON.parse(JSON.stringify(ECONOMY)) as typeof ECONOMY), structureCost: { 1: 0, 2: 0, 3: 0, 4: 0, default: 0, foreign: 0 } };

/** (Fase 2) custo operacional mensal (ver ECONOMY.structureCost). */
export function operatingMonthly(division: number | undefined, foreign?: boolean, info?: RealEconomyInfo): number {
  if (hasRealEconomy(info)) return Math.round(realOperatingPerSeason(info) / 12);
  const t = ECONOMY.structureCost;
  const v = foreign ? t.foreign ?? t[String(division ?? 'default')] : t[String(division ?? 'default')] ?? t.default;
  return Math.round((v ?? 0) / 12);
}

const byDiv = (t: Record<string, number>, div: number | undefined) => t[String(div ?? 'default')] ?? t.default;

export function ticketRevenue(attendance: number, division: number | undefined, reputation: number | undefined, info?: RealEconomyInfo): number {
  const price = hasRealEconomy(info)
    ? realTicketPrice(info)
    : byDiv(ECONOMY.ticketPrice, division) * (1 + ECONOMY.ticketRepK * ((reputation ?? 2.5) - 2.5));
  return Math.round(attendance * Math.max(0.2, price) * ECONOMY.revenueMultiplier);
}

export function tvMonthly(division: number | undefined, info?: RealEconomyInfo): number {
  if (hasRealEconomy(info)) return Math.round(((REAL_ECONOMY.tvShare * info.revenue) / 12) * ECONOMY.revenueMultiplier);
  return Math.round((byDiv(ECONOMY.tvPerSeason, division) / 12) * ECONOMY.revenueMultiplier);
}

export function sponsorMonthly(sponsorPerSeason: number | undefined, division: number | undefined): number {
  return Math.round((sponsorPerSeason ?? byDiv(ECONOMY.sponsorDefault, division)) / 12);
}

/** prêmio por posição final (1-based) */
export function leaguePrize(division: number | undefined, position: number, clubs: number): number {
  const top = byDiv(ECONOMY.prizeChampion, division);
  const bottom = top * ECONOMY.prizeBottomShare;
  const t = clubs <= 1 ? 0 : (position - 1) / (clubs - 1);
  return Math.round((top - (top - bottom) * t) * ECONOMY.revenueMultiplier);
}
