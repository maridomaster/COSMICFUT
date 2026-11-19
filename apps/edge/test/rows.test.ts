/** Linhas gravadas no SQLite do DO por checkpoint (o plano Free permite 100 mil `rows_written` por dia). */
import { describe, expect, it } from 'vitest';
import { CKPT_CHUNK, decodeCkptChunk, encodeHostFrame, type RoomMetaLite } from '@cosmicfut/online-core/wire';
import { HOST_GRACE_MS } from '../src/relay.ts';
import { makeRoom, type FakeEnv, type FakeSocket } from './fake.ts';

const pattern = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 31 + seed) % 251);

async function sendCkpt(a: FakeSocket, id: string, bytes: Uint8Array, chunk = CKPT_CHUNK) {
  const n = Math.ceil(bytes.byteLength / chunk);
  for (let i = 0; i < n; i++) {
    const part = bytes.subarray(i * chunk, Math.min(bytes.byteLength, (i + 1) * chunk));
    await a.bin(encodeHostFrame({ ck: { id, i, n, size: bytes.byteLength, len: part.byteLength } }, [], part));
  }
}

/** O anfitrião aceita as entradas pendentes. */
async function answer(host: FakeSocket) {
  const done = (host as FakeSocket & { done?: Set<number> }).done ??= new Set<number>();
  const todo = host.json<{ t: string; j: number; p: string }>().filter((m) => m.t === 'join' && !done.has(m.j));
  for (const j of todo) done.add(j.j);
  if (todo.length) await host.bin(encodeHostFrame({ joined: todo.map((j) => ({ j: j.j, ok: true, p: j.p, data: {} })) }, []));
}

/** Sala com A (anfitrião) e B; devolve os dois. */
async function twoSeats(env: FakeEnv) {
  env.relay.init();
  const a = env.open();
  await a.msg({ t: 'hello', v: 1, mode: 'create', nickname: 'Ana', settings: {} });
  await answer(a);
  const b = env.open();
  await b.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'Bia' });
  await answer(a);
  return { a, b };
}

/** A cai; B é eleito e recebe o checkpoint: devolve os bytes remontados. */
async function failoverBytes(env: FakeEnv, a: FakeSocket, b: FakeSocket): Promise<{ n: number; bytes: Uint8Array }> {
  b.clear();
  a.drop();
  await env.tick(HOST_GRACE_MS + 10);
  const role = b.last<{ ckpt: { n: number; size: number } }>('role')!;
  const parts = b.bins().map(decodeCkptChunk).sort((x, y) => x.i - y.i);
  expect(parts.length).toBe(role.ckpt.n);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.bytes.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    expect(p.n).toBe(role.ckpt.n);
    out.set(p.bytes, at);
    at += p.bytes.byteLength;
  }
  expect(out.byteLength).toBe(role.ckpt.size);
  return { n: role.ckpt.n, bytes: out };
}

describe('relay: linhas gravadas por checkpoint', () => {
  it('checkpoint de 2,4 MB: poucas linhas (linhas grandes, regravadas no lugar) e o anfitrião novo recebe os mesmos bytes', async () => {
    const env = makeRoom('ROWS01');
    const { a, b } = await twoSeats(env);
    const bytes = pattern(2_400_000, 1);
    await sendCkpt(a, 'aa01', bytes);
    const w0 = env.storage.rowsWritten;
    const bytes2 = pattern(2_400_000, 7);
    await sendCkpt(a, 'aa02', bytes2);
    const per = env.storage.rowsWritten - w0;
    console.log(`[rows] checkpoint de 2.4 MB em ${Math.ceil(2_400_000 / CKPT_CHUNK)} pedaços: ${per} linhas gravadas (antes: 93)`);
    expect(per).toBeLessThanOrEqual(4);
    // ficou menor: a linha que sobrou é apagada
    const small = pattern(300_000, 3);
    await sendCkpt(a, 'aa03', small);
    expect([...env.storage.blobs.keys()].sort()).toEqual(['ck:0']);
    const got = await failoverBytes(env, a, b);
    expect(got.n).toBe(2);
    expect(got.bytes).toEqual(small);
  });

  it('checkpoint grande (3 linhas) volta inteiro', async () => {
    const env = makeRoom('ROWS02');
    const { a, b } = await twoSeats(env);
    const bytes = pattern(3_500_000, 5);
    await sendCkpt(a, 'bb01', bytes);
    expect(env.storage.blobs.size).toBe(3);
    const got = await failoverBytes(env, a, b);
    expect(got.bytes).toEqual(bytes);
  });

  it('pedaço do meio sem o começo (DO despejado no envio) é ignorado; o checkpoint anterior continua valendo', async () => {
    const env = makeRoom('ROWS03');
    const { a, b } = await twoSeats(env);
    const bytes = pattern(600_000, 2);
    await sendCkpt(a, 'cc01', bytes);
    const other = pattern(600_000, 9);
    const part = other.subarray(CKPT_CHUNK, 2 * CKPT_CHUNK);
    await a.bin(encodeHostFrame({ ck: { id: 'cc02', i: 1, n: 3, size: other.byteLength, len: part.byteLength } }, [], part));
    const got = await failoverBytes(env, a, b);
    expect(got.bytes).toEqual(bytes);
  });

  it('compatível com salas antigas: checkpoint no formato antigo (uma linha por pedaço + staging persistido)', async () => {
    const env = makeRoom('ROWS04');
    const { a, b } = await twoSeats(env);
    const old = pattern(700_000, 4);
    const n = Math.ceil(old.byteLength / CKPT_CHUNK);
    for (let i = 0; i < n; i++) env.storage.putBlob(`ck:${i}`, old.slice(i * CKPT_CHUNK, (i + 1) * CKPT_CHUNK));
    env.storage.put('ck', JSON.stringify({ id: 'old1', n, size: old.byteLength, at: 1 }));
    env.storage.putBlob('cks:0', new Uint8Array(10));
    env.storage.put('cks', JSON.stringify({ id: 'old2', n: 2, size: 20, got: [0] }));
    const got = await failoverBytes(env, a, b);
    expect(got.n).toBe(n);
    expect(got.bytes).toEqual(old);
    // o próximo checkpoint (novo formato) limpa as linhas e o staging antigos
    const next = pattern(500_000, 6);
    await sendCkpt(b, 'dd01', next);
    expect([...env.storage.blobs.keys()].sort()).toEqual(['ck:0']);
    expect(env.storage.get('cks')).toBeNull();
    const a2 = env.open();
    await a2.msg({ t: 'hello', v: 1, mode: 'join', nickname: 'Caio' });
    await answer(b);
    const got2 = await failoverBytes(env, b, a2);
    expect(got2.bytes).toEqual(next);
  });

  it('resumo da sala: mudar só a "última atividade" não regrava (até 10 min); outra mudança regrava', async () => {
    const env = makeRoom('ROWS05');
    const { a } = await twoSeats(env);
    const m = (over: Partial<RoomMetaLite>): RoomMetaLite => ({ phase: 'planning', season: 2026, date: '2026-02-01', hostId: 'p_x', turnOf: null, lastActivity: 1000, advancing: false, pub: null, players: [], ...over });
    await a.bin(encodeHostFrame({ meta: m({}) }, []));
    const w0 = env.storage.rowsWritten;
    for (let k = 1; k <= 20; k++) await a.bin(encodeHostFrame({ meta: m({ lastActivity: 1000 + k * 5000 }) }, []));
    expect(env.storage.rowsWritten - w0).toBe(0);
    await a.bin(encodeHostFrame({ meta: m({ lastActivity: 1000 + 11 * 60_000 }) }, []));
    expect(env.storage.rowsWritten - w0).toBe(1);
    await a.bin(encodeHostFrame({ meta: m({ lastActivity: 1000 + 11 * 60_000 + 1, advancing: true }) }, []));
    expect(env.storage.rowsWritten - w0).toBe(2);
    expect(env.relay.meta()!.advancing).toBe(true);
  });
});
