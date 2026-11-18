/**
 * Jogadores DUPLICADOS nos dados base: o banco do original traz o mesmo jogador em dois clubes (ex.: Carlos Espí no
 * Real Madrid e no Levante — o arquivo de cada time é independente). Na carreira isso vira dois jogadores iguais.
 *
 * Mesmo jogador = mesmo nome COMPLETO (2+ palavras, sem diferença de acento/maiúscula) + nacionalidade, e:
 *  - nome comum (4+ jogadores com esse nome no país — João Pedro, Jean Carlos…): regra estrita — mesma posição,
 *    idade a no máximo 1 ano e overall a no máximo 3 pontos (homônimos de verdade são frequentes);
 *  - nome raro (até 3): a base às vezes muda a posição/idade/overall entre as cópias (Miretti MF 21/23 anos,
 *    Hutchinson FW×MF) — posição igual ou vizinha (ZAG↔LAT↔MEI↔ATA; goleiro só com goleiro), idade ±2, overall ±6.
 * De cada grupo fica UMA cópia; as outras saem do jogo como aposentadas (`world.players.retired`, o mesmo caminho dos
 * aposentados: somem dos elencos e da busca do mercado).
 *
 * Segurança dos saves:
 *  - nunca sai uma cópia "mexida" na carreira: em clube humano, transferida/emprestada, com contrato novo ou citada no
 *    mercado da temporada (propostas, listas). Se todas estiverem mexidas, ficam todas. Entre as intactas, fica a de
 *    maior overall (depois maior salário, depois a primeira pelo id) — determinístico;
 *  - cópias já aposentadas não contam: o grupo nunca fica sem nenhuma cópia viva;
 *  - nenhum clube fica com menos de `MIN_SQUAD` jogadores da base por causa disto (ex.: 6 "Nick Stony" de 16 anos no
 *    mesmo time);
 *  - roda uma vez por revisão (`world.players.dedup`): na criação e na migração dos saves existentes.
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { SeasonState, WorldState } from '../contract';

/** 1: regra estrita · 2: nomes raros com posição/idade/overall um pouco diferentes + proteção do elenco */
export const DEDUP_REV = 2;
/** mínimo de jogadores da base que um clube mantém (a remoção de duplicados para antes disso) */
export const MIN_SQUAD = 18;
/** a partir de quantos jogadores com o mesmo nome no país o nome é "comum" (regra estrita) */
const COMMON_NAME = 4;

type Copy = { clubId: string; p: Player };

/** só nomes completos (2+ palavras): apelidos de uma palavra (Lucas, Renato…) se repetem entre pessoas diferentes */
const fullName = (n: string | undefined) => !!n && n.trim().split(/\s+/).length >= 2 && n.trim().length >= 6;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const LINE: Record<Position, number> = { GK: -10, CB: 0, FB: 1, MF: 2, FW: 3 };

function sameStrict(a: Player, b: Player): boolean {
  return a.position === b.position && Math.abs(a.age - b.age) <= 1 && Math.abs(a.overall - b.overall) <= 3;
}

function sameLoose(a: Player, b: Player): boolean {
  if ((a.position === 'GK') !== (b.position === 'GK')) return false;
  return Math.abs(LINE[a.position] - LINE[b.position]) <= 1 && Math.abs(a.age - b.age) <= 2 && Math.abs(a.overall - b.overall) <= 6;
}

/** Grupos de cópias do mesmo jogador (cada grupo com 2+ cópias), na ordem dos clubes informados. */
export function duplicateGroups(clubIds: readonly string[], base: (clubId: string) => readonly Player[]): Copy[][] {
  const byKey = new Map<string, Copy[]>();
  const seen = new Set<string>();
  for (const clubId of clubIds) {
    for (const p of base(clubId)) {
      if (seen.has(p.id) || !fullName(p.name)) continue;
      seen.add(p.id);
      const k = `${norm(p.name)}|${p.nationalityId}`;
      let g = byKey.get(k);
      if (!g) byKey.set(k, (g = []));
      g.push({ clubId, p });
    }
  }
  const out: Copy[][] = [];
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    const same = g.length >= COMMON_NAME ? sameStrict : sameLoose;
    // une as cópias parecidas (componentes conexos); pessoas diferentes com o mesmo nome ficam em grupos separados
    const parent = g.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (same(g[i].p, g[j].p)) parent[find(i)] = find(j);
    const comps = new Map<number, Copy[]>();
    g.forEach((x, i) => {
      const r = find(i);
      let c = comps.get(r);
      if (!c) comps.set(r, (c = []));
      c.push(x);
    });
    for (const c of comps.values()) if (c.length > 1) out.push(c);
  }
  return out;
}

/**
 * Aposenta as cópias duplicadas (uma vez por revisão). Muta `world` (e lê `state`). Devolve quantas saíram.
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
    humans.has(clubId) || wp.club[pid] !== undefined || wp.data[pid] !== undefined ||
    wp.contractEnd[pid] !== undefined || wp.freeSince[pid] !== undefined || cited.includes(`"${pid}"`);
  // jogadores da base ainda no clube (sem aposentados e sem quem saiu) — proteção do tamanho do elenco
  const size = new Map<string, number>();
  const sizeOf = (clubId: string) => {
    let n = size.get(clubId);
    if (n === undefined) {
      n = base(clubId).filter((p) => wp.retired[p.id] === undefined && (wp.club[p.id] === undefined || wp.club[p.id] === clubId)).length;
      size.set(clubId, n);
    }
    return n;
  };
  let n = 0;
  const season = state?.season ?? world.season;
  for (const g of duplicateGroups(clubIds, base)) {
    // cópias já aposentadas (revisão anterior, aposentadoria) não contam
    const alive = g.filter((x) => wp.retired[x.p.id] === undefined);
    if (alive.length < 2) continue;
    const free = alive.filter((x) => !touched(x.clubId, x.p.id));
    if (!free.length) continue;
    const keepTouched = free.length < alive.length;
    // sem cópia mexida: fica a melhor das intactas
    const sorted = free.slice().sort((a, b) => b.p.overall - a.p.overall || b.p.wage - a.p.wage || (a.p.id < b.p.id ? -1 : 1));
    const out = keepTouched ? sorted : sorted.slice(1);
    for (const x of out) {
      if (sizeOf(x.clubId) <= MIN_SQUAD) continue;
      wp.retired[x.p.id] = season;
      size.set(x.clubId, sizeOf(x.clubId) - 1);
      n++;
    }
  }
  return n;
}
