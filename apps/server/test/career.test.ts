import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { MatchResult, SeasonSummary, WorldState } from '@cosmicfut/engine';
import type { MatchEndPayload, MatchStartPayload, SeasonEndPayload } from '@cosmicfut/shared';
import { DEFAULT_DATA_DIR } from '../src/config.ts';
import { GameData } from '../src/data.ts';
import { playableClubs } from '../src/career-data.ts';
import { ROOM_CAREER_REV, type RoomSnapshot } from '../src/room.ts';
import { CAREER_REV, unavailablePlayers } from '@cosmicfut/engine';
import type { SeasonPreview, ExpiringInfo } from '../src/sim-core.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, fixtureById, gunzip, ok, startServer, todays, Tracker, waitFor, type Client } from './helpers.ts';

const data = new GameData(DEFAULT_DATA_DIR);
const playable = playableClubs({ leagues: data.leagues(), states: data.states() }, 29);
/** um clube que só joga o estadual (sem divisão nacional) — de São Paulo, com elenco no mercado */
const STATE_ONLY = [...playable.stateOnly].filter((id) => data.club(id)?.state === 'SP').sort()[0];
const fictional = data.leagues().find((d) => d.countryId === 29 && d.fictional && d.clubIds.some((id) => !playable.all.has(id)));

let servers: CosmicServer[] = [];
const sockets: Client[] = [];
async function mk(url: string) {
  const s = await client(url);
  sockets.push(s);
  return s;
}
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  for (const s of servers.splice(0)) await s.close();
});
async function boot(over: Parameters<typeof startServer>[0] = {}) {
  const r = await startServer(over);
  servers.push(r.srv);
  return r;
}

describe('início da carreira', () => {
  it('Série A + clube que só joga estadual; regra de clube jogável no pick-club', async () => {
    expect(STATE_ONLY).toBeTruthy();
    const { srv, url } = await boot();
    const a = await mk(url);
    const b = await mk(url);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Verdão' });
    await ok(b, 'room:join', { code, nickname: 'Interior' });
    // fictícia (BRA-5..10) e clube sem competição: rejeitados
    if (fictional) {
      const id = fictional.clubIds.find((x) => !playable.all.has(x))!;
      expect((await call(b, 'room:pick-club', { clubId: id })).ok).toBe(false);
    }
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(b, 'room:pick-club', { clubId: STATE_ONLY });
    await ok(a, 'room:start');
    const s = await ta.waitSnap(() => true);
    expect(s.world).toBeTruthy();
    expect(s.worldVersion).toBe(1);
    expect(s.state.humanClubIds).toEqual(['palmeiras', STATE_ONLY]);
    const comps = s.state.competitions;
    const ids = comps.map((c) => c.id);
    // (Etapa 1) Séries A e B; C e D saíram (clubes "só estadual")
    for (const id of ['BRA-1', 'BRA-2', 'BRA-CUP', 'EST-SP-1']) expect(ids).toContain(id);
    for (const id of ['BRA-3', 'BRA-4']) expect(ids).not.toContain(id);
    // 1º trecho (01/01–30/06): competições de ano civil; a virada europeia é em 30/06
    expect(s.state.date).toBe('2026-01-01');
    expect(s.state.segment).toEqual({ start: '2026-01-01', end: '2026-06-30', closes: 'split' });
    // continentais, ligas sul-americanas e Nordeste (Fase 2)
    expect(ids).toContain('LIBERTADORES');
    expect(ids.some((x) => x.startsWith('ARG'))).toBe(true);
    // o clube só-estadual está num estadual e não numa divisão nacional
    const mineComps = comps.filter((c) => c.clubIds.includes(STATE_ONLY)).map((c) => c.id);
    expect(mineComps.some((x) => x.startsWith('EST-SP-'))).toBe(true);
    expect(mineComps.some((x) => /^BRA-\d$/.test(x))).toBe(false);
    const room = srv.rooms.get(code)!;
    // (Etapa 1) o mundo tem as divisões de todos os países em escopo
    expect(room.settings.divisionIds).toEqual(expect.arrayContaining(['BRA-1', 'BRA-2', 'ING-1', 'ARG-1']));
    expect(room.career!.humanSquads[STATE_ONLY].length).toBeGreaterThan(10);
    expect(room.career!.humanSquads.palmeiras.length).toBeGreaterThan(18);
    // a 1ª rodada: os dois jogam (estaduais em janeiro)
    const sa = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    await ok(b, 'round:ready', { ready: true });
    const m = await sa;
    expect(m.fixture?.competitionId).toMatch(/^EST-SP-|^BRA-/);
    // 2º snapshot (rodada) sem o mundo — ele só vai no início/virada/rejoin
    const s2 = await ta.waitSnap((d) => d.version > s.version);
    expect(s2.raw.worldGz).toBeUndefined();
    expect(s2.worldVersion).toBe(1);
  });
});

describe('(Etapa 1) sala europeia: início em 01/07', () => {
  it('clube inglês começa na pré-temporada (1º semestre sul-americano simulado na criação); CAREER_REV da sala = engine', async () => {
    expect(ROOM_CAREER_REV).toBe(CAREER_REV);
    const ing = data.leagues().find((d) => d.id === 'ING-1')!;
    const { url } = await boot();
    const a = await mk(url);
    const ta = new Tracker(a);
    await ok(a, 'room:create', { nickname: 'London', settings: { countryId: ing.countryId } });
    await ok(a, 'room:pick-club', { clubId: ing.clubIds[1] });
    await ok(a, 'room:start');
    const s = await ta.waitSnap(() => true);
    expect(s.state.date).toBe('2026-07-01');
    expect(s.world!.startDate).toBe('2026-07-01');
    const pl = s.state.competitions.find((c) => c.id === 'ING-1')!;
    expect(pl.seasonLabel).toBe('2026/27');
    expect(pl.clubIds).toContain(ing.clubIds[1]);
    const br = s.state.competitions.find((c) => c.id === 'BRA-1')!;
    expect(br.fixtures.some((f) => f.result)).toBe(true);
  }, 60_000);
});

describe('Copa do Brasil em ida e volta', () => {
  it('2ª perna ao vivo leva o agregado da ida e o match:end traz aggregate/advancing', async () => {
    const { srv, url } = await boot({ halfTimeTimeoutMs: 0 });
    const a = await mk(url);
    const ta = new Tracker(a);
    const { code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Copa', settings: { matchSpeedMs: 1 } });
    await ok(a, 'room:pick-club', { clubId: 'flarj' });
    await ok(a, 'room:start');
    let snap = await ta.waitSnap(() => true);
    const isLeg2 = () => todays(snap.state, ['flarj']).find((f) => f.competitionId === 'BRA-CUP' && f.leg === 2);
    for (let i = 0; i < 80 && !isLeg2(); i++) snap = await ta.devAdvance('next-match');
    const leg2 = isLeg2()!;
    expect(leg2).toBeTruthy();
    const leg1 = snap.state.competitions.find((c) => c.id === 'BRA-CUP')!.fixtures.find((f) => f.tieId === leg2.tieId && f.leg === 1)!;
    expect(leg1.result).toBeTruthy();
    const before = leg1.homeId === leg2.homeId ? { home: leg1.result!.home, away: leg1.result!.away } : { home: leg1.result!.away, away: leg1.result!.home };

    const start = waitFor<MatchStartPayload>(a, 'match:start');
    await ok(a, 'round:ready', { ready: true });
    const m = await start;
    expect(m.matchId).toBe(leg2.id);
    expect(m.fixture?.leg).toBe(2);
    const cfg = m.config as { knockout: boolean; extraTime: boolean; aggregate?: { home: number; away: number } };
    expect(cfg.knockout).toBe(true);
    expect(cfg.extraTime).toBe(false);
    expect(cfg.aggregate).toEqual(before);
    const info = srv.rooms.get(code)!.matches.get(leg2.id)!.info();
    expect(info.aggregateBefore).toEqual(before);

    const end = await waitFor<MatchEndPayload>(a, 'match:end');
    const r = end.result as MatchResult;
    expect(end.aggregate).toEqual({ home: before.home + r.homeGoals, away: before.away + r.awayGoals });
    expect(end.advancing).toBeTruthy();
    if (end.aggregate!.home !== end.aggregate!.away) expect(end.advancing).toBe(end.aggregate!.home > end.aggregate!.away ? 'home' : 'away');
    else expect(end.penalties).toBeTruthy();
    // a engine resolve o confronto com o mesmo vencedor
    const after = await ta.waitSnap((d) => d.state.date > leg2.date);
    const comp = after.state.competitions.find((c) => c.id === 'BRA-CUP')!;
    const tie = Object.values(comp.stages ?? {}).flatMap((s) => s.ties ?? []).find((t) => t.id === leg2.tieId)!;
    expect(tie.winner).toBe(end.advancing === 'home' ? leg2.homeId : leg2.awayId);
    expect(fixtureById(after.state, leg2.id)?.result?.home).toBe(r.homeGoals);
  });
});

describe('virada de temporada online', () => {
  it('fim de temporada → resumo + renovações (season:renew) → nextSeason → planejamento; rejoin depois da virada', async () => {
    const { srv, url } = await boot({ halfTimeTimeoutMs: 0, seasonEndTimeoutMs: 60_000 });
    const a = await mk(url);
    const b = await mk(url);
    const ta = new Tracker(a);
    const tb = new Tracker(b);
    const { code, token } = await ok<{ code: string; token: string }>(a, 'room:create', { nickname: 'Host', settings: { matchSpeedMs: 1 } });
    await ok(b, 'room:join', { code, nickname: 'Guest' });
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(b, 'room:pick-club', { clubId: STATE_ONLY });
    await ok(a, 'room:start');
    await ta.waitSnap(() => true);
    // renovação fora do fim de temporada: rejeitada
    expect((await call(a, 'season:renew', { renew: {} })).ok).toBe(false);

    const t0 = performance.now();
    const endP = waitFor<SeasonEndPayload>(b, 'season:end', (e) => e.stage === 'review', 120_000);
    await ok(a, 'dev:advance', { until: 'season-end' });
    const review = await endP;
    console.log(`[métricas] temporada inteira (dev:advance, worker): ${(performance.now() - t0).toFixed(0)} ms`);
    const room = srv.rooms.get(code)!;
    expect(room.phase).toBe('season-end');
    expect(review.season).toBe(2026);
    const preview = review.preview as SeasonPreview;
    expect(preview.champions.find((c) => c.competitionId === 'BRA-1')?.championId).toBeTruthy();
    expect(preview.promoted['BRA-1']?.length ?? preview.promoted['BRA-2']?.length).toBeGreaterThan(0);
    expect(preview.relegated['BRA-1']?.length).toBeGreaterThan(0);
    expect(preview.continental?.libertadores.length).toBeGreaterThan(0);
    const expA = review.expiring!.palmeiras as ExpiringInfo[];
    expect(expA.length).toBeGreaterThanOrEqual(2);
    expect(review.deadline).toBeGreaterThan(Date.now());
    const st = await tb.waitRoom((s) => s.phase === 'season-end');
    expect(st.seasonEnd?.waitingFor.length).toBe(2);

    // validação
    const other = review.expiring![STATE_ONLY]?.[0];
    if (other) expect((await call(a, 'season:renew', { renew: { [other.playerId]: true } })).ok).toBe(false);
    expect((await call(a, 'season:renew', { renew: { [expA[0].playerId]: { wage: expA[0].demand.wage, years: 9 } } })).ok).toBe(false);
    expect((await call(a, 'season:renew', { renew: { 'palmeiras:99999': true } })).ok).toBe(false);

    // (13/11) o pedido mostrado é EXATO (mesma reputação do nextSeason): oferecer o pedido renova; 1% abaixo é recusado
    const eligible = expA.filter((x) => x.age < 38);
    const keep = eligible[0];
    const cheap = eligible[1];
    const exact = [keep, ...eligible.slice(2).filter((_, i) => i % 2 === 0)];
    const below = [cheap, ...eligible.slice(2).filter((_, i) => i % 2 === 1)];
    const renew: Record<string, { wage: number; years: number }> = {};
    for (const x of exact) renew[x.playerId] = { wage: x.demand.wage, years: x.demand.minYears };
    for (const x of below) renew[x.playerId] = { wage: Math.floor(x.demand.wage * 0.99), years: x.demand.minYears };
    const acc = await ok<{ accepted: number }>(a, 'season:renew', { renew });
    expect(acc.accepted).toBe(exact.length + below.length);
    expect(room.phase).toBe('season-end'); // B ainda não
    const done = waitFor<SeasonEndPayload>(a, 'season:end', (e) => e.stage === 'done', 60_000);
    const doneB = waitFor<SeasonEndPayload>(b, 'season:end', (e) => e.stage === 'done', 60_000);
    await ok(b, 'season:renew', { renew: {}, ready: true });
    const fin = await done;
    const summary = fin.summary as SeasonSummary;
    expect(summary.season).toBe(2026);
    for (const x of exact) expect(summary.contracts.humanReleased).not.toContain(x.playerId);
    for (const x of exact) expect(summary.contracts.refused?.some((r) => r.playerId === x.playerId) ?? false).toBe(false);
    for (const x of below) expect(summary.contracts.refused?.some((r) => r.playerId === x.playerId)).toBe(true);
    for (const x of below) expect(summary.contracts.humanReleased).toContain(x.playerId);
    // humanReleased vem filtrado por jogador (só o clube dele) + o mapa por clube
    expect(fin.humanReleasedByClub?.palmeiras).toEqual(summary.contracts.humanReleased);
    const finB = await doneB;
    const relB = (finB.summary as SeasonSummary).contracts.humanReleased;
    expect(relB).toEqual(fin.humanReleasedByClub?.[STATE_ONLY] ?? []);
    for (const x of below) expect(relB).not.toContain(x.playerId);
    const snap = await ta.waitSnap((d) => d.state.season === 2027);
    // (Etapa 1) virada automática de 30/06 (Europa/Arábia) + a do humano (31/12)
    expect(snap.worldVersion).toBe(3);
    expect(snap.state.segment?.start).toBe('2027-01-01');
    expect(snap.state.competitions.find((c) => c.id === 'ING-1')?.seasonLabel).toBe('2026/27');
    expect(snap.world).toBeTruthy();
    expect(snap.world!.season).toBe(2027);
    expect(snap.world!.players.contractEnd[keep.playerId]).toBeGreaterThanOrEqual(2027);
    expect(snap.world!.history.some((h) => h.competitionId === 'BRA-1' && h.season === 2026)).toBe(true);
    const planning = await ta.waitRoom((s) => s.phase === 'planning' && s.season === 2027);
    expect(planning.settings.divisionIds).toContain('BRA-1');

    // rejoin depois da virada: mundo novo, estado 2027 e o resumo da virada
    a.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const a2 = await mk(url);
    const ta2 = new Tracker(a2);
    const doneAgain = waitFor<SeasonEndPayload>(a2, 'season:end', (e) => e.stage === 'done');
    await ok(a2, 'room:rejoin', { code, token });
    const s2 = await ta2.waitSnap(() => true);
    expect(s2.worldVersion).toBe(3);
    expect(s2.world?.season).toBe(2027);
    expect(s2.state.season).toBe(2027);
    expect((await doneAgain).season).toBe(2026);
    expect((await ta2.waitRoom(() => true)).phase).toBe('planning');

    // a nova temporada roda
    const start = waitFor<MatchStartPayload>(a2, 'match:start', () => true, 60_000);
    await ok(a2, 'round:ready', { ready: true });
    await ok(b, 'round:ready', { ready: true });
    const m = await start;
    expect(m.fixture?.date.startsWith('2027')).toBe(true);
  });

  it('timeout do fim de temporada roda a virada sozinho (renovação automática)', async () => {
    const { url } = await boot({ seasonEndTimeoutMs: 200 });
    const a = await mk(url);
    const ta = new Tracker(a);
    await ok(a, 'room:create', { nickname: 'Solo' });
    await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
    await ok(a, 'room:start');
    await ta.waitSnap(() => true);
    const done = waitFor<SeasonEndPayload>(a, 'season:end', (e) => e.stage === 'done', 120_000);
    await ok(a, 'dev:advance', { until: 'season-end' });
    const review = ta.seasonEnd!;
    const fin = await done;
    const auto = (review.expiring!.palmeiras ?? []).filter((p) => p.age < 33);
    const released = (fin.summary as SeasonSummary).contracts.humanReleased;
    for (const p of auto) expect(released).not.toContain(p.playerId);
    await ta.waitRoom((s) => s.phase === 'planning' && s.season === 2027);
  });
});

describe('persistência da carreira e migração', () => {
  it('salva world+state (gzip), restaura, mantém escalação; carreira legado (rev < 3) e v1 viram lobby; arquivo ruim é descartado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmicfut-career-'));
    try {
      const first = await boot({ persistDir: dir });
      const a = await mk(first.url);
      const ta = new Tracker(a);
      const { code, token } = await ok<{ code: string; token: string }>(a, 'room:create', { nickname: 'Persist', settings: { matchSpeedMs: 1 } });
      await ok(a, 'room:pick-club', { clubId: 'palmeiras' });
      await ok(a, 'room:start');
      await ta.waitSnap(() => true);
      const adv = await ta.devAdvance('2026-02-15');
      const room1 = first.srv.rooms.get(code)!;
      const club = adv.state.clubs.palmeiras;
      // (Atualização 38) lesionados + suspensos em qualquer competição (suspensão agora é por competição)
      const out = unavailablePlayers(club);
      const squad = room1.career!.humanSquads.palmeiras.filter((id) => !out.has(id));
      const lineup = { starters: squad.slice(0, 11), bench: squad.slice(11, 16) };
      const tactic = { formation: '4-4-2', mentality: 'defensive', tempo: 'slow', pressing: 'low', passing: 'direct' };
      await ok(a, 'round:set-lineup', { tactic, lineup });
      await new Promise((r) => setTimeout(r, 700)); // debounce da persistência
      a.disconnect();
      await first.srv.close();
      servers = servers.filter((s) => s !== first.srv);

      // arquivo salvo: v2 com a carreira comprimida
      const file = join(dir, `${code}.json`);
      const saved = JSON.parse(readFileSync(file, 'utf8')) as RoomSnapshot;
      expect(saved.v).toBe(2);
      expect(saved.career?.date).toBe('2026-02-15');
      expect(saved.career?.setups.palmeiras.tactic.formation).toBe('4-4-2');
      const kb = (Buffer.byteLength(JSON.stringify(saved)) / 1024).toFixed(0);
      console.log(`[métricas] arquivo da sala em disco: ${kb} KB`);
      // (Etapa 1) cópia da sala com o mundo de uma revisão anterior (sem rev): não migra — "legado", volta ao lobby
      const world = gunzip<WorldState>(Buffer.from(saved.career!.worldGz, 'base64'));
      expect(world.rev).toBe(3);
      delete world.rev;
      delete world.finance;
      delete world.options.continental;
      const legacyCareer = { ...saved, code: 'LGCYAB', career: { ...saved.career!, worldGz: gzipSync(JSON.stringify(world)).toString('base64') } };
      writeFileSync(join(dir, 'LGCYAB.json'), JSON.stringify(legacyCareer));
      // sala no formato antigo (temporada createSeason) e um arquivo corrompido
      writeFileSync(join(dir, 'LEGACY.json'), 'x'); // nome fora do padrão: ignorado
      writeFileSync(join(dir, 'ABCDEF.json'), JSON.stringify({
        v: 1, code: 'ABCDEF', createdAt: 1, savedAt: 1, hostId: 'p_old', phase: 'planning',
        settings: { countryId: 29, divisionIds: ['BRA-1'], matchSpeedMs: 400, allowSameClub: false },
        players: [{ id: 'p_old', token: 'tok_legacy_0123456789', nickname: 'Antigo', clubId: 'santos', ai: false }],
        season: { season: 2026, date: '2026-03-01', competitions: [] }, seasonVersion: 7, lastMatches: [],
      }));
      writeFileSync(join(dir, 'ZZZZZZ.json'), '{ corrompido');

      const second = await boot({ persistDir: dir, halfTimeTimeoutMs: 0 });
      expect(second.srv.rooms.has(code)).toBe(true);
      expect(second.srv.rooms.has('ZZZZZZ')).toBe(false);
      const legacy = second.srv.rooms.get('ABCDEF')!;
      expect(legacy.phase).toBe('lobby');
      expect(legacy.players[0].clubId).toBe('santos');
      expect(legacy.career).toBeNull();
      const legacyCareerRoom = second.srv.rooms.get('LGCYAB')!;
      expect(legacyCareerRoom.phase).toBe('lobby');
      expect(legacyCareerRoom.career).toBeNull();
      expect(legacyCareerRoom.players[0].clubId).toBe('palmeiras');

      const b = await mk(second.url);
      const tb = new Tracker(b);
      await ok(b, 'room:rejoin', { code, token });
      const st = await tb.waitRoom((s) => s.players.some((p) => p.connected));
      expect(st.phase).toBe('planning');
      const snap = await tb.waitSnap((d) => !!d.world);
      expect(snap.state.date).toBe('2026-02-15');
      expect(snap.world!.rev).toBe(3);
      expect(snap.world!.finance).toBeTruthy();
      expect(snap.world!.options.continental).toBe(true);
      const room2 = second.srv.rooms.get(code)!;
      expect(room2.needsHydrate).toBe(false);
      // a escalação salva vale na próxima partida
      const start = waitFor<MatchStartPayload>(b, 'match:start');
      await ok(b, 'round:ready', { ready: true });
      const m = await start;
      const side = m.side!;
      const cfg = m.config as Record<'home' | 'away', { tactic: { formation: string } }>;
      expect(cfg[side].tactic.formation).toBe('4-4-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
