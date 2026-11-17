/**
 * COSMICFUT — contrato de dados compartilhado.
 * Produzido por packages/data (build) e consumido por apps/web, packages/engine e apps/server.
 * Saída do pipeline: apps/web/public/data/*.json  (ver DataFiles abaixo)
 */

export type Position = 'GK' | 'FB' | 'CB' | 'MF' | 'FW'; // GOL, LAT, ZAG, MEI, ATA
export type Side = 'R' | 'L';

/** 0–3 goleiro, 4–13 linha (ordem do original). */
export type TraitId = number;

export interface Trait {
  id: TraitId;
  key: string; // ex: 'finishing'
  label: string; // pt-BR, ex: 'Finalização'
  gkOnly: boolean;
}

export interface Country {
  id: number; // índice P<n> do original (= número da bandeira)
  code: string | null; // sigla de 3 letras pt (BRA, ALE, ING...) quando conhecida
  name: string; // pt-BR
  flag: string; // caminho relativo a /assets, ex: 'flags/29.png'
  flagLarge: string; // ex: 'flags-large/29.png'
}

export interface Player {
  id: string; // estável: `${clubId}:${index}`
  name: string;
  position: Position;
  age: number;
  nationalityId: number;
  side: Side;
  traits: TraitId[]; // 0..2
  star: boolean; // flag "craque" do original
  highlight: boolean; // flag "destaque/estrela"
  worldClass: boolean; // elite mundial
  overall: number; // 1..99 — derivado (ver packages/data/README)
  potential: number; // 1..99 — derivado
  wage: number; // salário mensal (moeda do jogo)
  value: number; // valor de mercado
  youth: boolean; // veio da lista de base
  tmId: number | null;
  /**
   * (Etapa 5, só carreira) valor dos dados ÷ curva neutra (idade/overall/potencial) no início da carreira — base do
   * "fator de reputação" que mantém os valores curados no 1º dia e decai ~25% por temporada (engine transfers/value.ts).
   * Calculado pela engine a partir dos dados base; ausente ⇒ fator 1.
   */
  rep0?: number;
}

export interface Club {
  id: string; // slug normalizado ascii minúsculo
  sourceId: string; // slug original do .ban (para rastreio)
  name: string;
  shortName: string; // até ~12 chars
  colors: { primary: string; secondary: string }; // #rrggbb
  countryId: number;
  state: string | null; // UF para clubes brasileiros
  level: number; // 1..24 (força do clube no original)
  reputation: number; // 0..5
  stadium: { name: string; capacity: number };
  coach: { name: string; nationalityId: number };
  leagueId: string | null; // ex: 'BRA-1'
  division: number | null;
  /**
   * Euros (1 "$" = 1 €). balance = caixa inicial; sponsorPerSeason = patrocínio anual (0,40 × receita);
   * (adição, escala real) revenue = receita anual; wageBill = folha anual do elenco (soma dos salários × 12).
   */
  finances: { balance: number; sponsorPerSeason: number; revenue?: number; wageBill?: number };
  /** (Etapa 2) clube convidado (fora do escopo; só continentais) — ver ClubIndexEntry.guest */
  guest?: boolean;
  confed?: string;
  crest: string | null; // relativo a /assets, ex: 'crests/palmeiras.png'
  crestMini: string | null;
  kits: string[]; // camisas existentes (0..3)
  playerIds: string[];
}

export interface Division {
  id: string; // `${countryCode}-${division}` ex 'BRA-1'
  countryId: number;
  division: number;
  name: string; // ex 'Campeonato Brasileiro'
  divisionName: string; // ex 'Série A'
  teams: number;
  doubleRound: boolean;
  relegated: number;
  promoted: number;
  groups: number;
  legacyFormula: number;
  clubIds: string[]; // pode ficar vazio se a atribuição não for conhecida
  /** (adição Fase 1) divisão fictícia do original (BRA-5..10): a carreira ignora */
  fictional?: boolean;
  /** (adição Fase 1) campos do ConfigLigaType (ver DivisionExtra) */
  cfg?: DivisionExtra['cfg'];
  /** (Etapa 2) regras reais 2026 / 2026-27 da divisão (formato, acesso, rebaixamento, playoffs) — ver LeagueRules */
  rules?: LeagueRules;
}

/**
 * (Etapa 2) Regras reais de uma divisão nacional (2026 na América do Sul; 2026/27 na Europa e na Arábia).
 * Geradas pelo pipeline (packages/data/src/scope.mjs → leagues.json) e lidas pela engine (season/leagues.ts).
 */
export interface LeagueRules {
  /**
   * Formato:
   *  - 'league'     pontos corridos (ida e volta);
   *  - 'ac-zones'   Argentina: Apertura e Clausura em 2 zonas → mata-mata, Trofeo de Campeones;
   *  - 'ac-final'   Uruguai: Apertura e Clausura em turno único, final entre os campeões;
   *  - 'col'        Colômbia: Apertura e Finalización (turno único → cuadrangulares I/V → final I/V);
   *  - 'ac-tables'  Paraguai: Apertura e Clausura em ida e volta (dois campeões);
   *  - 'equ'        Equador (LigaPro): 1ª fase em ida e volta → hexagonal do título, grupo intermediário e
   *                 quadrangular do rebaixamento, com os pontos da 1ª fase.
   */
  kind: 'league' | 'ac-zones' | 'ac-final' | 'col' | 'ac-tables' | 'equ';
  /** rebaixados direto (os últimos da tabela) */
  relegated: number;
  /** promovidos direto (os primeiros da tabela) */
  promoted: number;
  /** playoff de acesso interno: posições [de, até]; `spots` vagas (padrão 1); `byes` melhores pulam a 1ª rodada */
  promotionPlayoff?: { ranks: [number, number]; spots?: number; byes?: number; rounds: { name: string; legs: 1 | 2; neutral?: boolean }[] };
  /** playoff de rebaixamento contra a divisão de baixo: a posição `rank` desta divisão (o perdedor fica embaixo) */
  relegationPlayoff?: { rank: number };
  /** quem da divisão de baixo vai ao playoff de rebaixamento: 'rank' = a posição `rank` (padrão 3); 'playoff' = vencedor do playoff interno */
  toRelegationPlayoff?: { from: 'rank' | 'playoff'; rank?: number };
  /** (Brasil, Série B) rebaixados voltam a ser "só estadual"; os substitutos saem dos estaduais */
  dropToStates?: number;
}

export interface StateChampionship {
  state: string; // UF
  /** (Fase 1) cada divisão ganha os campos opcionais de StateDivisionExtra (formatKey, rebaixamento...) */
  divisions: ({ division: number; name: string; teams: number; legacyFormula: number; clubIds: string[] } & StateDivisionExtra)[];
}

export interface Economy {
  initialMoneyByDivision: Record<string, number>; // '1','2','3','4','default'
  sponsorByDivision: Record<string, number>;
  prizes: Record<string, number>; // LIBERTADORES, LIGA_A ... — (escala real) em euros: premios.txt × 0,17
  /** (adição, escala real) valores originais de premios.txt, em reais */
  prizesBRL?: Record<string, number>;
}

export interface Calendar {
  id: string; // ex 'nacional'
  dates: string[]; // 'MM-DD'
}

export interface NamePool {
  code: string; // sigla 3 letras
  given: { n: string; w: number }[];
  surname: { n: string; w: number }[];
}

/** Índice leve carregado no boot pela UI. */
export interface ClubIndexEntry {
  id: string;
  name: string;
  countryId: number;
  state: string | null;
  level: number;
  leagueId: string | null;
  crestMini: string | null;
  colors: { primary: string; secondary: string };
  /** (adição Fase 1) reputação 0..5 e capacidade do estádio — usadas pela carreira sem carregar os bundles */
  reputation?: number;
  capacity?: number;
  /** (adição, escala real) finanças iniciais (as mesmas de Club.finances) — a carreira usa sem carregar os bundles */
  finances?: Club['finances'];
  /**
   * (Etapa 2) clube CONVIDADO de um país fora do escopo (sem liga nacional): disputa só competições continentais e
   * mundiais quando sorteado (ver competitions.json → guests). Nunca é selecionável como clube humano.
   */
  guest?: boolean;
  /** (Etapa 2) confederação do convidado ('UEFA', 'AFC', 'CONCACAF', 'CAF', 'OFC') */
  confed?: string;
}

/**
 * Arquivos gerados em apps/web/public/data/:
 *  - meta.json            { version, generatedAt, counts }
 *  - countries.json       Country[]
 *  - traits.json          Trait[]
 *  - clubs-index.json     ClubIndexEntry[]
 *  - clubs/<clubId>.json  { club: Club, players: Player[] }   (carga sob demanda)
 *  - players-market.json  versão compacta para busca no mercado (ver README do data)
 *  - leagues.json         Division[]
 *  - states.json          StateChampionship[]
 *  - economy.json         Economy
 *  - calendars.json       Calendar[]
 *  - names/<CODE>.json    NamePool
 *  - formats.json         FormatsFile (formatos dos estaduais, "<n>_<tipo>")          (adição Fase 1)
 *  - competitions.json    CompetitionsFile (registro declarativo das competições)     (adição Fase 1)
 *  - leagues.json/states.json ganham campos opcionais (DivisionExtra / StateDivisionExtra)
 * Assets em apps/web/public/assets/{crests,crests-mini,kits,flags,flags-large,trophies,ui,audio}
 */
/** players-market.json — linhas compactas. id do jogador = `${clubs[clubIdx]}:${playerIdx}` */
export type MarketRow = [
  clubIdx: number,
  playerIdx: number,
  name: string,
  pos: number, // índice em positions
  age: number,
  overall: number,
  potential: number,
  value: number,
  wage: number,
  nationalityId: number,
  youth: 0 | 1 | boolean,
];
export interface PlayersMarket {
  version: number;
  fields: string[];
  positions: Position[];
  clubs: string[];
  rows: MarketRow[];
}

export interface ClubBundle {
  club: Club;
  players: Player[];
}

/* ═════════════════════ Competições (Fase 1) — acréscimos ═════════════════════
 * Modelo declarativo de formato (ver docs/specs/competicoes-e-temporada.md §7.1).
 * Produzido por packages/data (formats.json, competitions.json) e consumido por packages/engine.
 */

export type Legs = 1 | 2;

/** Regra de um confronto de mata-mata. */
export interface TieRule {
  legs: Legs;
  /** empate (no jogo único ou no agregado) → pênaltis. Padrão true. */
  penalties?: boolean;
  /** prorrogação antes dos pênaltis. O original não tem (padrão false). */
  extraTime?: boolean;
  /** gol fora como desempate (padrão false — fiel ao original) */
  awayGoals?: boolean;
  /** campo neutro (finais de supercopa) */
  neutral?: boolean;
  /** jogo único: quem manda. 'better' (padrão) = melhor semente; 'worse' = pior (Copa do Brasil 1ª/2ª fase) */
  home?: 'better' | 'worse';
}

/**
 * Seleção de clubes. Usada para participantes de uma fase, rebaixamento e acesso.
 * Posições são 1-based. `stage` aceita várias fases (tabela somada, ex.: Apertura+Clausura).
 */
export type PickRule =
  /** inscritos nomeados da competição ('all' = todos, na ordem de semente), fatia opcional [from..to] */
  | { entrants: string; from?: number; to?: number }
  /** posições na tabela da fase (todos os grupos juntos, ou por grupo, ou de um grupo específico 0-based) */
  | { stage: string | string[]; ranks: [number, number]; perGroup?: boolean; group?: number }
  /** os N últimos da tabela (todos os grupos juntos, ou por grupo) */
  | { stage: string | string[]; bottom: number; perGroup?: boolean }
  /** os `count` melhores entre os `rank`-ésimos colocados de cada grupo (melhor 2º, melhores 3º) */
  | { stage: string; bestOfRank: number; count: number }
  /** os N melhores da tabela da fase que não foram para as fases listadas em `exclude` */
  | { stage: string; bestRest: number; exclude: string[] }
  /** vencedores do mata-mata (da última rodada, ou da rodada nomeada) */
  | { stage: string; winners: true; round?: string }
  /** perdedores do mata-mata (da última rodada, ou da rodada nomeada) */
  | { stage: string; losers: true; round?: string }
  /** classificação geral da competição (todos os jogos, incluindo mata-matas) */
  | { overall: true; bottom: number };

export interface TableStageDef {
  id: string;
  kind: 'table';
  name: string;
  /** rótulo para a UI (ex.: "TAÇA GUANABARA", "Torneio Frevo") */
  label?: string;
  groups?: number;
  groupNames?: string[];
  /** "grupo x grupo": cada clube enfrenta só os clubes dos outros grupos */
  crossGroups?: boolean;
  legs: Legs;
  /** rodadas parciais: só as k primeiras rodadas de um todos-contra-todos embaralhado */
  partialRounds?: number;
  sources: PickRule[];
  /** composição explícita por grupo (ex.: quadrangulares da Série C) */
  groupSources?: PickRule[][];
  /** distribuição dos participantes nos grupos: 'snake' (padrão, por semente), 'draw' (sorteio), 'region' (UF), 'order' (em blocos) */
  grouping?: 'snake' | 'draw' | 'region' | 'order';
  /** fases que precisam terminar antes desta (padrão: as citadas em `sources`) */
  after?: string[];
  /** índice (0-based) da 1ª data do calendário que a fase pode usar */
  slotStart?: number;
  /** título secundário dado ao 1º colocado (ex.: Apertura) */
  title?: string;
  /** só existe para definir rebaixados: é removida se a divisão não rebaixa */
  relegationStage?: 'group';
  /** (Fase 2) sorteio dos grupos evitando clubes do mesmo país no mesmo grupo (continentais) */
  avoidSameCountry?: boolean;
  /** (Fase 2) a fase só é montada quando a lista de inscritos `entrants` tiver ao menos `count` clubes (repasses entre competições) */
  requires?: { entrants: string; count: number }[];
  /**
   * (Etapa 2) "modelo suíço" (fase de liga da UEFA / AFC): cada grupo (ou a fase inteira) vira `pots` potes pela
   * semente; cada clube enfrenta `perPot` adversários de cada pote (perPot 2: um em casa e um fora por pote;
   * perPot 1: metade em casa), sem repetir adversário e evitando o mesmo país. Tabela única de todos.
   */
  swiss?: { pots: number; perPot: 1 | 2 };
  /** (Etapa 2) a tabela desta fase soma os números da fase indicada (pontos levados da 1ª fase — LigaPro) */
  carry?: string;
}

export interface KnockoutRoundDef {
  name: string;
  tie: TieRule;
  /** índices (0-based) fixos das datas do calendário (uma por perna) */
  slots?: number[];
}

export interface KnockoutStageDef {
  id: string;
  kind: 'knockout';
  name: string;
  label?: string;
  rounds: KnockoutRoundDef[];
  sources: PickRule[];
  /**
   * Pareamento da 1ª rodada: 'table' (1º×último, padrão), 'cross' (A1×B4, B1×A4… em 2 grupos),
   * 'draw' (sorteio livre), 'pots' (metade de cima × metade de baixo, sorteado), 'order' (1×2, 3×4…).
   * Rodadas seguintes: re-pareamento pela semente original (melhor × pior), exceto 'draw'/'pots' (sorteio).
   */
  seeding?: 'table' | 'cross' | 'draw' | 'pots' | 'order' | 'uefa-playoff' | 'uefa-r16';
  /**
   * (Etapa 2) chave fixa: nas rodadas seguintes o vencedor do confronto i enfrenta o do confronto i+1 (na ordem em
   * que foram criados), sem novo sorteio — como a chave da UEFA a partir das oitavas.
   */
  bracket?: boolean;
  /** (Etapa 2) fase de tabela que dá as posições para o pareamento 'uefa-playoff' / 'uefa-r16' */
  rankStage?: string;
  /** as N melhores sementes pulam a 1ª rodada (playoff-semi) */
  byes?: number;
  /** disputa de 3º lugar (perdedores da penúltima rodada, na data da final) */
  thirdPlace?: TieRule;
  after?: string[];
  slotStart?: number;
  /** título secundário (Taça Rio, Troféu Inconfidência, Apertura...) para o vencedor */
  title?: string;
  /** só existe para definir rebaixados (o perdedor cai); é removida se a divisão não rebaixa */
  relegationStage?: 'playoff';
  /** (Fase 2) ver TableStageDef.requires */
  requires?: { entrants: string; count: number }[];
  /** (Fase 2) pareamento 'pots' da 1ª rodada evita clubes do mesmo país */
  avoidSameCountry?: boolean;
}

export type StageDef = TableStageDef | KnockoutStageDef;

/** Formato completo de uma competição. */
export interface FormatDef {
  id: string;
  /** descrição curta (ex.: 'turno → 4 → semi I/V → final I/V') */
  summary?: string;
  /** nº de clubes esperado (0 = qualquer) */
  teams: number;
  stages: StageDef[];
  /** fase que define o campeão (vencedor da última rodada do mata-mata ou 1º da tabela) */
  champion: string;
  /** rebaixados (regras somadas, sem repetição) */
  relegation?: PickRule[];
  /** promovidos (regras somadas, sem repetição) */
  promotion?: PickRule[];
  /** (Etapa 2) estilo da liga (LeagueRules.kind) — ordem de classificação para as vagas continentais */
  style?: LeagueRules['kind'];
}

/** formats.json — formatos dos estaduais: chave `"<nTimes>_<tipo>"` (ex.: "16_2"). */
export type FormatsFile = Record<string, FormatDef>;

/** (adição) campos novos por divisão em states.json */
export interface StateDivisionExtra {
  /** chave em formats.json (`"<teams>_<formula>"`), ou formato genérico se não existir */
  formatKey?: string;
  relegated?: number;
  relegatedDirect?: number;
  relegationPlayoff?: number;
  relegationOverall?: boolean;
  /** sobem da divisão de baixo = caem desta (0 na última) */
  promotedFromBelow?: number;
}

/** (adição) campos novos por divisão em leagues.json (todos os de ConfigLigaType) */
export interface DivisionExtra {
  /** divisão fictícia do original (BRA-5..10): a carreira ignora */
  fictional?: boolean;
  cfg?: {
    formula: number;
    nGrupos: number;
    doisTurnos: boolean;
    jogosDentroGrupo: boolean;
    classificaPeloGeral: boolean;
    melhoresTerceiros: boolean;
    numeroTimesMataMata: number;
    nRebaixados: number;
    rebaixadosDireto: number;
    playoffAcesso: boolean;
    vagasSobemPeloMataMata: number;
    playoffRebaixamento: number;
    rebaixadoPeloGrupo: boolean;
    rebaixamentoGeral: boolean;
    duasVoltasMataMata: boolean[];
    duasVoltasMataMataSobe: boolean[];
    duasVoltasplayoffReb: boolean[];
    aperturaClausura: boolean;
    nomeClausura: string;
    desempate: number;
    positionPrizes: number[];
  };
}

/** Uma competição no registro competitions.json. */
export interface CompetitionDefEntry {
  id: string; // ex.: 'BRA-CUP', 'BRA-1'
  kind: 'league' | 'cup' | 'state' | 'supercup' | 'continental';
  name: string;
  countryId?: number;
  uf?: string;
  confed?: string;
  calendarId: string;
  /** formato embutido (ligas nacionais e copa) ou chave em formats.json (estaduais) */
  format?: FormatDef;
  formatKey?: string;
  /** chave em economy.prizes (pago só ao campeão no modo fiel) */
  prizeKey?: string;
  /** troféu em /assets/trophies */
  trophy?: string;
  /** prioridade de calendário (maior vence conflitos): continental 4, copa 3, liga 2, estadual 1 */
  priority: number;
  /** regras de participação (texto/estrutura livre para a UI e para a engine) */
  qualification?: Record<string, unknown>;
  /** desligada nesta fase (registro preparado) */
  disabled?: boolean;
}

/** competitions.json */
export interface CompetitionsFile {
  version: number;
  /** flags por país (NAC:BRA) */
  countries: Record<string, { brazilCopaReal?: boolean; brazilSerieDReal?: boolean }>;
  competitions: CompetitionDefEntry[];
  /** Série D Real: vagas por UF (mín./máx.) e ordem geográfica das UFs */
  serieD?: { slots: number; kept: number; minPerUf: number; maxPerUf: number; ufOrder: string[] };
  /** Copa do Brasil: tamanho dos potes */
  nationalCup?: { pot1: number; firstPhase: number };
  /** (Fase 2) vagas continentais e campeões iniciais (ver ContinentalConfig) */
  continental?: ContinentalConfig;
  /** (Etapa 2) clubes convidados por confederação (países fora do escopo) — ver GuestsConfig */
  guests?: GuestsConfig;
  /** (Etapa 2) vagas UEFA por país (Liga dos Campeões, Liga Europa, Liga Conferência) */
  uefa?: UefaSlotsConfig;
}

/**
 * (Etapa 2) Clubes convidados: países fora do escopo não têm liga; os seus clubes mais tradicionais entram nas
 * competições continentais por sorteio ponderado pela força (imita o acesso real). AFC dividida em Oeste e Leste.
 */
export interface GuestsConfig {
  UEFA: string[];
  AFC_WEST: string[];
  AFC_EAST: string[];
  CONCACAF: string[];
  CAF: string[];
  OFC: string[];
}

/** (Etapa 2) Vagas UEFA por país em escopo (lista de acesso 2026/27). Copa nacional → Liga Europa. */
export interface UefaSlotsConfig {
  /** sigla → vagas por posição na liga */
  slots: Record<string, { ucl: number; uel: number; uecl: number }>;
  /** o campeão da copa nacional ocupa a 1ª vaga da Liga Europa do país (repasse se já classificado) */
  cupToUel: boolean;
  /** países cuja vaga da Conferência vai ao campeão da copa da liga (Inglaterra: EFL Cup) */
  leagueCupToUecl?: string[];
}

/**
 * (Fase 2) Vagas continentais por país (CONMEBOL) — lidas pela engine (season/continental.ts).
 * Cada país lista as posições da ordem de classificação do ano anterior (liga; ARG/URU: campeões do
 * Apertura e do Clausura e depois a tabela anual) que vão a cada fase. O Brasil usa `BRA`, com a vaga do
 * campeão da copa nacional antes da tabela (repasse: vaga já ocupada desce na tabela).
 */
export interface ContinentalConfig {
  /** países sul-americanos simulados (siglas) e a divisão nacional usada para as vagas */
  conmebol: { code: string; leagueId: string }[];
  /** Libertadores: quantas vagas por país em cada fase ('groups', 'f2', 'f1'), na ordem da classificação */
  libertadores: Record<string, { groups: number; f2: number; f1: number; cupSlot?: boolean }>;
  /** Sul-Americana: vagas por país: 'groups' (direto) ou 'prelim' (jogo único entre clubes do mesmo país) */
  sulamericana: Record<string, { groups: number; prelim: number }>;
  /** campeões da temporada anterior ao 1º ano (resultados reais de 2025), para o 1º ano da carreira */
  initial?: { season: number; LIBERTADORES?: string; SULAMERICANA?: string; cup?: Record<string, string>; league?: Record<string, string> };
  /** Intercontinental/Supermundial: confederações → siglas de país com liga nos dados */
  confederations?: Record<string, string[]>;
  /** Copa do Nordeste: UFs e nº de clubes */
  nordeste?: { ufs: string[]; teams: number; priorityUfs: string[] };
}
