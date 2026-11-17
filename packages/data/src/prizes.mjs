// (Etapa 4) Tabelas da economia real 2026 → economy.json (`currency`, `tv`, `merit`, `competitionPrizes`, `wageRatio`,
// `matchday`, `ownerBacked`). Todos os valores finais em EUROS (moeda do jogo). Os valores originais ficam em `orig`
// (moeda + valor) quando vieram de outra moeda, e cada linha tem `source` e `confidence` ('high' | 'medium' | 'low').
//
// Câmbio fixo (documentado; a UI mostra a taxa): 1 € = R$ 6,30 · 1 US$ = 0,87 € · 1 £ = 1,17 €.
// A engine lê tudo daqui (packages/engine/src/season/economy.ts); sem estes campos (dados antigos) usa os mesmos
// números embutidos como padrão.

export const CURRENCY = { base: 'EUR', brlPerEur: 6.3, usdToEur: 0.87, gbpToEur: 1.17 };

const r = (v) => Math.round(v / 1000) * 1000;
const usd = (m) => r(m * 1e6 * CURRENCY.usdToEur);
const gbp = (m) => r(m * 1e6 * CURRENCY.gbpToEur);
const brl = (m) => r((m * 1e6) / CURRENCY.brlPerEur);
const eur = (m) => r(m * 1e6);

/**
 * Cota de TV anual (direitos centrais) por divisão: `min`/`max` em € — o clube recebe min + (max − min) × posição no
 * ranking de receita da divisão (o "tamanho" do clube: audiência, implantação social, paraquedas). Paga em 12
 * parcelas mensais (dia 1). A parte por desempenho (merit) está em `merit` e é paga no fim da liga.
 */
export const TV = {
  'ING-1': { min: eur(105), max: eur(115), source: 'Premier League 2024/25: parte igual + overseas + facility fees (~£90–100 mi); merit separado', confidence: 'high' },
  'ESP-1': { min: eur(45), max: eur(120), source: 'LaLiga 2024/25: 50% igual, 25% implantação social, 25% resultados (merit separado); Real/Barça ~€160 mi no total', confidence: 'medium' },
  'ITA-1': { min: eur(24), max: eur(65), source: 'Serie A 2024/25: base + audiência; total ~€25 mi (último) a ~€90 mi (Inter)', confidence: 'medium' },
  'ALE-1': { min: eur(30), max: eur(75), source: 'Bundesliga 2024/25 (DFL): pilares igual/desempenho/interesse; ~€35 mi a ~€105 mi', confidence: 'medium' },
  'FRA-1': { min: eur(6), max: eur(18), source: 'Ligue 1 2025/26 (Ligue1+ após a saída da DAZN): ~€8 mi a ~€30 mi com merit', confidence: 'low' },
  'POR-1': { min: eur(3), max: eur(38), source: 'Liga Portugal: contratos individuais (Benfica ~€40 mi, Porto ~€35 mi, pequenos ~€3 mi)', confidence: 'medium' },
  'HOL-1': { min: eur(3), max: eur(12), source: 'Eredivisie (ESPN): ~€3 mi a ~€12 mi', confidence: 'low' },
  'ARS-1': { min: eur(6), max: eur(18), source: 'Saudi Pro League: distribuição central modesta (PIF financia os 4 grandes)', confidence: 'low' },
  'BRA-1': { min: eur(22), max: eur(60), source: 'Brasileirão 2026 (blocos Libra/LFU): ~R$ 140 mi a ~R$ 380 mi', confidence: 'medium' },
  'ARG-1': { min: eur(2.5), max: eur(8), source: 'LPF Argentina (ESPN/TNT): valores pequenos em euros', confidence: 'low' },
  'URU-1': { min: eur(0.5), max: eur(2), source: 'estimativa', confidence: 'low' },
  'COL-1': { min: eur(1.5), max: eur(4), source: 'estimativa (Win Sports)', confidence: 'low' },
  'CHI-1': { min: eur(1.5), max: eur(4), source: 'estimativa (TNT Sports Chile)', confidence: 'low' },
  'PAR-1': { min: eur(0.6), max: eur(2.5), source: 'estimativa', confidence: 'low' },
  'EQU-1': { min: eur(1), max: eur(4), source: 'estimativa (LigaPro)', confidence: 'low' },
  'ING-2': { min: eur(9), max: eur(45), source: 'Championship: solidariedade ~£8 mi; paraquedas até ~£40 mi (topo do ranking de receita)', confidence: 'medium' },
  'ESP-2': { min: eur(5), max: eur(12), source: 'LaLiga Hypermotion', confidence: 'low' },
  'ITA-2': { min: eur(4), max: eur(10), source: 'Serie B (com paraquedas)', confidence: 'low' },
  'ALE-2': { min: eur(9), max: eur(25), source: '2. Bundesliga (DFL)', confidence: 'medium' },
  'FRA-2': { min: eur(2), max: eur(6), source: 'Ligue 2', confidence: 'low' },
  'POR-2': { min: eur(0.8), max: eur(2), source: 'estimativa', confidence: 'low' },
  'HOL-2': { min: eur(0.5), max: eur(1.5), source: 'estimativa', confidence: 'low' },
  'ARS-2': { min: eur(0.5), max: eur(2), source: 'estimativa', confidence: 'low' },
  'BRA-2': { min: eur(1.5), max: eur(5), source: 'Série B 2026: ~R$ 10–30 mi', confidence: 'low' },
  'ARG-2': { min: eur(0.3), max: eur(1), source: 'estimativa', confidence: 'low' },
  'URU-2': { min: eur(0.1), max: eur(0.4), source: 'estimativa', confidence: 'low' },
  'COL-2': { min: eur(0.3), max: eur(0.8), source: 'estimativa', confidence: 'low' },
  'CHI-2': { min: eur(0.3), max: eur(0.8), source: 'estimativa', confidence: 'low' },
  'PAR-2': { min: eur(0.1), max: eur(0.4), source: 'estimativa', confidence: 'low' },
  'EQU-2': { min: eur(0.2), max: eur(0.6), source: 'estimativa', confidence: 'low' },
  'BRA-state': { min: eur(0.05), max: eur(0.4), source: 'clubes só estaduais: cotas das federações', confidence: 'low' },
};

/**
 * Premiação por posição no fim da liga (merit): `first` para o campeão, linear até `last` na posição `paid`; abaixo
 * de `paid`, nada. Paga por `finalRanking` quando a liga termina.
 */
export const MERIT = {
  'ING-1': { first: gbp(56), last: gbp(2.8), paid: 20, orig: { currency: 'GBP', first: 56e6, perPlace: 2.8e6 }, source: 'Premier League merit payment 2024/25: £2,8 mi por posição', confidence: 'high' },
  'ESP-1': { first: eur(40), last: eur(2), paid: 20, source: 'LaLiga: fatia de 25% por resultados (simplificada por posição)', confidence: 'low' },
  'ITA-1': { first: eur(25), last: eur(1), paid: 20, source: 'Serie A: fatia por classificação', confidence: 'low' },
  'ALE-1': { first: eur(30), last: eur(2), paid: 18, source: 'Bundesliga: pilar de desempenho', confidence: 'low' },
  'FRA-1': { first: eur(12), last: eur(0.5), paid: 18, source: 'Ligue 1: parte por classificação', confidence: 'low' },
  'HOL-1': { first: eur(3), last: eur(0.2), paid: 18, source: 'estimativa', confidence: 'low' },
  'ARS-1': { first: usd(4), last: usd(0.3), paid: 18, source: 'estimativa (SPL)', confidence: 'low' },
  'BRA-1': { first: brl(48), last: brl(17), paid: 16, orig: { currency: 'BRL', first: 48e6, last: 17e6 }, source: 'Premiação CBF do Brasileirão (2024/25), 1º ao 16º', confidence: 'medium' },
  'BRA-2': { first: brl(3), last: brl(0.5), paid: 16, orig: { currency: 'BRL', first: 3e6, last: 0.5e6 }, source: 'estimativa (Série B)', confidence: 'low' },
  'ARG-1': { first: usd(1.2), last: usd(1.2), paid: 1, source: 'estimativa: prêmio do campeão', confidence: 'low' },
  'URU-1': { first: usd(0.3), last: usd(0.3), paid: 1, source: 'estimativa', confidence: 'low' },
  'COL-1': { first: usd(0.5), last: usd(0.5), paid: 1, source: 'estimativa', confidence: 'low' },
  'CHI-1': { first: usd(0.4), last: usd(0.4), paid: 1, source: 'estimativa', confidence: 'low' },
  'PAR-1': { first: usd(0.3), last: usd(0.3), paid: 1, source: 'estimativa', confidence: 'low' },
  'EQU-1': { first: usd(0.8), last: usd(0.8), paid: 1, source: 'estimativa (LigaPro)', confidence: 'low' },
  'POR-1': { first: eur(1.5), last: eur(1.5), paid: 1, source: 'estimativa: prêmio do campeão', confidence: 'low' },
  'ING-2': { first: gbp(1), last: gbp(1), paid: 1, source: 'estimativa', confidence: 'low' },
  'ESP-2': { first: eur(0.5), last: eur(0.5), paid: 1, source: 'estimativa', confidence: 'low' },
  'ITA-2': { first: eur(0.5), last: eur(0.5), paid: 1, source: 'estimativa', confidence: 'low' },
  'ALE-2': { first: eur(0.5), last: eur(0.5), paid: 1, source: 'estimativa', confidence: 'low' },
  'FRA-2': { first: eur(0.3), last: eur(0.3), paid: 1, source: 'estimativa', confidence: 'low' },
};

/**
 * Premiação por fase das copas e continentais (chave = id da competição ou `prizeKey`):
 *  - `participation`: ao entrar na competição (fase de liga/grupos ou 1ª fase)
 *  - `win` / `draw`: por jogo na fase de tabela (grupos/liga)
 *  - `reach`: ao chegar à fase — chaves `q1`..`q4` (fases preliminares/1ª–4ª fase), `playoff`, `groups`,
 *    `r64`, `r32`, `r16`, `qf`, `sf`, `final` (os dois finalistas). Na fase que define o campeão, a chave vem da
 *    distância até a final (final, sf, qf, r16, r32, r64); fora dela, do nome da fase.
 *  - `champion`: bônus extra do campeão (além do `final`)
 */
export const COMPETITION_PRIZES = {
  CHAMPIONS: {
    participation: eur(18.62), win: eur(2.1), draw: eur(0.7),
    reach: { playoff: eur(1), r16: eur(11), qf: eur(12.5), sf: eur(15), final: eur(18.5) }, champion: eur(6.5),
    source: 'UEFA, distribuição 2025/26 (Liga dos Campeões)', confidence: 'high',
  },
  EUROPA: {
    participation: eur(4.31), win: eur(0.45), draw: eur(0.15),
    reach: { playoff: eur(0.3), r16: eur(1.75), qf: eur(3), sf: eur(4.5), final: eur(7) }, champion: eur(6),
    source: 'UEFA, distribuição 2025/26 (Liga Europa)', confidence: 'high',
  },
  CONFERENCE: {
    participation: eur(3.17), win: eur(0.4), draw: eur(0.133),
    reach: { playoff: eur(0.2), r16: eur(0.8), qf: eur(1.3), sf: eur(2.5), final: eur(4) }, champion: eur(3),
    source: 'UEFA, distribuição 2025/26 (Conference League)', confidence: 'high',
  },
  UEFA_SUPER: { participation: eur(4), champion: eur(1), source: 'UEFA Supercopa', confidence: 'medium' },
  LIBERTADORES: {
    win: usd(0.33),
    reach: { q1: usd(0.6), q2: usd(0.75), q3: usd(0.85), groups: usd(3), r16: usd(1.25), qf: usd(1.7), sf: usd(2.3), final: usd(7) }, champion: usd(17),
    orig: { currency: 'USD', groups: '1 mi por jogo em casa (3)', win: 0.33e6, champion: 24e6 },
    source: 'CONMEBOL Libertadores 2025/2026 (campeão US$ 24 mi no total; vice US$ 7 mi)', confidence: 'medium',
  },
  SULAMERICANA: {
    win: usd(0.1),
    reach: { q1: usd(0.25), groups: usd(0.9), playoff: usd(0.5), r16: usd(0.6), qf: usd(0.7), sf: usd(1), final: usd(2.5) }, champion: usd(7.5),
    orig: { currency: 'USD', champion: 10e6 }, source: 'CONMEBOL Sul-Americana 2025 (campeão US$ 10 mi no total)', confidence: 'medium',
  },
  RECOPA: { reach: { final: usd(0.9) }, champion: usd(0.9), orig: { currency: 'USD' }, source: 'CONMEBOL Recopa (estimativa)', confidence: 'low' },
  INTERCONTINENTAL: { participation: usd(1), reach: { final: usd(2) }, champion: usd(3), orig: { currency: 'USD' }, source: 'FIFA Copa Intercontinental (estimativa)', confidence: 'low' },
  SUPERMUNDIAL: {
    participation: usd(15.21), win: usd(2), draw: usd(1),
    reach: { r16: usd(7.5), qf: usd(13.125), sf: usd(21), final: usd(30) }, champion: usd(10),
    orig: { currency: 'USD' }, source: 'FIFA Mundial de Clubes 2025 (base CONMEBOL; campeão US$ 40 mi na fase final)', confidence: 'high',
  },
  AFC_ELITE: {
    participation: usd(0.8), win: usd(0.1), draw: usd(0.05),
    reach: { playoff: usd(0.3), r16: usd(0.6), qf: usd(1), sf: usd(1.5), final: usd(4) }, champion: usd(6),
    orig: { currency: 'USD' }, source: 'AFC Champions League Elite 2025/26 (campeão US$ 10 mi)', confidence: 'low',
  },
  'BRA-CUP': {
    reach: { q1: brl(0.9), q2: brl(1.1), q3: brl(1.8), q4: brl(2.3), r32: brl(3.3), r16: brl(3.8), qf: brl(4.5), sf: brl(9.5), final: brl(33) }, champion: brl(44),
    orig: { currency: 'BRL', champion: 77e6 }, source: 'Copa do Brasil (CBF 2025, campeão ~R$ 77 mi no total)', confidence: 'medium',
  },
  'BRA-SUP': { reach: { final: brl(5) }, champion: brl(5), orig: { currency: 'BRL' }, source: 'Supercopa do Brasil (estimativa)', confidence: 'low' },
  'ING-CUP': {
    reach: { r64: gbp(0.105), r32: gbp(0.12), r16: gbp(0.225), qf: gbp(0.45), sf: gbp(1), final: gbp(1) }, champion: gbp(1),
    orig: { currency: 'GBP', champion: 2e6 }, source: 'FA Cup 2025/26 (prize fund; campeão £2 mi)', confidence: 'medium',
  },
  'ING-LCUP': { reach: { sf: gbp(0.05), final: gbp(0.05) }, champion: gbp(0.1), orig: { currency: 'GBP' }, source: 'EFL Cup (valores pequenos)', confidence: 'low' },
  'ING-SUP': { source: 'Community Shield (sem prêmio relevante)', confidence: 'medium' },
  'ESP-CUP': { reach: { r32: eur(0.1), r16: eur(0.2), qf: eur(0.4), sf: eur(0.8), final: eur(1) }, champion: eur(1), source: 'Copa del Rey (RFEF, estimativa)', confidence: 'low' },
  'ESP-SUP': { participation: eur(3), champion: eur(2), source: 'Supercopa de España (Riad): cachês de participação', confidence: 'low' },
  'ITA-CUP': { reach: { r16: eur(0.5), qf: eur(1), sf: eur(1.8), final: eur(3) }, champion: eur(4.5), source: 'Coppa Italia (estimativa)', confidence: 'low' },
  'ITA-SUP': { participation: eur(3), champion: eur(2), source: 'Supercoppa Italiana (Riad, estimativa)', confidence: 'low' },
  'ALE-CUP': {
    reach: { r64: eur(0.21), r32: eur(0.42), r16: eur(0.84), qf: eur(1.67), sf: eur(3.35), final: eur(2.9) }, champion: eur(1.5),
    source: 'DFB-Pokal 2024/25 (DFB)', confidence: 'medium',
  },
  'ALE-SUP': { reach: { final: eur(0.5) }, champion: eur(0.5), source: 'DFL-Supercup (estimativa)', confidence: 'low' },
  'FRA-CUP': { reach: { r16: eur(0.06), qf: eur(0.1), sf: eur(0.3), final: eur(0.5) }, champion: eur(0.7), source: 'Coupe de France (estimativa)', confidence: 'low' },
  'POR-CUP': { reach: { sf: eur(0.15), final: eur(0.3) }, champion: eur(0.7), source: 'Taça de Portugal (estimativa)', confidence: 'low' },
  'HOL-CUP': { reach: { sf: eur(0.1), final: eur(0.2) }, champion: eur(0.4), source: 'KNVB Beker (estimativa)', confidence: 'low' },
  'ARS-CUP': { reach: { sf: usd(0.3), final: usd(0.8) }, champion: usd(1.5), source: "King's Cup (estimativa)", confidence: 'low' },
  'ARG-CUP': { reach: { sf: usd(0.15), final: usd(0.3) }, champion: usd(0.7), source: 'Copa Argentina (estimativa)', confidence: 'low' },
  NACIONAL_CUP: { reach: { sf: usd(0.05), final: usd(0.1) }, champion: usd(0.2), source: 'copas nacionais menores (estimativa)', confidence: 'low' },
  SUPERCOPA: { reach: { final: usd(0.05) }, champion: usd(0.1), source: 'supercopas menores (estimativa)', confidence: 'low' },
};

/**
 * Folha salarial ÷ receita (jogadores). `target`: patamar da recalibração do pipeline (clubes sem folha curada);
 * `cap`: teto da diretoria (Teto da Folha Salarial = receita × cap, limitado ao redor da folha atual — ver engine).
 * Chave: liga (`ING-1`) > país (`ING`) > `default`.
 */
export const WAGE_RATIO = {
  ING: { target: 0.55, cap: 0.65, source: 'Premier League ~55–65% (Deloitte ARF 2025)' },
  'ING-2': { target: 0.8, cap: 0.95, source: 'Championship: folha ~90–100% da receita (donos cobrem)' },
  ESP: { target: 0.6, cap: 0.7, source: 'LaLiga ~60–70%, com controle de custo de elenco' },
  ITA: { target: 0.58, cap: 0.65, source: 'Serie A ~60–65%' },
  ALE: { target: 0.5, cap: 0.55, source: 'Bundesliga ~50–55%' },
  FRA: { target: 0.62, cap: 0.72, source: 'Ligue 1 ~65–70% (DNCG)' },
  POR: { target: 0.5, cap: 0.6, source: 'estimativa' },
  HOL: { target: 0.5, cap: 0.6, source: 'estimativa' },
  ARS: { target: 0.7, cap: 0.85, source: 'Saudi Pro League (fora do PIF)' },
  BRA: { target: 0.5, cap: 0.6, source: 'Brasil ~50–60% (Convocados/Itaú BBA 2025)' },
  ARG: { target: 0.42, cap: 0.5, source: 'Argentina: folha menor em valores absolutos' },
  URU: { target: 0.45, cap: 0.55, source: 'estimativa' },
  COL: { target: 0.45, cap: 0.55, source: 'estimativa' },
  CHI: { target: 0.45, cap: 0.55, source: 'estimativa' },
  PAR: { target: 0.45, cap: 0.55, source: 'estimativa' },
  EQU: { target: 0.45, cap: 0.55, source: 'estimativa' },
  owner: { target: 1.3, cap: 1.9, source: 'PIF (Al-Hilal, Al-Nassr, Al-Ittihad, Al-Ahli): folha bancada pelo dono, acima da receita' },
  default: { target: 0.5, cap: 0.6, source: 'padrão' },
};

/** Fatia da receita que vem da bilheteria (calibra o preço-base do ingresso). */
export const MATCHDAY_SHARE = {
  ING: 0.15, ESP: 0.17, ITA: 0.11, ALE: 0.15, FRA: 0.11, POR: 0.12, HOL: 0.13, ARS: 0.05,
  BRA: 0.13, ARG: 0.25, URU: 0.2, COL: 0.22, CHI: 0.2, PAR: 0.2, EQU: 0.2, default: 0.12,
};

/** Clubes bancados pelo dono (aporte explícito "Aporte"). */
export const OWNER_BACKED = ['al-hilal', 'alnassr-ara', 'alittihad-ara', 'al-ahli-ara'];

/** Bloco completo gravado em economy.json (v2). */
export function economyV2() {
  const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v]));
  return {
    version: 2,
    currency: CURRENCY,
    tv: strip(TV),
    merit: strip(MERIT),
    competitionPrizes: strip(COMPETITION_PRIZES),
    wageRatio: strip(WAGE_RATIO),
    matchday: MATCHDAY_SHARE,
    ownerBacked: OWNER_BACKED,
  };
}

/** Razão folha/receita (target, cap) para um clube. */
export function wageRatioFor(code, leagueId, ownerBacked = false) {
  if (ownerBacked) return WAGE_RATIO.owner;
  return (leagueId && WAGE_RATIO[leagueId]) || WAGE_RATIO[code] || WAGE_RATIO.default;
}
