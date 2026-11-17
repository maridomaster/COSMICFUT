/**
 * Simulação LEVE (Fase 1) para jogos sem humano entre clubes pequenos (estaduais), opcional.
 * Poisson pela média dos 11 melhores disponíveis; ~50× mais rápida que quickSimulate e
 * calibrada para a mesma média de gols (≈2,6) e vantagem de mando (≈45/27/28).
 * Não gera cartões nem lesões. Determinística pela seed.
 */
import type { Player } from '@cosmicfut/shared';
import type { MatchResult, Side, TeamLiveStats } from '../contract';
import { Rng } from '../rng';

export const LIGHT = { homeLambda: 1.42, awayLambda: 1.12, k: 0.058, neutralLambda: 1.27 };
/** (Registros) Assistências na simulação leve: taxa de gols com passe e peso por posição (× overall). */
export const LIGHT_ASSIST = { rate: 0.72, pos: { GK: 0.05, CB: 0.6, FB: 2, MF: 4, FW: 2.5 } as Record<string, number> };
/** Peso do overall na escolha de artilheiro/assistente: (ovr/70)^3 — um 85 pesa ~1,8× um 70. */
const ovrWeight = (ovr: number) => Math.pow(Math.max(30, ovr) / 70, 3);

function poisson(lambda: number, rng: Rng): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 12);
  return k - 1;
}

function top11(players: Player[], unavailable?: Set<string>): Player[] {
  const avail = players.filter((p) => !unavailable?.has(p.id));
  const gk = avail.filter((p) => p.position === 'GK').sort((a, b) => b.overall - a.overall)[0];
  const rest = avail.filter((p) => p !== gk).sort((a, b) => b.overall - a.overall).slice(0, gk ? 10 : 11);
  return gk ? [gk, ...rest] : rest;
}

const emptyStats = (goals: number): TeamLiveStats => ({
  goals, shots: goals * 3 + 6, shotsOnTarget: goals + 3, possession: 50, corners: 4, fouls: 12, yellows: 0, reds: 0,
  offsides: 2, xg: goals * 0.8 + 0.4, passesCompleted: 300, subsUsed: 0,
});

export interface LightTeam {
  clubId: string;
  players: Player[];
  unavailable?: Set<string>;
  capacity?: number;
  reputation?: number;
}

export function lightSimulate(seed: string, home: LightTeam, away: LightTeam, opts: { knockout?: boolean; aggregate?: { home: number; away: number }; neutral?: boolean } = {}): MatchResult {
  const rng = new Rng(seed + ':light');
  const h = top11(home.players, home.unavailable), a = top11(away.players, away.unavailable);
  const avg = (xs: Player[]) => (xs.length ? xs.reduce((s, p) => s + p.overall, 0) / xs.length : 40);
  const d = avg(h) - avg(a);
  const lh = (opts.neutral ? LIGHT.neutralLambda : LIGHT.homeLambda) * Math.exp(LIGHT.k * d);
  const la = (opts.neutral ? LIGHT.neutralLambda : LIGHT.awayLambda) * Math.exp(-LIGHT.k * d);
  const hg = poisson(lh, rng), ag = poisson(la, rng);
  const scorers: MatchResult['scorers'] = [];
  const pickScorer = (xs: Player[]) => {
    // (Registros) posição × overall (só os 11 titulares jogam na simulação leve): artilharias realistas
    const w = xs.map((p) => (p.position === 'FW' ? 5 : p.position === 'MF' ? 2.5 : p.position === 'GK' ? 0 : 0.7) * ovrWeight(p.overall));
    const i = rng.weightedIndex(w);
    return xs[Math.max(0, i)];
  };
  for (const [side, n, xs] of [['home', hg, h], ['away', ag, a]] as [Side, number, Player[]][]) {
    for (let k = 0; k < n; k++) {
      const p = pickScorer(xs);
      if (p) scorers.push({ side, playerId: p.id, minute: rng.int(1, 90) });
    }
  }
  scorers.sort((x, y) => x.minute - y.minute);
  // (Registros) assistências: RNG próprio (não muda placar, artilheiros nem o resto do jogo); ~72% dos gols têm passe
  if (scorers.length) {
    const ar = new Rng(seed + ':light:ast');
    for (const s of scorers) {
      if (!ar.chance(LIGHT_ASSIST.rate)) continue;
      const xs = s.side === 'home' ? h : a;
      const w = xs.map((p) => (p.id === s.playerId ? 0 : (LIGHT_ASSIST.pos[p.position] ?? 1) * ovrWeight(p.overall)));
      const i = ar.weightedIndex(w);
      if (i >= 0 && w[i] > 0) s.assistId = xs[i].id;
    }
  }
  let winner: Side | 'draw' = hg > ag ? 'home' : ag > hg ? 'away' : 'draw';
  let penalties: { home: number; away: number } | undefined;
  const aggregate = opts.aggregate ? { home: opts.aggregate.home + hg, away: opts.aggregate.away + ag } : undefined;
  const aggDraw = aggregate ? aggregate.home === aggregate.away : hg === ag;
  // mata-mata: winner = quem avança (agregado → pênaltis), como em MatchSimulation.result()
  if (opts.knockout && aggregate && !aggDraw) winner = aggregate.home > aggregate.away ? 'home' : 'away';
  if (opts.knockout && aggDraw) {
    const homeWins = rng.chance(0.5 + Math.max(-0.1, Math.min(0.1, d * 0.01)));
    const lo = rng.int(2, 4);
    penalties = homeWins ? { home: lo + 1, away: lo } : { home: lo, away: lo + 1 };
    winner = homeWins ? 'home' : 'away';
  }
  const advancing: Side | undefined = opts.knockout && winner !== 'draw' ? winner : undefined;
  const ratings: Record<string, number> = {};
  for (const p of h) ratings[p.id] = Math.round((6.4 + (hg - ag) * 0.15 + (rng.next() - 0.5) * 0.6) * 10) / 10;
  for (const p of a) ratings[p.id] = Math.round((6.4 + (ag - hg) * 0.15 + (rng.next() - 0.5) * 0.6) * 10) / 10;
  for (const s of scorers) ratings[s.playerId] = (ratings[s.playerId] ?? 6.5) + 0.8;
  // (Fase 2) desgaste físico equivalente ao da partida completa (~0,3/min: linha ≈ 76, goleiro ≈ 92), sem RNG:
  // sem isso, clubes simulados em modo leve chegavam sempre descansados aos jogos completos (continentais)
  const fitnessAfter: Record<string, number> = {};
  for (const p of [...h, ...a]) fitnessAfter[p.id] = p.position === 'GK' ? 92 : p.age >= 32 ? 73 : 76;
  const cap = home.capacity ?? 8000;
  const attendance = Math.round(cap * Math.min(0.95, 0.3 + 0.08 * (home.reputation ?? 2) + rng.next() * 0.1));
  return {
    homeGoals: hg, awayGoals: ag, penalties, winner, ...(aggregate ? { aggregate } : {}), ...(advancing ? { advancing } : {}), scorers, cards: [], injuries: [], ratings,
    stats: { home: emptyStats(hg), away: emptyStats(ag) }, attendance,
    appearances: { home: h.map((p) => p.id), away: a.map((p) => p.id) },
    fitnessAfter,
  };
}
