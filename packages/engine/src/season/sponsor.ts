/**
 * (28/11) Patrocínio MASTER dos clubes humanos (a marca principal da camisa).
 *
 * Economia: o patrocínio calibrado de cada clube (`sponsorPerSeason`) continua inteiro; 40% dele é a "cota master".
 * Sem contrato master, o clube recebe só os 60% dos demais patrocinadores. Com contrato, recebe os 60% + o valor
 * mensal do contrato (75%–130% da cota, conforme a proposta) e, no fim da temporada do clube, os bônus das METAS
 * cumpridas (posição na liga nacional, conquistar um título).
 *
 * Todo clube humano começa com o patrocinador que já tinha (contrato padrão, valor exato da cota, sem metas) até o fim
 * da temporada dele — ninguém perde receita até decidir. De tempos em tempos chegam propostas de marcas (fictícias, por
 * setor: automóveis, bancos, aéreas, apostas, telefonia, energia, bebidas, tecnologia, saúde, varejo); propostas mais
 * altas cobram metas mais difíceis. Assinar uma proposta substitui o contrato atual na hora.
 *
 * Estado em `state.market.sponsor` (vai no patch online do mercado e atravessa a virada). Determinístico.
 */
import type { Player } from '@cosmicfut/shared';
import type { ClubEconomyInfo, Competition, SeasonState, SponsorDeal, SponsorGoal, SponsorState } from '../contract';
import type { MarketResult } from '../transfers/actions';
import { squadStrength } from '../transfers/market';
import { Rng } from '../rng';
import { addDays } from './schedule';
import { computeStandings } from './standings';
import { cycleOfCompetition, cycleOfRegion, regionOfClub } from './timeline';

export const SPONSOR = {
  /** fatia do patrocínio calibrado que é a cota master */
  slotShare: 0.4,
  /** intervalo entre propostas (dias) */
  offerEvery: [20, 40] as const,
  /** sem contrato: propostas mais frequentes */
  offerEveryNoDeal: [6, 12] as const,
  maxOffers: 3,
  /** validade de uma proposta (dias) */
  offerDays: 45,
  /** valor anual da proposta: × cota master */
  factor: [0.75, 1.3] as const,
};

export const SPONSOR_BRANDS: { sector: string; brands: string[] }[] = [
  { sector: 'Automóveis', brands: ['Vértice Motors', 'Aurora Automóveis', 'Titan Veículos', 'Fênix Auto'] },
  { sector: 'Banco', brands: ['Banco Atlântico', 'Banco Meridional', 'Capital Prime', 'Banco Horizonte'] },
  { sector: 'Companhia aérea', brands: ['AeroSul', 'Alvorada Airlines', 'SkyAtlântica', 'Condor Linhas Aéreas'] },
  { sector: 'Apostas', brands: ['BetEstrela', 'PalpiteMax', 'Gol de Ouro Bet'] },
  { sector: 'Telefonia', brands: ['Conecta Telecom', 'NovaNet', 'Sinal Mais'] },
  { sector: 'Energia', brands: ['Solaris Energia', 'Petrolux', 'Volt Energia'] },
  { sector: 'Bebidas', brands: ['Cervejaria Âncora', 'Guaraná Tropical', 'Água Serra Azul'] },
  { sector: 'Tecnologia', brands: ['Nexus Tech', 'Órbita Digital', 'Pixel Systems'] },
  { sector: 'Saúde', brands: ['Vitalis Saúde', 'Clínicas Bem-Estar'] },
  { sector: 'Varejo', brands: ['Lojas Estrela', 'Mega Varejo', 'Supermercados Ponte'] },
];

const round1k = (v: number) => Math.round(v / 1000) * 1000;

/** Cota master por mês (40% do patrocínio calibrado). 0 sem economia. */
export function sponsorSlotMonthly(info: Pick<ClubEconomyInfo, 'sponsorPerSeason'> | undefined): number {
  return Math.round(((info?.sponsorPerSeason ?? 0) * SPONSOR.slotShare) / 12);
}

/** Ajuste mensal do patrocínio do clube: valor do master em vigor − cota (negativo sem contrato). */
export function sponsorMonthlyDelta(state: SeasonState, clubId: string): number {
  const st = state.market?.sponsor?.[clubId];
  if (!st) return 0;
  const slot = sponsorSlotMonthly(state.clubInfo?.[clubId]);
  const d = st.deal;
  const master = d && (!d.end || state.date <= d.end) ? d.monthly : 0;
  return master - slot;
}

/** Fim da temporada do clube (último dia do trecho que fecha o ciclo dele), ou null. */
function seasonCloses(state: SeasonState, clubId: string): boolean {
  const seg = state.segment;
  if (!seg) return state.date.endsWith('-12-31');
  return state.date === seg.end && seg.closes === cycleOfRegion(regionOfClub(state, clubId));
}

function nationalLeague(state: SeasonState, clubId: string): Competition | undefined {
  const cyc = cycleOfRegion(regionOfClub(state, clubId));
  return state.competitions.find((c) => c.type === 'league' && c.countryId !== undefined && c.clubIds.includes(clubId) && (!state.segment || cycleOfCompetition(c) === cyc));
}

/** Posição esperada do clube na liga (ranking de força do elenco). */
function expectedPosition(state: SeasonState, clubId: string, squads: (id: string) => readonly Player[]): { pos: number; teams: number } {
  const lg = nationalLeague(state, clubId);
  if (!lg) return { pos: 1, teams: 1 };
  const str = lg.clubIds.map((id) => ({ id, s: squadStrength(squads(id) as Player[]) })).sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
  return { pos: Math.max(1, str.findIndex((x) => x.id === clubId) + 1), teams: lg.clubIds.length };
}

function newOffer(state: SeasonState, clubId: string, st: SponsorState, squads: (id: string) => readonly Player[], rng: Rng): SponsorDeal {
  const slotYear = sponsorSlotMonthly(state.clubInfo?.[clubId]) * 12;
  const u = rng.next();
  const f = SPONSOR.factor[0] + (SPONSOR.factor[1] - SPONSOR.factor[0]) * u;
  const annual = slotYear * f;
  const { pos, teams } = expectedPosition(state, clubId, squads);
  // proposta alta ⇒ meta mais difícil (posição acima da esperada); baixa ⇒ meta folgada
  const target = Math.min(teams, Math.max(1, pos + Math.round(2 - 3 * u)));
  const goals: SponsorGoal[] = [{ kind: 'position', position: target, bonus: round1k(annual * (0.1 + 0.2 * u)) }];
  if (pos <= 4 || rng.chance(0.25)) goals.push({ kind: 'title', bonus: round1k(annual * (0.15 + 0.15 * u)) });
  const sec = SPONSOR_BRANDS[rng.int(0, SPONSOR_BRANDS.length - 1)];
  const brand = sec.brands[rng.int(0, sec.brands.length - 1)];
  return {
    id: `sp${++st.seq}`, brand, sector: sec.sector, monthly: round1k(annual / 12), years: rng.int(1, 3), goals,
    expiresOn: addDays(state.date, SPONSOR.offerDays),
  };
}

/** Estado inicial: o patrocinador que o clube já tinha até o fim da temporada dele (valor da cota, sem metas). */
export function initialSponsor(state: SeasonState, clubId: string): SponsorState {
  // fim da temporada do clube: 31/12 (ano civil) ou 30/06 (Europa/Arábia)
  const y = Number(state.date.slice(0, 4));
  const own = cycleOfRegion(regionOfClub(state, clubId)) === 'calendar' ? `${y}-12-31` : state.date.slice(5) < '07-01' ? `${y}-06-30` : `${y + 1}-06-30`;
  return {
    deal: { id: 'sp0', brand: 'Patrocinador atual', sector: 'Contrato vigente', monthly: sponsorSlotMonthly(state.clubInfo?.[clubId]), years: 1, goals: [], start: state.date, end: own, default: true },
    offers: [], nextOfferOn: addDays(state.date, 7), seq: 0,
  };
}

/**
 * Dia do patrocínio (chamado por `advanceDay`, com o mercado já copiado): propostas novas/vencidas, fim de contrato e
 * avaliação das metas no último dia da temporada do clube. Muta `state` (mercado e clubes do dia). Devolve notícias.
 */
export function sponsorDay(state: SeasonState, squads: (clubId: string) => readonly Player[]): { text: string; clubId: string }[] {
  const m = state.market;
  if (!m || !state.career) return [];
  const out: { text: string; clubId: string }[] = [];
  const fmt = (v: number) => (v >= 1e6 ? `€ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : `€ ${Math.round(v / 1000)} mil`);
  for (const clubId of state.humanClubIds) {
    const info = state.clubInfo?.[clubId];
    if (!info?.sponsorPerSeason) continue;
    const all = (m.sponsor ??= {});
    const st = (all[clubId] ??= initialSponsor(state, clubId));
    const rng = new Rng(`${state.seed ?? 's'}:sponsor:${clubId}:${state.date}`);
    // propostas vencidas
    st.offers = st.offers.filter((o) => !o.expiresOn || o.expiresOn >= state.date);
    // fim do contrato
    if (st.deal?.end && state.date > st.deal.end) {
      out.push({ clubId, text: `Patrocínio master: terminou o contrato com ${st.deal.brand}. Sem patrocinador master o clube recebe só os demais patrocínios — veja as propostas em Finanças.` });
      st.deal = null;
      if (st.nextOfferOn > addDays(state.date, 3)) st.nextOfferOn = addDays(state.date, 3);
    }
    // propostas novas
    if (state.date >= st.nextOfferOn) {
      if (st.offers.length < SPONSOR.maxOffers) {
        const o = newOffer(state, clubId, st, squads, rng);
        st.offers.push(o);
        out.push({ clubId, text: `Patrocínio master: ${o.brand} (${o.sector.toLowerCase()}) oferece ${fmt(o.monthly)}/mês por ${o.years} ${o.years > 1 ? 'anos' : 'ano'}. Veja em Finanças › Patrocínio.` });
      }
      const [a, b] = st.deal ? SPONSOR.offerEvery : SPONSOR.offerEveryNoDeal;
      st.nextOfferOn = addDays(state.date, rng.int(a, b));
    }
    // metas: no último dia da temporada do clube
    if (st.deal && !st.deal.default && st.deal.goals.length && seasonCloses(state, clubId)) {
      const label = state.date.slice(0, 4);
      if (!(st.evaluated ?? []).includes(label)) {
        st.evaluated = [...(st.evaluated ?? []), label].slice(-6);
        const lg = nationalLeague(state, clubId);
        const pos = lg ? computeStandings(lg).findIndex((r) => r.clubId === clubId) + 1 : 0;
        const cyc = cycleOfRegion(regionOfClub(state, clubId));
        const titles = state.competitions.filter((c) => c.championId === clubId && c.type !== 'state' && (!state.segment || cycleOfCompetition(c) === cyc)).length;
        let paid = 0;
        for (const g of st.deal.goals) {
          const ok = g.kind === 'position' ? pos > 0 && pos <= (g.position ?? 0) : titles > 0;
          g.done = { ...(g.done ?? {}), [label]: ok };
          if (ok) paid += g.bonus;
        }
        const club = state.clubs[clubId];
        if (paid > 0 && club) {
          club.balance += paid;
          const fin = (club.finance ??= { tickets: 0, tv: 0, sponsor: 0, prizes: 0, wages: 0 });
          fin.sponsor += paid;
        }
        const hit = st.deal.goals.filter((g) => g.done?.[label]).length;
        out.push({ clubId, text: `Patrocínio master (${st.deal.brand}): ${hit} de ${st.deal.goals.length} metas cumpridas${paid ? ` — bônus de ${fmt(paid)}` : ''}.` });
      }
    }
  }
  return out;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Assina uma proposta: vira o contrato master (substitui o atual na hora). */
export function signSponsor(input: SeasonState, clubId: string, offerId: string): MarketResult {
  const st0 = input.market?.sponsor?.[clubId];
  const o = st0?.offers.find((x) => x.id === offerId);
  if (!st0 || !o) return { state: input, error: 'Proposta de patrocínio não encontrada.' };
  if (o.expiresOn && o.expiresOn < input.date) return { state: input, error: 'A proposta expirou.' };
  const state = clone(input);
  const st = state.market!.sponsor![clubId];
  const { expiresOn: _e, ...deal } = st.offers.find((x) => x.id === offerId)!;
  void _e;
  st.deal = { ...deal, start: state.date, end: addDays(state.date, 365 * deal.years) };
  st.offers = st.offers.filter((x) => x.id !== offerId);
  state.news = [...state.news, { date: state.date, text: `Patrocínio master assinado: ${deal.brand} por ${deal.years} ${deal.years > 1 ? 'anos' : 'ano'}.`, clubId }];
  return { state };
}

/** Recusa (descarta) uma proposta. */
export function declineSponsor(input: SeasonState, clubId: string, offerId: string): MarketResult {
  if (!input.market?.sponsor?.[clubId]?.offers.some((x) => x.id === offerId)) return { state: input, error: 'Proposta de patrocínio não encontrada.' };
  const state = clone(input);
  const st = state.market!.sponsor![clubId];
  st.offers = st.offers.filter((x) => x.id !== offerId);
  return { state };
}
