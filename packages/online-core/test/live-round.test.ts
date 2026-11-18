/**
 * (Rodada ao vivo) Todos da sala assistem às partidas ao vivo dos humanos: espectador, técnico desempregado e técnico
 * que não joga a partida (espia a dos outros). Ticks em lote para "todos" (1 corpo por janela); comandos de quem não
 * joga a partida são recusados (só leitura).
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

describe('Rodada ao vivo: todos assistem', () => {
  it('espectador, desempregado e quem não joga recebem as partidas (só leitura); comandos de fora são recusados', async () => {
    const edge = new EdgeSim('VIVO01');
    edges.push(edge);
    expect(edge.relay.init()).toBe(true);
    const a = new EdgeClient('Ana', HOST);
    const b = new EdgeClient('Bia', HOST);
    const c = new EdgeClient('Caio', HOST);
    await a.connect(edge, { mode: 'create', nickname: 'Ana', settings: { turnMode: 'simultaneous', matchMode: 'live', matchSpeedMs: 40 } });
    await b.connect(edge, { mode: 'join', nickname: 'Bia' });
    await c.connect(edge, { mode: 'join', nickname: 'Caio' });
    await a.ok('room:pick-club', { clubId: 'palmeiras' });
    await b.ok('room:pick-club', { clubId: 'santos' });
    await c.ok('room:pick-club', { clubId: 'gremio' });
    await a.ok('room:start', undefined, 120_000);
    await a.waitRoom((r) => r.phase === 'planning' && !!r.date);
    // espectador e técnico que entra depois (desempregado)
    const spec = new EdgeClient('Espia', HOST);
    await spec.connect(edge, { mode: 'join', nickname: 'Espia', spectator: true });
    const late = new EdgeClient('Tardio', HOST);
    const wl = await late.connect(edge, { mode: 'join', nickname: 'Tardio' });
    expect(wl.data.unemployed).toBe(true);
    const managers = [a, b, c];
    const all = [a, b, c, spec, late];

    // rodadas até um dia de jogo ao vivo com partida humana
    let matchId: string | null = null;
    for (let round = 0; round < 8 && !matchId; round++) {
      const date = a.room.date;
      const from = spec.events.length;
      await Promise.all(managers.map((m) => m.call('round:ready', { ready: true })));
      for (let i = 0; i < 400; i++) {
        const st = spec.events.slice(from).find((e) => e.ev === 'match:start' && e.a.side === null);
        if (st) {
          matchId = st.a.matchId;
          break;
        }
        if (a.room.phase === 'planning' && a.room.date !== date) break;
        await sleep(10);
      }
      if (!matchId) await a.waitRoom((r) => r.phase === 'planning' && r.date !== date, 120_000);
    }
    expect(matchId).not.toBeNull();
    const m = spec.events.find((e) => e.ev === 'match:start' && e.a.matchId === matchId)!.a;
    expect(m.side).toBeNull();
    expect(m.config).toBeTruthy();
    const players = [m.homePlayerId, m.awayPlayerId].filter(Boolean) as string[];
    expect(players.length).toBeGreaterThan(0);

    // só leitura: espectador, desempregado e técnico de fora não mandam na partida
    const outsiders = [spec, late, ...managers.filter((x) => !players.includes(x.playerId))];
    for (const x of outsiders) {
      for (const [ev, a2] of [
        ['match:command', { matchId, command: { side: 'home', type: 'tactic', tactic: {} } }],
        ['match:pause-request', { matchId }],
        ['match:resume', { matchId }],
      ] as const) {
        const r = await x.call(ev, a2);
        expect(r.ok, `${x.name} ${ev}`).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/não está nesta partida|não há partida|Partida não encontrada|Espectador/i);
      }
    }

    // espera o fim do dia; todos receberam os ticks e o fim da partida
    const date = a.room.date;
    await a.waitRoom((r) => r.phase === 'planning' && r.date !== date, 120_000);
    await sleep(300);
    for (const x of all) {
      const starts = x.events.filter((e) => e.ev === 'match:start' && e.a.matchId === matchId);
      expect(starts.length, `${x.name} match:start`).toBeGreaterThan(0);
      const mine = players.includes(x.playerId);
      // quem joga recebe a sua (com o lado) — e a cópia só leitura, que o cliente ignora
      if (mine) expect(starts.some((e) => e.a.side === 'home' || e.a.side === 'away')).toBe(true);
      else expect(starts.every((e) => e.a.side === null)).toBe(true);
      const ticks = x.events.filter((e) => e.ev === 'match:tick' && e.a.matchId === matchId);
      expect(ticks.length, `${x.name} ticks`).toBeGreaterThan(20);
      expect(x.events.some((e) => e.ev === 'match:end' && e.a.matchId === matchId), `${x.name} match:end`).toBe(true);
      expect(x.events.some((e) => e.ev === 'match:info' && e.a.matchId === matchId), `${x.name} match:info`).toBe(true);
    }
    // técnico que joga OUTRA partida no mesmo dia também espia esta (se houve duas partidas humanas)
    const otherIds = new Set(spec.events.filter((e) => e.ev === 'match:start' && e.a.side === null).map((e) => e.a.matchId));
    for (const x of managers) {
      for (const id of otherIds) {
        const st = spec.events.find((e) => e.ev === 'match:start' && e.a.matchId === id)!.a;
        if (st.homePlayerId === x.playerId || st.awayPlayerId === x.playerId) continue;
        expect(x.events.some((e) => e.ev === 'match:start' && e.a.matchId === id && e.a.side === null), `${x.name} espia ${id}`).toBe(true);
      }
    }
  }, 400_000);

  it('entra no meio da partida (rejoin): quem não joga recebe as partidas em andamento só para assistir', async () => {
    const edge = new EdgeSim('VIVO02');
    edges.push(edge);
    expect(edge.relay.init()).toBe(true);
    const a = new EdgeClient('Ana', HOST);
    const b = new EdgeClient('Bia', HOST);
    await a.connect(edge, { mode: 'create', nickname: 'Ana', settings: { turnMode: 'simultaneous', matchMode: 'live', matchSpeedMs: 120 } });
    await b.connect(edge, { mode: 'join', nickname: 'Bia' });
    await a.ok('room:pick-club', { clubId: 'palmeiras' });
    await b.ok('room:pick-club', { clubId: 'santos' });
    await a.ok('room:start', undefined, 120_000);
    await a.waitRoom((r) => r.phase === 'planning' && !!r.date);
    let started = false;
    for (let round = 0; round < 8 && !started; round++) {
      const date = a.room.date;
      const from = a.events.length;
      await Promise.all([a, b].map((m) => m.call('round:ready', { ready: true })));
      for (let i = 0; i < 400; i++) {
        if (a.events.slice(from).some((e) => e.ev === 'match:start')) {
          started = true;
          break;
        }
        if (a.room.phase === 'planning' && a.room.date !== date) break;
        await sleep(10);
      }
      if (!started) await a.waitRoom((r) => r.phase === 'planning' && r.date !== date, 120_000);
    }
    expect(started).toBe(true);
    // um espectador chega com a partida rolando
    const spec = new EdgeClient('Espia', HOST);
    await spec.connect(edge, { mode: 'join', nickname: 'Espia', spectator: true });
    const st = await spec.waitEvent('match:start', () => true, 10_000);
    expect(st.side).toBeNull();
    await spec.waitEvent('match:tick', (t) => t.matchId === st.matchId, 20_000);
  }, 400_000);
});
