/**
 * Velocidade no meio do online: o host troca a velocidade com a partida rolando e ela vale na hora
 * (partida começa "travada" em 5 s por minuto; depois de acelerar, termina rápido).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchEndPayload } from '@cosmicfut/shared';
import type { MatchStartPayload } from '../src/protocol.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, ok, startServer, todays, Tracker, waitFor, type Client } from './helpers.ts';

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

describe('Velocidade durante a partida online', () => {
  it('host acelera no meio do jogo e só o host pode mudar', async () => {
    ({ srv } = await startServer());
    const url = urlOf(srv);
    const [a, b] = await Promise.all([client(url), client(url)]);
    sockets.push(a, b);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Host', settings: { matchSpeedMs: 5000 } });
    await ok(b, 'room:join', { code, nickname: 'Amigo' });
    await ok(a, 'room:pick-club', { clubId: FLA });
    await ok(b, 'room:pick-club', { clubId: COR });
    await ok(a, 'room:start');
    let snap = await ta.waitSnap(() => true);
    for (let i = 0; i < 40; i++) {
      if (todays(snap.state, [FLA]).some((f) => f.competitionId === 'BRA-SUP')) break;
      snap = await ta.devAdvance('next-match');
    }
    const start = waitFor<MatchStartPayload>(a, 'match:start');
    const end = waitFor<MatchEndPayload>(a, 'match:end', () => true, 60_000);
    await ok(a, 'round:ready', { ready: true });
    await ok(b, 'round:ready', { ready: true });
    const st = await start;
    // quem não é host não muda
    expect((await call(b, 'room:update-settings', { matchSpeedMs: 1 })).ok).toBe(false);
    // host acelera: a 5 s/minuto o jogo levaria ~8 min; acelerado termina em segundos
    await ok(a, 'room:update-settings', { matchSpeedMs: 1 });
    const e = await end;
    expect(e.matchId).toBe(st.matchId);
  }, 120_000);
});
