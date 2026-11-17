/**
 * (17/11) Lobby de até 6 técnicos: configurações (presets), validação e sorteio/draft de clubes.
 */
import {
  clubDifficulty, clubStrengthScore, DIFFICULTY_ORDER, MAX_MANAGERS, PLAYER_COLORS, SETTINGS_PRESETS,
  type ClubIndexEntry, type Difficulty, type RoomSettings,
} from '@cosmicfut/shared';
import * as V from './validate.ts';

export type FullSettings = Required<RoomSettings>;

export const DEFAULT_ROOM_SETTINGS: FullSettings = {
  countryId: 29,
  divisionIds: [],
  matchSpeedMs: 400,
  allowSameClub: false,
  // padrão: turnos estilo Brasfoot, partidas ao vivo, sem cronômetro (preset "Sem pressa")
  preset: 'sem-pressa',
  turnMode: 'turns',
  matchMode: 'live',
  timerSec: 0,
  h2hTransfers: true,
  pauseVotes: true,
  skipVotes: true,
  afkRounds: 2,
  pickMode: 'free',
  lotteryBand: 'any',
  isPublic: false,
  locked: false,
  // (carreira online salva) demissões de humanos ligadas; técnicos novos entram desempregados
  firing: true,
  lateJoin: true,
};

export const TIMER_OPTIONS = [0, 60, 120, 300];

/** Completa as configurações (salas antigas / snapshots sem os campos novos). */
export function fullSettings(s: Partial<RoomSettings> | undefined): FullSettings {
  return { ...DEFAULT_ROOM_SETTINGS, ...(s ?? {}), allowSameClub: false, divisionIds: (s?.divisionIds ?? []).slice() } as FullSettings;
}

const bool = (v: unknown, what: string): boolean => {
  if (typeof v !== 'boolean') throw new V.ValidationError(`${what} inválido.`);
  return v;
};

/**
 * Aplica um patch validado. `inLobby` libera os campos que só mudam antes do início (modo de vez, modo de escolha).
 * Devolve as chaves alteradas.
 */
export function applySettingsPatch(s: FullSettings, raw: unknown, inLobby: boolean): string[] {
  const o = V.obj(raw);
  const changed: string[] = [];
  const set = <K extends keyof FullSettings>(k: K, v: FullSettings[K]) => {
    if (s[k] !== v) {
      s[k] = v;
      changed.push(k);
    }
  };
  if (o.preset !== undefined) {
    const p = o.preset;
    if (p !== 'rapido' && p !== 'classico' && p !== 'sem-pressa' && p !== 'custom') throw new V.ValidationError('Preset inválido.');
    set('preset', p);
    if (p !== 'custom') {
      set('matchMode', SETTINGS_PRESETS[p].matchMode);
      set('timerSec', SETTINGS_PRESETS[p].timerSec);
    }
  }
  let custom = false;
  if (o.matchSpeedMs !== undefined) set('matchSpeedMs', V.intIn(o.matchSpeedMs, 'Velocidade', 1, 5000));
  if (o.matchMode !== undefined) {
    if (o.matchMode !== 'live' && o.matchMode !== 'quick') throw new V.ValidationError('Modo de partida inválido.');
    set('matchMode', o.matchMode);
    custom = true;
  }
  if (o.timerSec !== undefined) {
    const t = V.intIn(o.timerSec, 'Cronômetro', 0, 3600);
    if (!TIMER_OPTIONS.includes(t)) throw new V.ValidationError('Cronômetro: desligado, 60, 120 ou 300 s.');
    set('timerSec', t);
    custom = true;
  }
  for (const k of ['h2hTransfers', 'pauseVotes', 'skipVotes'] as const) {
    if (o[k] !== undefined) {
      set(k, bool(o[k], k));
      custom = true;
    }
  }
  if (o.afkRounds !== undefined) {
    set('afkRounds', V.intIn(o.afkRounds, 'Regra AFK', 0, 10));
    custom = true;
  }
  if (o.firing !== undefined) set('firing', bool(o.firing, 'Demissões'));
  if (o.lateJoin !== undefined) set('lateJoin', bool(o.lateJoin, 'Entrada tardia'));
  if (o.isPublic !== undefined) set('isPublic', bool(o.isPublic, 'Pública'));
  if (o.locked !== undefined) set('locked', bool(o.locked, 'Trancada'));
  if (o.lotteryBand !== undefined) {
    const b = o.lotteryBand;
    if (b !== 'any' && !DIFFICULTY_ORDER.includes(b as Difficulty)) throw new V.ValidationError('Faixa de dificuldade inválida.');
    set('lotteryBand', b as Difficulty | 'any');
  }
  for (const k of ['turnMode', 'pickMode'] as const) {
    if (o[k] === undefined) continue;
    if (!inLobby) throw new V.ValidationError('Isso só muda no lobby.');
    const ok = k === 'turnMode' ? ['turns', 'simultaneous'] : ['free', 'draft', 'lottery'];
    if (!ok.includes(o[k] as string)) throw new V.ValidationError(`${k} inválido.`);
    set(k, o[k] as never);
  }
  if (o.countryId !== undefined) set('countryId', V.intIn(o.countryId, 'País', 0, 100_000));
  if (custom && o.preset === undefined) {
    // continua no preset se os valores batem
    const match = (Object.keys(SETTINGS_PRESETS) as (keyof typeof SETTINGS_PRESETS)[]).find(
      (p) => SETTINGS_PRESETS[p].matchMode === s.matchMode && SETTINGS_PRESETS[p].timerSec === s.timerSec,
    );
    set('preset', match ?? 'custom');
  }
  return changed;
}

export const clampMaxPlayers = (n: number) => Math.max(1, Math.min(MAX_MANAGERS, Math.round(n)));

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && (PLAYER_COLORS as readonly string[]).includes(v);
}

export function shuffle<T>(xs: T[], rnd: () => number = Math.random): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Melhor clube disponível (draft automático): o de maior força (nível + reputação + orçamento). */
export function bestAvailable(candidates: ClubIndexEntry[], taken: Set<string>): ClubIndexEntry | null {
  let best: ClubIndexEntry | null = null;
  let bs = -Infinity;
  for (const c of candidates) {
    if (taken.has(c.id)) continue;
    const s = clubStrengthScore(c);
    if (s > bs || (s === bs && best && c.id < best.id)) {
      best = c;
      bs = s;
    }
  }
  return best;
}

/** Sorteio: um clube aleatório (não escolhido) dentro da faixa de dificuldade. */
export function randomInBand(candidates: ClubIndexEntry[], taken: Set<string>, band: Difficulty | 'any', rnd: () => number = Math.random): ClubIndexEntry | null {
  const pool = candidates.filter((c) => !taken.has(c.id) && (band === 'any' || clubDifficulty(c) === band));
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
}
