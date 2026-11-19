/**
 * (Base) Categorias de base dos clubes HUMANOS: de tempos em tempos (30–60 dias) a base revela um jogador, que o
 * técnico PROMOVE ao elenco principal (contrato de 3 anos, salário pequeno) ou DISPENSA. Sem decisão em 120 dias, ele
 * deixa o clube. Até 6 revelados esperando.
 *
 *  - Overall 60–82 e potencial 75–95, independentes e com cauda: overall = 60 + 22·u^2,6 e potencial = 75 + 20·v^2,4
 *    (u, v uniformes) — metade dos revelados tem overall ≤ 65 e potencial ≤ 83; overall 80+ sai em ~4% e potencial
 *    93+ em ~4%. O potencial fica sempre pelo menos 3 acima do overall.
 *  - Salário sempre pequeno: € 800 + € 100 por ponto acima de 60 (no máximo € 3 mil por mês).
 *  - Nome: DUAS palavras (primeiro nome + sobrenome) comuns da nacionalidade do elenco, pelo quanto aparecem entre os
 *    jogadores desse país (Lucas Silva, João Santos…); nunca repete um revelado anterior nem alguém do elenco.
 *
 * O estado fica em `state.market.academy` (vai junto no patch online do mercado e atravessa a virada). Tudo
 * determinístico (semente = clube + data + contador).
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { AcademyProspect, AcademyState, SeasonState } from '../contract';
import { Rng } from '../rng';
import { marketValue, rollTraits } from './players';
import { addDays } from './schedule';
import { contractEndsSeason, type MarketResult } from '../transfers/actions';

export const ACADEMY = {
  /** primeira revelação: entre 10 e 25 dias depois de a base começar */
  firstDays: [10, 25] as const,
  /** intervalo entre revelações (dias) */
  gapDays: [30, 60] as const,
  /** revelados esperando decisão, no máximo */
  maxProspects: 6,
  /** dias até o revelado sem decisão deixar o clube */
  expireDays: 120,
  ovr: [60, 82] as const,
  pot: [75, 95] as const,
  /** expoentes da cauda (maior = topo mais raro) */
  ovrCurve: 2.6,
  potCurve: 2.4,
  /** o potencial fica pelo menos isto acima do overall */
  minGrowth: 3,
  age: [17, 19] as const,
  /** salário mensal: base + por ponto de overall acima do mínimo */
  wageBase: 800,
  wagePerPoint: 100,
  contractYears: 3,
  /**
   * elenco máximo para promover. Maior que o do mercado (32): os elencos reais passam disso (Santos 37, São Paulo 40)
   * e a base ficaria inútil nos clubes grandes
   */
  squadCap: 45,
  /** nomes já revelados guardados por clube (para nunca repetir) */
  namesKept: 300,
} as const;

const POSITIONS: Position[] = ['GK', 'FB', 'FB', 'CB', 'CB', 'MF', 'MF', 'MF', 'FW', 'FW'];

/** Salário do revelado (sempre pequeno). */
export function academyWage(overall: number): number {
  return Math.round((ACADEMY.wageBase + Math.max(0, overall - ACADEMY.ovr[0]) * ACADEMY.wagePerPoint) / 100) * 100;
}

/** Overall e potencial sorteados (cauda: o topo é raro). */
export function rollAcademyRatings(rng: Rng): { overall: number; potential: number } {
  const [o0, o1] = ACADEMY.ovr;
  const [p0, p1] = ACADEMY.pot;
  const overall = o0 + Math.round((o1 - o0) * Math.pow(rng.next(), ACADEMY.ovrCurve));
  let potential = p0 + Math.round((p1 - p0) * Math.pow(rng.next(), ACADEMY.potCurve));
  potential = Math.min(p1, Math.max(potential, overall + ACADEMY.minGrowth));
  return { overall, potential };
}

/** Nacionalidade mais comum do elenco. */
export function mainNationality(squad: readonly Player[], fallbackNat = 29): number {
  const count = new Map<number, number>();
  for (const p of squad) count.set(p.nationalityId, (count.get(p.nationalityId) ?? 0) + 1);
  let nat = fallbackNat, best = -1;
  for (const [n, c] of count) if (c > best || (c === best && n < nat)) { nat = n; best = c; }
  return nat;
}

/**
 * Banco de nomes de uma nacionalidade: primeiros nomes e sobrenomes COMUNS dos jogadores desse país no jogo, com o
 * peso de quantas vezes aparecem (Lucas, João, Silva, Santos… saem mais). Só palavras que aparecem 2+ vezes — tira
 * apelidos e nomes raros.
 */
export interface NameBank {
  given: string[];
  gw: number[];
  surnames: string[];
  sw: number[];
}

const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const WORD = /^\p{Lu}[\p{L}'-]*$/u;

/** Monta o banco a partir dos jogadores (de todos os clubes) da nacionalidade (`-1` = todas). */
export function nameBank(players: Iterable<Player>, nationalityId: number, minCount = 2): NameBank {
  const g = new Map<string, number>(), sn = new Map<string, number>();
  for (const p of players) {
    if (!p.name || (nationalityId >= 0 && p.nationalityId !== nationalityId)) continue;
    const w = p.name.trim().split(/\s+/);
    if (w.length < 2) continue;
    if (WORD.test(w[0]) && w[0].length >= 3) g.set(w[0], (g.get(w[0]) ?? 0) + 1);
    const last = w[w.length - 1];
    if (WORD.test(last) && last.length >= 3) sn.set(last, (sn.get(last) ?? 0) + 1);
  }
  const pick = (m: Map<string, number>) => [...m.entries()].filter(([, c]) => c >= minCount).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const G = pick(g), S = pick(sn);
  return { given: G.map((x) => x[0]), gw: G.map((x) => x[1]), surnames: S.map((x) => x[0]), sw: S.map((x) => x[1]) };
}

/**
 * Nome com DUAS palavras (primeiro nome + sobrenome), sorteados pelo quanto são comuns na nacionalidade. Nunca
 * repete um nome de `used` (revelados da base e o elenco do clube).
 */
export function uniqueName(bank: NameBank, used: ReadonlySet<string>, rng: Rng): string {
  const free = (n: string) => !used.has(norm(n));
  const pickW = (names: string[], w: number[]) => names[Math.max(0, rng.weightedIndex(w))];
  if (bank.given.length && bank.surnames.length) {
    for (let i = 0; i < 200; i++) {
      const g = pickW(bank.given, bank.gw);
      const s = pickW(bank.surnames, bank.sw);
      const n = `${g} ${s}`;
      if (g !== s && free(n)) return n;
    }
  }
  // banco pequeno: combinações em ordem até achar uma livre
  const G = bank.given.length ? bank.given : ['Lucas'];
  const S = bank.surnames.length ? bank.surnames : ['Silva'];
  for (const g of G) for (const s of S) if (g !== s && free(`${g} ${s}`)) return `${g} ${s}`;
  return `${G[0]} ${S[0]}`;
}

/** Gera o revelado (determinístico pela semente do `rng`). */
export function generateProspect(id: string, name: string, nationalityId: number, rng: Rng, rep = 2): Player {
  const { overall, potential } = rollAcademyRatings(rng);
  const age = rng.int(ACADEMY.age[0], ACADEMY.age[1]);
  const position = rng.pick(POSITIONS);
  const traits = rollTraits(position, rng);
  return {
    id, name, position, age, nationalityId,
    side: rng.chance(0.25) ? 'L' : 'R',
    traits, star: false, highlight: potential >= 90, worldClass: false,
    overall, potential,
    wage: academyWage(overall),
    value: marketValue(age, overall, potential, rep),
    youth: true,
    tmId: null,
  };
}

const compact = (iso: string) => iso.replace(/-/g, '');

/**
 * Dia da base (chamado por `advanceDay`, com o mercado já copiado): começa a base dos humanos, tira os revelados
 * vencidos e revela um jogador quando chega a data. Muta `state.market.academy`; devolve as notícias.
 */
export function academyDay(state: SeasonState, squads: (clubId: string) => readonly Player[]): { text: string; clubId: string }[] {
  const m = state.market;
  if (!m || !state.career) return [];
  const date = state.date;
  const out: { text: string; clubId: string }[] = [];
  // banco de nomes: montado só em dia de revelação (todos os clubes da temporada), uma vez por nacionalidade
  const banks = new Map<number, NameBank>();
  const bankOf = (nat: number) => {
    let b = banks.get(nat);
    if (!b) {
      const all: Player[] = [];
      for (const c of Object.keys(state.clubs)) for (const p of squads(c)) all.push(p);
      for (const p of Object.values(m.players)) all.push(p);
      b = nameBank(all, nat);
      // país com poucos nomes no jogo: usa nomes de todas as nacionalidades
      if (b.given.length < 10 || b.surnames.length < 10) b = nameBank(all, -1);
      banks.set(nat, b);
    }
    return b;
  };
  for (const clubId of state.humanClubIds) {
    const all = (m.academy ??= {});
    let a: AcademyState | undefined = all[clubId];
    if (!a) {
      const r = new Rng(`academy:${clubId}:${date}:start`);
      a = all[clubId] = { next: addDays(date, r.int(ACADEMY.firstDays[0], ACADEMY.firstDays[1])), seq: 0, prospects: [] };
    }
    // vencidos
    const gone = a.prospects.filter((x) => x.expiresOn <= date);
    if (gone.length) {
      a.prospects = a.prospects.filter((x) => x.expiresOn > date);
      for (const g of gone) out.push({ clubId, text: `Base: ${g.player.name} ficou sem espaço e deixou o clube.` });
    }
    if (date < a.next) continue;
    const r = new Rng(`academy:${clubId}:${date}:${a.seq}`);
    a.next = addDays(date, r.int(ACADEMY.gapDays[0], ACADEMY.gapDays[1]));
    if (a.prospects.length >= ACADEMY.maxProspects) continue;
    a.seq++;
    // mesmo formato dos juniores gerados (`:g<n>-<n>`): a virada os guarda como jogadores do mundo, não da base de dados
    const id = `${clubId}:g${compact(date)}-${a.seq}`;
    const rep = state.clubInfo?.[clubId]?.reputation ?? 2;
    const nat = mainNationality(squads(clubId));
    // nomes já usados pela base (de qualquer clube humano): revelados atuais e anteriores, e o elenco do clube
    const used = new Set<string>(squads(clubId).map((x) => norm(x.name)));
    for (const x of Object.values(m.academy)) {
      for (const y of x.prospects) used.add(norm(y.player.name));
      for (const n of x.names ?? []) used.add(norm(n));
    }
    const p = generateProspect(id, uniqueName(bankOf(nat), used, r), nat, r, rep);
    a.names = [...(a.names ?? []), p.name].slice(-ACADEMY.namesKept);
    a.prospects.push({ player: p, revealedOn: date, expiresOn: addDays(date, ACADEMY.expireDays) });
    out.push({
      clubId,
      text: `Base: revelado ${p.name} (${p.age} anos), overall ${p.overall} e potencial ${p.potential}${p.potential >= 90 ? ' — uma joia!' : ''}. Promova ou dispense no menu Base.`,
    });
  }
  return out;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function findProspect(state: SeasonState, clubId: string, playerId: string): AcademyProspect | undefined {
  return state.market?.academy?.[clubId]?.prospects.find((x) => x.player.id === playerId);
}

/** Promove o revelado ao elenco principal (contrato de 3 anos, salário pequeno). */
export function promoteProspect(input: SeasonState, squads: (clubId: string) => readonly Player[], clubId: string, playerId: string): MarketResult {
  if (!input.market) return { state: input, error: 'Mercado não inicializado.' };
  if (!findProspect(input, clubId, playerId)) return { state: input, error: 'Jogador não está na base.' };
  if (squads(clubId).length >= ACADEMY.squadCap) return { state: input, error: `O elenco já tem ${ACADEMY.squadCap} jogadores (máximo para promover da base). Venda ou dispense alguém para abrir vaga.` };
  const state = clone(input);
  const m = state.market!;
  const a = m.academy![clubId];
  const x = a.prospects.find((y) => y.player.id === playerId)!;
  a.prospects = a.prospects.filter((y) => y.player.id !== playerId);
  const p: Player = { ...x.player };
  m.players[p.id] = p;
  m.moves[p.id] = clubId;
  m.contracts[p.id] = { wage: p.wage, endsSeason: contractEndsSeason(state, clubId, ACADEMY.contractYears), since: state.date, fee: 0, kind: 'free' };
  state.news.push({ date: state.date, clubId, text: `${p.name} foi promovido da base ao elenco principal.` });
  return { state };
}

/** Dispensa o revelado (sai da base, sem custo). */
export function releaseProspect(input: SeasonState, clubId: string, playerId: string): MarketResult {
  if (!findProspect(input, clubId, playerId)) return { state: input, error: 'Jogador não está na base.' };
  const state = clone(input);
  const a = state.market!.academy![clubId];
  a.prospects = a.prospects.filter((y) => y.player.id !== playerId);
  return { state };
}
