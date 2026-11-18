/**
 * (Base) Categorias de base dos clubes HUMANOS: de tempos em tempos (30–60 dias) a base revela um jogador, que o
 * técnico PROMOVE ao elenco principal (contrato de 3 anos, salário pequeno) ou DISPENSA. Sem decisão em 120 dias, ele
 * deixa o clube. Até 6 revelados esperando.
 *
 *  - Overall 60–82 e potencial 75–95, independentes e com cauda: overall = 60 + 22·u^2,6 e potencial = 75 + 20·v^2,4
 *    (u, v uniformes) — metade dos revelados tem overall ≤ 65 e potencial ≤ 83; overall 80+ sai em ~4% e potencial
 *    93+ em ~4%. O potencial fica sempre pelo menos 3 acima do overall.
 *  - Salário sempre pequeno: € 800 + € 100 por ponto acima de 60 (no máximo € 3 mil por mês).
 *  - Nome: primeiro nome e sobrenome de jogadores do próprio elenco, da nacionalidade mais comum dele.
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
  age: [16, 18] as const,
  /** salário mensal: base + por ponto de overall acima do mínimo */
  wageBase: 800,
  wagePerPoint: 100,
  contractYears: 3,
  /**
   * elenco máximo para promover. Maior que o do mercado (32): os elencos reais passam disso (Santos 37, São Paulo 40)
   * e a base ficaria inútil nos clubes grandes
   */
  squadCap: 45,
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

/** Nome e nacionalidade a partir do elenco (nacionalidade mais comum; nome de um, sobrenome de outro). */
function nameFrom(squad: readonly Player[], rng: Rng, fallbackNat: number): { name: string; nationalityId: number } {
  const count = new Map<number, number>();
  for (const p of squad) count.set(p.nationalityId, (count.get(p.nationalityId) ?? 0) + 1);
  let nat = fallbackNat, best = -1;
  for (const [n, c] of count) if (c > best || (c === best && n < nat)) { nat = n; best = c; }
  const words = squad.filter((p) => p.nationalityId === nat && p.name).map((p) => p.name.trim().split(/\s+/));
  const full = words.filter((w) => w.length >= 2);
  if (!full.length) {
    const single = words.map((w) => w[0]).filter(Boolean);
    return { name: single.length ? `${rng.pick(single)} Jr.` : 'Garoto da Base', nationalityId: nat };
  }
  const given = rng.pick(full)[0];
  const sur = rng.pick(full);
  return { name: `${given} ${sur[sur.length - 1]}`, nationalityId: nat };
}

/** Gera o revelado (determinístico pela semente do `rng`). */
export function generateProspect(id: string, squad: readonly Player[], rng: Rng, rep = 2, fallbackNat = 29): Player {
  const { overall, potential } = rollAcademyRatings(rng);
  const age = rng.int(ACADEMY.age[0], ACADEMY.age[1]);
  const position = rng.pick(POSITIONS);
  const { name, nationalityId } = nameFrom(squad, rng, fallbackNat);
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
    const p = generateProspect(id, squads(clubId), r, rep);
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
