/**
 * Validação de payloads vindos do cliente. Nada é confiado: tipos, tamanhos e ids são checados.
 * Cada validador devolve o valor limpo ou lança ValidationError (vira Ack de erro).
 */
import { FORMATIONS, PRESET_SLOTS, sanitizePositions, sanitizePreset } from '@cosmicfut/engine';
import type { Formation, Lineup, MatchCommand, Mentality, Passing, Pressing, SlotPos, Tactic, TacticPreset, Tempo } from '@cosmicfut/engine';

export class ValidationError extends Error {}

const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

export function obj(v: unknown, what = 'payload'): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${what} inválido.`);
  return v as Record<string, unknown>;
}

export function str(v: unknown, what: string, max = 64, min = 1): string {
  if (typeof v !== 'string') return fail(`${what} inválido.`);
  if (v.length < min || v.length > max) return fail(`${what}: tamanho inválido.`);
  return v;
}

export function id(v: unknown, what: string): string {
  const s = str(v, what, 96);
  if (!/^[A-Za-z0-9:_.-]+$/.test(s)) fail(`${what} inválido.`);
  return s;
}

/** Controles C0/C1, zero-width, separadores de linha, bidi e BOM (montado por código para evitar literais invisíveis). */
const INVISIBLE = new RegExp(
  '[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
    .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`)
    .join('') + ']',
  'g',
);

/** Remove caracteres de controle e marcação; colapsa espaços. */
export function cleanText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nickname(v: unknown): string {
  if (typeof v !== 'string' || v.length > 64) return fail('Apelido inválido.');
  const s = cleanText(v).slice(0, 20).trim();
  if (s.length < 2) return fail('Apelido precisa de 2 a 20 caracteres.');
  return s;
}

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I

export function roomCode(v: unknown): string {
  if (typeof v !== 'string') return fail('Código de sala inválido.');
  const s = v.trim().toUpperCase();
  if (s.length !== 6 || [...s].some((c) => !ROOM_CODE_ALPHABET.includes(c))) return fail('Código de sala inválido.');
  return s;
}

export function token(v: unknown): string {
  const s = str(v, 'Token', 128, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) fail('Token inválido.');
  return s;
}

export function intIn(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return fail(`${what} fora do intervalo (${min}..${max}).`);
  return v;
}

const MENTALITIES = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'all-out'];
const TEMPOS = ['slow', 'normal', 'fast'];
const PRESSINGS = ['low', 'medium', 'high'];
const PASSINGS = ['short', 'mixed', 'direct'];

function oneOf<T extends string>(v: unknown, list: readonly string[], what: string): T {
  if (typeof v !== 'string' || !list.includes(v)) return fail(`${what} inválido.`);
  return v as T;
}

export function tacticPatch(v: unknown): Partial<Tactic> {
  const o = obj(v, 'Tática');
  const out: Partial<Tactic> = {};
  if (o.formation !== undefined) out.formation = oneOf<Formation>(o.formation, FORMATIONS, 'Formação');
  if (o.mentality !== undefined) out.mentality = oneOf<Mentality>(o.mentality, MENTALITIES, 'Mentalidade');
  if (o.tempo !== undefined) out.tempo = oneOf<Tempo>(o.tempo, TEMPOS, 'Ritmo');
  if (o.pressing !== undefined) out.pressing = oneOf<Pressing>(o.pressing, PRESSINGS, 'Pressão');
  if (o.passing !== undefined) out.passing = oneOf<Passing>(o.passing, PASSINGS, 'Passe');
  return out;
}

export function tactic(v: unknown): Tactic {
  const t = tacticPatch(v);
  if (!t.formation || !t.mentality || !t.tempo || !t.pressing || !t.passing) fail('Tática incompleta.');
  return t as Tactic;
}

/** Escalação: 11 titulares únicos do elenco, até 9 reservas únicos, sem sobreposição. */
export function lineup(v: unknown, squadIds: Set<string>, formation: Formation = '4-4-2'): Lineup {
  const o = obj(v, 'Escalação');
  const ids = (x: unknown, what: string, max: number): string[] => {
    if (!Array.isArray(x) || x.length > max) return fail(`${what} inválidos.`);
    return x.map((e) => {
      const s = id(e, what);
      if (!squadIds.has(s)) fail(`${what}: jogador ${s} não pertence ao elenco.`);
      return s;
    });
  };
  const starters = ids(o.starters, 'Titulares', 11);
  if (starters.length !== 11) fail('A escalação precisa de 11 titulares.');
  if (new Set(starters).size !== 11) fail('Jogador repetido entre os titulares.');
  const bench = ids(o.bench ?? [], 'Reservas', 9);
  if (new Set(bench).size !== bench.length) fail('Jogador repetido no banco.');
  if (bench.some((b) => starters.includes(b))) fail('Jogador está entre titulares e reservas.');
  const out: Lineup = { starters, bench };
  for (const k of ['captainId', 'penaltyTakerId'] as const) {
    if (o[k] === undefined || o[k] === null) continue;
    const s = id(o[k], k);
    if (!starters.includes(s) && !bench.includes(s)) fail(`${k} precisa estar entre os relacionados.`);
    out[k] = s;
  }
  // (Táticas) formação personalizada: 11 posições {x,y} ∈ [0,1] ou null; precisa da formação para fixar o goleiro
  if (o.positions !== undefined && o.positions !== null) {
    const pos = positions(o.positions, formation);
    if (pos) out.positions = pos;
  }
  return out;
}

/** (Táticas) posições personalizadas: estrito (tipos/tamanho/faixa); o goleiro e a zona do gol são corrigidos. */
export function positions(v: unknown, formation: Formation = '4-4-2'): (SlotPos | null)[] | null {
  try {
    return sanitizePositions(v, formation, true);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Posições inválidas.');
  }
}

/** (Táticas) as 3 predefinições do técnico: nome limpo, tática válida, posições válidas, XI do elenco. */
export function presets(v: unknown, squadIds: Set<string>): (TacticPreset | null)[] {
  if (!Array.isArray(v) || v.length > PRESET_SLOTS) return fail('Predefinições inválidas.');
  return v.map((raw, i) => {
    if (raw === null || raw === undefined) return null;
    const o = obj(raw, 'Predefinição');
    const t = tactic(o.tactic);
    if (o.positions !== undefined && o.positions !== null) positions(o.positions, t.formation);
    if (o.starters !== undefined && o.starters !== null) {
      if (!Array.isArray(o.starters) || o.starters.length !== 11) fail('Predefinição: XI inválido.');
      for (const s of o.starters as unknown[]) if (!squadIds.has(id(s, 'Predefinição'))) fail('Predefinição: jogador fora do elenco.');
    }
    if (typeof o.name !== 'string' || o.name.length > 64) fail('Predefinição: nome inválido.');
    return sanitizePreset({ ...o, name: cleanText(o.name as string) }, i, squadIds);
  });
}

/** Comando de partida. O `side` enviado pelo cliente é IGNORADO (o servidor deduz). */
export function matchCommand(v: unknown, side: 'home' | 'away'): MatchCommand {
  const o = obj(v, 'Comando');
  switch (o.type) {
    case 'substitute':
      return { type: 'substitute', side, outId: id(o.outId, 'outId'), inId: id(o.inId, 'inId') };
    case 'swap-slots':
      return { type: 'swap-slots', side, aId: id(o.aId, 'aId'), bId: id(o.bId, 'bId') };
    case 'set-shape':
      // a formação atual da partida é aplicada pelo motor; aqui só tipos/faixa (goleiro corrigido pelo motor)
      return { type: 'set-shape', side, positions: o.positions === null ? null : positions(o.positions) };
    case 'set-tactic': {
      const t = tacticPatch(o.tactic);
      if (!Object.keys(t).length) fail('Tática vazia.');
      return { type: 'set-tactic', side, tactic: t };
    }
    default:
      return fail('Comando desconhecido.');
  }
}
