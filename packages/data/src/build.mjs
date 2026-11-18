#!/usr/bin/env node
// COSMICFUT — pipeline de dados.
// Lê a pasta do jogo original (SOMENTE LEITURA) e gera apps/web/public/data + apps/web/public/assets.
// Uso: node src/build.mjs [--source <pasta do jogo>] [--out <apps/web/public>] [--skip-assets]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJavaSerialized } from './javaser.mjs';
import { readBan } from './ban.mjs';
import { COUNTRY_CODES, BRAZIL, UF } from './countries.mjs';
import { rateClub } from './ratings.mjs';
import { loadReal, loadFc, applyReal } from './real.mjs';
import { fixMojibake, slugify, normColor, stripBom, roundMoney } from './util.mjs';
import { STATE_FORMATS } from './formats.mjs';
import { SCOPE, SCOPE_CODES, inScope, maxDivisionsOf, regionOfCode, leagueRulesOf, GUESTS, guestConfedOf, UEFA_SLOTS } from './scope.mjs';
import { buildRealCalendars } from './calendars-real.mjs';
import { CURRENCY as ECONOMY_CURRENCY, economyV2 } from './prizes.mjs';

// (Etapa 2) nomes reais das ligas, copas, supercopas e playoffs de rebaixamento (registro competitions.json)
const LEAGUE_NAMES = {
  'ING-1': 'Premier League', 'ING-2': 'EFL Championship', 'ESP-1': 'LaLiga', 'ESP-2': 'LaLiga Hypermotion',
  'ITA-1': 'Serie A', 'ITA-2': 'Serie B', 'ALE-1': 'Bundesliga', 'ALE-2': '2. Bundesliga', 'FRA-1': 'Ligue 1', 'FRA-2': 'Ligue 2',
  'POR-1': 'Liga Portugal', 'POR-2': 'Liga Portugal 2', 'HOL-1': 'Eredivisie', 'HOL-2': 'Eerste Divisie',
  'ARS-1': 'Saudi Pro League', 'ARS-2': 'Saudi First Division League',
  'ARG-1': 'Liga Profesional Argentina', 'ARG-2': 'Primera Nacional', 'URU-1': 'Liga AUF Uruguaya', 'URU-2': 'Segunda División Uruguaya',
  'COL-1': 'Liga BetPlay', 'COL-2': 'Torneo BetPlay', 'CHI-1': 'Liga de Primera', 'CHI-2': 'Primera B de Chile',
  'PAR-1': 'Primera División Paraguaya', 'PAR-2': 'División Intermedia', 'EQU-1': 'LigaPro Serie A',
};
const NATIONAL_CUPS = {
  ING: [['ING-CUP', 'FA Cup'], ['ING-LCUP', 'EFL Cup']], ESP: [['ESP-CUP', 'Copa del Rey']], ITA: [['ITA-CUP', 'Coppa Italia']],
  ALE: [['ALE-CUP', 'DFB-Pokal']], FRA: [['FRA-CUP', 'Coupe de France']], POR: [['POR-CUP', 'Taça de Portugal']], HOL: [['HOL-CUP', 'KNVB Beker']],
  ARS: [['ARS-CUP', "King's Cup"]], ARG: [['ARG-CUP', 'Copa Argentina']], URU: [['URU-CUP', 'Copa AUF Uruguay']], COL: [['COL-CUP', 'Copa Colombia']],
  CHI: [['CHI-CUP', 'Copa Chile']], PAR: [['PAR-CUP', 'Copa Paraguay']], EQU: [['EQU-CUP', 'Copa Ecuador']],
};
/** sigla → [nome, nº de clubes] */
const SUPERCUPS = {
  ING: ['Community Shield', 2], ESP: ['Supercopa de España', 4], ITA: ['Supercoppa Italiana', 4], ALE: ['DFL-Supercup', 2],
  FRA: ['Trophée des Champions', 2], POR: ['Supertaça Cândido de Oliveira', 2], HOL: ['Johan Cruijff Schaal', 2], ARS: ['Supercopa Saudita', 4],
  ARG: ['Supercopa Argentina', 2], URU: ['Supercopa Uruguaya', 2], COL: ['Superliga BetPlay', 2], CHI: ['Supercopa de Chile', 2], PAR: ['Supercopa Paraguay', 2],
};
const RELEGATION_PLAYOFFS = {
  ALE: 'Relegation (Bundesliga × 2. Bundesliga)', FRA: 'Barrage (Ligue 1 × Ligue 2)',
  POR: 'Playoff de Permanência (Liga Portugal)', HOL: 'Playoff de Promoção (Eredivisie)',
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const DEFAULT_SOURCE = 'E:\\Downloads 2\\Brasfoot 2026_1_23\\Brasfoot 2026';

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const SOURCE = path.resolve(opt('--source', DEFAULT_SOURCE));
const PUBLIC = path.resolve(opt('--out', path.join(REPO, 'apps', 'web', 'public')));
const SKIP_ASSETS = argv.includes('--skip-assets');
// dados reais (curadores): packages/data/real/*.json
const REAL_DIR = path.resolve(opt('--real', path.join(HERE, '..', 'real')));
const DATA = path.join(PUBLIC, 'data');
const ASSETS = path.join(PUBLIC, 'assets');

// Guarda de segurança: nunca escrever dentro da pasta do jogo.
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (inside(PUBLIC, SOURCE) || inside(SOURCE, PUBLIC)) throw new Error('saída não pode ficar dentro da pasta do jogo (e vice-versa)');
if (!fs.existsSync(path.join(SOURCE, 'teams'))) throw new Error('pasta do jogo inválida: ' + SOURCE);

const src = (...p) => path.join(SOURCE, ...p);
const t0 = Date.now();
const log = (...a) => console.log('[data]', ...a);
const warnings = [];
const warn = (m) => { warnings.push(m); };

// ---------------------------------------------------------------- escrita
const written = new Map(); // caminho absoluto -> bytes
function ensureDir(d) {
  if (!inside(d, PUBLIC)) throw new Error('escrita fora da saída: ' + d);
  fs.mkdirSync(d, { recursive: true });
}
function writeJson(rel, obj) {
  const file = path.join(DATA, rel);
  ensureDir(path.dirname(file));
  const text = JSON.stringify(obj);
  const buf = Buffer.from(text, 'utf8'); // UTF-8 sem BOM
  let same = false;
  try { same = fs.readFileSync(file).equals(buf); } catch {}
  if (!same) fs.writeFileSync(file, buf);
  written.set(file, buf.length);
}
/** Remove de `dir` (dentro da saída) os arquivos que não estão em `keep` (nomes). */
function pruneDir(dir, keep) {
  if (!inside(dir, PUBLIC) || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!keep.has(f) && fs.statSync(p).isFile()) { fs.unlinkSync(p); n++; }
  }
  return n;
}
/** Copia (nunca move) src -> dst se o destino não existe ou difere. */
function copyAsset(from, to) {
  ensureDir(path.dirname(to));
  const s = fs.statSync(from);
  try {
    const d = fs.statSync(to);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return false;
  } catch {}
  fs.copyFileSync(from, to);
  return true;
}

// ---------------------------------------------------------------- utilidades de leitura
const readText = (f) => stripBom(fs.readFileSync(f, 'utf8'));
function readKeyValues(f) {
  const out = {};
  for (const line of readText(f).split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 0) continue;
    out[l.slice(0, i).trim()] = Number(l.slice(i + 1).trim());
  }
  return out;
}
/** Índice case-insensitive de PNGs de uma pasta: lower(basename) -> nome real. */
function pngIndex(dir) {
  const m = new Map();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir)) if (/\.png$/i.test(f)) m.set(f.slice(0, -4).toLowerCase(), f);
  return m;
}
function findAsset(index, candidates) {
  for (const c of candidates) { if (!c) continue; const hit = index.get(String(c).toLowerCase()); if (hit) return hit; }
  return null;
}

// ================================================================ 1. países
const langXml = readText(src('arquivos', 'default_lang.xml'));
const countryNames = [];
for (const m of langXml.matchAll(/<entry key="P(\d+)">([^<]*)<\/entry>/g)) countryNames[+m[1]] = fixMojibake(m[2]);
const usedCodes = new Set();
const countries = countryNames.map((name, id) => {
  const code = COUNTRY_CODES[id] ?? null;
  if (code) { if (usedCodes.has(code)) throw new Error('sigla duplicada ' + code); usedCodes.add(code); }
  return { id, code, name, flag: `flags/${id}.png`, flagLarge: `flags-large/${id}.png` };
});
const codeOf = (id) => countries[id]?.code ?? null;
log(`países: ${countries.length} (${countries.filter((c) => c.code).length} com sigla)`);

// ================================================================ 2. características
const traits = [
  ['positioning', 'Colocação', true], ['penaltySaving', 'Defesa de Pênaltis', true], ['reflexes', 'Reflexos', true], ['rushingOut', 'Saída do Gol', true],
  ['playmaking', 'Armação', false], ['heading', 'Cabeceio', false], ['crossing', 'Cruzamento', false], ['tackling', 'Desarme', false],
  ['dribbling', 'Drible', false], ['finishing', 'Finalização', false], ['marking', 'Marcação', false], ['passing', 'Passe', false],
  ['stamina', 'Resistência', false], ['pace', 'Velocidade', false],
].map(([key, label, gkOnly], id) => ({ id, key, label, gkOnly }));

// ================================================================ 3. clubes (.ban)
const TEAMS = src('teams');
const banFiles = fs.readdirSync(TEAMS).filter((f) => /\.ban$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en'));
const crestIdx = pngIndex(src('teams', 'escudos'));
const crestMiniIdx = pngIndex(src('teams', 'escudosMini'));
const kitIdx = [pngIndex(src('teams', 'camisas')), pngIndex(src('teams', 'camisas2')), pngIndex(src('teams', 'camisas3'))];

const POS = ['GK', 'FB', 'CB', 'MF', 'FW'];
const usedIds = new Set();
const clubs = []; // { club, rawSquad, rawYouth, assets }
let errors = 0, mojibakeFixed = 0;
const fx = (s) => { const r = fixMojibake(s ?? ''); if (s && r !== String(s).trim().replace(/\s+/g, ' ')) mojibakeFixed++; return r; };

for (const f of banFiles) {
  let raw;
  try { raw = readBan(path.join(TEAMS, f)); } catch (e) { errors++; warn(`falha ao ler ${f}: ${e.message}`); continue; }
  const sourceId = f.slice(0, -4);
  let id = slugify(sourceId) || 'clube';
  if (usedIds.has(id)) { let k = 2; while (usedIds.has(`${id}-${k}`)) k++; warn(`id duplicado ${id} (${sourceId}) -> ${id}-${k}`); id = `${id}-${k}`; }
  usedIds.add(id);

  const name = fx(raw.name) || sourceId;
  const isBR = raw.country === BRAZIL;
  const state = isBR && raw.stateIdx >= 0 && raw.stateIdx < UF.length ? UF[raw.stateIdx] : null;
  const cands = [sourceId, raw.slug];
  const crestSrc = findAsset(crestIdx, cands);
  const crestMiniSrc = findAsset(crestMiniIdx, cands);
  const kitSrcs = kitIdx.map((idx) => findAsset(idx, cands));
  const kits = [];
  kitSrcs.forEach((k, i) => { if (k) kits.push(`kits/${id}${i ? '-' + (i + 1) : ''}.png`); });

  const club = {
    id, sourceId, name, shortName: shortName(name),
    colors: { primary: normColor(raw.cor1, '#ffffff'), secondary: normColor(raw.cor2, '#000000') },
    countryId: raw.country, state,
    level: raw.level, reputation: raw.reputation,
    stadium: { name: fx(raw.stadium) || 'Estádio ' + name, capacity: raw.capacity | 0 },
    coach: { name: fx(raw.coach) || '—', nationalityId: raw.coachNat },
    leagueId: null, division: null,
    finances: { balance: 0, sponsorPerSeason: 0 },
    crest: crestSrc ? `crests/${id}.png` : null,
    crestMini: crestMiniSrc ? `crests-mini/${id}.png` : null,
    kits,
    playerIds: [],
  };
  const all = [...raw.squad.map((p) => ({ ...p, youth: false })), ...raw.youth.map((p) => ({ ...p, youth: true }))];
  all.forEach((p, i) => { p.id = `${id}:${i}`; });
  club.playerIds = all.map((p) => p.id);
  if (!crestSrc) warn(`sem escudo: ${sourceId}`);
  clubs.push({ club, squad: all.filter((p) => !p.youth), youth: all.filter((p) => p.youth), assets: { crestSrc, crestMiniSrc, kitSrcs } });
}
log(`clubes: ${clubs.length}/${banFiles.length} decodificados (${errors} erros)`);

function shortName(name) {
  if (name.length <= 12) return name;
  const drop = new Set(['fc', 'f.c.', 'sc', 's.c.', 'cf', 'c.f.', 'ac', 'a.c.', 'ec', 'e.c.', 'ca', 'c.a.', 'cr', 'se', 'ad', 'cd', 'afc', 'club', 'clube', 'esporte', 'futebol', 'football', 'fútbol', 'associação', 'sport', 'sporting', 'de', 'do', 'da', 'del', 'des', 'la', 'le', 'the', 'and', 'e', 'y', '1.', 'fk', 'sk', 'if', 'bk', 'ss', 'us', 'as', 'ssc', 'tsg', 'vfl', 'vfb', 'sv', 'rc', 'rcd', 'ud', 'sd', 'cfc', 'ff']);
  const words = name.split(/\s+/);
  const kept = words.filter((w) => !drop.has(w.toLowerCase()));
  const ws = kept.length ? kept : words;
  let out = '';
  for (const w of ws) { const next = out ? out + ' ' + w : w; if (next.length > 12) break; out = next; }
  return out || ws[0].slice(0, 12);
}

// ================================================================ 4. ligas nacionais e estaduais
const sortByStrength = (a, b) => b.club.level - a.club.level || b.club.reputation - a.club.reputation || a.club.name.localeCompare(b.club.name, 'pt') || a.club.id.localeCompare(b.club.id);
const byCountry = new Map();
for (const c of clubs) { if (!byCountry.has(c.club.countryId)) byCountry.set(c.club.countryId, []); byCountry.get(c.club.countryId).push(c); }

const readCfg = (f) => { const top = readJavaSerialized(fs.readFileSync(f))[0]; return (top && top.$items) || []; };
const leagues = [];
const MIN_DIV_CLUBS = 8;
const LIGAS = src('BF26', 'conf_ligas_nacionais');
const countryFlags = {}; // sigla -> { brazilCopaReal, brazilSerieDReal } (NAC:<PAÍS>, divisão 1)
const bools = (a) => (Array.isArray(a) ? a.map((x) => !!x) : []);
/** Todos os campos de ConfigLigaType relevantes (spec §7.1, pipeline item 3). */
const cfgOf = (d) => ({
  formula: d.formula | 0, nGrupos: d.nGrupos | 0, doisTurnos: !!d.doisTurnos, jogosDentroGrupo: !!d.jogosDentroGrupo,
  classificaPeloGeral: !!d.classificaPeloGeral, melhoresTerceiros: !!d.melhoresTerceiros, numeroTimesMataMata: d.numeroTimesMataMata | 0,
  nRebaixados: d.nRebaixados | 0, rebaixadosDireto: d.rebaixadosDireto | 0, playoffAcesso: !!d.playoffAcesso,
  vagasSobemPeloMataMata: d.vagasSobemPeloMataMata | 0, playoffRebaixamento: d.playoffRebaixamento | 0,
  rebaixadoPeloGrupo: !!d.rebaixadoPeloGrupo, rebaixamentoGeral: !!d.rebaixamentoGeral,
  duasVoltasMataMata: bools(d.duasVoltasMataMata), duasVoltasMataMataSobe: bools(d.duasVoltasMataMataSobe), duasVoltasplayoffReb: bools(d.duasVoltasplayoffReb),
  aperturaClausura: !!d.aperturaClausura, nomeClausura: fixMojibake(d.nomeClausura ?? ''), desempate: d.desempate | 0,
  positionPrizes: (d.positionPrizes || []).map((x) => Number(x) || 0),
});
for (const f of fs.readdirSync(LIGAS).filter((x) => /\.cfg$/i.test(x)).sort()) {
  const fileCode = f.slice(0, -4).toUpperCase();
  const divs = readCfg(path.join(LIGAS, f)).filter((d) => d && d.valido).sort((a, b) => a.divisao - b.divisao);
  if (!divs.length) continue;
  const countryId = divs[0].pais;
  const code = codeOf(countryId) ?? fileCode;
  if (divs[0].brazilCopaReal || divs[0].brazilSerieDReal) countryFlags[code] = { brazilCopaReal: !!divs[0].brazilCopaReal, brazilSerieDReal: !!divs[0].brazilSerieDReal };
  if (code !== fileCode) warn(`cfg ${f}: pais=${countryId} tem sigla ${code}`);
  const pool = (byCountry.get(countryId) || []).slice().sort(sortByStrength);
  let cursor = 0;
  const country = [];
  for (const d of divs) {
    const id = `${code}-${d.divisao}`;
    // (Etapa 2) tamanho real da divisão (2026 / 2026-27) quando conhecido
    const nTimes = leagueRulesOf(id)?.teams ?? d.nTimes;
    const take = pool.slice(cursor, cursor + nTimes);
    // Divisão com menos de MIN_DIV_CLUBS clubes reais não é jogável: é omitida e as
    // divisões abaixo também (os clubes restantes ficam sem liga nacional).
    if (take.length < MIN_DIV_CLUBS) { if (take.length) warn(`${id}: só ${take.length}/${nTimes} clubes -> omitida (clubes ficam sem liga)`); break; }
    if (take.length < nTimes) warn(`${id}: parcial ${take.length}/${nTimes} clubes -> teams=${take.length}`);
    cursor += take.length;
    for (const c of take) { c.club.leagueId = id; c.club.division = d.divisao; }
    country.push({
      id, countryId, division: d.divisao,
      name: fixMojibake(d.nome), divisionName: fixMojibake(d.nomeDivisao),
      teams: take.length, doubleRound: !!d.doisTurnos,
      relegated: 0, promoted: 0,
      groups: d.nGrupos | 0, legacyFormula: d.formula | 0,
      clubIds: take.map((c) => c.club.id),
      legacy: {
        configuredTeams: nTimes, nRebaixados: d.nRebaixados | 0, rebaixadosDireto: d.rebaixadosDireto | 0,
        aperturaClausura: !!d.aperturaClausura, playoffAcesso: !!d.playoffAcesso,
        vagasSobemPeloMataMata: d.vagasSobemPeloMataMata | 0,
      },
      cfg: cfgOf(d),
    });
  }
  // Sobe/desce coerentes (spec §3.4): sobem(i+1) = caem(i) = nRebaixados(i), limitado só pelo tamanho da
  // divisão de baixo (sem o antigo corte por teams/2). Brasil: a Série D "cai" 64 (nRebaixados) — no modo
  // Série D Real eles voltam aos estaduais; as divisões 5–10 do original são fictícias (fictional: true),
  // mantidas só por compatibilidade, e não recebem ninguém da D (promoted 0 na BRA-5).
  const serieDReal = !!countryFlags[code]?.brazilSerieDReal;
  for (let i = 0; i < country.length - 1; i++) {
    if (serieDReal && country[i].division === 4) {
      country[i].relegated = country[i].legacy.nRebaixados; country[i + 1].promoted = 0;
      continue;
    }
    const n = Math.min(country[i].legacy.nRebaixados, country[i + 1].teams, country[i].teams);
    country[i].relegated = n; country[i + 1].promoted = n;
  }
  if (serieDReal) for (const d of country) if (d.division >= 5) d.fictional = true;
  leagues.push(...country);
  if (cursor < pool.length) warn(`${code}: ${pool.length - cursor} clubes sem liga nacional`);
}
leagues.sort((a, b) => a.countryId - b.countryId || a.division - b.division);
log(`divisões nacionais: ${leagues.length} em ${new Set(leagues.map((l) => l.countryId)).size} países`);

const states = [];
const EST = src('conf_estadual');
const brClubs = (byCountry.get(BRAZIL) || []);
for (const f of fs.readdirSync(EST).filter((x) => /\.cfg$/i.test(x)).sort()) {
  const uf = f.slice(0, -4).toUpperCase();
  const divs = readCfg(path.join(EST, f)).filter((d) => d && d.nTimes > 0).sort((a, b) => a.divisao - b.divisao);
  const pool = brClubs.filter((c) => c.club.state === uf).sort(sortByStrength);
  let cursor = 0;
  const out = [];
  for (const d of divs) {
    const take = pool.slice(cursor, cursor + d.nTimes);
    cursor += take.length;
    if (take.length < d.nTimes) warn(`estadual ${uf}-${d.divisao}: ${take.length}/${d.nTimes} clubes`);
    const formatKey = `${d.nTimes}_${d.formula | 0}`;
    if (!STATE_FORMATS[formatKey]) warn(`estadual ${uf}-${d.divisao}: formato ${formatKey} inexistente -> genérico`);
    else if (STATE_FORMATS[formatKey].teams !== take.length) warn(`estadual ${uf}-${d.divisao}: ${take.length} clubes != formato ${formatKey} -> genérico`);
    out.push({
      division: d.divisao, name: fixMojibake(d.nome), teams: d.nTimes, legacyFormula: d.formula | 0, clubIds: take.map((c) => c.club.id),
      // (Fase 1) formato e rebaixamento (EST:<UF>)
      formatKey, relegated: d.nRebaixados | 0, relegatedDirect: d.rebaixadosDireto | 0,
      relegationPlayoff: d.playoffRebaixamento | 0, relegationOverall: !!d.rebaixamentoGeral, promotedFromBelow: 0,
    });
  }
  // a última divisão não rebaixa; sobem(N+1) = caem(N)
  if (out.length) out[out.length - 1].relegated = out[out.length - 1].relegatedDirect = out[out.length - 1].relegationPlayoff = 0;
  for (let i = 0; i < out.length; i++) out[i].promotedFromBelow = i < out.length - 1 ? out[i].relegated : 0;
  states.push({ state: uf, divisions: out });
}
log(`estaduais: ${states.length} UFs, ${states.reduce((a, s) => a + s.divisions.length, 0)} divisões`);

// ================================================================ 4b. Série D Real inicial (Brasil)
// Espelha o modo do original (brazilSerieDReal / generateSerieDReal): a D não é "os próximos 96 por força",
// mas 32 clubes nacionais (análogo dos 28 mantidos + 4 rebaixados da C no 1º ano) + 64 vagas pelos
// estaduais (mín. 2 e máx. 4 por UF, extras pelo tamanho da 1ª divisão estadual). As divisões 5–10
// (fictícias) são preenchidas depois, por força. Mesmo algoritmo de allocateSerieD na engine (rollover.ts).
const SERIE_D = { slots: 64, kept: 28, minPerUf: 2, maxPerUf: 4 };
function allocateSerieD(stateRanking, stateDivisions, exclude, slots, minPerUf, maxPerUf) {
  const ufs = Object.keys(stateRanking).sort();
  const avail = new Map(ufs.map((u) => [u, (stateRanking[u] ?? []).filter((c) => !exclude.has(c))]));
  const d1 = (u) => stateDivisions[`${u}-1`]?.length ?? 0;
  const bySize = ufs.slice().sort((a, b) => d1(b) - d1(a) || (avail.get(b).length - avail.get(a).length) || a.localeCompare(b));
  const alloc = new Map(ufs.map((u) => [u, 0]));
  let left = slots;
  for (let cap = 1; cap <= maxPerUf && left > 0; cap++) {
    const order = cap <= minPerUf ? ufs : bySize;
    for (const u of order) { if (left <= 0) break; if (alloc.get(u) < cap && alloc.get(u) < avail.get(u).length) { alloc.set(u, alloc.get(u) + 1); left--; } }
  }
  while (left > 0) {
    const u = bySize.slice().sort((a, b) => (avail.get(b).length - alloc.get(b)) - (avail.get(a).length - alloc.get(a)))[0];
    if (!u || avail.get(u).length - alloc.get(u) <= 0) break;
    alloc.set(u, alloc.get(u) + 1); left--;
  }
  const out = [];
  for (const u of ufs) out.push(...avail.get(u).slice(0, alloc.get(u)));
  return out;
}
const brDivs = leagues.filter((l) => l.countryId === BRAZIL).sort((a, b) => a.division - b.division);
const brD = brDivs.find((d) => d.division === 4);
const brCode = codeOf(BRAZIL);
if (brD && countryFlags[brCode]?.brazilSerieDReal) {
  const upper = new Set(brDivs.filter((d) => d.division <= 3).flatMap((d) => d.clubIds));
  const pool = brClubs.filter((c) => !upper.has(c.club.id)).sort(sortByStrength);
  const kept = pool.slice(0, SERIE_D.kept + 4).map((c) => c.club.id);
  const stateRanking = {}, stateDivisions = {};
  for (const s of states) {
    const inDiv = new Set(s.divisions.flatMap((d) => d.clubIds));
    s.divisions.forEach((d) => (stateDivisions[`${s.state}-${d.division}`] = d.clubIds));
    stateRanking[s.state] = [...s.divisions.flatMap((d) => d.clubIds), ...brClubs.filter((c) => c.club.state === s.state && !inDiv.has(c.club.id)).sort(sortByStrength).map((c) => c.club.id)];
  }
  const fromStates = allocateSerieD(stateRanking, stateDivisions, new Set([...upper, ...kept]), brD.teams - kept.length, SERIE_D.minPerUf, SERIE_D.maxPerUf);
  brD.clubIds = [...kept, ...fromStates];
  const usedD = new Set([...upper, ...brD.clubIds]);
  const rest = brClubs.filter((c) => !usedD.has(c.club.id)).sort(sortByStrength);
  let k = 0;
  for (const d of brDivs.filter((x) => x.division >= 5)) { d.clubIds = rest.slice(k, k + d.teams).map((c) => c.club.id); k += d.clubIds.length; d.teams = d.clubIds.length; }
  // reatribui leagueId/division dos clubes brasileiros
  for (const c of brClubs) { c.club.leagueId = null; c.club.division = null; }
  const byId = new Map(brClubs.map((c) => [c.club.id, c]));
  for (const d of brDivs) for (const id of d.clubIds) { const c = byId.get(id); if (c) { c.club.leagueId = d.id; c.club.division = d.division; } }
  log(`Série D Real inicial: ${kept.length} nacionais + ${fromStates.length} pelos estaduais (${new Set(fromStates.map((id) => byId.get(id)?.club.state)).size} UFs)`);
}

// ================================================================ 4c. escopo geográfico (Etapa 1 — scope.mjs)
// Só os países em escopo geram ligas e clubes; cada país mantém as `maxDivisionsOf(code)` primeiras divisões
// (a última mantida não rebaixa). Brasil: Séries A e B como ligas nacionais; C/D saem e os clubes ficam como
// "só estadual" (todos os clubes brasileiros continuam). countries.json continua completo.
{
  const keptLeagues = [];
  for (const cid of [...new Set(leagues.map((l) => l.countryId))]) {
    const code = codeOf(cid);
    if (!code || !inScope(code)) continue;
    const divs = leagues.filter((l) => l.countryId === cid && !l.fictional).sort((a, b) => a.division - b.division).slice(0, maxDivisionsOf(code));
    if (!divs.length) continue;
    const last = divs[divs.length - 1];
    last.relegated = 0;
    // (Etapa 2) regras reais: rebaixados diretos; promovidos = diretos + vagas do playoff de acesso
    divs.forEach((d, i) => {
      const rules = leagueRulesOf(d.id);
      if (!rules) return;
      const { teams: _t, ...r } = rules;
      d.rules = r;
      d.relegated = d === last ? (r.dropToStates ?? 0) : r.relegated;
      d.promoted = i === 0 ? 0 : r.promoted + (r.promotionPlayoff ? (r.promotionPlayoff.spots ?? 1) : 0);
      if (i > 0 && divs[i - 1].relegated !== d.promoted) warn(`${d.id}: promovidos (${d.promoted}) ≠ rebaixados de ${divs[i - 1].id} (${divs[i - 1].relegated})`);
    });
    keptLeagues.push(...divs);
  }
  const keptIds = new Set(keptLeagues.map((l) => l.id));
  for (const { club } of clubs) if (club.leagueId && !keptIds.has(club.leagueId)) { club.leagueId = null; club.division = null; }
  const before = { leagues: leagues.length, clubs: clubs.length };
  leagues.splice(0, leagues.length, ...keptLeagues);
  // (Etapa 2) convidados: clubes de fora do escopo que só disputam continentais (sem liga), marcados `guest`
  const guestIds = new Set(Object.values(GUESTS).flat());
  const keepClub = ({ club }) => {
    if (guestIds.has(club.id)) {
      club.guest = true;
      club.confed = guestConfedOf(club.id);
      club.leagueId = null; club.division = null;
      return true;
    }
    const code = codeOf(club.countryId);
    if (!code || !inScope(code)) return false;
    return club.countryId === BRAZIL ? SCOPE.brazil.keepAllClubs : !!club.leagueId;
  };
  const keptClubs = clubs.filter(keepClub);
  clubs.splice(0, clubs.length, ...keptClubs);
  for (const id of guestIds) if (!keptClubs.some((c) => c.club.id === id)) warn(`convidado inexistente nos .ban: ${id}`);
  // Brasil sem Série D: o modo "Série D Real" deixa de existir
  if (countryFlags.BRA) countryFlags.BRA.brazilSerieDReal = false;
  log(`escopo: ${SCOPE_CODES.length} países (${SCOPE_CODES.join(', ')}); ligas ${before.leagues} → ${leagues.length}; clubes ${before.clubs} → ${clubs.length} (${keptClubs.filter((c) => c.club.guest).length} convidados)`);
}

// ================================================================ 5. economia
const divMoney = readKeyValues(src('arquivos', 'valores_divisoes.txt'));
const economy = { initialMoneyByDivision: {}, sponsorByDivision: {}, prizes: readKeyValues(src('arquivos', 'premios.txt')) };
for (const [k, v] of Object.entries(divMoney)) {
  let m = k.match(/^initial_money_(?:div)?(\w+)$/); if (m) economy.initialMoneyByDivision[m[1]] = v;
  m = k.match(/^sponsor_(?:div)?(\w+)$/); if (m) economy.sponsorByDivision[m[1]] = v;
}
// (escala real) os prêmios do original (premios.txt) estão em reais; o jogo agora usa euros (1 "$" = 1 €).
// Ex.: Libertadores R$ 136 mi → € 23 mi; Copa do Brasil R$ 77 mi → € 13 mi; Série A R$ 50 mi → € 8,5 mi.
// (Etapa 4) câmbio fixo único do jogo: 1 € = R$ 6,30 (prizes.mjs → CURRENCY); antes 0,17.
const BRL_TO_EUR = 1 / ECONOMY_CURRENCY.brlPerEur;
economy.prizesBRL = { ...economy.prizes };
for (const k of Object.keys(economy.prizes)) economy.prizes[k] = roundMoney(economy.prizes[k] * BRL_TO_EUR);
// (Etapa 2) prêmios das competições novas (só o campeão). (Etapa 4) valem só quando a competição não tem tabela por
// fase/posição em `competitionPrizes`/`merit` (ex.: estaduais) — e para os pontos de reputação do técnico.
Object.assign(economy.prizes, { CHAMPIONS: 25_000_000, EUROPA: 8_500_000, CONFERENCE: 7_000_000, UEFA_SUPER: 4_000_000, AFC_ELITE: 9_000_000 });
// (Etapa 4) tabelas reais 2026: TV mensal, merit por posição, prêmios por fase, razão folha/receita, bilheteria, PIF
Object.assign(economy, economyV2());
const money = (table, div) => table[String(div)] ?? table.default ?? 0;
for (const { club } of clubs) {
  // provisório (tabelas do original); substituído pela escala real em 6 (real.mjs → applyReal)
  club.finances = { balance: money(economy.initialMoneyByDivision, club.division), sponsorPerSeason: money(economy.sponsorByDivision, club.division) };
}

// ================================================================ 6. jogadores (derivados + dados reais)
const marketRows = [];
const marketClubIds = [];
const ovrHist = {};
const bundles = [];
const realData = loadReal(REAL_DIR, warn);
const realEntries = clubs.map((entry) => {
  const { club, squad, youth } = entry;
  const rated = rateClub(club, squad, youth);
  const players = [...squad, ...youth].map((p) => {
    const r = rated.get(p.id);
    const tr = [...new Set([p.t1, p.t2].filter((x) => Number.isInteger(x) && x >= 0 && x < traits.length))];
    return {
      id: p.id, name: fx(p.name) || '—', position: POS[p.pos] ?? 'MF', age: p.age, nationalityId: p.nat,
      side: p.side === 1 ? 'L' : 'R', traits: tr,
      star: p.star, highlight: p.highlight, worldClass: p.worldClass,
      overall: r.overall, potential: r.potential, wage: r.wage, value: r.value,
      youth: p.youth, tmId: p.tmId ? Number(p.tmId) : null,
      hash: p.hash, // auxiliar (variação orgânica da Etapa 3); removido antes da escrita
    };
  });
  return { club, players };
});
const fcData = loadFc(REAL_DIR, warn);
const realStats = applyReal(realEntries, realData, (cid) => COUNTRY_CODES[cid] ?? null, warn, { fc: fcData });
const statusOf = new Map(); // (Etapa 3) id -> status no elenco (só para o relatório)
for (const { club, players: list } of realEntries) {
  // remove os campos auxiliares de applyReal (real, fc, status, hash) antes de gravar
  const players = list.map(({ real: _r, fc: _f, status: _s, hash: _h, ...p }) => { if (_s) statusOf.set(p.id, _s); return p; });
  const ci = marketClubIds.push(club.id) - 1;
  players.forEach((p, i) => {
    marketRows.push([ci, i, p.name, POS.indexOf(p.position), p.age, p.overall, p.potential, p.value, p.wage, p.nationalityId, p.youth ? 1 : 0]);
    if (!p.youth) ovrHist[Math.floor(p.overall / 5) * 5] = (ovrHist[Math.floor(p.overall / 5) * 5] || 0) + 1;
  });
  bundles.push({ club, players });
}

// ================================================================ 7. calendários e nomes
const calendars = [];
const ARQ = src('arquivos');
for (const f of fs.readdirSync(ARQ).filter((x) => /^calendario_.*\.txt$/i.test(x)).sort()) {
  const dates = [];
  for (const line of readText(path.join(ARQ, f)).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) dates.push(`${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    else if (line.trim()) warn(`calendário ${f}: linha ignorada "${line.trim()}"`);
  }
  calendars.push({ id: slugify(f.replace(/^calendario_/i, '').replace(/\.txt$/i, '')), dates });
}
calendars.sort((a, b) => a.id.localeCompare(b.id));
// (Etapa 1) calendários reais com datas completas: SA 2026 (ano civil), EU/SAU 2026/27 (temporada cruzada)
const realCalendars = buildRealCalendars(leagues, (leagueId) => regionOfCode(leagueId.split('-')[0]));
calendars.push(...realCalendars);
log(`calendários reais: ${realCalendars.length} (${realCalendars.map((c) => `${c.id}:${c.dates.length}`).join(' ')})`);

function readPool(file) {
  if (!fs.existsSync(file)) return [];
  const counts = new Map();
  for (const line of readText(file).split(/\r?\n/)) {
    const n = fixMojibake(line);
    if (!n) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return [...counts].map(([n, w]) => ({ n, w }));
}
const nameCodes = new Set();
for (const d of ['names', 'surnames']) for (const f of fs.readdirSync(path.join(ARQ, d))) if (/\.txt$/i.test(f)) nameCodes.add(f.slice(0, -4).toUpperCase());
const namePools = [...nameCodes].sort().map((code) => ({ code, given: readPool(path.join(ARQ, 'names', code + '.txt')), surname: readPool(path.join(ARQ, 'surnames', code + '.txt')) }));

// ================================================================ 8. escrita dos JSON
writeJson('countries.json', countries);
writeJson('traits.json', traits);
writeJson('clubs-index.json', clubs.map(({ club: c }) => ({ id: c.id, name: c.name, countryId: c.countryId, state: c.state, level: c.level, leagueId: c.leagueId, crestMini: c.crestMini, colors: c.colors, reputation: c.reputation, capacity: c.stadium.capacity, finances: c.finances, ...(c.guest ? { guest: true, confed: c.confed } : {}) })));
const clubFiles = new Set();
for (const b of bundles) { writeJson(`clubs/${b.club.id}.json`, b); clubFiles.add(b.club.id + '.json'); }
const prunedClubs = pruneDir(path.join(DATA, 'clubs'), clubFiles);
writeJson('players-market.json', {
  version: 1,
  // id do jogador = `${clubs[clubIdx]}:${playerIdx}`
  fields: ['clubIdx', 'playerIdx', 'name', 'pos', 'age', 'overall', 'potential', 'value', 'wage', 'nationalityId', 'youth'],
  positions: POS,
  clubs: marketClubIds,
  rows: marketRows,
});
// (18/11) pé bom de cada jogador da busca do mercado (o players-market não tem): por clube, uma string 'L'/'R' indexada
// pelo playerIdx. Pode ser regerado sem o build completo: `node packages/data/src/feet.mjs`.
{
  const byId = new Map(bundles.map((b) => [b.club.id, b]));
  writeJson('players-feet.json', { version: 1, clubs: marketClubIds, feet: marketClubIds.map((id) => (byId.get(id)?.players ?? []).map((p) => (p.side === 'L' ? 'L' : 'R')).join('')) });
}
writeJson('leagues.json', leagues);
writeJson('states.json', states);
writeJson('economy.json', economy);
writeJson('calendars.json', calendars);

// (Fase 1) formatos dos estaduais e registro declarativo das competições
const formatErrors = validateFormats(STATE_FORMATS);
for (const e of formatErrors) warn('formato: ' + e);
writeJson('formats.json', STATE_FORMATS);
writeJson('competitions.json', buildCompetitions());

function validateFormats(all) {
  const errs = [];
  for (const [key, f] of Object.entries(all)) {
    const ids = new Set(f.stages.map((s) => s.id));
    if (ids.size !== f.stages.length) errs.push(`${key}: fases duplicadas`);
    if (!ids.has(f.champion)) errs.push(`${key}: campeão em fase inexistente`);
    for (const s of f.stages) {
      const refs = [...s.sources, ...(s.groupSources ?? []).flat()].map((r) => r.stage).filter(Boolean).flat();
      for (const r of [...refs, ...(s.after ?? [])]) if (!ids.has(r)) errs.push(`${key}/${s.id}: referência a ${r}`);
    }
  }
  return errs;
}

function buildCompetitions() {
  const trophies = new Set(fs.existsSync(path.join(ASSETS, 'trophies')) ? fs.readdirSync(path.join(ASSETS, 'trophies')) : []);
  const tr = (...names) => names.find((n) => trophies.has(n + '.png')) ?? null;
  const comps = [];
  // (Etapa 1) calendário real (`real:<id>`) quando existe; senão o MM-DD do original
  const cal = (id) => calendars.find((c) => c.id === `real:${id}`)?.id ?? calendars.find((c) => c.id === id)?.id ?? id;
  const prizeKeys = ['LIGA_A', 'LIGA_B', 'LIGA_C', 'LIGA_D'];
  const serie = ['Série A', 'Série B', 'Série C', 'Série D'];
  for (const d of leagues.filter((x) => x.countryId === BRAZIL && !x.fictional)) {
    comps.push({
      id: d.id, kind: 'league', name: `Brasileirão ${serie[d.division - 1] ?? d.divisionName}`, countryId: BRAZIL, calendarId: cal(d.id), cycle: 'calendar',
      prizeKey: prizeKeys[d.division - 1], trophy: tr(`tr-nacional-bra-d${d.division}`, 'tr-nacional-bra'), priority: 2,
      qualification: {
        format: 'engine: nationalFormat(cfg) — formula ' + d.cfg.formula + (d.cfg.playoffAcesso ? ' + Playoff de Acesso' : ''),
        teams: d.teams, relegated: d.relegated, promoted: d.promoted,
        ...(d.division === 4 ? { serieDReal: true, note: '64 voltam aos estaduais; 4 vêm da C, 28 mantidos, 64 pelos estaduais' } : {}),
      },
    });
  }
  comps.push({
    id: 'BRA-CUP', kind: 'cup', name: 'Copa do Brasil', countryId: BRAZIL, calendarId: cal('BRA-CUP'), cycle: 'calendar', prizeKey: 'NACIONAL_CUP',
    trophy: tr('tr-copa-bra', 'tr-copa'), priority: 3,
    qualification: { pot1: 12, firstPhase: 80, pots: 6, note: 'pote 1 = campeão anterior + Série A (direto nos 16-avos); 1ª fase = resto da A, Série B e vagas estaduais (1/UF + extras pelo tamanho do estadual, máx. 4)' },
  });
  comps.push({ id: 'BRA-SUP', kind: 'supercup', name: 'Supercopa do Brasil', countryId: BRAZIL, calendarId: cal('BRA-SUP'), cycle: 'calendar', prizeKey: 'SUPERCOPA', trophy: tr('tr-supercopa-bra'), priority: 3, qualification: { from: ['campeão da Série A', 'campeão da Copa do Brasil (ou vice)'] } });
  for (const s of states) {
    for (const d of s.divisions) {
      const uf = s.state.toLowerCase();
      comps.push({
        id: `EST-${s.state}-${d.division}`, kind: 'state', name: d.name, countryId: BRAZIL, uf: s.state, calendarId: cal('estaduais'), cycle: 'calendar',
        formatKey: STATE_FORMATS[d.formatKey] ? d.formatKey : undefined, prizeKey: 'ESTADUAL',
        trophy: d.division === 1 ? tr(`tr-estadual-${uf}`, 'tr-estadualgenerico') : tr(`tr-estadual-${uf}-d${d.division}`, 'tr-estadualgenerico'),
        priority: 1,
      });
    }
  }
  // outros países (Etapa 2): ligas, copas, supercopas e playoffs de rebaixamento com os nomes reais
  for (const d of leagues.filter((l) => l.countryId !== BRAZIL)) {
    const code = codeOf(d.countryId) ?? String(d.countryId);
    const region = regionOfCode(code);
    const cycle = SCOPE.regions[region]?.cycle;
    const ac = d.rules ? ['ac-zones', 'ac-final'].includes(d.rules.kind) : d.cfg.aperturaClausura;
    comps.push({
      id: d.id, kind: 'league', name: LEAGUE_NAMES[d.id] ?? `${d.name} - ${d.divisionName}`, countryId: d.countryId,
      calendarId: ac ? 'real:apertura+real:clausura' : cal(d.id), cycle, prizeKey: prizeKeys[d.division - 1], priority: 2,
      trophy: tr(`tr-nacional-${code.toLowerCase()}${d.division > 1 ? `-d${d.division}` : ''}`, 'tr-nacionalgenerico'),
      ...(d.rules ? { qualification: { rules: d.rules } } : {}),
    });
    if (d.division === 1) {
      for (const [id, name] of NATIONAL_CUPS[code] ?? [[`${code}-CUP`, `Copa Nacional (${code})`]]) {
        comps.push({ id, kind: 'cup', name, countryId: d.countryId, calendarId: cal(id), cycle, prizeKey: 'NACIONAL_CUP', trophy: tr(`tr-copa-${code.toLowerCase()}`, 'tr-copa'), priority: 3 });
      }
      if (SUPERCUPS[code]) {
        const [name, teams] = SUPERCUPS[code];
        comps.push({ id: `${code}-SUP`, kind: 'supercup', name, countryId: d.countryId, calendarId: cal(`${code}-SUP`), cycle, prizeKey: 'SUPERCOPA', trophy: tr(`tr-supercopa-${code.toLowerCase()}`, 'tr-supercopa-generico'), priority: 3, qualification: { teams } });
      }
      if (RELEGATION_PLAYOFFS[code]) {
        comps.push({ id: `${code}-PO`, kind: 'cup', name: RELEGATION_PLAYOFFS[code], countryId: d.countryId, calendarId: cal(`${code}-PO`), cycle, priority: 3, qualification: { note: 'playoff de rebaixamento entre divisões (o perdedor fica na divisão de baixo)' } });
      }
    }
  }
  // (Etapa 2) UEFA, AFC e FIFA (formatos e vagas na engine: season/confed.ts)
  comps.push(
    { id: 'UCL', kind: 'continental', name: 'Liga dos Campeões da UEFA', confed: 'UEFA', calendarId: cal('UCL'), cycle: 'split', prizeKey: 'CHAMPIONS', trophy: tr('tr-ligacampeoes'), priority: 4, qualification: { format: 'fase de liga (36 clubes, 8 jogos, potes de 9) → playoff 9º–24º I/V → oitavas, quartas e semi I/V → final única' } },
    { id: 'UEL', kind: 'continental', name: 'Liga Europa da UEFA', confed: 'UEFA', calendarId: cal('UEL'), cycle: 'split', prizeKey: 'EUROPA', trophy: tr('tr-ligaeuropa'), priority: 4, qualification: { format: 'fase de liga (36 clubes, 8 jogos) → playoff → oitavas a final' } },
    { id: 'UECL', kind: 'continental', name: 'Liga Conferência da UEFA', confed: 'UEFA', calendarId: cal('UECL'), cycle: 'split', prizeKey: 'CONFERENCE', trophy: tr('tr-conference'), priority: 4, qualification: { format: 'fase de liga (36 clubes, 6 jogos, potes de 6) → playoff → oitavas a final' } },
    { id: 'UEFA-SUP', kind: 'supercup', name: 'Supercopa da UEFA', confed: 'UEFA', calendarId: cal('UEFA-SUP'), cycle: 'split', prizeKey: 'UEFA_SUPER', trophy: tr('tr-recopaeuropa'), priority: 4 },
    { id: 'ACL', kind: 'continental', name: 'Liga dos Campeões da AFC Elite', confed: 'AFC', calendarId: cal('ACL'), cycle: 'split', prizeKey: 'AFC_ELITE', trophy: tr('tr-ligaafc'), priority: 4, qualification: { format: 'Oeste e Leste (12 cada, 8 jogos) → oitavas I/V por região → quartas, semi e final em Jidá (jogo único)' } },
  );
  // registro preparado (Fase 2/3): continentais e regionais, desligados
  const off = [
    ['LIBERTADORES', 'Copa Libertadores', 'continental', 'libertadores', 'LIBERTADORES', 'tr-libertadores', 4],
    ['SULAMERICANA', 'Copa Sul-Americana', 'continental', 'sulamericana', 'SULAMERICANA', 'tr-sulamericana', 4],
    ['RECOPA', 'Recopa Sul-Americana', 'continental', 'recopa', 'RECOPA', 'tr-recopasulamericana', 4],
    ['INTERCONTINENTAL', 'Copa Intercontinental FIFA', 'continental', 'intercontinental', 'INTERCONTINENTAL', 'tr-intercontinental', 4],
    ['SUPERMUNDIAL', 'Supermundial de Clubes', 'continental', 'supermundial', 'SUPERMUNDIAL', 'tr-supermundial', 4],
    ['NORDESTE', 'Copa do Nordeste', 'cup', 'nordeste', null, 'tr-copanordeste', 3],
    ['COPAVERDE', 'Copa Verde', 'cup', 'copaverde', null, 'tr-copaverde', 3],
    ['SULSUDESTE', 'Copa Sul-Sudeste', 'cup', 'sulsudeste', null, null, 3],
    ['COPAPAULISTA', 'Copa Paulista', 'cup', 'copapaulista', null, 'tr-copapaulista', 3],
  ];
  // Fase 2: continentais e Copa do Nordeste ligados (a engine monta formato e vagas: season/continental.ts)
  const PHASE2 = {
    LIBERTADORES: { format: '1ª fase (6) → 2ª fase (16) → 3ª fase (8) I/V → 8 grupos de 4 I/V → oitavas, quartas, semi I/V → final única neutra', teams: 47, slots: 'ver continental.libertadores' },
    SULAMERICANA: { format: 'preliminar JU (mesmo país) → 8 grupos de 4 I/V (+4 perdedores da 3ª fase da Libertadores) → play-off de oitavas (2ºs × 3ºs da Libertadores) → oitavas, quartas, semi I/V → final única neutra', teams: 48, slots: 'ver continental.sulamericana' },
    RECOPA: { from: ['campeão da Libertadores', 'campeão da Sul-Americana'], legs: 2 },
    INTERCONTINENTAL: { format: 'play-off CAF×OFC → Copa África-Ásia-Pacífico (AFC × vencedor) → Dérbi das Américas (CONCACAF×CONMEBOL) → Challenger Cup → Final (campeão da Liga dos Campeões)', note: 'UEFA = campeão da Liga dos Campeões; AFC = campeão da AFC Elite; CONCACAF/CAF/OFC = convidados sorteados por força' },
    SUPERMUNDIAL: { format: '32 clubes: 8 grupos de 4 (turno) → oitavas a final JU', slots: { UEFA: 12, CONMEBOL: 6, CONCACAF: 4, CAF: 4, AFC: 4, OFC: 1, host: 1 }, periodicity: 'every4 (2029, 2033...) por padrão; opção yearly', note: 'convidados nas confederações sem liga em escopo' },
    NORDESTE: { format: '4 grupos de 4 I/V → quartas JU → semi JU → final I/V', teams: 16, note: 'melhor do estadual de cada UF do NE + 2º de BA/PE/CE + 2º das UFs maiores' },
  };
  for (const [id, name, kind, calId, prizeKey, trophy, priority] of off) {
    const on = PHASE2[id];
    comps.push({
      id, kind, name, calendarId: cal(calId), prizeKey: prizeKey ?? (id === 'NORDESTE' ? 'ESTADUAL' : undefined), trophy: tr(trophy), priority,
      ...(on ? { qualification: on, cycle: 'calendar' } : { disabled: true }),
    });
  }
  const clubIds = new Set(clubs.map(({ club: c }) => c.id));
  const ifClub = (id) => (clubIds.has(id) ? id : undefined);
  return {
    version: 2,
    countries: countryFlags,
    competitions: comps,
    serieD: { ...SERIE_D, ufOrder: ['AC', 'AM', 'RR', 'RO', 'AP', 'PA', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA', 'MT', 'MS', 'GO', 'DF', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS'] },
    nationalCup: { pot1: 12, firstPhase: 80 },
    // Vagas (proposta fiel à regra CONMEBOL 2026; spec §2.6/2.7, confiança Baixa nos números) e
    // campeões de 2025 (resultados reais) para o 1º ano: Libertadores Flamengo, Sul-Americana Lanús,
    // Copa do Brasil Corinthians, Brasileirão Flamengo — Recopa e Supercopa 2026 iguais às reais.
    continental: {
      conmebol: [['ARG', 'ARG-1'], ['URU', 'URU-1'], ['COL', 'COL-1'], ['PAR', 'PAR-1'], ['CHI', 'CHI-1'], ['EQU', 'EQU-1'], ['PER', 'PER-1'], ['BOL', 'BOL-1'], ['VEN', 'VEN-1']]
        .filter(([, l]) => leagues.some((d) => d.id === l)).map(([code, leagueId]) => ({ code, leagueId })),
      // (Etapa 1) sem Bolívia, Peru e Venezuela (fora do escopo): as vagas deles foram redistribuídas entre os 7
      // países em escopo mantendo os totais do formato (grupos 28 = 2 campeões + 26; 2ª fase 13; 1ª fase 6;
      // Sul-Americana 12 diretos + 32 na preliminar). Provisório: a Etapa 2 refaz as competições.
      libertadores: {
        BRA: { groups: 7, f2: 2, f1: 0, cupSlot: true }, ARG: { groups: 6, f2: 2, f1: 0 },
        URU: { groups: 3, f2: 2, f1: 1 }, COL: { groups: 3, f2: 2, f1: 1 },
        PAR: { groups: 2, f2: 2, f1: 1 }, CHI: { groups: 3, f2: 1, f1: 2 }, EQU: { groups: 2, f2: 2, f1: 1 },
      },
      sulamericana: {
        BRA: { groups: 6, prelim: 0 }, ARG: { groups: 6, prelim: 0 },
        URU: { groups: 0, prelim: 6 }, COL: { groups: 0, prelim: 8 }, PAR: { groups: 0, prelim: 6 }, CHI: { groups: 0, prelim: 6 },
        EQU: { groups: 0, prelim: 6 },
      },
      initial: {
        season: 2025,
        LIBERTADORES: ifClub('flarj'),
        SULAMERICANA: ifClub('lanus-arg'),
        cup: { BRA: ifClub('corinthians-bra') },
        league: { BRA: ifClub('flarj') },
      },
      // (Etapa 1) só países em escopo: CONCACAF, CAF e OFC ficam vazias (a engine usa convidados da AFC/UEFA)
      confederations: Object.fromEntries(Object.entries({
        UEFA: ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL', 'BEL', 'TUR', 'AUT', 'SUI', 'RUS', 'UCR', 'NOR', 'SUE'],
        CONCACAF: ['MEX', 'EUA'], CAF: ['MAR', 'ALG', 'AFS'], AFC: ['ARS', 'JAP', 'CRS', 'CAT', 'CHN', 'AUS'], OFC: ['NOZ'],
      }).map(([k, v]) => [k, v.filter(inScope)])),
      nordeste: { ufs: ['BA', 'PE', 'CE', 'RN', 'PB', 'AL', 'SE', 'MA', 'PI'], teams: 16, priorityUfs: ['BA', 'PE', 'CE'] },
    },
    // (Etapa 2) convidados (só os que existem nos dados) e vagas UEFA
    guests: Object.fromEntries(Object.entries(GUESTS).map(([k, list]) => [k, list.filter((id) => clubIds.has(id))])),
    uefa: UEFA_SLOTS,
  };
}
const nameFiles = new Set();
for (const p of namePools) { writeJson(`names/${p.code}.json`, p); nameFiles.add(p.code + '.json'); }
pruneDir(path.join(DATA, 'names'), nameFiles);

const nPlayers = bundles.reduce((a, b) => a + b.players.length, 0);
const counts = {
  countries: countries.length, traits: traits.length, clubs: clubs.length, players: nPlayers,
  youthPlayers: bundles.reduce((a, b) => a + b.players.filter((p) => p.youth).length, 0),
  leagues: leagues.length, leagueCountries: new Set(leagues.map((l) => l.countryId)).size,
  clubsWithLeague: clubs.filter((c) => c.club.leagueId).length,
  states: states.length, calendars: calendars.length, namePools: namePools.length,
};
writeJson('meta.json', {
  version: '2026.1.0',
  generatedAt: new Date().toISOString(),
  source: 'Brasfoot 2026 (conteúdo de terceiros, extraído por packages/data)',
  derived: 'overall/potential/wage/value são derivados (ver packages/data/README.md)',
  counts,
  // (Etapa 1) escopo geográfico: países/regiões/ciclos que geram clubes, ligas e calendários (scope.mjs)
  scope: {
    ...SCOPE,
    countries: SCOPE_CODES,
    countryIds: Object.fromEntries(SCOPE_CODES.map((code) => [code, countries.find((c) => c.code === code)?.id ?? null])),
    leagues: leagues.map((l) => l.id),
  },
});

// ================================================================ 9. assets
const assetStats = {};
if (!SKIP_ASSETS) {
  const sync = (dirName, pairs) => {
    const dir = path.join(ASSETS, dirName);
    const keep = new Set();
    let copied = 0, bytes = 0;
    for (const [from, toName] of pairs) {
      if (!fs.existsSync(from)) { warn(`asset ausente: ${from}`); continue; }
      const to = path.join(dir, toName);
      if (copyAsset(from, to)) copied++;
      keep.add(toName); bytes += fs.statSync(to).size;
    }
    const pruned = pruneDir(dir, keep);
    assetStats[dirName] = { files: keep.size, copied, pruned, mb: +(bytes / 1048576).toFixed(2) };
  };
  sync('crests', clubs.filter((c) => c.assets.crestSrc).map((c) => [src('teams', 'escudos', c.assets.crestSrc), c.club.id + '.png']));
  sync('crests-mini', clubs.filter((c) => c.assets.crestMiniSrc).map((c) => [src('teams', 'escudosMini', c.assets.crestMiniSrc), c.club.id + '.png']));
  const kitDirs = ['camisas', 'camisas2', 'camisas3'];
  sync('kits', clubs.flatMap((c) => c.assets.kitSrcs.map((k, i) => (k ? [src('teams', kitDirs[i], k), `${c.club.id}${i ? '-' + (i + 1) : ''}.png`] : null)).filter(Boolean)));
  const flagsDir = src('BF26', 'aflags'), flagsLDir = src('BF26', 'aflagslarge');
  sync('flags', countries.map((c) => [path.join(flagsDir, `${c.id}.png`), `${c.id}.png`]));
  sync('flags-large', countries.map((c) => [path.join(flagsLDir, `flag_${c.id}.png`), `${c.id}.png`]));
  sync('trophies', fs.readdirSync(src('trofeus')).filter((f) => /\.png$/i.test(f)).map((f) => [src('trofeus', f), slugify(f.slice(0, -4)) + '.png']));
  sync('audio', fs.readdirSync(src('sons')).filter((f) => /\.wav$/i.test(f)).map((f) => [src('sons', f), slugify(f.slice(0, -4)) + '.wav']));
}

// ================================================================ 10. validação
let parseFail = 0;
for (const file of written.keys()) { try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch { parseFail++; warn('JSON inválido: ' + file); } }
let bomFiles = 0;
for (const file of written.keys()) { const b = fs.readFileSync(file); if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bomFiles++; }
const refs = [];
for (const { club } of clubs) { if (club.crest) refs.push(club.crest); if (club.crestMini) refs.push(club.crestMini); refs.push(...club.kits); }
for (const c of countries) refs.push(c.flag, c.flagLarge);
const missingRefs = SKIP_ASSETS ? [] : refs.filter((r) => !fs.existsSync(path.join(ASSETS, r)));
const badIds = clubs.filter(({ club }) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(club.id)).length;

const dirSize = (d) => { let s = 0, n = 0; if (!fs.existsSync(d)) return { n, s }; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const r = dirSize(p); s += r.s; n += r.n; } else { s += fs.statSync(p).size; n++; } } return { n, s }; };
const mb = (b) => (b / 1048576).toFixed(2) + ' MB';

console.log('\n================ RESUMO ================');
console.log('fonte :', SOURCE);
console.log('saída :', PUBLIC);
console.log('contagens:', JSON.stringify(counts));
const sizeOf = (rel) => written.get(path.join(DATA, rel)) ?? 0;
for (const rel of ['meta.json', 'countries.json', 'traits.json', 'clubs-index.json', 'players-market.json', 'leagues.json', 'states.json', 'economy.json', 'calendars.json', 'formats.json', 'competitions.json']) console.log(`  ${rel.padEnd(22)} ${(sizeOf(rel) / 1024).toFixed(1).padStart(9)} KB`);
const cs = dirSize(path.join(DATA, 'clubs')), ns = dirSize(path.join(DATA, 'names'));
console.log(`  clubs/*.json           ${String(cs.n).padStart(5)} arquivos ${mb(cs.s)}${prunedClubs ? ` (${prunedClubs} obsoletos removidos)` : ''}`);
console.log(`  names/*.json           ${String(ns.n).padStart(5)} arquivos ${mb(ns.s)}`);
console.log('data total:', mb(dirSize(DATA).s));
if (!SKIP_ASSETS) {
  for (const [k, v] of Object.entries(assetStats)) console.log(`  assets/${k.padEnd(12)} ${String(v.files).padStart(5)} arquivos ${v.mb} MB (copiados agora: ${v.copied}, removidos: ${v.pruned})`);
  console.log('assets total:', mb(dirSize(ASSETS).s));
}
console.log('validação: JSON inválidos =', parseFail, '| com BOM =', bomFiles, '| refs de asset ausentes =', missingRefs.length, '| ids inválidos =', badIds, '| mojibake corrigido =', mojibakeFixed);
console.log('clubes sem escudo:', clubs.filter((c) => !c.club.crest).map((c) => c.club.sourceId).join(', ') || '—');
console.log('histograma overall (elenco):', Object.entries(ovrHist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));

// dados reais
console.log(`\ndados reais (${REAL_DIR}): ${realData.files.map((f) => `${f.file}${f.ok ? '' : ' (INVÁLIDO)'} c${f.clubs}/j${f.players}`).join(', ') || 'nenhum arquivo'}`);
console.log(`  clubes com finanças reais: ${realStats.clubsReal} | jogadores reais: ${realStats.overrides} → exatos ${realStats.matchedExact}, normalizados ${realStats.matchedNorm}, sem par ${realStats.unmatched} (clubes c/ jogadores ${realStats.clubsWithPlayers}, ids desconhecidos ${realStats.unknownClubs})`);
if (realStats.unmatchedSample.length) console.log('  sem par (amostra):', realStats.unmatchedSample.join(' · '));
const fmtP = (p) => `a=${p.a.toFixed(3)} b=${p.b.toFixed(4)} n=${p.n} países=${p.countries}`;
console.log(`  modelos: Δovr ${fmtP(realStats.models.delta)} | ln k ${fmtP(realStats.models.k)} | ln salário ${fmtP(realStats.models.wageScale)} | ln receita/elenco ${fmtP(realStats.models.revenue)} | ln caixa/receita ${fmtP(realStats.models.balance)}`);

// (Etapa 3) cartas FC 27 e tiers
const fs3 = realStats.fc, ts3 = realStats.tiers;
console.log(`\ncartas FC 27: ${fcData.files.map((f) => `${f.file}${f.ok ? (f.partial ? ' (PARCIAL)' : '') : ' (INVÁLIDO)'} j${f.players}`).join(', ') || 'nenhum arquivo (fc27-*.json ausentes: só tiers + fallback)'}`);
console.log(`  aplicadas ${fs3.applied} em ${fs3.clubs} clubes (exatos ${fs3.matchedExact}, normalizados ${fs3.matchedNorm}, sem par ${fs3.unmatched}, ignoradas no Brasil ${fs3.ignored}, ids desconhecidos ${fs3.unknownClubs}) | fontes ${JSON.stringify(fs3.bySource)}`);
if (fs3.unmatchedSample.length) console.log('  sem par (amostra):', fs3.unmatchedSample.join(' · '));
console.log(`  tiers: ${ts3.clubs} clubes ${JSON.stringify(ts3.byTier)} | ${ts3.players} jogadores nivelados, ${ts3.fixed} com carta FC mantida`);
console.log(`  cobertura FC fraca (< 50%, faixa por liga): ${ts3.weakCoverage.clubs} clubes, ${ts3.weakCoverage.players} jogadores ${JSON.stringify(ts3.weakCoverage.byLeague)}`);
console.log(`  correção curadoria → FC por faixa (mediana FC − curado): ${JSON.stringify(fs3.correction)}`);
{
  // distribuição: mediana do top-11 por clube, resumida por liga (mediana / mín / máx entre os clubes)
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
  const byLeague = new Map();
  for (const b of bundles) {
    const key = b.club.leagueId ?? (b.club.guest ? `convidados-${b.club.confed}` : b.club.countryId === BRAZIL ? 'BRA-estaduais' : 'outros');
    const top = b.players.filter((p) => !p.youth).map((p) => p.overall).sort((x, y) => y - x).slice(0, 11);
    if (!byLeague.has(key)) byLeague.set(key, []);
    byLeague.get(key).push(med(top));
  }
  const rows = [...byLeague].sort((a, b) => med(b[1]) - med(a[1]));
  console.log('  top-11 (mediana do clube) por liga:', rows.map(([k, v]) => `${k} ${med(v).toFixed(1)} [${Math.min(...v)}–${Math.max(...v)}]`).join(' · '));
  const ST = { star: 'CRAQUE', starter: 'titular', reserve: 'reserva', youth: 'base' };
  for (const id of opt('--squads', '').split(',').filter(Boolean)) {
    const b = bundles.find((x) => x.club.id === id);
    if (!b) { console.log(`  (elenco ${id} não encontrado)`); continue; }
    const sorted = b.players.slice().sort((x, y) => y.overall - x.overall);
    console.log(`\n  ${b.club.name} [${id}] ${b.club.leagueId ?? '-'}:`);
    console.log('   ' + sorted.map((p) => `${p.name} ${p.position} ${p.age}a ${statusOf.has(p.id) ? ST[statusOf.get(p.id)] + ' ' : ''}${p.overall}/${p.potential}`).join(' | '));
  }
}

// Exemplos de validação das fórmulas
const sample = (id) => bundles.find((b) => b.club.id === id);
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const M = (v) => (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + ' bi' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + ' mi' : (v / 1e3).toFixed(0) + ' mil');
const SAMPLES = (opt('--samples', '') || 'bayern-ale,realmadrid-esp,machestercity-ing,flarj,palmeiras,fortaleza,goias,botafogopb-bra,alnassr-ara,atletico-ac').split(',');
for (const id of SAMPLES) {
  const b = sample(id); if (!b) { console.log(`\n(amostra ${id} não encontrada)`); continue; }
  const sq = b.players.filter((p) => !p.youth).sort((x, y) => y.value - x.value);
  const f = b.club.finances;
  console.log(`\n${b.club.name} [${b.club.id}] nível ${b.club.level} liga ${b.club.leagueId} | caixa ${M(f.balance)} receita ${M(f.revenue)} folha ${M(f.wageBill)} patrocínio ${M(f.sponsorPerSeason)} | elenco ${M(sq.reduce((s, p) => s + p.value, 0))} | média ovr ${avg(sq.map((p) => p.overall)).toFixed(1)}`);
  for (const p of sq.slice(0, 5)) console.log(`   ${p.name.padEnd(24)} ${p.position} ${p.age}a ovr ${p.overall} pot ${p.potential} val ${M(p.value)} sal ${M(p.wage)}/mês`);
}
// média por nível
const byLevel = {};
for (const b of bundles) { const sq = b.players.filter((p) => !p.youth); (byLevel[b.club.level] ||= []).push(avg(sq.map((p) => p.overall))); }
console.log('\nmédia de elenco por nível:', Object.entries(byLevel).sort((a, b) => a[0] - b[0]).map(([l, v]) => `${l}:${avg(v).toFixed(1)}`).join(' '));
if (warnings.length) {
  console.log(`\navisos (${warnings.length}):`);
  const LIM = argv.includes('--verbose') ? Infinity : 60;
  for (const w of warnings.slice(0, LIM)) console.log('  -', w);
  if (warnings.length > LIM) console.log(`  ... +${warnings.length - LIM} (use --verbose)`);
}
console.log(`\nconcluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (parseFail || missingRefs.length || badIds || bomFiles) process.exitCode = 1;
