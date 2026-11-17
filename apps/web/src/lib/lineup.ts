/** Helpers de UI para escalação/tática (sem regras de jogo: essas ficam em @cosmicfut/engine). */
import type { Player } from '@cosmicfut/shared';
import { slotFit, type FormationSlot, type Lineup, type Mentality, type Passing, type Pressing, type SlotRole, type Tempo } from '@cosmicfut/engine';

export type LineupStatus = 'starter' | 'bench' | 'out';

export const STATUS_META: Record<LineupStatus, { label: string; short: string; color: string }> = {
  starter: { label: 'Titular', short: 'TIT', color: 'var(--color-success)' },
  bench: { label: 'Reserva', short: 'RES', color: 'var(--color-warning)' },
  out: { label: 'Fora', short: 'FORA', color: 'var(--color-fg-subtle)' },
};

export function statusOf(lineup: Lineup | null, id: string): LineupStatus {
  if (!lineup) return 'out';
  if (lineup.starters.includes(id)) return 'starter';
  if (lineup.bench.includes(id)) return 'bench';
  return 'out';
}

export const ROLE_LABEL: Record<SlotRole, string> = {
  GK: 'GOL', LB: 'LE', CB: 'ZAG', RB: 'LD', LWB: 'ALE', RWB: 'ALD', DM: 'VOL',
  CM: 'MC', LM: 'ME', RM: 'MD', AM: 'MEI', LW: 'PE', RW: 'PD', ST: 'ATA',
};

export type Sector = 'gk' | 'def' | 'mid' | 'att';
export const ROLE_SECTOR: Record<SlotRole, Sector> = {
  GK: 'gk', LB: 'def', CB: 'def', RB: 'def', LWB: 'def', RWB: 'def',
  DM: 'mid', CM: 'mid', LM: 'mid', RM: 'mid', AM: 'mid', LW: 'att', RW: 'att', ST: 'att',
};

/** Faixas de adequação ao slot → cor do anel da ficha. */
export type FitLevel = 'natural' | 'adapted' | 'wrong';
export function fitLevel(fit: number): FitLevel {
  if (fit >= 0.95) return 'natural';
  if (fit >= 0.7) return 'adapted';
  return 'wrong';
}
export const FIT_META: Record<FitLevel, { label: string; color: string }> = {
  natural: { label: 'Natural', color: 'var(--color-success)' },
  adapted: { label: 'Adaptado', color: 'var(--color-warning)' },
  wrong: { label: 'Fora de posição', color: 'var(--color-danger)' },
};

/** "Gabriel Barbosa" → "G. Barbosa"; nomes de uma palavra ficam como estão. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const last = parts[parts.length - 1];
  const particle = parts.length > 2 && /^(da|de|do|dos|das|van|von|del|di)$/i.test(parts[parts.length - 2]) ? parts[parts.length - 2] + ' ' : '';
  const s = `${parts[0][0]}. ${particle}${last}`;
  return s.length > 14 ? last : s;
}

export interface TeamIndicators {
  avgOverall: number;
  /** força efetiva (overall × fit) por setor, 0..99 */
  defense: number;
  midfield: number;
  attack: number;
  /** média do slotFit 0..1 */
  fit: number;
  alerts: { level: 'danger' | 'warning' | 'info'; text: string }[];
}

export function computeIndicators(lineup: Lineup | null, slots: FormationSlot[], byId: Map<string, Player>): TeamIndicators {
  const alerts: TeamIndicators['alerts'] = [];
  if (!lineup) return { avgOverall: 0, defense: 0, midfield: 0, attack: 0, fit: 0, alerts };
  const acc: Record<Sector, { sum: number; n: number }> = { gk: { sum: 0, n: 0 }, def: { sum: 0, n: 0 }, mid: { sum: 0, n: 0 }, att: { sum: 0, n: 0 } };
  let ovr = 0;
  let fitSum = 0;
  let wrong = 0;
  let adapted = 0;
  let count = 0;
  slots.forEach((slot, i) => {
    const p = byId.get(lineup.starters[i]);
    if (!p) return;
    const fit = slotFit(p, slot);
    count++;
    ovr += p.overall;
    fitSum += fit;
    const sec = ROLE_SECTOR[slot.role];
    acc[sec].sum += p.overall * fit;
    acc[sec].n++;
    if (slot.role === 'GK' && p.position !== 'GK') alerts.push({ level: 'danger', text: `Goleiro fora de posição: ${p.name} no gol` });
    else if (p.position === 'GK' && slot.role !== 'GK') alerts.push({ level: 'danger', text: `${p.name} é goleiro e está na linha` });
    else if (fitLevel(fit) === 'wrong') wrong++;
    else if (fitLevel(fit) === 'adapted') adapted++;
  });
  if (count < 11) alerts.push({ level: 'danger', text: `Escalação incompleta (${count}/11)` });
  if (wrong) alerts.push({ level: 'warning', text: `${wrong} jogador${wrong > 1 ? 'es' : ''} fora de posição` });
  if (adapted) alerts.push({ level: 'info', text: `${adapted} jogador${adapted > 1 ? 'es' : ''} adaptado${adapted > 1 ? 's' : ''}` });
  if (!lineup.bench.some((id) => byId.get(id)?.position === 'GK')) alerts.push({ level: 'warning', text: 'Nenhum goleiro no banco' });
  if (!lineup.captainId || !lineup.starters.includes(lineup.captainId)) alerts.push({ level: 'warning', text: 'Capitão não definido entre os titulares' });
  if (!lineup.penaltyTakerId || !lineup.starters.includes(lineup.penaltyTakerId))
    alerts.push({ level: 'info', text: 'Batedor de pênalti não está em campo' });
  const avg = (s: Sector) => (acc[s].n ? acc[s].sum / acc[s].n : 0);
  const gk = avg('gk');
  return {
    avgOverall: count ? ovr / count : 0,
    // o goleiro pesa na defesa como um quinto defensor
    defense: acc.def.n ? (acc.def.sum + gk) / (acc.def.n + (acc.gk.n ? 1 : 0)) : gk,
    midfield: avg('mid'),
    attack: avg('att'),
    fit: count ? fitSum / count : 0,
    alerts,
  };
}

export const MENTALITIES: { value: Mentality; label: string }[] = [
  { value: 'ultra-defensive', label: 'Retranca' },
  { value: 'defensive', label: 'Defensiva' },
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'attacking', label: 'Ofensiva' },
  { value: 'all-out', label: 'Tudo ao ataque' },
];
export const TEMPOS: { value: Tempo; label: string }[] = [
  { value: 'slow', label: 'Lento' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Rápido' },
];
export const PRESSINGS: { value: Pressing; label: string }[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
];
export const PASSINGS: { value: Passing; label: string }[] = [
  { value: 'short', label: 'Curto' },
  { value: 'mixed', label: 'Misto' },
  { value: 'direct', label: 'Direto' },
];
