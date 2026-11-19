/**
 * Quantos checkpoints o anfitrião manda num planejamento movimentado (cada um custa linhas gravadas no SQLite do
 * Durable Object; o plano Free permite 100 mil por dia). Tempo em escala 1:20: 150 ms aqui = 3 s de verdade.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CKPT_DELAY_MS, CKPT_FAST_MS } from '../src/host.ts';
import { EdgeClient, EdgeSim, sleep, type HostOpts } from './harness.ts';

const SCALE = 20;
const edges: EdgeSim[] = [];
afterEach(() => {
  for (const e of edges.splice(0)) e.stop();
});

async function planning(cfg: HostOpts, formations: string[]) {
  const edge = new EdgeSim(`CKB${edges.length}`);
  edges.push(edge);
  edge.relay.init();
  const cs = [new EdgeClient('Ana', cfg), new EdgeClient('Bia', cfg)];
  await cs[0].connect(edge, { mode: 'create', nickname: 'Ana', settings: { turnMode: 'simultaneous' } });
  await cs[1].connect(edge, { mode: 'join', nickname: 'Bia' });
  await cs[0].ok('room:pick-club', { clubId: 'palmeiras' });
  await cs[1].ok('room:pick-club', { clubId: 'santos' });
  await cs[0].ok('room:start', undefined, 120_000);
  await Promise.all(cs.map((c) => c.waitRoom((r) => r.phase === 'planning' && !!r.date)));
  await sleep(300);
  const host = cs[0].host!;
  const c0 = host.stats.ckpts;
  const s0 = host.stats.ckptSkipped;
  const w0 = edge.storage.rowsWritten;
  // 2 minutos "reais" de planejamento: uma mudança de escalação/tática a cada 3 s
  const actions = 40;
  for (let k = 0; k < actions; k++) {
    await cs[1].ok('round:set-lineup', { tactic: { formation: formations[k % formations.length], mentality: 'balanced', tempo: 'normal', pressing: 'medium', passing: 'mixed' }, lineup: null });
    await sleep(3000 / SCALE);
  }
  await sleep((cfg.ckptDelayMs ?? 0) + 200);
  return { ckpts: host.stats.ckpts - c0, skipped: host.stats.ckptSkipped - s0, rows: edge.storage.rowsWritten - w0, actions };
}

describe('checkpoints no planejamento', () => {
  it('antes (1,5 s) x agora (20 s no mesmo dia; estado igual não é regravado)', async () => {
    const before = await planning({ ckptDelayMs: 1500 / SCALE, ckptFastMs: 1500 / SCALE }, ['4-4-2', '4-3-3']);
    const after = await planning({ ckptDelayMs: CKPT_DELAY_MS / SCALE, ckptFastMs: CKPT_FAST_MS / SCALE }, ['4-4-2', '4-3-3']);
    const same = await planning({ ckptDelayMs: CKPT_DELAY_MS / SCALE, ckptFastMs: CKPT_FAST_MS / SCALE }, ['4-4-2']);
    console.log(
      `[ckpt] ${before.actions} mudanças em 2 min: antes ${before.ckpts} checkpoints (${before.rows} linhas) · ` +
        `agora ${after.ckpts} (${after.rows} linhas) · mesma escalação reenviada: ${same.ckpts} (${same.skipped} pulados)`,
    );
    expect(before.ckpts).toBeGreaterThanOrEqual(30);
    expect(after.ckpts).toBeLessThanOrEqual(8);
    expect(same.ckpts).toBeLessThanOrEqual(2);
  }, 180_000);
});
