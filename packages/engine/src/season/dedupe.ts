/**
 * Jogadores DUPLICADOS nos dados base: o banco do original traz o mesmo jogador em dois clubes (ex.: Carlos Espí no
 * Real Madrid e no Levante — o arquivo de cada time é independente). Na carreira isso vira dois jogadores iguais.
 *
 * Mesmo jogador = mesmo nome COMPLETO (2+ palavras) + nacionalidade + posição, idade a no máximo 1 ano e overall a no máximo 3 pontos.
 * De cada grupo fica UMA cópia; as outras saem do jogo como aposentadas (`world.players.retired`, o mesmo caminho dos
 * aposentados: somem dos elencos e da busca do mercado).
 *
 * Nunca sai uma cópia "mexida" na carreira: em clube humano, transferida/emprestada, com contrato novo ou citada no
 * mercado da temporada (propostas, listas). Se todas estiverem mexidas, ficam todas. Entre as intactas, fica a de
 * maior overall (depois a de maior salário, depois a primeira pelo id) — determinístico.
 *
 * Roda uma vez por carreira (`world.players.dedup`): na criação e na migração dos saves existentes.
 */
import type { Player } from '@cosmicfut/shared';
import type { SeasonState, WorldState } from '../contract';

export const DEDUP_REV = 1;

/** só nomes completos (2+ palavras): apelidos de uma palavra (Lucas, Renato…) se repetem entre pessoas diferentes */
const fullName = (n: string | undefined) => !!n && n.trim().split(/\s+/).length >= 2 && n.trim().length >= 6;

const key = (p: Player) => `${p.name.trim().toLowerCase()}|${p.nationalityId}|${p.position}`;

/** Grupos de cópias do mesmo jogador (cada grupo com 2+ cópias), na ordem dos clubes informados. */
export function duplicateGroups(clubIds: readonly string[], base: (clubId: string) => readonly Player[]): { clubId: string; p: Player }[][] {
  const byKey = new Map<string, { clubId: string; p: Player }[]>();
  const seen = new Set<string>();
  for (const clubId of clubIds) {
    for (const p of base(clubId)) {
      if (seen.has(p.id) || !fullName(p.name)) continue;
      seen.add(p.id);
      const k = key(p);
      let g = byKey.get(k);
      if (!g) byKey.set(k, (g = []));
      g.push({ clubId, p });
    }
  }
  const out: { clubId: string; p: Player }[][] = [];
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    // separa pessoas diferentes com o mesmo nome: agrupa por proximidade de idade e overall
    const left = g.slice();
    while (left.length > 1) {
      const head = left.shift()!;
      const same = [head];
      for (let i = left.length - 1; i >= 0; i--) {
        const x = left[i];
        if (Math.abs(x.p.age - head.p.age) <= 1 && Math.abs(x.p.overall - head.p.overall) <= 3) {
          same.push(x);
          left.splice(i, 1);
        }
      }
      if (same.length > 1) out.push(same);
    }
  }
  return out;
}

/**
 * Aposenta as cópias duplicadas (uma vez por carreira). Muta `world` (e lê `state`). Devolve quantas saíram.
 * `clubIds`: todos os clubes do jogo; `base`: os elencos base (os mesmos de `worldSquads`).
 */
export function retireDuplicatePlayers(
  world: WorldState, state: SeasonState | undefined, clubIds: readonly string[], base: (clubId: string) => readonly Player[],
): number {
  const wp = world.players;
  if ((wp.dedup ?? 0) >= DEDUP_REV) return 0;
  wp.dedup = DEDUP_REV;
  const humans = new Set([...(world.humanClubIds ?? []), ...(state?.humanClubIds ?? [])]);
  // ids citados no mercado da temporada (propostas, listas, empréstimos…) e nos empréstimos que atravessam a virada
  const cited = JSON.stringify([state?.market ?? null, wp.loans ?? null]);
  const touched = (clubId: string, pid: string) =>
    humans.has(clubId) || wp.retired[pid] !== undefined || wp.club[pid] !== undefined || wp.data[pid] !== undefined ||
    wp.contractEnd[pid] !== undefined || wp.freeSince[pid] !== undefined || cited.includes(`"${pid}"`);
  let n = 0;
  const season = state?.season ?? world.season;
  for (const g of duplicateGroups(clubIds, base)) {
    const free = g.filter((x) => !touched(x.clubId, x.p.id));
    if (!free.length) continue;
    const keepTouched = free.length < g.length;
    // sem cópia mexida: fica a melhor das intactas
    const sorted = free.slice().sort((a, b) => b.p.overall - a.p.overall || b.p.wage - a.p.wage || (a.p.id < b.p.id ? -1 : 1));
    const out = keepTouched ? sorted : sorted.slice(1);
    for (const x of out) {
      if (wp.retired[x.p.id] !== undefined) continue;
      wp.retired[x.p.id] = season;
      n++;
    }
  }
  return n;
}
