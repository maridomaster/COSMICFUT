/**
 * Worker de simulação (worker_threads). Um processo pode ter vários (pool, ver sim-pool.ts); cada sala fica
 * presa a um worker, que é o dono do `world`/`state` dela (CareerSimulator).
 *
 * Mensagens (fila: o worker processa uma por vez, na ordem):
 *   in : { id, req: SimRequest }
 *   out: { t: 'day', id, day }           — um por dia simulado com jogos (round:results ao vivo)
 *        { t: 'result', id, res }        — resposta da operação
 *        { t: 'snapshot', id, snap }     — snapshot gzip depois de operações que mudam o estado
 *        { t: 'error', id, message, code }
 *        { t: 'ready' }                  — dados carregados
 *
 * Roda em Node puro (type stripping): registra o resolvedor de `.ts` antes de carregar a engine.
 */
import './node-hooks.ts';
import { parentPort, workerData } from 'node:worker_threads';
import type { SimRequest } from './sim-core.ts';

const { CareerSimulator, CareerMissingError } = await import('./sim-core.ts');

const port = parentPort!;
const sim = new CareerSimulator((workerData as { dataDir: string }).dataDir);
try {
  sim.warm();
} catch {
  // erros de dados aparecem na 1ª operação
}
port.postMessage({ t: 'ready' });

port.on('message', (m: { id: number; req: SimRequest; withWorld?: boolean }) => {
  const { id, req } = m;
  try {
    const res = sim.run(req, { day: (day) => port.postMessage({ t: 'day', id, day }) });
    port.postMessage({ t: 'result', id, res });
    if (CareerSimulator.mayPack(req)) {
      // mercado sem mudança: snapshot vazio (o pool libera a chamada pendente)
      const snap = CareerSimulator.snapshotAfter(req, res) ? sim.pack(req.room, req.op === 'hydrate') : null;
      port.postMessage({ t: 'snapshot', id, snap });
    }
  } catch (e) {
    const code = e instanceof CareerMissingError ? 'career-missing' : 'error';
    port.postMessage({ t: 'error', id, code, message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
});
