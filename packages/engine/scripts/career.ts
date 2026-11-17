/**
 * Carreira completa (Fase 1): `node scripts/career.ts [--seasons 3] [--club palmeiras] [--light minor|none|all] [--copy]
 *   [--seed x] [--check] [--digest] [--quiet]` (13/11: --check verifica invariantes; --digest imprime hashes do estado)
 * Simula N temporadas do Brasil (estaduais + Copa do Brasil + Supercopa + Séries A–D) com virada de
 * temporada e imprime campeões, acesso/rebaixamento, médias de idade/overall, finanças e tempos.
 * Roda em Node com type stripping (sem build). Lê os JSON reais de apps/web/public/data.
 */
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ClubBundle, NamePool, Player } from '@cosmicfut/shared';

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
type CareerData = import('../src/contract.ts').CareerData;
type SeasonState = import('../src/contract.ts').SeasonState;
type WorldState = import('../src/contract.ts').WorldState;

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const SEASONS = Number(arg('seasons', '3'));
const CLUB = arg('club', 'palmeiras');
const LIGHT = arg('light', 'minor') as 'none' | 'minor' | 'all';
const COPY = args.includes('--copy'); // advanceDay sem inPlace (como a UI)
/** --economy legacy: roda com as constantes de economia ANTES do ajuste da Fase 2 (para comparar) */
const LEGACY = arg('economy', 'new') === 'legacy';
/** --no-continental: roda sem a Fase 2 (continentais, ligas sul-americanas, Nordeste) — mede o custo */
const NO_CONT = args.includes('--no-continental');
/** --seed x: seed da carreira (padrão 'career-script') */
const SEED = arg('seed', 'career-script');
/** --check: verifica invariantes a cada fim de temporada (overall 1–99, elencos 18–52, caixa finito, competições travadas) */
const CHECK = args.includes('--check');
/** --digest: imprime um hash do estado final (para conferir determinismo entre versões) */
const DIGEST = args.includes('--digest');
/** --quiet: só o essencial (tempos, checagens, digest) */
const QUIET = args.includes('--quiet');
const issues: string[] = [];
if (LEGACY) Object.assign(E.ECONOMY, JSON.parse(JSON.stringify(E.LEGACY_ECONOMY)));

const out = console.log;
if (QUIET) console.log = () => {};
const t0 = performance.now();
const data: CareerData = {
  clubs: readJson('clubs-index.json'),
  leagues: readJson('leagues.json'),
  states: readJson('states.json'),
  formats: readJson('formats.json'),
  competitions: readJson('competitions.json'),
  calendars: readJson('calendars.json'),
  economy: readJson('economy.json'),
  countries: readJson('countries.json'),
};
const bundles = new Map<string, ClubBundle>();
const base = (id: string): Player[] => {
  let b = bundles.get(id);
  if (!b) {
    const f = resolve(DATA, `clubs/${id}.json`);
    if (!existsSync(f)) return [];
    b = JSON.parse(readFileSync(f, 'utf8')) as ClubBundle;
    bundles.set(id, b);
  }
  return b.players;
};
const pools: Record<string, NamePool> = { BRA: readJson('names/BRA.json') };
const name = (id: string | null | undefined) => (id ? data.clubs.find((c) => c.id === id)?.name ?? id : '—');
const fmtM = (v: number) => `${(v / 1e6).toFixed(1)}M`;
const tLoad = performance.now() - t0;

let t = performance.now();
let { world, state } = E.createCareer({
  data, humanClubIds: [CLUB], season: 2026, seed: SEED, squads: base,
  options: { light: LIGHT, ...(NO_CONT ? { continental: false, regionalCups: false } : {}) },
});
console.log(`economia: ${LEGACY ? 'LEGADO (antes do ajuste)' : 'Fase 2 (ajustada)'} | continentais: ${NO_CONT ? 'desligadas' : 'ligadas'}`);
// vagas do 1º ano (força + campeões reais de 2025)
if (world.continental) {
  const q = world.continental;
  const br = E.qualifiedFrom(q, new Set(data.clubs.filter((c) => c.countryId === world.countryId).map((c) => c.id)));
  console.log(`vagas ${q.season} (1º ano, ${Object.values(q.source).every((s) => s === 'strength') ? 'por força' : 'mistas'}): Libertadores ${br.libertadores.map(name).join(', ')} | Sul-Americana ${br.sulamericana.map(name).join(', ')} | campeões ${name(q.holders.LIBERTADORES)} (Lib) e ${name(q.holders.SULAMERICANA)} (Sula)`);
}
if (CHECK) checkInvariants(world, state, `início ${state.season}`, false);
const balanceHistory: Record<string, number[]> = {}; // divisão → caixa médio no início de cada ano
const medianHistory: Record<string, number[]> = {}; // divisão → caixa mediano
const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const timings: { season: number; sim: number; roll: number; days: number; games: number }[] = [];
const tCreate = performance.now() - t;
console.log(`dados: ${tLoad.toFixed(0)} ms | createCareer: ${tCreate.toFixed(0)} ms | competições: ${state.competitions.length} | clubes: ${Object.keys(state.clubs).length} | jogos iniciais: ${state.competitions.reduce((a, c) => a + c.fixtures.length, 0)} | remarcados: ${state.career?.rescheduled}`);

function avgSquads(w: WorldState, s: SeasonState) {
  const sq = E.careerSquads(s, E.worldSquads(w, base));
  let n = 0, age = 0, ovr = 0, top = 0, nt = 0, prime = 0, np = 0;
  const allOvr: number[] = [];
  const byDiv: Record<string, { o: number; n: number }> = {};
  const divOf = E.nationalDivisionOf(w);
  for (const id of Object.keys(s.clubs)) {
    const ps = sq(id);
    for (const p of ps) {
      n++; age += p.age; ovr += p.overall; allOvr.push(p.overall);
      if (p.age >= 24 && p.age <= 30) { prime += p.overall; np++; }
    }
    const best = ps.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11);
    if (best.length) { top += best.reduce((a, b) => a + b, 0) / best.length; nt++; }
    const k = String(divOf.get(id) ?? 'est');
    (byDiv[k] ??= { o: 0, n: 0 });
    if (best.length) { byDiv[k].o += best.reduce((a, b) => a + b, 0) / best.length; byDiv[k].n++; }
  }
  const top500 = allOvr.sort((a, b) => b - a).slice(0, 500);
  return {
    players: n, age: age / n, overall: ovr / n, top11: top / nt, prime: prime / np,
    top500: top500.reduce((a, b) => a + b, 0) / top500.length, perClub: n / Object.keys(s.clubs).length,
    byDiv: Object.fromEntries(Object.entries(byDiv).map(([k, v]) => [k, (v.o / v.n).toFixed(1)])),
  };
}

const sizeKb = (x: unknown) => (JSON.stringify(x).length / 1024).toFixed(0);

/** Invariantes (--check): overall 1–99, elencos 18–52 (clubes do país da carreira), caixa finito, competições encerradas. */
function checkInvariants(w: WorldState, s: SeasonState, when: string, end: boolean) {
  const sq = E.careerSquads(s, E.worldSquads(w, base));
  const found: string[] = [];
  let small = 0, big = 0, badOvr = 0;
  const examples: string[] = [];
  for (const [id, c] of Object.entries(s.clubs)) {
    if (!Number.isFinite(c.balance)) found.push(`caixa não finito: ${id} = ${c.balance}`);
    for (const [k, v] of Object.entries(c.finance ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) found.push(`ledger ${id}.${k} = ${v}`);
    const ps = sq(id);
    for (const p of ps) {
      if (!(p.overall >= 1 && p.overall <= 99) || !Number.isFinite(p.overall)) { badOvr++; if (examples.length < 5) examples.push(`${p.id} ovr ${p.overall}`); }
      if (!(p.potential >= 1 && p.potential <= 99)) { badOvr++; if (examples.length < 5) examples.push(`${p.id} pot ${p.potential}`); }
      if (!Number.isFinite(p.wage) || !Number.isFinite(p.value)) found.push(`salário/valor inválido ${p.id}`);
    }
    if (s.clubInfo?.[id]?.foreign) continue; // elencos estrangeiros vêm dos dados (fora do controle da carreira)
    if (ps.length < 18) { small++; if (examples.length < 10) examples.push(`${id} ${ps.length} jog.`); }
    if (ps.length > 52) { big++; if (examples.length < 10) examples.push(`${id} ${ps.length} jog.`); }
  }
  if (badOvr) found.push(`${badOvr} jogadores com overall/potencial fora de 1–99`);
  if (small) found.push(`${small} clubes com menos de 18 jogadores`);
  if (big) found.push(`${big} clubes com mais de 52 jogadores`);
  if (end) {
    const open = s.competitions.filter((c) => !c.finished);
    if (open.length) found.push(`competições não encerradas: ${open.map((c) => c.id).join(', ')}`);
    for (const c of s.competitions) {
      if (c.format && c.finished && !c.championId && c.clubIds.length >= 2) found.push(`${c.id} encerrada sem campeão`);
    }
  }
  if (found.length) {
    const msg = `[check ${when}] ${found.join(' | ')}${examples.length ? ` (ex.: ${examples.join(', ')})` : ''}`;
    issues.push(msg);
    out(msg);
  } else out(`[check ${when}] ok`);
}
for (let y = 0; y < SEASONS; y++) {
  const a0 = avgSquads(world, state);
  console.log(`\n══════════ Temporada ${state.season} ══════════`);
  console.log(`início: ${a0.players} jogadores (${a0.perClub.toFixed(1)}/clube) | idade ${a0.age.toFixed(2)} | overall ${a0.overall.toFixed(2)} | 24–30 anos ${a0.prime.toFixed(2)} | top-500 ${a0.top500.toFixed(2)} | top11 ${a0.top11.toFixed(2)} | top11 por divisão ${JSON.stringify(a0.byDiv)}`);
  console.log(`estado inicial: SeasonState ${sizeKb(state)} KB | WorldState ${sizeKb(world)} KB`);
  const startBal = Object.fromEntries(Object.entries(state.clubs).map(([id, c]) => [id, c.balance]));
  {
    const divOf0 = E.nationalDivisionOf(world);
    const by: Record<string, number[]> = {};
    for (const [id, b] of Object.entries(startBal)) { const d = divOf0.get(id); if (d) (by[String(d)] ??= []).push(b); }
    for (const [d, v] of Object.entries(by)) { (balanceHistory[d] ??= []).push(v.reduce((a, b) => a + b, 0) / v.length); (medianHistory[d] ??= []).push(median(v)); }
  }
  let squads = E.worldSquads(world, base);
  let days = 0, games = 0, maxDay = 0, maxDayDate = '';
  t = performance.now();
  const end = `${state.season + 1}-07-31`;
  while (!E.seasonOver(state) && state.date < end) {
    // (Etapa 1) viradas regionais sem o humano (ex.: Europa em 30/06 para um clube brasileiro) são automáticas
    if (E.autoTurnoverDue(state)) {
      for (const code of E.scopeNamePoolCodes(data)) if (!pools[code] && existsSync(resolve(DATA, `names/${code}.json`))) pools[code] = readJson(`names/${code}.json`);
      const auto = E.nextSeason(world, state, base, data, pools);
      console.log(`virada automática ${auto.summary.date} (${auto.summary.seasonLabel}, ${auto.summary.cycle})`);
      world = auto.world;
      state = auto.state;
      squads = E.worldSquads(world, base);
      continue;
    }
    const d0 = performance.now();
    const r = E.advanceDay(state, squads, {}, { inPlace: !COPY });
    state = r.state;
    const dt = performance.now() - d0;
    if (dt > maxDay) { maxDay = dt; maxDayDate = state.date; }
    games += r.played.length;
    days++;
  }
  const tSeason = performance.now() - t;
  if (CHECK) checkInvariants(world, state, `fim ${state.season}`, true);
  if (QUIET) out(`${state.season}: ${days} dias, ${games} jogos, ${(tSeason / 1000).toFixed(2)} s (${(tSeason / days).toFixed(1)} ms/dia, pior ${maxDay.toFixed(0)} ms)`);
  const unfinished = state.competitions.filter((c) => !c.finished).map((c) => c.id);
  console.log(`simulação: ${days} dias, ${games} jogos em ${(tSeason / 1000).toFixed(2)} s (${(tSeason / days).toFixed(1)} ms/dia, pior dia ${maxDay.toFixed(0)} ms em ${maxDayDate}) | remarcados ${state.career?.rescheduled}${unfinished.length ? ` | NÃO TERMINARAM: ${unfinished.join(',')}` : ''}`);
  console.log(`estado final: SeasonState ${sizeKb(state)} KB`);

  // campeões principais
  const main = state.competitions.filter((c) => (c.type !== 'state' || c.division === 1) && c.type !== 'continental' && (c.countryId === undefined || c.countryId === world.countryId));
  const cont = state.competitions.filter((c) => c.type === 'continental');
  const foreignLeagues = state.competitions.filter((c) => c.type === 'league' && c.countryId !== undefined && c.countryId !== world.countryId);
  if (cont.length) {
    console.log('  — continentais —');
    for (const c of cont) {
      const titles = (c.titles ?? []).map((tt) => `${tt.title}: ${name(tt.clubId)}`).join('; ');
      const br = c.clubIds.filter((id) => data.clubs.find((x) => x.id === id)?.countryId === world.countryId);
      console.log(`  ${c.name.padEnd(30)} campeão ${name(c.championId).padEnd(22)} vice ${name(c.viceId).padEnd(22)} | ${c.clubIds.length} clubes (${br.length} BRA), ${c.fixtures.length} jogos${titles ? ` | ${titles}` : ''}`);
    }
    console.log(`  ligas sul-americanas: ${foreignLeagues.map((c) => `${c.id} ${name(c.championId)}`).join(' | ')}`);
  }
  for (const c of main) {
    const top = Object.entries(c.scorers ?? {}).sort((x, z) => z[1] - x[1])[0];
    const titles = (c.titles ?? []).map((tt) => `${tt.title}: ${name(tt.clubId)}`).join('; ');
    if (c.type === 'state' && !['SP', 'RJ', 'MG', 'RS', 'PE', 'CE', 'SC', 'GO', 'BA', 'PR', 'AM'].includes(c.uf ?? '')) continue;
    console.log(`  ${c.name.padEnd(34)} campeão ${name(c.championId).padEnd(22)} vice ${name(c.viceId).padEnd(22)}${top ? ` artilheiro ${top[1]} gols` : ''}${titles ? ` | ${titles}` : ''}`);
  }
  const human = state.clubs[CLUB];
  for (const code of E.careerNamePoolCodes(world, data, state)) if (!pools[code] && existsSync(resolve(DATA, `names/${code}.json`))) pools[code] = readJson(`names/${code}.json`);
  t = performance.now();
  const next = E.nextSeason(world, state, base, data, pools);
  const tRoll = performance.now() - t;
  const s = next.summary;
  console.log(`virada: ${tRoll.toFixed(0)} ms`);
  for (const [div, ids] of Object.entries(s.promoted)) console.log(`  sobem para ${div.replace(/\d$/, (d) => String(Number(d) - 1))} (de ${div}): ${ids.map(name).join(', ')}`);
  for (const [div, ids] of Object.entries(s.relegated)) if (div !== 'BRA-4') console.log(`  caem de ${div}: ${ids.map(name).join(', ')}`);
  if (s.serieD) console.log(`  Série D ${state.season + 1}: ${s.serieD.fromC.length} vindos da C, ${s.serieD.kept.length} mantidos, ${s.serieD.fromStates.length} pelos estaduais (ex.: ${s.serieD.fromStates.slice(0, 6).map(name).join(', ')}); ${s.serieD.dropped.length} voltam só ao estadual`);
  const sm = Object.entries(s.stateMoves).filter(([k]) => k.startsWith('SP-') || k.startsWith('RJ-'));
  for (const [k, v] of sm) if (v.down.length || v.up.length) console.log(`  ${k}: sobem ${v.up.map(name).join(', ') || '—'} | caem ${v.down.map(name).join(', ') || '—'}`);
  console.log(`  aposentadorias ${s.retirements.length} (ex.: ${s.retirements.slice(0, 3).map((r) => `${r.name} ${r.age}a`).join(', ')}) | juniores ${s.youth.length} (ex.: ${s.youth.slice(0, 4).map((x) => `${x.name} ${x.overall}/${x.potential}`).join(', ')})`);
  console.log(`  contratos: ${s.contracts.renewed} renovados, ${s.contracts.released} saíram (humano: ${s.contracts.humanReleased.length}), ${s.contracts.signedFree} livres contratados pela CPU | empréstimos devolvidos ${s.loansReturned}`);
  const bal = Object.values(state.clubs).map((c) => c.balance);
  const divOf = E.nationalDivisionOf(world);
  const finBy: Record<string, number[]> = {};
  const dBy: Record<string, number[]> = {};
  const dNoPrize: Record<string, number[]> = {};
  const comp: Record<string, Record<string, number>> = {};
  const med = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  for (const [id, c] of Object.entries(state.clubs)) {
    const k = String(divOf.get(id) ?? (state.clubInfo?.[id]?.foreign ? 'ext' : 'est'));
    (finBy[k] ??= []).push(c.balance);
    const d = c.balance - (startBal[id] ?? c.balance);
    (dBy[k] ??= []).push(d);
    (dNoPrize[k] ??= []).push(d - (c.finance?.prizes ?? 0));
    const f = c.finance;
    if (f) { const o = (comp[k] ??= {}); for (const [key, v] of Object.entries(f)) o[key] = (o[key] ?? 0) + (v as number) / 1; o.n = (o.n ?? 0) + 1; }
  }
  console.log(`  finanças: caixa médio ${fmtM(bal.reduce((a, b) => a + b, 0) / bal.length)} | por divisão ${Object.entries(finBy).map(([k, v]) => `${k}: ${fmtM(v.reduce((a, b) => a + b, 0) / v.length)}`).join(' ')} | ${name(CLUB)} ${fmtM(human.balance)} (prêmios ${fmtM(human.finance?.prizes ?? 0)})`);
  for (const k of ['1', '2', '3', '4', 'est', 'ext']) {
    if (!dBy[k]) continue;
    const c = comp[k];
    const per = (x: string) => fmtM((c?.[x] ?? 0) / (c?.n || 1));
    console.log(`    div ${k.padEnd(3)} Δcaixa no ano: mediana ${fmtM(med(dBy[k]))} (sem prêmios ${fmtM(med(dNoPrize[k]))}), média ${fmtM(dBy[k].reduce((a, b) => a + b, 0) / dBy[k].length)} | médias: ingressos ${per('tickets')} TV ${per('tv')} patrocínio ${per('sponsor')} salários ${per('wages')} transf. ${per('transfers')} prêmios ${per('prizes')}`);
  }
  if (s.continental) {
    console.log(`  classificados ${state.season + 1}: Libertadores ${s.continental.libertadores.map((id) => `${name(id)} (${s.continental!.qualifiers.reason[id] ?? ''})`).join(', ')}`);
    console.log(`                    Sul-Americana ${s.continental.sulamericana.map(name).join(', ')}`);
  }
  if (s.contracts.refused?.length) console.log(`  renovações recusadas: ${s.contracts.refused.length}`);
  timings.push({ season: state.season, sim: tSeason, roll: tRoll, days, games });
  console.log(`  evolução: Δ médio ${(s.evolution.delta / s.evolution.players).toFixed(2)} por jogador no ano (bônus de fim de ano: ${s.evolution.bonus})`);
  console.log(`  após a virada: idade média ${s.averages.age.toFixed(2)}, overall médio ${s.averages.overall.toFixed(2)}, ${s.averages.players} jogadores`);
  world = next.world;
  state = next.state;
  if (CHECK) checkInvariants(world, state, `início ${state.season}`, false);
}
if (DIGEST) {
  const { createHash } = await import('node:crypto');
  const h = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);
  // `results` ignora textos (notícias, motivos de vaga): só resultados, caixa e jogadores
  const results = { fx: state.competitions.map((c) => c.fixtures.map((f) => [f.id, f.date, f.result])), bal: world.balances, players: world.players, hist: world.history };
  out(`digest: world ${h(world)} | state ${h(state)} | results ${h(results)}`);
}
if (CHECK) out(issues.length ? `CHECAGENS: ${issues.length} problema(s)` : 'CHECAGENS: tudo ok');
const a = avgSquads(world, state);
console.log(`\nfinal (${state.season}): ${a.players} jogadores (${a.perClub.toFixed(1)}/clube) | idade ${a.age.toFixed(2)} | overall ${a.overall.toFixed(2)} | 24–30 anos ${a.prime.toFixed(2)} | top-500 ${a.top500.toFixed(2)} | top11 ${a.top11.toFixed(2)} | ${JSON.stringify(a.byDiv)}`);
console.log(`WorldState ${sizeKb(world)} KB | SeasonState inicial ${sizeKb(state)} KB | histórico ${world.history.length} registros`);
{
  const divOf = E.nationalDivisionOf(world);
  const by: Record<string, number[]> = {};
  for (const [id, c] of Object.entries(state.clubs)) { const d = divOf.get(id); if (d) (by[String(d)] ??= []).push(c.balance); }
  for (const [d, v] of Object.entries(by)) { (balanceHistory[d] ??= []).push(v.reduce((a, b) => a + b, 0) / v.length); (medianHistory[d] ??= []).push(median(v)); }
}
console.log(`\ntempos: ${timings.map((x) => `${x.season}: ${(x.sim / 1000).toFixed(2)} s (${x.days} dias, ${x.games} jogos), virada ${x.roll.toFixed(0)} ms`).join(' | ')}`);
console.log(`caixa médio por divisão no início de cada ano (${LEGACY ? 'economia LEGADA' : 'economia ajustada'}): ${Object.entries(balanceHistory).map(([d, v]) => `div ${d}: ${v.map(fmtM).join(' → ')}`).join(' | ')}`);
console.log(`caixa MEDIANO por divisão (o clube médio): ${Object.entries(medianHistory).map(([d, v]) => `div ${d}: ${v.map(fmtM).join(' → ')}`).join(' | ')}`);
console.log('referência ANTES do ajuste (Fase 1, medido em 13/11/2026 com --economy legacy, sem continentais): div 1: 15.0M → 23.1M → 26.8M (≈ 40M no 4º ano; nota 17)');
const champs = world.history.filter((h) => h.type === 'continental');
if (champs.length) console.log(`campeões continentais: ${champs.map((h) => `${h.season} ${h.name}: ${name(h.championId)}`).join(' | ')}`);
