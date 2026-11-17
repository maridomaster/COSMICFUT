/**
 * CareerData no thread principal (mesmos JSONs que o worker carrega; o navegador reaproveita o cache HTTP).
 * Usado pelas telas que precisam das regras de vagas continentais (`qualifyContinental`) sem ida ao worker.
 */
import { useEffect, useState } from 'react';
import type { CareerData } from '@cosmicfut/engine';
import { loadCareerData } from './data';

let cached: CareerData | null = null;

export function useCareerData(): CareerData | null {
  const [data, setData] = useState<CareerData | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    loadCareerData()
      .then((d) => {
        cached = d;
        if (alive) setData(d);
      })
      .catch((e) => console.warn('[carreira] dados estáticos indisponíveis', e));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
