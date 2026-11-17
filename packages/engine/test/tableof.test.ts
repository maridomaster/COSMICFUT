import { describe, expect, it } from 'vitest';
import { tableOf } from '../src/season/format';
import type { Fixture } from '../src/contract';

const fx = (id: string, homeId: string, awayId: string, home: number, away: number): Fixture =>
  ({ id, competitionId: 'c', round: 1, date: '2026-01-15', homeId, awayId, stageId: 's', result: { home, away } }) as unknown as Fixture;

describe('tableOf', () => {
  it('conta jogos contra clubes de OUTRO grupo (Taça Guanabara: grupo A x grupo B)', () => {
    const groupA = ['fla', 'vas'];
    const games = [fx('1', 'fla', 'nig', 6, 0), fx('2', 'mar', 'vas', 0, 2), fx('3', 'bot', 'mad', 3, 1)];
    const rows = tableOf(groupA, games);
    expect(rows.map((r) => r.clubId)).toEqual(['fla', 'vas']);
    expect(rows[0]).toMatchObject({ played: 1, won: 1, points: 3, goalsFor: 6, goalsAgainst: 0 });
    expect(rows[1]).toMatchObject({ played: 1, won: 1, points: 3, goalsFor: 2 });
  });

  it('grupo comum (jogos internos) continua igual', () => {
    const rows = tableOf(['a', 'b'], [fx('1', 'a', 'b', 1, 1)]);
    expect(rows.every((r) => r.played === 1 && r.points === 1)).toBe(true);
  });
});
