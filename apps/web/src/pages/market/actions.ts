/**
 * Adaptador das AÇÕES do mercado (mesmo padrão do MatchView em pages/match/view.tsx):
 *  - SOLO: chama a engine local (makeOffer, proposeContract, respondToOffer…) via `useSoloSeason.market`
 *    (o worker da carreira recebe a cópia e grava);
 *  - ONLINE: manda 'market:*' pelo socket — o servidor é autoritativo, valida janela/saldo/dono e responde com a
 *    decisão da IA; a Promise só volta depois que o 'market:update' da ação foi aplicado na SeasonState local.
 * As telas (MarketPage, NegotiationModal, abas, botão "Colocar à venda") só conhecem esta interface.
 *
 * (Etapa 5) Novas ações: contraproposta a ofertas recebidas, lista de empréstimo, opção de compra, retorno antecipado
 * de emprestado e renovação durante a temporada; propostas com termos de empréstimo, multa rescisória e pré-contrato.
 */
import { useMemo } from 'react';
import type { Player } from '@cosmicfut/shared';
import {
  counterIncoming, exercisePurchaseOption, makeOffer, promoteProspect, proposeContract, releaseProspect, setTraining, rebalanceBudgets, recallLoan, releasePlayer, renewContract, respondToOffer,
  setLoanListed, setTransferListed, withdrawOffer, setTicketPrice, takeLoan, repayLoan, expandStadium, payOffLuva, signSponsor, declineSponsor,
  type ExternalClubInfo, type LoanTerms, type MarketResult, type PreContract, type SeasonState, type TransferOffer, type TransferRecord,
} from '@cosmicfut/engine';
import { squads } from '@/data/squads';
import { useIsOnline } from '@/store/mode';
import { useOnline, type MarketCallType } from '@/store/online';
import { useSoloSeason } from '@/store/season';

export type FinanceReq =
  | { op: 'ticket'; price: number | null }
  | { op: 'loan' | 'repay'; blocks: number }
  | { op: 'stadium'; seats: number }
  | { op: 'luva'; playerId: string }
  | { op: 'sponsor'; offerId: string; accept: boolean };

function applyFinance(s: SeasonState, clubId: string, r: FinanceReq): MarketResult {
  return r.op === 'ticket' ? setTicketPrice(s, clubId, r.price)
    : r.op === 'loan' ? takeLoan(s, clubId, r.blocks)
    : r.op === 'repay' ? repayLoan(s, clubId, r.blocks)
    : r.op === 'stadium' ? expandStadium(s, clubId, r.seats)
    : r.op === 'luva' ? payOffLuva(s, clubId, r.playerId)
    : r.op === 'sponsor' ? (r.accept ? signSponsor(s, clubId, r.offerId) : declineSponsor(s, clubId, r.offerId))
    : { state: s, error: 'Operação inválida.' };
}

export interface MarketOutcome {
  error?: string;
  offer?: TransferOffer;
  record?: TransferRecord;
  /** (Etapa 5) pré-contrato assinado */
  preContract?: PreContract;
  /** (online) proposta enviada a outro humano: aguarda a resposta dele até o fim do planejamento */
  pendingHuman?: boolean;
}

export type OfferKind = 'transfer' | 'loan' | 'precontract';

export interface MarketActions {
  online: boolean;
  /** motivo para as ações estarem bloqueadas agora (online fora do planejamento); null = liberado */
  blocked: string | null;
  offer(req: { player: Player; fee: number; kind: OfferKind; offerId?: string; sellerInfo?: ExternalClubInfo; loan?: LoanTerms; clause?: boolean }): Promise<MarketOutcome>;
  /** etapa 2. Sem `offerId`: jogador LIVRE (abre a negociação e propõe na mesma ação) */
  contract(req: { offerId?: string; player?: Player; wage: number; years: number; luva?: number; releaseClause?: number; sellerInfo?: ExternalClubInfo }): Promise<MarketOutcome>;
  respond(offerId: string, accept: boolean): Promise<MarketOutcome>;
  /** (Etapa 5) contraproposta a uma oferta recebida da IA */
  counter(offerId: string, fee: number): Promise<MarketOutcome>;
  withdraw(offerId: string): Promise<MarketOutcome>;
  setListed(playerIds: string[], listed: boolean): Promise<MarketOutcome>;
  /** (Etapa 5) lista de empréstimo */
  /** (18/11) `months`: duração pedida do empréstimo (6–24); o clube que recebe paga o salário inteiro */
  setLoanListed(playerIds: string[], listed: boolean, months?: number): Promise<MarketOutcome>;
  release(playerId: string): Promise<MarketOutcome>;
  /** (Etapa 5) exerce a opção de compra de um emprestado ao clube */
  option(playerId: string): Promise<MarketOutcome>;
  /** (Etapa 5) chama de volta um emprestado (retorno antecipado previsto no contrato) */
  recall(playerId: string): Promise<MarketOutcome>;
  /** (Etapa 5) renova o contrato de um jogador do elenco */
  renew(playerId: string, wage: number, years: number, releaseClause?: number): Promise<MarketOutcome>;
  /** (Mercado e Orçamentos) equilíbrio: move `toWage` € do orçamento de transferências para o salarial (negativo = o contrário) */
  budget(toWage: number): Promise<MarketOutcome>;
  /** (Base) promove ao elenco principal um revelado da base */
  promote(playerId: string): Promise<MarketOutcome>;
  /** (Base) dispensa um revelado da base */
  dismiss(playerId: string): Promise<MarketOutcome>;
  /** (Treino) define os jogadores do Centro de Treinamento (até 3) */
  train(playerIds: string[]): Promise<MarketOutcome>;
  /** (28/11) gestão do clube (ingresso, empréstimo, estádio, luva) — solo e online */
  finance(req: FinanceReq): Promise<MarketOutcome>;
}

/* ───────── solo ───────── */

function soloApply(fn: (s: SeasonState) => MarketResult | SeasonState): MarketOutcome {
  const r = useSoloSeason.getState().market(fn);
  if (!r) return { error: 'A temporada está ocupada (avançando ou na virada).' };
  return { error: r.error, offer: r.offer, record: r.record, preContract: r.preContract };
}

const soloHuman = () => useSoloSeason.getState().save?.season.humanClubIds[0] ?? useSoloSeason.getState().save?.clubId ?? '';

const SOLO: MarketActions = {
  online: false,
  blocked: null,
  offer: async ({ player, fee, kind, offerId, sellerInfo, loan, clause }) =>
    soloApply((s) => makeOffer(s, squads, { buyerId: soloHuman(), player, fee, kind, offerId, sellerInfo, loan, clause })),
  contract: async ({ offerId, player, wage, years, luva, releaseClause, sellerInfo }) => {
    let id = offerId;
    if (!id) {
      if (!player) return { error: 'Jogador não informado.' };
      // jogador livre: abre a negociação direto no contrato
      const r0 = soloApply((s) => makeOffer(s, squads, { buyerId: soloHuman(), player, fee: 0 }));
      if (r0.error || !r0.offer) return { error: r0.error ?? 'Falha ao abrir negociação' };
      id = r0.offer.id;
    }
    const key = id;
    const r = soloApply((s) => proposeContract(s, squads, { offerId: key, wage, years, sellerInfo, ...(luva !== undefined ? { luva } : {}), ...(releaseClause ? { releaseClause } : {}) }));
    return { ...r, offer: r.offer ?? useSoloSeason.getState().save?.season.market?.offers.find((o) => o.id === key) };
  },
  respond: async (offerId, accept) => soloApply((s) => respondToOffer(s, squads, offerId, accept)),
  counter: async (offerId, fee) => soloApply((s) => counterIncoming(s, squads, offerId, fee)),
  withdraw: async (offerId) => soloApply((s) => withdrawOffer(s, offerId)),
  setListed: async (ids, listed) => soloApply((s) => ids.reduce((st, id) => setTransferListed(st, id, listed), s)),
  setLoanListed: async (ids, listed, months) => soloApply((s) => ids.reduce((st, id) => setLoanListed(st, id, listed, months), s)),
  release: async (playerId) => soloApply((s) => releasePlayer(s, squads, soloHuman(), playerId)),
  option: async (playerId) => soloApply((s) => exercisePurchaseOption(s, squads, soloHuman(), playerId)),
  recall: async (playerId) => soloApply((s) => recallLoan(s, squads, soloHuman(), playerId)),
  renew: async (playerId, wage, years, releaseClause) => soloApply((s) => renewContract(s, squads, soloHuman(), playerId, wage, years, releaseClause)),
  budget: async (toWage) => soloApply((s) => rebalanceBudgets(s, squads, soloHuman(), toWage)),
  promote: async (playerId) => soloApply((s) => promoteProspect(s, squads, soloHuman(), playerId)),
  dismiss: async (playerId) => soloApply((s) => releaseProspect(s, soloHuman(), playerId)),
  train: async (playerIds) => soloApply((s) => setTraining(s, squads, soloHuman(), playerIds)),
  finance: async (r) => soloApply((s) => applyFinance(s, soloHuman(), r)),
};

/* ───────── online ───────── */

async function net(type: MarketCallType, payload: Record<string, unknown>): Promise<MarketOutcome> {
  const r = await useOnline.getState().marketCall(type, payload);
  if (!r.ok) return { error: r.error };
  return { offer: r.data.offer as TransferOffer | undefined, record: r.data.record as TransferRecord | undefined, pendingHuman: r.data.pendingHuman };
}

function onlineActions(blocked: string | null): MarketActions {
  const guard = <A extends unknown[]>(fn: (...a: A) => Promise<MarketOutcome>) => (...a: A): Promise<MarketOutcome> =>
    blocked ? Promise.resolve({ error: blocked }) : fn(...a);
  return {
    online: true,
    blocked,
    offer: guard(({ player, fee, kind, offerId, loan, clause }) => net('offer', { playerId: player.id, fee, kind, ...(offerId ? { offerId } : {}), ...(loan ? { loan } : {}), ...(clause ? { clause: true } : {}) })),
    contract: guard(({ offerId, player, wage, years, luva, releaseClause }) =>
      net('contract', { ...(offerId ? { offerId } : { playerId: player?.id }), wage, years, ...(luva !== undefined ? { luva } : {}), ...(releaseClause ? { releaseClause } : {}) }),
    ),
    respond: guard((offerId, accept) => net('respond', { offerId, accept })),
    counter: guard((offerId, fee) => net('counter', { offerId, fee })),
    withdraw: guard((offerId) => net('withdraw', { offerId })),
    setListed: guard((playerIds, listed) => net('list', { playerIds, listed })),
    setLoanListed: guard((playerIds, listed, months) => net('loanlist', { playerIds, listed, ...(months ? { months } : {}) })),
    release: guard((playerId) => net('release', { playerId })),
    option: guard((playerId) => net('option', { playerId })),
    recall: guard((playerId) => net('recall', { playerId })),
    renew: guard((playerId, wage, years, releaseClause) => net('renew', { playerId, wage, years, ...(releaseClause ? { releaseClause } : {}) })),
    budget: guard((toWage) => net('budget', { toWage })),
    promote: guard((playerId) => net('promote', { playerId })),
    dismiss: guard((playerId) => net('dismiss', { playerId })),
    train: guard((playerIds) => net('train', { playerIds })),
    finance: guard((r) => net('finance', { ...r })),
  };
}

/** Ações do mercado do modo ativo. */
export function useMarketActions(): MarketActions {
  const online = useIsOnline();
  const phase = useOnline((s) => s.room?.phase);
  const blocked = !online ? null : phase === 'planning' ? null : 'O mercado abre no planejamento, entre as rodadas.';
  return useMemo(() => (online ? onlineActions(blocked) : SOLO), [online, blocked]);
}
