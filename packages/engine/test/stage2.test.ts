/**
 * (Etapa 2) Competições reais e vagas continentais:
 *  - fase de liga da UEFA (36 clubes, 8 jogos, 2 por pote, 4 em casa e 4 fora, sem repetir adversário) e o
 *    pareamento do mata-mata (playoff 9º–24º, oitavas pela chave);
 *  - Conferência (6 jogos, 1 por pote);
 *  - Sul-Americana: playoff = 2ºs dos grupos × 3ºs da Libertadores;
 *  - AFC Champions League Elite (playoff, Oeste/Leste, oitavas por região, finais centralizadas);
 *  - formatos reais das ligas (Colômbia, Paraguai, Equador, playoffs de acesso);
 *  - carreira completa (um humano brasileiro e um inglês): competições reais de cada um, vagas gravadas na virada,
 *    playoff de rebaixamento da Bundesliga e Série B → estaduais.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { FormatDef, LeagueRules, NamePool, Player } from '@cosmicfut/shared';
import type { CareerData, Competition, Fixture, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { Rng } from '../src/rng';
import { initCompetition, progressCompetition, stageStandings } from '../src/season/format';
import { realLeagueFormat, relegationPlayoffFormat, type LeagueDivision } from '../src/season/competitions';
import { aclEliteFormat, leaguePhaseFormat, linkCompetitions, qualifyUefa } from '../src/season/confed';
import { libertadoresFormat, linkContinental, sulamericanaFormat } from '../src/season/continental';
import { swissSchedule } from '../src/season/swiss';
import { addDays } from '../src/season/schedule';
import { createCareer, worldSquads } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { advanceDay } from '../src/season/season';
import { turnoverDue } from '../src/season/timeline';
import { qualificationZones } from '../src/season/zones';
import { loadBase, loadData, loadPools } from './career-helpers';

/* ───────────── utilitários ───────────── */

const ids = (n: number, p = 'c') => Array.from({ length: n }, (_, i) => `${p}${String(i + 1).padStart(2, '0')}`);

function cal(n: number, start = '2026-09-01', step = 7): string[] {
  const out: string[] = [];
  let d = start;
  for (let i = 0; i < n; i++) { out.push(d); d = addDays(d, step); }
  return out;
}

/** Força = posição na lista (o 1º é o mais forte); zebras pela seed. */
function strengthResult(f: Fixture, order: string[], seed = 'r'): Fixture['result'] {
  const r = new Rng(`${seed}:${f.id}`);
  const sh = order.length - order.indexOf(f.homeId), sa = order.length - order.indexOf(f.awayId);
  const g = (l: number) => Math.max(0, Math.round(l + r.normal() * 0.9));
  return { home: g(1.2 + (sh - sa) * 0.05), away: g(1.0 + (sa - sh) * 0.05) };
}

function makeComp(id: string, format: FormatDef, clubIds: string[], extra: Partial<Competition> = {}, countryOf?: (id: string) => number | undefined): Competition {
  const c: Competition = { id, name: id, type: 'continental', clubIds, doubleRound: false, relegated: 0, promoted: 0, fixtures: [], format, entrants: { all: clubIds }, ...extra };
  return initCompetition(c, { seed: 's', minDate: '2026-08-01', countryOf });
}

function playAll(c: Competition, order = c.clubIds, countryOf?: (id: string) => number | undefined): void {
  let guard = 0;
  while (c.relegatedIds === undefined && guard++ < 500) {
    const pending = c.fixtures.filter((f) => !f.result).map((f) => f.date).sort();
    if (!pending.length) { progressCompetition(c, { seed: 's', minDate: '2027-12-31', countryOf }); break; }
    const day = pending[0];
    for (const f of c.fixtures.filter((x) => x.date === day && !x.result)) f.result = strengthResult(f, order);
    progressCompetition(c, { seed: 's', minDate: day, countryOf });
  }
}

/** 36 clubes em 4 potes de 9 com países (9 países × 4 clubes, um por pote). */
const UCL36 = ids(36, 'u');
const countryOf36 = (id: string) => (UCL36.indexOf(id) % 9) + 1;

/* ───────────── UEFA: fase de liga ───────────── */

describe('UEFA: fase de liga (modelo suíço)', () => {
  it('Liga dos Campeões: 36 clubes, 8 jogos, 2 por pote (1 em casa e 1 fora), 4 em casa e 4 fora, sem repetir adversário nem país', () => {
    const c = makeComp('UCL', leaguePhaseFormat('UCL', 4, 2), UCL36, { calendar: cal(17) }, countryOf36);
    const lg = c.fixtures.filter((f) => f.stageId === 'league');
    expect(lg.length).toBe(144);
    expect(new Set(lg.map((f) => f.date)).size).toBe(8);
    const potOf = (id: string) => Math.floor(UCL36.indexOf(id) / 9);
    for (const id of UCL36) {
      const mine = lg.filter((f) => f.homeId === id || f.awayId === id);
      expect(mine.length, id).toBe(8);
      expect(mine.filter((f) => f.homeId === id).length, id).toBe(4);
      const opp = mine.map((f) => (f.homeId === id ? f.awayId : f.homeId));
      expect(new Set(opp).size, id).toBe(8);
      expect(opp).not.toContain(id);
      for (let p = 0; p < 4; p++) {
        const vsPot = mine.filter((f) => potOf(f.homeId === id ? f.awayId : f.homeId) === p);
        expect(vsPot.length, `${id} × pote ${p + 1}`).toBe(2);
        expect(vsPot.filter((f) => f.homeId === id).length, `${id} × pote ${p + 1} em casa`).toBe(1);
      }
      for (const o of opp) expect(countryOf36(o), `${id} × ${o}`).not.toBe(countryOf36(id));
      // um jogo por rodada
      expect(new Set(mine.map((f) => f.date)).size, id).toBe(8);
    }
  });

  it('o sorteio é válido em 40 sementes diferentes (rodadas sempre fecham)', () => {
    for (let s = 0; s < 40; s++) {
      const rounds = swissSchedule(UCL36, 4, 2, new Rng(`seed-${s}`), countryOf36)!;
      expect(rounds.length).toBe(8);
      for (const r of rounds) expect(new Set(r.flat()).size).toBe(36);
    }
  });

  it('mata-mata: 1º–8º às oitavas, 9º–24º no playoff (9/10×23/24 …), 25º–36º fora; oitavas e quartas pela chave', () => {
    const c = makeComp('UCL', leaguePhaseFormat('UCL', 4, 2), UCL36, { calendar: cal(17) }, countryOf36);
    playAll(c, UCL36, countryOf36);
    expect(c.championId).toBeTruthy();
    const table = stageStandings(c, 'league').map((r) => r.clubId);
    const rank = (id: string) => table.indexOf(id) + 1;
    const po = c.stages!.playoff;
    expect(po.seeds.slice().sort()).toEqual(table.slice(8, 24).sort());
    const block = (r: number) => (r <= 16 ? Math.floor((r - 9) / 2) : Math.floor((24 - r) / 2));
    for (const t of po.ties!) {
      expect(rank(t.a)).toBeLessThanOrEqual(16); // cabeça de chave decide em casa
      expect(rank(t.b)).toBeGreaterThan(16);
      expect(block(rank(t.a))).toBe(block(rank(t.b)));
      expect(c.fixtures.filter((f) => f.tieId === t.id).length).toBe(2);
    }
    const ko = c.stages!.ko;
    expect(ko.seeds.length).toBe(16);
    for (const id of table.slice(24)) expect(ko.seeds).not.toContain(id);
    const r16 = ko.ties!.filter((t) => t.round === 0);
    expect(r16.length).toBe(8);
    for (const t of r16) {
      expect(rank(t.a)).toBeLessThanOrEqual(8);
      // 1/2 × vencedores de 15/16×17/18; 3/4 × de 13/14×19/20; 5/6 × de 11/12×21/22; 7/8 × de 9/10×23/24
      expect(block(rank(t.b))).toBe(3 - Math.floor((rank(t.a) - 1) / 2));
    }
    // chave: ordem 1, 8, 4, 5, 2, 7, 3, 6 e as quartas cruzam confrontos vizinhos
    expect(r16.map((t) => rank(t.a))).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const qf = ko.ties!.filter((t) => t.round === 1);
    for (let i = 0; i < 4; i++) {
      expect([qf[i].a, qf[i].b].sort()).toEqual([r16[2 * i].winner, r16[2 * i + 1].winner].sort());
    }
    const fin = c.fixtures.find((f) => f.stageId === 'ko' && f.label?.endsWith('- Final'))!;
    expect(fin.neutral).toBe(true);
    expect(c.fixtures.length).toBe(144 + 16 + 16 + 8 + 4 + 1);
  });

  it('Liga Conferência: 6 jogos (1 adversário por pote de 6), 3 em casa e 3 fora', () => {
    const c = makeComp('UECL', leaguePhaseFormat('UECL', 6, 1), UCL36, { calendar: cal(15) }, countryOf36);
    const lg = c.fixtures.filter((f) => f.stageId === 'league');
    expect(lg.length).toBe(108);
    expect(new Set(lg.map((f) => f.date)).size).toBe(6);
    const potOf = (id: string) => Math.floor(UCL36.indexOf(id) / 6);
    for (const id of UCL36) {
      const mine = lg.filter((f) => f.homeId === id || f.awayId === id);
      expect(mine.length).toBe(6);
      expect(mine.filter((f) => f.homeId === id).length).toBe(3);
      const pots = mine.map((f) => potOf(f.homeId === id ? f.awayId : f.homeId)).sort();
      expect(pots).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});

/* ───────────── CONMEBOL: Sul-Americana × Libertadores ───────────── */

describe('Sul-Americana: playoff com os 3ºs da Libertadores', () => {
  it('2ºs dos grupos da Sul-Americana × 3ºs dos grupos da Libertadores; vencedores × 1ºs nas oitavas', () => {
    const libGroups = ids(28, 'lg'), libF2 = ids(13, 'l2'), libF1 = ids(6, 'l1');
    const libAll = [...libGroups, ...libF2, ...libF1];
    const sulaGroups = ids(12, 'sg'), sulaPrelim = ids(32, 'sp');
    const sulaAll = [...sulaGroups, ...sulaPrelim];
    const libCal = cal(19, '2026-02-04'), sulaCal = cal(16, '2026-03-05');
    const lib = makeComp('LIBERTADORES', libertadoresFormat(), libAll, { calendar: libCal, entrants: { all: libAll, groups: libGroups, f2: libF2, f1: libF1 } });
    const sula = makeComp('SULAMERICANA', sulamericanaFormat(), sulaAll, { calendar: sulaCal, entrants: { all: sulaAll, groups: sulaGroups, prelim: sulaPrelim } });
    const state = { season: 2026, date: '2026-02-01', humanClubIds: [], competitions: [lib, sula], clubs: {}, news: [], seed: 's' } as unknown as SeasonState;
    const order = [...libAll, ...sulaAll];
    for (let guard = 0; guard < 400 && !(lib.relegatedIds && sula.relegatedIds); guard++) {
      const pending = [...lib.fixtures, ...sula.fixtures].filter((f) => !f.result).map((f) => f.date).sort();
      const day = pending[0] ?? '2026-12-31';
      for (const c of [lib, sula]) {
        for (const f of c.fixtures.filter((x) => x.date === day && !x.result)) f.result = strengthResult(f, order);
        progressCompetition(c, { seed: 's', minDate: day });
      }
      const added = linkContinental(state, day, null);
      if (!pending.length && !added) break;
    }
    expect(sula.championId).toBeTruthy();
    const third = lib.stages!.groups.groups!.map((g) => stageStandings(lib, 'groups', lib.stages!.groups.groups!.indexOf(g))[2].clubId);
    expect(sula.entrants!.lib3rd.slice().sort()).toEqual(third.slice().sort());
    const runners = stageStandings(sula, 'groups').length ? sula.stages!.groups.groups!.map((_, g) => stageStandings(sula, 'groups', g)[1].clubId) : [];
    const po = sula.stages!.playoff;
    expect(po.seeds.length).toBe(16);
    for (const t of po.ties!) {
      expect(runners).toContain(t.a);
      expect(third).toContain(t.b);
    }
    // perdedores da 3ª fase da Libertadores entram nos grupos da Sul-Americana
    expect(sula.entrants!.lib3.slice().sort()).toEqual((lib.stages!.f3.losers ?? []).slice().sort());
    const winners = sula.stages!.groups.groups!.map((_, g) => stageStandings(sula, 'groups', g)[0].clubId);
    for (const t of sula.stages!.ko.ties!.filter((x) => x.round === 0)) {
      expect(winners).toContain(t.a);
      expect(po.winners).toContain(t.b);
    }
  });
});

/* ───────────── AFC Champions League Elite ───────────── */

describe('AFC Champions League Elite', () => {
  it('playoff (Oeste) → Oeste/Leste com 12 cada e 8 jogos dentro da região → oitavas I/V por região → finais em jogo único', () => {
    const west = ids(11, 'w'), east = ids(12, 'e'), po = ['w12', 'wpo'];
    const all = [...west, ...po, ...east];
    const c = makeComp('ACL', aclEliteFormat(), all, {
      calendar: ['2026-08-18', ...cal(8, '2026-09-15', 14), '2027-03-02', '2027-03-09', '2027-04-17', '2027-04-21', '2027-04-25'],
      entrants: { all, west, east, po },
    });
    expect(c.fixtures.length).toBe(1);
    playAll(c, all);
    expect(c.championId).toBeTruthy();
    const lg = c.stages!.league;
    expect(lg.groups!.length).toBe(2);
    expect(lg.groups![0].length).toBe(12);
    expect(lg.groups![1]).toEqual(expect.arrayContaining(east));
    expect(lg.groups![0]).toContain(c.stages!.po.winners![0]);
    const lgf = c.fixtures.filter((f) => f.stageId === 'league');
    expect(lgf.length).toBe(96);
    const region = (id: string) => (lg.groups![0].includes(id) ? 0 : 1);
    for (const id of [...lg.groups![0], ...lg.groups![1]]) {
      const mine = lgf.filter((f) => f.homeId === id || f.awayId === id);
      expect(mine.length).toBe(8);
      expect(mine.filter((f) => f.homeId === id).length).toBe(4);
      expect(new Set(mine.map((f) => (f.homeId === id ? f.awayId : f.homeId))).size).toBe(8);
      for (const f of mine) expect(region(f.homeId)).toBe(region(f.awayId));
    }
    for (const [sid, g] of [['r16w', 0], ['r16e', 1]] as const) {
      const t = stageStandings(c, 'league', g).map((r) => r.clubId);
      for (const tie of c.stages![sid].ties!) {
        expect(t.indexOf(tie.a) + t.indexOf(tie.b)).toBe(7); // 1º×8º, 2º×7º…
        expect(c.fixtures.filter((f) => f.tieId === tie.id).length).toBe(2);
      }
    }
    const qf = c.stages!.finals.ties!.filter((t) => t.round === 0);
    expect(qf.length).toBe(4);
    for (const t of qf) expect(region(t.a)).not.toBe(region(t.b)); // Oeste × Leste
    for (const f of c.fixtures.filter((x) => x.stageId === 'finals')) expect(f.neutral).toBe(true);
    expect(c.fixtures.length).toBe(1 + 96 + 16 + 4 + 2 + 1);
  });
});

/* ───────────── ligas reais ───────────── */

describe('formatos reais das ligas', () => {
  const div = (id: string, n: number, rules: LeagueRules, relegated = rules.relegated): LeagueDivision =>
    ({ id, countryId: 1, division: Number(id.slice(-1)), name: id, divisionName: id, teams: n, doubleRound: true, relegated, promoted: 0, groups: 0, legacyFormula: 0, clubIds: ids(n), rules } as LeagueDivision);

  it('Colômbia: Apertura e Finalización (turno → cuadrangulares I/V → final I/V); 2 caem pela tabela somada', () => {
    const c = makeComp('COL-1', realLeagueFormat(div('COL-1', 20, { kind: 'col', relegated: 2, promoted: 0 }), { kind: 'col', relegated: 2, promoted: 0 }), ids(20), { type: 'league', calendar: cal(54, '2026-01-24', 6) });
    playAll(c);
    expect(c.fixtures.filter((f) => f.stageId === 'a-liga').length).toBe(190);
    expect(c.stages!['a-quad'].groups!.map((g) => g.length)).toEqual([4, 4]);
    expect(c.fixtures.filter((f) => f.stageId === 'a-quad').length).toBe(24);
    expect(c.titles!.map((t) => t.title)).toContain('Apertura');
    expect(c.championId).toBe(c.stages!['f-final'].ties![0].winner);
    expect(c.relegatedIds!.length).toBe(2);
  });

  it('Equador (LigaPro): 2ª fase com os pontos da 1ª (hexagonal do título)', () => {
    const r: LeagueRules = { kind: 'equ', relegated: 0, promoted: 0 };
    const c = makeComp('EQU-1', realLeagueFormat(div('EQU-1', 16, r), r), ids(16), { type: 'league', calendar: cal(40, '2026-02-20', 6) });
    playAll(c);
    const f1 = stageStandings(c, 'f1');
    const hex = stageStandings(c, 'hex');
    expect(hex.map((x) => x.clubId).sort()).toEqual(f1.slice(0, 6).map((x) => x.clubId).sort());
    for (const row of hex) expect(row.played).toBe(30 + 10);
    expect(c.championId).toBe(hex[0].clubId);
  });

  it('Serie B: 2 sobem direto + playoff 3º–8º (preliminar, semi e final) → 3 promovidos', () => {
    const r: LeagueRules = { kind: 'league', relegated: 0, promoted: 2, promotionPlayoff: { ranks: [3, 8], byes: 2, rounds: [{ name: 'Preliminar', legs: 1 }, { name: 'Semifinal', legs: 2 }, { name: 'Final', legs: 2 }] } };
    const c = makeComp('ITA-2', realLeagueFormat(div('ITA-2', 20, r, 0), r), ids(20), { type: 'league', calendar: cal(43, '2026-08-22', 6) });
    playAll(c);
    const t = stageStandings(c, 'league').map((x) => x.clubId);
    expect(c.stages!.playoff.seeds).toEqual(t.slice(2, 8));
    expect(c.stages!.playoff.ties!.filter((x) => x.round === 0).length).toBe(2); // 5×8 e 6×7; 3º e 4º folgam
    expect(c.promotedIds!.length).toBe(3);
    expect(c.promotedIds!.slice(0, 2)).toEqual(t.slice(0, 2));
  });

  it('Bundesliga: playoff de rebaixamento (16º × 3º da 2. Bundesliga) por repasse', () => {
    const r1: LeagueRules = { kind: 'league', relegated: 2, promoted: 0, relegationPlayoff: { rank: 16 } };
    const r2: LeagueRules = { kind: 'league', relegated: 0, promoted: 2, toRelegationPlayoff: { from: 'rank', rank: 3 } };
    const a = makeComp('ALE-1', realLeagueFormat(div('ALE-1', 18, r1), r1), ids(18, 'a'), { type: 'league', calendar: cal(34, '2026-08-28', 7), cycleSeason: 2026 });
    const b = makeComp('ALE-2', realLeagueFormat(div('ALE-2', 18, r2, 0), r2), ids(18, 'b'), { type: 'league', calendar: cal(34, '2026-08-01', 7), cycleSeason: 2026 });
    const po = makeComp('ALE-PO', relegationPlayoffFormat('ALE-PO'), [], {
      type: 'cup', calendar: ['2027-05-20', '2027-05-24'], entrants: {}, cycleSeason: 2026,
      links: [{ entrants: 'upper', from: 'ALE-1', pick: { stage: 'league', ranks: [16, 16] }, season: 2026 }, { entrants: 'lower', from: 'ALE-2', pick: { stage: 'league', ranks: [3, 3] }, season: 2026 }],
    });
    expect(po.fixtures.length).toBe(0);
    playAll(a); playAll(b);
    const state = { season: 2027, date: '2027-05-16', humanClubIds: [], competitions: [a, b, po], clubs: {}, news: [], seed: 's' } as unknown as SeasonState;
    linkCompetitions(state, '2027-05-16', null);
    const p = state.competitions.find((c) => c.id === 'ALE-PO')!;
    expect(p.entrants!.upper).toEqual([stageStandings(a, 'league')[15].clubId]);
    expect(p.entrants!.lower).toEqual([stageStandings(b, 'league')[2].clubId]);
    expect(p.fixtures.length).toBe(2);
    expect(a.relegatedIds).toEqual(stageStandings(a, 'league').slice(16).map((x) => x.clubId));
    playAll(p, [...p.entrants!.upper, ...p.entrants!.lower]);
    expect([p.entrants!.upper[0], p.entrants!.lower[0]]).toContain(p.championId);
  });
});

/* ───────────── carreira completa: humanos brasileiro e inglês ───────────── */

describe('carreira completa (Palmeiras e Arsenal): competições reais e vagas', () => {
  let data: CareerData;
  let base: (id: string) => Player[];
  let pools: Record<string, NamePool>;
  const played: Record<string, Set<string>> = { palmeiras: new Set(), arsenal: new Set() };
  const summaries: SeasonSummary[] = [];
  let worldEnd: WorldState;
  let stateEnd: SeasonState;
  let before: SeasonState;
  let createMs = 0, yearMs = 0;

  beforeAll(() => {
    data = loadData();
    base = loadBase();
    pools = loadPools(data);
    let t = performance.now();
    let { world, state } = createCareer({ data, humanClubIds: ['palmeiras', 'arsenal'], season: 2026, seed: 'stage2', squads: base, options: { light: 'all' } });
    createMs = performance.now() - t;
    t = performance.now();
    let sq = worldSquads(world, base);
    while (state.date < '2027-07-02') {
      if (turnoverDue(state)) {
        if (state.segment!.end === '2027-06-30') before = JSON.parse(JSON.stringify(state)) as SeasonState;
        const r = nextSeason(world, state, base, data, pools);
        summaries.push(r.summary);
        world = r.world; state = r.state; sq = worldSquads(world, base);
        if (state.date === '2027-01-01') yearMs = performance.now() - t;
        continue;
      }
      for (const c of state.competitions) for (const f of c.fixtures) {
        if (f.date !== state.date) continue;
        for (const h of ['palmeiras', 'arsenal']) if (f.homeId === h || f.awayId === h) played[h].add(c.id);
      }
      state = advanceDay(state, sq, {}, { inPlace: true }).state;
    }
    worldEnd = world;
    stateEnd = state;
    console.log(`[etapa 2] criação ${Math.round(createMs)} ms; 1º ano (01/01/2026 → 01/01/2027) ${Math.round(yearMs)} ms`);
  }, 600_000);

  it('cada humano joga o seu conjunto real de competições', () => {
    expect([...played.palmeiras]).toEqual(expect.arrayContaining(['EST-SP-1', 'BRA-1', 'BRA-CUP', 'LIBERTADORES']));
    expect([...played.arsenal]).toEqual(expect.arrayContaining(['ING-1', 'ING-CUP', 'ING-LCUP', 'UCL']));
    for (const id of played.palmeiras) expect(/^(ING|ESP|ITA|ALE|FRA|POR|HOL|ARS)-|^U(CL|EL|ECL)$|^ACL$/.test(id), id).toBe(false);
    for (const id of played.arsenal) expect(/^(BRA|EST|ARG|URU|COL|CHI|PAR|EQU)-|^LIBERTADORES$|^SULAMERICANA$/.test(id), id).toBe(false);
  });

  it('a virada de 30/06 grava as vagas UEFA/AFC pelas tabelas finais e elas viram os inscritos da temporada seguinte', () => {
    const split = summaries.find((s) => s.cycle === 'split' && s.seasonLabel === '2026/27')!;
    expect(split.uefa!.season).toBe(2027);
    const q = worldEnd.uefa!;
    const ing = before.competitions.find((c) => c.id === 'ING-1')!;
    const table = stageStandings(ing, 'league').map((r) => r.clubId);
    for (const id of table.slice(0, 5)) expect(q.lists.UCL, id).toContain(id);
    // repasse: copa → Liga Europa, salvo se já classificado (então a vaga desce na tabela)
    const fa = before.competitions.find((c) => c.id === 'ING-CUP')!.championId!;
    if (!table.slice(0, 5).includes(fa)) expect(q.lists.UEL).toContain(fa);
    else expect(q.lists.UEL).toContain(table[5]);
    for (const k of ['UCL', 'UEL', 'UECL']) expect(q.lists[k].length, k).toBe(36);
    const all = [...q.lists.UCL, ...q.lists.UEL, ...q.lists.UECL];
    expect(new Set(all).size).toBe(108);
    // convidados completam as vagas; campeão da Liga dos Campeões 2026/27 defende o título
    expect(q.guests.length).toBeGreaterThan(40);
    const champ = before.competitions.find((c) => c.id === 'UCL')!.championId!;
    expect(q.lists.UCL).toContain(champ);
    const ucl = stateEnd.competitions.find((c) => c.id === 'UCL' && c.cycleSeason === 2027)!;
    expect(ucl.clubIds.slice().sort()).toEqual(q.lists.UCL.slice().sort());
    // AFC: 1º e 2º da Saudi Pro League direto
    const ars = stageStandings(before.competitions.find((c) => c.id === 'ARS-1')!, 'league').map((r) => r.clubId);
    expect(worldEnd.afc!.lists.west).toEqual(expect.arrayContaining(ars.slice(0, 2)));
    expect(stateEnd.competitions.find((c) => c.id === 'ACL' && c.cycleSeason === 2027)!.clubIds).toEqual(expect.arrayContaining(ars.slice(0, 2)));
  });

  it('a qualificação é a mesma regra de qualifyUefa (determinística) e a UEFA tem 36 em cada fase de liga', () => {
    const again = qualifyUefa(data, { ...worldEnd, uefa: undefined }, 2027, {
      orders: Object.fromEntries(['ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL'].map((code) => [code, worldEnd.lastRanking[`${code}-1`]])),
    });
    expect(again.lists).toEqual(worldEnd.uefa!.lists);
    for (const id of ['UCL', 'UEL', 'UECL']) expect(before.competitions.find((c) => c.id === id)!.clubIds.length).toBe(36);
  });

  it('Bundesliga: o playoff de rebaixamento decide quem fica (16º × 3º da 2. Bundesliga)', () => {
    const split = summaries.find((s) => s.cycle === 'split' && s.seasonLabel === '2026/27')!;
    const po = split.relegationPlayoffs!.ALE;
    const a1 = stageStandings(before.competitions.find((c) => c.id === 'ALE-1')!, 'league').map((r) => r.clubId);
    const a2 = stageStandings(before.competitions.find((c) => c.id === 'ALE-2')!, 'league').map((r) => r.clubId);
    expect([po.winner, po.loser].sort()).toEqual([a1[15], a2[2]].sort());
    expect(worldEnd.divisions['ALE-1']).toContain(po.winner);
    expect(worldEnd.divisions['ALE-2']).toContain(po.loser);
    expect(split.relegated['ALE-1'].length).toBe(po.swapped ? 3 : 2);
    expect(worldEnd.divisions['ALE-1'].length).toBe(18);
  });

  it('Intercontinental 2026: campeões de cada confederação (convidados na CONCACAF/CAF/OFC) e título da Libertadores por repasse', () => {
    const cal2026 = summaries.find((s) => s.cycle === 'calendar' && s.seasonLabel === '2026')!;
    const inter = cal2026.champions.find((c) => c.competitionId === 'INTERCONTINENTAL')!;
    expect(inter.championId).toBeTruthy();
    expect(cal2026.champions.find((c) => c.competitionId === 'LIBERTADORES')!.championId).toBeTruthy();
    const guests = new Set(data.clubs.filter((c) => c.guest).map((c) => c.id));
    expect(guests.size).toBeGreaterThanOrEqual(80);
    // convidados nunca são clubes humanos e não têm liga
    for (const id of guests) expect(data.leagues.some((l) => l.clubIds.includes(id))).toBe(false);
  });

  it('zonas de vaga por liga (Vagas): Premier League 1–5 Liga dos Campeões, 18–20 rebaixamento; Série B 1–2 acesso', () => {
    const z = qualificationZones(data, 'ING-1');
    expect(z.find((x) => x.zone === 'ucl')).toMatchObject({ from: 1, to: 5 });
    expect(z.find((x) => x.zone === 'uel')).toMatchObject({ from: 6, to: 7 });
    expect(z.find((x) => x.zone === 'relegation')).toMatchObject({ from: 18, to: 20 });
    const ale = qualificationZones(data, 'ALE-1');
    expect(ale.find((x) => x.zone === 'relplayoff')).toMatchObject({ from: 16, to: 16 });
    const b = qualificationZones(data, 'BRA-2');
    expect(b.find((x) => x.zone === 'promotion')).toMatchObject({ from: 1, to: 2 });
    expect(b.find((x) => x.zone === 'promoplayoff')).toMatchObject({ from: 3, to: 6 });
    expect(b.find((x) => x.zone === 'relegation')).toMatchObject({ from: 17, to: 20 });
    expect(qualificationZones(data, 'ARS-1').map((x) => x.zone)).toEqual(['acl', 'aclpo', 'relegation']);
  });

  it('desempenho: criação e 1 ano dentro de limites razoáveis', () => {
    expect(createMs).toBeLessThan(15_000);
    expect(yearMs).toBeLessThan(90_000);
  });
});
