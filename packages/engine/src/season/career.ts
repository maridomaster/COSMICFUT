/**
 * Carreira: WorldState persistente + montagem dos TRECHOS da linha do tempo global (Etapa 1) — ponto de entrada da UI.
 *
 *   const { world, state } = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'x', squads: base });
 *   const squads = careerSquads(state, worldSquads(world, base));   // elencos efetivos (UI e advanceDay)
 *   ... advanceDay(state, worldSquads(world, base)) até turnoverDue(state) ...
 *   const next = nextSeason(world, state, base, data, namePools);  // virada regional → { world, state, summary }
 *
 * (Etapa 1) Não há mais "país do humano" para montar a temporada: TODAS as ligas em escopo rodam em paralelo
 * (Europa, Arábia e América do Sul), com o Brasil completo (estaduais, Copa do Brasil, continentais). Cada SeasonState
 * cobre um trecho entre duas viradas (01/01–30/06 ou 01/07–31/12, ver timeline.ts); as competições do outro ciclo
 * atravessam a virada. Clube humano sul-americano começa em 01/01; europeu/saudita em 01/07 (o 1º semestre
 * sul-americano é simulado rapidamente, sem humanos, na criação).
 *
 * Puro e determinístico (seed + entradas).
 */
import type { NamePool, PickRule, Player, PlayersMarket } from '@cosmicfut/shared';
import type {
  CareerData, CareerOptions, ClubEconomyInfo, ClubSeasonState, Competition, CompetitionType, EconTables, FinanceLedger,
  Honors, MarketState, SeasonState, WorldState,
} from '../contract';
import { DEFAULT_TACTIC } from '../tactics';
import { baseClubOf, createMarket, marketSquads, MARKET, type Squads } from '../transfers/market';
import { careerValue, rep0Of } from '../transfers/value';
import { carryBudgets, ensureBudgets } from '../transfers/budget';
import { resolveConflicts } from './calendar';
import {
  brazilCupFormat, CUP_STYLES, genericCupFormat, nationalCupFormat, nationalFormat, relegationPlayoffFormat, stateFormat, supercup4Format, supercupFormat,
  type LeagueDivision, type StateDivision,
} from './competitions';
import { initCompetition } from './format';
import { EVOLUTION, MIN_PLAYER_AGE, realisticPotential, revalue, rollTraits, YOUTH } from './players';
import { continentalCompetitions, continentalCountryOf, continentalPots, qualifiedFrom, qualifyContinental, strengthSort } from './continental';
import { afcCompetitions, guestRegion, initialTitleHolders, qualifyAfc, qualifyUefa, uefaCompetitions, worldCompetitions } from './confed';
import type { CountryHolders } from '../contract';
import { addDays } from './schedule';
import { createCoachCareer, type CreateCoachOptions } from './coach';
import {
  cycleCalendar, cycleOfCompetition, cycleOfRegion, regionOfCode, regionsOfCycle, SCOPE_CODES, SCOPE_REGIONS, seasonLabel,
  segmentFrom, turnoverAffectsHumans, turnoverDue, windowFor, primaryRegion, type Cycle, type Region,
} from './timeline';
import { advanceDay } from './season';
import { rolloverSeason } from './rollover';
import { applyEconomyProfiles, ledgerDiff, pushMonth } from './econ';
import { emptyRecords } from './records';
import { migrateDiscipline } from './discipline';
import { Rng } from '../rng';
import { retireDuplicatePlayers } from './dedupe';
import { awardCycleOf, awardWindow, computeSeasonAwards, leagueLevel } from './awards';

export const DEFAULT_CAREER_OPTIONS: CareerOptions = {
  playStateLeagues: true,
  prizeMode: 'champion',
  light: 'minor',
  nationalCup: true,
  supercup: true,
  humanAutoRenew: false,
  continental: true,
  intercontinental: true,
  supermundial: 'every4',
  regionalCups: true,
};

/**
 * Revisão atual do save (WorldState.rev). 3 = Etapa 1 (linha do tempo global, calendário duplo, escopo geográfico).
 * Saves de revisões anteriores NÃO migram (`isLegacyCareer`): a UI mostra "legado — iniciar nova carreira".
 */
export const CAREER_REV = 3;

const BRAZIL = 29;
const PRIZE_BY_DIV: Record<number, string> = { 1: 'LIGA_A', 2: 'LIGA_B', 3: 'LIGA_C', 4: 'LIGA_D' };
const SERIE_NAMES: Record<number, string> = { 1: 'Série A', 2: 'Série B', 3: 'Série C', 4: 'Série D' };
const NEWS_KEEP = 200;

/** Ordem geográfica das UFs (N, NE, CO, SE, S) — agrupamento regional da Série D. */
export const UF_ORDER = ['AC', 'AM', 'RR', 'RO', 'AP', 'PA', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA', 'MT', 'MS', 'GO', 'DF', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS'];

/* ═════════════════════ helpers de dados ═════════════════════ */

export function countryDivisions(data: CareerData, countryId: number): LeagueDivision[] {
  return (data.leagues as LeagueDivision[])
    .filter((d) => d.countryId === countryId && !d.fictional && d.clubIds.length >= 2)
    .sort((a, b) => a.division - b.division);
}

function codeMap(data: CareerData): Map<number, string | null> {
  return new Map(data.countries.map((c) => [c.id, c.code]));
}

/** Região de um clube pelos dados (país → sigla → região). */
export function regionOfDataClub(data: CareerData, clubId: string, codes = codeMap(data)): Region | null {
  const c = data.clubs.find((x) => x.id === clubId);
  return c ? regionOfCode(codes.get(c.countryId) ?? null) : null;
}

/**
 * (Etapa 1) Data de início da carreira: a MAIS CEDO entre os clubes humanos — sul-americano 01/01, europeu/saudita
 * 01/07 (pré-temporada). Sem humanos ⇒ 01/01.
 */
export function careerStartDate(data: CareerData, humanClubIds: string[], season: number): string {
  const codes = codeMap(data);
  const starts = humanClubIds.map((id) => (cycleOfRegion(regionOfDataClub(data, id, codes)) === 'split' ? `${season}-07-01` : `${season}-01-01`));
  return starts.length ? starts.sort()[0] : `${season}-01-01`;
}

function strengthOrder(data: CareerData): Map<string, number> {
  const sorted = data.clubs.slice().sort((a, b) => b.level - a.level || (b.reputation ?? 0) - (a.reputation ?? 0) || a.id.localeCompare(b.id));
  return new Map(sorted.map((c, i) => [c.id, i]));
}

/** Divisão nacional (número) de cada clube no mundo atual. */
export function nationalDivisionOf(world: WorldState): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, clubs] of Object.entries(world.divisions)) {
    const div = Number(/-(\d+)$/.exec(id)?.[1] ?? 0);
    for (const c of clubs) m.set(c, div);
  }
  return m;
}

/** (Etapa 4) Tabelas reais da economia (economy.json v2); ausentes em dados antigos ⇒ undefined (economia legada). */
export function econTables(data: CareerData): EconTables | undefined {
  const e = data.economy;
  if (!e?.tv || !e.competitionPrizes || !e.merit) return undefined;
  return {
    version: e.version, currency: e.currency, tv: e.tv, merit: e.merit, competitionPrizes: e.competitionPrizes,
    wageRatio: e.wageRatio ?? { default: { target: 0.5, cap: 0.6 } }, matchday: e.matchday ?? { default: 0.12 }, ownerBacked: e.ownerBacked ?? [],
  };
}

/** (Etapa 4) Contexto dos perfis econômicos: divisões atuais e dos dados, país, convidados e clubes só estaduais. */
function economyContext(world: WorldState, data: CareerData, clubMeta: Map<string, CareerData['clubs'][number]>, codes: Map<number, string | null>, divOf: Map<string, number>) {
  const dataDivisions: Record<string, string[]> = {};
  for (const d of data.leagues as LeagueDivision[]) if (!d.fictional && d.clubIds.length >= 2) dataDivisions[d.id] = d.clubIds;
  return {
    divisions: world.divisions,
    dataDivisions,
    codeOf: (id: string) => { const m = clubMeta.get(id); return m ? codes.get(m.countryId) ?? null : null; },
    guest: (id: string) => !!clubMeta.get(id)?.guest,
    stateOnly: (id: string) => clubMeta.get(id)?.countryId === BRAZIL && !divOf.has(id),
  };
}

/**
 * (Etapa 4) Clube humano na virada: o histórico de bilheteria continua; o mês que fechou entra no demonstrativo; o
 * mês novo começa do livro-caixa novo (ou do mesmo, se a região do clube não virou).
 */
function carryMonthly(c: ClubSeasonState, prev: ClubSeasonState, startDate: string, keepLedger: boolean): void {
  if (prev.gates?.length) c.gates = prev.gates.map((g) => ({ ...g }));
  c.months = (prev.months ?? []).map((m) => ({ ...m, flow: { ...m.flow } }));
  const month = startDate.slice(0, 7);
  if (prev.monthStart && prev.monthStart.month !== month && prev.finance) {
    pushMonth(c, { month: prev.monthStart.month, flow: ledgerDiff(prev.finance, prev.monthStart.ledger), balance: prev.balance });
  }
  c.monthStart = { month, ledger: keepLedger && c.finance ? { ...c.finance } : emptyLedger() };
}

/**
 * (escala real) Patrocínio, receita e folha inicial do clube para `ClubEconomyInfo`: das finanças do clube nos dados
 * (clubs-index.json → finances); sem elas (dados antigos), o patrocínio da divisão do original e sem receita (economia
 * legada por divisão).
 */
export function economyFromData(
  meta: CareerData['clubs'][number] | undefined, div: number | undefined, data: CareerData,
): Pick<ClubEconomyInfo, 'sponsorPerSeason' | 'revenue' | 'wageBill'> {
  const f = meta?.finances;
  const sponsorPerSeason = f?.sponsorPerSeason ?? data.economy.sponsorByDivision[String(div ?? 'default')] ?? data.economy.sponsorByDivision.default;
  return {
    sponsorPerSeason,
    ...(f?.revenue ? { revenue: f.revenue } : {}),
    ...(f?.revenue && f.wageBill !== undefined ? { wageBill: f.wageBill } : {}),
  };
}

/* ═════════════════════ WorldState inicial ═════════════════════ */

export interface CreateCareerOptions {
  data: CareerData;
  humanClubIds: string[];
  /** ano de início (temporada 2026 = ano civil 2026 / temporada europeia 2026/27) */
  season: number;
  seed: string;
  /** país "da carreira" (técnico, pools de nomes; padrão: o do 1º clube humano) */
  countryId?: number;
  options?: Partial<CareerOptions>;
  /** elencos base (dados) — recomendado: cria o mercado já com a dispensa de excedentes */
  squads?: Squads;
  /** (Fase 3) técnico humano (com `options.coachCareer`) */
  coach?: CreateCoachOptions;
  /** (Etapa 1) data de início (padrão: `careerStartDate` dos humanos — 01/01 ou 01/07) */
  startDate?: string;
  /** (Etapa 1) pools de nomes para a virada do 1º semestre (início em 01/07); sem eles, juniores com nome genérico */
  pools?: NamePools;
}

export function createWorld(o: CreateCareerOptions): WorldState {
  const { data } = o;
  const codes = codeMap(data);
  const human = data.clubs.find((c) => c.id === o.humanClubIds[0]);
  const countryId = o.countryId ?? human?.countryId ?? BRAZIL;
  const code = codes.get(countryId) ?? String(countryId);
  // (Etapa 1) divisões de TODOS os países em escopo
  const divisions: Record<string, string[]> = {};
  for (const d of data.leagues as LeagueDivision[]) {
    if (d.fictional || d.clubIds.length < 2 || !regionOfCode(codes.get(d.countryId) ?? null)) continue;
    divisions[d.id] = d.clubIds.slice();
  }
  const stateDivisions: Record<string, string[]> = {};
  const stateRanking: Record<string, string[]> = {};
  const order = strengthOrder(data);
  for (const s of data.states) {
    const used = new Set<string>();
    for (const d of s.divisions) {
      stateDivisions[`${s.state}-${d.division}`] = d.clubIds.slice();
      d.clubIds.forEach((c) => used.add(c));
    }
    const rest = data.clubs.filter((c) => c.state === s.state && c.countryId === BRAZIL && !used.has(c.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((c) => c.id);
    stateRanking[s.state] = [...s.divisions.flatMap((d) => d.clubIds), ...rest];
  }
  // (13/11) clube humano fora de qualquer divisão (ex.: Real-RR, só no ranking estadual) passaria o ano sem jogos:
  // entra na divisão estadual mais baixa da sua UF
  const inNational = new Set(Object.values(divisions).flat());
  const inState = new Set(Object.values(stateDivisions).flat());
  for (const id of o.humanClubIds) {
    const meta = data.clubs.find((c) => c.id === id);
    if (!meta?.state || meta.countryId !== BRAZIL || inNational.has(id) || inState.has(id)) continue;
    const keys = Object.keys(stateDivisions).filter((k) => k.startsWith(`${meta.state}-`))
      .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
    const key = keys[keys.length - 1];
    if (key) stateDivisions[key].push(id);
  }
  const lastRanking: Record<string, string[]> = {};
  for (const [id, clubs] of Object.entries(divisions)) lastRanking[id] = clubs.slice();
  const divOf = new Map<string, number>();
  for (const [id, clubs] of Object.entries(divisions)) for (const c of clubs) divOf.set(c, Number(/-(\d+)$/.exec(id)?.[1]));
  const balances: Record<string, number> = {};
  for (const c of data.clubs) {
    if (!regionOfCode(codes.get(c.countryId) ?? null) && !o.humanClubIds.includes(c.id)) continue;
    const div = divOf.get(c.id);
    // (escala real) caixa do clube nos dados; sem ele (dados antigos), a tabela por divisão do original
    balances[c.id] = c.finances?.balance ?? data.economy.initialMoneyByDivision[String(div ?? 'default')] ?? data.economy.initialMoneyByDivision.default ?? 0;
  }
  const options: CareerOptions = { ...DEFAULT_CAREER_OPTIONS, ...(o.options ?? {}) };
  // (Fase 2) 1º ano: campeões da temporada anterior (resultados reais de 2025, competitions.json → continental.initial)
  const initial = data.competitions.continental?.initial;
  const useInitial = !!initial && initial.season === o.season - 1;
  const cupHolder = useInitial ? initial!.cup?.BRA ?? null : null;
  const leagueHolder = useInitial ? initial!.league?.BRA ?? null : null;
  const world: WorldState = {
    version: 1,
    rev: CAREER_REV,
    season: o.season,
    startSeason: o.season,
    countryId,
    countryCode: code,
    seed: o.seed,
    humanClubIds: o.humanClubIds.slice(),
    options,
    divisions,
    stateDivisions,
    stateRanking,
    lastRanking,
    cupHolder: cupHolder && divOf.has(cupHolder) ? cupHolder : null,
    cupVice: null,
    leagueHolder: leagueHolder && divOf.has(leagueHolder) ? leagueHolder : null,
    history: [],
    balances,
    ledgers: {},
    players: { delta: {}, club: {}, data: {}, retired: {}, contractEnd: {}, freeSince: {}, seq: 0, loans: {} },
    finance: {},
    agedYears: 0,
    startDate: o.startDate ?? careerStartDate(data, o.humanClubIds, o.season),
    holders: {},
    records: emptyRecords(),
  };
  world.holders!.BRA = { league: world.leagueHolder ?? null, cup: world.cupHolder ?? null, cupVice: null };
  // (Etapa 2) demais países: campeões da temporada anterior (não simulada) pela força — supercopas do 1º ano e vagas
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  for (const d of data.leagues as LeagueDivision[]) {
    const code = codes.get(d.countryId);
    if (!code || code === 'BRA' || d.division !== 1 || !divisions[d.id] || world.holders![code]) continue;
    const s = strengthSort(divisions[d.id], meta);
    world.holders![code] = { league: s[0] ?? null, leagueVice: s[1] ?? null, cup: s[2] ?? null, cupVice: s[3] ?? null, leagueTitle: s[1] ?? null, leagueCup: code === 'ING' ? s[4] ?? null : null };
  }
  if (options.continental !== false) {
    world.titleHolders = initialTitleHolders(data, o.seed, o.season);
    // (Etapa 2) vagas UEFA e AFC da 1ª temporada europeia/saudita (2026/27): força + convidados
    if (Object.keys(divisions).some((id) => /^(ING|ESP|ITA|ALE|FRA|POR|HOL)-1$/.test(id))) world.uefa = qualifyUefa(data, world, o.season);
    if (divisions['ARS-1']) world.afc = qualifyAfc(data, world, o.season);
  }
  if (divisions['BRA-1'] && options.continental !== false) {
    // 1º ano sem histórico: ordem por força (nível/reputação) em cada país + campeões reais de 2025
    world.continental = qualifyContinental(data, o.season, {
      cupHolder: world.cupHolder,
      holders: useInitial ? { LIBERTADORES: initial!.LIBERTADORES ?? null, SULAMERICANA: initial!.SULAMERICANA ?? null } : undefined,
    });
  }
  return world;
}

/**
 * (Etapa 2) Participantes de uma supercopa a partir dos campeões do país: 2 clubes = campeão da liga × campeão da
 * copa (Colômbia: × campeão do Apertura; repasse ao vice da copa/da liga); 4 clubes = [campeão da liga, vice da copa,
 * campeão da copa, vice da liga] (semis cruzadas). Vagas repetidas ou vazias descem na tabela (`ranking`).
 */
export function supercupEntrants(h: CountryHolders, ranking: string[], teams: number, valid: (id: string) => boolean, apertura = false): string[] {
  const slots = teams === 4
    ? [h.league, h.cupVice, h.cup, h.leagueVice ?? null]
    : [h.league, apertura ? h.leagueTitle ?? null : h.cup];
  const res: (string | null)[] = slots.map((x) => x ?? null);
  const seen = new Set<string>();
  res.forEach((c, i) => { if (!c || seen.has(c) || !valid(c)) res[i] = null; else seen.add(c); });
  if (teams === 2 && !res[1]) {
    for (const alt of [h.cup, h.cupVice, h.leagueVice]) if (alt && !seen.has(alt) && valid(alt)) { res[1] = alt; seen.add(alt); break; }
  }
  let r = 0;
  for (let i = 0; i < res.length; i++) {
    if (res[i]) continue;
    while (r < ranking.length && (seen.has(ranking[r]) || !valid(ranking[r]))) r++;
    if (r < ranking.length) { res[i] = ranking[r]; seen.add(ranking[r]); }
  }
  return res.filter((x): x is string => !!x);
}

/** (Etapa 1) Save de uma revisão anterior à linha do tempo global (não migra: "legado — iniciar nova carreira"). */
export function isLegacyCareer(world: Pick<WorldState, 'rev'> | null | undefined): boolean {
  return !world || (world.rev ?? 1) < CAREER_REV;
}

/**
 * Normalização idempotente de um save da revisão ATUAL (opções novas com os padrões, `finance`, ledgers, técnico).
 * (Etapa 1) Saves de revisões anteriores (rev < 3, calendário de ano civil centrado num país) NÃO são migrados:
 * voltam intactos com `legacy: true` — a UI/servidor devem tratá-los como "legado — iniciar nova carreira".
 */
export function migrateCareer(
  world: WorldState, state?: SeasonState, opts: MigrateCareerOptions = {},
): { world: WorldState; state?: SeasonState; migrated: boolean; coachCreated?: boolean; legacy?: boolean; econMigrated?: boolean; marketMigrated?: boolean; recordsMigrated?: boolean; budgetsMigrated?: boolean; dedupMigrated?: number; awardsMigrated?: boolean; potCapMigrated?: number } {
  if (isLegacyCareer(world)) return { world, state, migrated: false, legacy: true };
  const w = JSON.parse(JSON.stringify(world)) as WorldState;
  const s = state ? (JSON.parse(JSON.stringify(state)) as SeasonState) : undefined;
  w.options = { ...DEFAULT_CAREER_OPTIONS, ...(w.options ?? {}) };
  w.finance ??= {};
  w.rev = CAREER_REV;
  if (s) {
    for (const c of Object.values(s.clubs)) c.finance ??= emptyLedger();
    // (Atualização 38) suspensões/amarelos por competição (mapas antigos por jogador → por competição)
    migrateDiscipline(s);
  }
  // (Registros) saves anteriores: carreiras dos jogadores começam vazias (o histórico de campeões continua; as
  // competições em andamento já guardam artilharia; assistências e linhas contam a partir de agora)
  let recordsMigrated = false;
  if (!w.records) { w.records = emptyRecords(); recordsMigrated = true; }
  if (s?.career && !s.career.lines) s.career.lines = {};
  // (19/11) ícones: saves com Bola de Ouro já entregue ganham o ícone do último vencedor (até a próxima premiação)
  const lastAward = w.awards?.at(-1);
  if (!w.honors && lastAward?.ballonDor[0]) {
    const g = lastAward.ballonDor[0];
    w.honors = { world: { kind: 'world', playerId: g.playerId, name: g.name, clubId: g.clubId, label: lastAward.label } };
  }
  if (s?.career && w.honors && !s.career.honors) s.career.honors = JSON.parse(JSON.stringify(w.honors)) as Honors;
  // (Etapa 4) saves das Etapas 1–3: perfil econômico (TV, custos, teto da folha) e tabelas de prêmios no trecho em
  // andamento; a Moral da Torcida começa em 60 (ausente = 60). Sem `data`, o trecho segue com a economia antiga até
  // a próxima virada (que já cria o trecho com a economia nova).
  let econMigrated = false;
  if (s?.career && !s.career.econ && opts.data) {
    const econ = econTables(opts.data);
    if (econ && s.clubInfo) {
      const clubMeta = new Map(opts.data.clubs.map((c) => [c.id, c]));
      const info: Record<string, ClubEconomyInfo> = {};
      for (const [id, i] of Object.entries(s.clubInfo)) {
        const meta = clubMeta.get(id);
        // folha de referência: a maior entre a do save e a dos dados atuais (a Etapa 4 recalibrou as folhas para cima)
        const W = Math.max(i.wageBill ?? 0, meta?.finances?.wageBill ?? 0);
        info[id] = {
          ...i, ...(i.revenue ? {} : economyFromData(meta, i.division, opts.data)), ...(W > 0 && (i.revenue || meta?.finances?.revenue) ? { wageBill: W } : {}),
          ...(meta?.countryId === BRAZIL && meta.state ? { uf: meta.state } : {}),
        };
      }
      applyEconomyProfiles(econ, info, economyContext(w, opts.data, clubMeta, codeMap(opts.data), nationalDivisionOf(w)));
      s.clubInfo = info;
      s.career.econ = econ;
      econMigrated = true;
    }
  }
  // (Etapa 5) saves das Etapas 1–4: a liga dos DADOS de cada clube (fator de reputação dos valores). Os demais campos
  // novos do mercado têm padrão calculado e não precisam de migração: contratos (fim padrão determinístico), multas
  // rescisórias (defaultReleaseClause), `rep0` (worldSquads, a partir dos dados base), pré-contratos/listas (vazios).
  let marketMigrated = false;
  if (s?.clubInfo && opts.data && Object.values(s.clubInfo).some((i) => !i.dataLeague && (i.revenue || i.leagueKey))) {
    const dataDiv = new Map<string, string>();
    for (const d of opts.data.leagues as LeagueDivision[]) if (!d.fictional && d.clubIds.length >= 2) for (const c of d.clubIds) dataDiv.set(c, d.id);
    const meta = new Map(opts.data.clubs.map((c) => [c.id, c]));
    for (const [id, i] of Object.entries(s.clubInfo)) {
      if (i.dataLeague) continue;
      const dl = i.guest ? 'guest' : dataDiv.get(id) ?? (meta.get(id)?.countryId === BRAZIL ? 'BRA-state' : undefined);
      if (dl) i.dataLeague = dl;
    }
    marketMigrated = true;
  }
  // (Mercado e Orçamentos) saves anteriores: orçamentos de transferências e salarial definidos agora pela diretoria
  // (caixa e receita atuais; o salarial = teto da folha). As recusas de propostas começam vazias (campo opcional).
  // (dados) saves anteriores: o mesmo jogador em dois clubes da base — sai a cópia que não foi mexida (dedupe.ts)
  let dedupMigrated = 0;
  if (opts.squads && opts.data) dedupMigrated = retireDuplicatePlayers(w, s, opts.data.clubs.map((c) => c.id), opts.squads);
  // (19/11) 1ª Bola de Ouro dos saves antigos: a janela deixava de fora o 2º semestre europeu (só sul-americanos
  // disputavam). Refaz o pódio e a Seleção do Mundo das premiações afetadas; o ícone vai para o novo vencedor.
  let awardsMigrated = false;
  if (opts.squads && opts.data && s && (w.awardsRev ?? 0) < 1) {
    if (w.awards?.length) awardsMigrated = recomputeFirstAwards(w, s, opts.data.clubs.map((c) => c.id), careerSquads(s, worldSquads(w, opts.squads as Squads)));
    w.awardsRev = 1;
  }
  // (25/11) potencial é o teto: quem passou do potencial ORIGINAL dos dados (bugs de evolução antes de 25/11) volta a ele
  let potCapMigrated = 0;
  if (opts.squads && opts.data && (w.potCapRev ?? 0) < 1) {
    potCapMigrated = capToDataPotential(w, s, opts.data.clubs.map((c) => c.id), opts.squads as Squads);
    w.potCapRev = 1;
  }
  let budgetsMigrated = false;
  if (s?.career && ensureBudgets(s) > 0) budgetsMigrated = true;
  // (Fase 3) carreira do técnico: criada a partir do clube atual (opcional; o servidor online não pede)
  let coachCreated = false;
  if (opts.coachCareer && opts.data && s && !w.coach) {
    w.options.coachCareer = true;
    w.coach = createCoachCareer(w, s, opts.data, opts.coach);
    coachCreated = true;
  }
  return {
    world: w, state: s, migrated: false, ...(coachCreated ? { coachCreated } : {}), ...(econMigrated ? { econMigrated } : {}), ...(marketMigrated ? { marketMigrated } : {}),
    ...(recordsMigrated ? { recordsMigrated } : {}), ...(budgetsMigrated ? { budgetsMigrated } : {}), ...(dedupMigrated ? { dedupMigrated } : {}),
    ...(awardsMigrated ? { awardsMigrated } : {}), ...(potCapMigrated ? { potCapMigrated } : {}),
  };
}

/**
 * (25/11) Teto do potencial nos saves: overall e potencial de cada jogador dos DADOS limitados ao potencial original
 * (a virada gravava o potencial já "puxado" pelo overall). Juniores gerados e revelados da base não têm referência e
 * ficam como estão. MUTA `w` e `s`. Devolve quantos jogadores mudaram.
 */
export function capToDataPotential(w: WorldState, s: SeasonState | undefined, clubIds: string[], base: Squads): number {
  const cap = new Map<string, number>();
  for (const id of clubIds) for (const p of base(id)) if (!cap.has(p.id)) cap.set(p.id, p.potential);
  const changed = new Set<string>();
  const fix = (pid: string, ovr: number, pot: number): [number, number] | null => {
    const c = cap.get(pid);
    if (c === undefined || (ovr <= c && pot <= c)) return null;
    changed.add(pid);
    return [Math.min(ovr, c), Math.min(pot, c)];
  };
  const wp = w.players;
  for (const [pid, d] of Object.entries(wp.delta)) { const f = fix(pid, d[1], d[2]); if (f) { d[1] = f[0]; d[2] = f[1]; } }
  for (const [pid, p] of Object.entries(wp.data)) { const f = fix(pid, p.overall, p.potential); if (f) wp.data[pid] = { ...p, overall: f[0], potential: f[1] }; }
  const mp = s?.market?.players;
  if (mp) for (const [pid, p] of Object.entries(mp)) { const f = fix(pid, p.overall, p.potential); if (f) mp[pid] = { ...p, overall: f[0], potential: f[1] }; }
  const c = s?.career;
  if (c) {
    for (const [pid, v] of Object.entries(c.evo ?? {})) { const k = cap.get(pid); if (k !== undefined && v > k) { c.evo[pid] = k; changed.add(pid); } }
    for (const [pid, v] of Object.entries(c.potNow ?? {})) { const k = cap.get(pid); if (k !== undefined && v > k) c.potNow![pid] = k; }
  }
  return changed.size;
}

/** (19/11) Recalcula as premiações cuja janela mudou com a correção da 1ª temporada (ver `awardWindow`). */
function recomputeFirstAwards(w: WorldState, s: SeasonState, clubIds: string[], squads: Squads): boolean {
  let changed = false;
  w.awards = (w.awards ?? []).map((a) => {
    const { cycle, season } = awardCycleOf(a.label);
    if (w.prelude || awardWindow(cycle, season, w.startDate).length === awardWindow(cycle, season).length) return a;
    const fresh = computeSeasonAwards(w, squads, clubIds, { cycle, season, date: a.date, leagues: [], level: (id) => leagueLevel(s, id) });
    changed = true;
    return { ...a, ballonDor: fresh.ballonDor, world: fresh.world };
  });
  if (!changed) return false;
  const last = w.awards.at(-1)!;
  const g = last.ballonDor[0];
  // o ícone só troca se a premiação vigente (a última) foi refeita
  if (w.honors?.world?.label === last.label || (!w.honors?.world && g)) {
    w.honors ??= {};
    if (g) w.honors.world = { kind: 'world', playerId: g.playerId, name: g.name, clubId: g.clubId, label: last.label };
    if (s.career) {
      s.career.honors = { ...(s.career.honors ?? {}) };
      if (g) s.career.honors.world = w.honors.world;
    }
  }
  return true;
}

/** (Fase 3) Opções de `migrateCareer` (acréscimo; sem elas o comportamento é o da Fase 2). */
export interface MigrateCareerOptions {
  /** cria `world.coach` (carreira do técnico) se ainda não existir — exige `data` e a SeasonState */
  coachCareer?: boolean;
  data?: CareerData;
  /** elencos base (os de `worldSquads`): com `data`, aposenta as cópias duplicadas da base (uma vez) */
  squads?: (clubId: string) => readonly Player[];
  coach?: CreateCoachOptions;
}

/**
 * Cria a carreira: WorldState + SeasonState do 1º trecho. Com `options.coachCareer`, também a carreira do técnico.
 * (Etapa 1) Início em 01/07 (clube europeu/saudita): o 1º semestre sul-americano é simulado rapidamente (sem humanos,
 * simulação leve) e a virada de 30/06 cria as competições europeias 2026/27 — o humano começa na pré-temporada.
 */
export function createCareer(o: CreateCareerOptions): { world: WorldState; state: SeasonState } {
  const start = o.startDate ?? careerStartDate(o.data, o.humanClubIds, o.season);
  const jan1 = `${o.season}-01-01`;
  let world = createWorld({ ...o, startDate: start });
  // (dados) o mesmo jogador em dois clubes da base: fica uma cópia (ver dedupe.ts)
  if (o.squads) retireDuplicatePlayers(world, undefined, o.data.clubs.map((c) => c.id), o.squads);
  let state: SeasonState;
  if (start > jan1) {
    const base: Squads = o.squads ?? (() => []);
    const w0: WorldState = { ...world, humanClubIds: [] };
    let st = createSeasonFromWorld(w0, o.data, { squads: worldSquads(w0, base), startDate: jan1 });
    const sq = worldSquads(w0, base);
    while (!turnoverDue(st) && st.date < start) st = advanceDay(st, sq, {}, { inPlace: true }).state;
    const r = rolloverSeason(w0, st, base, o.data, o.pools ?? {});
    world = { ...r.world, humanClubIds: o.humanClubIds.slice() };
    state = createSeasonFromWorld(world, o.data, { squads: worldSquads(world, base), startDate: start, carry: st });
  } else {
    // (23/11) carreira de 01/01: a Europa/Arábia joga a temporada 2025/26 (comprimida) no 1º semestre — só quando
    // nenhum humano treina clube europeu/árabe (sala mista: o europeu entra na liga em agosto, como antes)
    const codes = codeMap(o.data);
    const prelude = o.humanClubIds.every((id) => cycleOfRegion(regionOfDataClub(o.data, id, codes)) !== 'split');
    if (prelude) world.prelude = true;
    state = createSeasonFromWorld(world, o.data, { squads: o.squads ? worldSquads(world, o.squads) : undefined, startDate: start, prelude });
  }
  // (13/11) com os elencos, a meta da 1ª temporada segue a força real do elenco
  if (world.options.coachCareer) world.coach = createCoachCareer(world, state, o.data, { ...(o.coach ?? {}), ...(o.squads ? { squads: careerSquads(state, worldSquads(world, o.squads)) } : {}) });
  return { world, state };
}

/* ═════════════════════ elencos ═════════════════════ */

/**
 * Elencos do mundo: dados base + alterações persistentes (idade/overall/potencial, aposentados,
 * transferências de temporadas anteriores, juniores gerados, livres). Idempotente e memorizado.
 * Coerente com `marketSquads`: na temporada, use `careerSquads(state, worldSquads(world, base))`.
 */
export function worldSquads(world: WorldState, base: Squads): Squads {
  const wp = world.players;
  const incoming = new Map<string, string[]>();
  for (const [pid, c] of Object.entries(wp.club)) {
    if (!c) continue;
    let arr = incoming.get(c);
    if (!arr) incoming.set(c, (arr = []));
    arr.push(pid);
  }
  const cache = new Map<string, Player[]>();
  // (Etapa 1) envelhecimentos aplicados (1º/07); saves antigos: temporadas desde o início
  const years = Math.max(0, world.agedYears ?? world.season - world.startSeason);
  // (Etapa 5) fator de reputação dos valores: `rep0` calculado dos DADOS (jogador cru do clube de origem)
  const start = world.startSeason;
  const rawIndex = new Map<string, Map<string, Player>>();
  const rawOf = (pid: string): Player | undefined => {
    const bc = baseClubOf(pid);
    if (!bc || /:g\d+-\d+$/.test(pid)) return undefined;
    let m = rawIndex.get(bc);
    if (!m) rawIndex.set(bc, (m = new Map(base(bc).map((x) => [x.id, x]))));
    return m.get(pid);
  };
  const withRep = (out: Player, raw: Player | undefined): Player => {
    if (out.rep0 !== undefined || !raw) return out;
    const r = rep0Of(raw, start);
    return r === undefined ? out : { ...out, rep0: r };
  };
  return (clubId: string) => {
    let out = cache.get(clubId);
    if (out) return out;
    out = [];
    const seen = new Set<string>();
    for (const p of base(clubId)) {
      if (wp.retired[p.id] !== undefined || seen.has(p.id)) continue;
      const mv = wp.club[p.id];
      if (mv !== undefined && mv !== clubId) continue;
      seen.add(p.id);
      const data = wp.data[p.id];
      if (data) { out.push(withRep(data, p)); continue; }
      const d = wp.delta[p.id];
      // (Fase 2) jogadores de clubes nunca simulados: envelhecimento/evolução anual barata
      out.push(withRep(d ? { ...p, age: d[0], overall: d[1], potential: d[2], wage: d[3], value: d[4], youth: !!d[5] } : years > 0 ? ageUntracked(p, years) : p, p));
    }
    for (const pid of incoming.get(clubId) ?? []) {
      if (seen.has(pid) || wp.retired[pid] !== undefined) continue;
      const data = wp.data[pid];
      if (!data) continue;
      seen.add(pid);
      out.push(data.rep0 !== undefined ? data : withRep(data, rawOf(pid)));
    }
    cache.set(clubId, out);
    return out;
  };
}

/**
 * (Fase 2) Envelhecimento barato de quem nunca esteve numa temporada simulada: idade +1 por ano e o Δ ESPERADO da
 * evolução mensal (players.ts/EVOLUTION, sem ruído nem bônus):
 * até 21 +12×gap×0,035; 22–25 +12×gap×0,03; 26–29 0; 30–31 −0,96; 32–33 −2,04; 34+ −3,6 por ano. Potencial =
 * max(potencial, overall) a partir dos 24. Determinístico e sem estado: calculado a partir dos dados base e do
 * número de envelhecimentos. Quando o clube entra numa temporada, os valores envelhecidos viram o delta persistido.
 * Não há aposentadoria para esses jogadores (o elenco base não muda).
 */
export function ageUntracked(p: Player, years: number): Player {
  let age = p.age, ovr = p.overall, pot = p.potential;
  for (let y = 0; y < years; y++) {
    const gap = Math.max(0, pot - ovr);
    ovr += age <= 21 ? 12 * gap * EVOLUTION.youngRate : age <= 25 ? 12 * gap * EVOLUTION.midRate : age <= 29 ? 0
      : 12 * (age >= 34 ? -0.3 : age >= 32 ? -0.17 : -0.08);
    ovr = Math.max(1, Math.min(99, ovr));
    age++;
    if (age >= 24) pot = Math.max(pot, Math.round(ovr));
  }
  const overall = Math.round(ovr);
  // valor calculado com o potencial "bruto" (economia inalterada); o potencial exibido é o real pela idade
  return { ...p, age, overall, potential: realisticPotential(age, overall, Math.max(pot, overall)), value: revalue(p, age, overall, Math.max(pot, overall)), youth: p.youth && age < YOUTH.graduateAge };
}

/**
 * (18/11) Amarelos acumulados que atravessam a virada: só os das competições ainda em andamento (`running`); os das
 * competições que acabaram zeram (a nova edição começa sem pendurados). Suspensões (`bans`) seguem sempre.
 */
export function keepRunningCards(cards: Record<string, Record<string, number>>, running: Set<string>): { cards?: Record<string, Record<string, number>> } {
  const out: Record<string, Record<string, number>> = {};
  for (const [comp, m] of Object.entries(cards)) if (running.has(comp) && Object.keys(m).length) out[comp] = { ...m };
  return Object.keys(out).length ? { cards: out } : {};
}

/** Elencos efetivos da temporada de carreira: mercado + evolução mensal (overall corrente). Idempotente. */
export function careerSquads(state: SeasonState, base: Squads, marketApplied = false): Squads {
  // `marketApplied`: `base` já são os elencos efetivos do mercado desta SeasonState (ex.: o retorno de runMarketDay)
  const ms = state.market && !marketApplied ? marketSquads(state, base) : base;
  const evo = state.career?.evo;
  const potNow = state.career?.potNow;
  if (!evo) return ms;
  const cache = new Map<string, Player[]>();
  return (clubId: string) => {
    let s = cache.get(clubId);
    if (!s) {
      s = ms(clubId).map((p) => {
        const e = evo[p.id];
        const ovr = e === undefined ? p.overall : Math.max(1, Math.min(99, Math.round(e)));
        const q = ovr === p.overall ? p : { ...p, overall: ovr };
        // (Etapa 5) valor de mercado dinâmico: overall atual, contrato restante, liga do clube e reputação
        // (calculado com o potencial dos dados, para não mexer na economia calibrada)
        const value = careerValue(state, q, clubId);
        // (18/11) potencial real pela idade: acompanha o overall de quem já passou do auge
        // (18/11) banco por muito tempo: o potencial cai (ajuste do trecho), nunca abaixo do overall
        const pn = potNow?.[p.id];
        const pot0 = pn !== undefined ? Math.max(q.overall, Math.min(q.potential, Math.round(pn))) : q.potential;
        const potential = realisticPotential(q.age, q.overall, pot0);
        // (18/11) ninguém abaixo da idade mínima (juniores de 15–16 anos do banco original contam como 17)
        const age = Math.max(MIN_PLAYER_AGE, q.age);
        // (18/11) juniores gerados/revelados antes sem características: 2, fixas pelo id (determinístico)
        const traits = q.traits.length || !/:g\d+-\d+$/.test(q.id) ? q.traits : rollTraits(q.position, new Rng(`traits:${q.id}`));
        return value === q.value && potential === q.potential && age === q.age && traits === q.traits ? q : { ...q, value, potential, age, traits };
      });
      cache.set(clubId, s);
    }
    return s;
  };
}

/**
 * Elencos a partir de players-market.json (sem carregar clubs/<id>.json). Faltam traits/lado/flags
 * (ficam vazios/padrão) — suficiente para os clubes simulados pela IA. Use os bundles completos para
 * os clubes humanos e seus adversários do dia, se quiser.
 */
export function squadsFromMarket(pm: PlayersMarket): Map<string, Player[]> {
  const out = new Map<string, Player[]>();
  for (const r of pm.rows) {
    const clubId = pm.clubs[r[0]];
    let arr = out.get(clubId);
    if (!arr) out.set(clubId, (arr = []));
    arr.push({
      id: `${clubId}:${r[1]}`, name: r[2], position: pm.positions[r[3]], age: r[4], nationalityId: r[9],
      side: 'R', traits: [], star: false, highlight: false, worldClass: false,
      overall: r[5], potential: r[6], wage: r[8], value: r[7], youth: !!r[10], tmId: null,
    });
  }
  return out;
}

/* ═════════════════════ trecho a partir do mundo ═════════════════════ */

export interface SeasonFromWorldOptions {
  /** elencos do mundo (worldSquads) — para criar o mercado com a dispensa de excedentes */
  squads?: Squads;
  /** data inicial do trecho (01/01 ou 01/07; padrão 01/01 de world.season) */
  startDate?: string;
  /**
   * (Etapa 1) SeasonState do trecho anterior (depois da virada): as competições do ciclo que NÃO virou atravessam a
   * virada (cópias), com o estado transitório dos clubes (moral, lesões, suspensões, condição, tática), notícias e,
   * fora do envelhecimento de 1º/07, a evolução mensal e as estatísticas.
   */
  carry?: SeasonState;
  /** ciclo cujas competições novas são criadas (padrão: 'calendar' em 01/01, 'split' em 01/07; null = nenhum) */
  opens?: Cycle | null;
  /**
   * (23/11) 1º trecho de uma carreira que começa em 01/01: cria também a temporada europeia/árabe em andamento
   * (2025/26), com o calendário comprimido em jan–jun — sem isso a Europa ficava parada até julho e os europeus
   * chegavam à 1ª Bola de Ouro com metade dos jogos.
   */
  prelude?: boolean;
}

/** (23/11) Janela da temporada europeia comprimida no 1º semestre (prelúdio). */
export const PRELUDE = { from: '01-03', to: '06-24' } as const;

/** Leva as datas das competições (ago–mai) para [from, to] mantendo a ordem e a proporção; datas sempre crescentes. */
export function compressCalendars(comps: Competition[], from: string, to: string): void {
  const all = comps.flatMap((c) => c.calendar ?? []);
  if (!all.length) return;
  const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const lo = Math.min(...all.map(day)), hi = Math.max(...all.map(day));
  const a = day(from), span = day(to) - a;
  const k = hi > lo ? span / (hi - lo) : 0;
  for (const c of comps) {
    if (!c.calendar?.length) continue;
    const out: string[] = [];
    let prev = -Infinity;
    for (const d of c.calendar) {
      const v = Math.max(prev + 1, Math.round(a + (day(d) - lo) * k));
      out.push(addDays(from, v - a));
      prev = v;
    }
    c.calendar = out;
  }
}

function emptyLedger(): FinanceLedger {
  return { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0, transfers: 0 };
}

function newComp(id: string, name: string, type: CompetitionType, clubIds: string[], extra: Partial<Competition>): Competition {
  return { id, name, type, clubIds: clubIds.slice(), doubleRound: false, relegated: 0, promoted: 0, fixtures: [], ...extra };
}

/** (Etapa 2) Copa do Brasil 2026: 126 clubes (pote 1 12, Série A 8, Série B 20, estaduais 86 em três níveis). */
export const BRAZIL_CUP_2026 = { total: 126, pot1: 12, f3States: 12, f2States: 54 };

/**
 * Participantes da Copa do Brasil 2026 por fase de entrada: pote 1 (12: campeão anterior, clubes na Libertadores e
 * Série A, direto na 5ª fase), `f4` (o resto da Série A), `f3` (Série B + os 12 melhores das vagas estaduais), `f2`
 * (54 estaduais) e `f1` (20 estaduais). Vagas estaduais: 1 por UF + extras pelo tamanho do estadual (máx. 4),
 * na ordem do ranking estadual; níveis pela força. `first` = todos fora do pote 1 (compatibilidade).
 */
export function brazilCupEntrants(world: WorldState, data: CareerData, season = world.season): { pot1: string[]; first: string[]; pots: string[][]; f1: string[]; f2: string[]; f3: string[]; f4: string[] } {
  const cfg = { ...(data.competitions.nationalCup ?? {}), pot1: data.competitions.nationalCup?.pot1 ?? BRAZIL_CUP_2026.pot1, firstPhase: BRAZIL_CUP_2026.total - BRAZIL_CUP_2026.pot1 };
  const A = world.divisions['BRA-1'] ?? [], B = world.divisions['BRA-2'] ?? [];
  const pot1: string[] = [];
  if (world.cupHolder && (A.includes(world.cupHolder) || B.includes(world.cupHolder))) pot1.push(world.cupHolder);
  // (Fase 2) clubes na Libertadores do ano entram direto nos 16-avos (pote 1), spec §2.3
  if (world.continental?.season === season && world.options.continental !== false) {
    const inAB = new Set([...A, ...B]);
    // ordem de pote (força), independente da ordem das listas de vagas
    for (const c of qualifiedFrom(continentalPots(world.continental, data), inAB).libertadores) if (!pot1.includes(c)) pot1.push(c);
  }
  for (const c of A) if (pot1.length < cfg.pot1 && !pot1.includes(c)) pot1.push(c);
  const taken = new Set(pot1);
  const first: string[] = [];
  for (const c of [...A, ...B]) if (!taken.has(c)) { first.push(c); taken.add(c); }
  // vagas estaduais: 1 por UF + extras pelo tamanho da 1ª divisão estadual (máx. 4 por UF)
  const stateSlots = Math.max(0, cfg.firstPhase - first.length);
  const ufs = Object.keys(world.stateRanking);
  const d1Size = (uf: string) => world.stateDivisions[`${uf}-1`]?.length ?? 0;
  const alloc = new Map(ufs.map((u) => [u, 0]));
  const bySize = ufs.slice().sort((a, b) => d1Size(b) - d1Size(a) || a.localeCompare(b));
  let left = stateSlots;
  for (const u of bySize) if (left > 0) { alloc.set(u, 1); left--; }
  for (let cap = 2; cap <= 4 && left > 0; cap++) for (const u of bySize) if (left > 0 && alloc.get(u)! < cap) { alloc.set(u, alloc.get(u)! + 1); left--; }
  const fromStates: string[] = [];
  for (const u of bySize) {
    let k = alloc.get(u)!;
    for (const c of world.stateRanking[u] ?? []) {
      if (k <= 0) break;
      if (taken.has(c)) continue;
      fromStates.push(c); taken.add(c); k--;
    }
  }
  first.push(...fromStates);
  const pots = [pot1];
  for (let i = 0; i < first.length; i += 16) pots.push(first.slice(i, i + 16));
  // (Etapa 2) fases de entrada
  const meta = new Map(data.clubs.map((c) => [c.id, c]));
  const st = strengthSort(fromStates, meta);
  const f4 = A.filter((c) => !pot1.includes(c));
  const f3 = [...B.filter((c) => !pot1.includes(c)), ...st.slice(0, BRAZIL_CUP_2026.f3States)];
  const f2 = st.slice(BRAZIL_CUP_2026.f3States, BRAZIL_CUP_2026.f3States + BRAZIL_CUP_2026.f2States);
  const f1 = st.slice(BRAZIL_CUP_2026.f3States + BRAZIL_CUP_2026.f2States);
  return { pot1, first, pots, f1, f2, f3, f4 };
}

/**
 * (Etapa 1) Competições NOVAS de um ciclo para a temporada `season` (não inicializadas): para cada região do ciclo e
 * cada país em escopo, as divisões nacionais do mundo (acesso/rebaixamento por país), a copa nacional e a supercopa;
 * no Brasil ('calendar') também estaduais, Copa do Brasil, Supercopa do Brasil, continentais e Copa do Nordeste.
 * Datas: calendários reais (`real:<chave>`, deslocados por ano) com o calendário MM-DD do original como reserva.
 */
export function cycleCompetitions(world: WorldState, data: CareerData, cycle: Cycle, season: number): Competition[] {
  const opts = world.options;
  const registry = new Map(data.competitions.competitions.map((c) => [c.id, c]));
  const label = seasonLabel(cycle, season);
  const cal = (key: string, fallback?: string) => cycleCalendar(data, key, cycle, season, fallback);
  const comps: Competition[] = [];
  const clubMeta = new Map(data.clubs.map((c) => [c.id, c]));
  for (const region of regionsOfCycle(cycle)) {
    const tag = (c: Competition): Competition => {
      c.cycle = cycle; c.cycleSeason = season; c.seasonLabel = label; c.region = region;
      return c;
    };
    for (const code of SCOPE_REGIONS[region].countries) {
      const country = data.countries.find((c) => c.code === code);
      if (!country) continue;
      const cid = country.id;
      const divs = countryDivisions(data, cid).filter((d) => world.divisions[d.id] !== undefined);
      if (!divs.length) continue;
      const isBR = cid === BRAZIL;
      const flags = data.competitions.countries?.[code] ?? {};

      // 1) divisões nacionais (a última do mundo não rebaixa)
      divs.forEach((d, i) => {
        const clubIds = world.divisions[d.id] ?? d.clubIds;
        const above = i > 0 ? divs[i - 1] : undefined;
        const last = i === divs.length - 1;
        // (Etapa 2) a última divisão não rebaixa — exceto a Série B (rebaixados voltam a ser "só estadual")
        const div: LeagueDivision = { ...d, clubIds, teams: clubIds.length, relegated: last ? d.rules?.dropToStates ?? 0 : d.relegated };
        const serieDReal = isBR && d.division === 4 && !!flags.brazilSerieDReal;
        const format = nationalFormat(div, above ? above.relegated : 0, { serieDReal });
        const ac = !!d.cfg?.aperturaClausura;
        const calendar = ac ? [...cal('apertura', 'apertura'), ...cal('clausura', 'clausura')] : cal(d.id, 'nacional');
        const reg = registry.get(d.id);
        const name = isBR && SERIE_NAMES[d.division] ? `Brasileirão ${SERIE_NAMES[d.division]}` : ac ? d.name : reg?.name ?? `${d.name} - ${d.divisionName}`;
        comps.push(tag(newComp(d.id, name, 'league', clubIds, {
          division: d.division, doubleRound: d.doubleRound, relegated: div.relegated,
          promoted: above ? above.relegated : 0, format, calendar, priority: reg?.priority ?? 2,
          prizeKey: reg?.prizeKey ?? PRIZE_BY_DIV[d.division], countryId: cid,
        })));
      });

      if (isBR) {
        // 2) estaduais
        if (opts.playStateLeagues) {
          const scal = cal('estaduais', 'estaduais');
          for (const s of data.states) {
            for (const d of s.divisions) {
              const key = `${s.state}-${d.division}`;
              const clubIds = world.stateDivisions[key] ?? d.clubIds;
              if (clubIds.length < 2) continue;
              const sd: StateDivision = { ...d, clubIds };
              comps.push(tag(newComp(`EST-${key}`, d.name, 'state', clubIds, {
                division: d.division, format: stateFormat(data.formats, sd), calendar: scal.slice(), priority: 1, prizeKey: 'ESTADUAL', uf: s.state,
                countryId: cid, relegated: sd.relegated ?? 0, promoted: 0,
              })));
            }
          }
        }
        // 3) Copa do Brasil
        if (opts.nationalCup && flags.brazilCopaReal !== false) {
          const reg = registry.get('BRA-CUP');
          const { pot1, first, f1, f2, f3, f4 } = brazilCupEntrants(world, data, season);
          const entrants: Record<string, string[]> = { all: [...pot1, ...first], pot1, first, f1, f2, f3, f4 };
          comps.push(tag(newComp('BRA-CUP', reg?.name ?? 'Copa do Brasil', 'cup', [...pot1, ...first], {
            format: brazilCupFormat(), entrants, calendar: cal('BRA-CUP', 'copa-nacional'),
            priority: reg?.priority ?? 3, prizeKey: reg?.prizeKey ?? 'NACIONAL_CUP', countryId: cid,
          })));
        }
        // 4) Supercopa do Brasil (campeão da Série A × campeão da Copa do Brasil; se for o mesmo, o vice da copa)
        if (opts.supercup && world.leagueHolder && world.cupHolder) {
          const other = world.cupHolder !== world.leagueHolder ? world.cupHolder : world.cupVice;
          if (other && other !== world.leagueHolder) {
            const reg = registry.get('BRA-SUP');
            comps.push(tag(newComp('BRA-SUP', reg?.name ?? 'Supercopa do Brasil', 'supercup', [world.leagueHolder, other], {
              format: supercupFormat('BRA-SUP'), entrants: { all: [world.leagueHolder, other] }, calendar: cal('BRA-SUP', 'supercopa'),
              priority: reg?.priority ?? 3, prizeKey: 'SUPERCOPA', countryId: cid,
            })));
          }
        }
        // 5) continentais CONMEBOL e Copa do Nordeste (Intercontinental/Supermundial: FIFA, abaixo)
        const cb = continentalCompetitions(world, data, {
          continental: opts.continental, intercontinental: false, supermundial: 'off', regionalCups: opts.regionalCups,
        }, season, (key, fb) => cal(key, fb));
        comps.push(...cb.competitions.map(tag));
      } else {
        // 3) (Etapa 2) copas nacionais reais (FA Cup e EFL Cup, Copa del Rey, Coppa Italia, DFB-Pokal...), supercopa e
        //    playoff de rebaixamento entre divisões
        const all = divs.flatMap((d) => world.divisions[d.id] ?? d.clubIds);
        const hasReal = (key: string) => data.calendars.some((c) => c.id === `real:${key}`);
        const calOf = (key: string, alt: string, fb: string) => (hasReal(key) ? cal(key, fb) : cal(alt, fb));
        const cups = data.competitions.competitions.filter((c) => c.kind === 'cup' && c.countryId === cid && !c.id.endsWith('-PO'));
        if (opts.nationalCup && all.length >= 4) {
          for (const reg of cups.length ? cups : [{ id: `${code}-CUP`, name: `Copa Nacional (${code})`, priority: 3, prizeKey: 'NACIONAL_CUP' }]) {
            const style = CUP_STYLES[reg.id];
            comps.push(tag(newComp(reg.id, reg.name, 'cup', all, {
              format: style ? nationalCupFormat(reg.id, all.length, style) : genericCupFormat(reg.id, all.length), entrants: { all },
              calendar: calOf(reg.id, `cup-${region}`, 'copa-nacional'), priority: reg.priority ?? 3, prizeKey: reg.prizeKey ?? 'NACIONAL_CUP', countryId: cid,
            })));
          }
        }
        const h = world.holders?.[code];
        const supId = `${code}-SUP`;
        const supReg = registry.get(supId);
        const teams = Number((supReg?.qualification as { teams?: number } | undefined)?.teams ?? 2);
        // supercopa só onde ela existe (registro); dados antigos sem registro do país: a genérica, como antes
        const legacyReg = !registry.has(`${code}-CUP`);
        if (opts.supercup && h?.league && (supReg || (legacyReg && h.cup))) {
          const ranking = (world.lastRanking[divs[0].id] ?? world.divisions[divs[0].id] ?? []).filter((c) => clubMeta.has(c));
          const ids = supercupEntrants(h, ranking, teams, (id) => clubMeta.has(id), code === 'COL');
          if (ids.length === teams) {
            comps.push(tag(newComp(supId, supReg?.name ?? `Supercopa (${code})`, 'supercup', ids, {
              format: teams === 4 ? supercup4Format(supId) : supercupFormat(supId, code === 'COL' ? 2 : 1), entrants: { all: ids },
              calendar: calOf(supId, `supercup-${region}`, 'supercopa'), priority: supReg?.priority ?? 3, prizeKey: 'SUPERCOPA', countryId: cid,
            })));
          }
        }
        const up = divs[0], down = divs[1];
        const rp = up?.rules?.relegationPlayoff, tp = down?.rules?.toRelegationPlayoff;
        if (rp && tp && world.divisions[down.id]?.length) {
          const id = `${code}-PO`;
          const reg = registry.get(id);
          const lowerPick: PickRule = tp.from === 'playoff' ? { stage: 'playoff', winners: true } : { stage: 'league', ranks: [tp.rank ?? 3, tp.rank ?? 3] };
          comps.push(tag(newComp(id, reg?.name ?? `Playoff de Rebaixamento (${code})`, 'cup', [], {
            format: relegationPlayoffFormat(id), entrants: {}, calendar: calOf(id, `cup-${region}`, 'copa-nacional'), priority: reg?.priority ?? 3, countryId: cid,
            links: [
              { entrants: 'upper', from: up.id, pick: { stage: 'league', ranks: [rp.rank, rp.rank] }, season },
              { entrants: 'lower', from: down.id, pick: lowerPick, season },
            ],
          })));
        }
      }
    }
    // (Etapa 2) UEFA (Europa) e AFC Champions League Elite (Arábia), com convidados
    if (opts.continental !== false) {
      if (region === 'EU') comps.push(...uefaCompetitions(world, data, season, cal).map(tag));
      if (region === 'SAU') comps.push(...afcCompetitions(world, data, season, cal).map(tag));
      if (region === 'SA') {
        comps.push(...worldCompetitions(world, data, season, cal, { intercontinental: opts.intercontinental, supermundial: opts.supermundial }).map(tag));
      }
    }
  }
  return comps;
}

/**
 * Monta a SeasonState de um TRECHO da linha do tempo global (Etapa 1): competições do ciclo que abre em `startDate`
 * (01/01 → América do Sul; 01/07 → Europa/Arábia) + as do outro ciclo que atravessam a virada (`carry`); clubes,
 * economia, mercado; resolve conflitos de data.
 */
export function createSeasonFromWorld(world: WorldState, data: CareerData, o: SeasonFromWorldOptions = {}): SeasonState {
  const startDate = o.startDate ?? `${world.season}-01-01`;
  const segment = segmentFrom(startDate);
  const season = Number(startDate.slice(0, 4));
  const opens: Cycle | null = o.opens !== undefined ? o.opens : startDate.slice(5) < '07-01' ? 'calendar' : 'split';
  const seed = `${world.seed}:${season}${startDate.slice(5) < '07-01' ? '' : 'b'}`;
  const opts = world.options;
  const clubMeta = new Map(data.clubs.map((c) => [c.id, c]));
  const codes = codeMap(data);
  const ufIdx = new Map(UF_ORDER.map((u, i) => [u, i]));
  const regionOf = (id: string) => ufIdx.get(clubMeta.get(id)?.state ?? '') ?? 99;
  const carry = o.carry;
  const deep = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

  const carried = (carry?.competitions ?? []).filter((c) => cycleOfCompetition(c) !== opens).map(deep);
  const runningIds = new Set(carried.map((c) => c.id));
  const fresh = opens ? cycleCompetitions(world, data, opens, cycleSeasonFor(opens, startDate)) : [];
  if (o.prelude && opens === 'calendar' && !carry) {
    const pre = cycleCompetitions(world, data, 'split', season - 1);
    compressCalendars(pre, `${season}-${PRELUDE.from}`, `${season}-${PRELUDE.to}`);
    fresh.push(...pre);
  }
  const comps: Competition[] = [...carried, ...fresh];

  // clubes e economia
  const divOf = nationalDivisionOf(world);
  const home = new Set<number>([world.countryId]);
  for (const id of world.humanClubIds) { const c = clubMeta.get(id); if (c) home.add(c.countryId); }
  const clubs: Record<string, ClubSeasonState> = {};
  const clubInfo: Record<string, ClubEconomyInfo> = {};
  const all = new Set<string>(world.humanClubIds);
  for (const c of comps) for (const id of c.clubIds) all.add(id);
  for (const id of [...all].sort()) {
    const meta = clubMeta.get(id);
    // (Etapa 2) convidado (fora do escopo): região da sua confederação (ciclo de contratos e janela)
    const region = meta ? regionOfCode(codes.get(meta.countryId) ?? null) ?? (meta.guest ? guestRegion(meta.confed) : null) : null;
    // (Etapa 1) "estrangeiro" = fora dos países dos humanos: simulação leve e economia de estrangeiro (Fase 2)
    const isForeign = meta !== undefined && !home.has(meta.countryId);
    const div = divOf.get(id) ?? (isForeign ? 1 : undefined);
    const fin = world.finance?.[id];
    const prev = carry?.clubs[id];
    // livro-caixa: continua se a região do clube não virou (a virada arquivou/zerou os da região que virou)
    const keepLedger = !!prev?.finance && !!opens && cycleOfRegion(region) !== opens;
    const fans = prev?.fanMorale ?? world.fans?.[id];
    clubs[id] = {
      clubId: id,
      balance: world.balances[id] ?? meta?.finances?.balance ?? data.economy.initialMoneyByDivision[String(div ?? 'default')] ?? 0,
      morale: prev?.morale ?? 60, tactic: prev ? deep(prev.tactic) : { ...DEFAULT_TACTIC }, lineup: prev?.lineup ? deep(prev.lineup) : null,
      injuries: prev ? { ...prev.injuries } : {}, suspensions: prev ? { ...prev.suspensions } : {},
      yellowCards: prev ? { ...prev.yellowCards } : {}, fitness: prev ? { ...prev.fitness } : {},
      // (Atualização 38) disciplina por competição atravessa a virada (suspensão pendente vale na próxima edição)
      // (18/11) os AMARELOS acumulados zeram com o fim da competição (a próxima edição usa o mesmo id: BRA-1 de 2027
      // herdava os pendurados de 2026); só seguem os de competições ainda em andamento (a outra região do calendário)
      ...(prev?.bans ? { bans: deep(prev.bans) } : {}), ...(prev?.cards ? keepRunningCards(prev.cards, runningIds) : {}),
      finance: keepLedger ? { ...prev!.finance! } : emptyLedger(),
      ...(fin?.ticketPrice != null ? { ticketPrice: fin.ticketPrice } : {}),
      ...(fin?.loan ? { loan: fin.loan } : {}),
      ...(fin?.luvaDebts?.length ? { luvaDebts: fin.luvaDebts.map((d) => ({ ...d })) } : {}),
      ...(fin?.stadiumWork ? { stadiumWork: { ...fin.stadiumWork } } : {}),
      ...(fans !== undefined ? { fanMorale: fans } : {}),
    };
    // (Etapa 4) clubes humanos: histórico de bilheteria e demonstrativo mensal atravessam a virada
    if (prev && world.humanClubIds.includes(id)) carryMonthly(clubs[id], prev, startDate, keepLedger);
    clubInfo[id] = {
      name: meta?.name ?? id, capacity: fin?.capacity ?? meta?.capacity, reputation: meta?.reputation, division: div,
      ...economyFromData(meta, div, data),
      countryId: meta?.countryId,
      ...(region ? { region } : {}),
      ...(isForeign ? { foreign: true } : {}),
      ...(meta?.countryId === BRAZIL && meta.state ? { uf: meta.state } : {}),
    };
  }
  // (Etapa 4) perfil econômico: TV da divisão atual, patrocínio, custos, aporte, teto da folha, preço-base
  const econ = econTables(data);
  if (econ) applyEconomyProfiles(econ, clubInfo, economyContext(world, data, clubMeta, codes, divOf));
  // competições que atravessam a virada: divisão/acesso podem ter mudado no mundo, mas o torneio segue como começou
  const keepProgress = !!carry?.career && startDate.slice(5) < '07-01';
  const state: SeasonState = {
    season, date: startDate, humanClubIds: world.humanClubIds.slice(), competitions: comps, clubs, news: carry ? carry.news.slice(-NEWS_KEEP) : [], seed, clubInfo,
    career: {
      countryId: world.countryId, startSeason: world.startSeason,
      evo: keepProgress ? { ...carry!.career!.evo } : {}, stats: keepProgress ? { ...carry!.career!.stats } : {},
      clubGames: keepProgress ? { ...carry!.career!.clubGames } : {},
      ...(keepProgress && carry!.career!.potNow ? { potNow: { ...carry!.career!.potNow } } : {}),
      prizeMode: opts.prizeMode, prizes: { ...data.economy.prizes }, light: opts.light,
      contractEnds: world.players.contractEnd, rescheduled: carry?.career?.rescheduled ?? 0, agedYears: world.agedYears ?? 0,
      ...(econ ? { econ } : {}),
      // (Registros) linhas de carreira do trecho (a virada anterior já despejou as do trecho que acabou)
      lines: {},
      // (19/11) Bola de Prata: números das ligas nacionais que atravessam a virada; ícones vigentes
      ...(carry?.career?.leagueLines ? { leagueLines: keepLeagueLines(carry.career.leagueLines, new Set(carried.map((x) => x.id))) } : {}),
      ...(world.honors ? { honors: JSON.parse(JSON.stringify(world.honors)) as Honors } : {}),
    },
    segment,
  };
  const minDate = addDays(startDate, -1);
  const countryOf = continentalCountryOf(state);
  for (const c of fresh) initCompetition(c, { seed, minDate, regionOf, countryOf });
  state.career!.rescheduled = (state.career!.rescheduled ?? 0) + resolveConflicts(state, startDate).length;
  state.market = seedMarket(state, world, o.squads);
  if (carry?.market) {
    // log de transferências e lista de venda continuam; ofertas em aberto caem na virada
    state.market.history = carry.market.history.slice(0, MARKET.historyCap);
    state.market.transferList = carry.market.transferList.filter((pid) => state.market!.moves[pid] !== '');
    state.market.seq = carry.market.seq;
    // (Base) as categorias de base atravessam a virada
    if (carry.market.academy) state.market.academy = JSON.parse(JSON.stringify(carry.market.academy)) as typeof carry.market.academy;
    // (Treino) o Centro de Treinamento também
    if (carry.market.training) state.market.training = JSON.parse(JSON.stringify(carry.market.training)) as typeof carry.market.training;
    if (carry.market.sponsor) state.market.sponsor = JSON.parse(JSON.stringify(carry.market.sponsor)) as typeof carry.market.sponsor;
    // (Etapa 5) lista de empréstimo e pré-contratos de jogadores que ainda não mudaram (região que não virou)
    if (carry.market.loanList?.length) state.market.loanList = carry.market.loanList.filter((pid) => state.market!.moves[pid] !== '');
    const pcs = Object.values(carry.market.preContracts ?? {}).filter((pc) => (world.players.club[pc.playerId] ?? baseClubOf(pc.playerId)) === pc.fromClubId);
    if (pcs.length) state.market.preContracts = Object.fromEntries(pcs.map((pc) => [pc.playerId, pc]));
  }
  // (Mercado e Orçamentos) orçamentos dos humanos: novos no início da temporada do clube; senão atravessam o trecho
  carryBudgets(state, carry, opens);
  return state;
}

/** Temporada do ciclo que abre em `startDate` (01/01 → o ano; 01/07 → o ano de início da temporada cruzada). */
function cycleSeasonFor(cycle: Cycle, startDate: string): number {
  const y = Number(startDate.slice(0, 4));
  return cycle === 'calendar' ? y : startDate.slice(5) >= '07-01' ? y : y - 1;
}

/**
 * Mercado do trecho já com as transferências/juniores/livres persistidos no mundo.
 * `moves` recebe todo `world.players.club` (para `currentClubOf` acertar o clube); `players` só os
 * LIVRES — os demais vêm de `worldSquads` (por isso a temporada de carreira deve sempre receber
 * `worldSquads(world, base)` como elencos base, nunca os dados crus). (Etapa 1) Empréstimos que atravessaram a
 * virada (`world.players.loans`) voltam ao mercado com o contrato completo.
 */
export function seedMarket(state: SeasonState, world: WorldState, squads?: Squads): MarketState {
  const wp = world.players;
  const freePlayers: Record<string, Player> = {};
  for (const [pid, c] of Object.entries(wp.club)) if (c === '' && wp.data[pid]) freePlayers[pid] = wp.data[pid];
  const contracts: MarketState['contracts'] = {};
  for (const [pid, c] of Object.entries(wp.loans ?? {})) if (wp.club[pid]) contracts[pid] = { ...c };
  const base: MarketState = {
    window: state.segment ? windowFor(primaryRegion(state), state.date) : { open: true, closesOn: `${state.season}-03-31`, opensOn: null },
    moves: { ...wp.club }, contracts, players: freePlayers, offers: [], transferList: [], history: [],
    rules: { overdraft: MARKET.overdraft, minSquad: MARKET.minSquad, maxSquad: MARKET.maxSquad }, seq: 0,
  };
  // jogadores emprestados precisam do registro completo (o mercado devolve com applyTransfer)
  for (const pid of Object.keys(contracts)) if (wp.data[pid]) base.players[pid] = wp.data[pid];
  if (!squads) return base;
  // dispensa de excedentes (> maxSquad) da IA, sobre os elencos já com os movimentos do mundo
  const tmp: SeasonState = { ...state, market: base };
  const fresh = createMarket(tmp, marketSquads(tmp, squads));
  base.window = fresh.window;
  for (const [pid, c] of Object.entries(fresh.moves)) { base.moves[pid] = c; base.players[pid] = fresh.players[pid]; }
  return base;
}

/**
 * A temporada do HUMANO acabou? (Etapa 1) Com linha do tempo global: a virada devida (data após o fim do trecho)
 * envolve a região de algum clube humano — a UI mostra o fim de temporada (renovações). Viradas sem humanos
 * (`autoTurnoverDue`) são feitas sem tela. Temporadas antigas: todas as competições encerradas.
 */
export function seasonOver(state: SeasonState): boolean {
  if (state.segment) {
    const due = turnoverDue(state);
    return due !== null && turnoverAffectsHumans(state, due);
  }
  return state.competitions.every((c) => c.finished || (c.fixtures.length > 0 && c.fixtures.every((f) => !!f.result) && !c.format));
}

/** Nomes por sigla de país (names/<CODE>.json). */
export type NamePools = Record<string, NamePool>;

/**
 * (Fase 2) Siglas dos pools de nomes que a virada usa (names/<CODE>.json): o país da carreira + os países dos
 * clubes da temporada. Sem o pool, a virada usa o do país da carreira.
 */
export function careerNamePoolCodes(world: WorldState, data: CareerData, state?: SeasonState): string[] {
  const codeOf = new Map(data.countries.map((c) => [c.id, c.code]));
  const clubCountry = new Map(data.clubs.map((c) => [c.id, c.countryId]));
  const out = new Set<string>([world.countryCode]);
  for (const id of Object.keys(state?.clubs ?? {})) {
    const code = codeOf.get(clubCountry.get(id) ?? -1);
    if (code) out.add(code);
  }
  return [...out].sort();
}

/** (Etapa 1) Siglas de todos os países em escopo presentes nos dados (pools para viradas automáticas). */
export function scopeNamePoolCodes(data: CareerData): string[] {
  const have = new Set(data.countries.map((c) => c.code));
  return SCOPE_CODES.filter((c) => have.has(c)).sort();
}

/** (19/11) Linhas da Bola de Prata só das competições que continuam no trecho seguinte. */
function keepLeagueLines<T>(lines: Record<string, T>, keep: Set<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(lines)) if (keep.has(k.slice(k.lastIndexOf('|') + 1))) out[k] = v;
  return out;
}
