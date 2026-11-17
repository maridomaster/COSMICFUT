/**
 * (Etapa 2) Competições reais de clubes fora da CONMEBOL e vagas continentais automáticas.
 *
 *  - UEFA 2026/27 (ciclo 'split', região EU):
 *      · Liga dos Campeões e Liga Europa: fase de liga de 36 clubes (4 potes de 9, 8 jogos, 2 adversários por pote,
 *        4 em casa e 4 fora) → 1º–8º direto às oitavas, 9º–24º playoff I/V, 25º–36º eliminados → oitavas, quartas e
 *        semi I/V (chave fixa) → final única em campo neutro.
 *      · Liga Conferência: idem com 6 potes de 6 e 6 jogos (1 adversário por pote).
 *      · Supercopa da UEFA (agosto): campeão da Liga dos Campeões × campeão da Liga Europa.
 *  - AFC Champions League Elite 2026/27 (ciclo 'split', região SAU): playoff (4º saudita × convidado do Oeste) →
 *    fase de liga Oeste e Leste (12 cada, 4 potes de 3, 8 jogos dentro da região) → oitavas I/V por região (1º×8º…)
 *    → quartas, semi e final em jogo único na sede centralizada (Jidá).
 *  - FIFA (ciclo 'calendar'): Copa Intercontinental (dezembro) e Supermundial (a cada 4 anos a partir de 2029).
 *
 * Convidados: só 7 países europeus (e 1 asiático) estão no escopo; as demais vagas vão a CLUBES CONVIDADOS de
 * países fora do escopo (competitions.json → guests), sem liga nacional, sorteados a cada temporada com peso pela
 * força (nível/reputação): os mais fortes tendem à Liga dos Campeões, os seguintes à Liga Europa e os demais à
 * Conferência. Os campeões da CONCACAF, CAF e OFC (Intercontinental) também são convidados sorteados.
 *
 * Vagas (`ConfedQualifiers`, WorldState.uefa / .afc): gravadas na virada de 30/06 a partir das tabelas finais, dos
 * campeões das copas e dos campeões continentais, com repasse (vaga de quem já está classificado desce na tabela).
 * Puro e determinístico.
 */
import type { FormatDef, GuestsConfig, KnockoutRoundDef, PickRule, UefaSlotsConfig } from '@cosmicfut/shared';
import type { CareerData, Competition, CompetitionLink, ConfedQualifiers, SeasonState, WorldState } from '../contract';
import { Rng } from '../rng';
import { pick } from './format';
import { feedCompetition, intercontinentalFormat, leagueLabel, strengthSort, supermundialFormat, supermundialYear, type SupermundialMode } from './continental';
import { supercupFormat } from './competitions';
import type { Region } from './timeline';

type ClubMeta = CareerData['clubs'][number];

/* ═════════════════════ configuração ═════════════════════ */

/** Vagas UEFA 2026/27 por país em escopo (fallback se competitions.json não trouxer). */
export const DEFAULT_UEFA_SLOTS: UefaSlotsConfig = {
  slots: {
    ING: { ucl: 5, uel: 2, uecl: 1 }, ESP: { ucl: 5, uel: 2, uecl: 1 }, ITA: { ucl: 4, uel: 2, uecl: 1 }, ALE: { ucl: 4, uel: 2, uecl: 1 },
    FRA: { ucl: 3, uel: 2, uecl: 1 }, POR: { ucl: 2, uel: 2, uecl: 1 }, HOL: { ucl: 2, uel: 2, uecl: 1 },
  },
  cupToUel: true,
  leagueCupToUecl: ['ING'],
};

export function uefaSlotsConfig(data: CareerData): UefaSlotsConfig {
  return data.competitions.uefa ?? DEFAULT_UEFA_SLOTS;
}

/** Tamanho das fases de liga e da AFC Elite. */
export const LEAGUE_PHASE_SIZE = 36;
export const AFC_REGION_SIZE = 12;
/** AFC Elite: vagas sauditas diretas e no playoff. */
export const AFC_SAUDI = { direct: 3, playoff: 1 };

/** Convidados por confederação (só os que existem nos dados). Sem `guests` no JSON: clubes com `guest` por `confed`. */
export function guestsConfig(data: CareerData): GuestsConfig {
  const g = data.competitions.guests;
  const has = new Set(data.clubs.map((c) => c.id));
  const f = (l?: string[]) => (l ?? []).filter((id) => has.has(id));
  if (g) return { UEFA: f(g.UEFA), AFC_WEST: f(g.AFC_WEST), AFC_EAST: f(g.AFC_EAST), CONCACAF: f(g.CONCACAF), CAF: f(g.CAF), OFC: f(g.OFC) };
  const by = (k: string) => data.clubs.filter((c) => c.guest && c.confed === k).map((c) => c.id);
  return { UEFA: by('UEFA'), AFC_WEST: by('AFC'), AFC_EAST: [], CONCACAF: by('CONCACAF'), CAF: by('CAF'), OFC: by('OFC') };
}

/** Região usada pelo convidado (janela, ciclo de contratos): UEFA → Europa; AFC → Arábia; demais → América do Sul. */
export function guestRegion(confed: string | undefined): Region | null {
  if (!confed) return null;
  return confed === 'UEFA' ? 'EU' : confed === 'AFC' ? 'SAU' : 'SA';
}

/* ═════════════════════ sorteio ponderado dos convidados ═════════════════════ */

/** Peso pela força: e^(k·(nível − 15)) × (1 + 0,2·reputação). k maior = mais elitista. */
export function strengthWeight(meta: Map<string, ClubMeta>, k: number): (id: string) => number {
  return (id) => {
    const m = meta.get(id);
    return Math.exp(k * ((m?.level ?? 12) - 15)) * (1 + 0.2 * (m?.reputation ?? 2));
  };
}

/**
 * Sorteio sem reposição de `count` clubes de `pool`, com peso `weight` e no máximo `maxPerCountry` por país (o teto é
 * relaxado se não houver outra opção). Determinístico.
 */
export function drawWeighted(
  pool: string[], count: number, rng: Rng, weight: (id: string) => number,
  o: { exclude?: Set<string>; maxPerCountry?: number; countryOf?: (id: string) => number | undefined } = {},
): string[] {
  const out: string[] = [];
  const cnt = new Map<number | undefined, number>();
  let avail = pool.filter((id) => !o.exclude?.has(id));
  while (out.length < count && avail.length) {
    const ok = o.maxPerCountry ? avail.filter((id) => (cnt.get(o.countryOf?.(id)) ?? 0) < o.maxPerCountry!) : avail;
    const list = ok.length ? ok : avail;
    const i = rng.weightedIndex(list.map(weight));
    const id = list[Math.max(0, i)];
    out.push(id);
    avail = avail.filter((x) => x !== id);
    const k = o.countryOf?.(id);
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  return out;
}

/* ═════════════════════ formatos ═════════════════════ */

const IV = { legs: 2 as const };
const JU_NEUTRAL = { legs: 1 as const, neutral: true };

/**
 * Fase de liga da UEFA: `pots` potes, `perPot` adversários por pote; playoff 9º–24º; oitavas (1º–8º × vencedores do
 * playoff), quartas e semi I/V em chave fixa; final única neutra. Datas: R rodadas + 9 (playoff 2, oitavas 2, quartas
 * 2, semi 2, final 1).
 */
export function leaguePhaseFormat(id: string, pots: number, perPot: 1 | 2): FormatDef {
  const R = pots * perPot;
  const s = (k: number) => [R + k, R + k + 1];
  const rounds: KnockoutRoundDef[] = [
    { name: 'Oitavas de Final', tie: IV, slots: s(2) }, { name: 'Quartas de Final', tie: IV, slots: s(4) },
    { name: 'Semifinal', tie: IV, slots: s(6) }, { name: 'Final', tie: JU_NEUTRAL, slots: [R + 8] },
  ];
  return {
    id, teams: LEAGUE_PHASE_SIZE,
    summary: `fase de liga (36 clubes, ${pots} potes, ${R} jogos: ${perPot} por pote) → 1º–8º às oitavas, 9º–24º no playoff I/V, 25º–36º eliminados → oitavas, quartas e semi I/V → final única`,
    stages: [
      { id: 'league', kind: 'table', name: 'Fase de Liga', label: 'FASE DE LIGA', legs: 1, sources: [{ entrants: 'all' }], swiss: { pots, perPot } },
      {
        id: 'playoff', kind: 'knockout', name: 'Playoff', label: 'PLAYOFF DAS OITAVAS', sources: [{ stage: 'league', ranks: [9, 24] }],
        seeding: 'uefa-playoff', rankStage: 'league', rounds: [{ name: 'Playoff', tie: IV, slots: s(0) }],
      },
      {
        id: 'ko', kind: 'knockout', name: 'Fase Final', sources: [{ stage: 'league', ranks: [1, 8] }, { stage: 'playoff', winners: true }],
        seeding: 'uefa-r16', rankStage: 'league', bracket: true, rounds,
      },
    ],
    champion: 'ko',
  };
}

/** AFC Champions League Elite (14 datas): playoff → fase de liga Oeste/Leste → oitavas I/V por região → finais em Jidá. */
export function aclEliteFormat(): FormatDef {
  const r16 = (id: string, name: string, group: number) => ({
    id, kind: 'knockout' as const, name, sources: [{ stage: 'league', ranks: [1, 8] as [number, number], group }], seeding: 'table' as const,
    rounds: [{ name: 'Oitavas de Final', tie: IV, slots: [9, 10] }],
  });
  return {
    id: 'ACL', teams: 24,
    summary: 'playoff (Oeste) → fase de liga Oeste e Leste (12 clubes cada, 4 potes de 3, 8 jogos) → oitavas I/V por região (1º×8º…) → quartas, semi e final em jogo único na sede (Jidá)',
    stages: [
      { id: 'po', kind: 'knockout', name: 'Playoff', label: 'PLAYOFF (OESTE)', sources: [{ entrants: 'po' }], seeding: 'order', rounds: [{ name: 'Playoff', tie: { legs: 1 }, slots: [0] }] },
      {
        id: 'league', kind: 'table', name: 'Fase de Liga', label: 'FASE DE LIGA', groupNames: ['Oeste', 'Leste'], legs: 1, sources: [], after: ['po'], slotStart: 1,
        groupSources: [[{ entrants: 'west' }, { stage: 'po', winners: true }], [{ entrants: 'east' }]], swiss: { pots: 4, perPot: 2 },
      },
      r16('r16w', 'Oitavas (Oeste)', 0),
      r16('r16e', 'Oitavas (Leste)', 1),
      {
        id: 'finals', kind: 'knockout', name: 'Fase Final (Jidá)', label: 'FASE FINAL (JIDÁ)', seeding: 'pots',
        sources: [{ stage: 'r16w', winners: true }, { stage: 'r16e', winners: true }],
        rounds: [{ name: 'Quartas de Final', tie: JU_NEUTRAL, slots: [11] }, { name: 'Semifinal', tie: JU_NEUTRAL, slots: [12] }, { name: 'Final', tie: JU_NEUTRAL, slots: [13] }],
      },
    ],
    champion: 'finals',
  };
}

/* ═════════════════════ vagas ═════════════════════ */

function metaOf(data: CareerData): Map<string, ClubMeta> {
  return new Map(data.clubs.map((c) => [c.id, c]));
}

function regName(data: CareerData, id: string, fallback: string): string {
  return data.competitions.competitions.find((c) => c.id === id)?.name ?? fallback;
}

/** Ordem da liga de um país: tabela final da última temporada (`lastRanking`) ou força (1º ano). */
function countryOrder(world: WorldState, code: string, meta: Map<string, ClubMeta>, given?: string[]): { order: string[]; source: 'results' | 'strength' } {
  if (given?.length) return { order: given, source: 'results' };
  const last = world.lastRanking[`${code}-1`];
  return { order: last?.length ? last : strengthSort(world.divisions[`${code}-1`] ?? [], meta), source: 'strength' };
}

export interface ConfedQualifyInput {
  /** ordem final da liga por país (sigla → clubes); ausente ⇒ lastRanking/força */
  orders?: Record<string, string[]>;
}

/**
 * Vagas UEFA da temporada `season` (lista de acesso real dos 7 países + campeões + convidados):
 *  1) por país: Liga dos Campeões pelas posições; Liga Europa = campeão da copa (repasse se já classificado) + posições;
 *     Conferência = posições (Inglaterra: campeão da EFL Cup);
 *  2) campeões da temporada anterior (só se ainda não classificados): Liga dos Campeões e Liga Europa → Liga dos
 *     Campeões; Conferência → Liga Europa;
 *  3) convidados até 36 em cada competição (sorteio ponderado: forte na Liga dos Campeões, moderado na Europa,
 *     quase uniforme na Conferência; no máximo 2/3/4 por país).
 */
export function qualifyUefa(data: CareerData, world: WorldState, season: number, input: ConfedQualifyInput = {}): ConfedQualifiers {
  const cfg = uefaSlotsConfig(data);
  const meta = metaOf(data);
  const lists: Record<string, string[]> = { UCL: [], UEL: [], UECL: [] };
  const reason: Record<string, string> = {};
  const source: Record<string, 'results' | 'strength'> = {};
  const taken = new Set<string>();
  const add = (comp: string, c: string, why: string, front = false) => {
    taken.add(c);
    if (front) lists[comp].unshift(c); else lists[comp].push(c);
    reason[c] = why;
  };
  const orders: Record<string, string[]> = {};
  for (const [code, s] of Object.entries(cfg.slots)) {
    if (!world.divisions[`${code}-1`]) continue;
    const o = countryOrder(world, code, meta, input.orders?.[code]);
    orders[code] = o.order;
    source[code] = o.source;
    const lbl = leagueLabel(data, code);
    const order = o.order;
    let i = 0;
    const next = () => { while (i < order.length) { const c = order[i++]; if (!taken.has(c)) return c; } return null; };
    const pos = (c: string) => order.indexOf(c) + 1;
    for (let k = 0; k < s.ucl; k++) { const c = next(); if (c) add('UCL', c, `${lbl} ${pos(c)}º → Liga dos Campeões`); }
    let uel = s.uel;
    const h = world.holders?.[code];
    if (cfg.cupToUel && uel > 0 && h?.cup && meta.has(h.cup) && !taken.has(h.cup)) {
      add('UEL', h.cup, `Campeão da ${regName(data, `${code}-CUP`, 'copa nacional')}`);
      uel--;
    }
    for (let k = 0; k < uel; k++) { const c = next(); if (c) add('UEL', c, `${lbl} ${pos(c)}º → Liga Europa`); }
    let uecl = s.uecl;
    if (cfg.leagueCupToUecl?.includes(code) && uecl > 0 && h?.leagueCup && meta.has(h.leagueCup) && !taken.has(h.leagueCup)) {
      add('UECL', h.leagueCup, `Campeão da ${regName(data, `${code}-LCUP`, 'copa da liga')}`);
      uecl--;
    }
    for (let k = 0; k < uecl; k++) { const c = next(); if (c) add('UECL', c, `${lbl} ${pos(c)}º → Liga Conferência`); }
  }
  // campeões continentais da temporada anterior (vaga própria só se não classificados pela liga)
  const th = world.titleHolders ?? {};
  for (const [id, comp, why] of [['UCL', 'UCL', 'Campeão da Liga dos Campeões'], ['UEL', 'UCL', 'Campeão da Liga Europa'], ['UECL', 'UEL', 'Campeão da Liga Conferência']] as const) {
    const t = th[id];
    if (!t || t.season !== season - 1 || !meta.has(t.clubId)) continue;
    if (!taken.has(t.clubId)) add(comp, t.clubId, why, true);
    else {
      // (Etapa 4, correção) classificado pela liga para uma competição MENOR: o título garante a vaga na maior
      // (regra da UEFA); a vaga que sobra na menor é completada pelos convidados
      const tier: Record<string, number> = { UCL: 0, UEL: 1, UECL: 2 };
      const cur = (['UCL', 'UEL', 'UECL'] as const).find((k) => lists[k].includes(t.clubId));
      if (cur && tier[cur] > tier[comp]) {
        lists[cur] = lists[cur].filter((x) => x !== t.clubId);
        taken.delete(t.clubId);
        add(comp, t.clubId, why, true);
      }
    }
  }
  // convidados
  const pool = guestsConfig(data).UEFA;
  const rng = new Rng(`${world.seed}:${season}:uefa:guests`);
  const countryOf = (id: string) => meta.get(id)?.countryId;
  const guests: string[] = [];
  for (const [comp, k, cap] of [['UCL', 0.6, 2], ['UEL', 0.3, 3], ['UECL', 0.05, 4]] as const) {
    const need = LEAGUE_PHASE_SIZE - lists[comp].length;
    if (need <= 0) continue;
    for (const c of drawWeighted(pool, need, rng, strengthWeight(meta, k), { exclude: taken, maxPerCountry: cap, countryOf })) {
      add(comp, c, 'Convidado (sorteio ponderado pela força)');
      guests.push(c);
    }
  }
  // sem convidados suficientes: completa com os próximos das ligas em escopo (país a país)
  const codes = Object.keys(orders);
  for (const comp of ['UCL', 'UEL', 'UECL']) {
    let guard = 0;
    while (lists[comp].length < LEAGUE_PHASE_SIZE && guard++ < 400 && codes.length) {
      const code = codes[guard % codes.length];
      const c = orders[code].find((x) => !taken.has(x));
      if (c) add(comp, c, `${leagueLabel(data, code)} ${orders[code].indexOf(c) + 1}º → vaga extra`);
    }
  }
  return { confed: 'UEFA', season, lists, reason, guests, source };
}

/**
 * Vagas da AFC Champions League Elite da temporada `season`: Arábia Saudita com 3 diretas (1º e 2º da Saudi Pro
 * League e o campeão da King's Cup — repasse para o 3º) e 1 no playoff (o seguinte); convidados: 8 do Oeste + o
 * adversário do playoff, 12 do Leste.
 */
export function qualifyAfc(data: CareerData, world: WorldState, season: number, input: ConfedQualifyInput = {}): ConfedQualifiers {
  const meta = metaOf(data);
  const lists: Record<string, string[]> = { west: [], east: [], playoff: [] };
  const reason: Record<string, string> = {};
  const source: Record<string, 'results' | 'strength'> = {};
  const taken = new Set<string>();
  const add = (k: string, c: string, why: string) => { taken.add(c); lists[k].push(c); reason[c] = why; };
  if (world.divisions['ARS-1']) {
    const o = countryOrder(world, 'ARS', meta, input.orders?.ARS);
    source.ARS = o.source;
    const lbl = leagueLabel(data, 'ARS');
    let i = 0;
    const next = () => { while (i < o.order.length) { const c = o.order[i++]; if (!taken.has(c)) return c; } return null; };
    const pos = (c: string) => o.order.indexOf(c) + 1;
    for (let k = 0; k < AFC_SAUDI.direct - 1; k++) { const c = next(); if (c) add('west', c, `${lbl} ${pos(c)}º → AFC Elite`); }
    const cup = world.holders?.ARS?.cup;
    if (cup && meta.has(cup) && !taken.has(cup)) add('west', cup, `Campeão da ${regName(data, 'ARS-CUP', "King's Cup")}`);
    else { const c = next(); if (c) add('west', c, `${lbl} ${pos(c)}º → AFC Elite`); }
    for (let k = 0; k < AFC_SAUDI.playoff; k++) { const c = next(); if (c) add('playoff', c, `${lbl} ${pos(c)}º → AFC Elite (playoff)`); }
  }
  const g = guestsConfig(data);
  const rng = new Rng(`${world.seed}:${season}:afc:guests`);
  const countryOf = (id: string) => meta.get(id)?.countryId;
  const guests: string[] = [];
  const westNeed = AFC_REGION_SIZE - lists.west.length - (lists.playoff.length ? 1 : 0);
  const west = drawWeighted(g.AFC_WEST, westNeed + (lists.playoff.length ? 1 : 0), rng, strengthWeight(meta, 0.4), { exclude: taken, maxPerCountry: 4, countryOf });
  west.slice(0, westNeed).forEach((c) => add('west', c, 'Convidado (sorteio ponderado pela força)'));
  west.slice(westNeed).forEach((c) => add('playoff', c, 'Convidado (playoff)'));
  const east = drawWeighted(g.AFC_EAST, AFC_REGION_SIZE, rng, strengthWeight(meta, 0.35), { exclude: taken, maxPerCountry: 4, countryOf });
  east.forEach((c) => add('east', c, 'Convidado (sorteio ponderado pela força)'));
  guests.push(...west, ...east);
  return { confed: 'AFC', season, lists, reason, guests, source };
}

/**
 * Campeões continentais da temporada anterior ao 1º ano (não simulada): CONMEBOL pelos resultados reais de 2025
 * (competitions.json → continental.initial); UEFA e AFC por sorteio ponderado entre os mais fortes.
 */
export function initialTitleHolders(data: CareerData, seed: string, season: number): Record<string, { clubId: string; season: number }> {
  const meta = metaOf(data);
  const rng = new Rng(`${seed}:${season}:initial-holders`);
  const out: Record<string, { clubId: string; season: number }> = {};
  const prev = season - 1;
  const eu = strengthSort([...['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'].flatMap((c) => data.leagues.find((l) => l.id === `${c}-1`)?.clubIds ?? []), ...guestsConfig(data).UEFA], meta);
  const used = new Set<string>();
  const draw = (pool: string[], k: number) => {
    const c = drawWeighted(pool.filter((x) => !used.has(x)), 1, rng, strengthWeight(meta, k))[0];
    if (c) used.add(c);
    return c;
  };
  const ucl = draw(eu.slice(0, 8), 0.8);
  if (ucl) out.UCL = { clubId: ucl, season: prev };
  const uel = draw(eu.slice(8, 30), 0.5);
  if (uel) out.UEL = { clubId: uel, season: prev };
  const uecl = draw(eu.slice(20, 60), 0.3);
  if (uecl) out.UECL = { clubId: uecl, season: prev };
  const g = guestsConfig(data);
  const asia = strengthSort([...(data.leagues.find((l) => l.id === 'ARS-1')?.clubIds ?? []).slice(), ...g.AFC_WEST, ...g.AFC_EAST], meta);
  const acl = draw(asia.slice(0, 8), 0.6);
  if (acl) out.ACL = { clubId: acl, season: prev };
  const init = data.competitions.continental?.initial;
  if (init?.season === prev) {
    if (init.LIBERTADORES && meta.has(init.LIBERTADORES)) out.LIBERTADORES = { clubId: init.LIBERTADORES, season: prev };
    if (init.SULAMERICANA && meta.has(init.SULAMERICANA)) out.SULAMERICANA = { clubId: init.SULAMERICANA, season: prev };
  }
  return out;
}

/* ═════════════════════ competições ═════════════════════ */

function newComp(id: string, name: string, type: Competition['type'], clubIds: string[], extra: Partial<Competition>): Competition {
  return { id, name, type, clubIds: clubIds.slice(), doubleRound: false, relegated: 0, promoted: 0, fixtures: [], ...extra };
}

type CalOf = (key: string, fallback?: string) => string[];

/** Ordem de pote: os primeiros fixos (campeões), o resto pela força (nível/reputação), como o coeficiente. */
function potOrder(ids: string[], first: (string | undefined)[], meta: Map<string, ClubMeta>): string[] {
  const head = first.filter((x): x is string => !!x && ids.includes(x));
  return [...head, ...strengthSort(ids.filter((x) => !head.includes(x)), meta)];
}

/** Liga dos Campeões, Liga Europa, Conferência e Supercopa da UEFA da temporada `season` (2026 = 2026/27). */
export function uefaCompetitions(world: WorldState, data: CareerData, season: number, cal: CalOf): Competition[] {
  const meta = metaOf(data);
  const q = world.uefa?.season === season ? world.uefa : qualifyUefa(data, world, season);
  const th = world.titleHolders ?? {};
  const holder = (id: string) => (th[id]?.season === season - 1 ? th[id].clubId : undefined);
  const reg = (id: string) => data.competitions.competitions.find((c) => c.id === id);
  const out: Competition[] = [];
  const phases: [string, string, number, 1 | 2, string, (string | undefined)[]][] = [
    ['UCL', 'Liga dos Campeões da UEFA', 4, 2, 'CHAMPIONS', [holder('UCL'), holder('UEL')]],
    ['UEL', 'Liga Europa da UEFA', 4, 2, 'EUROPA', [holder('UECL')]],
    ['UECL', 'Liga Conferência da UEFA', 6, 1, 'CONFERENCE', []],
  ];
  for (const [id, name, pots, perPot, prize, first] of phases) {
    const ids = q.lists[id] ?? [];
    if (ids.length < 4) continue;
    const pot = potOrder(ids, first, meta);
    out.push(newComp(id, reg(id)?.name ?? name, 'continental', pot, {
      format: leaguePhaseFormat(id, pots, perPot), entrants: { all: pot }, calendar: cal(id), priority: reg(id)?.priority ?? 4,
      prizeKey: reg(id)?.prizeKey ?? prize, confed: 'UEFA',
    }));
  }
  const a = holder('UCL'), b = holder('UEL');
  if (a && b && a !== b) {
    out.push(newComp('UEFA-SUP', reg('UEFA-SUP')?.name ?? 'Supercopa da UEFA', 'supercup', [a, b], {
      format: supercupFormat('UEFA-SUP'), entrants: { all: [a, b] }, calendar: cal('UEFA-SUP'), priority: 4, prizeKey: reg('UEFA-SUP')?.prizeKey ?? 'UEFA_SUPER', confed: 'UEFA',
    }));
  }
  return out;
}

/** AFC Champions League Elite da temporada `season`. */
export function afcCompetitions(world: WorldState, data: CareerData, season: number, cal: CalOf): Competition[] {
  const meta = metaOf(data);
  const q = world.afc?.season === season ? world.afc : qualifyAfc(data, world, season);
  const west = potOrder(q.lists.west ?? [], [], meta);
  const east = potOrder(q.lists.east ?? [], [], meta);
  const po = q.lists.playoff ?? [];
  if (west.length + east.length < 8) return [];
  const all = [...west, ...po, ...east];
  const reg = data.competitions.competitions.find((c) => c.id === 'ACL');
  return [newComp('ACL', reg?.name ?? 'Liga dos Campeões da AFC Elite', 'continental', all, {
    format: aclEliteFormat(), entrants: { all, west, east, po }, calendar: cal('ACL'), priority: reg?.priority ?? 4, prizeKey: reg?.prizeKey ?? 'AFC_ELITE', confed: 'AFC',
  })];
}

/** Campeão "da temporada" de uma confederação sem liga (CONCACAF, CAF, OFC): sorteio ponderado entre os convidados. */
export function guestChampion(data: CareerData, confed: 'CONCACAF' | 'CAF' | 'OFC', seed: string, exclude: Set<string> = new Set()): string | null {
  const meta = metaOf(data);
  const pool = guestsConfig(data)[confed].filter((c) => !exclude.has(c));
  if (!pool.length) return null;
  return drawWeighted(pool, 1, new Rng(`${seed}:${confed}:champion`), strengthWeight(meta, 0.5))[0] ?? null;
}

/**
 * Participantes do Supermundial (32): UEFA 12 (campeões da Liga dos Campeões dos 4 últimos anos + força, máx. 2 por
 * país), CONMEBOL 6 (campeões da Libertadores + força), CONCACAF 4, CAF 4 e OFC 1 (convidados), AFC 4 (campeões da
 * AFC Elite + sauditas e convidados), país-sede 1 (convidado da CONCACAF).
 */
export function supermundialEntrantsV2(data: CareerData, world: WorldState, season: number): string[] {
  const meta = metaOf(data);
  const countryOf = (id: string) => meta.get(id)?.countryId;
  const out: string[] = [];
  const add = (pool: string[], n: number, perCountry = 2) => {
    const count = new Map<number | undefined, number>();
    for (const c of out) count.set(countryOf(c), (count.get(countryOf(c)) ?? 0) + 1);
    let k = 0;
    for (const c of pool) {
      if (k >= n) break;
      if (out.includes(c) || (count.get(countryOf(c)) ?? 0) >= perCountry) continue;
      out.push(c); k++;
      count.set(countryOf(c), (count.get(countryOf(c)) ?? 0) + 1);
    }
  };
  const champs = (id: string) => world.history.filter((h) => h.competitionId === id && h.season >= season - 4 && h.championId).sort((a, b) => b.season - a.season).map((h) => h.championId!);
  const g = guestsConfig(data);
  const leagueClubs = (codes: string[]) => codes.flatMap((c) => world.divisions[`${c}-1`] ?? []);
  const before = () => out.length;
  let s = before();
  add(champs('UCL'), 12, 3);
  add(strengthSort([...leagueClubs(['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL']), ...g.UEFA], meta), 12 - (out.length - s));
  s = before();
  add(champs('LIBERTADORES'), 6, 3);
  add(strengthSort(leagueClubs(['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'EQU']), meta), 6 - (out.length - s));
  s = before();
  add(champs('ACL'), 4, 3);
  add(strengthSort([...leagueClubs(['ARS']), ...g.AFC_WEST, ...g.AFC_EAST], meta), 4 - (out.length - s));
  add(strengthSort(g.CONCACAF, meta), 4);
  add(strengthSort(g.CAF, meta), 4);
  add(strengthSort(g.OFC, meta), 1);
  add(strengthSort(g.CONCACAF, meta), 1, 99); // país-sede
  if (out.length < 32) add(strengthSort([...leagueClubs(['ING', 'ESP', 'ITA', 'ALE', 'FRA']), ...g.UEFA], meta), 32 - out.length, 99);
  return strengthSort(out.slice(0, 32), meta);
}

export interface WorldCompOptions {
  intercontinental?: boolean;
  supermundial?: SupermundialMode;
}

/**
 * Competições da FIFA do ano civil `season`: Intercontinental (UEFA = campeão da Liga dos Campeões da temporada
 * (season−1)/season; AFC = campeão da AFC Elite; CONMEBOL = campeão da Libertadores do ano — por repasse quando a
 * final acontece durante o ano) e Supermundial (se for ano).
 */
export function worldCompetitions(world: WorldState, data: CareerData, season: number, cal: CalOf, o: WorldCompOptions = {}): Competition[] {
  const out: Competition[] = [];
  const reg = (id: string) => data.competitions.competitions.find((c) => c.id === id);
  if (o.intercontinental !== false) {
    const th = world.titleHolders ?? {};
    const seed = `${world.seed}:${season}:inter`;
    const ent: Record<string, string[]> = { conmebol: [] };
    const links: CompetitionLink[] = [{ entrants: 'conmebol', from: 'LIBERTADORES', pick: 'champion', season }];
    const used = new Set<string>();
    for (const [key, id] of [['uefa', 'UCL'], ['afc', 'ACL']] as const) {
      const t = th[id];
      if (t && t.season === season - 1) { ent[key] = [t.clubId]; used.add(t.clubId); }
      else { ent[key] = []; links.push({ entrants: key, from: id, pick: 'champion', season: season - 1 }); }
    }
    for (const [key, confed] of [['concacaf', 'CONCACAF'], ['caf', 'CAF'], ['ofc', 'OFC']] as const) {
      const c = guestChampion(data, confed, seed, used);
      ent[key] = c ? [c] : [];
      if (c) used.add(c);
    }
    const ids = Object.values(ent).flat();
    ent.all = ids.slice();
    out.push(newComp('INTERCONTINENTAL', reg('INTERCONTINENTAL')?.name ?? 'Copa Intercontinental FIFA', 'continental', ids, {
      format: intercontinentalFormat(), entrants: ent, links, calendar: cal('intercontinental'), priority: reg('INTERCONTINENTAL')?.priority ?? 4,
      prizeKey: 'INTERCONTINENTAL', confed: 'FIFA',
    }));
  }
  if (supermundialYear(season, o.supermundial)) {
    const ids = supermundialEntrantsV2(data, world, season);
    out.push(newComp('SUPERMUNDIAL', reg('SUPERMUNDIAL')?.name ?? 'Supermundial de Clubes', 'continental', ids, {
      format: supermundialFormat(), entrants: { all: ids }, calendar: cal('supermundial'), priority: reg('SUPERMUNDIAL')?.priority ?? 4, prizeKey: 'SUPERMUNDIAL', confed: 'FIFA',
    }));
  }
  return out;
}

/* ═════════════════════ repasses genéricos ═════════════════════ */

/**
 * (Etapa 2) Processa `Competition.links` (MUTA `state`): quando a competição de origem tem campeão (ou a fase citada
 * terminou), os clubes viram inscritos da competição de destino (playoffs de rebaixamento, Intercontinental).
 * `shared` = competições ainda compartilhadas com a SeasonState de entrada (copiadas antes de mudar).
 */
export function linkCompetitions(state: SeasonState, date: string, shared: Competition[] | null): boolean {
  let added = false;
  for (const target of state.competitions.slice()) {
    if (!target.links?.length || target.finished) continue;
    for (const link of target.links) {
      const cur = state.competitions.find((c) => c.id === target.id) ?? target;
      if (cur.entrants?.[link.entrants]?.length) continue;
      const src = state.competitions.find((c) => c.id === link.from && (link.season === undefined || (c.cycleSeason ?? state.season) === link.season));
      if (!src) continue;
      let ids: string[] | null = null;
      if (link.pick === 'champion') ids = src.championId ? [src.championId] : null;
      else {
        const rule = link.pick as PickRule;
        const stage = 'stage' in rule && !Array.isArray(rule.stage) ? rule.stage : null;
        if (stage && src.stages?.[stage]?.status === 'done') ids = pick(src, rule);
        else if (src.finished) ids = pick(src, rule);
      }
      if (ids === null) continue;
      if (feedCompetition(state, cur.id, link.entrants, ids, date, shared)) added = true;
    }
  }
  return added;
}
