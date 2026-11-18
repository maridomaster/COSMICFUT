/**
 * Jogadores duplicados na base (o mesmo jogador em dois clubes — ex.: Carlos Espí no Real Madrid e no Levante):
 * a carreira fica com UMA cópia; a cópia mexida (clube humano, transferida) nunca sai; saves já migrados não perdem
 * as duas cópias; nenhum elenco encolhe abaixo do mínimo.
 */
import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import { createCareer, DEDUP_REV, duplicateGroups, migrateCareer, retireDuplicatePlayers, worldSquads, type WorldState } from '../src';
import { loadBase, loadData } from './career-helpers';

const pl = (id: string, o: Partial<Player> = {}): Player =>
  ({ id, name: 'Fulano Teste', position: 'FW', age: 21, nationalityId: 65, side: 'R', traits: [], star: false, highlight: false, worldClass: false, overall: 77, potential: 89, wage: 1000, value: 1000, youth: false, tmId: null, ...o }) as Player;

/** elenco com 20 "figurantes" (nomes únicos) + os jogadores do teste */
const squad = (club: string, ...ps: Player[]) => [...ps, ...Array.from({ length: 20 }, (_, i) => pl(`${club}:f${i}`, { name: `Figurante ${club} ${i}` }))];

const emptyWorld = (humanClubIds: string[] = []): WorldState =>
  ({ season: 2026, humanClubIds, players: { delta: {}, club: {}, data: {}, retired: {}, contractEnd: {}, freeSince: {}, seq: 0, loans: {} } }) as unknown as WorldState;

describe('jogadores duplicados na base', () => {
  const squads: Record<string, Player[]> = {
    real: squad('real', pl('real:1', { wage: 800000 })),
    levante: squad('levante', pl('levante:1', { age: 20, side: 'L', wage: 58000 })),
    // mesmo nome, mas outra pessoa (idade bem diferente)
    xx: squad('xx', pl('xx:1', { age: 33, overall: 60 })),
  };
  const base = (id: string) => squads[id] ?? [];
  const ids = Object.keys(squads);

  it('agrupa só as cópias da mesma pessoa', () => {
    const g = duplicateGroups(ids, base);
    expect(g).toHaveLength(1);
    expect(g[0].map((x) => x.p.id).sort()).toEqual(['levante:1', 'real:1']);
  });

  it('sem cópia mexida: fica a melhor (maior salário no empate de overall) e só uma vez por revisão', () => {
    const w = emptyWorld();
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(1);
    expect(Object.keys(w.players.retired)).toEqual(['levante:1']);
    expect(w.players.dedup).toBe(DEDUP_REV);
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(0);
    expect(worldSquads(w, base)('levante').some((p) => p.id === 'levante:1')).toBe(false);
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
  });

  it('save já migrado na revisão anterior: a cópia que ficou NÃO sai (o jogador nunca some de vez)', () => {
    const w = emptyWorld();
    w.players.dedup = 1;
    w.players.retired['levante:1'] = 2026; // revisão 1 já tirou esta
    expect(retireDuplicatePlayers(w, undefined, ids, base)).toBe(0);
    expect(w.players.retired['real:1']).toBeUndefined();
  });

  it('nome raro: posição vizinha / idade ±2 / overall ±6 ainda é o mesmo jogador; nome comum exige a regra estrita', () => {
    const sq: Record<string, Player[]> = {
      a: squad('a', pl('a:1', { name: 'Fabio Miretti', position: 'MF', age: 23, overall: 74 }), pl('a:2', { name: 'João Pedro', position: 'FW', age: 23 })),
      b: squad('b', pl('b:1', { name: 'Fábio Miretti', position: 'FW', age: 21, overall: 75 }), pl('b:2', { name: 'João Pedro', position: 'CB', age: 23 })),
      c: squad('c', pl('c:2', { name: 'Joao Pedro', position: 'FW', age: 25 })),
      d: squad('d', pl('d:2', { name: 'João Pedro', position: 'MF', age: 30 })),
    };
    const g = duplicateGroups(Object.keys(sq), (id) => sq[id] ?? []);
    expect(g.map((x) => x.map((y) => y.p.id).sort())).toEqual([['a:1', 'b:1']]);
  });

  it('o elenco nunca fica abaixo do mínimo (várias cópias no mesmo clube)', () => {
    const many = Array.from({ length: 6 }, (_, i) => pl(`ba:${i}`, { name: 'Nick Stony', age: 16, overall: 40 + i }));
    const sq: Record<string, Player[]> = { ba: [...many, ...Array.from({ length: 13 }, (_, i) => pl(`ba:f${i}`, { name: `Outro Nome ${i}` }))] };
    const w = emptyWorld();
    const n = retireDuplicatePlayers(w, undefined, ['ba'], (id) => sq[id] ?? []);
    expect(n).toBe(1); // 19 → 18
    expect(worldSquads(w, (id) => sq[id] ?? [])('ba')).toHaveLength(18);
  });

  it('dados reais: Carlos Espí (Real Madrid × Levante) vira um só na carreira nova e na migração', () => {
    const data = loadData();
    const realBase = loadBase();
    const all = data.clubs.map((c) => c.id);
    const groups = duplicateGroups(all, realBase);
    const espi = groups.find((g) => g.some((x) => x.p.name === 'Carlos Espí'));
    expect(espi?.map((x) => x.clubId).sort()).toEqual(['levante-esp', 'realmadrid-esp']);
    const { world, state } = createCareer({ data, humanClubIds: ['saopaulo-bra'], season: 2026, seed: 'dedupe', squads: realBase });
    expect(world.players.dedup).toBe(DEDUP_REV);
    // nenhum clube abaixo do mínimo por causa da limpeza
    for (const id of all) {
      const before = realBase(id).length;
      if (before >= 18) expect(worldSquads(world, realBase)(id).length).toBeGreaterThanOrEqual(18);
    }
    // save antigo (sem dedup) com a cópia do Levante transferida para o Grêmio
    const old = JSON.parse(JSON.stringify(world)) as WorldState;
    delete old.players.dedup;
    old.players.retired = {};
    old.players.club['levante-esp:24'] = 'gremio';
    const m = migrateCareer(old, state, { data, squads: realBase });
    expect(m.dedupMigrated).toBeGreaterThan(0);
    expect(m.world.players.retired['realmadrid-esp:26']).toBeDefined();
    expect(m.world.players.retired['levante-esp:24']).toBeUndefined();
    // save migrado na revisão 1: a revisão 2 só acrescenta, nunca tira a cópia que ficou
    const rev1 = JSON.parse(JSON.stringify(m.world)) as WorldState;
    rev1.players.dedup = 1;
    const m2 = migrateCareer(rev1, state, { data, squads: realBase });
    expect(m2.world.players.retired['levante-esp:24']).toBeUndefined();
    for (const g of groups) expect(g.some((x) => m2.world.players.retired[x.p.id] === undefined)).toBe(true);
  }, 120_000);
});
