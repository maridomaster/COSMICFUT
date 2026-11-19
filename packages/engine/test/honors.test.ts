/**
 * (19/11) Ícones da Bola de Ouro / Prata: bônus somados, menos cansaço e mais força na partida; jogos sem sofrer
 * gol nas linhas; Bola de Prata só com os jogos do campeonato nacional.
 */
import { describe, expect, it } from 'vitest';
import type { MatchResult, SeasonState } from '../src/contract';
import { HONOR, honorBonus, silverRanking } from '../src/season/awards';
import { recordLines } from '../src/season/records';
import { MatchSimulation } from '../src/match/index';
import { config, makeSquad } from './helpers';

describe('ícones', () => {
  it('bônus: ouro +2/−20%, prata +1/−10%, os dois somam', () => {
    const h = { world: { kind: 'world' as const, playerId: 'a', name: 'A', clubId: 'x', label: '2026' }, national: { 'BRA-1': { kind: 'national' as const, playerId: 'a', name: 'A', clubId: 'x', label: '2026' }, 'ENG-1': { kind: 'national' as const, playerId: 'b', name: 'B', clubId: 'y', label: '2025/26' } } };
    expect(honorBonus(h, 'a')).toEqual({ overall: 3, drain: HONOR.world.drain * HONOR.national.drain });
    expect(honorBonus(h, 'b')).toEqual({ overall: 1, drain: 0.9 });
    expect(honorBonus(h, 'c')).toBeNull();
  });

  it('na partida: quem tem o ícone cansa menos', () => {
    const base = config('icone');
    const all = (drain: number) => Object.fromEntries(base.home.players.map((p) => [p.id, { overall: 0.0001, drain }]));
    const fit = (cfg: typeof base) => {
      const r = new MatchSimulation(cfg).runToEnd();
      const ids = cfg.home.lineup.starters;
      return ids.reduce((s, id) => s + (r.fitnessAfter?.[id] ?? 100), 0) / ids.length;
    };
    const without = fit(base);
    const withHonor = fit({ ...base, home: { ...base.home, honors: all(0.8) } });
    expect(withHonor).toBeGreaterThan(without);
  });
});

describe('linhas: jogos sem sofrer gol e campeonato nacional', () => {
  it('conta SG para quem jogou e separa os jogos da liga nacional', () => {
    const sq = makeSquad('c1', 75);
    const state = { clubs: { c1: {}, c2: {} }, career: { lines: {} } } as unknown as SeasonState;
    const r = { homeGoals: 2, awayGoals: 0, scorers: [], appearances: { home: [sq[0].id, sq[1].id], away: [] }, ratings: { [sq[0].id]: 7.5, [sq[1].id]: 7 } } as unknown as MatchResult;
    const league = { id: 'BRA-1', type: 'league', countryId: 29, division: 1 } as never;
    const cup = { id: 'BRA-CUP', type: 'cup', countryId: 29 } as never;
    recordLines(state, 'c1', 'c2', r, league);
    recordLines(state, 'c1', 'c2', { ...r, awayGoals: 1 } as MatchResult, cup);
    expect(state.career!.lines![`${sq[0].id}|c1`]).toEqual([2, 0, 0, 150, 0, 1]);
    expect(state.career!.leagueLines![`${sq[0].id}|BRA-1`]).toEqual([1, 0, 0, 75, 1, 'c1']);
    expect(state.career!.leagueLines![`${sq[0].id}|BRA-CUP`]).toBeUndefined();
    const rank = silverRanking(state, () => sq, 'BRA-1');
    expect(rank.map((x) => x.playerId)).toContain(sq[0].id);
    expect(rank.find((x) => x.playerId === sq[0].id)?.cleanSheets).toBe(1);
  });
});
