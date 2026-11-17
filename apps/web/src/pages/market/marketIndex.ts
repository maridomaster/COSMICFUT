/**
 * Índice de mercado da carreira: o que mudou no mundo em relação ao players-market.json.
 *
 * Fontes (mesma precedência de `careerSquads(state, worldSquads(world, base))`):
 *  1. `world.players.delta`  → idade/overall/potencial/salário/valor de quem segue no clube base;
 *  2. `world.players.data`   → cópia completa de quem saiu do clube base, juniores gerados e livres;
 *  3. `state.market.players` → snapshots da temporada (contratos novos, dispensados);
 *  4. `state.career.evo`     → overall corrente (evolução mensal);
 *  5. `state.market.moves`   → clube atual ('' = livre; inclui `world.players.club`);
 *  6. `world.players.retired`→ removidos.
 * No online (sem `world`) só entram o mercado da temporada (moves + players).
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { SeasonState, WorldState } from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import type { MarketIndex } from './searchTypes';

type Vals = [number, number, number, number, number, number];

export function buildMarketIndex(state: SeasonState, world: WorldState | null): MarketIndex {
  const vals = new Map<string, Vals>();
  const info = new Map<string, [string, Position, number]>();
  const fromPlayer = (p: Player) => {
    vals.set(p.id, [p.age, p.overall, p.potential, p.value, p.wage, p.youth ? 1 : 0]);
    info.set(p.id, [p.name, p.position, p.nationalityId]);
  };
  const wp = world?.players;
  if (wp) {
    for (const [pid, d] of Object.entries(wp.delta)) vals.set(pid, [d[0], d[1], d[2], d[4], d[3], d[5]]);
    for (const p of Object.values(wp.data)) fromPlayer(p);
  }
  const m = state.market;
  if (m) for (const p of Object.values(m.players)) fromPlayer(p);
  const evoOnly = new Map<string, number>();
  const evo = state.career?.evo;
  if (evo) {
    for (const [pid, e] of Object.entries(evo)) {
      const v = vals.get(pid);
      const o = Math.max(1, Math.min(99, Math.round(e)));
      // jogador sem delta: a base do JSON é a referência (idade/valor da base); só o overall muda
      if (v) v[1] = o;
      else evoOnly.set(pid, o);
    }
  }
  // (Etapa 5) valor de mercado dinâmico (contrato, liga, idade, reputação): os elencos efetivos da carreira já trazem
  // o valor recalculado — vale para os clubes com divisão nacional (os só estaduais ficam com o valor da base)
  if (wp && state.career) {
    for (const clubId of Object.keys(state.clubs)) {
      const info = state.clubInfo?.[clubId];
      if (info?.division === undefined && !state.humanClubIds.includes(clubId)) continue;
      for (const p of squads(clubId)) {
        const v = vals.get(p.id);
        if (v) { v[1] = p.overall; v[3] = p.value; v[4] = p.wage; evoOnly.delete(p.id); }
        else { vals.set(p.id, [p.age, p.overall, p.potential, p.value, p.wage, p.youth ? 1 : 0]); evoOnly.delete(p.id); }
      }
    }
  }
  const ids = [...vals.keys()];
  const flat = new Float64Array(ids.length * 6);
  ids.forEach((pid, k) => flat.set(vals.get(pid)!, k * 6));
  const clubs: Record<string, string> = { ...(wp?.club ?? {}), ...(m?.moves ?? {}) };
  const removed = wp ? Object.keys(wp.retired) : [];
  return { ids, vals: flat, info: ids.map((pid) => info.get(pid) ?? null), clubs, removed, ovr: Object.fromEntries(evoOnly) };
}
