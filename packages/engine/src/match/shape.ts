/**
 * (Táticas avançadas) Formação personalizada, zonas táticas, improvisação, equilíbrio de setores,
 * escalação automática ("Melhor Elenco" / "Descansar Time") e predefinições táticas.
 *
 * Puro e determinístico (sem RNG). Usado pelo motor (simulation.ts → `shapeSlots`/`shapeBalance`),
 * pela UI de táticas (indicadores ao vivo) e pelo servidor (validação de `Lineup.positions`).
 *
 * Modelo:
 *  - Cada formação tem 11 slots fixos (tactics.ts). `Lineup.positions[i]` move o slot i para (x, y);
 *    o PAPEL do slot passa a ser o da zona onde ele caiu (`detectRole`). Slot sem posição = padrão.
 *    O slot do goleiro é fixo e nenhum slot de linha pode cair na zona do gol.
 *  - Improvisação: o rendimento do jogador é `overall × slotFit(jogador, papel)` (já era a regra do motor);
 *    a perda cresce com a distância entre a posição natural e o papel da zona (LD→LE ~5%, ZAG→ATA 50%).
 *  - Equilíbrio de setores: contagem defesa/meio/ataque do desenho. Formações padrão são neutras
 *    (multiplicadores exatamente 1 ⇒ resultados idênticos). Buracos na defesa/meio ou ataque inchado
 *    reduzem o controle do meio-campo e a solidez defensiva (mais chances do adversário, contra-ataques),
 *    e cada setor satura (retorno decrescente acima de 120% do 4-4-2) para não premiar "6 atacantes".
 */
import type { Player } from '@cosmicfut/shared';
import type { Formation, FormationSlot, Lineup, SlotPos, SlotRole, Tactic, TacticPreset } from '../contract';
import { DEFAULT_TACTIC, FORMATIONS, formationSlotsRef, SLOT_NATURAL, SLOT_SECTOR, slotFit } from '../tactics';
import { NORM, ROLE_W, staminaFactor } from './model';

/* ───────────────────────── zonas ───────────────────────── */

/** As 10 zonas da UI (pt-BR) e o papel do motor correspondente. */
export type TacticalZone = 'GOL' | 'ZAG' | 'LD' | 'LE' | 'VOL' | 'MC' | 'MEI' | 'PD' | 'PE' | 'ATA';
export const ZONE_ROLE: Record<TacticalZone, SlotRole> = {
  GOL: 'GK', ZAG: 'CB', LD: 'RB', LE: 'LB', VOL: 'DM', MC: 'CM', MEI: 'AM', PD: 'RW', PE: 'LW', ATA: 'ST',
};

/** Limites das zonas (y = profundidade a partir do gol próprio; x = largura, 0 = esquerda). */
export const ZONE_BOUNDS = {
  /** abaixo disto é a zona do goleiro */
  gk: 0.12,
  /** linha de defesa (ZAG/LE/LD) */
  def: 0.33,
  /** faixa dos alas (ALE/ALD) e do volante */
  wingBack: 0.45,
  /** meio (ME/MD/MC) */
  mid: 0.6,
  /** meia ofensivo (MEI) / pontas */
  attMid: 0.72,
  /** corredores laterais: x < wide ou x > 1 − wide */
  wide: 0.25,
  /** corredor das pontas no ataque (mais largo) */
  wideAtt: 0.3,
} as const;

/** Limites de arrasto de um slot de linha (fora da zona do gol). */
export const OUTFIELD_MIN_Y = 0.13;

/**
 * Papel tático da posição (x, y). Usa as 10 zonas da UI e 2 refinamentos que o motor já conhecia:
 * ALE/ALD (faixa entre a defesa e o meio, nos corredores) e ME/MD (meio, nos corredores).
 */
export function detectRole(x: number, y: number): SlotRole {
  const B = ZONE_BOUNDS;
  if (y < B.gk) return 'GK';
  const left = x < B.wide, right = x > 1 - B.wide;
  if (y < B.def) return left ? 'LB' : right ? 'RB' : 'CB';
  if (y < B.wingBack) return left ? 'LWB' : right ? 'RWB' : 'DM';
  if (y < B.mid) return left ? 'LM' : right ? 'RM' : 'CM';
  const aLeft = x < B.wideAtt, aRight = x > 1 - B.wideAtt;
  if (y < B.attMid) return aLeft ? 'LW' : aRight ? 'RW' : 'AM';
  return aLeft ? 'LW' : aRight ? 'RW' : 'ST';
}

/** Zona (uma das 10) de um papel. Alas e meias abertos caem na zona do lado. */
export function roleZone(role: SlotRole): TacticalZone {
  switch (role) {
    case 'GK': return 'GOL';
    case 'CB': return 'ZAG';
    case 'LB': case 'LWB': return 'LE';
    case 'RB': case 'RWB': return 'LD';
    case 'DM': return 'VOL';
    case 'CM': return 'MC';
    case 'LM': return 'PE';
    case 'RM': return 'PD';
    case 'AM': return 'MEI';
    case 'LW': return 'PE';
    case 'RW': return 'PD';
    case 'ST': return 'ATA';
  }
}

export function detectZone(x: number, y: number): TacticalZone {
  return roleZone(detectRole(x, y));
}

/* ───────────────────────── posições personalizadas ───────────────────────── */

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Limpa `Lineup.positions` vindo da UI, de um save ou da rede. Devolve null se não houver nada a aplicar.
 * Regras: 11 entradas (null ou {x, y} finitos); slot do goleiro sempre null; x ∈ [0.03, 0.97],
 * y ∈ [0.13, 0.95] (nenhum jogador de linha na zona do gol); 3 casas decimais.
 * `strict` lança erro em vez de descartar (validação do servidor).
 */
export function sanitizePositions(raw: unknown, formation: Formation = '4-4-2', strict = false): (SlotPos | null)[] | null {
  const bad = (msg: string): null => {
    if (strict) throw new Error(msg);
    return null;
  };
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return bad('Posições inválidas.');
  if (raw.length !== 11) return bad('Posições: são necessárias 11 entradas.');
  const base = formationSlotsRef(FORMATIONS.includes(formation) ? formation : '4-4-2');
  const out: (SlotPos | null)[] = [];
  let any = false;
  for (let i = 0; i < 11; i++) {
    const e = raw[i] as unknown;
    if (e === null || e === undefined) {
      out.push(null);
      continue;
    }
    if (typeof e !== 'object') return bad('Posição inválida.');
    const { x, y } = e as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return bad('Posição inválida.');
    if (strict && (x < 0 || x > 1 || y < 0 || y > 1)) return bad('Posição fora do campo.');
    if (base[i]?.role === 'GK') {
      out.push(null);
      continue;
    }
    out.push({ x: r3(clamp(x, 0.03, 0.97)), y: r3(clamp(y, OUTFIELD_MIN_Y, 0.95)) });
    any = true;
  }
  return any ? out : null;
}

/**
 * Slots efetivos de uma formação com posições personalizadas. Sem posições ⇒ devolve EXATAMENTE
 * `formationSlotsRef(f)` (mesma referência: o motor fica idêntico ao de antes).
 */
export function shapeSlots(f: Formation, positions?: readonly (SlotPos | null | undefined)[] | null): readonly FormationSlot[] {
  const base = formationSlotsRef(f);
  const pos = positions ? sanitizePositions(positions, f) : null;
  if (!pos) return base;
  return base.map((s, i) => {
    const p = pos[i];
    if (!p || s.role === 'GK') return s;
    const role = detectRole(p.x, p.y);
    return { role, x: p.x, y: p.y, natural: [...SLOT_NATURAL[role]] };
  });
}

/* ───────────────────────── improvisação ───────────────────────── */

export interface Improvisation {
  /** eficácia 0..1 (slotFit) */
  fit: number;
  /** pontos de overall perdidos no papel (overall − overall × fit) */
  penalty: number;
  /** jogador fora da posição natural */
  improvised: boolean;
}

/**
 * Penalidade de improvisação de um jogador num slot. Reaproveita `slotFit` (a regra que o motor já usa):
 * natural = 0; lado trocado (LD na LE) ≈ −5%; vizinho (ZAG na LE/VOL) −15%; longe (ZAG no ATA) −50%.
 */
export function improvisation(p: Player, slot: FormationSlot): Improvisation {
  const fit = slotFit(p, slot);
  const penalty = Math.round(p.overall * (1 - fit));
  return { fit, penalty, improvised: fit < 0.999 };
}

/** Atalho: penalidade num papel (sem posição). */
export function rolePenalty(p: Player, role: SlotRole): number {
  return improvisation(p, { role, x: 0.5, y: 0.5, natural: [...SLOT_NATURAL[role]] }).penalty;
}

/* ───────────────────────── equilíbrio de setores ───────────────────────── */

export const SHAPE_COEF = {
  /** mínimos sem penalidade */
  minDef: 3,
  minMid: 3,
  maxAtt: 3,
  minAtt: 1,
  /**
   * Solidez defensiva perdida (QUADRÁTICA no tamanho do buraco: um desenho ousado custa pouco, um extremo custa
   * muito) por defensor faltando / atacante sobrando, e linear por meia faltando.
   * O modelo de papéis (ROLE_W) já desloca força entre setores; isto é o custo EXTRA de desequilíbrio.
   */
  defPerDefGap: 0.06,
  defPerMidGap: 0.01,
  defPerOverload: 0.02,
  /** controle do meio perdido (quadrático) por meia faltando / atacante sobrando */
  midPerMidGap: 0.03,
  midPerOverload: 0.015,
  /** ataque perdido sem nenhum atacante */
  attPerAttGap: 0.08,
  /** saturação: acima de `satAt` (× soma de pesos do 4-4-2) cada setor rende só `satK` */
  satAt: 1.2,
  satK: 0.35,
  floor: 0.6,
} as const;

export interface ShapeBalance {
  /** multiplicadores aplicados à força de defesa/meio/ataque (1 = neutro) */
  def: number;
  mid: number;
  att: number;
  counts: { def: number; mid: number; att: number };
  /** avisos pt-BR para a UI */
  issues: string[];
  neutral: boolean;
}

const BAL_CACHE = new WeakMap<readonly FormationSlot[], ShapeBalance>();

function saturation(ratio: number): number {
  const C = SHAPE_COEF;
  if (ratio <= C.satAt) return 1;
  return (C.satAt + (ratio - C.satAt) * C.satK) / ratio;
}

/** Equilíbrio do desenho (só depende dos papéis dos slots). Memoizado por array de slots. */
export function shapeBalance(slots: readonly FormationSlot[]): ShapeBalance {
  const hit = BAL_CACHE.get(slots);
  if (hit) return hit;
  const C = SHAPE_COEF;
  const counts = { def: 0, mid: 0, att: 0 };
  const w = { def: 0, mid: 0, att: 0 };
  for (const s of slots) {
    const sec = SLOT_SECTOR[s.role];
    if (sec === 'gk') continue;
    counts[sec]++;
    const rw = ROLE_W[s.role];
    w.def += rw.def; w.mid += rw.mid; w.att += rw.att;
  }
  const defGap = Math.max(0, C.minDef - counts.def);
  const midGap = Math.max(0, C.minMid - counts.mid);
  const overload = Math.max(0, counts.att - C.maxAtt);
  const attGap = Math.max(0, C.minAtt - counts.att);
  const issues: string[] = [];
  if (defGap) issues.push(`Defesa desguarnecida: só ${counts.def} defensor${counts.def === 1 ? '' : 'es'} (mín. ${C.minDef})`);
  if (midGap) issues.push(`Meio-campo vazio: só ${counts.mid} no meio (mín. ${C.minMid}) — perde controle do jogo`);
  if (overload) issues.push(`Ataque inchado: ${counts.att} atacantes — exposto a contra-ataques`);
  if (attGap) issues.push('Nenhum atacante: o time quase não finaliza');
  const satDef = saturation(w.def / NORM.def), satMid = saturation(w.mid / NORM.mid), satAtt = saturation(w.att / NORM.att);
  if (satAtt < 1 || satDef < 1 || satMid < 1) issues.push('Setor sobrecarregado: jogadores a mais rendem menos');
  const def = Math.max(C.floor, 1 - C.defPerDefGap * defGap ** 2 - C.defPerMidGap * midGap - C.defPerOverload * overload ** 2) * satDef;
  const mid = Math.max(C.floor, 1 - C.midPerMidGap * midGap ** 2 - C.midPerOverload * overload ** 2) * satMid;
  const att = Math.max(C.floor, 1 - C.attPerAttGap * attGap) * satAtt;
  const out: ShapeBalance = { def, mid, att, counts, issues, neutral: def === 1 && mid === 1 && att === 1 };
  BAL_CACHE.set(slots, out);
  return out;
}

/* ───────────────────────── força por setor (UI) ───────────────────────── */

export interface ShapeStrength {
  def: number;
  mid: number;
  att: number;
  gk: number;
  balance: ShapeBalance;
}

/**
 * Força por setor como o motor calcula (computeStrength), sem mando/moral nem traits:
 * Σ peso do papel × overall × slotFit × fator de stamina, normalizada pelo 4-4-2, × equilíbrio do desenho.
 */
export function shapeStrength(slots: readonly FormationSlot[], starters: readonly (Player | undefined)[], fitness?: Record<string, number>): ShapeStrength {
  let def = 0, mid = 0, att = 0, gk = 0;
  slots.forEach((slot, i) => {
    const p = starters[i];
    if (!p) return;
    const eff = p.overall * slotFit(p, slot) * staminaFactor(fitness?.[p.id] ?? 100);
    if (slot.role === 'GK') {
      gk = eff;
      return;
    }
    const w = ROLE_W[slot.role];
    def += w.def * eff; mid += w.mid * eff; att += w.att * eff;
  });
  const balance = shapeBalance(slots);
  return { def: (def / NORM.def) * balance.def, mid: (mid / NORM.mid) * balance.mid, att: (att / NORM.att) * balance.att, gk, balance };
}

/* ───────────────────────── escalação automática ───────────────────────── */

export interface PickOptions {
  /** condição física 0..100 */
  fitness?: Record<string, number>;
  /** lesionados/suspensos (fora da escolha) */
  unavailable?: Set<string>;
  /** escalação atual: mantém posições personalizadas, capitão e batedor quando possível */
  current?: Lineup | null;
}

const BIG = 1e6;

/** Atribuição ótima (Hungarian, O(n²m)), linhas ≤ colunas. Minimiza o custo; devolve coluna por linha. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length, m = cost[0]?.length ?? 0;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0), way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

/** Overall efetivo em campo (o que o motor usa): overall × slotFit × fator de stamina. */
export function slotEffectiveOverall(p: Player, slot: FormationSlot, fitness?: number): number {
  return p.overall * slotFit(p, slot) * staminaFactor(fitness ?? 100);
}

function assignXI(pool: Player[], slots: readonly FormationSlot[], value: (p: Player, s: FormationSlot) => number): (Player | null)[] {
  const cols = pool.slice();
  // completa com "vazios" se faltarem jogadores
  const m = Math.max(cols.length, slots.length);
  const cost = slots.map((s) => {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      const p = cols[j];
      if (!p) { row.push(BIG); continue; }
      const gkSlot = s.role === 'GK', gk = p.position === 'GK';
      // goleiro nunca na linha e jogador de linha só no gol se não houver goleiro (custo enorme, não proibido)
      row.push(-value(p, s) + (gkSlot !== gk ? BIG / 10 : 0));
    }
    return row;
  });
  const a = hungarian(cost);
  return a.map((j) => (j >= 0 ? cols[j] ?? null : null));
}

function finishLineup(xi: (Player | null)[], pool: Player[], opts: PickOptions, benchValue: (p: Player) => number): Lineup {
  const starters = xi.filter((p): p is Player => !!p);
  const ids = new Set(starters.map((p) => p.id));
  const rest = pool.filter((p) => !ids.has(p.id));
  const bench: Player[] = [];
  const take = (pred: (p: Player) => boolean) => {
    const best = rest.filter((p) => !bench.includes(p) && pred(p)).sort((a, b) => benchValue(b) - benchValue(a) || (a.id < b.id ? -1 : 1))[0];
    if (best && bench.length < 9) bench.push(best);
  };
  take((p) => p.position === 'GK');
  for (const pos of ['CB', 'FB', 'MF', 'FW', 'MF', 'FW'] as const) take((p) => p.position === pos);
  while (bench.length < 9) {
    const before = bench.length;
    take((p) => p.position !== 'GK');
    if (bench.length === before) break;
  }
  const cur = opts.current;
  const keep = (id: string | undefined) => (id && ids.has(id) ? id : undefined);
  const captain = keep(cur?.captainId) ?? starters.slice().sort((a, b) => b.overall + Math.min(b.age, 34) * 0.4 - (a.overall + Math.min(a.age, 34) * 0.4))[0]?.id;
  const penScore = (p: Player) => p.overall + (p.traits.includes(9) ? 8 : 0) + (p.position === 'FW' ? 4 : p.position === 'MF' ? 2 : 0) + (p.star ? 2 : 0);
  const pen = keep(cur?.penaltyTakerId) ?? starters.filter((p) => p.position !== 'GK').sort((a, b) => penScore(b) - penScore(a))[0]?.id;
  const out: Lineup = { starters: xi.map((p) => p?.id ?? '').filter(Boolean), bench: bench.map((p) => p.id) };
  if (captain) out.captainId = captain;
  if (pen) out.penaltyTakerId = pen;
  if (cur?.positions) out.positions = cur.positions.map((p) => (p ? { ...p } : null));
  return out;
}

function sortedPool(players: Player[], unavailable?: Set<string>): Player[] {
  return players.filter((p) => !unavailable?.has(p.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * "Melhor Elenco" (força máxima): os 11 disponíveis com a MAIOR soma de overall efetivo nos slots
 * (overall × adequação × stamina), atribuição ótima (Hungarian). Goleiro só no gol.
 */
export function pickBestXI(players: Player[], slots: readonly FormationSlot[], opts: PickOptions = {}): Lineup {
  const pool = sortedPool(players, opts.unavailable);
  const fit = (p: Player) => opts.fitness?.[p.id];
  const xi = assignXI(pool, slots, (p, s) => slotEffectiveOverall(p, s, fit(p)));
  return finishLineup(xi, pool, opts, (p) => p.overall * staminaFactor(fit(p) ?? 100));
}

/** Pesos do "Descansar Time". */
export const REST_COEF = { fitness: 1.2, quality: 0.6, offPosition: 12 } as const;

/**
 * "Descansar Time" (time reserva / foco em stamina): prioriza a condição física (descansa titulares cansados),
 * mas ainda prefere posições naturais entre os mais descansados. Goleiro nunca na linha e vice-versa.
 */
export function pickRestXI(players: Player[], slots: readonly FormationSlot[], opts: PickOptions = {}): Lineup {
  const pool = sortedPool(players, opts.unavailable);
  const fit = (p: Player) => opts.fitness?.[p.id] ?? 100;
  const C = REST_COEF;
  const xi = assignXI(pool, slots, (p, s) => {
    const f = slotFit(p, s);
    return C.fitness * fit(p) + C.quality * p.overall * f - (f < 0.85 ? C.offPosition : 0);
  });
  return finishLineup(xi, pool, opts, (p) => p.overall * staminaFactor(fit(p)));
}

/** Pesos do "Time Reserva". */
export const RESERVE_COEF = { natural: 200, adapted: 100, notStarter: 60, fitTie: 40 } as const;

/**
 * (18/11) "Time Reserva": o time mais fraco POSIÇÃO POR POSIÇÃO, como um time reserva de verdade — cada vaga com um
 * jogador da posição (natural > adaptado; improvisar só se faltar gente), de preferência quem não está no "Melhor
 * Elenco", e entre esses o de MENOR overall. Os titulares vão para o banco. Lesionados/suspensos ficam de fora.
 */
export function pickReserveXI(players: Player[], slots: readonly FormationSlot[], opts: PickOptions = {}): Lineup {
  const pool = sortedPool(players, opts.unavailable);
  const best = new Set(pickBestXI(players, slots, opts).starters);
  const C = RESERVE_COEF;
  const xi = assignXI(pool, slots, (p, s) => {
    const f = slotFit(p, s);
    // + f×C.fitTie: entre arrumações equivalentes, cada um no seu lado (pé bom) — LD destro, LE canhoto
    return (f >= 0.95 ? C.natural : f >= 0.85 ? C.adapted : 0) + (best.has(p.id) ? 0 : C.notStarter) - p.overall + f * C.fitTie;
  });
  const fit = (p: Player) => opts.fitness?.[p.id] ?? 100;
  return finishLineup(xi, pool, opts, (p) => p.overall * staminaFactor(fit(p)));
}

/** Soma do overall efetivo do XI (para comparar escalações / testes). */
export function lineupEffectiveSum(players: Player[], slots: readonly FormationSlot[], starters: readonly string[], fitness?: Record<string, number>): number {
  const byId = new Map(players.map((p) => [p.id, p]));
  let sum = 0;
  slots.forEach((s, i) => {
    const p = byId.get(starters[i]);
    if (p) sum += slotEffectiveOverall(p, s, fitness?.[p.id]);
  });
  return sum;
}

/* ───────────────────────── predefinições ───────────────────────── */

export const PRESET_SLOTS = 3;
export const PRESET_NAME_MAX = 24;

const MENT = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'all-out'];
const TEMPO = ['slow', 'normal', 'fast'];
const PRESS = ['low', 'medium', 'high'];
const PASS = ['short', 'mixed', 'direct'];

function cleanTactic(raw: unknown): Tactic | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (!FORMATIONS.includes(t.formation as Formation)) return null;
  const pick = (v: unknown, list: string[], d: string) => (typeof v === 'string' && list.includes(v) ? v : d);
  return {
    formation: t.formation as Formation,
    mentality: pick(t.mentality, MENT, DEFAULT_TACTIC.mentality) as Tactic['mentality'],
    tempo: pick(t.tempo, TEMPO, DEFAULT_TACTIC.tempo) as Tactic['tempo'],
    pressing: pick(t.pressing, PRESS, DEFAULT_TACTIC.pressing) as Tactic['pressing'],
    passing: pick(t.passing, PASS, DEFAULT_TACTIC.passing) as Tactic['passing'],
  };
}

const INVISIBLE = new RegExp(
  '[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
    .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`)
    .join('') + ']',
  'g',
);

/** Nome limpo (sem controles/marcação), 1..24 caracteres. */
export function cleanPresetName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // controles C0/C1, zero-width, bidi e BOM (montados por código: sem literais invisíveis no fonte)
  const s = raw.normalize('NFKC').replace(INVISIBLE, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, PRESET_NAME_MAX).trim() : fallback;
}

/** Limpa uma predefinição (null se inválida). `squadIds` filtra o XI salvo (jogador vendido ⇒ XI descartado). */
export function sanitizePreset(raw: unknown, index = 0, squadIds?: Set<string>): TacticPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const tactic = cleanTactic(o.tactic);
  if (!tactic) return null;
  const out: TacticPreset = { name: cleanPresetName(o.name, `Predefinição ${index + 1}`), tactic };
  const pos = sanitizePositions(o.positions, tactic.formation);
  if (pos) out.positions = pos;
  if (Array.isArray(o.starters) && o.starters.length === 11 && o.starters.every((x) => typeof x === 'string' && x.length <= 96)) {
    const st = o.starters as string[];
    if (new Set(st).size === 11 && (!squadIds || st.every((id) => squadIds.has(id)))) out.starters = st.slice();
  }
  if (typeof o.savedAt === 'string' && o.savedAt.length <= 40) out.savedAt = o.savedAt;
  return out;
}

/** Normaliza as 3 vagas (migração de saves antigos: ausente ⇒ [null, null, null]). */
export function normalizePresets(raw: unknown, squadIds?: Set<string>): (TacticPreset | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: PRESET_SLOTS }, (_, i) => sanitizePreset(arr[i], i, squadIds));
}

/** Cria a predefinição a partir do estado atual. */
export function makePreset(name: string, tactic: Tactic, lineup: Lineup | null, includeXI: boolean, savedAt?: string): TacticPreset {
  const p: TacticPreset = { name: cleanPresetName(name, 'Predefinição'), tactic: { ...tactic } };
  const pos = sanitizePositions(lineup?.positions, tactic.formation);
  if (pos) p.positions = pos;
  if (includeXI && lineup && lineup.starters.length === 11) p.starters = lineup.starters.slice();
  if (savedAt) p.savedAt = savedAt;
  return p;
}

/**
 * Aplica uma predefinição: tática + posições; o XI salvo entra só com jogadores DISPONÍVEIS
 * (o lugar de um indisponível é preenchido pelo melhor reserva/fora na vaga). Banco recalculado sem repetir titulares.
 */
export function applyPreset(
  preset: TacticPreset,
  current: Lineup | null,
  players: Player[],
  opts: { unavailable?: Set<string>; fitness?: Record<string, number> } = {},
): { tactic: Tactic; lineup: Lineup | null } {
  const tactic = { ...preset.tactic };
  const positions = sanitizePositions(preset.positions, tactic.formation);
  const slots = shapeSlots(tactic.formation, positions);
  const byId = new Map(players.map((p) => [p.id, p]));
  const ok = (id: string | undefined) => !!id && byId.has(id) && !opts.unavailable?.has(id);
  let starters: (string | null)[] | null = null;
  if (preset.starters && preset.starters.length === 11) starters = preset.starters.map((id) => (ok(id) ? id : null));
  else if (current && current.starters.length === 11) starters = null; // mantém os titulares, redistribui nos slots
  let lineup: Lineup | null;
  if (starters) {
    const used = new Set(starters.filter((x): x is string => !!x));
    const pool = players.filter((p) => !used.has(p.id) && !opts.unavailable?.has(p.id));
    for (let i = 0; i < 11; i++) {
      if (starters[i]) continue;
      const s = slots[i];
      const best = pool
        .filter((p) => !used.has(p.id) && (s.role === 'GK') === (p.position === 'GK'))
        .sort((a, b) => slotEffectiveOverall(b, s, opts.fitness?.[b.id]) - slotEffectiveOverall(a, s, opts.fitness?.[a.id]) || (a.id < b.id ? -1 : 1))[0];
      if (best) { starters[i] = best.id; used.add(best.id); }
    }
    const st = starters.filter((x): x is string => !!x);
    const bench = (current?.bench ?? []).filter((id) => !used.has(id) && byId.has(id)).slice(0, 9);
    lineup = { ...(current ?? { bench: [] }), starters: st, bench };
    if (lineup.captainId && !used.has(lineup.captainId)) delete lineup.captainId;
    if (lineup.penaltyTakerId && !used.has(lineup.penaltyTakerId)) delete lineup.penaltyTakerId;
  } else if (current && current.starters.length === 11) {
    // mesmos 11, redistribuídos pelos slots da predefinição (atribuição ótima)
    const xiPlayers = current.starters.map((id) => byId.get(id)).filter((p): p is Player => !!p);
    const xi = assignXI(xiPlayers, slots, (p, s) => slotEffectiveOverall(p, s, opts.fitness?.[p.id]));
    lineup = { ...current, starters: xi.map((p) => p?.id ?? '').filter(Boolean) };
  } else lineup = current ? { ...current } : null;
  if (lineup) {
    if (positions) lineup.positions = positions;
    else delete lineup.positions;
  }
  return { tactic, lineup };
}
