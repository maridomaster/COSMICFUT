/**
 * (Fase 2) Leituras de economia para a UI (puras): estimativa de público por jogo em casa, com o mesmo modelo da
 * simulação (`MatchSimulation`: capacidade × ocupação por reputação e moral) e a resposta ao preço do ingresso
 * (`ticketDemandFactor`, a mesma função que a engine usa na bilheteria).
 */
import {
  gateRevenue, hasEcon, matchImportance, resultAttendance, suggestedTicketPrice, ticketDemandFactor, ticketPriceOf, type Fixture, type MatchResult, type SeasonState,
} from '@cosmicfut/engine';
import { clubFixtures } from './view';
import { currencySymbol, toDisplay } from '@/lib/format';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Público ao preço sugerido (ocupação média da simulação, sem o sorteio de ±6%). */
export function baseAttendance(state: SeasonState, homeId: string, awayId?: string): number {
  const info = state.clubInfo?.[homeId];
  const cap = info?.capacity ?? 30000;
  const repH = info?.reputation ?? 2.5;
  const repA = awayId ? (state.clubInfo?.[awayId]?.reputation ?? 2.5) : 2.5;
  const morale = state.clubs[homeId]?.morale ?? 50;
  return Math.round(cap * clamp(0.42 + 0.08 * repH + 0.03 * repA + (morale - 50) * 0.003, 0.12, 1));
}

export interface GateEstimate {
  price: number;
  attendance: number;
  revenue: number;
  /** multiplicador de público pelo preço (1 = sugerido) */
  factor: number;
  capacity: number;
}

/**
 * Público e renda estimados de um jogo em casa com o preço informado (padrão: o preço atual do clube).
 * (Etapa 4) Com o perfil econômico, usa o mesmo modelo da bilheteria da engine (`gateRevenue`: ocupação-base, preço,
 * importância do jogo e Moral da Torcida), sem o ruído do jogo.
 */
export function gateEstimate(state: SeasonState, homeId: string, awayId?: string, price?: number, fixture?: Fixture | null): GateEstimate {
  const info = state.clubInfo?.[homeId];
  if (hasEcon(info)) {
    const p = price ?? ticketPriceOf(state, homeId);
    const comp = fixture ? state.competitions.find((c) => c.id === fixture.competitionId) : undefined;
    const imp = fixture ? matchImportance(state, comp, fixture).value : 1;
    const club = state.clubs[homeId];
    const g = gateRevenue({
      capacity: info.capacity ?? 10_000, fill0: info.fill0, basePrice: info.basePrice, price: p, importance: imp,
      fanMorale: club?.fanMorale ?? 60, form: club?.morale ?? 50, awayReputation: awayId ? state.clubInfo?.[awayId]?.reputation ?? 2.5 : 2.5,
    });
    return { price: p, attendance: g.attendance, revenue: g.revenue, factor: g.demand, capacity: info.capacity ?? 0 };
  }
  const sug = suggestedTicketPrice(state, homeId);
  const p = price ?? ticketPriceOf(state, homeId);
  const cap = state.clubInfo?.[homeId]?.capacity ?? Infinity;
  const factor = ticketDemandFactor(p, sug);
  const attendance = Math.round(Math.min(cap, baseAttendance(state, homeId, awayId) * factor));
  return { price: p, attendance, revenue: Math.round(attendance * p), factor, capacity: Number.isFinite(cap) ? cap : 0 };
}

/**
 * Público de um jogo já disputado como a bilheteria o contou: a simulação devolve o público ao preço sugerido
 * (`MatchResult.attendance`), e a engine aplica o preço do mandante na renda (`ticketSales`). A UI mostra o
 * mesmo número que gerou a renda.
 */
export function paidAttendance(state: SeasonState, homeId: string, result: Pick<MatchResult, 'attendance' | 'ticketDemand'>): number {
  // a engine já devolve o público pagante quando `ticketDemand` está presente (não reaplica o fator)
  return resultAttendance(state, homeId, result);
}

/** Próximo jogo em casa (não neutro) do clube a partir de hoje. */
export function nextHomeFixture(state: SeasonState, clubId: string): Fixture | null {
  return clubFixtures(state, clubId).find((f) => !f.result && f.date >= state.date && f.homeId === clubId && !f.neutral) ?? null;
}

export const fmtPrice = (v: number) => `${currencySymbol()} ${toDisplay(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
