/**
 * Persistência opcional: um snapshot JSON por sala em `<dir>/<CODE>.json` (v2: metadados + carreira em
 * JSON+gzip/base64 — world e state ficam ~0,5–1 MB no disco em vez de 4–7 MB).
 * Escritas com debounce e troca atômica (tmp + rename). Partidas em andamento não são salvas —
 * ao reiniciar, a sala volta ao planejamento da mesma rodada (engine determinística).
 *
 * (Carreira online salva) Ao lado de cada snapshot vai um `<CODE>.meta.json` pequeno (fase, data, técnicos, hash dos
 * tokens, última atividade) — a lista "Minhas carreiras online" (POST /careers/status) consulta salas que não estão na
 * memória sem abrir o arquivo grande. O diretório (PERSIST_DIR) precisa estar num volume persistente.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoomPhase } from '@cosmicfut/shared';
import type { LegacyRoomSnapshot, RoomSnapshot } from './room.ts';

const CODE_FILE = /^[A-Z0-9]{6}\.json$/;
const CODE_RE = /^[A-Z0-9]{6}$/;

export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Resumo de uma sala salva (sem tokens; só o hash deles). */
export interface RoomMeta {
  code: string;
  phase: RoomPhase;
  season: number | null;
  date: string | null;
  savedAt: number;
  lastActivity: number;
  hostId: string;
  players: { id: string; nickname: string; clubId: string | null; color?: string; spectator?: boolean; tokenHash: string; lastSeen: number | null }[];
}

export function metaOf(s: RoomSnapshot): RoomMeta {
  return {
    code: s.code, phase: s.phase, season: s.career?.season ?? null, date: s.career?.date ?? null, savedAt: s.savedAt,
    lastActivity: s.lastActivity ?? s.savedAt, hostId: s.hostId,
    players: s.players.map((p) => ({
      id: p.id, nickname: p.nickname, clubId: p.clubId, ...(p.color ? { color: p.color } : {}), ...(p.spectator ? { spectator: true } : {}),
      tokenHash: tokenHash(p.token), lastSeen: p.lastSeen ?? null,
    })),
  };
}

export class PersistStore {
  readonly dir: string;
  private readonly pending = new Map<string, () => RoomSnapshot>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delayMs: number;

  constructor(dir: string, delayMs = 400) {
    this.dir = dir;
    this.delayMs = delayMs;
    mkdirSync(dir, { recursive: true });
  }

  private file(code: string): string {
    return join(this.dir, `${code}.json`);
  }

  private metaFile(code: string): string {
    return join(this.dir, `${code}.meta.json`);
  }

  /** Lê os snapshots (v2 = carreira; v1 = formato antigo, convertido pela sala). Corrompidos são descartados com log. */
  loadAll(log: (msg: string, extra?: Record<string, unknown>) => void = () => undefined): (RoomSnapshot | LegacyRoomSnapshot)[] {
    const out: (RoomSnapshot | LegacyRoomSnapshot)[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!CODE_FILE.test(f)) continue;
      const s = this.read(f.slice(0, 6), log);
      if (s) out.push(s);
    }
    return out;
  }

  /** Um snapshot do disco (null se não existe/corrompido). */
  read(code: string, log: (msg: string, extra?: Record<string, unknown>) => void = () => undefined): RoomSnapshot | LegacyRoomSnapshot | null {
    if (!CODE_RE.test(code)) return null;
    const f = this.file(code);
    if (!existsSync(f)) return null;
    try {
      const s = JSON.parse(readFileSync(f, 'utf8')) as RoomSnapshot | LegacyRoomSnapshot;
      if (s && (s.v === 1 || s.v === 2) && typeof s.code === 'string' && Array.isArray(s.players)) return s;
      log('snapshot descartado (formato desconhecido)', { file: f });
    } catch (e) {
      log('snapshot descartado (corrompido)', { file: f, error: String(e) });
    }
    return null;
  }

  /** Códigos das salas no disco. */
  loadCodes(): string[] {
    try {
      return readdirSync(this.dir).filter((f) => CODE_FILE.test(f)).map((f) => f.slice(0, 6));
    } catch {
      return [];
    }
  }

  has(code: string): boolean {
    return CODE_RE.test(code) && existsSync(this.file(code));
  }

  /** Resumo salvo (ou montado do snapshot, para arquivos antigos sem .meta.json). */
  readMeta(code: string): RoomMeta | null {
    if (!CODE_RE.test(code)) return null;
    try {
      const m = JSON.parse(readFileSync(this.metaFile(code), 'utf8')) as RoomMeta;
      if (m && m.code === code && Array.isArray(m.players)) return m;
    } catch {
      /* sem meta: tenta o snapshot */
    }
    const s = this.read(code);
    if (!s || s.v !== 2) return null;
    const m = metaOf(s);
    try {
      writeFileSync(this.metaFile(code), JSON.stringify(m));
    } catch {
      /* ignora */
    }
    return m;
  }

  schedule(code: string, snap: () => RoomSnapshot): void {
    this.pending.set(code, snap);
    if (this.timers.has(code)) return;
    this.timers.set(
      code,
      setTimeout(() => {
        this.timers.delete(code);
        const fn = this.pending.get(code);
        this.pending.delete(code);
        if (fn) void this.write(code, fn());
      }, this.delayMs),
    );
  }

  private async write(code: string, snap: RoomSnapshot): Promise<void> {
    const file = this.file(code);
    const tmp = `${file}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(snap));
      await rename(tmp, file);
      await writeFile(`${this.metaFile(code)}.tmp`, JSON.stringify(metaOf(snap)));
      await rename(`${this.metaFile(code)}.tmp`, this.metaFile(code));
    } catch {
      // disco indisponível: a sala segue em memória
    }
  }

  /** Grava agora (síncrono): descarregar a sala da memória. */
  writeNow(code: string, snap: RoomSnapshot): void {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
    this.pending.delete(code);
    const file = this.file(code);
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(snap));
      renameSync(`${file}.tmp`, file);
      writeFileSync(this.metaFile(code), JSON.stringify(metaOf(snap)));
    } catch {
      /* ignora */
    }
  }

  remove(code: string): void {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
    this.pending.delete(code);
    rmSync(this.file(code), { force: true });
    rmSync(this.metaFile(code), { force: true });
  }

  /** Grava tudo que está pendente (síncrono) — usado no desligamento. */
  flush(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const [code, fn] of this.pending) {
      const file = this.file(code);
      try {
        const snap = fn();
        writeFileSync(`${file}.tmp`, JSON.stringify(snap));
        renameSync(`${file}.tmp`, file);
        writeFileSync(this.metaFile(code), JSON.stringify(metaOf(snap)));
      } catch {
        // ignora
      }
    }
    this.pending.clear();
  }
}
