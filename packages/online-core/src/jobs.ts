/**
 * Carreira online â€” Central de Empregos e demissÃµes (modelo LEVE, no simulador da sala).
 *
 * A carreira do tÃ©cnico da engine (`season/coach.ts`, `world.coach`) Ã© de UM tÃ©cnico (solo). Online hÃ¡ atÃ© 6 tÃ©cnicos
 * humanos na mesma carreira, que podem ficar sem clube (entrada tardia ou demissÃ£o). Este mÃ³dulo Ã© o equivalente
 * multi-tÃ©cnico, reaproveitando da engine as regras e fÃ³rmulas (COACH: vitÃ³ria/derrota, nÃ­vel = pontos/400, salÃ¡rio,
 * reputaÃ§Ã£o mÃ­nima por clube; `seasonExpectation`/`currentPosition` para a meta da diretoria):
 *
 *  - TÃ‰CNICOS HUMANOS (por playerId da sala): reputaÃ§Ã£o (pontos, 0..2000 â‡’ nÃ­vel 0..5), clube, confianÃ§a da diretoria
 *    (0..100), meta da temporada, histÃ³rico de passagens.
 *  - DIRETORIA do humano empregado: vitÃ³ria +2,5, empate 0 (fora +0,5), derrota âˆ’3,5, eliminaÃ§Ã£o âˆ’6; avaliaÃ§Ã£o no meio
 *    da competiÃ§Ã£o principal (posiÃ§Ã£o Ã— meta, Â±2 por posiÃ§Ã£o); toda segunda volta 2% em direÃ§Ã£o a 55.
 *    DemissÃ£o (se `firing`): confianÃ§a < 20 depois de 8 jogos no clube â‡’ clube volta Ã  IA, vaga aberta, tÃ©cnico
 *    desempregado (âˆ’10% âˆ’ 40 pontos de reputaÃ§Ã£o).
 *  - TÃ‰CNICOS DA IA (sem estado por clube, barato): toda segunda, para cada liga nacional com â‰¥ 25% dos jogos feitos,
 *    compara a posiÃ§Ã£o com a forÃ§a esperada (reputaÃ§Ã£o/nÃ­vel do clube); quanto pior, maior a chance de demissÃ£o.
 *    Limite: 2 demissÃµes por semana no mundo (3 se hÃ¡ humano desempregado e poucas vagas). Clube que trocou de tÃ©cnico hÃ¡
 *    menos de 90 dias nÃ£o demite. Resultado tÃ­pico: 4â€“8 vagas por mÃªs no mundo todo.
 *  - VAGAS: abertas por demissÃ£o (IA ou humano), saÃ­da (o tÃ©cnico da IA foi para outro clube â€” 25% das contrataÃ§Ãµes da
 *    IA "roubam" o tÃ©cnico de um clube menor, que abre vaga) ou humano que trocou de clube. A IA preenche em 10â€“20 dias
 *    se nenhum humano tiver proposta/candidatura pendente.
 *  - PROPOSTAS para desempregados: a cada dia, cada desempregado sem proposta nos Ãºltimos 3 dias tem 50% de receber uma
 *    proposta de uma vaga compatÃ­vel (reputaÃ§Ã£o do clube â‰¤ nÃ­vel + 0,5; Ã s vezes, 12%, um clube maior atÃ© nÃ­vel + 1,5).
 *    Valem 7 dias. Sem vaga compatÃ­vel e com um desempregado esperando, abre-se uma vaga "inicial" num clube compatÃ­vel.
 *  - CANDIDATURA: resposta em 5 dias; aprovaÃ§Ã£o com a fÃ³rmula do solo (0,5 + (nÃ­vel + 0,5 âˆ’ rep. do clube) Ã— 0,6).
 *  - ACEITAR: o clube sai da IA e vira humano NA HORA (a sala troca o dono; vale a partir da prÃ³xima rodada).
 *
 * DeterminÃ­stico (seed da carreira + data). O estado (`OnlineJobs`) Ã© pequeno (< 20 KB) e vai no meta para a sala
 * persistir no snapshot.
 */
import {
  COACH, Rng, addDays, clubSeason, computeStandings, currentPosition, requiredReputation, seasonExpectation,
  type CareerData, type Fixture, type MatchResult, type SeasonState, type WorldState,
} from '@cosmicfut/engine';
import type { Player } from '@cosmicfut/shared';
import type { JobApplicationInfo, JobOfferInfo, JobsPayload, JobVacancyInfo, ManagerCareerInfo } from '@cosmicfut/shared';

export const JOBS = {
  /** reputaÃ§Ã£o (pontos) de quem entra depois do inÃ­cio: nÃ­vel 1,5 (rep. 30, "Promissor") */
  newcomerPoints: 600,
  boardStart: 60,
  fireBoard: 20,
  fireMinGames: 8,
  win: 2.5, drawAway: 0.5, loss: -3.5, cupOut: -6,
  offerDays: 7,
  applicationDays: 5,
  offerCooldownDays: 3,
  offerChance: 0.5,
  bigOfferChance: 0.12,
  maxPendingOffers: 2,
  aiFirePerWeek: 2,
  aiFirePerWeekNeedy: 3,
  aiHireCooldownDays: 90,
  poachChance: 0.25,
  vacancyMinDays: 10,
  vacancyMaxDays: 20,
  changesCap: 40,
  offersCap: 60,
  initialVacancies: 3,
} as const;

export interface JobManager {
  id: string;
  name: string;
  clubId: string | null;
  points: number;
  board: { confidence: number; games: number; season: number; goal: string | null; compId: string | null; targetPos: number | null; reviewed: boolean } | null;
  history: ManagerCareerInfo['history'];
  /** clubId â†’ data de saÃ­da (nÃ£o volta antes de 30 dias) */
  left: Record<string, string>;
  lastOfferOn: string | null;
}

export interface JobVacancy extends JobVacancyInfo {
  fillOn: string;
}

export interface JobOffer extends JobOfferInfo {
  managerId: string;
}

export interface JobApplication extends JobApplicationInfo {
  managerId: string;
}

export type JobEvent =
  | { type: 'fired'; managerId: string; clubId: string; date: string }
  | { type: 'hired'; managerId: string; clubId: string; date: string }
  | { type: 'offer'; managerId: string; clubId: string; date: string }
  | { type: 'answer'; managerId: string; clubId: string; approved: boolean; date: string };

export interface OnlineJobs {
  v: 1;
  seq: number;
  firing: boolean;
  managers: Record<string, JobManager>;
  vacancies: JobVacancy[];
  offers: JobOffer[];
  applications: JobApplication[];
  changes: JobsPayload['changes'];
  /** clubId â†’ data da Ãºltima troca de tÃ©cnico (carÃªncia para demitir de novo) */
  hiredOn: Record<string, string>;
  lastDay: string | null;
  /** eventos ainda nÃ£o entregues Ã  sala */
  events: JobEvent[];
}

export const emptyJobs = (): OnlineJobs => ({
  v: 1, seq: 0, firing: true, managers: {}, vacancies: [], offers: [], applications: [], changes: [], hiredOn: {}, lastDay: null, events: [],
});

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const daysBetween = (a: string, b: string) => dayIndex(b) - dayIndex(a);
export const levelOf = (points: number) => clamp(points / COACH.pointsPerLevel, 0, 5);
export const repOf = (points: number) => Math.round(levelOf(points) * 20);

const GIVEN = ['Carlos', 'Paulo', 'Roberto', 'Marcelo', 'AntÃ´nio', 'Fernando', 'Luiz', 'Ricardo', 'SÃ©rgio', 'Jorge', 'Eduardo', 'Renato', 'HÃ©lio', 'Abel', 'Juan', 'Mano', 'Lisca', 'Dado', 'Diego', 'Marco', 'Luca', 'Javier', 'Pep', 'Thomas'];
const SURNAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Ferreira', 'Moraes', 'Ribeiro', 'Mendes', 'Lopes', 'Gomes', 'Andrade', 'Rocha', 'Ramos', 'Sampaio', 'Castro', 'Pires', 'Lima', 'GarcÃ­a', 'Rossi', 'MÃ¼ller', 'MartÃ­nez', 'Costa'];
const aiName = (rng: Rng) => `${rng.pick(GIVEN)} ${rng.pick(SURNAMES)}`;

export interface JobsCtx {
  data: CareerData;
  /** elencos efetivos (meta pela forÃ§a real) */
  squads?: (clubId: string) => Player[];
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ leituras â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function clubName(s: SeasonState, data: CareerData, id: string): string {
  return s.clubInfo?.[id]?.name ?? data.clubs.find((c) => c.id === id)?.name ?? id;
}

function clubRep(s: SeasonState, data: CareerData, id: string): number {
  return s.clubInfo?.[id]?.reputation ?? data.clubs.find((c) => c.id === id)?.reputation ?? 1;
}

/** Liga nacional (pontos corridos, nÃ£o estrangeira) do clube. */
function leagueOf(s: SeasonState, id: string) {
  return s.competitions.find((c) => c.type === 'league' && c.clubIds.includes(id) && !s.clubInfo?.[id]?.foreign);
}

/** Clube elegÃ­vel a ter vaga: estÃ¡ numa liga nacional e nÃ£o Ã© de humano. */
function eligible(s: SeasonState, id: string): boolean {
  return !s.humanClubIds.includes(id) && !!s.clubs[id] && !!leagueOf(s, id);
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ registro â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** Registra um tÃ©cnico (inÃ­cio da carreira: com clube; entrada tardia: sem clube). Idempotente. */
export function registerManager(j: OnlineJobs, s: SeasonState, data: CareerData, m: { id: string; name: string; clubId: string | null }, ctx: JobsCtx): void {
  const cur = j.managers[m.id];
  if (cur) {
    cur.name = m.name;
    return;
  }
  const rep = m.clubId ? clubRep(s, data, m.clubId) : 0;
  const mgr: JobManager = {
    id: m.id, name: m.name, clubId: m.clubId,
    points: m.clubId ? Math.round(COACH.pointsPerLevel * Math.max(0, rep - COACH.repSlack)) : JOBS.newcomerPoints,
    board: null, history: [], left: {}, lastOfferOn: null,
  };
  j.managers[m.id] = mgr;
  if (m.clubId) {
    mgr.history.push({ clubId: m.clubId, name: clubName(s, data, m.clubId), from: s.date, to: null, games: 0, won: 0, drawn: 0, lost: 0 });
    mgr.board = newBoard(s, m.clubId, ctx);
  } else {
    ensureVacanciesFor(j, s, data, mgr, s.date);
  }
}

export function renameManager(j: OnlineJobs, id: string, name: string): void {
  if (j.managers[id]) j.managers[id].name = name;
}

function newBoard(s: SeasonState, clubId: string, ctx: JobsCtx): JobManager['board'] {
  let goal: string | null = null;
  let compId: string | null = null;
  let targetPos: number | null = null;
  try {
    const e = seasonExpectation(s, clubId, ctx.data, ctx.squads);
    goal = `${e.label} (atÃ© ${e.targetPos}Âº no ${e.competitionName})`;
    compId = e.competitionId;
    targetPos = e.targetPos;
  } catch {
    /* sem competiÃ§Ã£o principal */
  }
  return { confidence: JOBS.boardStart, games: 0, season: clubSeason(s, clubId), goal, compId, targetPos, reviewed: false };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ vagas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function openVacancy(j: OnlineJobs, s: SeasonState, data: CareerData, clubId: string, date: string, reason: JobVacancy['reason'], previousCoach: string | null, rng: Rng): JobVacancy {
  const ex = j.vacancies.find((v) => v.clubId === clubId);
  if (ex) return ex;
  const rep = clubRep(s, data, clubId);
  const v: JobVacancy = {
    id: `v${++j.seq}`, clubId, name: clubName(s, data, clubId), reputation: rep, division: s.clubInfo?.[clubId]?.division ?? leagueOf(s, clubId)?.division ?? null,
    minReputation: requiredReputation(rep), openedOn: date, reason, previousCoach, fillOn: addDays(date, rng.int(JOBS.vacancyMinDays, JOBS.vacancyMaxDays)),
  };
  j.vacancies.push(v);
  j.hiredOn[clubId] = date;
  return v;
}

function logChange(j: OnlineJobs, c: JobsPayload['changes'][number]): void {
  j.changes.unshift(c);
  if (j.changes.length > JOBS.changesCap) j.changes.length = JOBS.changesCap;
}

/** Abre vagas iniciais (inÃ­cio da carreira / desempregado sem vaga compatÃ­vel). */
function ensureVacanciesFor(j: OnlineJobs, s: SeasonState, data: CareerData, mgr: JobManager, date: string): void {
  const level = levelOf(mgr.points);
  const fits = j.vacancies.filter((v) => v.reputation <= level + COACH.repSlack);
  if (fits.length >= 2) return;
  const rng = new Rng(`${s.seed ?? 'jobs'}:${date}:init:${mgr.id}`);
  const pool = Object.keys(s.clubs).filter((id) => eligible(s, id) && !j.vacancies.some((v) => v.clubId === id) && clubRep(s, data, id) <= level + COACH.repSlack).sort();
  for (let i = fits.length; i < 2 && pool.length; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const prev = aiName(rng);
    openVacancy(j, s, data, id, date, 'initial', prev, rng);
    logChange(j, { date, clubId: id, name: clubName(s, data, id), out: prev, in: null, reason: 'saiu do clube' });
  }
}

/** Vagas iniciais da carreira (como no solo: 3 clubes sem tÃ©cnico na prÃ©-temporada). */
export function seedVacancies(j: OnlineJobs, s: SeasonState, data: CareerData): void {
  if (j.vacancies.length) return;
  const rng = new Rng(`${s.seed ?? 'jobs'}:seed`);
  const pool = Object.keys(s.clubs).filter((id) => eligible(s, id) && clubRep(s, data, id) <= 3).sort();
  for (let i = 0; i < JOBS.initialVacancies && pool.length; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const prev = aiName(rng);
    openVacancy(j, s, data, id, s.date, 'initial', prev, rng);
    logChange(j, { date: s.date, clubId: id, name: clubName(s, data, id), out: prev, in: null, reason: 'saiu do clube' });
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ clube humano â†” IA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** O clube volta para a IA (demissÃ£o/saÃ­da do humano): mesmo efeito do `detachHuman` da engine. */
export function detachClub(world: WorldState, s: SeasonState, clubId: string): void {
  world.humanClubIds = world.humanClubIds.filter((x) => x !== clubId);
  s.humanClubIds = s.humanClubIds.filter((x) => x !== clubId);
  const club = s.clubs[clubId];
  if (club) club.lineup = null;
  for (const o of s.market?.offers ?? []) {
    if (o.toClubId === clubId && (o.status === 'negotiating' || o.status === 'agreed' || o.status === 'pending')) o.status = 'withdrawn';
    if (o.fromClubId === clubId && o.status === 'pending' && s.humanClubIds.includes(o.toClubId)) o.status = 'expired';
  }
}

/** O clube sai da IA e passa ao humano. */
export function attachClub(world: WorldState, s: SeasonState, clubId: string): void {
  if (!world.humanClubIds.includes(clubId)) world.humanClubIds.push(clubId);
  if (!s.humanClubIds.includes(clubId)) s.humanClubIds.push(clubId);
  const club = s.clubs[clubId];
  if (club) club.lineup = null;
}

function closeTenure(m: JobManager, date: string, exit: 'fired' | 'left'): void {
  const h = m.history.findLast((x) => x.to === null);
  if (h) {
    h.to = date;
    h.exit = exit;
  }
}

/** Demite o tÃ©cnico humano (diretoria). */
export function fireManager(j: OnlineJobs, world: WorldState, s: SeasonState, data: CareerData, m: JobManager, date: string, rng: Rng): void {
  const clubId = m.clubId;
  if (!clubId) return;
  const name = clubName(s, data, clubId);
  const pct = Math.round(m.board?.confidence ?? 0);
  m.points = Math.max(0, Math.round(m.points * 0.9 - COACH.firedPenalty));
  closeTenure(m, date, 'fired');
  m.left[clubId] = date;
  m.clubId = null;
  m.board = null;
  detachClub(world, s, clubId);
  openVacancy(j, s, data, clubId, date, 'fired', m.name, rng);
  logChange(j, { date, clubId, name, out: m.name, in: null, reason: `demitido (diretoria ${pct}%)` });
  s.news.push({ date, text: `O ${name} demitiu o tÃ©cnico ${m.name} (confianÃ§a da diretoria em ${pct}%).`, clubId });
  j.events.push({ type: 'fired', managerId: m.id, clubId, date });
}

/** O humano sai do clube sem ser demitido (expulso da sala / trocou de clube). */
export function releaseManager(j: OnlineJobs, world: WorldState, s: SeasonState, data: CareerData, managerId: string, date: string): string | null {
  const m = j.managers[managerId];
  if (!m?.clubId) return null;
  const clubId = m.clubId;
  closeTenure(m, date, 'left');
  m.left[clubId] = date;
  m.clubId = null;
  m.board = null;
  detachClub(world, s, clubId);
  const rng = new Rng(`${s.seed ?? 'jobs'}:${date}:release:${clubId}`);
  openVacancy(j, s, data, clubId, date, 'human-left', m.name, rng);
  logChange(j, { date, clubId, name: clubName(s, data, clubId), out: m.name, in: null, reason: 'deixou o clube' });
  return clubId;
}

/** Remove o tÃ©cnico do modelo (expulso). */
export function removeManager(j: OnlineJobs, id: string): void {
  delete j.managers[id];
  for (const o of j.offers) if (o.managerId === id && o.status === 'pending') o.status = 'declined';
  for (const a of j.applications) if (a.managerId === id && a.status === 'pending') a.status = 'rejected';
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ dia a dia â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function outcome(f: Fixture, r: MatchResult, clubId: string): 'W' | 'D' | 'L' {
  const home = f.homeId === clubId;
  const gf = home ? r.homeGoals : r.awayGoals;
  const ga = home ? r.awayGoals : r.homeGoals;
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
}

function compFactor(s: SeasonState, compId: string): number {
  const c = s.competitions.find((x) => x.id === compId);
  if (!c) return 0.5;
  if (c.type === 'continental') return 1.5;
  if (c.type === 'state') return 0.3;
  if (c.type === 'cup' || c.type === 'supercup') return 1;
  return ({ 1: 1, 2: 0.6, 3: 0.4 } as Record<number, number>)[c.division ?? 1] ?? 0.25;
}

/** Eliminado neste jogo (mata-mata decidido contra o clube)? */
function eliminated(s: SeasonState, f: Fixture, clubId: string): boolean {
  if (!f.knockout || !f.tieId) return false;
  const c = s.competitions.find((x) => x.id === f.competitionId);
  for (const st of Object.values(c?.stages ?? {})) {
    const t = (st as { ties?: { id: string; loser?: string }[] }).ties?.find((x) => x.id === f.tieId);
    if (t) return t.loser === clubId;
  }
  return false;
}

/**
 * Processa o dia jÃ¡ simulado (chamar DEPOIS de `advanceDay`, com o `played` do dia). Muta `j`, `world` e `s`
 * (demissÃ£o de humano). Devolve true se algum humano mudou de situaÃ§Ã£o (a rodada deve parar).
 */
export function jobsDay(j: OnlineJobs, world: WorldState, s: SeasonState, played: { fixture: Fixture; result: MatchResult }[], ctx: JobsCtx): boolean {
  const day = addDays(s.date, -1);
  if (j.lastDay && j.lastDay >= day) return false;
  j.lastDay = day;
  const data = ctx.data;
  const rng = new Rng(`${s.seed ?? 'jobs'}:${day}:jobs`);
  let changed = false;
  const managers = Object.values(j.managers).sort((a, b) => (a.id < b.id ? -1 : 1));

  // 1) humanos empregados: resultados, meta e demissÃ£o
  for (const m of managers) {
    if (!m.clubId) continue;
    const clubId = m.clubId;
    if (!m.board || m.board.season !== clubSeason(s, clubId)) {
      const prevConf = m.board?.confidence ?? JOBS.boardStart;
      m.board = newBoard(s, clubId, ctx);
      // temporada nova: a confianÃ§a volta para perto do inÃ­cio (meio caminho)
      if (m.board) m.board.confidence = r1((prevConf + JOBS.boardStart) / 2);
    }
    const b = m.board!;
    const h = m.history.findLast((x) => x.to === null && x.clubId === clubId);
    let playedToday = false;
    for (const { fixture: f, result } of played) {
      if (f.homeId !== clubId && f.awayId !== clubId) continue;
      playedToday = true;
      const o = outcome(f, result, clubId);
      let d = o === 'W' ? JOBS.win : o === 'L' ? JOBS.loss : f.homeId === clubId ? 0 : JOBS.drawAway;
      if (eliminated(s, f, clubId)) d += JOBS.cupOut;
      b.confidence = r1(clamp(b.confidence + d, 0, 100));
      b.games++;
      if (h) {
        h.games++;
        if (o === 'W') h.won++;
        else if (o === 'D') h.drawn++;
        else h.lost++;
      }
      m.points = r1(m.points + (o === 'W' ? COACH.repWin : o === 'D' ? COACH.repDraw : 0) * compFactor(s, f.competitionId));
    }
    // tÃ­tulos de hoje: reputaÃ§Ã£o
    for (const c of s.competitions) {
      if (c.finished && c.championId === clubId && c.fixtures.some((f) => f.date === day)) {
        m.points = Math.round(m.points + Math.max(COACH.titleFloor, 25));
        b.confidence = r1(clamp(b.confidence + 15, 0, 100));
      }
    }
    // avaliaÃ§Ã£o no meio da competiÃ§Ã£o principal
    if (playedToday && !b.reviewed && b.compId && b.targetPos) {
      const comp = s.competitions.find((c) => c.id === b.compId);
      const mine = comp?.fixtures.filter((f) => f.homeId === clubId || f.awayId === clubId) ?? [];
      if (mine.length >= 4 && mine.filter((f) => f.result).length >= Math.ceil(mine.length / 2)) {
        b.reviewed = true;
        const pos = currentPosition(s, clubId, b.compId);
        if (pos) b.confidence = r1(clamp(b.confidence + (pos > b.targetPos ? -Math.min(16, 2 * (pos - b.targetPos)) : Math.min(8, b.targetPos - pos + 2)), 0, 100));
      }
    }
    if (j.firing && playedToday && b.games >= JOBS.fireMinGames && b.confidence < JOBS.fireBoard) {
      fireManager(j, world, s, data, m, day, rng);
      changed = true;
    }
  }

  // 2) semanal (segunda-feira): diretoria volta para 55; a IA demite
  const weekly = new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
  if (weekly) {
    for (const m of managers) if (m.board) m.board.confidence = r1(clamp(m.board.confidence + (55 - m.board.confidence) * 0.02, 0, 100));
    aiFirings(j, s, data, day, rng);
  }

  // 3) candidaturas respondidas
  for (const a of j.applications) {
    if (a.status !== 'pending' || a.answerOn > s.date) continue;
    const m = j.managers[a.managerId];
    const v = j.vacancies.find((x) => x.id === a.vacancyId);
    const rep = clubRep(s, data, a.clubId);
    const p = m ? clamp(0.5 + (levelOf(m.points) + COACH.repSlack - rep) * 0.6, 0.05, 0.95) : 0;
    const ok = !!m && !m.clubId && !!v && rng.chance(p);
    a.status = ok ? 'approved' : 'rejected';
    if (m) j.events.push({ type: 'answer', managerId: m.id, clubId: a.clubId, approved: ok, date: s.date });
    if (ok && m && v) {
      const o = makeOffer(j, s, data, m, v, 'application', s.date, ctx);
      v.fillOn = addDays(o.expiresAt, 1);
    } else if (v) v.fillOn = s.date;
    changed = true;
  }

  // 4) propostas para os desempregados
  for (const m of managers) {
    if (m.clubId) continue;
    ensureVacanciesFor(j, s, data, m, day);
    if (m.lastOfferOn && daysBetween(m.lastOfferOn, s.date) < JOBS.offerCooldownDays) continue;
    const pending = j.offers.filter((o) => o.managerId === m.id && o.status === 'pending');
    if (pending.length >= JOBS.maxPendingOffers) continue;
    if (!rng.chance(JOBS.offerChance)) continue;
    const level = levelOf(m.points);
    const blocked = (id: string) => !!m.left[id] && daysBetween(m.left[id], s.date) < COACH.returnBlockDays;
    const offered = new Set(j.offers.filter((o) => o.managerId === m.id && o.status === 'pending').map((o) => o.clubId));
    const open = j.vacancies.filter((v) => !blocked(v.clubId) && !offered.has(v.clubId) && !s.humanClubIds.includes(v.clubId));
    const big = rng.chance(JOBS.bigOfferChance);
    const fit = open.filter((v) => v.reputation <= level + (big ? 1.5 : COACH.repSlack)).sort((a, b) => b.reputation - a.reputation || (a.clubId < b.clubId ? -1 : 1));
    if (!fit.length) continue;
    // a maior que aceita o tÃ©cnico (Ã s vezes a 2Âª/3Âª)
    const v = fit[Math.min(fit.length - 1, rng.int(0, Math.min(2, fit.length - 1)))];
    const o = makeOffer(j, s, data, m, v, 'invite', s.date, ctx);
    if (v.fillOn <= o.expiresAt) v.fillOn = addDays(o.expiresAt, 1);
    changed = true;
  }

  // 5) propostas vencidas
  for (const o of j.offers) if (o.status === 'pending' && o.expiresAt < s.date) o.status = 'expired';
  if (j.offers.length > JOBS.offersCap) j.offers = j.offers.filter((o, i) => o.status === 'pending' || i < JOBS.offersCap);
  if (j.applications.length > JOBS.offersCap) j.applications = j.applications.filter((a, i) => a.status === 'pending' || i < JOBS.offersCap);

  // 6) a IA preenche as vagas vencidas (sem proposta/candidatura humana pendente)
  for (const v of j.vacancies.slice()) {
    if (v.fillOn > s.date) continue;
    const busy = j.offers.some((o) => o.status === 'pending' && o.clubId === v.clubId) || j.applications.some((a) => a.status === 'pending' && a.vacancyId === v.id);
    if (busy) continue;
    fillByAi(j, s, data, v, s.date, rng);
  }
  return changed;
}

/** DemissÃµes semanais da IA: posiÃ§Ã£o Ã— forÃ§a esperada na liga nacional. */
function aiFirings(j: OnlineJobs, s: SeasonState, data: CareerData, day: string, rng: Rng): void {
  const needy = Object.values(j.managers).some((m) => !m.clubId) && j.vacancies.length < 3;
  const cap = needy ? JOBS.aiFirePerWeekNeedy : JOBS.aiFirePerWeek;
  const cands: { id: string; p: number }[] = [];
  for (const comp of s.competitions) {
    if (comp.type !== 'league' || comp.clubIds.length < 6) continue;
    if (comp.clubIds.some((id) => s.clubInfo?.[id]?.foreign)) continue;
    const total = comp.fixtures.length;
    const done = comp.fixtures.filter((f) => f.result).length;
    if (!total || done < total * 0.25 || comp.finished) continue;
    let rows;
    try {
      rows = computeStandings(comp);
    } catch {
      continue;
    }
    const expected = comp.clubIds.slice().sort((a, b) => clubRep(s, data, b) - clubRep(s, data, a) || (a < b ? -1 : 1));
    const n = comp.clubIds.length;
    rows.forEach((r, i) => {
      const id = r.clubId;
      if (s.humanClubIds.includes(id) || j.vacancies.some((v) => v.clubId === id)) return;
      if (j.hiredOn[id] && daysBetween(j.hiredOn[id], day) < JOBS.aiHireCooldownDays) return;
      const d = (i - expected.indexOf(id)) / n;
      if (d <= 0.2) return;
      cands.push({ id, p: Math.min(0.35, (d - 0.2) * (needy ? 2.4 : 1.2)) });
    });
  }
  cands.sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
  let fired = 0;
  for (const c of cands) {
    if (fired >= cap) break;
    if (!rng.chance(c.p)) continue;
    fired++;
    const prev = aiName(rng);
    const name = clubName(s, data, c.id);
    openVacancy(j, s, data, c.id, day, 'fired', prev, rng);
    logChange(j, { date: day, clubId: c.id, name, out: prev, in: null, reason: 'demitido (maus resultados)' });
    s.news.push({ date: day, text: `O ${name} demitiu o tÃ©cnico ${prev} apÃ³s maus resultados.`, clubId: c.id });
  }
}

/** A IA contrata para a vaga; Ã s vezes tira o tÃ©cnico de um clube menor (que abre vaga). */
function fillByAi(j: OnlineJobs, s: SeasonState, data: CareerData, v: JobVacancy, date: string, rng: Rng): void {
  j.vacancies = j.vacancies.filter((x) => x.id !== v.id);
  for (const a of j.applications) if (a.vacancyId === v.id && a.status === 'pending') a.status = 'rejected';
  if (s.humanClubIds.includes(v.clubId)) return;
  let hired = aiName(rng);
  let from: string | null = null;
  if (rng.chance(JOBS.poachChance)) {
    const pool = Object.keys(s.clubs).filter((id) => eligible(s, id) && id !== v.clubId && !j.vacancies.some((x) => x.clubId === id) && clubRep(s, data, id) < v.reputation && !(j.hiredOn[id] && daysBetween(j.hiredOn[id], date) < JOBS.aiHireCooldownDays)).sort();
    if (pool.length) from = pool[rng.int(0, pool.length - 1)];
  }
  j.hiredOn[v.clubId] = date;
  if (from) {
    hired = aiName(rng);
    const fromName = clubName(s, data, from);
    openVacancy(j, s, data, from, date, 'left', hired, rng);
    logChange(j, { date, clubId: from, name: fromName, out: hired, in: null, reason: `saiu para o ${v.name}` });
    s.news.push({ date, text: `${hired} deixou o ${fromName} para treinar o ${v.name}.`, clubId: from });
  }
  logChange(j, { date, clubId: v.clubId, name: v.name, out: v.previousCoach, in: hired, reason: 'contrataÃ§Ã£o' });
  s.news.push({ date, text: `O ${v.name} contratou o tÃ©cnico ${hired}.`, clubId: v.clubId });
}

function makeOffer(j: OnlineJobs, s: SeasonState, data: CareerData, m: JobManager, v: JobVacancy, kind: JobOffer['kind'], date: string, ctx: JobsCtx): JobOffer {
  let goal: string | null = null;
  try {
    goal = seasonExpectation(s, v.clubId, data, ctx.squads).label;
  } catch {
    /* sem meta */
  }
  const o: JobOffer = {
    id: `o${++j.seq}`, managerId: m.id, clubId: v.clubId, name: v.name, reputation: v.reputation, division: v.division,
    kind, createdAt: date, expiresAt: addDays(date, JOBS.offerDays), status: 'pending', goal,
  };
  j.offers.unshift(o);
  m.lastOfferOn = date;
  j.events.push({ type: 'offer', managerId: m.id, clubId: v.clubId, date });
  return o;
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ aÃ§Ãµes do tÃ©cnico â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export type JobsActionResult = { ok: true; message: string; clubId?: string } | { ok: false; error: string };

export function applyForVacancy(j: OnlineJobs, s: SeasonState, managerId: string, vacancyId: string): JobsActionResult {
  const m = j.managers[managerId];
  if (!m) return { ok: false, error: 'TÃ©cnico nÃ£o encontrado na carreira.' };
  if (m.clubId) return { ok: false, error: 'VocÃª jÃ¡ tem clube. (Online, sÃ³ desempregados se candidatam.)' };
  const v = j.vacancies.find((x) => x.id === vacancyId);
  if (!v) return { ok: false, error: 'Esta vaga nÃ£o estÃ¡ mais aberta.' };
  if (s.humanClubIds.includes(v.clubId)) return { ok: false, error: 'Outro tÃ©cnico jÃ¡ assumiu este clube.' };
  if (m.left[v.clubId] && daysBetween(m.left[v.clubId], s.date) < COACH.returnBlockDays) return { ok: false, error: 'VocÃª deixou este time hÃ¡ menos de 30 dias.' };
  if (j.applications.some((a) => a.managerId === m.id && a.vacancyId === v.id && a.status === 'pending')) return { ok: false, error: 'VocÃª jÃ¡ se candidatou a esta vaga. Aguarde a resposta.' };
  const answerOn = addDays(s.date, JOBS.applicationDays);
  j.applications.unshift({ id: `a${++j.seq}`, managerId: m.id, vacancyId: v.id, clubId: v.clubId, name: v.name, appliedOn: s.date, answerOn, status: 'pending' });
  if (v.fillOn <= answerOn) v.fillOn = addDays(answerOn, 1);
  return { ok: true, message: `Candidatura enviada ao ${v.name}. A diretoria responde em ${JOBS.applicationDays} dias.` };
}

export function declineOffer(j: OnlineJobs, managerId: string, offerId: string): JobsActionResult {
  const o = j.offers.find((x) => x.id === offerId && x.managerId === managerId);
  if (!o || o.status !== 'pending') return { ok: false, error: 'Proposta nÃ£o estÃ¡ mais disponÃ­vel.' };
  o.status = 'declined';
  return { ok: true, message: 'Proposta recusada.' };
}

/** Aceita: o clube sai da IA e vira do humano agora. */
/**
 * Convite do host (administração): o clube `clubId` (da IA) convida o técnico, mesmo empregado. Aceitar deixa o
 * clube atual (vaga aberta, como "deixou o clube") e assume o novo na hora.
 */
export function adminOffer(j: OnlineJobs, s: SeasonState, data: CareerData, managerId: string, clubId: string, ctx: JobsCtx): JobsActionResult {
  const m = j.managers[managerId];
  if (!m) return { ok: false, error: 'Técnico não encontrado na carreira.' };
  if (!s.clubs[clubId]) return { ok: false, error: 'Clube fora da carreira.' };
  if (m.clubId === clubId) return { ok: false, error: 'Ele já é o técnico deste clube.' };
  if (s.humanClubIds.includes(clubId)) return { ok: false, error: 'Outro técnico da sala comanda este clube.' };
  if (j.offers.some((o) => o.status === 'pending' && o.managerId === m.id && o.clubId === clubId)) return { ok: false, error: 'Já há um convite pendente deste clube.' };
  const name = clubName(s, data, clubId);
  const v: JobVacancy = {
    id: '', clubId, name, reputation: clubRep(s, data, clubId), division: s.clubInfo?.[clubId]?.division ?? leagueOf(s, clubId)?.division ?? null,
    minReputation: 0, openedOn: s.date, reason: 'initial', previousCoach: null, fillOn: s.date,
  };
  makeOffer(j, s, data, m, v, 'invite', s.date, ctx);
  return { ok: true, message: `O ${name} convidou ${m.name}.` };
}

export function acceptOffer(j: OnlineJobs, world: WorldState, s: SeasonState, data: CareerData, managerId: string, offerId: string, ctx: JobsCtx): JobsActionResult {
  const m = j.managers[managerId];
  const o = j.offers.find((x) => x.id === offerId && x.managerId === managerId);
  if (!m || !o || o.status !== 'pending') return { ok: false, error: 'Proposta nÃ£o estÃ¡ mais disponÃ­vel.' };
  if (o.expiresAt < s.date) {
    o.status = 'expired';
    return { ok: false, error: 'A proposta expirou.' };
  }
  if (m.clubId === o.clubId) return { ok: false, error: 'Você já é o técnico deste clube.' };
  if (s.humanClubIds.includes(o.clubId)) {
    o.status = 'expired';
    return { ok: false, error: 'Outro tÃ©cnico jÃ¡ assumiu este clube.' };
  }
  if (!s.clubs[o.clubId]) return { ok: false, error: 'Clube fora da carreira.' };
  const date = s.date;
  // empregado (só por convite do host): deixa o clube atual antes de assumir o novo
  if (m.clubId) releaseManager(j, world, s, data, m.id, date);
  o.status = 'accepted';
  for (const x of j.offers) if (x.status === 'pending' && (x.managerId === m.id || x.clubId === o.clubId)) x.status = x.managerId === m.id ? 'declined' : 'expired';
  for (const a of j.applications) if (a.status === 'pending' && a.managerId === m.id) a.status = 'rejected';
  const v = j.vacancies.find((x) => x.clubId === o.clubId);
  j.vacancies = j.vacancies.filter((x) => x.clubId !== o.clubId);
  attachClub(world, s, o.clubId);
  m.clubId = o.clubId;
  m.history.push({ clubId: o.clubId, name: o.name, from: date, to: null, games: 0, won: 0, drawn: 0, lost: 0 });
  m.board = newBoard(s, o.clubId, ctx);
  j.hiredOn[o.clubId] = date;
  logChange(j, { date, clubId: o.clubId, name: o.name, out: v?.previousCoach ?? null, in: m.name, reason: 'contrataÃ§Ã£o (tÃ©cnico da sala)' });
  s.news.push({ date, text: `O ${o.name} anuncia ${m.name} como novo tÃ©cnico.`, clubId: o.clubId });
  j.events.push({ type: 'hired', managerId: m.id, clubId: o.clubId, date });
  return { ok: true, message: `VocÃª Ã© o novo tÃ©cnico do ${o.name}!`, clubId: o.clubId };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ visÃ£o do jogador â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function jobsView(j: OnlineJobs | null | undefined, managerId: string | null, date: string | null): JobsPayload {
  if (!j) return { date, firing: true, vacancies: [], offers: [], applications: [], me: null, changes: [] };
  const m = managerId ? j.managers[managerId] : undefined;
  const vacancies: JobVacancyInfo[] = j.vacancies.map((v) => ({
    id: v.id, clubId: v.clubId, name: v.name, reputation: v.reputation, division: v.division, minReputation: v.minReputation,
    openedOn: v.openedOn, reason: v.reason, previousCoach: v.previousCoach,
  }));
  const offers: JobOfferInfo[] = m
    ? j.offers.filter((o) => o.managerId === m.id).slice(0, 20).map((o) => ({
        id: o.id, clubId: o.clubId, name: o.name, reputation: o.reputation, division: o.division, kind: o.kind, createdAt: o.createdAt,
        expiresAt: o.expiresAt, status: o.status, goal: o.goal ?? null,
      }))
    : [];
  const applications: JobApplicationInfo[] = m
    ? j.applications.filter((a) => a.managerId === m.id).slice(0, 20).map((a) => ({
        id: a.id, vacancyId: a.vacancyId, clubId: a.clubId, name: a.name, appliedOn: a.appliedOn, answerOn: a.answerOn, status: a.status,
      }))
    : [];
  return {
    date,
    firing: j.firing,
    vacancies: vacancies.sort((a, b) => b.reputation - a.reputation || (a.name < b.name ? -1 : 1)),
    offers,
    applications,
    me: m
      ? {
          reputation: repOf(m.points), clubId: m.clubId,
          board: m.board ? { confidence: Math.round(m.board.confidence), goal: m.board.goal, games: m.board.games } : null,
          history: m.history.map((h) => ({ ...h })),
        }
      : null,
    changes: j.changes.slice(0, 20),
  };
}

/** Propostas pendentes por tÃ©cnico (contagem para o room:state). */
export function pendingOfferCount(j: OnlineJobs | null | undefined, managerId: string, date: string | null): number {
  if (!j) return 0;
  return j.offers.filter((o) => o.managerId === managerId && o.status === 'pending' && (!date || o.expiresAt >= date)).length;
}

/** ValidaÃ§Ã£o mÃ­nima de um OnlineJobs vindo do disco/backup. */
export function sanitizeJobs(raw: unknown): OnlineJobs | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<OnlineJobs>;
  if (o.v !== 1 || !o.managers || typeof o.managers !== 'object' || !Array.isArray(o.vacancies) || !Array.isArray(o.offers)) return null;
  const str = (x: unknown) => typeof x === 'string' && x.length <= 120;
  const managers: Record<string, JobManager> = {};
  for (const [k, m] of Object.entries(o.managers)) {
    if (!m || typeof m !== 'object' || !str(m.id) || m.id !== k || typeof m.points !== 'number' || !Number.isFinite(m.points)) continue;
    managers[k] = {
      id: m.id, name: str(m.name) ? m.name : 'TÃ©cnico', clubId: str(m.clubId) ? m.clubId : null, points: m.points,
      board: m.board && typeof m.board === 'object' && typeof m.board.confidence === 'number' ? m.board : null,
      history: Array.isArray(m.history) ? m.history.filter((h) => h && typeof h === 'object' && str(h.clubId)).slice(-50) : [],
      left: m.left && typeof m.left === 'object' ? m.left : {}, lastOfferOn: str(m.lastOfferOn) ? m.lastOfferOn : null,
    };
  }
  const okDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  return {
    ...emptyJobs(),
    seq: typeof o.seq === 'number' && Number.isFinite(o.seq) ? o.seq : 0,
    firing: o.firing !== false,
    managers,
    vacancies: o.vacancies.filter((v) => v && str(v.id) && str(v.clubId) && okDate(v.fillOn)).slice(0, 200),
    offers: o.offers.filter((x) => x && str(x.id) && str(x.clubId) && str(x.managerId) && okDate(x.expiresAt)).slice(0, 200),
    applications: Array.isArray(o.applications) ? o.applications.filter((a) => a && str(a.id) && str(a.vacancyId) && okDate(a.answerOn)).slice(0, 200) : [],
    changes: Array.isArray(o.changes) ? o.changes.slice(0, JOBS.changesCap) : [],
    hiredOn: o.hiredOn && typeof o.hiredOn === 'object' ? o.hiredOn : {},
    lastDay: okDate(o.lastDay) ? o.lastDay! : null,
    events: [],
  };
}
