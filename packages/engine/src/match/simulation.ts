/**
 * Motor de partida minuto a minuto.
 * Determinístico: tudo que afeta o resultado usa `rng` (seed da config). A narração usa
 * um RNG separado (`txt`), então quickSimulate (sem narração) e a partida ao vivo
 * produzem exatamente o mesmo resultado para a mesma seed e os mesmos comandos.
 */
import type { Player } from '@cosmicfut/shared';
import type {
  FormationSlot, LivePlayerState, MatchCommand, MatchConfig, MatchEvent, MatchEventType,
  MatchResult, MatchSimulationApi, MatchState, MatchTeamInput, Mentality, Side, Tactic, TeamLiveStats,
} from '../contract';
import { Rng } from '../rng';
import { isAttacking, isDefensive, matchOverall, STARS, starTier } from '../stars';
import { autoPickLineup, FORMATIONS, formationSlotsRef, slotFit } from '../tactics';
import {
  ASSIST_W, COEF, FOUL_W, HEAD_W, MENT_ATT, MENT_OPP, MENT_POSS, MENTALITIES, MENTALITY_IDX, NORM,
  PASS_ATT, PASS_BIG, PASS_OFFSIDE, PASS_POSS, PASS_VOLUME, PRESS_DRAIN, PRESS_FOUL, PRESS_OPP,
  PRESS_POSS, ROLE_W, SHOOT_W, STAMINA, staminaFactor, TEMPO_ATT, TEMPO_DRAIN, TEMPO_OPP, TEMPO_POSS,
} from './model';
import { describeTacticChange, narrate, type NarrationKey, type NarrationVars } from './narration';
import { shapeBalance, shapeSlots } from './shape';

export interface MatchSimOptions {
  /** gera texto de narração (padrão true). quickSimulate usa false. */
  narrate?: boolean;
}

interface PInfo {
  p: Player;
  tDef: number; tMid: number; tAtt: number;
  fin: number; head: number; pass: number; cross: number;
  gkBonus: number; penSave: number; drain: number;
  /** (Estrelas) bônus de conversão (meio/ataque), multiplicador de cartões e bônus de nota (defesa) */
  goal: number; cardMul: number; ratingBonus: number;
}

interface Team {
  side: Side;
  input: MatchTeamInput;
  name: string;
  info: Map<string, PInfo>;
  live: LivePlayerState[];
  liveById: Map<string, LivePlayerState>;
  onPitch: LivePlayerState[];
  slots: readonly FormationSlot[];
  stats: TeamLiveStats;
  tactic: Tactic;
  baseMentality: Mentality;
  morale: number;
  benchIds: Set<string>;
  usedSubs: Set<string>; // quem já saiu (não volta)
  penaltyTakerId?: string;
  // força do minuto
  def: number; mid: number; att: number; gk: number;
  gkId: string | null;
  possMinutes: number;
  passAcc: number;
  lastAiSub: number;
  appeared: Set<string>;
}

interface Period { phase: 'first-half' | 'second-half' | 'extra-time'; start: number; len: number }
const PERIODS: Period[] = [
  { phase: 'first-half', start: 0, len: 45 },
  { phase: 'second-half', start: 45, len: 45 },
  { phase: 'extra-time', start: 90, len: 15 },
  { phase: 'extra-time', start: 105, len: 15 },
];

function emptyStats(): TeamLiveStats {
  return {
    goals: 0, shots: 0, shotsOnTarget: 0, possession: 50, corners: 0, fouls: 0, yellows: 0, reds: 0,
    offsides: 0, xg: 0, passesCompleted: 0, subsUsed: 0,
  };
}

function pinfo(pBase: Player, honor?: { overall: number; drain: number }): PInfo {
  // (19/11) ícone da Bola de Ouro/Prata: overall a mais na partida (antes das estrelas) e menos cansaço
  const p0 = honor ? { ...pBase, overall: Math.min(99, pBase.overall + honor.overall) } : pBase;
  // (Estrelas) Top Mundial / Destaque: status +10% / +5% na partida (overall efetivo)
  const tier = starTier(p0);
  const p = tier ? { ...p0, overall: matchOverall(p0) } : p0;
  const def = !!tier && isDefensive(p0.position);
  const t = new Set(p.traits);
  const has = (id: number) => (t.has(id) ? 1 : 0);
  return {
    p,
    tDef: 0.04 * has(7) + 0.04 * has(10) + 0.015 * has(5),
    tMid: 0.04 * has(11) + 0.04 * has(4) + 0.01 * has(12),
    tAtt: 0.03 * has(13) + 0.03 * has(8) + 0.02 * has(6) + 0.015 * has(9),
    fin: 0.12 * has(9),
    head: 0.18 * has(5),
    pass: has(11) + has(4),
    cross: has(6),
    gkBonus: 0.04 * has(2) + 0.03 * has(0) + 0.02 * has(3),
    penSave: has(1),
    drain: (t.has(12) ? 0.75 : 1) * (p.age >= 32 ? STAMINA.veteranDrain : p.age <= 22 ? STAMINA.youngDrain : 1) * (def ? STARS.drain[tier!] : 1) * (honor?.drain ?? 1),
    goal: tier && isAttacking(p0.position) ? STARS.goal[tier] : 0,
    cardMul: def ? STARS.cards[tier!] : 1,
    ratingBonus: def ? STARS.rating[tier!] : 0,
  };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const VALID_TEMPO = ['slow', 'normal', 'fast'];
const VALID_PRESS = ['low', 'medium', 'high'];
const VALID_PASS = ['short', 'mixed', 'direct'];

export class MatchSimulation implements MatchSimulationApi {
  readonly state: MatchState;
  private readonly cfg: MatchConfig;
  private readonly rng: Rng;
  private readonly txt: Rng;
  private readonly narrateOn: boolean;
  private readonly maxSubs: number;
  private readonly teams: { home: Team; away: Team };
  private periodIdx = 0;
  private elapsed = 0;
  private added = -1;
  private periodEventCount = 0;
  private returnedIdx = 0;
  private shootout: { kicks: { home: number; away: number }; order: { home: string[]; away: string[] } } | null = null;
  private finalized = false;
  private readonly scorers: MatchResult['scorers'] = [];
  private readonly cards: MatchResult['cards'] = [];
  private readonly injuries: MatchResult['injuries'] = [];
  private readonly attendance: number;
  private readonly ticketDemand: number | undefined;
  private wentExtra = false;

  constructor(config: MatchConfig, opts: MatchSimOptions = {}) {
    this.cfg = config;
    this.rng = new Rng(config.seed);
    this.txt = new Rng(config.seed + ':txt');
    this.narrateOn = opts.narrate !== false;
    this.maxSubs = config.maxSubs ?? 5;
    const home = this.buildTeam('home', config.home);
    const away = this.buildTeam('away', config.away);
    this.teams = { home, away };
    this.state = {
      minute: 0,
      extra: 0,
      phase: 'pre',
      score: { home: 0, away: 0 },
      stats: { home: home.stats, away: away.stats },
      players: { home: home.live, away: away.live },
      tactic: { home: home.tactic, away: away.tactic },
      // (Atualização 38) posições vigentes (formação personalizada / set-shape) para a UI desenhar o campo
      slots: { home: home.slots, away: away.slots },
      momentum: 0,
      events: [],
    };
    // público (RNG próprio para não alterar a sequência da partida)
    const ar = new Rng(config.seed + ':att');
    const cap = config.home.stadiumCapacity ?? 30000;
    const fill = clamp(
      0.42 + 0.08 * (config.home.reputation ?? 2.5) + 0.03 * (config.away.reputation ?? 2.5)
        + ((config.home.morale ?? 50) - 50) * 0.003 + ar.range(-0.06, 0.06),
      0.12, 1,
    );
    const base = Math.round(cap * fill);
    // (13/11) preço do ingresso do mandante: público pagante (mesma conta de finance.ts/ticketSales)
    const k = config.home.ticketDemand;
    const exact = config.home.attendance;
    if (exact !== undefined && Number.isFinite(exact) && exact >= 0) {
      // (Etapa 4) bilheteria da economia (matchGate): o mesmo público da renda e da notícia
      this.ticketDemand = k;
      this.attendance = Math.round(exact);
    } else if (k !== undefined && Number.isFinite(k) && k > 0) {
      this.ticketDemand = k;
      this.attendance = Math.round(Math.min(cap, base * k));
    } else this.attendance = base;
  }

  /* ───────────── setup ───────────── */

  private buildTeam(side: Side, input: MatchTeamInput): Team {
    const byId = new Map(input.players.map((p) => [p.id, p]));
    let lineup = input.lineup;
    const valid =
      lineup && lineup.starters.length === 11 &&
      new Set(lineup.starters).size === 11 && lineup.starters.every((id) => byId.has(id));
    if (!valid) lineup = autoPickLineup(input.players, input.tactic);
    const tactic: Tactic = { ...input.tactic };
    if (!FORMATIONS.includes(tactic.formation)) tactic.formation = '4-4-2';
    const info = new Map<string, PInfo>();
    const live: LivePlayerState[] = [];
    const benchIds = new Set<string>();
    const fit = input.fitness ?? {};
    lineup.starters.forEach((id, i) => {
      const p = byId.get(id)!;
      info.set(id, pinfo(p, input.honors?.[id]));
      live.push(this.mkLive(id, true, i, fit[id]));
    });
    for (const id of (lineup.bench ?? []).slice(0, 12)) {
      const p = byId.get(id);
      if (!p || info.has(id)) continue;
      info.set(id, pinfo(p, input.honors?.[id]));
      live.push(this.mkLive(id, false, null, fit[id]));
      benchIds.add(id);
    }
    const t: Team = {
      side, input, name: input.name, info, live,
      liveById: new Map(live.map((l) => [l.id, l])),
      onPitch: [],
      // (Táticas) formação personalizada: sem `positions` ⇒ os mesmos slots da formação
      slots: shapeSlots(tactic.formation, lineup.positions),
      stats: emptyStats(),
      tactic,
      baseMentality: tactic.mentality,
      morale: input.morale ?? 50,
      benchIds,
      usedSubs: new Set(),
      penaltyTakerId: lineup.penaltyTakerId,
      def: 0, mid: 0, att: 0, gk: 0, gkId: null,
      possMinutes: 0, passAcc: 0, lastAiSub: -10,
      appeared: new Set(lineup.starters),
    };
    this.refresh(t);
    return t;
  }

  private mkLive(id: string, onPitch: boolean, slot: number | null, fitness?: number): LivePlayerState {
    return {
      id, onPitch, slotIndex: slot, stamina: clamp(fitness ?? 100, 1, 100), rating: 6,
      yellow: 0, sentOff: false, injured: false, goals: 0, assists: 0,
    };
  }

  private refresh(t: Team): void {
    t.onPitch = t.live.filter((l) => l.onPitch);
    t.gkId = null;
    for (const l of t.onPitch) if (l.slotIndex !== null && t.slots[l.slotIndex]?.role === 'GK') t.gkId = l.id;
  }

  /* ───────────── API ───────────── */

  isFinished(): boolean {
    return this.state.phase === 'finished';
  }

  tick(): MatchEvent[] {
    const s = this.state;
    if (s.phase === 'finished') return this.flush();
    if (s.phase === 'penalties') {
      this.shootoutKick();
      return this.flush();
    }
    if (s.phase === 'pre') {
      this.emit('kickoff', 'kickoff', {});
      s.phase = 'first-half';
    } else if (s.phase === 'half-time') {
      s.minute = 46;
      s.extra = 0;
      this.emit('second-half', 'second-half', {});
      s.phase = 'second-half';
    }
    this.playMinute();
    return this.flush();
  }

  runToEnd(): MatchResult {
    let guard = 0;
    while (!this.isFinished() && guard++ < 1000) this.tick();
    return this.result();
  }

  apply(cmd: MatchCommand): string | null {
    const s = this.state;
    if (s.phase === 'finished') return 'A partida já terminou.';
    if (s.phase === 'penalties') return 'Não é possível durante a disputa de pênaltis.';
    if (!cmd || (cmd.side !== 'home' && cmd.side !== 'away')) return 'Lado inválido.';
    const t = this.teams[cmd.side];
    switch (cmd.type) {
      case 'substitute':
        return this.substitute(t, cmd.outId, cmd.inId, false);
      case 'set-tactic':
        return this.setTactic(t, cmd.tactic);
      case 'swap-slots':
        return this.swapSlots(t, cmd.aId, cmd.bId);
      case 'set-shape': {
        // (Táticas) predefinição/arrasto durante o jogo: os jogadores ficam nos mesmos slots, que mudam de lugar
        const slots = shapeSlots(t.tactic.formation, cmd.positions);
        if (slots === t.slots) return null;
        t.slots = slots;
        this.state.slots![t.side] = slots;
        this.refresh(t);
        this.emitRaw('tactic-change', t, undefined, undefined, undefined, null, {}, `${t.name} ajusta o posicionamento em campo.`);
        return null;
      }
      default:
        return 'Comando desconhecido.';
    }
  }

  result(): MatchResult {
    const s = this.state;
    const h = s.score.home, a = s.score.away;
    const agg = this.cfg.aggregate;
    const aggregate = agg ? { home: agg.home + h, away: agg.away + a } : undefined;
    // mata-mata: o vencedor é quem avança (agregado → pênaltis); fora dele, o vencedor do jogo
    const th = this.cfg.knockout && aggregate ? aggregate.home : h;
    const ta = this.cfg.knockout && aggregate ? aggregate.away : a;
    let winner: Side | 'draw' = th > ta ? 'home' : ta > th ? 'away' : 'draw';
    if (winner === 'draw' && s.penaltyScore && s.phase === 'finished') {
      winner = s.penaltyScore.home > s.penaltyScore.away ? 'home' : s.penaltyScore.away > s.penaltyScore.home ? 'away' : 'draw';
    }
    const advancing = this.cfg.knockout && winner !== 'draw' && s.phase === 'finished' ? winner : undefined;
    const ratings: Record<string, number> = {};
    const fitnessAfter: Record<string, number> = {};
    for (const t of [this.teams.home, this.teams.away]) {
      for (const l of t.live) {
        if (!t.appeared.has(l.id)) continue;
        ratings[l.id] = Math.round(l.rating * 10) / 10;
        fitnessAfter[l.id] = Math.round(l.stamina);
      }
    }
    return {
      homeGoals: h,
      awayGoals: a,
      penalties: s.penaltyScore ? { ...s.penaltyScore } : undefined,
      winner,
      ...(aggregate ? { aggregate } : {}),
      ...(advancing ? { advancing } : {}),
      scorers: this.scorers.slice(),
      cards: this.cards.slice(),
      injuries: this.injuries.slice(),
      ratings,
      stats: { home: { ...s.stats.home }, away: { ...s.stats.away } },
      attendance: this.attendance,
      ...(this.ticketDemand !== undefined ? { ticketDemand: this.ticketDemand } : {}),
      appearances: { home: [...this.teams.home.appeared], away: [...this.teams.away.appeared] },
      extraTime: this.wentExtra,
      fitnessAfter,
    };
  }

  /* ───────────── relógio ───────────── */

  private playMinute(): void {
    const s = this.state;
    const per = PERIODS[this.periodIdx];
    this.elapsed++;
    if (this.elapsed <= per.len) {
      s.minute = per.start + this.elapsed;
      s.extra = 0;
    } else {
      s.minute = per.start + per.len;
      s.extra = this.elapsed - per.len;
    }

    this.simulateMinute();

    if (this.elapsed === per.len) {
      this.added = this.computeStoppage();
      if (this.added > 0) this.emit('commentary', 'stoppage', { d: String(this.added) });
    }
    if (this.elapsed >= per.len && this.elapsed >= per.len + this.added) this.endPeriod();
  }

  private computeStoppage(): number {
    const ev = this.periodEventCount;
    const r = this.rng.int(0, 2);
    switch (this.periodIdx) {
      case 0: return clamp(1 + Math.floor(ev / 6) + (r > 1 ? 1 : 0), 1, 5);
      case 1: return clamp(3 + Math.floor(ev / 4) + r, 3, 9);
      default: return clamp(r, 0, 2);
    }
  }

  private endPeriod(): void {
    const s = this.state;
    const agg = this.cfg.aggregate;
    const draw = agg
      ? s.score.home + agg.home === s.score.away + agg.away
      : s.score.home === s.score.away;
    this.periodEventCount = 0;
    this.added = -1;
    this.elapsed = 0;
    if (this.periodIdx === 0) {
      s.phase = 'half-time';
      this.periodIdx = 1;
      this.emit('half-time', 'half-time', { s: `${s.score.home} x ${s.score.away}` });
      for (const t of [this.teams.home, this.teams.away]) for (const l of t.onPitch) l.stamina = Math.min(100, l.stamina + STAMINA.halfTime);
      return;
    }
    if (this.periodIdx === 1) {
      if (this.cfg.knockout && draw && this.cfg.extraTime === false) {
        // fiel ao original: sem prorrogação, empate → pênaltis
        this.periodIdx = 3;
        return this.endPeriod();
      }
      if (this.cfg.knockout && draw) {
        this.periodIdx = 2;
        this.wentExtra = true;
        s.phase = 'extra-time';
        this.emit('extra-time', 'extra-time', {});
        for (const t of [this.teams.home, this.teams.away]) for (const l of t.onPitch) l.stamina = Math.min(100, l.stamina + STAMINA.extraTimeBreak);
        return;
      }
      return this.finish();
    }
    if (this.periodIdx === 2) {
      this.periodIdx = 3;
      this.emit('extra-time', 'extra-time-2', {});
      return;
    }
    if (draw) {
      s.phase = 'penalties';
      s.penaltyScore = { home: 0, away: 0 };
      this.emit('penalties', 'penalties', {});
      this.shootout = {
        kicks: { home: 0, away: 0 },
        order: { home: this.shootoutOrder(this.teams.home), away: this.shootoutOrder(this.teams.away) },
      };
      return;
    }
    this.finish();
  }

  private finish(): void {
    const s = this.state;
    if (this.finalized) return;
    this.finalized = true;
    s.phase = 'finished';
    // ajustes finais de nota
    const h = s.score.home, a = s.score.away;
    for (const t of [this.teams.home, this.teams.away]) {
      const gf = t.side === 'home' ? h : a;
      const ga = t.side === 'home' ? a : h;
      const resAdj = gf > ga ? 0.3 : gf < ga ? -0.2 : 0;
      const xgDiff = t.stats.xg - this.opp(t).stats.xg;
      for (const l of t.live) {
        if (!t.appeared.has(l.id)) continue;
        const inf = t.info.get(l.id)!;
        let r = l.rating + resAdj + clamp(xgDiff, -2, 2) * 0.15 + (inf.p.overall - 72) * 0.012 + inf.ratingBonus + this.rng.normal() * 0.22;
        const role = this.roleOfPlayer(t, l);
        if (ga === 0 && (role === 'GK' || (role && ROLE_W[role].def >= 0.6))) r += role === 'GK' ? 0.5 : 0.3;
        l.rating = clamp(r, 3, 10);
      }
    }
    this.emit('full-time', 'full-time', { s: `${h} x ${a}` });
  }

  /* ───────────── núcleo do minuto ───────────── */

  private opp(t: Team): Team {
    return t.side === 'home' ? this.teams.away : this.teams.home;
  }

  private roleOfPlayer(t: Team, l: LivePlayerState) {
    return l.slotIndex !== null ? t.slots[l.slotIndex]?.role : undefined;
  }

  private computeStrength(t: Team): void {
    let def = 0, mid = 0, att = 0, gk = 0;
    t.gkId = null;
    for (const l of t.onPitch) {
      if (l.slotIndex === null) continue;
      const slot = t.slots[l.slotIndex];
      if (!slot) continue;
      const inf = t.info.get(l.id)!;
      const eff = inf.p.overall * slotFit(inf.p, slot) * staminaFactor(l.stamina) * (l.injured ? 0.6 : 1);
      if (slot.role === 'GK') {
        gk = eff * (1 + inf.gkBonus);
        t.gkId = l.id;
        continue;
      }
      const w = ROLE_W[slot.role];
      def += w.def * eff * (1 + inf.tDef);
      mid += w.mid * eff * (1 + inf.tMid);
      att += w.att * eff * (1 + inf.tAtt);
    }
    const bonus = (t.side === 'home' ? COEF.homeAdv : 0) + (t.morale - 50) * COEF.moralePerPoint;
    // (Táticas) equilíbrio de setores do desenho (formações padrão: multiplicadores exatamente 1)
    const sb = shapeBalance(t.slots);
    t.def = (def / NORM.def) * sb.def + bonus;
    t.mid = (mid / NORM.mid) * sb.mid + bonus;
    t.att = (att / NORM.att) * sb.att + bonus;
    t.gk = (gk || 22) + bonus * 0.5;
  }

  private simulateMinute(): void {
    const s = this.state;
    const H = this.teams.home, A = this.teams.away;
    const r = this.rng;

    this.aiCoach(H);
    this.aiCoach(A);

    // cansaço
    for (const t of [H, A]) {
      const k = COEF.staminaDrain * TEMPO_DRAIN[t.tactic.tempo] * PRESS_DRAIN[t.tactic.pressing] * (this.periodIdx >= 2 ? STAMINA.extraTimeDrain : 1);
      for (const l of t.onPitch) {
        const inf = t.info.get(l.id)!;
        const gkMul = this.roleOfPlayer(t, l) === 'GK' ? STAMINA.gkDrain : 1;
        l.stamina = Math.max(0, l.stamina - k * inf.drain * gkMul);
      }
    }

    this.computeStrength(H);
    this.computeStrength(A);

    // posse
    const tp = (t: Team) => MENT_POSS[MENTALITY_IDX[t.tactic.mentality]] + TEMPO_POSS[t.tactic.tempo] + PRESS_POSS[t.tactic.pressing] + PASS_POSS[t.tactic.passing];
    const logit = COEF.kPoss * (H.mid - A.mid) + tp(H) - tp(A) + COEF.momentumPoss * s.momentum;
    const pHome = 1 / (1 + Math.exp(-logit));
    const P = r.next() < pHome ? H : A;
    const D = this.opp(P);
    P.possMinutes++;
    const tot = H.possMinutes + A.possMinutes;
    H.stats.possession = Math.round((100 * H.possMinutes) / tot);
    A.stats.possession = 100 - H.stats.possession;
    for (const t of [H, A]) {
      const mine = t === P ? 1 : 0.35;
      t.passAcc += 5.2 * mine * PASS_VOLUME[t.tactic.passing] * clamp(t.mid / 75, 0.6, 1.3);
      const whole = Math.floor(t.passAcc);
      t.stats.passesCompleted += whole;
      t.passAcc -= whole;
    }
    this.momentum(P, 0.02);

    // ataque
    const pc = clamp(
      COEF.baseChance * Math.exp(COEF.kAtt * (P.att - D.def)) *
        MENT_ATT[MENTALITY_IDX[P.tactic.mentality]] * TEMPO_ATT[P.tactic.tempo] * PASS_ATT[P.tactic.passing] *
        MENT_OPP[MENTALITY_IDX[D.tactic.mentality]] * TEMPO_OPP[D.tactic.tempo] * PRESS_OPP[D.tactic.pressing],
      0.02, 0.75,
    );
    if (r.next() < pc) this.chance(P, D);
    else if (r.next() < COEF.cornerPerMinute) this.corner(P, D);

    // faltas do time sem a bola
    const pf = COEF.foulBase * PRESS_FOUL[D.tactic.pressing] * (this.state.minute > 75 ? 1.1 : 1) * (0.9 + 0.2 * (D.onPitch.length / 11));
    if (r.next() < pf) this.foul(D, P);

    // lesões
    for (const t of [H, A]) {
      // (Atualização 38) exaustos (< 25%) elevam o risco de lesão do time (mesma quantidade de sorteios)
      let spent = 0;
      for (const l of t.onPitch) if (l.stamina < 25) spent++;
      const exhausted = spent ? 1 + (1.8 * spent) / Math.max(1, t.onPitch.length) : 1;
      if (r.next() < COEF.injuryPerMinute * (t.tactic.pressing === 'high' ? 1.15 : 1) * exhausted) this.injury(t);
    }

    s.momentum *= 0.9;

    if (this.narrateOn) this.flavor(P, D);
  }

  /* ───────────── lances ───────────── */

  private pickWeighted(t: Team, wf: (l: LivePlayerState, inf: PInfo) => number, exclude?: string): LivePlayerState | null {
    const ws: number[] = [];
    for (const l of t.onPitch) ws.push(l.id === exclude || l.slotIndex === null ? 0 : wf(l, t.info.get(l.id)!));
    const i = this.rng.weightedIndex(ws);
    return i < 0 ? null : t.onPitch[i];
  }

  private role(t: Team, l: LivePlayerState) {
    return t.slots[l.slotIndex ?? 0]?.role ?? 'CM';
  }

  private chance(P: Team, D: Team): void {
    const r = this.rng;
    const diff = P.att - D.def;
    const shooter = this.pickWeighted(P, (l, inf) => SHOOT_W[this.role(P, l)] * (inf.p.overall / 70) ** 2 * (1 + inf.fin * 2.5));
    if (!shooter) return;
    const passerW = (l: LivePlayerState, inf: PInfo) =>
      ASSIST_W[this.role(P, l)] * (inf.p.overall / 70) ** 2 * (1 + 0.3 * inf.pass + 0.3 * inf.cross);
    // impedimento
    if (r.next() < COEF.offsideRate * PASS_OFFSIDE[P.tactic.passing]) {
      P.stats.offsides++;
      shooter.rating -= 0.05;
      this.emit('offside', 'offside', {}, P, shooter.id);
      return;
    }
    // chance perdida (passe final cortado)
    if (r.next() < COEF.chanceLost) {
      const tackler = this.pickWeighted(D, (l) => ROLE_W[this.role(D, l)].def);
      if (tackler) tackler.rating += 0.06;
      this.emit('chance', 'chance-lost', {}, P, shooter.id);
      if (r.next() < 0.35) this.corner(P, D);
      return;
    }
    // tipo de finalização
    const pBig = clamp(COEF.bigChance * Math.exp(COEF.kBig * diff) * PASS_BIG[P.tactic.passing], 0.03, 0.35);
    const u = r.next();
    let xg: number;
    let kind: 'big' | 'normal' | 'long';
    if (u < pBig) { kind = 'big'; xg = COEF.xgBig[0] + COEF.xgBig[1] * r.next(); }
    else if (u < pBig + COEF.longShot / PASS_BIG[P.tactic.passing]) { kind = 'long'; xg = COEF.xgLong[0] + COEF.xgLong[1] * r.next(); }
    else { kind = 'normal'; xg = COEF.xgNormal[0] + COEF.xgNormal[1] * r.next(); }
    const assist = kind === 'long' && r.next() < 0.6 ? null : r.next() < 0.8 ? this.pickWeighted(P, passerW, shooter.id) : null;
    if (kind === 'big' && this.narrateOn) {
      this.emit('chance', assist ? 'chance-assist' : 'chance', {}, P, shooter.id, assist?.id);
    }
    this.shot(P, D, shooter, assist, xg, kind === 'long' ? 'long' : 'open');
  }

  private corner(P: Team, D: Team): void {
    P.stats.corners++;
    this.momentum(P, 0.05);
    const taker = this.pickWeighted(P, (l, inf) => ASSIST_W[this.role(P, l)] * (1 + inf.cross * 1.5));
    this.emit('corner', 'corner', {}, P, taker?.id);
    if (this.rng.next() < COEF.cornerHeaderShot) {
      const header = this.pickWeighted(P, (l, inf) => HEAD_W[this.role(P, l)] * (inf.p.overall / 70) * (1 + inf.head * 4), taker?.id);
      if (header) this.shot(P, D, header, this.rng.next() < 0.85 ? taker : null, 0.04 + 0.09 * this.rng.next(), 'header');
    }
  }

  private shot(
    P: Team, D: Team, shooter: LivePlayerState, assist: LivePlayerState | null, xg: number,
    kind: 'open' | 'long' | 'header' | 'freekick' | 'penalty',
  ): void {
    const r = this.rng;
    const inf = P.info.get(shooter.id)!;
    P.stats.shots++;
    P.stats.xg = Math.round((P.stats.xg + xg) * 100) / 100;
    this.momentum(P, 0.1);
    const finish = 1 + (inf.p.overall - 75) * COEF.finishK + (kind === 'header' ? inf.head : inf.fin) + inf.goal;
    const gkMod = clamp(1 - (D.gk - 75) * COEF.gkK, 0.55, 1.6);
    const pGoal = clamp(xg * finish * gkMod, 0.005, 0.92);
    const pOn = clamp(Math.max(pGoal + 0.08, 0.27 + 0.8 * xg + (inf.p.overall - 75) * 0.004), 0, 0.97);
    const u = r.next();
    const gkId = D.gkId;
    const vars: NarrationVars = { g: gkId ? this.pname(D, gkId) : 'o goleiro' };
    if (u < pGoal) {
      P.stats.shotsOnTarget++;
      this.goal(P, D, shooter, assist, kind);
      return;
    }
    if (u < pOn) {
      P.stats.shotsOnTarget++;
      shooter.rating += 0.1;
      const great = xg > 0.25;
      if (gkId) D.liveById.get(gkId)!.rating += great ? 0.45 : 0.22;
      this.momentum(P, 0.08);
      this.emit('save', great ? 'save-great' : 'save', vars, P, shooter.id, assist?.id);
      if (r.next() < 0.3) this.corner(P, D);
      return;
    }
    if (u < pOn + 0.035) {
      shooter.rating += 0.1;
      this.emit('woodwork', 'woodwork', vars, P, shooter.id);
      return;
    }
    shooter.rating -= 0.04;
    if (kind !== 'header' && r.next() < 0.3) {
      this.emit('shot', 'shot-blocked', vars, P, shooter.id);
      if (r.next() < 0.45) this.corner(P, D);
    } else {
      this.emit('shot', 'shot-off', vars, P, shooter.id);
    }
  }

  private goal(P: Team, D: Team, scorer: LivePlayerState, assist: LivePlayerState | null, kind: string, ownGoal = false): void {
    const s = this.state;
    s.score[P.side]++;
    P.stats.goals = s.score[P.side];
    this.periodEventCount++;
    if (ownGoal) {
      scorer.rating -= 1.0;
    } else {
      scorer.goals++;
      scorer.rating += kind === 'penalty' ? 0.7 : 1.0;
      if (assist) { assist.assists++; assist.rating += 0.6; }
    }
    if (D.gkId) D.liveById.get(D.gkId)!.rating -= 0.3;
    for (const l of D.onPitch) {
      const role = this.roleOfPlayer(D, l);
      if (role && role !== 'GK' && ROLE_W[role].def >= 0.6) l.rating -= 0.1;
    }
    s.momentum = clamp(s.momentum + (P.side === 'home' ? 0.4 : -0.4), -1, 1);
    // moral em jogo: quem sofre perde um pouco
    D.morale = clamp(D.morale - 1.5, 0, 100);
    P.morale = clamp(P.morale + 1.5, 0, 100);
    this.scorers.push({
      side: P.side, playerId: scorer.id, minute: s.minute, ownGoal: ownGoal || undefined,
      penalty: kind === 'penalty' || undefined,
      ...(assist && !ownGoal ? { assistId: assist.id } : {}),
    });
    if (!this.narrateOn) {
      this.pushEvent(ownGoal ? 'own-goal' : 'goal', P.side, scorer.id, assist?.id, '');
      return;
    }
    const h = s.score.home, a = s.score.away;
    const score = `${this.teams.home.name} ${h} x ${a} ${this.teams.away.name}`;
    let key: NarrationKey;
    if (ownGoal) key = 'own-goal';
    else if (kind === 'penalty') key = 'goal-penalty';
    else if (kind === 'freekick') key = 'goal-freekick';
    else if (kind === 'header') key = 'goal-header';
    else if (kind === 'long') key = 'goal-long';
    else if (h === a && this.txt.next() < 0.5) key = 'goal-equalizer';
    else key = assist ? 'goal-assist' : 'goal';
    const vars: NarrationVars = { s: score, a: assist ? this.pname(P, assist.id) : '' };
    if (ownGoal) {
      this.emit('own-goal', key, { s: score, p: this.pname(D, scorer.id), t: P.name, o: D.name }, P, scorer.id);
    } else {
      this.emit('goal', key, vars, P, scorer.id, assist?.id);
    }
  }

  private foul(D: Team, P: Team): void {
    const r = this.rng;
    const s = this.state;
    const fouler = this.pickWeighted(D, (l, inf) => FOUL_W[this.role(D, l)] * (1 + inf.tDef) * (l.yellow > 0 ? COEF.bookedFoulMul : 1));
    if (!fouler) return;
    D.stats.fouls++;
    fouler.rating -= 0.04;
    this.periodEventCount += 0.5;
    // pênalti?
    if (r.next() < COEF.penaltyPerFoul) {
      const victim = this.pickWeighted(P, (l) => SHOOT_W[this.role(P, l)] + 0.05);
      fouler.rating -= 0.35;
      this.emit('penalty-awarded', 'penalty-awarded', { a: this.pname(D, fouler.id) }, P, victim?.id ?? fouler.id);
      this.card(D, fouler, r.next() < 0.35, r.next() < 0.04);
      this.penalty(P, D);
      return;
    }
    const dangerous = r.next() < COEF.dangerousFoul;
    this.emit('foul', dangerous ? 'foul-dangerous' : 'foul', {}, D, fouler.id);
    const late = s.minute > 70 ? 1.15 : 1;
    // (Estrelas) defensor Top Mundial / Destaque leva menos cartões
    const cardMul = D.info.get(fouler.id)?.cardMul ?? 1;
    const yellow = r.next() < COEF.yellowPerFoul * late * (dangerous ? 1.6 : 1) * (fouler.yellow > 0 ? COEF.bookedYellowMul : 1) * cardMul;
    const red = r.next() < COEF.redPerFoul * cardMul;
    if (yellow || red) this.card(D, fouler, yellow, red);
    if (dangerous && r.next() < COEF.freeKickShot) {
      const taker = this.pickWeighted(P, (l, inf) => (inf.fin + 0.04 * inf.pass + 0.02) * (inf.p.overall / 70) ** 3 * (this.role(P, l) === 'GK' ? 0 : 1));
      if (taker) {
        this.emit('commentary', 'freekick-shot', {}, P, taker.id);
        this.shot(P, D, taker, null, 0.05 + 0.05 * r.next(), 'freekick');
      }
    }
  }

  private card(t: Team, l: LivePlayerState, yellow: boolean, red: boolean): void {
    if (l.sentOff) return;
    const s = this.state;
    this.periodEventCount++;
    if (red) {
      this.sendOff(t, l, 'red');
      return;
    }
    if (!yellow) return;
    l.yellow++;
    t.stats.yellows++;
    l.rating -= 0.3;
    this.cards.push({ side: t.side, playerId: l.id, minute: s.minute, color: 'yellow' });
    if (l.yellow >= 2) {
      this.sendOff(t, l, 'second-yellow');
    } else {
      this.emit('yellow', 'yellow', {}, t, l.id);
    }
  }

  private sendOff(t: Team, l: LivePlayerState, kind: 'red' | 'second-yellow'): void {
    const s = this.state;
    l.sentOff = true;
    l.onPitch = false;
    l.slotIndex = null;
    l.rating -= kind === 'red' ? 1.3 : 1.0;
    t.stats.reds++;
    this.cards.push({ side: t.side, playerId: l.id, minute: s.minute, color: 'red' });
    t.morale = clamp(t.morale - 3, 0, 100);
    this.refresh(t);
    this.emit(kind, kind, {}, t, l.id);
  }

  private penalty(P: Team, D: Team): void {
    const r = this.rng;
    let taker = P.penaltyTakerId ? P.liveById.get(P.penaltyTakerId) : undefined;
    if (!taker || !taker.onPitch) {
      taker = P.onPitch
        .filter((l) => this.roleOfPlayer(P, l) !== 'GK')
        .sort((a, b) => this.penScore(P, b) - this.penScore(P, a))[0];
    }
    if (!taker) return;
    const inf = P.info.get(taker.id)!;
    const gk = D.gkId ? D.info.get(D.gkId) : undefined;
    P.stats.shots++;
    P.stats.xg = Math.round((P.stats.xg + 0.76) * 100) / 100;
    const conv = clamp(
      COEF.penaltyConv + (inf.p.overall - 75) * 0.004 + inf.fin * 0.25 - (gk?.penSave ? 0.08 : 0) - ((D.gk - 75) * 0.003),
      0.45, 0.95,
    );
    const u = r.next();
    if (u < conv) {
      P.stats.shotsOnTarget++;
      this.goal(P, D, taker, null, 'penalty');
      return;
    }
    taker.rating -= 0.6;
    const vars: NarrationVars = { g: D.gkId ? this.pname(D, D.gkId) : 'o goleiro' };
    if (r.next() < 0.65) {
      P.stats.shotsOnTarget++;
      if (D.gkId) D.liveById.get(D.gkId)!.rating += 0.8;
      this.emit('penalty-missed', 'penalty-saved', vars, P, taker.id);
    } else {
      this.emit('penalty-missed', 'penalty-missed', vars, P, taker.id);
    }
  }

  private penScore(t: Team, l: LivePlayerState): number {
    const inf = t.info.get(l.id)!;
    return inf.p.overall + inf.fin * 60 + (inf.p.position === 'FW' ? 4 : inf.p.position === 'MF' ? 2 : 0) + (l.id === t.penaltyTakerId ? 50 : 0);
  }

  private injury(t: Team): void {
    const s = this.state;
    const l = this.pickWeighted(t, (x, inf) => (x.injured ? 0 : 1) * (1 + (100 - x.stamina) / 60) * (inf.p.age > 30 ? 1.2 : 1));
    if (!l) return;
    l.injured = true;
    l.rating -= 0.1;
    const u = this.rng.next();
    const days = u < 0.6 ? this.rng.int(3, 12) : u < 0.92 ? this.rng.int(13, 40) : this.rng.int(41, 120);
    this.injuries.push({ side: t.side, playerId: l.id, minute: s.minute, days });
    this.periodEventCount++;
    this.emit('injury', 'injury', {}, t, l.id);
  }

  private momentum(t: Team, v: number): void {
    const s = this.state;
    s.momentum = clamp(s.momentum + (t.side === 'home' ? v : -v), -1, 1);
  }

  /* ───────────── IA do técnico ───────────── */

  private aiCoach(t: Team): void {
    if (t.input.control !== 'ai') return;
    const s = this.state;
    const subsLeft = this.maxSubs - t.stats.subsUsed;
    // lesionados saem na hora
    for (const l of t.onPitch) {
      if (l.injured && subsLeft > 0 && l.slotIndex !== null) {
        const inc = this.bestReplacement(t, l.slotIndex);
        if (inc) this.substitute(t, l.id, inc, true);
        break;
      }
    }
    // goleiro expulso: sacrifica um jogador de linha pelo reserva do gol
    if (!t.gkId && this.maxSubs - t.stats.subsUsed > 0) {
      const gkSlot = t.slots.findIndex((x) => x.role === 'GK');
      const benchGk = [...t.benchIds].find((id) => !t.usedSubs.has(id) && t.info.get(id)!.p.position === 'GK' && !t.liveById.get(id)!.onPitch && !t.appeared.has(id));
      const victim = t.onPitch
        .filter((l) => this.roleOfPlayer(t, l) !== 'GK')
        .sort((a, b) => ROLE_W[this.role(t, a)].def - ROLE_W[this.role(t, b)].def || (a.id < b.id ? -1 : 1))[0];
      if (benchGk && gkSlot >= 0 && victim) {
        // o reserva entra no gol; o slot do sacrificado fica vazio
        victim.slotIndex = gkSlot;
        this.substitute(t, victim.id, benchGk, false);
      }
    }
    if (!t.gkId) {
      // sem goleiro e sem troca possível: um zagueiro vai para o gol
      const gkSlot = t.slots.findIndex((x) => x.role === 'GK');
      const stand = t.onPitch.slice().sort((a, b) => ROLE_W[this.role(t, b)].def - ROLE_W[this.role(t, a)].def || (a.id < b.id ? -1 : 1))[0];
      if (stand && gkSlot >= 0) {
        stand.slotIndex = gkSlot;
        this.refresh(t);
      }
    }
    const min = s.minute;
    const late = s.phase === 'second-half' || s.phase === 'extra-time';
    if (!late) return;
    // cansaço
    const left = this.maxSubs - t.stats.subsUsed;
    const window = (min >= 55 && min <= 80) || s.phase === 'extra-time';
    if (window && left > (min < 78 ? 1 : 0) && min - t.lastAiSub >= 3) {
      const thr = s.phase === 'extra-time' ? 70 : min < 65 ? 74 : 82;
      const tired = t.onPitch
        .filter((l) => this.roleOfPlayer(t, l) !== 'GK' && l.stamina < thr)
        .sort((a, b) => a.stamina - b.stamina)[0];
      if (tired && tired.slotIndex !== null) {
        const inc = this.bestReplacement(t, tired.slotIndex);
        if (inc && this.substitute(t, tired.id, inc, false) === null) t.lastAiSub = min;
      }
    }
    // mentalidade conforme o placar
    const diff = s.score[t.side] - s.score[this.opp(t).side];
    let target: Mentality = t.baseMentality;
    const baseIdx = MENTALITY_IDX[t.baseMentality];
    if (min >= 70 && diff < 0) target = min >= 82 || diff <= -2 ? 'all-out' : MENTALITIES[Math.max(baseIdx, 3)];
    else if (min >= 75 && diff > 0) target = MENTALITIES[Math.min(baseIdx, diff >= 2 ? 2 : 1)];
    if (target !== t.tactic.mentality) this.setTactic(t, { mentality: target }, true);
  }

  private bestReplacement(t: Team, slotIndex: number): string | null {
    const slot = t.slots[slotIndex];
    let best: string | null = null;
    let bv = -1;
    for (const id of t.benchIds) {
      const l = t.liveById.get(id)!;
      if (l.onPitch || t.appeared.has(id) || l.sentOff) continue;
      const p = t.info.get(id)!.p;
      if (slot.role !== 'GK' && p.position === 'GK') continue;
      const v = p.overall * slotFit(p, slot) * staminaFactor(l.stamina) - (slot.role === 'GK' && p.position !== 'GK' ? 100 : 0);
      if (v > bv) { bv = v; best = id; }
    }
    return best;
  }

  /* ───────────── comandos ───────────── */

  private substitute(t: Team, outId: string, inId: string, injurySub: boolean): string | null {
    if (t.stats.subsUsed >= this.maxSubs) return 'Limite de substituições atingido.';
    const out = t.liveById.get(outId);
    const inc = t.liveById.get(inId);
    if (!out) return 'Jogador que sai não está na partida.';
    if (!inc) return 'Jogador que entra não está no banco.';
    if (out.sentOff) return 'Jogador expulso não pode ser substituído.';
    if (!out.onPitch) return 'Jogador que sai não está em campo.';
    if (inc.onPitch) return 'Jogador que entra já está em campo.';
    if (inc.sentOff) return 'Jogador expulso não pode entrar.';
    if (!t.benchIds.has(inId)) return 'Jogador que entra não está no banco.';
    if (t.appeared.has(inId) || t.usedSubs.has(inId)) return 'Jogador já participou da partida e não pode voltar.';
    inc.onPitch = true;
    inc.slotIndex = out.slotIndex;
    out.onPitch = false;
    out.slotIndex = null;
    t.usedSubs.add(outId);
    t.appeared.add(inId);
    t.stats.subsUsed++;
    this.periodEventCount++;
    this.refresh(t);
    const injured = injurySub || out.injured;
    this.emitRaw('substitution', t, inId, undefined, outId, injured ? 'substitution-injury' : 'substitution', {
      in: this.pname(t, inId), out: this.pname(t, outId),
    });
    return null;
  }

  private setTactic(t: Team, patch: Partial<Tactic>, byAi = false): string | null {
    if (!patch || typeof patch !== 'object') return 'Tática inválida.';
    if (patch.formation !== undefined && !FORMATIONS.includes(patch.formation)) return 'Formação inválida.';
    if (patch.mentality !== undefined && !(patch.mentality in MENTALITY_IDX)) return 'Mentalidade inválida.';
    if (patch.tempo !== undefined && !VALID_TEMPO.includes(patch.tempo)) return 'Ritmo inválido.';
    if (patch.pressing !== undefined && !VALID_PRESS.includes(patch.pressing)) return 'Pressão inválida.';
    if (patch.passing !== undefined && !VALID_PASS.includes(patch.passing)) return 'Estilo de passe inválido.';
    const changed: Partial<Tactic> = {};
    for (const k of ['formation', 'mentality', 'tempo', 'pressing', 'passing'] as const) {
      const v = patch[k];
      if (v !== undefined && v !== t.tactic[k]) (changed as Record<string, string>)[k] = v;
    }
    if (Object.keys(changed).length === 0) return null;
    Object.assign(t.tactic, changed);
    if (!byAi && changed.mentality) t.baseMentality = changed.mentality;
    if (changed.formation) this.reassignSlots(t);
    this.emitRaw('tactic-change', t, undefined, undefined, undefined, 'tactic-change', { d: describeTacticChange(changed) });
    return null;
  }

  private reassignSlots(t: Team): void {
    t.slots = formationSlotsRef(t.tactic.formation);
    if (this.state?.slots) this.state.slots[t.side] = t.slots;
    const players = t.onPitch.slice();
    // goleiro atual continua no gol
    const pairs: { s: number; l: LivePlayerState; v: number }[] = [];
    for (let si = 0; si < t.slots.length; si++) {
      for (const l of players) {
        const p = t.info.get(l.id)!.p;
        const wasGk = l.id === t.gkId;
        const isGkSlot = t.slots[si].role === 'GK';
        const v = wasGk === isGkSlot ? p.overall * slotFit(p, t.slots[si]) + (wasGk ? 1000 : 0) : -1;
        pairs.push({ s: si, l, v });
      }
    }
    pairs.sort((a, b) => b.v - a.v || a.s - b.s);
    const used = new Set<string>();
    const filled = new Set<number>();
    for (const l of players) l.slotIndex = null;
    for (const { s, l, v } of pairs) {
      if (v < 0 || used.has(l.id) || filled.has(s)) continue;
      l.slotIndex = s;
      used.add(l.id);
      filled.add(s);
    }
    // sobra (ex.: GK slot sem goleiro) → qualquer slot vazio
    for (const l of players) {
      if (l.slotIndex !== null) continue;
      for (let si = 0; si < t.slots.length; si++) if (!filled.has(si)) { l.slotIndex = si; filled.add(si); break; }
    }
    this.refresh(t);
  }

  private swapSlots(t: Team, aId: string, bId: string): string | null {
    const a = t.liveById.get(aId), b = t.liveById.get(bId);
    if (!a || !b) return 'Jogador não encontrado.';
    if (aId === bId) return 'Escolha dois jogadores diferentes.';
    if (!a.onPitch || !b.onPitch || a.slotIndex === null || b.slotIndex === null) return 'Os dois jogadores precisam estar em campo.';
    const tmp = a.slotIndex;
    a.slotIndex = b.slotIndex;
    b.slotIndex = tmp;
    this.refresh(t);
    this.emitRaw('tactic-change', t, aId, bId, undefined, null, {}, `${this.pname(t, aId)} e ${this.pname(t, bId)} trocam de posição no ${t.name}.`);
    return null;
  }

  /* ───────────── disputa de pênaltis ───────────── */

  private shootoutOrder(t: Team): string[] {
    const list = t.onPitch.slice().sort((a, b) => {
      const ga = this.roleOfPlayer(t, a) === 'GK' ? 1 : 0, gb = this.roleOfPlayer(t, b) === 'GK' ? 1 : 0;
      return ga - gb || this.penScore(t, b) - this.penScore(t, a);
    });
    return list.map((l) => l.id);
  }

  private shootoutKick(): void {
    const s = this.state;
    const so = this.shootout!;
    const ps = s.penaltyScore!;
    const side: Side = so.kicks.home <= so.kicks.away ? 'home' : 'away';
    const t = this.teams[side];
    const D = this.opp(t);
    const order = so.order[side];
    const takerId = order[so.kicks[side] % Math.max(1, order.length)];
    so.kicks[side]++;
    this.computeStrength(t);
    this.computeStrength(D);
    const inf = t.info.get(takerId)!;
    const gk = D.gkId ? D.info.get(D.gkId) : undefined;
    const conv = clamp(0.75 + (inf.p.overall - 75) * 0.004 + inf.fin * 0.2 - (gk?.penSave ? 0.08 : 0) - (D.gk - 75) * 0.003, 0.45, 0.93);
    const u = this.rng.next();
    const scored = u < conv;
    if (scored) ps[side]++;
    const key: NarrationKey = scored ? 'shootout-goal' : this.rng.next() < 0.6 ? 'shootout-save' : 'shootout-miss';
    this.emit('penalty-shootout-kick', key, { g: D.gkId ? this.pname(D, D.gkId) : 'o goleiro' }, t, takerId, undefined, scored);

    // decidido?
    const kh = so.kicks.home, ka = so.kicks.away;
    let done = false;
    if (kh <= 5 && ka <= 5) {
      const remH = 5 - kh, remA = 5 - ka;
      if (ps.home > ps.away + remA || ps.away > ps.home + remH) done = true;
    } else if (kh === ka && ps.home !== ps.away) done = true;
    if (kh === 5 && ka === 5 && ps.home !== ps.away) done = true;
    if (done || kh + ka > 60) {
      const win = ps.home > ps.away ? this.teams.home : this.teams.away;
      this.emit('penalties', 'shootout-win', { d: `${ps.home} x ${ps.away}` }, win);
      this.finish();
    }
  }

  /* ───────────── eventos / narração ───────────── */

  private pname(t: Team, id: string): string {
    return t.info.get(id)?.p.name ?? id;
  }

  private flush(): MatchEvent[] {
    const ev = this.state.events;
    const out = ev.slice(this.returnedIdx);
    this.returnedIdx = ev.length;
    return out;
  }

  private pushEvent(type: MatchEventType, side: Side | undefined, playerId: string | undefined, assistId: string | undefined, text: string, playerOutId?: string, scored?: boolean): void {
    if (!this.narrateOn) return;
    const s = this.state;
    const e: MatchEvent = { minute: s.minute, type, text };
    if (s.extra) e.extra = s.extra;
    if (side) e.side = side;
    if (playerId) e.playerId = playerId;
    if (assistId) e.assistId = assistId;
    if (playerOutId) e.playerOutId = playerOutId;
    if (scored !== undefined) e.scored = scored;
    s.events.push(e);
  }

  /** evento com narração; `t` é o time do lance (p é jogador de `t`) */
  private emit(type: MatchEventType, key: NarrationKey, vars: NarrationVars, t?: Team, playerId?: string, assistId?: string, scored?: boolean): void {
    if (!this.narrateOn) return;
    const s = this.state;
    const v: NarrationVars = {
      home: this.teams.home.name, away: this.teams.away.name, ...vars,
    };
    if (t) {
      v.t ??= t.name;
      v.o ??= this.opp(t).name;
      if (playerId && v.p === undefined) v.p = this.pname(t, playerId);
      if (assistId && !v.a) v.a = this.pname(t, assistId);
    }
    if (v.s === undefined) v.s = `${s.score.home} x ${s.score.away}`;
    this.pushEvent(type, t?.side, playerId, assistId, narrate(this.txt, key, v), undefined, scored);
  }

  private emitRaw(type: MatchEventType, t: Team, playerId: string | undefined, assistId: string | undefined, outId: string | undefined, key: NarrationKey | null, vars: NarrationVars, text?: string): void {
    if (!this.narrateOn) return;
    const v: NarrationVars = { t: t.name, o: this.opp(t).name, home: this.teams.home.name, away: this.teams.away.name, ...vars };
    this.pushEvent(type, t.side, playerId, assistId, text ?? narrate(this.txt, key!, v), outId);
  }

  /** comentários de ambiente (só narração; RNG separado) */
  private flavor(P: Team, D: Team): void {
    const x = this.txt.next();
    if (x > 0.05) return;
    const s = this.state;
    if (Math.abs(s.momentum) > 0.45) {
      const dom = s.momentum > 0 ? this.teams.home : this.teams.away;
      this.emit('commentary', 'commentary-pressure', {}, dom);
    } else if (x < 0.012 && s.minute > 60) {
      const tired = P.onPitch.filter((l) => l.stamina < 60)[0];
      if (tired) this.emit('commentary', 'commentary-tired', {}, P, tired.id);
    } else if (x < 0.025) {
      this.emit('commentary', 'commentary-crowd', {}, this.teams.home);
    } else if (x < 0.04) {
      this.emit('commentary', 'commentary-calm', {}, D);
    }
  }
}
