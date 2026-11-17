import type { Competition, Fixture, StandingRow } from '../contract';

export interface StandingsOptions {
  /** usa confronto direto como 5º critério (padrão true) */
  headToHead?: boolean;
}

/**
 * Classificação. Desempate: pontos, vitórias, saldo, gols pró, confronto direto (opcional),
 * e por fim o id do clube (estável/determinístico).
 */
export function computeStandings(competition: Competition, opts: StandingsOptions = {}): StandingRow[] {
  const useH2H = opts.headToHead !== false;
  const rows = new Map<string, StandingRow>();
  for (const id of competition.clubIds) {
    rows.set(id, { clubId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] });
  }
  const played = competition.fixtures
    .filter((f) => f.result)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.round - b.round));
  for (const f of played) {
    const h = rows.get(f.homeId), a = rows.get(f.awayId);
    if (!h || !a) continue;
    const { home: hg, away: ag } = f.result!;
    h.played++; a.played++;
    h.goalsFor += hg; h.goalsAgainst += ag;
    a.goalsFor += ag; a.goalsAgainst += hg;
    if (hg > ag) { h.won++; a.lost++; h.points += 3; push(h, 'W'); push(a, 'L'); }
    else if (hg < ag) { a.won++; h.lost++; a.points += 3; push(h, 'L'); push(a, 'W'); }
    else { h.drawn++; a.drawn++; h.points++; a.points++; push(h, 'D'); push(a, 'D'); }
  }
  const list = [...rows.values()];
  const base = (x: StandingRow, y: StandingRow) =>
    y.points - x.points || y.won - x.won ||
    (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor;
  list.sort((x, y) => base(x, y) || (x.clubId < y.clubId ? -1 : 1));
  if (!useH2H) return list;

  // confronto direto dentro de cada grupo empatado nos 4 critérios
  const out: StandingRow[] = [];
  for (let i = 0; i < list.length; ) {
    let j = i + 1;
    while (j < list.length && base(list[i], list[j]) === 0) j++;
    const group = list.slice(i, j);
    if (group.length > 1) {
      const ids = new Set(group.map((g) => g.clubId));
      const mini = h2hTable(played, ids);
      group.sort((x, y) => {
        const mx = mini.get(x.clubId)!, my = mini.get(y.clubId)!;
        return my.pts - mx.pts || my.gd - mx.gd || my.gf - mx.gf || (x.clubId < y.clubId ? -1 : 1);
      });
    }
    out.push(...group);
    i = j;
  }
  return out;
}

function push(r: StandingRow, x: 'W' | 'D' | 'L') {
  r.form.push(x);
  if (r.form.length > 5) r.form.shift();
}

function h2hTable(fixtures: Fixture[], ids: Set<string>) {
  const m = new Map<string, { pts: number; gd: number; gf: number }>();
  for (const id of ids) m.set(id, { pts: 0, gd: 0, gf: 0 });
  for (const f of fixtures) {
    if (!ids.has(f.homeId) || !ids.has(f.awayId) || !f.result) continue;
    const h = m.get(f.homeId)!, a = m.get(f.awayId)!;
    const { home: hg, away: ag } = f.result;
    h.gf += hg; a.gf += ag; h.gd += hg - ag; a.gd += ag - hg;
    if (hg > ag) h.pts += 3; else if (ag > hg) a.pts += 3; else { h.pts++; a.pts++; }
  }
  return m;
}
