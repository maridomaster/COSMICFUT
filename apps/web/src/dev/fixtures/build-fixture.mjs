// Converte tools/extract/sample_output.json (formato pt antigo) para ClubBundle (contrato @cosmicfut/shared).
import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/PROJETOS CLAUDE/COSMICFUT';
const src = JSON.parse(fs.readFileSync(path.join(root, 'tools/extract/sample_output.json'), 'utf8'));
const outDir = path.join(root, 'apps/web/src/dev/fixtures');
fs.mkdirSync(outDir, { recursive: true });

const POS = { GOL: 'GK', LAT: 'FB', ZAG: 'CB', MEI: 'MF', ATA: 'FW' };
const META = {
  palmeiras: { id: 'palmeiras', short: 'Palmeiras', league: 'BRA-1', balance: 62_000_000, sponsor: 38_000_000 },
  flarj: { id: 'flarj', short: 'Flamengo', league: 'BRA-1', balance: 71_000_000, sponsor: 45_000_000 },
  realmadrid_esp: { id: 'realmadrid-esp', short: 'Real Madrid', league: 'ESP-1', balance: 240_000_000, sponsor: 150_000_000 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r500 = (v) => Math.round(v / 500) * 500;
const r10k = (v) => Math.round(v / 10_000) * 10_000;

function overallOf(j, level) {
  let o = 40 + level * 1.75;
  if (j.top_mundial) o += 9;
  if (j.craque) o += 5;
  if (j.destaque) o += 3;
  if (!j.top_mundial && !j.craque && !j.destaque) o -= 4;
  o += (j.forca_hash - 5) * 0.6;
  const a = j.idade;
  if (a < 20) o -= 6;
  else if (a <= 22) o -= 3;
  else if (a >= 35) o -= 3;
  else if (a >= 32) o -= 1;
  return Math.round(clamp(o, 45, 95));
}

const bundles = src.map((c) => {
  const m = META[c.id_arquivo];
  const players = c.jogadores.map((j, i) => {
    const overall = overallOf(j, c.nivel);
    const potential = Math.round(clamp(overall + Math.max(0, 27 - j.idade) * 1.6, overall, 96));
    const wage = r500(1500 * Math.pow(1.12, overall - 55) * (0.6 + c.reputacao * 0.2));
    const ageF = j.idade <= 23 ? 1.5 : j.idade <= 27 ? 1.2 : j.idade <= 30 ? 1 : j.idade <= 32 ? 0.6 : 0.3;
    const value = r10k(120_000 * Math.pow(1.17, overall - 55) * ageF);
    return {
      id: `${m.id}:${i}`,
      name: j.nome,
      position: POS[j.posicao],
      age: j.idade,
      nationalityId: j.nacionalidade.id,
      side: j.lado === 'E' ? 'L' : 'R',
      traits: j.caracteristicas_ids,
      star: j.craque,
      highlight: j.destaque,
      worldClass: j.top_mundial,
      overall,
      potential,
      wage,
      value,
      youth: false,
      tmId: j.tm_id ?? null,
    };
  });
  const club = {
    id: m.id,
    sourceId: c.id_arquivo,
    name: c.nome,
    shortName: m.short,
    colors: { primary: c.cor_primaria, secondary: c.cor_secundaria },
    countryId: c.pais.id,
    state: c.estado,
    level: c.nivel,
    reputation: c.reputacao,
    stadium: { name: c.estadio, capacity: c.capacidade },
    coach: { name: c.tecnico, nationalityId: c.tecnico_nacionalidade.id },
    leagueId: m.league,
    division: 1,
    finances: { balance: m.balance, sponsorPerSeason: m.sponsor },
    crest: `crests/${m.id}.png`,
    crestMini: `crests-mini/${m.id}.png`,
    kits: [],
    playerIds: players.map((p) => p.id),
  };
  return { club, players };
});

fs.writeFileSync(path.join(outDir, 'clubs.json'), JSON.stringify(bundles, null, 2) + '\n');
console.log(bundles.map((b) => `${b.club.id}: ${b.players.length} jog., ovr médio ${(b.players.reduce((s, p) => s + p.overall, 0) / b.players.length).toFixed(1)}, top ${Math.max(...b.players.map((p) => p.overall))}`).join('\n'));

