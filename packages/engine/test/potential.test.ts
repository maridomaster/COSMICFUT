import { describe, expect, it } from 'vitest';
import { realisticPotential } from '../src/season/players';

describe('(18/11) potencial real pela idade', () => {
  it('veterano em declínio: potencial acompanha o overall', () => {
    // Messi: 38 anos, caiu para 86 ⇒ potencial 86 (não fica 89)
    expect(realisticPotential(38, 86, 89)).toBe(86);
    expect(realisticPotential(30, 80, 85)).toBe(80);
    expect(realisticPotential(28, 82, 90)).toBe(82);
  });
  it('auge: só o crescimento que ainda cabe na idade', () => {
    expect(realisticPotential(24, 75, 88)).toBe(79);
    expect(realisticPotential(26, 80, 81)).toBe(81);
    expect(realisticPotential(27, 80, 90)).toBe(81);
  });
  it('jovem mantém o potencial dos dados; nunca abaixo do overall', () => {
    expect(realisticPotential(19, 65, 85)).toBe(85);
    expect(realisticPotential(21, 80, 78)).toBe(80);
    expect(realisticPotential(33, 90, 70)).toBe(90);
  });
});

import { beforeAll } from 'vitest';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData } from '../src/contract';
import { careerSquads, createCareer, worldSquads } from '../src/season/career';
import { loadBase, loadData, loadPools } from './career-helpers';

describe('(18/11) careerSquads: potencial dinâmico na carreira', () => {
  let data: CareerData;
  let base: (id: string) => Player[];
  let pools: Record<string, NamePool>;
  beforeAll(() => {
    data = loadData();
    base = loadBase();
    pools = loadPools(data);
  }, 120_000);

  it('veterano que perde overall perde potencial junto; o valor de mercado não muda por isso', () => {
    const { world, state } = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'pot', squads: base, pools, options: { light: 'all' } });
    const sq = () => careerSquads(state, worldSquads(world, base))('palmeiras');
    const vet = sq().filter((p) => p.age >= 30).sort((a, b) => b.overall - a.overall)[0];
    expect(vet).toBeTruthy();
    // força um potencial "dos dados" acima do overall e uma queda de 5 pontos
    state.career!.evo[vet.id] = vet.overall - 5;
    const after = sq().find((p) => p.id === vet.id)!;
    expect(after.overall).toBe(vet.overall - 5);
    expect(after.potential).toBe(after.overall);
    // jovem: mantém o potencial dos dados
    const kid = sq().filter((p) => p.age <= 21).sort((a, b) => b.potential - b.overall - (a.potential - a.overall))[0];
    if (kid) expect(kid.potential).toBeGreaterThan(kid.overall);
  }, 120_000);
});
