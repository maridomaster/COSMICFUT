/**
 * (Base) Categorias de base: revelações periódicas (overall 60–82, potencial 75–95, topo raro, salário pequeno),
 * promover entra no elenco e atravessa a virada; dispensar tira da lista; tudo determinístico.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { ACADEMY, academyWage, nameBank, promoteProspect, releaseProspect, rollAcademyRatings, uniqueName } from '../src/season/academy';
import { careerSquads, createCareer, seasonOver, worldSquads } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { releasePlayer } from '../src/transfers/actions';
import { loadBase, loadData, loadPools, runCareer } from './career-helpers';

describe('base: sorteio', () => {
  it('overall 60–82 e potencial 75–95, com o topo raro e potencial sempre acima do overall', () => {
    const r = new Rng('academy-dist');
    const N = 20000;
    const ovr: number[] = [], pot: number[] = [];
    for (let i = 0; i < N; i++) {
      const x = rollAcademyRatings(r);
      expect(x.overall).toBeGreaterThanOrEqual(60);
      expect(x.overall).toBeLessThanOrEqual(82);
      expect(x.potential).toBeGreaterThanOrEqual(75);
      expect(x.potential).toBeLessThanOrEqual(95);
      expect(x.potential).toBeGreaterThanOrEqual(x.overall + ACADEMY.minGrowth);
      ovr.push(x.overall); pot.push(x.potential);
    }
    const share = (a: number[], f: (v: number) => boolean) => a.filter(f).length / N;
    const med = (a: number[]) => a.slice().sort((x, y) => x - y)[N >> 1];
    expect(med(ovr)).toBeLessThanOrEqual(66);
    expect(med(pot)).toBeLessThanOrEqual(84);
    expect(share(ovr, (v) => v >= 80)).toBeLessThan(0.06);
    expect(share(ovr, (v) => v === 82)).toBeLessThan(0.02);
    expect(share(pot, (v) => v >= 93)).toBeLessThan(0.07);
    // e acontece de vez em quando
    expect(share(ovr, (v) => v >= 80)).toBeGreaterThan(0);
    expect(share(pot, (v) => v === 95)).toBeGreaterThan(0);
  });

  it('salário sempre pequeno (no máximo € 3 mil por mês)', () => {
    expect(academyWage(60)).toBe(800);
    expect(academyWage(82)).toBe(3000);
  });
});

describe('base: carreira', () => {
  it('revela de tempos em tempos; promover entra no elenco e atravessa a virada; dispensar tira da lista', () => {
    const data = loadData();
    const base = loadBase();
    const pools = loadPools(data);
    const human = 'saopaulo-bra';
    const c = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'base', squads: base });
    let { world, state } = runCareer(c.world, c.state, base, data, pools, { until: '2026-07-01' });
    const a = state.market!.academy![human];
    expect(a).toBeDefined();
    // ~6 meses: 3+ revelações (intervalo 30–60 dias), no máximo 6 esperando
    expect(a.seq).toBeGreaterThanOrEqual(3);
    expect(a.prospects.length).toBeGreaterThan(0);
    expect(a.prospects.length).toBeLessThanOrEqual(ACADEMY.maxProspects);
    expect(state.news.some((n) => n.clubId === human && n.text.startsWith('Base: revelado'))).toBe(true);
    for (const x of a.prospects) {
      expect(x.player.youth).toBe(true);
      expect(x.player.wage).toBeLessThanOrEqual(3000);
      expect(x.player.name.length).toBeGreaterThan(2);
      expect(x.expiresOn > state.date).toBe(true);
    }
    // determinismo: a mesma carreira revela os mesmos jogadores
    const c2 = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'base', squads: base });
    const again = runCareer(c2.world, c2.state, base, data, pools, { until: '2026-07-01' });
    expect(again.state.market!.academy![human].prospects.map((x) => x.player)).toEqual(a.prospects.map((x) => x.player));

    const sq = () => careerSquads(state, worldSquads(world, base));
    const promoted = a.prospects[0].player;
    // elenco cheio (limite da base): bloqueia; abre vaga dispensando o pior
    while (sq()(human).length >= ACADEMY.squadCap) {
      expect(promoteProspect(state, sq(), human, promoted.id).error).toMatch(/máximo/);
      const worst = sq()(human).slice().sort((x, y) => x.overall - y.overall)[0];
      state = releasePlayer(state, sq(), human, worst.id).state;
    }
    const r = promoteProspect(state, sq(), human, promoted.id);
    expect(r.error).toBeUndefined();
    state = r.state;
    expect(state.market!.academy![human].prospects.some((x) => x.player.id === promoted.id)).toBe(false);
    const inSquad = sq()(human).find((p) => p.id === promoted.id);
    expect(inSquad?.wage).toBe(promoted.wage);
    expect(promoteProspect(state, sq(), human, promoted.id).error).toBeTruthy();
    const left = state.market!.academy![human].prospects[0];
    if (left) {
      const d = releaseProspect(state, human, left.player.id);
      expect(d.error).toBeUndefined();
      expect(d.state.market!.academy![human].prospects.some((x) => x.player.id === left.player.id)).toBe(false);
      state = d.state;
    }

    // virada do humano: o promovido continua no clube e a base continua
    ({ world, state } = runCareer(world, state, base, data, pools));
    expect(seasonOver(state)).toBe(true);
    const seqBefore = state.market!.academy![human].seq;
    const n = nextSeason(world, state, base, data, pools, {});
    expect(worldSquads(n.world, base)(human).some((p) => p.id === promoted.id)).toBe(true);
    expect(n.state.market!.academy![human].seq).toBe(seqBefore);
  }, 300_000);
});

describe('base: nomes', () => {
  const pl = (name: string, nationalityId = 29) => ({ id: name, name, nationalityId }) as never;

  it('nome aleatório nunca repete um jogador existente nem um revelado anterior', () => {
    const bank = nameBank([pl('Pedro Silva'), pl('João Souza'), pl('Lucas Lima'), pl('Rafael Costa'), pl('Bruno Alves'), pl('Hans Müller', 4)], 29);
    expect(bank.given).toEqual(['Bruno', 'João', 'Lucas', 'Pedro', 'Rafael']);
    expect(bank.surnames).not.toContain('Müller');
    const used = new Set<string>();
    const r = new Rng('nomes');
    for (let i = 0; i < 200; i++) {
      const n = uniqueName(bank, used, r);
      expect(bank.taken.has(n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())).toBe(false);
      expect(used.has(n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())).toBe(false);
      used.add(n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    }
  });

  it('na carreira: um ano de revelações, todos os nomes diferentes entre si e de qualquer jogador do jogo', () => {
    const data = loadData();
    const base = loadBase();
    const pools = loadPools(data);
    const human = 'santos';
    const c = createCareer({ data, humanClubIds: [human], season: 2026, seed: 'nomes', squads: base });
    const { world, state } = runCareer(c.world, c.state, base, data, pools, { until: '2026-12-20' });
    const a = state.market!.academy![human];
    const names = a.names ?? [];
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(new Set(names).size).toBe(names.length);
    const sq = careerSquads(state, worldSquads(world, base));
    const existing = new Set<string>();
    for (const id of Object.keys(state.clubs)) for (const p of sq(id)) existing.add(p.name);
    for (const n of names) expect(existing.has(n)).toBe(false);
  }, 300_000);
});
