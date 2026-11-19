/**
 * (19/11) Finais rodam sempre na velocidade Normal: `isFinalFixture` reconhece o jogo de final (não o 3º lugar).
 */
import { describe, expect, it } from 'vitest';
import type { Competition, Fixture } from '../src/contract';
import { isFinalFixture } from '../src/season/index';

const fx = (id: string, tieId?: string): Fixture => ({ id, competitionId: 'cup', round: 1, date: '2026-12-01', homeId: 'a', awayId: 'b', stageId: 'ko', tieId } as Fixture);

const comp = {
  id: 'cup', name: 'Copa', fixtures: [fx('f1', 't-semi'), fx('f2', 't-final'), fx('f3', 't-3rd'), fx('f4')],
  stages: {
    ko: {
      ties: [
        { id: 't-semi', round: 0, roundName: 'Semifinal', a: 'a', b: 'b', fixtureIds: ['f1'] },
        { id: 't-final', round: 1, roundName: 'Final', a: 'a', b: 'b', fixtureIds: ['f2'] },
        { id: 't-3rd', round: 1, roundName: 'Final', a: 'c', b: 'd', fixtureIds: ['f3'], thirdPlace: true },
      ],
    },
  },
} as unknown as Competition;

describe('isFinalFixture', () => {
  const s = { competitions: [comp] };
  it('só a final conta', () => {
    expect(isFinalFixture(s, comp.fixtures[1])).toBe(true);
    expect(isFinalFixture(s, comp.fixtures[0])).toBe(false);
    expect(isFinalFixture(s, comp.fixtures[2])).toBe(false);
    expect(isFinalFixture(s, comp.fixtures[3])).toBe(false);
  });
});
