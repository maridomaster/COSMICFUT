/**
 * Correções de 13/11: público pagante (preço do ingresso) unificado, ordem/motivos das vagas continentais,
 * `tieSummary`, e robustez (repasse continental menor que o previsto, clube humano fora de qualquer divisão,
 * formatos com menos clubes que o previsto).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FormatDef, Player } from '@cosmicfut/shared';
import type { CareerData, Competition, Fixture, SeasonState } from '../src/contract';
import { advanceDay, buildTeamInput, createSeason } from '../src/season/season';
import { resultAttendance, setTicketPrice, suggestedTicketPrice, ticketDemandFactor } from '../src/season/finance';
import { MatchSimulation } from '../src/match/simulation';
import { continentalPots, qualifyContinental, strengthSort } from '../src/season/continental';
import { careerSquads, createCareer, seasonOver, squadsFromMarket, worldSquads } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { finalRanking, initCompetition, progressCompetition, tieSummary, tieSummaryOf } from '../src/season/format';
import { genericCupFormat, genericStateFormat } from '../src/season/competitions';
import { makeSquad } from './helpers';
import { loadPools, runCareer } from './career-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const rj = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

let data: CareerData;
let base: (id: string) => Player[];
beforeAll(() => {
  data = {
    clubs: rj('clubs-index.json'), leagues: rj('leagues.json'), states: rj('states.json'), formats: rj('formats.json'),
    competitions: rj('competitions.json'), calendars: rj('calendars.json'), economy: rj('economy.json'), countries: rj('countries.json'),
  };
  const pm = squadsFromMarket(rj('players-market.json'));
  base = (id) => pm.get(id) ?? [];
}, 120_000);

/* ═════════════════════ 1) público pagante ═════════════════════ */

describe('público pagante: resultado, notícia e renda usam o mesmo número', () => {
  const squadsOf = new Map<string, Player[]>();
  const squads = (id: string) => { let s = squadsOf.get(id); if (!s) squadsOf.set(id, (s = makeSquad(id))); return s; };
  const mk = (): { s: SeasonState; f: Fixture } => {
    const s = createSeason({
      season: 2026, startDate: '2026-01-01', humanClubIds: ['casa', 'fora'], clubBalances: {}, seed: 'att',
      divisions: [{ id: 'T-1', name: 'Teste', clubIds: ['casa', 'fora'], doubleRound: false, relegated: 0, promoted: 0 }],
      clubInfo: { casa: { capacity: 40000, reputation: 3, name: 'Casa' }, fora: { capacity: 40000, reputation: 3, name: 'Fora' } },
    });
    const f = s.competitions[0].fixtures[0];
    return { s: { ...s, date: f.date }, f };
  };
  const newsAtt = (s: SeasonState) => {
    const n = s.news.find((x) => /Público: /.test(x.text));
    return n ? Number(/Público: ([\d.]+)/.exec(n.text)![1].replace(/\./g, '')) : NaN;
  };

  it('advanceDay (IA/rápida): público ajustado pelo ticketDemandFactor no resultado, na notícia e na renda', () => {
    const { s, f } = mk();
    const r0 = advanceDay(s, squads);
    const att0 = r0.played[0].result.attendance;
    expect(r0.played[0].result.ticketDemand).toBeUndefined();
    expect(newsAtt(r0.state)).toBe(att0);

    const sug = suggestedTicketPrice(s, f.homeId);
    const s2 = setTicketPrice(s, f.homeId, sug * 2).state;
    const k = ticketDemandFactor(s2.clubs[f.homeId].ticketPrice!, sug);
    const r2 = advanceDay(s2, squads);
    const res = r2.played[0].result;
    expect(res.ticketDemand).toBeCloseTo(k, 10);
    expect(res.attendance).toBe(Math.round(Math.min(40000, att0 * k)));
    expect(res.attendance).toBeLessThan(att0);
    expect(newsAtt(r2.state)).toBe(res.attendance);
    const price = s2.clubs[f.homeId].ticketPrice!;
    expect(r2.state.clubs[f.homeId].finance!.tickets).toBe(Math.round(res.attendance * price));
    // idempotente: o resultado devolvido já está ajustado
    expect(resultAttendance(r2.state, f.homeId, res)).toBe(res.attendance);
  });

  it('preço baixo aumenta o público até a capacidade', () => {
    const { s, f } = mk();
    const sug = suggestedTicketPrice(s, f.homeId);
    const s2 = setTicketPrice(s, f.homeId, sug * 0.2).state;
    const res = advanceDay(s2, squads).played[0].result;
    expect(res.attendance).toBeLessThanOrEqual(40000);
    expect(res.ticketDemand).toBeGreaterThan(1);
  });

  it('jogo ao vivo (MatchSimulation via buildTeamInput) devolve o pagante e advanceDay não aplica o preço de novo', () => {
    const { s, f } = mk();
    const sug = suggestedTicketPrice(s, f.homeId);
    const s2 = setTicketPrice(s, f.homeId, sug * 1.5).state;
    const home = buildTeamInput(s2, f.homeId, squads(f.homeId), true);
    const away = buildTeamInput(s2, f.awayId, squads(f.awayId), false);
    expect(home.ticketDemand).toBeCloseTo(ticketDemandFactor(sug * 1.5, sug), 2);
    expect(away.ticketDemand).toBeUndefined();
    const seed = `${s2.seed}:${s2.season}:${f.id}`;
    const live = new MatchSimulation({ seed, home, away }).runToEnd();
    const raw = new MatchSimulation({ seed, home: { ...home, ticketDemand: undefined }, away }).runToEnd();
    expect(live.ticketDemand).toBe(home.ticketDemand);
    expect(live.attendance).toBe(Math.round(Math.min(40000, raw.attendance * home.ticketDemand!)));
    // mesmo placar: o preço não mexe no RNG da partida
    expect([live.homeGoals, live.awayGoals]).toEqual([raw.homeGoals, raw.awayGoals]);
    // resultado humano com o preço já aplicado: advanceDay registra o mesmo número
    const r = advanceDay(s2, squads, { [f.id]: live });
    expect(r.played[0].result.attendance).toBe(live.attendance);
    expect(newsAtt(r.state)).toBe(live.attendance);
    // resultado humano SEM o preço (servidor antigo): advanceDay aplica
    const r3 = advanceDay(s2, squads, { [f.id]: raw });
    expect(r3.played[0].result.attendance).toBe(live.attendance);
    expect(resultAttendance(s2, f.homeId, raw)).toBe(live.attendance);
  });
});

/* ═════════════════════ 2) vagas continentais ═════════════════════ */

describe('vagas continentais: ordem da vaga e motivos com posição', () => {
  const A = Array.from({ length: 20 }, (_, i) => `bra${i + 1}`);
  const fake = () => ({
    ...data,
    // força invertida: o pote (força) difere da ordem da tabela
    clubs: [...data.clubs, ...A.map((id, i) => ({ id, name: id, countryId: 29, state: 'SP', level: 1 + i, leagueId: 'BRA-1' }))],
  });

  it('listas na ordem campeão → Copa → posição; motivos "Série A Nº → ..."', () => {
    const d = fake();
    const q = qualifyContinental(d, 2027, { orders: { BRA: A }, cupHolder: 'bra9', holders: { LIBERTADORES: 'bra20', SULAMERICANA: null } });
    expect(q.libertadores.groups.slice(0, 6)).toEqual(['bra20', 'bra9', 'bra1', 'bra2', 'bra3', 'bra4']);
    // (Etapa 1) Brasil: 7 vagas nos grupos (com a copa) + 2 na 2ª fase (vagas de PER/BOL/VEN redistribuídas)
    expect(q.libertadores.f2.slice(0, 2)).toEqual(['bra7', 'bra8']);
    expect(q.sulamericana.groups.slice(0, 6)).toEqual(['bra10', 'bra11', 'bra12', 'bra13', 'bra14', 'bra15']);
    expect(q.reason.bra20).toBe('Campeão da Libertadores');
    expect(q.reason.bra9).toBe('Campeão da Copa Nacional');
    expect(q.reason.bra1).toBe('Série A 1º → Libertadores (grupos)');
    expect(q.reason.bra5).toBe('Série A 5º → Libertadores (grupos)');
    expect(q.reason.bra8).toBe('Série A 8º → Libertadores (2ª fase)');
    expect(q.reason.bra10).toBe('Série A 10º → Sul-Americana (grupos)');
    expect(q.position!.bra8).toBe(8);
    expect(q.position!.bra9).toBe(9);
    // outros países também trazem a posição (Sul-Americana preliminar incluída)
    const uru = Object.entries(q.reason).filter(([id]) => d.clubs.find((c) => c.id === id)?.countryId === 195);
    expect(uru.length).toBeGreaterThan(0);
    for (const [, why] of uru) expect(why).toMatch(/ \d+º → (Libertadores|Sul-Americana) \(/);
  });

  it('continentalPots devolve a ordem de pote (força) antiga, sem depender da ordem de entrada', () => {
    const d = fake();
    const q = qualifyContinental(d, 2027, { orders: { BRA: A }, cupHolder: 'bra9', holders: { LIBERTADORES: 'bra20', SULAMERICANA: null } });
    const meta = new Map(d.clubs.map((c) => [c.id, c]));
    const pots = continentalPots(q, d);
    expect(pots.libertadores.groups[0]).toBe('bra20');
    expect(pots.libertadores.groups.slice(1)).toEqual(strengthSort(q.libertadores.groups.filter((x) => x !== 'bra20'), meta));
    expect(pots.sulamericana.prelim).toEqual(q.sulamericana.prelim);
    const shuffled = { ...q, libertadores: { ...q.libertadores, groups: q.libertadores.groups.slice().reverse() } };
    expect(continentalPots(shuffled, d).libertadores.groups).toEqual(pots.libertadores.groups);
  });

  it('preliminar com nº ímpar de clubes num país: o do meio não recebe vaga fantasma', () => {
    const d = { ...data, leagues: data.leagues.map((l) => (l.id === 'URU-1' ? { ...l, clubIds: l.clubIds.slice(0, 7) } : l)) };
    const q = qualifyContinental(d, 2027, {});
    const listed = new Set([...q.libertadores.groups, ...q.libertadores.f2, ...q.libertadores.f1, ...q.sulamericana.groups, ...q.sulamericana.prelim, ...Object.values(q.holders).filter(Boolean) as string[]]);
    for (const id of Object.keys(q.reason)) expect(listed.has(id), id).toBe(true);
    expect(q.sulamericana.prelim.length % 2).toBe(0);
  });
});

/* ═════════════════════ 3) tieSummary ═════════════════════ */

describe('tieSummary', () => {
  const fmt = (awayGoals: boolean): FormatDef => ({
    id: 'T', teams: 2,
    stages: [{ id: 'ko', kind: 'knockout', name: 'Final', sources: [{ entrants: 'all' }], seeding: 'order', rounds: [{ name: 'Final', tie: { legs: 2, awayGoals } }] }],
    champion: 'ko',
  });
  const mkComp = (awayGoals: boolean): Competition => {
    const c: Competition = {
      id: 'TST', name: 'Teste', type: 'cup', clubIds: ['a', 'b'], doubleRound: false, relegated: 0, promoted: 0, fixtures: [],
      format: fmt(awayGoals), entrants: { all: ['a', 'b'] }, calendar: ['2026-03-01', '2026-03-08'],
    };
    return initCompetition(c, { seed: 's', minDate: '2026-01-01' });
  };
  const play = (c: Competition, leg1: [number, number], leg2: [number, number], pens?: [number, number]) => {
    const [f1, f2] = c.fixtures;
    f1.result = { home: leg1[0], away: leg1[1] };
    f2.result = { home: leg2[0], away: leg2[1], ...(pens ? { penalties: { home: pens[0], away: pens[1] } } : {}) };
    progressCompetition(c, { seed: 's', minDate: '2026-03-08' });
  };
  const tieOf = (c: Competition) => c.stages!.ko.ties![0];

  it('antes do jogo: pernas, agregado zerado, ninguém avança', () => {
    const c = mkComp(false);
    const t = tieSummary({ competitions: [c] }, tieOf(c).id)!;
    expect(t.legs.map((f) => f.leg)).toEqual([1, 2]);
    expect(t.played).toBe(false);
    expect(t.advancing).toBeNull();
    expect(t.decidedBy).toBeNull();
    expect(t.aggregate).toEqual({ a: 0, b: 0 });
  });

  it('agregado', () => {
    const c = mkComp(false);
    // ida: b (mandante) 1 x 0 a; volta: a 3 x 0 b  → a 3 x 1
    play(c, [1, 0], [3, 0]);
    const t = tieSummary({ competitions: [c] }, tieOf(c).id)!;
    expect(t.aggregate).toEqual({ a: 3, b: 1 });
    expect(t.advancing).toBe('a');
    expect(t.eliminated).toBe('b');
    expect(t.decidedBy).toBe('aggregate');
    expect(t.advancing).toBe(tieOf(c).winner);
  });

  it('gol fora (quando a regra manda)', () => {
    const c = mkComp(true);
    // ida: b 2 x 1 a (a marca 1 fora); volta: a 1 x 0 b → 2 x 2, gols fora a 1 × b 0
    play(c, [2, 1], [1, 0]);
    const t = tieSummaryOf(c, tieOf(c));
    expect(t.aggregate).toEqual({ a: 2, b: 2 });
    expect(t.awayGoals).toEqual({ a: 1, b: 0 });
    expect(t.decidedBy).toBe('away-goals');
    expect(t.advancing).toBe('a');
    expect(t.advancing).toBe(tieOf(c).winner);
  });

  it('pênaltis', () => {
    const c = mkComp(false);
    // 1 x 1 e 0 x 0; pênaltis da volta (a mandante) 3 x 4 → b avança
    play(c, [1, 1], [0, 0], [3, 4]);
    const t = tieSummary({ competitions: [c] }, tieOf(c).id)!;
    expect(t.decidedBy).toBe('penalties');
    expect(t.penalties).toEqual({ a: 3, b: 4 });
    expect(t.advancing).toBe('b');
    expect(t.advancing).toBe(tieOf(c).winner);
  });

  it('id inexistente → null', () => {
    expect(tieSummary({ competitions: [mkComp(false)] }, 'nada:ko:0:0')).toBeNull();
  });
});

/* ═════════════════════ 4) robustez ═════════════════════ */

/** Joga todos os jogos pendentes (placar determinístico) e progride até a competição encerrar. */
function playOut(c: Competition): void {
  let k = 0;
  for (let guard = 0; guard < 400 && c.relegatedIds === undefined; guard++) {
    let last = '2026-01-01';
    for (const f of c.fixtures) {
      if (f.date > last) last = f.date;
      if (f.result) continue;
      k++;
      f.result = { home: k % 3, away: (k * 7) % 4, ...(f.knockout && k % 3 === (k * 7) % 4 ? { penalties: { home: 4, away: 3 } } : {}) };
    }
    progressCompetition(c, { seed: 'po', minDate: last });
  }
}

describe('robustez: formatos com poucos clubes', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
  const comp = (format: FormatDef, n: number): Competition => ({
    id: 'X', name: 'X', type: 'state', clubIds: ids(n), doubleRound: false, relegated: 0, promoted: 0, fixtures: [], format,
    entrants: { all: ids(n) }, calendar: Array.from({ length: 30 }, (_, i) => `2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`),
  });

  it('estadual genérico de 0 a 24 clubes sempre termina (com campeão a partir de 1 clube)', () => {
    for (let n = 0; n <= 24; n++) {
      const c = initCompetition(comp(genericStateFormat(n), n), { seed: 'g', minDate: '2025-12-31' });
      playOut(c);
      expect(c.relegatedIds, `n=${n}`).toBeDefined();
      if (n >= 1) expect(c.championId, `n=${n}`).toBeTruthy();
      if (n >= 2) expect(finalRanking(c).length, `n=${n}`).toBeGreaterThan(0);
    }
  });

  it('copa nacional genérica de 2 a 40 clubes sempre termina com campeão', () => {
    for (let n = 2; n <= 40; n++) {
      const c = initCompetition({ ...comp(genericCupFormat('X-CUP', n), n), type: 'cup' }, { seed: 'g', minDate: '2025-12-31' });
      playOut(c);
      expect(c.championId, `n=${n}`).toBeTruthy();
    }
  });

  it('formato de estadual dos dados aplicado a uma divisão com MENOS clubes cai no genérico e termina', async () => {
    const { stateFormat } = await import('../src/season/competitions');
    const st = data.states.find((s) => s.divisions.some((d) => d.formatKey && data.formats[d.formatKey!]))!;
    const d0 = st.divisions.find((d) => d.formatKey && data.formats[d.formatKey!])!;
    for (const n of [1, 2, 3, Math.max(4, d0.clubIds.length - 1)]) {
      const clubIds = d0.clubIds.slice(0, n);
      const f = stateFormat(data.formats, { ...d0, clubIds });
      const c = initCompetition({ ...comp(f, n), clubIds, entrants: { all: clubIds } }, { seed: 'g', minDate: '2025-12-31' });
      playOut(c);
      expect(c.relegatedIds, `n=${n}`).toBeDefined();
      expect(c.championId, `n=${n}`).toBeTruthy();
    }
  });
});

describe('robustez: carreira', () => {
  it('Sul-Americana com repasse da Libertadores menor que o previsto (só BRA e ARG) termina com campeão', () => {
    const drop = new Set(['URU-1', 'COL-1', 'PAR-1', 'CHI-1', 'EQU-1', 'URU-2', 'COL-2', 'PAR-2', 'CHI-2']);
    const d: CareerData = { ...data, leagues: data.leagues.filter((l) => !drop.has(l.id)) };
    const c0 = createCareer({ data: d, humanClubIds: ['palmeiras'], season: 2026, seed: 'short', squads: base, options: { light: 'all', playStateLeagues: false } });
    // (Etapa 1) avança fazendo a virada automática de 30/06 até a virada do humano (31/12)
    const { state } = runCareer(c0.world, c0.state, base, d, {}, { until: '2027-01-31' });
    expect(seasonOver(state)).toBe(true);
    for (const id of ['LIBERTADORES', 'SULAMERICANA']) {
      const c = state.competitions.find((x) => x.id === id)!;
      expect(c.finished, id).toBe(true);
      expect(c.championId, id).toBeTruthy();
    }
    const sula = state.competitions.find((x) => x.id === 'SULAMERICANA')!;
    expect(sula.stages?.groups).toBeDefined();
  }, 120_000);

  it('virada com estaduais: nenhum clube abaixo de 18 jogadores (antes: 2–9 clubes com 14–17)', () => {
    const c0 = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'career-script', squads: base, options: { light: 'all', humanAutoRenew: true } });
    const pools = loadPools(data);
    const r = runCareer(c0.world, c0.state, base, data, pools, { until: '2027-01-31' });
    const next = nextSeason(r.world, r.state, base, data, pools);
    const eff = careerSquads(next.state, worldSquads(next.world, base));
    const small = Object.keys(next.state.clubs)
      .filter((id) => !next.state.clubInfo?.[id]?.foreign && base(id).length > 0)
      .map((id) => [id, eff(id).length] as const)
      .filter(([, n]) => n < 18);
    expect(small).toEqual([]);
  }, 180_000);

  it('clube humano fora de qualquer divisão (Real-RR) entra na divisão estadual mais baixa da UF e tem jogos', () => {
    const { world, state } = createCareer({ data, humanClubIds: ['real-rr'], season: 2026, seed: 'rr', squads: base });
    const key = Object.keys(world.stateDivisions).filter((k) => k.startsWith('RR-')).sort().pop()!;
    expect(world.stateDivisions[key]).toContain('real-rr');
    const games = state.competitions.flatMap((c) => c.fixtures).filter((f) => f.homeId === 'real-rr' || f.awayId === 'real-rr');
    expect(games.length).toBeGreaterThan(0);
  }, 60_000);
});
