import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { careerSquads, quickSimulate, unavailablePlayers, worldSquads, type MatchEvent, type MatchResult, type MatchState } from '@cosmicfut/engine';
import type { LiveMatchInfo, MatchEndPayload, RoundResultsPayload } from '@cosmicfut/shared';
import { DEFAULT_DATA_DIR } from '../src/config.ts';
import { CareerSimulator, careerMatchConfig } from '../src/sim-core.ts';
import type { MatchPausePayload, MatchStartPayload, MatchTickPayload } from '../src/protocol.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, collect, fixtureById, ok, startServer, todays, Tracker, waitFor, type Client } from './helpers.ts';

/** campeão brasileiro e campeão da Copa do Brasil de 2025 ⇒ Supercopa do Brasil 2026 (jogo único, pênaltis) */
const FLA = 'flarj';
const COR = 'corinthians-bra';

let srv: CosmicServer | null = null;
const sockets: Client[] = [];
async function mk(url: string) {
  const s = await client(url);
  sockets.push(s);
  return s;
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await srv?.close();
  srv = null;
});
afterAll(async () => {
  await srv?.close();
});

/** escolhe um titular de linha em campo e um reserva não usado */
function subFor(side: 'home' | 'away', start: MatchStartPayload, live: MatchState['players']) {
  const cfg = start.config as { home: { lineup: { starters: string[]; bench: string[] } }; away: { lineup: { starters: string[]; bench: string[] } } };
  const lineup = cfg[side].lineup;
  const st = new Map(live[side].map((l) => [l.id, l]));
  const outId = lineup.starters.slice(1).reverse().find((id) => st.get(id)?.onPitch && !st.get(id)?.sentOff)!;
  const inId = lineup.bench.find((id) => !st.get(id)?.onPitch && !st.get(id)?.sentOff)!;
  return { outId, inId };
}

const urlOf = (s: CosmicServer) => `http://127.0.0.1:${(s.app.server.address() as { port: number }).port}`;

describe('PvP em mata-mata (Supercopa)', () => {
  it('2 humanos prontos: Supercopa ao vivo com 1 substituição de cada lado, placar idêntico, vencedor (pênaltis sem prorrogação)', async () => {
    ({ srv } = await startServer());
    const url = urlOf(srv);
    const a = await mk(url);
    const b = await mk(url);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Rubro-Negro', settings: { matchSpeedMs: 1 } });
    await ok(b, 'room:join', { code, nickname: 'Alvinegro' });
    await ok(a, 'room:pick-club', { clubId: FLA });
    await ok(b, 'room:pick-club', { clubId: COR });
    await ok(a, 'room:start');
    let snap = await ta.waitSnap(() => true);
    expect(snap.state.competitions.some((c) => c.id === 'BRA-SUP')).toBe(true);
    // avança (simulando os jogos humanos) até o dia da Supercopa
    for (let i = 0; i < 40; i++) {
      if (todays(snap.state, [FLA]).some((f) => f.competitionId === 'BRA-SUP')) break;
      snap = await ta.devAdvance('next-match');
    }
    const sup = todays(snap.state, [FLA]).find((f) => f.competitionId === 'BRA-SUP')!;
    expect(sup).toBeTruthy();
    expect([sup.homeId, sup.awayId].sort()).toEqual([COR, FLA].sort());
    expect(sup.knockout).toBe(true);
    const aIsHome = sup.homeId === FLA;
    const [ha, hb]: ('home' | 'away')[] = aIsHome ? ['home', 'away'] : ['away', 'home'];

    // escalação: ids fora do elenco são rejeitados; válida é aceita
    const room = srv.rooms.get(code)!;
    const club = snap.state.clubs[FLA];
    // (Atualização 38) suspensão por competição: a da Supercopa
    const out = unavailablePlayers(club, 'BRA-SUP');
    const squad = room.career!.humanSquads[FLA].filter((id) => !out.has(id));
    const starters = squad.slice(0, 11);
    const bench = squad.slice(11, 18);
    const tactic = { formation: '4-3-3', mentality: 'attacking', tempo: 'fast', pressing: 'high', passing: 'short' };
    expect((await call(a, 'round:set-lineup', { tactic, lineup: { starters: [...starters.slice(0, 10), 'outro:1'], bench } })).ok).toBe(false);
    expect((await call(a, 'round:set-lineup', { tactic, lineup: { starters: [...starters.slice(0, 10), starters[0]], bench } })).ok).toBe(false);
    expect((await call(a, 'round:set-lineup', { tactic: { ...tactic, formation: '9-0-1' }, lineup: { starters, bench } })).ok).toBe(false);
    await ok(a, 'round:set-lineup', { tactic, lineup: { starters, bench } });

    const ticksA = collect<MatchTickPayload>(a, 'match:tick');
    const ticksB = collect<MatchTickPayload>(b, 'match:tick');
    const infosB = collect<LiveMatchInfo>(b, 'match:info');
    const startA = waitFor<MatchStartPayload>(a, 'match:start');
    const startB = waitFor<MatchStartPayload>(b, 'match:start');

    // só um pronto: nada acontece
    await ok(a, 'round:ready', { ready: true });
    expect(room.phase).toBe('planning');
    const t0 = performance.now();
    await ok(b, 'round:ready', { ready: true });
    const [sa, sb] = await Promise.all([startA, startB]);
    const advanceMs = performance.now() - t0;
    expect(sa.matchId).toBe(sup.id);
    expect(sb.matchId).toBe(sup.id);
    expect(sa.side).toBe(ha);
    expect(sb.side).toBe(hb);
    expect(sa.fixture?.competitionId).toBe('BRA-SUP');
    expect(sa.fixture?.knockout).toBe(true);
    const pcfg = sa.config as { knockout: boolean; extraTime: boolean; home: { lineup: { starters: string[] }; tactic: { formation: string }; players: unknown[] }; away: { lineup: { starters: string[] }; tactic: { formation: string } } };
    expect(pcfg.knockout).toBe(true);
    expect(pcfg.extraTime).toBe(false); // fiel ao original: empate → pênaltis direto
    // a escalação salva foi usada pelo servidor
    expect(pcfg[ha].lineup.starters).toEqual(starters);
    expect(pcfg[ha].tactic.formation).toBe('4-3-3');
    const matchId = sa.matchId;

    // intervalo: cada lado faz 1 substituição e confirma a volta
    const pauseA = await waitFor<MatchPausePayload>(a, 'match:pause', (p) => p.paused && p.reason === 'half-time');
    expect(pauseA.waitingFor.sort()).toEqual([sa.homePlayerId, sa.awayPlayerId].sort());
    const live = ticksA[ticksA.length - 1].players!;
    const subA = subFor(ha, sa, live);
    const subB = subFor(hb, sb, live);
    // lado enviado pelo cliente é ignorado: o servidor deduz
    await ok(a, 'match:command', { matchId, command: { type: 'substitute', side: hb, ...subA } });
    await ok(b, 'match:command', { matchId, command: { type: 'substitute', side: ha, ...subB } });
    expect((await call(b, 'match:command', { matchId, command: { type: 'substitute', outId: 'x:1', inId: 'y:2' } })).ok).toBe(false);
    expect((await call(b, 'match:command', { matchId: 'outra', command: { type: 'substitute', outId: 'x:1', inId: 'y:2' } })).ok).toBe(false);

    const resumed = waitFor<MatchPausePayload>(b, 'match:pause', (p) => !p.paused);
    await ok(a, 'match:resume', { matchId });
    expect(room.matches.get(matchId)!.status()).toBe('half-time'); // ainda esperando B
    await ok(b, 'match:resume', { matchId });
    await resumed;

    const results = waitFor<RoundResultsPayload>(a, 'round:results', (r) => r.results.some((x) => x.fixtureId === matchId));
    const [endA, endB] = await Promise.all([waitFor<MatchEndPayload>(a, 'match:end'), waitFor<MatchEndPayload>(b, 'match:end')]);
    const rA = endA.result as MatchResult;
    const rB = endB.result as MatchResult;
    expect(rA.homeGoals).toBe(rB.homeGoals);
    expect(rA.awayGoals).toBe(rB.awayGoals);
    expect(rA.stats.home.subsUsed).toBe(1);
    expect(rA.stats.away.subsUsed).toBe(1);
    // mata-mata: sempre há quem avança; empate → pênaltis, sem prorrogação
    expect(rA.winner).not.toBe('draw');
    expect(endA.advancing).toBe(rA.winner);
    expect(rA.extraTime ?? false).toBe(false);
    if (rA.homeGoals === rA.awayGoals) expect(endA.penalties).toBeTruthy();

    const evA = ticksA.flatMap((t) => t.events as MatchEvent[]);
    const evB = ticksB.flatMap((t) => t.events as MatchEvent[]);
    expect(evA.length).toBe(evB.length);
    const subs = evA.filter((e) => e.type === 'substitution');
    expect(subs.map((e) => e.side).sort()).toEqual(['away', 'home']);
    expect(subs.find((e) => e.side === ha)?.playerOutId).toBe(subA.outId);
    expect(ticksA[ticksA.length - 1].score).toEqual(ticksB[ticksB.length - 1].score);
    expect(infosB.some((i) => i.matchId === matchId && i.competitionId === 'BRA-SUP' && i.knockout)).toBe(true);

    const res = await results;
    const mine = res.results.find((x) => x.fixtureId === matchId)!;
    expect([mine.home, mine.away]).toEqual([rA.homeGoals, rA.awayGoals]);
    expect(mine.competitionId).toBe('BRA-SUP');

    const after = await ta.waitSnap((d) => d.state.date > sup.date);
    const fx = fixtureById(after.state, matchId)!;
    expect(fx.result?.home).toBe(rA.homeGoals);
    const supComp = after.state.competitions.find((c) => c.id === 'BRA-SUP')!;
    expect(supComp.championId).toBe(rA.winner === 'home' ? sup.homeId : sup.awayId);
    const st = await ta.waitRoom((s) => s.phase === 'planning' && !!s.date && s.date > sup.date);
    expect(st.players.every((p) => !p.ready)).toBe(true);
    console.log(`[métricas] PvP Supercopa: último ready→match:start ${advanceMs.toFixed(0)} ms (servidor: ${room.lastAdvanceMs.toFixed(0)} ms); snapshot gzip ${(room.lastSnapshotBytes / 1024).toFixed(0)} KB`);
  });
});

describe('reconexão', () => {
  it('rejoin no meio da partida devolve room:state, season:snapshot (com mundo) e match:start com o estado atual', async () => {
    ({ srv } = await startServer({ halfTimeTimeoutMs: 100 }));
    const url = urlOf(srv);
    const a = await mk(url);
    const { code, token, playerId } = await ok<{ code: string; token: string; playerId: string }>(a, 'room:create', { nickname: 'Solo', settings: { matchSpeedMs: 15 } });
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(a, 'room:start');
    const start = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    const { matchId } = await start;
    await waitFor<MatchTickPayload>(a, 'match:tick', (t) => t.minute >= 10);
    a.disconnect();

    await new Promise((r) => setTimeout(r, 150));
    const room = srv.rooms.get(code)!;
    expect(room.player(playerId)!.connected).toBe(false);
    const minuteBefore = room.matches.get(matchId)!.sim.state.minute;

    const b = await mk(url);
    const tb = new Tracker(b);
    const ms = waitFor<MatchStartPayload>(b, 'match:start');
    const r = await ok<{ playerId: string }>(b, 'room:rejoin', { code, token });
    expect(r.playerId).toBe(playerId);
    const s = await tb.waitRoom(() => true);
    expect(s.phase).toBe('matchday');
    expect(s.players[0].connected).toBe(true);
    const snap = await tb.waitSnap(() => true);
    expect(snap.world).toBeTruthy(); // rejoin sempre leva o WorldState
    expect(fixtureById(snap.state, matchId)?.date).toBe(snap.state.date);
    const m = await ms;
    expect(m.matchId).toBe(matchId);
    const state = m.state as MatchState;
    expect(state.minute).toBeGreaterThanOrEqual(minuteBefore);
    expect(state.phase).not.toBe('pre');
    expect(state.events.length).toBeGreaterThan(0);
    const end = await waitFor<MatchEndPayload>(b, 'match:end');
    expect((end.result as MatchResult).homeGoals).toBeGreaterThanOrEqual(0);
    await tb.waitRoom((x) => x.phase === 'planning');
  });
});

describe('desconectados não travam a sala', () => {
  it('quem caiu não bloqueia o ready; depois da tolerância vira IA e seus jogos são simulados (quickSimulate)', async () => {
    ({ srv } = await startServer({ disconnectGraceMs: 50, halfTimeTimeoutMs: 0 }));
    const url = urlOf(srv);
    const a = await mk(url);
    const b = await mk(url);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Fica', settings: { matchSpeedMs: 1 } });
    const { playerId: bId } = await ok<{ playerId: string }>(b, 'room:join', { code, nickname: 'Cai' });
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(b, 'room:pick-club', { clubId: 'santos' });
    await ok(a, 'room:start');
    b.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    const room = srv.rooms.get(code)!;
    expect(room.player(bId)!.ai).toBe(true);
    const start = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    await start;
    // o clube de quem caiu não tem partida ao vivo
    expect([...room.matches.values()].some((m) => m.sideOf(bId))).toBe(false);
    const st = await ta.waitRoom((s) => s.phase === 'planning' && s.matches.length > 0);
    const snap = await ta.waitSnap((d) => d.state.date === st.date);
    // todos os jogos de B até aqui foram disputados
    const pending = snap.state.competitions.flatMap((c) => c.fixtures).filter((f) => (f.homeId === 'santos' || f.awayId === 'santos') && f.date < snap.state.date && !f.result);
    expect(pending).toEqual([]);
  });
});

describe('determinismo', () => {
  it('partida PvE ao vivo sem comandos = quickSimulate com a mesma config da carreira', async () => {
    ({ srv } = await startServer({ halfTimeTimeoutMs: 0 }));
    const url = urlOf(srv);
    const a = await mk(url);
    const ta = new Tracker(a);
    const clubId = 'gremio';
    await ok(a, 'room:create', { nickname: 'Det', settings: { matchSpeedMs: 1 } });
    await ok(a, 'room:pick-club', { clubId });
    await ok(a, 'room:start');
    await ta.waitSnap(() => true);
    const start = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    const { matchId } = await start;
    const end = await waitFor<MatchEndPayload>(a, 'match:end');
    // estado do início do dia de jogo (antes do resultado)
    const snap = await ta.waitSnap((d) => !!fixtureById(d.state, matchId) && !fixtureById(d.state, matchId)!.result && d.state.date === fixtureById(d.state, matchId)!.date);
    const fixture = fixtureById(snap.state, matchId)!;
    const base = new CareerSimulator(DEFAULT_DATA_DIR).baseFor([clubId]);
    const cfg = careerMatchConfig(snap.state, fixture, careerSquads(snap.state, worldSquads(ta.world!, base)));
    // o lado humano não faz substituições automáticas (control 'human'), como na partida ao vivo
    cfg.home.control = fixture.homeId === clubId ? 'human' : 'ai';
    cfg.away.control = fixture.awayId === clubId ? 'human' : 'ai';
    const expected = JSON.parse(JSON.stringify(quickSimulate(cfg)));
    expect(end.result).toEqual(expected);
  });

  it('duas salas com a mesma seed e os mesmos clubes chegam ao mesmo estado', async () => {
    const states: string[] = [];
    for (let i = 0; i < 2; i++) {
      ({ srv } = await startServer());
      const a = await mk(urlOf(srv));
      const ta = new Tracker(a);
      await ok(a, 'room:create', { nickname: 'Seed' });
      await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
      await ok(a, 'room:start');
      await ta.waitSnap(() => true);
      const snap = await ta.devAdvance('2026-03-01');
      expect(snap.state.date).toBe('2026-03-01');
      states.push(JSON.stringify(snap.state));
      a.disconnect();
      await srv.close();
      srv = null;
    }
    expect(states[0].length).toBeGreaterThan(100_000);
    expect(states[0] === states[1]).toBe(true);
  });
});
