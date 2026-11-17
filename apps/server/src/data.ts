/**
 * Dados estáticos do jogo lidos do disco (padrão: apps/web/public/data). A classe vive em @cosmicfut/online-core
 * (lê de um `CareerSource`); aqui ela recebe a pasta.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData as CoreGameData } from '@cosmicfut/online-core/data';
import { fsSource } from './career-data.ts';

export class GameData extends CoreGameData {
  readonly dir: string;

  constructor(dir: string) {
    if (!existsSync(resolve(dir, 'clubs-index.json'))) {
      throw new Error(`Pasta de dados inválida (sem clubs-index.json): ${dir}`);
    }
    super(fsSource(dir));
    this.dir = dir;
  }
}
