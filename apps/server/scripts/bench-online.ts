/**
 * Benchmark do servidor online com a carreira: `node scripts/bench-online.ts [--workers 1] [--rounds 10]`
 *  (--workers 0 = simulação inline no thread principal, para comparar)
 *
 * Sobe o servidor em processo, cria uma sala (Palmeiras) e mede:
 *  - último "pronto" → match:start em várias rodadas (inclui os dias IA×IA entre os jogos humanos);
 *  - atraso do event loop (perf_hooks.monitorEventLoopDelay) durante as rodadas e durante uma temporada inteira
 *    (dev:advance season-end) — é o que as OUTRAS salas sentiriam (ticks de partida, chat, acks);
 *  - tamanho dos snapshots gzip recebidos.
 */
import './../src/node-hooks.ts';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { MatchStartPayload, SeasonSnapshotPayload } from '@cosmicfut/shared';

const { createServer } = await import('../src/server.ts');

const { values: args } = parseArgs({ options: { workers: { type: 'string', default: '1' }, rounds: { type: 'string', default: '10' } } });
const workers = Number(args.workers);
const rounds = Number(args.rounds);

const srv = createServer({ logger: false, persistDir: null, seedFor: () => 'bench', devCommands: true, simWorkers: workers, halfTimeTimeoutMs: 0, preMatchMs: 0, webDist: null });
const port = await srv.listen(0, '127.0.0.1');
const sock: Socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
await new Promise<void>((r) => sock.once('connect', () => r()));
const call = <T>(ev: string, ...a: unknown[]) =>
  new Promise<T>((res, rej) => sock.emit(ev, ...a, (r: { ok: boolean; data: T; error: string }) => (r.ok ? res(r.data) : rej(new Error(r.error)))));
const once = <T>(ev: string, pred: (x: T) => boolean = () => true) =>
  new Promise<T>((res) => {
    const on = (x: T) => {
      if (!pred(x)) return;
      sock.off(ev, on);
      res(x);
    };
    sock.on(ev, on);
  });

let phase = '';
sock.on('room:state', (s: { phase: string }) => (phase = s.phase));
const untilPhase = async (p: string) => {
  while (phase !== p) await new Promise((r) => setTimeout(r, 2));
};
const snaps: number[] = [];
sock.on('season:snapshot', (p: SeasonSnapshotPayload) => snaps.push((p.stateGz as Uint8Array).byteLength + ((p.worldGz as Uint8Array | undefined)?.byteLength ?? 0)));

const h = monitorEventLoopDelay({ resolution: 5 });
const pct = (n: number) => (n / 1e6).toFixed(0);

const t0 = performance.now();
await call('room:create', { nickname: 'Bench', settings: { matchSpeedMs: 1 } });
await call('room:pick-club', { clubId: 'palmeiras' });
await call('room:start');
console.log(`modo: ${workers > 0 ? `${workers} worker(s)` : 'inline (thread principal)'} | room:start (createCareer + aquecimento): ${(performance.now() - t0).toFixed(0)} ms`);

h.enable();
const lat: number[] = [];
const roomOf = () => [...srv.rooms.values()][0];
for (let i = 0; i < rounds; i++) {
  await untilPhase('planning');
  const start = once<MatchStartPayload>('match:start');
  const t = performance.now();
  void call('round:ready', { ready: true });
  const m = await start;
  lat.push(performance.now() - t);
  const r = roomOf().lastRound;
  console.log(`  rodada ${i + 1}: ${m.fixture?.date} ${m.fixture?.competitionId} | ready→match:start ${lat[i].toFixed(0)} ms (dias ${r?.days}, jogos ${r?.games}, sim ${r?.simMs} ms, maior dia ${r?.maxDayMs} ms)`);
  await once('match:end');
  phase = '';
  await untilPhase('planning');
}
h.disable();
lat.sort((a, b) => a - b);
console.log(`ready→match:start: mediana ${lat[Math.floor(lat.length / 2)].toFixed(0)} ms, máx ${lat[lat.length - 1].toFixed(0)} ms`);
console.log(`event loop nas rodadas: p50 ${pct(h.percentile(50))} ms, p99 ${pct(h.percentile(99))} ms, máx ${pct(h.max)} ms`);

const h2 = monitorEventLoopDelay({ resolution: 5 });
h2.enable();
const t1 = performance.now();
await call('dev:advance', { until: 'season-end' });
h2.disable();
console.log(`temporada até o fim (dev:advance): ${(performance.now() - t1).toFixed(0)} ms | event loop p99 ${pct(h2.percentile(99))} ms, máx ${pct(h2.max)} ms`);
console.log(`snapshots recebidos: ${snaps.length}, gzip médio ${(snaps.reduce((a, b) => a + b, 0) / snaps.length / 1024).toFixed(0)} KB, maior ${(Math.max(...snaps) / 1024).toFixed(0)} KB`);

sock.disconnect();
await srv.close();
process.exit(0);
