import { describe, expect, it } from 'vitest';
import { decodeCkptChunk, encodeHostFrame, encodeBundle, decodeBundle, type HostHeader, type RoomMetaLite } from '@cosmicfut/online-core/wire';
import { HOST_GRACE_MS, LOBBY_TTL_MS, MAX_MANAGERS, MAX_SPECTATORS } from '../src/relay.ts';
import { RoomRegistry } from '../src/registry.ts';
import { makeRoom, MemStorage, type FakeEnv, type FakeSocket } from './fake.ts';

type Msg = Record<string, any>;

const meta = (over: Partial<RoomMetaLite> = {}): RoomMetaLite => ({
  phase: 'lobby', season: null, date: null, hostId: 'p_x', turnOf: null, lastActivity: 1, advancing: false, pub: null, players: [], ...over,
});

/** O anfitrião responde as entradas pendentes que recebeu (aceita todas). */
async function answerJoins(_env: FakeEnv, host: FakeSocket, extra: HostHeader = {}): Promise<void> {
  const joins = host.json<Msg>().filter((m) => m.t === 'join');
  const done = new Set(host.json<Msg>().filter((m) => m.t === '_answered').map((m) => m.j));
  const todo = joins.filter((j) => !done.has(j.j));
  if (!todo.length && !Object.keys(extra).length) return;
  host.sent.push(...todo.map((j) => JSON.stringify({ t: '_answered', j: j.j })));
  await host.bin(encodeHostFrame({ joined: todo.map((j) => ({ j: j.j, ok: true, p: j.p, data: {} })), ...extra }, []));
}

/** Sala criada por A (anfitrião) com os outros entrando. Devolve sockets e tokens. */
async function room(env: FakeEnv, others: string[] = []): Promise<{ a: FakeSocket; tokA: string; pidA: string; socks: FakeSocket[]; pids: string[]; toks: string[] }> {
  expect(env.relay.init()).toBe(true);
  const a = env.open();
  await a.msg({ t: 'hello', v: 1, mode: 'create', nickname: 'Ana', settings: { turnMode: 'turns' } });
  expect(a.last('role')).toBeTruthy();
  await answerJoins(env, a);
  const w = a.last<Msg>('welcome')!;
  const socks: FakeSocket[] = [];
  const pids: string[] = [];
  const toks: string[] = [];
  for (const nick of others) {
    const s = env.open();
    await s.msg({ t: 'hello', v: 1, mode: 'join', nickname: nick });
    await answerJoins(env, a);
    const ws = s.last<Msg>('welcome')!;
    socks.push(s);
    pids.push(ws.playerId);
    toks.push(ws.token);
  }
  // resumo da sala (dono = A)
  await a.bin(encodeHostFrame({ meta: meta({ hostId: w.playerId, players: [{ id: w.playerId, nickname: 'Ana', clubId: null }, ...others.map((n, i) => ({ id: pids[i], nickname: n, clubId: null }))] }) }, []));
  return { a, tokA: w.token, pidA: w.playerId, socks, pids, toks };
}

describe('relay: autenticação e vagas', () => {
  it('cria a sala: o criador vira anfitrião, recebe token e o DO guarda só o hash', async () => {
    const env = makeRoom();
    const { a, tokA, pidA } = await room(env);
    const role = a.last<Msg>('role')!;
    expect(role.create.settings).toEqual({ turnMode: 'turns' });
    expect(a.last<Msg>('host')!.me).toBe(true);
    expect(tokA.length).toBeGreaterThanOrEqual(30);
    const seat = JSON.parse(env.storage.get(`seat:${pidA}`)!);
    expect(seat.th).toBe(await env.sha256(tokA));
    // o token em claro não está em lugar nenhum do armazenamento
    for (const v of env.storage.kv.values()) expect(v.includes(tokA)).toBe(false);
    // código reservado não pode ser recriado
    expect(env.relay.init()).toBe(false);
  });

  it('rejoin com token: liga a vaga; a conexão antiga cai; token errado é recusado', async () => {
    const env = makeRoom();
    const { a, socks, pids, toks } = await room(env, ['Bia']);
    const b2 = env.open();
    await b2.msg({ t: 'hello', v: 1, mode: 'rejoin', token: toks[0] });
    expect(b2.last<Msg>('welcome')!.playerId).toBe(pids[0]);
    expect(socks[0].closed?.reason).toBe('replaced');
    expect(socks[0].json<Msg>().some((m) => m.t === 'ev' && m.a?.code === 'replaced')).toBe(true);
    // o anfitrião recebe o attach com a vaga carimbada pelo relay
    expect(a.json<Msg>().filter((m) => m.t === 'attach').pop()).toMatchObject({ p: pids[0], c: b2.att.c });
    const bad = env.open();
    await bad.msg({ t: 'hello', v: 1, mode: 'rejoin', token: 'x'.repeat(32) });
    expect(bad.last<Msg>('denied')!.error).toMatch(/Token inválido/);
    expect(bad.closed).toBeTruthy();
  });

  it('limite de 6 técnicos e 4 espectadores', async () => {
    const env = makeRoom();
    const { a } = await room(env, ['B', 'C', 'D', 'E', 'F']);
    const g = env.open();
    await g.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'G' });
    expect(g.last<Msg>('denied')!.error).toMatch(new RegExp(`máximo ${MAX_MANAGERS}`));
    for (let i = 0; i < MAX_SPECTATORS; i++) {
      const s = env.open();
      await s.msg({ t: 'hello', v: 1, mode: 'join', nickname: `S${i}`, spectator: true });
      await answerJoins(env, a);
      expect(s.last<Msg>('welcome')).toBeTruthy();
    }
    const s5 = env.open();
    await s5.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'S5', spectator: true });
    expect(s5.last<Msg>('denied')!.error).toMatch(/espectadores/);
  });

  it('código de vaga: só o dono gera; quem usa ganha token novo e o antigo deixa de valer', async () => {
    const env = makeRoom();
    const { a, socks, pids, toks } = await room(env, ['Bia']);
    await socks[0].msg({ t: 'i', ev: 'room:seat-code', a: { playerId: pids[0] }, k: 1 });
    expect(socks[0].last<Msg>('ack')!.r).toEqual({ ok: false, error: 'Só o host da sala pode fazer isso.' });
    await a.msg({ t: 'i', ev: 'room:seat-code', a: { playerId: pids[0] }, k: 2 });
    const r = a.last<Msg>('ack')!.r;
    expect(r.ok).toBe(true);
    const code = r.data.seatCode as string;
    for (const v of env.storage.kv.values()) expect(v.includes(code)).toBe(false);
    const c = env.open();
    await c.msg({ t: 'hello', v: 1, mode: 'claim', seatCode: code, nickname: 'Beatriz' });
    const w = c.last<Msg>('welcome')!;
    expect(w.playerId).toBe(pids[0]);
    expect(w.token).not.toBe(toks[0]);
    expect(a.json<Msg>().filter((m) => m.t === 'claim').pop()).toMatchObject({ p: pids[0], nick: 'Beatriz' });
    const old = env.open();
    await old.msg({ t: 'hello', v: 1, mode: 'rejoin', token: toks[0] });
    expect(old.last<Msg>('denied')).toBeTruthy();
    // código de uso único
    const again = env.open();
    await again.msg({ t: 'hello', v: 1, mode: 'claim', seatCode: code });
    expect(again.last<Msg>('denied')).toBeTruthy();
  });

  it('administração: código de vaga pelo apelido sem o dono conectado; o dono recupera a própria vaga', async () => {
    const env = makeRoom();
    const { a, pidA, tokA } = await room(env, ['Bia']);
    a.close();
    expect((await env.relay.adminSeatCode('ninguém')).ok).toBe(false);
    const r = await env.relay.adminSeatCode('ana');
    if (!r.ok) throw new Error(r.error);
    expect(r.data.playerId).toBe(pidA);
    expect(r.data.nickname).toBe('Ana');
    for (const v of env.storage.kv.values()) expect(v.includes(r.data.seatCode)).toBe(false);
    const c = env.open();
    await c.msg({ t: 'hello', v: 1, mode: 'claim', seatCode: r.data.seatCode, nickname: 'Ana' });
    const w = c.last<Msg>('welcome')!;
    expect(w.playerId).toBe(pidA);
    expect(w.token).not.toBe(tokA);
  });
});

describe('relay: roteamento', () => {
  it('intenções vão ao anfitrião com a vaga do relay (o cliente não escolhe a vaga)', async () => {
    const env = makeRoom();
    const { a, socks, pids } = await room(env, ['Bia']);
    await socks[0].msg({ t: 'i', ev: 'round:ready', a: { ready: true, p: 'p_falso' }, k: 7, p: 'p_falso', c: 'outra' });
    const fwd = a.json<Msg>().filter((m) => m.t === 'i').pop()!;
    expect(fwd).toMatchObject({ t: 'i', c: socks[0].att.c, p: pids[0], ev: 'round:ready', k: 7 });
    // sem vaga: recusado no relay
    const anon = env.open();
    await anon.msg({ t: 'i', ev: 'round:ready', k: 1 });
    expect(anon.last<Msg>('ack')!.r.ok).toBe(false);
    // evento desconhecido / mensagem grande / JSON quebrado
    await socks[0].msg({ t: 'i', ev: 'dev:hack', k: 2 });
    expect(socks[0].last<Msg>('ack')!.r.error).toBe('Evento desconhecido.');
    await env.relay.onMessage(socks[0], 'x'.repeat(70 * 1024));
    expect(socks[0].closed).toBeTruthy();
    // administração: só o dono
    const c = env.open();
    await c.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'Caio' });
    await answerJoins(env, a);
    await c.msg({ t: 'i', ev: 'room:kick', a: { playerId: pids[0] }, k: 3 });
    expect(c.last<Msg>('ack')!.r.error).toMatch(/Só o host/);
    await c.msg({ t: 'i', ev: 'room:update-settings', a: {}, k: 4 });
    expect(c.last<Msg>('ack')!.r.error).toMatch(/Só o host/);
  });

  it('só o anfitrião eleito transmite; os corpos vão só para os destinos', async () => {
    const env = makeRoom();
    const { a, socks } = await room(env, ['Bia', 'Caio']);
    const [b, c] = socks;
    const body = encodeBundle([{ ev: 'turn:feed', a: { text: 'oi' } }]);
    // não-anfitrião tentando transmitir: ignorado
    b.clear();
    c.clear();
    await b.bin(encodeHostFrame({ o: [{ to: [c.att.c], n: body.byteLength }] }, [body]));
    expect(c.bins().length).toBe(0);
    // anfitrião: entrega só para C
    await a.bin(encodeHostFrame({ o: [{ to: [c.att.c], n: body.byteLength }] }, [body]));
    expect(c.bins().length).toBe(1);
    expect(b.bins().length).toBe(0);
    expect(decodeBundle(c.bins()[0])[0]).toMatchObject({ ev: 'turn:feed', a: { text: 'oi' } });
    // cabeçalho com tamanho mentiroso: descartado inteiro
    c.clear();
    await a.bin(encodeHostFrame({ o: [{ to: [c.att.c], n: 99999 }] }, [body]));
    expect(c.bins().length).toBe(0);
  });

  it('room:leave: o ack da saída chega a quem saiu (antes se perdia), e a conexão não fala mais pela vaga', async () => {
    const env = makeRoom();
    const { a, socks } = await room(env, ['Bia']);
    const [b] = socks;
    await b.msg({ t: 'i', ev: 'room:leave', k: 9 });
    expect(a.json<Msg>().filter((m) => m.t === 'i').pop()).toMatchObject({ ev: 'room:leave', k: 9 });
    expect(b.att.p).toBeNull();
    b.clear();
    const ack = encodeBundle([{ ev: '@ack', a: { k: 9, r: { ok: true } } }]);
    await a.bin(encodeHostFrame({ o: [{ to: [b.att.c], n: ack.byteLength }] }, [ack]));
    expect(b.bins().length).toBe(1);
    await b.msg({ t: 'i', ev: 'chat:send', a: { text: 'oi' }, k: 10 });
    expect(b.last<Msg>('ack')!.r.error).toMatch(/não está em uma sala/);
  });

  it('Rodada ao vivo: um corpo para "todos" (técnicos + espectador) = 1 mensagem recebida pelo DO; o leque de saída é grátis', async () => {
    const env = makeRoom();
    const { a, socks } = await room(env, ['Bia', 'Caio']);
    const spec = env.open();
    await spec.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'Espia', spectator: true });
    await answerJoins(env, a);
    expect(spec.last<Msg>('welcome')).toBeTruthy();
    const all = [a, ...socks, spec];
    for (const s of all) s.clear();
    const before = env.relay.stats.hostFrames + env.relay.stats.clientMsgs;
    const ticks = encodeBundle(Array.from({ length: 7 }, (_, i) => ({ ev: 'match:tick', a: { matchId: 'm1', minute: i }, dt: i * 150 })));
    await a.bin(encodeHostFrame({ o: [{ to: all.map((s) => s.att.c), n: ticks.byteLength }] }, [ticks]));
    expect(env.relay.stats.hostFrames + env.relay.stats.clientMsgs - before).toBe(1);
    for (const s of all) {
      expect(s.bins().length).toBe(1);
      expect(decodeBundle(s.bins()[0]).length).toBe(7);
    }
  });

  it('expulsão: o anfitrião informa a saída e a vaga é revogada (token não vale mais)', async () => {
    const env = makeRoom();
    const { a, socks, pids, toks } = await room(env, ['Bia']);
    await a.msg({ t: 'i', ev: 'room:kick', a: { playerId: pids[0] }, k: 1 });
    expect(a.json<Msg>().filter((m) => m.t === 'i').pop()).toMatchObject({ ev: 'room:kick' });
    await a.bin(encodeHostFrame({ drop: [pids[0]] }, []));
    expect(socks[0].closed?.reason).toBe('left');
    const back = env.open();
    await back.msg({ t: 'hello', v: 1, mode: 'rejoin', token: toks[0] });
    expect(back.last<Msg>('denied')).toBeTruthy();
  });

  it('limites: chat (5 em 10 s), reações (700 ms) e mensagens por segundo', async () => {
    const env = makeRoom();
    const { a, socks } = await room(env, ['Bia']);
    const b = socks[0];
    for (let i = 0; i < 5; i++) await b.msg({ t: 'i', ev: 'chat:send', a: { text: `m${i}` }, k: i });
    await b.msg({ t: 'i', ev: 'chat:send', a: { text: 'flood' }, k: 99 });
    expect(b.last<Msg>('ack')!.r.error).toMatch(/Muitas mensagens/);
    expect(a.json<Msg>().filter((m) => m.t === 'i' && m.ev === 'chat:send').length).toBe(5);
    env.clock += 2000;
    await b.msg({ t: 'i', ev: 'room:react', a: { emoji: '🔥' }, k: 100 });
    await b.msg({ t: 'i', ev: 'room:react', a: { emoji: '🔥' }, k: 101 });
    expect(b.last<Msg>('ack')!.r.error).toMatch(/reações/);
    env.clock += 2000;
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      await b.msg({ t: 'i', ev: 'jobs:get', k: 200 + i });
      if (b.last<Msg>('ack')?.k === 200 + i && b.last<Msg>('ack')!.r.ok === false) refused++;
    }
    expect(refused).toBe(10);
  });
});

describe('relay: checkpoint, failover e expiração', () => {
  async function sendCkpt(host: FakeSocket, bytes: Uint8Array, chunk: number, extra: HostHeader = {}) {
    const n = Math.ceil(bytes.byteLength / chunk);
    for (let i = 0; i < n; i++) {
      const part = bytes.subarray(i * chunk, Math.min(bytes.byteLength, (i + 1) * chunk));
      await host.bin(encodeHostFrame({ ck: { id: 'abc123', i, n, size: bytes.byteLength, len: part.byteLength }, ...(i === n - 1 ? extra : {}) }, [], part));
    }
  }

  it('checkpoint em pedaços: grava e devolve os mesmos bytes ao novo anfitrião (com replay se a rodada estava rodando)', async () => {
    const env = makeRoom();
    const { a, socks, pidA, pids } = await room(env, ['Bia', 'Caio']);
    const bytes = new Uint8Array(700_000).map((_, i) => (i * 31) % 251);
    await sendCkpt(a, bytes, 256 * 1024, { meta: meta({ hostId: pidA, phase: 'matchday', season: 2026, date: '2026-01-20', advancing: true, players: [{ id: pidA, nickname: 'Ana', clubId: 'palmeiras' }, { id: pids[0], nickname: 'Bia', clubId: 'santos' }, { id: pids[1], nickname: 'Caio', clubId: 'gremio' }] }) });
    expect(JSON.parse(env.storage.get('ck')!).n).toBe(3);
    expect(env.storage.keys('cks').length).toBe(0);
    // anfitrião cai: todos veem "lost"; depois da tolerância, B (técnico mais antigo conectado) é eleito
    a.drop();
    expect(socks[0].last<Msg>('host')!.state).toBe('lost');
    await socks[0].msg({ t: 'i', ev: 'round:ready', a: { ready: true }, k: 5 });
    expect(socks[0].last<Msg>('ack')!.r.error).toMatch(/reconectando/);
    await env.tick(HOST_GRACE_MS + 10);
    const role = socks[0].last<Msg>('role')!;
    expect(role.replay).toBe(true);
    expect(role.ckpt).toEqual({ n: 3, size: bytes.byteLength });
    expect(Object.fromEntries(role.seats.map((s: Msg) => [s.p, !!s.c]))).toEqual({ [pidA]: false, [pids[0]]: true, [pids[1]]: true });
    const parts = socks[0].bins().map(decodeCkptChunk);
    const got = new Uint8Array(parts.reduce((n, p) => n + p.bytes.byteLength, 0));
    let at = 0;
    for (const p of parts.sort((x, y) => x.i - y.i)) {
      got.set(p.bytes, at);
      at += p.bytes.byteLength;
    }
    expect(got).toEqual(bytes);
    expect(socks[1].last<Msg>('host')).toMatchObject({ playerId: pids[0], state: 'resuming', me: false });
    // o novo anfitrião transmite; os outros não
    const body = encodeBundle([{ ev: 'room:state', a: { ok: 1 } }]);
    socks[1].clear();
    await socks[1].bin(encodeHostFrame({ o: [{ to: [socks[1].att.c], n: body.byteLength }] }, [body]));
    expect(socks[1].bins().length).toBe(0);
    await socks[0].bin(encodeHostFrame({ o: [{ to: [socks[1].att.c], n: body.byteLength }] }, [body]));
    expect(socks[1].bins().length).toBe(1);
  });

  it('o anfitrião recarrega a página dentro da tolerância: volta a ser eleito (é o dono)', async () => {
    const env = makeRoom();
    const { a, tokA, pidA, socks } = await room(env, ['Bia']);
    await sendCkpt(a, new Uint8Array([1, 2, 3]), 1024, { meta: meta({ hostId: pidA, phase: 'planning', players: [] }) });
    a.drop();
    const a2 = env.open();
    await a2.msg({ t: 'hello', v: 1, mode: 'rejoin', token: tokA });
    expect(a2.last<Msg>('welcome')).toBeTruthy();
    await env.tick(HOST_GRACE_MS + 1);
    expect(a2.last<Msg>('role')).toBeTruthy();
    expect(a2.last<Msg>('role')!.replay).toBe(false);
    expect(socks[0].last<Msg>('role')).toBeUndefined();
  });

  it('lobby vazio expira (alarme); carreira começada nunca expira', async () => {
    const env = makeRoom('LOBBY1');
    const { a, socks } = await room(env, ['Bia']);
    socks[0].drop();
    a.drop();
    expect(env.alarm).toBe(env.clock + LOBBY_TTL_MS);
    await env.tick(LOBBY_TTL_MS + 1);
    expect(env.storage.get('room')).toBeNull();

    const env2 = makeRoom('CARR01');
    const r2 = await room(env2, ['Bia']);
    await r2.a.bin(encodeHostFrame({ meta: meta({ hostId: r2.pidA, phase: 'planning', season: 2026, date: '2026-02-01' }) }, []));
    r2.socks[0].drop();
    r2.a.drop();
    expect(env2.alarm).toBeNull();
    await env2.tick(LOBBY_TTL_MS * 10);
    expect(env2.storage.get('room')).not.toBeNull();
  });

  it('"Minhas carreiras online": situação sem vazar tokens; token errado não acha nada', async () => {
    const env = makeRoom('STAT01');
    const { a, tokA, pidA, pids, toks } = await room(env, ['Bia']);
    await a.bin(encodeHostFrame({ meta: meta({ hostId: pidA, phase: 'planning', season: 2026, date: '2026-03-01', turnOf: 'Bia', players: [{ id: pidA, nickname: 'Ana', clubId: 'palmeiras', color: '#ff0000' }, { id: pids[0], nickname: 'Bia', clubId: null, unemployed: true }] }) }, []));
    const s = await env.relay.status(toks[0]);
    expect(s).toMatchObject({ code: 'STAT01', found: true, phase: 'planning', date: '2026-03-01', turnOf: 'Bia', me: { playerId: pids[0], nickname: 'Bia', isHost: false } });
    expect((s.managers as Msg[]).map((m) => [m.nickname, m.online, !!m.unemployed])).toEqual([['Ana', true, false], ['Bia', true, true]]);
    const txt = JSON.stringify(s);
    expect(txt.includes(tokA)).toBe(false);
    expect(txt.includes(toks[0])).toBe(false);
    expect(await env.relay.status('y'.repeat(32))).toEqual({ code: 'STAT01', found: false });
  });

  it('encerrar a carreira: só o dono, com confirmação; apaga tudo e avisa todos', async () => {
    const env = makeRoom('ENDX01');
    const { a, socks } = await room(env, ['Bia']);
    await a.msg({ t: 'i', ev: 'room:end', a: { confirm: 'ERRADO' }, k: 1 });
    expect(a.last<Msg>('ack')!.r.ok).toBe(false);
    await a.msg({ t: 'i', ev: 'room:end', a: { confirm: 'ENDX01' }, k: 2 });
    expect(socks[0].json<Msg>().some((m) => m.t === 'ev' && m.ev === 'room:ended')).toBe(true);
    expect(env.storage.kv.size).toBe(0);
  });

  it('salas públicas: o resumo publica/retira a sala do registro', async () => {
    const env = makeRoom('PUB001');
    const { a, pidA } = await room(env);
    const pub = { host: 'Ana', hostClubId: null, players: 1, maxPlayers: 6, preset: 'sem-pressa', turnMode: 'turns', pickMode: 'free', createdAt: 5 };
    await a.bin(encodeHostFrame({ meta: meta({ hostId: pidA, pub }) }, []));
    expect(env.published.pop()).toEqual({ code: 'PUB001', info: { ...pub, code: 'PUB001' } });
    await a.bin(encodeHostFrame({ meta: meta({ hostId: pidA, pub: null }) }, []));
    expect(env.published.pop()).toEqual({ code: 'PUB001', info: null });
    const reg = new RoomRegistry(new MemStorage(), () => 1000);
    reg.put('PUB001', { ...pub, code: 'PUB001' });
    reg.put('bad', pub);
    expect(reg.list().map((r) => r.code)).toEqual(['PUB001']);
    reg.put('PUB001', null);
    expect(reg.list()).toEqual([]);
  });
});


describe('relay: orçamento de CPU (cada mensagem bem abaixo de 10 ms)', () => {
  it('quadro do anfitrião de ~900 KB (snapshot fragmentado), pedaço de checkpoint, intenção e eleição', async () => {
    const env = makeRoom('CPU001');
    const { a, socks, pidA } = await room(env, ['B', 'C', 'D', 'E', 'F']);
    const frag = new Uint8Array(240 * 1024 + 9).fill(7);
    frag[0] = 2;
    const to = [a, ...socks].map((s) => s.att.c);
    const big = encodeHostFrame({ o: [0, 1, 2].map(() => ({ to, n: frag.byteLength })), meta: meta({ hostId: pidA }) }, [frag, frag, frag]);
    const time = async (fn: () => Promise<void>, n = 30) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) await fn();
      return (performance.now() - t0) / n;
    };
    const host = await time(() => a.bin(big));
    const chunk = new Uint8Array(256 * 1024).fill(3);
    let i = 0;
    const ck = await time(() => a.bin(encodeHostFrame({ ck: { id: 'aa' + (i++ % 1000), i: 0, n: 2, size: chunk.byteLength * 2, len: chunk.byteLength } }, [], chunk)));
    const intent = await time(() => socks[0].msg({ t: 'i', ev: 'round:set-lineup', a: { tactic: { formation: '4-4-2' }, lineup: Array.from({ length: 18 }, (_, k) => `p${k}`) }, k: 1 }), 25);
    for (const s of [a, ...socks]) s.clear();
    // eleição com checkpoint de 900 KB (4 pedaços) para o novo anfitrião
    const ckBytes = new Uint8Array(900_000).fill(5);
    for (let k = 0; k < 4; k++) {
      const part = ckBytes.subarray(k * 262144, Math.min(ckBytes.byteLength, (k + 1) * 262144));
      await a.bin(encodeHostFrame({ ck: { id: 'bb', i: k, n: 4, size: ckBytes.byteLength, len: part.byteLength } }, [], part));
    }
    a.drop();
    const t0 = performance.now();
    await env.tick(HOST_GRACE_MS + 1);
    const elect = performance.now() - t0;
    console.log(`[cpu] quadro 720 KB→6 clientes ${host.toFixed(2)} ms · pedaço de checkpoint 256 KB ${ck.toFixed(2)} ms · intenção ${intent.toFixed(3)} ms · eleição+envio de checkpoint ${elect.toFixed(2)} ms`);
    expect(host).toBeLessThan(5);
    expect(ck).toBeLessThan(5);
    expect(intent).toBeLessThan(2);
    expect(elect).toBeLessThan(8);
  });
});