// (Etapa 3) Overalls no padrão EA Sports FC 27 — nivelamento por tier para quem NÃO está no FC 27.
//
// Usado para: todo o Brasil (o Brasileirão não está no FC; o overall curado anterior só ORDENA o elenco), e para os
// jogadores sem carta FC 27 de Argentina, Uruguai, Colômbia, Chile, Paraguai, Equador e Arábia Saudita.
// Europa e convidados não têm tier: seguem o fallback calibrado de real.mjs, recentrado nas cartas FC 27.
//
// Cada clube tem um tier e um "R" = topo da faixa de TITULARES. As faixas por status saem de R:
//   craque    [R+1, R+5] (S) / [R+1, R+4] (demais)      titular [R−3, R]
//   reserva   [R−8, R−4]                                base    [R−15, R−9]
// Tier S: R = 77 → craques 78–82, titulares 74–77, reservas 69–73, base 62–68 (exatamente o pedido).
// Tier A: R = 75 → craques 76–79, titulares 72–75, reservas 67–71, base 60–66.
// Tiers B/C/D (meio de tabela, Série B e equivalentes): R proporcional à força do clube dentro do tier
// (nível + 0,5×reputação), de modo que os titulares andam entre 64 e 72. E (2ªs divisões fora do Brasil) e
// F (brasileiros "só estadual") ficam abaixo disso.
// Tudo é determinístico (sem RNG global): a variação orgânica sai do hash, das características e de um jitter por id.
import { clamp, hash32 } from './util.mjs';

/** Faixa de R (topo dos titulares) por tier; S e A fixos. `starTop` = quanto o craque pode passar de R. */
export const TIERS = {
  S: { R: [77, 77], starTop: 5 },
  A: { R: [75, 75], starTop: 4 },
  B: { R: [71, 72], starTop: 4 },
  C: { R: [69, 71], starTop: 4 },
  D: { R: [67, 69], starTop: 4 },
  E: { R: [61, 66], starTop: 4 },
  F: { R: [55, 65], starTop: 4 },
};

/** Países em que o tier se aplica (siglas de countries.mjs). Brasil: sempre, mesmo com carta FC. */
export const TIER_COUNTRIES = ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'EQU', 'ARS'];
export const FC_IGNORED_COUNTRIES = ['BRA'];

/**
 * Tier explícito por clube (ids de clubs-index.json), avaliação de 2026. Quem não está aqui recebe o tier padrão da
 * divisão (`defaultTier`).
 */
export const CLUB_TIERS = {
  // ── Brasil — Série A 2026
  flarj: 'S', palmeiras: 'S', 'botafogorj-bra': 'S',
  'saopaulo-bra': 'A', 'corinthians-bra': 'A', 'atleticomg-bra': 'A', gremio: 'A', 'internacional-bra': 'A',
  'cruzeiro-bra': 'A', flurj: 'A', bahia: 'A',
  'atleticopr-bra': 'B', vasco: 'B', santos: 'B', 'bragantino-bra': 'B', 'miirassol-sp': 'B',
  'coritiba-bra': 'C', vitoria: 'C', remo: 'C', 'chapecoense-bra': 'C',
  // ── Brasil — Série B 2026 (os recém-rebaixados no topo do D)
  fortaleza: 'D', 'ceara-bra': 'D', sport: 'D', juventude: 'D', goias: 'D', 'criciuma-bra': 'D', 'atleticogo-bra': 'D',
  'cuiaba-bra': 'D', 'americamg-bra': 'D', 'avai-bra': 'D', 'novorinzontino-sp': 'D', 'crb-bra': 'D', 'pontepreta-bra': 'D',
  vilago: 'D', 'operario-pr': 'D', nautico: 'D', 'botafogosp-bra': 'D', 'londrina-pr': 'D', 'saobernardo-sp': 'D', 'athleticclub-mg': 'D',
  // ── Argentina
  'riverplate-arg': 'S',
  'bocajuniors-arg': 'A', 'racing-arg': 'A',
  'estudiantes-ar': 'B', 'velezsarsfield-arg': 'B', 'lanus-arg': 'B', 'talleres-arg': 'B', 'rosariocentral-arg': 'B',
  'independiente-arg': 'B', 'sanlorenzo-ar': 'B', 'argentinojnrs-arg': 'B',
  'newoldboys-ar': 'C', 'tigre-arg': 'C', 'huracan-arg': 'C', 'belgrano-arg': 'C', 'platense-arg': 'C', 'godoycruz-ar': 'C',
  'defensayjusticia-ar': 'C', 'independienteridavia-arg': 'C', 'union-arg': 'C', 'barracascentral-arg': 'C', 'instituto-arg': 'C',
  'banfield-arg': 'C', 'gimnasialp-arg': 'C',
  // ── Arábia Saudita
  'al-hilal': 'S', 'alnassr-ara': 'S',
  'alittihad-ara': 'A', 'al-ahli-ara': 'A',
  'al-qadisiya-ara': 'B', 'ettifaq-ara': 'B', 'al-shabab-ara': 'B', 'neom-ara': 'B', 'al-taawon-ara': 'B',
  'al-fateh-ara': 'C', 'al-khaleej-ara': 'C', 'al-fayha-ara': 'C', 'al-hazem-ara': 'C', 'alkholood-ara': 'C', 'alriyadh-ara': 'C',
  // ── Uruguai
  'penarol-uru': 'B', 'nacional-uru': 'B',
  'liverpool-uru': 'C', 'defensor-uru': 'C', 'danubio-uru': 'C',
  // ── Colômbia
  'nacional-col': 'B', 'junior-col': 'B', 'millionarios-col': 'B', 'indepmedellin-col': 'B', 'americacali-col': 'B',
  'deportestolima-col': 'B', 'santafe-col': 'B',
  'deportivocali-col': 'C', 'oncecaldas-col': 'C', 'bucaramanga-col': 'C', 'deportivopereira-col': 'C',
  // ── Chile
  'colocolo-chi': 'B', 'universidadchile-chi': 'B', 'universidadcatolica-chi': 'B',
  'huachipato-chi': 'C', 'ohiggins-chi': 'C', 'coquimbounido-chi': 'C', 'palestino-chi': 'C', 'audax-chi': 'C', 'everton-chi': 'C',
  // ── Paraguai
  'olimpia-par': 'B', 'cerroporteno-par': 'B', 'libertad-par': 'B',
  'guarani-par': 'C', 'nacional-par': 'C', '2demayo-par': 'C',
  // ── Equador
  'ldu-equ': 'B', 'independiente-equ': 'B', 'barcelona-equ': 'B',
  'emelec-equ': 'C', 'univcatolicaquito-equ': 'C', 'aucas-equ': 'C', 'deportivocuenca-equ': 'C', 'orense-equ': 'C', 'macara-equ': 'C',
};

/** Tier padrão: Série A → C, Série B → D, Brasil "só estadual" → F; fora do Brasil 1ª divisão → D, 2ª → E. */
export function defaultTier(code, division) {
  if (code === 'BRA') return division === 1 ? 'C' : division === 2 ? 'D' : 'F';
  return division === 1 ? 'D' : 'E';
}

/**
 * Tier e R de todos os clubes com tier. clubs: [{ id, code, division, level, reputation }].
 * R é interpolado dentro do tier pela força (nível + 0,5×reputação) normalizada entre os clubes do mesmo tier.
 * @returns Map clubId -> { tier, R, q }
 */
export function assignTiers(clubs) {
  const out = new Map();
  const groups = new Map();
  for (const c of clubs) {
    if (!TIER_COUNTRIES.includes(c.code)) continue;
    const tier = CLUB_TIERS[c.id] ?? defaultTier(c.code, c.division);
    const s = (c.level ?? 1) + 0.5 * (c.reputation ?? 0);
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push({ id: c.id, s });
  }
  for (const [tier, list] of groups) {
    const lo = Math.min(...list.map((x) => x.s)), hi = Math.max(...list.map((x) => x.s));
    const [r0, r1] = TIERS[tier].R;
    for (const x of list) {
      const q = hi > lo ? (x.s - lo) / (hi - lo) : 0.5;
      out.set(x.id, { tier, q, R: Math.round(r0 + (r1 - r0) * q) });
    }
  }
  return out;
}

/* ───────────── (Etapa 3) faixas por liga: Europa/convidados com pouca cobertura FC ───────────── */

/**
 * Clubes sem tier (Europa e convidados) cujo elenco principal tem < WEAK_COVERAGE de cartas FC 27 (elencos
 * desatualizados no original: 2ªs divisões, alguns clubes da 1ª, convidados asiáticos...): os sem carta são
 * nivelados como os tiers, com R por liga interpolado pela força do clube na liga. Faixas calibradas pela
 * distribuição das cartas FC 27 dos clubes bem cobertos (titulares de 2ª divisão ~64–74, craque raramente > 76).
 */
export const WEAK_COVERAGE = 0.5;
export const LEAGUE_BANDS = {
  'ING-1': { R: [74, 80], starTop: 4 }, 'ESP-1': { R: [73, 79], starTop: 4 }, 'ITA-1': { R: [72, 78], starTop: 4 },
  'ALE-1': { R: [72, 78], starTop: 4 }, 'FRA-1': { R: [71, 77], starTop: 4 },
  'POR-1': { R: [68, 74], starTop: 4 }, 'HOL-1': { R: [68, 74], starTop: 4 },
  'ING-2': { R: [68, 73], starTop: 3 }, 'ESP-2': { R: [67, 72], starTop: 3 }, 'ITA-2': { R: [67, 72], starTop: 3 },
  'ALE-2': { R: [67, 72], starTop: 3 }, 'FRA-2': { R: [67, 72], starTop: 3 },
  'POR-2': { R: [64, 69], starTop: 3 }, 'HOL-2': { R: [64, 69], starTop: 3 },
  GUEST: { R: [68, 75], starTop: 4 },
  default: { R: [64, 70], starTop: 3 },
};
export const leagueBandKey = (club) => (club.guest ? 'GUEST' : club.leagueId && LEAGUE_BANDS[club.leagueId] ? club.leagueId : 'default');

/**
 * R por clube para TODOS os clubes sem tier (usado só nos de cobertura fraca). Força = nível + 0,5×reputação,
 * normalizada dentro da liga (ou do grupo de convidados).
 * clubs: [{ id, key, level, reputation }] → Map id -> { tier: 'L', key, R, q, starTop }
 */
export function assignLeagueBands(clubs) {
  const groups = new Map();
  for (const c of clubs) {
    if (!groups.has(c.key)) groups.set(c.key, []);
    groups.get(c.key).push({ id: c.id, s: (c.level ?? 1) + 0.5 * (c.reputation ?? 0) });
  }
  const out = new Map();
  for (const [key, list] of groups) {
    const lo = Math.min(...list.map((x) => x.s)), hi = Math.max(...list.map((x) => x.s));
    const b = LEAGUE_BANDS[key] ?? LEAGUE_BANDS.default;
    for (const x of list) {
      const q = hi > lo ? (x.s - lo) / (hi - lo) : 0.5;
      out.set(x.id, { tier: 'L', key, q, R: Math.round(b.R[0] + (b.R[1] - b.R[0]) * q), starTop: b.starTop });
    }
  }
  return out;
}

/** Faixas [lo, hi] por status para um clube de tier `tier` e topo de titulares R. */
export function statusBands(tier, R, starTop = TIERS[tier]?.starTop ?? 4) {
  return {
    star: [R + 1, R + starTop],
    starter: [R - 3, R],
    reserve: [R - 8, R - 4],
    youth: [R - 15, R - 9],
  };
}

/* ───────────── status no elenco ───────────── */

/** Cotas de posição do XI (4-3-3 e 4-4-2; vale a que somar mais). */
export const XI_QUOTAS = [
  { GK: 1, FB: 2, CB: 2, MF: 3, FW: 3 },
  { GK: 1, FB: 2, CB: 2, MF: 4, FW: 2 },
];
export const MAX_STARS = 3;
export const YOUTH_AGE = 20;

/**
 * Status de cada jogador: 'star' | 'starter' | 'reserve' | 'youth'.
 * players: [{ id, position, age, youth, star, worldClass, score }] — `score` ordena (overall curado anterior).
 * - base (flag `youth`) → youth;
 * - XI = melhor 11 por posição (4-3-3/4-4-2) entre os demais; faltando posição, completa com os melhores de linha;
 * - craques: os 2 melhores do XI + quem tem flag craque/top mundial no XI (máx. 3; o 3º sem flag só se estiver
 *   a ≤ 1 ponto do 2º);
 * - quem tem ≤ 20 anos e ficou fora do XI → youth; os demais → reserve.
 * @returns Map id -> status
 */
export function squadStatus(players) {
  const st = new Map();
  const byScore = (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id));
  const seniors = players.filter((p) => !p.youth).sort(byScore);
  for (const p of players) if (p.youth) st.set(p.id, 'youth');
  let best = null;
  for (const quota of XI_QUOTAS) {
    const left = { ...quota };
    const xi = [];
    for (const p of seniors) if (left[p.position] > 0) { left[p.position]--; xi.push(p); }
    // completa com os melhores restantes (GK só se faltar goleiro)
    for (const p of seniors) {
      if (xi.length >= 11) break;
      if (xi.includes(p)) continue;
      if (p.position === 'GK' && xi.some((x) => x.position === 'GK')) continue;
      xi.push(p);
    }
    const sum = xi.reduce((s, p) => s + p.score, 0);
    if (!best || sum > best.sum) best = { xi, sum };
  }
  const xi = (best?.xi ?? []).slice().sort(byScore);
  const stars = new Set(xi.slice(0, 2).map((p) => p.id));
  for (const p of xi) if (stars.size < MAX_STARS && (p.star || p.worldClass)) stars.add(p.id);
  if (stars.size < MAX_STARS && xi.length >= 3 && xi[1].score - xi[2].score <= 1) stars.add(xi[2].id);
  const inXI = new Set(xi.map((p) => p.id));
  for (const p of seniors) st.set(p.id, stars.has(p.id) ? 'star' : inXI.has(p.id) ? 'starter' : p.age <= YOUTH_AGE ? 'youth' : 'reserve');
  return st;
}

/* ───────────── variação orgânica ───────────── */

/**
 * Variação −1..+2 a partir de atributos secundários: hash (0–10) 45%, nº de características 25%, jitter por id 30%.
 * Craque/top mundial empurram +0,15. Determinística.
 */
export function organicVariation(p) {
  const h = Number.isFinite(p.hash) ? clamp(p.hash, 0, 10) / 10 : 0.5;
  const t = clamp((p.traits?.length ?? 0) / 2, 0, 1);
  const j = (hash32('fc27var:' + p.id) % 1000) / 999;
  const f = clamp(0.45 * h + 0.25 * t + 0.3 * j + (p.star || p.worldClass ? 0.15 : 0), 0, 1);
  return clamp(Math.round(-1 + 3 * f), -1, 2);
}

/* ───────────── nivelamento de um clube ───────────── */

/**
 * Overall por tier para os jogadores de um clube.
 * players: [{ id, position, age, youth, star, worldClass, hash, traits, score, fixed? }]
 *  - `fixed` = overall vindo do FC 27 (não muda; participa só da escolha de status).
 * Dentro de cada status, a ordem de `score` é preservada: a base vai de hi−1 (melhor) a lo (pior) por ranking,
 * soma a variação, limita à faixa e passa um mínimo acumulado (ninguém passa quem estava à frente).
 * @returns { ovr: Map id -> overall (só os não fixos), status: Map id -> status, bands }
 */
export function levelSquad(players, tier, R, starTop) {
  const status = squadStatus(players);
  const bands = statusBands(tier, R, starTop);
  const ovr = new Map();
  for (const s of ['star', 'starter', 'reserve', 'youth']) {
    const [lo, hi] = bands[s];
    const group = players.filter((p) => status.get(p.id) === s && p.fixed === undefined)
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    const n = group.length;
    let prev = Infinity;
    group.forEach((p, i) => {
      const t = n > 1 ? (n - 1 - i) / (n - 1) : 0.5;
      const base = Math.round(lo + (hi - 1 - lo) * t);
      let v = clamp(base + organicVariation(p), lo, hi);
      v = Math.min(v, prev);
      prev = v;
      ovr.set(p.id, v);
    });
  }
  return { ovr, status, bands };
}
