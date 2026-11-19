/**
 * Partida ao vivo no servidor (PvE ou PvP). Um MatchSimulation da engine, um tick a cada `speedMs`.
 * Intervalo e pausas combinadas viram um "portão": a partida fica parada até os humanos conectados
 * confirmarem (`match:resume`) ou até o timeout.
 */
import { MatchSimulation } from '@cosmicfut/engine';
import type { Fixture, MatchCommand, MatchConfig, MatchResult, Side } from '@cosmicfut/engine';
import type { LiveMatchInfo } from '@cosmicfut/shared';
import type { MatchPausePayload, MatchTickPayload } from './protocol.ts';
import { publicConfig } from './match-config.ts';

/** (19/11) disputa de pênaltis sempre devagar (uma cobrança a cada 1,5 s), mesmo na velocidade rápida — tem que ter emoção */
export const PENALTY_TICK_MS = 1500; // só nas velocidades reais (≥ 50 ms; os testes usam 1–20 ms)
/** (19/11) velocidade Normal: as finais nunca rodam mais rápido que isso (suspense) */
export const FINAL_MIN_TICK_MS = 400;

export interface LiveMatchHooks {
  tick(m: LiveMatch, t: MatchTickPayload): void;
  info(m: LiveMatch): void;
  pause(m: LiveMatch, p: MatchPausePayload): void;
  end(m: LiveMatch, result: MatchResult): void;
  /** humanos que estão de fato no controle (conectados, não-IA) desta partida */
  activeHumans(m: LiveMatch): string[];
}

export interface LiveMatchOptions {
  speedMs: number;
  halfTimeTimeoutMs: number;
  pauseTimeoutMs: number;
  /** (Atualização 38) pausas "de mudanças" por técnico e por tempo de jogo (padrão CHANGES_PAUSES_PER_HALF) */
  changesPerHalf?: number;
  /** (Atualização 38) duração máxima de uma pausa de mudanças (padrão `pauseTimeoutMs`) */
  changesPauseMs?: number;
  /** (19/11) final de competição: nunca mais rápida que a velocidade Normal */
  final?: boolean;
}

/**
 * (Atualização 38) Abrir o painel de mudanças (substituir/táticas) pausa o relógio compartilhado NA HORA, sem votação.
 * Contra abuso: cada técnico tem 2 pausas por tempo (1º, 2º, prorrogação), cada uma de no máximo `changesPauseMs`;
 * a pausa termina quando quem pediu fecha o painel (`match:resume`). O intervalo (45') já para a partida para todos.
 */
export const CHANGES_PAUSES_PER_HALF = 2;

interface Gate {
  reason: 'half-time' | 'requested' | 'changes';
  needed: Set<string>;
  resumeAt: number;
  timer: ReturnType<typeof setTimeout>;
  /** quem pediu (pausa de mudanças) */
  by?: string;
}

export class LiveMatch {
  readonly id: string;
  readonly fixture: Fixture;
  readonly config: MatchConfig;
  readonly sim: MatchSimulation;
  readonly homePlayerId: string | null;
  readonly awayPlayerId: string | null;
  speedMs: number;
  private readonly opts: LiveMatchOptions;
  private readonly hooks: LiveMatchHooks;
  private sent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gate: Gate | null = null;
  private readonly pauseVotes = new Set<string>();
  private lastInfoKey = '';
  finished = false;
  result: MatchResult | null = null;

  constructor(
    fixture: Fixture,
    config: MatchConfig,
    players: { home: string | null; away: string | null },
    opts: LiveMatchOptions,
    hooks: LiveMatchHooks,
  ) {
    this.id = fixture.id;
    this.fixture = fixture;
    this.config = config;
    this.sim = new MatchSimulation(config);
    this.homePlayerId = players.home;
    this.awayPlayerId = players.away;
    this.opts = opts;
    this.speedMs = this.clampSpeed(opts.speedMs);
    this.hooks = hooks;
  }

  /* ───────── consulta ───────── */

  sideOf(playerId: string): Side | null {
    if (playerId === this.homePlayerId) return 'home';
    if (playerId === this.awayPlayerId) return 'away';
    return null;
  }

  isPvP(): boolean {
    return !!this.homePlayerId && !!this.awayPlayerId;
  }

  status(): LiveMatchInfo['status'] {
    if (this.finished) return 'finished';
    const ph = this.sim.state.phase;
    if (ph === 'pre') return 'pending';
    if (ph === 'half-time') return 'half-time';
    return 'live';
  }

  info(): LiveMatchInfo {
    const s = this.sim.state;
    const f = this.fixture;
    const out: LiveMatchInfo = {
      matchId: this.id,
      homeClubId: f.homeId,
      awayClubId: f.awayId,
      homePlayerId: this.homePlayerId,
      awayPlayerId: this.awayPlayerId,
      status: this.status(),
      minute: s.minute,
      score: { ...s.score },
      competitionId: f.competitionId,
    };
    if (f.label) out.label = f.label;
    if (f.leg) out.leg = f.leg;
    if (this.config.knockout) out.knockout = true;
    if (this.config.aggregate) out.aggregateBefore = { ...this.config.aggregate };
    if (s.penaltyScore) out.penaltyScore = { ...s.penaltyScore };
    return out;
  }

  publicConfig(): unknown {
    return publicConfig(this.config);
  }

  pauseState(): MatchPausePayload | null {
    if (!this.gate) return null;
    const out: MatchPausePayload = { matchId: this.id, paused: true, reason: this.gate.reason, waitingFor: [...this.gate.needed], resumeAt: this.gate.resumeAt };
    if (this.gate.by) out.by = this.gate.by;
    out.changesLeft = this.changesLeft();
    return out;
  }

  /* ───────── ciclo ───────── */

  start(): void {
    this.started = true;
    this.hooks.info(this);
    this.schedule();
  }

  /** (pré-jogo) a partida só anda depois de start(); antes disso não aceita comandos nem pausa */
  started = false;

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.gate) clearTimeout(this.gate.timer);
    this.gate = null;
  }

  /** (19/11) final: no mínimo a velocidade Normal (só nas velocidades reais, ≥ 50 ms; os testes usam 1–20 ms) */
  private clampSpeed(ms: number): number {
    return this.opts.final && ms >= 50 ? Math.max(ms, FINAL_MIN_TICK_MS) : ms;
  }

  /** muda a velocidade no meio da partida (vale já no próximo minuto) */
  setSpeed(ms0: number): void {
    const ms = this.clampSpeed(ms0);
    if (ms === this.speedMs) return;
    this.speedMs = ms;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.schedule();
    }
  }

  private schedule(): void {
    if (!this.started || this.finished || this.gate || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, Math.max(0, this.sim.state.phase === 'penalties' && this.speedMs >= 50 ? Math.max(this.speedMs, PENALTY_TICK_MS) : this.speedMs));
  }

  private step(): void {
    if (this.finished || this.gate) return;
    const before = this.sim.state.phase;
    this.sim.tick();
    this.emitTick();
    if (this.sim.isFinished()) return this.finish();
    if (this.sim.state.phase === 'half-time' && before !== 'half-time') {
      if (this.openGate('half-time', this.opts.halfTimeTimeoutMs)) return;
    }
    this.schedule();
  }

  private emitTick(): void {
    const s = this.sim.state;
    const events = s.events.slice(this.sent);
    this.sent = s.events.length;
    const t: MatchTickPayload = {
      matchId: this.id,
      minute: s.minute,
      extra: s.extra,
      events,
      score: { ...s.score },
      momentum: s.momentum,
      stats: s.stats,
      phase: s.phase,
      players: s.players,
      tactic: s.tactic,
    };
    if (s.slots) t.slots = s.slots;
    if (s.penaltyScore) t.penaltyScore = { ...s.penaltyScore };
    this.hooks.tick(this, t);
    // resumo para a sala: só quando muda placar/status ou a cada 5 minutos
    const key = `${t.score.home}-${t.score.away}-${this.status()}`;
    if (key !== this.lastInfoKey || s.minute % 5 === 0) {
      this.lastInfoKey = key;
      this.hooks.info(this);
    }
  }

  private finish(): void {
    this.finished = true;
    this.stop();
    this.result = this.sim.result();
    this.hooks.info(this);
    this.hooks.end(this, this.result);
  }

  /* ───────── portão (intervalo / pausa) ───────── */

  /** Abre o portão; devolve false se não há humano ativo para esperar. `only`: espera só estes (pausa de mudanças). */
  private openGate(reason: Gate['reason'], timeoutMs: number, only?: string[]): boolean {
    const active = this.hooks.activeHumans(this);
    const needed = new Set(only ? active.filter((p) => only.includes(p)) : active);
    if (!needed.size) return false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const resumeAt = Date.now() + timeoutMs;
    this.gate = { reason, needed, resumeAt, timer: setTimeout(() => this.closeGate(), Math.max(0, timeoutMs)) };
    if (only?.length === 1) this.gate.by = only[0];
    this.hooks.pause(this, this.pauseState()!);
    this.hooks.info(this);
    return true;
  }

  private closeGate(): void {
    if (!this.gate) return;
    const reason = this.gate.reason;
    clearTimeout(this.gate.timer);
    this.gate = null;
    this.pauseVotes.clear();
    this.hooks.pause(this, { matchId: this.id, paused: false, reason, waitingFor: [], resumeAt: null });
    this.schedule();
  }

  /** Recalcula quem o portão espera (alguém caiu/virou IA). */
  refreshGate(): void {
    if (!this.gate) return;
    const active = new Set(this.hooks.activeHumans(this));
    for (const p of [...this.gate.needed]) if (!active.has(p)) this.gate.needed.delete(p);
    if (!this.gate.needed.size) this.closeGate();
    else this.hooks.pause(this, this.pauseState()!);
  }

  resume(playerId: string): string | null {
    if (!this.sideOf(playerId)) return 'Você não está nesta partida.';
    if (!this.gate) return null; // idempotente
    this.gate.needed.delete(playerId);
    if (!this.gate.needed.size) this.closeGate();
    else this.hooks.pause(this, this.pauseState()!);
    return null;
  }

  /** Pausa combinada: só para quando TODOS os humanos ativos da partida pedem. */
  requestPause(playerId: string): string | null {
    if (!this.sideOf(playerId)) return 'Você não está nesta partida.';
    if (this.finished) return 'A partida já terminou.';
    if (!this.started) return 'A partida ainda não começou.';
    if (this.gate) return null;
    const ph = this.sim.state.phase;
    if (ph === 'penalties') return 'Não é possível pausar nos pênaltis.';
    this.pauseVotes.add(playerId);
    const active = this.hooks.activeHumans(this);
    if (active.every((p) => this.pauseVotes.has(p))) this.openGate('requested', this.opts.pauseTimeoutMs);
    return null;
  }

  /* ───────── (Atualização 38) pausa de mudanças ───────── */

  private readonly changesUsed = new Map<string, number>();

  /** Tempo de jogo atual para a cota de pausas: 1 (pré/1º tempo), 2 (intervalo/2º tempo), 3 (prorrogação). */
  private halfKey(): number {
    const ph = this.sim.state.phase;
    return ph === 'pre' || ph === 'first-half' ? 1 : ph === 'extra-time' ? 3 : 2;
  }

  /** Pausas de mudanças restantes neste tempo, por técnico humano da partida. */
  changesLeft(): Record<string, number> {
    const lim = this.opts.changesPerHalf ?? CHANGES_PAUSES_PER_HALF;
    const out: Record<string, number> = {};
    for (const id of [this.homePlayerId, this.awayPlayerId]) if (id) out[id] = Math.max(0, lim - (this.changesUsed.get(`${id}:${this.halfKey()}`) ?? 0));
    return out;
  }

  /**
   * Abriu o painel de mudanças: pausa na hora (portão 'changes' que espera só quem pediu). Já parada (pausa combinada
   * ou mudanças do adversário): entra na espera sem gastar cota; no intervalo o portão já espera todos.
   * Sem cota: erro (a partida segue).
   */
  requestChangesPause(playerId: string): string | null {
    if (!this.sideOf(playerId)) return 'Você não está nesta partida.';
    if (this.finished) return 'A partida já terminou.';
    if (!this.started) return 'A partida ainda não começou.';
    if (this.sim.state.phase === 'penalties') return 'Não é possível pausar nos pênaltis.';
    if (this.gate) {
      if (this.gate.reason !== 'half-time' && !this.gate.needed.has(playerId)) {
        this.gate.needed.add(playerId);
        this.hooks.pause(this, this.pauseState()!);
      }
      return null;
    }
    const key = `${playerId}:${this.halfKey()}`;
    const used = this.changesUsed.get(key) ?? 0;
    const lim = this.opts.changesPerHalf ?? CHANGES_PAUSES_PER_HALF;
    if (used >= lim) return `Limite de ${lim} pausas para mudanças neste tempo — a partida segue enquanto você mexe no time.`;
    this.changesUsed.set(key, used + 1);
    if (!this.openGate('changes', this.opts.changesPauseMs ?? this.opts.pauseTimeoutMs, [playerId])) {
      this.changesUsed.set(key, used);
      return 'Não foi possível pausar agora.';
    }
    return null;
  }

  /** (17/11) Pausa votada pela sala: para já (se há humano ativo para retomar). */
  forcePause(timeoutMs: number): boolean {
    if (this.finished || !this.started || this.gate || this.sim.state.phase === 'penalties') return false;
    return this.openGate('requested', timeoutMs);
  }

  /* ───────── comandos ───────── */

  setControl(side: Side, control: 'human' | 'ai'): void {
    // MatchSimulation guarda a referência de config.home/away: a IA do técnico passa a agir no minuto seguinte.
    this.config[side].control = control;
  }

  command(playerId: string, cmd: MatchCommand): string | null {
    const side = this.sideOf(playerId);
    if (!side) return 'Você não está nesta partida.';
    if (this.finished) return 'A partida já terminou.';
    if (!this.started) return 'A partida ainda não começou.';
    if (cmd.side !== side) return 'Lado inválido.';
    const err = this.sim.apply(cmd);
    if (!err) this.emitTick(); // eventos do comando (substituição/tática) saem na hora
    return err;
  }
}
