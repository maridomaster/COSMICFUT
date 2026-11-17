/**
 * Fase 3 — Carreira do técnico (spec §6 e §7.3): estabilidade, confiança da diretoria e da torcida, metas da
 * temporada, demissão, técnicos da CPU, Central de Empregos (clubes e seleções), candidaturas, convites,
 * declaração pública de interesse, pedido de demissão (multa de 6 meses ou acordo mútuo) e caixa de entrada.
 *
 * Fonte das regras (strings do executável do original, spec §6):
 *  - estabilidade 0–100%: > 79% "O técnico está com muita estabilidade (Acima de 79%)" (ninguém consegue pressionar);
 *    < 43% "O técnico já está prestes a cair (Abaixo de 43%)";
 *  - demissão: "O clube decidiu encerrar o seu contrato e pagará a multa rescisória" / "A diretoria cedeu à pressão
 *    popular..." — demitido, o CLUBE paga a multa ao técnico;
 *  - pedir demissão: "Multa de rescisão (6 meses)"; acordo mútuo sem multa ("Estabilidade em X%") — permitido com
 *    estabilidade ≤ 43% (proposta da spec §6.1);
 *  - candidatura por e-mail: resposta em 7 dias; aprovação "Parabéns! Você foi o escolhido..." / recusa "Sentimos muito!...";
 *  - declarar interesse: a estabilidade do técnico atual "caiu drasticamente"; bloqueio de 6 meses; técnico de
 *    status muito maior ⇒ "Vamos permanecer com o atual treinador."; pressão que funciona ⇒ "A diretoria demitiu o
 *    técnico sob pressão ... Deseja assumir o ...";
 *  - "Você deixou este time há menos de 30 dias."; assumir outro clube empregado ⇒ "Deseja pagar a multa e assumir o novo time?";
 *  - Central de Empregos com seleções ("Assumir Seleção"); convites ("Convites para ser técnico"), oferta de 1 ano.
 * Números de baixa confiança (spec §6.3/§6.4, "para calibrar") estão em `COACH` e documentados abaixo.
 *
 * Integração: o dono do estado (worker da carreira solo) chama `coachDay(world, state, played, ctx)` depois de cada
 * `advanceDay`; a virada chama `coachSeasonEnd` (dentro de `rolloverSeason`, só se `world.coach` existir). As ações do
 * jogador (`applyForJob`, `declareInterest`, `acceptJobOffer`, `resignJob`...) MUTAM `world` e `state` (como o
 * `advanceDay` com `inPlace`) e devolvem `{ ok, message, error, clubChanged }`. Determinístico (seed do mundo + data).
 */
import type { NamePool, Player } from '@cosmicfut/shared';
import type {
  AiCoach, CareerData, ClubBoardState, Coach, CoachCareer, CoachExit, CoachHistoryItem, Competition, ExpectationKind,
  Fixture, InboxKind, InboxMessage, JobOffer, JobVacancy, MatchResult, SeasonExpectation, SeasonState, SeasonSummary, WorldState,
} from '../contract';
import { Rng } from '../rng';
import { finalRanking } from './format';
import { randomName } from './players';
import { addDays } from './schedule';
import { computeStandings } from './standings';
import { clubSeason } from './timeline';
import { coachMonthlyFor } from './econ';
import { fmtMoneyShort } from '../money';

/** Parâmetros da carreira do técnico. Limiares 79/43, 7 dias, 6 meses, 30 dias e multa de 6 salários: original. */
export const COACH = {
  /** > 79%: blindado — declarar interesse não funciona (original) */
  shielded: 79,
  /** < 43%: "prestes a cair" (original); também o teto do acordo mútuo (spec §6.1) */
  danger: 43,
  /** spec §6.4: demissão automática do humano com estabilidade < 20% após um jogo */
  fireStability: 20,
  /** spec §6.4: ou confiança da diretoria < 15% */
  fireBoard: 15,
  /** (decisão) torcida < 12% ⇒ "A diretoria cedeu à pressão popular" */
  fireFans: 12,
  /** spec §6.4: sem demissão automática nos 5 primeiros jogos após assumir */
  graceGames: 5,
  start: 60,
  /* por jogo (spec §6.4) */
  win: 2, winBig: 3, drawHome: 0, drawAway: 0.5, loss: -3, lossHomeWeaker: -5, cupOut: -6,
  /* temporada (spec §6.4) */
  title: 25, promotion: 20, relegation: -40,
  /* reputação (spec §6.3): 3×V + 1×E por jogo × fator da competição; título = prêmio/1M (piso 5); −15%/ano */
  repWin: 3, repDraw: 1, titleFloor: 5, decay: 0.15, pointsPerLevel: 400,
  /** (decisão) demissão custa 10% dos pontos + 40; pedir demissão, 15 */
  firedPenalty: 40, resignPenalty: 15,
  /* prazos (original) */
  applicationDays: 7, offerDays: 7, interestBlockDays: 182, returnBlockDays: 30, fineMonths: 6,
  /** declarar interesse: queda "drástica" do técnico atual (decisão: 30–40 pontos) */
  interestHit: 30,
  /** (decisão) declarar interesse estando empregado irrita a própria diretoria/torcida */
  interestOwnBoard: -8, interestOwnFans: -5,
  /** técnico da CPU com reputação (0..5) acima da sua + isto: a diretoria fica com ele (original: "status muito maior") */
  interestStatusGap: 1,
  /** clube aceita/convida se reputaçãoClube ≤ nível do técnico + 0,5 (spec §6.3) */
  repSlack: 0.5,
  inboxCap: 150, changesCap: 60, freeCap: 40,
} as const;

/** mesma moeda das notícias da engine (`$`) */
const MONEY = (v: number) => fmtMoneyShort(Math.round(v));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const daysBetween = (a: string, b: string) => dayIndex(b) - dayIndex(a);

/* ═════════════════════ leituras ═════════════════════ */

/** Nível do técnico 0..5 (`repTec = pontos/400`, spec §6.3). */
export function coachLevel(coach: Pick<Coach, 'reputationPoints'>): number {
  return clamp(coach.reputationPoints / COACH.pointsPerLevel, 0, 5);
}

/** Reputação 0..100 exibida na UI (= nível × 20). */
export function coachReputation(coach: Pick<Coach, 'reputationPoints'>): number {
  return Math.round(coachLevel(coach) * 20);
}

/** Faixa de estabilidade (cores da UI): > 79 blindado; < 43 prestes a cair; < 20 por um fio. */
export function stabilityBand(stability: number): 'shielded' | 'stable' | 'danger' | 'critical' {
  if (stability > COACH.shielded) return 'shielded';
  if (stability < COACH.fireStability) return 'critical';
  if (stability < COACH.danger) return 'danger';
  return 'stable';
}

/** Salário mensal do técnico pela reputação do clube (0..5) — decisão: 8 mil + 12 mil × rep². */
export function coachWage(clubReputation: number, revenue?: number): number {
  // (Etapa 4) escala real: ~1,1% da receita anual do clube por ano (Real Madrid ~€ 1 mi/mês; Flamengo ~€ 300 mil;
  // Série B ~€ 16 mil), o mesmo valor que entra na linha "comissão e funcionários" do clube
  if (revenue && revenue > 0) return coachMonthlyFor(revenue);
  const rep = clamp(clubReputation, 0, 5);
  return Math.round((8_000 + 12_000 * rep * rep) / 500) * 500;
}

/** Multa rescisória: 6 meses de salário (original). */
export function resignationFine(coach: Pick<Coach, 'wage'>): number {
  return COACH.fineMonths * coach.wage;
}

/** Reputação mínima (0..100) para um clube/seleção de reputação 0..5. */
export function requiredReputation(clubReputation: number): number {
  return Math.round(clamp(clubReputation - COACH.repSlack, 0, 5) * 20);
}

/** Pode pedir acordo mútuo? (estabilidade ≤ 43%) */
export function canMutualAgreement(cc: CoachCareer): boolean {
  return !!cc.board && cc.board.stability <= COACH.danger;
}

/** Mensagens não lidas. */
export function unreadCount(cc: CoachCareer | undefined | null): number {
  return cc ? cc.inbox.reduce((n, m) => n + (m.read ? 0 : 1), 0) : 0;
}

/* ═════════════════════ nomes, seleções, clubes ═════════════════════ */

const GIVEN = ['Carlos', 'Paulo', 'Roberto', 'Marcelo', 'Antônio', 'Fernando', 'Luiz', 'Ricardo', 'Sérgio', 'Jorge', 'Cláudio', 'Eduardo',
  'Márcio', 'Renato', 'Vágner', 'Gilson', 'Hélio', 'Ademir', 'Celso', 'Dorival', 'Abel', 'Tite', 'Wanderley', 'Joel', 'Oswaldo', 'Nelsinho',
  'Péricles', 'Zé', 'Guto', 'Léo', 'Rogério', 'Fábio', 'Alexandre', 'Juan', 'Mano', 'Emerson', 'Givanildo', 'Lisca', 'Dado', 'Argel'];
const SURNAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Ferreira', 'Carvalho', 'Moraes', 'Barbosa', 'Ribeiro', 'Mendes', 'Lopes', 'Gomes',
  'Andrade', 'Teixeira', 'Rocha', 'Cardoso', 'Nunes', 'Ramos', 'Batista', 'Macedo', 'Peixoto', 'Ventura', 'Conceição', 'Sampaio', 'Freitas',
  'Castro', 'Pires', 'Amaral', 'Bastos', 'Lima'];

function coachName(rng: Rng, pool?: NamePool): string {
  if (pool?.given?.length && pool.surname?.length) return randomName(pool, rng, false);
  return `${rng.pick(GIVEN)} ${rng.pick(SURNAMES)}`;
}

interface ClubMeta { name: string; reputation: number; level: number; uf: string | null; countryId: number; revenue?: number }

const metaCache = new WeakMap<CareerData['clubs'], Map<string, ClubMeta>>();
function metaMap(data: CareerData): Map<string, ClubMeta> {
  let m = metaCache.get(data.clubs);
  if (m) return m;
  m = new Map<string, ClubMeta>();
  for (const c of data.clubs) m.set(c.id, { name: c.name, reputation: c.reputation ?? 0, level: c.level ?? 1, uf: c.state, countryId: c.countryId, revenue: c.finances?.revenue });
  metaCache.set(data.clubs, m);
  return m;
}

function clubRep(state: SeasonState | null, metas: Map<string, ClubMeta>, id: string): number {
  return state?.clubInfo?.[id]?.reputation ?? metas.get(id)?.reputation ?? 0;
}

/** (Etapa 4) E-mails mensais da diretoria: caixa negativo (cheque especial) e folha perto/acima do teto. */
function financeMail(cc: CoachCareer, state: SeasonState, clubId: string, day: string): void {
  const c = state.clubs[clubId];
  const info = state.clubInfo?.[clubId];
  if (!c || !info) return;
  const name = info.name ?? clubId;
  if (c.balance < 0) {
    const limit = info.creditLimit ?? 0;
    const over = limit > 0 && c.balance < -limit;
    mail(cc, day, `Diretoria do ${name}`, over ? 'Limite do cheque especial estourado' : 'Caixa no cheque especial',
      `O caixa do clube está em ${MONEY(c.balance)}. O banco cobra 2,5% de juros ao mês sobre o saldo negativo${limit ? ` (limite: ${MONEY(-limit)})` : ''}.${over ? ' Novas contratações estão bloqueadas até o caixa voltar para dentro do limite.' : ' Venda jogadores ou reduza a folha para sair do vermelho.'}`,
      'warning', { tone: 'bad', clubId });
  }
  const w = c.boardWarn;
  if (w && w.month === day.slice(0, 7) && w.level === 2) {
    mail(cc, day, `Diretoria do ${name}`, 'Folha salarial acima do teto',
      `A folha salarial passou do teto definido pela diretoria (${MONEY(info.wageCeiling ?? 0)} por ano). Contratações e renovações que aumentem a folha estão vetadas.`,
      'board', { tone: 'bad', clubId });
  }
}

/** (Etapa 4) receita anual do clube (salário do técnico em escala real). */
function clubRevenue(state: SeasonState | null, metas: Map<string, ClubMeta>, id: string): number | undefined {
  return state?.clubInfo?.[id]?.revenue ?? metas.get(id)?.revenue;
}

function clubNameOf(state: SeasonState | null, metas: Map<string, ClubMeta>, id: string): string {
  return state?.clubInfo?.[id]?.name ?? metas.get(id)?.name ?? id;
}

/** Seleções que podem abrir vaga: países com ≥ 6 clubes nos dados; reputação = maior reputação de clube + 1 (máx. 5). */
export function nationalTeams(data: CareerData): { id: number; code: string; name: string; reputation: number }[] {
  const byCountry = new Map<number, { n: number; rep: number }>();
  for (const c of data.clubs) {
    const e = byCountry.get(c.countryId) ?? { n: 0, rep: 0 };
    e.n++;
    e.rep = Math.max(e.rep, c.reputation ?? 0);
    byCountry.set(c.countryId, e);
  }
  const out: { id: number; code: string; name: string; reputation: number }[] = [];
  for (const c of data.countries) {
    const e = byCountry.get(c.id);
    if (!e || e.n < 6 || !c.code) continue;
    const name = (c as { name?: string }).name ?? c.code;
    out.push({ id: c.id, code: c.code, name: `Seleção ${name.startsWith('Seleção') ? name.slice(8) : name}`, reputation: Math.min(5, e.rep + 1) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Clubes do país da carreira com técnico da CPU acompanhado (não estrangeiros, presentes na temporada). */
function trackedClubs(world: WorldState, state: SeasonState): string[] {
  return Object.keys(state.clubs).filter((id) => {
    const info = state.clubInfo?.[id];
    return !info?.foreign && (info?.countryId === undefined || info.countryId === world.countryId);
  }).sort();
}

/* ═════════════════════ meta da temporada ═════════════════════ */

/** Competição principal do clube: liga nacional; senão o estadual de menor divisão. */
export function mainCompetition(state: SeasonState, clubId: string): Competition | undefined {
  const mine = state.competitions.filter((c) => c.clubIds.includes(clubId));
  return mine.find((c) => c.type === 'league' && !c.clubIds.some((id) => state.clubInfo?.[id]?.foreign))
    ?? mine.filter((c) => c.type === 'state').sort((a, b) => (a.division ?? 9) - (b.division ?? 9))[0]
    ?? mine.find((c) => c.type === 'league') ?? mine[0];
}

const EXPECTATION_LABEL: Record<ExpectationKind, string> = {
  title: 'Brigar pelo título',
  continental: 'Vaga continental',
  midtable: 'Meio de tabela',
  'avoid-relegation': 'Evitar o rebaixamento',
  promotion: 'Conquistar o acesso',
};

/**
 * Meta da temporada (decisão documentada; o original não expõe a fórmula): ranking de força (nível, reputação) do clube
 * na competição principal × divisão.
 *  - 1ª divisão nacional: top 2 → título (até 2º); top 6 → vaga continental (até 6º); metade de cima → meio de tabela
 *    (até n/2 + 2); resto → evitar o rebaixamento (até n − rebaixados).
 *  - divisões inferiores: top (acesso + 1) → acesso (até a última vaga de acesso); metade → meio de tabela; resto → evitar.
 *  - estadual: top 2 → título (até 2º); metade → meio de tabela; resto → evitar o rebaixamento.
 */
export function seasonExpectation(state: SeasonState, clubId: string, data: CareerData, squads?: (clubId: string) => Player[]): SeasonExpectation {
  const comp = mainCompetition(state, clubId);
  const metas = metaMap(data);
  if (!comp) {
    return { season: clubSeason(state, clubId), kind: 'midtable', label: EXPECTATION_LABEL.midtable, competitionId: null, competitionName: '—', targetPos: 1, size: 1, strengthRank: 1 };
  }
  // (Calendário/assistente, 13/11) com os elencos: a meta segue a FORÇA REAL do elenco (média dos 11 melhores, com uma
  // casa decimal; empate → nível/reputação). Sem eles (servidor), só nível/reputação dos dados — que ignorava o elenco
  // atual (ex.: São Paulo com meta de vaga continental tendo o 9º elenco da liga, demitido em 3 de 3 simulações).
  const strength = new Map<string, number>();
  if (squads) {
    for (const id of comp.clubIds) {
      const top = squads(id).map((p) => p.overall).sort((a, b) => b - a).slice(0, 11);
      strength.set(id, top.length ? Math.round((top.reduce((s, v) => s + v, 0) / top.length) * 10) / 10 : 0);
    }
  }
  const order = comp.clubIds.slice().sort((a, b) => {
    const ma = metas.get(a), mb = metas.get(b);
    return (strength.get(b) ?? 0) - (strength.get(a) ?? 0) || (mb?.level ?? 0) - (ma?.level ?? 0) || (mb?.reputation ?? 0) - (ma?.reputation ?? 0) || (a < b ? -1 : 1);
  });
  const n = comp.clubIds.length;
  const r = order.indexOf(clubId) + 1;
  const half = Math.ceil(n / 2);
  const releg = Math.max(1, comp.relegated || Math.round(n / 5));
  const safe = Math.max(1, n - releg);
  let kind: ExpectationKind;
  let target: number;
  const div = comp.division ?? 1;
  if (comp.type === 'league' && div === 1) {
    if (r <= 2) { kind = 'title'; target = 2; }
    else if (r <= 6) { kind = 'continental'; target = Math.min(6, n); }
    else if (r <= half) { kind = 'midtable'; target = Math.min(n, half + 2); }
    else { kind = 'avoid-relegation'; target = safe; }
  } else if (comp.type === 'league') {
    const up = Math.max(1, comp.promoted || 4);
    if (r <= up + 1) { kind = 'promotion'; target = up; }
    else if (r <= half) { kind = 'midtable'; target = Math.min(n, half + 1); }
    else { kind = 'avoid-relegation'; target = safe; }
  } else {
    if (r <= 2) { kind = 'title'; target = 2; }
    else if (r <= half) { kind = 'midtable'; target = Math.min(n, half + 1); }
    else { kind = 'avoid-relegation'; target = comp.relegated ? safe : n; }
  }
  return { season: clubSeason(state, clubId), kind, label: EXPECTATION_LABEL[kind], competitionId: comp.id, competitionName: comp.name, targetPos: target, size: n, strengthRank: r };
}

/** Posição atual do clube na competição principal (tabela geral de pontos; final ranking se encerrada). */
export function currentPosition(state: SeasonState, clubId: string, compId: string | null): number | null {
  const comp = compId ? state.competitions.find((c) => c.id === compId) : undefined;
  if (!comp || !comp.clubIds.includes(clubId)) return null;
  if (comp.finished && comp.format) {
    const i = finalRanking(comp).indexOf(clubId);
    return i >= 0 ? i + 1 : null;
  }
  const rows = computeStandings(comp);
  const i = rows.findIndex((x) => x.clubId === clubId);
  return i >= 0 && rows[i].played > 0 ? i + 1 : null;
}

/* ═════════════════════ criação e migração ═════════════════════ */

export interface CreateCoachOptions {
  name?: string;
  nationalityId?: number;
  /** pools de nomes (names/<CODE>.json) para os técnicos da CPU; sem eles, nomes embutidos */
  pools?: Record<string, NamePool>;
  /** (13/11) elencos efetivos (meta da 1ª temporada pela força real do elenco) */
  squads?: (clubId: string) => Player[];
}

function nextId(cc: CoachCareer, prefix: string): string {
  return `${prefix}${++cc.seq}`;
}

function newBoard(clubId: string, stability: number = COACH.start): ClubBoardState {
  return {
    clubId, stability, boardConfidence: COACH.start, fanConfidence: COACH.start, expectation: null,
    gamesSinceHire: 0, streak: 0, turnoDone: false, warned: { stability: 100, board: 100, fans: 100 },
  };
}

function newAiCoach(rng: Rng, rep: number, date: string, pool?: NamePool, nationalityId = 29): AiCoach {
  return {
    name: coachName(rng, pool), nationalityId,
    reputation: r1(clamp(rep + rng.range(-0.6, 0.6), 0, 5)),
    stability: rng.int(50, 76), since: date, games: 0,
  };
}

/**
 * Cria a carreira do técnico a partir do clube humano atual (carreira nova ou save antigo migrado).
 * Decisão: o técnico começa com a reputação mínima do clube escolhido (pontos = 400 × max(0, rep − 0,5)), salário pela
 * reputação do clube e contrato de 2 temporadas; os clubes do país ganham técnicos da CPU; 3 vagas e 2 seleções abertas.
 */
export function createCoachCareer(world: WorldState, state: SeasonState, data: CareerData, o: CreateCoachOptions = {}): CoachCareer {
  const metas = metaMap(data);
  const date = state.date;
  const clubId = world.humanClubIds[0] ?? null;
  const rep = clubId ? clubRep(state, metas, clubId) : 0;
  const rng = new Rng(`${world.seed}:coach:create`);
  const pool = o.pools?.[world.countryCode];
  const coach: Coach = {
    name: (o.name ?? '').trim().slice(0, 50) || 'Técnico',
    nationalityId: o.nationalityId ?? world.countryId,
    reputationPoints: Math.round(COACH.pointsPerLevel * Math.max(0, rep - COACH.repSlack)),
    wage: coachWage(rep, clubId ? clubRevenue(state, metas, clubId) : undefined),
    savings: 0,
    clubId,
    contractUntil: clubId ? clubSeason(state, clubId) + 1 : null,
    since: clubId ? date : null,
    nationalTeamId: null,
    nationalSince: null,
    history: clubId ? [{ kind: 'club', clubId, name: clubNameOf(state, metas, clubId), from: date, to: null, games: 0, won: 0, drawn: 0, lost: 0, titles: [] }] : [],
  };
  coach.savings = coach.wage * 3;
  const cc: CoachCareer = {
    v: 1, coach, board: clubId ? newBoard(clubId) : null, aiCoaches: {}, freeCoaches: [], vacancies: [], offers: [], applications: [],
    inbox: [], leftClubs: {}, lastInterestOn: null, pressure: [], changes: [],
    seasonRecord: { season: clubSeason(state, clubId), games: 0, won: 0, drawn: 0, lost: 0 }, seq: 0, lastDay: null,
  };
  for (const id of trackedClubs(world, state)) {
    if (id === clubId) continue;
    cc.aiCoaches[id] = newAiCoach(rng, clubRep(state, metas, id), addDays(date, -rng.int(30, 700)), pool, world.countryId);
  }
  for (let i = 0; i < 6; i++) cc.freeCoaches.push(newAiCoach(rng, rng.range(0, 3), date, pool, world.countryId));
  // vagas iniciais (técnicos que saíram na pré-temporada), mais nas divisões menores
  const candidates = Object.keys(cc.aiCoaches);
  for (let i = 0; i < 3 && candidates.length; i++) {
    const id = candidates[rng.int(0, candidates.length - 1)];
    if (cc.vacancies.some((v) => v.clubId === id)) continue;
    const ai = cc.aiCoaches[id];
    delete cc.aiCoaches[id];
    openVacancy(cc, state, metas, { clubId: id }, date, 'initial', ai.name, rng);
  }
  const nats = nationalTeams(data);
  for (let i = 0; i < 2 && nats.length; i++) {
    const t = nats[rng.int(0, nats.length - 1)];
    if (cc.vacancies.some((v) => v.nationalTeamId === t.id)) continue;
    openNationalVacancy(cc, t, date, rng);
  }
  if (clubId && cc.board) {
    cc.board.expectation = seasonExpectation(state, clubId, data, o.squads);
    const name = clubNameOf(state, metas, clubId);
    mail(cc, date, 'Diretoria', `Bem-vindo ao ${name}`,
      'A diretoria lhe deseja sorte. Esperamos muitas vitórias. Nesta janela iremos te comunicar sobre vários assuntos do clube.', 'welcome', { clubId, tone: 'good' });
    goalMail(cc, date, name, cc.board.expectation);
  }
  return cc;
}

/* ═════════════════════ caixa de entrada ═════════════════════ */

function mail(cc: CoachCareer, date: string, from: string, subject: string, body: string, kind: InboxKind, extra: Partial<InboxMessage> = {}): InboxMessage {
  const m: InboxMessage = { id: nextId(cc, 'm'), date, from, subject, body, kind, read: false, ...extra };
  cc.inbox.unshift(m);
  if (cc.inbox.length > COACH.inboxCap) cc.inbox.length = COACH.inboxCap;
  return m;
}

function goalMail(cc: CoachCareer, date: string, clubName: string, e: SeasonExpectation | null): void {
  if (!e) return;
  mail(cc, date, 'Diretoria', `Meta da temporada ${e.season}: ${e.label}`,
    `A diretoria do ${clubName} definiu a meta para ${e.season}: ${e.label.toLowerCase()} no ${e.competitionName} (terminar até a ${e.targetPos}ª posição). ` +
    `O elenco é o ${e.strengthRank}º mais forte entre ${e.size} clubes.`, 'goal', { tone: 'neutral' });
}

/** Marca mensagens como lidas (todas, se `ids` ausente). */
export function markInboxRead(world: WorldState, ids?: string[]): void {
  const cc = world.coach;
  if (!cc) return;
  const set = ids ? new Set(ids) : null;
  for (const m of cc.inbox) if (!set || set.has(m.id)) m.read = true;
}

/** Renomeia o técnico humano. */
export function renameCoach(world: WorldState, name: string): CoachActionResult {
  const cc = world.coach;
  const n = name.trim().slice(0, 50);
  if (!cc) return fail('Carreira de técnico desligada.');
  if (n.length < 2) return fail('Nome do técnico inválido (2-50 caracteres)');
  cc.coach.name = n;
  return { ok: true, message: 'Nome atualizado.' };
}

/* ═════════════════════ vagas e técnicos da CPU ═════════════════════ */

function openVacancy(
  cc: CoachCareer, state: SeasonState | null, metas: Map<string, ClubMeta>, target: { clubId: string },
  date: string, reason: JobVacancy['reason'], previousCoach: string | null, rng: Rng,
): JobVacancy {
  const existing = cc.vacancies.find((v) => v.clubId === target.clubId);
  if (existing) return existing;
  const rep = clubRep(state, metas, target.clubId);
  const v: JobVacancy = {
    id: nextId(cc, 'v'), clubId: target.clubId, name: clubNameOf(state, metas, target.clubId), openedOn: date, reason,
    fillOn: addDays(date, rng.int(7, 20)), minReputation: requiredReputation(rep), previousCoach,
  };
  cc.vacancies.push(v);
  return v;
}

function openNationalVacancy(cc: CoachCareer, t: { id: number; name: string; reputation: number }, date: string, rng: Rng): JobVacancy {
  const v: JobVacancy = {
    id: nextId(cc, 'v'), nationalTeamId: t.id, name: t.name, openedOn: date, reason: 'national',
    fillOn: addDays(date, rng.int(25, 60)), minReputation: requiredReputation(t.reputation), previousCoach: null,
  };
  cc.vacancies.push(v);
  return v;
}

function logChange(cc: CoachCareer, c: CoachCareer['changes'][number]): void {
  cc.changes.unshift(c);
  if (cc.changes.length > COACH.changesCap) cc.changes.length = COACH.changesCap;
}

function fireAiCoach(cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, clubId: string, date: string, rng: Rng, why: 'stability' | 'pressure' | 'relegation'): void {
  const ai = cc.aiCoaches[clubId];
  if (!ai) return;
  delete cc.aiCoaches[clubId];
  const name = clubNameOf(state, metas, clubId);
  const pct = Math.round(ai.stability);
  const pressured = why === 'pressure';
  const v = openVacancy(cc, state, metas, { clubId }, date, pressured ? 'pressure' : 'fired', ai.name, rng);
  cc.freeCoaches.push({ ...ai, stability: COACH.start, games: 0 });
  if (cc.freeCoaches.length > COACH.freeCap) cc.freeCoaches.splice(0, cc.freeCoaches.length - COACH.freeCap);
  const reason = why === 'relegation' ? 'rebaixamento' : `baixa estabilidade (${pct}%)`;
  state.news.push({ date, text: `O ${name} demitiu seu técnico ${ai.name} devido ${why === 'relegation' ? 'ao rebaixamento' : `à baixa estabilidade (${pct}%)`}.`, clubId });
  logChange(cc, { date, clubId, name, out: ai.name, in: null, reason: pressured ? 'demitido sob pressão' : `demitido (${reason})` });
  // a pressão funcionou: o clube oferece o cargo ao humano
  if (pressured && cc.coach.clubId !== clubId) {
    const rep = clubRep(state, metas, clubId);
    const offer = makeOffer(cc, state, metas, { clubId }, date, 'pressure', rep);
    v.fillOn = addDays(offer.expiresAt, 1);
    mail(cc, date, `Diretoria do ${name}`, `Interesse Recebido (Vaga Aberta!)`,
      `A diretoria demitiu o técnico sob pressão e publicou:\n\n"Achamos que você seja o treinador ideal para nosso clube."\n\nDeseja assumir o ${name}?`,
      'offer', { offerId: offer.id, clubId, tone: 'good' });
  }
}

function makeOffer(
  cc: CoachCareer, state: SeasonState | null, metas: Map<string, ClubMeta>, target: { clubId?: string; nationalTeamId?: number; name?: string },
  date: string, kind: JobOffer['kind'], rep: number,
): JobOffer {
  const o: JobOffer = {
    id: nextId(cc, 'o'),
    ...(target.clubId ? { clubId: target.clubId } : { nationalTeamId: target.nationalTeamId }),
    name: target.name ?? (target.clubId ? clubNameOf(state, metas, target.clubId) : 'Seleção'),
    wage: coachWage(rep, target.clubId ? clubRevenue(state, metas, target.clubId) : undefined), years: 1, stability: COACH.start,
    division: target.clubId ? state?.clubInfo?.[target.clubId]?.division ?? null : null,
    createdAt: date, expiresAt: addDays(date, COACH.offerDays), kind, status: 'pending',
  };
  cc.offers.unshift(o);
  if (cc.offers.length > 40) cc.offers.length = 40;
  return o;
}

/** A CPU contrata para a vaga (técnico livre de reputação compatível, ou um novo nome). */
function fillVacancy(cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, v: JobVacancy, date: string, rng: Rng, pool?: NamePool): void {
  cc.vacancies = cc.vacancies.filter((x) => x.id !== v.id);
  if (v.nationalTeamId !== undefined) {
    logChange(cc, { date, nationalTeamId: v.nationalTeamId, name: v.name, out: v.previousCoach ?? null, in: coachName(rng, pool), reason: 'seleção' });
    return;
  }
  const clubId = v.clubId!;
  if (cc.coach.clubId === clubId) return;
  const rep = clubRep(state, metas, clubId);
  const i = cc.freeCoaches.findIndex((c) => c.name !== v.previousCoach && Math.abs(c.reputation - rep) <= 1);
  const ai = i >= 0 ? cc.freeCoaches.splice(i, 1)[0] : newAiCoach(rng, rep, date, pool);
  cc.aiCoaches[clubId] = { ...ai, stability: rng.int(55, 70), since: date, games: 0 };
  state.news.push({ date, text: `O ${v.name} contratou o técnico ${ai.name}.`, clubId });
  logChange(cc, { date, clubId, name: v.name, out: v.previousCoach ?? null, in: ai.name, reason: 'contratação' });
  // pendências do humano para este clube perdem o sentido
  for (const a of cc.applications) if (a.vacancyId === v.id && a.status === 'pending') a.status = 'rejected';
}

/* ═════════════════════ processamento diário ═════════════════════ */

export interface CoachDayContext {
  data: CareerData;
  pools?: Record<string, NamePool>;
  /** (13/11) elencos efetivos: a meta da temporada segue a força real do elenco (ver seasonExpectation) */
  squads?: (clubId: string) => Player[];
}

export interface CoachDayEvents {
  /** o humano foi demitido hoje */
  fired: boolean;
  /** clube de onde saiu (demissão) */
  firedFrom?: string;
  /** propostas novas (convites, candidaturas aprovadas, pressão) */
  offers: number;
  /** respostas de candidatura recebidas */
  answers: number;
  /** avisos da diretoria (estabilidade/confiança) */
  warnings: number;
}

function competitionFactor(comp: Competition | undefined): number {
  if (!comp) return 0.5;
  if (comp.type === 'continental') return 1.5;
  if (comp.type === 'state') return 0.3;
  if (comp.type === 'cup' || comp.type === 'supercup') return comp.id === 'NORDESTE' ? 0.5 : 1;
  return ({ 1: 1, 2: 0.6, 3: 0.4, 4: 0.25 } as Record<number, number>)[comp.division ?? 1] ?? 0.25;
}

function tieLoser(comp: Competition | undefined, f: Fixture): string | null {
  if (!comp || !f.tieId || !f.knockout || !comp.stages) return null;
  for (const st of Object.values(comp.stages)) {
    const t = st.ties?.find((x) => x.id === f.tieId);
    if (t) return t.loser ?? null;
  }
  return null;
}

function outcome(f: Fixture, res: MatchResult | undefined, clubId: string): 'W' | 'D' | 'L' {
  const home = f.homeId === clubId;
  const gf = res ? (home ? res.homeGoals : res.awayGoals) : home ? f.result!.home : f.result!.away;
  const ga = res ? (home ? res.awayGoals : res.homeGoals) : home ? f.result!.away : f.result!.home;
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
}

function isClassic(metas: Map<string, ClubMeta>, a: string, b: string): boolean {
  const ma = metas.get(a), mb = metas.get(b);
  return !!ma && !!mb && !!ma.uf && ma.uf === mb.uf && ma.reputation >= 3 && mb.reputation >= 3;
}

function adjust(b: ClubBoardState, st: number, board: number, fans: number): void {
  b.stability = r1(clamp(b.stability + st, 0, 100));
  b.boardConfidence = r1(clamp(b.boardConfidence + board, 0, 100));
  b.fanConfidence = r1(clamp(b.fanConfidence + fans, 0, 100));
}

function currentItem(cc: CoachCareer): CoachHistoryItem | undefined {
  const id = cc.coach.clubId;
  if (!id) return undefined;
  for (let i = cc.coach.history.length - 1; i >= 0; i--) {
    const h = cc.coach.history[i];
    if (h.kind === 'club' && h.clubId === id && h.to === null) return h;
  }
  return undefined;
}

/**
 * Processa o dia já simulado (chamar DEPOIS de `advanceDay`, com o `played` devolvido). Muta `world.coach` e, na
 * demissão, `world`/`state` (clube humano). Idempotente por data (`lastDay`).
 *
 * Por jogo do humano (spec §6.4): vitória +2 (+3 mata-mata/clássico), empate 0 em casa / +0,5 fora, derrota −3 (−5 em
 * casa contra clube de reputação menor), eliminação −6; sequência de 3+ derrotas −1 extra por jogo, 3+ vitórias +1.
 * Diretoria: 60% da variação + metas e finanças; torcida: resultados (×1,5 em clássico) e contratações/vendas de estrela.
 * Demissão (humano): após um jogo, passados 5 jogos do início, se estabilidade < 20, diretoria < 15 ou torcida < 12.
 * Semanal (segunda-feira): estabilidade volta 2% em direção a 55; caixa negativo −2 na diretoria; CPU demite com
 * probabilidade max(0, 43 − est)/100; convites (desempregado 40%, empregado 8% por semana).
 */
export function coachDay(world: WorldState, state: SeasonState, played: { fixture: Fixture; result: MatchResult }[], ctx: CoachDayContext): CoachDayEvents {
  const ev: CoachDayEvents = { fired: false, offers: 0, answers: 0, warnings: 0 };
  const cc = world.coach;
  if (!cc) return ev;
  const day = addDays(state.date, -1);
  if (cc.lastDay && cc.lastDay >= day) return ev;
  cc.lastDay = day;
  const metas = metaMap(ctx.data);
  const rng = new Rng(`${world.seed}:${day}:coach`);
  const pool = ctx.pools?.[world.countryCode];
  const offersBefore = cc.offers.filter((o) => o.status === 'pending').length;
  const compById = new Map(state.competitions.map((c) => [c.id, c]));

  // 0) nova temporada: meta da diretoria
  const hid = cc.coach.clubId;
  // (Etapa 1) temporada do ciclo da região do clube do técnico (Europa 2026/27 → 2026)
  const hSeason = clubSeason(state, hid);
  if (hid && cc.board && (!cc.board.expectation || cc.board.expectation.season !== hSeason)) {
    cc.board.expectation = seasonExpectation(state, hid, ctx.data, ctx.squads);
    cc.board.turnoDone = false;
    goalMail(cc, day, clubNameOf(state, metas, hid), cc.board.expectation);
  }
  if (cc.seasonRecord.season !== hSeason) cc.seasonRecord = { season: hSeason, games: 0, won: 0, drawn: 0, lost: 0 };
  // clubes novos na temporada (ex.: subiram de divisão estadual) ganham técnico
  if (day.endsWith('-01-01') || Object.keys(cc.aiCoaches).length === 0) {
    for (const id of trackedClubs(world, state)) {
      if (id === hid || cc.aiCoaches[id] || cc.vacancies.some((v) => v.clubId === id)) continue;
      cc.aiCoaches[id] = newAiCoach(rng, clubRep(state, metas, id), day, pool, world.countryId);
    }
  }

  // 1) jogos do dia
  let humanPlayed = false;
  for (const { fixture: f, result } of played) {
    const comp = compById.get(f.competitionId);
    const loser = tieLoser(comp, f);
    for (const clubId of [f.homeId, f.awayId]) {
      const opp = clubId === f.homeId ? f.awayId : f.homeId;
      const o = outcome(f, result, clubId);
      if (clubId === hid && cc.board) {
        humanPlayed = true;
        humanResult(cc, state, metas, f, comp, o, clubId, opp, loser === clubId, day);
      } else {
        const ai = cc.aiCoaches[clubId];
        if (!ai) continue;
        ai.games++;
        ai.stability = r1(clamp(ai.stability + (o === 'W' ? (f.knockout ? COACH.winBig : COACH.win) : o === 'L' ? COACH.loss : f.homeId === clubId ? 0 : COACH.drawAway) + (loser === clubId ? COACH.cupOut : 0), 0, 100));
        // pressão declarada pelo humano: cai na rodada seguinte se estiver prestes a cair
        const pressed = cc.pressure.find((p) => p.clubId === clubId && p.until >= day);
        if (pressed && ai.stability < COACH.danger) {
          cc.pressure = cc.pressure.filter((p) => p !== pressed);
          fireAiCoach(cc, state, metas, clubId, day, rng, 'pressure');
        }
      }
    }
  }
  // títulos conquistados hoje
  if (hid && cc.board) {
    for (const comp of state.competitions) {
      if (!comp.finished || comp.championId !== hid) continue;
      const item = currentItem(cc);
      const tSeason = comp.cycleSeason ?? state.season;
      if (!item || item.titles.some((t) => t.competitionId === comp.id && t.season === tSeason)) continue;
      item.titles.push({ season: tSeason, competitionId: comp.id, name: comp.name });
      const prize = (comp.prizeKey && state.career?.prizes[comp.prizeKey]) || 0;
      cc.coach.reputationPoints = Math.round(cc.coach.reputationPoints + Math.max(COACH.titleFloor, prize / 1_000_000));
      adjust(cc.board, COACH.title, 15, 20);
      mail(cc, day, 'Diretoria', `Campeão: ${comp.name}!`, `Parabéns pelo título do ${comp.name} ${comp.seasonLabel ?? state.season}! A diretoria e a torcida estão em festa.`, 'board', { tone: 'good', clubId: hid });
    }
  }
  // avaliação do 1º turno
  if (hid && cc.board && humanPlayed && !cc.board.turnoDone) turnoReview(cc, state, metas, hid, day);
  // torcida × contratações/vendas de estrela (spec §5.6)
  if (hid && cc.board) fanTransfers(cc, state, hid, day);
  // demissão do humano
  if (hid && cc.board && humanPlayed && cc.board.gamesSinceHire >= COACH.graceGames) {
    const b = cc.board;
    const why = b.stability < COACH.fireStability ? 'stability' : b.boardConfidence < COACH.fireBoard ? 'board' : b.fanConfidence < COACH.fireFans ? 'fans' : null;
    if (why) {
      fireHuman(world, state, ctx.data, day, why, rng);
      ev.fired = true;
      ev.firedFrom = hid;
    }
  }
  if (!ev.fired && cc.board) ev.warnings += warnings(cc, state, metas, day);
  // (Etapa 4) dia 1: e-mails da diretoria sobre o cheque especial e o teto da folha salarial
  if (!ev.fired && hid && cc.board && day.endsWith('-01')) financeMail(cc, state, hid, day);

  // 2) semanal (segunda-feira)
  const weekly = new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
  if (weekly) {
    const b = cc.board;
    if (b && cc.coach.clubId) {
      adjust(b, (55 - b.stability) * 0.02, (55 - b.boardConfidence) * 0.02, (55 - b.fanConfidence) * 0.02);
      if ((state.clubs[cc.coach.clubId]?.balance ?? 0) < 0) adjust(b, -1, -2, 0);
    }
    for (const id of Object.keys(cc.aiCoaches).sort()) {
      const ai = cc.aiCoaches[id];
      ai.stability = r1(clamp(ai.stability + (60 - ai.stability) * 0.02, 0, 100));
      if (ai.games < COACH.graceGames) continue;
      const pressed = cc.pressure.some((p) => p.clubId === id && p.until >= day);
      if (rng.chance(Math.max(0, COACH.danger - ai.stability) / 100)) fireAiCoach(cc, state, metas, id, day, rng, pressed ? 'pressure' : 'stability');
    }
    cc.pressure = cc.pressure.filter((p) => p.until >= day);
    invitations(cc, state, metas, day, rng);
    // seleções: 1 vaga nova por mês, em média, até 3 abertas
    if (rng.chance(0.25) && cc.vacancies.filter((v) => v.nationalTeamId !== undefined).length < 3) {
      const nats = nationalTeams(ctx.data).filter((t) => t.id !== cc.coach.nationalTeamId && !cc.vacancies.some((v) => v.nationalTeamId === t.id));
      if (nats.length) openNationalVacancy(cc, nats[rng.int(0, nats.length - 1)], day, rng);
    }
  }

  // 3) candidaturas com resposta (7 dias): a data do jogo já avançou para `now` (a resposta chega "hoje")
  const now = state.date;
  for (const a of cc.applications) {
    if (a.status !== 'pending' || a.answerOn > now) continue;
    ev.answers++;
    const v = cc.vacancies.find((x) => x.id === a.vacancyId);
    const rep = a.clubId ? clubRep(state, metas, a.clubId) : (nationalTeams(ctx.data).find((t) => t.id === a.nationalTeamId)?.reputation ?? 3);
    const p = clamp(0.5 + (coachLevel(cc.coach) + COACH.repSlack - rep) * 0.6, 0.05, 0.95);
    const approved = !!v && rng.chance(p);
    a.status = approved ? 'approved' : 'rejected';
    const from = a.clubId ? `Diretor de Futebol — ${a.name}` : `Federação — ${a.name}`;
    if (approved && v) {
      const offer = makeOffer(cc, state, metas, { clubId: a.clubId, nationalTeamId: a.nationalTeamId, name: a.name }, now, 'application', rep);
      v.fillOn = addDays(offer.expiresAt, 1);
      mail(cc, now, from, `Re: Interesse em treinar ${a.name}`, 'Parabéns! Você foi o escolhido para treinar nosso time!', 'application', { offerId: offer.id, clubId: a.clubId, nationalTeamId: a.nationalTeamId, tone: 'good' });
    } else {
      mail(cc, now, from, `Re: Interesse em treinar ${a.name}`, 'Sentimos muito! Mas já escolhemos um novo treinador para nosso time.', 'application', { clubId: a.clubId, nationalTeamId: a.nationalTeamId, tone: 'bad' });
      if (v) v.fillOn = now;
    }
  }
  // 4) propostas vencidas
  for (const o of cc.offers) if (o.status === 'pending' && o.expiresAt < now) o.status = 'expired';
  // 5) a CPU preenche as vagas vencidas (sem candidatura/proposta do humano pendente)
  for (const v of cc.vacancies.slice()) {
    if (v.fillOn > now) continue;
    const busy = cc.applications.some((a) => a.vacancyId === v.id && a.status === 'pending')
      || cc.offers.some((o) => o.status === 'pending' && ((v.clubId && o.clubId === v.clubId) || (v.nationalTeamId !== undefined && o.nationalTeamId === v.nationalTeamId)));
    if (busy) continue;
    fillVacancy(cc, state, metas, v, now, rng, pool);
  }
  for (const k of Object.keys(cc.leftClubs)) if (daysBetween(cc.leftClubs[k], day) > 400) delete cc.leftClubs[k];
  ev.offers = Math.max(0, cc.offers.filter((o) => o.status === 'pending').length - offersBefore);
  return ev;
}

function humanResult(
  cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, f: Fixture, comp: Competition | undefined,
  o: 'W' | 'D' | 'L', clubId: string, opp: string, eliminated: boolean, day: string,
): void {
  const b = cc.board!;
  const home = f.homeId === clubId;
  const classic = isClassic(metas, clubId, opp);
  const big = !!f.knockout || classic;
  const myRep = clubRep(state, metas, clubId), oppRep = clubRep(state, metas, opp);
  let st = o === 'W' ? (big ? COACH.winBig : COACH.win) : o === 'D' ? (home ? COACH.drawHome : COACH.drawAway) : home && oppRep < myRep ? COACH.lossHomeWeaker : COACH.loss;
  let fans = o === 'W' ? 2.5 : o === 'D' ? (home ? -0.5 : 0.5) : home && oppRep < myRep ? -5 : -3.5;
  if (classic) fans *= 1.5;
  b.streak = o === 'W' ? Math.max(0, b.streak) + 1 : o === 'L' ? Math.min(0, b.streak) - 1 : 0;
  if (b.streak <= -3) st -= 1;
  if (b.streak >= 3) st += 1;
  let board = st * 0.6;
  if (eliminated) {
    st += COACH.cupOut;
    board -= 4;
    fans -= 5;
    mail(cc, day, 'Diretoria', `Eliminação: ${comp?.name ?? 'copa'}`, `A eliminação no ${comp?.name ?? 'mata-mata'} não foi bem recebida. A diretoria espera reação imediata.`, 'board', { tone: 'bad', clubId });
  }
  adjust(b, st, board, fans);
  b.gamesSinceHire++;
  const item = currentItem(cc);
  const rec = cc.seasonRecord;
  rec.games++;
  if (item) item.games++;
  if (o === 'W') { rec.won++; if (item) item.won++; }
  else if (o === 'D') { rec.drawn++; if (item) item.drawn++; }
  else { rec.lost++; if (item) item.lost++; }
  const pts = o === 'W' ? COACH.repWin : o === 'D' ? COACH.repDraw : 0;
  cc.coach.reputationPoints = r1(cc.coach.reputationPoints + pts * competitionFactor(comp));
}

/** Avaliação do 1º turno (spec §6.4): na metade dos jogos da competição principal, posição × meta. */
function turnoReview(cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, clubId: string, day: string): void {
  const b = cc.board!;
  const e = b.expectation;
  const comp = e?.competitionId ? state.competitions.find((c) => c.id === e.competitionId) : undefined;
  if (!e || !comp) return;
  const mine = comp.fixtures.filter((f) => f.homeId === clubId || f.awayId === clubId);
  const done = mine.filter((f) => f.result).length;
  if (mine.length < 4 || done < Math.ceil(mine.length / 2)) return;
  b.turnoDone = true;
  const pos = currentPosition(state, clubId, comp.id);
  if (!pos) return;
  const diff = pos - e.targetPos;
  const name = clubNameOf(state, metas, clubId);
  if (diff > 0) {
    adjust(b, -Math.min(16, 2 * diff), -Math.min(16, 2 * diff), -Math.min(8, diff));
    mail(cc, day, 'Diretoria', 'Avaliação do 1º turno', `O ${name} está em ${pos}º no ${comp.name}, abaixo da meta (${e.targetPos}º). A diretoria cobra melhora no returno.`, 'board', { tone: 'bad', clubId });
  } else {
    adjust(b, Math.min(8, -diff + 2), Math.min(8, -diff + 2), Math.min(5, -diff + 1));
    mail(cc, day, 'Diretoria', 'Avaliação do 1º turno', `O ${name} está em ${pos}º no ${comp.name}, dentro da meta (${e.targetPos}º). Continue assim!`, 'board', { tone: 'good', clubId });
  }
}

/** Torcida × transferências do dia (spec §5.6): craque (overall ≥ 82) ±8/−10, estrela (≥ 76) +5/−6. */
function fanTransfers(cc: CoachCareer, state: SeasonState, clubId: string, day: string): void {
  const b = cc.board!;
  for (const t of state.market?.history ?? []) {
    if (t.date < day) break;
    if (t.date !== day) continue;
    const craque = t.overall >= 82, estrela = t.overall >= 76;
    if (!estrela) continue;
    if (t.toClubId === clubId && t.kind !== 'loan-return') {
      adjust(b, 0, 0, craque ? 8 : 5);
      mail(cc, day, 'Torcida', craque ? 'Festa na torcida' : 'Torcida animada', craque ? 'Os torcedores estão em festa pela chegada de um craque!' : 'A torcida ficou animada com a contratação de uma estrela!', 'fans', { tone: 'good', clubId });
    } else if (t.fromClubId === clubId && t.kind === 'transfer') {
      adjust(b, 0, 0, craque ? -10 : -6);
      mail(cc, day, 'Torcida', 'Torcida na bronca', 'A torcida não gostou da venda de uma estrela do time!', 'fans', { tone: 'bad', clubId });
    }
  }
}

/** Avisos da diretoria ao cruzar faixas: estabilidade 43/30; confiança da diretoria e da torcida a cada 10 pontos abaixo de 50. */
function warnings(cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, day: string): number {
  const b = cc.board!;
  const name = clubNameOf(state, metas, b.clubId);
  let n = 0;
  const w = b.warned;
  for (const lvl of [COACH.danger, 30]) {
    if (b.stability < lvl && w.stability > lvl) {
      w.stability = lvl;
      n++;
      mail(cc, day, 'Diretoria', lvl === COACH.danger ? 'Você está prestes a cair' : 'Ultimato da diretoria',
        lvl === COACH.danger
          ? `Sua estabilidade no ${name} caiu para ${Math.round(b.stability)}% (abaixo de 43%). O técnico já está prestes a cair: os próximos jogos serão decisivos.`
          : `Sua estabilidade no ${name} é de ${Math.round(b.stability)}%. Abaixo de 20% o clube encerrará o seu contrato.`,
        'warning', { tone: 'bad', clubId: b.clubId });
    }
  }
  if (b.stability >= COACH.danger + 5) w.stability = 100;
  const conf = (key: 'board' | 'fans', v: number, who: string) => {
    const lvl = Math.floor(v / 10) * 10 + 10;
    if (v < 50 && lvl < w[key]) {
      w[key] = lvl;
      n++;
      mail(cc, day, key === 'board' ? 'Diretoria' : 'Torcida', `Confiança da ${who} em queda`, `A confiança da ${who} caiu para ${Math.round(v)}%.`, 'warning', { tone: 'bad', clubId: b.clubId });
    } else if (v >= 55) w[key] = 100;
  };
  conf('board', b.boardConfidence, 'Diretoria');
  conf('fans', b.fanConfidence, 'Torcida');
  return n;
}

/** Convites (`checkForJobInvitations`): vagas abertas e clubes com técnico prestes a cair, de reputação compatível. */
function invitations(cc: CoachCareer, state: SeasonState, metas: Map<string, ClubMeta>, day: string, rng: Rng): void {
  const employed = !!cc.coach.clubId;
  if (!rng.chance(employed ? 0.08 : 0.4)) return;
  const level = coachLevel(cc.coach);
  const pending = new Set(cc.offers.filter((o) => o.status === 'pending' && o.clubId).map((o) => o.clubId!));
  const blocked = (id: string) => !!cc.leftClubs[id] && daysBetween(cc.leftClubs[id], day) < COACH.returnBlockDays;
  const pool: string[] = [];
  for (const v of cc.vacancies) if (v.clubId) pool.push(v.clubId);
  for (const [id, ai] of Object.entries(cc.aiCoaches)) if (ai.stability < COACH.danger) pool.push(id);
  const fit = pool.filter((id) => id !== cc.coach.clubId && !pending.has(id) && !blocked(id) && clubRep(state, metas, id) <= level + COACH.repSlack)
    .sort((a, b) => clubRep(state, metas, b) - clubRep(state, metas, a) || (a < b ? -1 : 1));
  if (!fit.length) return;
  // prefere os maiores clubes que aceitam o técnico
  const id = fit[Math.min(fit.length - 1, rng.int(0, Math.min(2, fit.length - 1)))];
  const rep = clubRep(state, metas, id);
  const offer = makeOffer(cc, state, metas, { clubId: id }, day, 'invite', rep);
  const v = cc.vacancies.find((x) => x.clubId === id);
  if (v && v.fillOn <= offer.expiresAt) v.fillOn = addDays(offer.expiresAt, 1);
  const name = clubNameOf(state, metas, id);
  mail(cc, day, `Diretoria do ${name}`, `Convite para ser técnico do ${name}`,
    `O ${name} quer você no comando técnico.\n\nSalário: ${MONEY(offer.wage)} por mês · Duração: 1 ano.\nA proposta vale até ${offer.expiresAt.split('-').reverse().join('/')}.`,
    'offer', { offerId: offer.id, clubId: id, tone: 'good' });
}

/* ═════════════════════ demissão e contratação do humano ═════════════════════ */

function closeItem(cc: CoachCareer, date: string, exit: CoachExit): void {
  const item = currentItem(cc);
  if (item) { item.to = date; item.exit = exit; }
}

/** Solta o clube humano: mundo e temporada passam a tratá-lo como CPU (escalação automática, ofertas canceladas). */
function detachHuman(world: WorldState, state: SeasonState | null, clubId: string): void {
  world.humanClubIds = world.humanClubIds.filter((x) => x !== clubId);
  if (!state) return;
  state.humanClubIds = state.humanClubIds.filter((x) => x !== clubId);
  const club = state.clubs[clubId];
  if (club) club.lineup = null;
  for (const o of state.market?.offers ?? []) {
    if (o.toClubId === clubId && (o.status === 'negotiating' || o.status === 'agreed')) o.status = 'withdrawn';
    if (o.fromClubId === clubId && o.status === 'pending') o.status = 'expired';
  }
}

function payClub(world: WorldState, state: SeasonState | null, clubId: string, amount: number): void {
  const c = state?.clubs[clubId];
  if (c) {
    c.balance += amount;
    if (c.finance) c.finance.wages += Math.min(0, amount);
  } else world.balances[clubId] = (world.balances[clubId] ?? 0) + amount;
}

/**
 * Demissão pelo clube (estabilidade/diretoria/torcida ou avaliação de fim de temporada). O clube PAGA a multa
 * (6 salários) ao técnico; reputação −10% − 40 pontos; vaga aberta; o humano fica desempregado.
 */
function fireHuman(world: WorldState, state: SeasonState | null, data: CareerData, date: string, why: 'stability' | 'board' | 'fans' | 'season', rng: Rng): void {
  const cc = world.coach!;
  const clubId = cc.coach.clubId!;
  const metas = metaMap(data);
  const b = cc.board;
  const name = clubNameOf(state, metas, clubId);
  const fine = resignationFine(cc.coach);
  payClub(world, state, clubId, -fine);
  cc.coach.savings += fine;
  cc.coach.reputationPoints = Math.max(0, Math.round(cc.coach.reputationPoints * 0.9 - COACH.firedPenalty));
  closeItem(cc, date, 'fired');
  const pct = why === 'fans' ? b?.fanConfidence : why === 'board' ? b?.boardConfidence : b?.stability;
  const body = why === 'fans'
    ? `A confiança da Torcida caiu para ${Math.round(pct ?? 0)}%. A diretoria cedeu à pressão popular e encerrou o seu contrato com o pagamento da multa.`
    : why === 'board'
      ? `A confiança da Diretoria caiu para ${Math.round(pct ?? 0)}%. O clube decidiu encerrar o seu contrato e pagará a multa rescisória.`
      : why === 'season'
        ? `Após a avaliação de fim de temporada (estabilidade em ${Math.round(pct ?? 0)}%), o clube decidiu encerrar o seu contrato e pagará a multa rescisória.`
        : `Sua estabilidade caiu para ${Math.round(pct ?? 0)}%. O clube decidiu encerrar o seu contrato e pagará a multa rescisória.`;
  mail(cc, date, `Diretoria do ${name}`, 'Você foi demitido!', `${body}\n\nMulta recebida: ${MONEY(fine)}.`, 'fired', { tone: 'bad', clubId });
  cc.coach.clubId = null;
  cc.coach.contractUntil = null;
  cc.coach.since = null;
  cc.board = null;
  cc.leftClubs[clubId] = date;
  detachHuman(world, state, clubId);
  openVacancy(cc, state, metas, { clubId }, date, 'fired', cc.coach.name, rng);
  logChange(cc, { date, clubId, name, out: cc.coach.name, in: null, reason: why === 'fans' ? 'pressão da torcida' : 'demitido' });
  state?.news.push({ date, text: `O ${name} demitiu o técnico ${cc.coach.name}.`, clubId });
}

function assignHuman(world: WorldState, state: SeasonState, data: CareerData, target: { clubId?: string; nationalTeamId?: number; name: string }, date: string, wage: number, years: number): void {
  const cc = world.coach!;
  const metas = metaMap(data);
  if (target.nationalTeamId !== undefined) {
    cc.coach.nationalTeamId = target.nationalTeamId;
    cc.coach.nationalSince = date;
    cc.coach.history.push({ kind: 'national', nationalTeamId: target.nationalTeamId, name: target.name, from: date, to: null, games: 0, won: 0, drawn: 0, lost: 0, titles: [] });
    cc.vacancies = cc.vacancies.filter((v) => v.nationalTeamId !== target.nationalTeamId);
    logChange(cc, { date, nationalTeamId: target.nationalTeamId, name: target.name, out: null, in: cc.coach.name, reason: 'contratação' });
    mail(cc, date, `Federação — ${target.name}`, `Bem-vindo à ${target.name}`, 'Você assumiu o comando da seleção. (Nesta versão a seleção não disputa jogos: o cargo conta para a reputação e o histórico.)', 'welcome', { tone: 'good', nationalTeamId: target.nationalTeamId });
    return;
  }
  const clubId = target.clubId!;
  const ai = cc.aiCoaches[clubId];
  if (ai) {
    delete cc.aiCoaches[clubId];
    cc.freeCoaches.push({ ...ai, stability: COACH.start, games: 0 });
    if (cc.freeCoaches.length > COACH.freeCap) cc.freeCoaches.splice(0, cc.freeCoaches.length - COACH.freeCap);
  }
  cc.vacancies = cc.vacancies.filter((v) => v.clubId !== clubId);
  cc.pressure = cc.pressure.filter((p) => p.clubId !== clubId);
  cc.coach.clubId = clubId;
  cc.coach.since = date;
  cc.coach.wage = wage;
  cc.coach.contractUntil = clubSeason(state, clubId) + Math.max(1, years) - 1;
  const name = clubNameOf(state, metas, clubId);
  cc.coach.history.push({ kind: 'club', clubId, name, from: date, to: null, games: 0, won: 0, drawn: 0, lost: 0, titles: [] });
  cc.board = newBoard(clubId);
  cc.board.expectation = seasonExpectation(state, clubId, data);
  cc.seasonRecord = { season: clubSeason(state, clubId), games: 0, won: 0, drawn: 0, lost: 0 };
  for (const o of cc.offers) if (o.status === 'pending' && o.clubId === clubId) o.status = 'accepted';
  world.humanClubIds = [clubId];
  state.humanClubIds = [clubId];
  const club = state.clubs[clubId];
  if (club) club.lineup = null;
  logChange(cc, { date, clubId, name, out: ai?.name ?? null, in: cc.coach.name, reason: 'contratação' });
  state.news.push({ date, text: `O ${name} anuncia ${cc.coach.name} como novo técnico.`, clubId });
  mail(cc, date, `Diretoria do ${name}`, `Bem-vindo ao ${name}`,
    'A diretoria lhe deseja sorte. Esperamos muitas vitórias. Nesta janela iremos te comunicar sobre vários assuntos do clube.', 'welcome', { tone: 'good', clubId });
  goalMail(cc, date, name, cc.board.expectation);
}

/* ═════════════════════ ações do jogador ═════════════════════ */

export interface CoachActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  /** novo clube humano (troca de clube) ou null (ficou desempregado) */
  clubChanged?: string | null;
  /** multa paga (+) ou recebida (−) pelo técnico */
  fine?: number;
}

const fail = (error: string): CoachActionResult => ({ ok: false, error });

function blockedReturn(cc: CoachCareer, clubId: string | undefined, date: string): boolean {
  return !!clubId && !!cc.leftClubs[clubId] && daysBetween(cc.leftClubs[clubId], date) < COACH.returnBlockDays;
}

/** Candidatura por e-mail a uma vaga aberta: resposta em 7 dias. */
export function applyForJob(world: WorldState, state: SeasonState, vacancyId: string): CoachActionResult {
  const cc = world.coach;
  if (!cc) return fail('Carreira de técnico desligada.');
  const v = cc.vacancies.find((x) => x.id === vacancyId);
  if (!v) return fail('Esta vaga não está mais aberta.');
  const date = state.date;
  if (v.clubId && v.clubId === cc.coach.clubId) return fail('Você já é o técnico deste time.');
  if (v.nationalTeamId !== undefined && v.nationalTeamId === cc.coach.nationalTeamId) return fail('Você já é o técnico desta seleção.');
  if (blockedReturn(cc, v.clubId, date)) return fail('Você deixou este time há menos de 30 dias.');
  if (cc.applications.some((a) => a.vacancyId === v.id && a.status === 'pending')) return fail('Você já se candidatou a esta vaga. Aguarde a resposta.');
  const answerOn = addDays(date, COACH.applicationDays);
  cc.applications.unshift({ id: nextId(cc, 'a'), vacancyId: v.id, clubId: v.clubId, nationalTeamId: v.nationalTeamId, name: v.name, appliedOn: date, answerOn, status: 'pending' });
  if (cc.applications.length > 40) cc.applications.length = 40;
  if (v.fillOn <= answerOn) v.fillOn = addDays(answerOn, 1);
  mail(cc, date, `Diretor de Futebol — ${v.name}`, `Candidatura Enviada: ${v.name}`,
    'Recebemos seu e-mail de interesse no cargo de Treinador!\n\nVamos analisar os candidatos e enviaremos uma resposta definitiva em breve (7 dias).\n\nAssinado: Diretor de Futebol',
    'application', { clubId: v.clubId, nationalTeamId: v.nationalTeamId, tone: 'neutral', read: true });
  return { ok: true, message: 'Recebemos seu e-mail de interesse no cargo de Treinador! Resposta definitiva em 7 dias.' };
}

/** Dias que faltam para poder declarar interesse de novo (0 = liberado). */
export function interestCooldown(cc: CoachCareer, date: string): number {
  if (!cc.lastInterestOn) return 0;
  return Math.max(0, COACH.interestBlockDays - daysBetween(cc.lastInterestOn, date));
}

/**
 * Declaração pública de interesse num clube que tem técnico (original): bloqueia nova declaração por 6 meses; técnico
 * com estabilidade > 79% não pode ser pressionado; técnico de status muito maior (reputação > a sua + 1) fica; senão a
 * estabilidade dele cai 30–40 pontos e, se ficar abaixo de 43% após o próximo jogo dele, a diretoria o demite e
 * oferece o cargo ao humano. Empregado, o humano perde 8 de confiança da diretoria e 5 da torcida (decisão).
 */
export function declareInterest(world: WorldState, state: SeasonState, clubId: string, data: CareerData): CoachActionResult {
  const cc = world.coach;
  if (!cc) return fail('Carreira de técnico desligada.');
  const date = state.date;
  const metas = metaMap(data);
  if (clubId === cc.coach.clubId) return fail('Você já é o técnico deste time.');
  const wait = interestCooldown(cc, date);
  if (wait > 0) return fail(`Aguarde 6 meses desde o seu último interesse para tentar novamente (faltam ${wait} dias).`);
  if (blockedReturn(cc, clubId, date)) return fail('Você deixou este time há menos de 30 dias.');
  const ai = cc.aiCoaches[clubId];
  if (!ai) return fail(cc.vacancies.some((v) => v.clubId === clubId) ? 'Este clube está sem técnico: candidate-se à vaga.' : 'Clube fora da carreira.');
  if (ai.stability > COACH.shielded) return fail('O técnico está com muita estabilidade (Acima de 79%).');
  cc.lastInterestOn = date;
  const name = clubNameOf(state, metas, clubId);
  if (cc.board) {
    adjust(cc.board, 0, COACH.interestOwnBoard, COACH.interestOwnFans);
    mail(cc, date, 'Diretoria', 'Seu nome ligado a outro clube', `A diretoria não gostou de ver o seu nome ligado ao ${name}.`, 'board', { tone: 'bad', clubId: cc.coach.clubId ?? undefined });
  }
  state.news.push({ date, text: `${cc.coach.name} declara publicamente interesse em treinar o ${name}.`, clubId });
  if (ai.reputation > coachLevel(cc.coach) + COACH.interestStatusGap) {
    mail(cc, date, `Diretoria do ${name}`, 'Interesse Rejeitado', 'A diretoria publicou a seguinte nota:\n\n"Vamos permanecer com o atual treinador."', 'interest', { clubId, tone: 'bad' });
    return { ok: true, message: 'A diretoria publicou a seguinte nota: "Vamos permanecer com o atual treinador."' };
  }
  const rng = new Rng(`${world.seed}:${date}:interest:${clubId}`);
  ai.stability = r1(clamp(ai.stability - COACH.interestHit - rng.int(0, 10), 0, 100));
  cc.pressure = [...cc.pressure.filter((p) => p.clubId !== clubId), { clubId, until: addDays(date, 30) }];
  mail(cc, date, `Diretoria do ${name}`, 'Interesse Recebido',
    'Seu interesse foi recebido e aumentou a pressão sobre o técnico atual!\n\n(A estabilidade dele caiu drasticamente, fique de olho na próxima rodada!)', 'interest', { clubId, tone: 'neutral' });
  return { ok: true, message: 'Seu interesse foi recebido e aumentou a pressão sobre o técnico atual! (A estabilidade dele caiu drasticamente, fique de olho na próxima rodada!)' };
}

/**
 * Aceita uma proposta. Clube, estando empregado: exige `payFine` (o técnico paga 6 salários ao clube atual —
 * "Deseja pagar a multa e assumir o novo time?"). Seleção: cargo paralelo, sem multa.
 */
export function acceptJobOffer(world: WorldState, state: SeasonState, offerId: string, data: CareerData, o: { payFine?: boolean } = {}): CoachActionResult {
  const cc = world.coach;
  if (!cc) return fail('Carreira de técnico desligada.');
  const offer = cc.offers.find((x) => x.id === offerId);
  const date = state.date;
  if (!offer || offer.status !== 'pending') return fail('Esta proposta não está mais disponível.');
  if (offer.expiresAt < date) { offer.status = 'expired'; return fail('A proposta expirou.'); }
  if (offer.nationalTeamId !== undefined) {
    if (cc.coach.nationalTeamId !== null) leaveNational(cc, date);
    offer.status = 'accepted';
    assignHuman(world, state, data, { nationalTeamId: offer.nationalTeamId, name: offer.name }, date, offer.wage, offer.years);
    return { ok: true, message: `Você assumiu a ${offer.name}.` };
  }
  const clubId = offer.clubId!;
  if (blockedReturn(cc, clubId, date)) return fail('Você deixou este time há menos de 30 dias.');
  if (!state.clubs[clubId]) return fail('Clube fora da temporada da carreira.');
  let fine = 0;
  const from = cc.coach.clubId;
  if (from) {
    fine = resignationFine(cc.coach);
    if (!o.payFine) return { ok: false, error: `Deseja pagar a multa e assumir o novo time? Multa de rescisão (6 meses): ${MONEY(fine)}.`, fine };
    const metas = metaMap(data);
    cc.coach.savings -= fine;
    payClub(world, state, from, fine);
    closeItem(cc, date, 'left');
    cc.leftClubs[from] = date;
    const name = clubNameOf(state, metas, from);
    detachHuman(world, state, from);
    cc.coach.clubId = null;
    cc.board = null;
    openVacancy(cc, state, metas, { clubId: from }, date, 'left', cc.coach.name, new Rng(`${world.seed}:${date}:left`));
    state.news.push({ date, text: `${cc.coach.name} paga a multa e deixa o ${name}.`, clubId: from });
  }
  offer.status = 'accepted';
  assignHuman(world, state, data, { clubId, name: offer.name }, date, offer.wage, offer.years);
  return { ok: true, message: `Você é o novo técnico do ${offer.name}!`, clubChanged: clubId, fine };
}

/** Recusa uma proposta. */
export function declineJobOffer(world: WorldState, offerId: string): CoachActionResult {
  const offer = world.coach?.offers.find((x) => x.id === offerId);
  if (!offer || offer.status !== 'pending') return fail('Esta proposta não está mais disponível.');
  offer.status = 'declined';
  return { ok: true, message: 'Proposta recusada.' };
}

function leaveNational(cc: CoachCareer, date: string): void {
  const id = cc.coach.nationalTeamId;
  if (id === null) return;
  for (let i = cc.coach.history.length - 1; i >= 0; i--) {
    const h = cc.coach.history[i];
    if (h.kind === 'national' && h.nationalTeamId === id && h.to === null) { h.to = date; h.exit = 'resigned'; break; }
  }
  cc.coach.nationalTeamId = null;
  cc.coach.nationalSince = null;
}

/**
 * Pede demissão do clube. `mutual` (acordo mútuo, sem multa) só com estabilidade ≤ 43%; senão o técnico paga 6 meses
 * de salário ao clube. Reputação −15 pontos. `national: true` deixa a seleção (sem multa).
 */
export function resignJob(world: WorldState, state: SeasonState, data: CareerData, o: { mutual?: boolean; national?: boolean } = {}): CoachActionResult {
  const cc = world.coach;
  if (!cc) return fail('Carreira de técnico desligada.');
  const date = state.date;
  if (o.national) {
    if (cc.coach.nationalTeamId === null) return fail('Você não treina nenhuma seleção.');
    leaveNational(cc, date);
    return { ok: true, message: 'Você deixou o comando da seleção.' };
  }
  const clubId = cc.coach.clubId;
  if (!clubId || !cc.board) return fail('Você não treina nenhum clube.');
  const metas = metaMap(data);
  const name = clubNameOf(state, metas, clubId);
  let fine = 0;
  if (o.mutual) {
    if (!canMutualAgreement(cc)) return fail(`Acordo mútuo só com estabilidade abaixo de 43% (atual: ${Math.round(cc.board.stability)}%).`);
  } else {
    fine = resignationFine(cc.coach);
    cc.coach.savings -= fine;
    payClub(world, state, clubId, fine);
  }
  cc.coach.reputationPoints = Math.max(0, Math.round(cc.coach.reputationPoints - COACH.resignPenalty));
  closeItem(cc, date, o.mutual ? 'mutual' : 'resigned');
  cc.coach.clubId = null;
  cc.coach.contractUntil = null;
  cc.coach.since = null;
  cc.board = null;
  cc.leftClubs[clubId] = date;
  detachHuman(world, state, clubId);
  openVacancy(cc, state, metas, { clubId }, date, 'resigned', cc.coach.name, new Rng(`${world.seed}:${date}:resign`));
  logChange(cc, { date, clubId, name, out: cc.coach.name, in: null, reason: o.mutual ? 'acordo mútuo' : 'pediu demissão' });
  state.news.push({ date, text: `${cc.coach.name} ${o.mutual ? 'deixa o comando por acordo mútuo' : 'pede demissão'} do ${name}.`, clubId });
  const message = o.mutual ? 'Demissão por acordo mútuo concluída com sucesso!' : `Você pediu demissão e pagou a multa rescisória (${MONEY(fine)}).`;
  mail(cc, date, `Diretoria do ${name}`, o.mutual ? 'Acordo mútuo' : 'Pedido de demissão', message, 'contract', { tone: 'neutral', clubId });
  return { ok: true, message, clubChanged: null, fine };
}

/* ═════════════════════ Central de Empregos (leitura) ═════════════════════ */

export interface JobListing {
  vacancy: JobVacancy;
  reputation: number;
  division: number | null;
  /** 'ok' (pode se candidatar) | 'applied' | 'offer' | 'blocked' (saiu há < 30 dias) | 'current' */
  status: 'ok' | 'applied' | 'offer' | 'blocked' | 'current';
  /** reputação do técnico ≥ exigida? (só uma indicação: a decisão é da diretoria) */
  qualified: boolean;
}

export interface CoachListing {
  clubId: string;
  name: string;
  coach: AiCoach;
  reputation: number;
  division: number | null;
  band: ReturnType<typeof stabilityBand>;
  /** pode declarar interesse (estabilidade ≤ 79, sem bloqueio) */
  canDeclare: boolean;
  pressured: boolean;
}

/** Dados da Central de Empregos: vagas (clubes e seleções) e técnicos da CPU (para declarar interesse). */
export function jobCenter(world: WorldState, state: SeasonState, data: CareerData, o: { limit?: number } = {}): { vacancies: JobListing[]; coaches: CoachListing[]; cooldown: number } {
  const cc = world.coach;
  if (!cc) return { vacancies: [], coaches: [], cooldown: 0 };
  const metas = metaMap(data);
  const nats = new Map(nationalTeams(data).map((t) => [t.id, t]));
  const level = coachLevel(cc.coach);
  const date = state.date;
  const vacancies = cc.vacancies.map((v): JobListing => {
    const rep = v.clubId ? clubRep(state, metas, v.clubId) : nats.get(v.nationalTeamId!)?.reputation ?? 3;
    const applied = cc.applications.some((a) => a.vacancyId === v.id && a.status === 'pending');
    const offer = cc.offers.some((x) => x.status === 'pending' && ((v.clubId && x.clubId === v.clubId) || (v.nationalTeamId !== undefined && x.nationalTeamId === v.nationalTeamId)));
    const status = (v.clubId && v.clubId === cc.coach.clubId) || (v.nationalTeamId !== undefined && v.nationalTeamId === cc.coach.nationalTeamId)
      ? 'current' : offer ? 'offer' : applied ? 'applied' : blockedReturn(cc, v.clubId, date) ? 'blocked' : 'ok';
    return { vacancy: v, reputation: rep, division: v.clubId ? state.clubInfo?.[v.clubId]?.division ?? null : null, status, qualified: level + COACH.repSlack >= rep };
  }).sort((a, b) => b.reputation - a.reputation || a.vacancy.name.localeCompare(b.vacancy.name));
  const cooldown = interestCooldown(cc, date);
  const coaches = Object.entries(cc.aiCoaches).map(([clubId, ai]): CoachListing => ({
    clubId, name: clubNameOf(state, metas, clubId), coach: ai, reputation: clubRep(state, metas, clubId),
    division: state.clubInfo?.[clubId]?.division ?? null, band: stabilityBand(ai.stability),
    canDeclare: cooldown === 0 && ai.stability <= COACH.shielded && !blockedReturn(cc, clubId, date),
    pressured: cc.pressure.some((p) => p.clubId === clubId && p.until >= date),
  })).sort((a, b) => b.reputation - a.reputation || (a.division ?? 9) - (b.division ?? 9) || a.coach.stability - b.coach.stability || a.name.localeCompare(b.name));
  return { vacancies, coaches: o.limit ? coaches.slice(0, o.limit) : coaches, cooldown };
}

/* ═════════════════════ virada ═════════════════════ */

/**
 * Fim de temporada (chamado por `rolloverSeason` antes de `world.season` avançar). Reputação: −15% (spec §6.3);
 * seleção +40 × rep/5 por ano. Clube humano: acesso +20, rebaixamento −40 (spec §6.4), meta cumprida ±; avaliação
 * final — demitido se rebaixado, se a estabilidade < 20 ou se ficou 4+ posições abaixo da meta com estabilidade < 43.
 * Contrato vencendo: renovado (1 ano) com estabilidade ≥ 43, senão não é renovado. CPU: rebaixado ⇒ técnico demitido.
 */
export function coachSeasonEnd(world: WorldState, state: SeasonState, data: CareerData, summary: SeasonSummary): void {
  const cc = world.coach;
  if (!cc) return;
  const date = state.date;
  // (Etapa 1) temporada do ciclo que virou (Europa 2026/27 → 2026)
  const season = summary.season;
  const label = summary.seasonLabel ?? String(season);
  const metas = metaMap(data);
  const rng = new Rng(`${world.seed}:${summary.date ?? season}:coach-end`);
  const relegated = new Set(Object.values(summary.relegated).flat());
  const promoted = new Set(Object.values(summary.promoted).flat());
  cc.coach.reputationPoints = Math.round(cc.coach.reputationPoints * (1 - COACH.decay));
  if (cc.coach.nationalTeamId !== null) {
    const t = nationalTeams(data).find((x) => x.id === cc.coach.nationalTeamId);
    cc.coach.reputationPoints += Math.round(40 * (t?.reputation ?? 3) / 5);
  }
  // CPU
  for (const id of Object.keys(cc.aiCoaches).sort()) {
    const ai = cc.aiCoaches[id];
    if (relegated.has(id)) fireAiCoach(cc, state, metas, id, date, rng, 'relegation');
    else if (promoted.has(id)) ai.stability = r1(clamp(ai.stability + COACH.promotion, 0, 100));
    else if (summary.champions.some((c) => c.championId === id)) ai.stability = r1(clamp(ai.stability + COACH.title, 0, 100));
  }
  const clubId = cc.coach.clubId;
  const b = cc.board;
  if (!clubId || !b) return;
  const name = clubNameOf(state, metas, clubId);
  const e = b.expectation;
  const pos = e ? currentPosition(state, clubId, e.competitionId) : null;
  let missed = 0;
  if (relegated.has(clubId)) adjust(b, COACH.relegation, -30, -25);
  else if (promoted.has(clubId)) {
    adjust(b, COACH.promotion, 20, 20);
    cc.coach.reputationPoints += 20;
  }
  if (e && pos) {
    missed = pos - e.targetPos;
    if (missed <= 0) adjust(b, 6, 10, 5);
    else adjust(b, -Math.min(15, 2 * missed), -Math.min(20, 3 * missed), -Math.min(10, missed));
  }
  const rec = cc.seasonRecord;
  const fire = relegated.has(clubId) || b.stability < COACH.fireStability || (missed >= 4 && b.stability < COACH.danger);
  if (fire) {
    fireHuman(world, null, data, date, 'season', rng);
    return;
  }
  const verdict = e && pos ? `${pos}º lugar no ${e.competitionName} (meta: ${e.targetPos}º)` : 'temporada encerrada';
  mail(cc, date, 'Diretoria', `Balanço da temporada ${label}`,
    `${verdict}. Campanha: ${rec.won}V ${rec.drawn}E ${rec.lost}D. Estabilidade: ${Math.round(b.stability)}%.`, 'board', { tone: missed > 0 ? 'bad' : 'good', clubId });
  if (cc.coach.contractUntil !== null && cc.coach.contractUntil <= season) {
    if (b.stability >= COACH.danger) {
      const rep = metas.get(clubId)?.reputation ?? 0;
      cc.coach.contractUntil = season + 1;
      cc.coach.wage = Math.max(cc.coach.wage, coachWage(rep, metas.get(clubId)?.revenue));
      mail(cc, date, 'Diretoria', 'Contrato renovado', `A diretoria do ${name} renovou o seu contrato por 1 ano (até ${season + 1}).`, 'contract', { tone: 'good', clubId });
    } else {
      closeItem(cc, date, 'contract-end');
      mail(cc, date, 'Diretoria', 'Contrato encerrado', `A diretoria do ${name} optou por não renovar o seu contrato (estabilidade em ${Math.round(b.stability)}%).`, 'contract', { tone: 'bad', clubId });
      cc.coach.clubId = null;
      cc.coach.contractUntil = null;
      cc.coach.since = null;
      cc.board = null;
      cc.leftClubs[clubId] = date;
      detachHuman(world, null, clubId);
      openVacancy(cc, state, metas, { clubId }, date, 'left', cc.coach.name, rng);
      return;
    }
  }
  b.turnoDone = false;
  b.expectation = null;
}
