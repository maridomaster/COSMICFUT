/**
 * Medições da carreira online: `node scripts/measure-career.ts [--clubs flarj,corinthians-bra]`
 *  - createCareer, tempo por dia (advanceDay inPlace), maior dia;
 *  - tamanho de `world` e `state` em JSON e em gzip (o que vai na rede e no disco) + tempo de pack (no worker);
 *  - comparação com deflate raw (perMessageDeflate do ws) e custo de structuredClone/JSON.stringify
 *    (o que o thread principal pagaria se recebesse o estado como objeto);
 *  - virada (season-end + rollover).
 */
import '../src/node-hooks.ts';
import { deflateRawSync } from 'node:zlib';
import { DEFAULT_DATA_DIR } from '../src/config.ts';

const { CareerSimulator } = await import('../src/sim-core.ts');

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const clubs = arg('clubs', 'flarj,corinthians-bra').split(',');
const sim = new CareerSimulator(DEFAULT_DATA_DIR);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const size = (label: string, x: unknown) => {
  const t0 = performance.now();
  const json = JSON.stringify(x);
  const tStr = performance.now() - t0;
  const z = deflateRawSync(json);
  const t2 = performance.now();
  structuredClone(x);
  const tClone = performance.now() - t2;
  console.log(`  ${label}: JSON ${kb(json.length)} | deflate-raw ${kb(z.length)} | stringify ${tStr.toFixed(0)} ms | structuredClone ${tClone.toFixed(0)} ms`);
};
const pack = (label: string, withWorld = false) => {
  const p = sim.pack('M', withWorld);
  const s = p.stats;
  console.log(`  pack ${label}: state ${kb(s.stateJson)} → gzip ${kb(s.stateGz)}${s.worldJson ? ` | world ${kb(s.worldJson)} → gzip ${kb(s.worldGz!)}` : ''} | ${s.ms.toFixed(0)} ms (no worker)`);
};

let t = performance.now();
sim.warm();
console.log(`dados + players-market: ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
sim.create({ op: 'create', room: 'M', humanClubIds: clubs, season: 2026, seed: 'measure', countryId: 29 });
let c = sim.career('M')!;
console.log(`createCareer: ${(performance.now() - t).toFixed(0)} ms | competições ${c.state.competitions.length} | clubes ${Object.keys(c.state.clubs).length}`);
size('world (início)', c.world);
size('state (início)', c.state);
pack('início', true);

let worst = 0;
let rounds = 0;
let reason = '';
const t0 = performance.now();
for (;;) {
  const r = sim.round({ op: 'round', room: 'M', live: [], until: { kind: 'next-match' }, maxDays: 400 }, {});
  rounds++;
  worst = Math.max(worst, r.maxDayMs);
  if (rounds === 20) {
    size('state (20ª parada)', sim.career('M')!.state);
    pack('20ª parada');
  }
  if (r.reason === 'season-over' || r.reason === 'limit') {
    reason = r.reason;
    break;
  }
}
c = sim.career('M')!;
console.log(`temporada: ${rounds} paradas em dias de jogo humano, ${(performance.now() - t0).toFixed(0)} ms, maior dia ${worst.toFixed(0)} ms (${reason})`);
size('state (fim)', c.state);
pack('fim');
t = performance.now();
const end = sim.seasonEnd({ op: 'season-end', room: 'M' });
console.log(`season-end (prévia + vencimentos): ${(performance.now() - t).toFixed(0)} ms; vencendo: ${Object.entries(end.expiring).map(([k, l]) => `${k}=${l.length}`).join(' ')}`);
size('season:end payload', { preview: end.preview, expiring: end.expiring });
t = performance.now();
const renew: Record<string, true> = {};
for (const l of Object.values(end.expiring)) for (const p of l.slice(0, 3)) renew[p.playerId] = true;
const roll = sim.rollover({ op: 'rollover', room: 'M', renew });
console.log(`rollover: ${(performance.now() - t).toFixed(0)} ms; nova temporada ${roll.meta.season}; renovados ${roll.summary.contracts.renewed}`);
size('summary da virada', roll.summary);
c = sim.career('M')!;
size('world (após virada)', c.world);
size('state (2ª temporada)', c.state);
pack('após virada', true);
