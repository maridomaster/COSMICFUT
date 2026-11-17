#!/usr/bin/env node
'use strict';
/*
 * Brasfoot 2026 team file (.ban) decoder.
 *
 * Format: plain (uncompressed, unencrypted) Java Object Serialization stream
 * (magic AC ED 00 05) containing a single object of class `e.t` (team) whose
 * fields `l` and `m` are java.util.ArrayList<e.g> (players). Field names are
 * obfuscated; meanings below were inferred (see README section of the report).
 *
 * Usage:
 *   node decode_ban.js <file.ban>                     -> prints JSON of one club
 *   node decode_ban.js --stats <teamsDir>             -> decodes all .ban, prints summary
 *   node decode_ban.js --sample <out.json> <f1> [f2...] -> writes array of decoded clubs
 * Options:
 *   --lang <default_lang.xml>  country-name table (default: <ban dir>/../arquivos/default_lang.xml)
 *   --raw                      also include raw obfuscated fields
 */
const fs = require('fs');
const path = require('path');
const { JavaReader } = require('./javaser');

const POSITIONS = ['GOL', 'LAT', 'ZAG', 'MEI', 'ATA'];
const POSITION_NAMES = ['Goleiro', 'Lateral', 'Zagueiro', 'Meia', 'Atacante'];
// Characteristic ids (shared space): 0-3 goalkeeper only, 4-13 outfield only.
const TRAITS = [
  'Colocação', 'Defesa de Pênaltis', 'Reflexos', 'Saída do Gol',
  'Armação', 'Cabeceio', 'Cruzamento', 'Desarme', 'Drible', 'Finalização',
  'Marcação', 'Passe', 'Resistência', 'Velocidade',
];
// Brazilian state index (team field `b`, only meaningful when country == 29 Brasil)
const UF = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const BRASIL = 29;

const countryCache = new Map();
function loadCountries(langPath) {
  if (!langPath) return null;
  if (countryCache.has(langPath)) return countryCache.get(langPath);
  let table = null;
  try {
    const xml = fs.readFileSync(langPath, 'utf8');
    table = [];
    const re = /<entry key="P(\d+)">([^<]*)<\/entry>/g;
    let m;
    while ((m = re.exec(xml))) table[+m[1]] = m[2].trim();
  } catch { table = null; }
  countryCache.set(langPath, table);
  return table;
}

function country(id, table) {
  return { id, nome: table && table[id] !== undefined ? table[id] : null };
}

function decodePlayer(p, countries, raw) {
  const out = {
    nome: p.a,
    posicao: POSITIONS[p.e] ?? `?${p.e}`,
    posicao_id: p.e,
    idade: p.d,
    nacionalidade: country(p.c, countries),
    lado: p.i === 1 ? 'E' : p.i === 0 ? 'D' : `?${p.i}`,           // i: 0 direito / 1 esquerdo
    caracteristicas: [p.g, p.h].map(x => TRAITS[x] ?? `?${x}`),
    caracteristicas_ids: [p.g, p.h],
    craque: p.b,                       // b: rare flag (~0.4%) – "craque"/estrela
    destaque: p.f === 1,               // f: ~37% – titular/jogador de destaque (inferido)
    top_mundial: p.j,                  // j: elite mundial (Mbappé, Haaland, Messi...)
    forca_hash: p.hash,                // 0..10 normalmente; 11..89 em arquivos editados (ver relatório)
    tm_id: p.tid || null,              // provável ID Transfermarkt do jogador
  };
  if (raw) out.raw = Object.fromEntries(Object.entries(p).filter(([k]) => k !== '$class'));
  return out;
}

function decodeBan(file, opts = {}) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || buf.readUInt32BE(0) !== 0xACED0005) throw new Error('not a Java serialization stream');
  const r = new JavaReader(buf);
  const contents = r.readStream();
  if (contents.length !== 1) throw new Error(`expected 1 top-level object, got ${contents.length}`);
  const t = contents[0];
  if (!t || t.$class !== 'e.t') throw new Error('top-level object is not e.t (team): ' + (t && t.$class));
  const langPath = opts.lang || path.join(path.dirname(path.resolve(file)), '..', 'arquivos', 'default_lang.xml');
  const countries = loadCountries(langPath);
  const items = L => (L && L.$items ? L.$items : []);
  for (const p of [...items(t.l), ...items(t.m)]) if (!p || p.$class !== 'e.g') throw new Error('list item is not e.g (player)');

  const club = {
    arquivo: path.basename(file),
    versao_formato: t.vid,                        // vid: always 185
    nome: t.e,
    id_arquivo: t.d,                              // d: basename for teams/escudos|camisas/<d>.png
    cor_primaria: t.cor1,
    cor_secundaria: t.cor2,
    estadio: t.f,
    capacidade: t.g,
    tecnico: t.h,
    tecnico_nacionalidade: country(t.i, countries),
    pais: country(t.a, countries),
    estado: t.a === BRASIL && t.b >= 0 && t.b < UF.length ? UF[t.b] : null,
    estado_raw: t.b,                              // 0..26 UF (Brasil); 0/255/outros fora do Brasil
    nivel: t.c,                                   // 1..24 força/nível do time
    reputacao: t.n,                               // 0..5 (corr. 0.72 com nivel)
    o_desconhecido: t.o,                          // 0..18, significado incerto
    id_global: t.id || null,                      // id alfabético global (0 = sem id)
    valido: t.valid,
    jogadores: items(t.l).map(p => decodePlayer(p, countries, opts.raw)),
    juniores: items(t.m).map(p => decodePlayer(p, countries, opts.raw)), // m: categoria de base (inferido)
  };
  if (opts.raw) club.raw = { a: t.a, aid: t.aid, b: t.b, c: t.c, g: t.g, i: t.i, id: t.id, n: t.n, o: t.o, sid: t.sid, tid: t.tid, valid: t.valid, vid: t.vid };
  return club;
}

function stats(dir, opts) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.ban'));
  let ok = 0, nPlayers = 0, nYouth = 0;
  const errors = [], pos = {}, age = {}, hash = {}, lvl = {}, rep = {}, traits = {}, nat = {}, countriesT = {};
  let ageMin = 1e9, ageMax = -1, hMin = 1e9, hMax = -1, craque = 0, top = 0, destaque = 0, canhoto = 0, withTm = 0;
  let escudoMatches = 0;
  const inc = (m, k) => { m[k] = (m[k] || 0) + 1; };
  for (const f of files) {
    try {
      const c = decodeBan(path.join(dir, f), opts);
      ok++;
      inc(lvl, c.nivel); inc(rep, c.reputacao); inc(countriesT, c.pais.nome ?? c.pais.id);
      if (fs.existsSync(path.join(dir, 'escudos', c.id_arquivo + '.png'))) escudoMatches++;
      nYouth += c.juniores.length;
      for (const p of [...c.jogadores, ...c.juniores]) {
        if (c.jogadores.includes(p)) nPlayers++;
        inc(pos, p.posicao); inc(age, p.idade); inc(hash, p.forca_hash);
        inc(nat, p.nacionalidade.nome ?? p.nacionalidade.id);
        p.caracteristicas.forEach(x => inc(traits, p.posicao + ':' + x));
        ageMin = Math.min(ageMin, p.idade); ageMax = Math.max(ageMax, p.idade);
        hMin = Math.min(hMin, p.forca_hash); hMax = Math.max(hMax, p.forca_hash);
        if (p.craque) craque++; if (p.top_mundial) top++; if (p.destaque) destaque++;
        if (p.lado === 'E') canhoto++; if (p.tm_id) withTm++;
      }
    } catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  const top15 = m => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    arquivos_ban: files.length, decodificados_ok: ok, erros: errors,
    jogadores_elenco: nPlayers, jogadores_juniores: nYouth,
    posicoes: pos, idade: { min: ageMin, max: ageMax, dist: age },
    forca_hash: { min: hMin, max: hMax, dist: hash },
    nivel_times: lvl, reputacao_times: rep,
    craques: craque, top_mundial: top, destaques: destaque, canhotos: canhoto, com_tm_id: withTm,
    escudo_png_encontrado: escudoMatches,
    paises_times_top15: top15(countriesT), nacionalidades_top15: top15(nat),
    caracteristicas_por_posicao: traits,
  };
}

function main(argv) {
  const opts = { raw: false, lang: null };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--raw') opts.raw = true;
    else if (argv[i] === '--lang') opts.lang = argv[++i];
    else args.push(argv[i]);
  }
  if (args[0] === '--stats') {
    console.log(JSON.stringify(stats(args[1], opts), null, 2));
  } else if (args[0] === '--sample') {
    const out = args[1];
    const clubs = args.slice(2).map(f => decodeBan(f, opts));
    fs.writeFileSync(out, JSON.stringify(clubs, null, 2), 'utf8');
    console.log(`wrote ${clubs.length} clubs to ${out}`);
  } else if (args[0]) {
    process.stdout.write(JSON.stringify(decodeBan(args[0], opts), null, 2) + '\n');
  } else {
    console.error('usage: node decode_ban.js [--raw] [--lang default_lang.xml] <file.ban> | --stats <dir> | --sample <out.json> <files...>');
    process.exit(2);
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { decodeBan, TRAITS, POSITIONS, UF };
