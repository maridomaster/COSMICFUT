/**
 * (Mercado e Orçamentos) "Clube irritado com propostas insistentes".
 *
 * Cada proposta RECUSADA pelo clube vendedor (decisão 'reject' — contraproposta não conta) soma 1 em
 * `market.rejections[`${jogador}|${comprador}`].rejectedOffersCount`, na janela do COMPRADOR (chave = data em que ela
 * fecha; outra janela zera a contagem). Na 3ª recusa, o vendedor bloqueia novas negociações (compra e empréstimo)
 * daquele comprador por aquele jogador durante 14 dias de jogo: "Disponível novamente em DD/MM". Livres e
 * pré-contratos (conversa direta com o jogador) não são bloqueados. Vale para o humano comprando da IA e, no online,
 * de outro humano (a recusa do dono conta igual).
 */
import type { OfferRejections, SeasonState, TransferOffer } from '../contract';
import { addDaysIso, isHumanClub, marketWindow } from './market';

export const COOLDOWN = {
  /** recusas na mesma janela que irritam o vendedor */
  rejections: 3,
  /** dias de jogo (calendário) sem negociar */
  days: 14,
};

const keyOf = (playerId: string, buyerId: string) => `${playerId}|${buyerId}`;

/** Chave da janela do comprador (data em que fecha; fora da janela, o mês). */
export function windowKey(state: SeasonState, buyerId: string): string {
  const w = marketWindow(state, buyerId);
  return w.open && w.closesOn ? w.closesOn : state.date.slice(0, 7);
}

/** "31/08" */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Bloqueio ativo do vendedor para este comprador e jogador (null = pode negociar). */
export function negotiationBlock(state: SeasonState, playerId: string, buyerId: string): { until: string; sellerId: string } | null {
  const r = state.market?.rejections?.[keyOf(playerId, buyerId)];
  if (!r?.blockedUntil || state.date >= r.blockedUntil) return null;
  return { until: r.blockedUntil, sellerId: r.sellerId };
}

/** Recusas na janela atual (0..2) — para a UI avisar ("2ª recusa: mais uma e o clube se irrita"). */
export function rejectionCount(state: SeasonState, playerId: string, buyerId: string): number {
  const r = state.market?.rejections?.[keyOf(playerId, buyerId)];
  if (!r || r.window !== windowKey(state, buyerId)) return 0;
  return r.rejectedOffersCount;
}

export function blockMessage(until: string): string {
  return `Clube irritado com propostas insistentes. Disponível novamente em ${ddmm(until)}.`;
}

/**
 * Registra a recusa de uma proposta (MUTA `state`). Só compradores humanos. Na 3ª recusa da janela, bloqueia por 14
 * dias, encerra a negociação (status 'rejected') e avisa nas notícias. Devolve o bloqueio criado (ou null).
 */
export function noteRejection(state: SeasonState, offer: Pick<TransferOffer, 'playerId' | 'toClubId' | 'fromClubId' | 'fromName' | 'player'> & Partial<TransferOffer>): { until: string } | null {
  const m = state.market;
  if (!m || !offer.fromClubId || !isHumanClub(state, offer.toClubId)) return null;
  const rej = (m.rejections ??= {});
  pruneRejections(state);
  const key = keyOf(offer.playerId, offer.toClubId);
  const win = windowKey(state, offer.toClubId);
  const cur: OfferRejections = rej[key] && rej[key].window === win ? rej[key] : { rejectedOffersCount: 0, window: win, sellerId: offer.fromClubId };
  cur.sellerId = offer.fromClubId;
  cur.rejectedOffersCount += 1;
  rej[key] = cur;
  if (cur.rejectedOffersCount < COOLDOWN.rejections) return null;
  const until = addDaysIso(state.date, COOLDOWN.days);
  cur.rejectedOffersCount = 0;
  cur.blockedUntil = until;
  const live = m.offers.find((o) => o.id === offer.id);
  if (live && (live.status === 'negotiating' || live.status === 'pending')) {
    live.status = 'rejected';
    live.updatedOn = state.date;
  }
  if (live) live.log.push({ by: 'seller', decision: 'reject', date: state.date, text: blockMessage(until) });
  state.news.push({
    date: state.date,
    text: `O ${offer.fromName} ficou irritado com as propostas insistentes por ${offer.player.name} e não negocia com o ${state.clubInfo?.[offer.toClubId]?.name ?? 'seu clube'} até ${ddmm(until)}.`,
    clubId: offer.toClubId,
  });
  return { until };
}

/** Limpa registros vencidos (janela passada e sem bloqueio ativo). MUTA. */
export function pruneRejections(state: SeasonState): void {
  const rej = state.market?.rejections;
  if (!rej) return;
  for (const [k, r] of Object.entries(rej)) {
    const blocked = r.blockedUntil && state.date < r.blockedUntil;
    if (blocked) continue;
    const buyer = k.slice(k.lastIndexOf('|') + 1);
    if (r.window !== windowKey(state, buyer)) delete rej[k];
    else if (r.blockedUntil && !r.rejectedOffersCount) delete rej[k];
  }
}
