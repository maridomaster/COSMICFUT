/**
 * Táticas, formações e escalação automática.
 * Puro e determinístico (sem RNG): mesma entrada ⇒ mesma escalação.
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { Formation, FormationSlot, Lineup, SlotRole, Tactic } from './contract';

/** Lista de formações suportadas, na ordem de exibição. */
export const FORMATIONS: Formation[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-5-1', '3-4-3'];

export const DEFAULT_TACTIC: Tactic = {
  formation: '4-4-2',
  mentality: 'balanced',
  tempo: 'normal',
  pressing: 'medium',
  passing: 'mixed',
};

/** Rótulos pt-BR curtos para a UI. */
export const SLOT_ROLE_LABEL: Record<SlotRole, string> = {
  GK: 'GOL', LB: 'LE', CB: 'ZAG', RB: 'LD', LWB: 'ALE', RWB: 'ALD', DM: 'VOL',
  CM: 'MC', LM: 'ME', RM: 'MD', AM: 'MEI', LW: 'PE', RW: 'PD', ST: 'ATA',
};

/** Setor do slot (usado pelo motor de partida). */
export type Sector = 'gk' | 'def' | 'mid' | 'att';
export const SLOT_SECTOR: Record<SlotRole, Sector> = {
  GK: 'gk', LB: 'def', CB: 'def', RB: 'def', LWB: 'def', RWB: 'def',
  DM: 'mid', CM: 'mid', LM: 'mid', RM: 'mid', AM: 'mid', LW: 'att', RW: 'att', ST: 'att',
};

const NATURAL: Record<SlotRole, Position[]> = {
  GK: ['GK'], LB: ['FB'], RB: ['FB'], LWB: ['FB'], RWB: ['FB'], CB: ['CB'],
  DM: ['MF'], CM: ['MF'], LM: ['MF'], RM: ['MF'], AM: ['MF'], LW: ['FW'], RW: ['FW'], ST: ['FW'],
};
/** (Táticas/Predefinições) posições naturais de cada papel — usado por match/shape.ts (formação personalizada). */
export const SLOT_NATURAL: Readonly<Record<SlotRole, readonly Position[]>> = NATURAL;

/** Eficácia posição do jogador → papel do slot. */
const FIT: Record<SlotRole, Record<Position, number>> = {
  GK: { GK: 1, FB: 0.2, CB: 0.2, MF: 0.2, FW: 0.2 },
  LB: { GK: 0.2, FB: 1, CB: 0.85, MF: 0.75, FW: 0.6 },
  RB: { GK: 0.2, FB: 1, CB: 0.85, MF: 0.75, FW: 0.6 },
  LWB: { GK: 0.2, FB: 1, CB: 0.7, MF: 0.85, FW: 0.7 },
  RWB: { GK: 0.2, FB: 1, CB: 0.7, MF: 0.85, FW: 0.7 },
  CB: { GK: 0.2, FB: 0.85, CB: 1, MF: 0.7, FW: 0.5 },
  DM: { GK: 0.2, FB: 0.75, CB: 0.85, MF: 1, FW: 0.55 },
  CM: { GK: 0.2, FB: 0.7, CB: 0.65, MF: 1, FW: 0.75 },
  LM: { GK: 0.2, FB: 0.85, CB: 0.6, MF: 1, FW: 0.85 },
  RM: { GK: 0.2, FB: 0.85, CB: 0.6, MF: 1, FW: 0.85 },
  AM: { GK: 0.2, FB: 0.6, CB: 0.5, MF: 1, FW: 0.85 },
  LW: { GK: 0.2, FB: 0.7, CB: 0.5, MF: 0.85, FW: 1 },
  RW: { GK: 0.2, FB: 0.7, CB: 0.5, MF: 0.85, FW: 1 },
  ST: { GK: 0.2, FB: 0.55, CB: 0.5, MF: 0.7, FW: 1 },
};

const SIDE_OF: Partial<Record<SlotRole, 'L' | 'R'>> = {
  LB: 'L', LWB: 'L', LM: 'L', LW: 'L', RB: 'R', RWB: 'R', RM: 'R', RW: 'R',
};

type RawSlot = [SlotRole, number, number];
const RAW: Record<Formation, RawSlot[]> = {
  '4-4-2': [
    ['GK', 0.5, 0.05],
    ['LB', 0.12, 0.25], ['CB', 0.37, 0.2], ['CB', 0.63, 0.2], ['RB', 0.88, 0.25],
    ['LM', 0.12, 0.52], ['CM', 0.38, 0.47], ['CM', 0.62, 0.47], ['RM', 0.88, 0.52],
    ['ST', 0.38, 0.8], ['ST', 0.62, 0.8],
  ],
  '4-3-3': [
    ['GK', 0.5, 0.05],
    ['LB', 0.12, 0.25], ['CB', 0.37, 0.2], ['CB', 0.63, 0.2], ['RB', 0.88, 0.25],
    ['CM', 0.3, 0.5], ['DM', 0.5, 0.4], ['CM', 0.7, 0.5],
    ['LW', 0.16, 0.78], ['ST', 0.5, 0.85], ['RW', 0.84, 0.78],
  ],
  '4-2-3-1': [
    ['GK', 0.5, 0.05],
    ['LB', 0.12, 0.25], ['CB', 0.37, 0.2], ['CB', 0.63, 0.2], ['RB', 0.88, 0.25],
    ['DM', 0.37, 0.41], ['DM', 0.63, 0.41],
    ['LW', 0.15, 0.66], ['AM', 0.5, 0.64], ['RW', 0.85, 0.66],
    ['ST', 0.5, 0.86],
  ],
  '3-5-2': [
    ['GK', 0.5, 0.05],
    ['CB', 0.25, 0.21], ['CB', 0.5, 0.18], ['CB', 0.75, 0.21],
    ['LWB', 0.1, 0.5], ['CM', 0.33, 0.48], ['DM', 0.5, 0.38], ['CM', 0.67, 0.48], ['RWB', 0.9, 0.5],
    ['ST', 0.38, 0.8], ['ST', 0.62, 0.8],
  ],
  '5-3-2': [
    ['GK', 0.5, 0.05],
    ['LWB', 0.1, 0.3], ['CB', 0.3, 0.2], ['CB', 0.5, 0.18], ['CB', 0.7, 0.2], ['RWB', 0.9, 0.3],
    ['CM', 0.28, 0.5], ['CM', 0.5, 0.45], ['CM', 0.72, 0.5],
    ['ST', 0.38, 0.8], ['ST', 0.62, 0.8],
  ],
  '4-5-1': [
    ['GK', 0.5, 0.05],
    ['LB', 0.12, 0.25], ['CB', 0.37, 0.2], ['CB', 0.63, 0.2], ['RB', 0.88, 0.25],
    ['LM', 0.12, 0.56], ['CM', 0.34, 0.5], ['DM', 0.5, 0.4], ['CM', 0.66, 0.5], ['RM', 0.88, 0.56],
    ['ST', 0.5, 0.83],
  ],
  '3-4-3': [
    ['GK', 0.5, 0.05],
    ['CB', 0.25, 0.21], ['CB', 0.5, 0.18], ['CB', 0.75, 0.21],
    ['LM', 0.12, 0.5], ['CM', 0.38, 0.46], ['CM', 0.62, 0.46], ['RM', 0.88, 0.5],
    ['LW', 0.18, 0.78], ['ST', 0.5, 0.85], ['RW', 0.82, 0.78],
  ],
};

const SLOT_CACHE = new Map<Formation, FormationSlot[]>();

/** Retorna os 11 slots da formação (GK, defesa esq→dir, meio esq→dir, ataque esq→dir). */
export function getFormationSlots(f: Formation): FormationSlot[] {
  let slots = SLOT_CACHE.get(f);
  if (!slots) {
    const raw = RAW[f] ?? RAW['4-4-2'];
    slots = raw.map(([role, x, y]) => ({ role, x, y, natural: [...NATURAL[role]] }));
    SLOT_CACHE.set(f, slots);
  }
  // cópia rasa para que a UI possa mutar sem afetar o cache
  return slots.map((s) => ({ ...s, natural: [...s.natural] }));
}

/** Slots internos sem cópia (uso do motor). */
export function formationSlotsRef(f: Formation): readonly FormationSlot[] {
  if (!SLOT_CACHE.has(f)) getFormationSlots(f);
  return SLOT_CACHE.get(f)!;
}

/** Eficácia 0..1 de um jogador num slot. */
export function slotFit(player: Player, slot: FormationSlot): number {
  let fit = FIT[slot.role]?.[player.position];
  if (fit === undefined) fit = slot.natural.includes(player.position) ? 1 : 0.6;
  const side = SIDE_OF[slot.role];
  if (side && player.side && player.side !== side && fit > 0.5) fit *= 0.95;
  return fit;
}

export interface AutoPickOptions {
  /** condição física 0..100 por jogador (padrão 100) */
  fitness?: Record<string, number>;
}

function fitnessFactor(f: number | undefined): number {
  if (f === undefined) return 1;
  if (f >= 85) return 1;
  // abaixo de 85 começa a pesar; 60 ⇒ ~0.8
  return Math.max(0.4, 1 - (85 - f) * 0.008);
}

/** IA: monta a melhor escalação para uma tática, respeitando lesão/suspensão (`unavailable`). */
export function autoPickLineup(
  players: Player[],
  tactic: Tactic,
  unavailable?: Set<string>,
  opts?: AutoPickOptions,
): Lineup {
  const slots = formationSlotsRef(tactic.formation);
  const pool = players
    .filter((p) => !unavailable || !unavailable.has(p.id))
    .slice()
    .sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ff = (p: Player) => fitnessFactor(opts?.fitness?.[p.id]);
  const score = (p: Player, s: FormationSlot) => {
    const fit = slotFit(p, s);
    return p.overall * fit * ff(p) * (s.role === 'GK' && p.position !== 'GK' ? 0.5 : 1);
  };

  const assign: (Player | null)[] = new Array(slots.length).fill(null);
  const used = new Set<string>();

  // 1) guloso global sobre pares (slot, jogador)
  const pairs: { s: number; p: Player; v: number }[] = [];
  for (let s = 0; s < slots.length; s++) for (const p of pool) pairs.push({ s, p, v: score(p, slots[s]) });
  pairs.sort((a, b) => b.v - a.v || a.s - b.s || (a.p.id < b.p.id ? -1 : 1));
  for (const { s, p } of pairs) {
    if (assign[s] || used.has(p.id)) continue;
    assign[s] = p;
    used.add(p.id);
  }

  // 2) melhoria local: trocas entre slots e com reservas
  const slotScore = (i: number) => (assign[i] ? score(assign[i]!, slots[i]) : 0);
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = assign[i], b = assign[j];
        if (!a || !b) continue;
        const before = slotScore(i) + slotScore(j);
        const after = score(b, slots[i]) + score(a, slots[j]);
        if (after > before + 1e-9) {
          assign[i] = b; assign[j] = a; improved = true;
        }
      }
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const cur = assign[i];
        if (score(p, slots[i]) > slotScore(i) + 1e-9) {
          if (cur) used.delete(cur.id);
          assign[i] = p; used.add(p.id); improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const starters = assign.filter((p): p is Player => !!p);
  const starterIds = assign.map((p) => (p ? p.id : '')).filter(Boolean);

  // Reservas: 1 goleiro, depois cobertura por posição, depois os melhores restantes
  const rest = pool.filter((p) => !used.has(p.id));
  const bench: Player[] = [];
  const take = (pred: (p: Player) => boolean) => {
    const best = rest
      .filter((p) => !bench.includes(p) && pred(p))
      .sort((a, b) => b.overall * ff(b) - a.overall * ff(a))[0];
    if (best && bench.length < 9) bench.push(best);
  };
  take((p) => p.position === 'GK');
  for (const pos of ['CB', 'FB', 'MF', 'FW', 'MF', 'FW'] as Position[]) take((p) => p.position === pos);
  while (bench.length < 9) {
    const before = bench.length;
    take((p) => p.position !== 'GK');
    if (bench.length === before) break;
  }

  // Capitão: mais experiente entre os melhores
  const captain = starters
    .slice()
    .sort((a, b) => b.overall + Math.min(b.age, 34) * 0.4 - (a.overall + Math.min(a.age, 34) * 0.4))[0];
  // Batedor: Finalização (9) > atacante > melhor de linha
  const pen = starters
    .filter((p) => p.position !== 'GK')
    .sort((a, b) => penScore(b) - penScore(a))[0];

  return {
    starters: starterIds,
    bench: bench.map((p) => p.id),
    captainId: captain?.id,
    penaltyTakerId: pen?.id,
  };
}

function penScore(p: Player): number {
  return p.overall + (p.traits.includes(9) ? 8 : 0) + (p.position === 'FW' ? 4 : p.position === 'MF' ? 2 : 0) + (p.star ? 2 : 0);
}

/** Força média da escalação (overall × fit), útil para a UI e a IA. */
export function lineupStrength(players: Player[], lineup: Lineup, formation: Formation): number {
  const slots = formationSlotsRef(formation);
  const byId = new Map(players.map((p) => [p.id, p]));
  let sum = 0;
  for (let i = 0; i < slots.length; i++) {
    const p = byId.get(lineup.starters[i]);
    if (p) sum += p.overall * slotFit(p, slots[i]);
  }
  return sum / slots.length;
}
