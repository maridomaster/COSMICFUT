/** (Fase 2) Hooks das vagas continentais (projeção com a regra da engine). */
import { useMemo } from 'react';
import { finalRanking, type Competition, type SeasonState } from '@cosmicfut/engine';
import { useCareerData } from '@/career/useCareerData';
import { useWorld } from '@/store/season';
import { clubTable } from './view';
import { careerCountryOf, projectContinental, type QualProjection } from './continental';

/** A competição é a 1ª divisão nacional do país da carreira (a que dá vagas continentais)? */
export function isTopNationalLeague(state: SeasonState, comp: Competition | undefined): boolean {
  return !!comp && comp.type === 'league' && (comp.division ?? 0) === 1 && (comp.countryId === undefined || comp.countryId === careerCountryOf(state));
}

/**
 * Projeção das vagas do ano seguinte para a 1ª divisão do país da carreira (null nas demais, no online ou
 * com as continentais desligadas). Usa a classificação atual (ou a final, se encerrada).
 */
export function useQualProjection(state: SeasonState, comp: Competition | undefined): QualProjection | null {
  const world = useWorld();
  const data = useCareerData();
  const on = !!world && world.countryCode === 'BRA' && world.options.continental !== false && isTopNationalLeague(state, comp);
  return useMemo(() => {
    if (!on || !data || !comp || !world) return null;
    const order = comp.finished && comp.format ? finalRanking(comp) : clubTable(comp).rows.map((r) => r.clubId);
    if (!order.length) return null;
    try {
      return projectContinental(state, data, world.countryCode, order);
    } catch (e) {
      console.warn('[continentais] projeção de vagas falhou', e);
      return null;
    }
  }, [on, data, comp, world, state]);
}
