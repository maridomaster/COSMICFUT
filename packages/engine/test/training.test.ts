/**
 * (Treino) Centro de Treinamento: até 3 jogadores; o overall sobe aos poucos até o potencial; treinar no dia do jogo
 * e na véspera gasta energia.
 */
import { describe, expect, it } from 'vitest';
import { advanceDay } from '../src/season/season';
import { careerSquads, createCareer, worldSquads } from '../src/season/career';
import { setTraining, TRAINING, trainingCost, trainingRate } from '../src/season/training';
import { loadBase, loadData } from './career-helpers';

describe('Centro de Treinamento', () => {
  it('ritmo: mais rápido quando jovem e longe do potencial; zero no potencial', () => {
    expect(trainingRate({ age: 19, overall: 60, potential: 80 })).toBeGreaterThan(trainingRate({ age: 26, overall: 60, potential: 80 }));
    expect(trainingRate({ age: 20, overall: 78, potential: 80 })).toBeLessThan(trainingRate({ age: 20, overall: 60, potential: 80 }));
    expect(trainingRate({ age: 31, overall: 85, potential: 90 })).toBe(0);
    expect(trainingRate({ age: 20, overall: 80, potential: 80 })).toBe(0);
  });

  it('até 3 jogadores; evoluem aos poucos; treino no dia do jogo cansa', () => {
    const data = loadData();
    const base = loadBase();
    const human = 'santos';
    const c = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'treino', squads: base });
    const world = c.world;
    let state = c.state;
    const sq = () => careerSquads(state, worldSquads(world, base));
    const young = sq()(human).filter((p) => trainingRate(p) > 0).sort((a, b) => trainingRate(b) - trainingRate(a));
    expect(young.length).toBeGreaterThanOrEqual(4);
    expect(setTraining(state, sq(), human, young.slice(0, 4).map((p) => p.id)).error).toMatch(/máximo/);
    expect(setTraining(state, sq(), human, ['outro-clube:1']).error).toBeTruthy();
    const picked = young.slice(0, 3);
    state = setTraining(state, sq(), human, picked.map((p) => p.id)).state;
    const before = new Map(picked.map((p) => [p.id, p.overall]));
    let tiredOnMatchDay = false;
    const w = worldSquads(world, base);
    while (state.date < '2026-03-15') {
      const cost = trainingCost(state, human);
      const r = advanceDay(state, w, {}, { inPlace: true });
      state = r.state;
      if (cost === TRAINING.matchDayCost) tiredOnMatchDay = true;
    }
    expect(tiredOnMatchDay).toBe(true);
    const after = sq()(human);
    let grew = 0;
    for (const p of picked) {
      const now = after.find((x) => x.id === p.id)!;
      if (now.overall > before.get(p.id)!) grew++;
    }
    expect(grew).toBeGreaterThanOrEqual(2);
    expect(state.news.some((n) => n.clubId === human && n.text.startsWith('Centro de Treinamento:'))).toBe(true);
    expect(state.market!.training![human].players).toHaveLength(3);
  }, 300_000);
});
