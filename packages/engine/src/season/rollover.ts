/**
 * Virada (Fase 1; Etapa 1: viradas REGIONAIS na linha do tempo global).
 *
 * Cada SeasonState de carreira cobre um trecho (timeline.ts); quando a data passa do fim do trecho, vira o ciclo
 * `segment.closes`:
 *  - 'calendar' (31/12 → 01/01): América do Sul — campeões/histórico, acesso e rebaixamento (Brasil, estaduais e
 *    demais países sul-americanos), vagas continentais, contratos e aposentadorias dos clubes sul-americanos;
 *  - 'split' (30/06 → 01/07): Europa e Arábia — campeões/histórico, acesso e rebaixamento, contratos e
 *    aposentadorias dos clubes europeus/sauditas; e o ENVELHECIMENTO anual de todos (evolução de fim de ano, idade,
 *    potencial, juniores do ano, limpeza de livres).
 * Em toda virada: mercado do trecho → mundo (transferências, livres, empréstimos), caixas e finanças persistentes.
 * Competições do outro ciclo continuam no trecho seguinte (createSeasonFromWorld com `carry`).
 *
 * Sequência por virada (spec §4.1 do original, por região): campeões → acesso/rebaixamento → contratos →
 * (1º/07) evolução + envelhecimento + aposentadorias + juniores → finanças → WorldState seguinte.
 * Puro e determinístico: não muta as entradas.
 */
import type { Player } from '@cosmicfut/shared';
import type { CareerData, ChampionRecord, Competition, PlayerContract, SeasonState, SeasonSummary, WorldState } from '../contract';
import { Rng } from '../rng';
import { baseClubOf, defaultContractEnd, MARKET, type Squads } from '../transfers/market';
import { clubView, contractDemand, evaluateContract, type ContractDemand } from '../transfers/valuation';
import { withWageFloor } from '../transfers/wage-floor';
import { AI_MARKET } from '../transfers/ai';
import { CAREER_REV, careerSquads, createSeasonFromWorld, worldSquads, type NamePools } from './career';
import { finalRanking, forceFinishCompetition } from './format';
import { competitionRecord, emptyRecords, flushLines, pruneRetired } from './records';
import { AWARDS, computeSeasonAwards } from './awards';
import { ordersFromSeason, qualifiedFrom, qualifyContinental } from './continental';
import { qualifyAfc, qualifyUefa } from './confed';
import {
  generateYouthPlayer, monthlyWage, neediestPosition, nextPotential, retireChance, revalue, squadScales, yearEndBonus, YOUTH,
} from './players';
import { computeStandings } from './standings';
import { coachSeasonEnd } from './coach';
import { addDays } from './schedule';
import { fmtMoneyShort } from '../money';
import {
  cycleOfCompetition, cycleOfRegion, cycleSeason, regionOfCode, regionsOfCycle, SCOPE_REGIONS, seasonLabel, type Cycle, type Region,
} from './timeline';

const deep = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const isGenerated = (pid: string) => /:g\d+-\d+$/.test(pid);
/** Na virada, clubes da CPU com menos jogadores que isto contratam livres do seu nível. */
export const FILL_TO = 24;
/** (13/11) Elenco mínimo após a virada (todos os clubes da temporada): o que faltar vem da base (juniores). */
export const MIN_SQUAD = 18;

/** (Fase 2) Termos de renovação de um jogador do humano. */
export interface RenewTerms {
  /** salário mensal oferecido (ausente ⇒ aceita o salário pedido, como na lista simples) */
  wage?: number;
  /** anos de contrato (1..5; ausente ⇒ sorteio 1–3, como antes) */
  years?: number;
}

/** Idade a partir da qual o jogador renovado pelo humano ainda pode se aposentar na mesma virada. */
export const RENEW_RETIRE_AGE = 38;

export interface RolloverOptions {
  /**
   * Jogadores do humano com contrato vencendo que serão renovados (os demais saem, como no original).
   *  - lista de ids (compatível com a Fase 1): renova sempre, salário = max(atual, salário de mercado), 1–3 anos;
   *  - mapa id → {wage, years} (Fase 2): o jogador avalia a oferta com a regra de `evaluateContract`
   *    (última rodada: salário ≥ pedido de `renewalDemand` → aceita; senão recusa e fica livre).
   *    `true` no lugar dos termos = aceita o pedido.
   * Aposentadoria × renovação: quem o humano marcou para renovar NÃO se aposenta nesta virada,
   * salvo se tiver `RENEW_RETIRE_AGE` (38) anos ou mais.
   */
  renew?: string[] | Record<string, RenewTerms | true>;
}

/**
 * Pedido salarial do jogador para renovar com o próprio clube (o que a UI deve mostrar como "salário pedido").
 * = contractDemand com aumento 1.0 (kind 'loan') sobre max(salário atual, salário de mercado na idade/overall
 * do ano seguinte); duração fora da faixa preferida custa +6%/ano. Usa a seed da temporada (determinístico).
 */
export function renewalDemand(state: SeasonState, squads: Squads, clubId: string, player: Player, years?: number, reputation?: number): ContractDemand {
  const buyer = clubView(state, squads, clubId);
  const rep = reputation ?? buyer.reputation;
  const base = { ...player, wage: Math.max(player.wage, monthlyWage(player.age + 1, player.overall, rep)) };
  return contractDemand(state, { player: base, buyer, fromReputation: buyer.reputation, kind: 'loan' }, years);
}

function rankingOf(c: Competition): string[] {
  return c.format ? finalRanking(c) : computeStandings(c).map((r) => r.clubId);
}

/** Campeão/vice/artilheiro de cada competição (addChampion). (Etapa 1) `comps` = as que fecham na virada. */
export function seasonChampions(state: SeasonState, squads: Squads, comps: Competition[] = state.competitions): ChampionRecord[] {
  const out: ChampionRecord[] = [];
  // (Registros) nome do jogador: clube do gol, clube de origem, mercado (livres/transferidos)
  const nameOf = (pid: string, clubId: string) =>
    squads(clubId).find((p) => p.id === pid)?.name ?? squads(baseClubOf(pid)).find((p) => p.id === pid)?.name ?? state.market?.players[pid]?.name ?? pid;
  for (const c of comps) {
    const order = c.format ? null : computeStandings(c);
    let top: ChampionRecord['topScorer'];
    for (const [pid, g] of Object.entries(c.scorers ?? {})) {
      if (!top || g > top.goals || (g === top.goals && pid < top.playerId)) top = { playerId: pid, goals: g, clubId: c.scorerClubs?.[pid] };
    }
    if (top?.clubId) top.name = squads(top.clubId).find((p) => p.id === top!.playerId)?.name;
    out.push({
      competitionId: c.id, name: c.name, type: c.type, season: c.cycleSeason ?? state.season,
      championId: c.championId ?? order?.[0]?.clubId ?? null,
      viceId: c.viceId ?? order?.[1]?.clubId ?? null,
      topScorer: top, titles: c.titles?.length ? c.titles : undefined,
      ...(c.cycle ? { cycle: c.cycle } : {}), ...(c.seasonLabel ? { seasonLabel: c.seasonLabel } : {}),
      ...competitionRecord(c, order ? order.map((r) => r.clubId) : finalRanking(c), nameOf),
    });
  }
  return out;
}

/** Ajusta a lista de promovidos para `n` clubes (completa pela ordem final, sem repetir). */
function fitCount(list: string[], n: number, ranking: string[], exclude: string[]): string[] {
  const out = list.slice(0, n);
  for (const c of ranking) {
    if (out.length >= n) break;
    if (!out.includes(c) && !exclude.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Série D Real: 64 vagas pelos estaduais (spec §3.3): mín. 2 e máx. 4 por UF, extras pelo tamanho da
 * 1ª divisão estadual; se faltar clube numa UF, a vaga vai para a UF com mais clubes disponíveis.
 * (Etapa 1: o Brasil não tem mais Série D como liga nacional; mantido para dados antigos.)
 */
export function allocateSerieD(
  stateRanking: Record<string, string[]>, stateDivisions: Record<string, string[]>, exclude: Set<string>,
  slots: number, minPerUf = 2, maxPerUf = 4,
): string[] {
  const ufs = Object.keys(stateRanking).sort();
  const avail = new Map(ufs.map((u) => [u, (stateRanking[u] ?? []).filter((c) => !exclude.has(c))]));
  const d1 = (u: string) => stateDivisions[`${u}-1`]?.length ?? 0;
  const bySize = ufs.slice().sort((a, b) => d1(b) - d1(a) || (avail.get(b)!.length - avail.get(a)!.length) || a.localeCompare(b));
  const alloc = new Map(ufs.map((u) => [u, 0]));
  let left = slots;
  for (let cap = 1; cap <= maxPerUf && left > 0; cap++) {
    const order = cap <= minPerUf ? ufs : bySize;
    for (const u of order) {
      if (left <= 0) break;
      if (alloc.get(u)! < cap && alloc.get(u)! < avail.get(u)!.length) { alloc.set(u, alloc.get(u)! + 1); left--; }
    }
  }
  while (left > 0) {
    const u = bySize.slice().sort((a, b) => (avail.get(b)!.length - alloc.get(b)!) - (avail.get(a)!.length - alloc.get(a)!))[0];
    if (!u || avail.get(u)!.length - alloc.get(u)! <= 0) break;
    alloc.set(u, alloc.get(u)! + 1);
    left--;
  }
  const out: string[] = [];
  for (const u of ufs) out.push(...avail.get(u)!.slice(0, alloc.get(u)!));
  return out;
}

/**
 * (Etapa 2) Substitutos dos rebaixados da Série B (que voltam a ser "só estadual"): candidatos = os 2 melhores clubes
 * sem divisão nacional de cada UF no ranking estadual mais recente (os estaduais que acabaram de terminar); entre eles,
 * os `n` de maior pontuação = nível + 0,5 × reputação − 0,5 × posição no estadual (força pesa mais que a UF pequena).
 */
export function stateReplacements(
  stateRanking: Record<string, string[]>, national: Set<string>, n: number, meta: Map<string, CareerData['clubs'][number]>,
): string[] {
  const cand: { id: string; score: number }[] = [];
  for (const uf of Object.keys(stateRanking).sort()) {
    let k = 0;
    stateRanking[uf].forEach((id, pos) => {
      if (k >= 2 || national.has(id) || !meta.has(id)) return;
      k++;
      const m = meta.get(id)!;
      cand.push({ id, score: m.level + 0.5 * (m.reputation ?? 0) - 0.5 * pos });
    });
  }
  return cand.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, n).map((c) => c.id);
}

/** Meio-ano (ano×2 + semestre) de uma data — marcador de "livre desde" (Etapa 1). */
const halfYear = (date: string) => Number(date.slice(0, 4)) * 2 + (date.slice(5) >= '07-01' ? 1 : 0);

/** (Etapa 1) Informação da virada pendente de uma SeasonState (ciclo, temporada que fecha, regiões, data). */
export function turnoverInfo(state: SeasonState): { cycle: Cycle; season: number; label: string; regions: Region[] | null; aging: boolean; date: string } {
  const seg = state.segment;
  if (!seg) return { cycle: 'calendar', season: state.season, label: String(state.season), regions: null, aging: true, date: `${state.season + 1}-01-01` };
  const season = cycleSeason(seg.closes, seg.end);
  return { cycle: seg.closes, season, label: seasonLabel(seg.closes, season), regions: regionsOfCycle(seg.closes), aging: seg.closes === 'split', date: addDays(seg.end, 1) };
}

/** Virada (regional). Retorna o WorldState seguinte e o resumo da temporada encerrada do ciclo que virou. */
export function rolloverSeason(
  world: WorldState, state: SeasonState, base: Squads, data: CareerData, pools: NamePools, o: RolloverOptions = {},
): { world: WorldState; summary: SeasonSummary } {
  const w = deep(world);
  const ti = turnoverInfo(state);
  const { cycle, season, aging } = ti;
  const turnoverDate = ti.date;
  const nextYear = Number(turnoverDate.slice(0, 4));
  const squads = careerSquads(state, worldSquads(world, base));
  const clubMeta = new Map(data.clubs.map((c) => [c.id, c]));
  const codes = new Map(data.countries.map((c) => [c.id, c.code]));
  const regionOfId = (id: string): Region | null => (state.clubInfo?.[id]?.region as Region | undefined) ?? regionOfCode(codes.get(clubMeta.get(id)?.countryId ?? -1) ?? null);
  const inClosing = (id: string) => !ti.regions || ti.regions.includes(regionOfId(id) as Region);
  const isBRWorld = !!w.divisions['BRA-1'];
  const flags = data.competitions.countries?.BRA ?? {};
  const summary: SeasonSummary = {
    season, champions: [], promoted: {}, relegated: {}, stateMoves: {}, retirements: [], youth: [],
    contracts: { renewed: 0, released: 0, humanReleased: [], signedFree: 0 }, loansReturned: 0,
    evolution: { players: 0, delta: 0, bonus: 0 },
    averages: { age: 0, overall: 0, balance: 0, players: 0 },
    cycle, ...(ti.regions ? { regions: ti.regions } : {}), seasonLabel: ti.label, aging, date: turnoverDate,
  };

  /* 0) competições que fecham (cópias encerradas à força se ainda não terminaram — ex.: jogo remarcado após a virada) */
  const closing = state.competitions
    .filter((c) => !state.segment || cycleOfCompetition(c) === cycle)
    .map((c) => {
      if (c.finished) return c;
      const x = deep(c);
      x.fixtures = x.fixtures.filter((f) => !!f.result);
      if (x.format && x.championId === undefined) forceFinishCompetition(x);
      x.finished = true;
      return x;
    });
  const closingIds = new Set(closing.map((c) => c.id));
  const view: SeasonState = { ...state, competitions: state.competitions.map((c) => (closingIds.has(c.id) ? closing.find((x) => x.id === c.id)! : c)) };

  /* 1) campeões e histórico (antes de mover os clubes) */
  summary.champions = seasonChampions(state, squads, closing);
  w.history.push(...summary.champions);
  // (Registros) carreiras dos jogadores: todas as linhas do trecho (de todas as regiões) vão para o mundo
  w.records ??= emptyRecords();
  flushLines(w.records, state, state.segment?.start ?? state.date);
  // (Prêmios) Bola de Ouro, Seleção do Mundo e time do campeonato de cada humano — só nas viradas dos humanos
  if (state.humanClubIds.some(inClosing)) {
    const humansNow = new Set(state.humanClubIds);
    const leagues = closing
      .filter((c) => c.type === 'league' && c.countryId !== undefined && c.clubIds.some((id) => humansNow.has(id)))
      .map((c) => ({ competitionId: c.id, name: c.name, seasonLabel: ti.label, clubIds: c.clubIds.slice() }));
    summary.awards = computeSeasonAwards(w, squads, Object.keys(state.clubs), { cycle, season, date: turnoverDate, leagues });
    w.awards = [...(w.awards ?? []), summary.awards].slice(-AWARDS.keep);
  }
  for (const c of closing) w.lastRanking[c.id] = rankingOf(c);
  // campeões por país (copa e liga): Supercopa e pote 1 do ano seguinte
  w.holders ??= {};
  const countriesClosing = new Set(closing.filter((c) => c.countryId !== undefined).map((c) => c.countryId!));
  for (const cid of countriesClosing) {
    const code = codes.get(cid);
    if (!code) continue;
    const cup = closing.find((c) => c.id === `${code}-CUP`);
    const lg = closing.find((c) => c.id === `${code}-1` && c.type === 'league');
    const lcup = closing.find((c) => c.id === `${code}-LCUP`);
    const prev = w.holders[code];
    const lgRank = lg ? rankingOf(lg) : [];
    w.holders[code] = {
      league: lg ? lg.championId ?? lgRank[0] ?? null : prev?.league ?? null,
      cup: cup ? cup.championId ?? null : prev?.cup ?? null, cupVice: cup ? cup.viceId ?? null : prev?.cupVice ?? null,
      // (Etapa 2) vice da liga (supercopas de 4), campeão do Apertura (Superliga), campeão da copa da liga (EFL Cup)
      leagueVice: lg ? lgRank.find((c) => c !== (lg.championId ?? lgRank[0])) ?? null : prev?.leagueVice ?? null,
      leagueTitle: lg ? (lg.titles ?? []).find((t) => t.title === 'Apertura')?.clubId ?? null : prev?.leagueTitle ?? null,
      leagueCup: lcup ? lcup.championId ?? null : prev?.leagueCup ?? null,
    };
  }
  // (Etapa 2) campeões continentais (Supercopa da UEFA, Recopa, Intercontinental, vagas de campeão)
  w.titleHolders ??= {};
  for (const c of closing) {
    if (['UCL', 'UEL', 'UECL', 'ACL', 'LIBERTADORES', 'SULAMERICANA', 'RECOPA', 'INTERCONTINENTAL', 'UEFA-SUP', 'SUPERMUNDIAL'].includes(c.id) && c.championId) {
      w.titleHolders[c.id] = { clubId: c.championId, season: c.cycleSeason ?? season };
    }
  }
  if (w.holders.BRA && closing.some((c) => c.countryId === 29)) {
    w.cupHolder = w.holders.BRA.cup;
    w.cupVice = w.holders.BRA.cupVice;
    w.leagueHolder = w.holders.BRA.league;
  }

  /* 1b) (Fase 2) vagas continentais do ano seguinte (América do Sul): resultados deste ano */
  if (cycle === 'calendar' && isBRWorld && w.options.continental !== false) {
    const champ = (id: string) => closing.find((c) => c.id === id)?.championId ?? null;
    w.continental = qualifyContinental(data, season + 1, {
      orders: ordersFromSeason(view, w, data),
      cupHolder: w.cupHolder,
      holders: { LIBERTADORES: champ('LIBERTADORES'), SULAMERICANA: champ('SULAMERICANA') },
    });
    const mine = new Set(data.clubs.filter((c) => c.countryId === w.countryId).map((c) => c.id));
    summary.continental = { ...qualifiedFrom(w.continental, mine), qualifiers: w.continental };
  }

  /* 1c) (Etapa 2) vagas UEFA e AFC da temporada europeia/saudita seguinte: tabelas finais + copas + campeões */
  if (cycle === 'split' && w.options.continental !== false) {
    const orders: Record<string, string[]> = {};
    for (const c of closing) {
      if (c.type !== 'league' || c.division !== 1 || c.countryId === undefined) continue;
      const code = codes.get(c.countryId);
      if (code) orders[code] = rankingOf(c);
    }
    if (Object.keys(w.divisions).some((id) => /^(ING|ESP|ITA|ALE|FRA|POR|HOL)-1$/.test(id))) summary.uefa = w.uefa = qualifyUefa(data, w, season + 1, { orders });
    if (w.divisions['ARS-1']) summary.afc = w.afc = qualifyAfc(data, w, season + 1, { orders });
  }

  /* 2) estaduais (Brasil, ano civil) */
  const ufs = new Set(closing.filter((c) => c.type === 'state' && c.uf).map((c) => c.uf!));
  for (const uf of ufs) {
    const comps = closing.filter((c) => c.type === 'state' && c.uf === uf).sort((a, b) => (a.division ?? 0) - (b.division ?? 0));
    const down = comps.map((c) => (c.relegatedIds ?? []).filter((x) => c.clubIds.includes(x)));
    down[down.length - 1] = [];
    const up = comps.map((c, i) => (i === 0 ? [] : fitCount([], down[i - 1].length, rankingOf(c), down[i])));
    comps.forEach((c, i) => {
      const key = `${uf}-${c.division}`;
      const stay = rankingOf(c).filter((x) => c.clubIds.includes(x) && !up[i].includes(x) && !down[i].includes(x));
      w.stateDivisions[key] = [...stay, ...(up[i + 1] ?? []), ...(i > 0 ? down[i - 1] : [])];
      summary.stateMoves[key] = { up: up[i], down: down[i] };
    });
    const inDivs = new Set(comps.flatMap((c) => c.clubIds));
    const ranking = comps.flatMap((c) => rankingOf(c));
    w.stateRanking[uf] = [...ranking, ...(world.stateRanking[uf] ?? []).filter((c) => !inDivs.has(c))];
  }

  /* 3) divisões nacionais POR PAÍS da região que virou: rebaixados(i) = promovidos(i+1) */
  const natAll = closing.filter((c) => c.type === 'league' && w.divisions[c.id] !== undefined);
  const byCountry = new Map<number, Competition[]>();
  for (const c of natAll) {
    const k = c.countryId ?? -1;
    let arr = byCountry.get(k);
    if (!arr) byCountry.set(k, (arr = []));
    arr.push(c);
  }
  for (const [cid, list] of [...byCountry.entries()].sort((a, b) => a[0] - b[0])) {
    const natComps = list.sort((a, b) => (a.division ?? 0) - (b.division ?? 0));
    const realD = cid === 29 && !!flags.brazilSerieDReal;
    const down = natComps.map((c) => (realD && c.division === 4 ? [] : (c.relegatedIds ?? []).filter((x) => c.clubIds.includes(x))));
    // (Etapa 2) a última divisão não rebaixa — exceto a Série B, cujos rebaixados voltam a ser "só estadual"
    const lastRules = natComps.length ? data.leagues.find((l) => l.id === natComps[natComps.length - 1].id)?.rules : undefined;
    const toStates = lastRules?.dropToStates ? down[down.length - 1].slice() : [];
    if (down.length) down[down.length - 1] = toStates;
    const up = natComps.map((c, i) => (i === 0 ? [] : fitCount(c.promotedIds ?? [], down[i - 1].length, rankingOf(c), down[i])));
    // (Etapa 2) playoff de rebaixamento entre divisões (Relegation, Barrage...): se o da divisão de baixo vence, trocam
    const code = codes.get(cid);
    const po = code ? closing.find((c) => c.id === `${code}-PO`) : undefined;
    if (po?.championId && natComps.length >= 2) {
      const upper = po.entrants?.upper?.[0], lower = po.entrants?.lower?.[0];
      const swapped = !!upper && !!lower && po.championId === lower && natComps[0].clubIds.includes(upper) && natComps[1].clubIds.includes(lower)
        && !down[0].includes(upper) && !up[1].includes(lower);
      if (swapped) { down[0].push(upper!); up[1].push(lower!); }
      if (upper && lower) (summary.relegationPlayoffs ??= {})[code!] = { winner: po.championId, loser: po.championId === upper ? lower : upper, swapped };
    }
    const newLists = natComps.map((c, i) => {
      const stay = rankingOf(c).filter((x) => c.clubIds.includes(x) && !up[i].includes(x) && !down[i].includes(x));
      return [...stay, ...(up[i + 1] ?? []), ...(i > 0 ? down[i - 1] : [])];
    });
    // (Etapa 2) Série B: os rebaixados saem; entram os melhores clubes "só estadual" pelos estaduais
    if (toStates.length) {
      const li = natComps.length - 1;
      const national = new Set([...newLists.flat(), ...toStates]);
      const fromStates = stateReplacements(w.stateRanking, national, toStates.length, clubMeta);
      newLists[li].push(...fromStates);
      (summary.fromStates ??= {})[natComps[li].id] = fromStates;
    }
    natComps.forEach((c, i) => {
      if (i > 0) summary.promoted[c.id] = up[i];
      if (down[i].length) summary.relegated[c.id] = down[i];
    });
    const dIdx = natComps.findIndex((c) => c.division === 4);
    if (realD && dIdx >= 0) {
      const D = natComps[dIdx];
      const cfg = data.competitions.serieD ?? { slots: 64, kept: 28, minPerUf: 2, maxPerUf: 4, ufOrder: [] };
      const fromC = dIdx > 0 ? down[dIdx - 1] : [];
      const rankD = rankingOf(D).filter((x) => D.clubIds.includes(x) && !up[dIdx].includes(x));
      const kept = rankD.slice(0, cfg.kept);
      const dropped = rankD.slice(cfg.kept);
      const exclude = new Set<string>([...newLists.slice(0, dIdx).flat(), ...fromC, ...kept]);
      const total = D.clubIds.length;
      const fromStates = allocateSerieD(w.stateRanking, w.stateDivisions, exclude, Math.max(0, total - kept.length - fromC.length), cfg.minPerUf, cfg.maxPerUf);
      newLists[dIdx] = [...kept, ...fromC, ...fromStates];
      summary.serieD = { fromC, kept, fromStates, dropped };
      summary.relegated[D.id] = dropped;
    }
    natComps.forEach((c, i) => (w.divisions[c.id] = newLists[i]));
  }

  /* 4) jogadores: mercado do trecho → mundo; contratos (região que virou); envelhecimento (1º/07) */
  const wp = w.players;
  const m = state.market;
  const segEnd = state.segment?.end ?? `${state.season}-12-31`;
  if (m) {
    wp.club = { ...m.moves };
    wp.data = { ...wp.data, ...m.players };
    const keepLoans: Record<string, PlayerContract> = {};
    for (const [pid, c] of Object.entries(m.contracts)) {
      if (c.kind === 'loan' && c.loanFrom) {
        // (Etapa 1) empréstimo que termina depois da virada continua (contrato guardado no mundo)
        if (!c.loanUntil || c.loanUntil <= segEnd) {
          wp.club[pid] = c.loanFrom;
          // (Etapa 5) volta com o contrato que tinha com o dono
          if (c.parentEnd !== undefined) wp.contractEnd[pid] = c.parentEnd;
          summary.loansReturned++;
        } else keepLoans[pid] = { ...c };
        continue;
      }
      wp.contractEnd[pid] = c.endsSeason;
    }
    wp.loans = keepLoans;
  }
  const career = state.career;
  const startSeason = w.startSeason;
  const agedBefore = world.agedYears ?? state.season - startSeason;
  const contractEndOf = (p: Player) => {
    const c = m?.contracts[p.id];
    if (c && c.kind !== 'loan') return c.endsSeason;
    return wp.contractEnd[p.id] ?? defaultContractEnd(p.id, p.age - agedBefore, startSeason);
  };
  /** temporada contratual do clube DEPOIS da virada (contratos novos de livres e juniores) */
  const seasonAfter = (clubId: string) => cycleSeason(cycleOfRegion(regionOfId(clubId)), turnoverDate);
  const humans = new Set(w.humanClubIds);
  const renewMap: Record<string, RenewTerms | true> = Array.isArray(o.renew)
    ? Object.fromEntries(o.renew.map((id) => [id, true as const]))
    : { ...(o.renew ?? {}) };
  const renewSet = new Set(Object.keys(renewMap));
  summary.contracts.refused = [];
  const seedR = state.segment ? `${w.seed}:${turnoverDate}:rollover` : `${w.seed}:${season}:rollover`;
  const hyNow = halfYear(turnoverDate);
  let sumAge = 0, sumOvr = 0, nPl = 0;

  const writePlayer = (p: Player, clubId: string) => {
    if (!isGenerated(p.id) && baseClubOf(p.id) === clubId) {
      wp.delta[p.id] = [p.age, p.overall, p.potential, p.wage, p.value, p.youth ? 1 : 0];
      delete wp.club[p.id];
      delete wp.data[p.id];
    } else {
      wp.club[p.id] = clubId;
      wp.data[p.id] = p;
      delete wp.delta[p.id];
    }
    delete wp.freeSince[p.id];
  };
  const humanSet = new Set(w.humanClubIds);
  const removePlayer = (pid: string) => {
    // (Registros) carreira sem relevância de quem sai do jogo não fica no save
    pruneRetired(w.records!, pid, humanSet);
    wp.retired[pid] = season;
    delete wp.club[pid];
    delete wp.data[pid];
    delete wp.delta[pid];
    delete wp.contractEnd[pid];
    delete wp.freeSince[pid];
    delete wp.loans?.[pid];
  };

  const tracked = Object.keys(state.clubs).sort();
  const rosters = new Map<string, Player[]>();
  const levels = new Map<string, number>();
  // (Etapa 5) pré-contratos: chegam ao clube novo nesta virada (região do clube atual)
  const preContracts = m?.preContracts ?? {};
  const arrivals: { clubId: string; p: Player }[] = [];
  summary.contracts.preContracts = [];
  /** Gera `n` juniores no clube (nomes da nacionalidade do clube). */
  const addYouth = (clubId: string, remaining: Player[], n: number, forRetirement: boolean) => {
    const meta = clubMeta.get(clubId);
    if (n <= 0 || !meta) return;
    const code = codes.get(meta.countryId) ?? '';
    // (Fase 2) nomes do país do clube; sem o pool carregado, usa o do país da carreira
    const pool = pools[code] ?? pools[w.countryCode];
    // (escala real) juniores no patamar do elenco atual (overall, valor e salário) — calculado antes de incluí-los
    const scales = squadScales(remaining, meta.reputation);
    for (let k = 0; k < n; k++) {
      const id = `${clubId}:g${nextYear}-${++wp.seq}`;
      const rng = new Rng(`${seedR}:youth:${id}`);
      const y = generateYouthPlayer({
        id, clubLevel: meta.level, clubReputation: meta.reputation, nationalityId: meta.countryId, pool,
        brazilStyle: code === 'BRA', position: neediestPosition(remaining, rng), rng, ...scales,
      });
      wp.club[id] = clubId;
      wp.data[id] = y;
      wp.contractEnd[id] = seasonAfter(clubId) + 2;
      remaining.push(y);
      sumAge += y.age; sumOvr += y.overall; nPl++;
      summary.youth.push({ playerId: id, name: y.name, clubId, nationalityId: y.nationalityId, overall: y.overall, potential: y.potential });
      if (forRetirement) {
        const ret = summary.retirements.find((r) => r.clubId === clubId && !r.youthId);
        if (ret) ret.youthId = id;
      }
    }
  };
  for (const clubId of tracked) {
    const meta = clubMeta.get(clubId);
    const rep = meta?.reputation ?? 2;
    const human = humans.has(clubId);
    const closingClub = inClosing(clubId);
    const squad = squads(clubId);
    let retiredHere = 0;
    const remaining: Player[] = [];
    // titulares (14 melhores) para a regra de renovação da CPU; (Etapa 5) excedentes: fora dos 22 melhores
    const byOvr = squad.slice().sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    const starters = new Set(byOvr.slice(0, 14).map((p) => p.id));
    const core = new Set(byOvr.slice(0, 22).map((p) => p.id));
    // (Etapa 5) salário de mercado no patamar do clube (renovações da IA não derrubam a folha)
    const wScaleClub = human ? 1 : Math.min(5, Math.max(0.2, squadScales(squad, rep).wageScale ?? 1));
    // (Etapa 4) teto da folha da diretoria nas renovações do humano (folha mensal corrente do elenco)
    const ceiling = human ? state.clubInfo?.[clubId]?.wageCeiling ?? 0 : 0;
    let wageNow = squad.reduce((s, p) => s + (p.wage || 0), 0);
    // (Etapa 5) IA: folha-alvo das renovações = min(teto, W0 × 1,02) — renovação acima dela fica pelo salário atual
    const infoC = state.clubInfo?.[clubId];
    const aiTarget = !human && infoC?.wageBill ? Math.min(infoC.wageCeiling ?? Infinity, infoC.wageBill * AI_MARKET.renewTarget) : 0;
    for (const p of squad) {
      const rng = new Rng(`${seedR}:${p.id}`);
      const st = career?.stats[p.id];
      const games = st?.[0] ?? 0;
      const avg = games ? st![2] / 10 / games : 0;
      let np: Player = p;
      if (closingClub) {
        // aposentadoria (≥ 33) no fim da temporada DA REGIÃO do clube (junto com os contratos). Marcado pelo humano para
        // renovar: só se aposenta com 38+ (decisão documentada). O sorteio é feito sempre (mesma sequência de RNG com
        // ou sem renovação). (Etapa 1) Na virada sul-americana as estatísticas cobrem só jul–dez (zeradas no
        // envelhecimento de 1º/07): os jogos são extrapolados para o ano (× 2).
        const gamesYear = state.segment && cycle === 'calendar' ? games * 2 : games;
        const retires = rng.chance(retireChance(p, career ? gamesYear : undefined));
        const protectedByRenewal = (human && renewSet.has(p.id) && p.age < RENEW_RETIRE_AGE) || !!preContracts[p.id];
        if (retires && !protectedByRenewal) {
          removePlayer(p.id);
          retiredHere++;
          summary.retirements.push({ playerId: p.id, name: p.name, clubId, age: p.age, overall: p.overall });
          continue;
        }
      }
      if (aging) {
        // 1º de julho: bônus + idade + potencial
        const evo = career?.evo[p.id] ?? p.overall;
        const bonus = yearEndBonus(p.age, games, avg);
        if (bonus) summary.evolution.bonus += bonus;
        const overall = Math.max(1, Math.min(99, Math.round(evo + bonus)));
        summary.evolution.delta += overall - p.overall;
        summary.evolution.players++;
        const age = p.age + 1;
        const potential = nextPotential(age, p.potential, overall, rng);
        np = {
          ...p, age, overall, potential, value: revalue(p, age, overall, potential, rep),
          youth: p.youth && age < YOUTH.graduateAge,
        };
      }
      // (Etapa 5) pré-contrato assinado: sai para o clube novo no fim do contrato (não renova)
      const pc = closingClub ? preContracts[p.id] : undefined;
      if (pc && pc.fromClubId === clubId && m?.contracts[p.id]?.kind !== 'loan') {
        const moved: Player = { ...np, wage: pc.wage };
        wp.club[p.id] = pc.toClubId;
        wp.data[p.id] = moved;
        delete wp.delta[p.id];
        wp.contractEnd[p.id] = seasonAfter(pc.toClubId) + Math.max(1, pc.years) - 1;
        delete wp.freeSince[p.id];
        arrivals.push({ clubId: pc.toClubId, p: moved });
        summary.contracts.preContracts!.push({ playerId: p.id, name: p.name, from: clubId, to: pc.toClubId });
        continue;
      }
      // contrato (só clubes da região que virou)
      const loanBack = m?.contracts[p.id]?.kind === 'loan';
      if (closingClub && !loanBack && contractEndOf(p) <= season) {
        // (Etapa 5) IA: peças-chave (14 melhores, < 33) renovam quase sempre; excedentes (fora dos 22) quase nunca
        let renew = human
          ? w.options.humanAutoRenew || renewSet.has(p.id)
          : rng.chance(starters.has(p.id) && p.age < 33 ? 0.85 : !core.has(p.id) || p.age >= 34 ? 0.12 : 0.45);
        const terms = human ? renewMap[p.id] : undefined;
        let years = rng.int(1, 3);
        // (escala real) piso de mercado genérico, ou o salário atual corrigido pela evolução (preserva o patamar do clube)
        const growth = monthlyWage(np.age, np.overall, rep) / Math.max(1, monthlyWage(p.age, p.overall, rep));
        let wage = Math.max(np.wage, monthlyWage(np.age, np.overall, rep), Math.round((np.wage * Math.min(2, Math.max(1, growth))) / 100) * 100);
        // (Etapa 5) IA: salário de mercado no patamar do clube (corrige a queda das folhas da IA ao longo dos anos)
        if (!human) wage = Math.max(wage, Math.round((monthlyWage(np.age, np.overall, rep) * wScaleClub) / 100) * 100);
        if (renew && !human && aiTarget > 0 && wage > p.wage && (wageNow + wage - p.wage) * 12 > aiTarget) wage = p.wage;
        // (18/11) contrato renovado nunca abaixo do piso salarial do overall
        wage = withWageFloor(wage, np.age, np.overall);
        if (renew && terms && terms !== true && (terms.wage !== undefined || terms.years !== undefined)) {
          // renovação detalhada: o jogador avalia (regra de evaluateContract, última rodada)
          const y = Math.round(terms.years ?? years);
          const demand = renewalDemand(state, squads, clubId, p, y, rep);
          const offer = Math.round(terms.wage ?? demand.wage);
          const buyer = clubView(state, squads, clubId);
          const base = { ...p, wage: Math.max(p.wage, monthlyWage(p.age + 1, p.overall, rep)) };
          const d = evaluateContract(state, { player: base, buyer, fromReputation: buyer.reputation, kind: 'loan', wage: offer, years: y, round: MARKET.maxRounds, renewal: true });
          if (d.decision === 'accept') { years = y; wage = offer; }
          else { renew = false; summary.contracts.refused!.push({ playerId: p.id, asked: demand.wage, offered: offer, reason: d.reason }); }
        }
        // (Etapa 4) renovação que aumenta a folha acima do teto: vetada pela diretoria
        if (renew && human && ceiling > 0 && wage > p.wage && (wageNow + wage - p.wage) * 12 > ceiling) {
          renew = false;
          summary.contracts.refused!.push({ playerId: p.id, asked: wage, offered: wage, reason: `A diretoria vetou: a folha passaria do teto de ${fmtMoneyShort(ceiling)}/ano.` });
        }
        wageNow += renew ? wage - p.wage : -p.wage;
        if (renew) {
          wp.contractEnd[p.id] = season + years;
          np = { ...np, wage };
          summary.contracts.renewed++;
        } else {
          wp.club[p.id] = '';
          wp.data[p.id] = np;
          delete wp.delta[p.id];
          delete wp.contractEnd[p.id];
          wp.freeSince[p.id] = hyNow;
          summary.contracts.released++;
          if (human) summary.contracts.humanReleased.push(p.id);
          continue;
        }
      }
      const owner = wp.club[p.id] !== undefined && wp.club[p.id] !== '' && wp.club[p.id] !== clubId ? wp.club[p.id] : clubId; // empréstimo devolvido
      writePlayer(np, owner);
      remaining.push(np);
      sumAge += np.age; sumOvr += np.overall; nPl++;
    }
    // cada aposentadoria gera um júnior (regra do original)
    addYouth(clubId, remaining, retiredHere, true);
    rosters.set(clubId, remaining);
    const best = remaining.filter((p) => !p.youth).map((p) => p.overall).sort((a, b) => b - a).slice(0, 11);
    levels.set(clubId, best.length ? best.reduce((a, b) => a + b, 0) / best.length : 0);
  }
  // (Etapa 5) chegadas por pré-contrato entram no elenco do clube novo (reposição e juniores contam com elas)
  for (const a of arrivals) {
    const r = rosters.get(a.clubId);
    if (r) { r.push(a.p); sumAge += a.p.age; sumOvr += a.p.overall; nPl++; }
  }
  // livres: quem está livre há ~1 temporada (2 viradas) sai do jogo (desistiu/aposentou); dispensados durante o
  // trecho ganham o prazo até a próxima virada
  for (const [pid, c] of Object.entries(wp.club)) {
    if (c !== '') continue;
    if (!wp.data[pid]) { delete wp.club[pid]; continue; }
    const since = wp.freeSince[pid];
    if (since === undefined) { wp.freeSince[pid] = hyNow - 1; continue; }
    if (hyNow - since >= 2) removePlayer(pid);
  }
  // reposição da CPU da região que virou: clubes com menos de FILL_TO jogadores contratam livres do seu nível
  const free = Object.entries(wp.club).filter(([, c]) => c === '').map(([pid]) => wp.data[pid]).filter((p): p is Player => !!p && p.age <= 34)
    .sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
  const taken = new Set<string>();
  const cpu = [...rosters.keys()].filter((id) => !humans.has(id) && inClosing(id)).sort((a, b) => levels.get(b)! - levels.get(a)! || (a < b ? -1 : 1));
  for (const clubId of cpu) {
    const rep = clubMeta.get(clubId)?.reputation ?? 2;
    const roster = rosters.get(clubId)!;
    const lvl = levels.get(clubId)!;
    // (escala real) salário no patamar do clube (mediana salário ÷ genérico do elenco atual)
    const wScale = Math.min(5, Math.max(0.2, squadScales(roster, rep).wageScale ?? 1));
    const cs = seasonAfter(clubId);
    for (const p of free) {
      if (roster.length >= FILL_TO) break;
      // reposição de elenco: jogadores até o nível do time titular (não reforços)
      if (taken.has(p.id) || p.overall > lvl) continue;
      taken.add(p.id);
      const np = { ...p, wage: withWageFloor(Math.max(300, Math.round((monthlyWage(p.age, p.overall, rep) * wScale) / 100) * 100), p.age, p.overall) };
      wp.club[p.id] = clubId;
      wp.data[p.id] = np;
      wp.contractEnd[p.id] = p.age >= 31 ? cs : cs + 1;
      delete wp.freeSince[p.id];
      roster.push(np);
      sumAge += np.age; sumOvr += np.overall; nPl++;
      summary.contracts.signedFree++;
    }
  }
  // juniores do ano (1º/07): +YOUTH.perYear para quem ainda está abaixo do tamanho mínimo (base ≤ 20)
  if (aging) {
    for (const clubId of tracked) {
      const roster = rosters.get(clubId);
      if (!roster) continue;
      const youthCount = roster.filter((p) => p.youth).length;
      const extra = Math.min(YOUTH.perYear, YOUTH.academyLimit - youthCount, Math.max(0, YOUTH.squadCap - roster.length));
      addYouth(clubId, roster, extra, false);
    }
  }
  // (13/11) elenco mínimo: clube que ficou abaixo de MIN_SQUAD completa com juniores da base
  for (const clubId of tracked) {
    const roster = rosters.get(clubId);
    if (roster && roster.length < MIN_SQUAD) addYouth(clubId, roster, MIN_SQUAD - roster.length, false);
  }

  /* 5) finanças: caixa mantido; livro-caixa dos humanos da região que virou arquivado ("2026" ou "2026/27") */
  let sumBal = 0, nBal = 0;
  w.finance ??= {};
  for (const [id, c] of Object.entries(state.clubs)) {
    w.balances[id] = c.balance;
    sumBal += c.balance; nBal++;
    // (Etapa 4) Moral da Torcida persiste (só os diferentes de 60)
    if (c.fanMorale !== undefined && Math.abs(c.fanMorale - 60) >= 0.5) (w.fans ??= {})[id] = Math.round(c.fanMorale * 10) / 10;
    else if (w.fans) delete w.fans[id];
    if (humans.has(id) && c.finance && inClosing(id)) {
      const key = state.segment ? seasonLabel(cycleOfRegion(regionOfId(id)), season) : String(season);
      (w.ledgers[key] ??= {})[id] = { ...c.finance };
    }
    // (Fase 2) empréstimo, luvas, preço do ingresso, obra e capacidade do estádio continuam no trecho seguinte
    const cap = state.clubInfo?.[id]?.capacity;
    const baseCap = clubMeta.get(id)?.capacity;
    if (c.loan || c.luvaDebts?.length || c.ticketPrice != null || c.stadiumWork || (cap !== undefined && cap !== baseCap)) {
      w.finance[id] = {
        ...(c.ticketPrice != null ? { ticketPrice: c.ticketPrice } : {}),
        ...(c.loan ? { loan: c.loan } : {}),
        ...(c.luvaDebts?.length ? { luvaDebts: c.luvaDebts.map((d) => ({ ...d })) } : {}),
        ...(c.stadiumWork ? { stadiumWork: { ...c.stadiumWork } } : {}),
        ...(cap !== undefined && cap !== baseCap ? { capacity: cap } : {}),
      };
    } else delete w.finance[id];
  }
  w.rev = Math.max(w.rev ?? 1, CAREER_REV);

  summary.averages = { age: nPl ? sumAge / nPl : 0, overall: nPl ? sumOvr / nPl : 0, balance: nBal ? sumBal / nBal : 0, players: nPl };
  // (Fase 3) carreira do técnico: fim da temporada DO CLUBE DO TÉCNICO (desempregado: na virada de ano civil)
  if (w.coach) {
    const before = w.coach.coach.clubId;
    const coachCycle = before ? cycleOfRegion(regionOfId(before)) : 'calendar';
    if (!state.segment || coachCycle === cycle) {
      coachSeasonEnd(w, view, data, summary);
      // demitido/sem renovação na virada: o caixa do ex-clube já foi gravado acima — a multa entra em world.balances
      if (before && !w.coach.coach.clubId) summary.coachLeft = before;
    }
  }
  if (aging) w.agedYears = agedBefore + 1;
  else w.agedYears = agedBefore;
  w.season = nextYear;
  return { world: w, summary };
}

/**
 * Virada completa: rollover + SeasonState do trecho seguinte (com mercado). (Etapa 1) As competições do ciclo que
 * não virou continuam (carry), as do ciclo que virou recomeçam com a temporada seguinte.
 */
export function nextSeason(
  world: WorldState, state: SeasonState, base: Squads, data: CareerData, pools: NamePools, o: RolloverOptions = {},
): { world: WorldState; state: SeasonState; summary: SeasonSummary } {
  const r = rolloverSeason(world, state, base, data, pools, o);
  const start = state.segment ? addDays(state.segment.end, 1) : `${r.world.season}-01-01`;
  const ns = createSeasonFromWorld(r.world, data, { squads: worldSquads(r.world, base), startDate: start, ...(state.segment ? { carry: state } : {}) });
  return { world: r.world, state: ns, summary: r.summary };
}

/**
 * Jogadores do humano com contrato terminando na virada pendente (para a UI perguntar antes dela). (Etapa 1) Só
 * quando a virada é da região do clube (América do Sul em 31/12; Europa/Arábia em 30/06).
 */
export function expiringContracts(world: WorldState, state: SeasonState, base: Squads, clubId: string): Player[] {
  const ti = turnoverInfo(state);
  const r = (state.clubInfo?.[clubId]?.region as Region | undefined) ?? null;
  if (state.segment && (!r || cycleOfRegion(r) !== ti.cycle)) return [];
  const squads = careerSquads(state, worldSquads(world, base));
  const m = state.market;
  const aged = world.agedYears ?? state.season - world.startSeason;
  return squads(clubId).filter((p) => {
    const c = m?.contracts[p.id];
    if (c?.kind === 'loan') return false;
    // (Etapa 5) quem assinou pré-contrato com outro clube sai na virada (não há o que renovar)
    if (m?.preContracts?.[p.id]) return false;
    const end = c ? c.endsSeason : world.players.contractEnd[p.id] ?? defaultContractEnd(p.id, p.age - aged, world.startSeason);
    return end <= ti.season;
  });
}

/** (Etapa 1) Países de uma região com ligas no mundo (para a UI agrupar o fim de temporada regional). */
export function regionCountryCodes(region: Region): string[] {
  return SCOPE_REGIONS[region].countries.slice();
}
