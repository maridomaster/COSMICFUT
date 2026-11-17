/**
 * Núcleo da simulação da carreira: movido para @cosmicfut/online-core/sim-core (lê os dados de um `CareerSource`).
 * Aqui o `CareerSimulator` recebe a pasta de dados (disco), como antes.
 */
import './node-platform.ts';
import { CareerSimulator as CoreCareerSimulator } from '@cosmicfut/online-core/sim-core';
import { fsSource } from './career-data.ts';

export * from '@cosmicfut/online-core/sim-core';

export class CareerSimulator extends CoreCareerSimulator {
  readonly dir: string;

  constructor(dir: string) {
    super(fsSource(dir));
    this.dir = dir;
  }
}
