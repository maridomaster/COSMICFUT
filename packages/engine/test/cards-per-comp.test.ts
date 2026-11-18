/** (18/11) Amarelos contam só na própria competição; zeram quando a competição acaba. */
import { describe, expect, it } from 'vitest';
import type { ClubSeasonState } from '../src/contract';
import { applyMatchDiscipline, isSuspendedFor, yellowsIn } from '../src/season/discipline';
import { keepRunningCards } from '../src/season/career';

const club = (): ClubSeasonState => ({ clubId: 'x', injuries: {}, suspensions: {}, yellowCards: {}, fitness: {} } as unknown as ClubSeasonState);
const Y = (pid: string) => [{ playerId: pid, color: 'yellow' as const }];
const none = () => 1;

describe('amarelos por competição', () => {
  it('amarelo no Brasileirão não conta na Copa do Brasil (e vice-versa)', () => {
    const c = club();
    applyMatchDiscipline(c, 'BRA-1', Y('p'), none);
    applyMatchDiscipline(c, 'BRA-1', Y('p'), none);
    applyMatchDiscipline(c, 'BRA-CUP', Y('p'), none);
    expect(yellowsIn(c, 'p', 'BRA-1')).toBe(2);
    expect(yellowsIn(c, 'p', 'BRA-CUP')).toBe(1);
    expect(isSuspendedFor(c, 'p', 'BRA-1')).toBe(false);
  });

  it('3º amarelo no Brasileirão: suspenso só no próximo jogo do Brasileirão; livre na copa', () => {
    const c = club();
    for (let i = 0; i < 3; i++) applyMatchDiscipline(c, 'BRA-1', Y('p'), none);
    expect(isSuspendedFor(c, 'p', 'BRA-1')).toBe(true);
    expect(isSuspendedFor(c, 'p', 'BRA-CUP')).toBe(false);
    expect(yellowsIn(c, 'p', 'BRA-1')).toBe(0); // contador zera ao gerar a suspensão
    // joga a copa: a suspensão do Brasileirão continua pendente
    applyMatchDiscipline(c, 'BRA-CUP', [], none);
    expect(isSuspendedFor(c, 'p', 'BRA-1')).toBe(true);
    // cumpre no jogo seguinte do Brasileirão
    applyMatchDiscipline(c, 'BRA-1', [], none);
    expect(isSuspendedFor(c, 'p', 'BRA-1')).toBe(false);
  });

  it('expulso na Libertadores: suspenso só na Libertadores', () => {
    const c = club();
    applyMatchDiscipline(c, 'LIBERTADORES', [{ playerId: 'p', color: 'red' }], () => 1);
    expect(isSuspendedFor(c, 'p', 'LIBERTADORES')).toBe(true);
    expect(isSuspendedFor(c, 'p', 'BRA-1')).toBe(false);
  });

  it('virada de temporada: pendurados das competições encerradas zeram; das em andamento seguem', () => {
    const cards = { 'BRA-1': { p: 2 }, 'EST-SP-1': { q: 1 }, UCL: { r: 2 } };
    expect(keepRunningCards(cards, new Set(['UCL']))).toEqual({ cards: { UCL: { r: 2 } } });
    expect(keepRunningCards(cards, new Set())).toEqual({});
  });
});
