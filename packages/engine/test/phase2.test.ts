/**
 * Fase 2: continentais (vagas, fases da Libertadores, repasses), agregado/advancing, renovação detalhada,
 * aposentadoria × renovação, economia (empréstimo, estádio, ingresso, luvas), migração de save e a regressão
 * "temporada inteira → seasonOver → nextSeason" (bug do INTERCONTINENTAL que nunca terminava).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData, Competition, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { advanceDay } from '../src/season/season';
import { ageUntracked, createCareer, createSeasonFromWorld, migrateCareer, seasonOver, squadsFromMarket, worldSquads, careerSquads } from '../src/season/career';
import { expiringContracts, MIN_SQUAD, nextSeason, renewalDemand, rolloverSeason } from '../src/season/rollover';
import { intercontinentalFormat, qualifyContinental, qualifiedFrom } from '../src/season/continental';
import { forceFinishCompetition, initCompetition } from '../src/season/format';
import {
  chargeLuva, expandStadium, FINANCE, luvaAmount, maxLoan, processMonthlyFinance, repayLoan, setTicketPrice,
  suggestedTicketPrice, takeLoan, ticketDemandFactor, loanBlockFor,
} from '../src/season/finance';
import { MatchSimulation } from '../src/match/simulation';
import { lightSimulate } from '../src/season/light';
import { config, makeSquad } from './helpers';
import { cycleOfCompetition } from '../src/season/timeline';
import { loadPools, runCareer, type AutoTurnover } from './career-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const rj = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

let data: CareerData;
let base: (id: string) => Player[];
let pools: Record<string, NamePool>;
let world: WorldState;
let state: SeasonState;
let next: { world: WorldState; state: SeasonState; summary: SeasonSummary };
/** (Etapa 1) virada automática de 30/06 (Europa/Arábia + envelhecimento de 1º/07) */
let july: AutoTurnover;
/** 1º trecho (01/01–30/06/2026) */
let first: SeasonState;
const comp = (s: SeasonState, id: string) => s.competitions.find((c) => c.id === id)!;

beforeAll(() => {
  data = {
    clubs: rj('clubs-index.json'), leagues: rj('leagues.json'), states: rj('states.json'), formats: rj('formats.json'),
    competitions: rj('competitions.json'), calendars: rj('calendars.json'), economy: rj('economy.json'), countries: rj('countries.json'),
  };
  const pm = squadsFromMarket(rj('players-market.json'));
  base = (id) => pm.get(id) ?? [];
  pools = loadPools(data);
  const c = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'phase2', squads: base, options: { light: 'all', playStateLeagues: false } });
  first = c.state;
  const r = runCareer(c.world, c.state, base, data, pools, { until: '2027-01-31' });
  world = r.world;
  state = r.state;
  july = r.autos[0];
  next = nextSeason(world, state, base, data, pools);
}, 300_000);

describe('regressão: temporada inteira da carreira', () => {
  it('seasonOver vira true antes de 2027 e todas as competições (inclusive INTERCONTINENTAL) terminam', () => {
    expect(seasonOver(state)).toBe(true);
    expect(state.date <= '2027-01-01').toBe(true);
    for (const c of state.competitions.filter((x) => cycleOfCompetition(x) === 'calendar')) {
      expect(c.finished, c.id).toBe(true);
      expect(c.championId, c.id).toBeTruthy();
    }
    const inter = comp(state, 'INTERCONTINENTAL');
    expect(inter.entrants!.conmebol).toEqual([comp(state, 'LIBERTADORES').championId]);
    expect(inter.titles!.map((t) => t.title)).toEqual(expect.arrayContaining(['Dérbi das Américas', 'Copa África-Ásia-Pacífico', 'Challenger Cup']));
  });

  it('nextSeason funciona e grava os continentais no histórico; Recopa com os campeões', () => {
    expect(next.state.season).toBe(2027);
    for (const id of ['LIBERTADORES', 'SULAMERICANA', 'RECOPA', 'INTERCONTINENTAL']) {
      expect(next.world.history.some((h) => h.competitionId === id && h.season === 2026 && h.championId), id).toBe(true);
    }
    const recopa = comp(next.state, 'RECOPA');
    expect(recopa.clubIds).toEqual([comp(state, 'LIBERTADORES').championId, comp(state, 'SULAMERICANA').championId]);
    // o campeão da Libertadores defende o título nos grupos
    expect(next.world.continental!.libertadores.groups).toContain(comp(state, 'LIBERTADORES').championId);
  });

  it('(13/11) após a virada: elencos com pelo menos MIN_SQUAD jogadores, overall 1–99 e caixa finito', () => {
    const sq = careerSquads(next.state, worldSquads(next.world, base));
    for (const [id, c] of Object.entries(next.state.clubs)) {
      expect(Number.isFinite(c.balance), id).toBe(true);
      const ps = sq(id);
      if (base(id).length === 0 && !ps.length) continue; // clube sem elenco nos dados de mercado
      expect(ps.length, id).toBeGreaterThanOrEqual(MIN_SQUAD);
      expect(ps.length, id).toBeLessThanOrEqual(52);
      for (const p of ps) expect(p.overall >= 1 && p.overall <= 99, p.id).toBe(true);
    }
  });

  it('encerra à força competição travada (fase à espera de participante que não vem)', () => {
    const c: Competition = {
      id: 'INTERCONTINENTAL', name: 'X', type: 'continental', clubIds: ['a', 'b', 'c', 'd', 'e'], doubleRound: false, relegated: 0, promoted: 0,
      fixtures: [], format: intercontinentalFormat(), calendar: ['2026-12-16', '2026-12-19', '2026-12-22', '2026-12-25', '2026-12-29'],
      entrants: { afc: ['a'], ofc: ['b'], caf: ['c'], uefa: ['d'], concacaf: ['e'], conmebol: [] },
    };
    initCompetition(c, { seed: 's', minDate: '2026-01-01' });
    for (const f of c.fixtures) f.result = { home: 1, away: 0 };
    const s: SeasonState = {
      season: 2026, date: '2026-12-30', humanClubIds: [], competitions: [c], clubs: {}, news: [], seed: 'x',
      career: { countryId: 29, startSeason: 2026, evo: {}, stats: {}, clubGames: {}, prizeMode: 'champion', prizes: {}, light: 'all' },
    };
    const r = advanceDay(s, () => []);
    expect(r.state.competitions[0].finished).toBe(true);
    expect(seasonOver(r.state)).toBe(true);
    const c2 = JSON.parse(JSON.stringify(c)) as Competition;
    forceFinishCompetition(c2);
    expect(c2.championId).toBeTruthy();
  });
});

describe('vagas continentais', () => {
  it('1º ano: campeões reais de 2025 e ordem por força; 47 na Libertadores e 44 na Sul-Americana', () => {
    const q = world.continental!;
    expect(q.season).toBe(2026);
    expect(q.holders).toEqual({ LIBERTADORES: 'flarj', SULAMERICANA: 'lanus-arg' });
    expect(q.libertadores.groups.length).toBe(28);
    expect(q.libertadores.f2.length).toBe(13);
    expect(q.libertadores.f1.length).toBe(6);
    expect(q.sulamericana.groups.length).toBe(12);
    expect(q.sulamericana.prelim.length).toBe(32);
    expect(Object.values(q.source).every((s) => s === 'strength')).toBe(true);
    // Corinthians (campeão da Copa do Brasil 2025) na Libertadores; Supercopa 2026 = Flamengo × Corinthians
    expect(q.libertadores.groups).toContain('corinthians-bra');
    expect(comp(state, 'BRA-SUP').clubIds.sort()).toEqual(['corinthians-bra', 'flarj']);
    const all = [...q.libertadores.groups, ...q.libertadores.f2, ...q.libertadores.f1, ...q.sulamericana.groups, ...q.sulamericana.prelim];
    expect(new Set(all).size).toBe(all.length);
    // preliminar da Sul-Americana: pares do mesmo país
    const ctry = new Map(data.clubs.map((c) => [c.id, c.countryId]));
    for (let i = 0; i < q.sulamericana.prelim.length; i += 2) expect(ctry.get(q.sulamericana.prelim[i])).toBe(ctry.get(q.sulamericana.prelim[i + 1]));
  });

  it('repasse: campeão da copa já classificado pela liga ⇒ a vaga desce na tabela; G4 + Copa nos grupos, 5º e 6º na 2ª fase', () => {
    const A = Array.from({ length: 20 }, (_, i) => `bra${i + 1}`);
    const fake: CareerData = { ...data, clubs: [...data.clubs, ...A.map((id) => ({ id, name: id, countryId: 29, state: 'SP', level: 10, leagueId: 'BRA-1' }))] };
    const q = qualifyContinental(fake, 2027, { orders: { BRA: A }, cupHolder: 'bra2', holders: { LIBERTADORES: null, SULAMERICANA: null } });
    const br = qualifiedFrom(q, (id) => id.startsWith('bra'));
    // (Etapa 1) vagas de Peru, Bolívia e Venezuela redistribuídas: Brasil 7 nos grupos (com a copa) + 2 na 2ª fase
    expect(br.libertadores.sort()).toEqual(['bra1', 'bra2', 'bra3', 'bra4', 'bra5', 'bra6', 'bra7', 'bra8', 'bra9'].sort());
    expect(q.libertadores.groups).toEqual(expect.arrayContaining(['bra1', 'bra2', 'bra3', 'bra4', 'bra5', 'bra6', 'bra7']));
    expect(q.libertadores.f2).toEqual(expect.arrayContaining(['bra8', 'bra9']));
    expect(br.sulamericana.sort()).toEqual(['bra10', 'bra11', 'bra12', 'bra13', 'bra14', 'bra15']);
    expect(q.reason.bra2).toBe('Campeão da Copa Nacional');
  });

  it('Copa do Brasil: brasileiros da Libertadores no pote 1 (16-avos)', () => {
    const cup = comp(state, 'BRA-CUP');
    const lib = qualifiedFrom(world.continental, new Set([...world.divisions['BRA-1'], ...world.divisions['BRA-2']])).libertadores;
    for (const id of lib) expect(cup.entrants!.pot1).toContain(id);
  });

  it('virada: vagas do ano seguinte vêm dos resultados (Série A, Copa, ligas estrangeiras)', () => {
    const q = next.world.continental!;
    expect(q.season).toBe(2027);
    expect(q.source.BRA).toBe('results');
    expect(q.source.ARG).toBe('results');
    const cupChamp = comp(state, 'BRA-CUP').championId!;
    expect([...q.libertadores.groups, ...q.libertadores.f2]).toContain(cupChamp);
    expect(next.summary.continental!.libertadores.length).toBeGreaterThanOrEqual(7);
  });
});

describe('Libertadores e Sul-Americana: fases', () => {
  it('preliminares: 3 + 8 + 4 confrontos em ida e volta, nas datas do calendário', () => {
    const lib = comp(state, 'LIBERTADORES');
    expect(lib.stages!.f1.ties!.length).toBe(3);
    expect(lib.stages!.f2.ties!.length).toBe(8);
    expect(lib.stages!.f3.ties!.length).toBe(4);
    for (const st of ['f1', 'f2', 'f3']) for (const t of lib.stages![st].ties!) expect(t.fixtureIds.length).toBe(2);
    const f1dates = lib.fixtures.filter((f) => f.stageId === 'f1').map((f) => f.date.slice(5));
    // (Etapa 1) calendário real 2026 (real:libertadores)
    expect(f1dates).toEqual(expect.arrayContaining(['02-04', '02-11']));
  });

  it('grupos: 8 de 4 (28 diretos + 4 da 3ª fase), 6 rodadas I/V', () => {
    const lib = comp(state, 'LIBERTADORES');
    const g = lib.stages!.groups;
    expect(g.groups!.length).toBe(8);
    for (const gr of g.groups!) expect(gr.length).toBe(4);
    for (const w of lib.stages!.f3.winners!) expect(g.seeds).toContain(w);
    expect(lib.fixtures.filter((f) => f.stageId === 'groups').length).toBe(96);
  });

  it('mata-mata: oitavas, quartas, semi I/V e final única neutra', () => {
    const lib = comp(state, 'LIBERTADORES');
    const ties = lib.stages!.ko.ties!;
    const by = (n: string) => ties.filter((t) => t.roundName === n);
    expect(by('Oitavas de Final').length).toBe(8);
    expect(by('Quartas de Final').length).toBe(4);
    expect(by('Semifinal').length).toBe(2);
    expect(by('Final').length).toBe(1);
    const fin = lib.fixtures.find((f) => f.id === by('Final')[0].fixtureIds[0])!;
    expect(fin.neutral).toBe(true);
    expect(by('Final')[0].fixtureIds.length).toBe(1);
    expect(lib.championId).toBe(by('Final')[0].winner);
  });

  it('repasses: perdedores da 3ª fase → grupos da Sul-Americana; 3ºs dos grupos → play-off de oitavas', () => {
    const lib = comp(state, 'LIBERTADORES');
    const sula = comp(state, 'SULAMERICANA');
    expect(sula.entrants!.lib3.sort()).toEqual(lib.stages!.f3.losers!.slice().sort());
    for (const id of sula.entrants!.lib3) expect(sula.stages!.groups.seeds).toContain(id);
    expect(sula.entrants!.lib3rd.length).toBe(8);
    for (const id of sula.entrants!.lib3rd) expect(sula.stages!.playoff.seeds).toContain(id);
    expect(sula.stages!.prelim.ties!.length).toBe(16);
    expect(sula.fixtures.filter((f) => f.stageId === 'groups').length).toBe(96);
  });

  it('ligas sul-americanas disputadas na temporada (simulação leve) e estrangeiros evoluem na virada', () => {
    // (Etapa 1) sem Peru, Bolívia e Venezuela (fora do escopo); envelhecimento em 1º/07
    for (const id of ['ARG-1', 'URU-1', 'COL-1', 'PAR-1', 'CHI-1', 'EQU-1']) expect(comp(state, id).finished, id).toBe(true);
    for (const id of ['PER-1', 'BOL-1', 'VEN-1']) expect(state.competitions.some((c) => c.id === id), id).toBe(false);
    expect(state.clubInfo!['bocajuniors-arg'].foreign).toBe(true);
    const before = careerSquads(july.before, worldSquads(july.worldBefore, base))('bocajuniors-arg');
    const after = new Map(careerSquads(july.after, worldSquads(july.world, base))('bocajuniors-arg').map((p) => [p.id, p]));
    const kept = before.filter((p) => after.has(p.id));
    expect(kept.length).toBeGreaterThan(10);
    for (const p of kept) expect(after.get(p.id)!.age).toBe(p.age + 1);
  });

  it('jogadores de clubes nunca simulados (Europa) envelhecem pelo Δ esperado', () => {
    const p: Player = { ...makeSquad('x')[3], age: 20, overall: 70, potential: 86 };
    const a = ageUntracked(p, 2);
    expect(a.age).toBe(22);
    expect(a.overall).toBeGreaterThan(70);
    const o = ageUntracked({ ...p, age: 34, overall: 80, potential: 80 }, 1);
    expect(o.overall).toBeLessThan(80);
    // (Etapa 1) toda liga em escopo é simulada; nunca simulados = clubes brasileiros "só estadual" sem divisão
    const inComps = new Set(state.competitions.flatMap((c) => c.clubIds));
    const untracked = data.clubs.find((c) => c.countryId === 29 && !inComps.has(c.id) && !first.clubs[c.id] && base(c.id).length > 0)!.id;
    const p0 = base(untracked)[0];
    const p1 = worldSquads(next.world, base)(untracked).find((x) => x.id === p0.id)!;
    expect(next.world.agedYears).toBe(1);
    expect(p1.age).toBe(p0.age + 1);
  });
});

describe('MatchResult em mata-mata: aggregate e advancing', () => {
  it('2ª perna: vencer o jogo e perder no agregado ⇒ winner/advancing = visitante', () => {
    let found = 0;
    for (let i = 0; i < 40 && found < 3; i++) {
      const r = new MatchSimulation(config(`agg${i}`, { knockout: true, extraTime: false, aggregate: { home: 0, away: 3 } })).runToEnd();
      expect(r.aggregate).toEqual({ home: r.homeGoals, away: r.awayGoals + 3 });
      expect(r.advancing).toBe(r.winner);
      if (r.homeGoals > r.awayGoals && r.homeGoals - r.awayGoals < 3) { expect(r.winner).toBe('away'); found++; }
      if (r.homeGoals - r.awayGoals === 3) { expect(r.penalties).toBeDefined(); }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('agregado empatado ⇒ pênaltis decidem; jogo único sem agregado mantém o comportamento', () => {
    let pens = 0;
    for (let i = 0; i < 60 && pens < 2; i++) {
      const r = new MatchSimulation(config(`pen${i}`, { knockout: true, extraTime: false, aggregate: { home: 1, away: 1 } })).runToEnd();
      if (r.homeGoals === r.awayGoals) {
        pens++;
        expect(r.penalties).toBeDefined();
        expect(r.winner).toBe(r.penalties!.home > r.penalties!.away ? 'home' : 'away');
        expect(r.advancing).toBe(r.winner);
      }
    }
    expect(pens).toBeGreaterThan(0);
    const plain = new MatchSimulation(config('plain')).runToEnd();
    expect(plain.advancing).toBeUndefined();
    expect(plain.aggregate).toBeUndefined();
    const lt = { clubId: 'h', players: makeSquad('h') }, at = { clubId: 'a', players: makeSquad('a') };
    for (let i = 0; i < 20; i++) {
      const r = lightSimulate(`l${i}`, lt, at, { knockout: true, aggregate: { home: 0, away: 4 } });
      expect(r.advancing).toBe(r.winner);
      if (r.homeGoals - r.awayGoals < 4) expect(r.winner).toBe('away');
    }
  });
});

describe('renovação detalhada e aposentadoria', () => {
  it('mapa id → {wage, years}: salário abaixo do pedido é recusado; acima, renova com os anos pedidos', () => {
    const exp = expiringContracts(world, state, base, 'palmeiras');
    expect(exp.length).toBeGreaterThan(1);
    const sq = careerSquads(state, worldSquads(world, base));
    const [low, ok] = exp.filter((p) => p.age < 33);
    const demand = renewalDemand(state, sq, 'palmeiras', ok, 2);
    const r = rolloverSeason(world, state, base, data, pools, { renew: { [low.id]: { wage: 1, years: 2 }, [ok.id]: { wage: demand.wage + 1000, years: 2 } } });
    expect(r.summary.contracts.refused!.map((x) => x.playerId)).toContain(low.id);
    expect(r.summary.contracts.humanReleased).toContain(low.id);
    const retiredOk = r.summary.retirements.some((x) => x.playerId === ok.id);
    if (!retiredOk) {
      expect(r.world.players.contractEnd[ok.id]).toBe(2026 + 2);
      expect(r.summary.contracts.humanReleased).not.toContain(ok.id);
    }
    // lista simples continua aceita (compatibilidade)
    const r2 = rolloverSeason(world, state, base, data, pools, { renew: [low.id] });
    expect(r2.summary.contracts.humanReleased).not.toContain(low.id);
  });

  it('quem o humano renova não se aposenta na virada (salvo 38+)', () => {
    const sq = careerSquads(state, worldSquads(world, base));
    const w = JSON.parse(JSON.stringify(world)) as WorldState;
    // força contratos vencendo e idade alta (33–37) para provocar aposentadorias
    const s = JSON.parse(JSON.stringify(state)) as SeasonState;
    const squad = sq('palmeiras').slice(0, 8);
    for (const p of squad) {
      w.players.contractEnd[p.id] = 2026;
      // (Etapa 1) depois do envelhecimento de 1º/07 o jogador já tem delta no mundo (sobrepõe o elenco base)
      const d = w.players.delta[p.id];
      if (d) w.players.delta[p.id] = [37, 50, d[2], d[3], d[4], d[5]];
    }
    const baseAged = (id: string) => (id === 'palmeiras' ? base(id).map((p) => (squad.some((x) => x.id === p.id) ? { ...p, age: 37, overall: 50 } : p)) : base(id));
    const without = rolloverSeason(w, s, baseAged, data, pools, { renew: [] });
    const retiredWithout = without.summary.retirements.filter((r) => squad.some((p) => p.id === r.playerId));
    expect(retiredWithout.length).toBeGreaterThan(0);
    const withRenew = rolloverSeason(w, s, baseAged, data, pools, { renew: squad.map((p) => p.id) });
    expect(withRenew.summary.retirements.filter((r) => squad.some((p) => p.id === r.playerId)).length).toBe(0);
  });
});

describe('economia fiel', () => {
  // (Etapa 4) bloco = 2,5% da receita em valor redondo (Palmeiras: € 5 mi), juros de 1,2% ao mês (antes 500 mil e 5%)
  it('empréstimo: blocos pela receita, teto pela reputação/receita, juros de 1,2% ao mês no dia 1', () => {
    const s0 = next.state;
    const bal = s0.clubs.palmeiras.balance;
    const block = loanBlockFor(s0.clubInfo!.palmeiras.revenue);
    expect(block).toBe(5_000_000);
    const r = takeLoan(s0, 'palmeiras', 2);
    expect(r.error).toBeUndefined();
    expect(r.state.clubs.palmeiras.loan).toBe(2 * block);
    expect(r.state.clubs.palmeiras.balance).toBe(bal + 2 * block);
    expect(s0.clubs.palmeiras.loan).toBeUndefined(); // puro
    // (escala real) teto = max(2M × (rep + 1), 25% da receita anual)
    const cap = maxLoan(s0.clubInfo!.palmeiras.reputation, s0.clubInfo!.palmeiras.revenue);
    expect(cap).toBeGreaterThanOrEqual(maxLoan(s0.clubInfo!.palmeiras.reputation));
    expect(takeLoan(s0, 'palmeiras', cap / block + 1).error).toBeTruthy();
    const c = JSON.parse(JSON.stringify(r.state.clubs.palmeiras));
    const interest = Math.round(2 * block * FINANCE.loanMonthlyRate);
    expect(processMonthlyFinance(c).interest).toBe(interest);
    const p = repayLoan(r.state, 'palmeiras', 1);
    expect(p.state.clubs.palmeiras.loan).toBe(block);
    expect(p.state.clubs.palmeiras.balance).toBe(bal + block);
    // dívida persiste na virada (WorldState.finance)
    let s = r.state;
    const sq = worldSquads(next.world, base);
    while (s.date < '2027-02-02') s = advanceDay(s, sq).state;
    expect(s.clubs.palmeiras.finance!.loanInterest).toBe(-2 * interest); // juros em 01/01 e 01/02
  });

  // (Etapa 4) custo por lugar da região (América do Sul: € 3.500; antes 1.000)
  it('expansão do estádio: € 3.500 por lugar (América do Sul), obra de N dias, capacidade sobe no fim', () => {
    let s: SeasonState = { ...next.state, clubs: { ...next.state.clubs, palmeiras: { ...next.state.clubs.palmeiras, balance: 50_000_000 } } };
    const cap0 = s.clubInfo!.palmeiras.capacity!;
    const r = expandStadium(s, 'palmeiras', 5000);
    expect(r.error).toBeUndefined();
    expect(r.state.clubs.palmeiras.balance).toBe(50_000_000 - 5000 * 3_500);
    const w = r.state.clubs.palmeiras.stadiumWork!;
    expect(w.until > s.date).toBe(true);
    expect(expandStadium(r.state, 'palmeiras', 1000).error).toBeTruthy(); // uma obra por vez
    s = r.state;
    const sq = worldSquads(next.world, base);
    while (s.date <= w.until) s = advanceDay(s, sq).state;
    expect(s.clubInfo!.palmeiras.capacity).toBe(cap0 + 5000);
    expect(s.clubs.palmeiras.stadiumWork).toBeNull();
    // (Etapa 2) ~2 meses simulados sem `inPlace` com ~140 competições: o limite padrão de 5 s (que já estourava às
    // vezes com a suíte em paralelo) passa a 60 s
  }, 60_000);

  it('ingresso: preço sugerido, faixa permitida e efeito no público', () => {
    const sug = suggestedTicketPrice(next.state, 'palmeiras');
    expect(sug).toBeGreaterThan(0);
    expect(setTicketPrice(next.state, 'palmeiras', sug * 10).error).toBeTruthy();
    expect(setTicketPrice(next.state, 'palmeiras', sug * 1.5).state.clubs.palmeiras.ticketPrice).toBeCloseTo(sug * 1.5, 1);
    expect(ticketDemandFactor(sug * 2, sug)).toBeCloseTo(0.5, 5);
    expect(ticketDemandFactor(sug / 2, sug)).toBeGreaterThan(1);
  });

  // (Etapa 4) luva = 25% do valor de mercado (antes 80%)
  it('luvas: 25% do valor, à vista ou parcelada (cobrada no dia 1)', () => {
    const s = JSON.parse(JSON.stringify(next.state)) as SeasonState;
    const pl = { id: 'x', name: 'Fulano', value: 3_200_000 };
    expect(luvaAmount(pl)).toBe(800_000);
    const b = s.clubs.palmeiras.balance;
    chargeLuva(s, 'palmeiras', pl, 0);
    expect(s.clubs.palmeiras.balance).toBe(b - 800_000);
    chargeLuva(s, 'palmeiras', pl, 6);
    expect(s.clubs.palmeiras.luvaDebts![0].monthly).toBe(Math.ceil(800_000 / 6));
    let total = 0;
    for (let m = 0; m < 6; m++) total += processMonthlyFinance(s.clubs.palmeiras).luvas;
    expect(total).toBe(800_000);
    expect(s.clubs.palmeiras.luvaDebts!.length).toBe(0);
  });
});

describe('saves de revisões anteriores (Etapa 1: não migram)', () => {
  it('save da Fase 1/2 (rev < 3) volta intacto marcado como legado; o da revisão atual é normalizado', () => {
    const c = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'mig', squads: base, options: { continental: false, regionalCups: false } });
    const old = JSON.parse(JSON.stringify(c.world)) as WorldState & Record<string, unknown>;
    delete old.rev; delete old.continental; delete old.finance;
    const m = migrateCareer(old, c.state);
    expect(m.legacy).toBe(true);
    expect(m.migrated).toBe(false);
    expect(m.world).toBe(old);
    const v2 = { ...c.world, rev: 2 };
    expect(migrateCareer(v2).legacy).toBe(true);
    const cur = migrateCareer(c.world, c.state);
    expect(cur.legacy).toBeUndefined();
    expect(cur.world.rev).toBe(3);
    // opções antigas ganham os padrões; a temporada continua normalmente
    const s1 = advanceDay(cur.state!, worldSquads(cur.world, base)).state;
    expect(s1.date).toBe('2026-01-02');
    const s2 = createSeasonFromWorld({ ...cur.world, season: 2027, options: { ...cur.world.options, continental: true } }, data, {});
    expect(s2.competitions.some((x) => x.id === 'LIBERTADORES')).toBe(true);
  }, 60_000);
});
