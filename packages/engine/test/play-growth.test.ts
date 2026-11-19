/**
 * (18/11) Minutos e treino no crescimento: quem joga ou treina chega ao potencial mais rápido; quem fica muito tempo
 * no banco cresce devagar e perde potencial (nunca abaixo do overall).
 */
import { describe, expect, it } from 'vitest';
import { benchPotentialLoss, careerSquads, monthlyDelta, PLAY, playGrowthFactor } from '../src';
import { Rng } from '../src/rng';
import type { Player } from '@cosmicfut/shared';
import type { SeasonState } from '../src';

const rng = () => new Rng('x');

describe('crescimento pelos minutos', () => {
  it('titular cresce mais rápido que reserva; no começo da temporada é neutro', () => {
    const titular = monthlyDelta(20, 70, 85, 0.8, rng(), playGrowthFactor(0.8, 10));
    const reserva = monthlyDelta(20, 70, 85, 0.05, rng(), playGrowthFactor(0.05, 10));
    expect(titular).toBeGreaterThan(reserva * 2);
    expect(playGrowthFactor(0, 2)).toBe(1);
    // 22–25 também
    expect(monthlyDelta(23, 72, 82, 0.7, rng(), playGrowthFactor(0.7, 12))).toBeGreaterThan(monthlyDelta(23, 72, 82, 0, rng(), playGrowthFactor(0, 12)));
  });

  it('treino especial garante crescimento mesmo sem jogar', () => {
    expect(playGrowthFactor(0, 12, true)).toBe(PLAY.trainingGrowth);
    expect(playGrowthFactor(0.8, 12, true)).toBe(1.5);
  });

  it('potencial cai só para jovem encostado, com a temporada andando e sem treino', () => {
    expect(benchPotentialLoss(21, 0.05, 12)).toBe(PLAY.decayPerMonth);
    expect(benchPotentialLoss(21, 0.05, 4)).toBe(0); // começo da temporada
    expect(benchPotentialLoss(21, 0.5, 12)).toBe(0); // joga
    expect(benchPotentialLoss(21, 0.05, 12, true)).toBe(0); // treina
    expect(benchPotentialLoss(31, 0.05, 12)).toBe(0); // veterano: potencial já acompanha o overall
  });

  it('careerSquads aplica o potencial corrente (nunca abaixo do overall, nunca acima dos dados)', () => {
    const p = { id: 'c:1', name: 'Jovem Teste', position: 'MF', age: 20, nationalityId: 29, side: 'R', traits: [], star: false, highlight: false, worldClass: false, overall: 70, potential: 86, wage: 1000, value: 1_000_000, youth: false, tmId: null } as Player;
    const state = { season: 2026, date: '2026-03-01', humanClubIds: [], competitions: [], clubs: {}, news: [], career: { evo: {}, stats: {}, clubGames: {}, potNow: { 'c:1': 82.4 } } } as unknown as SeasonState;
    expect(careerSquads(state, () => [p])('c')[0].potential).toBe(82);
    (state.career!.potNow as Record<string, number>)['c:1'] = 60;
    expect(careerSquads(state, () => [p])('c')[0].potential).toBe(70);
    (state.career!.potNow as Record<string, number>)['c:1'] = 95;
    expect(careerSquads(state, () => [p])('c')[0].potential).toBe(86);
  });
});
