// COSMICFUT — fotos de jogadores + tmId verificado (Wikidata + Wikimedia Commons, SOMENTE imagens livres).
//
//   npm run photos:build                       (ligas no escopo + clubes convidados)
//   npm run photos:build -- --scope core       (só as ligas/clubes prioritários)
//   npm run photos:build -- --cache <dir>      (cache; padrão: <tmp>/cosmicfut-photos-cache)
//   npm run photos:build -- --manifest-only    (sem downloads; regera photos.json com o que já existe)
//
// Por que por ELENCO e não por tmId: ~60% dos `tid` herdados do original apontam para OUTRO jogador (ficaram na
// "vaga" quando o nome foi atualizado). Então:
//  1. Clube → item do Wikidata. Votação: os tmIds do clube (mesmo os errados são, em geral, de ex-jogadores DAQUELE
//     clube) → itens (P2446) → times em P54; o clube de futebol mais votado, desempatado por semelhança de nome.
//     Sem votos suficientes → busca (EntitySearch) restrita a P31/P279* Q476028, verificada por nome. Override manual
//     em CLUB_OVERRIDES.
//  2. Elenco do item: pessoas com P54 = clube sem P582 ou P582 ≥ 2024 (rótulos/apelidos, P569, P18, P2446).
//  3. Casamento jogador do jogo × elenco (matchPlayer: nome normalizado + idade, candidato único).
//     Fonte secundária: o tmId do jogo, se o item dele bater por nome + idade. Conflito → vale o elenco.
//  4. Commons (licença/autor/miniatura 250px) → download → manifesto v2:
//     { version: 2, generatedAt,
//       people:  { "<Qid>": { tmId, file, author, license, source } },   // tmId = P2446 verificado (ou null)
//       players: { "<clubId>|<nome normalizado>": "<Qid>" },
//       tmIds:   { "<tmId>": "<Qid>" } }                                  // fallback da API antiga
//
// Requisições sequenciais, pausa entre elas, User-Agent genérico, respeito a 429/Retry-After; tudo em cache.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeName, playerKey } from '../../../apps/web/src/components/game/playerKey.ts';

export { normalizeName, playerKey };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA = path.join(ROOT, 'apps/web/public/data');
const OUT_DIR = path.join(ROOT, 'apps/web/public/assets/players');
const MANIFEST = path.join(DATA, 'photos.json');

const UA = 'COSMICFUT-asset-builder/1.0 (personal non-commercial project)';
const SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH = 250; // largura-padrão de miniatura do Commons
const SPARQL_BATCH = 250;
const META_BATCH = 200;
const COMMONS_BATCH = 50;
const DELAY_API = 1000;
const DELAY_DL = 1500; // upload.wikimedia.org devolve 429 (Retry-After 600s) acima disso
const REF_DATE = new Date('2026-07-01T00:00:00Z');
/** Janela aceita para (idade real − idade no jogo): as idades do original estão, em geral, 3–7 anos abaixo. */
export const AGE_WINDOW = [-2, 9];
const LABEL_LANGS = ['pt', 'en', 'es', 'fr', 'de', 'it', 'nl', 'tr', 'mul', 'pl', 'hr', 'sr-el', 'cs', 'sk', 'sl', 'ro', 'hu', 'sv', 'da', 'nb', 'pt-br', 'ca', 'eu', 'gl'];

const CORE_LEAGUES = ['ING-1', 'ESP-1', 'ITA-1', 'ALE-1', 'FRA-1', 'BRA-1', 'BRA-2', 'ARS-1', 'HOL-1'];
const CORE_CLUBS = ['basaksehir-tur', 'besiktas-tur', 'fenerbahce-tur', 'galatasaray-tur', 'samsunspor-tur', 'trabzonspor-tur', 'intermiami-eua'];
const NEXT_LEAGUES = ['POR-1', 'ARG-1'];
/** Correções manuais clube → Qid (preencher se o relatório apontar erro). */
const CLUB_OVERRIDES = {};

/* ═════════════════════════ casamento de nomes (exportado p/ teste) ═════════════════════════ */

const STOP = new Set(['de', 'da', 'do', 'dos', 'das', 'di', 'del', 'della', 'van', 'der', 'den', 'von', 'el', 'al', 'la', 'le', 'jr', 'junior', 'filho', 'neto', 'sobrinho', 'e', 'y']);
/** Tokens significativos de um nome (normalizado, sem partículas). */
export const nameTokens = (s) => normalizeName(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t));

export function ageAt(iso, ref = REF_DATE) {
  const b = new Date(String(iso).replace(/^\+/, ''));
  if (Number.isNaN(b.getTime())) return null;
  let a = ref.getUTCFullYear() - b.getUTCFullYear();
  if (ref.getUTCMonth() < b.getUTCMonth() || (ref.getUTCMonth() === b.getUTCMonth() && ref.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/** null = sem data de nascimento; true/false = dentro/fora da janela. */
export function ageOk(births, gameAge) {
  const ages = [...(births ?? [])].map((b) => ageAt(b)).filter((a) => a != null);
  if (!ages.length || gameAge == null) return null;
  return ages.some((a) => a - gameAge >= AGE_WINDOW[0] && a - gameAge <= AGE_WINDOW[1]);
}

/**
 * Nível do casamento nome-do-jogo × rótulos de uma pessoa (0 = não casa):
 *  3 — nome normalizado idêntico a um rótulo/apelido ("Allan", "Vini Jr", "Vinicius Junior");
 *  2 — nome composto: todos os tokens do jogo estão num MESMO rótulo, ou um rótulo de 2+ tokens está contido no
 *      nome do jogo ("Rúben Dias" × "Rúben dos Santos Gato Alves Dias");
 *  1 — nome de uma palavra (≥ 4 letras) que é token de um rótulo ("Bakasetas" × "Anastasios Bakasetas").
 */
export function nameLevel(gameName, labels) {
  const n = normalizeName(gameName);
  const g = nameTokens(gameName);
  if (!n) return 0;
  let level = 0;
  for (const label of labels) {
    const ln = normalizeName(label);
    if (!ln) continue;
    if (ln === n) return 3;
    const lt = new Set(nameTokens(label));
    if (g.length >= 2 && g.every((t) => lt.has(t))) level = Math.max(level, 2);
    else if (lt.size >= 2 && [...lt].every((t) => g.includes(t))) level = Math.max(level, 2);
    else if (g.length === 1 && g[0].length >= 4 && lt.has(g[0])) level = Math.max(level, 1);
  }
  return level;
}

/**
 * Casa um jogador do jogo com UMA pessoa do elenco do Wikidata.
 * people: [{ qid, labels: Iterable<string>, births: Iterable<string> }]
 * Regras: idade fora da janela elimina; sem nascimento só vale nível ≥ 2; vence o maior nível com candidato ÚNICO
 * (empate no melhor nível = ambíguo = sem casamento).
 */
export function matchPlayer(gameName, gameAge, people) {
  const byLevel = { 1: [], 2: [], 3: [] };
  for (const p of people) {
    const lvl = nameLevel(gameName, p.labels);
    if (!lvl) continue;
    const ok = ageOk(p.births, gameAge);
    if (ok === false) continue;
    if (ok === null && lvl < 2) continue;
    byLevel[lvl].push(p);
  }
  for (const lvl of [3, 2, 1]) {
    const c = byLevel[lvl];
    if (c.length === 1) return { person: c[0], level: lvl };
    if (c.length > 1) return { person: null, level: lvl, ambiguous: c.length };
  }
  return { person: null, level: 0 };
}

/** Semelhança de nomes de clube (Dice em bigramas, sem palavras genéricas). */
const CLUB_STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'afc', 'cd', 'ud', 'sd', 'rc', 'rcd', 'ca', 'se', 'ec', 'club', 'clube', 'de', 'futebol', 'football', 'futbol', 'fútbol', 'calcio', 'the', 'do', 'da', 'del', 'e', 'y', 'sk', 'fk', 'bk', 'if', 'kv', 'krc', 'vfb', 'vfl', 'tsg', 'sv', 'bv', 'us', 'asd', 'spa', 'srl', 'sad', 'f', 'c', 's', 'a', 'jk', 'sk']);
const clubCore = (s) => normalizeName(s).split(' ').filter((t) => t && !CLUB_STOP.has(t)).join('');
const bigrams = (s) => {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
};
export function clubSimilarity(a, b) {
  const x = clubCore(a);
  const y = clubCore(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return 0.9;
  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = [...by];
  let hit = 0;
  for (const g of bx) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return (2 * hit) / (bx.length + by.length || 1);
}

/* ═════════════════════════ infraestrutura ═════════════════════════ */

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SCOPE = argVal('--scope', 'all');
const CACHE = path.resolve(argVal('--cache', process.env.PHOTOS_CACHE || path.join(os.tmpdir(), 'cosmicfut-photos-cache')));
const MANIFEST_ONLY = args.includes('--manifest-only');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v, pretty = false) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0));
};
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const qidOf = (uri) => String(uri).replace(/^.*\//, '');

async function politeFetch(url, init = {}, tries = 7) {
  let wait = 5000;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...(init.headers || {}) } });
    } catch (err) {
      if (attempt >= tries) throw err;
      log(`  rede falhou (${err.message}); nova tentativa em ${wait / 1000}s`);
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      const ra = Number(res.headers.get('retry-after'));
      const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait;
      log(`  HTTP ${res.status}; aguardando ${Math.round(ms / 1000)}s`);
      await sleep(ms);
      wait *= 2;
      continue;
    }
    throw new Error(`HTTP ${res.status} em ${url.slice(0, 120)}`);
  }
}

/** SPARQL com cache em disco por chave. */
async function sparql(cacheKey, query) {
  const file = path.join(CACHE, 'sparql', `${cacheKey}.json`);
  if (fs.existsSync(file)) return readJson(file);
  const res = await politeFetch(SPARQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }).toString(),
  });
  const json = await res.json();
  const rows = json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
  writeJson(file, rows);
  await sleep(DELAY_API);
  return rows;
}
const langFilter = `FILTER(LANG(?l) IN (${LABEL_LANGS.map((l) => `"${l}"`).join(',')}))`;

/* ═════════════════════════ 0. escopo ═════════════════════════ */
function collectScope() {
  const leagues = readJson(path.join(DATA, 'leagues.json'));
  const index = readJson(path.join(DATA, 'clubs-index.json'));
  const groups = [];
  const byId = new Map(leagues.map((l) => [l.id, l]));
  for (const id of CORE_LEAGUES) if (byId.has(id)) groups.push({ label: id, clubIds: byId.get(id).clubIds });
  groups.push({ label: 'Convidados (TUR + Inter Miami)', clubIds: CORE_CLUBS });
  if (SCOPE !== 'core') {
    for (const id of NEXT_LEAGUES) if (byId.has(id)) groups.push({ label: id, clubIds: byId.get(id).clubIds });
    for (const l of leagues) if (!CORE_LEAGUES.includes(l.id) && !NEXT_LEAGUES.includes(l.id)) groups.push({ label: l.id, clubIds: l.clubIds });
    groups.push({ label: 'Outros convidados', clubIds: index.filter((c) => c.guest && !CORE_CLUBS.includes(c.id)).map((c) => c.id) });
  }
  const clubs = new Map(); // clubId → { id, name, players }
  for (const g of groups)
    for (const id of g.clubIds) {
      if (clubs.has(id)) continue;
      const file = path.join(DATA, 'clubs', `${id}.json`);
      if (!fs.existsSync(file)) continue;
      const j = readJson(file);
      clubs.set(id, { id, name: j.club.name, players: j.players });
    }
  return { groups, clubs };
}

/* ═════════════════════════ 1. tmIds → itens (verificação + votos de clube) ═════════════════════════ */
async function tmLookup(tmIds) {
  const sorted = [...tmIds].sort((a, b) => Number(a) - Number(b));
  const items = new Map(); // tm → { qids:Set, images:[], births:Set, labels:Set, teams:Set }
  const n = Math.ceil(sorted.length / SPARQL_BATCH);
  for (let i = 0; i < sorted.length; i += SPARQL_BATCH) {
    const batch = sorted.slice(i, i + SPARQL_BATCH);
    const key = sha(batch.join(','));
    const values = batch.map((t) => `"${t}"`).join(' ');
    if (!fs.existsSync(path.join(CACHE, 'sparql', `v2-${key}.json`)) || !fs.existsSync(path.join(CACHE, 'sparql', `teams-${key}.json`)))
      log(`tmIds ${i / SPARQL_BATCH + 1}/${n}`);
    const rows = await sparql(
      `v2-${key}`,
      `SELECT ?tm ?item ?img ?birth (GROUP_CONCAT(DISTINCT ?l; separator="|") AS ?labels) WHERE {
  VALUES ?tm { ${values} }
  ?item wdt:P2446 ?tm .
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL { ?item wdt:P569 ?birth . }
  OPTIONAL { ?item rdfs:label|skos:altLabel ?l . FILTER(LANG(?l) IN ("en","pt","es","fr","de","it","nl","mul")) }
} GROUP BY ?tm ?item ?img ?birth`,
    );
    const teams = await sparql(
      `teams-${key}`,
      `SELECT DISTINCT ?tm ?team WHERE {
  VALUES ?tm { ${values} }
  ?item wdt:P2446 ?tm ; wdt:P54 ?team .
}`,
    );
    const get = (tm) => {
      if (!items.has(tm)) items.set(tm, { qids: new Set(), images: [], births: new Set(), labels: new Set(), teams: new Set() });
      return items.get(tm);
    };
    for (const r of rows) {
      const e = get(r.tm);
      e.qids.add(qidOf(r.item));
      if (r.img && !e.images.includes(r.img)) e.images.push(r.img);
      if (r.birth) e.births.add(r.birth);
      for (const l of r.labels ? r.labels.split('|') : []) e.labels.add(l);
    }
    for (const r of teams) get(r.tm).teams.add(qidOf(r.team));
  }
  return items;
}

/* ═════════════════════════ 2. clube → item ═════════════════════════ */
async function teamMeta(qids) {
  const out = new Map();
  const sorted = [...qids].sort();
  for (let i = 0; i < sorted.length; i += META_BATCH) {
    const batch = sorted.slice(i, i + META_BATCH);
    const rows = await sparql(
      `teammeta-${sha(batch.join(','))}`,
      `SELECT ?team ?isClub ?isNational (GROUP_CONCAT(DISTINCT ?l; separator="|") AS ?labels) WHERE {
  VALUES ?team { ${batch.map((q) => `wd:${q}`).join(' ')} }
  BIND(EXISTS { ?team wdt:P31/wdt:P279* wd:Q476028 } AS ?isClub)
  BIND(EXISTS { ?team wdt:P31/wdt:P279* wd:Q6979593 } AS ?isNational)
  OPTIONAL { ?team rdfs:label|skos:altLabel ?l . FILTER(LANG(?l) IN ("en","pt","es","mul","de","fr","it","nl","tr")) }
} GROUP BY ?team ?isClub ?isNational`,
    );
    for (const r of rows)
      out.set(qidOf(r.team), { isClub: r.isClub === 'true' || r.isClub === '1', isNational: r.isNational === 'true' || r.isNational === '1', labels: r.labels ? r.labels.split('|') : [] });
  }
  return out;
}

async function searchClub(name) {
  const rows = await sparql(
    `search-${sha(name)}`,
    `SELECT DISTINCT ?item (GROUP_CONCAT(DISTINCT ?l; separator="|") AS ?labels) WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" ; wikibase:endpoint "www.wikidata.org" ;
                    mwapi:search ${JSON.stringify(name)} ; mwapi:language "pt" ; mwapi:limit "25" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P31/wdt:P279* wd:Q476028 .
  OPTIONAL { ?item rdfs:label|skos:altLabel ?l . FILTER(LANG(?l) IN ("en","pt","es","mul")) }
} GROUP BY ?item`,
  );
  return rows.map((r) => ({ qid: qidOf(r.item), labels: r.labels ? r.labels.split('|') : [] }));
}

const bestSim = (name, labels) => Math.max(0, ...labels.map((l) => clubSimilarity(name, l)));

async function resolveClubs(clubs, tmItems) {
  const cacheFile = path.join(CACHE, 'clubs-resolved.json');
  const votesByClub = new Map();
  const allCandidates = new Set();
  for (const c of clubs.values()) {
    const votes = new Map();
    for (const p of c.players) {
      const e = p.tmId && tmItems.get(String(p.tmId));
      if (!e) continue;
      for (const t of e.teams) votes.set(t, (votes.get(t) ?? 0) + 1);
    }
    const top = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 8);
    votesByClub.set(c.id, top);
    top.forEach(([q]) => allCandidates.add(q));
  }
  log(`metadados de ${allCandidates.size} times candidatos`);
  const meta = await teamMeta(allCandidates);

  const resolved = {};
  for (const c of clubs.values()) {
    if (CLUB_OVERRIDES[c.id]) {
      resolved[c.id] = { qid: CLUB_OVERRIDES[c.id], method: 'override' };
      continue;
    }
    const cands = votesByClub
      .get(c.id)
      .map(([qid, votes]) => ({ qid, votes, m: meta.get(qid) }))
      .filter((x) => x.m && x.m.isClub && !x.m.isNational)
      .map((x) => ({ ...x, sim: bestSim(c.name, x.m.labels), label: x.m.labels[0] }));
    const best = cands[0];
    if (best && best.votes >= 3) {
      // entre os que têm ≥ 70% dos votos do primeiro, o de nome mais parecido
      const close = cands.filter((x) => x.votes >= best.votes * 0.7).sort((a, b) => b.sim - a.sim || b.votes - a.votes);
      const pick = close[0];
      if (pick.sim >= 0.35 || pick.votes >= 8) {
        resolved[c.id] = { qid: pick.qid, label: pick.label, votes: pick.votes, sim: +pick.sim.toFixed(2), method: 'vote' };
        continue;
      }
    }
    // fallback: busca por nome restrita a clubes de futebol
    const found = await searchClub(c.name);
    const scored = found.map((f) => ({ ...f, sim: bestSim(c.name, f.labels) })).sort((a, b) => b.sim - a.sim);
    if (scored[0] && scored[0].sim >= 0.6 && (!scored[1] || scored[1].sim < scored[0].sim)) {
      resolved[c.id] = { qid: scored[0].qid, label: scored[0].labels[0], sim: +scored[0].sim.toFixed(2), method: 'search' };
    } else {
      resolved[c.id] = { qid: null, method: 'unresolved', hint: best ? `${best.label} (${best.votes} votos, sim ${best.sim.toFixed(2)})` : scored[0]?.labels[0] ?? null };
    }
  }
  writeJson(cacheFile, resolved, true);
  return resolved;
}

/* ═════════════════════════ 3. elencos ═════════════════════════ */
async function roster(qid) {
  const rows = await sparql(
    `roster-${qid}`,
    `SELECT ?p ?img ?birth ?tm (GROUP_CONCAT(DISTINCT ?l; separator="|") AS ?labels) WHERE {
  ?p p:P54 ?st . ?st ps:P54 wd:${qid} .
  OPTIONAL { ?st pq:P582 ?end . }
  FILTER(!BOUND(?end) || YEAR(?end) >= 2024)
  OPTIONAL { ?p wdt:P18 ?img . }
  OPTIONAL { ?p wdt:P569 ?birth . }
  OPTIONAL { ?p wdt:P2446 ?tm . }
  OPTIONAL { ?p rdfs:label|skos:altLabel ?l . ${langFilter} }
} GROUP BY ?p ?img ?birth ?tm`,
  );
  const people = new Map();
  for (const r of rows) {
    const qid2 = qidOf(r.p);
    const e = people.get(qid2) ?? { qid: qid2, labels: new Set(), births: new Set(), images: [], tmIds: new Set() };
    for (const l of r.labels ? r.labels.split('|') : []) e.labels.add(l);
    if (r.birth) e.births.add(r.birth);
    if (r.img && !e.images.includes(r.img)) e.images.push(r.img);
    if (r.tm) e.tmIds.add(r.tm);
    people.set(qid2, e);
  }
  return [...people.values()];
}

/* ═════════════════════════ 4. Commons + downloads ═════════════════════════ */
const fileNameOf = (url) => decodeURIComponent(url.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ');
const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
const cleanArtist = (s) =>
  String(s ?? '')
    .replace(/\(\s*(talk|discuss[aã]o|contribs?)\s*\)/gi, ' ')
    .replace(/\d{1,2}:\d{2},?\s+\d{1,2}\s+\p{L}+\s+\d{4}\s*\(UTC\)/gu, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
export function normalizeLicense(shortName) {
  const s = String(shortName ?? '').trim();
  if (!s) return null;
  if (/^cc0/i.test(s) || /zero/i.test(s)) return 'CC0';
  if (/^public domain|^pd\b|^pd-/i.test(s)) return 'Public domain';
  const m = s.match(/^cc[- ]by(-sa)?[- ]?(\d(?:\.\d)?)?/i);
  if (m) return `CC BY${m[1] ? '-SA' : ''}${m[2] ? ` ${m[2]}` : ''}`;
  return null;
}

async function commonsInfo(fileNames) {
  const cacheFile = path.join(CACHE, 'commons.json');
  const cache = fs.existsSync(cacheFile) ? readJson(cacheFile) : {};
  const missing = [...new Set(fileNames)].filter((f) => !(f in cache));
  for (let i = 0; i < missing.length; i += COMMONS_BATCH) {
    const batch = missing.slice(i, i + COMMONS_BATCH);
    log(`Commons ${i / COMMONS_BATCH + 1}/${Math.ceil(missing.length / COMMONS_BATCH)}`);
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'extmetadata|url|mime',
      iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'LicenseShortName|Artist|Credit|UsageTerms|NonFree',
      titles: batch.map((f) => `File:${f}`).join('|'),
    });
    const res = await politeFetch(COMMONS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const json = await res.json();
    const norm = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of json.query?.pages ?? []) {
      const name = (norm.get(page.title) ?? page.title).replace(/^File:/, '');
      const ii = page.imageinfo?.[0];
      if (!ii) {
        cache[name] = { missing: true };
        continue;
      }
      const md = ii.extmetadata ?? {};
      cache[name] = {
        licenseRaw: md.LicenseShortName?.value ?? null,
        nonFree: md.NonFree?.value ?? null,
        artist: stripHtml(md.Artist?.value) || stripHtml(md.Credit?.value) || null,
        thumb: ii.thumburl ?? ii.url ?? null,
        page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`,
        mime: ii.mime ?? null,
      };
    }
    for (const f of batch) if (!(f in cache)) cache[f] = { missing: true };
    writeJson(cacheFile, cache);
    await sleep(DELAY_API);
  }
  return cache;
}

const extOf = (url, type) => {
  if (/png/.test(type ?? '')) return 'png';
  if (/webp/.test(type ?? '')) return 'webp';
  if (/jpe?g/.test(type ?? '')) return 'jpg';
  const m = String(url).toLowerCase().match(/\.(jpe?g|png|webp)(?:$|\?)/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
};
const existingFile = (id) => ['jpg', 'png', 'webp'].map((e) => `${id}.${e}`).find((f) => fs.existsSync(path.join(OUT_DIR, f)));

/* ═════════════════════════ principal ═════════════════════════ */
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`cache: ${CACHE}`);
  const { groups, clubs } = collectScope();
  const tmIds = new Set();
  for (const c of clubs.values()) for (const p of c.players) if (p.tmId) tmIds.add(String(p.tmId));
  log(`${clubs.size} clubes, ${tmIds.size} tmIds distintos`);

  const tmItems = await tmLookup(tmIds);
  const resolved = await resolveClubs(clubs, tmItems);
  const unresolved = Object.entries(resolved).filter(([, r]) => !r.qid);
  log(`clubes resolvidos: ${clubs.size - unresolved.length}/${clubs.size}`);

  // registro "arquivo baixado → arquivo do Commons" (para reaproveitar downloads de execuções anteriores)
  const dlFile = path.join(CACHE, 'downloads.json');
  const downloads = fs.existsSync(dlFile) ? readJson(dlFile) : {};
  for (const [tm, e] of tmItems) {
    const have = existingFile(tm);
    if (have && !downloads[tm] && e.qids.size === 1 && e.images[0]) downloads[tm] = fileNameOf(e.images[0]);
  }

  /* casamento */
  const people = new Map(); // qid → { qid, labels, births, images, tmIds }
  const players = {}; // key → qid
  const stats = { roster: 0, tmOnly: 0, conflictRoster: 0, ambiguous: 0, none: 0 };
  const perClub = new Map();
  const rosterQids = [...new Set(Object.values(resolved).map((r) => r.qid).filter(Boolean))];
  let k = 0;
  for (const qid of rosterQids) {
    if (!fs.existsSync(path.join(CACHE, 'sparql', `roster-${qid}.json`)) && ++k % 25 === 1) log(`elencos ${k}…`);
    perClub.set(qid, await roster(qid));
  }
  for (const c of clubs.values()) {
    const r = resolved[c.id];
    const pool = r?.qid ? perClub.get(r.qid) ?? [] : [];
    for (const p of c.players) {
      const key = playerKey(c.id, p.name);
      let chosen = null;
      const m = matchPlayer(p.name, p.age, pool);
      if (m.person) chosen = m.person;
      else if (m.ambiguous) stats.ambiguous++;
      // fonte secundária: o tmId do jogo, verificado por nome + idade
      let viaTm = null;
      const e = p.tmId && tmItems.get(String(p.tmId));
      if (e && e.qids.size === 1) {
        const cand = { qid: [...e.qids][0], labels: e.labels, births: e.births, images: e.images, tmIds: new Set([String(p.tmId)]) };
        if (matchPlayer(p.name, p.age, [cand]).level >= 2) viaTm = cand;
      }
      if (chosen) {
        stats.roster++;
        if (viaTm && viaTm.qid !== chosen.qid) stats.conflictRoster++;
      } else if (viaTm) {
        chosen = viaTm;
        stats.tmOnly++;
      } else {
        stats.none++;
        continue;
      }
      const prev = people.get(chosen.qid);
      if (prev) {
        chosen.labels.forEach((l) => prev.labels.add(l));
        chosen.tmIds.forEach((t) => prev.tmIds.add(t));
        for (const i of chosen.images) if (!prev.images.includes(i)) prev.images.push(i);
      } else people.set(chosen.qid, { ...chosen, labels: new Set(chosen.labels), tmIds: new Set(chosen.tmIds), images: [...chosen.images] });
      players[key] = chosen.qid;
    }
  }

  /* imagens */
  const pickTm = (p) => [...p.tmIds].filter((t) => /^\d+$/.test(t)).sort((a, b) => Number(a) - Number(b))[0] ?? null;
  const fileIdOf = (p) => pickTm(p) ?? p.qid;
  const wanted = new Map(); // qid → commons file name
  for (const p of people.values()) {
    if (!p.images.length) continue;
    const id = fileIdOf(p);
    const names = p.images.map(fileNameOf);
    wanted.set(p.qid, downloads[id] && names.includes(downloads[id]) ? downloads[id] : names[0]);
  }
  const info = await commonsInfo([...wanted.values()]);

  // ordem de prioridade dos downloads = ordem dos grupos
  const order = [];
  const seen = new Set();
  for (const g of groups)
    for (const id of g.clubIds) {
      const c = clubs.get(id);
      if (!c) continue;
      for (const p of c.players) {
        const q = players[playerKey(c.id, p.name)];
        if (q && !seen.has(q)) {
          seen.add(q);
          order.push(q);
        }
      }
    }

  const manifestPeople = {};
  const pending = [];
  let notFree = 0;
  for (const qid of order) {
    const p = people.get(qid);
    const tmId = pickTm(p);
    const entry = { tmId: tmId ? Number(tmId) : null, file: null };
    const fname = wanted.get(qid);
    const c = fname && info[fname];
    if (c && !c.missing && c.thumb) {
      const license = c.nonFree && /true|1/i.test(c.nonFree) ? null : normalizeLicense(c.licenseRaw);
      if (!license) notFree++;
      else {
        const id = fileIdOf(p);
        Object.assign(entry, { author: cleanArtist(c.artist) || 'Autor desconhecido', license, source: c.page });
        const have = existingFile(id);
        if (have && downloads[id] === fname) entry.file = `players/${have}`;
        else pending.push({ qid, id, fname, url: c.thumb });
      }
    }
    manifestPeople[qid] = entry;
  }

  const flush = () => writeManifest(manifestPeople, players);
  if (!MANIFEST_ONLY && pending.length) {
    log(`baixando ${pending.length} miniaturas`);
    let n = 0;
    for (const job of pending) {
      try {
        const res = await politeFetch(job.url);
        const type = res.headers.get('content-type') ?? '';
        if (!/^image\//.test(type)) throw new Error(`tipo inesperado ${type}`);
        const buf = Buffer.from(await res.arrayBuffer());
        for (const old of ['jpg', 'png', 'webp']) {
          const f = path.join(OUT_DIR, `${job.id}.${old}`);
          if (fs.existsSync(f)) fs.unlinkSync(f); // foto antiga de outra imagem do mesmo id
        }
        const file = `${job.id}.${extOf(job.url, type)}`;
        fs.writeFileSync(path.join(OUT_DIR, file), buf);
        downloads[job.id] = job.fname;
        manifestPeople[job.qid].file = `players/${file}`;
      } catch (err) {
        log(`  falhou ${job.id}: ${err.message}`);
      }
      if (++n % 50 === 0) {
        log(`  ${n}/${pending.length}`);
        writeJson(dlFile, downloads);
        flush();
      }
      await sleep(DELAY_DL);
    }
  }
  writeJson(dlFile, downloads);
  // entradas sem foto e sem tmId não servem para nada
  for (const [q, e] of Object.entries(manifestPeople)) if (!e.file && e.tmId == null) delete manifestPeople[q];
  for (const [key, q] of Object.entries(players)) if (!manifestPeople[q]) delete players[key];
  flush();

  /* relatório */
  writeJson(path.join(CACHE, 'unresolved-clubs.json'), Object.fromEntries(unresolved), true);
  log('casamento:', JSON.stringify(stats), `não-livres: ${notFree}`);
  if (unresolved.length) console.log('Clubes sem item no Wikidata:', unresolved.map(([id, r]) => `${id}${r.hint ? ` (~${r.hint})` : ''}`).join(', '));
  console.log('\nCobertura (jogadores / identificados / com foto / com tmId verificado):');
  for (const g of groups) {
    let total = 0, ident = 0, photo = 0, tm = 0;
    for (const id of g.clubIds) {
      const c = clubs.get(id);
      if (!c) continue;
      for (const p of c.players) {
        total++;
        const q = players[playerKey(c.id, p.name)];
        if (!q) continue;
        ident++;
        if (manifestPeople[q].file) photo++;
        if (manifestPeople[q].tmId != null) tm++;
      }
    }
    const pct = (x) => (total ? ((100 * x) / total).toFixed(1) : '0.0').padStart(5);
    console.log(`  ${g.label.padEnd(30)} ${String(total).padStart(5)}  ident ${String(ident).padStart(5)} ${pct(ident)}%  foto ${String(photo).padStart(5)} ${pct(photo)}%  tm ${String(tm).padStart(5)} ${pct(tm)}%`);
  }
  const lic = {};
  let bytes = 0;
  const used = new Set();
  for (const e of Object.values(manifestPeople)) {
    if (!e.file) continue;
    lic[e.license] = (lic[e.license] ?? 0) + 1;
    used.add(path.basename(e.file));
    bytes += fs.statSync(path.join(OUT_DIR, path.basename(e.file))).size;
  }
  const orphans = fs.readdirSync(OUT_DIR).filter((f) => !used.has(f));
  console.log('\nLicenças:', JSON.stringify(lic));
  console.log(`Total: ${used.size} fotos, ${(bytes / 1024 / 1024).toFixed(1)} MB` + (orphans.length ? ` (+${orphans.length} arquivos fora do manifesto)` : ''));
}

function writeManifest(people, players) {
  const p = {};
  for (const [q, e] of Object.entries(people).sort()) {
    if (!e.file && e.tmId == null) continue;
    p[q] = e.file ? { tmId: e.tmId, file: e.file, author: e.author, license: e.license, source: e.source } : { tmId: e.tmId };
  }
  const tmIds = {};
  for (const [q, e] of Object.entries(p)) if (e.tmId != null) tmIds[e.tmId] = q;
  const pl = Object.fromEntries(Object.entries(players).filter(([, q]) => p[q]).sort());
  writeJson(MANIFEST, { version: 2, generatedAt: new Date().toISOString(), people: p, players: pl, tmIds });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
