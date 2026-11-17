import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoomSummary } from '@cosmicfut/shared';
import { GameData } from '../src/data.ts';
import { DEFAULT_DATA_DIR } from '../src/config.ts';
import type { SeasonSnapshotPayload } from '@cosmicfut/shared';
import { call, client, decodeSnap, ok, startServer, waitFor, type Client } from './helpers.ts';
import type { CosmicServer } from '../src/server.ts';
import { playableClubs } from '../src/career-data.ts';

const data = new GameData(DEFAULT_DATA_DIR);
const bra1 = data.leagues().find((d) => d.id === 'BRA-1')!;
const foreign = data.leagues().find((d) => d.countryId !== 29 && d.clubIds.length >= 2 && d.clubIds.length <= 40)!;
const playable = playableClubs({ leagues: data.leagues(), states: data.states() }, 29);
/** clube brasileiro fora de qualquer competição da carreira (nem divisão nacional real, nem estadual) */
const noLeague = [...data.clubIndex().values()].find((c) => c.countryId === 29 && !playable.all.has(c.id))!;

describe('lobby', () => {
  let srv: CosmicServer;
  let url: string;
  const sockets: Client[] = [];
  const mk = async () => {
    const s = await client(url);
    sockets.push(s);
    return s;
  };

  beforeAll(async () => {
    ({ srv, url } = await startServer({ maxPlayers: 3 }));
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await srv.close();
  });

  it('GET /health responde com CORS para localhost:5173', async () => {
    const r = await fetch(`${url}/health`, { headers: { Origin: 'http://localhost:5173' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
    const bad = await fetch(`${url}/health`, { headers: { Origin: 'http://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('cria e entra na sala; código sem caracteres ambíguos; apelido sanitizado', async () => {
    const a = await mk();
    const b = await mk();
    const created = await ok<{ code: string; playerId: string; token: string }>(a, 'room:create', { nickname: '  <b>Ana</b>\u0007  ' });
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.token.length).toBeGreaterThanOrEqual(24);

    const stateP = waitFor<RoomSummary>(a, 'room:state', (s) => s.players.length === 2);
    const joined = await ok<{ playerId: string; token: string }>(b, 'room:join', { code: created.code.toLowerCase(), nickname: 'Bia' });
    const st = await stateP;
    expect(st.hostId).toBe(created.playerId);
    expect(st.players.map((p) => p.nickname)).toEqual(['bAna/b', 'Bia']);
    expect(st.players.find((p) => p.playerId === joined.playerId)?.isHost).toBe(false);

    // preview HTTP
    const prev = (await (await fetch(`${url}/rooms/${created.code}`)).json()) as { data: { players: unknown[] } };
    expect(prev.data.players).toHaveLength(2);

    // validações de payload
    expect((await call(b, 'room:join', { code: 'XXXXX0', nickname: 'Zé' })).ok).toBe(false);
    expect((await call(b, 'room:join', { code: 123, nickname: 'Zé' })).ok).toBe(false);
    expect((await call(b, 'room:create', { nickname: 42 })).ok).toBe(false);
    expect((await call(b, 'room:create', { nickname: 'a' })).ok).toBe(false);
  });

  it('escolha de clube: repetido e sem liga são rejeitados (outro país vale desde 17/11); só o host inicia', async () => {
    const a = await mk();
    const b = await mk();
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Host', settings: { countryId: 29 } });
    await ok(b, 'room:join', { code, nickname: 'Guest' });

    await ok(a, 'room:pick-club', { clubId: bra1.clubIds[0] });
    const dup = await call(b, 'room:pick-club', { clubId: bra1.clubIds[0] });
    expect(dup.ok).toBe(false);
    // início sem todos escolherem: rejeitado
    expect((await call(a, 'room:start')).ok).toBe(false);
    // (17/11) qualquer região em escopo
    expect((await call(b, 'room:pick-club', { clubId: foreign.clubIds[0] })).ok).toBe(true);
    if (noLeague) expect((await call(b, 'room:pick-club', { clubId: noLeague.id })).ok).toBe(false);
    expect((await call(b, 'room:pick-club', { clubId: '../../etc/passwd' })).ok).toBe(false);
    expect((await call(b, 'room:pick-club', { clubId: 'nao-existe-xyz' })).ok).toBe(false);

    // lineup antes de começar: rejeitado
    expect((await call(b, 'round:set-lineup', { tactic: {}, lineup: {} })).ok).toBe(false);
    await ok(b, 'room:pick-club', { clubId: bra1.clubIds[1] });
    // convidado não inicia
    expect((await call(b, 'room:start')).ok).toBe(false);

    const snap = waitFor<SeasonSnapshotPayload>(b, 'season:snapshot');
    await ok(a, 'room:start');
    const s = decodeSnap(await snap);
    const comps = s.state.competitions.map((c) => c.id);
    // carreira completa: Séries A e B (Etapa 1: C e D saíram), estaduais, Copa do Brasil, continentais...
    for (const id of ['BRA-1', 'BRA-2', 'BRA-CUP']) expect(comps).toContain(id);
    for (const id of ['BRA-3', 'BRA-4']) expect(comps).not.toContain(id);
    expect(comps.some((c) => c.startsWith('EST-'))).toBe(true);
    expect(s.state.humanClubIds).toEqual([bra1.clubIds[0], bra1.clubIds[1]]);
    expect(s.world?.humanClubIds).toEqual([bra1.clubIds[0], bra1.clubIds[1]]);
    // (carreira online salva) quem entra depois do início é técnico DESEMPREGADO; com a entrada tardia desligada, não entra
    const c = await mk();
    const late = await call<{ unemployed?: boolean }>(c, 'room:join', { code, nickname: 'Late' });
    expect(late.ok && late.data.unemployed).toBe(true);
    await ok(a, 'room:update-settings', { lateJoin: false });
    const d = await mk();
    expect((await call(d, 'room:join', { code, nickname: 'Late2' })).ok).toBe(false);
  });

  it('limite de jogadores e transferência de host', async () => {
    const [a, b, c, d] = [await mk(), await mk(), await mk(), await mk()];
    const { code, playerId: hostId } = await ok<{ code: string; playerId: string }>(a, 'room:create', { nickname: 'H1' });
    const { playerId: bId } = await ok<{ playerId: string }>(b, 'room:join', { code, nickname: 'H2' });
    await ok(c, 'room:join', { code, nickname: 'H3' });
    expect((await call(d, 'room:join', { code, nickname: 'H4' })).ok).toBe(false); // maxPlayers 3
    const st = waitFor<RoomSummary>(b, 'room:state', (s) => s.players.length === 2);
    await ok(a, 'room:leave');
    const s = await st;
    expect(s.hostId).not.toBe(hostId);
    expect(s.hostId).toBe(bId);
  });

  it('chat: entrega, sanitiza e limita a taxa', async () => {
    const a = await mk();
    const b = await mk();
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Chat A' });
    await ok(b, 'room:join', { code, nickname: 'Chat B' });
    const msg = waitFor<{ text: string; nickname: string }>(b, 'chat:message');
    await ok(a, 'chat:send', { text: '  oi <script>  pessoal ' });
    expect((await msg).text).toBe('oi script pessoal');
    expect((await call(a, 'chat:send', { text: 'x'.repeat(600) })).ok).toBe(false);
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await call(a, 'chat:send', { text: `m${i}` })).ok);
    expect(results.filter((x) => !x).length).toBeGreaterThan(0);
  });
});

describe('persistência em disco', () => {
  it('sala sobrevive a reinício e aceita rejoin pelo token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmicfut-'));
    try {
      const first = await startServer({ persistDir: dir });
      const a = await client(first.url);
      const { code, token, playerId } = await ok<{ code: string; token: string; playerId: string }>(a, 'room:create', { nickname: 'Persist' });
      await ok(a, 'room:pick-club', { clubId: bra1.clubIds[2] });
      const s0 = waitFor<SeasonSnapshotPayload>(a, 'season:snapshot');
      await ok(a, 'room:start');
      await s0;
      await new Promise((r) => setTimeout(r, 600)); // debounce da persistência
      a.disconnect();
      await first.srv.close();

      const second = await startServer({ persistDir: dir });
      expect(second.srv.rooms.has(code)).toBe(true);
      const b = await client(second.url);
      const snap = waitFor<SeasonSnapshotPayload>(b, 'season:snapshot');
      const st = waitFor<RoomSummary>(b, 'room:state', (s) => s.players.some((p) => p.connected));
      const r = await ok<{ playerId: string }>(b, 'room:rejoin', { code, token });
      expect(r.playerId).toBe(playerId);
      expect((await st).phase).toBe('planning');
      const d = decodeSnap(await snap);
      expect(d.state.humanClubIds).toEqual([bra1.clubIds[2]]);
      expect(d.world?.rev).toBe(3); // (Etapa 1) linha do tempo global
      expect((await call(b, 'room:rejoin', { code, token: 'x'.repeat(32) })).ok).toBe(false);
      b.disconnect();
      await second.srv.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
