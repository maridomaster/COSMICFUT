/**
 * (19/11) Corrida da Bola de Ouro no meio da temporada: soma os números da temporada em curso sem mutar o mundo.
 */
import { describe, expect, it } from 'vitest';
import type { SeasonState, WorldState } from '../src/contract';
import { ballonRace } from '../src/season/index';
import { makeSquad } from './helpers';

const sq = makeSquad('c1', 80);
const state = {
  date: '2026-06-01', clubs: { c1: {} }, clubInfo: { c1: {} },
  career: { lines: { [`${sq[10].id}|c1`]: [10, 12, 3, 780, 0], [`${sq[9].id}|c1`]: [10, 1, 1, 650, 0], [`${sq[1].id}|c1`]: [1, 0, 0, 700, 0] } },
} as unknown as SeasonState;
const world = { records: { players: {} }, history: [] } as unknown as Pick<WorldState, 'records' | 'history'>;

describe('ballonRace', () => {
  it('ranqueia pela nota da premiação e não muta o mundo', () => {
    const race = ballonRace(world, state, () => sq, ['c1']);
    expect(race.map((p) => p.playerId)).toEqual([sq[10].id, sq[9].id]); // 1 jogo: abaixo do mínimo proporcional
    expect(race[0].goals).toBe(12);
    expect(world.records!.players).toEqual({});
  });
});
