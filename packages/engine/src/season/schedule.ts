import { Rng } from '../rng';

export interface RoundRobinMatch {
  round: number;
  homeId: string;
  awayId: string;
}

/**
 * Todos contra todos pelo método do círculo (tabela de Berger).
 * - ordem dos clubes embaralhada pela seed (determinístico);
 * - número ímpar de clubes ⇒ folga (bye) rotativa;
 * - mando alternado: cada clube tem no máximo 1 mando de diferença no turno;
 * - returno espelhado (mesma ordem de rodadas, mando invertido).
 */
export function generateRoundRobin(clubIds: string[], doubleRound: boolean, seed: string): RoundRobinMatch[] {
  const ids: (string | null)[] = new Rng(seed).shuffle(Array.from(new Set(clubIds)));
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const out: RoundRobinMatch[] = [];
  // mando: equilibra (mandos − visitas) e evita repetir mando da rodada anterior
  const bal = new Map<string, number>();
  const last = new Map<string, number>(); // +1 mandante na última rodada, −1 visitante
  const pref = (x: string) => (bal.get(x) ?? 0) * 4 + (last.get(x) ?? 0);
  // arr[0] fixo, os demais giram
  let arr = ids.slice();
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      const pa = pref(a), pb = pref(b);
      const aHome = pa !== pb ? pa < pb : (r + i) % 2 === 0;
      const [home, away] = aHome ? [a, b] : [b, a];
      bal.set(home, (bal.get(home) ?? 0) + 1);
      bal.set(away, (bal.get(away) ?? 0) - 1);
      last.set(home, 1);
      last.set(away, -1);
      out.push({ round: r + 1, homeId: home, awayId: away });
    }
    // gira: mantém arr[0], move o último para a posição 1
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (doubleRound) {
    const first = out.length;
    for (let k = 0; k < first; k++) {
      const m = out[k];
      out.push({ round: m.round + rounds, homeId: m.awayId, awayId: m.homeId });
    }
  }
  return out;
}

/* ───────────── datas ───────────── */

export function parseIso(d: string): number {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
}
export function toIso(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function addDays(iso: string, n: number): string {
  return toIso(parseIso(iso) + n * 86400000);
}

/**
 * Datas das rodadas: usa o calendário ('MM-DD' no ano da temporada) a partir de startDate;
 * se faltar data, completa semanalmente após a última.
 */
export function roundDates(rounds: number, season: number, startDate: string, calendarDates?: string[]): string[] {
  const out: string[] = [];
  if (calendarDates && calendarDates.length) {
    const cal = calendarDates
      .map((md) => `${season}-${md}`)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= startDate)
      .sort();
    const uniq = Array.from(new Set(cal));
    // se sobrar data, distribui as rodadas uniformemente pelo calendário
    if (uniq.length >= rounds) {
      for (let r = 0; r < rounds; r++) {
        const idx = rounds === 1 ? 0 : Math.round((r * (uniq.length - 1)) / (rounds - 1));
        out.push(uniq[idx]);
      }
      // garante datas estritamente crescentes
      for (let r = 1; r < out.length; r++) if (out[r] <= out[r - 1]) out[r] = addDays(out[r - 1], 1);
      return out;
    }
    out.push(...uniq);
  }
  // sem calendário: semanal, primeira rodada 7 dias após startDate
  let last = out.length ? out[out.length - 1] : startDate;
  while (out.length < rounds) {
    last = addDays(last, 7);
    out.push(last);
  }
  return out;
}
