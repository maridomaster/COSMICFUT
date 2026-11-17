/**
 * Registro global das "Salas abertas" (lógica pura). Um único Durable Object (`Registry`, nome "global") guarda as
 * salas públicas que estão no lobby — cada sala avisa quando entra ou sai da lista (só no lobby: poucas
 * requisições). Entradas velhas (sala que caiu sem avisar) somem depois de 6 h.
 */
import type { RelayStorage } from './relay.ts';

export interface PublicRoom {
  code: string;
  host: string;
  hostClubId: string | null;
  players: number;
  maxPlayers: number;
  preset: string;
  turnMode: string;
  pickMode: string;
  createdAt: number;
}

const STALE_MS = 6 * 3600_000;
const CODE_RE = /^[A-Z0-9]{6}$/;

export class RoomRegistry {
  private readonly st: RelayStorage;
  private readonly now: () => number;

  constructor(st: RelayStorage, now: () => number) {
    this.st = st;
    this.now = now;
  }

  put(code: string, info: unknown): void {
    if (!CODE_RE.test(code)) return;
    if (!info || typeof info !== 'object') {
      this.st.del(`r:${code}`);
      return;
    }
    const i = info as Record<string, unknown>;
    const s = (v: unknown, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const room: PublicRoom = {
      code, host: s(i.host, 20), hostClubId: typeof i.hostClubId === 'string' ? s(i.hostClubId, 64) : null, players: n(i.players), maxPlayers: n(i.maxPlayers),
      preset: s(i.preset), turnMode: s(i.turnMode), pickMode: s(i.pickMode), createdAt: n(i.createdAt),
    };
    this.st.put(`r:${code}`, JSON.stringify({ room, at: this.now() }));
  }

  list(): PublicRoom[] {
    const now = this.now();
    const out: PublicRoom[] = [];
    for (const k of this.st.keys('r:')) {
      try {
        const e = JSON.parse(this.st.get(k) ?? 'null') as { room: PublicRoom; at: number } | null;
        if (!e || now - e.at > STALE_MS) {
          this.st.del(k);
          continue;
        }
        out.push(e.room);
      } catch {
        this.st.del(k);
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }
}
