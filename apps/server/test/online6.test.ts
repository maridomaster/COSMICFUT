/**
 * (17/11) Online até 6 técnicos: limite + espectadores, salas públicas, draft em serpentina, sorteio, host (expulsar,
 * passar), modo turnos (ordem, concluir vez, cronômetro → assistente, ausência, propostas na fila, recarregar a página),
 * modo simultâneo (cronômetro → pronto automático), votação para pular, Liga dos Amigos, regiões misturadas e /public-url.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snakeOrder, type FriendsLeague, type PublicRoomInfo, type RoomSummary, type SkipEndPayload, type TurnFeedItem } from '@cosmicfut/shared';
import type { CosmicServer } from '../src/server.ts';
import { computeFriendsLeague, emptyFriends, recordH2H, updateFromMeta } from '../src/friends.ts';
import { call, client, collect, ok, sleep, startServer, Tracker, waitFor, type Client } from './helpers.ts';

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

const TURNS = { turnMode: 'turns', matchMode: 'quick' };

/** Sala com n técnicos (clubes dados), já iniciada. */
async function startedRoom(url: string, clubs: string[], settings: Record<string, unknown> = TURNS) {
  const socks: Client[] = [];
  const trackers: Tracker[] = [];
  const ids: string[] = [];
  const tokens: string[] = [];
  let code = '';
  for (let i = 0; i < clubs.length; i++) {
    const s = await mk(url);
    trackers.push(new Tracker(s));
    socks.push(s);
    if (i === 0) {
      const r = await ok<{ code: string; playerId: string; token: string }>(s, 'room:create', { nickname: `T${i}`, settings: { matchSpeedMs: 1, ...settings } });
      code = r.code;
      ids.push(r.playerId);
      tokens.push(r.token);
    } else {
      const r = await ok<{ playerId: string; token: string }>(s, 'room:join', { code, nickname: `T${i}` });
      ids.push(r.playerId);
      tokens.push(r.token);
    }
    await ok(s, 'room:pick-club', { clubId: clubs[i] });
  }
  await ok(socks[0], 'room:start');
  await trackers[0].waitSnap(() => true);
  return { socks, trackers, ids, tokens, code, room: srv!.rooms.get(code)! };
}

describe('lobby de 6', () => {
  it('6 técnicos; o 7º é recusado ou entra como espectador (que não escolhe clube)', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    expect(srv.opts.maxPlayers).toBe(6);
    const a = await mk(url);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Host' });
    for (let i = 1; i < 6; i++) await ok(await mk(url), 'room:join', { code, nickname: `J${i}` });
    const seventh = await mk(url);
    const r = await call(seventh, 'room:join', { code, nickname: 'Sete' });
    expect(r.ok).toBe(false);
    const spec = await ok<{ spectator?: boolean }>(seventh, 'room:join', { code, nickname: 'Sete', spectator: true });
    expect(spec.spectator).toBe(true);
    expect((await call(seventh, 'room:pick-club', { clubId: 'palmeiras' })).ok).toBe(false);
    const room = srv.rooms.get(code)!;
    expect(room.managers()).toHaveLength(6);
    expect(room.summary().players.filter((p) => p.spectator)).toHaveLength(1);
    // limite rígido: mesmo pedindo 8 o servidor fica em 6
    const { srv: s2 } = await startServer({ maxPlayers: 8 });
    expect(s2.opts.maxPlayers).toBe(6);
    await s2.close();
  });

  it('salas públicas: GET /rooms e room:list mostram só as públicas, no lobby e destrancadas', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const a = await mk(url);
    const b = await mk(url);
    const pub = await ok<{ code: string }>(a, 'room:create', { nickname: 'Pública', settings: { isPublic: true, preset: 'rapido' } });
    await ok<{ code: string }>(b, 'room:create', { nickname: 'Privada' });
    const list = ((await (await fetch(`${url}/rooms`)).json()) as { data: PublicRoomInfo[] }).data;
    expect(list.map((r) => r.code)).toEqual([pub.code]);
    expect(list[0]).toMatchObject({ host: 'Pública', players: 1, maxPlayers: 6, preset: 'rapido', turnMode: 'simultaneous' });
    const viaSocket = await ok<PublicRoomInfo[]>(b, 'room:list');
    expect(viaSocket.map((r) => r.code)).toEqual([pub.code]);
    // trancada: some da lista e ninguém entra
    await ok(a, 'room:update-settings', { locked: true });
    expect(((await (await fetch(`${url}/rooms`)).json()) as { data: unknown[] }).data).toHaveLength(0);
    const c = await mk(url);
    expect((await call(c, 'room:join', { code: pub.code, nickname: 'Tarde' })).ok).toBe(false);
    // só o host configura
    await ok(a, 'room:update-settings', { locked: false });
    await ok(c, 'room:join', { code: pub.code, nickname: 'Tarde' });
    expect((await call(c, 'room:update-settings', { isPublic: false })).ok).toBe(false);
  });

  it('draft em serpentina: ordem sorteada, só quem está na vez escolhe, tempo esgotado = melhor clube disponível', async () => {
    expect(snakeOrder(['a', 'b', 'c'], 2)).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
    let url: string;
    ({ srv, url } = await startServer({ pickMs: 400 }));
    const [a, b, c] = [await mk(url), await mk(url), await mk(url)];
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'D1', settings: { pickMode: 'draft' } });
    await ok(b, 'room:join', { code, nickname: 'D2' });
    await ok(c, 'room:join', { code, nickname: 'D3' });
    const room = srv.rooms.get(code)!;
    expect((await call(b, 'draft:start')).ok).toBe(false); // só o host
    expect((await call(a, 'room:pick-club', { clubId: 'palmeiras' })).ok).toBe(false); // draft não começou
    await ok(a, 'draft:start');
    const order = room.draft!.order.slice();
    expect(order).toHaveLength(3);
    const sockOf = (id: string) => [a, b, c][room.players.findIndex((p) => p.id === id)];
    // fora da vez: recusado
    const notNow = order[1];
    expect((await call(sockOf(notNow), 'room:pick-club', { clubId: 'santos' })).ok).toBe(false);
    await ok(sockOf(order[0]), 'room:pick-club', { clubId: 'palmeiras' });
    expect(room.draft!.current).toBe(order[1]);
    // repetido: recusado
    expect((await call(sockOf(order[1]), 'room:pick-club', { clubId: 'palmeiras' })).ok).toBe(false);
    // ninguém escolhe: escolha automática do melhor disponível (Real Madrid é o mais forte dos dados)
    await sleep(1200);
    expect(room.draft!.current).toBeNull();
    const picks = room.draft!.picks;
    expect(picks.map((p) => p.playerId)).toEqual(order);
    expect(picks[1].auto).toBe(true);
    const { bestAvailable } = await import('../src/lobby.ts');
    expect(picks[1].clubId).toBe(bestAvailable(srv.data.playableEntries(), new Set(['palmeiras']))!.id);
    expect(new Set(room.players.map((p) => p.clubId)).size).toBe(3);
    // ordem das vezes da temporada = ordem do draft, invertendo a cada rodada (serpentina)
    await ok(a, 'room:update-settings', { turnMode: 'turns', matchMode: 'quick' });
    await ok(a, 'room:start');
    await new Tracker(a).waitRoom(() => true).catch(() => undefined);
    await waitUntil(() => room.turn !== null);
    expect(room.turn!.order).toEqual(order);
  }, 120_000);

  it('sorteio dentro da faixa: clubes únicos e da dificuldade pedida', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const [a, b, c] = [await mk(url), await mk(url), await mk(url)];
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'S1', settings: { pickMode: 'lottery', lotteryBand: 'medio' } });
    await ok(b, 'room:join', { code, nickname: 'S2' });
    await ok(c, 'room:join', { code, nickname: 'S3' });
    expect((await call(b, 'room:pick-club', { clubId: 'santos' })).ok).toBe(false); // no sorteio ninguém escolhe
    await ok(a, 'lottery:run');
    const room = srv.rooms.get(code)!;
    const clubs = room.players.map((p) => p.clubId!);
    expect(new Set(clubs).size).toBe(3);
    const { clubDifficulty } = await import('@cosmicfut/shared');
    for (const id of clubs) expect(clubDifficulty(srv.data.club(id)!)).toBe('medio');
  });

  it('host: expulsa, passa o comando; quando o host sai, o comando passa adiante; cor única; reações', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const [a, b, c] = [await mk(url), await mk(url), await mk(url)];
    const { code, playerId: aId } = await ok<{ code: string; playerId: string }>(a, 'room:create', { nickname: 'Chefe' });
    const { playerId: bId } = await ok<{ playerId: string }>(b, 'room:join', { code, nickname: 'Bia' });
    const { playerId: cId } = await ok<{ playerId: string }>(c, 'room:join', { code, nickname: 'Caio' });
    const room = srv.rooms.get(code)!;
    expect((await call(b, 'room:kick', { playerId: cId })).ok).toBe(false);
    const kicked = waitFor<{ code: string }>(c, 'error', (e) => e.code === 'kicked');
    await ok(a, 'room:kick', { playerId: cId });
    await kicked;
    expect(room.players.map((p) => p.id)).toEqual([aId, bId]);
    // cor: única
    const colorA = room.player(aId)!.color;
    expect((await call(b, 'room:set-color', { color: colorA })).ok).toBe(false);
    expect((await call(b, 'room:set-color', { color: '#123456' })).ok).toBe(false);
    // reação vai para todos
    const rx = waitFor<{ emoji: string; playerId: string }>(a, 'room:reaction');
    await ok(b, 'room:react', { emoji: '🔥' });
    expect(await rx).toMatchObject({ emoji: '🔥', playerId: bId });
    expect((await call(b, 'room:react', { emoji: '💩' })).ok).toBe(false);
    // passa o host
    await ok(a, 'room:transfer-host', { playerId: bId });
    expect(room.hostId).toBe(bId);
    expect((await call(a, 'room:transfer-host', { playerId: aId })).ok).toBe(false);
    // o host sai: o comando volta para quem sobrou
    await ok(b, 'room:leave');
    expect(room.hostId).toBe(aId);
  });
});

async function waitUntil(fn: () => boolean, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout (waitUntil)');
    await sleep(10);
  }
}

describe('modo turnos (estilo Brasfoot)', () => {
  it('ordem, só o da vez age, concluir vez passa adiante e a última vez avança a rodada para todos', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const { socks, ids, room, trackers } = await startedRoom(url, ['palmeiras', 'santos', 'flarj']);
    const feed = collect<TurnFeedItem>(socks[1], 'turn:feed');
    expect(room.turn!.order).toEqual(ids);
    expect(room.turn!.playerId).toBe(ids[0]);
    // fora da vez: escalação e mercado recusados
    expect((await call(socks[1], 'round:set-lineup', { tactic: {}, lineup: null })).ok).toBe(false);
    const r = await call(socks[1], 'market:list', { playerIds: [room.career!.humanSquads.santos[0]], listed: true });
    expect(r.ok).toBe(false);
    expect((await call(socks[1], 'turn:end')).ok).toBe(false);
    // o da vez age (público no feed) e conclui
    await ok(socks[0], 'market:list', { playerIds: [room.career!.humanSquads.palmeiras[0]], listed: true });
    await ok(socks[0], 'turn:end');
    expect(room.turn!.playerId).toBe(ids[1]);
    await ok(socks[1], 'round:ready', { ready: true }); // "pronto" do da vez = concluir
    expect(room.turn!.playerId).toBe(ids[2]);
    const date0 = room.career!.date;
    await ok(socks[2], 'turn:end');
    await trackers[0].waitRoom((s) => s.phase === 'planning' && s.date !== date0 && (s.round ?? 0) >= 2);
    // rodada 2: quem começa gira
    expect(room.turn!.order).toEqual([ids[1], ids[2], ids[0]]);
    expect(feed.some((f) => f.kind === 'list' && f.playerId === ids[0])).toBe(true);
    expect(feed.some((f) => f.text.startsWith('Vez de'))).toBe(true);
  }, 120_000);

  it('cronômetro esgotado: o assistente conclui a vez; regra AFK depois de N rodadas', async () => {
    let url: string;
    ({ srv, url } = await startServer({ timerMs: 300 }));
    const { ids, room, trackers } = await startedRoom(url, ['palmeiras', 'santos'], { ...TURNS, afkRounds: 1 });
    expect(room.turn!.deadline).toBeTruthy();
    // ninguém age: as duas vezes acabam pelo tempo e a rodada avança
    await trackers[0].waitRoom((s) => (s.round ?? 0) >= 2 && s.phase === 'planning', 30_000);
    expect(room.player(ids[0])!.missed).toBeGreaterThanOrEqual(1);
    expect(room.player(ids[0])!.afk).toBe(true);
    expect(room.summary().players.find((p) => p.playerId === ids[0])!.afk).toBe(true);
  }, 120_000);

  it('quem cai na própria vez: a vez espera a tolerância (recarregar não perde); sem voltar, o assistente conclui', async () => {
    let url: string;
    ({ srv, url } = await startServer({ planningGraceMs: 1500, disconnectGraceMs: 60_000 }));
    const { socks, ids, tokens, code, room, trackers } = await startedRoom(url, ['palmeiras', 'santos']);
    await ok(socks[0], 'turn:end');
    expect(room.turn!.playerId).toBe(ids[1]);
    // B recarrega a página (F5) na vez dele
    socks[1].disconnect();
    await trackers[0].waitRoom((s) => s.players.some((p) => p.playerId === ids[1] && !p.connected));
    await sleep(500);
    expect(room.turn!.playerId).toBe(ids[1]); // ainda é a vez dele
    expect(room.phase).toBe('planning');
    const b2 = await mk(url);
    await ok(b2, 'room:rejoin', { code, token: tokens[1] });
    await sleep(1500); // passou da tolerância, mas ele voltou
    expect(room.turn!.playerId).toBe(ids[1]);
    const d0 = room.career!.date;
    await ok(b2, 'turn:end');
    await trackers[0].waitRoom((s) => s.date !== d0 && s.phase === 'planning');
    // rodada 2 começa com B; agora ele cai e não volta: depois da tolerância o assistente conclui a vez
    expect(room.turn!.playerId).toBe(ids[1]);
    b2.disconnect();
    await waitUntil(() => room.turn?.playerId === ids[0], 10_000);
    expect(room.turn!.done).toContain(ids[1]);
  }, 120_000);

  it('proposta a um técnico que já jogou a vez fica na fila até a próxima vez dele (não expira na virada da rodada)', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const { socks, room, trackers } = await startedRoom(url, ['palmeiras', 'remo']);
    await ok(socks[0], 'turn:end'); // A (Palmeiras) já jogou
    const target = room.career!.humanSquads.palmeiras.find((id) => id)!;
    // elenco no máximo no início da carreira: abre uma vaga
    while (room.career!.humanSquads.remo.length >= 32) await ok(socks[1], 'market:release', { playerId: room.career!.humanSquads.remo.at(-1) });
    const res = await ok<{ pendingHuman?: boolean; offer?: { id: string } }>(socks[1], 'market:offer', { playerId: target, fee: 1_000_000 });
    expect(res.pendingHuman).toBe(true);
    const offerId = res.offer!.id;
    const d0 = room.career!.date;
    await ok(socks[1], 'turn:end');
    const snap = await trackers[0].waitSnap((s) => s.state.date !== d0);
    const o = snap.state.market!.offers.find((x) => x.id === offerId)!;
    expect(o.status).toBe('pending'); // na fila: A ainda não viu
    // rodada 2 (começa com B, depois A): A vê e pode responder na vez dele
    await ok(socks[1], 'turn:end');
    await waitUntil(() => room.turn?.playerId === room.players[0].id);
    const r = await ok<{ version: number }>(socks[0], 'market:respond', { offerId, accept: false });
    expect(r.version).toBeGreaterThan(0);
  }, 120_000);
});

describe('modo simultâneo', () => {
  it('cronômetro do planejamento: quem não marcou pronto é marcado e a rodada segue; contagem 3-2-1 com todos prontos', async () => {
    let url: string;
    ({ srv, url } = await startServer({ timerMs: 400, countdownMs: 300 }));
    const { socks, ids, room, trackers } = await startedRoom(url, ['palmeiras', 'santos'], { turnMode: 'simultaneous', matchMode: 'quick' });
    expect(room.planningDeadline).toBeTruthy();
    const d0 = room.career!.date;
    await ok(socks[0], 'round:ready', { ready: true });
    await trackers[0].waitRoom((s) => s.date !== d0 && s.phase === 'planning', 30_000);
    expect(room.player(ids[1])!.missed).toBe(1);
    expect(room.player(ids[0])!.missed).toBe(0);
  }, 120_000);

  it('todos prontos: contagem 3-2-1 (desmarcar cancela); host força sem cronômetro; convidado não força', async () => {
    let url: string;
    ({ srv, url } = await startServer({ countdownMs: 400 }));
    const { socks, room, trackers } = await startedRoom(url, ['palmeiras', 'santos'], { turnMode: 'simultaneous', matchMode: 'quick' });
    expect(room.planningDeadline).toBeNull();
    await ok(socks[0], 'round:ready', { ready: true });
    await ok(socks[1], 'round:ready', { ready: true });
    expect(room.countdown).toBeTruthy();
    await ok(socks[1], 'round:ready', { ready: false });
    expect(room.countdown).toBeNull();
    expect(room.phase).toBe('planning');
    expect((await call(socks[1], 'round:force')).ok).toBe(false);
    const d0 = room.career!.date;
    await ok(socks[0], 'round:force');
    await trackers[0].waitRoom((s) => s.date !== d0 && s.phase === 'planning', 30_000);
    expect(room.player(room.players[1].id)!.missed).toBe(1);
  }, 120_000);
});

describe('votação para pular', () => {
  it('maioria aprova (salto com o assistente, progresso para todos); minoria não', async () => {
    let url: string;
    ({ srv, url } = await startServer({ voteMs: 2000, skipOfferPct: 1_000_000 }));
    const { socks, room, trackers } = await startedRoom(url, ['palmeiras', 'santos', 'flarj'], { turnMode: 'simultaneous', matchMode: 'quick' });
    const d0 = room.career!.date;
    // minoria: 1 sim, 2 não
    const res1 = waitFor<{ passed: boolean }>(socks[2], 'vote:result');
    await ok(socks[0], 'vote:propose', { kind: 'skip', until: '2026-02-01', label: '01/02' });
    expect(room.vote).toBeTruthy();
    await ok(socks[1], 'vote:cast', { id: room.vote!.id, yes: false });
    await ok(socks[2], 'vote:cast', { id: room.vote!.id, yes: false });
    expect((await res1).passed).toBe(false);
    expect(room.career!.date).toBe(d0);
    // maioria: 2 de 3
    const prog = collect(socks[2], 'skip:progress');
    const end = waitFor<SkipEndPayload>(socks[2], 'skip:end', () => true, 120_000);
    await ok(socks[1], 'vote:propose', { kind: 'skip', until: '2026-02-01' });
    await ok(socks[0], 'vote:cast', { id: room.vote!.id, yes: true });
    const e = await end;
    expect(e.reason).toBe('done');
    expect(prog.length).toBeGreaterThan(0);
    await trackers[0].waitRoom((s) => s.phase === 'planning' && s.date === '2026-02-01');
    await trackers[0].waitSnap((s) => s.state.date === '2026-02-01');
  }, 180_000);

  it('para numa proposta grande por um jogador de um humano (banner com o dono)', async () => {
    let url: string;
    // qualquer proposta ≥ 1% do valor para o salto
    ({ srv, url } = await startServer({ voteMs: 2000, skipOfferPct: 1 }));
    const { socks, ids } = await startedRoom(url, ['palmeiras', 'santos'], { turnMode: 'simultaneous', matchMode: 'quick' });
    const end = waitFor<SkipEndPayload>(socks[1], 'skip:end', () => true, 170_000);
    await ok(socks[0], 'vote:propose', { kind: 'skip', until: '2026-12-01' });
    await ok(socks[1], 'vote:cast', { id: srv.rooms.values().next().value!.vote!.id, yes: true });
    const e = await end;
    expect(e.reason).toBe('offer');
    expect(['palmeiras', 'santos']).toContain(e.clubId);
    expect(ids).toContain(e.playerId);
    expect(e.note).toMatch(/^T[01]: Proposta/);
  }, 200_000);

  it('o salto para no fim de temporada de um humano', async () => {
    let url: string;
    ({ srv, url } = await startServer({ voteMs: 2000, skipOfferPct: 1_000_000 }));
    const { socks, trackers } = await startedRoom(url, ['palmeiras'], { turnMode: 'simultaneous', matchMode: 'quick' });
    const end = waitFor<SkipEndPayload>(socks[0], 'skip:end', () => true, 170_000);
    await ok(socks[0], 'vote:propose', { kind: 'skip', until: '2027-06-01' });
    const e = await end;
    expect(e.reason).toBe('season-end');
    await trackers[0].waitRoom((s) => s.phase === 'season-end');
  }, 200_000);
});

describe('Liga dos Amigos', () => {
  it('pontos: liga, títulos, copas, lucro e confronto direto; matriz e feed', () => {
    const f = emptyFriends();
    const names = (id: string) => id.toUpperCase();
    updateFromMeta(f, {
      a: { balance: 10_000_000, league: { id: 'L', name: 'Liga', pos: 1, size: 20, division: 1 }, titles: [], koWins: 0 },
      b: { balance: 10_000_000, league: { id: 'L', name: 'Liga', pos: 20, size: 20, division: 1 }, titles: [], koWins: 0 },
    }, 2026, '2026-01-01', names);
    recordH2H(f, 'a', 'b', 2, 1, '2026-02-01', names);
    recordH2H(f, 'b', 'a', 0, 0, '2026-03-01', names);
    updateFromMeta(f, {
      a: { balance: 30_000_000, league: { id: 'L', name: 'Liga', pos: 1, size: 20, division: 1 }, titles: [{ id: 'CUP', name: 'Copa', type: 'cup', season: 2026 }], koWins: 3 },
      b: { balance: 5_000_000, league: { id: 'L', name: 'Liga', pos: 20, size: 20, division: 1 }, titles: [], koWins: 1 },
    }, 2026, '2026-05-01', names);
    const l: FriendsLeague = computeFriendsLeague(f, [
      { playerId: 'pa', nickname: 'Ana', clubId: 'a' },
      { playerId: 'pb', nickname: 'Bia', clubId: 'b' },
    ]);
    const [ra, rb] = l.rows;
    expect(ra.playerId).toBe('pa');
    expect(ra.breakdown).toEqual({ league: 20, trophies: 15, cups: 6, profit: 4, h2h: 4 });
    expect(ra.points).toBe(49);
    expect(rb.breakdown).toEqual({ league: 0, trophies: 0, cups: 2, profit: -1, h2h: 1 });
    expect(l.matrix.a.b).toEqual({ w: 1, d: 1, l: 0, gf: 2, ga: 1 });
    expect(l.matrix.b.a).toEqual({ w: 0, d: 1, l: 1, gf: 1, ga: 2 });
    expect(l.feed[0].kind).toBe('title');
    expect(l.feed.some((x) => x.text === 'A venceu B por 2 x 1')).toBe(true);
  });

  it('o servidor manda a liga (friends:get / friends:update) com as posições reais', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const { socks } = await startedRoom(url, ['palmeiras', 'santos']);
    const l0 = await ok<FriendsLeague>(socks[1], 'friends:get');
    expect(l0.rows.map((r) => r.clubId).sort()).toEqual(['palmeiras', 'santos']);
    // sem jogos na liga ainda: posição não conta
    expect(l0.rows.every((r) => r.league === null && r.breakdown.league === 0)).toBe(true);
    // depois de jogar o Brasileirão: posição real (de 20)
    await new Tracker(socks[0]).devAdvance('2026-02-20');
    const l = await ok<FriendsLeague>(socks[1], 'friends:get');
    expect(l.rows.every((r) => r.league?.size === 20)).toBe(true);
  }, 60_000);
});

describe('regiões misturadas', () => {
  it('um europeu e um sul-americano: começa em 01/01 (o mais cedo) e o europeu entra na liga em agosto', async () => {
    let url: string;
    ({ srv, url } = await startServer());
    const { trackers, room } = await startedRoom(url, ['realmadrid-esp', 'flarj'], { turnMode: 'simultaneous', matchMode: 'quick' });
    const s0 = trackers[0].snap!;
    expect(s0.state.date).toBe('2026-01-01');
    expect(s0.state.humanClubIds).toEqual(['realmadrid-esp', 'flarj']);
    // flamengo já tem jogos; o Real está na pré-temporada (sem jogos antes de julho)
    const firstReal = s0.state.competitions.flatMap((c) => c.fixtures).filter((f) => f.homeId === 'realmadrid-esp' || f.awayId === 'realmadrid-esp').map((f) => f.date).sort()[0];
    expect(!firstReal || firstReal >= '2026-07-01').toBe(true);
    // 30/06: virada da Europa — o Real (humano) tem a tela de fim de temporada (renovações), o Flamengo espera
    const mid = await trackers[0].devAdvance('2026-08-31');
    expect(mid.state.date >= '2026-06-30' && mid.state.date <= '2026-07-01').toBe(true);
    await trackers[0].waitRoom((s) => s.phase === 'season-end');
    await ok(trackers[0].s, 'season:renew', { renew: {}, ready: true });
    await ok(trackers[1].s, 'season:renew', { renew: {}, ready: true });
    await trackers[0].waitRoom((s) => s.phase === 'planning');
    const snap = await trackers[0].devAdvance('2026-08-31');
    expect(snap.state.date).toBe('2026-08-31');
    const liga = snap.state.competitions.find((c) => c.id === 'ESP-1')!;
    expect(liga.clubIds).toContain('realmadrid-esp');
    expect(liga.fixtures.some((f) => f.result && (f.homeId === 'realmadrid-esp' || f.awayId === 'realmadrid-esp'))).toBe(true);
    expect(snap.state.humanClubIds).toEqual(['realmadrid-esp', 'flarj']);
    expect(room.phase).toBe('planning');
  }, 240_000);
});

describe('GET /public-url', () => {
  it('lê o arquivo do lançador a cada pedido; PUBLIC_URL tem prioridade; inválido = null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-url-'));
    try {
      const file = join(dir, 'public-url.txt');
      let url: string;
      ({ srv, url } = await startServer({ publicUrlFile: file }));
      const get = async () => ((await (await fetch(`${url}/public-url`)).json()) as { url: string | null }).url;
      expect(await get()).toBeNull();
      writeFileSync(file, 'https://abc-def.trycloudflare.com\n');
      expect(await get()).toBe('https://abc-def.trycloudflare.com');
      writeFileSync(file, 'javascript:alert(1)');
      expect(await get()).toBeNull();
      await srv.close();
      ({ srv, url } = await startServer({ publicUrlFile: file, publicUrl: 'https://fixo.example.com/' }));
      expect(await get()).toBe('https://fixo.example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

void ({} as RoomSummary);
