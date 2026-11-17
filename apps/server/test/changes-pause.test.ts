/**
 * (Atualização 38) Pausa de mudanças no online: abrir o painel de mudanças pausa o relógio compartilhado na hora,
 * só quem pediu libera, cota de 2 pausas por técnico e por tempo, timeout e intervalo.
 */
import { describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import { autoPickLineup, DEFAULT_TACTIC, type Fixture, type MatchConfig, type MatchTeamInput } from '@cosmicfut/engine';
import { CHANGES_PAUSES_PER_HALF, LiveMatch, type LiveMatchHooks } from '../src/live-match.ts';
import type { MatchPausePayload } from '../src/protocol.ts';

const POS: Player['position'][] = ['GK', 'GK', 'FB', 'FB', 'FB', 'FB', 'CB', 'CB', 'CB', 'CB', 'MF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'FW'];
function squad(club: string): Player[] {
  return POS.map((position, i) => ({
    id: `${club}:${i}`, name: `${club} ${i}`, position, age: 25, nationalityId: 29, side: i % 2 ? 'L' : 'R', traits: [],
    star: false, highlight: false, worldClass: false, overall: 72 + (i % 5), potential: 80, wage: 10000, value: 1_000_000, youth: false, tmId: null,
  }));
}
function team(club: string, isHome: boolean): MatchTeamInput {
  const players = squad(club);
  return { clubId: club, name: club, players, lineup: autoPickLineup(players, DEFAULT_TACTIC), tactic: { ...DEFAULT_TACTIC }, isHome, control: 'human', morale: 50 };
}
const fixture: Fixture = { id: 'L:1:h-a', competitionId: 'L', round: 1, date: '2026-02-01', homeId: 'h', awayId: 'a' };

function mk(opts: { pvp?: boolean; changesPauseMs?: number; halfTimeTimeoutMs?: number } = {}) {
  const pauses: MatchPausePayload[] = [];
  let active = opts.pvp === false ? ['A'] : ['A', 'B'];
  const hooks: LiveMatchHooks = {
    tick: () => undefined,
    info: () => undefined,
    pause: (_m, p) => void pauses.push(p),
    end: () => undefined,
    activeHumans: () => active,
  };
  const cfg: MatchConfig = { seed: 'pause-test', home: team('h', true), away: team('a', false) };
  if (opts.pvp === false) cfg.away.control = 'ai';
  const m = new LiveMatch(fixture, cfg, { home: 'A', away: opts.pvp === false ? null : 'B' }, {
    speedMs: 2, halfTimeTimeoutMs: opts.halfTimeTimeoutMs ?? 5_000, pauseTimeoutMs: 5_000, changesPauseMs: opts.changesPauseMs,
  }, hooks);
  return { m, pauses, setActive: (a: string[]) => (active = a) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await sleep(2);
  }
}

describe('Atualização 38 — pausa de mudanças (online)', () => {
  it('abrir mudanças pausa na hora; só quem pediu libera; o relógio não anda enquanto isso', async () => {
    const { m, pauses } = mk();
    m.start();
    await until(() => m.sim.state.minute >= 3);
    expect(m.requestChangesPause('A')).toBeNull();
    const p = pauses[pauses.length - 1];
    expect(p).toMatchObject({ paused: true, reason: 'changes', waitingFor: ['A'], by: 'A' });
    expect(p.changesLeft).toEqual({ A: CHANGES_PAUSES_PER_HALF - 1, B: CHANGES_PAUSES_PER_HALF });
    const minute = m.sim.state.minute;
    await sleep(40);
    expect(m.sim.state.minute).toBe(minute);
    // o adversário não libera a pausa de quem está mexendo no time
    expect(m.resume('B')).toBeNull();
    expect(m.pauseState()?.reason).toBe('changes');
    // substituição durante a pausa
    expect(m.resume('A')).toBeNull();
    expect(pauses[pauses.length - 1].paused).toBe(false);
    await until(() => m.sim.state.minute > minute);
    m.stop();
  });

  it('adversário que abre mudanças durante a pausa entra na espera sem gastar cota', async () => {
    const { m } = mk();
    m.start();
    await until(() => m.sim.state.minute >= 2);
    m.requestChangesPause('A');
    expect(m.requestChangesPause('B')).toBeNull();
    expect(m.pauseState()!.waitingFor.sort()).toEqual(['A', 'B']);
    expect(m.changesLeft()).toEqual({ A: CHANGES_PAUSES_PER_HALF - 1, B: CHANGES_PAUSES_PER_HALF });
    m.resume('A');
    expect(m.pauseState()?.waitingFor).toEqual(['B']);
    m.resume('B');
    expect(m.pauseState()).toBeNull();
    m.stop();
  });

  it('cota: 2 pausas por técnico no 1º tempo; a 3ª é recusada e a partida segue', async () => {
    const { m } = mk();
    m.start();
    await until(() => m.sim.state.minute >= 1);
    for (let i = 0; i < CHANGES_PAUSES_PER_HALF; i++) {
      expect(m.requestChangesPause('A')).toBeNull();
      m.resume('A');
    }
    const err = m.requestChangesPause('A');
    expect(err).toMatch(/Limite de 2 pausas/);
    expect(m.pauseState()).toBeNull();
    // o outro técnico ainda tem as dele
    expect(m.requestChangesPause('B')).toBeNull();
    m.resume('B');
    m.stop();
  });

  it('timeout: a pausa de mudanças termina sozinha', async () => {
    const { m, pauses } = mk({ changesPauseMs: 25 });
    m.start();
    await until(() => m.sim.state.minute >= 1);
    m.requestChangesPause('A');
    await until(() => pauses.some((p) => !p.paused && p.reason === 'changes'), 1000);
    expect(m.pauseState()).toBeNull();
    m.stop();
  });

  it('intervalo: para para todos (vestiário); pedir mudanças no intervalo não gasta cota; cota renova no 2º tempo', async () => {
    const { m, pauses } = mk();
    m.start();
    // usa as duas pausas do 1º tempo
    await until(() => m.sim.state.minute >= 1);
    m.requestChangesPause('A'); m.resume('A');
    m.requestChangesPause('A'); m.resume('A');
    expect(m.changesLeft().A).toBe(0);
    await until(() => m.pauseState()?.reason === 'half-time');
    const ht = pauses.find((p) => p.reason === 'half-time')!;
    expect(ht.waitingFor.sort()).toEqual(['A', 'B']);
    expect(m.requestChangesPause('A')).toBeNull();
    expect(m.pauseState()?.reason).toBe('half-time');
    // intervalo conta como 2º tempo: cota cheia de novo
    expect(m.changesLeft().A).toBe(CHANGES_PAUSES_PER_HALF);
    m.resume('A'); m.resume('B');
    await until(() => m.sim.state.phase === 'second-half');
    expect(m.requestChangesPause('A')).toBeNull();
    expect(m.pauseState()?.reason).toBe('changes');
    m.stop();
  });

  it('PvE: a pausa espera só o humano; IA não trava', async () => {
    const { m } = mk({ pvp: false });
    m.start();
    await until(() => m.sim.state.minute >= 1);
    expect(m.requestChangesPause('A')).toBeNull();
    expect(m.pauseState()?.waitingFor).toEqual(['A']);
    expect(m.requestChangesPause('X')).toMatch(/não está nesta partida/);
    m.resume('A');
    m.stop();
  });
});
