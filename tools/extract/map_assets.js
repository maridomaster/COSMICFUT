// Uso: node map_assets.js "<pasta Brasfoot 2026>" [saida.json]
// Somente leitura na pasta do jogo. Gera estatisticas e vinculacao .ban -> escudo/camisa.
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const out = process.argv[3];
if (!root) { console.error('uso: node map_assets.js <pasta> [saida.json]'); process.exit(1); }

const dirs = ['teams/escudos','teams/escudosMini','teams/camisas','teams/camisas2','teams/camisas3','teams/camisasg1','teams/coletes',
  'selecoes/camisas','selecoes/camisas2','selecoes/escudos','trofeus','BF26/aflags','BF26/aflagslarge','BF26/aicons','BF26/aiconsb',
  'BF26/aiconsc','BF26/aiconsj','BF26/aeicons','BF26/aesticons','BF26/acamisas','BF26/cerimoniafifa','img','sons'];

function walk(d, acc = []) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, acc) : acc.push(p); }
  return acc;
}
function pngDim(f) {
  try {
    const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(24); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd);
    if (b.readUInt32BE(0) !== 0x89504e47) return null;
    return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
  } catch { return null; }
}
const report = { folders: {} };
const sets = {};
for (const d of dirs) {
  const files = walk(path.join(root, d));
  const ext = {}, dims = {}; let bytes = 0;
  const pngs = files.filter(f => /\.png$/i.test(f));
  files.forEach(f => { bytes += fs.statSync(f).size; const e = path.extname(f).toLowerCase(); ext[e] = (ext[e] || 0) + 1; });
  pngs.forEach(f => { const k = pngDim(f); if (k) dims[k] = (dims[k] || 0) + 1; });
  const topDims = Object.entries(dims).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const names = files.map(f => path.basename(f));
  report.folders[d] = { count: files.length, mb: +(bytes / 1048576).toFixed(1), ext, topDims, sample: names.slice(0, 5) };
  sets[d] = new Set(pngs.map(f => path.basename(f, path.extname(f))));
}
const ban = fs.readdirSync(path.join(root, 'teams')).filter(f => /\.ban$/i.test(f)).map(f => f.slice(0, -4));
const banSet = new Set(ban);
const lower = s => new Set([...s].map(x => x.toLowerCase()));
function link(dir) {
  const s = sets[dir], sl = lower(s);
  const has = ban.filter(b => s.has(b)), hasCI = ban.filter(b => !s.has(b) && sl.has(b.toLowerCase()));
  const miss = ban.filter(b => !sl.has(b.toLowerCase()));
  const orphans = [...s].filter(x => !banSet.has(x));
  return { total: s.size, banWithExact: has.length, banWithCaseOnly: hasCI.length, banMissing: miss.length, missingSample: miss.slice(0, 30), orphans: orphans.length, orphanSample: orphans.slice(0, 15) };
}
report.ban = ban.length;
report.link = {};
for (const d of ['teams/escudos','teams/escudosMini','teams/camisas','teams/camisas2','teams/camisas3']) report.link[d] = link(d);
// sufixos
const suf = {};
ban.forEach(b => { const i = b.lastIndexOf('_'); const s = i < 0 ? '(sem_sufixo)' : b.slice(i + 1).toLowerCase(); suf[s] = (suf[s] || 0) + 1; });
report.suffixBan = Object.entries(suf).sort((a, b) => b[1] - a[1]);
const sufE = {};
[...sets['teams/escudos']].forEach(b => { const i = b.lastIndexOf('_'); const s = i < 0 ? '(sem_sufixo)' : b.slice(i + 1).toLowerCase(); sufE[s] = (sufE[s] || 0) + 1; });
report.suffixEscudos = Object.entries(sufE).sort((a, b) => b[1] - a[1]);
// team_links
try {
  const tl = fs.readFileSync(path.join(root, 'arquivos/team_links.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('=')[0]);
  report.teamLinks = { n: tl.length, inBan: tl.filter(x => banSet.has(x)).length, inEscudos: tl.filter(x => sets['teams/escudos'].has(x)).length };
} catch {}
const json = JSON.stringify(report, null, 1);
if (out) fs.writeFileSync(out, json); else console.log(json);
