/**
 * (Premiação) Tabela de prêmios de uma competição para a tela de Competições: quanto se ganha em cada fase (copas e
 * continentais: participação, por jogo, por fase alcançada e título), por posição (ligas com premiação por mérito) ou
 * só o campeão (prêmio do original). Marca o que o clube já recebeu. Mesmas regras que `advanceDay` paga
 * (season.ts: `payPhasePrizes`, `matchBonus`, mérito por posição, prêmio do campeão).
 */
import type { Competition, SeasonState } from '../contract';
import { meritAt, PHASE_LABEL, prizeScheduleOf } from './econ';
import { finalRanking } from './format';
import { leaguePrize } from './economy';

export interface PrizeRow {
  key: string;
  label: string;
  value: number;
  /** o clube já recebeu (fases) / é a posição atual dele (mérito) */
  mine?: boolean;
}

export interface PrizeTableView {
  /** 'phases' = por fase alcançada · 'merit' = por posição final · 'champion' = só o campeão · 'none' = sem prêmio */
  kind: 'phases' | 'merit' | 'champion' | 'none';
  rows: PrizeRow[];
  /** bônus por jogo na fase de liga/grupos */
  perMatch?: { win?: number; draw?: number };
  /** total já recebido pelo clube (fases; sem os bônus por jogo) */
  earned: number;
  /** posição atual do clube (mérito / proporcional) */
  position?: number;
}

const ORDER = ['q1', 'q2', 'q3', 'q4', 'playoff', 'groups', 'r128', 'r64', 'r32', 'r16', 'qf', 'sf', 'final'];

const REACH_LABEL: Record<string, string> = {
  q1: 'Chegar à 1ª fase', q2: 'Chegar à 2ª fase', q3: 'Chegar à 3ª fase', q4: 'Chegar à 4ª fase', playoff: 'Chegar ao playoff',
  groups: 'Fase de liga / grupos', r128: 'Chegar aos 128-avos', r64: 'Chegar aos 64-avos', r32: 'Chegar aos 16-avos',
  r16: 'Chegar às oitavas de final', qf: 'Chegar às quartas de final', sf: 'Chegar à semifinal', final: 'Chegar à final',
};
const reachLabel = (k: string) => REACH_LABEL[k] ?? `Chegar: ${PHASE_LABEL[k] ?? k}`;

export function prizeTable(state: SeasonState, comp: Competition, clubId: string): PrizeTableView {
  const econ = state.career?.econ;
  const merit = econ?.merit[comp.id];
  const sched = prizeScheduleOf(econ, comp);
  const rank = () => {
    try {
      return finalRanking(comp);
    } catch {
      return [] as string[];
    }
  };
  if (econ && merit) {
    const pos = rank().indexOf(clubId) + 1 || undefined;
    const rows: PrizeRow[] = [];
    for (let p = 1; p <= merit.paid; p++) rows.push({ key: `pos${p}`, label: `${p}º lugar`, value: meritAt(merit, p), mine: p === pos });
    return { kind: 'merit', rows, earned: comp.finished && pos ? meritAt(merit, pos) : 0, ...(pos ? { position: pos } : {}) };
  }
  if (econ && sched) {
    const paid = new Set(comp.paid ?? []);
    const rows: PrizeRow[] = [];
    let earned = 0;
    const push = (key: string, label: string, value: number | undefined, got: boolean) => {
      if (!value || value <= 0) return;
      rows.push({ key, label, value, mine: got });
      if (got) earned += value;
    };
    push('participation', 'Participação', sched.participation, paid.has(`participation:${clubId}`));
    const keys = Object.keys(sched.reach ?? {}).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    for (const k of keys) push(k, reachLabel(k), sched.reach![k], paid.has(`${k}:${clubId}`));
    push('champion', 'Título (bônus do campeão)', sched.champion, comp.championId === clubId);
    const perMatch = sched.win || sched.draw ? { ...(sched.win ? { win: sched.win } : {}), ...(sched.draw ? { draw: sched.draw } : {}) } : undefined;
    return { kind: rows.length || perMatch ? 'phases' : 'none', rows, earned, ...(perMatch ? { perMatch } : {}) };
  }
  const mode = state.career?.prizeMode ?? 'champion';
  if (mode === 'champion') {
    let v = (comp.prizeKey && state.career?.prizes[comp.prizeKey]) || 0;
    // estaduais com economia real: o prêmio do original vale para os grandes; nos demais, até 2% da receita
    const R = state.clubInfo?.[clubId]?.revenue;
    if (econ && comp.type === 'state' && R) v = Math.min(v, Math.round(0.02 * R));
    if (!v) return { kind: 'none', rows: [], earned: 0 };
    return { kind: 'champion', rows: [{ key: 'champion', label: 'Campeão', value: v, mine: comp.championId === clubId }], earned: comp.championId === clubId ? v : 0 };
  }
  const order = rank();
  const pos = order.indexOf(clubId) + 1 || undefined;
  const rows = order.map((_, i) => ({ key: `pos${i + 1}`, label: `${i + 1}º lugar`, value: leaguePrize(comp.division, i + 1, order.length), mine: i + 1 === pos }));
  return { kind: rows.length ? 'merit' : 'none', rows, earned: 0, ...(pos ? { position: pos } : {}) };
}
