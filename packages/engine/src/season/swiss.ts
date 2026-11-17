/**
 * (Etapa 2) "Modelo suíço" das fases de liga da UEFA (Liga dos Campeões, Liga Europa, Conferência) e da AFC Elite.
 *
 * Sorteio (`swissDraw`): os participantes (em ordem de semente) formam `pots` potes iguais.
 *  - perPot 2 (UCL/UEL: 4 potes de 9, 8 jogos; AFC: 4 potes de 3 por região, 8 jogos): cada clube enfrenta 2 clubes
 *    de CADA pote, um em casa e um fora:
 *      · no próprio pote, um ciclo (a recebe o seguinte e visita o anterior);
 *      · entre os potes i < j, duas permutações σ e τ (σ(a) ≠ τ(a)): a recebe σ(a) e visita τ(a) — cada clube de j
 *        também fica com um jogo em casa e um fora contra o pote i.
 *    ⇒ 8 adversários diferentes, 4 em casa e 4 fora.
 *  - perPot 1 (UECL: 6 potes de 6, 6 jogos): um adversário de cada pote (emparelhamento perfeito dentro do pote e
 *    entre cada par de potes); mando por orientação euleriana (cada clube 3 em casa e 3 fora).
 *  Restrição de país: evita adversários do mesmo país (sorteio com retrocesso; se for impossível, aceita).
 *
 * Rodadas (`scheduleRounds`): os jogos são repartidos em R rodadas (R = nº de jogos por clube), cada clube uma vez
 * por rodada — busca em profundidade de um emparelhamento perfeito por rodada (clube com menos opções primeiro),
 * reiniciada com outra ordem quando uma rodada não fecha. Determinístico (Rng da competição).
 */
import { Rng } from '../rng';

export type SwissPair = [home: string, away: string];

/** Permutação a → b (A e B do mesmo tamanho) evitando `bad(a, b)`; retrocesso com ordem aleatória. null = impossível. */
function drawPerm(A: string[], B: string[], bad: (a: string, b: string, k: number) => boolean, rng: Rng, budget = 4000): string[] | null {
  const out: string[] = new Array(A.length);
  const used = new Set<string>();
  let nodes = 0;
  const order = rng.shuffle(A.map((_, i) => i));
  const dfs = (d: number): boolean => {
    if (d === order.length) return true;
    if (++nodes > budget) return false;
    const k = order[d];
    for (const b of rng.shuffle(B)) {
      if (used.has(b) || bad(A[k], b, k)) continue;
      used.add(b); out[k] = b;
      if (dfs(d + 1)) return true;
      used.delete(b);
    }
    return false;
  };
  return dfs(0) ? out : null;
}

/** Ciclo (ordem circular) do pote evitando vizinhos do mesmo país. */
function drawCycle(pot: string[], same: (a: string, b: string) => boolean, rng: Rng): string[] {
  let best = rng.shuffle(pot), bestBad = Infinity;
  for (let t = 0; t < 200; t++) {
    const c = t === 0 ? best : rng.shuffle(pot);
    let bad = 0;
    for (let k = 0; k < c.length; k++) if (same(c[k], c[(k + 1) % c.length])) bad++;
    if (bad < bestBad) { best = c; bestBad = bad; }
    if (!bad) break;
  }
  return best;
}

/** Emparelhamento perfeito dentro de um pote (tamanho par) evitando o mesmo país. */
function drawMatching(pot: string[], same: (a: string, b: string) => boolean, rng: Rng): [string, string][] {
  let best: [string, string][] = [], bestBad = Infinity;
  for (let t = 0; t < 200; t++) {
    const s = rng.shuffle(pot);
    const m: [string, string][] = [];
    let bad = 0;
    for (let k = 0; k + 1 < s.length; k += 2) { m.push([s[k], s[k + 1]]); if (same(s[k], s[k + 1])) bad++; }
    if (bad < bestBad) { best = m; bestBad = bad; }
    if (!bad) break;
  }
  return best;
}

/** Orienta as arestas de um grafo de graus pares (circuito de Euler por componente): em casa = fora em cada vértice. */
export function eulerOrient(edges: [string, string][]): SwissPair[] {
  const adj = new Map<string, number[]>();
  edges.forEach(([a, b], i) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(i);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const out: SwissPair[] = new Array(edges.length);
  const ptr = new Map<string, number>();
  for (const start of [...adj.keys()].sort()) {
    // Hierholzer iterativo: cada aresta é orientada no sentido em que é percorrida
    const stack: string[] = [start];
    while (stack.length) {
      const v = stack[stack.length - 1];
      const list = adj.get(v)!;
      let p = ptr.get(v) ?? 0;
      while (p < list.length && used[list[p]]) p++;
      ptr.set(v, p);
      if (p === list.length) { stack.pop(); continue; }
      const i = list[p];
      used[i] = true;
      const [a, b] = edges[i];
      const w = a === v ? b : a;
      out[i] = [v, w];
      stack.push(w);
    }
  }
  return out;
}

/**
 * Sorteio da fase de liga. `seeds` em ordem de semente (pote 1 primeiro). Retorna os jogos [mandante, visitante] ou
 * null se os potes não forem válidos (nº de clubes não divisível, pote pequeno demais).
 */
export function swissDraw(seeds: string[], pots: number, perPot: 1 | 2, rng: Rng, countryOf?: (id: string) => number | undefined): SwissPair[] | null {
  const n = seeds.length;
  if (pots < 1 || n % pots !== 0) return null;
  const size = n / pots;
  if ((perPot === 2 && size < 3) || (perPot === 1 && size % 2 !== 0)) return null;
  const P = Array.from({ length: pots }, (_, i) => seeds.slice(i * size, (i + 1) * size));
  const same = (a: string, b: string) => {
    const x = countryOf?.(a);
    return x !== undefined && x === countryOf?.(b);
  };
  const pairs: SwissPair[] = [];
  if (perPot === 2) {
    for (const pot of P) {
      const c = drawCycle(pot, same, rng);
      for (let k = 0; k < c.length; k++) pairs.push([c[k], c[(k + 1) % c.length]]);
    }
    for (let i = 0; i < pots; i++) {
      for (let j = i + 1; j < pots; j++) {
        const A = P[i], B = P[j];
        const sigma = drawPerm(A, B, (a, b) => same(a, b), rng) ?? drawPerm(A, B, () => false, rng)!;
        const tau = drawPerm(A, B, (a, b, k) => b === sigma[k] || same(a, b), rng) ?? drawPerm(A, B, (_a, b, k) => b === sigma[k], rng)!;
        A.forEach((a, k) => { pairs.push([a, sigma[k]]); pairs.push([tau[k], a]); });
      }
    }
    return pairs;
  }
  const edges: [string, string][] = [];
  for (const pot of P) edges.push(...drawMatching(pot, same, rng));
  for (let i = 0; i < pots; i++) {
    for (let j = i + 1; j < pots; j++) {
      const sigma = drawPerm(P[i], P[j], (a, b) => same(a, b), rng) ?? drawPerm(P[i], P[j], () => false, rng)!;
      P[i].forEach((a, k) => edges.push(rng.chance(0.5) ? [a, sigma[k]] : [sigma[k], a]));
    }
  }
  return eulerOrient(edges);
}

/**
 * Reparte os jogos em `R` rodadas, cada clube exatamente uma vez por rodada (grafo R-regular). null = não conseguiu
 * (o chamador sorteia de novo).
 */
export function scheduleRounds(pairs: SwissPair[], R: number, rng: Rng, attempts = 300): SwissPair[][] | null {
  const teams = [...new Set(pairs.flat())];
  for (let attempt = 0; attempt < attempts; attempt++) {
    let rem = pairs.map((_, i) => i);
    const rounds: SwissPair[][] = [];
    let ok = true;
    for (let rd = 0; rd < R && ok; rd++) {
      const adj = new Map<string, number[]>();
      for (const i of rem) for (const v of pairs[i]) (adj.get(v) ?? adj.set(v, []).get(v)!).push(i);
      const used = new Set<string>();
      const pick: number[] = [];
      let nodes = 0;
      const dfs = (): boolean => {
        if (++nodes > 20000) return false;
        let bo: number[] | null = null;
        for (const v of teams) {
          if (used.has(v)) continue;
          const o = (adj.get(v) ?? []).filter((i) => !used.has(pairs[i][0]) && !used.has(pairs[i][1]));
          if (!bo || o.length < bo.length) { bo = o; if (!o.length) break; }
        }
        if (!bo) return true;
        if (!bo.length) return false;
        for (const i of rng.shuffle(bo)) {
          const [a, b] = pairs[i];
          used.add(a); used.add(b); pick.push(i);
          if (dfs()) return true;
          pick.pop(); used.delete(a); used.delete(b);
        }
        return false;
      };
      if (!dfs()) { ok = false; break; }
      rounds.push(pick.map((i) => pairs[i]));
      const ps = new Set(pick);
      rem = rem.filter((i) => !ps.has(i));
    }
    if (ok && !rem.length) return rounds;
  }
  return null;
}

/**
 * Sorteio + rodadas (tenta novos sorteios se as rodadas não fecharem). Último recurso: rodadas gulosas (pode
 * haver folga) — nunca lança erro.
 */
export function swissSchedule(seeds: string[], pots: number, perPot: 1 | 2, rng: Rng, countryOf?: (id: string) => number | undefined): SwissPair[][] | null {
  const R = pots * perPot;
  for (let t = 0; t < 20; t++) {
    const pairs = swissDraw(seeds, pots, perPot, rng, countryOf);
    if (!pairs) return null;
    const rounds = scheduleRounds(pairs, R, rng, 60);
    if (rounds) return rounds;
  }
  const pairs = swissDraw(seeds, pots, perPot, rng, countryOf)!;
  const rounds: SwissPair[][] = [];
  for (const p of pairs) {
    let r = rounds.find((x) => !x.some(([a, b]) => a === p[0] || b === p[0] || a === p[1] || b === p[1]));
    if (!r) rounds.push((r = []));
    r.push(p);
  }
  return rounds;
}
