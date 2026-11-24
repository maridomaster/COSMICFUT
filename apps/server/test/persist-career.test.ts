/**
 * Carreira online salva e entrada tardia (nota 42): sala vazia não expira, pausa sem ninguém, volta do disco,
 * vaga por token e por código, backup, técnico desempregado, vagas/propostas, assumir clube, demissão, Liga dos
 * Amigos por passagem e POST /careers/status sem vazar tokens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { CareerStatus, FriendsLeague, JobsPayload, RoomSummary } from '@cosmicfut/shared';
import type { RoomSnapshot } from '../src/room.ts';
import type { OnlineJobs } from '../src/jobs.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, ok, sleep, startServer, Tracker, waitFor, type Client } from './helpers.ts';

let servers: CosmicServer[] = [];
const sockets: Client[] = [];
const dirs: string[] = [];
async function mk(url: string) {
  const s = await client(url);
  sockets.push(s);
  return s;
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function boot(over: Parameters<typeof startServer>[0] = {}) {
  const r = await startServer(over);
  servers.push(r.srv);
  return r;
}
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cosmicfut-persist-'));
  dirs.push(d);
  return d;
};
async function post<T>(url: string, path: string, body: unknown): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as T, text };
}

/** Sala com 2 técnicos (Palmeiras × Santos), carreira criada. */
async function career(url: string, settings: Record<string, unknown> = {}) {
  const a = await mk(url);
  const b = await mk(url);
  const ta = new Tracker(a);
  const tb = new Tracker(b);
  const host = await ok<{ code: string; token: string; playerId: string }>(a, 'room:create', { nickname: 'Host', settings: { matchSpeedMs: 1, ...settings } });
  const guest = await ok<{ token: string; playerId: string }>(b, 'room:join', { code: host.code, nickname: 'Amigo' });
  await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
  await ok(b, 'room:pick-club', { clubId: 'santos' });
  await ok(a, 'room:start');
  await ta.waitSnap(() => true);
  await ta.waitRoom((r) => r.phase === 'planning');
  return { a, b, ta, tb, code: host.code, host, guest };
}

describe('carreira online salva', () => {
  it('convite do host (admin:job-offer): clube da IA convida técnico empregado; aceitar deixa o clube antigo para a IA', async () => {
    const { srv, url } = await boot({ simWorkers: 0, roomDefaults: { turnMode: 'simultaneous', matchMode: 'quick' } });
    const { a, b, tb, code, guest } = await career(url);
    // só o host convida; clube humano ou inexistente é recusado
    expect((await call(b, 'admin:job-offer', { playerId: guest.playerId, clubId: 'flarj' })).ok).toBe(false);
    expect((await call(a, 'admin:job-offer', { playerId: guest.playerId, clubId: 'palmeiras' })).ok).toBe(false);
    expect((await call(a, 'admin:job-offer', { playerId: guest.playerId, clubId: 'nao-existe-xyz' })).ok).toBe(false);
    await ok(a, 'admin:job-offer', { playerId: guest.playerId, clubId: 'flarj' });
    expect((await call(a, 'admin:job-offer', { playerId: guest.playerId, clubId: 'flarj' })).ok).toBe(false);
    const jobs = await ok<JobsPayload>(b, 'jobs:get');
    const offer = jobs.offers.find((o) => o.status === 'pending' && o.clubId === 'flarj');
    expect(offer).toBeTruthy();
    const acc = await ok<{ clubId: string }>(b, 'jobs:accept', { offerId: offer!.id });
    expect(acc.clubId).toBe('flarj');
    await tb.waitRoom((r) => r.players.find((p) => p.playerId === guest.playerId)?.clubId === 'flarj');
    const room = srv.rooms.get(code)!;
    expect(room.humanClubIds).toContain('flarj');
    expect(room.humanClubIds).not.toContain('santos');
    const after = await ok<JobsPayload>(b, 'jobs:get');
    expect(after.vacancies.some((v) => v.clubId === 'santos')).toBe(true);
    expect(after.me?.history.find((h) => h.clubId === 'santos')).toMatchObject({ exit: 'left' });
  });


  it('sala com a temporada iniciada sobrevive vazia além do TTL; sala no lobby expira', async () => {
    const { srv, url } = await boot({ roomTtlMs: 150, sweepIntervalMs: 40, unloadAfterMs: 60_000 });
    const { a, b, code } = await career(url);
    const c = await mk(url);
    const lobby = await ok<{ code: string }>(c, 'room:create', { nickname: 'Lobby' });
    a.disconnect();
    b.disconnect();
    c.disconnect();
    await sleep(600);
    expect(srv.rooms.has(code)).toBe(true);
    expect(srv.rooms.has(lobby.code)).toBe(false);
  });

  it('reinício: volta do disco sem avançar sozinha (pausada), descarrega da memória e o token recupera o mesmo clube', async () => {
    const dir = tmp();
    const first = await boot({ persistDir: dir, timerMs: 400 });
    const { a, b, code, host, guest } = await career(first.url, { matchMode: 'quick' });
    // cronômetro do planejamento (simultâneo) com todos fora: não avança
    a.disconnect();
    b.disconnect();
    await sleep(150);
    for (let i = 0; i < 100 && first.srv.rooms.get(code)!.phase !== 'planning'; i++) await sleep(50);
    const date0 = first.srv.rooms.get(code)!.career!.date;
    await sleep(900);
    expect(first.srv.rooms.get(code)!.career!.date).toBe(date0);
    expect(first.srv.rooms.get(code)!.phase).toBe('planning');
    await sleep(500);
    await first.srv.close();
    servers = servers.filter((s) => s !== first.srv);
    const saved = JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as RoomSnapshot;
    expect(saved.career?.date).toBe(date0);
    expect(saved.career?.jobs?.managers[host.playerId]?.clubId).toBe('palmeiras');

    // reinício: ninguém conectado ⇒ nada anda; depois descarrega da memória (fica no disco)
    const second = await boot({ persistDir: dir, timerMs: 150, unloadAfterMs: 300, sweepIntervalMs: 50 });
    expect(second.srv.rooms.has(code)).toBe(true);
    await sleep(900);
    expect(second.srv.rooms.has(code)).toBe(false);
    const again = JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as RoomSnapshot;
    expect(again.career?.date).toBe(date0);
    expect(again.career?.version).toBe(saved.career?.version);

    // volta pela lista: rejoin carrega do disco e devolve a mesma vaga/clube
    const a2 = await mk(second.url);
    const t2 = new Tracker(a2);
    const r = await ok<{ playerId: string }>(a2, 'room:rejoin', { code, token: host.token });
    expect(r.playerId).toBe(host.playerId);
    const st = await t2.waitRoom((x) => x.players.some((p) => p.playerId === host.playerId && p.connected));
    expect(st.players.find((p) => p.playerId === host.playerId)?.clubId).toBe('palmeiras');
    const snap = await t2.waitSnap((d) => !!d.world);
    expect(snap.state.date).toBe(date0);
    // o outro técnico continua com a vaga dele (token)
    const b2 = await mk(second.url);
    const rb = await ok<{ playerId: string }>(b2, 'room:rejoin', { code, token: guest.token });
    expect(rb.playerId).toBe(guest.playerId);
  });

  it('código de vaga: o host gera, outro aparelho assume (token novo, uso único) e o token antigo deixa de valer', async () => {
    const { url } = await boot();
    const { a, code, guest } = await career(url);
    expect((await call(await mk(url), 'room:seat-code', { playerId: guest.playerId })).ok).toBe(false); // fora da sala
    const { seatCode } = await ok<{ seatCode: string }>(a, 'room:seat-code', { playerId: guest.playerId });
    expect(seatCode).toMatch(/^[A-Z0-9]{6}$/);
    const d = await mk(url);
    const td = new Tracker(d);
    const claim = await ok<{ playerId: string; token: string }>(d, 'room:claim-seat', { code, seatCode, nickname: 'Amigo Novo' });
    expect(claim.playerId).toBe(guest.playerId);
    expect(claim.token).not.toBe(guest.token);
    expect((await call(await mk(url), 'room:rejoin', { code, token: guest.token })).ok).toBe(false);
    expect((await call(await mk(url), 'room:claim-seat', { code, seatCode })).ok).toBe(false);
    const st = await td.waitRoom((r) => r.players.some((p) => p.playerId === guest.playerId && p.nickname === 'Amigo Novo'));
    expect(st.players.find((p) => p.playerId === guest.playerId)?.clubId).toBe('santos');
  });

  it('backup do host: sem tokens; restaurar cria a sala com os mesmos técnicos e clubes', async () => {
    const { url } = await boot();
    const { code, host, guest } = await career(url);
    const deny = await fetch(`${url}/rooms/${code}/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: guest.token }) });
    expect(deny.status).toBe(403);
    const res = await fetch(`${url}/rooms/${code}/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: host.token }) });
    expect(res.status).toBe(200);
    const gz = Buffer.from(await res.arrayBuffer());
    const text = gunzipSync(gz).toString('utf8');
    expect(text).not.toContain(host.token);
    expect(text).not.toContain(guest.token);
    // validação estrita
    const bad = await fetch(`${url}/rooms/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('{"v":9}') });
    expect(bad.status).toBe(400);
    const r = await fetch(`${url}/rooms/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: gz });
    const j = (await r.json()) as { ok: boolean; data: { code: string; token: string; playerId: string } };
    expect(j.ok).toBe(true);
    expect(j.data.code).not.toBe(code); // o original ainda existe
    expect(j.data.playerId).toBe(host.playerId);
    const n = await mk(url);
    const tn = new Tracker(n);
    await ok(n, 'room:rejoin', { code: j.data.code, token: j.data.token });
    const st = await tn.waitRoom((x) => x.phase === 'planning' && x.players.length === 2);
    expect(st.players.map((p) => p.clubId).sort()).toEqual(['palmeiras', 'santos']);
    const snap = await tn.waitSnap((d) => !!d.world);
    expect(snap.state.humanClubIds.sort()).toEqual(['palmeiras', 'santos']);
  });

  it('POST /careers/status: situação da carreira sem devolver tokens; token errado não vê nada', async () => {
    const { url } = await boot();
    const { code, host, guest } = await career(url);
    const r = await post<{ ok: boolean; data: CareerStatus[] }>(url, '/careers/status', { items: [{ code, token: host.token }, { code, token: 'x'.repeat(32) }] });
    expect(r.json.ok).toBe(true);
    expect(r.text).not.toContain(host.token);
    expect(r.text).not.toContain(guest.token);
    const [mine, wrong] = r.json.data;
    expect(mine.found).toBe(true);
    expect(mine.me?.clubId).toBe('palmeiras');
    expect(mine.me?.isHost).toBe(true);
    expect(mine.managers?.length).toBe(2);
    expect(mine.date).toBeTruthy();
    expect(wrong.found).toBe(false);
    expect(wrong.managers).toBeUndefined();
  });
});

describe('entrada tardia e Central de Empregos', () => {
  it('modo turnos: desempregado sem proposta é pulado (não trava ninguém); vagas aparecem no mundo com o tempo', async () => {
    const { srv, url } = await boot({ roomDefaults: { turnMode: 'turns', matchMode: 'quick' } });
    const { a, ta, code } = await career(url);
    const c = await mk(url);
    const join = await ok<{ playerId: string }>(c, 'room:join', { code, nickname: 'Tardio' });
    await ta.waitRoom((r) => !!r.players.find((p) => p.playerId === join.playerId)?.unemployed);
    const room = srv.rooms.get(code)!;
    const changes0 = room.jobs?.changes.length ?? 0;
    // ~2 meses: a IA demite técnicos por maus resultados (algumas vagas por mês no mundo)
    await ok(a, 'dev:advance', { until: '2026-03-31' });
    const fired = (room.jobs?.changes ?? []).filter((x) => /demitido \(maus resultados\)/.test(x.reason)).length;
    expect((room.jobs?.changes.length ?? 0)).toBeGreaterThan(changes0);
    expect(fired).toBeGreaterThan(0);
    // nova rodada de vezes: o desempregado só entra na ordem se tiver proposta pendente
    const pending = room.jobs!.offers.filter((o) => o.managerId === join.playerId && o.status === 'pending').length;
    const st = await ta.waitRoom((r) => r.phase === 'planning' && !!r.turn);
    expect(st.turn!.order.includes(join.playerId)).toBe(pending > 0);
    // a vez de quem tem clube vem antes; a do desempregado (se houver) é a última e curta
    if (pending > 0) expect(st.turn!.order.at(-1)).toBe(join.playerId);
  });

  it('entra desempregado, recebe proposta, assume o clube; humano demitido vira desempregado; Liga dos Amigos por passagem', async () => {
    const { srv, url } = await boot({ simWorkers: 0, roomDefaults: { turnMode: 'simultaneous', matchMode: 'quick' } });
    const { a, b, ta, code, host } = await career(url);
    // técnico novo com a carreira rolando: desempregado
    const c = await mk(url);
    const tc = new Tracker(c);
    const jobsC: JobsPayload[] = [];
    c.on('jobs:update', (j) => jobsC.push(j));
    const join = await ok<{ playerId: string; unemployed?: boolean }>(c, 'room:join', { code, nickname: 'Tardio' });
    expect(join.unemployed).toBe(true);
    const st = await tc.waitRoom((r: RoomSummary) => !!r.players.find((p) => p.playerId === join.playerId)?.unemployed);
    expect(st.players.find((p) => p.playerId === join.playerId)?.clubId).toBeNull();
    await tc.waitSnap((d) => !!d.world);
    for (let i = 0; i < 100 && !jobsC.some((j) => j.me && j.vacancies.length >= 2); i++) await sleep(50);
    const j0 = jobsC.at(-1)!;
    expect(j0.me?.reputation).toBe(30);
    expect(j0.vacancies.filter((v) => v.reputation <= 2).length).toBeGreaterThanOrEqual(2);
    expect((await call(c, 'market:list', { playerIds: ['x'], listed: true })).ok).toBe(false);

    // dias passam: vagas e propostas para o desempregado (reputação baixa ⇒ clubes menores)
    await ok(a, 'dev:advance', { until: '2026-03-10' });
    const jobs = await ok<JobsPayload>(c, 'jobs:get');
    const offers = jobs.offers.filter((o) => o.status === 'pending');
    expect(jobs.changes.length).toBeGreaterThan(0);
    expect(offers.length).toBeGreaterThan(0);
    const offer = offers[0];
    expect(offer.reputation).toBeLessThanOrEqual(3.5);

    // aceitar: o clube sai da IA e vira dele (a partir da próxima rodada)
    const acc = await ok<{ clubId: string }>(c, 'jobs:accept', { offerId: offer.id });
    expect(acc.clubId).toBe(offer.clubId);
    const st2 = await tc.waitRoom((r) => r.players.find((p) => p.playerId === join.playerId)?.clubId === offer.clubId);
    expect(st2.players.find((p) => p.playerId === join.playerId)?.unemployed).toBeFalsy();
    const snap = await tc.waitSnap((d) => d.state.humanClubIds.includes(offer.clubId));
    expect(snap.state.humanClubIds).toContain(offer.clubId);
    const room = srv.rooms.get(code)!;
    expect(room.humanClubIds).toContain(offer.clubId);
    expect(room.career!.humanSquads[offer.clubId]?.length).toBeGreaterThan(10);
    // próxima rodada: todos prontos, o clube joga como humano (simulado no modo rápido)
    const before = room.career!.date;
    await ok(a, 'round:ready', { ready: true });
    await ok(b, 'round:ready', { ready: true });
    await ok(c, 'round:ready', { ready: true });
    await tc.waitRoom((r) => r.phase === 'planning' && r.date !== before, 60_000);
    expect(srv.rooms.get(code)!.humanClubIds).toContain(offer.clubId);

    // demissão de humano: diretoria no chão ⇒ demitido no próximo jogo, vira desempregado e recebe propostas
    const inline = (srv.sim as unknown as { sim: { careers: Map<string, { jobs: OnlineJobs }> } }).sim;
    const jm = inline.careers.get(code)!.jobs.managers[host.playerId];
    expect(jm.clubId).toBe('palmeiras');
    jm.board = { ...jm.board!, confidence: 1, games: 20 };
    const feed: string[] = [];
    a.on('turn:feed', (f) => feed.push(f.text));
    const d0 = srv.rooms.get(code)!.career!.date;
    const until = new Date(Date.parse(`${d0}T00:00:00Z`) + 25 * 86_400_000).toISOString().slice(0, 10);
    await ok(a, 'dev:advance', { until });
    const st3 = await ta.waitRoom((r) => !!r.players.find((p) => p.playerId === host.playerId)?.unemployed);
    expect(st3.players.find((p) => p.playerId === host.playerId)?.clubId).toBeNull();
    expect(feed.some((t) => /foi demitido do /.test(t))).toBe(true);
    expect(srv.rooms.get(code)!.humanClubIds).not.toContain('palmeiras');
    const jobsA = await ok<JobsPayload>(a, 'jobs:get');
    expect(jobsA.me?.history[0]).toMatchObject({ clubId: 'palmeiras', exit: 'fired' });
    // vaga aberta no Palmeiras (a IA pode já tê-la preenchido em 10–20 dias)
    expect(jobsA.changes.some((c) => c.clubId === 'palmeiras' && /demitido/.test(c.reason))).toBe(true);
    const d1 = srv.rooms.get(code)!.career!.date;
    const until2 = new Date(Date.parse(`${d1}T00:00:00Z`) + 20 * 86_400_000).toISOString().slice(0, 10);
    // (o host demitido continua host e pode avançar)
    await ok(a, 'dev:advance', { until: until2 });
    const jobsA2 = await ok<JobsPayload>(a, 'jobs:get');
    expect(jobsA2.offers.length).toBeGreaterThan(0);

    // Liga dos Amigos: pontos por passagem (o demitido leva a parcial do Palmeiras; o novo começa no clube dele)
    const league = await ok<FriendsLeague>(a, 'friends:get');
    const rowHost = league.rows.find((r) => r.playerId === host.playerId)!;
    const rowLate = league.rows.find((r) => r.playerId === join.playerId)!;
    expect(rowHost.clubId).toBeNull();
    expect(rowHost.tenures?.[0]).toMatchObject({ clubId: 'palmeiras' });
    expect(rowHost.tenures?.[0].to).toBeTruthy();
    expect(rowLate.clubId).toBe(offer.clubId);
    expect(rowLate.tenures?.map((t) => t.clubId)).toEqual([offer.clubId]);
    expect(league.feed.some((f) => f.kind === 'fired')).toBe(true);
    expect(league.feed.some((f) => f.kind === 'hired')).toBe(true);
    expect(league.feed.some((f) => f.kind === 'joined')).toBe(true);
    void waitFor;
  }, 240_000);
});
