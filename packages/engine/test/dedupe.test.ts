/**
 * Jogadores duplicados na base (o mesmo jogador em dois clubes — ex.: Carlos Espí no Real Madrid e no Levante):
 * a carreira fica com UMA cópia; a cópia mexida (clube humano, transferida) nunca sai.
 */
import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import { createCareer, duplicateGroups, migrateCareer, retireDuplicatePlayers, worldSquads, type WorldState } from '../src';
import { loadBase, loadData } from './career-helpers';

const pl = (id: string, o: Partial<Player> = {}): Player =>
  ({ id, name: 'Fulano Teste', position: 'FW', age: 21, nationalityId: 65, side: 'R', traits: [], star: false, highlight: false, worldClass: false, overall: 77, potential: 89, wage: 1000, value: 1000, youth: false, tmId: null, ...o }) as Player;

const emptyWorld = (humanClubIds: string[] = []): WorldState =>
  ({ season: 2026, humanClubIds, players: { delta: {}, club: {}, data: {}, retired: {}, contractEnd: {}, freeSince: {}, seq: 0, loans: {} } }) as unknown as WorldState;

describe('jogadores duplicados na base', () => {
  const squads: Record<string, Player[]> = {
    real: [pl('real:1', { wage: 800000 }), pl('real:2', { name: 'Outro', overall: 70 })],
    levante: [pl('levante:1', { age: 20, side: 'L', wage: 58000 })],
    // mesmo nome, mas outra pessoa (idade bem diferente)
    xx: [pl('xx:1', { age: 33, overall: 60 })],
  };
  const base = (id: string) => squads[id] ?? [];
  const ids = Object.keys(squads);

  it('agrupa só as cópias da mesma pessoa (nome, país, posição, idade e overall próximos)', () => {
    const g = duplicateGroups(ids, base);
    expect(g).toHaveLength(1);
    expect(g[0].map((x) => x.p.id).sort()).toEqual(['levante:1', 'real:1']);
  });

  it('sem cópia mexida: fica a melhor (maior salário no empate de overall) e só uma vez por carreira', () => {
    const w = emptyWorld();
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(1);
    expect(Object.keys(w.players.retired)).toEqual(['levante:1']);
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(0);
    expect(worldSquads(w, base)('levante')).toHaveLength(0);
    expect(worldSquads(w, base)('real').map((p) => p.id)).toContain('real:1');
  });

  it('a cópia transferida fica; sai a que continua parada no clube base', () => {
    const w = emptyWorld();
    w.players.club['levante:1'] = 'gremio';
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(1);
    expect(Object.keys(w.players.retired)).toEqual(['real:1']);
  });

  it('cópia citada no mercado da temporada ou em clube humano nunca sai', () => {
    const w = emptyWorld(['real']);
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(1);
    expect(Object.keys(w.players.retired)).toEqual(['levante:1']);
    const w2 = emptyWorld(['real']);
    const state = { season: 2026, humanClubIds: ['real'], market: { moves: { 'levante:1': 'gremio' } } } as never;
    expect(retireDuplicatePlayers(w2, state, ids, base)).toBe(0);
    expect(w2.players.dedup).toBe(1);
  });

  it('dados reais: Carlos Espí (Real Madrid × Levante) vira um só na carreira nova e na migração', () => {
    const data = loadData();
    const realBase = loadBase();
    const all = data.clubs.map((c) => c.id);
    const groups = duplicateGroups(all, realBase);
    const espi = groups.find((g) => g.some((x) => x.p.name === 'Carlos Espí'));
    expect(espi?.map((x) => x.clubId).sort()).toEqual(['levante-esp', 'realmadrid-esp']);
    // save antigo (sem dedup) com a cópia do Levante transferida para o Grêmio
    const { world, state } = createCareer({ data, humanClubIds: ['saopaulo-bra'], season: 2026, seed: 'dedupe', squads: realBase });
    expect(world.players.dedup).toBe(1);
    const old = JSON.parse(JSON.stringify(world)) as WorldState;
    delete old.players.dedup;
    old.players.retired = {};
    old.players.club['levante-esp:24'] = 'gremio';
    const m = migrateCareer(old, state, { data, squads: realBase });
    expect(m.dedupMigrated).toBeGreaterThan(0);
    expect(m.world.players.retired['realmadrid-esp:26']).toBeDefined();
    expect(m.world.players.retired['levante-esp:24']).toBeUndefined();
  }, 120_000);
});
