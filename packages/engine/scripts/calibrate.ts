/**
 * Calibragem do motor: `npm run sim --workspace @cosmicfut/engine [-- --games 8000 --seasons 20]`
 * Roda em Node com type stripping (sem build). Lê os JSON reais em apps/web/public/data.
 */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Player, ClubBundle, Division, Calendar } from '@cosmicfut/shared';

// src/ usa imports sem extensão (estilo bundler); resolve `.ts` para o Node.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.')) return next(spec + '.ts', ctx);
      throw e;
    }
  },
});

const E = await import('../src/index.ts');
type MatchTeamInput = import('../src/contract.ts').MatchTeamInput;
type MatchResult = import('../src/contract.ts').MatchResult;

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

const args = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const GAMES = arg('games', 7600);
const SEASONS = arg('seasons', 20);

const leagues = readJson<Division[]>('leagues.json');
const bra1 = leagues.find((d) => d.id === 'BRA-1')!;
const bundles = new Map<string, ClubBundle>();
const load = (id: string) => {
  if (!bundles.has(id)) bundles.set(id, readJson<ClubBundle>(`clubs/${id}.json`));
  return bundles.get(id)!;
};
for (const id of bra1.clubIds) load(id);

function teamInput(id: string, isHome: boolean): MatchTeamInput {
  const b = load(id);
  const tactic = { ...E.DEFAULT_TACTIC };
  return {
    clubId: id, name: b.club.shortName || b.club.name, players: b.players,
    lineup: E.autoPickLineup(b.players, tactic), tactic, isHome, control: 'ai', morale: 50,
    stadiumCapacity: b.club.stadium.capacity, reputation: b.club.reputation,
  };
}
const avg11 = (id: string) => {
  const b = load(id);
  const l = E.autoPickLineup(b.players, E.DEFAULT_TACTIC);
  return E.lineupStrength(b.players, l, '4-4-2');
};
const fmt = (n: number, d = 2) => n.toFixed(d);
const pct = (n: number) => (n * 100).toFixed(1) + '%';

/* ───────────── 1) métricas de partida ───────────── */
if (!only || only === 'match') {
  const pairs: [string, string][] = [];
  for (const a of bra1.clubIds) for (const b of bra1.clubIds) if (a !== b) pairs.push([a, b]);
  const inputs = new Map<string, MatchTeamInput>();
  for (const id of bra1.clubIds) { inputs.set(id + ':h', teamInput(id, true)); inputs.set(id + ':a', teamInput(id, false)); }
  const agg = { goals: 0, hw: 0, d: 0, aw: 0, shots: 0, sot: 0, yel: 0, red: 0, corners: 0, fouls: 0, off: 0, pens: 0, inj: 0, xg: 0, poss: 0, hg: 0, ag: 0, passes: 0 };
  const scoreFreq = new Map<string, number>();
  const t0 = performance.now();
  for (let i = 0; i < GAMES; i++) {
    const [h, a] = pairs[i % pairs.length];
    const r: MatchResult = E.quickSimulate({ seed: `cal:${i}`, home: inputs.get(h + ':h')!, away: inputs.get(a + ':a')! });
    agg.goals += r.homeGoals + r.awayGoals; agg.hg += r.homeGoals; agg.ag += r.awayGoals;
    if (r.winner === 'home') agg.hw++; else if (r.winner === 'away') agg.aw++; else agg.d++;
    agg.shots += r.stats.home.shots + r.stats.away.shots;
    agg.sot += r.stats.home.shotsOnTarget + r.stats.away.shotsOnTarget;
    agg.yel += r.cards.filter((c) => c.color === 'yellow').length;
    agg.red += r.cards.filter((c) => c.color === 'red').length;
    agg.corners += r.stats.home.corners + r.stats.away.corners;
    agg.fouls += r.stats.home.fouls + r.stats.away.fouls;
    agg.off += r.stats.home.offsides + r.stats.away.offsides;
    agg.pens += r.scorers.filter((s) => s.penalty).length;
    agg.inj += r.injuries.length;
    agg.xg += r.stats.home.xg + r.stats.away.xg;
    agg.poss += r.stats.home.possession;
    agg.passes += r.stats.home.passesCompleted + r.stats.away.passesCompleted;
    const k = `${r.homeGoals}-${r.awayGoals}`;
    scoreFreq.set(k, (scoreFreq.get(k) ?? 0) + 1);
  }
  const ms = performance.now() - t0;
  const n = GAMES;
  console.log(`\n== BRA-1: ${n} jogos (quickSimulate) ==`);
  console.log(`gols/jogo ${fmt(agg.goals / n)} (casa ${fmt(agg.hg / n)} / fora ${fmt(agg.ag / n)})  xG/jogo ${fmt(agg.xg / n)}`);
  console.log(`mandante/empate/visitante ${pct(agg.hw / n)} / ${pct(agg.d / n)} / ${pct(agg.aw / n)}`);
  console.log(`chutes/time ${fmt(agg.shots / n / 2)}  no alvo/time ${fmt(agg.sot / n / 2)}  escanteios/time ${fmt(agg.corners / n / 2)}  impedimentos/time ${fmt(agg.off / n / 2)}`);
  console.log(`faltas/jogo ${fmt(agg.fouls / n)}  amarelos/jogo ${fmt(agg.yel / n)}  vermelhos/jogo ${fmt(agg.red / n, 3)}  gols de pênalti/jogo ${fmt(agg.pens / n, 3)}  lesões/jogo ${fmt(agg.inj / n, 3)}`);
  console.log(`posse média mandante ${fmt(agg.poss / n, 1)}%  passes certos/jogo ${fmt(agg.passes / n, 0)}`);
  console.log(`placares mais comuns: ${[...scoreFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pct(v / n)}`).join(', ')}`);
  console.log(`desempenho: ${fmt(n / (ms / 1000), 0)} jogos/s (${fmt(ms / n, 3)} ms/jogo)`);
}

/* ───────────── 2) confrontos de referência ───────────── */
function h2h(a: string, b: string, n = 1000) {
  let wa = 0, d = 0, wb = 0, ga = 0, gb = 0;
  for (let i = 0; i < n; i++) {
    const aHome = i % 2 === 0;
    const r = E.quickSimulate({
      seed: `h2h:${a}:${b}:${i}`,
      home: teamInput(aHome ? a : b, true),
      away: teamInput(aHome ? b : a, false),
    });
    const gA = aHome ? r.homeGoals : r.awayGoals, gB = aHome ? r.awayGoals : r.homeGoals;
    ga += gA; gb += gB;
    if (gA > gB) wa++; else if (gA < gB) wb++; else d++;
  }
  console.log(`${a} (${fmt(avg11(a), 1)}) x ${b} (${fmt(avg11(b), 1)}): ${pct(wa / n)} / ${pct(d / n)} / ${pct(wb / n)}  gols ${fmt(ga / n)} x ${fmt(gb / n)}`);
}
if (!only || only === 'h2h') {
  console.log('\n== Confrontos (mando alternado, 1000 jogos) ==');
  load('realmadrid-esp'); load('ajaccio-fr');
  h2h('realmadrid-esp', 'ajaccio-fr');
  h2h('palmeiras', 'flarj');
  h2h('palmeiras', 'chapecoense-bra');
  h2h('flarj', 'remo');
}

/* ───────────── 2b) narração de exemplo ───────────── */
if (only === 'narrate') {
  const sim = new E.MatchSimulation({ seed: `narr:${arg('seed', 1)}`, home: teamInput('palmeiras', true), away: teamInput('flarj', false) });
  const res = sim.runToEnd();
  for (const e of sim.state.events) console.log(`${String(e.minute).padStart(3)}'${e.extra ? '+' + e.extra : ''}  [${e.type}] ${e.text}`);
  const q = E.quickSimulate({ seed: `narr:${arg('seed', 1)}`, home: teamInput('palmeiras', true), away: teamInput('flarj', false) });
  console.log(`\nresultado ao vivo ${res.homeGoals}x${res.awayGoals} | quickSimulate ${q.homeGoals}x${q.awayGoals} | idênticos: ${JSON.stringify(res.stats) === JSON.stringify(q.stats)}`);
  const top = Object.entries(res.ratings).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log('melhores notas:', top.map(([id, r]) => `${id} ${r}`).join(', '));
}

/* ───────────── 3) temporadas completas ───────────── */
if (!only || only === 'season') {
  console.log(`\n== ${SEASONS} temporadas BRA-1 (createSeason + advanceDay) ==`);
  const calendars = readJson<Calendar[]>('calendars.json');
  const nacional = calendars.find((c) => c.id === 'nacional')!.dates;
  const titles = new Map<string, number>();
  const posSum = new Map<string, number>();
  const balanceDelta = new Map<string, number>();
  const income = new Map<string, Record<string, number>>();
  const squads = (id: string): Player[] => load(id).players;
  // (Etapa 4) escala real em euros: receita/folha dos dados + perfil econômico (TV mensal, patrocínio, custos, preço-base)
  const clubInfo: Record<string, import('../src/contract.ts').ClubEconomyInfo> = {};
  for (const id of bra1.clubIds) {
    const c = load(id).club;
    clubInfo[id] = {
      capacity: c.stadium.capacity, reputation: c.reputation, sponsorPerSeason: c.finances.sponsorPerSeason, division: c.division ?? 1, name: c.shortName,
      revenue: c.finances.revenue, wageBill: c.finances.wageBill, region: 'SA', countryId: c.countryId,
    };
  }
  const econ = E.econTables({ economy: readJson('economy.json') } as never);
  if (econ) {
    E.applyEconomyProfiles(econ, clubInfo, {
      divisions: { [bra1.id]: bra1.clubIds }, dataDivisions: { [bra1.id]: bra1.clubIds },
      codeOf: () => 'BRA', guest: () => false, stateOnly: () => false,
    });
  }
  const t0 = performance.now();
  let gamesPlayed = 0;
  for (let s = 0; s < SEASONS; s++) {
    let st = E.createSeason({
      season: 2026, startDate: '2026-01-01',
      divisions: [{ id: bra1.id, name: bra1.name, clubIds: bra1.clubIds, doubleRound: true, relegated: bra1.relegated, promoted: bra1.promoted }],
      calendarDates: nacional, humanClubIds: [],
      clubBalances: Object.fromEntries(bra1.clubIds.map((id) => [id, load(id).club.finances.balance])),
      seed: `season-cal:${s}`, clubInfo,
    });
    const start = Object.fromEntries(bra1.clubIds.map((id) => [id, st.clubs[id].balance]));
    let guard = 0;
    while (st.date < '2027-01-01' && guard++ < 400) {
      const r = E.advanceDay(st, squads);
      st = r.state;
      gamesPlayed += r.played.length;
    }
    const table = E.computeStandings(st.competitions[0]);
    titles.set(table[0].clubId, (titles.get(table[0].clubId) ?? 0) + 1);
    table.forEach((row, i) => posSum.set(row.clubId, (posSum.get(row.clubId) ?? 0) + i + 1));
    for (const id of bra1.clubIds) {
      balanceDelta.set(id, (balanceDelta.get(id) ?? 0) + st.clubs[id].balance - start[id]);
      const fin = (st.clubs[id] as unknown as { finance?: Record<string, number> }).finance;
      if (fin) {
        const acc = income.get(id) ?? {};
        for (const [k, v] of Object.entries(fin)) acc[k] = (acc[k] ?? 0) + v;
        income.set(id, acc);
      }
    }
    if (s === 0) {
      console.log('Tabela final (temporada 1):');
      for (const [i, r] of table.entries()) {
        console.log(`${String(i + 1).padStart(2)}. ${r.clubId.padEnd(18)} ${String(r.points).padStart(3)} pts  ${r.won}V ${r.drawn}E ${r.lost}D  ${r.goalsFor}:${r.goalsAgainst}`);
      }
    }
  }
  const ms = performance.now() - t0;
  console.log(`(${gamesPlayed} jogos em ${fmt(ms / 1000, 1)}s)`);
  console.log('\nForça (top-11) | títulos | posição média | saldo financeiro médio/temporada (€)');
  console.log('(só a liga: sem estaduais, copas e continentais — bilheteria e prêmios abaixo do perfil; a sustentabilidade real é medida em test/stage4.test.ts)');
  const rows = bra1.clubIds.map((id) => ({ id, str: avg11(id) })).sort((a, b) => b.str - a.str);
  for (const { id, str } of rows) {
    const inc = income.get(id);
    const incTxt = inc ? '  ' + Object.entries(inc).map(([k, v]) => `${k} ${E.fmtMoneyShort(v / SEASONS)}`).join(' ') : '';
    console.log(`${id.padEnd(18)} ${fmt(str, 1)} | ${String(titles.get(id) ?? 0).padStart(2)} | ${fmt((posSum.get(id) ?? 0) / SEASONS, 1).padStart(4)} | ${fmt((balanceDelta.get(id) ?? 0) / SEASONS / 1e6, 1).padStart(6)}M${incTxt}`);
  }
}
