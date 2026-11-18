// (18/11) Gera apps/web/public/data/players-feet.json a partir dos JSON já publicados (clubs/*.json + players-market.json),
// sem rodar o build completo. Mesmo formato que o build.mjs escreve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data');
const pm = JSON.parse(fs.readFileSync(path.join(DATA, 'players-market.json'), 'utf8'));
const feet = pm.clubs.map((id) => {
  const f = path.join(DATA, 'clubs', `${id}.json`);
  if (!fs.existsSync(f)) return '';
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  return b.players.map((p) => (p.side === 'L' ? 'L' : 'R')).join('');
});
fs.writeFileSync(path.join(DATA, 'players-feet.json'), JSON.stringify({ version: 1, clubs: pm.clubs, feet }));
console.log(`players-feet.json: ${feet.reduce((s, x) => s + x.length, 0)} jogadores, ${(fs.statSync(path.join(DATA, 'players-feet.json')).size / 1024).toFixed(1)} KB`);
