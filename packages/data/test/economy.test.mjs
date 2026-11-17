// (Etapa 4) Tabelas da economia (prizes.mjs → economy.json) e recalibração da folha (real.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENCY, COMPETITION_PRIZES, MERIT, TV, WAGE_RATIO, economyV2, wageRatioFor } from '../src/prizes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, '../../../apps/web/public/data');

test('tabelas: câmbio fixo, UCL 2025/26, Libertadores em US$, merit da Premier League', () => {
  assert.equal(CURRENCY.brlPerEur, 6.3);
  assert.equal(COMPETITION_PRIZES.CHAMPIONS.participation, 18_620_000);
  assert.deepEqual(COMPETITION_PRIZES.CHAMPIONS.reach, { playoff: 1e6, r16: 11e6, qf: 12.5e6, sf: 15e6, final: 18.5e6 });
  assert.equal(COMPETITION_PRIZES.LIBERTADORES.reach.final + COMPETITION_PRIZES.LIBERTADORES.champion, 20_880_000);
  assert.ok(TV['ING-1'].min >= 100e6 && TV['ING-1'].max + MERIT['ING-1'].first >= 175e6);
  assert.ok(TV['BRA-1'].min >= 20e6 && TV['BRA-1'].max <= 60e6);
  assert.equal(wageRatioFor('ALE', 'ALE-1').cap, 0.55);
  assert.equal(wageRatioFor('ARS', 'ARS-1', true), WAGE_RATIO.owner);
  for (const [k, v] of Object.entries(economyV2().competitionPrizes)) assert.ok(v.source && v.confidence, k);
});

test('dados gerados: folha recalibrada (Flamengo ~€ 100 mi) e economy.json v2', { skip: !fs.existsSync(path.join(DATA, 'clubs-index.json')) }, () => {
  const clubs = JSON.parse(fs.readFileSync(path.join(DATA, 'clubs-index.json'), 'utf8'));
  const fla = clubs.find((c) => c.id === 'flarj');
  assert.ok(fla.finances.wageBill > 85e6, `Flamengo ${fla.finances.wageBill}`);
  // folha/receita mediana por liga dentro de uma faixa realista
  const by = {};
  for (const c of clubs) if (c.leagueId && c.finances?.revenue) (by[c.leagueId] ??= []).push(c.finances.wageBill / c.finances.revenue);
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  for (const lg of ['ING-1', 'ESP-1', 'ITA-1', 'ALE-1', 'FRA-1', 'BRA-1', 'BRA-2', 'ARG-1']) assert.ok(med(by[lg]) > 0.3 && med(by[lg]) < 0.7, `${lg}: ${med(by[lg])}`);
  const eco = JSON.parse(fs.readFileSync(path.join(DATA, 'economy.json'), 'utf8'));
  assert.equal(eco.version, 2);
  assert.ok(eco.tv && eco.merit && eco.competitionPrizes && eco.wageRatio && eco.ownerBacked.includes('alnassr-ara'));
});
