/**
 * Decisões do mercado: preço pedido pelo clube, avaliação de propostas (transferência, empréstimo, multa) e de
 * contratos (salário, anos, multa rescisória; o jogador pode recusar o clube).
 * Toda aleatoriedade vem de seeds estáveis (jogador × comprador), então a "opinião" de um clube sobre um jogador não
 * muda entre rodadas — o humano pode aprender a negociar.
 *
 * (Etapa 5) Na carreira, o valor de referência é o valor de mercado dinâmico (transfers/value.ts: overall, idade,
 * potencial, liga, contrato e reputação) e entram a necessidade do vendedor na posição, o caixa relativo à receita,
 * o perfil vendedor (América do Sul, Portugal/Holanda, divisões de baixo vendem para clubes mais ricos) e a liga /
 * minutos / continentais na decisão do jogador. Temporadas avulsas (sem carreira) mantêm as regras antigas.
 */
import type { Player, Position } from '@cosmicfut/shared';
import type { ClubEconomyInfo, LoanTerms, SeasonState, TransferKind } from '../contract';
import { Rng } from '../rng';
import { fmtMoneyShort } from '../money';
import { autoPickLineup, DEFAULT_TACTIC } from '../tactics';
import { clubName, contractEnd, contractSeasonOf, countByPosition, FREE, isHumanClub, MARKET, type Squads } from './market';
import { careerValue, careerWorth, clubLeagueMult, leagueMultiplier, monthsLeftOf, releaseClauseOf } from './value';
import { wageFloor } from './wage-floor';

/** Informação de um clube fora da temporada (ex.: comprar de um clube estrangeiro). */
export interface ExternalClubInfo extends ClubEconomyInfo {
  balance?: number;
}

export interface ClubView {
  clubId: string;
  name: string;
  reputation: number; // 0..5
  division: number; // 1 = elite; clubes fora da temporada: informado ou 1
  balance: number;
  squad: Player[];
  human: boolean;
  inSeason: boolean;
  /* ── (Etapa 5) ── */
  /** multiplicador da liga atual (transfers/value.ts) */
  league: number;
  region: string | null;
  /** receita anual (0 = desconhecida) */
  revenue: number;
  /** disputa competição continental no trecho atual */
  continental: boolean;
}

const continentalCache = new WeakMap<object, Set<string>>();
/** Clubes em competições continentais no trecho (memorizado pela lista de competições). */
export function continentalClubs(state: SeasonState): Set<string> {
  let s = continentalCache.get(state.competitions);
  if (!s) {
    s = new Set<string>();
    for (const c of state.competitions) if (c.type === 'continental') for (const id of c.clubIds) s.add(id);
    continentalCache.set(state.competitions, s);
  }
  return s;
}

export function clubView(state: SeasonState, squads: Squads, clubId: string, ext?: ExternalClubInfo): ClubView {
  if (clubId === FREE) {
    return { clubId, name: 'Sem clube', reputation: 0, division: 9, balance: 0, squad: [], human: false, inSeason: false, league: 0.5, region: null, revenue: 0, continental: false };
  }
  const info = state.clubInfo?.[clubId];
  const cs = state.clubs[clubId];
  return {
    clubId,
    name: clubName(state, clubId, ext),
    reputation: info?.reputation ?? ext?.reputation ?? 2,
    division: info?.division ?? ext?.division ?? 1,
    balance: cs ? cs.balance : (ext?.balance ?? 0),
    squad: squads(clubId),
    human: isHumanClub(state, clubId),
    inSeason: !!cs,
    league: info ? clubLeagueMult(state, clubId) : leagueMultiplier(ext?.leagueKey, ext?.code),
    region: info?.region ?? ext?.region ?? null,
    revenue: info?.revenue ?? ext?.revenue ?? 0,
    continental: continentalClubs(state).has(clubId),
  };
}

/* ───────────── preço pedido ───────────── */

export interface AskingPrice {
  ask: number;
  /** valor de referência (carreira: valor de mercado dinâmico) */
  value: number;
  /** multiplicadores aplicados sobre o valor de mercado (para a UI explicar) */
  factors: {
    importance: number; age: number; contract: number; finances: number; reputation: number; listed: number; noise: number;
    need: number; seller: number; untouchable: number;
  };
  role: 'key' | 'starter' | 'reserve';
  yearsLeft: number;
}

const round50k = (v: number) => Math.max(0, Math.round(v / 50_000) * 50_000);
const round1k = (v: number) => Math.max(0, Math.round(v / 1_000) * 1_000);

/** Papel do jogador no elenco do vendedor: top-3 em overall = peça-chave; no XI do autoPick = titular. */
export function squadRole(squad: Player[], playerId: string): 'key' | 'starter' | 'reserve' {
  if (!squad.length) return 'reserve';
  const top3 = squad.slice().sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1)).slice(0, 3);
  if (top3.some((p) => p.id === playerId)) return 'key';
  if (squad.length >= 11 && autoPickLineup(squad, DEFAULT_TACTIC).starters.includes(playerId)) return 'starter';
  return 'reserve';
}

/** Ligas/divisões "vendedoras" (vivem de vender para mercados mais ricos). */
export function isSellingClub(v: Pick<ClubView, 'region' | 'division' | 'clubId'>, info?: ClubEconomyInfo): boolean {
  if (v.region === 'SA') return true;
  if (v.division >= 2) return true;
  const code = info?.code;
  return code === 'POR' || code === 'HOL';
}

/**
 * Preço pedido = valor × importância × necessidade × idade × contrato × finanças × reputação × perfil vendedor ×
 * intocável × listado × ruído
 *  - importância: peça-chave 1.35 · titular 1.2 · reserva 1.0 (0.9 se o elenco tem ≥ 28)
 *  - necessidade: a posição ficaria abaixo do mínimo (GOL 2, LAT 3, ZAG 3, MEI 5, ATA 3) → 1.25
 *  - idade e contrato: na carreira já estão no valor (1); temporada avulsa: ≤21 1.2 … ≥34 0.6 e 0.65/0.85/1
 *  - finanças: caixa < 0 → 0.85 · < 5% da receita → 0.93 · > 50% da receita → 1.08 (sem receita: < 2M / > 30M)
 *  - reputação: vendedor maior que o comprador +10%/ponto; menor −3%/ponto (mín 0.9)
 *  - perfil vendedor (carreira): América do Sul → Europa 0.88; clube vendedor (América do Sul, POR/HOL, 2ª divisão)
 *    para comprador ≥ 1,5× mais rico 0.94
 *  - intocável: peça-chave de clube grande (reputação ≥ 4) com ≥ 2 temporadas de contrato 1.2
 *  - listado para venda: 0.85; ruído determinístico 0.95–1.05 (seed jogador × comprador); piso de 40% do valor
 */
export function askingPrice(state: SeasonState, player: Player, seller: ClubView, buyer: ClubView): AskingPrice {
  const career = !!state.career;
  const value = careerValue(state, player, seller.clubId);
  const role = squadRole(seller.squad, player.id);
  const importance = role === 'key' ? 1.35 : role === 'starter' ? 1.2 : seller.squad.length >= 28 ? 0.9 : 1;
  const a = player.age;
  const ageBase = a <= 21 ? 1.2 : a <= 24 ? 1.1 : a <= 29 ? 1 : a <= 31 ? 0.9 : a <= 33 ? 0.75 : 0.6;
  const age = career ? 1 : ageBase * (1 + Math.max(0, player.potential - player.overall) * 0.01);
  const yearsLeft = Math.max(0, contractEnd(state, player) - contractSeasonOf(state, seller.clubId));
  const contract = career ? 1 : yearsLeft <= 0 ? 0.65 : yearsLeft === 1 ? 0.85 : 1;
  const R = seller.revenue;
  const finances = seller.balance < 0 ? 0.85
    : R > 0 ? (seller.balance < 0.05 * R ? 0.93 : seller.balance > 0.5 * R ? 1.08 : 1)
      : seller.balance < 2e6 ? 0.95 : seller.balance > 30e6 ? 1.08 : 1;
  const d = seller.reputation - buyer.reputation;
  const reputation = d > 0 ? 1 + 0.1 * d : Math.max(0.9, 1 + 0.03 * d);
  const counts = seller.squad.length ? countByPosition(seller.squad) : null;
  const need = counts && counts[player.position] - 1 < MARKET.minByPosition[player.position] ? 1.25 : 1;
  let sellerF = 1;
  if (career) {
    const richer = buyer.revenue > 0 && seller.revenue > 0 && buyer.revenue >= 1.5 * seller.revenue;
    if (seller.region === 'SA' && buyer.region === 'EU' && richer) sellerF = 0.88;
    else if (richer && isSellingClub(seller, state.clubInfo?.[seller.clubId])) sellerF = 0.94;
  }
  const monthsLeft = career ? monthsLeftOf(state, player, seller.clubId) ?? 0 : yearsLeft * 12;
  const untouchable = career && role === 'key' && seller.reputation >= 4 && monthsLeft >= 24 ? 1.2 : 1;
  const listed = state.market?.transferList.includes(player.id) ? 0.85 : 1;
  const noise = new Rng(`${state.seed ?? 'season'}:ask:${player.id}:${buyer.clubId}`).range(0.95, 1.05);
  const raw = value * importance * need * age * contract * finances * reputation * sellerF * untouchable * listed * noise;
  const ask = round50k(Math.max(value * 0.4, raw, 50_000));
  return { ask, value, factors: { importance, age, contract, finances, reputation, listed, noise, need, seller: sellerF, untouchable }, role, yearsLeft };
}

/* ───────────── avaliação da proposta (clube vendedor) ───────────── */

export type Decision = 'accept' | 'reject' | 'counter';

export interface OfferDecision {
  decision: Decision;
  /** contraproposta (valor) quando decision = 'counter' */
  counterFee?: number;
  /** (Etapa 5) empréstimo: termos pedidos pelo dono na contraproposta */
  counterLoan?: LoanTerms;
  ask: number;
  ratio: number;
  /** negociação encerrada (não aceita novas rodadas) */
  final: boolean;
  reason: string;
  /** (Etapa 5) venda forçada pela multa rescisória */
  clause?: boolean;
}

export interface EvaluateOfferInput {
  player: Player;
  fee: number;
  /** rodada 1..MARKET.maxRounds */
  round: number;
  kind?: TransferKind;
  seller: ClubView;
  buyer: ClubView;
  /** (Etapa 5) termos do empréstimo (padrão: 100% do salário, sem opção, sem retorno antecipado) */
  loan?: LoanTerms;
  /** (Etapa 5) o comprador deposita a multa rescisória (`fee` ≥ multa ⇒ venda forçada) */
  clause?: boolean;
}

/** Termos mínimos que o dono exige num empréstimo (taxa, % do salário). */
export function loanRequirements(state: SeasonState, player: Player, seller: ClubView, buyer: ClubView, ask: number): { fee: number; wageShare: number; option: number } {
  const surplus = (state.market?.loanList ?? []).includes(player.id) || seller.squad.length >= 28;
  const young = player.age <= 21;
  const fee = surplus || young ? 0 : round50k(ask * 0.08);
  const richer = buyer.revenue > 0 && seller.revenue > 0 && buyer.revenue >= seller.revenue;
  const wageShare = surplus ? (young ? 40 : 60) : richer ? 100 : 75;
  return { fee, wageShare, option: round50k(Math.max(ask, 100_000)) };
}

/**
 * Clube da IA decide sobre a proposta. r = valor / preço pedido:
 *  - elenco do vendedor ficaria < 18 → recusa final
 *  - multa rescisória depositada (≥ multa vigente) → aceita (venda forçada)
 *  - empréstimo: titular/peça-chave não é emprestado; exige taxa (8% do pedido; 0 para excedentes e jovens ≤ 21),
 *    parte do salário (100% de quem é mais rico; 75%; excedentes 40–60%) e opção de compra ≥ 95% do pedido
 *  - r ≥ 1 → aceita
 *  - última rodada: r ≥ 0.95 → aceita; senão recusa final
 *  - 0.8 ≤ r < 1 → contraproposta = pedido × (1 + 0.04 × rodadas restantes)
 *  - r < 0.8 → recusa (pode tentar de novo até a última rodada)
 */
export function evaluateOffer(state: SeasonState, input: EvaluateOfferInput): OfferDecision {
  const { player, fee, seller, buyer } = input;
  const kind = input.kind ?? 'transfer';
  const round = Math.max(1, input.round);
  const last = round >= MARKET.maxRounds;
  const minSquad = state.market?.rules.minSquad ?? MARKET.minSquad;
  const price = askingPrice(state, player, seller, buyer);
  let ask = price.ask;
  if (seller.squad.length && seller.squad.length - 1 < minSquad) {
    return { decision: 'reject', ask, ratio: fee / Math.max(1, ask), final: true, reason: `O ${seller.name} não pode ficar com menos de ${minSquad} jogadores.` };
  }
  if (kind !== 'loan' && (input.clause || kind === 'transfer') && seller.clubId) {
    const clause = releaseClauseOf(state, player, seller.clubId);
    if (input.clause) {
      if (fee >= clause) return { decision: 'accept', ask, ratio: fee / Math.max(1, ask), final: true, clause: true, reason: `Multa rescisória de ${fmt(clause)} depositada: o ${seller.name} é obrigado a liberar ${player.name}.` };
      return { decision: 'reject', ask, ratio: fee / Math.max(1, ask), final: false, reason: `A multa rescisória de ${player.name} é de ${fmt(clause)}.` };
    }
    // proposta acima da multa: o clube não segura (é o mesmo que pagar a multa)
    if (fee >= clause) return { decision: 'accept', ask, ratio: fee / Math.max(1, ask), final: true, clause: true, reason: `A proposta cobre a multa rescisória: o ${seller.name} libera ${player.name}.` };
  }
  if (kind === 'loan') {
    const listedLoan = (state.market?.loanList ?? []).includes(player.id);
    if (price.role !== 'reserve' && !listedLoan) return { decision: 'reject', ask, ratio: 0, final: true, reason: `O ${seller.name} não empresta jogadores titulares.` };
    const req = loanRequirements(state, player, seller, buyer, ask);
    const terms = input.loan ?? { wageShare: 100 };
    const share = Math.max(0, Math.min(100, terms.wageShare));
    const optionOk = terms.purchaseOption === undefined || terms.purchaseOption >= req.option * 0.95;
    ask = req.fee;
    const ratio = req.fee > 0 ? fee / req.fee : 1;
    if (fee >= req.fee && share >= req.wageShare && optionOk) {
      return { decision: 'accept', ask, ratio, final: true, reason: `O ${seller.name} aceitou emprestar ${player.name}.` };
    }
    const counterLoan: LoanTerms = {
      wageShare: Math.max(share, req.wageShare),
      ...(terms.purchaseOption !== undefined ? { purchaseOption: Math.max(terms.purchaseOption, req.option) } : {}),
      ...(terms.recall ? { recall: true } : {}),
    };
    if (last) return { decision: 'reject', ask, ratio, final: true, reason: `O ${seller.name} encerrou a negociação do empréstimo.` };
    const parts: string[] = [];
    if (fee < req.fee) parts.push(`taxa de ${fmt(req.fee)}`);
    if (share < req.wageShare) parts.push(`${req.wageShare}% do salário pagos por vocês`);
    if (!optionOk) parts.push(`opção de compra de ${fmt(req.option)}`);
    return { decision: 'counter', counterFee: Math.max(fee, req.fee), counterLoan, ask, ratio, final: false, reason: `O ${seller.name} empresta com ${parts.join(', ')}.` };
  }
  const ratio = ask > 0 ? fee / ask : 1;
  if (ratio >= 1) return { decision: 'accept', ask, ratio, final: true, reason: `O ${seller.name} aceitou a proposta.` };
  if (last) {
    if (ratio >= 0.95) return { decision: 'accept', ask, ratio, final: true, reason: `Na última rodada, o ${seller.name} aceitou fechar negócio.` };
    return { decision: 'reject', ask, ratio, final: true, reason: `O ${seller.name} encerrou as negociações.` };
  }
  if (ratio >= 0.8) {
    const counterFee = round50k(Math.max(fee + 50_000, ask * (1 + 0.04 * (MARKET.maxRounds - round))));
    return { decision: 'counter', counterFee, ask, ratio, final: false, reason: `O ${seller.name} quer mais e pede ${fmt(counterFee)}.` };
  }
  return {
    decision: 'reject',
    ask,
    ratio,
    final: false,
    reason: ratio < 0.6 ? `O ${seller.name} considerou a proposta ofensiva.` : `O ${seller.name} recusou: proposta muito abaixo do esperado.`,
  };
}

/* ───────────── contrato (jogador) ───────────── */

export interface ContractDemand {
  wage: number;
  minYears: number;
  maxYears: number;
  /** (Etapa 5) papel esperado no clube novo e o multiplicador de cada motivo (para a UI explicar) */
  role?: 'starter' | 'rotation' | 'bench';
  factors?: { raise: number; reputation: number; division: number; ambition: number; age: number; league: number; role: number; continental: number; clause: number };
}

export interface ContractInput {
  player: Player;
  buyer: ClubView;
  /** reputação do clube atual do jogador (livre = 1) */
  fromReputation: number;
  kind?: TransferKind;
  /** (Etapa 5) multiplicador de liga do clube atual (livre/ausente: o do comprador) */
  fromLeague?: number;
  /** (Etapa 5) multa rescisória proposta no contrato novo */
  releaseClause?: number;
  /** (Etapa 5) renovação com o próprio clube: o interesse no clube não entra (só salário/anos) */
  renewal?: boolean;
}

const STARTERS_BY_POS: Record<Position, number> = { GK: 1, FB: 2, CB: 2, MF: 3, FW: 2 };

/** Papel esperado no elenco do comprador: entre os k melhores da posição = titular; até 2 abaixo / −3 = rodízio. */
export function expectedRole(squad: Player[], p: Player): 'starter' | 'rotation' | 'bench' {
  const k = STARTERS_BY_POS[p.position];
  const same = squad.filter((x) => x.position === p.position && x.id !== p.id).map((x) => x.overall).sort((a, b) => b - a);
  const better = same.filter((o) => o > p.overall).length;
  if (better < k) return 'starter';
  const kth = same[k - 1] ?? 0;
  if (better < k + 2 || p.overall >= kth - 3) return 'rotation';
  return 'bench';
}

/**
 * Salário exigido = salário atual × aumento × reputação × divisão × ambição × idade × liga × minutos × continental ×
 * multa × ruído
 *  - aumento: transferência 1.15 · livre/pré-contrato 1.10 (há luvas) · empréstimo 1.0
 *  - reputação (comprador − atual = d): d < 0 → +10%/ponto; d > 0 → −4%/ponto (mín 0.88)
 *  - divisão do comprador: +12% por divisão abaixo da elite
 *  - ambição: overall ≥ 82 em clube de reputação ≤ 2 → 1.2; overall ≥ 78 na 3ª divisão ou abaixo → 1.25
 *  - idade ≥ 32 → 0.92
 *  - (carreira) liga: (liga do comprador ÷ liga atual)^0,5 entre 0.85 e 1.8 (ligas mais ricas pagam mais)
 *  - minutos: titular 0.97 · rodízio 1.03 · banco 1.12
 *  - continental: o comprador joga continental 0.96; sem continental e overall ≥ 80 1.06
 *  - multa: < 1,5× o valor 0.97 (gosta de multa baixa); > 6× 1.05
 *  - duração preferida: ≤23 anos 3–5 · ≤28 2–5 · ≤31 2–4 · ≥32 1–2 (fora disso +6%/ano de distância)
 */
export function contractDemand(state: SeasonState, input: ContractInput, years?: number): ContractDemand {
  const { player: p, buyer } = input;
  const kind = input.kind ?? 'transfer';
  const raise = kind === 'free' || kind === 'precontract' ? 1.1 : kind === 'loan' ? 1 : 1.15;
  const d = buyer.reputation - input.fromReputation;
  const rep = d < 0 ? 1 - 0.1 * d : Math.max(0.88, 1 - 0.04 * d);
  const div = 1 + 0.12 * Math.max(0, buyer.division - 1);
  const amb = p.overall >= 82 && buyer.reputation <= 2 ? 1.2 : p.overall >= 78 && buyer.division >= 3 ? 1.25 : 1;
  const age = p.age >= 32 ? 0.92 : 1;
  const career = !!state.career;
  const fromL = input.fromLeague ?? buyer.league;
  const league = career && fromL > 0 && buyer.league > 0 ? Math.min(1.8, Math.max(0.85, Math.sqrt(buyer.league / fromL))) : 1;
  const role = buyer.squad.length ? expectedRole(buyer.squad, p) : 'starter';
  const roleF = role === 'starter' ? 0.97 : role === 'rotation' ? 1.03 : 1.12;
  const continental = !career ? 1 : buyer.continental ? 0.96 : p.overall >= 80 ? 1.06 : 1;
  const worth = careerWorth(state, p, buyer.clubId);
  const clause = input.releaseClause === undefined || !(worth > 0) ? 1 : input.releaseClause < 1.5 * worth ? 0.97 : input.releaseClause > 6 * worth ? 1.05 : 1;
  const [minYears, maxYears] = p.age <= 23 ? [3, 5] : p.age <= 28 ? [2, 5] : p.age <= 31 ? [2, 4] : [1, 2];
  const dist = years === undefined ? 0 : years < minYears ? minYears - years : years > maxYears ? years - maxYears : 0;
  const noise = new Rng(`${state.seed ?? 'season'}:wage:${p.id}:${buyer.clubId}`).range(0.95, 1.05);
  // (18/11) base nunca abaixo do piso do overall (ligas que pagam pouco: Portugal, Holanda, Bélgica)
  const wage = round1k(Math.max(1_000, p.wage, wageFloor(p.age, p.overall)) * raise * rep * div * amb * age * league * roleF * continental * clause * noise * (1 + 0.06 * dist));
  return { wage, minYears, maxYears, role, factors: { raise, reputation: rep, division: div, ambition: amb, age, league, role: roleF, continental, clause } };
}

/**
 * (Etapa 5) Interesse do jogador no clube (quanto maior, melhor): reputação, liga, minutos e continental. Abaixo de
 * −2,2 ele recusa, a menos que o salário passe de 1,6× o pedido ("o dinheiro fala": veteranos e Arábia).
 *   0,6 × Δreputação + 2,2 × ln(liga nova ÷ liga atual) (½ peso com 30+) + minutos (titular +0,6 · banco −1,2;
 *   dobrado até 23 anos) + continental 0,4 − Arábia antes dos 28 vindo da Europa 1,5
 */
export function playerAppeal(state: SeasonState, input: ContractInput): { score: number; reason: string } {
  const { player: p, buyer } = input;
  if (!state.career) return { score: 0, reason: '' };
  const fromL = input.fromLeague ?? buyer.league;
  const repT = 0.6 * (buyer.reputation - input.fromReputation);
  const leagueT = 2.2 * Math.log(Math.max(0.05, buyer.league) / Math.max(0.05, fromL)) * (p.age >= 30 ? 0.5 : 1);
  const role = buyer.squad.length ? expectedRole(buyer.squad, p) : 'starter';
  const roleT = (role === 'starter' ? 0.6 : role === 'bench' ? -1.2 : 0) * (p.age <= 23 ? 2 : 1);
  const contT = buyer.continental ? 0.4 : 0;
  const saudiT = buyer.region === 'SAU' && p.age < 28 && fromL >= 0.9 ? -1.5 : 0;
  const score = repT + leagueT + roleT + contT + saudiT;
  const worst = [
    [repT, `o ${buyer.name} é um clube pequeno demais para ele`],
    [leagueT, `não quer cair de nível de liga`],
    [roleT, `teria poucas chances de jogar no ${buyer.name}`],
    [saudiT, `quer seguir na Europa`],
  ].sort((a, b) => (a[0] as number) - (b[0] as number))[0];
  return { score, reason: worst[1] as string };
}

export interface ContractDecision {
  decision: Decision;
  demand: ContractDemand;
  final: boolean;
  reason: string;
  /** (Etapa 5) recusou o clube (não é questão de salário) */
  refusedClub?: boolean;
}

export const APPEAL_MIN = -2.2;
export const MONEY_TALKS = 1.6;

/**
 * Jogador decide sobre salário/anos/multa: sem interesse no clube (playerAppeal < −2,2) e salário < 1,6× o pedido →
 * recusa final; salário ≥ exigido → aceita; ≥ 85% (antes da última rodada) → contraproposta com o exigido; senão
 * recusa (final na última rodada).
 */
export function evaluateContract(
  state: SeasonState,
  input: ContractInput & { wage: number; years: number; round: number },
): ContractDecision {
  const demand = contractDemand(state, input, input.years);
  const last = input.round >= MARKET.maxRounds;
  const name = input.player.name;
  if (input.years < 1 || input.years > 5) return { decision: 'reject', demand, final: false, reason: 'Contratos vão de 1 a 5 anos.' };
  const appeal = input.renewal ? { score: 0, reason: '' } : playerAppeal(state, input);
  if (appeal.score < APPEAL_MIN && input.wage < demand.wage * MONEY_TALKS) {
    return { decision: 'reject', demand, final: true, refusedClub: true, reason: `${name} recusou: ${appeal.reason}.` };
  }
  if (input.wage >= demand.wage) return { decision: 'accept', demand, final: true, reason: `${name} aceitou o contrato!` };
  const r = input.wage / demand.wage;
  if (!last && r >= 0.85) {
    return { decision: 'counter', demand, final: false, reason: `${name} pede ${fmt(demand.wage)}/mês por ${clampYears(input.years, demand)} anos.` };
  }
  if (last) return { decision: 'reject', demand, final: true, reason: `${name} recusou e encerrou a conversa.` };
  return { decision: 'reject', demand, final: false, reason: `${name} achou o salário baixo demais.` };
}

function clampYears(y: number, d: ContractDemand): number {
  return Math.min(d.maxYears, Math.max(d.minYears, y));
}

function fmt(v: number): string {
  return fmtMoneyShort(v);
}
