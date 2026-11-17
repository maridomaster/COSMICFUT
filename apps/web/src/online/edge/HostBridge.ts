/**
 * Ponte entre o WebSocket do relay e o Web Worker do ANFITRIÃO DA SIMULAÇÃO (host.worker.ts), que roda a sala
 * autoritativa (mesma lógica do servidor Node) neste navegador. Criada quando o relay elege esta aba (`role`) e
 * encerrada quando a conexão cai ou a aba sai da sala.
 */
import type { RelayToHost } from '@cosmicfut/online-core/wire';

export interface HostStatus {
  state: 'loading' | 'ready' | 'error' | 'stopped';
  message?: string;
}

export interface HostBridgeOpts {
  /** quadro binário para o relay */
  send(frame: Uint8Array): void;
  /** backup a restaurar (sala criada a partir de arquivo) */
  restoreBytes: Uint8Array | null;
  onStatus(s: HostStatus): void;
}

export class HostBridge {
  private readonly worker: Worker;
  private stopped = false;

  constructor(opts: HostBridgeOpts) {
    this.worker = new Worker(new URL('./host.worker.ts', import.meta.url), { type: 'module', name: 'cosmicfut-anfitriao' });
    this.worker.onmessage = (e: MessageEvent<{ t: 'frame'; b: Uint8Array } | { t: 'status'; s: HostStatus }>) => {
      if (this.stopped) return;
      const m = e.data;
      if (m.t === 'frame') opts.send(m.b);
      else if (m.t === 'status') opts.onStatus(m.s);
    };
    this.worker.onerror = (e) => {
      console.error('[anfitrião] erro no worker', e.message);
      opts.onStatus({ state: 'error', message: 'O anfitrião da simulação falhou neste navegador.' });
    };
    this.worker.postMessage({ t: 'init', restore: opts.restoreBytes });
  }

  post(m: RelayToHost): void {
    if (!this.stopped) this.worker.postMessage({ t: 'msg', m });
  }

  postBinary(b: Uint8Array): void {
    if (!this.stopped) this.worker.postMessage({ t: 'bin', b }, [b.buffer]);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.postMessage({ t: 'stop' });
    // dá um instante para o último quadro sair; depois encerra o worker
    setTimeout(() => this.worker.terminate(), 200);
  }
}
