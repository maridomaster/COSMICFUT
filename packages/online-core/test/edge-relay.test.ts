/**
 * Integração do modo online grátis, em processo: relay (lógica do Durable Object) + anfitrião da simulação
 * (HostRuntime) + clientes do protocolo de fio. Mesmo fluxo do navegador, sem rede nem Cloudflare.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EdgeClient, EdgeSim, sleep, type HostOpts } from './harness.ts';

const HOST: HostOpts = {
  opts: { seedFor: () => 'test-seed', preMatchMs: 0, countdownMs: 0, devCommands: true, halfTimeTimeoutMs: 30, pauseTimeoutMs: 30, planningGraceMs: 200, disconnectGraceMs: 400 },
};

const edges: EdgeSim[] = [];
afterEach(() => {
  for (const e of edges.splice(0)) e.stop();
});

function newRoom(code: string): EdgeSim {
  const e = new EdgeSim(code);
  edges.push(e);
  expect(e.relay.init()).toBe(true);
  return e;
}

/** Cria a sala com A (anfitrião) + outros, escolhe clubes e inicia a temporada. */
async function setup(code: string, clubs: string[], settings: Record<string, unknown>) {
  const edge = newRoom(code);
  const names = ['Ana', 'Bia', 'Caio', 'Duda'];
  const cs = clubs.map((_, i) => new EdgeClient(names[i], HOST));
  const w = await cs[0].connect(edge, { mode: 'create', nickname: names[0], settings });
  expect(w.data.code).toBe(code);
  for (const c of cs.slice(1)) await c.connect(edge, { mode: 'join', nickname: c.name });
  for (let i = 0; i < cs.length; i++) await cs[i].ok('room:pick-club', { clubId: clubs[i] });
  await cs[0].ok('room:start', undefined, 120_000);
  await Promise.all(cs.map((c) => c.waitRoom((r) => r.phase === 'planning' && !!r.date)));
  return { edge, cs };
}

/** Modo turnos: cada um conclui a vez na ordem até a rodada começar. */
async function playTurns(cs: EdgeClient[]): Promise<void> {
  const r0 = cs[0].room;
  const round = r0.round;
  for (let i = 0; i < 12; i++) {
    const r = cs[0].room;
    if (r.phase !== 'planning' || r.round !== round) return;
    const who = cs.find((c) => c.playerId === r.turn?.playerId);
    if (!who) {
      await sleep(20);
      continue;
    }
    const res = await who.call('turn:end');
    if (!res.ok) await sleep(20);
    await sleep(15);
  }
}

describe('online grátis: relay + anfitrião no "navegador"', () => {
  it('3 técnicos em turnos: rodadas, partida ao vivo, salto votado e orçamento de requisições', async () => {
    const { edge, cs } = await setup('TURNO1', ['palmeiras', 'santos', 'gremio'], { turnMode: 'turns', matchMode: 'live', matchSpeedMs: 2 });
    const [a, b, c] = cs;
    expect(a.host).not.toBeNull();
    expect(b.host).toBeNull();
    expect(b.hostInfo).toMatchObject({ playerId: a.playerId, me: false });
    const rs = edge.relay.stats;
    const msgs = () => rs.clientMsgs + rs.hostFrames;

    let lives = 0;
    const perRound: number[] = [];
    for (let round = 0; round < 6; round++) {
      const before = msgs();
      const date = a.room.date;
      await playTurns(cs);
      // dia de jogo ao vivo para quem joga: espera o fim e o próximo planejamento
      await a.waitRoom((r) => r.phase === 'planning' && r.date !== date, 90_000);
      perRound.push(msgs() - before);
      lives = a.events.filter((e) => e.ev === 'match:start').length + b.events.filter((e) => e.ev === 'match:start').length + c.events.filter((e) => e.ev === 'match:start').length;
    }
    expect(lives).toBeGreaterThan(0);
    const ends = [...a.events, ...b.events, ...c.events].filter((e) => e.ev === 'match:end');
    expect(ends.length).toBeGreaterThan(0);
    // todos os clientes recebem a carreira (snapshot) e a mesma data
    for (const x of cs) expect(x.events.some((e) => e.ev === 'season:snapshot')).toBe(true);
    expect(b.room.date).toBe(a.room.date);

    // salto votado de 1 mês
    const skipFrom = msgs();
    const until = (() => {
      const d = new Date(`${a.room.date}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 10);
    })();
    await a.ok('vote:propose', { kind: 'skip', until });
    await b.waitRoom((r) => !!r.vote);
    const voteId = b.room.vote.id;
    await b.ok('vote:cast', { id: voteId, yes: true });
    await c.call('vote:cast', { id: voteId, yes: true });
    await a.waitEvent('skip:end', () => true, 180_000);
    const skipMsgs = msgs() - skipFrom;
    console.log(`[orçamento] turnos (3 técnicos): ${perRound.join(', ')} msgs/rodada; salto de 1 mês: ${skipMsgs}; checkpoints: ${rs.ckptChunks} pedaços; host→clientes ${rs.toClients}`);
    expect(Math.max(...perRound)).toBeLessThan(400);
  }, 400_000);

  it('anfitrião cai no meio do dia: outro técnico assume, carrega o checkpoint e rejoga o dia com o mesmo resultado', async () => {
    const settings = { turnMode: 'simultaneous', matchMode: 'quick' };
    // referência: sala X jogada até o fim sem queda
    const X = await setup('REFX01', ['palmeiras', 'santos', 'gremio'], settings);
    // sala Y: mesmas escolhas; o anfitrião cai assim que a rodada começa a simular
    const Y = await setup('FAILY1', ['palmeiras', 'santos', 'gremio'], settings);
    expect(Y.cs[0].room.date).toBe(X.cs[0].room.date);

    const resultsOf = (cl: EdgeClient, from: number) => cl.events.slice(from).filter((e) => e.ev === 'round:results').flatMap((e) => e.a.results.map((r: any) => `${e.a.date}:${r.fixtureId}:${r.home}-${r.away}`));

    const readyRound = async (cs: EdgeClient[]) => {
      const d = cs[1].room.date;
      await Promise.all(cs.map((c) => c.ok('round:ready', { ready: true })));
      await cs[1].waitRoom((r) => r.phase === 'planning' && r.date !== d, 120_000);
    };
    // 1ª rodada (até o dia de jogo) normal nas duas salas
    await readyRound(X.cs);
    await readyRound(Y.cs);
    expect(Y.cs[1].room.date).toBe(X.cs[1].room.date);
    // X: 2ª rodada (joga o dia) sem queda
    const fromX = X.cs[1].events.length;
    await readyRound(X.cs);
    const refResults = resultsOf(X.cs[1], fromX);
    expect(refResults.length).toBeGreaterThan(0);

    // Y: prontos → o anfitrião grava o checkpoint do planejamento (advancing) e cai
    const [a, b, c] = Y.cs;
    const fromY = b.events.length;
    const dateY = a.room.date;
    await Promise.all(Y.cs.map((x) => x.ok('round:ready', { ready: true })));
    for (let i = 0; i < 500; i++) {
      const m = JSON.parse(Y.edge.storage.get('meta') ?? '{}');
      if (m.advancing) break;
      await sleep(2);
    }
    expect(JSON.parse(Y.edge.storage.get('meta')!).advancing).toBe(true);
    a.drop();
    // B (técnico mais antigo conectado) é eleito depois da tolerância, rejoga o dia
    await b.waitEvent('edge:host', (h) => h.state === 'lost', 10_000);
    await b.waitRoom((r) => r.phase === 'planning' && r.date !== dateY && b.host !== null, 120_000);
    expect(b.host).not.toBeNull();
    expect(c.hostInfo).toMatchObject({ playerId: b.playerId, me: false });
    expect(b.room.date).toBe(X.cs[1].room.date);
    const replay = resultsOf(b, fromY);
    // sem duplicatas da tentativa interrompida: compara o conjunto
    expect([...new Set(replay)].sort()).toEqual([...new Set(refResults)].sort());

    // A volta (recarregou a página): continua na mesma carreira, agora como cliente comum
    const a2 = new EdgeClient('Ana', HOST);
    await a2.connect(Y.edge, { mode: 'rejoin', token: a.token });
    await a2.waitRoom((r) => r.date === b.room.date && r.players.find((p: any) => p.playerId === a.playerId)?.connected);
    expect(a2.host).toBeNull();
  }, 400_000);

  it('entrada tardia (desempregado) → proposta → assume clube; fecha tudo e volta pelo checkpoint', async () => {
    const { edge, cs } = await setup('TARDE1', ['palmeiras', 'santos'], { turnMode: 'simultaneous', matchMode: 'quick' });
    const [a, b] = cs;
    const late = new EdgeClient('Tardio', HOST);
    const w = await late.connect(edge, { mode: 'join', nickname: 'Tardio' });
    expect(w.data.unemployed).toBe(true);
    await late.waitRoom((r) => !!r.players.find((p: any) => p.playerId === late.playerId)?.unemployed);
    await a.ok('dev:advance', { until: '2026-03-10' }, 180_000);
    const jobs = await late.ok('jobs:get');
    const offers = jobs.offers.filter((o: any) => o.status === 'pending');
    expect(offers.length).toBeGreaterThan(0);
    const acc = await late.ok('jobs:accept', { offerId: offers[0].id });
    expect(acc.clubId).toBe(offers[0].clubId);
    await a.waitRoom((r) => r.players.find((p: any) => p.playerId === late.playerId)?.clubId === offers[0].clubId);

    // checkpoint do planejamento chega ao relay; todos fecham a aba
    const date = a.room.date;
    for (let i = 0; i < 300; i++) {
      const m = JSON.parse(edge.storage.get('meta') ?? '{}');
      const ck = edge.storage.get('ck');
      if (m.date === date && ck && m.players?.some((p: any) => p.id === late.playerId && p.clubId === offers[0].clubId) && !m.advancing) break;
      await sleep(10);
    }
    await sleep(400);
    for (const x of [a, b, late]) x.drop();
    expect(edge.sockets().length).toBe(0);
    // status da carreira (lista "Minhas carreiras online"): ninguém on-line, sem tokens
    const st = await edge.relay.status(late.token);
    expect(st).toMatchObject({ found: true, phase: 'planning', date, me: { playerId: late.playerId, clubId: offers[0].clubId } });
    expect(JSON.stringify(st).includes(late.token)).toBe(false);

    // volta: B abre de novo (vira anfitrião, carrega o checkpoint) e encontra o mesmo dia e os mesmos clubes
    const b2 = new EdgeClient('Bia', HOST);
    await b2.connect(edge, { mode: 'rejoin', token: b.token });
    await b2.waitRoom((r) => r.date === date && r.phase === 'planning', 60_000);
    expect(b2.host).not.toBeNull();
    expect(b2.room.players.find((p: any) => p.playerId === late.playerId).clubId).toBe(offers[0].clubId);
    await b2.waitEvent('season:snapshot');
    const late2 = new EdgeClient('Tardio', HOST);
    await late2.connect(edge, { mode: 'rejoin', token: late.token });
    await late2.waitRoom((r) => r.players.find((p: any) => p.playerId === late.playerId)?.connected);
    // o jogo continua: rodada com os presentes
    await b2.ok('round:ready', { ready: true });
    await late2.ok('round:ready', { ready: true });
    await b2.waitRoom((r) => r.phase === 'planning' && r.date !== date, 120_000);
  }, 400_000);
});
