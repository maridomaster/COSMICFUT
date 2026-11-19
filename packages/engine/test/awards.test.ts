/**
 * (Prêmios) Fim de temporada: Bola de Ouro (pódio), Seleção do Mundo e time do campeonato do humano.
 */
import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { WorldState } from '../src/contract';
import { AWARDS, awardWindow, computeSeasonAwards, pickTeam } from '../src/season/awards';
import { createCareer, migrateCareer } from '../src/season/career';
import { nextSeason } from '../src/season/rollover';
import { loadBase, loadData, loadPools, runCareer } from './career-helpers';

const pl = (id: string, position: Player['position'], overall = 75): Player =>
  ({ id, name: id, position, age: 25, nationalityId: 29, side: 'R', traits: [], star: false, highlight: false, worldClass: false, overall, potential: overall, wage: 1, value: 1, youth: false, tmId: null }) as Player;

describe('prêmios: regras', () => {
  it('janela: a temporada que fechou + a do outro calendário encerrada antes', () => {
    expect(awardWindow('calendar', 2026)).toEqual(['2026', '2025/26']);
    expect(awardWindow('split', 2026)).toEqual(['2026/27', '2026']);
    // (19/11) 1ª premiação: a temporada do outro calendário começou antes da carreira → entra a seguinte (12 meses do mundo)
    expect(awardWindow('calendar', 2026, '2026-01-01')).toEqual(['2026', '2025/26', '2026/27']);
    expect(awardWindow('calendar', 2027, '2026-01-01')).toEqual(['2027', '2026/27']);
    expect(awardWindow('split', 2026, '2026-07-01')).toEqual(['2026/27', '2026', '2027']);
    expect(awardWindow('split', 2027, '2026-07-01')).toEqual(['2027/28', '2027']);
  });

  it('4-3-3 pelo desempenho; mínimo de jogos; título conta; só a liga da temporada no time do campeonato', () => {
    const squads: Record<string, Player[]> = {
      a: [pl('a:gk', 'GK'), pl('a:fw', 'FW', 70), pl('a:fw2', 'FW', 90), pl('a:mf', 'MF')],
      b: [pl('b:fw', 'FW', 70), pl('b:cb', 'CB')],
    };
    const world = {
      history: [{ competitionId: 'BRA-1', name: 'Série A', type: 'league', season: 2026, seasonLabel: '2026', championId: 'b', viceId: null, countryId: 29, division: 1 }],
      records: {
        players: {
          'a:gk': [['2026', '', 30, 0, 0, 72]],
          'a:fw': [['2026', '', 30, 25, 5, 74]],
          // muitos gols, mas poucos jogos: fora
          'a:fw2': [['2026', '', 5, 9, 0, 90]],
          'a:mf': [['2025/26', 'x', 30, 4, 10, 71]],
          // mesmos números do a:fw, mas campeão
          'b:fw': [['2026', '', 30, 25, 5, 74]],
          'b:cb': [['2024', '', 30, 0, 0, 80]],
        },
      },
    } as unknown as Pick<WorldState, 'records' | 'history'>;
    const r = computeSeasonAwards(world, (id) => squads[id] ?? [], ['a', 'b'], {
      cycle: 'calendar', season: 2026, date: '2027-01-01',
      leagues: [{ competitionId: 'BRA-1', name: 'Série A', seasonLabel: '2026', clubIds: ['a', 'b'] }],
    });
    expect(r.label).toBe('2026');
    expect(r.ballonDor[0].playerId).toBe('b:fw');
    expect(r.ballonDor.map((x) => x.playerId)).not.toContain('a:fw2');
    expect(r.world.map((x) => x.playerId).sort()).toEqual(['a:fw', 'a:gk', 'a:mf', 'b:fw']);
    // a:mf jogou fora da liga (clube x, temporada europeia): não entra no time do campeonato
    expect(r.leagues[0].xi.map((x) => x.playerId)).not.toContain('a:mf');
    expect(r.leagues[0].best?.playerId).toBe('b:fw');
    expect(r.ballonDor[0].rating).toBe(7.4);
  });

  it('pickTeam respeita a formação', () => {
    const c = (id: string, position: Player['position'], score: number) => ({ playerId: id, position, score, overall: 70 }) as never;
    const xi = pickTeam([c('g1', 'GK', 9), c('g2', 'GK', 8), ...Array.from({ length: 5 }, (_, i) => c(`f${i}`, 'FW', i))]);
    expect(xi.filter((x) => x.position === 'GK')).toHaveLength(AWARDS.xi.GK);
    expect(xi.filter((x) => x.position === 'FW').map((x) => x.playerId)).toEqual(['f4', 'f3', 'f2']);
  });
});

describe('prêmios: carreira', () => {
  it('na virada do humano: Bola de Ouro, Seleção do Mundo (11) e time do campeonato (11)', () => {
    const data = loadData();
    const base = loadBase();
    const pools = loadPools(data);
    const c = createCareer({ data, humanClubIds: ['saopaulo-bra'], season: 2026, seed: 'premios', squads: base });
    const { world, state, autos } = runCareer(c.world, c.state, base, data, pools);
    // viradas sem humanos (Europa em 30/06) não premiam
    for (const a of autos) expect(a.summary.awards).toBeUndefined();
    const n = nextSeason(world, state, base, data, pools, {});
    const aw = n.summary.awards!;
    expect(aw).toBeDefined();
    expect(aw.label).toBe('2026');
    expect(aw.ballonDor).toHaveLength(3);
    expect(aw.world).toHaveLength(11);
    expect(aw.world.map((x) => x.position)).toEqual(['GK', 'FB', 'FB', 'CB', 'CB', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW']);
    const lg = aw.leagues.find((l) => l.competitionId === 'BRA-1')!;
    expect(lg).toBeDefined();
    expect(lg.xi).toHaveLength(11);
    expect(lg.best).not.toBeNull();
    for (const x of [...aw.world, ...lg.xi]) {
      expect(x.games).toBeGreaterThanOrEqual(AWARDS.minGamesLeague);
      expect(x.rating).toBeGreaterThan(5);
    }
    expect(n.world.awards?.at(-1)).toEqual(aw);
    // (19/11) 1ª premiação: a temporada europeia da carreira começa em julho (2026/27) e entra na janela; antes só
    // sul-americanos disputavam. Volume (70 jogos no Brasil) não decide sozinho.
    const sa = /-(bra|arg|uru|chi|col|par|per|ecu|bol|ven)$/;
    expect(aw.world.filter((x) => !sa.test(x.clubId)).length).toBeGreaterThanOrEqual(4);
    expect(aw.ballonDor.some((x) => !sa.test(x.clubId))).toBe(true);
    // saves antigos: a 1ª Bola de Ouro (só sul-americanos) é refeita e o ícone vai para o novo vencedor
    const fake = { ...aw.ballonDor[1], playerId: 'velho:1', name: 'Velho' };
    const old: WorldState = { ...n.world, awardsRev: undefined, awards: [{ ...aw, ballonDor: [fake] }], honors: { ...n.world.honors, world: { kind: 'world', playerId: 'velho:1', name: 'Velho', clubId: fake.clubId, label: aw.label } } };
    const mig = migrateCareer(old, n.state, { squads: base, data });
    expect(mig.awardsMigrated).toBe(true);
    expect(mig.world.awards!.at(-1)!.ballonDor[0].playerId).toBe(aw.ballonDor[0].playerId);
    expect(mig.world.honors?.world?.playerId).toBe(aw.ballonDor[0].playerId);
    expect(mig.state?.career?.honors?.world?.playerId).toBe(aw.ballonDor[0].playerId);
    expect(migrateCareer(mig.world, mig.state, { squads: base, data }).awardsMigrated).toBeUndefined();
    // (19/11) ícone da Bola de Ouro e Bola de Prata do Brasileirão (só os jogos da liga); passam para o trecho seguinte
    expect(n.world.honors?.world?.playerId).toBe(aw.ballonDor[0].playerId);
    const silver = n.summary.silver?.find((s) => s.competitionId === 'BRA-1');
    expect(silver).toBeDefined();
    expect(silver!.best.games).toBeGreaterThanOrEqual(AWARDS.minGamesLeague);
    expect(n.world.honors?.national?.['BRA-1']?.playerId).toBe(silver!.best.playerId);
    expect(n.state.career?.honors?.world?.playerId).toBe(aw.ballonDor[0].playerId);
    // todas as ligas nacionais (1ª divisão) que fecham ganham a sua Bola de Prata, não só a do humano
    expect(n.summary.silver?.some((s) => s.competitionId === 'ARG-1')).toBe(true);
    expect(n.summary.silver?.some((s) => s.competitionId === 'BRA-2')).toBe(false);
    // goleiros com jogos sem sofrer gol nas linhas
    const gks = aw.world.filter((x) => x.position === 'GK');
    expect(gks.every((x) => (x.cleanSheets ?? 0) > 0)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('PREMIOS', JSON.stringify({ ouro: aw.ballonDor.map((x) => `${x.name} (${x.clubId}) ${x.rating} ${x.goals}g`), craque: lg.best && `${lg.best.name} ${lg.best.rating}`, mundo: aw.world.map((x) => `${x.position} ${x.name} ${x.clubId}`) }));
  }, 400_000);
});
