/**
 * Escala real (13/11): finanças proporcionais à receita (REAL_ECONOMY), curvas de valor/salário em euros e
 * orçamento da IA. Usa os dados gerados em apps/web/public/data (com packages/data/real/*.json).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { CareerData, SeasonState } from '../src/contract';
import { createCareer, migrateCareer, seasonOver, squadsFromMarket } from '../src/season/career';
import { loadPools, runCareer } from './career-helpers';
import {
  ECONOMY, foreignMatchdayMonthly, operatingMonthly, ownerSupportPerSeason, REAL_ECONOMY, realOperatingPerSeason, realTicketPrice, ticketRevenue, tvMonthly,
} from '../src/season/economy';
import { marketValue, monthlyWage, revalue, valueCurve } from '../src/season/players';
import { aiBudget } from '../src/transfers/ai';
import { fmtMoneyShort } from '../src/money';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const rj = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

let data: CareerData;
let base: (id: string) => Player[];
let start: SeasonState;
let end: SeasonState;

beforeAll(() => {
  data = {
    clubs: rj('clubs-index.json'), leagues: rj('leagues.json'), states: rj('states.json'), formats: rj('formats.json'),
    competitions: rj('competitions.json'), calendars: rj('calendars.json'), economy: rj('economy.json'), countries: rj('countries.json'),
  };
  const pm = squadsFromMarket(rj('players-market.json'));
  base = (id) => pm.get(id) ?? [];
  const c = createCareer({ data, humanClubIds: ['palmeiras'], season: 2026, seed: 'real-economy', squads: base, options: { light: 'all' } });
  start = JSON.parse(JSON.stringify(c.state)) as SeasonState;
  // (Etapa 1) até a virada do humano (31/12), com a virada automática de 30/06 no meio (o livro-caixa sul-americano
  // atravessa a virada europeia)
  end = runCareer(c.world, c.state, base, data, loadPools(data), { until: '2027-01-31' }).state;
}, 240_000);

describe('escala real: dados', () => {
  it('clubs-index traz finanças reais (euros) e a carreira começa com elas', () => {
    const byId = new Map(data.clubs.map((c) => [c.id, c]));
    const fla = byId.get('flarj')!.finances!;
    expect(fla.revenue).toBeGreaterThan(100_000_000);
    expect(fla.wageBill).toBeGreaterThan(10_000_000);
    expect(start.clubs.flarj.balance).toBe(fla.balance);
    expect(start.clubInfo!.flarj.revenue).toBe(fla.revenue);
    // (Etapa 4) o patrocínio vem do perfil econômico (receita − TV − bilheteria − prêmios esperados), não mais 40% de R
    expect(start.clubInfo!.flarj.sponsorPerSeason).toBeGreaterThan(0.3 * fla.revenue!);
    expect(start.clubInfo!.flarj.tvPerSeason).toBeGreaterThan(20_000_000);
    // (Etapa 4) folha do Flamengo recalibrada (antes ~€ 64 mi; real ~€ 110 mi com funcionários)
    expect(fla.wageBill).toBeGreaterThan(85_000_000);
    // Bayern na casa das centenas de milhões, não 11,9 mi
    expect(byId.get('bayern-ale')!.finances!.balance).toBeGreaterThan(50_000_000);
  });
});

describe('escala real: caixa estável numa temporada', () => {
  const check = (id: string) => {
    const R = start.clubInfo![id].revenue!;
    const b0 = start.clubs[id].balance, b1 = end.clubs[id].balance;
    // nem explode nem desaba: variação dentro de −30%..+60% da receita anual (prêmios e transferências incluídos)
    expect(b1, `${id}: ${fmtMoneyShort(b0)} → ${fmtMoneyShort(b1)} (R ${fmtMoneyShort(R)})`).toBeGreaterThan(b0 - 0.3 * R);
    expect(b1, `${id}: ${fmtMoneyShort(b0)} → ${fmtMoneyShort(b1)} (R ${fmtMoneyShort(R)})`).toBeLessThan(b0 + 0.6 * R);
    // receitas fixas na ordem da receita real: patrocínio + TV + bilheteria entre 60% e 130% de R
    const l = end.clubs[id].finance!;
    const income = l.sponsor + l.tv + l.tickets + (l.owner ?? 0);
    expect(income / R, id).toBeGreaterThan(0.6);
    expect(income / R, id).toBeLessThan(1.3);
  };
  it('Palmeiras (humano) e Flamengo', () => {
    expect(seasonOver(end)).toBe(true);
    check('palmeiras');
    check('flarj');
  });
  it('mediana da Série A e da Série B não desaba nem explode', () => {
    for (const div of ['BRA-1', 'BRA-2']) {
      const ids = end.competitions.find((c) => c.id === div)!.clubIds;
      const rel = ids.map((id) => (end.clubs[id].balance - start.clubs[id].balance) / start.clubInfo![id].revenue!).sort((a, b) => a - b);
      const med = rel[rel.length >> 1];
      expect(med, div).toBeGreaterThan(-0.15);
      expect(med, div).toBeLessThan(0.3);
    }
  });
});

describe('escala real: fórmulas', () => {
  const info = { revenue: 100_000_000, wageBill: 55_000_000, sponsorPerSeason: 40_000_000, division: 1, capacity: 40_000, reputation: 4 };
  it('receitas e custos proporcionais à receita; equilíbrio com a folha inicial', () => {
    expect(tvMonthly(1, info) * 12).toBeCloseTo(REAL_ECONOMY.tvShare * 1e8, -3);
    const opex = realOperatingPerSeason(info);
    expect(opex).toBe(REAL_ECONOMY.breakEvenShare * 1e8 - 55_000_000);
    expect(operatingMonthly(1, false, info)).toBe(Math.round(opex / 12));
    // receitas esperadas − folha − custos = ~3% da receita
    const net = REAL_ECONOMY.incomeShare * 1e8 - 55_000_000 - opex;
    expect(net / 1e8).toBeCloseTo(0.03, 5);
    // preço do ingresso: bilheteria esperada ≈ matchdayShare × R
    const price = realTicketPrice(info);
    expect(price).toBeGreaterThan(5);
    expect(ticketRevenue(30_000, 1, 4, info)).toBe(Math.round(30_000 * price));
    // sem receita: tabelas antigas por divisão (saves antigos)
    expect(ticketRevenue(30_000, 1, 2.5)).toBe(Math.round(30_000 * ECONOMY.ticketPrice['1']));
    expect(ownerSupportPerSeason(info)).toBe(0);
  });
  it('folha acima da receita (ex.: Al Nassr): aporte do dono zera o déficit esperado', () => {
    const sa = { revenue: 220_000_000, wageBill: 330_000_000, sponsorPerSeason: 88_000_000, division: 1, foreign: true };
    const owner = ownerSupportPerSeason(sa);
    expect(owner).toBeGreaterThan(100_000_000);
    const net = REAL_ECONOMY.incomeShare * sa.revenue + owner - sa.wageBill - realOperatingPerSeason(sa);
    expect(Math.abs(net)).toBeLessThan(1);
    expect(foreignMatchdayMonthly(sa)).toBe(Math.round((REAL_ECONOMY.matchdayShare * sa.revenue) / 12));
  });
  it('curvas: valor em euros, evolução preserva o fator do clube, salário genérico plausível', () => {
    expect(valueCurve(26, 70, 70)).toBeCloseTo(2_500_000, -3);
    expect(valueCurve(26, 90, 90)).toBeGreaterThan(100_000_000);
    const p = { age: 22, overall: 80, potential: 86, value: 3 * valueCurve(22, 80, 86) };
    const v = revalue(p, 23, 83, 86);
    expect(v / valueCurve(23, 83, 86)).toBeCloseTo(3, 1);
    expect(marketValue(17, 50, 70, 2)).toBeGreaterThanOrEqual(10_000);
    expect(monthlyWage(27, 85, 5)).toBeGreaterThan(300_000);
    expect(monthlyWage(27, 55, 1)).toBeLessThan(10_000);
  });
  // (Etapa 5, de propósito) na carreira a IA guarda 5% da receita em caixa: o Bayern (€ 130 mi, receita € 860 mi) banca
  // € 87 mi numa compra (antes € 130 mi); o mercado completo é muito mais movimentado
  it('orçamento da IA: Bayern banca um jogador de € 80 mi; um clube da Série B, não', () => {
    const s: SeasonState = {
      ...start,
      clubs: { ...start.clubs, big: { ...start.clubs.palmeiras, clubId: 'big', balance: 130_000_000 }, small: { ...start.clubs.palmeiras, clubId: 'small', balance: 2_500_000 } },
      clubInfo: { ...start.clubInfo, big: { revenue: 860_000_000 }, small: { revenue: 18_000_000 } },
    };
    expect(aiBudget(s, 'big')).toBeGreaterThanOrEqual(80_000_000);
    expect(aiBudget(s, 'small')).toBeLessThan(5_000_000);
  });
  it('formatação curta: bi / mi / mil', () => {
    // (Etapa 4) moeda do jogo: euro; em reais com o câmbio fixo 1 € = R$ 6,30
    expect(fmtMoneyShort(1_050_000_000)).toBe('€ 1,05 bi');
    expect(fmtMoneyShort(120_000_000)).toBe('€ 120 mi');
    expect(fmtMoneyShort(11_900_000)).toBe('€ 11,9 mi');
    expect(fmtMoneyShort(850_000)).toBe('€ 850 mil');
    expect(fmtMoneyShort(-2_350_000)).toBe('-€ 2,35 mi');
    expect(fmtMoneyShort(120_000_000, 'BRL')).toBe('R$ 756 mi');
  });
  it('(Etapa 1) save antigo (rev 2): não migra — volta intacto, marcado como legado', () => {
    const old = JSON.parse(JSON.stringify(start)) as SeasonState;
    for (const i of Object.values(old.clubInfo!)) { delete i.revenue; delete i.wageBill; }
    const world = { rev: 2, options: {}, finance: {} } as never;
    const m = migrateCareer(world, old, { data });
    expect(m.legacy).toBe(true);
    expect(m.state).toBe(old);
    expect(m.state!.clubInfo!.palmeiras.revenue).toBeUndefined();
  });
});
