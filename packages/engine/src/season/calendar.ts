/**
 * Calendário multi-competição (Fase 1).
 *
 * - Cada competição tem as suas datas (`calendar_<id>.txt` → calendars.json, 'MM-DD'), uma por slot.
 * - Conflito = um clube com dois jogos na mesma data (ou em dias seguidos).
 *   Política documentada (spec §7.1.2): fica o jogo da competição de MAIOR prioridade
 *   (continental 4 > copa 3 > liga 2 > estadual 1; empate → id da competição); o outro é ADIADO
 *   para a 1ª data livre para os dois clubes, com 1 dia de folga antes e depois.
 *   Se o jogo adiado é a ida de um mata-mata, a volta é empurrada para depois dele.
 */
import type { Competition, Fixture, SeasonState } from '../contract';
import { addDays } from './schedule';

export const PRIORITY: Record<Competition['type'], number> = { continental: 4, supercup: 3, cup: 3, league: 2, state: 1 };

/** Datas ISO de um calendário 'MM-DD' na temporada (ordenadas, sem repetição). */
export function seasonDates(dates: string[] | undefined, season: number): string[] {
  const out = (dates ?? []).map((md) => `${season}-${md}`).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return Array.from(new Set(out));
}

export interface ConflictMove {
  fixtureId: string;
  competitionId: string;
  from: string;
  to: string;
  clubId: string;
}

function priorityOf(c: Competition): number {
  return c.priority ?? PRIORITY[c.type] ?? 2;
}

/**
 * Resolve conflitos de data entre os jogos ainda não disputados (a partir de `today`, inclusive).
 * Mutação in-place. Retorna os jogos remarcados.
 */
export function resolveConflicts(state: SeasonState, today: string, maxPasses = 6): ConflictMove[] {
  const moves: ConflictMove[] = [];
  const compOf = new Map<string, Competition>();
  for (const c of state.competitions) compOf.set(c.id, c);
  for (let pass = 0; pass < maxPasses; pass++) {
    // índice clube → datas ocupadas
    const busy = new Map<string, Map<string, Fixture[]>>();
    for (const c of state.competitions) {
      for (const f of c.fixtures) {
        if (f.result || f.date < today) continue;
        for (const id of [f.homeId, f.awayId]) {
          let m = busy.get(id);
          if (!m) busy.set(id, (m = new Map()));
          const arr = m.get(f.date);
          if (arr) arr.push(f); else m.set(f.date, [f]);
        }
      }
    }
    // clubes com 2+ jogos na mesma data
    const conflicts: Fixture[][] = [];
    for (const m of busy.values()) for (const arr of m.values()) if (arr.length > 1) conflicts.push(arr);
    if (!conflicts.length) break;
    conflicts.sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : 0));
    const moved = new Set<string>();
    const isFree = (club: string, d: string) => {
      const m = busy.get(club);
      return !m || (!m.get(d)?.length && !m.get(addDays(d, -1))?.length && !m.get(addDays(d, 1))?.length);
    };
    const occupy = (f: Fixture, from: string, to: string) => {
      for (const id of [f.homeId, f.awayId]) {
        const m = busy.get(id)!;
        const arr = m.get(from);
        if (arr) m.set(from, arr.filter((x) => x !== f));
        const t = m.get(to);
        if (t) t.push(f); else m.set(to, [f]);
      }
    };
    for (const arr of conflicts) {
      const live = arr.filter((f) => !moved.has(f.id) && f.date === arr[0].date);
      if (live.length < 2) continue;
      live.sort((a, b) => {
        const ca = compOf.get(a.competitionId)!, cb = compOf.get(b.competitionId)!;
        return priorityOf(cb) - priorityOf(ca) || (a.competitionId < b.competitionId ? -1 : 1) || (a.id < b.id ? -1 : 1);
      });
      for (const f of live.slice(1)) {
        const from = f.date;
        let d = addDays(from, 1);
        for (let k = 0; k < 90 && !(isFree(f.homeId, d) && isFree(f.awayId, d)); k++) d = addDays(d, 1);
        occupy(f, from, d);
        f.date = d;
        moved.add(f.id);
        moves.push({ fixtureId: f.id, competitionId: f.competitionId, from, to: d, clubId: f.homeId });
        // ida adiada para depois da volta → empurra a volta
        if (f.tieId && f.leg === 1) {
          const comp = compOf.get(f.competitionId)!;
          const back = comp.fixtures.find((x) => x.tieId === f.tieId && x.leg === 2 && !x.result);
          if (back && back.date <= d) {
            const old = back.date;
            let nd = addDays(d, 3);
            for (let k = 0; k < 90 && !(isFree(back.homeId, nd) && isFree(back.awayId, nd)); k++) nd = addDays(nd, 1);
            occupy(back, old, nd);
            back.date = nd;
            moves.push({ fixtureId: back.id, competitionId: back.competitionId, from: old, to: nd, clubId: back.homeId });
          }
        }
      }
    }
  }
  return moves;
}

/** Datas com jogos (qualquer competição) a partir de `from` — para a UI montar a agenda. */
export function matchDates(state: SeasonState, from = state.date): string[] {
  const s = new Set<string>();
  for (const c of state.competitions) for (const f of c.fixtures) if (!f.result && f.date >= from) s.add(f.date);
  return [...s].sort();
}
