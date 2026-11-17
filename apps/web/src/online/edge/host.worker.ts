/**
 * Web Worker do ANFITRIÃO DA SIMULAÇÃO (modo online grátis). Roda o `HostRuntime` de @cosmicfut/online-core: a
 * mesma sala autoritativa do servidor Node (lobby, turnos, simultâneo, votações, partidas ao vivo, Liga dos Amigos,
 * Central de Empregos) com o simulador da carreira inline. Os dados vêm de `<BASE_URL>data/` como no modo solo:
 * os arquivos grandes são baixados no início (fetch) e os bundles de clube/nomes sob demanda (XHR síncrono — permitido
 * em workers; a carreira os pede de forma síncrona).
 *
 * Mensagens: main → worker {t:'init', restore} | {t:'msg', m: RelayToHost} | {t:'bin', b} | {t:'stop'}
 *            worker → main {t:'frame', b} (quadro para o relay) | {t:'status', s}
 */
import { CAREER_FILES, type CareerSource } from '@cosmicfut/online-core/career-data';
import { GameData } from '@cosmicfut/online-core/data';
import { CareerSimulator } from '@cosmicfut/online-core/sim-core';
import { InlineSimRunner } from '@cosmicfut/online-core/sim-runner';
import { HostRuntime } from '@cosmicfut/online-core/host';
import type { RelayToHost } from '@cosmicfut/online-core/wire';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
const url = (rel: string) => `${BASE}data/${rel.replace(/^\//, '')}`;

const cache = new Map<string, unknown>();
const source: CareerSource = {
  readJson<T>(rel: string): T | null {
    if (cache.has(rel)) return cache.get(rel) as T | null;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url(rel), false);
    xhr.send();
    let v: unknown = null;
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        v = JSON.parse(xhr.responseText);
      } catch {
        v = null;
      }
    }
    cache.set(rel, v);
    return v as T | null;
  },
};

async function preload(): Promise<void> {
  await Promise.all(
    CAREER_FILES.map(async (f) => {
      try {
        const r = await fetch(url(f));
        cache.set(f, r.ok ? await r.json() : null);
      } catch {
        /* tenta de novo (síncrono) quando precisar */
      }
    }),
  );
}

const post = (m: unknown, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

let runtime: HostRuntime | null = null;
let restore: Uint8Array | null = null;
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ t: 'init'; restore: Uint8Array | null } | { t: 'msg'; m: RelayToHost } | { t: 'bin'; b: Uint8Array } | { t: 'stop' }>) => {
  const d = e.data;
  if (d.t === 'init') {
    restore = d.restore;
    post({ t: 'status', s: { state: 'loading' } });
    chain = preload().then(() => {
      runtime = new HostRuntime({
        data: new GameData(source),
        sim: new InlineSimRunner(new CareerSimulator(source)),
        send: (frame) => post({ t: 'frame', b: frame }, [frame.buffer]),
        restoreBytes: async () => restore,
        log: (msg, extra) => console.info(`[anfitrião] ${msg}`, extra ?? ''),
        status: (s) => post({ t: 'status', s }),
      });
    });
    return;
  }
  if (d.t === 'stop') {
    chain = chain.then(() => runtime?.stop());
    return;
  }
  // mantém a ordem: o 'role' prepara a montagem do checkpoint antes dos pedaços binários
  chain = chain.then(() => {
    if (!runtime) return;
    if (d.t === 'msg') void runtime.handle(d.m);
    else void runtime.handle(d.b);
  });
};
