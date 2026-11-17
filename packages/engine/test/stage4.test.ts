/**
 * Etapa 4 — economia dos clubes: bilheteria por jogo (importância, Moral da Torcida, elasticidade do preço), TV em
 * parcelas mensais, prêmios por fase (UCL/Libertadores), cheque especial, teto da folha (humano e IA), migração de
 * saves e sustentabilidade em 3 temporadas. Usa os dados reais de apps/web/public/data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { CareerData, ClubSeasonState, Competition, SeasonState, WorldState } from '../src/contract';
import { createCareer, migrateCareer, worldSquads } from '../src/season/career';
import { advanceDay } from '../src/season/season';
import { nextSeason } from '../src/season/rollover';
import { turnoverDue } from '../src/season/timeline';
import {
  checkWageCeiling, clubEconomyProfile, ECON, gateRevenue, IMPORTANCE, matchBonus, matchImportance, meritAt, monthlyCashFlow, payPhasePrizes,
  phaseKeyOf, priceDemand, type GateInput,
} from '../src/season/econ';
import { makeOffer, proposeContract } from '../src/transfers/actions';
import { careerSquads } from '../src/season/career';
import { fmtMoneyShort } from '../src/money';
import { loadBase, loadData, loadPools } from './career-helpers';

let data: CareerData;
let base: (id: string) => Player[];
let world: WorldState;
let state: SeasonState;

beforeAll(() => {
  data = loadData();
  base = loadBase();
  const c = createCareer({ data, humanClubIds: ['flarj'], season: 2026, seed: 'stage4', squads: base, options: { light: 'all' } });
  world = c.world;
  state = c.state;
}, 120_000);

const G: GateInput = { capacity: 50_000, fill0: 0.6, basePrice: 30, price: 30, importance: 1, fanMorale: 60, form: 50, awayReputation: 2.5 };

describe('Etapa 4: bilheteria por jogo', () => {
  it('renda monotônica na importância e na Moral da Torcida', () => {
    let prev = -1;
    for (const importance of [IMPORTANCE.friendly, IMPORTANCE.state, IMPORTANCE.league, IMPORTANCE.classic, IMPORTANCE.cupFinal, IMPORTANCE.final]) {
      const g = gateRevenue({ ...G, importance });
      expect(g.revenue, `importância ${importance}`).toBeGreaterThan(prev);
      prev = g.revenue;
    }
    prev = -1;
    let prevAtt = -1;
    for (const fanMorale of [0, 20, 40, 60, 80, 100]) {
      const g = gateRevenue({ ...G, fanMorale });
      expect(g.revenue).toBeGreaterThan(prev);
      expect(g.attendance).toBeGreaterThanOrEqual(prevAtt);
      prev = g.revenue;
      prevAtt = g.attendance;
    }
    // estádio cheio não passa da capacidade
    expect(gateRevenue({ ...G, fill0: 0.97, importance: IMPORTANCE.final, fanMorale: 100 }).attendance).toBe(G.capacity);
  });

  it('elasticidade do preço: público cai com o preço; −50% a cada +100% acima do preço-base', () => {
    expect(priceDemand(60, 30)).toBeCloseTo(0.5, 5);
    expect(priceDemand(15, 30)).toBeCloseTo(1.15, 5);
    let prevAtt = Infinity;
    for (const price of [10, 20, 30, 45, 60, 90]) {
      const g = gateRevenue({ ...G, price });
      expect(g.attendance).toBeLessThanOrEqual(prevAtt);
      prevAtt = g.attendance;
    }
    // receita máxima um pouco acima do preço-base (r ≈ 1,5), não no infinito
    const rev = (p: number) => gateRevenue({ ...G, price: p }).revenue;
    expect(rev(45)).toBeGreaterThan(rev(30));
    expect(rev(90)).toBeLessThan(rev(45));
  });

  it('importância: liga < clássico < mata-mata de copa < continental (grupos) < final', () => {
    const lib = state.competitions.find((c) => c.id === 'LIBERTADORES')!;
    const league = state.competitions.find((c) => c.id === 'BRA-1')!;
    // jogo comum: adversário de outra UF e de reputação < 4
    const f = league.fixtures.find((x) => x.homeId === 'flarj' && state.clubInfo![x.awayId].uf !== 'RJ' && (state.clubInfo![x.awayId].reputation ?? 0) < 4)!;
    expect(matchImportance(state, league, f).value).toBe(IMPORTANCE.league);
    // clássico: mesma UF, as duas com reputação ≥ 3 (Fla-Flu)
    const classic = league.fixtures.find((x) => x.homeId === 'flarj' && x.awayId === 'flurj')!;
    expect(matchImportance(state, league, classic).value).toBe(IMPORTANCE.classic);
    expect(IMPORTANCE.cupQF).toBeLessThan(IMPORTANCE.contGroup);
    const grp = lib.fixtures.find((x) => x.stageId && lib.format!.stages.find((s) => s.id === x.stageId)!.kind === 'table');
    if (grp) expect(matchImportance(state, lib, grp).value).toBe(IMPORTANCE.contGroup);
    expect(IMPORTANCE.contGroup).toBeLessThan(IMPORTANCE.final);
    expect(IMPORTANCE.friendly).toBeLessThan(IMPORTANCE.league);
  });

  it('jogo em casa grava a bilheteria do humano (público, preço, importância, moral) e a renda no livro', () => {
    let s = state;
    const sq = worldSquads(world, base);
    const before = s.clubs.flarj.finance!.tickets;
    while (!(s.clubs.flarj.gates?.length) && s.date < '2026-04-01') s = advanceDay(s, sq).state;
    const g = s.clubs.flarj.gates![0];
    expect(g.attendance).toBeGreaterThan(1000);
    expect(g.attendance).toBeLessThanOrEqual(g.capacity);
    expect(g.price).toBeGreaterThan(0);
    expect(g.importance).toBeGreaterThan(0);
    expect(g.revenue).toBeGreaterThan(0);
    expect(s.clubs.flarj.finance!.tickets - before).toBeGreaterThanOrEqual(g.revenue);
    expect(s.news.some((n) => n.text.includes('renda €'))).toBe(true);
  }, 60_000);
});

describe('Etapa 4: fluxo mensal', () => {
  it('TV em parcelas mensais (dia 1) e demonstrativo do mês', () => {
    const info = state.clubInfo!.flarj;
    expect(info.tvPerSeason).toBeGreaterThan(20_000_000);
    expect(info.tvPerSeason).toBeLessThanOrEqual(60_000_000);
    let s = advanceDay(state, worldSquads(world, base)).state; // 01/01
    const tv1 = s.clubs.flarj.finance!.tv;
    expect(tv1).toBe(Math.round(info.tvPerSeason! / 12));
    const sq = worldSquads(world, base);
    while (s.date <= '2026-02-01') s = advanceDay(s, sq).state;
    expect(s.clubs.flarj.finance!.tv).toBe(2 * tv1);
    // dia 1 de fevereiro fecha janeiro no demonstrativo
    const jan = s.clubs.flarj.months!.find((m) => m.month === '2026-01')!;
    expect(jan.flow.tv).toBe(tv1);
    expect(jan.flow.wages!).toBeLessThan(0);
    expect(jan.flow.staff!).toBeLessThan(0);
  }, 60_000);

  it('cheque especial: juros de 2,5% ao mês sobre o saldo negativo', () => {
    const info = { ...state.clubInfo!.flarj } as Parameters<typeof monthlyCashFlow>[1];
    const club = JSON.parse(JSON.stringify(state.clubs.flarj)) as ClubSeasonState;
    club.balance = -10_000_000;
    const wages = 8_000_000;
    const r = monthlyCashFlow(club, info, wages);
    const afterFlows = -10_000_000 + r.tv + r.sponsor + r.owner + r.matchday - wages - r.staff - r.maintenance - r.opex;
    expect(r.overdraft).toBe(Math.round(-afterFlows * ECON.overdraftRate));
    expect(club.balance).toBe(afterFlows - r.overdraft);
    expect(club.finance!.overdraft).toBe(-r.overdraft);
    // saldo positivo: sem juros
    const c2 = JSON.parse(JSON.stringify(state.clubs.flarj)) as ClubSeasonState;
    c2.balance = 50_000_000;
    expect(monthlyCashFlow(c2, info, wages).overdraft).toBe(0);
  });

  it('perfil: Real Madrid sem aporte; PIF (Al-Nassr) com aporte; teto da folha ≥ folha atual', () => {
    const t = state.career!.econ!;
    const prof = (id: string, league: string, code: string, region: string) => {
      const c = data.clubs.find((x) => x.id === id)!;
      return clubEconomyProfile(t, {
        id, revenue: c.finances!.revenue!, wageBill: c.finances!.wageBill!, capacity: c.capacity!, reputation: c.reputation!, code, region,
        leagueNow: league, shareNow: 1, leagueData: league, shareData: 1, divisionSize: 20,
      });
    };
    const rm = prof('realmadrid-esp', 'ESP-1', 'ESP', 'EU');
    expect(rm.ownerPerSeason).toBe(0);
    expect(rm.wageCeiling).toBeGreaterThan(data.clubs.find((x) => x.id === 'realmadrid-esp')!.finances!.wageBill!);
    const an = prof('alnassr-ara', 'ARS-1', 'ARS', 'SAU');
    expect(an.ownerPerSeason).toBeGreaterThan(50_000_000);
    expect(an.ownerBacked).toBe(true);
  });
});

/** Competição sintética no formato UEFA: fase de liga (tabela) → oitavas … final (fase do campeão). */
function fakeUcl(ids: string[]): Competition {
  return {
    id: 'UCL', name: 'Liga dos Campeões', type: 'continental', clubIds: ids, doubleRound: false, relegated: 0, promoted: 0, fixtures: [], prizeKey: 'CHAMPIONS',
    format: {
      id: 'UCL', teams: 36, champion: 'ko',
      stages: [
        { id: 'league', kind: 'table', name: 'Fase de Liga', legs: 1, sources: [{ entrants: 'all' }] },
        { id: 'playoff', kind: 'knockout', name: 'Playoff', sources: [], rounds: [{ name: 'Playoff', tie: { legs: 2 } }] },
        {
          id: 'ko', kind: 'knockout', name: 'Fase Final', sources: [],
          rounds: [{ name: 'Oitavas de Final', tie: { legs: 2 } }, { name: 'Quartas de Final', tie: { legs: 2 } }, { name: 'Semifinal', tie: { legs: 2 } }, { name: 'Final', tie: { legs: 1 } }],
        },
      ],
    },
    stages: {
      league: { id: 'league', status: 'done', seeds: ids },
      playoff: { id: 'playoff', status: 'done', seeds: [ids[2], ids[3]], ties: [{ id: 'p1', round: 0, roundName: 'Playoff', a: ids[2], b: ids[3], fixtureIds: [], winner: ids[2] }] },
      ko: {
        id: 'ko', status: 'active', seeds: [ids[0], ids[1], ids[2], ids[4]], ties: [
          { id: 'k1', round: 0, roundName: 'Oitavas de Final', a: ids[0], b: ids[4], fixtureIds: [], winner: ids[0] },
          { id: 'k2', round: 0, roundName: 'Oitavas de Final', a: ids[1], b: ids[2], fixtureIds: [], winner: ids[1] },
          { id: 'k3', round: 1, roundName: 'Quartas de Final', a: ids[0], b: ids[1], fixtureIds: [], winner: ids[0] },
          { id: 'k4', round: 3, roundName: 'Final', a: ids[0], b: ids[5], fixtureIds: [] },
        ],
      },
    },
  };
}

describe('Etapa 4: prêmios por fase', () => {
  it('UCL: participação € 18,62 mi, vitória € 2,1 mi, empate € 0,7 mi, oitavas € 11 mi, quartas € 12,5 mi, final € 18,5 mi + título € 6,5 mi', () => {
    const t = data.economy.competitionPrizes!;
    const ucl = t.CHAMPIONS;
    expect(ucl.participation).toBe(18_620_000);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const comp = fakeUcl(ids);
    const got: Record<string, number> = {};
    payPhasePrizes(comp, ucl, (id, v) => { got[id] = (got[id] ?? 0) + v; });
    expect(got.a).toBe(18_620_000 + 11_000_000 + 12_500_000 + 18_500_000);
    expect(got.c).toBe(18_620_000 + 1_000_000 + 11_000_000);
    expect(got.e).toBe(18_620_000 + 11_000_000);
    expect(got.f).toBe(18_620_000 + 18_500_000);
    // idempotente: chamar de novo não paga nada
    const again: Record<string, number> = {};
    payPhasePrizes(comp, ucl, (id, v) => { again[id] = v; });
    expect(Object.keys(again)).toEqual([]);
    expect(ucl.champion).toBe(6_500_000);
    // bônus por jogo da fase de liga
    const f = { id: 'x', competitionId: 'UCL', round: 1, date: '2026-09-16', homeId: 'a', awayId: 'b', stageId: 'league' };
    expect(matchBonus(comp, ucl, f, 2, 1)).toEqual([{ clubId: 'a', v: 2_100_000, why: 'vitória' }]);
    expect(matchBonus(comp, ucl, f, 1, 1).map((x) => x.v)).toEqual([700_000, 700_000]);
    expect(matchBonus(comp, ucl, { ...f, stageId: 'ko' }, 2, 1)).toEqual([]);
    expect(phaseKeyOf(comp, 'ko', 0)).toBe('r16');
    expect(phaseKeyOf(comp, 'ko', 3)).toBe('final');
    expect(phaseKeyOf(comp, 'playoff', 0)).toBe('playoff');
  });

  it('Libertadores (US$ → €, 0,87): campeão ~US$ 24 mi na final; fases preliminares e grupos', () => {
    const lib = data.economy.competitionPrizes!.LIBERTADORES;
    expect(lib.reach!.final + lib.champion!).toBe(Math.round((24e6 * 0.87) / 1000) * 1000);
    expect(lib.reach!.groups).toBe(2_610_000);
    expect(lib.win).toBe(287_000);
    const comp = state.competitions.find((c) => c.id === 'LIBERTADORES')!;
    expect(phaseKeyOf(comp, comp.format!.stages[0].id, 0)).toBe('q1');
    expect(phaseKeyOf(comp, comp.format!.stages.find((s) => s.kind === 'table')!.id)).toBe('groups');
  });

  it('merit por posição: Premier League £ 2,8 mi por posição; Brasileirão do 1º ao 16º', () => {
    const pl = data.economy.merit!['ING-1'];
    expect(Math.abs(meritAt(pl, 1) - meritAt(pl, 2) - (pl.first - pl.last) / 19)).toBeLessThan(1);
    expect(Math.abs((pl.first - pl.last) / 19 - 2.8e6 * 1.17)).toBeLessThan(2000);
    expect(meritAt(pl, 20)).toBe(pl.last);
    const br = data.economy.merit!['BRA-1'];
    expect(meritAt(br, 16)).toBe(br.last);
    expect(meritAt(br, 17)).toBe(0);
  });
});

describe('Etapa 4: teto da folha salarial', () => {
  it('humano: contrato que estoura o teto é vetado pela diretoria; abaixo do teto segue para o jogador', () => {
    const s = JSON.parse(JSON.stringify(state)) as SeasonState;
    const sq = careerSquads(s, worldSquads(world, base));
    const ceiling = s.clubInfo!.flarj.wageCeiling!;
    const monthly = sq('flarj').reduce((t, p) => t + p.wage, 0);
    expect(monthly * 12).toBeLessThan(ceiling);
    // jogador livre de teste no mercado
    const p: Player = { ...sq('palmeiras')[0], id: 'free:test', name: 'Teste Livre' };
    s.market!.moves[p.id] = '';
    s.market!.players[p.id] = p;
    const o = makeOffer(s, sq, { buyerId: 'flarj', player: p, fee: 0 });
    expect(o.error).toBeUndefined();
    const huge = Math.ceil((ceiling - monthly * 12) / 12) + 100_000;
    const r = proposeContract(o.state, sq, { offerId: o.offer!.id, wage: huge, years: 2 });
    expect(r.error).toMatch(/diretoria vetou/);
    const ok = proposeContract(o.state, sq, { offerId: o.offer!.id, wage: Math.max(p.wage, 50_000), years: 2 });
    expect(ok.error).toBeUndefined();
    // a checagem da IA usa a mesma regra
    expect(checkWageCeiling(s, 'flarj', sq('flarj'), huge).ok).toBe(false);
    expect(checkWageCeiling(s, 'flarj', sq('flarj'), 10_000).ok).toBe(true);
  });
});

describe('Etapa 4: saves das Etapas 1–3', () => {
  it('migração: perfil econômico, tabelas de prêmios e teto calculados; Moral da Torcida padrão 60', () => {
    const old = JSON.parse(JSON.stringify(state)) as SeasonState;
    delete old.career!.econ;
    for (const i of Object.values(old.clubInfo!)) {
      for (const k of ['tvPerSeason', 'staffPerSeason', 'coachMonthly', 'maintenancePerSeason', 'opexPerSeason', 'ownerPerSeason', 'wageCeiling', 'creditLimit', 'basePrice', 'fill0', 'gatePerSeason', 'leagueKey', 'code', 'ownerBacked'] as const) delete i[k];
    }
    for (const c of Object.values(old.clubs)) delete c.fanMorale;
    const m = migrateCareer(world, old, { data });
    expect(m.econMigrated).toBe(true);
    expect(m.migrated).toBe(false);
    expect(m.state!.career!.econ).toBeTruthy();
    expect(m.state!.clubInfo!.flarj.wageCeiling).toBe(state.clubInfo!.flarj.wageCeiling);
    expect(m.state!.clubInfo!.flarj.tvPerSeason).toBe(state.clubInfo!.flarj.tvPerSeason);
    expect(m.state!.clubs.flarj.fanMorale ?? ECON.fanDefault).toBe(60);
    // idempotente
    expect(migrateCareer(m.world, m.state, { data }).econMigrated).toBeUndefined();
    // sem dados: o trecho segue (economia antiga) e continua jogável
    const n = migrateCareer(world, old);
    expect(n.econMigrated).toBeUndefined();
    expect(advanceDay(n.state!, worldSquads(world, base)).state.date).toBe('2026-01-02');
  });
});

describe('Etapa 4: sustentabilidade em 3 temporadas', () => {
  it('mediana do Δcaixa/receita por temporada dentro de ±12% em cada região', () => {
    const c = createCareer({ data, humanClubIds: ['flarj'], season: 2026, seed: 'stage4-sustain', squads: base, options: { light: 'all' } });
    let w = c.world, s = c.state;
    const pools = loadPools(data);
    const R: Record<string, number> = {};
    const start: Record<string, number> = {};
    for (const x of data.clubs) if (x.finances?.revenue && !x.guest) { R[x.id] = x.finances.revenue; start[x.id] = w.balances[x.id]; }
    const group = (id: string) => {
      const lg = data.clubs.find((x) => x.id === id)?.leagueId ?? '';
      if (/^(ING|ESP|ITA|ALE|FRA)-1$/.test(lg)) return 'EU';
      if (lg === 'BRA-1') return 'BRA-1';
      if (lg === 'BRA-2') return 'BRA-2';
      if (lg === 'ARG-1') return 'ARG';
      if (/^(URU|COL|CHI|PAR|EQU)-1$/.test(lg)) return 'SA';
      if (lg === 'ARS-1') return 'ARS';
      return null;
    };
    const d: Record<string, number[]> = {};
    const net: Record<string, number[]> = {};
    let sq = worldSquads(w, base);
    while (s.date < '2029-01-01') {
      if (turnoverDue(s)) {
        const closes = s.segment!.closes;
        for (const [id, cl] of Object.entries(s.clubs)) {
          const g = group(id), info = s.clubInfo?.[id];
          if (!g || !R[id] || (closes === 'calendar') !== (info?.region === 'SA')) continue;
          // (Etapa 5, de propósito) o mercado completo faz da América do Sul uma região vendedora: o saldo de
          // transferências (vendas − compras − rescisões) é medido à parte; a sustentabilidade é a da operação
          const transfers = cl.finance?.transfers ?? 0;
          (d[g] ??= []).push((cl.balance - start[id] - transfers) / R[id]);
          (net[g] ??= []).push(transfers / R[id]);
          start[id] = cl.balance;
        }
        const r = nextSeason(w, s, base, data, pools, {});
        w = r.world; s = r.state; sq = worldSquads(w, base);
        continue;
      }
      s = advanceDay(s, sq, {}, { inPlace: true }).state;
    }
    const med = (a: number[]) => { const x = a.slice().sort((p, q) => p - q); return x[x.length >> 1]; };
    for (const g of ['EU', 'BRA-1', 'BRA-2', 'ARG', 'SA', 'ARS']) {
      const m = med(d[g]);
      expect(Math.abs(m), `${g}: mediana ${(m * 100).toFixed(1)}% (n=${d[g].length})`).toBeLessThan(0.12);
    }
    // (Etapa 5) saldo de transferências: a elite sul-americana vende mais do que compra; ninguém se arruína no mercado
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(net.SA)).toBeGreaterThan(0);
    for (const g of ['EU', 'BRA-1', 'BRA-2', 'ARG', 'SA', 'ARS']) expect(Math.abs(med(net[g])), `${g}: transferências`).toBeLessThan(0.25);
    // clube grande europeu não precisa de aporte; o caixa do Real Madrid segue positivo
    expect(s.clubs['realmadrid-esp']?.finance?.owner ?? 0).toBe(0);
    expect(w.balances['realmadrid-esp'] ?? s.clubs['realmadrid-esp'].balance, fmtMoneyShort(s.clubs['realmadrid-esp'].balance)).toBeGreaterThan(0);
  }, 600_000);
});
