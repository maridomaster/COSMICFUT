// COSMICFUT — escopo geográfico (Etapa 1 da refatoração em 5 etapas, nota 28 do Obsidian).
//
// Só estes países geram clubes, ligas e calendários. `countries.json` continua completo (nacionalidade dos jogadores).
// Os dados reais (packages/data/real/*.json) não mudam: entradas de fora do escopo são simplesmente ignoradas.
//
// Regiões e ciclos:
//  - EU  (Europa)         → temporada cruzada ('split', agosto–maio, rótulo "2026/27"), virada no fim de junho;
//  - SA  (América do Sul) → ano civil ('calendar', janeiro–dezembro, rótulo "2026"), virada no fim de dezembro;
//  - SAU (Arábia Saudita) → temporada cruzada ('split'), como a Europa.

export const SCOPE = {
  version: 1,
  regions: {
    EU: { cycle: 'split', countries: ['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'] },
    SA: { cycle: 'calendar', countries: ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'EQU'] },
    SAU: { cycle: 'split', countries: ['ARS'] },
  },
  /** divisões nacionais mantidas por país (as de baixo saem; a última mantida não rebaixa) */
  maxDivisions: { default: 2 },
  /**
   * Brasil: Séries A e B como ligas nacionais; C e D deixam de existir como ligas nacionais. Os estaduais continuam
   * e TODOS os clubes brasileiros ficam nos dados (os pequenos como clubes "só estadual").
   */
  brazil: { nationalDivisions: 2, keepAllClubs: true, stateChampionships: true },
};

/* ═════════════════════ (Etapa 2) ligas reais 2026 / 2026-27 ═════════════════════ */

const SF_F = (sfLegs, fLegs, neutralFinal = false) => [{ name: 'Semifinal', legs: sfLegs }, { name: 'Final', legs: fLegs, ...(neutralFinal ? { neutral: true } : {}) }];

/**
 * Tamanho e regras reais de cada divisão mantida (ids de leagues.json). `teams` substitui o nº de clubes do .cfg do
 * original (clubes atribuídos por força, como antes). `relegated`/`promoted` são DIRETOS; os playoffs completam a conta
 * (rebaixados da divisão de cima = promovidos diretos + vagas do playoff de acesso da de baixo).
 * Fontes: regulamentos 2026 (América do Sul) e 2026/27 (Europa, Arábia) conforme o conhecimento disponível.
 */
export const REAL_LEAGUES = {
  // Europa 2026/27
  'ING-1': { teams: 20, kind: 'league', relegated: 3, promoted: 0 },
  'ING-2': { teams: 24, kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 6], rounds: SF_F(2, 1, true) } },
  'ESP-1': { teams: 20, kind: 'league', relegated: 3, promoted: 0 },
  'ESP-2': { teams: 22, kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 6], rounds: SF_F(2, 2) } },
  'ITA-1': { teams: 20, kind: 'league', relegated: 3, promoted: 0 },
  'ITA-2': { teams: 20, kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 8], byes: 2, rounds: [{ name: 'Preliminar', legs: 1 }, ...SF_F(2, 2)] } },
  'ALE-1': { teams: 18, kind: 'league', relegated: 2, promoted: 0, relegationPlayoff: { rank: 16 } },
  'ALE-2': { teams: 18, kind: 'league', relegated: 0, promoted: 2, toRelegationPlayoff: { from: 'rank', rank: 3 } },
  'FRA-1': { teams: 18, kind: 'league', relegated: 2, promoted: 0, relegationPlayoff: { rank: 16 } },
  'FRA-2': {
    teams: 18, kind: 'league', relegated: 0, promoted: 2, toRelegationPlayoff: { from: 'playoff' },
    promotionPlayoff: { ranks: [3, 5], spots: 0, byes: 1, rounds: [{ name: 'Playoff - 1ª Fase', legs: 1 }, { name: 'Playoff - Final', legs: 1 }] },
  },
  'POR-1': { teams: 18, kind: 'league', relegated: 2, promoted: 0, relegationPlayoff: { rank: 16 } },
  'POR-2': { teams: 18, kind: 'league', relegated: 0, promoted: 2, toRelegationPlayoff: { from: 'rank', rank: 3 } },
  'HOL-1': { teams: 18, kind: 'league', relegated: 2, promoted: 0, relegationPlayoff: { rank: 16 } },
  'HOL-2': { teams: 20, kind: 'league', relegated: 0, promoted: 2, toRelegationPlayoff: { from: 'rank', rank: 3 } },
  // Arábia Saudita 2026/27
  'ARS-1': { teams: 18, kind: 'league', relegated: 3, promoted: 0 },
  'ARS-2': { teams: 18, kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 6], rounds: SF_F(1, 1, true) } },
  // América do Sul 2026
  'BRA-1': { teams: 20, kind: 'league', relegated: 4, promoted: 0 },
  'BRA-2': {
    teams: 20, kind: 'league', relegated: 4, promoted: 2, dropToStates: 4,
    promotionPlayoff: { ranks: [3, 6], spots: 2, rounds: [{ name: 'Playoff de Acesso', legs: 2 }] },
  },
  'ARG-1': { teams: 30, kind: 'ac-zones', relegated: 2, promoted: 0 },
  'ARG-2': { teams: 20, kind: 'league', relegated: 0, promoted: 1, promotionPlayoff: { ranks: [2, 5], rounds: SF_F(1, 1, true) } },
  'URU-1': { teams: 16, kind: 'ac-final', relegated: 3, promoted: 0 },
  'URU-2': { teams: 20, kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 6], rounds: SF_F(2, 2) } },
  'COL-1': { teams: 20, kind: 'col', relegated: 2, promoted: 0 },
  'COL-2': { teams: 16, kind: 'league', relegated: 0, promoted: 2 },
  'CHI-1': { teams: 16, kind: 'league', relegated: 2, promoted: 0 },
  'CHI-2': { teams: 16, kind: 'league', relegated: 0, promoted: 1, promotionPlayoff: { ranks: [2, 5], rounds: SF_F(2, 2) } },
  'PAR-1': { teams: 12, kind: 'ac-tables', relegated: 2, promoted: 0 },
  'PAR-2': { teams: 19, kind: 'league', relegated: 0, promoted: 2 },
  'EQU-1': { teams: 16, kind: 'equ', relegated: 0, promoted: 0 },
};

/** Regras reais de uma divisão (ou undefined). */
export const leagueRulesOf = (id) => REAL_LEAGUES[id];

/* ═════════════════════ (Etapa 2) clubes convidados ═════════════════════ */

/**
 * Clubes de países FORA do escopo que entram nas competições continentais por sorteio ponderado pela força (sem liga
 * nacional). Ids = slugs dos .ban do original. Tamanho: a UEFA precisa de ~60 convidados por temporada (3 × 36 vagas −
 * ~46 clubes dos 7 países em escopo), a AFC de 21 (24 − 3 sauditas, mais o adversário do playoff saudita).
 */
export const GUESTS = {
  UEFA: [
    // Bélgica, Turquia, Escócia
    'brugge-bel', 'union-bel', 'anderlecht-bel', 'genk-bel', 'gent-bel', 'royalantwerp-bel', 'standardliege-bel',
    'galatasaray-tur', 'fenerbahce-tur', 'besiktas-tur', 'trabzonspor-tur', 'basaksehir-tur', 'samsunspor-tur',
    'glasgowceltic-esc', 'rangers-esc', 'hearts-esc', 'aberdeen-esc',
    // Áustria, Suíça, Tchéquia, Dinamarca
    'salzburg-aut', 'sturmgraz-aut', 'lask-aut', 'rapidviena-aut',
    'youngboys-sui', 'basel-sui', 'servette-sui', 'lugano-sui',
    'slavia-cze', 'viktoria-rep', 'banik-cze',
    'copenhague-din', 'midtjylland-din', 'brondby-din', 'nordsjaelland-din',
    // Escandinávia
    'bodoglimt-nor', 'molde-nor', 'rosenborg-nor', 'brann-nor', 'viking-nor',
    'malmo-sue', 'djurgardens-sue', 'hammarby-sue', 'hacken-sue',
    // Grécia, Chipre, Leste Europeu
    'olympiakos-gre', 'panatinaikos-gre', 'paok-gre', 'aek-gre',
    'paphos-cyp', 'apoel-chp', 'aeklarnaca-chi',
    'dinamozagreb-cro', 'hajduk-cro', 'rijeka-cro',
    'estrelavermelha-ser', 'partizan-ser',
    'shakhtar-ucr', 'dinamokiev-ucr',
    'lechpoznan-pol', 'legiawarsaw', 'jagiellonia-pl',
    'ferencvaros-hun', 'maccaitel-isr', 'maccabihaifa-isr', 'ludogorets-bul', 'cfrcluj-rom', 'steua-bucaresti-rom',
  ],
  // AFC Oeste (Catar, Emirados, Irã, Uzbequistão) — a Arábia Saudita está em escopo
  AFC_WEST: ['alsad-cat', 'alduhail-cat', 'alrayyan-cat', 'algharafa-cat', 'aljazira-emi', 'persepolis-irn', 'esteghlal-irn', 'sepahan-ira', 'tractor-irn', 'pakhtakor-ubz'],
  // AFC Leste (Japão, Coreia do Sul, China, Austrália)
  AFC_EAST: [
    'kashimaantlers-jap', 'kawasakifrontale-jap', 'sanfreccehiroshima-jap', 'visselkobe-jap', 'urawareds-jap',
    'ulsan-jap', 'jeonbuk-cor', 'fcseoul-cor', 'pohangsteelers-cor',
    'shangaisipg-chn', 'sanghai-chn', 'hangzhou-chn', 'melbournecityfc-aus', 'sydneyfc-aus',
  ],
  CONCACAF: ['cruzazul-mex', 'america-mex', 'monterrey-mex', 'tigres-mex', 'toluca-mex', 'intermiami-eua'],
  CAF: ['alahly-egi', 'pyramidsfc-egi', 'mamelodisundows-afs', 'estunis-tun', 'wac-mar'],
  OFC: ['auckland-nze'],
};

/** Confederação de um convidado (ou null). */
export function guestConfedOf(id) {
  for (const [k, list] of Object.entries(GUESTS)) if (list.includes(id)) return k.startsWith('AFC') ? 'AFC' : k;
  return null;
}

/**
 * Vagas UEFA 2026/27 por país em escopo (lista de acesso real; os playoffs/qualificatórias não são simulados):
 * Inglaterra e Espanha com a 5ª vaga (European Performance Spot), França 3, Portugal e Holanda 2. O campeão da copa
 * nacional ocupa a 1ª vaga da Liga Europa do país; na Inglaterra a vaga da Conferência é do campeão da EFL Cup.
 */
export const UEFA_SLOTS = {
  slots: {
    ING: { ucl: 5, uel: 2, uecl: 1 }, ESP: { ucl: 5, uel: 2, uecl: 1 }, ITA: { ucl: 4, uel: 2, uecl: 1 }, ALE: { ucl: 4, uel: 2, uecl: 1 },
    FRA: { ucl: 3, uel: 2, uecl: 1 }, POR: { ucl: 2, uel: 2, uecl: 1 }, HOL: { ucl: 2, uel: 2, uecl: 1 },
  },
  cupToUel: true,
  leagueCupToUecl: ['ING'],
};

/** Siglas de todos os países em escopo (ordem: EU, SA, SAU). */
export const SCOPE_CODES = Object.values(SCOPE.regions).flatMap((r) => r.countries);

/** Região de uma sigla de país (ou null fora do escopo). */
export function regionOfCode(code) {
  for (const [region, r] of Object.entries(SCOPE.regions)) if (r.countries.includes(code)) return region;
  return null;
}

export const inScope = (code) => regionOfCode(code) !== null;

/** Nº máximo de divisões nacionais mantidas para o país. */
export function maxDivisionsOf(code) {
  if (code === 'BRA') return SCOPE.brazil.nationalDivisions;
  return SCOPE.maxDivisions[code] ?? SCOPE.maxDivisions.default;
}
