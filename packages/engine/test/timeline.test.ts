/**
 * Etapa 1 — escopo geográfico e linha do tempo global com calendário duplo:
 *  - filtro de escopo nos dados (nenhum clube/liga fora do escopo);
 *  - semana do ano e janelas de transferência por região;
 *  - carreira de 18 meses a partir de 01/01/2026 com humano brasileiro (viradas regionais nas datas certas,
 *    Brasileirão 2026 termina em dezembro, Premier League 2026/27 de agosto a maio, competição 'split' atravessa 1º/01);
 *  - carreira com clube inglês começando em 01/07/2026.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData, Competition, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { careerStartDate, createCareer, seasonOver, worldSquads } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { advanceDay } from '../src/season/season';
import { confedChampion, continentalConfig } from '../src/season/continental';
import { contractSeasonOf, marketWindow } from '../src/transfers/market';
import {
  autoTurnoverDue, cycleCalendar, cycleSeason, REGIONS, SCOPE_CODES, SCOPE_REGIONS, seasonLabel, segmentFrom, shiftDates,
  turnoverDue, weekOfYear, windowFor,
} from '../src/season/timeline';
import { loadBase, loadData, loadPools, rj, runCareer, type AutoTurnover } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let pools: Record<string, NamePool>;

beforeAll(() => {
  data = loadData();
  base = loadBase();
  pools = loadPools(data);
}, 120_000);

const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();
const dates = (c: Competition) => c.fixtures.map((f) => f.date).sort();

/* ═════════════════════ 1) escopo ═════════════════════ */

describe('escopo geográfico (dados)', () => {
  it('nenhum clube, liga ou calendário de liga fora do escopo; countries.json completo; meta.scope', () => {
    const countries = rj<{ id: number; code: string | null }[]>('countries.json');
    expect(countries.length).toBe(224);
    const codeOf = new Map(countries.map((c) => [c.id, c.code]));
    const scope = new Set(SCOPE_CODES);
    // (Etapa 2) exceção: clubes convidados (fora do escopo, `guest`), sem liga — só continentais
    for (const c of data.clubs) expect(scope.has(codeOf.get(c.countryId) ?? '') || !!c.guest, c.id).toBe(true);
    for (const c of data.clubs.filter((x) => x.guest)) expect(c.leagueId, c.id).toBeNull();
    for (const l of data.leagues) {
      expect(scope.has(codeOf.get(l.countryId) ?? ''), l.id).toBe(true);
      expect(l.division, l.id).toBeLessThanOrEqual(2);
    }
    // Brasil: só Séries A e B; C e D saíram (clubes ficaram "só estadual")
    expect(data.leagues.filter((l) => l.countryId === 29).map((l) => l.id).sort()).toEqual(['BRA-1', 'BRA-2']);
    // (Etapa 2) a Série B rebaixa 4 para os estaduais (dropToStates)
    expect(data.leagues.find((l) => l.id === 'BRA-2')!.relegated).toBe(4);
    expect(data.states.length).toBe(27);
    const stateOnly = data.clubs.filter((c) => c.countryId === 29 && !c.leagueId);
    expect(stateOnly.length).toBeGreaterThan(600);
    // a última divisão mantida de cada país não rebaixa (exceto a Série B → estaduais)
    for (const code of SCOPE_CODES) {
      const ds = data.leagues.filter((l) => codeOf.get(l.countryId) === code).sort((a, b) => a.division - b.division);
      expect(ds.length, code).toBeGreaterThan(0);
      expect(ds[ds.length - 1].relegated, code).toBe(code === 'BRA' ? 4 : 0);
    }
    // clubes de outros países só aparecem se têm liga (ou são convidados)
    for (const c of data.clubs.filter((x) => x.countryId !== 29 && !x.guest)) expect(c.leagueId, c.id).toBeTruthy();
    // elencos: só clubes em escopo
    const pm = rj<{ clubs: string[] }>('players-market.json');
    const ids = new Set(data.clubs.map((c) => c.id));
    for (const id of pm.clubs) expect(ids.has(id), id).toBe(true);
    // calendários reais das ligas em escopo; nenhum de liga fora do escopo
    const real = data.calendars.filter((c) => c.id.startsWith('real:'));
    for (const l of data.leagues.filter((x) => !(x as { cfg?: { aperturaClausura?: boolean } }).cfg?.aperturaClausura)) {
      expect(real.some((c) => c.id === `real:${l.id}`), l.id).toBe(true);
    }
    for (const c of real) {
      const m = /^real:([A-Z]{3})-\d$/.exec(c.id);
      if (m) expect(scope.has(m[1]), c.id).toBe(true);
    }
    const meta = rj<{ scope: { countries: string[]; regions: Record<string, { cycle: string; countries: string[] }> } }>('meta.json');
    expect(meta.scope.countries.sort()).toEqual([...SCOPE_CODES].sort());
    for (const r of REGIONS) expect(meta.scope.regions[r]).toEqual({ cycle: SCOPE_REGIONS[r].cycle, countries: SCOPE_REGIONS[r].countries });
  });

  it('continentais filtrados pelo escopo; confederações sem clubes usam convidados', () => {
    const cfg = continentalConfig(data);
    expect(cfg.conmebol.map((c) => c.code).sort()).toEqual(['ARG', 'CHI', 'COL', 'EQU', 'PAR', 'URU']);
    for (const list of Object.values(cfg.confederations ?? {})) for (const code of list) expect(SCOPE_CODES).toContain(code);
    // vagas: totais do formato mantidos com a redistribuição (grupos 26 + 2 campeões, 2ª fase 13, 1ª fase 6)
    const lib = Object.values(cfg.libertadores);
    expect(lib.reduce((a, q) => a + q.groups, 0)).toBe(26);
    expect(lib.reduce((a, q) => a + q.f2, 0)).toBe(13);
    expect(lib.reduce((a, q) => a + q.f1, 0)).toBe(6);
    expect(Object.values(cfg.sulamericana).reduce((a, q) => a + q.prelim, 0)).toBe(32);
    const ids = new Set(data.clubs.map((c) => c.id));
    for (const conf of ['UEFA', 'CONCACAF', 'CAF', 'AFC', 'OFC']) {
      const c = confedChampion(data, conf, 'seed');
      expect(c, conf).toBeTruthy();
      expect(ids.has(c!), conf).toBe(true);
    }
  });
});

/* ═════════════════════ 2) semana do ano, ciclos, janelas ═════════════════════ */

describe('semana do ano, ciclos e janelas', () => {
  it('weekOfYear: 1–52', () => {
    expect(weekOfYear('2026-01-01')).toBe(1);
    expect(weekOfYear('2026-01-07')).toBe(1);
    expect(weekOfYear('2026-01-08')).toBe(2);
    expect(weekOfYear('2026-07-01')).toBe(26);
    expect(weekOfYear('2026-12-17')).toBe(51);
    expect(weekOfYear('2026-12-24')).toBe(52);
    expect(weekOfYear('2026-12-31')).toBe(52);
    expect(weekOfYear('2028-12-31')).toBe(52); // ano bissexto
    for (let d = '2026-01-01'; d <= '2026-12-31'; d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) {
      const w = weekOfYear(d);
      expect(w >= 1 && w <= 52, d).toBe(true);
    }
  });

  it('ciclos: temporada, rótulo e trechos', () => {
    expect(cycleSeason('calendar', '2026-11-30')).toBe(2026);
    expect(cycleSeason('split', '2026-08-22')).toBe(2026);
    expect(cycleSeason('split', '2027-05-23')).toBe(2026);
    expect(seasonLabel('split', 2026)).toBe('2026/27');
    expect(seasonLabel('split', 2099)).toBe('2099/00');
    expect(seasonLabel('calendar', 2026)).toBe('2026');
    expect(segmentFrom('2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-06-30', closes: 'split' });
    expect(segmentFrom('2026-07-01')).toEqual({ start: '2026-07-01', end: '2026-12-31', closes: 'calendar' });
  });

  it('calendários dos anos seguintes: deslocados por semanas inteiras (mesmo dia da semana), dentro da temporada', () => {
    const pl26 = cycleCalendar(data, 'ING-1', 'split', 2026);
    expect(pl26[0]).toBe('2026-08-22');
    expect(pl26[pl26.length - 1]).toBe('2027-05-23');
    for (const y of [2027, 2028, 2031]) {
      const pl = cycleCalendar(data, 'ING-1', 'split', y);
      expect(pl.length).toBe(pl26.length);
      expect(dow(pl[0])).toBe(dow(pl26[0]));
      expect(pl[0] >= `${y}-08-15` && pl[0] <= `${y}-08-29`, pl[0]).toBe(true);
      expect(pl[pl.length - 1] <= `${y + 1}-06-29`).toBe(true);
      const br = cycleCalendar(data, 'BRA-1', 'calendar', y);
      expect(br[0].slice(0, 4)).toBe(String(y));
      expect(br[br.length - 1] <= `${y}-12-30`).toBe(true);
    }
    expect(shiftDates(['2026-01-28'], 2026, 2027)).toEqual(['2027-01-27']);
    // Brasileirão 2026: pausa da Copa do Mundo (11/06–19/07) sem rodadas
    const br26 = cycleCalendar(data, 'BRA-1', 'calendar', 2026);
    expect(br26.some((d) => d >= '2026-06-11' && d <= '2026-07-19')).toBe(false);
    expect(br26[0]).toBe('2026-01-28');
    expect(br26[br26.length - 1]).toBe('2026-12-02');
    // Bundesliga com pausa de inverno
    const bl = cycleCalendar(data, 'ALE-1', 'split', 2026);
    expect(bl.some((d) => d >= '2026-12-21' && d <= '2027-01-08')).toBe(false);
  });

  it('janelas por região (windowFor)', () => {
    expect(windowFor('EU', '2026-07-01')).toEqual({ open: true, closesOn: '2026-09-01', opensOn: null });
    expect(windowFor('EU', '2026-09-01').open).toBe(true);
    expect(windowFor('EU', '2026-09-02')).toEqual({ open: false, closesOn: null, opensOn: '2027-01-01' });
    expect(windowFor('EU', '2027-02-02')).toEqual({ open: true, closesOn: '2027-02-02', opensOn: null });
    expect(windowFor('EU', '2027-02-03')).toEqual({ open: false, closesOn: null, opensOn: '2027-07-01' });
    expect(windowFor('SAU', '2027-01-15').open).toBe(true);
    expect(windowFor('SAU', '2027-02-01').open).toBe(false);
    expect(windowFor('SAU', '2026-08-31').open).toBe(true);
    expect(windowFor('SA', '2026-03-31').open).toBe(true);
    expect(windowFor('SA', '2026-04-01')).toEqual({ open: false, closesOn: null, opensOn: '2026-07-01' });
    expect(windowFor('SA', '2026-09-30').open).toBe(true);
    expect(windowFor('SA', '2026-10-01')).toEqual({ open: false, closesOn: null, opensOn: '2027-01-01' });
  });

  it('início da carreira: sul-americano 01/01, europeu/saudita 01/07; online = o mais cedo', () => {
    expect(careerStartDate(data, ['palmeiras'], 2026)).toBe('2026-01-01');
    expect(careerStartDate(data, ['arsenal'], 2026)).toBe('2026-07-01');
    expect(careerStartDate(data, ['al-hilal'], 2026)).toBe('2026-07-01');
    expect(careerStartDate(data, ['arsenal', 'palmeiras'], 2026)).toBe('2026-01-01');
  });
});

/* ═════════════════════ 3) carreira de 18 meses (humano brasileiro) ═════════════════════ */

describe('18 meses a partir de 01/01/2026 (Palmeiras)', () => {
  let turnovers: { date: string; summary: SeasonSummary; auto: boolean; before: SeasonState; after: SeasonState }[];
  let final: { world: WorldState; state: SeasonState };
  let jan2027: SeasonState;
  let dec2026: SeasonState;

  beforeAll(() => {
    const c = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'tl18', squads: base, options: { light: 'all', humanAutoRenew: true } });
    expect(c.state.date).toBe('2026-01-01');
    turnovers = [];
    const push = (a: AutoTurnover) => turnovers.push({ date: a.summary.date!, summary: a.summary, auto: true, before: a.before, after: a.after });
    // até a virada do humano (31/12/2026)
    let r = runCareer(c.world, c.state, base, data, pools, { until: '2027-07-05' });
    r.autos.forEach(push);
    expect(seasonOver(r.state)).toBe(true);
    dec2026 = r.state;
    const h = nextSeason(r.world, r.state, base, data, pools, { renew: [] });
    jan2027 = JSON.parse(JSON.stringify(h.state)) as SeasonState;
    turnovers.push({ date: h.summary.date!, summary: h.summary, auto: false, before: r.state, after: jan2027 });
    r = runCareer(h.world, h.state, base, data, pools, { until: '2027-07-05' });
    r.autos.forEach(push);
    final = { world: r.world, state: r.state };
  }, 300_000);

  it('cada região vira na data certa (30/06 Europa/Arábia + envelhecimento; 31/12 América do Sul)', () => {
    expect(turnovers.map((t) => [t.date, t.summary.cycle, t.summary.seasonLabel, t.auto, !!t.summary.aging])).toEqual([
      ['2026-07-01', 'split', '2025/26', true, true],
      ['2027-01-01', 'calendar', '2026', false, false],
      ['2027-07-01', 'split', '2026/27', true, true],
    ]);
    for (const t of turnovers) {
      expect(t.before.segment!.end).toBe(new Date(Date.parse(t.date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10));
      expect(t.after.date).toBe(t.date);
    }
    // acesso/rebaixamento só da região que virou
    const dec = turnovers[1].summary, jul = turnovers[2].summary;
    expect(Object.keys(dec.relegated)).toContain('BRA-1');
    expect(Object.keys(dec.promoted).every((id) => /^(BRA|ARG|URU|COL|CHI|PAR|EQU)-/.test(id))).toBe(true);
    expect(Object.keys(jul.promoted)).toEqual(expect.arrayContaining(['ING-2', 'ESP-2', 'ALE-2', 'ARS-2']));
    expect(Object.keys(jul.promoted).some((id) => id.startsWith('BRA'))).toBe(false);
    // aposentadorias pela região do clube
    const reg = (s: SeasonState, id: string) => s.clubInfo![id]?.region;
    for (const r of dec.retirements) expect(reg(turnovers[1].before, r.clubId)).toBe('SA');
    for (const r of jul.retirements) expect(['EU', 'SAU']).toContain(reg(turnovers[2].before, r.clubId));
    expect(final.world.agedYears).toBe(2);
    expect(final.state.season).toBe(2027);
    expect(final.state.segment).toEqual({ start: '2027-07-01', end: '2027-12-31', closes: 'calendar' });
  });

  it('Brasileirão 2026 começa em janeiro e termina em dezembro', () => {
    const a = dec2026.competitions.find((c) => c.id === 'BRA-1')!;
    expect(a.seasonLabel).toBe('2026');
    expect(a.cycle).toBe('calendar');
    expect(a.finished).toBe(true);
    const ds = dates(a);
    expect(ds[0]).toBe('2026-01-28');
    expect(ds[ds.length - 1] >= '2026-12-01' && ds[ds.length - 1] <= '2026-12-31').toBe(true);
    // sem jogos de clubes na pausa da Copa do Mundo
    expect(a.fixtures.some((f) => f.date >= '2026-06-11' && f.date <= '2026-07-19')).toBe(false);
    const h = final.world.history.find((x) => x.competitionId === 'BRA-1' && x.season === 2026)!;
    expect(h.seasonLabel).toBe('2026');
    expect(h.championId).toBe(a.championId);
    // nova edição em 2027
    expect(jan2027.competitions.find((c) => c.id === 'BRA-1')!.seasonLabel).toBe('2027');
  });

  it('Premier League 2026/27: agosto de 2026 a maio de 2027, atravessa o 1º de janeiro sem reiniciar', () => {
    const before = turnovers[1].before.competitions.find((c) => c.id === 'ING-1')!;
    const after = jan2027.competitions.find((c) => c.id === 'ING-1')!;
    expect(before.seasonLabel).toBe('2026/27');
    expect(after.seasonLabel).toBe('2026/27');
    expect(after.cycleSeason).toBe(2026);
    const played = before.fixtures.filter((f) => f.result).length;
    expect(played).toBeGreaterThan(100);
    expect(after.fixtures.filter((f) => f.result).length).toBe(played);
    expect(after.fixtures.length).toBe(before.fixtures.length);
    expect(after.finished).toBeFalsy();
    const ds = dates(after);
    expect(ds[0]).toBe('2026-08-22');
    expect(ds[ds.length - 1] >= '2027-05-01' && ds[ds.length - 1] <= '2027-05-31').toBe(true);
    // fechou na virada de 30/06/2027, com o rótulo da temporada
    const h = final.world.history.find((x) => x.competitionId === 'ING-1' && x.seasonLabel === '2026/27')!;
    expect(h.seasonLabel).toBe('2026/27');
    expect(h.season).toBe(2026);
    expect(h.championId).toBeTruthy();
    // e a 2027/28 já está criada (começa em agosto de 2027)
    const pl = final.state.competitions.find((c) => c.id === 'ING-1')!;
    expect(pl.seasonLabel).toBe('2027/28');
    expect(dates(pl)[0].startsWith('2027-08')).toBe(true);
    // todas as ligas em escopo rodam em paralelo
    for (const id of ['ING-1', 'ESP-1', 'ITA-1', 'ALE-1', 'FRA-1', 'POR-1', 'HOL-1', 'ARS-1', 'BRA-1', 'ARG-1', 'URU-1', 'COL-1', 'CHI-1', 'PAR-1', 'EQU-1']) {
      expect(jan2027.competitions.some((c) => c.id === id && c.type === 'league'), id).toBe(true);
    }
  });

  it('janela do mercado pela região do humano; contratos na temporada do ciclo do clube', () => {
    const s = turnovers[0].after; // 01/07/2026
    expect(marketWindow(s).open).toBe(true);
    expect(s.market!.window.closesOn).toBe('2026-09-30');
    expect(marketWindow({ ...s, date: '2026-10-01' }).open).toBe(false);
    // clube europeu no mesmo dia: janela europeia
    expect(marketWindow({ ...s, date: '2026-09-15' }, 'arsenal').open).toBe(false);
    expect(marketWindow({ ...s, date: '2026-09-15' }, 'palmeiras').open).toBe(true);
    expect(contractSeasonOf(jan2027, 'arsenal')).toBe(2026);
    expect(contractSeasonOf(jan2027, 'palmeiras')).toBe(2027);
  });
});

/* ═════════════════════ 4) clube inglês começando em 01/07/2026 ═════════════════════ */

describe('carreira com clube inglês (início em 01/07/2026)', () => {
  let world: WorldState;
  let state: SeasonState;
  let ms: number;
  beforeAll(() => {
    const t0 = Date.now();
    const c = createCareer({ data, humanClubIds: ['arsenal'], season: 2026, seed: 'eng', squads: base, pools });
    ms = Date.now() - t0;
    world = c.world;
    state = c.state;
  }, 120_000);

  it('começa na pré-temporada com o 1º semestre sul-americano já simulado', () => {
    expect(ms).toBeLessThan(20_000);
    expect(state.date).toBe('2026-07-01');
    expect(world.startDate).toBe('2026-07-01');
    expect(state.humanClubIds).toEqual(['arsenal']);
    expect(state.clubInfo!.arsenal.region).toBe('EU');
    expect(state.segment).toEqual({ start: '2026-07-01', end: '2026-12-31', closes: 'calendar' });
    const pl = state.competitions.find((c) => c.id === 'ING-1')!;
    expect(pl.clubIds).toContain('arsenal');
    expect(pl.seasonLabel).toBe('2026/27');
    expect(pl.fixtures.every((f) => !f.result && f.date >= '2026-08-01')).toBe(true);
    const br = state.competitions.find((c) => c.id === 'BRA-1')!;
    expect(br.fixtures.filter((f) => f.result).length).toBeGreaterThan(100);
    expect(br.fixtures.every((f) => !f.result || f.date < '2026-07-01')).toBe(true);
    // ninguém mexeu no clube humano antes do início: sem jogos e caixa dos dados
    expect(state.clubs.arsenal.balance).toBe(data.clubs.find((c) => c.id === 'arsenal')!.finances!.balance);
    expect(seasonOver(state)).toBe(false);
    expect(state.market!.window.open).toBe(true);
    expect(world.agedYears).toBe(1);
  });

  it('a virada sul-americana de 31/12 é automática e a Premier League segue', () => {
    let s = state, w = world;
    const sq = worldSquads(w, base);
    while (!turnoverDue(s)) s = advanceDay(s, sq, {}, { inPlace: true }).state;
    expect(s.date).toBe('2027-01-01');
    expect(autoTurnoverDue(s)).toBe(true);
    expect(seasonOver(s)).toBe(false);
    const playedPl = s.competitions.find((c) => c.id === 'ING-1')!.fixtures.filter((f) => f.result).length;
    const r = nextSeason(w, s, base, data, pools);
    expect(r.summary.cycle).toBe('calendar');
    expect(r.summary.contracts.humanReleased).toEqual([]);
    const pl = r.state.competitions.find((c) => c.id === 'ING-1')!;
    expect(pl.fixtures.filter((f) => f.result).length).toBe(playedPl);
    expect(pl.fixtures.some((f) => f.homeId === 'arsenal' && !f.result)).toBe(true);
    // janela europeia de inverno aberta em 01/01
    expect(r.state.market!.window).toEqual({ open: true, closesOn: '2027-02-02', opensOn: null });
  }, 120_000);
});
