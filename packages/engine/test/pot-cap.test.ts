/**
 * (25/11) Potencial é o teto também nos saves: quem passou do potencial original dos dados volta a ele (uma vez).
 */
import { describe, expect, it } from 'vitest';
import { careerSquads, createCareer, migrateCareer, worldSquads } from '../src/season/career';
import { loadBase, loadData } from './career-helpers';

describe('teto do potencial nos saves', () => {
  it('overall e potencial acima do potencial dos dados voltam a ele; juniores gerados ficam', () => {
    const data = loadData();
    const base = loadBase();
    const c = createCareer({ data, humanClubIds: ['flarj'], season: 2026, seed: 'potcap', squads: base });
    const p = base('flarj').find((x) => x.age <= 23)!;
    const q = base('flarj').find((x) => x.id !== p.id && x.age <= 25)!;
    // simula o bug: evo e o potencial gravado na virada acima do potencial original
    c.state.career!.evo[p.id] = p.potential + 4.2;
    c.world.players.delta[q.id] = [q.age + 1, q.potential + 3, q.potential + 3, q.wage, q.value, 0];
    c.world.players.delta['flarj:g9-1'] = [18, 80, 95, 1000, 1, 1];
    delete c.world.potCapRev;
    const m = migrateCareer(c.world, c.state, { squads: base, data });
    expect(m.potCapMigrated).toBe(2);
    expect(m.state!.career!.evo[p.id]).toBe(p.potential);
    expect(m.world.players.delta[q.id].slice(1, 3)).toEqual([q.potential, q.potential]);
    expect(m.world.players.delta['flarj:g9-1'][2]).toBe(95);
    const sq = careerSquads(m.state!, worldSquads(m.world, base))('flarj');
    expect(sq.find((x) => x.id === p.id)!.overall).toBeLessThanOrEqual(p.potential);
    expect(migrateCareer(m.world, m.state, { squads: base, data }).potCapMigrated).toBeUndefined();
  });
});
