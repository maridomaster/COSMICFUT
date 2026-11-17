// (Etapa 3) Testes do nivelamento por tier, das cartas FC 27 e da distribuição gerada.
// Rodar: npm test --workspace @cosmicfut/data   (node:test, sem dependências)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, CLUB_TIERS, assignTiers, statusBands, squadStatus, levelSquad, organicVariation } from '../src/tiers.mjs';
import { applyReal, loadFc } from '../src/real.mjs';

const POS = ['GK', 'GK', 'GK', 'FB', 'FB', 'FB', 'FB', 'CB', 'CB', 'CB', 'CB', 'CB', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW', 'FW'];

/** Elenco sintético: 24 seniores (score decrescente com ruído) + 4 da base; ids estáveis. */
function squad(prefix = 'c', base = 78) {
  const out = POS.map((position, i) => ({
    id: `${prefix}:${i}`, name: `P${i}`, position, age: 22 + (i % 12), youth: false, star: i === 12, worldClass: false,
    highlight: i < 11, hash: (i * 7) % 11, traits: i % 3 ? [1] : [1, 2], score: base - i * 0.6 + ((i * 13) % 5) * 0.3,
  }));
  for (let k = 0; k < 4; k++) out.push({ id: `${prefix}:${24 + k}`, name: `Y${k}`, position: POS[k * 5], age: 17 + k, youth: true, star: false, worldClass: false, hash: k * 3, traits: [], score: base - 15 - k });
  out.push({ id: `${prefix}:28`, name: 'Teen', position: 'MF', age: 19, youth: false, star: false, worldClass: false, hash: 4, traits: [], score: base - 9 });
  return out;
}

test('faixas por tier/status batem com o pedido (S e A)', () => {
  assert.deepEqual(statusBands('S', TIERS.S.R[0]), { star: [78, 82], starter: [74, 77], reserve: [69, 73], youth: [62, 68] });
  const a = statusBands('A', TIERS.A.R[0]);
  assert.deepEqual([a.star, a.starter, a.reserve], [[76, 79], [72, 75], [67, 71]]);
});

test('tiers: exemplos do pedido e titulares de B/C/D entre 64 e 72', () => {
  for (const id of ['flarj', 'palmeiras', 'botafogorj-bra', 'riverplate-arg', 'al-hilal', 'alnassr-ara']) assert.equal(CLUB_TIERS[id], 'S', id);
  for (const id of ['saopaulo-bra', 'corinthians-bra', 'atleticomg-bra', 'gremio', 'bocajuniors-arg', 'alittihad-ara', 'al-ahli-ara', 'internacional-bra', 'cruzeiro-bra', 'flurj', 'bahia', 'racing-arg']) assert.equal(CLUB_TIERS[id], 'A', id);
  for (const t of ['B', 'C', 'D']) {
    const [r0, r1] = TIERS[t].R;
    assert.ok(r0 - 3 >= 64 && r1 <= 72, `${t}: titulares ${r0 - 3}..${r1}`);
  }
  // abaixo da Série B: só-estadual (F) e 2ªs divisões estrangeiras (E)
  assert.ok(TIERS.F.R[1] < TIERS.D.R[1] && TIERS.E.R[1] < TIERS.D.R[1]);
  const t = assignTiers([
    { id: 'flarj', code: 'BRA', division: 1, level: 21, reputation: 4 },
    { id: 'x-a', code: 'BRA', division: 2, level: 15, reputation: 2 },
    { id: 'x-b', code: 'BRA', division: 2, level: 12, reputation: 0 },
    { id: 'x-st', code: 'BRA', division: null, level: 5, reputation: 1 },
    { id: 'eu', code: 'ING', division: 1, level: 24, reputation: 5 },
  ]);
  assert.equal(t.get('flarj').R, 77);
  assert.equal(t.get('x-a').tier, 'D');
  assert.ok(t.get('x-a').R > t.get('x-b').R, 'Série B proporcional à força');
  assert.equal(t.get('x-st').tier, 'F');
  assert.equal(t.has('eu'), false, 'Europa sem tier');
});

test('status: base, XI por posição (4-3-3/4-4-2), 2–3 craques, ≤20 fora do XI = base', () => {
  const sq = squad();
  const st = squadStatus(sq);
  const of = (s) => sq.filter((p) => st.get(p.id) === s);
  const xi = [...of('star'), ...of('starter')];
  assert.equal(xi.length, 11);
  assert.equal(xi.filter((p) => p.position === 'GK').length, 1);
  assert.ok(of('star').length >= 2 && of('star').length <= 3);
  assert.ok(of('star').some((p) => p.star), 'flag craque no XI vira craque');
  for (const p of sq.filter((x) => x.youth)) assert.equal(st.get(p.id), 'youth');
  assert.equal(st.get('c:28'), 'youth', 'menor de 21 fora do XI');
});

test('variação orgânica limitada a −1..+2 e usa a faixa toda', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = organicVariation({ id: `v:${i}`, hash: i % 11, traits: i % 4 ? [1] : [], star: i % 17 === 0 });
    assert.ok(v >= -1 && v <= 2 && Number.isInteger(v));
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [-1, 0, 1, 2]);
});

test('levelSquad: faixas por status respeitadas e ordem preservada dentro do status', () => {
  for (const [tier, R] of [['S', 77], ['A', 75], ['B', 72], ['C', 69], ['D', 67], ['E', 62], ['F', 56]]) {
    const sq = squad(tier, 70);
    const { ovr, status, bands } = levelSquad(sq, tier, R);
    for (const s of ['star', 'starter', 'reserve', 'youth']) {
      const group = sq.filter((p) => status.get(p.id) === s).sort((a, b) => b.score - a.score);
      for (const p of group) {
        const v = ovr.get(p.id);
        assert.ok(v >= bands[s][0] && v <= bands[s][1], `${tier}/${s} ${v} fora de ${bands[s]}`);
      }
      for (let i = 1; i < group.length; i++) assert.ok(ovr.get(group[i].id) <= ovr.get(group[i - 1].id), `${tier}/${s}: ordem invertida`);
    }
    // nenhum titular abaixo de um reserva do mesmo clube por mais que a largura das faixas permite
    const med = (s) => { const a = sq.filter((p) => status.get(p.id) === s).map((p) => ovr.get(p.id)).sort((x, y) => x - y); return a[a.length >> 1]; };
    assert.ok(med('star') > med('starter') && med('starter') > med('reserve') && med('reserve') > med('youth'), tier);
  }
  // jogadores com carta FC ficam fixos
  const sq = squad('fx');
  sq[0].fixed = 88;
  const { ovr } = levelSquad(sq, 'S', 77);
  assert.equal(ovr.has('fx:0'), false);
});

/* ───────────── FC 27 + applyReal ───────────── */

const CODES = { 1: 'BRA', 2: 'ESP', 3: 'ARG' };
function entry(id, countryId, level, division, n = 22) {
  const players = Array.from({ length: n }, (_, i) => ({
    id: `${id}:${i}`, name: `${id} Player ${i}`, position: POS[i % POS.length], age: 20 + (i % 14), nationalityId: 1,
    side: 'R', traits: [], star: false, highlight: i < 11, worldClass: false, hash: i % 11,
    overall: 75 - Math.floor(i / 2), potential: 78 - Math.floor(i / 2), wage: 0, value: 0, youth: i >= n - 3, tmId: null,
  }));
  return { club: { id, countryId, level, division, reputation: 3 }, players };
}
const realOf = (players = []) => {
  const m = new Map();
  for (const r of players) { if (!m.has(r.clubId)) m.set(r.clubId, new Map()); m.get(r.clubId).set(r.name, r); }
  return { clubs: new Map(), players: m, files: [] };
};
const fcOf = (list) => {
  const m = new Map();
  for (const r of list) { if (!m.has(r.clubId)) m.set(r.clubId, new Map()); m.get(r.clubId).set(r.name, { source: 'fc27', ...r }); }
  return { players: m, files: [] };
};

test('FC 27: carta substitui o overall fora do Brasil; Brasil ignora a carta e usa o tier; Europa recentrada', () => {
  const eu = entry('realmadrid-esp', 2, 24, 1);
  const br = entry('flarj', 1, 21, 1);
  const ar = entry('riverplate-arg', 3, 21, 1);
  const real = realOf([
    { clubId: 'realmadrid-esp', name: 'realmadrid-esp Player 0', overall: 80, value: 150_000_000, wage: 2_000_000 },
    { clubId: 'flarj', name: 'flarj Player 0', overall: 80, potential: 82, value: 35_000_000, wage: 400_000 },
  ]);
  const fc = fcOf([
    ...Array.from({ length: 12 }, (_, i) => ({ clubId: 'realmadrid-esp', name: `realmadrid-esp Player ${i}`, overall: 90 - i })),
    { clubId: 'flarj', name: 'flarj Player 0', overall: 70 },
    { clubId: 'riverplate-arg', name: 'riverplate-arg Player 3', overall: 81, potential: 84 },
  ]);
  const before = eu.players.map((p) => p.overall);
  const stats = applyReal([eu, br, ar], real, (c) => CODES[c], () => {}, { fc });
  // Europa (12 cartas de 19 seniores ≥ 50%): cartas aplicadas; os demais deslocados pela mediana (carta − derivado) = 12
  assert.deepEqual(eu.players.slice(0, 4).map((p) => p.overall), [90, 89, 88, 87]);
  assert.equal(eu.players[14].overall, before[14] + 12);
  assert.equal(eu.players[0].value, 150_000_000, 'valor curado mantido');
  // Brasil: carta ignorada; tier S
  assert.equal(stats.fc.ignored, 1);
  const stars = br.players.filter((p) => p.status === 'star');
  assert.ok(stars.length >= 2 && stars.every((p) => p.overall >= 78 && p.overall <= 82), `craques do Flamengo ${stars.map((p) => p.overall)}`);
  assert.ok(br.players.filter((p) => p.status === 'starter').every((p) => p.overall >= 74 && p.overall <= 77));
  assert.notEqual(br.players[0].overall, 70, 'carta FC ignorada no Brasil');
  assert.equal(br.players[0].value, 35_000_000, 'valor curado mantido');
  // Argentina: carta mantida, demais pelo tier
  assert.equal(ar.players[3].overall, 81);
  assert.equal(ar.players[3].potential, 84);
  assert.ok(ar.players.filter((p, i) => i !== 3 && !p.youth).every((p) => p.overall >= 69 && p.overall <= 82));
  // consistência: potencial ≥ overall; sem valor curado ⇒ valor recalculado pela curva (cresce com o overall)
  for (const e of [eu, br, ar]) for (const p of e.players) assert.ok(p.potential >= p.overall && p.value > 0 && p.wage > 0);
  const noReal = br.players.filter((p) => !p.youth && p.id !== 'flarj:0' && p.age >= 25 && p.age <= 27);
  for (let i = 0; i < noReal.length; i++) for (let j = 0; j < noReal.length; j++) {
    if (noReal[i].age === noReal[j].age && noReal[i].overall > noReal[j].overall) assert.ok(noReal[i].value >= noReal[j].value);
  }
});

test('cobertura FC fraca (Europa/convidados): faixa por liga; boa cobertura: recentrado e limitado à melhor carta', () => {
  // 2ª divisão com elenco desatualizado e escala errada (fallback derivado altíssimo), só 2 cartas
  const weak = entry('cremonese-ita', 4, 22, 2, 24);
  weak.club.leagueId = 'ITA-2';
  for (const p of weak.players) { p.overall += 12; p.potential += 12; }
  const good = entry('porto', 5, 22, 1, 22);
  good.club.leagueId = 'POR-1';
  const fc = fcOf([
    { clubId: 'cremonese-ita', name: 'cremonese-ita Player 0', overall: 74 },
    { clubId: 'cremonese-ita', name: 'cremonese-ita Player 1', overall: 72 },
    ...Array.from({ length: 14 }, (_, i) => ({ clubId: 'porto', name: `porto Player ${i}`, overall: 80 - i })),
  ]);
  const stats = applyReal([weak, good], realOf(), (c) => ({ 4: 'ITA', 5: 'POR' })[c], () => {}, { fc });
  assert.equal(stats.tiers.weakCoverage.clubs, 1);
  assert.deepEqual(weak.players.slice(0, 2).map((p) => p.overall), [74, 72], 'cartas mantidas');
  const others = weak.players.filter((p, i) => i > 1);
  const R = 67 + 0; // ITA-2: R entre 67 e 72; craque ≤ R + 3
  assert.ok(others.every((p) => p.overall <= 72 + 3 && p.overall >= R - 15), `faixa ITA-2: ${others.map((p) => p.overall)}`);
  assert.ok(good.players.filter((p) => !p.fc).every((p) => p.overall <= 80), 'sem carta ≤ melhor carta do clube');
});

test('loadFc tolera arquivo ausente e parcial (curador escrevendo)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc27-'));
  assert.equal(loadFc(dir).files.length, 0);
  fs.writeFileSync(path.join(dir, 'fc27-world.json'), '[{"clubId":"a","name":"X","overall":80,"source":"fc27"},{"clubId":"a","name":"Y","overall":7');
  fs.writeFileSync(path.join(dir, 'players-x.json'), '[]');
  const r = loadFc(dir);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].partial, true);
  assert.equal(r.players.get('a').get('X').overall, 80);
  assert.equal(r.players.get('a').has('Y'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ───────────── relatório de distribuição (dados gerados) ───────────── */

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data');
test('distribuição gerada: top-11 por liga e coerência market/index', { skip: !fs.existsSync(path.join(DATA, 'players-market.json')) }, () => {
  const pm = JSON.parse(fs.readFileSync(path.join(DATA, 'players-market.json'), 'utf8'));
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'clubs-index.json'), 'utf8'));
  const byClub = new Map();
  for (const r of pm.rows) {
    assert.ok(r[6] >= r[5], 'potencial ≥ overall');
    if (r[10]) continue;
    const id = pm.clubs[r[0]];
    if (!byClub.has(id)) byClub.set(id, []);
    byClub.get(id).push(r[5]);
  }
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const top11 = (id) => med((byClub.get(id) ?? []).sort((a, b) => b - a).slice(0, 11));
  const league = new Map();
  for (const c of idx) {
    assert.ok(c.finances && c.finances.revenue > 0, `finanças de ${c.id}`);
    const k = c.leagueId ?? (c.guest ? 'convidados' : 'sem-liga');
    if (!league.has(k)) league.set(k, []);
    league.get(k).push(top11(c.id));
  }
  assert.equal(new Set(idx.map((c) => c.id)).size, pm.clubs.length, 'clubs-index e players-market com os mesmos clubes');
  const report = [...league].map(([k, v]) => [k, med(v)]).sort((a, b) => b[1] - a[1]);
  console.log('top-11 (mediana) por liga:', report.map(([k, v]) => `${k} ${v}`).join(' · '));
  const L = Object.fromEntries(report);
  assert.ok(L['BRA-1'] >= 70 && L['BRA-1'] <= 77, `BRA-1 ${L['BRA-1']}`);
  assert.ok(L['BRA-2'] < L['BRA-1'] && L['BRA-2'] >= 64 && L['BRA-2'] <= 70, `BRA-2 ${L['BRA-2']}`);
  assert.ok(L['ING-1'] > L['BRA-1']);
  assert.ok(top11('flarj') >= 74 && top11('palmeiras') >= 74);
});
