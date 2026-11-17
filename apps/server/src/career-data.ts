/**
 * Dados da carreira lidos do DISCO (pasta de dados, padrão apps/web/public/data). A lógica (careerBase, playableClubs,
 * loaders) vive em @cosmicfut/online-core/career-data, que lê de um `CareerSource`; aqui fica a fonte de arquivos.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CareerSource } from '@cosmicfut/online-core/career-data';

export * from '@cosmicfut/online-core/career-data';

/** Fonte síncrona de JSON a partir de uma pasta (null = arquivo inexistente). */
export function fsSource(dir: string): CareerSource & { dir: string } {
  return {
    dir,
    readJson<T>(rel: string): T | null {
      const f = resolve(dir, rel);
      if (!existsSync(f)) return null;
      return JSON.parse(readFileSync(f, 'utf8')) as T;
    },
  };
}
