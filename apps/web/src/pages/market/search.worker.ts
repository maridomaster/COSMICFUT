/**
 * Busca do mercado em Web Worker: players-market.json (84 mil linhas) vira colunas tipadas.
 *
 * Duas camadas:
 *  - BASE: as colunas lidas do JSON (imutáveis);
 *  - EFETIVA: base + "índice de mercado" da carreira (ver ./marketIndex.ts) — idade/overall/potencial/
 *    valor/salário/clube atuais, juniores gerados (linhas novas) e aposentados (removidos).
 * Cada ordenação tem um índice pré-ordenado sobre as colunas efetivas, refeito de forma preguiçosa
 * (só a ordenação usada) quando chega um índice novo; uma consulta é um único passe filtrando
 * nessa ordem (sem sort por consulta) — tipicamente poucos ms.
 */
import type { ClubIndexEntry, PlayersMarket, Position } from '@cosmicfut/shared';
import type { FromWorker, MarketIndex, MarketRowOut, SearchQuery, SortKey, ToWorker } from './searchTypes';

interface Ctx {
  postMessage(m: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const ctx = self as unknown as Ctx;
/** idade mínima no jogo (= MIN_PLAYER_AGE da engine; o worker não carrega a engine) */
const MIN_AGE = 17;

/** margem de evolução pela idade (= growthGap da engine) */
const GAP: Record<number, number> = { 15: 22, 16: 20, 17: 18, 18: 16, 19: 14, 20: 12, 21: 10, 22: 8, 23: 6, 24: 4, 25: 3, 26: 2, 27: 1 };
/** potencial real pela idade (= realisticPotential da engine): quem passou do auge não cresce mais */
function realPot(a: number, o: number, p: number): number {
  if (a <= 23) return Math.max(p, o);
  return Math.max(o, Math.min(p, o + (GAP[a] ?? 0)));
}
/** aplica o potencial real a todas as linhas (idempotente) */
function applyRealPotential(): void {
  for (let i = 0; i < n; i++) pot[i] = realPot(age[i], ovr[i], pot[i]);
}

/* ── base (JSON) ── */
let n0 = 0;
let positions: Position[] = [];
let clubs: string[] = [];
let clubIdxById = new Map<string, number>();
let bClub: Int32Array;
let bAge: Uint8Array;
let bOvr: Uint8Array;
let bPot: Uint8Array;
let bNat: Uint16Array;
let bYouth: Uint8Array;
/** (18/11) pé bom: 0 desconhecido, 1 destro, 2 canhoto */
let bFoot: Uint8Array;
let bValue: Float64Array;
let bWage: Float64Array;
let bIds: string[] = [];
let bNames: string[] = [];
let bNorm: string[] = [];
const baseRowByPid = new Map<string, number>();

/* ── efetivo (base + índice) ── */
let n = 0;
let ids: string[] = [];
let names: string[] = [];
let norm: string[] = [];
let effClub: Int32Array;
let pos: Uint8Array;
let age: Uint8Array;
let ovr: Uint8Array;
let pot: Uint8Array;
let nat: Uint16Array;
let youth: Uint8Array;
let foot: Uint8Array;
let value: Float64Array;
let wage: Float64Array;
let removed: Uint8Array;
let rowByPid = new Map<string, number>();

/** por clube: país, liga (índice em leagues), posição no ranking alfabético */
let clubCountry: Int32Array;
let clubLeague: Int32Array;
let clubRank: Int32Array;
let leagues: string[] = [];
let orders = new Map<SortKey, Int32Array>();
let rev = 0;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function init(marketUrl: string, clubsUrl: string, feetUrl?: string) {
  const t0 = performance.now();
  const [mres, cres, fres] = await Promise.all([fetch(marketUrl), fetch(clubsUrl), feetUrl ? fetch(feetUrl).catch(() => null) : Promise.resolve(null)]);
  // (18/11) pé bom (opcional: sem o arquivo, a busca segue sem a informação)
  let feet: string[] | null = null;
  try {
    if (fres?.ok && (fres.headers.get('content-type') ?? '').includes('json')) feet = ((await fres.json()) as { feet: string[] }).feet;
  } catch {
    feet = null;
  }
  if (!mres.ok || !(mres.headers.get('content-type') ?? '').includes('json')) throw new Error('a base de jogadores não pôde ser carregada');
  const market = (await mres.json()) as PlayersMarket;
  const index = cres.ok ? ((await cres.json()) as ClubIndexEntry[]) : [];
  positions = market.positions;
  clubs = market.clubs.slice();
  const meta = new Map(index.map((c) => [c.id, c]));
  for (const c of index) if (!clubIdxById.has(c.id) && !clubs.includes(c.id)) clubs.push(c.id);
  clubIdxById = new Map(clubs.map((id, i) => [id, i]));
  const leagueIdx = new Map<string, number>();
  clubCountry = new Int32Array(clubs.length).fill(-1);
  clubLeague = new Int32Array(clubs.length).fill(-1);
  clubs.forEach((id, i) => {
    const m = meta.get(id);
    if (!m) return;
    clubCountry[i] = m.countryId;
    if (m.leagueId) {
      let li = leagueIdx.get(m.leagueId);
      if (li === undefined) leagueIdx.set(m.leagueId, (li = leagueIdx.size));
      clubLeague[i] = li;
    }
  });
  leagues = [...leagueIdx.keys()];
  const byName = clubs.map((id, i) => ({ i, name: normalize(meta.get(id)?.name ?? id) })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  clubRank = new Int32Array(clubs.length);
  byName.forEach((c, r) => (clubRank[c.i] = r));

  const rows = market.rows;
  n0 = rows.length;
  bClub = new Int32Array(n0);
  bAge = new Uint8Array(n0);
  bOvr = new Uint8Array(n0);
  bPot = new Uint8Array(n0);
  bNat = new Uint16Array(n0);
  bYouth = new Uint8Array(n0);
  bFoot = new Uint8Array(n0);
  bValue = new Float64Array(n0);
  bWage = new Float64Array(n0);
  const bPos = new Uint8Array(n0);
  bIds = new Array(n0);
  bNames = new Array(n0);
  bNorm = new Array(n0);
  for (let i = 0; i < n0; i++) {
    const r = rows[i];
    bClub[i] = r[0];
    bIds[i] = `${market.clubs[r[0]]}:${r[1]}`;
    bNames[i] = r[2];
    bNorm[i] = normalize(r[2]);
    bPos[i] = r[3];
    // (18/11) idade mínima de 17 (o banco do original tem juniores de 15–16)
    bAge[i] = Math.max(MIN_AGE, r[4]);
    bOvr[i] = r[5];
    bPot[i] = r[6];
    bValue[i] = r[7];
    bWage[i] = r[8];
    bNat[i] = r[9];
    bYouth[i] = r[10] ? 1 : 0;
    const ft = feet?.[r[0]]?.[r[1]];
    bFoot[i] = ft === 'L' ? 2 : ft === 'R' ? 1 : 0;
    baseRowByPid.set(bIds[i], i);
  }
  basePos = bPos;
  resetEffective(0);
  applyRealPotential();

  const natSet = new Set<number>();
  for (let i = 0; i < n0; i++) natSet.add(bNat[i]);
  const ccSet = new Set<number>();
  for (const c of clubCountry) if (c >= 0) ccSet.add(c);
  ctx.postMessage({ t: 'ready', total: n0, ms: performance.now() - t0, facets: { leagues, clubCountries: [...ccSet], nats: [...natSet] } });
}

let basePos: Uint8Array;

/** Colunas efetivas = base (+ `extra` linhas vazias no fim, para os jogadores novos). */
function resetEffective(extra: number) {
  n = n0 + extra;
  const grow = <T extends Uint8Array | Uint16Array | Int32Array | Float64Array>(src: T, Ctor: new (len: number) => T): T => {
    const a = new Ctor(n);
    a.set(src);
    return a;
  };
  effClub = grow(bClub, Int32Array);
  pos = grow(basePos, Uint8Array);
  age = grow(bAge, Uint8Array);
  ovr = grow(bOvr, Uint8Array);
  pot = grow(bPot, Uint8Array);
  nat = grow(bNat, Uint16Array);
  youth = grow(bYouth, Uint8Array);
  foot = grow(bFoot, Uint8Array);
  value = grow(bValue, Float64Array);
  wage = grow(bWage, Float64Array);
  removed = new Uint8Array(n);
  if (extra) {
    ids = bIds.slice();
    names = bNames.slice();
    norm = bNorm.slice();
    rowByPid = new Map(baseRowByPid);
  } else {
    ids = bIds;
    names = bNames;
    norm = bNorm;
    rowByPid = baseRowByPid;
  }
  orders = new Map();
}

function clubIndex(c: string): number {
  if (c === '') return -1;
  let ci = clubIdxById.get(c);
  if (ci === undefined) {
    ci = clubs.length;
    clubs.push(c);
    clubIdxById.set(c, ci);
    // clube fora do índice: sem país/liga, vai para o fim na ordenação por clube
    const grow = (a: Int32Array, v: number) => {
      const b = new Int32Array(clubs.length).fill(v);
      b.set(a);
      return b;
    };
    clubCountry = grow(clubCountry, -1);
    clubLeague = grow(clubLeague, -1);
    clubRank = grow(clubRank, clubs.length);
  }
  return ci;
}

/** Aplica o índice de mercado (carreira ou online) sobre a base. */
function applyIndex(ix: MarketIndex): number {
  const t0 = performance.now();
  const extras = ix.ids.filter((pid, k) => !baseRowByPid.has(pid) && ix.info[k] !== null);
  resetEffective(extras.length);
  let next = n0;
  for (let k = 0; k < ix.ids.length; k++) {
    const pid = ix.ids[k];
    let i = rowByPid.get(pid);
    const info = ix.info[k];
    if (i === undefined) {
      if (!info) continue;
      i = next++;
      ids[i] = pid;
      rowByPid.set(pid, i);
    }
    if (info) {
      names[i] = info[0];
      norm[i] = normalize(info[0]);
      const pi = positions.indexOf(info[1]);
      pos[i] = pi < 0 ? 0 : pi;
      nat[i] = info[2];
      if (info[3]) foot[i] = info[3] === 'L' ? 2 : 1;
    }
    const o = k * 6;
    age[i] = Math.max(MIN_AGE, ix.vals[o]);
    ovr[i] = ix.vals[o + 1];
    pot[i] = ix.vals[o + 2];
    value[i] = ix.vals[o + 3];
    wage[i] = ix.vals[o + 4];
    youth[i] = ix.vals[o + 5];
    // linha nova sem clube informado: livre
    if (i >= n0) effClub[i] = -1;
  }
  for (const [pid, o] of Object.entries(ix.ovr)) {
    const i = rowByPid.get(pid);
    if (i !== undefined) ovr[i] = o;
  }
  for (const [pid, c] of Object.entries(ix.clubs)) {
    const i = rowByPid.get(pid);
    if (i !== undefined) effClub[i] = clubIndex(c);
  }
  for (const pid of ix.removed) {
    const i = rowByPid.get(pid);
    if (i !== undefined) removed[i] = 1;
  }
  applyRealPotential();
  rev++;
  return performance.now() - t0;
}

function orderFor(key: SortKey): Int32Array {
  let o = orders.get(key);
  if (o) return o;
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  const numeric = (col: ArrayLike<number>) => a.sort((x, y) => col[x] - col[y] || ovr[y] - ovr[x] || x - y);
  switch (key) {
    case 'ovr':
      o = a.sort((x, y) => ovr[x] - ovr[y] || pot[x] - pot[y] || value[x] - value[y] || x - y);
      break;
    case 'pos':
      o = a.sort((x, y) => pos[x] - pos[y] || ovr[y] - ovr[x] || x - y);
      break;
    case 'name':
      o = a.sort((x, y) => (norm[x] < norm[y] ? -1 : norm[x] > norm[y] ? 1 : x - y));
      break;
    case 'pot':
      o = numeric(pot);
      break;
    case 'age':
      o = numeric(age);
      break;
    case 'value':
      o = numeric(value);
      break;
    case 'wage':
      o = numeric(wage);
      break;
    case 'nat':
      o = numeric(nat);
      break;
    default:
      return orderFor('ovr');
  }
  orders.set(key, o);
  return o;
}

function toRow(i: number): MarketRowOut {
  const c = effClub[i];
  return {
    id: ids[i],
    name: names[i],
    pos: positions[pos[i]],
    age: age[i],
    ovr: ovr[i],
    pot: pot[i],
    value: value[i],
    wage: wage[i],
    nat: nat[i],
    clubId: c < 0 ? '' : clubs[c],
    youth: !!youth[i],
    ...(foot[i] ? { foot: foot[i] === 2 ? ('L' as const) : ('R' as const) } : {}),
  };
}

function query(q: SearchQuery, offset: number, limit: number) {
  const t0 = performance.now();
  const tokens = normalize(q.name).trim().split(/\s+/).filter(Boolean);
  let posMask = 0;
  for (const p of q.positions) posMask |= 1 << positions.indexOf(p);
  const leagueI = q.league ? leagues.indexOf(q.league) : -2;
  const clubI = q.club ? (clubIdxById.get(q.club) ?? -3) : -2;
  const exclI = q.excludeClub ? (clubIdxById.get(q.excludeClub) ?? -3) : -2;
  const vHi = q.value[1] ?? Infinity;
  const budget = q.maxValue ?? Infinity;
  const [o0, o1] = q.ovr;
  const [p0, p1] = q.pot;
  const [a0, a1] = q.age;
  const v0 = q.value[0];
  const footWant = q.foot === 'L' ? 2 : q.foot === 'R' ? 1 : 0;

  const pass = (i: number) => {
    if (removed[i]) return false;
    const o = ovr[i];
    if (o < o0 || o > o1) return false;
    const pt = pot[i];
    if (pt < p0 || pt > p1) return false;
    const ag = age[i];
    if (ag < a0 || ag > a1) return false;
    const v = value[i];
    if (v < v0 || v > vHi || v > budget) return false;
    if (posMask && !(posMask & (1 << pos[i]))) return false;
    const c = effClub[i];
    if (q.freeOnly && c !== -1) return false;
    if (exclI !== -2 && c === exclI) return false;
    if (clubI !== -2 && c !== clubI) return false;
    if (leagueI !== -2 && (c < 0 || clubLeague[c] !== leagueI)) return false;
    if (q.clubCountry !== null && (c < 0 || clubCountry[c] !== q.clubCountry)) return false;
    if (footWant && foot[i] !== footWant) return false;
    if (q.nat !== null && nat[i] !== q.nat) return false;
    if (tokens.length) {
      const s = norm[i];
      for (const t of tokens) if (!s.includes(t)) return false;
    }
    return true;
  };

  const rows: MarketRowOut[] = [];
  let total = 0;
  const desc = q.dir === 'desc';
  if (q.sort === 'club') {
    // clube efetivo muda com o mercado: ordena só o filtrado
    const hits: number[] = [];
    for (let i = 0; i < n; i++) if (pass(i)) hits.push(i);
    const rank = (i: number) => (effClub[i] < 0 ? -1 : clubRank[effClub[i]]);
    hits.sort((a, b) => (rank(a) - rank(b)) * (desc ? -1 : 1) || ovr[b] - ovr[a] || a - b);
    total = hits.length;
    for (let k = offset; k < Math.min(total, offset + limit); k++) rows.push(toRow(hits[k]));
  } else {
    const order = orderFor(q.sort);
    const end = offset + limit;
    if (desc) {
      for (let k = n - 1; k >= 0; k--) {
        const i = order[k];
        if (!pass(i)) continue;
        if (total >= offset && total < end) rows.push(toRow(i));
        total++;
      }
    } else {
      for (let k = 0; k < n; k++) {
        const i = order[k];
        if (!pass(i)) continue;
        if (total >= offset && total < end) rows.push(toRow(i));
        total++;
      }
    }
  }
  return { rows, total, ms: performance.now() - t0 };
}

let pendingIndex: MarketIndex | null = null;

function flushIndex() {
  if (!pendingIndex || !n0) return;
  const ix = pendingIndex;
  pendingIndex = null;
  const ms = applyIndex(ix);
  // a ordenação padrão (overall) já fica pronta; as outras são feitas na 1ª consulta que as usa
  const s0 = performance.now();
  orderFor('ovr');
  let active = 0;
  for (let i = 0; i < n; i++) if (!removed[i]) active++;
  ctx.postMessage({ t: 'indexed', rev, total: active, added: n - n0, removed: ix.removed.length, ms: ms + performance.now() - s0 });
}

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.t === 'init') {
      init(m.marketUrl, m.clubsUrl, m.feetUrl)
        .then(flushIndex)
        .catch((err: unknown) => ctx.postMessage({ t: 'error', message: err instanceof Error ? err.message : String(err) }));
    } else if (m.t === 'index') {
      pendingIndex = m.index;
      flushIndex();
    } else if (m.t === 'query') {
      flushIndex();
      const r = query(m.q, m.offset, m.limit);
      ctx.postMessage({ t: 'result', id: m.id, total: r.total, rows: r.rows, offset: m.offset, ms: r.ms });
    } else if (m.t === 'ids') {
      flushIndex();
      const rows: MarketRowOut[] = [];
      for (const pid of m.ids) {
        const i = rowByPid.get(pid);
        if (i !== undefined && !removed[i]) rows.push(toRow(i));
      }
      ctx.postMessage({ t: 'ids', id: m.id, rows });
    }
  } catch (err) {
    ctx.postMessage({ t: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
