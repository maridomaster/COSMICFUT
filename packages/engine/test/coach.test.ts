import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Player } from '@cosmicfut/shared';
import type { CareerData, Fixture, JobOffer, MatchResult, SeasonState, SeasonSummary, WorldState } from '../src/contract';
import { advanceDay } from '../src/season/season';
import { createCareer, migrateCareer, squadsFromMarket, worldSquads } from '../src/season/career';
import { addDays } from '../src/season/schedule';
import {
  acceptJobOffer, applyForJob, COACH, coachDay, coachSeasonEnd, declareInterest, jobCenter, resignationFine, resignJob, stabilityBand,
} from '../src/season/coach';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../../apps/web/public/data');
const rj = <T,>(p: string): T => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T;

let data: CareerData;
let base: (id: string) => Player[];
const HUMAN = 'palmeiras';

beforeAll(() => {
  data = {
    clubs: rj('clubs-index.json'), leagues: rj('leagues.json'), states: rj('states.json'), formats: rj('formats.json'),
    competitions: rj('competitions.json'), calendars: rj('calendars.json'), economy: rj('economy.json'), countries: rj('countries.json'),
  };
  const pm = squadsFromMarket(rj('players-market.json'));
  base = (id) => pm.get(id) ?? [];
}, 60_000);

function career(seed = 'coach-test', coach = true): { world: WorldState; state: SeasonState } {
  return createCareer({ data, humanClubIds: [HUMAN], season: 2026, seed, squads: base, options: { light: 'all', coachCareer: coach } });
}

/** Um "dia" com um jogo do clube (resultado dado) — chama coachDay como o worker (depois de avançar a data). */
function playDay(world: WorldState, state: SeasonState, opp: string, gf: number, ga: number, home = true, extra: Partial<Fixture> = {}) {
  const date = state.date;
  const f: Fixture = {
    id: `T:${date}:${opp}`, competitionId: 'BRA-1', round: 1, date, homeId: home ? HUMAN : opp, awayId: home ? opp : HUMAN,
    result: home ? { home: gf, away: ga } : { home: ga, away: gf }, ...extra,
  };
  const r = { homeGoals: f.result!.home, awayGoals: f.result!.away, winner: 'draw', scorers: [], cards: [], injuries: [], ratings: {}, attendance: 0 } as unknown as MatchResult;
  state.date = addDays(date, 1);
  return coachDay(world, state, [{ fixture: f, result: r }], { data });
}

function idleDays(world: WorldState, state: SeasonState, n: number) {
  for (let i = 0; i < n; i++) {
    state.date = addDays(state.date, 1);
    coachDay(world, state, [], { data });
  }
}

describe('carreira do técnico: criação e opção', () => {
  it('desligada por padrão (servidor online): createCareer não cria world.coach', () => {
    const { world } = career('off', false);
    expect(world.coach).toBeUndefined();
    expect(world.options.coachCareer ?? false).toBe(false);
  });

  it('cria o técnico no clube humano, com meta, técnicos da CPU, vagas e e-mails', () => {
    const { world } = career();
    const cc = world.coach!;
    expect(cc.coach.clubId).toBe(HUMAN);
    expect(cc.board!.stability).toBe(60);
    expect(cc.board!.expectation!.competitionId).toBe('BRA-1');
    expect(['title', 'continental']).toContain(cc.board!.expectation!.kind);
    expect(Object.keys(cc.aiCoaches).length).toBeGreaterThan(100);
    expect(cc.aiCoaches[HUMAN]).toBeUndefined();
    expect(cc.vacancies.some((v) => v.clubId)).toBe(true);
    expect(cc.vacancies.some((v) => v.nationalTeamId !== undefined)).toBe(true);
    expect(cc.inbox.some((m) => m.kind === 'welcome')).toBe(true);
    expect(cc.coach.history[0]).toMatchObject({ kind: 'club', clubId: HUMAN, to: null });
  });
});

describe('estabilidade', () => {
  it('sobe com vitórias e cai com derrotas (regras da spec §6.4)', () => {
    const { world, state } = career();
    const b = world.coach!.board!;
    playDay(world, state, 'gremio', 2, 0);
    expect(b.stability).toBe(62);
    playDay(world, state, 'cuiaba', 0, 1); // derrota em casa para clube menor: −5
    expect(b.stability).toBe(57);
    playDay(world, state, 'flamengo', 0, 1, false); // derrota fora: −3
    expect(b.stability).toBe(54);
    playDay(world, state, 'internacional', 1, 1, false); // empate fora: +0,5
    expect(b.stability).toBe(54.5);
    expect(world.coach!.seasonRecord).toMatchObject({ games: 4, won: 1, drawn: 1, lost: 2 });
    expect(world.coach!.coach.history[0].games).toBe(4);
  });

  it('faixas 79/43: blindado, estável, prestes a cair, crítico', () => {
    expect(stabilityBand(80)).toBe('shielded');
    expect(stabilityBand(79)).toBe('stable');
    expect(stabilityBand(43)).toBe('stable');
    expect(stabilityBand(42.5)).toBe('danger');
    expect(stabilityBand(19)).toBe('critical');
  });

  it('aviso "prestes a cair" ao cruzar 43%', () => {
    const { world, state } = career();
    const b = world.coach!.board!;
    b.stability = 45;
    playDay(world, state, 'santos', 0, 2);
    expect(b.stability).toBeLessThan(43);
    expect(world.coach!.inbox[0].kind).toBe('warning');
    expect(world.coach!.inbox[0].subject).toMatch(/prestes a cair/i);
  });

  it('técnico da CPU acima de 79% não pode ser pressionado', () => {
    const { world, state } = career();
    const id = Object.keys(world.coach!.aiCoaches)[0];
    world.coach!.aiCoaches[id].stability = 85;
    const r = declareInterest(world, state, id, data);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Acima de 79%/);
    expect(world.coach!.lastInterestOn).toBeNull();
  });
});

describe('demissão', () => {
  it('sem demissão nos 5 primeiros jogos; depois, < 20% ⇒ demitido, clube paga a multa', () => {
    const { world, state } = career();
    const cc = world.coach!;
    cc.board!.stability = 10;
    playDay(world, state, 'santos', 0, 1);
    expect(cc.coach.clubId).toBe(HUMAN); // carência
    cc.board!.gamesSinceHire = 10;
    const bal = state.clubs[HUMAN].balance;
    const savings = cc.coach.savings;
    const fine = resignationFine(cc.coach);
    const ev = playDay(world, state, 'santos', 0, 1);
    expect(ev.fired).toBe(true);
    expect(cc.coach.clubId).toBeNull();
    expect(cc.board).toBeNull();
    expect(world.humanClubIds).toEqual([]);
    expect(state.humanClubIds).toEqual([]);
    expect(state.clubs[HUMAN].lineup).toBeNull();
    expect(state.clubs[HUMAN].balance).toBe(bal - fine);
    expect(cc.coach.savings).toBe(savings + fine);
    expect(cc.inbox[0].kind).toBe('fired');
    expect(cc.vacancies.some((v) => v.clubId === HUMAN)).toBe(true);
    expect(cc.coach.history[0]).toMatchObject({ exit: 'fired' });
    expect(cc.coach.history[0].to).toBeTruthy();
    // a temporada continua simulada sem o humano
    const sq = worldSquads(world, base);
    for (let i = 0; i < 5; i++) advanceDay(state, sq, {}, { inPlace: true });
  });

  it('fim de temporada: rebaixado ⇒ demitido', () => {
    const { world, state } = career();
    const summary = { relegated: { 'BRA-1': [HUMAN] }, promoted: {}, champions: [] } as unknown as SeasonSummary;
    coachSeasonEnd(world, state, data, summary);
    expect(world.coach!.coach.clubId).toBeNull();
    expect(world.humanClubIds).toEqual([]);
  });
});

describe('Central de Empregos', () => {
  it('candidatura respondida em 7 dias', () => {
    const { world, state } = career();
    const cc = world.coach!;
    cc.coach.reputationPoints = 2000;
    const v = jobCenter(world, state, data).vacancies.find((x) => x.vacancy.clubId && x.status === 'ok')!;
    expect(v).toBeTruthy();
    const r = applyForJob(world, state, v.vacancy.id);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/7 dias/);
    expect(applyForJob(world, state, v.vacancy.id).ok).toBe(false); // duplicada
    const app = cc.applications[0];
    expect(app.answerOn).toBe(addDays(state.date, 7));
    idleDays(world, state, 6);
    expect(app.status).toBe('pending');
    expect(cc.vacancies.some((x) => x.id === v.vacancy.id)).toBe(true); // vaga segura enquanto pendente
    idleDays(world, state, 1);
    expect(app.status).toBe('approved');
    const reply = cc.inbox.find((m) => m.subject.startsWith('Re: Interesse'))!;
    expect(reply.body).toMatch(/Parabéns/);
    const offer = cc.offers.find((o) => o.id === reply.offerId)!;
    expect(offer).toMatchObject({ kind: 'application', status: 'pending', years: 1 });
  });

  it('pedir demissão: multa de 6 salários; acordo mútuo só com estabilidade ≤ 43%', () => {
    const { world, state } = career();
    const cc = world.coach!;
    const mutualNo = resignJob(world, state, data, { mutual: true });
    expect(mutualNo.ok).toBe(false);
    const fine = resignationFine(cc.coach);
    expect(fine).toBe(6 * cc.coach.wage);
    const savings = cc.coach.savings;
    const bal = state.clubs[HUMAN].balance;
    const r = resignJob(world, state, data);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/pagou a multa/);
    expect(cc.coach.savings).toBe(savings - fine);
    expect(state.clubs[HUMAN].balance).toBe(bal + fine);
    expect(world.humanClubIds).toEqual([]);
    expect(cc.coach.history[0].exit).toBe('resigned');

    const b = career('coach-mutual');
    b.world.coach!.board!.stability = 40;
    const s0 = b.world.coach!.coach.savings;
    const m = resignJob(b.world, b.state, data, { mutual: true });
    expect(m.ok).toBe(true);
    expect(m.message).toMatch(/acordo mútuo/);
    expect(b.world.coach!.coach.savings).toBe(s0);
  });

  it('bloqueio de 30 dias para voltar ao clube e de 6 meses para declarar interesse', () => {
    const { world, state } = career();
    const cc = world.coach!;
    resignJob(world, state, data);
    const vac = cc.vacancies.find((v) => v.clubId === HUMAN)!;
    vac.fillOn = '2099-01-01';
    expect(applyForJob(world, state, vac.id).error).toMatch(/menos de 30 dias/);
    idleDays(world, state, 31);
    expect(applyForJob(world, state, vac.id).ok).toBe(true);

    const ids = Object.keys(cc.aiCoaches).slice(0, 2);
    for (const id of ids) { cc.aiCoaches[id].stability = 60; cc.aiCoaches[id].reputation = 0; }
    const first = declareInterest(world, state, ids[0], data);
    expect(first.ok).toBe(true);
    expect(cc.aiCoaches[ids[0]]?.stability ?? 0).toBeLessThanOrEqual(30);
    const second = declareInterest(world, state, ids[1], data);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/Aguarde 6 meses/);
    idleDays(world, state, COACH.interestBlockDays);
    if (cc.aiCoaches[ids[1]]) {
      cc.aiCoaches[ids[1]].stability = 60;
      expect(declareInterest(world, state, ids[1], data).ok).toBe(true);
    }
  });

  it('troca de clube: multa, clube humano no mundo e na temporada, competições seguem', () => {
    const { world, state } = career();
    const cc = world.coach!;
    const target = 'santos';
    const offer: JobOffer = {
      id: 'o-test', clubId: target, name: 'Santos', wage: 50_000, years: 1, stability: 60, createdAt: state.date,
      expiresAt: addDays(state.date, 7), kind: 'invite', status: 'pending',
    };
    cc.offers.push(offer);
    const ask = acceptJobOffer(world, state, offer.id, data);
    expect(ask.ok).toBe(false);
    expect(ask.error).toMatch(/pagar a multa/);
    const fine = resignationFine(cc.coach);
    const savings = cc.coach.savings;
    state.clubs[HUMAN].lineup = { starters: [], bench: [] };
    const r = acceptJobOffer(world, state, offer.id, data, { payFine: true });
    expect(r.ok).toBe(true);
    expect(r.clubChanged).toBe(target);
    expect(world.humanClubIds).toEqual([target]);
    expect(state.humanClubIds).toEqual([target]);
    expect(cc.coach.clubId).toBe(target);
    expect(cc.board!.clubId).toBe(target);
    expect(cc.coach.savings).toBe(savings - fine);
    expect(cc.aiCoaches[target]).toBeUndefined();
    expect(cc.vacancies.some((v) => v.clubId === HUMAN)).toBe(true);
    expect(state.clubs[HUMAN].lineup).toBeNull();
    expect(cc.coach.history.map((h) => h.clubId)).toEqual([HUMAN, target]);
    expect(cc.coach.history[0].exit).toBe('left');
    // voltar ao Palmeiras em menos de 30 dias é proibido
    cc.offers.push({ ...offer, id: 'o-back', clubId: HUMAN, name: 'Palmeiras', status: 'pending' });
    expect(acceptJobOffer(world, state, 'o-back', data, { payFine: true }).error).toMatch(/30 dias/);
    expect(world.humanClubIds).toEqual([target]);
    // a temporada continua: jogos do novo clube passam a ser do humano
    const sq = worldSquads(world, base);
    let mine = 0;
    for (let i = 0; i < 40; i++) {
      const res = advanceDay(state, sq, {}, { inPlace: true });
      coachDay(world, state, res.played, { data });
      mine += res.played.filter((p) => p.fixture.homeId === target || p.fixture.awayId === target).length;
    }
    expect(mine).toBeGreaterThan(0);
    expect(cc.seasonRecord.games).toBe(mine);
  });
});

describe('migração e determinismo', () => {
  it('save rev 2 sem técnico: migrateCareer cria o técnico do clube atual (idempotente); sem opção não cria', () => {
    const { world, state } = career('mig', false);
    const plain = migrateCareer(world, state);
    expect(plain.world.coach).toBeUndefined();
    const m = migrateCareer(world, state, { coachCareer: true, data });
    expect(m.coachCreated).toBe(true);
    expect(m.world.coach!.coach.clubId).toBe(HUMAN);
    expect(m.world.options.coachCareer).toBe(true);
    const again = migrateCareer(m.world, m.state, { coachCareer: true, data });
    expect(again.coachCreated).toBeUndefined();
    expect(JSON.stringify(again.world.coach)).toBe(JSON.stringify(m.world.coach));
  });

  it('mesma seed ⇒ mesma carreira do técnico (40 dias simulados)', () => {
    const run = () => {
      const { world, state } = career('det');
      const sq = worldSquads(world, base);
      for (let i = 0; i < 40; i++) {
        const r = advanceDay(state, sq, {}, { inPlace: true });
        coachDay(world, state, r.played, { data });
      }
      return JSON.stringify(world.coach);
    };
    expect(run()).toBe(run());
  });
});
