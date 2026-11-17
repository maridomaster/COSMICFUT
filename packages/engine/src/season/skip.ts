/**
 * (Calendário) Pular no tempo — "simular até aqui" (como no FC): a carreira avança dia a dia até a data escolhida,
 * com o ASSISTENTE no comando do clube humano:
 *  - escalação e substituições: a do assistente (`lineup = null` ⇒ `autoPickLineup` com a condição física de cada
 *    jogo; os jogos do humano são simulados como os da IA, `quickSimulate`);
 *  - mercado: nenhuma compra/venda do humano; propostas recebidas ficam sem resposta e expiram sozinhas (a multa
 *    rescisória depositada continua forçando a venda, como sempre);
 *  - fim de temporada do humano (se não parar nele): renova os contratos das peças-chave (`assistantRenewals`) e faz a
 *    virada; viradas sem humano são automáticas, como no Continuar.
 * Paradas (configuráveis): demissão, proposta de emprego, proposta por jogador do humano acima de X% do valor e fim de
 * temporada do humano; `none` atravessa tudo.
 *
 * Determinismo: o salto é EXATAMENTE o laço "um dia por vez" (advanceDay + coachDay + viradas); `step` pode ser
 * chamado em pedaços (orçamento de dias ou de tempo) sem mudar o resultado, e parar entre dois dias deixa o estado
 * consistente (pronto para salvar e continuar).
 */
import type { Player } from '@cosmicfut/shared';
import type { CareerData, Fixture, MatchResult, SeasonState, SeasonSummary, WorldState } from '../contract';
import type { Squads } from '../transfers/market';
import { advanceDay } from './season';
import { coachDay } from './coach';
import { expiringContracts, nextSeason } from './rollover';
import { careerSquads, worldSquads, type NamePools } from './career';
import { autoTurnoverDue, turnoverDue } from './timeline';
import { addDays } from './schedule';
import { autoPickLineup, DEFAULT_TACTIC, lineupStrength } from '../tactics';
import { unavailablePlayers } from './season';
import { checkWageCeiling } from './econ';
import { monthsLeftOf } from '../transfers/value';
import { renewalAsk, renewInPlace, respondToOffer } from '../transfers/actions';
import { fmtMoneyShort } from '../money';

/** Parâmetros do assistente. */
export const ASSISTANT = {
  /** renova peças-chave com até isto de meses de contrato (no dia 1 de cada mês) */
  renewMonths: 6,
  /** peças-chave: os N melhores com até `keyMaxAge` anos (+ promessas, ver assistantRenewals) */
  keyPlayers: 16,
  keyMaxAge: 32,
  /** caixa negativo: aceita proposta por excedente (fora dos N melhores) com valor ≥ isto × valor de mercado */
  surplusRank: 18,
  /** elenco com mais que isto: lista os excedentes fora dos listKeep melhores (venda; ≤ 22 anos, empréstimo) */
  listAbove: 26,
  listKeep: 22,
  surplusMinPct: 0.9,
  /** preço do ingresso fora de ±isto do preço-base volta ao sugerido */
  ticketBand: 0.25,
};

/**
 * Um dia de gestão do assistente no(s) clube(s) humano(s), ANTES do advanceDay (o laço "um dia por vez" e o salto
 * chamam a mesma função — determinístico). Faz o que a IA faz no clube dela e um pouco mais:
 *  - escalação automática (`lineup = null` ⇒ `autoPickLineup` com a condição física, como a IA);
 *  - esquema: o mais forte (`lineupStrength`) entre o do jogador e o padrão da IA (nunca pior que a IA);
 *  - ingresso: preço do jogador fora de ±25% do preço-base volta ao sugerido (o da IA);
 *  - dia 1: renova as peças-chave com ≤ 6 meses de contrato pelo salário pedido (respeitando o teto da folha), como a
 *    IA faz com as dela;
 *  - caixa negativo: aceita UMA proposta por dia por excedente (fora dos 18 melhores) que pague ≥ 90% do valor.
 * Pode devolver uma SeasonState nova (venda aceita); senão muta e devolve a mesma.
 */
export function assistantDay(input: SeasonState, worldSq: Squads): SeasonState {
  let state = input;
  for (const id of state.humanClubIds) {
    const club = state.clubs[id];
    if (!club) continue;
    club.lineup = null;
    const sqf = careerSquads(state, worldSq);
    const squad = sqf(id);
    if (squad.length < 11) continue;
    // esquema
    const un = unavailablePlayers(club);
    const avail = squad.filter((p) => !un.has(p.id));
    if (avail.length >= 11) {
      const cur = club.tactic ?? DEFAULT_TACTIC;
      const str = (f: typeof cur.formation) => lineupStrength(avail, autoPickLineup(avail, { ...cur, formation: f }, undefined, { fitness: club.fitness }), f);
      if (cur.formation !== DEFAULT_TACTIC.formation && str(DEFAULT_TACTIC.formation) > str(cur.formation)) club.tactic = { ...cur, formation: DEFAULT_TACTIC.formation };
    }
    // ingresso
    const base = state.clubInfo?.[id]?.basePrice;
    if (club.ticketPrice != null && base && base > 0 && Math.abs(club.ticketPrice / base - 1) > ASSISTANT.ticketBand) {
      club.ticketPrice = null;
      state.news.push({ date: state.date, text: 'Assistente: o preço do ingresso voltou ao sugerido pela diretoria.', clubId: id });
    }
    const m = state.market;
    if (!m) continue;
    const ranked = squad.slice().sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
    // renovações de meio de temporada (dia 1)
    if (state.date.endsWith('-01')) {
      const xi = ranked.slice(0, 11);
      const avg = xi.reduce((s, p) => s + p.overall, 0) / Math.max(1, xi.length);
      const key = ranked.filter((p, i) => (i < ASSISTANT.keyPlayers && p.age <= ASSISTANT.keyMaxAge) || (p.age <= 23 && p.potential >= avg - 3));
      for (const p of key) {
        const k = m.contracts[p.id];
        if ((k?.kind === 'loan' && k.loanFrom !== id) || m.preContracts?.[p.id]) continue;
        const months = monthsLeftOf(state, p, id);
        if (months === null || Math.round(months) > ASSISTANT.renewMonths) continue;
        const years = p.age <= 26 ? 3 : p.age <= 30 ? 2 : 1;
        const wage = renewalAsk(state, sqf, id, p, years).wage;
        if (!checkWageCeiling(state, id, sqf(id), wage, p.wage).ok) continue;
        renewInPlace(state, id, p, wage, years);
        state.news.push({ date: state.date, text: `Assistente: ${p.name} renovou por ${years} ${years > 1 ? 'anos' : 'ano'} (${fmtMoneyShort(wage)}/mês).`, clubId: id });
      }
    }
    // elenco inchado (como a IA, dia 1): excedentes fora dos 22 melhores vão à lista de venda; jovens (≤ 22), à de
    // empréstimo — a IA passa a fazer propostas por eles
    const bloated = squad.length > ASSISTANT.listAbove;
    if (bloated && state.date.endsWith('-01')) {
      for (const p of ranked.slice(ASSISTANT.listKeep)) {
        const k = m.contracts[p.id];
        if (k?.kind === 'loan' && k.loanFrom !== id) continue;
        if (p.age <= 22) { if (!(m.loanList ??= []).includes(p.id)) m.loanList.push(p.id); }
        else if (!m.transferList.includes(p.id)) m.transferList.push(p.id);
      }
    }
    // caixa negativo (ou elenco inchado): aceita uma proposta por dia por excedente (venda ≥ 90% do valor; empréstimo)
    if (club.balance < 0 || bloated) {
      const surplus = new Set(ranked.slice(ASSISTANT.surplusRank).map((p) => p.id));
      const offer = m.offers.find((o) => o.status === 'pending' && o.fromClubId === id && surplus.has(o.playerId)
        && (o.kind === 'loan' ? bloated : o.fee >= ASSISTANT.surplusMinPct * (squad.find((p) => p.id === o.playerId)?.value ?? Infinity)));
      if (offer) {
        const r = respondToOffer(state, sqf, offer.id, true);
        if (!r.error || r.state !== state) {
          state = r.state;
          state.news.push({ date: state.date, text: offer.kind === 'loan' ? `Assistente: ${offer.player.name} (excedente) emprestado ao ${offer.toName}.` : `Assistente: aceitou ${fmtMoneyShort(offer.fee)} do ${offer.toName} por ${offer.player.name} (excedente).`, clubId: id });
        }
      }
    }
  }
  return state;
}

/** Elencos efetivos sob demanda (a meta da temporada do técnico segue a força real do elenco). */
export function lazyCareerSquads(state: SeasonState, worldSq: Squads): Squads {
  let cs: Squads | null = null;
  return (id) => (cs ??= careerSquads(state, worldSq))(id);
}

export interface SkipStops {
  /** técnico humano demitido */
  fired: boolean;
  /** proposta de emprego recebida */
  jobOffer: boolean;
  /** proposta por um jogador do humano com valor ≥ `playerOfferPct`% do valor de mercado */
  playerOffer: boolean;
  playerOfferPct: number;
  /** fim da temporada do humano (para antes da virada: renovações e resumo na tela de fim de temporada) */
  seasonEnd: boolean;
  /** "não parar": ignora todas as paradas acima */
  none: boolean;
}

export const DEFAULT_SKIP_STOPS: SkipStops = { fired: true, jobOffer: true, playerOffer: true, playerOfferPct: 120, seasonEnd: true, none: false };

/** Limite de segurança do salto (dias). */
export const SKIP_MAX_DAYS = 3660;

export type SkipReason = 'done' | 'cancelled' | 'fired' | 'job' | 'offer' | 'season-end' | 'limit';

export interface SkipTurnover {
  summary: SeasonSummary;
  /** virada da região do humano (fim de temporada dele) */
  human: boolean;
}

export interface SkipOptions {
  world: WorldState;
  state: SeasonState;
  base: Squads;
  data: CareerData;
  pools: NamePools;
  /** data-alvo (ISO): o salto para quando `state.date` chega nela (o dia-alvo ainda não foi jogado) */
  until: string;
  stops?: Partial<SkipStops>;
  /** chamado depois de cada virada (o worker zera o histórico de saldo nas do humano) */
  onTurnover?: (t: SkipTurnover, world: WorldState, state: SeasonState) => void;
  /** chamado depois de cada dia simulado */
  onDay?: (state: SeasonState, played: { fixture: Fixture; result: MatchResult }[]) => void;
}

/**
 * Renovações do assistente no fim de temporada: peças-chave (16 melhores com até 32 anos) e promessas (até 23 anos
 * com potencial ≥ média do XI − 3). Salário = o pedido de mercado (lista simples da virada); a diretoria ainda veta o
 * que passar do teto da folha.
 */
export function assistantRenewals(world: WorldState, state: SeasonState, base: Squads, clubId: string): string[] {
  const exp = expiringContracts(world, state, base, clubId);
  if (!exp.length) return [];
  const squad = careerSquads(state, worldSquads(world, base))(clubId);
  const ranked = squad.slice().sort((a, b) => b.overall - a.overall || (a.id < b.id ? -1 : 1));
  const top = new Set(ranked.slice(0, 16).map((p) => p.id));
  const xi = ranked.slice(0, 11);
  const avg = xi.length ? xi.reduce((s, p) => s + p.overall, 0) / xi.length : 0;
  return exp.filter((p: Player) => (top.has(p.id) && p.age <= 32) || (p.age <= 23 && p.potential >= avg - 3)).map((p) => p.id).sort();
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** Salto em andamento. `step` avança em pedaços; `cancel` para no fim do dia atual. */
export class TimeSkip {
  world: WorldState;
  state: SeasonState;
  readonly until: string;
  readonly from: string;
  readonly stops: SkipStops;
  days = 0;
  games = 0;
  simMs = 0;
  rolloverMs = 0;
  turnovers: SkipTurnover[] = [];
  reason: SkipReason | null = null;
  note?: string;
  /** (online) clube humano dono do evento que parou o salto (proposta por jogador) */
  stopClubId: string | null = null;
  private sq: Squads;
  private seenOffers = new Set<string>();
  private readonly o: SkipOptions;

  constructor(o: SkipOptions) {
    this.o = o;
    this.world = o.world;
    this.state = o.state;
    this.until = o.until;
    this.from = o.state.date;
    const s = { ...DEFAULT_SKIP_STOPS, ...(o.stops ?? {}) };
    this.stops = s.none ? { ...s, fired: false, jobOffer: false, playerOffer: false, seasonEnd: false } : s;
    this.sq = worldSquads(this.world, o.base);
    this.assistant();
    for (const x of this.state.market?.offers ?? []) this.seenOffers.add(x.id);
  }

  /** Assistente: escalação automática do clube humano (a do jogador volta no próximo Continuar). */
  private assistant(): void {
    for (const id of this.state.humanClubIds) {
      const c = this.state.clubs[id];
      if (c) c.lineup = null;
    }
  }

  get done(): boolean {
    return this.reason !== null;
  }

  /** Total de dias do salto e fração concluída (0..1). */
  get total(): number {
    return Math.max(1, daysBetween(this.from, this.until));
  }
  get progress(): number {
    return Math.min(1, Math.max(0, daysBetween(this.from, this.state.date) / this.total));
  }

  cancel(): void {
    if (!this.reason) this.reason = 'cancelled';
  }

  /**
   * Avança até terminar, parar, ou estourar o orçamento (`days` simulados nesta chamada ou `ms` de relógio; `now`
   * padrão Date.now). Devolve `done`. Sempre para ENTRE dois dias (estado consistente).
   */
  step(budget: { days?: number; ms?: number; now?: () => number } = {}): boolean {
    const now = budget.now ?? Date.now;
    const t0 = now();
    let n = 0;
    while (!this.reason) {
      // chegou: a virada que vence exatamente na data-alvo (ex.: 01/01) ainda é feita, para os registros do ano
      // encerrado já aparecerem (ou parar no fim de temporada do humano, se a parada estiver ligada)
      if (this.state.date >= this.until && !turnoverDue(this.state)) { this.reason = 'done'; break; }
      if (this.days >= SKIP_MAX_DAYS) { this.reason = 'limit'; break; }
      if (budget.days !== undefined && n >= budget.days) break;
      if (budget.ms !== undefined && n > 0 && now() - t0 >= budget.ms) break;
      if (turnoverDue(this.state)) {
        const human = !autoTurnoverDue(this.state);
        if (human && this.stops.seasonEnd) {
          this.reason = 'season-end';
          this.note = 'Fim de temporada: veja o resumo, renove os contratos e continue o salto.';
          break;
        }
        const r0 = now();
        const humanId = this.state.humanClubIds[0];
        const renew = human && humanId ? assistantRenewals(this.world, this.state, this.o.base, humanId) : [];
        const r = nextSeason(this.world, this.state, this.o.base, this.o.data, this.o.pools, { renew });
        this.rolloverMs += now() - r0;
        this.world = r.world;
        this.state = r.state;
        this.sq = worldSquads(this.world, this.o.base);
        this.assistant();
        const t: SkipTurnover = { summary: r.summary, human };
        this.turnovers.push(t);
        this.o.onTurnover?.(t, this.world, this.state);
        continue;
      }
      const d0 = now();
      this.state = assistantDay(this.state, this.sq);
      const r = advanceDay(this.state, this.sq, {}, { inPlace: true });
      const humanBefore = this.state.humanClubIds[0] ?? '';
      const ev = coachDay(this.world, this.state, r.played, { data: this.o.data, pools: this.o.pools, squads: lazyCareerSquads(this.state, this.sq) });
      this.simMs += now() - d0;
      this.days++;
      n++;
      this.games += r.played.length;
      this.o.onDay?.(this.state, r.played);
      if (ev.fired) {
        if (this.stops.fired) { this.reason = 'fired'; this.note = 'Você foi demitido!'; break; }
        continue;
      }
      if (ev.offers > 0 && this.stops.jobOffer) {
        this.reason = 'job';
        this.note = 'Nova proposta de emprego na caixa de entrada.';
        break;
      }
      // propostas por jogadores do humano (as que não param ficam sem resposta e expiram)
      const offers = this.state.market?.offers ?? [];
      for (const x of offers) {
        if (this.seenOffers.has(x.id)) continue;
        this.seenOffers.add(x.id);
        // (online) qualquer humano da carreira (no solo só há um)
        if (!this.stops.playerOffer || x.status !== 'pending' || (x.fromClubId !== humanBefore && !this.state.humanClubIds.includes(x.fromClubId)) || x.kind !== 'transfer') continue;
        const value = x.player.value || 0;
        if (value > 0 && x.fee >= (value * this.stops.playerOfferPct) / 100) {
          this.reason = 'offer';
          this.stopClubId = x.fromClubId;
          this.note = `Proposta do ${x.toName} por ${x.player.name}: ${Math.round((x.fee / value) * 100)}% do valor de mercado.`;
        }
      }
      if (this.reason) break;
    }
    return this.done;
  }
}

/** Salto completo de uma vez (testes/scripts). */
export function timeSkip(o: SkipOptions): TimeSkip {
  const s = new TimeSkip(o);
  s.step();
  return s;
}

/** Atalhos do calendário: próxima data de jogo do humano, fim da janela, fim de temporada, +1 ano. */
export function skipShortcuts(state: SeasonState, humanId: string): { nextMatch: string | null; plusYear: string } {
  let next: string | null = null;
  for (const c of state.competitions) {
    for (const f of c.fixtures) {
      if (f.result || f.date <= state.date || (f.homeId !== humanId && f.awayId !== humanId)) continue;
      if (!next || f.date < next) next = f.date;
    }
  }
  return { nextMatch: next, plusYear: addDays(state.date, 365) };
}
