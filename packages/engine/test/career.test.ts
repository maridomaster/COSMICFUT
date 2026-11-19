/**
 * Carreira do Brasil na linha do tempo global (Etapa 1): 01/01/2026 → virada sul-americana de 31/12/2026, passando
 * pela virada automática de 30/06 (Europa/Arábia + envelhecimento de 1º/07).
 *
 * (Etapa 1) Mudanças intencionais em relação à Fase 1: o Brasil tem só Séries A e B como ligas nacionais (C e D
 * saíram; os clubes ficaram "só estadual"), a Série D Real deixou de existir, o envelhecimento e os juniores do ano
 * acontecem em 1º/07 (virada automática) e a SeasonState da virada do humano também traz as ligas europeias em
 * andamento (2026/27), que atravessam o 1º de janeiro.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NamePool, Player } from '@cosmicfut/shared';
import type { CareerData, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { advanceDay } from '../src/season/season';
import { createCareer, seasonOver, worldSquads, careerSquads } from '../src/season/career';
import { nextSeason, rolloverSeason, allocateSerieD, expiringContracts } from '../src/season/rollover';
import { retireChance } from '../src/season/players';
import { cycleOfCompetition } from '../src/season/timeline';
import { DATA, loadBase, loadData, loadPools, runCareer, type AutoTurnover } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let pools: Record<string, NamePool>;
let world: WorldState;
let state: SeasonState;
let first: SeasonState;
let july: AutoTurnover;
let next: { world: WorldState; state: SeasonState; summary: SeasonSummary };

beforeAll(() => {
  data = loadData();
  base = loadBase();
  pools = loadPools(data);
  const c = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'test-career', squads: base, options: { light: 'all' } });
  first = JSON.parse(JSON.stringify(c.state)) as SeasonState;
  const r = runCareer(c.world, c.state, base, data, pools, { until: '2027-01-31' });
  world = r.world;
  state = r.state;
  july = r.autos[0];
  next = nextSeason(world, state, base, data, pools);
}, 240_000);

describe('carreira: temporada do Brasil', () => {
  it('monta estaduais, Copa do Brasil e Séries A e B (C e D saem; sem divisões fictícias)', () => {
    expect(existsSync(resolve(DATA, 'formats.json'))).toBe(true);
    const ids = first.competitions.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['BRA-1', 'BRA-2', 'BRA-CUP', 'EST-SP-1', 'EST-PE-1', 'ARG-1', 'ARG-2', 'COL-1', 'EQU-1']));
    expect(ids.some((id) => /^BRA-([3-9]|10)$/.test(id))).toBe(false);
    // (Etapa 2) a Série B rebaixa 4: eles voltam a ser "só estadual" e os substitutos saem dos estaduais
    expect(first.competitions.find((c) => c.id === 'BRA-2')!.relegated).toBe(4);
    expect(first.competitions.filter((c) => c.type === 'state').length).toBeGreaterThanOrEqual(60);
    // 1º trecho: só competições de ano civil (as europeias 2026/27 começam em 01/07)
    expect(first.competitions.every((c) => cycleOfCompetition(c) === 'calendar')).toBe(true);
    expect(first.segment).toEqual({ start: '2026-01-01', end: '2026-06-30', closes: 'split' });
  });

  it('todas as competições sul-americanas terminam com campeão; (Etapa 4) prêmios por fase e por posição', () => {
    expect(seasonOver(state)).toBe(true);
    expect(state.date).toBe('2027-01-01');
    for (const c of state.competitions.filter((x) => cycleOfCompetition(x) === 'calendar')) {
      expect(c.finished, c.id).toBe(true);
      expect(c.championId, c.id).toBeTruthy();
    }
    const cup = state.competitions.find((c) => c.id === 'BRA-CUP')!;
    // (Etapa 4) prêmio do original em euros com o câmbio fixo (R$ 77 mi ÷ 6,30); a Copa do Brasil paga por fase:
    // o campeão recebe pelo menos a final + o bônus do título (R$ 33 mi + R$ 44 mi)
    expect(data.economy.prizes.NACIONAL_CUP).toBe(12_000_000);
    const cupTable = data.economy.competitionPrizes!['BRA-CUP'];
    expect(state.clubs[cup.championId!].finance!.prizes).toBeGreaterThanOrEqual(cupTable.champion! + cupTable.reach!.final);
    expect(cup.paid!.length).toBeGreaterThan(100);
    // (Etapa 4) Brasileirão: premiação por posição (CBF, 1º ao 16º); rebaixados (17º–20º) não recebem merit
    const a = state.competitions.find((c) => c.id === 'BRA-1')!;
    const merit = data.economy.merit!['BRA-1'];
    expect(state.clubs[a.championId!].finance!.prizes).toBeGreaterThanOrEqual(merit.first);
    const last = a.relegatedIds![0];
    expect(state.clubs[last].finance!.prizes).toBeLessThan(merit.first);
  });

  it('nenhum clube com dois jogos no mesmo dia', () => {
    const seen = new Set<string>();
    for (const c of state.competitions) for (const f of c.fixtures) for (const id of [f.homeId, f.awayId]) {
      const k = `${id}@${f.date}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });
});

describe('virada de temporada (sul-americana, 31/12)', () => {
  it('acesso e rebaixamento: 4 ↔ 4 entre A/B; tamanhos mantidos; outros países sul-americanos também', () => {
    const s = next.summary;
    expect(s.cycle).toBe('calendar');
    expect(s.seasonLabel).toBe('2026');
    expect(s.relegated['BRA-1'].length).toBe(4);
    expect(s.promoted['BRA-2'].length).toBe(4);
    // (Etapa 2) Série B: 4 rebaixados voltam aos estaduais; 4 clubes "só estadual" entram pelos estaduais
    expect(s.relegated['BRA-2'].length).toBe(4);
    expect(s.fromStates!['BRA-2'].length).toBe(4);
    const w = next.world;
    for (const id of s.relegated['BRA-2']) expect(Object.values(w.divisions).flat()).not.toContain(id);
    for (const id of s.fromStates!['BRA-2']) {
      expect(w.divisions['BRA-2']).toContain(id);
      expect(world.divisions['BRA-1'].includes(id) || world.divisions['BRA-2'].includes(id)).toBe(false);
    }
    expect([w.divisions['BRA-1'].length, w.divisions['BRA-2'].length]).toEqual([20, 20]);
    for (const id of s.promoted['BRA-2']) expect(w.divisions['BRA-1']).toContain(id);
    for (const id of s.relegated['BRA-1']) expect(w.divisions['BRA-2']).toContain(id);
    expect(s.promoted['ARG-2']?.length).toBeGreaterThan(0);
    // ligas europeias não viram em dezembro
    expect(s.promoted['ING-2']).toBeUndefined();
    const all = Object.values(w.divisions).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('sem Série D Real (Etapa 1); a alocação pelos estaduais continua disponível para dados antigos', () => {
    expect(next.summary.serieD).toBeUndefined();
    expect(Object.keys(next.world.divisions).some((id) => /^BRA-[34]$/.test(id))).toBe(false);
    expect(allocateSerieD({ AA: ['a', 'b', 'c'], BB: ['d'] }, {}, new Set(), 4, 2, 4).length).toBe(4);
  });

  it('estaduais: sobem tantos quantos caem e as divisões mantêm o tamanho', () => {
    for (const s of data.states) {
      for (const d of s.divisions) {
        expect(next.world.stateDivisions[`${s.state}-${d.division}`].length, `${s.state}-${d.division}`).toBe(d.clubIds.length);
      }
    }
    const sp1 = next.summary.stateMoves['SP-1'], sp2 = next.summary.stateMoves['SP-2'];
    expect(sp1.down.length).toBe(2);
    expect(sp2.up.length).toBe(2);
  });

  it('aposentadoria a partir de 33 (no fim da temporada da região) e um júnior por aposentado', () => {
    const s = next.summary;
    expect(s.retirements.length).toBeGreaterThan(50);
    for (const r of s.retirements) {
      expect(r.age).toBeGreaterThanOrEqual(33);
      expect(r.youthId).toBeTruthy();
    }
    // só clubes sul-americanos se aposentam em dezembro
    const reg = (id: string) => state.clubInfo![id]?.region;
    for (const r of s.retirements) expect(reg(r.clubId)).toBe('SA');
    expect(retireChance({ age: 32, overall: 50, position: 'MF' }, 0)).toBe(0);
    expect(retireChance({ age: 34, overall: 70, position: 'GK' }, 30)).toBe(0); // goleiro: idade efetiva 32
    expect(retireChance({ age: 38, overall: 70, position: 'MF' }, 30)).toBeGreaterThan(0.9);
  });

  it('juniores com nomes do pool da nacionalidade do clube', () => {
    const pool = pools.BRA;
    const words = new Set([...pool.given, ...pool.surname].flatMap((x) => x.n.split(' ')));
    const ys = [...july.summary.youth, ...next.summary.youth];
    expect(next.summary.youth.length).toBeGreaterThan(next.summary.retirements.length - 1);
    const countryOf = new Map(data.clubs.map((c) => [c.id, c.countryId]));
    for (const y of ys) expect(y.nationalityId).toBe(countryOf.get(y.clubId));
    for (const y of ys.filter((x) => countryOf.get(x.clubId) === 29).slice(0, 300)) {
      expect(y.nationalityId).toBe(29);
      for (const w of y.name.split(' ')) expect(words.has(w), y.name).toBe(true);
    }
    // juniores aparecem no elenco do clube no trecho seguinte
    const sq = careerSquads(next.state, worldSquads(next.world, base));
    const y = next.summary.youth.find((x) => next.state.clubs[x.clubId])!;
    expect(sq(y.clubId).some((p) => p.id === y.playerId)).toBe(true);
    expect(sq(y.clubId).find((p) => p.id === y.playerId)!.age).toBeLessThanOrEqual(18);
  });

  it('envelhecimento em 1º/07: +1 ano para quem fica; aposentados somem do elenco', () => {
    expect(july.summary.aging).toBe(true);
    expect(july.summary.date).toBe('2026-07-01');
    const before = careerSquads(july.before, worldSquads(july.worldBefore, base));
    const after = careerSquads(july.after, worldSquads(july.world, base));
    const pal = before('palmeiras');
    const palAfter = new Map(after('palmeiras').map((p) => [p.id, p]));
    let checked = 0;
    for (const p of pal) {
      const q = palAfter.get(p.id);
      if (q) { expect(q.age).toBe(p.age + 1); checked++; }
    }
    expect(checked).toBeGreaterThan(10);
    // a virada de dezembro não envelhece
    const decBefore = careerSquads(state, worldSquads(world, base))('palmeiras');
    const decAfter = new Map(careerSquads(next.state, worldSquads(next.world, base))('palmeiras').map((p) => [p.id, p]));
    for (const p of decBefore) { const q = decAfter.get(p.id); if (q) expect(q.age).toBe(p.age); }
    const retired = new Set(next.summary.retirements.map((r) => r.playerId));
    const sq = careerSquads(next.state, worldSquads(next.world, base));
    for (const c of Object.keys(next.state.clubs).slice(0, 100)) for (const p of sq(c)) expect(retired.has(p.id)).toBe(false);
  });

  it('contratos: humano perde quem não renovou; finanças mantêm o caixa', () => {
    const s = next.summary;
    expect(s.contracts.renewed).toBeGreaterThan(0);
    const after = careerSquads(next.state, worldSquads(next.world, base))('palmeiras').map((p) => p.id);
    for (const id of s.contracts.humanReleased) expect(after).not.toContain(id);
    expect(next.world.balances.palmeiras).toBe(state.clubs.palmeiras.balance);
    expect(next.state.clubs.palmeiras.balance).toBe(state.clubs.palmeiras.balance);
    expect(next.state.clubs.palmeiras.finance!.prizes).toBe(0);
    expect(next.world.ledgers['2026'].palmeiras).toBeDefined();
    expect(Array.isArray(expiringContracts(world, state, base, 'palmeiras'))).toBe(true);
  });

  it('histórico e nova temporada', () => {
    expect(next.world.season).toBe(2027);
    expect(next.state.season).toBe(2027);
    const calendarComps = state.competitions.filter((c) => cycleOfCompetition(c) === 'calendar');
    expect(next.world.history.filter((h) => h.season === 2026 && h.cycle === 'calendar').length).toBe(calendarComps.length);
    const a = next.world.history.find((h) => h.competitionId === 'BRA-1')!;
    expect(a.championId).toBe(state.competitions.find((c) => c.id === 'BRA-1')!.championId);
    expect(a.seasonLabel).toBe('2026');
    expect(a.topScorer?.goals).toBeGreaterThan(5);
    // Supercopa no 2º ano
    expect(next.state.competitions.some((c) => c.id === 'BRA-SUP')).toBe(true);
  });

  it('determinismo: a virada é uma função pura das entradas', () => {
    const r1 = rolloverSeason(world, state, base, data, pools);
    const r2 = rolloverSeason(world, state, base, data, pools);
    expect(JSON.stringify(r1.world)).toBe(JSON.stringify(r2.world));
    expect(JSON.stringify(r1.summary)).toBe(JSON.stringify(next.summary));
  });

  it('determinismo: mesma seed ⇒ mesma temporada (primeiros 60 dias)', () => {
    const run = () => {
      let { world: w, state: s } = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'det', squads: base, options: { light: 'all', playStateLeagues: false } });
      const sq = worldSquads(w, base);
      for (let i = 0; i < 60; i++) s = advanceDay(s, sq).state;
      return JSON.stringify(s.competitions.map((c) => c.fixtures.map((f) => f.result)));
    };
    expect(run()).toBe(run());
  });
});
