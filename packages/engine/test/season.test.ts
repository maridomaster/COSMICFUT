import { describe, expect, it } from 'vitest';
import type { Competition, MatchResult } from '../src/contract';
import { advanceDay, computeStandings, createSeason, fixturesOn, generateRoundRobin, nextFixtureFor } from '../src/season/index';
import { makeSquad } from './helpers';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe('generateRoundRobin', () => {
  for (const n of [2, 4, 5, 6, 7, 10, 19, 20]) {
    for (const double of [false, true]) {
      it(`${n} clubes, ${double ? 'ida e volta' : 'turno único'}`, () => {
        const clubs = ids(n);
        const games = generateRoundRobin(clubs, double, 'rr');
        const per = n % 2 === 0 ? n - 1 : n;
        const rounds = per * (double ? 2 : 1);
        expect(Math.max(...games.map((g) => g.round))).toBe(rounds);
        expect(games.length).toBe(((n * (n - 1)) / 2) * (double ? 2 : 1));
        // cada par 1 (ou 2) vezes; no returno mando invertido
        const pair = new Map<string, number>();
        const ordered = new Set<string>();
        for (const g of games) {
          const k = [g.homeId, g.awayId].sort().join('|');
          pair.set(k, (pair.get(k) ?? 0) + 1);
          if (double) {
            expect(ordered.has(`${g.homeId}>${g.awayId}`)).toBe(false);
            ordered.add(`${g.homeId}>${g.awayId}`);
          }
        }
        expect(pair.size).toBe((n * (n - 1)) / 2);
        for (const v of pair.values()) expect(v).toBe(double ? 2 : 1);
        // ninguém joga 2x na rodada
        for (let r = 1; r <= rounds; r++) {
          const seen = new Set<string>();
          for (const g of games.filter((x) => x.round === r)) {
            expect(seen.has(g.homeId) || seen.has(g.awayId)).toBe(false);
            seen.add(g.homeId); seen.add(g.awayId);
          }
        }
        // mando equilibrado (turno: diferença ≤ 1; ida e volta: igual)
        for (const c of clubs) {
          const home = games.filter((g) => g.homeId === c).length;
          const away = games.filter((g) => g.awayId === c).length;
          if (double) expect(home).toBe(away);
          else expect(Math.abs(home - away)).toBeLessThanOrEqual(1);
        }
        // returno espelhado
        if (double) {
          for (const g of games.filter((x) => x.round <= per)) {
            expect(games.some((x) => x.round === g.round + per && x.homeId === g.awayId && x.awayId === g.homeId)).toBe(true);
          }
        }
      });
    }
  }

  it('mesma seed ⇒ mesma tabela; seeds diferentes ⇒ ordem diferente', () => {
    expect(generateRoundRobin(ids(10), true, 's')).toEqual(generateRoundRobin(ids(10), true, 's'));
    expect(generateRoundRobin(ids(10), true, 's')).not.toEqual(generateRoundRobin(ids(10), true, 't'));
  });
});

describe('computeStandings', () => {
  const comp = (results: [string, string, number, number][]): Competition => ({
    id: 'T-1', name: 'Teste', type: 'league', clubIds: ['a', 'b', 'c', 'd'], doubleRound: false,
    relegated: 1, promoted: 0,
    fixtures: results.map(([h, a, hg, ag], i) => ({
      id: `T-1:${i + 1}:${h}-${a}`, competitionId: 'T-1', round: i + 1, date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      homeId: h, awayId: a, result: { home: hg, away: ag },
    })),
  });

  it('pontos, vitórias, saldo, gols pró e forma', () => {
    const t = computeStandings(comp([
      ['a', 'b', 2, 0], ['c', 'd', 1, 1], ['a', 'c', 0, 1], ['b', 'd', 3, 3], ['d', 'a', 0, 0],
    ]));
    expect(t.map((r) => r.clubId)).toEqual(['c', 'a', 'd', 'b']);
    const a = t.find((r) => r.clubId === 'a')!;
    expect([a.played, a.won, a.drawn, a.lost, a.goalsFor, a.goalsAgainst, a.points]).toEqual([3, 1, 1, 1, 2, 1, 4]);
    expect(a.form).toEqual(['W', 'L', 'D']);
  });

  it('vitórias desempatam antes do saldo', () => {
    // a: V 1x0, D 0x5 → 3 pts 1V saldo -4 ; b: 3 empates → 3 pts 0V saldo 0
    const t = computeStandings(comp([['a', 'c', 1, 0], ['a', 'd', 0, 5], ['b', 'c', 0, 0], ['b', 'd', 1, 1], ['b', 'a', 2, 2]]));
    const ia = t.findIndex((r) => r.clubId === 'a'), ib = t.findIndex((r) => r.clubId === 'b');
    expect(t[ia].points).toBe(4);
    expect(t[ib].points).toBe(3);
    const t2 = computeStandings(comp([['a', 'c', 1, 0], ['a', 'd', 0, 5], ['b', 'c', 0, 0], ['b', 'd', 1, 1], ['c', 'b', 0, 0]]));
    const ra = t2.find((r) => r.clubId === 'a')!, rb = t2.find((r) => r.clubId === 'b')!;
    expect(ra.points).toBe(3);
    expect(rb.points).toBe(3);
    expect(t2.indexOf(ra)).toBeLessThan(t2.indexOf(rb));
  });

  it('confronto direto como critério opcional', () => {
    // a e b idênticos nos 4 critérios; b venceu o confronto direto
    const c = comp([['a', 'c', 2, 1], ['b', 'a', 1, 0], ['d', 'b', 2, 1], ['a', 'd', 1, 1], ['b', 'c', 1, 1]]);
    const t = computeStandings(c);
    const ia = t.findIndex((r) => r.clubId === 'a'), ib = t.findIndex((r) => r.clubId === 'b');
    expect(t[ia].points).toBe(t[ib].points);
    expect(ib).toBeLessThan(ia);
    const noH2h = computeStandings(c, { headToHead: false });
    expect(noH2h.findIndex((r) => r.clubId === 'a')).toBeLessThan(noH2h.findIndex((r) => r.clubId === 'b'));
  });
});

describe('temporada', () => {
  const clubs = ids(6);
  const squads = new Map(clubs.map((c, i) => [c, makeSquad(c, 70 + i)]));
  const sq = (id: string) => squads.get(id)!;
  const mk = (cal?: string[]) =>
    createSeason({
      season: 2026, startDate: '2026-01-01',
      divisions: [{ id: 'BRA-1', name: 'Liga', clubIds: clubs, doubleRound: true, relegated: 1, promoted: 0 }],
      calendarDates: cal, humanClubIds: ['c0'],
      clubBalances: Object.fromEntries(clubs.map((c) => [c, 1_000_000])),
      seed: 'temp',
      clubInfo: Object.fromEntries(clubs.map((c) => [c, { capacity: 20000, reputation: 3, sponsorPerSeason: 1_200_000, name: c.toUpperCase() }])),
    });

  it('datas do calendário no ano da temporada, ou semanais', () => {
    const cal = ['01-28', '02-04', '02-09', '02-26', '03-11', '03-15', '03-18', '03-22', '04-01', '04-05', '04-12', '04-19'];
    const s = mk(cal);
    const dates = [...new Set(s.competitions[0].fixtures.map((f) => f.date))].sort();
    expect(dates).toHaveLength(10);
    expect(dates.every((d) => d.startsWith('2026-'))).toBe(true);
    const w = mk();
    const wd = [...new Set(w.competitions[0].fixtures.map((f) => f.date))].sort();
    expect(wd[0]).toBe('2026-01-08');
    expect(wd[1]).toBe('2026-01-15');
  });

  it('nextFixtureFor / fixturesOn', () => {
    const s = mk();
    const nf = nextFixtureFor(s, 'c3')!;
    expect(nf.homeId === 'c3' || nf.awayId === 'c3').toBe(true);
    expect(fixturesOn(s, nf.date)).toHaveLength(3);
    expect(nextFixtureFor(s, '')!.date).toBe(nf.date);
  });

  it('advanceDay: salários no dia 1, jogos, resultado humano, data avança, não muta a entrada', () => {
    let s = mk();
    const before = JSON.stringify(s);
    const r1 = advanceDay(s, sq);
    expect(JSON.stringify(s)).toBe(before);
    expect(r1.state.date).toBe('2026-01-02');
    const wages = sq('c1').reduce((a, p) => a + p.wage, 0);
    expect(r1.state.clubs.c1.balance).toBe(1_000_000 - wages + 100_000 + Math.round(1.6e6 / 12));
    expect(r1.state.clubs.c1.finance!.wages).toBe(-wages);
    s = r1.state;
    // avança até a 1ª rodada, informando o resultado do humano
    const nf = nextFixtureFor(s, 'c0')!;
    while (s.date < nf.date) s = advanceDay(s, sq).state;
    const fake: MatchResult = {
      homeGoals: 4, awayGoals: 0, winner: 'home', scorers: [], cards: [], injuries: [], ratings: {},
      stats: s as never, attendance: 15000,
    };
    const r = advanceDay(s, sq, { [nf.id]: fake });
    expect(r.played).toHaveLength(3);
    const f = r.state.competitions[0].fixtures.find((x) => x.id === nf.id)!;
    expect(f.result).toEqual({ home: 4, away: 0 });
    expect(r.played.every((p) => p.fixture.result)).toBe(true);
    const winner = nf.homeId;
    expect(r.state.clubs[winner].morale).toBeGreaterThan(s.clubs[winner].morale);
    expect(r.state.clubs[nf.homeId].finance!.tickets).toBeGreaterThan(0);
    expect(r.state.news.some((n) => n.text.includes('4 x 0'))).toBe(true);
  });

  it('lesões contam em dias, suspensões por cartões e fitness recupera', () => {
    let s = mk();
    const nf = nextFixtureFor(s, 'c0')!;
    while (s.date < nf.date) s = advanceDay(s, sq).state;
    const homeP = sq(nf.homeId);
    const injured = homeP[3].id, redP = homeP[6].id, yel = homeP[7].id, tired = homeP[8].id;
    // (Atualização 38) amarelos/suspensões por competição
    s.clubs[nf.homeId].cards = { 'BRA-1': { [yel]: 2 } };
    const fake: MatchResult = {
      homeGoals: 1, awayGoals: 1, winner: 'draw', scorers: [], ratings: {},
      cards: [{ side: 'home', playerId: redP, minute: 30, color: 'red' }, { side: 'home', playerId: yel, minute: 40, color: 'yellow' }],
      injuries: [{ side: 'home', playerId: injured, minute: 10, days: 30 }],
      stats: s as never, attendance: 1000,
      appearances: { home: [tired], away: [] }, fitnessAfter: { [tired]: 60 },
    };
    let r = advanceDay(s, sq, { [nf.id]: fake }).state;
    const club = r.clubs[nf.homeId];
    expect(club.injuries[injured]).toBe(30);
    expect(club.bans!['BRA-1'][redP]).toBeGreaterThanOrEqual(1);
    expect(club.bans!['BRA-1'][redP]).toBeLessThanOrEqual(2);
    expect(club.bans!['BRA-1'][yel]).toBe(1);
    expect(club.cards?.['BRA-1']?.[yel] ?? 0).toBe(0);
    expect(club.fitness[tired]).toBe(60);
    r = advanceDay(r, sq).state;
    expect(r.clubs[nf.homeId].injuries[injured]).toBe(29);
    // (Atualização 38) recuperação 60 → 70,8 (antes +9 fixo ⇒ 69)
    expect(r.clubs[nf.homeId].fitness[tired]).toBe(70.8);
    // no próximo jogo do clube os suspensos/lesionados não jogam e a suspensão é cumprida
    const next = nextFixtureFor(r, nf.homeId)!;
    while (r.date < next.date) r = advanceDay(r, sq).state;
    const out = advanceDay(r, sq);
    const played = out.played.find((p) => p.fixture.id === next.id)!;
    const side = next.homeId === nf.homeId ? 'home' : 'away';
    expect(played.result.appearances![side]).not.toContain(yel);
    expect(played.result.appearances![side]).not.toContain(injured);
    expect(out.state.clubs[nf.homeId].bans?.['BRA-1']?.[yel]).toBeUndefined();
  });

  it('temporada completa: todos os jogos, premiação e campeão', () => {
    let s = mk();
    let guard = 0;
    while (s.competitions[0].fixtures.some((f) => !f.result) && guard++ < 400) s = advanceDay(s, sq).state;
    expect(s.competitions[0].finished).toBe(true);
    const t = computeStandings(s.competitions[0]);
    expect(t.every((r) => r.played === 10)).toBe(true);
    expect(s.news.some((n) => n.text.includes('campeão'))).toBe(true);
    expect(s.clubs[t[0].clubId].finance!.prizes).toBeGreaterThan(s.clubs[t[5].clubId].finance!.prizes);
  });
});
