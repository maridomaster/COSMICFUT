/**
 * (Treino) Centro de Treinamento dos clubes HUMANOS: até 3 jogadores do elenco em treino especial. Todo dia o treino
 * acumula progresso; a cada 1,0 de progresso o jogador ganha +1 de overall (até o potencial real pela idade). O ritmo
 * depende do quanto falta para o potencial e da idade (jovem evolui mais rápido; 30+ quase nada).
 *
 * Energia: treinar no DIA DO JOGO ou na VÉSPERA cansa (−12 e −8 de energia, depois da recuperação do dia). Longe dos
 * jogos o treino não gasta energia.
 *
 * Estado em `state.market.training` (vai junto no patch online do mercado e atravessa a virada). Determinístico.
 */
import type { Player } from '@cosmicfut/shared';
import type { SeasonState, TrainingState } from '../contract';
import type { MarketResult } from '../transfers/actions';
import { realisticPotential } from './players';
import { addDays } from './schedule';

export const TRAINING = {
  maxPlayers: 3,
  /** progresso por dia com o fator 1 (≈ +1 de overall a cada ~140 dias; jovem longe do potencial ~1 a cada 2 meses) — (25/11) antes 0,04 */
  perDay: 0.007,
  /** fator pelo que falta até o potencial: (pot − ovr) / gapRef, até gapCap */
  gapRef: 8,
  gapCap: 1.5,
  /** custo de energia: no dia do jogo e na véspera */
  matchDayCost: 12,
  eveCost: 8,
  /** energia mínima depois do custo do treino */
  floor: 40,
};

/** Fator de evolução pela idade. */
export function trainingAgeFactor(age: number): number {
  if (age <= 21) return 1.3;
  if (age <= 25) return 1;
  if (age <= 29) return 0.6;
  return 0.3;
}

/** Progresso por dia de um jogador (0 se já está no potencial). */
export function trainingRate(p: Pick<Player, 'age' | 'overall' | 'potential'>): number {
  const pot = realisticPotential(p.age, p.overall, p.potential);
  const gap = pot - p.overall;
  if (gap <= 0) return 0;
  return TRAINING.perDay * Math.min(TRAINING.gapCap, gap / TRAINING.gapRef) * trainingAgeFactor(p.age);
}

/** Dias até o próximo jogo do clube (0 = hoje; null = sem jogo marcado). */
export function daysToNextMatch(state: SeasonState, clubId: string): number | null {
  let best: string | null = null;
  for (const c of state.competitions) {
    for (const f of c.fixtures) {
      if (f.result || f.date < state.date || (f.homeId !== clubId && f.awayId !== clubId)) continue;
      if (!best || f.date < best) best = f.date;
    }
  }
  if (!best) return null;
  return Math.round((Date.parse(best + 'T00:00:00Z') - Date.parse(state.date + 'T00:00:00Z')) / 86400000);
}

/** Custo de energia do treino hoje para o clube (0 longe dos jogos). */
export function trainingCost(state: SeasonState, clubId: string): number {
  const d = daysToNextMatch(state, clubId);
  return d === 0 ? TRAINING.matchDayCost : d === 1 ? TRAINING.eveCost : 0;
}

/**
 * Dia de treino (chamado por `advanceDay` depois da recuperação física): progresso, +1 de overall ao completar e o
 * custo de energia perto dos jogos. Muta `state` (mercado e clubes já copiados no dia). Devolve as notícias.
 */
export function trainingDay(state: SeasonState, squads: (clubId: string) => readonly Player[]): { text: string; clubId: string }[] {
  const t = state.market?.training;
  const career = state.career;
  if (!t || !career) return [];
  const out: { text: string; clubId: string }[] = [];
  for (const clubId of state.humanClubIds) {
    const ts = t[clubId];
    if (!ts?.players.length) continue;
    const squad = squads(clubId);
    const club = state.clubs[clubId];
    // quem saiu do elenco deixa o treino
    ts.players = ts.players.filter((id) => squad.some((p) => p.id === id));
    const cost = trainingCost(state, clubId);
    for (const pid of ts.players) {
      const p = squad.find((x) => x.id === pid)!;
      if (club && cost > 0) {
        const f = club.fitness[pid] ?? 100;
        club.fitness[pid] = Math.max(TRAINING.floor, Math.round((f - cost) * 10) / 10);
      }
      const rate = trainingRate(p);
      if (rate <= 0) continue;
      const prog = (ts.progress[pid] ?? 0) + rate;
      if (prog >= 1) {
        // +1 de overall: a evolução da carreira (evo) é compartilhada entre dias — cópia antes de mudar
        if (career.evo === undefined) continue;
        career.evo = { ...career.evo };
        const cur = career.evo[pid] ?? p.overall;
        career.evo[pid] = Math.round((cur + 1) * 1000) / 1000;
        ts.progress[pid] = Math.round((prog - 1) * 1000) / 1000;
        out.push({ clubId, text: `Centro de Treinamento: ${p.name} evoluiu para ${p.overall + 1} de overall.` });
      } else ts.progress[pid] = Math.round(prog * 1000) / 1000;
    }
    // progresso de quem não treina mais é descartado
    for (const id of Object.keys(ts.progress)) if (!ts.players.includes(id)) delete ts.progress[id];
  }
  return out;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Define os jogadores em treino (até 3, do elenco do clube). */
export function setTraining(input: SeasonState, squads: (clubId: string) => readonly Player[], clubId: string, playerIds: string[]): MarketResult {
  if (!input.market) return { state: input, error: 'Mercado não inicializado.' };
  const squad = new Set(squads(clubId).map((p) => p.id));
  // quem já treinava e saiu do elenco (vendido/emprestado) sai da lista em silêncio
  const before = new Set(input.market.training?.[clubId]?.players ?? []);
  const ids = [...new Set(playerIds)].filter((id) => squad.has(id) || !before.has(id));
  if (ids.length > TRAINING.maxPlayers) return { state: input, error: `No máximo ${TRAINING.maxPlayers} jogadores no Centro de Treinamento.` };
  if (ids.some((id) => !squad.has(id))) return { state: input, error: 'Só jogadores do seu elenco podem treinar.' };
  const state = clone(input);
  const all = (state.market!.training ??= {});
  const prev: TrainingState = all[clubId] ?? { players: [], progress: {} };
  all[clubId] = { players: ids, progress: Object.fromEntries(Object.entries(prev.progress).filter(([id]) => ids.includes(id))) };
  return { state };
}

/** Data em que o progresso atual completa +1 (estimativa para a tela). */
export function trainingEta(state: SeasonState, p: Pick<Player, 'age' | 'overall' | 'potential'>, progress: number): string | null {
  const r = trainingRate(p);
  if (r <= 0) return null;
  return addDays(state.date, Math.max(1, Math.ceil((1 - progress) / r)));
}
