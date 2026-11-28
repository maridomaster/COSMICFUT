/**
 * Núcleo da simulação da CARREIRA online — roda no worker do servidor (sim-worker.ts), inline (SIM_WORKERS=0) ou no
 * Web Worker do anfitrião da simulação no navegador (online grátis: GitHub Pages + Cloudflare).
 * Replica o loop de apps/web/src/career/career.worker.ts.
 *
 * O simulador é o DONO de `world` (WorldState) e `state` (SeasonState) de cada sala: roda
 * `advanceDay(state, worldSquads(world, base), results, { inPlace: true })` sem cópias e devolve à sala só
 * o que ela precisa (metadados, configs das partidas ao vivo, ids dos elencos humanos) + snapshots já
 * serializados e comprimidos (gzip de JSON). Assim o thread principal nunca clona/serializa os ~2–7 MB
 * da carreira: medido, um structuredClone da SeasonState custa ~90 ms e um JSON.stringify ~30 ms.
 */
import { fromUtf8, gunzip, gzip, utf8 } from './platform.ts';
import type { ClubBundle, NamePool, Player } from '@cosmicfut/shared';
import {
  advanceDay, applyTransfer, baseClubOf, buildTeamInput, careerNamePoolCodes, careerSquads, createCareer,
  currentClubOf, expiringContracts, fixtureMatchRules, fmtMoneyShort, FREE, makeOffer, migrateCareer, nextSeason, proposeContract, releasePlayer, promoteProspect, releaseProspect, setTraining, setTicketPrice, takeLoan, repayLoan, expandStadium, payOffLuva, signSponsor, declineSponsor,
  renewalDemand, respondToOffer, rolloverSeason, seasonOver, setTransferListed, withdrawOffer, worldSquads,
  autoTurnoverDue, isLegacyCareer, marketWindow, scopeNamePoolCodes, turnoverDue,
  counterIncoming, exercisePurchaseOption, recallLoan, releaseClauseOf, renewContract, setLoanListed, computeStandings, TimeSkip,
  rebalanceBudgets, transferBudgetError, isFinalFixture, negotiationBlock, blockMessage, noteRejection,
  type CareerData, type CareerOptions, type ContractDecision, type ExternalClubInfo, type Fixture, type Lineup, type TacticPreset, type LoanTerms, type MarketResult,
  type MatchConfig, type MatchResult, type OfferDecision, type RenewTerms, type SeasonState, type SeasonSummary, type Tactic,
  type TransferOffer, type TransferRecord, type WorldState,
} from '@cosmicfut/engine';
import { careerBase, loadBundle, loadCareerData, loadMarketSquads, loadNamePools, type BaseSquads, type CareerSource } from './career-data.ts';
import {
  acceptOffer, adminOffer, applyForVacancy, declineOffer, emptyJobs, jobsDay, registerManager, releaseManager, removeManager, renameManager,
  sanitizeJobs, seedVacancies, type JobEvent, type OnlineJobs,
} from './jobs.ts';

/** (carreira online) técnico da sala para o modelo de empregos */
export interface ManagerSeed {
  id: string;
  name: string;
  clubId: string | null;
}

/** (carreira online) ações da Central de Empregos e da sala sobre os técnicos */
export type JobsAction =
  | { type: 'register'; manager: ManagerSeed }
  | { type: 'rename'; managerId: string; name: string }
  | { type: 'apply'; managerId: string; vacancyId: string }
  | { type: 'accept'; managerId: string; offerId: string }
  | { type: 'decline'; managerId: string; offerId: string }
  /** o técnico deixa o clube (expulso da sala): clube volta à IA, vaga aberta */
  | { type: 'release'; managerId: string; remove?: boolean }
  | { type: 'firing'; on: boolean }
  /** convite do host: o clube (da IA) convida o técnico, mesmo empregado */
  | { type: 'admin-offer'; managerId: string; clubId: string };

export interface JobsResponse {
  meta: CareerMeta;
  ok: boolean;
  error?: string;
  message?: string;
  clubId?: string;
}

/* ───────────────────────── protocolo sala ⇄ simulador ───────────────────────── */

/** Até onde o `round` avança. */
export type RoundUntil =
  /** jogo normal: para no 1º dia com jogo de um humano PRESENTE (os ausentes são simulados por quickSimulate) */
  | { kind: 'match' }
  /** (dev) simula tudo, inclusive jogos humanos, e para no PRÓXIMO dia com jogo humano */
  | { kind: 'next-match' }
  /**
   * (18/11) depois do dia de jogo: fecha o dia e avança até o PRÓXIMO dia com jogo de um humano, parando nele SEM
   * jogá-lo — o planejamento (escalação, físico) fica no próprio dia do jogo, não dias antes
   */
  | { kind: 'prep' }
  /** (dev) simula até o fim da temporada */
  | { kind: 'season-end' }
  /** (dev) simula até a data (ISO), parando antes de jogá-la */
  | { kind: 'date'; date: string };

export interface ClubSetup {
  tactic: Tactic;
  lineup: Lineup | null;
  /** (Táticas) as 3 predefinições do técnico (validadas em validate.presets) */
  presets?: (TacticPreset | null)[];
}

export type SimRequest =
  | { op: 'create'; room: string; humanClubIds: string[]; season: number; seed: string; countryId: number; options?: Partial<CareerOptions>; managers?: ManagerSeed[]; firing?: boolean }
  /** restaura a carreira de uma sala (disco ou reinício do worker); chama migrateCareer */
  | {
      op: 'hydrate'; room: string; humanClubIds: string[]; worldGz: Uint8Array; stateGz: Uint8Array; version: number; worldVersion: number; setups?: Record<string, ClubSetup>;
      /** (carreira online) Central de Empregos salva; ausente (sala antiga) ⇒ criada a partir de `managers` */
      jobs?: OnlineJobs | null;
      managers?: ManagerSeed[];
      firing?: boolean;
    }
  /** (carreira online) Central de Empregos */
  | { op: 'jobs'; room: string; action: JobsAction }
  | { op: 'set-lineup'; room: string; clubId: string; setup: ClubSetup }
  | {
      op: 'round';
      room: string;
      /** resultados das partidas humanas ao vivo do dia corrente (fecha o dia antes de seguir) */
      results?: Record<string, MatchResult>;
      /** clubes humanos cujo dono está presente (jogo ao vivo); os demais jogos humanos são simulados */
      live: string[];
      until: RoundUntil;
      /** 0 = só fecha o dia de `results` */
      maxDays: number;
      /** (17/11, modo turnos) propostas humano × humano que o dono ainda não viu na vez dele: não expiram */
      keepOffers?: string[];
      /** (carreira online) demissões de humanos ligadas (configuração da sala) */
      firing?: boolean;
    }
  /** (17/11) salto votado: um pedaço de até `days` dias com o assistente em todos os humanos */
  | { op: 'skip'; room: string; until: string; days: number; playerOfferPct?: number }
  | { op: 'season-end'; room: string }
  | { op: 'rollover'; room: string; renew: Record<string, RenewTerms | true> }
  /** ação de mercado de um clube humano (a sala já validou a fase e o dono do clube) */
  | { op: 'market'; room: string; clubId: string; action: MarketAction; noHumanDeals?: boolean }
  | { op: 'drop'; room: string };

/** Ações de mercado (ver net.ts: market:*). */
export type MarketAction =
  | { type: 'offer'; playerId: string; fee: number; kind: 'transfer' | 'loan' | 'precontract'; offerId?: string; loan?: LoanTerms; clause?: boolean }
  | { type: 'contract'; offerId?: string; playerId?: string; wage: number; years: number; luva?: number; releaseClause?: number }
  | { type: 'respond'; offerId: string; accept: boolean }
  | { type: 'withdraw'; offerId: string }
  /* (Etapa 5) */
  | { type: 'counter'; offerId: string; fee: number }
  | { type: 'loanlist'; playerIds: string[]; listed: boolean; months?: number }
  | { type: 'option'; playerId: string }
  | { type: 'recall'; playerId: string }
  | { type: 'renew'; playerId: string; wage: number; years: number; releaseClause?: number }
  | { type: 'list'; playerIds: string[]; listed: boolean }
  | { type: 'release'; playerId: string }
  /** (Base) promove / dispensa um revelado da base do clube */
  | { type: 'promote'; playerId: string }
  | { type: 'dismiss'; playerId: string }
  /** (Treino) define os jogadores do Centro de Treinamento */
  | { type: 'train'; playerIds: string[] }
  /** (28/11) gestão do clube: ingresso (null = sugerido), empréstimo bancário, obra do estádio, quitar luva */
  | { type: 'finance'; op: 'ticket'; price: number | null }
  | { type: 'finance'; op: 'loan' | 'repay'; blocks: number }
  | { type: 'finance'; op: 'stadium'; seats: number }
  | { type: 'finance'; op: 'luva'; playerId: string }
  /** (28/11) patrocínio master: assinar (accept) ou recusar uma proposta */
  | { type: 'finance'; op: 'sponsor'; offerId: string; accept: boolean }
  /** (Mercado e Orçamentos) equilíbrio: move 	oWage € de transferências para a folha (negativo = o contrário) */
  | { type: 'budget'; toWage: number };

export interface MarketResponse {
  meta: CareerMeta;
  ok: boolean;
  /** erro de validação/regra (com `changed` = false o estado não mudou) */
  error?: string;
  changed: boolean;
  offer?: TransferOffer;
  club?: OfferDecision;
  contract?: ContractDecision;
  record?: TransferRecord;
  /** proposta a outro humano criada (aguarda a resposta dele) */
  pendingHuman?: boolean;
  /** patch para os clientes (market:update), quando o estado mudou */
  patch?: { version: number; date: string; gz: Uint8Array; json: number };
  /** clubes humanos cujo elenco mudou nesta ação */
  touched: string[];
}

/** Proposta de humano por jogador de outro humano: pendente até o fim do planejamento. */
const HUMAN_OFFER_NOTE = 'Proposta de outro técnico: aguarda a resposta do dono até o fim do planejamento.';

export interface DayPlayed {
  date: string;
  results: { fixtureId: string; competitionId: string; home: number; away: number; penalties?: { home: number; away: number }; homeId: string; awayId: string }[];
}

/** (17/11) Liga dos Amigos: situação de cada clube humano (calculada no simulador). */
export interface HumanClubInfo {
  balance: number;
  /** liga principal (pontos corridos) do clube nesta temporada */
  league: { id: string; name: string; pos: number; size: number; division: number } | null;
  /** títulos das competições já encerradas nesta temporada */
  titles: { id: string; name: string; type: string; division?: number; season: number }[];
  /** confrontos de mata-mata vencidos nesta temporada (campanha nas copas) */
  koWins: number;
}

export interface SkipResponse {
  meta: CareerMeta;
  /** null = pedaço concluído, salto continua */
  reason: 'done' | 'offer' | 'season-end' | 'limit' | null;
  note?: string;
  stopClubId: string | null;
  days: number;
  games: number;
}

/** Snapshot pronto para a rede/disco: JSON comprimido com gzip. */
export interface PackedSnapshot {
  room: string;
  version: number;
  worldVersion: number;
  season: number;
  date: string;
  stateGz: Uint8Array;
  /** presente quando o mundo mudou (create, hydrate, rollover) */
  worldGz?: Uint8Array;
  /** tamanhos em bytes (JSON cru e comprimido) e tempo de serialização+compressão */
  stats: { stateJson: number; stateGz: number; worldJson?: number; worldGz?: number; ms: number };
}

/** Metadados que a sala mantém (o estado em si fica no simulador). */
export interface CareerMeta {
  season: number;
  date: string;
  version: number;
  worldVersion: number;
  over: boolean;
  /** ids do elenco efetivo de cada clube humano (validação de escalação no thread principal) */
  humanSquads: Record<string, string[]>;
  /** divisões nacionais do mundo atual (RoomSettings.divisionIds) */
  divisionIds: string[];
  /** (17/11) Liga dos Amigos */
  humans?: Record<string, HumanClubInfo>;
  /** (carreira online) clubes humanos atuais (mudam com contratações/demissões) */
  humanClubIds?: string[];
  /** (carreira online) Central de Empregos (a sala persiste) */
  jobs?: OnlineJobs;
  /** (carreira online) eventos novos (demitido, contratado, proposta, resposta) */
  jobEvents?: JobEvent[];
}

export type StopReason = 'matchday' | 'season-over' | 'date' | 'limit' | 'jobs';

export interface LiveFixture {
  fixture: Fixture;
  config: MatchConfig;
  /** (19/11) final de competição: roda no mínimo na velocidade Normal */
  final?: boolean;
}

export interface RoundResponse {
  meta: CareerMeta;
  reason: StopReason;
  days: number;
  games: number;
  /** ms só dos advanceDay e o maior dia */
  simMs: number;
  maxDayMs: number;
  /** partidas ao vivo a montar (reason 'matchday') */
  matches: LiveFixture[];
}

export interface ExpiringInfo {
  playerId: string;
  name: string;
  position: string;
  age: number;
  overall: number;
  wage: number;
  /** pedido do jogador (renewalDemand): salário mínimo aceito e faixa de anos */
  demand: { wage: number; minYears: number; maxYears: number };
}

/** Resumo enviado ao entrar no fim de temporada (prévia EXATA da virada, sem a parte de contratos/jogadores). */
export type SeasonPreview = Pick<SeasonSummary, 'season' | 'champions' | 'promoted' | 'relegated' | 'stateMoves' | 'serieD' | 'continental'>;

export interface SeasonEndResponse {
  meta: CareerMeta;
  preview: SeasonPreview;
  expiring: Record<string, ExpiringInfo[]>;
}

export interface RolloverResponse {
  meta: CareerMeta;
  summary: SeasonSummary;
  /** summary.contracts.humanReleased separado por clube humano (clubId → playerIds) */
  releasedByClub: Record<string, string[]>;
}

export type SimResponse =
  | { meta: CareerMeta; migrated?: boolean }
  | RoundResponse
  | SeasonEndResponse
  | RolloverResponse
  | MarketResponse
  | SkipResponse
  | JobsResponse
  | { ok: true };

/** Eventos emitidos durante uma operação (antes da resposta). */
export interface SimEvents {
  day?(d: DayPlayed): void;
}

/* ───────────────────────── helpers ───────────────────────── */

/** Mesma seed que advanceDay usa nos jogos simulados — sem comandos e com as duas IAs, dá o mesmo placar. */
export function matchSeed(state: SeasonState, fixture: Fixture): string {
  return `${state.seed ?? 'season'}:${state.season}:${fixture.id}`;
}

/** MatchConfig de um jogo humano: elencos da carreira + regras do mata-mata (agregado, pênaltis sem prorrogação). */
export function careerMatchConfig(state: SeasonState, fixture: Fixture, squads: BaseSquads): MatchConfig {
  const home = buildTeamInput(state, fixture.homeId, squads(fixture.homeId), true, fixture);
  const away = buildTeamInput(state, fixture.awayId, squads(fixture.awayId), false);
  return { seed: matchSeed(state, fixture), home, away, ...fixtureMatchRules(state, fixture) };
}

export const gzipJson = (x: unknown): { gz: Uint8Array; json: number } => {
  const json = JSON.stringify(x);
  // nível 4: ~40 ms para 4 MB (nível 6: ~80 ms, só ~10% menor) — o pack atrasa a próxima operação do worker
  const bytes = utf8(json);
  return { gz: gzip(bytes, 4), json: bytes.byteLength };
};
export const gunzipJson = <T>(gz: Uint8Array): T => JSON.parse(fromUtf8(gunzip(gz))) as T;

/* ───────────────────────── simulador ───────────────────────── */

interface Career {
  room: string;
  humanClubIds: string[];
  base: BaseSquads;
  world: WorldState;
  state: SeasonState;
  version: number;
  worldVersion: number;
  wb: BaseSquads;
  /** mundo mudou desde o último pack (manda o world junto) */
  worldDirty: boolean;
  /** (carreira online) Central de Empregos */
  jobs: OnlineJobs;
}

export class CareerSimulator {
  /** de onde vêm os JSON da carreira (disco no Node, /data no navegador) */
  readonly src: CareerSource;
  private dataCache: CareerData | null = null;
  private marketCache: Map<string, Player[]> | null = null;
  private readonly bundles = new Map<string, Player[]>();
  /** bundles completos de clubes NÃO humanos (mercado: traits/lado do jogador, dados do vendedor estrangeiro) */
  private readonly fullBundles = new Map<string, ClubBundle | null>();
  private readonly pools = new Map<string, NamePool | null>();
  private readonly careers = new Map<string, Career>();

  constructor(src: CareerSource) {
    this.src = src;
  }

  get data(): CareerData {
    return (this.dataCache ??= loadCareerData(this.src));
  }

  private get market(): Map<string, Player[]> {
    return (this.marketCache ??= loadMarketSquads(this.src));
  }

  /** Carrega dados e players-market (aquecimento do worker). */
  warm(): void {
    void this.data;
    void this.market;
  }

  /** Base de elencos de um conjunto de humanos (estável: depende só dos dados e dos ids). */
  baseFor(humanClubIds: string[]): BaseSquads {
    const humans = new Map<string, Player[]>();
    for (const id of humanClubIds) {
      let p = this.bundles.get(id);
      if (!p) {
        p = loadBundle(this.src, id)?.players ?? [];
        this.bundles.set(id, p);
      }
      humans.set(id, p);
    }
    return careerBase(this.market, humans);
  }

  has(room: string): boolean {
    return this.careers.has(room);
  }

  /** Acesso direto (testes/inline). */
  career(room: string): { world: WorldState; state: SeasonState; base: BaseSquads } | null {
    const c = this.careers.get(room);
    return c ? { world: c.world, state: c.state, base: c.base } : null;
  }

  private get(room: string): Career {
    const c = this.careers.get(room);
    if (!c) throw new CareerMissingError(room);
    return c;
  }

  private meta(c: Career): CareerMeta {
    const sq = careerSquads(c.state, c.wb);
    const humanSquads: Record<string, string[]> = {};
    for (const id of c.state.humanClubIds) humanSquads[id] = sq(id).map((p) => p.id);
    const jobEvents = c.jobs.events;
    c.jobs.events = [];
    return {
      season: c.state.season, date: c.state.date, version: c.version, worldVersion: c.worldVersion,
      over: seasonOver(c.state), humanSquads, divisionIds: Object.keys(c.world.divisions), humans: humanInfo(c.state),
      humanClubIds: c.state.humanClubIds.slice(), jobs: c.jobs, ...(jobEvents.length ? { jobEvents } : {}),
    };
  }

  /** (carreira online) Clubes humanos mudaram (contratação/demissão): base de elencos e mundo novos. */
  private rebase(c: Career): void {
    const ids = c.state.humanClubIds.slice();
    if (ids.join('|') === c.humanClubIds.join('|')) return;
    c.humanClubIds = ids;
    c.world.humanClubIds = ids.slice();
    c.base = this.baseFor(ids);
    c.wb = worldSquads(c.world, c.base);
    c.worldVersion++;
    c.worldDirty = true;
  }

  private jobsCtx(c: Career) {
    return { data: this.data, squads: careerSquads(c.state, c.wb) };
  }

  /** (carreira online) Central de Empregos. */
  jobsOp(req: Extract<SimRequest, { op: 'jobs' }>): JobsResponse {
    const c = this.get(req.room);
    const a = req.action;
    const j = c.jobs;
    const s = c.state;
    let r: { ok: true; message: string; clubId?: string } | { ok: false; error: string };
    switch (a.type) {
      case 'register':
        registerManager(j, s, this.data, a.manager, this.jobsCtx(c));
        r = { ok: true, message: 'ok' };
        break;
      case 'rename':
        renameManager(j, a.managerId, a.name);
        r = { ok: true, message: 'ok' };
        break;
      case 'apply':
        r = applyForVacancy(j, s, a.managerId, a.vacancyId);
        break;
      case 'decline':
        r = declineOffer(j, a.managerId, a.offerId);
        break;
      case 'accept':
        r = acceptOffer(j, c.world, s, this.data, a.managerId, a.offerId, this.jobsCtx(c));
        break;
      case 'release': {
        const club = releaseManager(j, c.world, s, this.data, a.managerId, s.date);
        if (a.remove) removeManager(j, a.managerId);
        r = { ok: true, message: club ? 'released' : 'ok' };
        break;
      }
      case 'admin-offer':
        r = adminOffer(j, s, this.data, a.managerId, a.clubId, this.jobsCtx(c));
        break;
      case 'firing':
        j.firing = a.on;
        r = { ok: true, message: 'ok' };
        break;
    }
    this.rebase(c);
    if (r.ok) c.version++;
    return { meta: this.meta(c), ok: r.ok, ...(r.ok ? { message: r.message, ...(r.clubId ? { clubId: r.clubId } : {}) } : { error: r.error }) };
  }

  /** Serializa e comprime o estado (e o mundo, se mudou ou se `withWorld`). */
  pack(room: string, withWorld = false): PackedSnapshot {
    const c = this.get(room);
    const t0 = performance.now();
    const s = gzipJson(c.state);
    const out: PackedSnapshot = {
      room, version: c.version, worldVersion: c.worldVersion, season: c.state.season, date: c.state.date, stateGz: s.gz,
      stats: { stateJson: s.json, stateGz: s.gz.byteLength, ms: 0 },
    };
    if (withWorld || c.worldDirty) {
      const w = gzipJson(c.world);
      out.worldGz = w.gz;
      out.stats.worldJson = w.json;
      out.stats.worldGz = w.gz.byteLength;
      c.worldDirty = false;
    }
    out.stats.ms = performance.now() - t0;
    return out;
  }

  /** A operação muda o estado (a sala deve receber um snapshot novo depois da resposta)? */
  static changesState(req: SimRequest): boolean {
    return req.op === 'create' || req.op === 'round' || req.op === 'rollover' || req.op === 'skip';
  }

  /**
   * Snapshot a guardar depois da operação: sempre nas que mudam o estado e no hydrate; no mercado só se a ação
   * mudou algo (o snapshot do mercado NÃO vai para os clientes — eles recebem o market:update — mas a sala o guarda
   * para rejoin, disco e reidratação).
   */
  static snapshotAfter(req: SimRequest, res: SimResponse): boolean {
    if (CareerSimulator.changesState(req) || req.op === 'hydrate') return true;
    // (carreira online) ação de emprego que mudou algo: snapshot (clube humano novo, notícias)
    if (req.op === 'jobs') return (res as JobsResponse).ok;
    return req.op === 'market' && (res as MarketResponse).changed;
  }

  /** O executor deve esperar uma mensagem de snapshot (talvez vazia) depois do resultado? */
  static mayPack(req: SimRequest): boolean {
    return CareerSimulator.changesState(req) || req.op === 'hydrate' || req.op === 'market' || req.op === 'jobs';
  }

  run(req: SimRequest, ev: SimEvents = {}): SimResponse {
    switch (req.op) {
      case 'create':
        return this.create(req);
      case 'hydrate':
        return this.hydrate(req);
      case 'set-lineup': {
        const c = this.get(req.room);
        const club = c.state.clubs[req.clubId];
        if (club && c.humanClubIds.includes(req.clubId)) {
          club.tactic = { ...req.setup.tactic };
          club.lineup = req.setup.lineup ? { ...req.setup.lineup, starters: req.setup.lineup.starters.slice(), bench: req.setup.lineup.bench.slice() } : null;
          if (req.setup.presets) club.tacticPresets = req.setup.presets.map((p) => (p ? { ...p } : null));
        }
        return { ok: true };
      }
      case 'round':
        return this.round(req, ev);
      case 'skip':
        return this.skip(req, ev);
      case 'season-end':
        return this.seasonEnd(req);
      case 'rollover':
        return this.rollover(req);
      case 'market':
        return this.marketOp(req);
      case 'jobs':
        return this.jobsOp(req);
      case 'drop':
        this.careers.delete(req.room);
        return { ok: true };
    }
  }

  create(req: Extract<SimRequest, { op: 'create' }>): { meta: CareerMeta } {
    const base = this.baseFor(req.humanClubIds);
    // (Etapa 1) início = o mais cedo entre os clubes humanos (sul-americano 01/01; europeu/saudita 01/07, com o
    // 1º semestre sul-americano simulado na criação — pools para a virada de 30/06)
    const { world, state } = createCareer({
      data: this.data, humanClubIds: req.humanClubIds.slice(), season: req.season, seed: req.seed,
      countryId: req.countryId, options: req.options, squads: base, pools: this.scopePools(),
    });
    const c: Career = {
      room: req.room, humanClubIds: req.humanClubIds.slice(), base, world, state, version: 1, worldVersion: 1,
      wb: worldSquads(world, base), worldDirty: true, jobs: emptyJobs(),
    };
    this.initJobs(c, null, req.managers, req.firing);
    this.careers.set(req.room, c);
    return { meta: this.meta(c) };
  }

  /** (carreira online) Central de Empregos: a salva, ou uma nova com os técnicos da sala. */
  private initJobs(c: Career, saved: OnlineJobs | null | undefined, managers: ManagerSeed[] | undefined, firing: boolean | undefined): void {
    const j = sanitizeJobs(saved) ?? emptyJobs();
    c.jobs = j;
    if (firing !== undefined) j.firing = firing;
    const ctx = this.jobsCtx(c);
    for (const m of managers ?? []) registerManager(j, c.state, this.data, m, ctx);
    seedVacancies(j, c.state, this.data);
    j.events = [];
  }

  hydrate(req: Extract<SimRequest, { op: 'hydrate' }>): { meta: CareerMeta; migrated: boolean } {
    const base = this.baseFor(req.humanClubIds);
    const world0 = gunzipJson<WorldState>(req.worldGz);
    // (Etapa 1) carreira de revisão anterior (ano civil, um país): não migra — a sala vira "legado"
    if (isLegacyCareer(world0)) throw new LegacyCareerError(req.room);
    const m = migrateCareer(world0, gunzipJson<SeasonState>(req.stateGz), { data: this.data, squads: base });
    const state = m.state!;
    for (const [clubId, setup] of Object.entries(req.setups ?? {})) {
      const club = state.clubs[clubId];
      if (!club || !req.humanClubIds.includes(clubId)) continue;
      club.tactic = { ...setup.tactic };
      club.lineup = setup.lineup;
      if (setup.presets) club.tacticPresets = setup.presets;
    }
    const c: Career = {
      room: req.room, humanClubIds: req.humanClubIds.slice(), base, world: m.world, state, version: req.version,
      worldVersion: req.worldVersion, wb: worldSquads(m.world, base), worldDirty: false, jobs: emptyJobs(),
    };
    // (dados) cópias duplicadas aposentadas agora: mundo novo para os clientes
    if (m.dedupMigrated || m.awardsMigrated || m.potCapMigrated) {
      c.worldVersion++;
      c.worldDirty = true;
    }
    this.initJobs(c, req.jobs, req.managers, req.firing);
    this.rebase(c);
    this.careers.set(req.room, c);
    return { meta: this.meta(c), migrated: m.migrated };
  }

  round(req: Extract<SimRequest, { op: 'round' }>, ev: SimEvents): RoundResponse {
    const c = this.get(req.room);
    let s = c.state;
    let wb = c.wb;
    const humans = new Set(s.humanClubIds);
    const live = new Set(req.live);
    const isHuman = (f: Fixture) => humans.has(f.homeId) || humans.has(f.awayId);
    let simMs = 0;
    let maxDayMs = 0;
    let days = 0;
    let games = 0;
    /** (carreira online) um humano foi demitido / mudou de situação: a rodada para no planejamento */
    let jobsStop = false;
    if (req.firing !== undefined) c.jobs.firing = req.firing;
    const step = (results: Record<string, MatchResult>) => {
      const date = s.date;
      const t0 = performance.now();
      const r = advanceDay(s, wb, results, { inPlace: true });
      const ms = performance.now() - t0;
      simMs += ms;
      maxDayMs = Math.max(maxDayMs, ms);
      days++;
      games += r.played.length;
      // (carreira online) diretoria, demissões, vagas e propostas do dia
      const before = s.humanClubIds.join('|');
      jobsDay(c.jobs, c.world, s, r.played, { data: this.data, squads: careerSquads(s, wb) });
      if (s.humanClubIds.join('|') !== before) {
        this.rebase(c);
        wb = c.wb;
        jobsStop = true;
      }
      if (r.played.length) {
        ev.day?.({
          date,
          results: r.played.map(({ fixture, result }) => ({
            fixtureId: fixture.id, competitionId: fixture.competitionId, home: result.homeGoals, away: result.awayGoals, homeId: fixture.homeId, awayId: fixture.awayId,
            ...(result.penalties ? { penalties: { ...result.penalties } } : {}),
          })),
        });
      }
    };
    const done = (reason: StopReason, matches: LiveFixture[] = []): RoundResponse => {
      c.version++;
      return { meta: this.meta(c), reason, days, games, simMs, maxDayMs, matches };
    };

    // 0) fim do planejamento: propostas humano × humano sem resposta são recusadas
    if (!req.results) expireHumanOffers(s, new Set(req.keepOffers ?? []));
    // 1) fecha o dia de jogo: resultados ao vivo + jogos humanos ausentes (simulados) + IA×IA do dia
    if (req.results) step(req.results);
    if (jobsStop) return done('jobs');

    const u = req.until;
    // (carreira online) com técnico desempregado na sala a rodada anda no máximo 7 dias (propostas chegam e vencem
    // em dias; ele precisa ver a tempo)
    const jobless = Object.values(c.jobs.managers).some((m) => !m.clubId);
    const maxDays = jobless && (u.kind === 'match' || u.kind === 'next-match' || u.kind === 'prep') ? Math.min(req.maxDays, 7) : req.maxDays;
    for (let i = 0; i < maxDays; i++) {
      // (Etapa 1) virada regional devida: sem humanos na região ⇒ automática (sem renovações); com ⇒ fim de temporada
      if (turnoverDue(s)) {
        if (!autoTurnoverDue(s)) return done('season-over');
        this.autoTurnover(c);
        s = c.state;
        wb = c.wb;
        continue;
      }
      if (seasonOver(s)) return done('season-over');
      if (u.kind === 'date' && s.date >= u.date) return done('date');
      const today: Fixture[] = [];
      for (const comp of s.competitions) for (const f of comp.fixtures) if (f.date === s.date && !f.result && isHuman(f)) today.push(f);
      if (today.length) {
        if (u.kind === 'match') {
          const liveToday = today.filter((f) => live.has(f.homeId) || live.has(f.awayId));
          if (liveToday.length) {
            const sq = careerSquads(s, wb);
            return done('matchday', liveToday.map((f) => ({ fixture: { ...f }, config: careerMatchConfig(s, f, sq), final: isFinalFixture(s, f) })));
          }
        } else if (u.kind === 'prep') {
          return done('date');
        } else if (u.kind === 'next-match' && i > 0) {
          return done('date');
        }
      }
      step({});
      // (dev: avanço até data/fim de temporada não para)
      if (jobsStop && (u.kind === 'match' || u.kind === 'next-match' || u.kind === 'prep')) return done('jobs');
    }
    return done(seasonOver(s) ? 'season-over' : 'limit');
  }

  /**
   * (17/11) Salto votado (um pedaço): TimeSkip da engine com o assistente em TODOS os humanos (escalação automática,
   * renovações de peças-chave, excedentes). Para no fim de temporada de qualquer humano (a sala faz o fim de temporada
   * normal) ou numa proposta grande por jogador de um humano (`stopClubId`). Sem carreira de técnico no online:
   * demissão/proposta de emprego não existem aqui.
   */
  skip(req: Extract<SimRequest, { op: 'skip' }>, ev: SimEvents): SkipResponse {
    const c = this.get(req.room);
    const worldBefore = c.world;
    const sk = new TimeSkip({
      world: c.world, state: c.state, base: c.base, data: this.data, pools: this.scopePools(), until: req.until,
      stops: { fired: false, jobOffer: false, playerOffer: true, playerOfferPct: req.playerOfferPct ?? 120, seasonEnd: true, none: false },
      onDay: (s, played) => {
        // (carreira online) vagas/propostas seguem durante o salto; sem demissão de humano (o assistente comandou)
        const firing = c.jobs.firing;
        c.jobs.firing = false;
        try {
          jobsDay(c.jobs, c.world, s, played, { data: this.data });
        } finally {
          c.jobs.firing = firing;
        }
        if (!played.length) return;
        ev.day?.({
          date: addIsoDays(s.date, -1),
          results: played.filter(({ fixture: f }) => s.humanClubIds.includes(f.homeId) || s.humanClubIds.includes(f.awayId)).map(({ fixture, result }) => ({
            fixtureId: fixture.id, competitionId: fixture.competitionId, home: result.homeGoals, away: result.awayGoals, homeId: fixture.homeId, awayId: fixture.awayId,
            ...(result.penalties ? { penalties: { ...result.penalties } } : {}),
          })),
        });
      },
    });
    sk.step({ days: Math.max(1, req.days) });
    c.state = sk.state;
    if (sk.world !== worldBefore || sk.turnovers.length) {
      c.world = sk.world;
      c.wb = worldSquads(c.world, c.base);
      c.worldVersion++;
      c.worldDirty = true;
    }
    c.version++;
    const reason = sk.reason === 'cancelled' || sk.reason === 'fired' || sk.reason === 'job' ? 'done' : sk.reason;
    return { meta: this.meta(c), reason, note: sk.note, stopClubId: sk.stopClubId, days: sk.days, games: sk.games };
  }

  seasonEnd(req: Extract<SimRequest, { op: 'season-end' }>): SeasonEndResponse {
    const c = this.get(req.room);
    const s = c.state;
    const data = this.data;
    // prévia EXATA da virada (campeões, acesso/rebaixamento, vagas) — a renovação só mexe nos contratos do humano
    const pools = loadNamePools(this.src, [...new Set([...careerNamePoolCodes(c.world, data, s), ...scopeNamePoolCodes(data)])], this.pools);
    const sm = rolloverSeason(c.world, s, c.base, data, pools, {}).summary;
    const preview: SeasonPreview = {
      season: sm.season, champions: sm.champions, promoted: sm.promoted, relegated: sm.relegated, stateMoves: sm.stateMoves,
      ...(sm.serieD ? { serieD: sm.serieD } : {}), ...(sm.continental ? { continental: sm.continental } : {}),
    };
    const sq = careerSquads(s, c.wb);
    const expiring: Record<string, ExpiringInfo[]> = {};
    for (const clubId of s.humanClubIds) {
      // MESMA reputação que o nextSeason usa na renovação (clubs-index), para o mínimo mostrado ser exato
      const rep = this.renewalReputation(clubId);
      expiring[clubId] = expiringContracts(c.world, s, c.base, clubId).map((p) => {
        const d = renewalDemand(s, sq, clubId, p, undefined, rep);
        return {
          playerId: p.id, name: p.name, position: p.position, age: p.age, overall: p.overall, wage: p.wage,
          demand: { wage: Math.ceil(d.wage), minYears: d.minYears, maxYears: d.maxYears },
        };
      });
    }
    return { meta: this.meta(c), preview, expiring };
  }

  rollover(req: Extract<SimRequest, { op: 'rollover' }>): RolloverResponse {
    const c = this.get(req.room);
    const data = this.data;
    const pools = loadNamePools(this.src, [...new Set([...careerNamePoolCodes(c.world, data, c.state), ...scopeNamePoolCodes(data)])], this.pools);
    // dono de cada jogador dos humanos ANTES da virada (humanReleased da engine mistura todos os humanos)
    const owner = new Map<string, string>();
    const sq = careerSquads(c.state, c.wb);
    for (const h of c.state.humanClubIds) for (const p of sq(h)) owner.set(p.id, h);
    const r = nextSeason(c.world, c.state, c.base, data, pools, { renew: req.renew });
    const releasedByClub: Record<string, string[]> = {};
    for (const h of c.state.humanClubIds) releasedByClub[h] = [];
    for (const pid of r.summary.contracts.humanReleased) {
      const h = owner.get(pid);
      if (h) releasedByClub[h].push(pid);
    }
    c.world = r.world;
    c.state = r.state;
    c.wb = worldSquads(r.world, c.base);
    c.version++;
    c.worldVersion++;
    c.worldDirty = true;
    return { meta: this.meta(c), summary: r.summary, releasedByClub };
  }

  /** (Etapa 1) Pools de nomes de todos os países em escopo (viradas automáticas e criação a partir de 01/07). */
  private scopePools() {
    return loadNamePools(this.src, scopeNamePoolCodes(this.data), this.pools);
  }

  /**
   * (Etapa 1) Virada regional sem humanos na região (ex.: Europa em 30/06 numa sala brasileira): nextSeason sem
   * renovações. O mundo muda (o próximo pack leva o world).
   */
  private autoTurnover(c: Career): SeasonSummary {
    const r = nextSeason(c.world, c.state, c.base, this.data, this.scopePools(), {});
    c.world = r.world;
    c.state = r.state;
    c.wb = worldSquads(r.world, c.base);
    c.worldVersion++;
    c.worldDirty = true;
    return r.summary;
  }

  /** Reputação usada por `rolloverSeason` na renovação dos humanos (clubs-index; padrão 2). */
  renewalReputation(clubId: string): number {
    return this.data.clubs.find((x) => x.id === clubId)?.reputation ?? 2;
  }

  /* ───────────────────────── mercado ───────────────────────── */

  private bundleOf(clubId: string): ClubBundle | null {
    if (!clubId) return null;
    let b = this.fullBundles.get(clubId);
    if (b === undefined) {
      b = loadBundle(this.src, clubId);
      if (this.fullBundles.size > 200) this.fullBundles.clear();
      this.fullBundles.set(clubId, b);
    }
    return b;
  }

  /** Dados do clube vendedor fora da temporada (outro país), como o web monta em resolvePlayer. */
  private sellerInfo(state: SeasonState, clubId: string): ExternalClubInfo | undefined {
    if (!clubId || state.clubs[clubId]) return undefined;
    const b = this.bundleOf(clubId)?.club;
    if (b) return { name: b.name, reputation: b.reputation, division: b.division ?? 1, balance: b.finances.balance, capacity: b.stadium.capacity };
    const e = this.data.clubs.find((x) => x.id === clubId);
    return e ? { name: e.name, reputation: e.reputation ?? 2, division: 1, capacity: e.capacity } : undefined;
  }

  /**
   * Jogador completo pelo id (mesma regra do web `resolvePlayer`): snapshot do mercado ou bundle do clube de
   * origem (traits/lado) com idade/overall/salário evoluídos do elenco efetivo da carreira.
   */
  private resolvePlayer(state: SeasonState, sq: BaseSquads, pid: string): { player: Player; clubId: string } | null {
    const clubId = currentClubOf(state, pid);
    const raw = state.market?.players[pid] ?? this.bundleOf(baseClubOf(pid))?.players.find((p) => p.id === pid);
    const live = clubId ? sq(clubId).find((p) => p.id === pid) : undefined;
    const player = live && raw
      ? { ...raw, age: live.age, overall: live.overall, potential: live.potential, wage: live.wage, value: live.value, youth: live.youth, ...(live.rep0 !== undefined ? { rep0: live.rep0 } : {}) }
      : (raw ?? live);
    return player ? { player, clubId } : null;
  }

  /** Ação de mercado de um clube humano sobre a SeasonState da sala. */
  marketOp(req: Extract<SimRequest, { op: 'market' }>): MarketResponse {
    const c = this.get(req.room);
    const s0 = c.state;
    const clubId = req.clubId;
    const fail = (error: string): MarketResponse => ({ meta: this.meta(c), ok: false, error, changed: false, touched: [] });
    const m = s0.market;
    if (!m) return fail('Mercado não inicializado.');
    if (!s0.humanClubIds.includes(clubId) || !s0.clubs[clubId]) return fail('Clube fora da temporada.');
    const sq = careerSquads(s0, c.wb);
    const a = req.action;
    const findOffer = (id: string) => m.offers.find((o) => o.id === id);
    const isHuman = (id: string) => s0.humanClubIds.includes(id);
    // (Etapa 1) janela da região do clube humano (Etapa 5: a inscrição segue a janela do COMPRADOR)
    const windowOpen = marketWindow(s0, clubId).open;
    const balance = s0.clubs[clubId].balance;
    // (Etapa 4) cheque especial: o limite de crédito do clube
    const credit = Math.max(m.rules.overdraft, s0.clubInfo?.[clubId]?.creditLimit ?? 0);
    const fmt = fmtMoney;

    switch (a.type) {
      case 'offer': {
        const res = this.resolvePlayer(s0, sq, a.playerId);
        if (!res) return fail('Jogador não encontrado.');
        const seller = res.clubId;
        if (seller === clubId) return fail('O jogador já é do seu clube.');
        const fee = a.clause && seller ? releaseClauseOf(s0, res.player, seller) : Math.max(0, Math.round(a.fee));
        if (seller !== FREE && a.kind !== 'precontract') {
          if (!windowOpen) return fail('A janela de transferências está fechada. Fora da janela só é possível contratar jogadores livres e assinar pré-contratos.');
          if (balance - fee < -credit) return fail(`Saldo insuficiente: o caixa é de ${fmt(balance)} e a proposta é de ${fmt(fee)}.`);
        }
        let offerId = a.offerId;
        if (offerId) {
          const o = findOffer(offerId);
          if (!o || o.toClubId !== clubId) return fail('Negociação não encontrada.');
          if (o.playerId !== a.playerId) return fail('A negociação é de outro jogador.');
        }
        // (17/11) sala sem transferências entre técnicos
        if (req.noHumanDeals && seller !== FREE && isHuman(seller)) return fail('Transferências entre técnicos estão desligadas nesta sala.');
        // humano × humano: proposta pendente para o dono (a multa e o pré-contrato não dependem dele)
        if (seller !== FREE && isHuman(seller) && a.kind !== 'precontract') return this.humanOffer(c, clubId, seller, res.player, fee, a.kind === 'loan' ? 'loan' : 'transfer', a.loan, !!a.clause);
        // negociação aberta com o mesmo jogador: continua (o cliente pode não ter mandado o offerId)
        offerId ??= m.offers.find((o) => o.playerId === a.playerId && o.toClubId === clubId && o.status === 'negotiating')?.id;
        const r = makeOffer(s0, sq, { buyerId: clubId, player: res.player, fee, kind: a.kind, offerId, sellerInfo: this.sellerInfo(s0, seller), loan: a.loan, clause: a.clause });
        return this.commit(c, s0, r, [clubId, seller]);
      }
      case 'contract': {
        let base = s0;
        let baseSq = sq;
        let offerId = a.offerId;
        if (!offerId) {
          // jogador livre: abre a negociação e propõe o contrato na mesma ação
          if (!a.playerId) return fail('Informe a negociação (offerId) ou o jogador livre (playerId).');
          const res = this.resolvePlayer(s0, sq, a.playerId);
          if (!res) return fail('Jogador não encontrado.');
          if (res.clubId !== FREE) return fail('O jogador tem clube: primeiro faça a proposta ao clube dele.');
          const open = m.offers.find((o) => o.playerId === a.playerId && o.toClubId === clubId && (o.status === 'agreed' || o.status === 'negotiating'));
          if (open) offerId = open.id;
          else {
            const r0 = makeOffer(s0, sq, { buyerId: clubId, player: res.player, fee: 0 });
            if (r0.error || !r0.offer) return fail(r0.error ?? 'Falha ao abrir a negociação.');
            base = r0.state;
            baseSq = careerSquads(base, c.wb);
            offerId = r0.offer.id;
          }
        }
        const o = base.market!.offers.find((x) => x.id === offerId);
        if (!o || o.toClubId !== clubId) return fail('Negociação não encontrada.');
        if (o.status !== 'agreed') return fail(o.status === 'negotiating' ? 'Ainda não há acordo com o clube vendedor.' : 'Esta negociação já foi encerrada.');
        if (o.fromClubId !== FREE && o.kind !== 'precontract' && !windowOpen) return fail('A janela de transferências está fechada.');
        if (balance - o.fee < -credit) return fail(`Saldo insuficiente: o caixa é de ${fmt(balance)}.`);
        const luva = a.luva !== undefined && (o.kind === 'free' || o.kind === 'precontract') ? a.luva : undefined;
        const r = proposeContract(base, baseSq, { offerId: o.id, wage: a.wage, years: a.years, luva, releaseClause: a.releaseClause, sellerInfo: this.sellerInfo(base, o.fromClubId) });
        // erro numa negociação de livre recém-aberta: descarta a abertura também
        if (r.error && base !== s0) return fail(r.error);
        return this.commit(c, s0, r, [clubId, o.fromClubId]);
      }
      case 'respond': {
        const o = findOffer(a.offerId);
        if (!o || o.fromClubId !== clubId) return fail('Oferta não encontrada.');
        if (o.status !== 'pending') return fail('Oferta não está mais disponível.');
        if (isHuman(o.toClubId)) return this.respondHuman(c, o.id, a.accept);
        const r = respondToOffer(s0, sq, o.id, a.accept);
        return this.commit(c, s0, r, [clubId, o.toClubId]);
      }
      case 'withdraw': {
        const o = findOffer(a.offerId);
        if (!o || o.toClubId !== clubId) return fail('Negociação não encontrada.');
        if (o.status === 'pending' && isHuman(o.fromClubId)) {
          // proposta a outro humano ainda sem resposta
          o.status = 'withdrawn';
          o.updatedOn = s0.date;
          o.log.push({ by: 'buyer', date: s0.date, text: 'Proposta retirada.' });
          return this.commit(c, s0, { state: s0, offer: o }, [clubId], s0.news.length);
        }
        return this.commit(c, s0, withdrawOffer(s0, o.id), [clubId]);
      }
      case 'list': {
        const mine = new Set(sq(clubId).map((p) => p.id));
        const bad = a.playerIds.find((id) => !mine.has(id));
        if (bad) return fail('Só jogadores do seu elenco podem ir para a lista de transferências.');
        const next = a.playerIds.reduce((st, id) => setTransferListed(st, id, a.listed), s0);
        return this.commit(c, s0, { state: next }, [clubId]);
      }
      case 'release': {
        const r = releasePlayer(s0, sq, clubId, a.playerId);
        return this.commit(c, s0, r, [clubId]);
      }
      /* ── (Base) ── */
      case 'promote':
        return this.commit(c, s0, promoteProspect(s0, sq, clubId, a.playerId), [clubId]);
      case 'dismiss':
        return this.commit(c, s0, releaseProspect(s0, clubId, a.playerId), [clubId]);
      case 'train':
        return this.commit(c, s0, setTraining(s0, sq, clubId, a.playerIds), [clubId]);
      case 'finance': {
        const r = a.op === 'ticket' ? setTicketPrice(s0, clubId, a.price)
          : a.op === 'loan' ? takeLoan(s0, clubId, a.blocks)
          : a.op === 'repay' ? repayLoan(s0, clubId, a.blocks)
          : a.op === 'stadium' ? expandStadium(s0, clubId, a.seats)
          : a.op === 'luva' ? payOffLuva(s0, clubId, a.playerId)
          : a.op === 'sponsor' ? (a.accept ? signSponsor(s0, clubId, a.offerId) : declineSponsor(s0, clubId, a.offerId))
          : { state: s0, error: 'Operação inválida.' };
        return this.commit(c, s0, r, [clubId]);
      }
      /* ── (Etapa 5) ── */
      case 'counter': {
        const o = findOffer(a.offerId);
        if (!o || o.fromClubId !== clubId) return fail('Oferta não encontrada.');
        if (o.status !== 'pending') return fail('Oferta não está mais disponível.');
        if (isHuman(o.toClubId)) return fail('Proposta de outro técnico: aceite ou recuse.');
        const r = counterIncoming(s0, sq, o.id, a.fee);
        return this.commit(c, s0, r, [clubId, o.toClubId]);
      }
      case 'loanlist': {
        const mine = new Set(sq(clubId).map((p) => p.id));
        if (a.playerIds.some((id) => !mine.has(id))) return fail('Só jogadores do seu elenco podem ir para a lista de empréstimo.');
        const next = a.playerIds.reduce((st, id) => setLoanListed(st, id, a.listed, a.months), s0);
        return this.commit(c, s0, { state: next }, [clubId]);
      }
      case 'option': {
        const k = m.contracts[a.playerId];
        const r = exercisePurchaseOption(s0, sq, clubId, a.playerId);
        return this.commit(c, s0, r, [clubId, k?.loanFrom ?? '']);
      }
      case 'recall': {
        const holder = currentClubOf(s0, a.playerId);
        const r = recallLoan(s0, sq, clubId, a.playerId);
        return this.commit(c, s0, r, [clubId, holder]);
      }
      case 'renew': {
        const r = renewContract(s0, sq, clubId, a.playerId, a.wage, a.years, a.releaseClause);
        return this.commit(c, s0, r, [clubId]);
      }
      /* ── (Mercado e Orçamentos) ── */
      case 'budget': {
        const r = rebalanceBudgets(s0, sq, clubId, a.toWage);
        return this.commit(c, s0, r, [clubId]);
      }
    }
  }

  /**
   * Proposta por jogador de OUTRO humano: oferta `pending` no clube dele até o fim do planejamento. (Etapa 5) Multa
   * rescisória depositada: o dono não pode recusar — a oferta já nasce `agreed` e o comprador negocia com o jogador.
   */
  private humanOffer(c: Career, buyerId: string, sellerId: string, player: Player, fee: number, kind: 'transfer' | 'loan', loan?: LoanTerms, clause = false): MarketResponse {
    const s = c.state;
    const m = s.market!;
    const sq = careerSquads(s, c.wb);
    const fail = (error: string): MarketResponse => ({ meta: this.meta(c), ok: false, error, changed: false, touched: [] });
    if (m.offers.some((o) => o.playerId === player.id && o.toClubId === buyerId && (o.status === 'pending' || o.status === 'negotiating' || o.status === 'agreed'))) {
      return fail('Você já tem uma proposta por este jogador aguardando resposta.');
    }
    if (sq(buyerId).length >= m.rules.maxSquad) return fail(`O elenco já tem ${m.rules.maxSquad} jogadores (máximo).`);
    // (Mercado e Orçamentos) dono irritado com propostas insistentes e orçamento de transferências do comprador
    const blk = negotiationBlock(s, player.id, buyerId);
    if (blk) return fail(blockMessage(blk.until));
    const be = transferBudgetError(s, buyerId, fee);
    if (be) return fail(be);
    if (clause && sq(sellerId).length - 1 < m.rules.minSquad) return fail(`O ${s.clubInfo?.[sellerId]?.name ?? sellerId} não pode ficar com menos de ${m.rules.minSquad} jogadores.`);
    const name = (id: string) => s.clubInfo?.[id]?.name ?? id;
    const offer: TransferOffer = {
      id: `o${++m.seq}`,
      kind,
      playerId: player.id,
      player: { ...player },
      fromClubId: sellerId,
      fromName: name(sellerId),
      toClubId: buyerId,
      toName: name(buyerId),
      fee,
      round: 1,
      contractRound: 0,
      status: clause ? 'agreed' : 'pending',
      createdOn: s.date,
      updatedOn: s.date,
      // (17/11) modo turnos: a proposta pode esperar a próxima vez do dono (a sala a recusa no fim do planejamento
      // em que ele a viu — expireHumanOffers); a engine não a expira antes disso
      expiresOn: addIsoDays(s.date, 60),
      log: [{ by: 'buyer', fee, date: s.date, text: clause ? 'Multa rescisória depositada.' : HUMAN_OFFER_NOTE }],
      ...(kind === 'loan' ? { loan: { wageShare: 100, ...(loan ?? {}) } } : {}),
      ...(clause ? { clause: true } : {}),
    };
    if (clause) offer.log.push({ by: 'seller', decision: 'accept', fee, date: s.date, text: 'Multa rescisória: venda obrigatória.' });
    m.offers.unshift(offer);
    const newsFrom = s.news.length;
    s.news.push({
      date: s.date,
      text: clause
        ? `Multa paga! O ${offer.toName} depositou a multa de ${fmtMoney(fee)} de ${player.name} e negocia com o jogador.`
        : `Proposta de técnico: o ${offer.toName} oferece ${fmtMoney(fee)} por ${player.name}${kind === 'loan' ? ` (empréstimo, ${offer.loan!.wageShare}% do salário)` : ''}. Responda até o fim do planejamento.`,
      clubId: sellerId,
    });
    const out = this.commit(c, s, { state: s, offer }, [buyerId, sellerId], newsFrom);
    out.pendingHuman = !clause;
    return out;
  }

  /** Dono responde à proposta de outro humano. Aceita: transfere (contrato pelo pedido do jogador; empréstimo mantém o salário). */
  private respondHuman(c: Career, offerId: string, accept: boolean): MarketResponse {
    const s = c.state;
    const m = s.market!;
    const o = m.offers.find((x) => x.id === offerId)!;
    const fail = (error: string): MarketResponse => ({ meta: this.meta(c), ok: false, error, changed: false, touched: [] });
    const touched = [o.fromClubId, o.toClubId];
    const newsFrom = s.news.length;
    if (!accept) {
      o.status = 'rejected';
      o.updatedOn = s.date;
      o.log.push({ by: 'seller', decision: 'reject', date: s.date, text: 'O dono recusou a proposta.' });
      // (Mercado e Orçamentos) a 3ª recusa na janela irrita o dono: 14 dias sem propostas daquele técnico pelo jogador
      noteRejection(s, o);
      return this.commit(c, s, { state: s, offer: o }, touched, newsFrom);
    }
    const sq = careerSquads(s, c.wb);
    const expire = (error: string): MarketResponse => {
      o.status = 'expired';
      o.updatedOn = s.date;
      o.log.push({ by: 'seller', date: s.date, text: error });
      const out = this.commit(c, s, { state: s, offer: o }, touched, newsFrom);
      out.ok = false;
      out.error = error;
      return out;
    };
    if (!marketWindow(s, o.fromClubId).open) return expire('A janela fechou; a proposta expirou.');
    if (currentClubOf(s, o.playerId) !== o.fromClubId) return expire('O jogador já não está no clube.');
    if (sq(o.fromClubId).length - 1 < m.rules.minSquad) return fail(`O elenco não pode ficar com menos de ${m.rules.minSquad} jogadores.`);
    if (sq(o.toClubId).length >= m.rules.maxSquad) return expire(`O elenco do ${o.toName} está cheio.`);
    const buyerBal = s.clubs[o.toClubId]?.balance ?? 0;
    const buyerCredit = Math.max(m.rules.overdraft, s.clubInfo?.[o.toClubId]?.creditLimit ?? 0);
    if (buyerBal - o.fee < -buyerCredit) return expire(`O ${o.toName} não tem mais caixa para a compra.`);
    if (o.kind === 'loan' && transferBudgetError(s, o.toClubId, o.fee)) return expire(`O ${o.toName} não tem mais orçamento de transferências para a operação.`);
    const player = sq(o.fromClubId).find((p) => p.id === o.playerId) ?? o.player;
    o.updatedOn = s.date;
    o.log.push({ by: 'seller', decision: 'accept', fee: o.fee, date: s.date });
    if (o.kind !== 'loan') {
      // (Etapa 5) acordo com o clube: o comprador negocia salário, anos e multa com o jogador ('market:contract')
      o.status = 'agreed';
      o.player = { ...player };
      s.news.push({ date: s.date, text: `O ${o.fromName} aceitou ${fmtMoney(o.fee)} por ${player.name}: negocie o contrato com o jogador.`, clubId: o.toClubId });
      return this.commit(c, s, { state: s, offer: o }, touched, newsFrom);
    }
    // empréstimo: conclui com a % do salário proposta
    o.status = 'completed';
    o.wage = player.wage;
    o.years = 1;
    const record = applyTransfer(s, {
      player, fromClubId: o.fromClubId, toClubId: o.toClubId, fee: o.fee, wage: player.wage, years: 1, kind: 'loan', loan: o.loan,
    });
    return this.commit(c, s, { state: s, offer: o, record }, touched, newsFrom);
  }

  /**
   * Fecha uma ação: adota o estado novo (as funções da engine devolvem cópias; as ações humano × humano mutam no
   * lugar e passam `mutated`), sobe a versão e monta o patch (market + clubes envolvidos + notícias novas).
   */
  private commit(c: Career, s0: SeasonState, r: MarketResult, involved: string[], mutatedNewsFrom?: number): MarketResponse {
    const mutated = mutatedNewsFrom !== undefined;
    const changed = mutated || r.state !== s0;
    const base = { offer: r.offer, club: r.club, contract: r.contract, record: r.record };
    if (!changed) return { meta: this.meta(c), ok: !r.error, error: r.error, changed: false, touched: [], ...base };
    // as funções da engine só acrescentam notícias (cópia nova); nas mutações no lugar o chamador marcou o início
    const newsFrom = mutated ? mutatedNewsFrom : s0.news.length;
    c.state = r.state;
    c.version++;
    const s = c.state;
    const ids = new Set<string>([...s.humanClubIds, ...involved]);
    if (r.record) ids.add(r.record.fromClubId).add(r.record.toClubId);
    const clubs: Record<string, unknown> = {};
    for (const id of ids) if (id && s.clubs[id]) clubs[id] = s.clubs[id];
    const p = gzipJson({ market: s.market, clubs, news: { from: newsFrom, items: s.news.slice(newsFrom) } });
    const touched = r.record ? [r.record.fromClubId, r.record.toClubId].filter((id) => s.humanClubIds.includes(id)) : [];
    return {
      meta: this.meta(c), ok: !r.error, error: r.error, changed: true, touched, ...base,
      patch: { version: c.version, date: s.date, gz: p.gz, json: p.json },
    };
  }
}

/** Fim do planejamento: propostas humano × humano ainda pendentes viram recusadas. */
export function expireHumanOffers(s: SeasonState, keep: Set<string> = new Set()): number {
  const m = s.market;
  if (!m) return 0;
  let n = 0;
  for (const o of m.offers) {
    if (o.status !== 'pending' || !s.humanClubIds.includes(o.toClubId) || keep.has(o.id)) continue;
    o.status = 'rejected';
    o.updatedOn = s.date;
    o.log.push({ by: 'seller', decision: 'reject', date: s.date, text: 'Sem resposta até o fim do planejamento.' });
    n++;
  }
  return n;
}

function addIsoDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** (17/11) Liga dos Amigos: posição na liga, títulos da temporada e mata-matas vencidos de cada humano. */
export function humanInfo(s: SeasonState): Record<string, HumanClubInfo> {
  const out: Record<string, HumanClubInfo> = {};
  for (const id of s.humanClubIds) {
    let league: HumanClubInfo['league'] = null;
    const titles: HumanClubInfo['titles'] = [];
    let koWins = 0;
    for (const comp of s.competitions) {
      if (!comp.clubIds.includes(id)) continue;
      if (comp.type === 'league' && (!league || (comp.division ?? 9) < league.division)) {
        try {
          const rows = computeStandings(comp);
          const pos = rows.findIndex((r) => r.clubId === id);
          // (sem jogos ainda, a posição é só a ordem alfabética/semente: não conta)
          const played = comp.fixtures.some((f) => f.result && (f.homeId === id || f.awayId === id));
          if (pos >= 0 && played) league = { id: comp.id, name: comp.name, pos: pos + 1, size: rows.length, division: comp.division ?? 1 };
        } catch {
          /* formato sem tabela simples */
        }
      }
      if (comp.finished && comp.championId === id) titles.push({ id: comp.id, name: comp.name, type: comp.type, division: comp.division, season: comp.cycleSeason ?? s.season });
      for (const f of comp.fixtures) {
        // jogo decisivo do mata-mata: agregado das pernas (mesmo tieId) e, empatado, os pênaltis
        if (!f.result || !f.knockout || (f.homeId !== id && f.awayId !== id)) continue;
        const legs = f.tieId ? comp.fixtures.filter((x) => x.tieId === f.tieId && x.result) : [f];
        let mine = 0;
        let theirs = 0;
        for (const x of legs) {
          const r = x.result!;
          mine += x.homeId === id ? r.home : r.away;
          theirs += x.homeId === id ? r.away : r.home;
        }
        const pens = f.result.penalties;
        if (mine === theirs && pens) {
          mine += f.homeId === id ? pens.home : pens.away;
          theirs += f.homeId === id ? pens.away : pens.home;
        }
        if (mine > theirs) koWins++;
      }
    }
    out[id] = { balance: s.clubs[id]?.balance ?? 0, league, titles, koWins };
  }
  return out;
}

function fmtMoney(v: number): string {
  return fmtMoneyShort(v); // "$ 1,05 bi", "$ 120 mi", "$ 850 mil"
}

/** (Etapa 1) Snapshot de carreira de revisão anterior (rev < 3): não é reidratado; a sala fica como legado. */
export class LegacyCareerError extends Error {
  constructor(room: string) {
    super(`career-legacy:${room}`);
  }
}

export class CareerMissingError extends Error {
  constructor(room: string) {
    super(`career-missing:${room}`);
  }
}
