/**
 * Jogadores ao longo dos anos (Fase 1): evolução mensal, bônus de fim de ano, aposentadoria
 * e geração de juniores (regens). Números da spec §4.3–4.5 (confiança Baixa, calibrados em
 * scripts/career.ts para não inflar/deflacionar a média do país).
 * Fórmulas de rating portadas de packages/data/src/ratings.mjs (mesma escala do pipeline).
 */
import type { NamePool, Player, Position } from '@cosmicfut/shared';
import { Rng } from '../rng';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ───────────── escalas do pipeline ───────────── */

/** Média-alvo do elenco principal (nível 1..24, reputação 0..5). */
export function squadTarget(level: number, reputation?: number): number {
  const L = clamp(level || 1, 1, 24);
  return 47 + (L - 1) * (37 / 23) + 0.4 * ((reputation ?? 2.5) - 2.5);
}

/** Margem de evolução restante pela idade. */
export function growthGap(age: number): number {
  const t: Record<number, number> = { 15: 22, 16: 20, 17: 18, 18: 16, 19: 14, 20: 12, 21: 10, 22: 8, 23: 6, 24: 4, 25: 3, 26: 2, 27: 1 };
  if (age < 15) return 22;
  return t[age] ?? 0;
}

function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 500_000) * 500_000;
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000;
  if (v >= 100_000) return Math.round(v / 10_000) * 10_000;
  if (v >= 10_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 100) * 100;
}

/*
 * (escala real, 13/11) Curvas em euros — as MESMAS de packages/data/src/real.mjs:
 *   valor neutro = 2,5 M × e^(0,2 × (eff − 70)) × multIdade     (eff = overall + 0,35 × (pot − ovr) até 23 anos)
 *   salário neutro (mensal) = 0,025 × (2,5 M × e^(0,2 × (ovr − 70)))^0,95 × (≤20 0,5 · ≤22 0,75)
 * O pipeline multiplica cada clube por um fator (prêmio da liga/clube, calibrado pelos dados reais). A engine
 * PRESERVA esse fator: na evolução o valor é reescalado pela razão das curvas (`revalue`), e não recalculado do zero.
 */
export const VALUE_CURVE = { base: 2_500_000, k: 0.2, pivot: 70, wageA: 0.025, wageB: 0.95 };

export function ageValueMult(age: number): number {
  if (age <= 20) return 1.15;
  if (age <= 24) return 1.05;
  if (age <= 27) return 1;
  if (age === 28) return 0.92;
  if (age === 29) return 0.85;
  if (age === 30) return 0.72;
  if (age === 31) return 0.6;
  if (age === 32) return 0.48;
  if (age === 33) return 0.38;
  return 0.3 * Math.pow(0.8, age - 34);
}

/** Valor "neutro" (sem prêmio de liga/clube). */
export function valueCurve(age: number, ovr: number, pot: number): number {
  const eff = age <= 23 ? ovr + Math.max(0, pot - ovr) * 0.35 : ovr;
  return VALUE_CURVE.base * Math.exp(VALUE_CURVE.k * (eff - VALUE_CURVE.pivot)) * ageValueMult(age);
}

/** Prêmio genérico pela reputação do clube (0..5 → 0,45..1,2) — só para quem não tem valor de referência. */
const repPremium = (rep: number | undefined) => 0.45 + 0.15 * clamp(rep ?? 2, 0, 5);

/** Valor de mercado genérico (juniores gerados, jogadores sem valor de referência). */
export function marketValue(age: number, ovr: number, pot: number, rep = 2): number {
  return Math.max(10_000, roundMoney(valueCurve(age, ovr, pot) * repPremium(rep)));
}

/**
 * Valor após mudança de idade/overall/potencial, preservando o fator de liga/clube do jogador:
 * valor antigo × curva(novo) ÷ curva(antigo). Sem valor antigo: `marketValue`.
 */
export function revalue(p: Pick<Player, 'age' | 'overall' | 'potential' | 'value'>, age: number, ovr: number, pot: number, rep = 2): number {
  const before = valueCurve(p.age, p.overall, p.potential);
  if (!(p.value > 0) || !(before > 0)) return marketValue(age, ovr, pot, rep);
  return Math.max(10_000, roundMoney(p.value * (valueCurve(age, ovr, pot) / before)));
}

/** Salário mensal genérico de mercado (piso de renovação, livres contratados, juniores). */
export function monthlyWage(age: number, ovr: number, rep = 2): number {
  const v = VALUE_CURVE.base * Math.exp(VALUE_CURVE.k * (ovr - VALUE_CURVE.pivot)) * repPremium(rep);
  const ageMult = age <= 20 ? 0.5 : age <= 22 ? 0.75 : 1;
  return Math.max(300, roundMoney(VALUE_CURVE.wageA * Math.pow(v, VALUE_CURVE.wageB) * ageMult));
}

/* ───────────── evolução ───────────── */

/** Parâmetros (ajustáveis) da evolução. */
export const EVOLUTION = {
  youngRate: 0.035, // até 21: +gap × taxa por mês
  midRate: 0.03, // 22–25
  playedBonus: 0.25, // até 21, se jogou ≥ 50% dos jogos do clube
  peakNoise: 0.15, // 26–29
  decline: [
    [30, -0.08],
    [32, -0.17],
    [34, -0.3],
  ] as [number, number][],
  /** bônus de fim de ano */
  youngBonusMaxAge: 23,
  youngBonusGames: 20,
  standoutRating: 7.0,
  standoutMinGames: 10,
};

/**
 * (18/11) Minutos e treino no crescimento: quem joga (ou está no Centro de Treinamento) chega ao potencial mais
 * rápido; quem fica no banco cresce devagar. Só vale com o clube tendo jogado `PLAY.minGames` jogos no trecho.
 */
export const PLAY = {
  minGames: 4,
  /** [participação mínima, multiplicador do crescimento] (a 1ª que servir) */
  growth: [[0.6, 1.5], [0.35, 1.2], [0.15, 0.85], [0, 0.55]] as [number, number][],
  /** em treino especial: crescimento pelo menos isto */
  trainingGrowth: 1.25,
  /** potencial cai quem fica no banco: participação abaixo disto, com o clube tendo jogado `decayMinGames` jogos */
  decayShare: 0.15,
  decayMinGames: 8,
  /** queda do potencial por mês (≈ −2,5 numa temporada inteira encostado) */
  decayPerMonth: 0.25,
  /** até esta idade o potencial ainda importa (depois disso ele já acompanha o overall) */
  decayMaxAge: 27,
};

/** Multiplicador do crescimento pelos minutos (1 = neutro, no começo da temporada). */
export function playGrowthFactor(playedShare: number, clubGames: number, training = false): number {
  let f = 1;
  if (clubGames >= PLAY.minGames) f = PLAY.growth.find(([min]) => playedShare >= min)?.[1] ?? 1;
  return training ? Math.max(f, PLAY.trainingGrowth) : f;
}

/** Queda do potencial no mês por falta de jogos (0 = não cai). */
export function benchPotentialLoss(age: number, playedShare: number, clubGames: number, training = false): number {
  if (training || age > PLAY.decayMaxAge || clubGames < PLAY.decayMinGames || playedShare >= PLAY.decayShare) return 0;
  return PLAY.decayPerMonth;
}

/**
 * Δ de overall num mês (fracionário). `playedShare` = jogos do jogador / jogos do clube no ano. (18/11) `growth` =
 * multiplicador pelos minutos/treino (playGrowthFactor; 1 = antigo).
 */
export function monthlyDelta(age: number, overall: number, potential: number, playedShare: number, rng: Rng, growth = 1): number {
  const gap = Math.max(0, potential - overall);
  if (age <= 21) return (gap * EVOLUTION.youngRate + (playedShare >= 0.5 ? EVOLUTION.playedBonus : 0) * (gap > 0 ? 1 : 0.3)) * growth;
  if (age <= 25) return gap * EVOLUTION.midRate * growth;
  if (age <= 29) return (rng.next() * 2 - 1) * EVOLUTION.peakNoise;
  let d = 0;
  for (const [a, v] of EVOLUTION.decline) if (age >= a) d = v;
  return d;
}

/** Bônus de fim de ano (+1 jovem com ≥ 20 jogos; +1 destaque com média ≥ 7,0). */
export function yearEndBonus(age: number, games: number, avgRating: number): number {
  let b = 0;
  if (age <= EVOLUTION.youngBonusMaxAge && games >= EVOLUTION.youngBonusGames) b++;
  if (games >= EVOLUTION.standoutMinGames && avgRating >= EVOLUTION.standoutRating) b++;
  return b;
}

/**
 * (18/11) Potencial "real" = teto que o jogador ainda pode atingir, pela idade. Até 23 anos: o potencial dos dados
 * (nunca abaixo do overall). 24–27: no máximo overall + o crescimento que ainda cabe na idade (`growthGap`: +4, +3,
 * +2, +1). 28+: não cresce mais ⇒ potencial = overall atual (um veterano em declínio perde potencial junto).
 */
export function realisticPotential(age: number, overall: number, potential: number): number {
  if (age <= 23) return Math.max(potential, overall);
  return Math.max(overall, Math.min(potential, overall + growthGap(age)));
}

/** Potencial no fim do ano (idade já incrementada): ruído ±2 até 23; aos 24+ = `realisticPotential`. */
export function nextPotential(newAge: number, potential: number, overall: number, rng: Rng): number {
  if (newAge >= 24) return realisticPotential(newAge, overall, potential);
  const noise = Math.round(rng.normal() * 1.2);
  return clamp(Math.max(overall, potential + clamp(noise, -2, 2)), 1, 99);
}

/* ───────────── aposentadoria ───────────── */

export const RETIREMENT = {
  minAge: 33,
  byAge: { 33: 0.1, 34: 0.2, 35: 0.35, 36: 0.55, 37: 0.75 } as Record<number, number>,
  over: 0.95, // 38+
  lowOverall: 55,
  lowGames: 10,
  lowBonus: 0.15,
  highOverall: 80,
  highMalus: 0.1,
  gkAgeOffset: 2,
};

/** Probabilidade anual de aposentadoria (≥ 33; goleiro: idade efetiva − 2). */
export function retireChance(p: Pick<Player, 'age' | 'overall' | 'position'>, games: number | undefined): number {
  const eff = p.position === 'GK' ? p.age - RETIREMENT.gkAgeOffset : p.age;
  if (p.age < RETIREMENT.minAge || eff < RETIREMENT.minAge) return 0;
  let c = eff >= 38 ? RETIREMENT.over : RETIREMENT.byAge[eff] ?? 0;
  if (p.overall < RETIREMENT.lowOverall || (games !== undefined && games < RETIREMENT.lowGames)) c += RETIREMENT.lowBonus;
  if (p.overall >= RETIREMENT.highOverall) c -= RETIREMENT.highMalus;
  return clamp(c, 0, 0.99);
}

/* ───────────── juniores ───────────── */

/** (18/11) idade mínima de qualquer jogador no jogo (o banco do original tem juniores de 15–16 anos) */
export const MIN_PLAYER_AGE = 17;

export const YOUTH = {
  minAge: MIN_PLAYER_AGE,
  maxAge: 18,
  /** overall inicial = squadTarget − offset ± spread (spec §4.5: −22 ± 6) */
  offset: 22,
  spread: 6,
  /** (23/11) potencial 90+ mais raro: desvio 5 → 4; promessa mundial 2% (88–95) → 0,5% (86–93) */
  potentialSd: 4,
  worldPromise: 0.005,
  promise: [86, 93] as const,
  /** apelido de nome único no Brasil */
  brazilNickname: 0.35,
  /** juniores extras por ano (além de 1 por aposentadoria), até `academyLimit` na base… */
  perYear: 2,
  academyLimit: 20,
  /** …e só se o elenco (após repor com livres) tiver menos que isto — evita inchar os elencos e derrubar a idade média */
  squadCap: 24,
  /** com 19 anos o júnior deixa de ser "base" */
  graduateAge: 19,
};

function weighted(list: { n: string; w: number }[] | undefined, rng: Rng): string {
  if (!list || !list.length) return '';
  const i = rng.weightedIndex(list.map((x) => x.w));
  return list[Math.max(0, i)].n;
}

/** Nome do pool da nacionalidade (linhas repetidas = peso). Brasil: 35% de apelido de nome único. */
export function randomName(pool: NamePool | undefined, rng: Rng, brazilStyle = false): string {
  const given = weighted(pool?.given, rng) || 'Jogador';
  const sur = weighted(pool?.surname, rng);
  if (brazilStyle && rng.chance(YOUTH.brazilNickname)) return rng.chance(0.5) || !sur ? given : sur;
  return sur ? `${given} ${sur}` : given;
}

/** Posição mais carente do elenco (proporção vs formação de referência). */
export function neediestPosition(squad: Pick<Player, 'position'>[], rng: Rng): Position {
  const ideal: Record<Position, number> = { GK: 3, FB: 5, CB: 5, MF: 8, FW: 5 };
  const c: Record<Position, number> = { GK: 0, FB: 0, CB: 0, MF: 0, FW: 0 };
  for (const p of squad) c[p.position]++;
  let best: Position = 'MF', bestScore = -Infinity;
  for (const pos of ['GK', 'FB', 'CB', 'MF', 'FW'] as Position[]) {
    const s = (ideal[pos] - c[pos]) / ideal[pos] + rng.next() * 0.05;
    if (s > bestScore) { bestScore = s; best = pos; }
  }
  return best;
}

export interface YouthSpec {
  id: string;
  clubLevel: number;
  clubReputation?: number;
  nationalityId: number;
  pool?: NamePool;
  brazilStyle?: boolean;
  position: Position;
  rng: Rng;
  /**
   * (escala real) média de overall do elenco principal atual: substitui `squadTarget(nível)` como referência
   * (os dados reais deslocam a escala de overall por clube). Ausente ⇒ squadTarget.
   */
  squadMean?: number;
  /** (escala real) fator de valor do clube (mediana de valor ÷ curva neutra do elenco). Ausente ⇒ prêmio pela reputação. */
  valueScale?: number;
  /** (escala real) fator de salário do clube (mediana de salário ÷ salário genérico). Ausente ⇒ 1. */
  wageScale?: number;
}

/** (escala real) Fatores de valor e salário de um elenco (medianas), para juniores e reposições no mesmo patamar. */
export function squadScales(squad: Pick<Player, 'age' | 'overall' | 'potential' | 'value' | 'wage' | 'youth'>[], rep?: number): { squadMean?: number; valueScale?: number; wageScale?: number } {
  const main = squad.filter((p) => !p.youth);
  if (main.length < 11) return {};
  const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const best = main.map((p) => p.overall).sort((a, b) => b - a).slice(0, 18);
  return {
    squadMean: best.reduce((a, b) => a + b, 0) / best.length,
    valueScale: med(main.filter((p) => p.value > 0).map((p) => p.value / valueCurve(p.age, p.overall, p.potential))) || undefined,
    wageScale: med(main.filter((p) => p.wage > 0).map((p) => p.wage / monthlyWage(p.age, p.overall, rep))) || undefined,
  };
}

/**
 * (18/11) Duas características, como os jogadores reais do banco (sempre 2): goleiro só as de goleiro (0–3); na linha,
 * sorteio ponderado pela posição (zagueiro: cabeceio/desarme/marcação; atacante: finalização/drible/velocidade…).
 */
const TRAIT_WEIGHTS: Record<Exclude<Position, 'GK'>, Record<number, number>> = {
  // 4 Armação · 5 Cabeceio · 6 Cruzamento · 7 Desarme · 8 Drible · 9 Finalização · 10 Marcação · 11 Passe · 12 Resistência · 13 Velocidade
  CB: { 5: 5, 7: 5, 10: 5, 11: 2, 12: 2, 13: 1 },
  FB: { 6: 5, 13: 4, 7: 3, 10: 3, 12: 3, 8: 2 },
  MF: { 4: 5, 11: 5, 8: 3, 7: 3, 12: 3, 9: 2, 13: 1 },
  FW: { 9: 6, 8: 4, 13: 4, 5: 3, 4: 2 },
};

export function rollTraits(position: Position, rng: Rng): number[] {
  if (position === 'GK') {
    const a = rng.int(0, 3);
    let b = rng.int(0, 2);
    if (b >= a) b++;
    return [a, b];
  }
  const w = TRAIT_WEIGHTS[position];
  const ids = Object.keys(w).map(Number);
  const out: number[] = [];
  while (out.length < 2) {
    const left = ids.filter((id) => !out.includes(id));
    const i = rng.weightedIndex(left.map((id) => w[id]));
    out.push(left[i < 0 ? 0 : i]);
  }
  return out;
}

/** Gera um júnior (17–18 anos). */
export function generateYouthPlayer(s: YouthSpec): Player {
  const r = s.rng;
  const age = r.int(YOUTH.minAge, YOUTH.maxAge);
  // squadMean ≈ média dos 18 melhores; squadTarget é a média do elenco todo (≈ 1,5 abaixo)
  const T = s.squadMean !== undefined ? s.squadMean - 1.5 : squadTarget(s.clubLevel, s.clubReputation);
  const overall = Math.round(clamp(T - YOUTH.offset + (r.next() * 2 - 1) * YOUTH.spread, 25, 80));
  let potential = Math.round(overall + growthGap(age) + r.normal() * YOUTH.potentialSd);
  const promise = r.chance(YOUTH.worldPromise);
  if (promise) potential = r.int(YOUTH.promise[0], YOUTH.promise[1]);
  potential = clamp(Math.max(potential, overall + 2), 1, 99);
  const traits = rollTraits(s.position, r);
  return {
    id: s.id,
    name: randomName(s.pool, r, s.brazilStyle),
    position: s.position,
    age,
    nationalityId: s.nationalityId,
    side: r.chance(0.25) ? 'L' : 'R',
    traits,
    star: false,
    highlight: promise,
    worldClass: false,
    overall,
    potential,
    wage: Math.max(300, roundMoney(monthlyWage(age, overall, s.clubReputation) * clamp(s.wageScale ?? 1, 0.2, 5))),
    value: s.valueScale !== undefined
      ? Math.max(10_000, roundMoney(valueCurve(age, overall, potential) * clamp(s.valueScale, 0.05, 10)))
      : marketValue(age, overall, potential, s.clubReputation),
    youth: true,
    tmId: null,
  };
}
