/**
 * Coeficientes e tabelas do modelo de partida (calibrados por scripts/calibrate.ts).
 */
import type { Mentality, Passing, Pressing, SlotRole, Tempo } from '../contract';
import { formationSlotsRef } from '../tactics';

export const COEF = {
  /** pontos de rating somados a todos os setores do mandante */
  homeAdv: 4.3,
  /** pontos de rating por ponto de moral acima/abaixo de 50 */
  moralePerPoint: 0.035,
  /** logit de posse por ponto de diferença de meio-campo */
  kPoss: 0.025,
  /** prob. base de criar chance por minuto de posse */
  baseChance: 0.285,
  /** sensibilidade da criação de chances a (ataque − defesa) */
  kAtt: 0.016,
  /** prob. base de "chance clara" (xG alto) */
  bigChance: 0.13,
  kBig: 0.01,
  longShot: 0.3,
  /** xG por tipo de finalização: [mínimo, amplitude] */
  xgBig: [0.22, 0.25] as const,
  xgNormal: [0.04, 0.075] as const,
  xgLong: [0.02, 0.04] as const,
  /** jogador já amarelado: menos faltas e árbitro mais tolerante */
  bookedFoulMul: 0.35,
  bookedYellowMul: 0.45,
  /** finalizador / goleiro: efeito por ponto de overall em relação a 75 */
  finishK: 0.005,
  gkK: 0.005,
  /** escanteio "espontâneo" por minuto de posse */
  cornerPerMinute: 0.06,
  cornerHeaderShot: 0.3,
  offsideRate: 0.15,
  chanceLost: 0.12,
  /** faltas por minuto do time sem a bola */
  foulBase: 0.235,
  yellowPerFoul: 0.155,
  redPerFoul: 0.002,
  penaltyPerFoul: 0.012,
  dangerousFoul: 0.1,
  freeKickShot: 0.35,
  injuryPerMinute: 0.0011,
  /** perda de stamina por minuto (base) */
  staminaDrain: 0.3,
  /** força do momentum na posse */
  momentumPoss: 0.25,
  penaltyConv: 0.77,
};

/** Contribuição do papel tático para defesa/meio/ataque. */
export const ROLE_W: Record<SlotRole, { def: number; mid: number; att: number }> = {
  GK: { def: 0, mid: 0, att: 0 },
  CB: { def: 1.0, mid: 0.1, att: 0.02 },
  LB: { def: 0.8, mid: 0.3, att: 0.15 },
  RB: { def: 0.8, mid: 0.3, att: 0.15 },
  LWB: { def: 0.6, mid: 0.45, att: 0.25 },
  RWB: { def: 0.6, mid: 0.45, att: 0.25 },
  DM: { def: 0.5, mid: 0.8, att: 0.1 },
  CM: { def: 0.25, mid: 1.0, att: 0.3 },
  LM: { def: 0.15, mid: 0.8, att: 0.45 },
  RM: { def: 0.15, mid: 0.8, att: 0.45 },
  AM: { def: 0.05, mid: 0.7, att: 0.7 },
  LW: { def: 0.05, mid: 0.35, att: 0.9 },
  RW: { def: 0.05, mid: 0.35, att: 0.9 },
  ST: { def: 0.02, mid: 0.15, att: 1.0 },
};

function norm(): { def: number; mid: number; att: number } {
  const n = { def: 0, mid: 0, att: 0 };
  for (const s of formationSlotsRef('4-4-2')) {
    const w = ROLE_W[s.role];
    n.def += w.def; n.mid += w.mid; n.att += w.att;
  }
  return n;
}
/** normalizadores (soma de pesos do 4-4-2) — formações diferentes deslocam força entre setores */
export const NORM = norm();

/** peso para ser o finalizador */
export const SHOOT_W: Record<SlotRole, number> = {
  GK: 0, CB: 0.07, LB: 0.06, RB: 0.06, LWB: 0.1, RWB: 0.1, DM: 0.1, CM: 0.25,
  LM: 0.35, RM: 0.35, AM: 0.55, LW: 0.7, RW: 0.7, ST: 1.0,
};
/** peso para cabeceio em bola parada */
export const HEAD_W: Record<SlotRole, number> = {
  GK: 0, CB: 1.0, LB: 0.2, RB: 0.2, LWB: 0.2, RWB: 0.2, DM: 0.45, CM: 0.35,
  LM: 0.2, RM: 0.2, AM: 0.3, LW: 0.3, RW: 0.3, ST: 1.0,
};
export const ASSIST_W: Record<SlotRole, number> = {
  GK: 0.01, CB: 0.1, LB: 0.35, RB: 0.35, LWB: 0.5, RWB: 0.5, DM: 0.35, CM: 0.7,
  LM: 0.8, RM: 0.8, AM: 1.0, LW: 0.8, RW: 0.8, ST: 0.5,
};
export const FOUL_W: Record<SlotRole, number> = {
  GK: 0.05, CB: 1.0, LB: 0.9, RB: 0.9, LWB: 0.85, RWB: 0.85, DM: 1.2, CM: 0.8,
  LM: 0.6, RM: 0.6, AM: 0.5, LW: 0.45, RW: 0.45, ST: 0.45,
};

export const MENTALITY_IDX: Record<Mentality, number> = {
  'ultra-defensive': 0, defensive: 1, balanced: 2, attacking: 3, 'all-out': 4,
};
export const MENTALITIES: Mentality[] = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'all-out'];
/** multiplicador das chances próprias */
export const MENT_ATT = [0.72, 0.86, 1, 1.13, 1.27];
/** multiplicador das chances do adversário */
export const MENT_OPP = [0.78, 0.89, 1, 1.09, 1.22];
export const MENT_POSS = [-0.15, -0.07, 0, 0.05, 0.08];

export const TEMPO_ATT: Record<Tempo, number> = { slow: 0.92, normal: 1, fast: 1.08 };
export const TEMPO_OPP: Record<Tempo, number> = { slow: 0.95, normal: 1, fast: 1.05 };
export const TEMPO_POSS: Record<Tempo, number> = { slow: 0.05, normal: 0, fast: -0.05 };
/** (Atualização 38) rápido 1.15 → 1.1 */
export const TEMPO_DRAIN: Record<Tempo, number> = { slow: 0.9, normal: 1, fast: 1.1 };

export const PRESS_OPP: Record<Pressing, number> = { low: 1.03, medium: 1, high: 0.96 };
export const PRESS_POSS: Record<Pressing, number> = { low: -0.1, medium: 0, high: 0.1 };
export const PRESS_FOUL: Record<Pressing, number> = { low: 0.82, medium: 1, high: 1.22 };
/** (Atualização 38) pressão alta 1.2 → 1.12 */
export const PRESS_DRAIN: Record<Pressing, number> = { low: 0.88, medium: 1, high: 1.12 };

export const PASS_ATT: Record<Passing, number> = { short: 0.95, mixed: 1, direct: 1.08 };
export const PASS_POSS: Record<Passing, number> = { short: 0.15, mixed: 0, direct: -0.15 };
/** desloca a probabilidade de chance clara / chute de longe */
export const PASS_BIG: Record<Passing, number> = { short: 1.12, mixed: 1, direct: 0.92 };
export const PASS_OFFSIDE: Record<Passing, number> = { short: 0.8, mixed: 1, direct: 1.45 };
export const PASS_VOLUME: Record<Passing, number> = { short: 1.3, mixed: 1, direct: 0.72 };

/**
 * (Atualização 38) Curva de stamina. Medido antes (300 jogos, elenco sintético 74–76):
 * fim dos 90' com tática normal 77,5% (rápido+pressão alta 68,7%, p10 64%), recuperação de +9/dia fixa.
 * Agora: sem o "bônus" do intervalo (+4), multiplicadores extremos mais brandos (ritmo rápido, pressão alta,
 * prorrogação, veteranos) e recuperação diária que cresce com o cansaço — ver `dailyRecovery`.
 */
export const STAMINA = {
  /** stamina recuperada no intervalo (antes +4) */
  halfTime: 0,
  /** stamina recuperada antes da prorrogação (antes +2) */
  extraTimeBreak: 1,
  /** multiplicador da perda na prorrogação (antes 1.15) */
  extraTimeDrain: 1.05,
  /** multiplicador de veteranos (≥ 32 anos; antes 1.12) e jovens (≤ 22) */
  veteranDrain: 1.08,
  youngDrain: 0.94,
  /** goleiro perde 30% do ritmo de um jogador de linha */
  gkDrain: 0.3,
  /** recuperação diária: base + fração do que falta para 100 (antes +9 fixo) */
  recoverBase: 6,
  recoverFrac: 0.12,
};

/**
 * (Atualização 38) Recuperação de um dia (entre jogos). Cresce com o cansaço: de 73% → 81 → 88 → 95 → 100;
 * jogando a cada 3 dias por um mês, o XI cai devagar (início ~100 → ~88) sem chegar à exaustão.
 */
export function dailyRecovery(f: number): number {
  const v = f + STAMINA.recoverBase + STAMINA.recoverFrac * Math.max(0, 100 - f);
  return v >= 100 ? 100 : Math.round(v * 10) / 10;
}

/**
 * fator de rendimento pela stamina (0..100). (Atualização 38) Começa a pesar em 85 (antes 88) e é mais brando
 * na faixa 50–85 (−0,6%/ponto); abaixo de 40 o cansaço pesa em dobro (queda severa abaixo de 25).
 */
export function staminaFactor(st: number): number {
  if (st >= 85) return 1;
  return 1 - (85 - st) * 0.006 - Math.max(0, 40 - st) * 0.006;
}
