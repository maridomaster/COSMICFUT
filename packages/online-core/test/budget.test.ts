/**
 * Orçamento de requisições do Durable Object (mensagens RECEBIDAS pelo DO = requisições cobradas no plano Free).
 * Cenário realista: 6 técnicos, modo turnos, partidas ao vivo na velocidade "Rápida" (150 ms/minuto), lotes de
 * 50 ms (planejamento) e 1 s (partida ao vivo), cada técnico fazendo 8 ações por vez, e um salto votado de 1 mês.
 * Demora alguns minutos (tempo real): só roda com BUDGET=1.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EdgeClient, EdgeSim, sleep, type HostOpts } from './harness.ts';

const HOST: HostOpts = {
  opts: { seedFor: () => 'budget-seed', preMatchMs: 2000, countdownMs: 0, halfTimeTimeoutMs: 3000, pauseTimeoutMs: 3000, planningGraceMs: 2000, disconnectGraceMs: 5000 },
  flushMs: 50,
  liveFlushMs: 1000,
  ckptDelayMs: 1500,
};

const edges: EdgeSim[] = [];
afterEach(() => {
  for (const e of edges.splice(0)) e.stop();
});

describe.runIf(process.env.BUDGET === '1')('orçamento de requisições (BUDGET=1)', () => {
  it('6 técnicos, turnos, ao vivo "Rápida", salto de 1 mês', async () => {
    const edge = new EdgeSim('BUDGET');
    edges.push(edge);
    edge.relay.init();
    const clubs = ['palmeiras', 'santos', 'gremio', 'corinthians-bra', 'bragantino-bra', 'botafogosp-bra'];
    const names = ['Ana', 'Bia', 'Caio', 'Duda', 'Edu', 'Fabi'];
    const cs = names.map((n) => new EdgeClient(n, HOST));
    await cs[0].connect(edge, { mode: 'create', nickname: 'Ana', settings: { turnMode: 'turns', matchMode: 'live', matchSpeedMs: 150 } });
    for (const c of cs.slice(1)) await c.connect(edge, { mode: 'join', nickname: c.name });
    const playable = clubs.slice();
    for (let i = 0; i < cs.length; i++) {
      const r = await cs[i].call('room:pick-club', { clubId: playable[i] });
      if (!r.ok) throw new Error(`${playable[i]}: ${r.error}`);
    }
    await cs[0].ok('room:start', undefined, 120_000);
    await cs[0].waitRoom((r) => r.phase === 'planning' && !!r.turn);
    const st = edge.relay.stats;
    const total = () => st.clientMsgs + st.hostFrames;
    const t0 = Date.now();
    const base = total();
    const rows: string[] = [];
    let matchesLive = 0;
    for (let round = 0; round < 5; round++) {
      const r0 = total();
      const c0 = st.clientMsgs;
      const tr = Date.now();
      const date = cs[0].room.date;
      const rnd = cs[0].room.round;
      // vezes: cada técnico faz 8 ações (escalação/mercado/consultas) e conclui
      for (let guard = 0; guard < 40; guard++) {
        const r = cs[0].room;
        if (r.phase !== 'planning' || r.round !== rnd) break;
        const who = cs.find((c) => c.playerId === r.turn?.playerId);
        if (!who) {
          await sleep(30);
          continue;
        }
        for (let k = 0; k < 8; k++) await who.call(k % 2 ? 'friends:get' : 'jobs:get');
        await who.call('turn:end');
        await sleep(20);
      }
      const startsBefore = cs.reduce((n, c) => n + c.events.filter((e) => e.ev === 'match:start').length, 0);
      await cs[0].waitRoom((r) => r.phase === 'planning' && r.date !== date, 300_000);
      const starts = cs.reduce((n, c) => n + c.events.filter((e) => e.ev === 'match:start').length, 0) - startsBefore;
      matchesLive += starts;
      rows.push(`rodada ${round + 1} (${date}): ${total() - r0} msgs (${st.clientMsgs - c0} de clientes), ${starts} partida(s) ao vivo, ${((Date.now() - tr) / 1000).toFixed(1)} s`);
    }
    const roundsMsgs = total() - base;
    const roundsSec = (Date.now() - t0) / 1000;
    // salto votado de 1 mês
    const s0 = total();
    const until = (() => {
      const d = new Date(`${cs[0].room.date}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 10);
    })();
    await cs[0].ok('vote:propose', { kind: 'skip', until });
    await cs[1].waitRoom((r) => !!r.vote);
    const id = cs[1].room.vote.id;
    for (const c of cs.slice(1)) await c.call('vote:cast', { id, yes: true });
    await cs[0].waitEvent('skip:end', () => true, 300_000);
    const skipMsgs = total() - s0;
    const perHour = (roundsMsgs / roundsSec) * 3600;
    const lines = [
      ...rows,
      `5 rodadas: ${roundsMsgs} msgs em ${roundsSec.toFixed(0)} s (${matchesLive} inícios de partida ao vivo vistos pelos clientes)`,
      `salto de 1 mês: ${skipMsgs} msgs`,
      `ritmo deste teste (bots rápidos): ${perHour.toFixed(0)} msgs/h; quadros do anfitrião ${st.hostFrames}, checkpoints ${st.ckptChunks} pedaços, entregas aos clientes ${st.toClients} (saída não conta)`,
    ];
    console.log(`[orçamento]\n${lines.join('\n')}`);
    expect(roundsMsgs / 5).toBeLessThan(1500);
  }, 900_000);
});
