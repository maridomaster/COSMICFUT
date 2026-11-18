/**
 * (Rodada ao vivo) Servidor Node (mesmo núcleo do online grátis): o espectador recebe a partida ao vivo dos técnicos
 * (match:start só leitura, ticks, fim) e não consegue mandar nela.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchEndPayload } from '@cosmicfut/shared';
import type { MatchStartPayload, MatchTickPayload } from '../src/protocol.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, collect, ok, startServer, todays, Tracker, waitFor, type Client } from './helpers.ts';

const FLA = 'flarj';
const COR = 'corinthians-bra';

let srv: CosmicServer | null = null;
const sockets: Client[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await srv?.close();
  srv = null;
});
const urlOf = (s: CosmicServer) => `http://127.0.0.1:${(s.app.server.address() as { port: number }).port}`;

describe('Rodada ao vivo (servidor Node)', () => {
  it('espectador assiste à partida dos técnicos (só leitura)', async () => {
    ({ srv } = await startServer());
    const url = urlOf(srv);
    const [a, b, spec] = await Promise.all([client(url), client(url), client(url)]);
    sockets.push(a, b, spec);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Rubro-Negro', settings: { matchSpeedMs: 20 } });
    await ok(b, 'room:join', { code, nickname: 'Alvinegro' });
    await ok(a, 'room:pick-club', { clubId: FLA });
    await ok(b, 'room:pick-club', { clubId: COR });
    await ok(a, 'room:start');
    let snap = await ta.waitSnap(() => true);
    for (let i = 0; i < 40; i++) {
      if (todays(snap.state, [FLA]).some((f) => f.competitionId === 'BRA-SUP')) break;
      snap = await ta.devAdvance('next-match');
    }
    await ok(spec, 'room:join', { code, nickname: 'Espia', spectator: true });
    const ticks = collect<MatchTickPayload>(spec, 'match:tick');
    const start = waitFor<MatchStartPayload>(spec, 'match:start');
    const end = waitFor<MatchEndPayload>(spec, 'match:end', () => true, 120_000);
    await ok(a, 'round:ready', { ready: true });
    await ok(b, 'round:ready', { ready: true });
    const st = await start;
    expect(st.side).toBeNull();
    // só leitura: comandos/pausa do espectador são recusados
    const cmd = await call(spec, 'match:command', { matchId: st.matchId, command: { side: 'home', type: 'tactic', tactic: {} } });
    expect(cmd.ok).toBe(false);
    const pause = await call(spec, 'match:pause-request', { matchId: st.matchId });
    expect(pause.ok).toBe(false);
    const e = await end;
    expect(e.matchId).toBe(st.matchId);
    expect(ticks.filter((t) => t.matchId === st.matchId).length).toBeGreaterThan(20);
  }, 300_000);
});
