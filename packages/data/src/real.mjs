// Dados da vida real (packages/data/real/*.json, mantidos pelos curadores) + recalibração do fallback.
// Escala: 1 "$" do jogo = 1 €. Ver packages/data/README.md, seção "Escala real".
//
//  - clubs-*.json   { "<clubId>": { balance, revenue, wageBill, squadValue, confidence } }   (euros; anuais)
//  - players-*.json [{ clubId, name, overall, potential, value, wage }]                       (wage = € por MÊS)
//
// Tudo é determinístico (sem RNG): o fallback parte do overall/potencial derivados (ratings.mjs) e é deslocado e
// escalado para ficar coerente com os jogadores e clubes reais.
import fs from 'node:fs';
import path from 'node:path';
import { clamp, roundMoney } from './util.mjs';
import { growthGap } from './ratings.mjs';
import { assignTiers, assignLeagueBands, leagueBandKey, levelSquad, FC_IGNORED_COUNTRIES, WEAK_COVERAGE } from './tiers.mjs';
import { OWNER_BACKED, wageRatioFor } from './prizes.mjs';

/* ───────────── curvas (mesmas da engine: packages/engine/src/season/players.ts) ───────────── */

/** Curva de valor: 2,5 M € no overall 70, ×e^0,2 por ponto (≈ ×2,2 a cada 4 pontos). */
export const VALUE_CURVE = { base: 2_500_000, k: 0.2, pivot: 70 };
/** Salário mensal genérico = A × (valor "de habilidade")^B. */
export const WAGE_CURVE = { a: 0.025, b: 0.95 };

export function ageValueMult(age) {
  if (age <= 20) return 1.15;
  if (age <= 24) return 1.05;
  if (age <= 27) return 1;
  if (age === 28) return 0.92;
  if (age === 29) return 0.85;
  if (age === 30) return 0.72;
  if (age === 31) return 0.6;
  if (age === 32) return 0.48;
  if (age === 33) return 0.38;
  return 0.3 * Math.pow(0.8, age - 34);
}

/** Valor de mercado "neutro" (sem prêmio de liga/clube). */
export function valueCurve(age, ovr, pot) {
  const eff = age <= 23 ? ovr + Math.max(0, pot - ovr) * 0.35 : ovr;
  return VALUE_CURVE.base * Math.exp(VALUE_CURVE.k * (eff - VALUE_CURVE.pivot)) * ageValueMult(age);
}

/** Salário mensal "neutro" (sem prêmio de liga/clube). */
export function wageCurve(age, ovr) {
  const v = VALUE_CURVE.base * Math.exp(VALUE_CURVE.k * (ovr - VALUE_CURVE.pivot));
  const youth = age <= 20 ? 0.5 : age <= 22 ? 0.75 : 1;
  return WAGE_CURVE.a * Math.pow(v, WAGE_CURVE.b) * youth;
}

/**
 * Prêmio de mercado por país (valor do jogador ÷ curva neutra) usado como PRIOR quando o país não tem clubes
 * com dados reais. Os dados reais corrigem esse prior (ver fitModel).
 */
export const COUNTRY_PREMIUM = {
  ING: 1.6, ESP: 1.1, ALE: 1.0, ITA: 1.0, FRA: 0.9, POR: 0.8, HOL: 0.75, BEL: 0.65, TUR: 0.6, BRA: 0.6,
  ARS: 0.6, EUA: 0.5, MEX: 0.5, ARG: 0.5, ESC: 0.5, AUT: 0.5, SUI: 0.5, DIN: 0.45, GRE: 0.45, RUS: 0.5,
  UCR: 0.45, CRO: 0.45, SER: 0.4, TCH: 0.4, POL: 0.4, NOR: 0.4, SUE: 0.4, URU: 0.4, COL: 0.4, CHI: 0.35,
  JAP: 0.4, CPR: 0.35, CHN: 0.35, EMI: 0.4, QUE: 0.35,
};
const DEFAULT_PREMIUM = 0.3;

/** Normalização para casar nomes (sem acento, minúsculo, só letras/números). */
export function normName(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[đĐ]/g, 'd').replace(/[łŁ]/g, 'l')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : undefined);

/* ───────────── leitura ───────────── */

/**
 * Lê todos os `*.json` de `dir` (ordem alfabética; duplicatas posteriores vencem, com aviso).
 * Arquivo ausente/parcial/inválido é ignorado com aviso (os curadores podem estar escrevendo).
 */
export function loadReal(dir, warn = () => {}) {
  const clubs = new Map(); // clubId -> { balance?, revenue?, wageBill?, squadValue?, confidence?, file }
  const players = new Map(); // clubId -> Map(name -> entry)
  const files = [];
  if (!dir || !fs.existsSync(dir)) return { clubs, players, files };
  // (Etapa 3) fc27-*.json têm formato e papel próprios (loadFc)
  for (const f of fs.readdirSync(dir).filter((x) => /\.json$/i.test(x) && !FC_FILE.test(x)).sort()) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      warn(`real/${f}: JSON inválido ou incompleto, ignorado (${e.message.slice(0, 80)})`);
      files.push({ file: f, ok: false, clubs: 0, players: 0 });
      continue;
    }
    let nc = 0, np = 0;
    const playerList = Array.isArray(json) ? json : Array.isArray(json?.players) ? json.players : null;
    const clubObj = !Array.isArray(json) && json && typeof json === 'object' ? (json.clubs && typeof json.clubs === 'object' ? json.clubs : playerList ? null : json) : null;
    if (clubObj) {
      for (const [id, raw] of Object.entries(clubObj)) {
        if (!raw || typeof raw !== 'object') continue;
        const e = { file: f };
        for (const k of ['balance', 'revenue', 'wageBill', 'squadValue']) {
          const v = num(raw[k]);
          if (v !== undefined && (k === 'balance' || v > 0)) e[k] = Math.round(v);
        }
        if (raw.confidence !== undefined) e.confidence = raw.confidence;
        if (clubs.has(id)) warn(`real: clube ${id} repetido (${clubs.get(id).file} → ${f}); vale o de ${f}`);
        clubs.set(id, e);
        nc++;
      }
    }
    if (playerList) {
      for (const raw of playerList) {
        const clubId = raw?.clubId, name = typeof raw?.name === 'string' ? raw.name.trim() : '';
        const overall = num(raw?.overall);
        if (!clubId || !name || overall === undefined) continue;
        const e = {
          clubId, name, file: f,
          overall: clamp(Math.round(overall), 40, 99),
          potential: num(raw.potential),
          value: num(raw.value),
          wage: num(raw.wage),
        };
        if (e.potential !== undefined) e.potential = clamp(Math.round(e.potential), e.overall, 99);
        if (e.value !== undefined) e.value = Math.max(0, Math.round(e.value));
        if (e.wage !== undefined) e.wage = Math.max(0, Math.round(e.wage));
        let m = players.get(clubId);
        if (!m) players.set(clubId, (m = new Map()));
        if (m.has(name)) warn(`real: jogador ${clubId}/${name} repetido (${m.get(name).file} → ${f}); vale o de ${f}`);
        m.set(name, e);
        np++;
      }
    }
    files.push({ file: f, ok: true, clubs: nc, players: np });
  }
  return { clubs, players, files };
}

/* ───────────── (Etapa 3) cartas EA Sports FC 27 ───────────── */

/** Arquivos das cartas FC 27 (curadoria da Etapa 3): `fc27-*.json`. */
export const FC_FILE = /^fc\d+-.*\.json$/i;
export const FC_SOURCES = ['fc27', 'fc26-adjusted', 'estimate'];

/**
 * Lê `fc27-*.json` de `dir`: arrays de `{ clubId, name, overall, potential?, source }`.
 * Arquivo ausente é ignorado; arquivo parcial (curador ainda escrevendo) é salvo até o último objeto completo.
 * Duplicatas: vale a do último arquivo (ordem alfabética), com aviso.
 */
export function loadFc(dir, warn = () => {}) {
  const players = new Map(); // clubId -> Map(name -> { clubId, name, overall, potential?, source, file })
  const files = [];
  if (!dir || !fs.existsSync(dir)) return { players, files };
  for (const f of fs.readdirSync(dir).filter((x) => FC_FILE.test(x)).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');
    let json, partial = false;
    try {
      json = JSON.parse(text);
    } catch {
      json = salvageArray(text);
      partial = true;
      if (!json) { warn(`real/${f}: JSON FC inválido, ignorado`); files.push({ file: f, ok: false, players: 0 }); continue; }
      warn(`real/${f}: JSON FC incompleto; lidos ${json.length} registros até o último objeto completo`);
    }
    const list = Array.isArray(json) ? json : Array.isArray(json?.players) ? json.players : [];
    let np = 0;
    for (const raw of list) {
      const clubId = raw?.clubId, name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      const overall = num(raw?.overall);
      if (!clubId || !name || overall === undefined) continue;
      const e = { clubId, name, file: f, overall: clamp(Math.round(overall), 40, 99), source: FC_SOURCES.includes(raw.source) ? raw.source : 'estimate' };
      const pot = num(raw.potential);
      if (pot !== undefined) e.potential = clamp(Math.round(pot), e.overall, 99);
      let m = players.get(clubId);
      if (!m) players.set(clubId, (m = new Map()));
      if (m.has(name)) warn(`fc27: jogador ${clubId}/${name} repetido (${m.get(name).file} → ${f}); vale o de ${f}`);
      m.set(name, e);
      np++;
    }
    files.push({ file: f, ok: true, partial, players: np, bytes: text.length });
  }
  return { players, files };
}

/** Recupera um array JSON truncado: corta no último `}` que fecha um elemento e fecha o array. */
function salvageArray(text) {
  const start = text.indexOf('[');
  if (start < 0) return null;
  for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
    try {
      const v = JSON.parse(text.slice(start, end + 1) + ']');
      if (Array.isArray(v)) return v;
    } catch { /* tenta o `}` anterior */ }
  }
  return [];
}

/* ───────────── casamento por nome ───────────── */

/**
 * Casa os registros `m` (Map nome -> registro) com os jogadores de `e.players`, gravando `p[key]`.
 * Exato primeiro, depois nome normalizado (homônimos: o do elenco principal; ambíguo → sem par).
 */
function matchInto(e, m, key, stats, sample) {
  const exact = new Map(), normList = new Map();
  for (const p of e.players) {
    if (!exact.has(p.name)) exact.set(p.name, p);
    const k = normName(p.name);
    if (!normList.has(k)) normList.set(k, []);
    normList.get(k).push(p);
  }
  const norm = new Map();
  for (const [k, list] of normList) {
    const senior = list.filter((p) => !p.youth);
    norm.set(k, senior.length === 1 ? senior[0] : senior.length === 0 && list.length === 1 ? list[0] : null);
  }
  let n = 0;
  for (const r of m.values()) {
    stats.overrides++;
    let p = exact.get(r.name);
    if (p && !p[key]) stats.matchedExact++;
    else {
      p = norm.get(normName(r.name)) ?? undefined;
      if (p && !p[key]) stats.matchedNorm++;
      else p = undefined;
    }
    if (!p) { stats.unmatched++; if (sample.length < 25) sample.push(`${e.club.id}/${r.name}`); continue; }
    p[key] = r;
    n++;
  }
  return n;
}

/* ───────────── ajuste (país + nível) ───────────── */

const median = (a) => {
  if (!a.length) return undefined;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Modelo y ≈ a + b·(nível − 12) + resíduo(país), ajustado por mínimos quadrados ponderados com pseudo-pontos no
 * `prior` (peso `priorW`), e resíduo por país encolhido por n/(n+2). Sem dados: devolve o prior.
 * points: { country, level, y, w }
 */
export function fitModel(points, prior, { priorW = 3, lo = -Infinity, hi = Infinity } = {}) {
  const pts = points.concat([{ level: 6, y: prior, w: priorW / 2, pseudo: true }, { level: 18, y: prior, w: priorW / 2, pseudo: true }]);
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const x = p.level - 12; sw += p.w; sx += p.w * x; sy += p.w * p.y; sxx += p.w * x * x; sxy += p.w * x * p.y; }
  const den = sw * sxx - sx * sx;
  const b = den > 1e-9 ? (sw * sxy - sx * sy) / den : 0;
  const a = (sy - b * sx) / sw;
  const base = (level) => a + b * (level - 12);
  const res = new Map();
  for (const p of points) { const r = res.get(p.country) ?? []; r.push(p.y - base(p.level)); res.set(p.country, r); }
  const off = new Map();
  for (const [c, r] of res) off.set(c, (median(r) ?? 0) * (r.length / (r.length + 2)));
  // sem extrapolar a reta além da faixa de níveis com dados (os curadores cobrem sobretudo clubes grandes)
  const lv = points.map((p) => p.level);
  const lmin = lv.length ? Math.min(...lv) : 1, lmax = lv.length ? Math.max(...lv) : 24;
  const fn = (country, level) => clamp(base(clamp(level, lmin, lmax)) + (off.get(country) ?? 0), lo, hi);
  fn.params = { a, b, n: points.length, countries: off.size };
  return fn;
}

/* ───────────── recalibração ───────────── */

/**
 * entries: [{ club, players: [{ id, name, age, youth, overall, potential }] }] — overall/potencial DERIVADOS.
 * codeOf(countryId) → sigla. Muta os jogadores (overall/potential/value/wage) e `club.finances`.
 * Retorna estatísticas para o log.
 */
export function applyReal(entries, real, codeOf, warn = () => {}, opts = {}) {
  const stats = { overrides: 0, matchedExact: 0, matchedNorm: 0, unmatched: 0, unknownClubs: 0, clubsReal: 0, clubsWithPlayers: 0, unmatchedSample: [] };
  const fcStats = { overrides: 0, matchedExact: 0, matchedNorm: 0, unmatched: 0, unknownClubs: 0, ignored: 0, applied: 0, clubs: 0, bySource: {}, unmatchedSample: [] };
  stats.fc = fcStats;
  const fc = opts.fc?.players ?? new Map();
  const byId = new Map(entries.map((e) => [e.club.id, e]));
  for (const id of real.clubs.keys()) if (!byId.has(id)) { stats.unknownClubs++; warn(`real: clube desconhecido ${id}`); }
  for (const [id, m] of real.players) if (!byId.has(id)) { stats.unknownClubs++; stats.unmatched += m.size; warn(`real: jogadores de clube desconhecido ${id} (${m.size})`); }
  for (const [id, m] of fc) if (!byId.has(id)) { fcStats.unknownClubs++; fcStats.unmatched += m.size; warn(`fc27: jogadores de clube desconhecido ${id} (${m.size})`); }

  // 1) casa jogadores reais (players-*.json) e cartas FC 27 (fc27-*.json) com o elenco
  //    (nomes repetidos no elenco, ex.: titular e júnior homônimos: o dado vai para o jogador do elenco principal)
  for (const e of entries) {
    e.code = codeOf(e.club.countryId) ?? String(e.club.countryId);
    e.real = real.clubs.get(e.club.id);
    if (e.real) stats.clubsReal++;
    const m = real.players.get(e.club.id);
    e.matched = m ? matchInto(e, m, 'real', stats, stats.unmatchedSample) : 0;
    if (e.matched) stats.clubsWithPlayers++;
    const mf = fc.get(e.club.id);
    if (!mf) continue;
    // (Etapa 3) o Brasileirão não está no FC: cartas de clubes brasileiros são ignoradas (vale o tier)
    if (FC_IGNORED_COUNTRIES.includes(e.code)) { fcStats.ignored += mf.size; continue; }
    const n = matchInto(e, mf, 'fc', fcStats, fcStats.unmatchedSample);
    if (n) fcStats.clubs++;
    fcStats.applied += n;
    for (const p of e.players) if (p.fc) fcStats.bySource[p.fc.source] = (fcStats.bySource[p.fc.source] ?? 0) + 1;
  }

  // 2) overall-alvo: carta FC 27 > curadoria (deslocada para a escala FC do clube) > fallback derivado + Δ do clube
  //    Δ = mediana(alvo − derivado) dos jogadores com alvo; modelo país+nível para os clubes sem nenhum
  //    curados sem carta: diferença mediana FC − curadoria dos colegas que têm as duas (≥ 3); senão a correção global
  //    por faixa do overall curado (a curadoria antiga ficou ~3–5 abaixo do EA sob 65 e ~1 acima a partir de 75)
  const gc = fcCorrection(entries);
  stats.fc.correction = gc.table;
  const target = (e, p) => (p.fc ? p.fc.overall : p.real ? clamp(Math.round(p.real.overall + (e.fcN >= 3 ? e.fcShift : gc.at(p.real.overall))), 40, 99) : undefined);
  const dPts = [];
  for (const e of entries) {
    const both = e.players.filter((p) => p.fc && p.real).map((p) => p.fc.overall - p.real.overall);
    e.fcN = both.length;
    e.fcShift = both.length ? median(both) : 0;
    const d = e.players.filter((p) => target(e, p) !== undefined).map((p) => target(e, p) - p.overall);
    e.deltaOwn = median(d);
    e.deltaN = d.length;
    if (d.length) dPts.push({ country: e.code, level: e.club.level, y: e.deltaOwn, w: Math.min(d.length, 8) });
  }
  const deltaModel = fitModel(dPts, -1, { priorW: 6, lo: -15, hi: 8 });
  for (const e of entries) {
    const model = deltaModel(e.code, e.club.level);
    const n = e.deltaN;
    const fcs = e.players.filter((p) => p.fc).map((p) => p.fc.overall);
    e.fcMax = fcs.length ? Math.max(...fcs) : undefined;
    e.delta = n >= 3 ? e.deltaOwn : n ? (n * e.deltaOwn + 2 * model) / (n + 2) : model;
    for (const p of e.players) {
      const gap = Math.max(0, p.potential - p.overall);
      const t = target(e, p);
      if (t !== undefined) {
        p.overall = t;
        const pot = p.fc?.potential ?? (p.real?.potential !== undefined ? p.real.potential + (t - p.real.overall) : undefined);
        p.potential = clamp(pot ?? p.overall + gap, p.overall, 97);
      } else {
        // sem carta num clube com cartas: nunca acima da melhor carta do clube (elencos com escala errada)
        p.overall = clamp(Math.round(p.overall + e.delta), p.youth ? 25 : 30, Math.min(94, e.fcMax ?? 94));
        p.potential = clamp(p.overall + gap, p.overall, 97);
      }
    }
  }

  // 2b) (Etapa 3) nivelamento por tier (Brasil, resto da América do Sul e Arábia) para quem não tem carta FC
  stats.tiers = applyTiers(entries);

  // 3) valor: k = valor ÷ curva neutra. squadValue conhecido → fecha o total do elenco; senão modelo (prior por país)
  const prem = (code) => COUNTRY_PREMIUM[code] ?? DEFAULT_PREMIUM;
  const kPts = [];
  for (const e of entries) {
    let fbSum = 0, ovSum = 0;
    const ratios = [];
    for (const p of e.players) {
      p.raw = valueCurve(p.age, p.overall, p.potential);
      if (p.real?.value !== undefined) {
        if (!p.youth) ovSum += p.real.value;
        if (p.real.value > 0) ratios.push(p.real.value / p.raw);
      } else if (!p.youth) fbSum += p.raw;
    }
    // o modelo usa a razão valor real ÷ curva dos jogadores curados (estável); squadValue só ajusta o clube
    const main = e.players.filter((p) => !p.youth);
    e.coverage = main.length ? main.filter((p) => p.real).length / main.length : 0;
    e.fbSum = fbSum;
    e.ovValueSum = ovSum;
    e.kRatios = ratios.length ? median(ratios) : undefined;
    e.kN = ratios.length;
    if (ratios.length) kPts.push({ country: e.code, level: e.club.level, y: Math.log(e.kRatios / prem(e.code)), w: Math.min(ratios.length, 6) });
  }
  const kModel = fitModel(kPts, 0, { priorW: 6, lo: Math.log(0.15), hi: Math.log(6) });
  for (const e of entries) {
    const model = prem(e.code) * Math.exp(kModel(e.code, e.club.level));
    const n = Math.min(e.kN, 6);
    const ref = e.kRatios ? Math.exp((n * Math.log(e.kRatios) + 2 * Math.log(model)) / (n + 2)) : model;
    e.k = ref;
    // squadValue é alvo SUAVE: só fecha o total quando ≥ 70% do elenco principal tem dado real (em clubes pouco
    // cobertos os curadores somaram valores fixos por jogador não coberto, o que subestima o elenco); mesmo assim
    // o fator fica entre 0,5× e 2× a referência (poucos jogadores de fallback ⇒ conta instável)
    const S = e.real?.squadValue;
    if (S && e.fbSum > 0 && e.coverage >= COVERAGE_FOR_SQUAD_VALUE) {
      e.k = clamp(Math.max(S - e.ovValueSum, 0) / e.fbSum, 0.5 * ref, 2 * ref);
    }
    // piso do nível: o fallback nunca fica abaixo de 60% do prêmio esperado para o país/nível
    e.k = Math.max(e.k, K_FLOOR_SHARE * model);
    for (const p of e.players) {
      p.value = p.real?.value !== undefined ? p.real.value : Math.max(10_000, roundMoney(p.raw * e.k));
    }
  }

  // 4a) (Etapa 4) receita e caixa ANTES dos salários: a folha-alvo de cada clube sai da receita (razão folha/receita da
  //     liga, prizes.mjs → WAGE_RATIO). A receita do fallback vem do valor do elenco (não dos salários): sem circularidade.
  const revPts = [], balPts = [];
  for (const e of entries) {
    e.squadValue = e.players.filter((p) => !p.youth).reduce((s, p) => s + p.value, 0);
    if (e.real?.revenue && e.squadValue > 0) revPts.push({ country: e.code, level: e.club.level, y: Math.log(e.real.revenue / e.squadValue), w: 1 });
    if (e.real?.revenue && e.real.balance !== undefined) balPts.push({ country: e.code, level: e.club.level, y: Math.log(clamp(e.real.balance / e.real.revenue, 0.01, 2)), w: 1 });
  }
  const revModel = fitModel(revPts, Math.log(0.9), { priorW: 4, lo: Math.log(0.25), hi: Math.log(4) });
  const balModel = fitModel(balPts, Math.log(0.15), { priorW: 4, lo: Math.log(0.02), hi: Math.log(1) });
  for (const e of entries) {
    e.revenue = e.real?.revenue ?? Math.max(150_000, roundMoney(e.squadValue * Math.exp(revModel(e.code, e.club.level))));
    e.balance = e.real?.balance ?? roundMoney(e.revenue * Math.exp(balModel(e.code, e.club.level)));
  }

  // 4) salário: folha-alvo (curada × fatia dos jogadores, ou receita × razão da liga) → fecha a folha com os salários
  //    curados fixos; o que faltar além do limite do fallback sobe os curados que NÃO são as 3 estrelas do clube.
  const ratioPts = []; // ln(folha/receita) — só para o relatório (modelo antigo)
  for (const e of entries) {
    if (e.real?.wageBill && e.real?.revenue) ratioPts.push({ country: e.code, level: e.club.level, y: Math.log(e.real.wageBill / e.real.revenue), w: 1 });
  }
  const wageRatioModel = fitModel(ratioPts, Math.log(0.6), { priorW: 4, lo: Math.log(0.25), hi: Math.log(1.1) });
  // referência: razão salário real ÷ curva dos jogadores curados (mediana; estável), por clube e no modelo
  const sPts = [];
  for (const e of entries) {
    let fixed = 0, rawSum = 0;
    const ratios = [];
    for (const p of e.players) {
      p.wraw = wageCurve(p.age, p.overall) * Math.pow(e.k, WAGE_CURVE.b);
      if (p.real?.wage !== undefined) { fixed += p.real.wage; if (p.real.wage > 0) ratios.push(p.real.wage / p.wraw); }
      else rawSum += p.wraw;
    }
    e.wFixed = fixed; e.wRawSum = rawSum;
    e.sRatio = ratios.length ? median(ratios) : undefined;
    e.sN = ratios.length;
    if (ratios.length) sPts.push({ country: e.code, level: e.club.level, y: Math.log(e.sRatio), w: Math.min(ratios.length, 6) });
  }
  const sModel = fitModel(sPts, 0, { priorW: 6, lo: Math.log(0.2), hi: Math.log(5) });
  for (const e of entries) {
    const model = Math.exp(sModel(e.code, e.club.level));
    const n = Math.min(e.sN, 6);
    const ref = e.sRatio ? Math.exp((n * Math.log(e.sRatio) + 2 * Math.log(model)) / (n + 2)) : model;
    // (Etapa 4) folha-alvo anual dos JOGADORES: a folha curada (que inclui funcionários) × PLAYER_WAGE_SHARE, ou a
    // receita × razão folha/receita da liga (prizes.mjs). Antes: só clubes curados, limitada a 0,5×–2× a referência,
    // o que deixava o Brasil com ~25% da receita (Flamengo € 64 mi/ano contra ~€ 110 mi reais).
    const owner = OWNER_BACKED.includes(e.club.id);
    const ratio = wageRatioFor(e.code, e.club.leagueId, owner);
    const annual = e.real?.wageBill ? e.real.wageBill * PLAYER_WAGE_SHARE : e.revenue * ratio.target;
    e.wageTarget = annual;
    let s = ref;
    if (annual && e.wRawSum > 0) s = clamp(Math.max(annual / 12 - e.wFixed, 0) / e.wRawSum, FALLBACK_WAGE_RANGE[0] * ref, FALLBACK_WAGE_RANGE[1] * ref);
    for (const p of e.players) p.wage = p.real?.wage !== undefined ? p.real.wage : Math.max(300, roundMoney(p.wraw * s));
    // ainda abaixo do alvo (elenco quase todo curado): sobe os curados que não são as 3 estrelas (maiores salários)
    const total = e.players.reduce((t, p) => t + p.wage, 0);
    const short = annual / 12 - total;
    if (short > 0.03 * (annual / 12)) {
      const curated = e.players.filter((p) => p.real?.wage !== undefined && p.real.wage > 0).sort((a, b) => b.real.wage - a.real.wage);
      const movable = curated.slice(3);
      const base = movable.reduce((t, p) => t + p.wage, 0);
      if (base > 0) {
        const k = clamp(1 + short / base, 1, CURATED_UPLIFT_MAX);
        for (const p of movable) p.wage = roundMoney(p.wage * k);
        e.curatedUplift = k;
      }
    }
  }

  // 5) finanças do clube (receita/caixa calculados em 4a)
  for (const e of entries) {
    const wageBill = e.players.reduce((s, p) => s + p.wage, 0) * 12;
    e.club.finances = { balance: e.balance, sponsorPerSeason: roundMoney(e.revenue * SPONSOR_SHARE), revenue: e.revenue, wageBill };
    e.realSquadValue = e.real?.squadValue;
    for (const p of e.players) { delete p.raw; delete p.wraw; }
  }
  stats.models = { delta: deltaModel.params, k: kModel.params, wageScale: sModel.params, revenue: revModel.params, balance: balModel.params, wageRatio: wageRatioModel.params };
  return stats;
}

/** (Etapa 4) Fatia da folha curada (`wageBill`, com funcionários) que é de jogadores. */
export const PLAYER_WAGE_SHARE = 0.92;
/** (Etapa 4) Faixa do fator do fallback em relação à referência do clube (antes 0,5×–2×). */
export const FALLBACK_WAGE_RANGE = [0.3, 4];
/** (Etapa 4) Aumento máximo dos salários curados (fora as 3 estrelas) para fechar a folha-alvo. */
export const CURATED_UPLIFT_MAX = 1.6;

/**
 * (Etapa 3) Nivelamento por tier (tiers.mjs) dos clubes de BRA/ARG/URU/COL/CHI/PAR/EQU/ARS.
 * O overall atual (curado ou fallback) só ORDENA o elenco; jogadores com carta FC (fora do Brasil) ficam fixos.
 * Potencial = novo overall + o gap anterior (curado ou derivado), com piso de metade do gap da idade até 23 anos.
 * Grava `e.tier` e `p.status` (auxiliar, removido antes da escrita). Retorna estatísticas.
 */
export function applyTiers(entries) {
  const tiers = assignTiers(entries.map((e) => ({ id: e.club.id, code: e.code, division: e.club.division, level: e.club.level, reputation: e.club.reputation })));
  // (Etapa 3) Europa/convidados: faixa por liga para os clubes com cobertura FC fraca
  const bands = assignLeagueBands(entries.filter((e) => !tiers.has(e.club.id)).map((e) => ({ id: e.club.id, key: leagueBandKey(e.club), level: e.club.level, reputation: e.club.reputation })));
  const stats = { clubs: 0, players: 0, fixed: 0, byTier: {}, weakCoverage: { clubs: 0, players: 0, byLeague: {} } };
  for (const e of entries) {
    let t = tiers.get(e.club.id);
    if (!t) {
      const main = e.players.filter((p) => !p.youth);
      e.fcCoverage = main.length ? main.filter((p) => p.fc).length / main.length : 0;
      if (e.fcCoverage >= WEAK_COVERAGE) continue;
      t = bands.get(e.club.id);
      const w = stats.weakCoverage;
      w.clubs++;
      w.byLeague[t.key] = (w.byLeague[t.key] ?? 0) + 1;
      w.players += e.players.filter((p) => !p.fc).length;
    }
    e.tier = t;
    if (t.tier !== 'L') {
      stats.clubs++;
      stats.byTier[t.tier] = (stats.byTier[t.tier] ?? 0) + 1;
    }
    const input = e.players.map((p) => ({
      id: p.id, position: p.position, age: p.age, youth: p.youth, star: p.star, worldClass: p.worldClass,
      hash: p.hash, traits: p.traits, score: p.overall + (p.star ? 0.3 : 0) + (p.highlight ? 0.1 : 0),
      fixed: p.fc ? p.overall : undefined,
    }));
    const { ovr, status } = levelSquad(input, t.tier, t.R, t.starTop);
    for (const p of e.players) {
      p.status = status.get(p.id);
      const v = ovr.get(p.id);
      if (v === undefined) { if (t.tier !== 'L') stats.fixed++; continue; }
      const gap = Math.max(0, p.potential - p.overall, p.age <= 23 ? Math.round(growthGap(p.age) * 0.5) : 0);
      p.overall = v;
      p.potential = clamp(v + gap, v, 97);
      if (t.tier !== 'L') stats.players++;
    }
  }
  return stats;
}

/**
 * Correção global curadoria → FC 27 por faixa de 5 do overall curado: mediana(FC − curado) dos jogadores (fora do
 * Brasil) que têm as duas coisas; faixa com < 8 pontos usa a vizinha mais próxima; sem dados, 0.
 */
export function fcCorrection(entries) {
  const buckets = new Map();
  for (const e of entries) {
    if (FC_IGNORED_COUNTRIES.includes(e.code)) continue;
    for (const p of e.players) {
      if (!p.fc || !p.real) continue;
      const b = clamp(Math.floor(p.real.overall / 5) * 5, 50, 90);
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(p.fc.overall - p.real.overall);
    }
  }
  const table = {};
  for (const [b, d] of [...buckets].sort((x, y) => x[0] - y[0])) if (d.length >= 8) table[b] = Math.round(median(d) * 10) / 10;
  const keys = Object.keys(table).map(Number);
  const at = (ovr) => {
    if (!keys.length) return 0;
    const b = clamp(Math.floor(ovr / 5) * 5, 50, 90);
    const k = keys.reduce((best, x) => (Math.abs(x - b) < Math.abs(best - b) ? x : best), keys[0]);
    return table[k];
  };
  return { table, at };
}

/** Cobertura mínima (jogadores reais ÷ elenco principal) para usar `squadValue` como alvo do total. */
export const COVERAGE_FOR_SQUAD_VALUE = 0.7;
/** Piso do fator de valor do fallback, como fração do esperado para o país/nível. */
export const K_FLOOR_SHARE = 0.6;

/** Fatia da receita anual que vira patrocínio (o resto: TV e bilheteria, calculados pela engine). */
export const SPONSOR_SHARE = 0.4;
