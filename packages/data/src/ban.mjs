// Decodificador dos arquivos de time (.ban) — port ESM de tools/extract/decode_ban.js.
// Formato: serialização Java pura (AC ED 00 05) com um objeto `e.t` (time) cujos
// campos `l` (elenco) e `m` (base) são ArrayList<e.g> (jogadores). Nomes de campos ofuscados.
import fs from 'node:fs';
import { readJavaSerialized } from './javaser.mjs';

const items = (L) => (L && L.$items ? L.$items : []);

/** Devolve o objeto bruto do time, com listas de jogadores já achatadas. */
export function readBan(file) {
  const contents = readJavaSerialized(fs.readFileSync(file));
  if (contents.length !== 1) throw new Error(`expected 1 top-level object, got ${contents.length}`);
  const t = contents[0];
  if (!t || t.$class !== 'e.t') throw new Error('top-level object is not e.t (team)');
  const squad = items(t.l), youth = items(t.m);
  for (const p of [...squad, ...youth]) if (!p || p.$class !== 'e.g') throw new Error('list item is not e.g (player)');
  return {
    name: t.e,            // nome
    slug: t.d,            // basename de escudos/camisas
    cor1: t.cor1, cor2: t.cor2,
    stadium: t.f, capacity: t.g,
    coach: t.h, coachNat: t.i,
    country: t.a,         // índice P<n>
    stateIdx: t.b,        // 0..26 UF (só Brasil)
    level: t.c,           // 1..24
    reputation: t.n,      // 0..5
    o: t.o, gid: t.id, sid: t.sid, aid: t.aid, tid: t.tid, valid: t.valid, vid: t.vid,
    squad: squad.map(rawPlayer),
    youth: youth.map(rawPlayer),
  };
}

function rawPlayer(p) {
  return {
    name: p.a,
    nat: p.c,
    age: p.d,
    pos: p.e,          // 0..4 GOL LAT ZAG MEI ATA
    side: p.i,         // 0 direito, 1 esquerdo
    t1: p.g, t2: p.h,  // características
    star: !!p.b,       // craque
    highlight: p.f === 1,
    worldClass: !!p.j,
    hash: p.hash,      // 0..10 variação de força
    tmId: p.tid || null,
  };
}
