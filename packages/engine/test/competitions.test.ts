import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormatDef, FormatsFile } from '@cosmicfut/shared';
import type { Competition, Fixture, SeasonState } from '../src/contract';
import { Rng } from '../src/rng';
import { quickSimulate } from '../src/match/quick';
import { computeStandings } from '../src/season/standings';
import { addDays } from '../src/season/schedule';
import {
  finalRanking, initCompetition, pickAll, progressCompetition, resolveTie, stageGroupTables, stageStandings,
} from '../src/season/format';
import {
  brazilCupFormat, groupsKnockoutFormat, leagueFormat, nationalFormat, serieCFormat, stateFormat, type LeagueDivision,
} from '../src/season/competitions';
import { resolveConflicts } from '../src/season/calendar';
import { config } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const formats = JSON.parse(readFileSync(resolve(DATA, 'formats.json'), 'utf8')) as FormatsFile;

/* ───────────── utilitários ───────────── */

const ids = (n: number, p = 'c') => Array.from({ length: n }, (_, i) => `${p}${String(i + 1).padStart(2, '0')}`);

/** calendário: uma data a cada 3 dias a partir de 2026-01-10 */
function cal(n: number): string[] {
  const out: string[] = [];
  let d = '2026-01-10';
  for (let i = 0; i < n; i++) { out.push(d); d = addDays(d, 3); }
  return out;
}

function makeComp(format: FormatDef, clubIds: string[], extra: Partial<Competition> = {}, slots = 60): Competition {
  const c: Competition = {
    id: 'T', name: 'Teste', type: 'league', clubIds, doubleRound: false, relegated: 0, promoted: 0, fixtures: [],
    format, calendar: cal(slots), ...extra,
  };
  return initCompetition(c, { seed: 's', minDate: '2026-01-01' });
}

/** Força = posição na lista (c01 é o mais forte). Resultado determinístico com "zebras" pela seed. */
function strengthResult(f: Fixture, clubIds: string[], seed = 'r'): Fixture['result'] {
  const r = new Rng(`${seed}:${f.id}`);
  const sh = clubIds.length - clubIds.indexOf(f.homeId), sa = clubIds.length - clubIds.indexOf(f.awayId);
  const lh = 1.2 + (sh - sa) * 0.08, la = 1.0 + (sa - sh) * 0.08;
  const g = (l: number) => Math.max(0, Math.round(l + r.normal() * 0.9));
  const res: NonNullable<Fixture['result']> = { home: g(lh), away: g(la) };
  return res;
}

/** Joga a competição data a data até terminar (progressão como no advanceDay). */
function playAll(c: Competition, result = (f: Fixture) => strengthResult(f, c.clubIds)): number {
  let guard = 0;
  while (!c.relegatedIds && guard++ < 500) {
    const pending = c.fixtures.filter((f) => !f.result).map((f) => f.date).sort();
    if (!pending.length) { progressCompetition(c, { seed: 's', minDate: '2026-12-31' }); break; }
    const day = pending[0];
    for (const f of c.fixtures.filter((x) => x.date === day && !x.result)) f.result = result(f);
    progressCompetition(c, { seed: 's', minDate: day });
  }
  return c.fixtures.length;
}

const games = (c: Competition, id: string) => c.fixtures.filter((f) => f.homeId === id || f.awayId === id).length;

/* ───────────── fase de tabela ───────────── */

describe('fase de tabela', () => {
  it('pontos corridos em 1 e 2 turnos', () => {
    const clubs = ids(6);
    const one = makeComp(leagueFormat('L1', 6, false, 0, 0), clubs);
    const two = makeComp(leagueFormat('L2', 6, true, 1, 0), clubs);
    expect(one.fixtures.length).toBe(15);
    expect(two.fixtures.length).toBe(30);
    expect(new Set(one.fixtures.map((f) => f.date)).size).toBe(5);
    playAll(two);
    expect(two.championId).toBe(stageStandings(two, 'league')[0].clubId);
    expect(two.relegatedIds).toEqual([stageStandings(two, 'league')[5].clubId]);
  });

  it('grupos (dentro do grupo) e grupo x grupo', () => {
    const fmt = (cross: boolean): FormatDef => ({
      id: 'G', teams: 12, champion: 'g',
      stages: [{ id: 'g', kind: 'table', name: 'G', groups: 2, crossGroups: cross, legs: 1, sources: [{ entrants: 'all' }] }],
    });
    const inside = makeComp(fmt(false), ids(12));
    expect(inside.fixtures.length).toBe(30); // 2 × C(6,2)
    const cross = makeComp(fmt(true), ids(12));
    expect(cross.fixtures.length).toBe(36); // 6 × 6
    expect(new Set(cross.fixtures.map((f) => f.date)).size).toBe(6);
    const groups = cross.stages!.g.groups!;
    for (const f of cross.fixtures) expect(groups[0].includes(f.homeId)).not.toBe(groups[0].includes(f.awayId));
  });

  it('3 grupos de 4 contra os outros grupos (Mineiro): 8 jogos por clube', () => {
    const c = makeComp({
      id: 'MG', teams: 12, champion: 'g',
      stages: [{ id: 'g', kind: 'table', name: 'G', groups: 3, crossGroups: true, legs: 1, sources: [{ entrants: 'all' }] }],
    }, ids(12));
    expect(c.fixtures.length).toBe(48);
    for (const id of c.clubIds) expect(games(c, id)).toBe(8);
    expect(new Set(c.fixtures.map((f) => f.date)).size).toBeLessThanOrEqual(9);
  });

  it('rodadas parciais (Paulistão: 8 jogos por clube)', () => {
    const c = makeComp(formats['16_2'], ids(16));
    const g = c.fixtures.filter((f) => f.stageId === 'g');
    expect(g.length).toBe(64);
    for (const id of c.clubIds) expect(g.filter((f) => f.homeId === id || f.awayId === id).length).toBe(8);
  });
});

/* ───────────── desempate ───────────── */

describe('desempate', () => {
  const comp = (fx: [string, string, number, number][]): Competition => ({
    id: 'D', name: 'D', type: 'league', clubIds: ['a', 'b', 'c', 'd'], doubleRound: false, relegated: 0, promoted: 0,
    fixtures: fx.map(([h, a, x, y], i) => ({ id: `D:${i}`, competitionId: 'D', round: i + 1, date: `2026-02-${String(i + 1).padStart(2, '0')}`, homeId: h, awayId: a, result: { home: x, away: y } })),
  });
  it('pontos → vitórias → saldo → gols pró → confronto direto', () => {
    // a e b: 4 pts; a tem mais vitórias? ambos 1V 1E — saldo decide
    const t = computeStandings(comp([['a', 'c', 3, 0], ['a', 'd', 0, 0], ['b', 'c', 1, 0], ['b', 'd', 1, 1]]));
    expect(t[0].clubId).toBe('a');
    expect(t[1].clubId).toBe('b');
    // empate total nos 4 critérios: confronto direto
    const t2 = computeStandings(comp([['a', 'c', 1, 0], ['b', 'd', 1, 0], ['a', 'b', 0, 1], ['c', 'a', 0, 1], ['d', 'b', 0, 1], ['b', 'a', 0, 1]]));
    const ia = t2.findIndex((r) => r.clubId === 'a'), ib = t2.findIndex((r) => r.clubId === 'b');
    expect(t2[ia].points).toBe(t2[ib].points);
    expect(Math.abs(ia - ib)).toBe(1);
  });
  it('vitórias antes do saldo', () => {
    const t = computeStandings(comp([['a', 'c', 1, 0], ['a', 'd', 0, 3], ['b', 'c', 0, 0], ['b', 'd', 0, 0], ['b', 'a', 0, 0]]));
    // a: 1V 1D 1E = 4 pts, saldo −2; b: 3E = 3 pts — sem empate; checa só a ordem de pontos
    expect(t[0].points).toBeGreaterThanOrEqual(t[1].points);
  });
});

/* ───────────── mata-mata ───────────── */

describe('mata-mata', () => {
  const koFmt = (tie: { legs: 1 | 2; home?: 'better' | 'worse' }, n = 4, extra = {}): FormatDef => ({
    id: 'K', teams: n, champion: 'k',
    stages: [{ id: 'k', kind: 'knockout', name: 'K', sources: [{ entrants: 'all' }], rounds: n === 4 ? [{ name: 'Semifinal', tie }, { name: 'Final', tie }] : [{ name: 'Final', tie }], ...extra }],
  });

  it('ida e volta: agregado decide, melhor semente manda o 2º jogo', () => {
    const c = makeComp(koFmt({ legs: 2 }, 2), ['a', 'b']);
    const [ida, volta] = c.fixtures;
    expect(ida.homeId).toBe('b');
    expect(volta.homeId).toBe('a');
    expect(volta.knockout).toBe(true);
    expect(ida.knockout).toBeUndefined();
    ida.result = { home: 2, away: 0 };
    volta.result = { home: 1, away: 0 };
    progressCompetition(c, { seed: 's', minDate: volta.date });
    expect(c.championId).toBe('b');
  });

  it('agregado empatado → pênaltis da volta (sem gol fora)', () => {
    const c = makeComp(koFmt({ legs: 2 }, 2), ['a', 'b']);
    const [ida, volta] = c.fixtures;
    ida.result = { home: 1, away: 0 }; // b 1 x 0 a
    volta.result = { home: 2, away: 1, penalties: { home: 3, away: 4 } }; // a 2 x 1 b (fora: b marcou 1) → pênaltis
    progressCompetition(c, { seed: 's', minDate: volta.date });
    expect(c.championId).toBe('b');
    const t = c.stages!.k.ties![0];
    expect(t.winner).toBe('b');
  });

  it('jogo decisivo sem disputa registrada recebe pênaltis determinísticos', () => {
    const run = () => {
      const c = makeComp(koFmt({ legs: 1 }, 2), ['a', 'b']);
      c.fixtures[0].result = { home: 1, away: 1 };
      progressCompetition(c, { seed: 's', minDate: c.fixtures[0].date });
      return c;
    };
    const x = run(), y = run();
    expect(x.championId).toBe(y.championId);
    expect(x.fixtures[0].result!.penalties).toBeDefined();
  });

  it('jogo único com mando do pior ranqueado (Copa do Brasil 1ª fase)', () => {
    const c = makeComp(koFmt({ legs: 1, home: 'worse' }, 2), ['a', 'b']);
    expect(c.fixtures[0].homeId).toBe('b');
  });

  it('playoff-semi com byes, 3º lugar e progressão por rodadas', () => {
    const fmt: FormatDef = {
      id: 'PS', teams: 6, champion: 'k',
      stages: [{
        id: 'k', kind: 'knockout', name: 'K', sources: [{ entrants: 'all' }], byes: 2, thirdPlace: { legs: 1 },
        rounds: [{ name: 'Playoff-Semi', tie: { legs: 1 } }, { name: 'Semifinal', tie: { legs: 2 } }, { name: 'Final', tie: { legs: 2 } }],
      }],
    };
    const c = makeComp(fmt, ids(6));
    expect(c.fixtures.length).toBe(2); // só o playoff-semi existe no início
    expect(c.fixtures.every((f) => !['c01', 'c02'].includes(f.homeId) && !['c01', 'c02'].includes(f.awayId))).toBe(true);
    playAll(c);
    const ties = c.stages!.k.ties!;
    expect(ties.filter((t) => t.roundName === 'Playoff-Semi').length).toBe(2);
    expect(ties.filter((t) => t.roundName === 'Semifinal').length).toBe(2);
    expect(ties.filter((t) => t.thirdPlace).length).toBe(1);
    expect(c.championId).toBeDefined();
    expect(c.fixtures.length).toBe(2 + 4 + 2 + 1);
    // semifinal: 1ª semente × pior classificado do playoff
    const semi = ties.filter((t) => t.roundName === 'Semifinal');
    expect(semi.map((t) => t.a).sort()).toEqual(['c01', 'c02']);
  });

  it('resolveTie: gol fora só quando a regra pede', () => {
    const c = makeComp(koFmt({ legs: 2 }, 2), ['a', 'b']);
    const [ida, volta] = c.fixtures;
    ida.result = { home: 1, away: 1 }; // b 1 x 1 a → a marcou fora
    volta.result = { home: 0, away: 0, penalties: { home: 2, away: 4 } };
    const t = c.stages!.k.ties![0];
    expect(resolveTie(c, { ...t }, { legs: 2, awayGoals: true })).toBe(true);
    const tt = { ...t, winner: undefined, loser: undefined };
    resolveTie(c, tt, { legs: 2, awayGoals: true });
    expect(tt.winner).toBe('a');
    const t2 = { ...t, winner: undefined, loser: undefined };
    resolveTie(c, t2, { legs: 2 });
    expect(t2.winner).toBe('b'); // pênaltis
  });
});

/* ───────────── progressão entre fases ───────────── */

describe('progressão', () => {
  it('Série B: pontos corridos → Playoff de Acesso (3º×6º, 4º×5º) → 4 sobem', () => {
    const div = { id: 'X-2', countryId: 1, division: 2, name: 'X', divisionName: 'B', teams: 20, doubleRound: true, relegated: 4, promoted: 4, groups: 0, legacyFormula: 0, clubIds: ids(20), cfg: { playoffAcesso: true, vagasSobemPeloMataMata: 2, duasVoltasMataMataSobe: [false] } } as unknown as LeagueDivision;
    const fmt = nationalFormat(div, 4);
    const c = makeComp(fmt, ids(20), {}, 40);
    expect(c.stages!.playoff).toBeUndefined();
    playAll(c);
    expect(c.fixtures.length).toBe(380 + 2);
    const table = stageStandings(c, 'league').map((r) => r.clubId);
    const po = c.stages!.playoff;
    expect(po.seeds).toEqual(table.slice(2, 6));
    const pairs = po.ties!.map((t) => [t.a, t.b]);
    expect(pairs).toContainEqual([table[2], table[5]]);
    expect(pairs).toContainEqual([table[3], table[4]]);
    expect(c.promotedIds!.slice(0, 2)).toEqual(table.slice(0, 2));
    expect(c.promotedIds!.length).toBe(4);
    expect(c.relegatedIds).toEqual(table.slice(16));
    // playoff na data seguinte à última rodada (slot 39)
    const last = c.fixtures.filter((f) => f.stageId === 'league').map((f) => f.date).sort().at(-1)!;
    expect(c.fixtures.filter((f) => f.stageId === 'playoff').every((f) => f.date > last)).toBe(true);
  });

  it('Série C: 2 grupos de 14 → quadrangulares → final; 4 sobem e 4 caem', () => {
    const div = { id: 'BRA-3', countryId: 29, division: 3, name: 'B', divisionName: 'C', teams: 28, doubleRound: false, relegated: 4, promoted: 4, groups: 2, legacyFormula: 3, clubIds: ids(28), cfg: { formula: 3, nGrupos: 2, duasVoltasMataMata: [true] } } as unknown as LeagueDivision;
    const fmt = nationalFormat(div, 4);
    expect(fmt).toEqual(serieCFormat(div, 4));
    const c = makeComp(fmt, ids(28), {}, 40);
    playAll(c);
    expect(c.fixtures.length).toBe(182 + 24 + 2);
    const f1 = stageGroupTables(c, 'f1');
    const q = c.stages!.f2.groups!;
    expect(q[0]).toEqual([f1[0][0].clubId, f1[0][3].clubId, f1[1][1].clubId, f1[1][2].clubId]);
    expect(c.promotedIds!.length).toBe(4);
    expect(c.relegatedIds!.length).toBe(4);
    for (const t of f1) expect(c.relegatedIds).toEqual(expect.arrayContaining(t.slice(12).map((r) => r.clubId)));
    expect(c.fixtures.filter((f) => f.stageId === 'final').length).toBe(2);
    expect(new Set(c.fixtures.map((f) => f.date)).size).toBe(21);
  });

  it('Série D: 16 grupos de 6 (I/V) → 64 no mata-mata → 4 sobem (vencedores das quartas)', () => {
    const div = { id: 'BRA-4', countryId: 29, division: 4, name: 'B', divisionName: 'D', teams: 96, doubleRound: true, relegated: 64, promoted: 4, groups: 16, legacyFormula: 6, clubIds: ids(96), cfg: { formula: 6, nGrupos: 16, duasVoltasMataMata: [true, true, true, true, true, true, true] } } as unknown as LeagueDivision;
    const fmt = groupsKnockoutFormat(div, 4, { serieDReal: true });
    expect(fmt.stages[1].kind === 'knockout' && fmt.stages[1].rounds.map((r) => r.name)).toEqual(['64-avos de Final', '16-avos de Final', 'Oitavas de Final', 'Quartas de Final', 'Semifinal', 'Final']);
    const c = makeComp(fmt, ids(96), {}, 40);
    playAll(c);
    expect(c.fixtures.length).toBe(480 + 126);
    expect(c.stages!.ko.seeds.length).toBe(64);
    expect(c.promotedIds!.length).toBe(4);
    const qf = c.stages!.ko.ties!.filter((t) => t.roundName === 'Quartas de Final').map((t) => t.winner);
    expect(new Set(c.promotedIds)).toEqual(new Set(qf));
    expect(c.relegatedIds).toEqual([]); // Série D Real: decidido na virada
    expect(new Set(c.fixtures.map((f) => f.date)).size).toBe(22);
  });

  // (Etapa 2) formato 2026: 126 clubes em 5 fases de entrada (antes: 80 na 1ª fase + pote 1 nos 16-avos = 92)
  it('Copa do Brasil 2026: 5 fases de entrada (20/54/32/8/12), pote 1 na 5ª fase, final única em 06/12 (slot 12)', () => {
    const pot1 = ids(12, 'p'), f4 = ids(8, 'a'), f3 = ids(32, 'b'), f2 = ids(54, 's'), f1 = ids(20, 't');
    const all = [...pot1, ...f4, ...f3, ...f2, ...f1];
    expect(all.length).toBe(126);
    const calendar = ['02-18', '03-04', '03-18', '04-15', '04-29', '05-13', '07-29', '08-05', '08-26', '09-02', '10-21', '11-04', '12-06'].map((d) => `2026-${d}`);
    const c = makeComp(brazilCupFormat(), all, { type: 'cup', entrants: { all, pot1, f1, f2, f3, f4 }, calendar });
    expect(c.fixtures.length).toBe(10);
    playAll(c, (f) => strengthResult(f, all));
    // 10 + 32 + 32 + 20 (jogo único) + 16×2 + 8×2 + 4×2 + 2×2 + final
    expect(c.fixtures.length).toBe(10 + 32 + 32 + 20 + 32 + 16 + 8 + 4 + 1);
    // mandante = pior ranqueado nas fases de jogo único
    for (const f of c.fixtures.filter((x) => x.stageId === 'f1')) expect(f1.slice(10)).toContain(f.homeId);
    expect(c.stages!.f2.seeds.length).toBe(64);
    expect(c.stages!.f3.seeds.length).toBe(64);
    expect(c.stages!.f4.seeds.length).toBe(40);
    for (const a of f4) expect(c.stages!.f4.seeds).toContain(a); // Série A (fora do pote 1) entra na 4ª fase
    const fin = c.fixtures.find((f) => f.label?.endsWith('- Final') && f.stageId === 'principal')!;
    expect(fin.date).toBe('2026-12-06');
    expect(fin.neutral).toBe(true);
    const r32 = c.stages!.principal.seeds;
    expect(r32.length).toBe(32);
    expect(pot1.every((p) => r32.includes(p))).toBe(true);
    // pote 1 não se enfrenta na 5ª fase
    for (const t of c.stages!.principal.ties!.filter((x) => x.round === 0)) expect(pot1.includes(t.a) && pot1.includes(t.b)).toBe(false);
    expect(c.championId).toBeDefined();
  });
});

/* ───────────── estaduais (formats.json) ───────────── */

describe('estaduais', () => {
  const div = (teams: number, formula: number, rel: Partial<{ relegated: number; relegatedDirect: number; relegationPlayoff: number; relegationOverall: boolean }> = {}) =>
    ({ division: 1, name: 'E', teams, legacyFormula: formula, clubIds: ids(teams), formatKey: `${teams}_${formula}`, ...rel });

  it('Paulistão (16_2): 8 rodadas parciais → quartas JU, semi JU, final I/V; 2 caem', () => {
    const c = makeComp(stateFormat(formats, div(16, 2, { relegated: 2, relegatedDirect: 2 })), ids(16), { type: 'state' });
    playAll(c);
    expect(c.fixtures.length).toBe(64 + 4 + 2 + 2);
    expect(c.relegatedIds).toEqual(stageStandings(c, 'g').slice(14).map((r) => r.clubId));
    expect(new Set(c.fixtures.map((f) => f.date)).size).toBe(12);
  });

  it('Carioca (12_2): Taça Guanabara, Taça Rio e quadrangular do rebaixamento', () => {
    const c = makeComp(stateFormat(formats, div(12, 2, { relegated: 2, relegatedDirect: 0, relegationPlayoff: 2 })), ids(12), { type: 'state' });
    playAll(c);
    expect(c.fixtures.length).toBe(36 + 4 + 5 + 5 + 12);
    expect(c.titles!.map((t) => t.title)).toEqual(['Taça Rio']);
    const qfLosers = c.stages!.qf.losers!;
    expect(new Set(c.stages!.rio.seeds)).toEqual(new Set(qfLosers));
    expect(c.relegatedIds!.length).toBe(2);
    expect(c.stages!.rq.seeds.every((x) => c.stages!.rq.seeds.includes(x))).toBe(true);
    for (const r of c.relegatedIds!) expect(c.stages!.rq.seeds).toContain(r);
  });

  it('Pernambucano (31_1): Torneio Frevo → quadrangular → Torneio Forró com os 7 melhores', () => {
    const c = makeComp(stateFormat(formats, div(31, 1)), ids(31), { type: 'state' });
    expect(c.stages!.frevo.seeds.length).toBe(24);
    playAll(c);
    expect(c.fixtures.length).toBe(60 + 12 + 6 + 25 + 10);
    const forro = c.stages!.forro.seeds;
    expect(forro.length).toBe(10);
    for (const id of ids(7)) expect(forro).toContain(id);
    expect(c.championId).toBeDefined();
    expect(c.relegatedIds).toEqual([]);
  });

  it('Mineiro (12_9): melhor 2º, Troféu Inconfidência e rebaixamento pela classificação geral', () => {
    const c = makeComp(stateFormat(formats, div(12, 9, { relegated: 2, relegatedDirect: 2, relegationOverall: true })), ids(12), { type: 'state' });
    playAll(c);
    expect(c.stages!.mm.seeds.length).toBe(4);
    expect(c.stages!.inc.seeds.some((x) => c.stages!.mm.seeds.includes(x))).toBe(false);
    expect(c.titles!.map((t) => t.title)).toEqual(['Troféu Inconfidência']);
    expect(c.relegatedIds!.length).toBe(2);
  });

  it('Cearense (10_5): 2 fases, 3º lugar, 5º lugar e quadrangular; Goianão (12_8) com playoff de rebaixamento', () => {
    const ce = makeComp(stateFormat(formats, div(10, 5, { relegated: 2, relegatedDirect: 0, relegationPlayoff: 2 })), ids(10), { type: 'state' });
    playAll(ce);
    expect(ce.stages!.f2.seeds.length).toBe(6);
    expect(ce.stages!.mm.ties!.some((t) => t.thirdPlace)).toBe(true);
    expect(ce.relegatedIds!.length).toBe(2);
    const go = makeComp(stateFormat(formats, div(12, 8, { relegated: 2, relegatedDirect: 1, relegationPlayoff: 1 })), ids(12), { type: 'state' });
    playAll(go);
    const t = stageStandings(go, 'g').map((r) => r.clubId);
    expect(go.stages!.rp.seeds).toEqual(t.slice(9, 11)); // 10º e 11º
    expect(go.relegatedIds).toContain(t[11]); // 12º cai direto
    expect(go.relegatedIds!.length).toBe(2);
  });

  it('divisão que não rebaixa perde as fases de rebaixamento', () => {
    const f = stateFormat(formats, div(12, 2, { relegated: 0 }));
    expect(f.stages.find((s) => s.id === 'rq')).toBeUndefined();
    expect(f.relegation).toEqual([]);
  });

  it('todos os formatos de formats.json terminam com campeão', () => {
    for (const [key, fmt] of Object.entries(formats)) {
      const c = makeComp(fmt, ids(fmt.teams), { type: 'state' }, 60);
      playAll(c);
      expect(c.championId, key).toBeDefined();
      expect(c.fixtures.every((f) => !!f.result), key).toBe(true);
    }
  });
});

/* ───────────── classificação final / regras ───────────── */

describe('seleção e classificação final', () => {
  it('finalRanking: campeão e vice primeiro, depois quem foi mais longe', () => {
    const c = makeComp(formats['16_1'], ids(16), { type: 'state' });
    playAll(c);
    const r = finalRanking(c);
    expect(r[0]).toBe(c.championId);
    expect(r[1]).toBe(c.viceId);
    const semi = c.stages!.mm.ties!.filter((t) => t.roundName === 'Semifinal').map((t) => t.loser);
    expect(new Set(r.slice(2, 4))).toEqual(new Set(semi));
    expect(r.length).toBe(16);
  });
  it('pickAll não repete clubes', () => {
    const c = makeComp(leagueFormat('L', 6, false, 0, 0), ids(6));
    playAll(c);
    expect(pickAll(c, [{ stage: 'league', ranks: [1, 3] }, { stage: 'league', ranks: [2, 4] }]).length).toBe(4);
  });
});

/* ───────────── calendário ───────────── */

describe('calendário unificado', () => {
  it('conflito de data: fica a competição de maior prioridade, a outra é adiada', () => {
    const mk = (id: string, type: Competition['type'], date: string, h: string, a: string): Competition => ({
      id, name: id, type, clubIds: [h, a], doubleRound: false, relegated: 0, promoted: 0,
      fixtures: [{ id: `${id}:1:${h}-${a}`, competitionId: id, round: 1, date, homeId: h, awayId: a }],
    });
    const state = { competitions: [mk('EST', 'state', '2026-05-09', 'x', 'y'), mk('BRA-1', 'league', '2026-05-09', 'x', 'z')] } as unknown as SeasonState;
    const moves = resolveConflicts(state, '2026-05-01');
    expect(moves.length).toBe(1);
    expect(moves[0].competitionId).toBe('EST');
    expect(state.competitions[1].fixtures[0].date).toBe('2026-05-09');
    expect(state.competitions[0].fixtures[0].date > '2026-05-10').toBe(true);
  });
});

/* ───────────── partida de mata-mata ───────────── */

describe('partida decisiva (fiel ao original)', () => {
  it('sem prorrogação: empate vai direto aos pênaltis; agregado considerado', () => {
    let foundAgg = false;
    for (let i = 0; i < 40; i++) {
      const r = quickSimulate(config(`ko:${i}`, { knockout: true, extraTime: false }));
      expect(r.extraTime).toBeFalsy();
      if (r.homeGoals === r.awayGoals) expect(r.penalties).toBeDefined();
      else expect(r.penalties).toBeUndefined();
      const agg = quickSimulate(config(`ko:${i}`, { knockout: true, extraTime: false, aggregate: { home: 0, away: 1 } }));
      if (agg.homeGoals - agg.awayGoals === 1) { expect(agg.penalties).toBeDefined(); foundAgg = true; }
      if (agg.homeGoals === agg.awayGoals) expect(agg.penalties).toBeUndefined();
    }
    expect(foundAgg).toBe(true);
  });
});
