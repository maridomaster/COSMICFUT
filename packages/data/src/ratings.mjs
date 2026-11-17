// Atributos derivados: overall, potencial, salário e valor de mercado.
// O jogo original não armazena nenhum deles; ver packages/data/README.md para a explicação.
// Tudo é determinístico: o RNG é semeado pelo id estável do jogador.
import { rngFor, clamp, roundMoney } from './util.mjs';

/** Média-alvo do elenco principal para um clube (nível 1..24, reputação 0..5). */
export function squadTarget(level, reputation) {
  const L = clamp(level || 1, 1, 24);
  return 47 + (L - 1) * (37 / 23) + 0.4 * ((reputation ?? 2.5) - 2.5);
}

/** Ajuste de overall pela idade (pico entre 24 e 29). */
export function ageAdjust(age) {
  if (age <= 17) return -9;
  const table = { 18: -7, 19: -5, 20: -3.5, 21: -2, 22: -1, 23: 0, 24: 0.5, 25: 0.5, 26: 0.5, 27: 0.5, 28: 0.5, 29: 0.5, 30: 0, 31: -0.5, 32: -1.5, 33: -2.5, 34: -3.5 };
  if (age in table) return table[age];
  return -4.5 - (age - 35) * 1.2; // 35+
}

/** Margem de evolução restante pela idade. */
export function growthGap(age) {
  const table = { 15: 22, 16: 20, 17: 18, 18: 16, 19: 14, 20: 12, 21: 10, 22: 8, 23: 6, 24: 4, 25: 3, 26: 2, 27: 1 };
  if (age < 15) return 22;
  return table[age] ?? 0;
}

const hashNorm = (h) => clamp(Number.isFinite(h) ? h : 5, 0, 10);

/**
 * Calcula overall/potential/wage/value para todos os jogadores de um clube.
 * @param club  { level, reputation }
 * @param squad  jogadores brutos do elenco (lista `l`) com `id` já atribuído
 * @param youth  jogadores brutos da base (lista `m`)
 * @returns Map id -> { overall, potential, wage, value }
 */
export function rateClub(club, squad, youth) {
  const T = squadTarget(club.level, club.reputation);
  const out = new Map();

  // 1) score bruto do elenco principal
  const raw = squad.map((p) => {
    const rnd = rngFor('ovr:' + p.id);
    const h = hashNorm(p.hash);
    let r = (h - 5) * 1.0;
    r += p.highlight ? 3 : -2;
    if (p.star) r += 5;
    r += ageAdjust(p.age);
    r += (rnd() - 0.5) * 4; // ruído ±2
    return r;
  });
  const meanRaw = raw.length ? raw.reduce((a, b) => a + b, 0) / raw.length : 0;

  squad.forEach((p, i) => {
    const rnd = rngFor('wc:' + p.id);
    let ovr = T + (raw[i] - meanRaw);
    ovr = clamp(ovr, 30, p.star ? 92 : 89);
    if (p.worldClass) {
      // elite mundial: faixa 88–95
      const wc = 88 + hashNorm(p.hash) * 0.45 + (p.star ? 1 : 0) + rnd() * 1.5 + Math.max(0, (club.level - 20) * 0.3);
      ovr = clamp(Math.max(ovr, wc), 88, 95);
    }
    if (Number.isFinite(p.hash) && p.hash > 10) {
      // arquivos editados: hash 11..99 é interpretado como overall explícito
      ovr = clamp(p.hash, 30, 95);
    }
    out.set(p.id, finish(p, Math.round(ovr), club));
  });

  // 2) base (lista `m`): não recentrada; ~14 abaixo do alvo do elenco
  for (const p of youth) {
    const rnd = rngFor('ovr:' + p.id);
    const h = hashNorm(p.hash);
    let ovr = T - 14 + (h - 5) * 0.8 + (p.highlight ? 2 : 0) + (p.star ? 4 : 0) + (p.age - 17) * 1.5 + (rnd() - 0.5) * 4;
    ovr = clamp(ovr, 25, 80);
    if (Number.isFinite(p.hash) && p.hash > 10) ovr = clamp(p.hash, 25, 95);
    out.set(p.id, finish(p, Math.round(ovr), club));
  }
  return out;
}

function finish(p, overall, club) {
  const rnd = rngFor('pot:' + p.id);
  const h = hashNorm(p.hash);
  const gap = growthGap(p.age) * (0.6 + 0.4 * (h / 10) + (rnd() - 0.5) * 0.3)
    + (p.star && p.age < 27 ? 3 : 0) + (p.highlight && p.age < 23 ? 2 : 0) + (p.worldClass && p.age < 24 ? 2 : 0);
  const potential = clamp(Math.round(overall + Math.max(0, gap)), overall, 97);
  return { overall, potential, value: marketValue(p.age, overall, potential, club.reputation), wage: monthlyWage(p.age, overall, club.reputation) };
}

/** Valor de mercado (moeda do jogo). */
export function marketValue(age, ovr, pot, rep = 2) {
  const eff = age <= 23 ? ovr + (pot - ovr) * 0.35 : ovr;
  const base = 2_000_000 * Math.exp((eff - 70) * 0.17);
  let ageMult;
  if (age <= 20) ageMult = 1.1;
  else if (age <= 27) ageMult = 1.0;
  else if (age <= 29) ageMult = 0.9;
  else if (age === 30) ageMult = 0.75;
  else if (age === 31) ageMult = 0.6;
  else if (age === 32) ageMult = 0.48;
  else if (age === 33) ageMult = 0.38;
  else ageMult = 0.3 * Math.pow(0.8, age - 34);
  const repMult = 0.75 + 0.1 * clamp(rep ?? 2, 0, 5);
  return Math.max(10_000, roundMoney(base * ageMult * repMult));
}

/** Salário mensal (moeda do jogo). */
export function monthlyWage(age, ovr, rep = 2) {
  const base = 12_000 * Math.exp((ovr - 70) * 0.14);
  const ageMult = age <= 20 ? 0.5 : age <= 22 ? 0.75 : 1;
  const repMult = 0.7 + 0.12 * clamp(rep ?? 2, 0, 5);
  return Math.max(300, roundMoney(base * ageMult * repMult));
}
