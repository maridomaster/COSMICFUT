/**
 * (Base) Categorias de base dos clubes HUMANOS: de tempos em tempos (30–60 dias) a base revela um jogador, que o
 * técnico PROMOVE ao elenco principal (contrato de 3 anos, salário pequeno) ou DISPENSA. Sem decisão em 120 dias, ele
 * deixa o clube. Até 6 revelados esperando.
 *
 *  - Overall 60–82 e potencial 75–95, independentes e com cauda: overall = 60 + 22·u^2,6 e potencial = 75 + 20·v^2,4
 *    (u, v uniformes) — metade dos revelados tem overall ≤ 65 e potencial ≤ 83; overall 80+ sai em ~4% e potencial
 *    93+ em ~4%. O potencial fica sempre pelo menos 3 acima do overall.
 *  - Salário sempre pequeno: € 800 + € 100 por ponto acima de 60 (no máximo € 3 mil por mês).
 *  - Nome: totalmente aleatório e ÚNICO — primeiro nome e sobrenome sorteados (sem peso) entre TODOS os jogadores do
 *    jogo da nacionalidade mais comum do elenco; nunca repete o nome de um jogador existente nem de um revelado antes.
 *
 * O estado fica em `state.market.academy` (vai junto no patch online do mercado e atravessa a virada). Tudo
 * determinístico (semente = clube + data + contador).
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { AcademyProspect, AcademyState, SeasonState } from '../contract';
import { Rng } from '../rng';
import { marketValue } from './players';
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

/** Banco de nomes de uma nacionalidade: primeiros nomes e sobrenomes distintos + nomes que já existem no jogo. */
export interface NameBank {
  given: string[];
  surnames: string[];
  taken: Set<string>;
}

const norm = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const WORD = /^\p{Lu}[\p{L}'-]*$/u;

/** Monta o banco a partir dos jogadores (de todos os clubes) da nacionalidade (`-1` = todas). */
export function nameBank(players: Iterable<Player>, nationalityId: number): NameBank {
  const given = new Set<string>(), surnames = new Set<string>(), taken = new Set<string>();
  for (const p of players) {
    if (!p.name) continue;
    taken.add(norm(p.name));
    if (nationalityId >= 0 && p.nationalityId !== nationalityId) continue;
    const w = p.name.trim().split(/\s+/);
    if (w.length < 2) continue;
    if (WORD.test(w[0]) && w[0].length >= 2) given.add(w[0]);
    const last = w[w.length - 1];
    if (WORD.test(last) && last.length >= 3) surnames.add(last);
  }
  return { given: [...given].sort(), surnames: [...surnames].sort(), taken };
}

/**
 * Nome aleatório e único: primeiro nome × sobrenome (sorteio uniforme entre os DISTINTOS, para não favorecer os
 * comuns), às vezes com dois sobrenomes. Nunca igual a um nome já existente no jogo (`bank.taken`) nem a um já usado
 * pela base (`used`).
 */
export function uniqueName(bank: NameBank, used: ReadonlySet<string>, rng: Rng): string {
  const free = (n: string) => !bank.taken.has(norm(n)) && !used.has(norm(n));
  if (bank.given.length && bank.surnames.length) {
    for (let i = 0; i < 80; i++) {
      const g = rng.pick(bank.given);
      const s1 = rng.pick(bank.surnames);
      const s2 = bank.surnames.length > 1 && rng.chance(0.25) ? rng.pick(bank.surnames) : '';
      const n = s2 && s2 !== s1 ? `${g} ${s1} ${s2}` : `${g} ${s1}`;
      if (g !== s1 && free(n)) return n;
    }
  }
  // banco pequeno: a numeração garante que não repete
  const g = bank.given.length ? rng.pick(bank.given) : 'Garoto';
  const s = bank.surnames.length ? rng.pick(bank.surnames) : 'Base';
  for (let k = 1; ; k++) {
    const n = k === 1 ? `${g} ${s} Júnior` : `${g} ${s} ${k}`;
    if (free(n)) return n;
  }
}

/** Gera o revelado (determinístico pela semente do `rng`). */
export function generateProspect(id: string, name: string, nationalityId: number, rng: Rng, rep = 2): Player {
  const { overall, potential } = rollAcademyRatings(rng);
  const age = rng.int(ACADEMY.age[0], ACADEMY.age[1]);
  const position = rng.pick(POSITIONS);
  const traits = position === 'GK' ? [rng.int(0, 3)] : rng.chance(0.4) ? [rng.int(4, 13)] : [];
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
      if (b.given.length < 20 || b.surnames.length < 20) b = nameBank(all, -1);
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
    // nomes já usados pela base (de qualquer clube humano): revelados atuais e anteriores
    const used = new Set<string>();
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
