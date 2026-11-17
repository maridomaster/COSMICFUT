import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

/** min(4, núcleos − 1), no mínimo 1 */
export const defaultWorkerCount = (): number => Math.max(1, Math.min(4, availableParallelism() - 1));

const here = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  port: number;
  host: string;
  /** origens liberadas no CORS (HTTP e Socket.io); '*' libera tudo */
  corsOrigins: string[] | '*';
  /** pasta com os JSON do jogo (clubs-index, clubs/, leagues, calendars…) */
  dataDir: string;
  /** build do front (apps/web/dist) servido pelo próprio servidor; null/inexistente desliga */
  webDist: string | null;
  /** pasta dos snapshots das salas; null desliga a persistência */
  persistDir: string | null;
  /**
   * sala AINDA NO LOBBY e vazia (ninguém conectado) é apagada depois disso (padrão 6 h). (Carreira online salva) sala
   * com a temporada iniciada NUNCA expira: só o host a encerra.
   */
  roomTtlMs: number;
  /** (carreira online salva) carreira vazia sai da memória depois disso (fica no disco; volta ao abrir o código) */
  unloadAfterMs: number;
  /** (carreira online salva) tamanho máximo do arquivo de backup enviado em POST /rooms/restore */
  maxBackupBytes: number;
  /** (testes) tempo máximo da vez de um técnico desempregado (padrão 90 s) */
  joblessTurnMs?: number;
  /** jogador desconectado vira IA depois disso */
  disconnectGraceMs: number;
  /**
   * (13/11) quem cai/recarrega a página: a rodada ESPERA por ele até isto (limitado a disconnectGraceMs) antes de
   * avançar sem ele (antes avançava na hora e quem recarregava no planejamento perdia a partida ao vivo)
   */
  planningGraceMs: number;
  /** (13/11) pré-jogo online: o match:preview chega isto antes do match:start (0 = sem pré-jogo) */
  preMatchMs: number;
  /** intervalo: espera os humanos confirmarem até este timeout */
  halfTimeTimeoutMs: number;
  /** pausa combinada (match:pause-request) dura no máximo isto */
  pauseTimeoutMs: number;
  maxPlayers: number;
  /** varredura de salas expiradas */
  sweepIntervalMs: number;
  /** fim de temporada: espera as renovações dos humanos até este timeout (depois roda a virada) */
  seasonEndTimeoutMs: number;
  /** worker_threads de simulação (0 = inline no thread principal) */
  simWorkers: number;
  /** habilita 'dev:advance' (avanço rápido do host, para testes/desenvolvimento) */
  devCommands: boolean;
  /** temporada inicial da carreira */
  startSeason: number;
  /** seed da temporada (testes fixam; padrão aleatório) */
  seedFor?: (code: string) => string;
  logger: boolean;
  /** (17/11) URL pública fixa (env PUBLIC_URL); senão lida de publicUrlFile a cada GET /public-url */
  publicUrl: string | null;
  /** arquivo escrito pelo lançador do túnel (uma linha https://...) */
  publicUrlFile: string | null;
  /** (testes) tempos do lobby/rodada: escolha do draft (45 s), votação (30 s), contagem 3-2-1 (3 s) */
  pickMs?: number;
  voteMs?: number;
  countdownMs?: number;
  /** (testes) cronômetro em ms no lugar de settings.timerSec × 1000 */
  timerMs?: number;
  /** (testes) salto votado: % do valor que faz uma proposta parar o salto (padrão 120) */
  skipOfferPct?: number;
  /** (testes) configurações iniciais das salas novas (ex.: turnMode 'simultaneous' nos testes antigos) */
  roomDefaults?: Record<string, unknown>;
}

export const DEFAULT_DATA_DIR = resolve(here, '../../web/public/data');
export const DEFAULT_WEB_DIST = resolve(here, '../../web/dist');
export const DEFAULT_PERSIST_DIR = resolve(here, '../.data');
/** (17/11) escrito por scripts/online.ps1 (túnel Cloudflare): <raiz>/.data/public-url.txt */
export const DEFAULT_PUBLIC_URL_FILE = resolve(here, '../../../.data/public-url.txt');

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
}

export function defaultOptions(over: Partial<ServerOptions> = {}): ServerOptions {
  return {
    port: 8787,
    host: '0.0.0.0',
    corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    dataDir: DEFAULT_DATA_DIR,
    webDist: DEFAULT_WEB_DIST,
    persistDir: null,
    roomTtlMs: 6 * 3600_000,
    unloadAfterMs: 10 * 60_000,
    maxBackupBytes: 30 * 1024 * 1024,
    disconnectGraceMs: 60_000,
    planningGraceMs: 20_000,
    preMatchMs: 8_000,
    halfTimeTimeoutMs: 30_000,
    pauseTimeoutMs: 60_000,
    sweepIntervalMs: 60_000,
    seasonEndTimeoutMs: 180_000,
    simWorkers: defaultWorkerCount(),
    devCommands: false,
    startSeason: 2026,
    logger: false,
    publicUrl: null,
    publicUrlFile: DEFAULT_PUBLIC_URL_FILE,
    ...over,
    // (17/11) até 6 técnicos: padrão E limite
    maxPlayers: Math.max(1, Math.min(6, over.maxPlayers ?? 6)),
  };
}

/** Opções a partir das variáveis de ambiente (ver README). */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): ServerOptions {
  const cors = (env.CORS_ORIGINS ?? '').trim();
  const persist = (env.PERSIST_DIR ?? '').trim();
  return defaultOptions({
    port: num(env.PORT, 8787),
    host: env.HOST || '0.0.0.0',
    corsOrigins: cors === '*' ? '*' : cors ? cors.split(',').map((s) => s.trim()).filter(Boolean) : defaultOptions().corsOrigins,
    dataDir: env.DATA_DIR ? resolve(env.DATA_DIR) : DEFAULT_DATA_DIR,
    webDist: env.WEB_DIST === undefined || env.WEB_DIST.trim() === '' ? DEFAULT_WEB_DIST : env.WEB_DIST.trim() === 'off' ? null : resolve(env.WEB_DIST),
    persistDir: env.PERSIST === '0' || persist === 'off' ? null : persist ? resolve(persist) : DEFAULT_PERSIST_DIR,
    // LOBBY_TTL_MS (novo nome) ou ROOM_TTL_MS (antigo): só salas no lobby expiram
    roomTtlMs: num(env.LOBBY_TTL_MS ?? env.ROOM_TTL_MS, 6 * 3600_000),
    unloadAfterMs: num(env.ROOM_UNLOAD_MS, 10 * 60_000),
    maxBackupBytes: Math.round(num(env.MAX_BACKUP_MB, 30) * 1024 * 1024),
    publicUrlFile: env.PUBLIC_URL_FILE?.trim() ? resolve(env.PUBLIC_URL_FILE.trim()) : DEFAULT_PUBLIC_URL_FILE,
    disconnectGraceMs: num(env.DISCONNECT_GRACE_MS, 60_000),
    planningGraceMs: num(env.PLANNING_GRACE_MS, 20_000),
    preMatchMs: num(env.PREMATCH_MS, 8_000),
    halfTimeTimeoutMs: num(env.HALF_TIME_TIMEOUT_MS, 30_000),
    pauseTimeoutMs: num(env.PAUSE_TIMEOUT_MS, 60_000),
    seasonEndTimeoutMs: num(env.SEASON_END_TIMEOUT_MS, 180_000),
    simWorkers: num(env.SIM_WORKERS, defaultWorkerCount()),
    devCommands: env.DEV_COMMANDS === '1',
    logger: env.LOG !== '0',
    publicUrl: env.PUBLIC_URL?.trim() || null,
  });
}

