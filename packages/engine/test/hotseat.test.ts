/**
 * (17/11) Hot-seat ("vários técnicos no mesmo computador"): ordem das vezes, troca do técnico ativo
 * (humanClubIds[0]) e quem joga no dia — numa carreira real com 3 técnicos.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData } from '../src/contract';
import { createCareer, worldSquads } from '../src/season/career';
import { advanceDay } from '../src/season/season';
import { activateHotseat, createHotseat, endHotseatTurn, hotseatPlayingToday, nextHotseatTurn } from '../src/season/hotseat';
import { loadBase, loadData, loadPools } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let pools: Record<string, NamePool>;
beforeAll(() => {
  data = loadData();
  base = loadBase();
  pools = loadPools(data);
}, 120_000);

const MANAGERS = [
  { name: 'Ana', color: '#22c55e', clubId: 'palmeiras' },
  { name: 'Bia', color: '#3b82f6', clubId: 'santos' },
  { name: 'Caio', color: '#f59e0b', clubId: 'flarj' },
];

describe('hot-seat', () => {
  it('ordem das vezes: concluir passa ao próximo; depois do último a rodada fecha (done zera)', () => {
    const hs = createHotseat(MANAGERS);
    expect(hs.active).toBe(0);
    expect(nextHotseatTurn(hs)).toBe(1);
    expect(endHotseatTurn(hs)).toBe(1);
    hs.active = 1;
    expect(endHotseatTurn(hs)).toBe(2);
    hs.active = 2;
    expect(endHotseatTurn(hs)).toBeNull();
    expect(hs.done).toEqual([]);
    expect(() => createHotseat([...MANAGERS, { name: 'X', color: '#000', clubId: 'palmeiras' }])).toThrow();
    expect(() => createHotseat(Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, color: '#000', clubId: `c${i}` })))).toThrow();
  });

  it('carreira com 3 técnicos: o ativo vira humanClubIds[0]; quem joga hoje; os jogos dos outros são simulados', () => {
    const c = createCareer({ data, humanClubIds: MANAGERS.map((m) => m.clubId), season: 2026, seed: 'hotseat', squads: base, pools, options: { light: 'all' } });
    c.world.hotseat = createHotseat(MANAGERS);
    expect(c.state.humanClubIds).toEqual(['palmeiras', 'santos', 'flarj']);
    activateHotseat(c.world, c.state, 2);
    expect(c.state.humanClubIds[0]).toBe('flarj');
    expect(c.world.humanClubIds[0]).toBe('flarj');
    expect(new Set(c.state.humanClubIds)).toEqual(new Set(['palmeiras', 'santos', 'flarj']));
    // avança até um dia com jogo de algum técnico
    const sq = worldSquads(c.world, base);
    let playing: number[] = [];
    for (let i = 0; i < 60 && !(playing = hotseatPlayingToday(c.world, c.state)).length; i++) advanceDay(c.state, sq, {}, { inPlace: true });
    expect(playing.length).toBeGreaterThan(0);
    const today = c.state.date;
    // sem resultado ao vivo: os jogos humanos do dia são simulados como os da IA
    const r = advanceDay(c.state, sq, {}, { inPlace: true });
    const humanGames = r.played.filter(({ fixture: f }) => MANAGERS.some((m) => m.clubId === f.homeId || m.clubId === f.awayId));
    expect(humanGames.every(({ fixture }) => fixture.date === today)).toBe(true);
    expect(humanGames.length).toBeGreaterThan(0);
  }, 120_000);
});
