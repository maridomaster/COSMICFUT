/**
 * Tolerância no planejamento: quem recarrega a página não perde a rodada — os outros esperam até
 * PLANNING_GRACE_MS antes de considerá-lo ausente. E o pré-jogo (match:preview) antes do match:start.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchPreviewPayload, MatchStartPayload, RoomSummary } from '@cosmicfut/shared';
import type { CosmicServer } from '../src/server.ts';
import { call, client, ok, sleep, startServer, Tracker, waitFor, type Client } from './helpers.ts';

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

async function room2(url: string) {
  const a = await mk(url);
  const b = await mk(url);
  const ta = new Tracker(a);
  const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Fica', settings: { matchSpeedMs: 1 } });
  const { token: tokenB, playerId: bId } = await ok<{ token: string; playerId: string }>(b, 'room:join', { code, nickname: 'Recarrega' });
  await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
  await ok(b, 'room:pick-club', { clubId: 'santos' });
  await ok(a, 'room:start');
  await ta.waitSnap(() => true);
  return { a, b, ta, code, tokenB, bId };
}

describe('recarregar a página no planejamento', () => {
  it('a rodada espera quem caiu (graceUntil); ele volta, marca pronto e joga AO VIVO', async () => {
    let url: string;
    ({ srv, url } = await startServer({ planningGraceMs: 1500, disconnectGraceMs: 60_000, halfTimeTimeoutMs: 0 }));
    const { a, b, ta, code, tokenB, bId } = await room2(url);
    const room = srv.rooms.get(code)!;
    b.disconnect(); // F5
    await ta.waitRoom((s) => s.players.some((p) => p.playerId === bId && !p.connected));
    const st = ta.room!.players.find((p) => p.playerId === bId)!;
    expect(st.graceUntil).toBeGreaterThan(Date.now());
    await ok(a, 'round:ready', { ready: true });
    await sleep(500);
    expect(room.phase).toBe('planning'); // esperando o B
    // B volta (outro socket, mesmo token) dentro da tolerância e marca pronto
    const b2 = await mk(url);
    const tb2 = new Tracker(b2);
    await ok(b2, 'room:rejoin', { code, token: tokenB });
    await tb2.waitSnap(() => true);
    expect(room.phase).toBe('planning');
    const startB = waitFor<MatchStartPayload>(b2, 'match:start');
    await ok(b2, 'round:ready', { ready: true });
    const m = await startB;
    expect(m.side).toBeTruthy(); // partida ao vivo do B (não simulada pela IA)
    const live = [...room.matches.values()].find((x) => x.sideOf(bId));
    expect(live).toBeTruthy();
    expect(live!.config[live!.sideOf(bId)!].control).toBe('human');
  });

  it('sem voltar: depois da tolerância a rodada segue sem ele (jogo dele simulado)', async () => {
    let url: string;
    ({ srv, url } = await startServer({ planningGraceMs: 600, disconnectGraceMs: 60_000, halfTimeTimeoutMs: 0 }));
    const { a, b, ta, code, bId } = await room2(url);
    const room = srv.rooms.get(code)!;
    b.disconnect();
    await ta.waitRoom((s) => s.players.some((p) => p.playerId === bId && !p.connected));
    const t0 = Date.now();
    const start = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    await start;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450);
    expect([...room.matches.values()].some((x) => x.sideOf(bId) && x.config[x.sideOf(bId)!].control === 'human')).toBe(false);
    const r = await ta.waitRoom((s: RoomSummary) => s.phase !== 'planning');
    expect(r.players.find((p) => p.playerId === bId)?.graceUntil ?? null).toBeNull();
  });
});

describe('pré-jogo online', () => {
  it('match:preview com confronto e escalações chega antes; o match:start sai em startsAt', async () => {
    let url: string;
    ({ srv, url } = await startServer({ preMatchMs: 700, halfTimeTimeoutMs: 0 }));
    const a = await mk(url);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Pre', settings: { matchSpeedMs: 1 } });
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(a, 'room:start');
    await ta.waitSnap(() => true);
    const pv = waitFor<MatchPreviewPayload>(a, 'match:preview');
    const st = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    const p = await pv;
    const tPreview = Date.now();
    expect(p.side).toBeTruthy();
    expect(p.fixture.homeId === 'palmeiras' || p.fixture.awayId === 'palmeiras').toBe(true);
    const cfg = p.config as Record<'home' | 'away', { lineup: { starters: string[] } }>;
    expect(cfg.home.lineup.starters.length).toBe(11);
    expect(cfg.away.lineup.starters.length).toBe(11);
    expect(p.startsAt).toBeGreaterThan(tPreview);
    const room = srv.rooms.get(code)!;
    expect(room.phase).toBe('matchday');
    expect([...room.matches.values()].every((m) => !m.started)).toBe(true);
    // comando antes do apito: recusado
    const early = await call(a, 'match:command', { matchId: p.matchId, command: { type: 'set-tactic', tactic: { mentality: 'attacking' } } });
    expect(early.ok).toBe(false);
    const m = await st;
    expect(Date.now()).toBeGreaterThanOrEqual(p.startsAt - 50);
    expect(m.matchId).toBe(p.matchId);
  });
});
