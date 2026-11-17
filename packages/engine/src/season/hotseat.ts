/**
 * (17/11) "Vários técnicos no mesmo computador" (hot-seat do Brasfoot): até 6 técnicos humanos numa carreira solo.
 * Cada rodada, um de cada vez faz a sua vez (escalação, mercado, finanças); quando o último conclui, o dia avança
 * para todos. O clube de quem está com o controle fica em `humanClubIds[0]` (as telas leem a carreira por ele).
 */
import type { HotseatManager, HotseatState, SeasonState, WorldState } from '../contract';

export const MAX_HOTSEAT = 6;

export function createHotseat(managers: HotseatManager[]): HotseatState {
  if (managers.length < 1 || managers.length > MAX_HOTSEAT) throw new Error(`hot-seat: de 1 a ${MAX_HOTSEAT} técnicos`);
  if (new Set(managers.map((m) => m.clubId)).size !== managers.length) throw new Error('hot-seat: clubes repetidos');
  return { managers: managers.map((m) => ({ ...m })), active: 0, done: [] };
}

/** Passa o controle ao técnico `index`: o clube dele vira `humanClubIds[0]` (mundo e temporada). */
export function activateHotseat(world: WorldState, state: SeasonState, index: number): void {
  const hs = world.hotseat;
  if (!hs || index < 0 || index >= hs.managers.length) throw new Error('hot-seat: técnico inválido');
  const id = hs.managers[index].clubId;
  const reorder = (ids: string[]) => [id, ...ids.filter((x) => x !== id)];
  world.humanClubIds = reorder(world.humanClubIds);
  state.humanClubIds = reorder(state.humanClubIds);
  hs.active = index;
}

/** Próximo técnico da rodada que ainda não jogou (null = todos concluíram: o dia avança). */
export function nextHotseatTurn(hs: HotseatState): number | null {
  for (let k = 1; k <= hs.managers.length; k++) {
    const i = (hs.active + k) % hs.managers.length;
    if (!hs.done.includes(i)) return i;
  }
  return null;
}

/** Conclui a vez do técnico ativo; devolve o próximo (ou null quando a rodada acabou — `done` zera). */
export function endHotseatTurn(hs: HotseatState): number | null {
  if (!hs.done.includes(hs.active)) hs.done.push(hs.active);
  const next = nextHotseatTurn(hs);
  if (next === null) hs.done = [];
  return next;
}

/** Técnicos (índices, na ordem) que jogam hoje — o 1º joga a partida ao vivo; os outros são simulados. */
export function hotseatPlayingToday(world: WorldState, state: SeasonState): number[] {
  const hs = world.hotseat;
  if (!hs) return [];
  const out: number[] = [];
  hs.managers.forEach((m, i) => {
    for (const c of state.competitions) {
      if (c.fixtures.some((f) => f.date === state.date && !f.result && (f.homeId === m.clubId || f.awayId === m.clubId))) {
        out.push(i);
        return;
      }
    }
  });
  return out;
}
