/**
 * Opções da SALA (as que a lógica autoritativa usa). O servidor Node estende com porta, CORS, pastas etc.
 * (`apps/server/src/config.ts`); o anfitrião no navegador usa só estas.
 */
export interface RoomOptions {
  /** jogador desconectado vira IA depois disso */
  disconnectGraceMs: number;
  /** quem cai/recarrega a página: a rodada ESPERA por ele até isto (limitado a disconnectGraceMs) */
  planningGraceMs: number;
  /** pré-jogo online: o match:preview chega isto antes do match:start (0 = sem pré-jogo) */
  preMatchMs: number;
  /** intervalo: espera os humanos confirmarem até este timeout */
  halfTimeTimeoutMs: number;
  /** pausa combinada (match:pause-request) dura no máximo isto */
  pauseTimeoutMs: number;
  maxPlayers: number;
  /** fim de temporada: espera as renovações dos humanos até este timeout */
  seasonEndTimeoutMs: number;
  /** habilita 'dev:advance' */
  devCommands: boolean;
  /** temporada inicial da carreira */
  startSeason: number;
  /** seed da temporada (testes fixam; padrão aleatório) */
  seedFor?: (code: string) => string;
  /** (testes) tempo máximo da vez de um técnico desempregado (padrão 90 s) */
  joblessTurnMs?: number;
  /** (testes) tempos do lobby/rodada */
  pickMs?: number;
  voteMs?: number;
  countdownMs?: number;
  timerMs?: number;
  skipOfferPct?: number;
  /** (testes) configurações iniciais das salas novas */
  roomDefaults?: Record<string, unknown>;
}

export function defaultRoomOptions(over: Partial<RoomOptions> = {}): RoomOptions {
  return {
    disconnectGraceMs: 60_000,
    planningGraceMs: 20_000,
    preMatchMs: 8_000,
    halfTimeTimeoutMs: 30_000,
    pauseTimeoutMs: 60_000,
    seasonEndTimeoutMs: 180_000,
    devCommands: false,
    startSeason: 2026,
    ...over,
    // até 6 técnicos: padrão E limite
    maxPlayers: Math.max(1, Math.min(6, over.maxPlayers ?? 6)),
  };
}
