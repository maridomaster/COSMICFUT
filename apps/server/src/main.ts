import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { optionsFromEnv } from './config.ts';
import { createServer } from './server.ts';

export async function main(): Promise<void> {
  const opts = optionsFromEnv();
  const srv = createServer(opts);
  const port = await srv.listen();
  srv.app.log.info(
    { port, dataDir: opts.dataDir, persistDir: opts.persistDir, cors: opts.corsOrigins, restoredRooms: srv.rooms.size },
    'COSMICFUT server pronto',
  );
  if (!opts.logger) console.log(`COSMICFUT server em http://localhost:${port} (salas restauradas: ${srv.rooms.size})`);
  if (opts.webDist && existsSync(join(opts.webDist, 'index.html'))) console.log(`Front servido de ${opts.webDist} -> abra http://localhost:${port}`);
  else console.log('Front não encontrado (rode "npm run build" ou "npm run play"); só a API/Socket.io está ativa.');

  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${sig}: encerrando (salvando salas)...`);
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}
