import type { Player } from '@cosmicfut/shared';
import type {
  ClubEconomyInfo, ClubSeasonState, Competition, CreateSeasonOptions, FinanceLedger, Fixture, MatchConfig, MatchResult,
  MatchTeamInput, SeasonState, Side,
} from '../contract';
import { quickSimulate } from '../match/quick';
import { Rng } from '../rng';
import { autoPickLineup, DEFAULT_TACTIC } from '../tactics';
import { ECONOMY, foreignMatchdayMonthly, hasRealEconomy, leaguePrize, operatingMonthly, ownerMonthly, sponsorMonthly, ticketRevenue, tvMonthly } from './economy';
import { addDays, generateRoundRobin, roundDates } from './schedule';
import { computeStandings } from './standings';
import { runMarketDay } from '../transfers/ai';
import { clubWageBill, loanOutWages } from '../transfers/market';
import { aggregateBefore, finalRanking, forceFinishCompetition, progressCompetition, stageStandings } from './format';
import { resolveConflicts } from './calendar';
import { lightSimulate, type LightTeam } from './light';
import { honorBonus } from './awards';
import { benchPotentialLoss, monthlyDelta, playGrowthFactor } from './players';
import { recordCompetitionGoals, recordLines } from './records';
import { careerSquads } from './career';
import { academyDay } from './academy';
import { trainingDay } from './training';
import { homeTicketDemand, processMonthlyFinance, processStadiumWorks, resultAttendance, ticketPriceOf } from './finance';
import { continentalCountryOf, linkContinental } from './continental';
import { linkCompetitions } from './confed';
import {
  ECON, FANS, bumpFans, fanPriceDelta, fanResultDelta, hasEcon, matchBonus, matchGate, matchImportance, meritAt, monthlyCashFlow, payPhasePrizes,
  PHASE_LABEL, prizeScheduleOf, recordGate, rollMonth, type MatchGate, type MonthlyResult,
} from './econ';
import { fmtMoneyShort } from '../money';
import { dailyRecovery } from '../match/model';
import { applyMatchDiscipline, suspendedPlayers, YELLOW_LIMIT } from './discipline';

const NEWS_CAP = 400;

function emptyLedger(): FinanceLedger {
  return { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 };
}

function divisionOf(id: string): number | undefined {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** Cria a temporada (competições, tabela de jogos, estado dos clubes). */
export function createSeason(opts: CreateSeasonOptions): SeasonState {
  const competitions: Competition[] = [];
  const clubs: Record<string, ClubSeasonState> = {};
  const clubInfo = { ...(opts.clubInfo ?? {}) };
  for (const d of opts.divisions) {
    const rr = generateRoundRobin(d.clubIds, d.doubleRound, `${opts.seed}:${d.id}`);
    const rounds = rr.reduce((m, x) => Math.max(m, x.round), 0);
    const dates = roundDates(rounds, opts.season, opts.startDate, opts.calendarDates);
    const division = divisionOf(d.id);
    competitions.push({
      id: d.id,
      name: d.name,
      type: 'league',
      clubIds: d.clubIds.slice(),
      doubleRound: d.doubleRound,
      relegated: d.relegated,
      promoted: d.promoted,
      division,
      fixtures: rr.map((m) => ({
        id: `${d.id}:${m.round}:${m.homeId}-${m.awayId}`,
        competitionId: d.id,
        round: m.round,
        date: dates[m.round - 1],
        homeId: m.homeId,
        awayId: m.awayId,
      })),
    });
    for (const id of d.clubIds) {
      if (!clubs[id]) {
        clubs[id] = {
          clubId: id,
          balance: opts.clubBalances[id] ?? 0,
          morale: 60,
          tactic: { ...DEFAULT_TACTIC },
          lineup: null,
          injuries: {},
          suspensions: {},
          yellowCards: {},
          fitness: {},
          finance: emptyLedger(),
        };
      }
      clubInfo[id] = { division, ...clubInfo[id] };
    }
  }
  return {
    season: opts.season,
    date: opts.startDate,
    humanClubIds: opts.humanClubIds.slice(),
    competitions,
    clubs,
    news: [],
    seed: opts.seed,
    clubInfo,
  };
}

/** Próximo jogo (sem resultado, a partir da data atual) do clube — ou de qualquer clube se `clubId` vazio. */
export function nextFixtureFor(state: SeasonState, clubId?: string): Fixture | null {
  let best: Fixture | null = null;
  for (const c of state.competitions) {
    for (const f of c.fixtures) {
      if (f.result || f.date < state.date) continue;
      if (clubId && f.homeId !== clubId && f.awayId !== clubId) continue;
      if (!best || f.date < best.date || (f.date === best.date && f.id < best.id)) best = f;
    }
  }
  return best;
}

/** Jogos de uma data (todas as competições). */
export function fixturesOn(state: SeasonState, date: string): Fixture[] {
  const out: Fixture[] = [];
  for (const c of state.competitions) for (const f of c.fixtures) if (f.date === date) out.push(f);
  return out;
}

/**
 * Jogadores indisponíveis (lesionados ou suspensos). (Atualização 38) A suspensão é por competição: com
 * `competitionId`, só conta a suspensão daquela competição; sem ele, a de qualquer competição (conservador).
 */
export function unavailablePlayers(club: ClubSeasonState, competitionId?: string): Set<string> {
  const s = suspendedPlayers(club, competitionId);
  for (const [id, d] of Object.entries(club.injuries)) if (d > 0) s.add(id);
  return s;
}

/**
 * Monta a entrada de partida de um clube a partir do estado da temporada (usado pela IA e pela UI).
 * (Atualização 38) A competição do jogo decide quem está suspenso: `fixture`, ou `competitionId`, ou o próximo
 * jogo do clube.
 */
export function buildTeamInput(state: SeasonState, clubId: string, players: Player[], isHome: boolean, fixture?: Fixture, competitionId?: string): MatchTeamInput {
  const club = state.clubs[clubId];
  const info = state.clubInfo?.[clubId];
  const compId = fixture?.competitionId ?? competitionId ?? (club ? nextFixtureFor(state, clubId)?.competitionId : undefined);
  const unavailable = club ? unavailablePlayers(club, compId) : new Set<string>();
  const available = players.filter((p) => !unavailable.has(p.id));
  const tactic = club?.tactic ?? DEFAULT_TACTIC;
  const human = state.humanClubIds.includes(clubId);
  let lineup = human ? club?.lineup ?? null : null;
  if (lineup) {
    const ids = new Set(available.map((p) => p.id));
    const ok = lineup.starters.length === 11 && lineup.starters.every((id) => ids.has(id));
    if (!ok) lineup = null;
    else lineup = { ...lineup, bench: lineup.bench.filter((id) => ids.has(id)) };
  }
  if (!lineup) lineup = autoPickLineup(available, tactic, undefined, { fitness: club?.fitness });
  // (19/11) ícones da Bola de Ouro/Prata dos jogadores deste elenco
  let honors: Record<string, { overall: number; drain: number }> | undefined;
  if (state.career?.honors) for (const p of available) {
    const b = honorBonus(state.career.honors, p.id);
    if (b) (honors ??= {})[p.id] = b;
  }
  // (13/11) preço do ingresso do mandante: a simulação devolve o público pagante
  const ticketDemand = isHome ? homeTicketDemand(state, clubId) : undefined;
  // (Etapa 4) com o jogo informado, o público é o da bilheteria da economia (o mesmo que advanceDay grava)
  const gate = isHome && fixture ? matchGate(state, state.competitions.find((c) => c.id === fixture.competitionId), fixture) : null;
  return {
    ...(ticketDemand !== undefined ? { ticketDemand } : {}),
    ...(gate ? { attendance: gate.attendance } : {}),
    clubId,
    name: info?.name ?? clubId,
    players: available,
    lineup,
    tactic,
    morale: club?.morale ?? 50,
    isHome,
    control: 'ai',
    fitness: club?.fitness,
    stadiumCapacity: info?.capacity,
    reputation: info?.reputation,
    ...(honors ? { honors } : {}),
  };
}

function cloneState(s: SeasonState): SeasonState {
  return JSON.parse(JSON.stringify(s)) as SeasonState;
}

const deep = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * (Etapa 2, desempenho) Próxima data com jogo pendente de cada competição, memorizada por objeto: com ~140
 * competições e ~15 mil jogos por temporada, varrer todos os jogos de todas as competições todo dia custava caro.
 * O valor é um limite inferior seguro: jogos novos mudam `fixtures.length` (recalcula) e a remarcação de conflitos só
 * empurra datas para frente; quando a data chega ao limite, recalcula.
 */
const nextGameCache = new WeakMap<Competition, { n: number; min: string }>();
function hasGamesOn(comp: Competition, date: string): boolean {
  let e = nextGameCache.get(comp);
  if (!e || e.n !== comp.fixtures.length || e.min <= date) {
    let min = '9999-12-31';
    for (const f of comp.fixtures) if (!f.result && f.date >= date && f.date < min) min = f.date;
    e = { n: comp.fixtures.length, min };
    nextGameCache.set(comp, e);
  }
  return e.min === date;
}

/**
 * Cópia para o dia (temporadas de carreira): copia profundamente só o que o dia pode mudar
 * (clubes, mercado, notícias, competições com jogo hoje, estatísticas); o resto é compartilhado
 * por referência com a entrada — que continua intacta.
 */
function cloneForDay(s: SeasonState): SeasonState {
  const date = s.date;
  const monthly = date.endsWith('-01');
  return {
    ...s,
    clubs: deep(s.clubs),
    news: s.news.slice(),
    market: s.market ? deep(s.market) : undefined,
    competitions: s.competitions.map((c) => (hasGamesOn(c, date) ? deep(c) : c)),
    career: s.career ? {
      ...s.career, evo: monthly ? { ...s.career.evo } : s.career.evo, stats: { ...s.career.stats }, clubGames: { ...s.career.clubGames },
      ...(s.career.lines ? { lines: { ...s.career.lines } } : {}),
      ...(s.career.leagueLines ? { leagueLines: { ...s.career.leagueLines } } : {}),
    } : undefined,
  };
}

export interface AdvanceDayOptions {
  /** muta `state` em vez de copiar (scripts/servidor que descartam o estado anterior) */
  inPlace?: boolean;
}

/**
 * Processa um dia: atualizações diárias, finanças mensais (dia 1), jogos do dia
 * (IA×IA via quickSimulate; jogos humanos via `playedResults`, ou simulados se ausentes),
 * premiação ao fim da competição e avanço da data. Não muta `state` (salvo `opts.inPlace`).
 *
 * (Fase 1) Competições com `format`: mata-mata (agregado, pênaltis sem prorrogação), progressão
 * automática das fases, remarcação de conflitos, artilharia e prêmio só do campeão (carreira).
 * Temporadas de carreira (`state.career`): evolução mensal, estatísticas por jogador e simulação leve opcional.
 */
export function advanceDay(
  input: SeasonState,
  squadsIn: (clubId: string) => Player[],
  playedResults: Record<string, MatchResult> = {},
  opts: AdvanceDayOptions = {},
): { state: SeasonState; played: { fixture: Fixture; result: MatchResult }[] } {
  const state = opts.inPlace ? input : input.career ? cloneForDay(input) : cloneState(input);
  const date = state.date;
  const career = state.career;
  // 0) mercado (só quando a temporada tem `market`): IA compra/vende, ofertas, janelas.
  //    Depois disso os elencos passam a ser os efetivos (marketSquads é idempotente: aceita base ou efetivo).
  //    (13/11) os elencos efetivos que o dia de mercado já calculou são reaproveitados (mesmo resultado)
  const ms = state.market ? runMarketDay(state, squadsIn) : undefined;
  const squads = career ? careerSquads(state, ms ?? squadsIn, !!ms) : ms ?? squadsIn;
  const news = (text: string, clubId?: string) => state.news.push({ date, text, clubId });
  // (Base) revelações das categorias de base dos humanos
  if (career && state.market) for (const n of academyDay(state, squads)) news(n.text, n.clubId);
  const name = (id: string) => state.clubInfo?.[id]?.name ?? id;
  const isHuman = (id: string) => state.humanClubIds.includes(id);
  const fmtMoney = (v: number) => fmtMoneyShort(Math.round(v));
  const econ = state.career?.econ;

  // 1) diário: lesões, recuperação física, moral volta à média
  let worksPending = false;
  // (13/11, desempenho) for…in em vez de Object.entries: mesma ordem e mesmo resultado, sem alocar pares por dia
  for (const club of Object.values(state.clubs)) {
    const inj = club.injuries;
    for (const pid in inj) {
      const d = inj[pid];
      if (d <= 1) {
        delete inj[pid];
        if (isHuman(club.clubId)) news(`${playerName(squads, club.clubId, pid)} está recuperado e volta a treinar normalmente.`, club.clubId);
      } else inj[pid] = d - 1;
    }
    const fit = club.fitness;
    for (const pid in fit) {
      // (Atualização 38) recuperação que cresce com o cansaço (antes +9/dia fixo)
      const nf = dailyRecovery(fit[pid]);
      if (nf >= 100) delete fit[pid];
      else fit[pid] = nf;
    }
    club.morale = clamp(club.morale + (55 - club.morale) * 0.03, 0, 100);
    // (Etapa 4) Moral da Torcida volta devagar aos 60
    if (club.fanMorale !== undefined) {
      const fm = club.fanMorale + (ECON.fanDefault - club.fanMorale) * FANS.drift;
      club.fanMorale = Math.abs(fm - ECON.fanDefault) < 0.05 ? ECON.fanDefault : Math.round(fm * 100) / 100;
    }
    club.finance ??= emptyLedger();
    if (club.stadiumWork) worksPending = true;
  }
  // (Fase 2) obras do estádio concluídas
  if (worksPending) processStadiumWorks(state);
  // (Treino) Centro de Treinamento dos humanos: evolução e energia perto dos jogos
  if (career && state.market?.training) for (const n of trainingDay(state, squads)) news(n.text, n.clubId);

  // 2) finanças mensais
  if (date.endsWith('-01')) {
    // (Etapa 5) empréstimos: quem recebe paga a parte combinada; o dono paga o resto
    const loanOut = state.market ? loanOutWages(state) : null;
    for (const club of Object.values(state.clubs)) {
      const info = state.clubInfo?.[club.clubId];
      const wages = loanOut
        ? clubWageBill(state, club.clubId, squads(club.clubId), loanOut.get(club.clubId) ?? 0)
        : squads(club.clubId).reduce((s, p) => s + (p.wage || 0), 0);
      const human = isHuman(club.clubId);
      // (Etapa 4) demonstrativo mensal dos humanos: fecha o mês anterior antes dos lançamentos de hoje
      if (human) rollMonth(club, date);
      if (hasEcon(info)) {
        const r = monthlyCashFlow(club, info, wages);
        if (club.ticketPrice != null && club.ticketPrice > 0) bumpFans(club, fanPriceDelta(club.ticketPrice, info.basePrice));
        const extra = club.loan || club.luvaDebts?.length ? processMonthlyFinance(club) : null;
        if (human) monthlyNews(state, club, info, r, extra, wages, news, name);
        continue;
      }
      const sponsor = sponsorMonthly(info?.sponsorPerSeason, info?.division);
      const tv = tvMonthly(info?.division, info);
      // (Fase 2) custos operacionais (só temporadas de carreira; a temporada avulsa antiga não muda)
      // (escala real) com `info.revenue`: custos proporcionais à receita, aporte do dono e bilheteria mensal de estrangeiros
      const opex = career || hasRealEconomy(info) ? operatingMonthly(info?.division, info?.foreign, info) : 0;
      const owner = ownerMonthly(info);
      const matchday = foreignMatchdayMonthly(info);
      club.balance += sponsor + tv + owner + matchday - wages - opex;
      const fin = club.finance!;
      fin.wages -= wages;
      fin.sponsor += sponsor;
      fin.tv += tv;
      if (owner) fin.owner = (fin.owner ?? 0) + owner;
      if (matchday) fin.tickets += matchday;
      if (opex) fin.operating = (fin.operating ?? 0) - opex;
      // (Fase 2) juros do empréstimo e parcelas de luvas
      const extra = club.loan || club.luvaDebts?.length ? processMonthlyFinance(club) : null;
      if (isHuman(club.clubId)) {
        news(`Folha salarial paga: ${fmtMoney(wages)}. Patrocínio ${fmtMoney(sponsor)} e cota de TV ${fmtMoney(tv)} recebidos.${opex ? ` Custos operacionais: ${fmtMoney(opex)}.` : ''}`, club.clubId);
        if (extra?.interest) news(`Juros mensais (5%) do empréstimo: ${fmtMoney(extra.interest)}.`, club.clubId);
        if (extra?.luvas) news(`Parcelas de luvas pagas: ${fmtMoney(extra.luvas)}.`, club.clubId);
        if (club.balance < 0) news(`Atenção: o caixa do ${name(club.clubId)} está negativo (${fmtMoney(club.balance)}).`, club.clubId);
      }
    }
  }

  // 2b) evolução mensal (carreira)
  if (career && date.endsWith('-01')) monthlyEvolution(state, squads);

  // 3) jogos do dia
  const played: { fixture: Fixture; result: MatchResult }[] = [];
  const touched = new Set<Competition>();
  const leadersBefore = new Map<string, string>();
  // 'minor': clubes sem divisão nacional (só estadual) — os "estaduais pequenos"
  // (Fase 2) clubes estrangeiros (ligas sul-americanas e participantes de fora) também usam a simulação leve
  const minorDiv = (id: string) => state.clubInfo?.[id]?.division === undefined || !!state.clubInfo?.[id]?.foreign;
  for (const comp of state.competitions) {
    if (!hasGamesOn(comp, date)) continue;
    const today = comp.fixtures.filter((f) => f.date === date && !f.result);
    if (!today.length) continue;
    touched.add(comp);
    if (!comp.format) {
      const before = computeStandings(comp);
      if (before[0]?.played) leadersBefore.set(comp.id, before[0].clubId);
    } else if (comp.clubIds.some(isHuman)) {
      const before = leaderTable(comp);
      if (before?.[0]?.played) leadersBefore.set(comp.id, before[0].clubId);
    }
    for (const f of today) {
      let result = playedResults[f.id];
      if (!result) {
        const seed = `${state.seed ?? 'season'}:${state.season}:${f.id}`;
        const aggregate = comp.format ? aggregateBefore(comp, f) : undefined;
        const light = career && career.light !== 'none' && !isHuman(f.homeId) && !isHuman(f.awayId) &&
          (career.light === 'all' || (minorDiv(f.homeId) && minorDiv(f.awayId)));
        if (light) {
          const lt = (id: string): LightTeam => {
            const c = state.clubs[id];
            const info = state.clubInfo?.[id];
            const hs = state.career?.honors;
            const ps = squads(id);
            // (19/11) ícones: o overall a mais também vale na simulação leve
            const players = hs ? ps.map((p) => { const b = honorBonus(hs, p.id); return b ? { ...p, overall: Math.min(99, p.overall + b.overall) } : p; }) : ps;
            return { clubId: id, players, unavailable: c ? unavailablePlayers(c, f.competitionId) : undefined, capacity: info?.capacity, reputation: info?.reputation };
          };
          result = lightSimulate(seed, lt(f.homeId), lt(f.awayId), { knockout: f.knockout, aggregate, neutral: f.neutral });
        } else {
          const home = buildTeamInput(state, f.homeId, squads(f.homeId), true, undefined, f.competitionId);
          const away = buildTeamInput(state, f.awayId, squads(f.awayId), false, undefined, f.competitionId);
          const cfg: MatchConfig = { seed, home, away };
          if (f.knockout) { cfg.knockout = true; cfg.extraTime = !!f.extraTime; if (aggregate) cfg.aggregate = aggregate; }
          result = quickSimulate(cfg);
        }
      }
      // (Etapa 4) bilheteria da economia: público e renda pelo modelo (preço, importância, Moral da Torcida)
      let gate = matchGate(state, comp, f);
      // jogo humano disputado na UI: o público já veio da bilheteria do dia anterior (buildTeamInput com o jogo);
      // mantém o número mostrado na partida e ajusta a renda na mesma proporção
      const shown = playedResults[f.id]?.attendance;
      if (gate && shown && shown > 0 && shown !== gate.attendance && Math.abs(shown - gate.attendance) <= 0.05 * gate.attendance) {
        gate = { ...gate, revenue: Math.round((gate.revenue * shown) / gate.attendance), attendance: shown };
      }
      if (gate) result = { ...result, attendance: gate.attendance, ticketDemand: Math.round(gate.demand * 1000) / 1000 };
      // (13/11) público pagante (preço do ingresso do mandante) — o mesmo da renda e da notícia
      else if (result.ticketDemand === undefined) {
        const k = homeTicketDemand(state, f.homeId);
        if (k !== undefined) result = { ...result, attendance: resultAttendance(state, f.homeId, result), ticketDemand: k };
      }
      f.result = { home: result.homeGoals, away: result.awayGoals };
      if (result.penalties) f.result.penalties = { ...result.penalties };
      postMatch(state, f, result, squads, news, comp, gate);
      if (comp.format) recordCompetitionGoals(comp, f.homeId, f.awayId, result);
      if (career) {
        recordStats(state, f, result);
        recordLines(state, f.homeId, f.awayId, result, comp);
      }
      played.push({ fixture: f, result });
    }
  }

  // 3b) progressão das competições com formato (checkProgression) e conflitos de data
  let rebuilt = false;
  for (const comp of touched) {
    if (!comp.format || comp.finished) continue;
    const nBefore = comp.fixtures.length;
    progressCompetition(comp, { seed: state.seed ?? 'season', minDate: date, countryOf: continentalCountryOf(state) });
    if (comp.fixtures.length > nBefore) rebuilt = true;
    // (Etapa 4) prêmios por fase alcançada (participação, oitavas, quartas...)
    const sched = prizeScheduleOf(econ, comp);
    if (sched && !econ?.merit[comp.id]) payPhasePrizes(comp, sched, (id, v, why) => creditPrize(state, id, v, `${PHASE_LABEL[why] ?? why} — ${comp.name}`, news));
  }
  // (Fase 2) repasses entre competições (Libertadores → Sul-Americana, campeão → Intercontinental)
  if (career) {
    const copyOnWrite = !opts.inPlace && !!input.career;
    if (linkContinental(state, date, copyOnWrite ? input.competitions : null)) rebuilt = true;
    // (Etapa 2) repasses genéricos: playoffs de rebaixamento entre divisões, campeões → Intercontinental
    if (linkCompetitions(state, date, copyOnWrite ? input.competitions : null)) rebuilt = true;
  }
  if (rebuilt) {
    if (!opts.inPlace && input.career) {
      // remarcação pode mexer em qualquer competição: copia as que ainda são compartilhadas
      state.competitions = state.competitions.map((c) => (input.competitions.includes(c) ? deep(c) : c));
    }
    const moves = resolveConflicts(state, addDays(date, 1));
    if (career) career.rescheduled = (career.rescheduled ?? 0) + moves.length;
    for (const m of moves) {
      const f = state.competitions.find((c) => c.id === m.competitionId)?.fixtures.find((x) => x.id === m.fixtureId);
      if (f && (isHuman(f.homeId) || isHuman(f.awayId))) {
        const hid = isHuman(f.homeId) ? f.homeId : f.awayId;
        news(`Jogo ${name(f.homeId)} x ${name(f.awayId)} (${f.label ?? m.competitionId}) remarcado de ${fmtDate(m.from)} para ${fmtDate(m.to)} por conflito de datas.`, hid);
      }
    }
  }

  // 4) líderes, fim de competição
  for (const comp of touched) {
    if (comp.format) {
      if (!comp.finished && comp.relegatedIds !== undefined) finishFormatCompetition(state, comp, news, fmtMoney);
      else if (leadersBefore.has(comp.id)) {
        const leader = leaderTable(comp)?.[0]?.clubId;
        const prev = leadersBefore.get(comp.id);
        if (leader && prev && leader !== prev) news(`${name(leader)} assume a liderança do ${comp.name}!`, leader);
      }
      continue;
    }
    const table = computeStandings(comp);
    const leader = table[0]?.clubId;
    const prev = leadersBefore.get(comp.id);
    if (leader && prev && leader !== prev) news(`${name(leader)} assume a liderança do ${comp.name}!`, leader);
    if (!comp.finished && comp.fixtures.every((f) => f.result)) {
      comp.finished = true;
      news(`${name(table[0].clubId)} é campeão do ${comp.name} ${comp.seasonLabel ?? state.season}!`, table[0].clubId);
      table.forEach((row, i) => {
        const prize = leaguePrize(comp.division, i + 1, table.length);
        const club = state.clubs[row.clubId];
        if (!club) return;
        club.balance += prize;
        club.finance!.prizes += prize;
        if (isHuman(row.clubId)) news(`${name(row.clubId)} termina em ${i + 1}º lugar e recebe ${fmtMoney(prize)} de premiação.`, row.clubId);
      });
      if (comp.relegated > 0) {
        const down = table.slice(-comp.relegated).map((r) => name(r.clubId));
        news(`Rebaixados no ${comp.name}: ${down.join(', ')}.`);
      }
    }
  }

  // 5) (Fase 2) robustez: competição com formato que não pode mais andar (sem jogos pendentes, calendário
  //    esgotado, fases à espera de participantes que não virão) é encerrada com o que tiver — seasonOver nunca trava
  for (let i = 0; i < state.competitions.length; i++) {
    const comp = state.competitions[i];
    if (!comp.format || comp.finished) continue;
    const cal = comp.calendar;
    const lastCal = cal?.length ? cal[cal.length - 1] : '';
    if (lastCal >= date) continue;
    if (comp.fixtures.some((f) => !f.result)) continue;
    let c = comp;
    if (!opts.inPlace && input.career && input.competitions.includes(c)) {
      c = deep(c);
      state.competitions[i] = c;
    }
    if (c.relegatedIds === undefined) forceFinishCompetition(c);
    finishFormatCompetition(state, c, news, fmtMoney);
  }

  if (state.news.length > NEWS_CAP) state.news.splice(0, state.news.length - NEWS_CAP);
  state.date = addDays(date, 1);
  return { state, played };
}

function postMatch(
  state: SeasonState,
  f: Fixture,
  r: MatchResult,
  squads: (clubId: string) => Player[],
  news: (text: string, clubId?: string) => void,
  comp?: Competition,
  gate?: MatchGate | null,
): void {
  const name = (id: string) => state.clubInfo?.[id]?.name ?? id;
  const isHuman = (id: string) => state.humanClubIds.includes(id);
  const rng = new Rng(`${state.seed ?? 'season'}:${f.id}:post`);
  const importance = gate?.importance.value ?? (state.career?.econ ? matchImportance(state, comp, f).value : 1);
  const sides: [Side, string][] = [['home', f.homeId], ['away', f.awayId]];
  for (const [side, clubId] of sides) {
    const club = state.clubs[clubId];
    if (!club) continue;
    const gf = side === 'home' ? r.homeGoals : r.awayGoals;
    const ga = side === 'home' ? r.awayGoals : r.homeGoals;
    const won = gf > ga || (gf === ga && r.winner === side);
    const lost = gf < ga || (gf === ga && r.winner !== side && r.winner !== 'draw');

    // (Atualização 38) disciplina por competição: cumpre as suspensões DESTA competição, aplica expulsões e o
    // acúmulo de amarelos desta competição (season/discipline.ts)
    const mine = r.cards.filter((c) => c.side === side);
    const compName = comp?.name ?? state.competitions.find((c) => c.id === f.competitionId)?.name ?? f.competitionId;
    const events = applyMatchDiscipline(club, f.competitionId, mine, (_pid, secondYellow) => (secondYellow ? 1 : rng.int(1, 2)));
    if (isHuman(clubId)) {
      for (const e of events) {
        const who = playerName(squads, clubId, e.playerId);
        news(e.kind === 'red'
          ? `${who} foi expulso e cumprirá ${e.games} jogo(s) de suspensão no(a) ${compName}.`
          : `${who} recebeu o ${YELLOW_LIMIT}º amarelo no(a) ${compName} e está suspenso para o próximo jogo da competição.`, clubId);
      }
    }
    // lesões
    for (const inj of r.injuries.filter((x) => x.side === side)) {
      club.injuries[inj.playerId] = Math.max(club.injuries[inj.playerId] ?? 0, inj.days);
      if (isHuman(clubId)) news(`${playerName(squads, clubId, inj.playerId)} se lesionou e deve ficar ${inj.days} dias fora.`, clubId);
    }
    // condição física
    const appeared = r.appearances?.[side] ?? [];
    for (const pid of appeared) {
      const st = r.fitnessAfter?.[pid];
      if (st !== undefined) club.fitness[pid] = Math.min(st, club.fitness[pid] ?? 100);
    }
    // moral
    club.morale = clamp(club.morale + (won ? 7 : lost ? -7 : 1) + (gf - ga) * (won || lost ? 0.8 : 0), 5, 100);
    // (Etapa 4) Moral da Torcida: resultado pesado pela importância do jogo
    if (state.career?.econ) bumpFans(club, fanResultDelta(won, lost, gf - ga, importance));
  }

  // bilheteria do mandante (campo neutro: 50/50)
  const home = state.clubs[f.homeId];
  if (home) {
    const info = state.clubInfo?.[f.homeId];
    const c0 = comp ?? state.competitions.find((c) => c.id === f.competitionId);
    // (Fase 2) preço definido pelo humano: o público responde ao preço (season/finance.ts). `r.attendance` já é o
    // público pagante (advanceDay aplicou o preço antes de chamar postMatch). (Etapa 4) com perfil: matchGate.
    const rev = gate
      ? gate.revenue
      : home.ticketPrice != null && home.ticketPrice > 0
        ? Math.round(r.attendance * ticketPriceOf(state, f.homeId) * ECONOMY.revenueMultiplier)
        : ticketRevenue(r.attendance, info?.division ?? c0?.division, info?.reputation, info);
    const shares: [ClubSeasonState | undefined, number][] = f.neutral
      ? [[home, Math.round(rev / 2)], [state.clubs[f.awayId], rev - Math.round(rev / 2)]]
      : [[home, rev]];
    for (const [club, v] of shares) {
      if (!club) continue;
      club.balance += v;
      club.finance ??= emptyLedger();
      club.finance.tickets += v;
    }
    if (gate && isHuman(f.homeId)) recordGate(home, f, c0, gate, shares[0][1]);
    // (Etapa 4) bônus por vitória/empate na fase de grupos/liga (UCL, Libertadores...)
    const econ = state.career?.econ;
    if (c0 && econ) {
      for (const b of matchBonus(c0, prizeScheduleOf(econ, c0), f, r.homeGoals, r.awayGoals)) creditPrize(state, b.clubId, b.v, `${b.why} — ${c0.name}`, news);
    }
  }

  // manchetes
  const score = `${name(f.homeId)} ${r.homeGoals} x ${r.awayGoals} ${name(f.awayId)}`;
  const humanSide = isHuman(f.homeId) ? f.homeId : isHuman(f.awayId) ? f.awayId : null;
  if (humanSide) {
    const scorers = r.scorers
      .filter((s) => !s.ownGoal)
      .map((s) => `${playerName(squads, s.side === 'home' ? f.homeId : f.awayId, s.playerId)} ${s.minute}'`);
    const renda = gate && isHuman(f.homeId) ? ` · renda ${fmtMoneyShort(gate.revenue)}` : '';
    news(`${score}${scorers.length ? ` — gols: ${scorers.join(', ')}` : ''}. Público: ${r.attendance.toLocaleString('pt-BR')}${renda}.`, humanSide);
  } else if (Math.abs(r.homeGoals - r.awayGoals) >= 4) {
    news(`Goleada! ${score}.`, r.homeGoals > r.awayGoals ? f.homeId : f.awayId);
  }
}

function playerName(squads: (clubId: string) => Player[], clubId: string, pid: string): string {
  return squads(clubId).find((p) => p.id === pid)?.name ?? pid;
}

function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Tabela "de liderança" de uma competição com formato: a 1ª fase, se for de grupo único e ainda ativa. */
function leaderTable(comp: Competition) {
  const first = comp.format?.stages[0];
  if (!first || first.kind !== 'table' || (first.groups ?? 1) > 1) return null;
  const st = comp.stages?.[first.id];
  if (!st || st.status !== 'active') return null;
  return stageStandings(comp, first.id);
}

function recordStats(state: SeasonState, f: Fixture, r: MatchResult): void {
  const c = state.career!;
  for (const [side, clubId] of [['home', f.homeId], ['away', f.awayId]] as [Side, string][]) {
    if (!state.clubs[clubId]) continue;
    c.clubGames[clubId] = (c.clubGames[clubId] ?? 0) + 1;
    for (const pid of r.appearances?.[side] ?? []) {
      const prev = c.stats[pid];
      const rating = Math.round((r.ratings[pid] ?? 6.2) * 10);
      c.stats[pid] = prev ? [prev[0] + 1, prev[1], prev[2] + rating] : [1, 0, rating];
    }
  }
  for (const s of r.scorers) {
    if (s.ownGoal) continue;
    const prev = c.stats[s.playerId];
    if (prev) c.stats[s.playerId] = [prev[0], prev[1] + 1, prev[2]];
  }
}

/** applyMonthlyEvolution: Δ mensal de overall (fracionário) para todos os jogadores dos clubes da carreira. */
function monthlyEvolution(state: SeasonState, squads: (clubId: string) => Player[]): void {
  const c = state.career!;
  // (18/11) potencial: cai para quem fica muito tempo no banco (cópia nova: o estado do dia é raso)
  const potNow: Record<string, number> = { ...(c.potNow ?? {}) };
  const training = state.market?.training;
  for (const clubId of Object.keys(state.clubs)) {
    const games = c.clubGames[clubId] ?? 0;
    const inTraining = new Set(training?.[clubId]?.players ?? []);
    for (const p of squads(clubId)) {
      const cur = c.evo[p.id] ?? p.overall;
      const st = c.stats[p.id];
      const share = games > 0 ? (st?.[0] ?? 0) / games : 0;
      const trains = inTraining.has(p.id);
      const rng = new Rng(`${state.seed ?? 'season'}:${state.date}:evo:${p.id}`);
      const next = Math.max(1, Math.min(99, cur + monthlyDelta(p.age, cur, p.potential, share, rng, playGrowthFactor(share, games, trains))));
      c.evo[p.id] = Math.round(next * 1000) / 1000;
      const loss = benchPotentialLoss(p.age, share, games, trains);
      if (loss > 0) {
        // p.potential já vem ajustado (careerSquads); nunca abaixo do overall atual
        const cur0 = Math.min(potNow[p.id] ?? p.potential, p.potential + 0.499);
        const v = Math.max(Math.ceil(next), cur0 - loss);
        if (v < cur0) potNow[p.id] = Math.round(v * 1000) / 1000;
      }
    }
  }
  if (Object.keys(potNow).length) c.potNow = potNow;
}

/** Fim de competição com formato: campeão, prêmio (só campeão no modo fiel), notícias. */
function finishFormatCompetition(
  state: SeasonState, comp: Competition,
  news: (text: string, clubId?: string) => void, fmtMoney: (v: number) => string,
): void {
  comp.finished = true;
  const name = (id: string) => state.clubInfo?.[id]?.name ?? id;
  const isHuman = (id: string) => state.humanClubIds.includes(id);
  const ch = comp.championId;
  if (ch) news(`${name(ch)} é campeão: ${comp.name} ${comp.seasonLabel ?? state.season}!${comp.viceId ? ` Vice: ${name(comp.viceId)}.` : ''}`, ch);
  for (const t of comp.titles ?? []) news(`${name(t.clubId)} conquista o título de ${t.title} (${comp.name}).`, t.clubId);
  const pay = (clubId: string, v: number, pos?: number) => {
    const club = state.clubs[clubId];
    if (!club || v <= 0) return;
    club.balance += v;
    club.finance ??= emptyLedger();
    club.finance.prizes += v;
    if (isHuman(clubId)) news(`${name(clubId)} recebe ${fmtMoney(v)} de premiação${pos ? ` (${pos}º lugar)` : ''} — ${comp.name}.`, clubId);
  };
  const mode = state.career?.prizeMode ?? 'champion';
  const econ = state.career?.econ;
  const merit = econ?.merit[comp.id];
  const sched = prizeScheduleOf(econ, comp);
  if (econ && merit) {
    // (Etapa 4) premiação por posição (merit da Premier League, CBF no Brasileirão...)
    const order = finalRanking(comp);
    order.forEach((id, i) => pay(id, meritAt(merit, i + 1), i + 1));
  } else if (econ && sched) {
    // (Etapa 4) fases ainda não pagas + bônus do campeão
    payPhasePrizes(comp, sched, (id, v, why) => creditPrize(state, id, v, `${PHASE_LABEL[why] ?? why} — ${comp.name}`, news));
    if (ch && sched.champion) creditPrize(state, ch, sched.champion, `título — ${comp.name}`, news);
  } else if (mode === 'champion') {
    let v = (comp.prizeKey && state.career?.prizes[comp.prizeKey]) || 0;
    // (Etapa 4) estaduais: o prêmio do original (R$ 5 mi) vale para os grandes; nos demais, até 2% da receita
    const R = ch ? state.clubInfo?.[ch]?.revenue : undefined;
    if (econ && comp.type === 'state' && R) v = Math.min(v, Math.round(0.02 * R));
    if (ch) pay(ch, v);
  } else {
    const order = finalRanking(comp);
    order.forEach((id, i) => pay(id, leaguePrize(comp.division, i + 1, order.length), i + 1));
  }
  // (Etapa 4) Moral da Torcida: título, vice, acesso e rebaixamento
  if (econ) {
    const minor = comp.type === 'state' || comp.type === 'supercup' ? 0.5 : 1;
    if (ch) bumpFans(state.clubs[ch], FANS.title * minor);
    if (comp.viceId) bumpFans(state.clubs[comp.viceId], FANS.vice * minor);
    for (const id of comp.relegatedIds ?? []) bumpFans(state.clubs[id], comp.type === 'state' ? FANS.relegation / 2 : FANS.relegation);
    for (const id of comp.promotedIds ?? []) bumpFans(state.clubs[id], FANS.promotion);
  }
  if (comp.relegatedIds?.length) news(`Rebaixados — ${comp.name}: ${comp.relegatedIds.map(name).join(', ')}.`);
  if (comp.promotedIds?.length) news(`Acesso — ${comp.name}: ${comp.promotedIds.map(name).join(', ')}.`);
}

/** (Etapa 4) Crédito de premiação (caixa + livro); notícia para clubes humanos. MUTA o estado. */
function creditPrize(state: SeasonState, clubId: string, v: number, why: string, news: (text: string, clubId?: string) => void): void {
  const club = state.clubs[clubId];
  if (!club || !(v > 0)) return;
  club.balance += v;
  club.finance ??= emptyLedger();
  club.finance.prizes += v;
  if (state.humanClubIds.includes(clubId)) news(`Premiação recebida: ${fmtMoneyShort(v)} (${why}).`, clubId);
}

/**
 * (Etapa 4) Notícias financeiras do mês para o clube humano: resumo, cheque especial e avisos da diretoria sobre o
 * teto da folha salarial (perto: ≥ 90%, uma vez; acima: todo mês).
 */
function monthlyNews(
  state: SeasonState, club: ClubSeasonState, info: ClubEconomyInfo, r: MonthlyResult, extra: { interest: number; luvas: number } | null,
  wages: number, news: (text: string, clubId?: string) => void, name: (id: string) => string,
): void {
  const id = club.clubId;
  const fm = fmtMoneyShort;
  const inc = r.tv + r.sponsor + r.owner + r.matchday;
  const out = r.wages + r.staff + r.maintenance + r.opex;
  news(`Fluxo do mês: TV ${fm(r.tv)}, patrocínio ${fm(r.sponsor)}${r.owner ? `, aporte ${fm(r.owner)}` : ''} (${fm(inc)}). Salários ${fm(r.wages)}, comissão e funcionários ${fm(r.staff)}, estádio ${fm(r.maintenance)}, operação ${fm(r.opex)} (${fm(out)}).`, id);
  if (extra?.interest) news(`Juros mensais do empréstimo bancário: ${fm(extra.interest)}.`, id);
  if (extra?.luvas) news(`Parcelas de luvas pagas: ${fm(extra.luvas)}.`, id);
  if (r.overdraft) news(`Cheque especial: caixa negativo (${fm(club.balance)}). Juros de ${Math.round(ECON.overdraftRate * 1000) / 10}% ao mês cobrados: ${fm(r.overdraft)}.`, id);
  const limit = info.creditLimit ?? 0;
  if (limit > 0 && club.balance < -limit) news(`Diretoria: o ${name(id)} estourou o limite do cheque especial (${fm(-limit)}). Compras de jogadores estão bloqueadas até o caixa melhorar.`, id);
  const ceiling = info.wageCeiling ?? 0;
  if (ceiling > 0) {
    const use = (wages * 12) / ceiling;
    const level = use > 1 ? 2 : use >= 0.9 ? 1 : 0;
    const month = state.date.slice(0, 7);
    const prev = club.boardWarn?.level ?? 0;
    if (level === 2) news(`Diretoria: a folha salarial (${fm(wages * 12)}/ano) está acima do teto de ${fm(ceiling)} (${Math.round(use * 100)}%). Contratações e renovações que aumentem a folha estão vetadas.`, id);
    else if (level === 1 && prev < 1) news(`Diretoria: a folha salarial chegou a ${Math.round(use * 100)}% do teto (${fm(ceiling)}/ano). Cuidado com novas contratações.`, id);
    club.boardWarn = { month, level };
  }
}

/** Regras de partida de um jogo (para a UI montar o MatchConfig de um jogo humano). */
export function fixtureMatchRules(state: SeasonState, f: Fixture): Pick<MatchConfig, 'knockout' | 'extraTime' | 'aggregate'> {
  if (!f.knockout) return {};
  const comp = state.competitions.find((c) => c.id === f.competitionId);
  const aggregate = comp ? aggregateBefore(comp, f) : undefined;
  return { knockout: true, extraTime: !!f.extraTime, ...(aggregate ? { aggregate } : {}) };
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
