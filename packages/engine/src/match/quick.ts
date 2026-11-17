import type { MatchConfig, MatchResult } from '../contract';
import { MatchSimulation } from './simulation';

/**
 * Simulação rápida: mesmo modelo e mesma sequência de RNG da partida ao vivo, sem narração
 * nem lista de eventos. Para a mesma config, o resultado é idêntico ao de
 * `new MatchSimulation(config).runToEnd()`.
 */
export function quickSimulate(config: MatchConfig): MatchResult {
  return new MatchSimulation(config, { narrate: false }).runToEnd();
}
