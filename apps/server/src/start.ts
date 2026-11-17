/**
 * Ponto de entrada: `node src/start.ts` (Node >= 23.6, type stripping nativo).
 * Registra o resolvedor de `.ts` ANTES de carregar a engine (por isso o import dinâmico).
 */
import './node-hooks.ts';

const { main } = await import('./main.ts');
await main();
