/**
 * COSMICFUT Engine — CONTRATO PÚBLICO (definido pelo coordenador).
 * TypeScript puro, sem DOM, sem Node APIs: roda no navegador e no servidor (multiplayer autoritativo).
 * TUDO determinístico dado (seed + inputs + comandos) — essencial para PvP online e replays.
 *
 * A implementação deve exportar essas funções/classes a partir de packages/engine/src/index.ts.
 * Pode-se ADICIONAR campos/funções; não remover/renomear sem avisar o coordenador.
 */
import type { FormatDef, Player, Position, TraitId } from '@cosmicfut/shared';

/* ───────────────────────── Táticas / Escalação ───────────────────────── */

export type Formation = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-5-1' | '3-4-3';
export type Mentality = 'ultra-defensive' | 'defensive' | 'balanced' | 'attacking' | 'all-out';
export type Tempo = 'slow' | 'normal' | 'fast';
export type Pressing = 'low' | 'medium' | 'high';
export type Passing = 'short' | 'mixed' | 'direct';

/** Slot tático (posição no campo) — a UI desenha o campo a partir disto. */
export type SlotRole = 'GK' | 'LB' | 'CB' | 'RB' | 'LWB' | 'RWB' | 'DM' | 'CM' | 'LM' | 'RM' | 'AM' | 'LW' | 'RW' | 'ST';
export interface FormationSlot {
  role: SlotRole;
  /** posição normalizada no campo (0..1), x = largura (0 esquerda), y = profundidade (0 = gol próprio) */
  x: number;
  y: number;
  /** posições do jogador naturais para o slot (do contrato shared) */
  natural: Position[];
}

export interface Tactic {
  formation: Formation;
  mentality: Mentality;
  tempo: Tempo;
  pressing: Pressing;
  passing: Passing;
}

export interface Lineup {
  /** 11 ids, na ordem dos slots de FORMATIONS[formation] */
  starters: string[];
  /** até 9 reservas (ids) */
  bench: string[];
  captainId?: string;
  penaltyTakerId?: string;
  /**
   * (Táticas) formação personalizada: posição livre de cada slot (mesma ordem de `starters`), 0..1 como em
   * FormationSlot. `null` (ou ausente) = posição padrão da formação. O papel do slot é DEDUZIDO da zona
   * (match/shape.ts → detectRole). O slot do goleiro é fixo. Validado/limpo por `sanitizePositions`.
   */
  positions?: (SlotPos | null)[];
}

/** (Táticas) posição livre no campo (0..1; x = largura, 0 esquerda; y = profundidade, 0 = gol próprio). */
export interface SlotPos {
  x: number;
  y: number;
}

/** (Táticas) predefinição salva pelo técnico (3 vagas por clube). */
export interface TacticPreset {
  /** nome dado pelo técnico (ex.: "4-3-3 Ofensivo") */
  name: string;
  tactic: Tactic;
  /** formação personalizada (ver Lineup.positions) */
  positions?: (SlotPos | null)[];
  /** XI opcional (ids na ordem dos slots); ausente = mantém os titulares atuais */
  starters?: string[];
  savedAt?: string;
}

/*
 * Implementado em ./tactics.ts (exportado por index.ts):
 *   getFormationSlots(f: Formation): FormationSlot[]
 *   autoPickLineup(players: Player[], tactic: Tactic, unavailable?: Set<string>, opts?): Lineup
 *   slotFit(player: Player, slot: FormationSlot): number
 *     (posição natural = 1; adjacente ~0.85; fora ~0.6; GK fora do gol ~0.2)
 */

/* ───────────────────────── Partida ───────────────────────── */

export interface MatchTeamInput {
  clubId: string;
  name: string;
  players: Player[]; // elenco disponível (com overall, traits etc.)
  lineup: Lineup;
  tactic: Tactic;
  /** 0..100 */
  morale?: number;
  isHome: boolean;
  /** controle: 'ai' muda tática/subs sozinho; 'human' só via comandos */
  control: 'ai' | 'human';
  /** (adição) condição física inicial 0..100 por jogador (padrão 100) */
  fitness?: Record<string, number>;
  /** (adição) capacidade do estádio (mandante) para calcular o público */
  stadiumCapacity?: number;
  /** (adição) reputação 0..5 (afeta público) */
  reputation?: number;
  /**
   * (adição 13/11) multiplicador do público pelo preço do ingresso (só o mandante): `ticketDemandFactor(preço,
   * sugerido)`. `buildTeamInput` preenche quando o clube definiu preço. Ausente ⇒ público ao preço sugerido.
   * Com ele, `MatchResult.attendance` já é o público PAGANTE (≤ capacidade) e `MatchResult.ticketDemand` é preenchido.
   */
  ticketDemand?: number;
  /** (Etapa 4) público pagante exato (bilheteria da economia, `matchGate`); tem prioridade sobre o cálculo da simulação */
  attendance?: number;
}

export interface MatchConfig {
  seed: string; // ex: `${fixtureId}:${season}`
  home: MatchTeamInput;
  away: MatchTeamInput;
  /** se for mata-mata e empatar, prorrogação/pênaltis */
  knockout?: boolean;
  /** máximo de substituições (padrão 5) */
  maxSubs?: number;
  /**
   * (adição Fase 1) prorrogação no mata-mata. Padrão true (comportamento antigo); as competições
   * fiéis ao original passam false: empate → direto aos pênaltis.
   */
  extraTime?: boolean;
  /**
   * (adição Fase 1) gols das pernas anteriores do confronto, do ponto de vista DESTA partida
   * (home = mandante de hoje). Com `knockout`, o empate é avaliado no agregado.
   */
  aggregate?: { home: number; away: number };
}

export type Side = 'home' | 'away';

export type MatchEventType =
  | 'kickoff' | 'half-time' | 'second-half' | 'full-time'
  | 'extra-time' | 'penalties' | 'penalty-shootout-kick'
  | 'chance' | 'shot' | 'shot-on-target' | 'save' | 'woodwork' | 'goal' | 'own-goal'
  | 'foul' | 'yellow' | 'red' | 'second-yellow' | 'injury'
  | 'corner' | 'offside' | 'penalty-awarded' | 'penalty-missed'
  | 'substitution' | 'tactic-change' | 'commentary';

export interface MatchEvent {
  minute: number; // 0..120 (+ acréscimos: use `extra`)
  extra?: number; // acréscimo (ex: 45+2 → minute 45, extra 2)
  type: MatchEventType;
  side?: Side;
  playerId?: string;
  assistId?: string;
  /** para substituição: quem sai */
  playerOutId?: string;
  /** texto narrado pt-BR, variado (templates) */
  text: string;
  /** (adição) em 'penalty-shootout-kick': se a cobrança entrou */
  scored?: boolean;
}

export interface TeamLiveStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  possession: number; // % 0..100 acumulada
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  offsides: number;
  xg: number;
  passesCompleted: number;
  subsUsed: number;
}

export interface LivePlayerState {
  id: string;
  onPitch: boolean;
  slotIndex: number | null;
  stamina: number; // 0..100
  rating: number; // nota 0..10 (começa 6.0)
  yellow: number;
  sentOff: boolean;
  injured: boolean;
  goals: number;
  assists: number;
}

export interface MatchState {
  minute: number;
  extra: number;
  phase: 'pre' | 'first-half' | 'half-time' | 'second-half' | 'extra-time' | 'penalties' | 'finished';
  score: { home: number; away: number };
  penaltyScore?: { home: number; away: number };
  stats: { home: TeamLiveStats; away: TeamLiveStats };
  players: { home: LivePlayerState[]; away: LivePlayerState[] };
  tactic: { home: Tactic; away: Tactic };
  /** (Atualização 38) slots vigentes de cada lado (formação + posições personalizadas/set-shape); slotIndex aponta para cá */
  slots?: { home: readonly FormationSlot[]; away: readonly FormationSlot[] };
  /** momentum −1 (away) .. +1 (home) para a UI */
  momentum: number;
  events: MatchEvent[];
}

/** Comandos que humanos (ou rede) enviam durante a partida. */
export type MatchCommand =
  | { type: 'substitute'; side: Side; outId: string; inId: string }
  | { type: 'set-tactic'; side: Side; tactic: Partial<Tactic> }
  | { type: 'swap-slots'; side: Side; aId: string; bId: string }
  /** (Táticas) aplica uma formação personalizada (Lineup.positions) na formação atual; null = padrão */
  | { type: 'set-shape'; side: Side; positions: (SlotPos | null)[] | null };

/**
 * Simulação incremental. A UI chama tick() num intervalo (velocidade ajustável);
 * o servidor online faz o mesmo e transmite os eventos.
 * Determinismo: mesma config + mesmos comandos aplicados nos mesmos minutos ⇒ mesmo resultado.
 */
export interface MatchSimulationApi {
  readonly state: MatchState;
  /** avança 1 minuto de jogo; retorna os eventos gerados neste minuto */
  tick(): MatchEvent[];
  /** aplica comando; retorna erro (string) se inválido (ex: sem substituições) */
  apply(cmd: MatchCommand): string | null;
  isFinished(): boolean;
  /** roda até o fim (para jogos da IA, sem UI) */
  runToEnd(): MatchResult;
  result(): MatchResult;
}
/* class MatchSimulation implements MatchSimulationApi — ver ./match/simulation.ts */

/**
 * Resultado de uma partida.
 *
 * (Fase 2) Regra do `winner` em mata-mata — quando `config.knockout` é true (jogo decisivo):
 *  - `winner` é o lado que AVANÇA no confronto: placar agregado (`config.aggregate` + placar do jogo),
 *    e, se o agregado empatar, os pênaltis. Nunca é 'draw' num jogo decisivo terminado.
 *  - `aggregate` = placar somado do confronto (pernas anteriores + este jogo), do ponto de vista deste jogo;
 *    só existe quando `config.aggregate` foi informado (2ª perna).
 *  - `advancing` = o mesmo lado de `winner`, explícito (ausente fora de mata-mata).
 *  Ex.: 2ª perna 1 x 0 com agregado anterior 0 x 2 → placar do jogo é vitória do mandante, mas
 *  `aggregate` = 1 x 2, `winner` = `advancing` = 'away'. Para o placar do jogo use homeGoals/awayGoals.
 * Fora de mata-mata, `winner` é o vencedor do jogo (ou 'draw'), como antes.
 */
export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  penalties?: { home: number; away: number };
  winner: Side | 'draw';
  /** (Fase 2) agregado do confronto incluindo este jogo (só com config.aggregate) */
  aggregate?: { home: number; away: number };
  /** (Fase 2) lado que avança no mata-mata (jogo decisivo) */
  advancing?: Side;
  /** (Registros) `assistId`: quem deu a assistência (ausente em gol contra, pênalti/bola parada sem passe) */
  scorers: { side: Side; playerId: string; minute: number; ownGoal?: boolean; penalty?: boolean; assistId?: string }[];
  cards: { side: Side; playerId: string; minute: number; color: 'yellow' | 'red' }[];
  injuries: { side: Side; playerId: string; minute: number; days: number }[];
  ratings: Record<string, number>;
  stats: { home: TeamLiveStats; away: TeamLiveStats };
  /**
   * Público. (13/11) Nos resultados devolvidos por `advanceDay` (`played`) é SEMPRE o público pagante, ajustado
   * pelo preço do ingresso do mandante — o mesmo número da renda e da notícia "Público: X".
   * Na `MatchSimulation`, é o pagante quando `home.ticketDemand` foi informado (ver `ticketDemand` abaixo).
   * Para um resultado qualquer, use `resultAttendance(state, homeId, result)` (idempotente).
   */
  attendance: number;
  /** (adição 13/11) fator de preço já aplicado em `attendance` (ausente ⇒ público ao preço sugerido) */
  ticketDemand?: number;
  /** (adição) ids de quem entrou em campo (titulares + substitutos usados) */
  appearances?: { home: string[]; away: string[] };
  /** (adição) houve prorrogação */
  extraTime?: boolean;
  /** (adição) stamina final (0..100) de quem jogou — vira fitness na temporada */
  fitnessAfter?: Record<string, number>;
}

/* quickSimulate(config: MatchConfig): MatchResult — simulação rápida sem narração. Ver ./match/quick.ts */

/* ───────────────────────── Temporada / Liga ───────────────────────── */

export interface Fixture {
  id: string; // `${competitionId}:${round}:${homeId}-${awayId}`
  competitionId: string; // ex 'BRA-1'
  round: number; // 1..N
  date: string; // ISO yyyy-mm-dd
  homeId: string;
  awayId: string;
  result?: { home: number; away: number; penalties?: { home: number; away: number } };
  /* ── (adição Fase 1) competições com formato ── */
  /** fase do formato (FormatDef.stages[].id) */
  stageId?: string;
  /** grupo (0-based) em fase de tabela */
  group?: number;
  /** perna do confronto de mata-mata */
  leg?: 1 | 2;
  /** confronto de mata-mata ao qual o jogo pertence */
  tieId?: string;
  /** jogo decisivo de mata-mata: empate no jogo (ou no agregado, na 2ª perna) → pênaltis */
  knockout?: boolean;
  /** prorrogação antes dos pênaltis (o original não tem) */
  extraTime?: boolean;
  /** campo neutro (sem bilheteria para o mandante: renda 50/50) */
  neutral?: boolean;
  /** rótulo para a UI: nome da fase/rodada (ex.: "Quartas de Final", "Taça Rio - Semifinal") */
  label?: string;
}

export interface StandingRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: ('W' | 'D' | 'L')[]; // últimos 5
}

export interface Competition {
  id: string;
  name: string;
  /** 'league' (pontos corridos ou liga com fases), 'cup' (copa nacional), 'state' (estadual), 'supercup', 'continental' */
  type: CompetitionType;
  clubIds: string[];
  doubleRound: boolean;
  relegated: number;
  promoted: number;
  fixtures: Fixture[];
  /** (adição) divisão (1 = elite), usada pela economia */
  division?: number;
  /** (adição) true quando todos os jogos foram disputados e a premiação foi paga */
  finished?: boolean;

  /* ── (adição Fase 1) competição com formato declarativo. Ausente ⇒ liga simples antiga. ── */
  format?: FormatDef;
  /** estado de cada fase (participantes, grupos, confrontos) */
  stages?: Record<string, StageState>;
  /** listas nomeadas de inscritos (ex.: 'all', 'pot1'), em ordem de semente */
  entrants?: Record<string, string[]>;
  /** datas (ISO) da competição, uma por "slot" — de calendars.json (pode ser estendida) */
  calendar?: string[];
  /** prioridade de calendário: continental 4, copa 3, liga 2, estadual 1 */
  priority?: number;
  /** chave em economy.prizes (prêmio só do campeão no modo fiel) */
  prizeKey?: string;
  countryId?: number;
  /** UF (estaduais) */
  uf?: string;
  championId?: string;
  viceId?: string;
  /** títulos secundários (Taça Rio, Inconfidência, Apertura...) */
  titles?: { title: string; clubId: string; viceId?: string }[];
  /** preenchidos quando a competição termina */
  relegatedIds?: string[];
  promotedIds?: string[];
  /** artilharia: jogadorId → gols; e o clube do jogador no gol */
  scorers?: Record<string, number>;
  /** clube do jogador no último gol OU assistência (artilharia e tabela de assistências) */
  scorerClubs?: Record<string, string>;
  /** (Registros) assistências: jogadorId → passes para gol */
  assists?: Record<string, number>;

  /* ── (Etapa 1) calendário duplo — ver season/timeline.ts ── */
  /** 'calendar' (ano civil, América do Sul) ou 'split' (agosto–maio, Europa/Arábia). Ausente ⇒ 'calendar'. */
  cycle?: 'calendar' | 'split';
  /** temporada do ciclo (ano civil; ou o ano de início da temporada cruzada: 2026/27 → 2026) */
  cycleSeason?: number;
  /** rótulo da temporada: "2026" ou "2026/27" */
  seasonLabel?: string;
  /** região da competição ('SA', 'EU', 'SAU') */
  region?: 'EU' | 'SA' | 'SAU';

  /* ── (Etapa 2) repasses de outras competições ── */
  /** inscritos que chegam de outra competição durante a temporada (playoff de rebaixamento, Intercontinental) */
  links?: CompetitionLink[];
  /** confederação (continentais: 'CONMEBOL', 'UEFA', 'AFC', 'FIFA') */
  confed?: string;
  /** (Etapa 4) prêmios por fase já pagos (`fase:clubId`) */
  paid?: string[];
}

/**
 * (Etapa 2) Repasse: quando a competição `from` (da temporada `season`, se informada) define o campeão ('champion')
 * ou conclui a fase citada na regra, os clubes escolhidos viram a lista de inscritos `entrants` desta competição.
 */
export interface CompetitionLink {
  entrants: string;
  from: string;
  pick: PickRule | 'champion';
  season?: number;
}

export type CompetitionType = 'league' | 'cup' | 'state' | 'supercup' | 'continental';

/** (adição Fase 1) estado de uma fase de uma competição com formato. */
export interface StageState {
  id: string;
  status: 'pending' | 'active' | 'done';
  /** participantes em ordem de semente (1ª = melhor) */
  seeds: string[];
  /** fase de tabela: clubes por grupo */
  groups?: string[][];
  /** mata-mata: rodada atual (0-based) e confrontos de todas as rodadas */
  round?: number;
  ties?: TieState[];
  /** vencedores/perdedores finais (mata-mata) */
  winners?: string[];
  losers?: string[];
}

/** (adição Fase 1) confronto de mata-mata. `a` é a melhor semente. */
export interface TieState {
  id: string;
  round: number;
  roundName: string;
  a: string;
  b: string;
  fixtureIds: string[];
  winner?: string;
  loser?: string;
  /** disputa de 3º lugar */
  thirdPlace?: boolean;
}

export type { FormatDef, StageDef, PickRule, TieRule, TableStageDef, KnockoutStageDef, Legs, LeagueRules, GuestsConfig, UefaSlotsConfig } from '@cosmicfut/shared';
import type { PickRule } from '@cosmicfut/shared';

/** Estado persistível de clube durante a temporada (o que muda vs dados base). */
export interface ClubSeasonState {
  clubId: string;
  balance: number;
  morale: number; // 0..100
  tactic: Tactic;
  lineup: Lineup | null; // null ⇒ IA escolhe
  /** (Táticas) 3 vagas de predefinição do técnico humano (null = vaga vazia). Ausente em saves antigos. */
  tacticPresets?: (TacticPreset | null)[];
  /** jogadorId → dias fora */
  injuries: Record<string, number>;
  /**
   * jogadorId → jogos suspenso. (Atualização 38) LEGADO: a suspensão agora é por competição (`bans`); este mapa fica
   * vazio depois de `migrateDiscipline` (saves antigos). Ver season/discipline.ts.
   */
  suspensions: Record<string, number>;
  /** jogadorId → cartões amarelos acumulados. (Atualização 38) LEGADO: ver `cards`. */
  yellowCards: Record<string, number>;
  /** (Atualização 38) competitionId → jogadorId → jogos de suspensão ('*' = qualquer competição, só migração) */
  bans?: Record<string, Record<string, number>>;
  /** (Atualização 38) competitionId → jogadorId → amarelos acumulados naquela competição */
  cards?: Record<string, Record<string, number>>;
  /** jogadorId → condição física 0..100 */
  fitness: Record<string, number>;
  /** (adição) acumulado financeiro da temporada (receitas positivas, despesas negativas) */
  finance?: FinanceLedger;
  /* ── (Fase 2) economia fiel — ver season/finance.ts. Ausentes ⇒ padrão (saves antigos). ── */
  /** preço do ingresso definido pelo humano (ausente/null ⇒ preço sugerido) */
  ticketPrice?: number | null;
  /** dívida do empréstimo bancário (principal; juros de 5% ao mês cobrados no dia 1) */
  loan?: number;
  /** luvas parceladas (LuvaDebt do original) */
  luvaDebts?: LuvaDebt[];
  /** obra de expansão do estádio em andamento */
  stadiumWork?: StadiumWork | null;
  /* ── (Etapa 4) ── */
  /** Moral da Torcida 0..100 (ausente ⇒ 60) */
  fanMorale?: number;
  /** últimos jogos em casa (só clubes humanos) */
  gates?: GateRecord[];
  /** demonstrativo mensal fechado (só clubes humanos) */
  months?: MonthFlow[];
  /** livro-caixa no início do mês corrente (fecha o demonstrativo no dia 1) */
  monthStart?: { month: string; ledger: FinanceLedger };
  /** último aviso da diretoria sobre o teto (mês 'AAAA-MM' e nível 1 = perto, 2 = acima) */
  boardWarn?: { month: string; level: number };
  /** (Mercado e Orçamentos) orçamentos separados do clube humano (ausente ⇒ derivado na hora; ver transfers/budget.ts) */
  budget?: ClubBudget;
}

/**
 * (Mercado e Orçamentos) Orçamentos do clube humano, definidos pela diretoria no início da temporada DO CLUBE (caixa e
 * receita) e ajustáveis pelo equilíbrio (€ 1 mi de transferências = € 50 mil/mês de folha).
 */
export interface ClubBudget {
  /** orçamento de transferências (€): taxas, multas, empréstimos e opções de compra; cai nas compras e sobe nas vendas */
  transfer: number;
  /** orçamento salarial MENSAL (€): é o Teto da Folha da diretoria (× 12) enquanto existir */
  wage: number;
  /** valores definidos pela diretoria (antes do equilíbrio e do mercado) */
  baseTransfer: number;
  baseWage: number;
  /** data em que a diretoria definiu (início da temporada do clube) */
  since: string;
}

/** (Fase 2) Luva de assinatura parcelada (`LuvaDebt` do original): cobrada mensalmente no dia 1. */
export interface LuvaDebt {
  playerId: string;
  playerName?: string;
  total: number;
  monthly: number;
  remainingInstallments: number;
  /** já pago (parcelas cobradas) */
  paid?: number;
}

/** (Fase 2) Obra de expansão do estádio: os lugares entram em `until` (ISO). */
export interface StadiumWork {
  seats: number;
  cost: number;
  started: string;
  until: string;
}

/** (Fase 2) Estado financeiro persistente por clube (WorldState.finance), restaurado a cada temporada. */
export interface ClubFinanceWorld {
  ticketPrice?: number | null;
  loan?: number;
  luvaDebts?: LuvaDebt[];
  stadiumWork?: StadiumWork | null;
  /** capacidade atual do estádio (após expansões); ausente ⇒ a dos dados */
  capacity?: number;
}

/** (adição) Livro-caixa da temporada por clube. */
export interface FinanceLedger {
  tickets: number;
  tv: number;
  sponsor: number;
  prizes: number;
  wages: number; // negativo
  /** (adição) saldo líquido de transferências: vendas (+) e compras/rescisões (−). Opcional (saves antigos). */
  transfers?: number;
  /** (Fase 2) juros do empréstimo bancário (negativo) */
  loanInterest?: number;
  /** (Fase 2) luvas pagas (à vista e parcelas; negativo) */
  luvas?: number;
  /** (Fase 2) obras do estádio (negativo) */
  stadium?: number;
  /** (Fase 2) custos operacionais mensais (manutenção, funcionários; negativo) — ECONOMY.structureCost */
  operating?: number;
  /** (escala real) aporte do dono/investidor (positivo) — clubes com folha acima da receita (ver REAL_ECONOMY) */
  owner?: number;
  /** (Etapa 4) comissão técnica e funcionários (negativo) */
  staff?: number;
  /** (Etapa 4) manutenção do estádio (negativo) */
  maintenance?: number;
  /** (Etapa 4) juros do cheque especial (negativo) */
  overdraft?: number;
  /** (Etapa 4) vendas (+) e compras (−) de jogadores separadas (o `transfers` continua sendo o líquido, com multas) */
  sales?: number;
  purchases?: number;
}

export interface SeasonState {
  season: number;
  date: string; // ISO
  humanClubIds: string[];
  competitions: Competition[];
  clubs: Record<string, ClubSeasonState>;
  /** log de notícias/mensagens curtas para a caixa de entrada */
  news: { date: string; text: string; clubId?: string }[];
  /** (adição) seed base da temporada (jogos IA usam `${seed}:${fixtureId}`) */
  seed?: string;
  /** (adição) dados econômicos estáticos por clube (capacidade, reputação, patrocínio, divisão, nome) */
  clubInfo?: Record<string, ClubEconomyInfo>;
  /** (adição) mercado de transferências. Ausente ⇒ advanceDay não roda o mercado (saves antigos/calibragem). */
  market?: MarketState;
  /** (adição Fase 1) dados de carreira: evolução mensal, estatísticas, regras de premiação/simulação. */
  career?: CareerSeasonInfo;
  /**
   * (Etapa 1) Trecho da linha do tempo global coberto por esta SeasonState (carreira): de `start` a `end` (inclusive).
   * Quando `date` passa de `end`, a virada do ciclo `closes` é devida (`turnoverDue`). `season` = ano de `start`.
   * Ausente ⇒ temporada antiga de ano civil (sem calendário duplo).
   */
  segment?: SeasonSegment;
}

/** (Etapa 1) Trecho entre duas viradas: 01/01–30/06 (fecha 'split') ou 01/07–31/12 (fecha 'calendar'). */
export interface SeasonSegment {
  start: string;
  end: string;
  closes: 'calendar' | 'split';
}

/** (adição Fase 1) parte "de carreira" da SeasonState (criada por createSeasonFromWorld). */
export interface CareerSeasonInfo {
  countryId: number;
  /** temporada em que a carreira começou (contratos padrão) */
  startSeason: number;
  /** overall fracionário corrente (evolução mensal) — absoluto, aplicado por careerSquads */
  evo: Record<string, number>;
  /** estatísticas por jogador na temporada: [jogos, gols, soma das notas × 10] */
  stats: Record<string, [number, number, number]>;
  /** jogos disputados por clube na temporada */
  clubGames: Record<string, number>;
  /** 'champion' (fiel: só o campeão, valores de premios.txt) | 'proportional' (moderno) */
  prizeMode: 'champion' | 'proportional';
  /** economy.prizes (LIGA_A, NACIONAL_CUP, ESTADUAL...) */
  prizes: Record<string, number>;
  /** simulação leve para jogos sem humano: 'none' (sempre quickSimulate), 'minor' (só entre clubes sem divisão nacional), 'all' */
  light: 'none' | 'minor' | 'all';
  /** fim de contrato por jogador (referência ao WorldState; não muda durante a temporada) */
  contractEnds?: Record<string, number>;
  /** log dos jogos remarcados por conflito de data */
  rescheduled?: number;
  /** (Etapa 1) envelhecimentos já aplicados desde o início (1º de julho de cada ano) — contratos padrão */
  agedYears?: number;
  /** (Etapa 4) tabelas reais de economia (TV, merit, prêmios por fase). Ausente ⇒ prêmio só do campeão (antigo). */
  econ?: EconTables;
  /**
   * (Registros) linhas de carreira do TRECHO por jogador e clube: `${jogadorId}|${clubeId}` → [jogos, gols,
   * assistências, soma das notas × 10, emprestado (0/1)]. No trecho a temporada de cada clube é fixa (ver
   * season/records.ts); a virada despeja tudo em `WorldState.records.players`. Ausente ⇒ save antigo (começa vazio).
   */
  lines?: Record<string, [number, number, number, number, number]>;
}

/* ───────────────────── Carreira / WorldState (adição Fase 1) ───────────────────── */

/** Registro de campeão (addChampion do original). */
export interface ChampionRecord {
  competitionId: string;
  name: string;
  type: CompetitionType;
  season: number;
  championId: string | null;
  viceId: string | null;
  topScorer?: { playerId: string; name?: string; clubId?: string; goals: number };
  /** títulos secundários (Taça Rio, Inconfidência, Apertura...) */
  titles?: { title: string; clubId: string; viceId?: string }[];
  /** (Etapa 1) ciclo e rótulo da temporada ("2026" ou "2026/27"); `season` = ano de início */
  cycle?: 'calendar' | 'split';
  seasonLabel?: string;
  /* ── (Registros) gravados na virada ── */
  /** artilharia (top 20 nas competições principais, 10 nas demais): [jogadorId, nome, clubeId, gols] */
  scorers?: RecordRow[];
  /** assistências: [jogadorId, nome, clubeId, assistências] */
  assists?: RecordRow[];
  /** ordem final (finalRanking): posição = índice + 1 */
  table?: string[];
  /** até onde cada clube chegou no mata-mata principal (nome da rodada da última eliminatória disputada) */
  reach?: Record<string, string>;
  /** país (ligas/copas nacionais) */
  countryId?: number;
  /** divisão (ligas e estaduais) */
  division?: number;
}

/** (Registros) Linha de artilharia/assistências: [jogadorId, nome, clubeId, quantidade]. */
export type RecordRow = [string, string, string, number];

/**
 * (Registros) Linha de carreira de um jogador numa temporada e clube:
 * [rótulo da temporada ("2026" | "2026/27"), clubeId ('' = clube de origem do id), jogos, gols, assistências,
 *  nota média × 10, emprestado? (1, opcional)].
 */
export type PlayerSeasonLine = [string, string, number, number, number, number, number?];

/** (Registros) Registros persistentes da carreira (além de `WorldState.history`). */
export interface CareerRecords {
  /** jogadorId → temporadas (ordem cronológica de gravação) */
  players: Record<string, PlayerSeasonLine[]>;
}

/** (Etapa 1) Campeões da liga e da copa de um país na última temporada encerrada (Supercopa, pote 1). */
export interface CountryHolders {
  league: string | null;
  cup: string | null;
  cupVice: string | null;
  /** (Etapa 2) vice da liga (supercopas de 4 clubes) */
  leagueVice?: string | null;
  /** (Etapa 2) campeão do 1º torneio da liga (Apertura na Colômbia: Superliga) */
  leagueTitle?: string | null;
  /** (Etapa 2) campeão da copa da liga (Inglaterra: EFL Cup → vaga na Conferência) */
  leagueCup?: string | null;
}

/**
 * (Etapa 2) Vagas de uma confederação para uma temporada (UEFA: 'UCL' | 'UEL' | 'UECL'; AFC: 'west' | 'east' |
 * 'playoff'), gravadas na virada a partir das tabelas finais, copas e campeões; dirigem os inscritos da temporada
 * seguinte. Os convidados (clubes de fora do escopo) completam as vagas por sorteio ponderado pela força.
 */
export interface ConfedQualifiers {
  confed: 'UEFA' | 'AFC';
  /** temporada (do ciclo 'split', ano de início) em que as vagas são disputadas */
  season: number;
  /** competição/fase → clubes, na ordem da vaga (campeões, depois a liga país a país, depois convidados) */
  lists: Record<string, string[]>;
  /** clubId → motivo ("Premier League 3º → Liga dos Campeões", "Campeão da FA Cup", "Convidado (sorteio)") */
  reason: Record<string, string>;
  /** convidados sorteados */
  guests: string[];
  /** de onde veio a ordem de cada país */
  source: Record<string, 'results' | 'strength'>;
}

/**
 * Estado persistente da carreira (acima da SeasonState). Guarda o que muda de um ano para o outro.
 * Persistir junto com a SeasonState (IndexedDB). Ver season/career.ts e season/rollover.ts.
 */
export interface HotseatManager {
  name: string;
  color: string;
  clubId: string;
}

export interface HotseatState {
  managers: HotseatManager[];
  /** índice em `managers` de quem está com o controle */
  active: number;
  /** quem já concluiu a vez na rodada atual (índices) */
  done: number[];
}

export interface WorldState {
  version: 1;
  /** temporada corrente (a da SeasonState em andamento) */
  season: number;
  startSeason: number;
  countryId: number;
  /** sigla do país (BRA, ARG...) */
  countryCode: string;
  seed: string;
  humanClubIds: string[];
  options: CareerOptions;
  /** divisões nacionais atuais: id ('BRA-1') → clubIds (ordem = semente/ranking anterior) */
  divisions: Record<string, string[]>;
  /** divisões estaduais atuais: 'SP-1' → clubIds */
  stateDivisions: Record<string, string[]>;
  /** ranking do estadual mais recente por UF (todas as divisões + sem divisão) — Copa e Série D Real */
  stateRanking: Record<string, string[]>;
  /** classificação final mais recente por competição (ordem) */
  lastRanking: Record<string, string[]>;
  /** campeão da copa nacional e da liga no ano anterior (Supercopa e pote 1) */
  cupHolder?: string | null;
  cupVice?: string | null;
  leagueHolder?: string | null;
  history: ChampionRecord[];
  /** caixa por clube (não é zerado na virada) */
  balances: Record<string, number>;
  /** livros-caixa arquivados dos clubes humanos: temporada → clube → ledger */
  ledgers: Record<string, Record<string, FinanceLedger>>;
  players: WorldPlayers;
  /* ── (Fase 2) — opcionais: saves v2 da Fase 1 não têm (ver migrateCareer) ── */
  /** revisão do formato do save: ausente/1 = Fase 1; 2 = Fase 2 (continentais + economia) */
  rev?: number;
  /** vagas continentais da temporada `continental.season` (fixadas na virada; 1º ano: força + campeões reais de 2025) */
  continental?: ContinentalQualifiers;
  /** estado financeiro persistente (empréstimo, luvas, ingresso, estádio) por clube */
  finance?: Record<string, ClubFinanceWorld>;
  /**
   * (Fase 3) Carreira do técnico humano (estabilidade, Central de Empregos, caixa de entrada). Só existe com
   * `options.coachCareer` (carreira solo); o modo online não cria. Ver season/coach.ts.
   */
  coach?: CoachCareer;
  /* ── (Etapa 1) linha do tempo global (rev 3) ── */
  /** envelhecimentos anuais (1º de julho) já aplicados */
  agedYears?: number;
  /** data em que a carreira do humano começou (01/01 na América do Sul, 01/07 na Europa/Arábia) */
  startDate?: string;
  /** campeões por país (sigla) da última temporada encerrada de cada ciclo */
  holders?: Record<string, CountryHolders>;
  /* ── (Etapa 2) competições reais e vagas ── */
  /** vagas UEFA (Liga dos Campeões, Liga Europa, Conferência) da próxima/atual temporada europeia */
  uefa?: ConfedQualifiers;
  /** vagas da AFC Champions League Elite (Oeste, Leste, playoff) */
  afc?: ConfedQualifiers;
  /**
   * campeões das competições continentais (id → clube e temporada do ciclo): Supercopa da UEFA, Recopa,
   * Intercontinental, vagas de campeão. 1º ano: sorteio ponderado pela força (ou o campeão real de 2025, se conhecido).
   */
  titleHolders?: Record<string, { clubId: string; season: number }>;
  /** (Etapa 4) Moral da Torcida por clube (só os diferentes de 60) */
  fans?: Record<string, number>;
  /** (Registros) carreiras dos jogadores (temporada × clube). Ausente ⇒ save antigo (migrateCareer cria vazio). */
  records?: CareerRecords;
  /**
   * (17/11) "Vários técnicos no mesmo computador" (hot-seat, como no Brasfoot): técnicos locais da carreira solo, na
   * ordem das vezes; `active` = quem está com o controle (o clube dele é `humanClubIds[0]`). A engine não usa.
   */
  hotseat?: HotseatState;
}

/* ───────────────────── Carreira do técnico (Fase 3) — ver season/coach.ts ───────────────────── */

/** Motivo de saída de um emprego (CoachHistoryItem do original). */
export type CoachExit = 'fired' | 'resigned' | 'mutual' | 'left' | 'contract-end';

/** Passagem do técnico por um clube ou seleção (`CoachHistoryItem`). */
export interface CoachHistoryItem {
  kind: 'club' | 'national';
  clubId?: string;
  /** seleção: id do país */
  nationalTeamId?: number;
  name: string;
  /** ISO */
  from: string;
  to: string | null;
  games: number;
  won: number;
  drawn: number;
  lost: number;
  titles: { season: number; competitionId: string; name: string }[];
  exit?: CoachExit;
}

/** Técnico humano (`Coach` do original: pontosReputacao, contratoAnos, nacionalidade...). */
export interface Coach {
  name: string;
  nationalityId: number;
  /** `pontosReputacao` (reputação 0..100 = pontos / 20; nível 0..5 = pontos / 400) */
  reputationPoints: number;
  /** salário mensal (pessoal, não entra no caixa do clube) */
  wage: number;
  /** dinheiro pessoal do técnico (multas pagas/recebidas, salários) */
  savings: number;
  /** clube atual (null = desempregado) */
  clubId: string | null;
  /** última temporada do contrato (inclusive) */
  contractUntil: number | null;
  since: string | null;
  /** seleção (cargo paralelo ao clube; sem jogos nesta versão) */
  nationalTeamId: number | null;
  nationalSince: string | null;
  history: CoachHistoryItem[];
}

export type ExpectationKind = 'title' | 'continental' | 'midtable' | 'avoid-relegation' | 'promotion';

/** Meta da temporada definida pela diretoria (força relativa × divisão). */
export interface SeasonExpectation {
  season: number;
  kind: ExpectationKind;
  /** texto pt-BR ("Brigar pelo título"...) */
  label: string;
  competitionId: string | null;
  competitionName: string;
  /** posição máxima aceitável na competição principal */
  targetPos: number;
  size: number;
  /** ranking de força do clube na competição (1 = mais forte) */
  strengthRank: number;
}

/** Diretoria/torcida do clube do técnico humano. */
export interface ClubBoardState {
  clubId: string;
  /** 0..100 — > 79 blindado; < 43 prestes a cair */
  stability: number;
  boardConfidence: number;
  fanConfidence: number;
  expectation: SeasonExpectation | null;
  /** jogos oficiais desde a contratação (sem demissão automática nos 5 primeiros) */
  gamesSinceHire: number;
  /** sequência: > 0 vitórias seguidas, < 0 derrotas seguidas */
  streak: number;
  /** avaliação do 1º turno já feita nesta temporada */
  turnoDone: boolean;
  /** menores faixas já avisadas (evita repetir o e-mail) */
  warned: { stability: number; board: number; fans: number };
}

/** Técnico de um clube da CPU. */
export interface AiCoach {
  name: string;
  nationalityId: number;
  /** reputação 0..5 (mesma escala do clube) */
  reputation: number;
  stability: number;
  since: string;
  games: number;
}

/** Vaga aberta (clube sem técnico ou seleção). */
export interface JobVacancy {
  id: string;
  clubId?: string;
  nationalTeamId?: number;
  name: string;
  openedOn: string;
  reason: 'fired' | 'resigned' | 'left' | 'pressure' | 'national' | 'initial';
  /** a CPU contrata alguém nesta data (adiada enquanto houver candidatura pendente) */
  fillOn: string;
  /** reputação mínima do técnico (0..100) */
  minReputation: number;
  previousCoach?: string | null;
}

/** Proposta de emprego (`JobOffer`): convite, candidatura aprovada ou pressão que derrubou o técnico. */
export interface JobOffer {
  id: string;
  clubId?: string;
  nationalTeamId?: number;
  name: string;
  wage: number;
  /** o original oferece 1 ano ("Duração: 1 ano") */
  years: number;
  /** estabilidade inicial no clube */
  stability: number;
  division?: number | null;
  createdAt: string;
  expiresAt: string;
  kind: 'invite' | 'application' | 'pressure';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

/** Candidatura por e-mail (`PendingJobApplication`): resposta em 7 dias. */
export interface PendingJobApplication {
  id: string;
  vacancyId: string;
  clubId?: string;
  nationalTeamId?: number;
  name: string;
  appliedOn: string;
  answerOn: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type InboxKind = 'welcome' | 'goal' | 'warning' | 'board' | 'fans' | 'offer' | 'application' | 'fired' | 'contract' | 'interest' | 'info';

/** E-mail do escritório (diretoria, convites, respostas). */
export interface InboxMessage {
  id: string;
  date: string;
  from: string;
  subject: string;
  body: string;
  kind: InboxKind;
  read: boolean;
  tone?: 'good' | 'bad' | 'neutral';
  offerId?: string;
  clubId?: string;
  nationalTeamId?: number;
}

/** "Últimas trocas de técnicos". */
export interface CoachChange {
  date: string;
  clubId?: string;
  nationalTeamId?: number;
  name: string;
  out: string | null;
  in: string | null;
  reason: string;
}

/** Estado da carreira do técnico (WorldState.coach). */
export interface CoachCareer {
  v: 1;
  coach: Coach;
  board: ClubBoardState | null;
  /** técnicos da CPU por clube do país da carreira */
  aiCoaches: Record<string, AiCoach>;
  /** "Técnicos Livres" (CPU) */
  freeCoaches: AiCoach[];
  vacancies: JobVacancy[];
  offers: JobOffer[];
  applications: PendingJobApplication[];
  inbox: InboxMessage[];
  /** clube → data (ISO) em que o técnico humano saiu (bloqueio de 30 dias) */
  leftClubs: Record<string, string>;
  /** última declaração pública de interesse (bloqueio de 6 meses) */
  lastInterestOn: string | null;
  /** clubes pressionados pela declaração de interesse (até `until`) */
  pressure: { clubId: string; until: string }[];
  changes: CoachChange[];
  /** campanha da temporada no clube atual */
  seasonRecord: { season: number; games: number; won: number; drawn: number; lost: number };
  seq: number;
  /** último dia processado por coachDay (idempotência) */
  lastDay: string | null;
}

/** (Fase 2) Vagas continentais fixadas para uma temporada (WorldState.continental). */
export interface ContinentalQualifiers {
  /** temporada em que estas vagas são disputadas */
  season: number;
  /**
   * (13/11) Cada lista vem na ordem da vaga: campeões continentais, campeão da copa nacional e depois a posição
   * na liga (país a país, na ordem CONMEBOL). Os potes dos sorteios (força) saem de `continentalPots(q, data)`.
   * Saves anteriores a 13/11 guardam as listas na ordem de pote.
   */
  libertadores: { groups: string[]; f2: string[]; f1: string[] };
  /** prelim em pares do mesmo país (1º×4º, 2º×3º): [a1, b1, a2, b2, ...] — mantém os pares (não é reordenada) */
  sulamericana: { groups: string[]; prelim: string[] };
  /** campeões do ano anterior */
  holders: { LIBERTADORES: string | null; SULAMERICANA: string | null };
  /**
   * origem de cada vaga (para a UI): clubId → texto. (13/11) Formato: "Série A 5º → Libertadores (2ª fase)",
   * "Série A 8º → Sul-Americana (grupos)", "Campeonato Argentino 3º → Libertadores (grupos)",
   * "Campeão da Copa Nacional", "Campeão da Libertadores". (Antes: "BRA 3º → grupos", "BRA → Sul-Americana (grupos)".)
   */
  reason: Record<string, string>;
  /** (adição 13/11) posição de cada clube na ordem de classificação do seu país (1-based; Apertura/Clausura: campeões primeiro) */
  position?: Record<string, number>;
  /** de onde veio a ordem de cada país: 'results' (temporada anterior) ou 'strength' (1º ano / sem histórico) */
  source: Record<string, 'results' | 'strength'>;
}

/**
 * Jogadores por cima dos dados base (clubs/<id>.json). Ver `worldSquads`.
 * - `delta`: jogadores ainda no clube base → [idade, overall, potencial, salário, valor, júnior 0|1] (absolutos)
 * - `club` + `data`: quem saiu do clube base, juniores gerados e jogadores livres (cópia completa);
 *   na temporada viram `market.moves` / `market.players`.
 * - `retired`: aposentados (id → temporada).
 * - `contractEnd`: última temporada de contrato (renovações e contratos novos).
 */
export interface WorldPlayers {
  delta: Record<string, [number, number, number, number, number, number]>;
  club: Record<string, string>;
  data: Record<string, Player>;
  retired: Record<string, number>;
  contractEnd: Record<string, number>;
  /**
   * jogadores livres desde — saem do jogo se ficarem ~1 temporada sem clube. (Etapa 1) valor = `agedYears` na
   * liberação; o envelhecimento de 1º/07 remove quem foi liberado antes do envelhecimento anterior.
   */
  freeSince: Record<string, number>;
  /** (dados) cópias duplicadas do mesmo jogador já aposentadas (ver season/dedupe.ts) — revisão aplicada */
  dedup?: number;
  /** contador para ids de juniores */
  seq: number;
  /** (Etapa 1) empréstimos que atravessam uma virada (contrato completo; voltam ao mercado no trecho seguinte) */
  loans?: Record<string, PlayerContract>;
}

export interface CareerOptions {
  /** disputar os estaduais (padrão true) — `playStateLeagues` do original */
  playStateLeagues: boolean;
  /** modo de premiação (padrão 'champion', fiel) */
  prizeMode: 'champion' | 'proportional';
  /** simulação leve (padrão 'minor') */
  light: 'none' | 'minor' | 'all';
  /** criar a copa nacional (padrão true) */
  nationalCup: boolean;
  /** criar a supercopa a partir do 2º ano (padrão true) */
  supercup: boolean;
  /** renovar automaticamente os contratos do humano que vencem (padrão false: saem, como no original) */
  humanAutoRenew: boolean;
  /** (Fase 2) Libertadores, Sul-Americana, Recopa e ligas sul-americanas (padrão true) */
  continental?: boolean;
  /** (Fase 2) Copa Intercontinental FIFA (padrão true; exige `continental`) */
  intercontinental?: boolean;
  /** (Fase 2) Supermundial: 'every4' (padrão, 2029, 2033...), 'yearly' ou 'off' */
  supermundial?: 'every4' | 'yearly' | 'off';
  /** (Fase 2) copas regionais: Copa do Nordeste (padrão true) */
  regionalCups?: boolean;
  /**
   * (Fase 3) carreira do técnico: estabilidade, demissão, Central de Empregos e caixa de entrada (WorldState.coach).
   * Padrão false (o servidor online não usa); a carreira solo liga.
   */
  coachCareer?: boolean;
}

/** Dados estáticos que a carreira precisa (todos de apps/web/public/data). */
export interface CareerData {
  /** clubs-index.json (com reputation/capacity) */
  clubs: {
    id: string; name: string; countryId: number; state: string | null; level: number; reputation?: number; capacity?: number; leagueId: string | null;
    /** (escala real) finanças iniciais do clube (clubs-index.json); ausentes ⇒ tabelas de economy.json por divisão */
    finances?: { balance: number; sponsorPerSeason: number; revenue?: number; wageBill?: number };
    /** (Etapa 2) convidado de fora do escopo (só continentais) e a sua confederação */
    guest?: boolean;
    confed?: string;
  }[];
  leagues: import('@cosmicfut/shared').Division[];
  states: import('@cosmicfut/shared').StateChampionship[];
  formats: import('@cosmicfut/shared').FormatsFile;
  competitions: import('@cosmicfut/shared').CompetitionsFile;
  /** calendários: 'MM-DD' do original ou (Etapa 1) `real:<chave>` com datas completas da temporada-base `season` */
  calendars: { id: string; dates: string[]; season?: number; cycle?: 'calendar' | 'split' }[];
  economy: { initialMoneyByDivision: Record<string, number>; sponsorByDivision: Record<string, number>; prizes: Record<string, number> } & Partial<EconTables>;
  countries: { id: number; code: string | null }[];
}

/*
 * ───────────── API da carreira (Fase 1) — implementada em ./season/{career,rollover,format,competitions,calendar}.ts ─────────────
 *
 * Dados a carregar (apps/web/public/data): clubs-index.json (com reputation/capacity), leagues.json, states.json,
 * formats.json, competitions.json, calendars.json, economy.json, countries.json → CareerData;
 * names/<CODE>.json da nacionalidade do país da carreira (BRA) → NamePools (só na virada);
 * elencos: `base(clubId)` síncrono para TODOS os clubes da temporada (≈690 no Brasil) — use
 * `squadsFromMarket(players-market.json)` e, se quiser, os bundles completos dos clubes humanos.
 *
 *   createCareer({ data, humanClubIds, season, seed, options?, squads: base }) → { world, state }
 *   worldSquads(world, base)            elencos do mundo (overrides + juniores + transferências antigas)
 *   careerSquads(state, worldBase)      elencos efetivos da temporada (mercado + evolução mensal) — telas
 *   advanceDay(state, worldBase, playedResults?, { inPlace? })   (sempre passe worldSquads, nunca o base cru)
 *   fixtureMatchRules(state, fixture)   { knockout, extraTime, aggregate } para o MatchConfig de jogo humano
 *   seasonOver(state)                   todas as competições encerradas
 *   expiringContracts(world, state, base, clubId)   quem sai na virada (perguntar ao humano)
 *   nextSeason(world, state, base, data, pools, { renew? }) → { world, state, summary }   virada completa
 *     (= rolloverSeason(...) + createSeasonFromWorld(newWorld, data, { squads: worldSquads(newWorld, base) }))
 *   Consultas: stageStandings / stageGroupTables / finalRanking / overallStandings, comp.stages[id].ties,
 *   Fixture.label/stageId/group/leg/tieId, Competition.championId/viceId/titles/relegatedIds/promotedIds/scorers.
 *
 * Persistência: salvar `world` (WorldState, ~2–4 MB após alguns anos) e `state` (SeasonState, ~1,5–3,5 MB);
 * ambos são JSON puro. A SeasonState de carreira não guarda o WorldState: os dois são salvos juntos.
 */

/*
 * ───────────── Fase 2 (2026-11-13) — continentais, economia fiel, renovação detalhada ─────────────
 *
 * Competições novas na SeasonState de carreira do Brasil (season/continental.ts): LIBERTADORES, SULAMERICANA,
 * RECOPA, INTERCONTINENTAL (todo ano), SUPERMUNDIAL (CareerOptions.supermundial: 'every4' a partir de 2029 |
 * 'yearly' | 'off'), NORDESTE ('cup', prêmio ESTADUAL) e as 1ªs divisões de ARG, URU, COL, PAR, CHI, EQU, PER,
 * BOL, VEN (type 'league', countryId do país; clubes com ClubEconomyInfo.foreign = true, simulação leve).
 * Vagas: WorldState.continental (ContinentalQualifiers), fixadas na virada por qualifyContinental; 1º ano =
 * força + campeões reais de 2025 (competitions.json → continental.initial). SeasonSummary.continental lista os
 * brasileiros classificados. Repasses Lib → Sula/Intercontinental: linkContinental (advanceDay, automático).
 * Robustez: competição com formato sem jogos pendentes e com o calendário esgotado é encerrada à força
 * (forceFinishCompetition) — seasonOver nunca trava.
 *
 * MatchResult (mata-mata): `aggregate`, `advancing` e `winner` = quem avança (ver MatchResult).
 *
 * Virada: nextSeason(world, state, base, data, pools, { renew }) — `renew` aceita lista de ids (Fase 1) ou
 * mapa id → { wage, years } | true (Fase 2; o jogador recusa salário abaixo de renewalDemand; recusas em
 * summary.contracts.refused). Marcado para renovar não se aposenta, salvo com 38+ (RENEW_RETIRE_AGE).
 * Pools de nomes: careerNamePoolCodes(world, data, state) diz quais names/<CODE>.json carregar.
 * Jogadores de clubes nunca simulados envelhecem por ageUntracked (aplicado em worldSquads).
 *
 * Economia (season/finance.ts; funções puras → { state, error? }):
 *   setTicketPrice(state, clubId, preço | null), suggestedTicketPrice, ticketDemandFactor, ticketSales
 *   takeLoan(state, clubId, blocos) / repayLoan(...) — blocos de 500 mil, juros 5%/mês (dia 1), teto maxLoan(rep)
 *   expandStadium(state, clubId, lugares) — R$ 1.000/lugar, obra de 30 + 10×⌈lugares/1000⌉ dias
 *   luvaAmount(player) (80% do valor); proposeContract(..., { luva: 0 | 6 | 12 }) para livres; payOffLuva
 *   financeOverview(state, clubId) — tudo o que a tela de finanças precisa
 * Custos operacionais mensais por divisão (ECONOMY.structureCost; FinanceLedger.operating) — recalibração.
 * Persistência entre temporadas: WorldState.finance (empréstimo, luvas, preço, obra, capacidade).
 *
 * Migração: migrateCareer(world, state?) → { world, state, migrated } (saves v2 da Fase 1 → rev 2).
 */

/*
 * ───────────── Correções de 13/11 (acréscimos; nada removido) ─────────────
 *
 * Público pagante: `MatchTeamInput.ticketDemand` (buildTeamInput preenche para o mandante com preço próprio) →
 *   `MatchSimulation`/`quickSimulate` devolvem `MatchResult.attendance` já ajustado pelo preço e `ticketDemand`.
 *   `advanceDay` aplica o preço aos resultados que chegam sem ele (`playedResults` de servidor antigo, simulação
 *   leve); `played[].result.attendance`, a notícia "Público: X" e a renda usam o mesmo número.
 *   `resultAttendance(state, homeId, result)` (idempotente) e `homeTicketDemand(state, clubId)`.
 *   ATENÇÃO UI: o `paidAttendance` do web reaplica o fator sobre `result.attendance`; com `result.ticketDemand`
 *   presente, use o número como está (ou troque por `resultAttendance`).
 * Vagas: `ContinentalQualifiers` na ordem da vaga + `reason` com a posição ("Série A 5º → Libertadores (2ª fase)")
 *   + `position`. Potes dos sorteios: `continentalPots(q, data)`. `leagueLabel(data, code)`.
 * Confrontos: `tieSummary(state, tieId)` / `tieSummaryOf(comp, tie)` → `TieSummary` { legs, aggregate, awayGoals,
 *   penalties?, played, advancing, eliminated, decidedBy: 'aggregate' | 'away-goals' | 'penalties' | null, ... }.
 * Robustez: `MIN_SQUAD` (18) na virada (juniores completam o elenco); repasse continental menor que o previsto
 *   não trava a fase (Sul-Americana sem campeão); clube humano brasileiro fora de qualquer divisão entra na divisão
 *   estadual mais baixa da sua UF; preliminar da Sul-Americana com nº ímpar de clubes não deixa vaga fantasma.
 * Desempenho: `marketSquadsCache` (invalidação seletiva); `runMarketDay` devolve os elencos efetivos do dia;
 *   `careerSquads(state, base, marketApplied?)`.
 */

/** Resumo da temporada encerrada (retornado por rolloverSeason). */
export interface SeasonSummary {
  season: number;
  /**
   * (Etapa 1) virada regional: ciclo que fechou ('calendar' = América do Sul em 31/12; 'split' = Europa/Arábia em
   * 30/06), regiões, rótulo da temporada encerrada, se houve envelhecimento anual (1º/07) e a data da virada.
   * `season` = temporada do ciclo encerrado (2026/27 → 2026).
   */
  cycle?: 'calendar' | 'split';
  regions?: ('EU' | 'SA' | 'SAU')[];
  seasonLabel?: string;
  aging?: boolean;
  date?: string;
  champions: ChampionRecord[];
  /** acesso/rebaixamento nacionais: divisão → clubes */
  promoted: Record<string, string[]>;
  relegated: Record<string, string[]>;
  /** estaduais: 'SP-1' → { up, down } */
  stateMoves: Record<string, { up: string[]; down: string[] }>;
  /** Série D Real do ano seguinte */
  serieD?: { fromC: string[]; kept: string[]; fromStates: string[]; dropped: string[] };
  retirements: { playerId: string; name: string; clubId: string; age: number; overall: number; youthId?: string }[];
  youth: { playerId: string; name: string; clubId: string; nationalityId: number; overall: number; potential: number }[];
  /** renovados, liberados (viram livres), do humano liberados, livres contratados pela CPU na virada */
  contracts: {
    renewed: number; released: number; humanReleased: string[]; signedFree: number;
    /** (Fase 2) renovações detalhadas recusadas pelo jogador (salário abaixo do pedido) — o jogador ficou livre */
    refused?: { playerId: string; asked: number; offered: number; reason: string }[];
    /** (Etapa 5) pré-contratos concluídos nesta virada */
    preContracts?: { playerId: string; name: string; from: string; to: string }[];
  };
  loansReturned: number;
  /** evolução no ano: jogadores avaliados, soma dos Δ de overall (mensal + bônus) e soma dos bônus de fim de ano */
  evolution: { players: number; delta: number; bonus: number };
  /** médias dos clubes da carreira após a virada */
  averages: { age: number; overall: number; balance: number; players: number };
  /** (Fase 2) classificados do país da carreira para as continentais do ano seguinte + vagas completas */
  continental?: { libertadores: string[]; sulamericana: string[]; qualifiers: ContinentalQualifiers };
  /** (Etapa 2) vagas UEFA/AFC da temporada seguinte (virada de 30/06) e campeões continentais gravados */
  uefa?: ConfedQualifiers;
  afc?: ConfedQualifiers;
  /** (Etapa 2) playoffs de rebaixamento entre divisões: sigla → { vencedor, perdedor, quem subiu/desceu } */
  relegationPlayoffs?: Record<string, { winner: string; loser: string; swapped: boolean }>;
  /** (Etapa 2) clubes "só estadual" que entram na divisão (Série B) no lugar dos rebaixados: divisão → clubes */
  fromStates?: Record<string, string[]>;
  /** (Fase 3) o técnico humano saiu deste clube na virada (demitido ou contrato não renovado) */
  coachLeft?: string;
}

/**
 * Cria temporada para as competições informadas (ex: a divisão do clube humano;
 * opcionalmente todas as divisões do país). Datas de rodada a partir de calendars.json
 * (calendário 'nacional') ou espaçamento semanal se faltar.
 */
export interface CreateSeasonOptions {
  season: number;
  startDate: string;
  divisions: { id: string; name: string; clubIds: string[]; doubleRound: boolean; relegated: number; promoted: number }[];
  calendarDates?: string[]; // 'MM-DD'
  humanClubIds: string[];
  clubBalances: Record<string, number>;
  seed: string;
  /** (adição) dados de clube para finanças: capacidade, reputação, patrocínio, divisão */
  clubInfo?: Record<string, ClubEconomyInfo>;
}

/** (adição) Informação econômica estática de um clube, usada por advanceDay. */
export interface ClubEconomyInfo {
  capacity?: number;
  reputation?: number; // 0..5
  sponsorPerSeason?: number;
  division?: number;
  name?: string;
  /** (Fase 2) clube de outro país (ligas sul-americanas, continentais): simulação leve nos jogos sem humano */
  foreign?: boolean;
  /** (Fase 2) id do país do clube (sorteios com restrição de país) */
  countryId?: number;
  /** (Etapa 1) região do clube ('SA', 'EU', 'SAU'): ciclo da temporada, janela e vencimento de contratos */
  region?: 'EU' | 'SA' | 'SAU';
  /**
   * (escala real) receita anual e folha anual inicial do elenco (euros; Club.finances do pipeline). Com `revenue`,
   * TV/bilheteria/custos/aporte do dono escalam com a receita (season/economy.ts REAL_ECONOMY); sem ela (saves
   * antigos), valem as tabelas por divisão.
   */
  revenue?: number;
  wageBill?: number;
  /* ── (Etapa 4) perfil econômico (season/econ.ts → clubEconomyProfile), recalculado a cada trecho ── */
  /** cota de TV anual da divisão ATUAL (12 parcelas mensais) */
  tvPerSeason?: number;
  /** comissão técnica e funcionários (anual; inclui o técnico) */
  staffPerSeason?: number;
  /** salário mensal de referência do técnico */
  coachMonthly?: number;
  /** manutenção do estádio (anual) */
  maintenancePerSeason?: number;
  /** despesas operacionais (administração, viagens, base; anual) */
  opexPerSeason?: number;
  /** aporte dos donos (anual; PIF/sauditas) */
  ownerPerSeason?: number;
  /** clube bancado pelo dono (PIF): o aporte acompanha a folha atual */
  ownerBacked?: boolean;
  /** Teto da Folha Salarial (anual), definido pela diretoria */
  wageCeiling?: number;
  /** limite do cheque especial (saldo negativo máximo para comprar) */
  creditLimit?: number;
  /** preço-base do ingresso e ocupação-base do estádio */
  basePrice?: number;
  fill0?: number;
  /** bilheteria esperada na temporada (calibração) */
  gatePerSeason?: number;
  /** liga atual na tabela de TV ('BRA-1', 'BRA-state', 'guest') e sigla do país */
  leagueKey?: string;
  code?: string;
  /** UF (clubes brasileiros: clássicos estaduais) */
  uf?: string;
  /** convidado de fora do escopo */
  guest?: boolean;
  /** (Etapa 5) liga do clube nos DADOS (início da carreira): base do fator de reputação dos valores (transfers/value.ts) */
  dataLeague?: string;
}

/* ───────────── (Etapa 4) economia: tabelas reais (economy.json v2) e registros ───────────── */

/** Premiação por fase de uma copa/continental (euros). Ver packages/data/src/prizes.mjs. */
export interface PrizeSchedule {
  participation?: number;
  win?: number;
  draw?: number;
  reach?: Record<string, number>;
  champion?: number;
  source?: string;
  confidence?: string;
}

export interface EconTables {
  version?: number;
  currency?: { base: string; brlPerEur: number; usdToEur?: number; gbpToEur?: number };
  tv: Record<string, { min: number; max: number }>;
  merit: Record<string, { first: number; last: number; paid: number }>;
  competitionPrizes: Record<string, PrizeSchedule>;
  wageRatio: Record<string, { target: number; cap: number }>;
  matchday: Record<string, number>;
  ownerBacked: string[];
}

/** Bilheteria de um jogo em casa (histórico dos clubes humanos). */
export interface GateRecord {
  date: string;
  fixtureId: string;
  opponentId: string;
  competition: string;
  attendance: number;
  capacity: number;
  price: number;
  importance: number;
  importanceLabel: string;
  fanMorale: number;
  revenue: number;
  neutral?: boolean;
}

/** Linha do demonstrativo mensal: o que o livro-caixa mudou no mês e o saldo ao fechar. */
export interface MonthFlow {
  month: string;
  flow: Partial<FinanceLedger>;
  balance: number;
}

/*
 * Implementado em ./season/*.ts (exportado por index.ts):
 *   createSeason(opts: CreateSeasonOptions): SeasonState
 *     Datas de rodada a partir de calendarDates ('MM-DD', ano da temporada) ou semanais.
 *   generateRoundRobin(clubIds, doubleRound, seed): { round; homeId; awayId }[]  (método do círculo)
 *   computeStandings(competition, opts?): StandingRow[]
 *   nextFixtureFor(state, clubId): Fixture | null
 *   fixturesOn(state, date): Fixture[]
 *   advanceDay(state, squads, playedResults?): { state; played }
 *     Simula IA×IA com quickSimulate, aplica resultados humanos, atualiza lesões/suspensões/
 *     fitness/moral/finanças (bilheteria, TV, salários mensais no dia 1) e avança a data.
 */

/* ───────────────────────── Mercado de transferências (adição) ───────────────────────── */

/** Clube "livre" em `MarketState.moves` (jogador sem clube). */
export type FreeAgent = '';

/** Janela de transferências na data atual. Fora da janela só se contratam jogadores livres. */
export interface TransferWindow {
  open: boolean;
  /** data (ISO) em que a janela aberta fecha */
  closesOn: string | null;
  /** data (ISO) em que a próxima janela abre (quando fechada) */
  opensOn: string | null;
}

/**
 * Tipo da negociação. (Etapa 5) 'precontract' = jogador nos últimos 6 meses de contrato em outro clube: assina sem
 * taxa de transferência (só luvas + salário) e chega na virada da região do clube dele.
 */
export type TransferKind = 'transfer' | 'loan' | 'free' | 'precontract';

/** (Etapa 5) Termos de um empréstimo (1 temporada). */
export interface LoanTerms {
  /** % do salário pago pelo clube que recebe (0–100); o dono paga o resto */
  wageShare: number;
  /** opção de compra fixa (ausente = sem opção) */
  purchaseOption?: number;
  /** o dono pode chamar o jogador de volta na janela de inverno/meio de ano */
  recall?: boolean;
}

/** Contrato vigente de um jogador que mudou de clube (ou renovou). */
export interface PlayerContract {
  wage: number; // mensal
  /** última temporada do contrato (inclusive) */
  endsSeason: number;
  since: string; // ISO
  fee: number;
  /** (Etapa 5) 'renewal' = renovação durante a temporada (IA) */
  kind: TransferKind | 'renewal';
  /** empréstimo: clube dono e data de retorno */
  loanFrom?: string;
  loanUntil?: string;
  /** (Etapa 5) multa rescisória (ausente ⇒ a padrão de `defaultReleaseClause`) */
  releaseClause?: number;
  /** (Etapa 5) empréstimo: % do salário pago por quem recebe (ausente = 100), opção de compra e retorno antecipado */
  wageShare?: number;
  purchaseOption?: number;
  recall?: boolean;
  /** (Etapa 5) empréstimo: fim do contrato com o clube dono (temporada) — para o valor e a volta */
  parentEnd?: number;
}

/** (Etapa 5) Pré-contrato assinado: o jogador muda de clube na virada da região do clube atual. */
export interface PreContract {
  playerId: string;
  playerName: string;
  fromClubId: string;
  toClubId: string;
  toName: string;
  wage: number;
  years: number;
  releaseClause?: number;
  signedOn: string;
}

/**
 * Status de uma oferta:
 *  - compras do humano: negotiating → agreed (clube aceitou; falta o contrato) → completed | collapsed
 *    (jogador recusou) | rejected (clube encerrou) | withdrawn (humano desistiu) | expired (janela fechou)
 *  - ofertas da IA pelos jogadores do humano: pending → completed (aceita) | rejected | expired
 */
export type OfferStatus = 'negotiating' | 'agreed' | 'completed' | 'collapsed' | 'rejected' | 'withdrawn' | 'expired' | 'pending';

export interface OfferRound {
  by: 'buyer' | 'seller' | 'player';
  fee?: number;
  wage?: number;
  years?: number;
  decision?: 'accept' | 'reject' | 'counter';
  date: string;
  text?: string;
}

export interface TransferOffer {
  id: string;
  kind: TransferKind;
  playerId: string;
  /** cópia do jogador no momento da oferta (o comprador pode não ter o elenco do vendedor carregado) */
  player: Player;
  /** vendedor ('' = jogador livre) */
  fromClubId: string;
  fromName: string;
  toClubId: string;
  toName: string;
  /** valor proposto/acordado pelo comprador */
  fee: number;
  /** contraproposta do vendedor (quando houver) */
  counterFee?: number;
  /** rodadas de negociação com o clube (1..MARKET.maxRounds) */
  round: number;
  /** rodadas de negociação do contrato com o jogador */
  contractRound: number;
  /** contraproposta salarial do jogador */
  askedWage?: number;
  wage?: number;
  years?: number;
  status: OfferStatus;
  createdOn: string;
  updatedOn: string;
  /** ofertas recebidas expiram nesta data */
  expiresOn?: string;
  log: OfferRound[];
  /* ── (Etapa 5) ── */
  /** empréstimo: termos propostos/acordados e a contraproposta do dono */
  loan?: LoanTerms;
  counterLoan?: LoanTerms;
  /** o comprador pagou a multa rescisória (venda forçada) */
  clause?: boolean;
  /** multa rescisória do contrato novo e luvas acordadas */
  releaseClause?: number;
  luva?: number;
  /** contraproposta do jogador: anos pedidos */
  askedYears?: number;
  /** oferta recebida pelo humano: valor máximo que a IA compradora aceita pagar (não vai para a UI) */
  maxFee?: number;
}

export interface TransferRecord {
  date: string;
  playerId: string;
  playerName: string;
  position: Position;
  age: number;
  overall: number;
  fromClubId: string; // '' = livre
  fromName: string;
  toClubId: string; // '' = dispensado
  toName: string;
  fee: number;
  wage: number;
  kind: TransferKind | 'release' | 'loan-return';
  /** (Etapa 5) multa paga, opção de compra exercida, empréstimo chamado de volta */
  via?: 'clause' | 'option' | 'recall';
  /** (Etapa 5) regiões de origem/destino (estatísticas: América do Sul → Europa etc.) */
  fromRegion?: string;
  toRegion?: string;
}

export interface MarketRules {
  /** saldo negativo permitido ao humano para compras (0 = só com caixa) */
  overdraft: number;
  minSquad: number;
  maxSquad: number;
}

/** Estado do mercado dentro da SeasonState (campo opcional `market`). */
export interface MarketState {
  window: TransferWindow;
  /** jogadorId → clubId atual ('' = livre). Substitui o clube de origem dos dados base. */
  moves: Record<string, string>;
  /** jogadorId → contrato novo */
  contracts: Record<string, PlayerContract>;
  /** jogadorId → jogador com dados atualizados (salário do contrato novo); usado por effectiveSquad */
  players: Record<string, Player>;
  offers: TransferOffer[];
  /** jogadores listados para venda (de qualquer clube) */
  transferList: string[];
  /** log de transferências (mais recentes primeiro) */
  history: TransferRecord[];
  rules: MarketRules;
  /** contador para ids de oferta */
  seq: number;
  /* ── (Etapa 5; ausentes em saves antigos) ── */
  /** pré-contratos assinados (jogadorId → acordo); concluídos na virada da região do clube atual */
  preContracts?: Record<string, PreContract>;
  /** jogadores oferecidos por empréstimo (elencos inchados da IA e o humano) */
  loanList?: string[];
  /** reposições pendentes dos clubes grandes da IA (posições que perderam alguém vendido) */
  needs?: Record<string, Position[]>;
  /** contadores de mercado do trecho (estatísticas; não afetam o jogo) */
  tally?: MarketTally;
  /**
   * (Mercado e Orçamentos) propostas recusadas pelo clube vendedor, por jogador e clube comprador (`${jogadorId}|${compradorId}`),
   * na janela do comprador. Na 3ª recusa o vendedor bloqueia novas negociações por 14 dias. Ausente ⇒ vazio.
   */
  rejections?: Record<string, OfferRejections>;
}

/** (Mercado e Orçamentos) Recusas de propostas de um comprador por um jogador (ver transfers/cooldown.ts). */
export interface OfferRejections {
  /** recusas na janela atual (zera ao bloquear e quando a janela muda) */
  rejectedOffersCount: number;
  /** chave da janela do comprador (data de fechamento) */
  window: string;
  sellerId: string;
  /** bloqueio: novas negociações só a partir desta data (ISO, inclusive) */
  blockedUntil?: string;
}

/** (Etapa 5) Contadores do mercado no trecho (para relatórios e testes estatísticos). */
export interface MarketTally {
  transfers: number;
  loans: number;
  free: number;
  precontracts: number;
  clauses: number;
  renewals: number;
  options: number;
  /** soma das taxas */
  fees: number;
  /** América do Sul → Europa (com taxa), Europa → Arábia, jovens (≤ 23) sul-americanos para a Europa */
  saToEu: number;
  saToEuFees: number;
  euToSau: number;
  youngSaToEu: number;
}

/*
 * Implementado em ./transfers/*.ts (exportado por index.ts):
 *   transferWindow(date): TransferWindow            janelas: início da temporada–31/03 e 01/07–31/08
 *   createMarket(state, squads, rules?) / ensureMarket(state, squads): cria o mercado (IA dispensa
 *     excedentes acima de 32 → jogadores livres)
 *   baseClubOf(playerId), currentClubOf(state, playerId)
 *   effectiveSquad(state, baseSquads, clubId)     aplica moves/contratos ao elenco base (idempotente)
 *   marketSquads(state, baseSquads)               `squads()` efetivo e memorizado (para advanceDay/UI)
 *   freeAgents(state)
 *   askingPrice / evaluateOffer / evaluateContract / contractDemand   decisões (ver transfers/valuation.ts)
 *   makeOffer(state, squads, req)                 etapa 1: valor ao clube (até 3 rodadas)
 *   proposeContract(state, squads, req)           etapa 2: salário/anos com o jogador → conclui
 *   respondToOffer(state, squads, offerId, accept) humano aceita/recusa oferta recebida
 *   withdrawOffer, setTransferListed, releasePlayer
 *   marketDay(state, squads)                      dia de mercado da IA (chamado por advanceDay se `market`)
 *   Finanças: FinanceLedger.transfers (+vendas −compras). Notícias em `news`.
 */

export type { Player, Position, TraitId };
