/// <reference lib="webworker" />
/**
 * Worker da carreira solo (Fase 1). Dono do estado durante a simulação:
 *  - guarda `world` (WorldState) + `state` (SeasonState) e os elencos base (players-market + bundle do humano);
 *  - roda `advanceDay(state, worldSquads(world, base), results, { inPlace: true })` — sem cópias por dia;
 *  - grava `world` e `state` JUNTOS no IndexedDB (fora do thread principal);
 *  - devolve cópias ao thread principal (structured clone) só ao fim de cada operação.
 * As mensagens são processadas em fila (uma operação por vez).
 */
import type { Player } from '@cosmicfut/shared';
import type { NamePool } from '@cosmicfut/shared';
import {
  acceptJobOffer, advanceDay, applyForJob, autoTurnoverDue, careerNamePoolCodes, coachDay, createCareer, cycleEnd, cycleOfRegion, cycleSeason,
  declareInterest, declineJobOffer, isLegacyCareer, markInboxRead, migrateCareer, nextSeason, regionOfClub, renameCoach, resignJob,
  lazyCareerSquads, scopeNamePoolCodes, TimeSkip, turnoverDue, worldSquads,
  activateHotseat, assistantRenewals, createHotseat, endHotseatTurn, hotseatPlayingToday,
  type CoachActionResult, type Fixture, type SeasonState, type SeasonSummary, type WorldState,
} from '@cosmicfut/engine';
import { idb, isQuotaError } from '@/lib/idb';
import { careerBase, loadCareerData, loadMarketSquads, loadNamePool, type BaseSquads } from './data';
import {
  CAREER_FILE_FORMAT, CAREER_FILE_VERSION, CAREER_SAVE_KEY, CAREER_SAVE_VERSION, CAREERS_INDEX_KEY, FIRST_SLOT_ID, LEGACY_SAVE_KEY, MAX_CAREER_SLOTS,
  slotKey, slotTmpKey,
  type BalancePoint, type CareerFile, type CareerSave, type CareerSlotMeta, type CareersIndex, type CoachAction, type CoachPatch, type FromWorker,
  type HumanSetup, type SlotClub, type SnapshotPayload, type StopReason, type ToWorker,
} from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let data: Awaited<ReturnType<typeof loadCareerData>> | null = null;
let base: BaseSquads | null = null;
/**
 * Clube humano ATUAL (da SeasonState). (Fase 3) O técnico pode ser demitido ('' = desempregado) ou trocar de clube:
 * o elenco base (`base`) usa o bundle completo do clube informado no último `init`.
 */
let humanId = '';
const syncHuman = () => (humanId = state?.humanClubIds[0] ?? '');
/** pools de nomes do país da carreira (técnicos da CPU) — carregado sob demanda */
let coachPools: Record<string, NamePool> = {};
/** carreira carregada: slot + clube (o save fica em `career:<slotId>`) */
let meta: { slotId: string; clubId: string; startedAt: string | null } | null = null;
/** índice dos slots (cache; a fila garante uma escrita por vez) */
let indexCache: CareersIndex | null = null;
let world: WorldState | null = null;
let state: SeasonState | null = null;
let history: BalancePoint[] = [];
let summary: SeasonSummary | null = null;
let wb: ((id: string) => Player[]) | null = null;
let wbWorld: WorldState | null = null;

const send = (m: FromWorker) => self.postMessage(m);

function squads() {
  if (!world || !base) throw new Error('carreira não carregada');
  if (!wb || wbWorld !== world) {
    wb = worldSquads(world, base);
    wbWorld = world;
  }
  return wb;
}

function payload(): SnapshotPayload {
  return { world: world!, state: state!, history, summary };
}

/* ───────────── slots ───────────── */

const QUOTA_MSG = 'Sem espaço para salvar neste navegador. Exporte uma carreira para arquivo e exclua as que não usa.';
const friendly = (e: unknown, what: string) => (isQuotaError(e) ? QUOTA_MSG : `${what}: ${e instanceof Error ? e.message : String(e)}`);

function approxBytes(s: SeasonState, w: WorldState): number {
  try {
    return JSON.stringify(s).length + JSON.stringify(w).length;
  } catch {
    return 0;
  }
}

async function clubInfo(clubId: string): Promise<SlotClub> {
  try {
    const d = data ?? (await loadCareerData());
    // clubs-index.json completo (o tipo da engine só declara parte dos campos)
    const c = d.clubs.find((x) => x.id === clubId) as ((typeof d.clubs)[number] & Partial<SlotClub>) | undefined;
    if (c) return { id: c.id, name: c.name, colors: c.colors ?? { primary: '#555555', secondary: '#999999' }, crestMini: c.crestMini ?? null };
  } catch {
    /* sem dados: cai no padrão */
  }
  return { id: clubId, name: clubId, colors: { primary: '#555555', secondary: '#999999' }, crestMini: null };
}

function metaOf(id: string, name: string, club: SlotClub, save: CareerSave, bytes: number): CareerSlotMeta {
  return {
    id, name, club, season: save.state.season, date: save.state.date,
    createdAt: save.startedAt ?? save.savedAt, savedAt: save.savedAt, bytes, v: save.v,
  };
}

const isCareerSave = (s: unknown): s is CareerSave =>
  !!s && typeof s === 'object' && (s as CareerSave).kind === 'career' && !!(s as CareerSave).world && !!(s as CareerSave).state;

/**
 * Índice dos slots. Na primeira abertura com slots, o save único antigo (`career:current`) vira o
 * slot 1 numa transação só (cópia + índice + remoção da chave antiga): ou tudo acontece, ou nada.
 */
async function readIndex(): Promise<{ index: CareersIndex; migrated: boolean }> {
  if (indexCache) return { index: indexCache, migrated: false };
  const stored = await idb.get<CareersIndex>(CAREERS_INDEX_KEY);
  if (stored && stored.v === 1 && Array.isArray(stored.slots)) {
    // descarta entradas malformadas (sem id/clube)
    const slots = stored.slots.filter((s) => s && typeof s.id === 'string' && !!s.id && s.id !== 'undefined' && !!s.club?.id);
    indexCache = slots.length === stored.slots.length ? stored : { v: 1, slots };
    return { index: indexCache, migrated: false };
  }
  const index: CareersIndex = { v: 1, slots: [] };
  const old = await idb.get<CareerSave>(CAREER_SAVE_KEY).catch(() => undefined);
  let migrated = false;
  if (isCareerSave(old) && old.v === CAREER_SAVE_VERSION) {
    const club = await clubInfo(old.clubId);
    index.slots.push(metaOf(FIRST_SLOT_ID, `${club.name} ${old.state.season}`, club, old, approxBytes(old.state, old.world)));
    await idb.batch([
      { copy: CAREER_SAVE_KEY, to: slotKey(FIRST_SLOT_ID) },
      { put: CAREERS_INDEX_KEY, value: index },
      { del: CAREER_SAVE_KEY },
    ]);
    migrated = true;
  } else {
    await idb.set(CAREERS_INDEX_KEY, index);
  }
  indexCache = index;
  return { index, migrated };
}

/** Lê os dados do slot; recupera uma escrita interrompida (`:tmp` completo e mais novo). */
async function readSlot(slotId: string): Promise<CareerSave | undefined> {
  const key = slotKey(slotId);
  const tmp = slotTmpKey(slotId);
  if (!(await idb.has(tmp).catch(() => false))) return idb.get<CareerSave>(key);
  const [main, t] = await Promise.all([idb.get<CareerSave>(key), idb.get<CareerSave>(tmp)]);
  if (isCareerSave(t) && (!main || (t.savedAt ?? '') >= (main.savedAt ?? ''))) {
    await idb.batch([{ copy: tmp, to: key }, { del: tmp }]).catch((e) => console.warn('[carreira] recuperação do :tmp', e));
    return t;
  }
  await idb.del(tmp).catch(() => undefined);
  return main;
}

function withSlot(index: CareersIndex, m: CareerSlotMeta): CareersIndex {
  const has = index.slots.some((s) => s.id === m.id);
  return { v: 1, slots: has ? index.slots.map((s) => (s.id === m.id ? m : s)) : [...index.slots, m] };
}

/** Grava dados + índice de forma atômica: `career:<id>:tmp` primeiro, depois troca (cópia + índice + remoção do tmp). */
async function writeSlotAtomic(slotId: string, save: CareerSave, index: CareersIndex): Promise<void> {
  const tmp = slotTmpKey(slotId);
  await idb.set(tmp, save);
  await idb.batch([{ copy: tmp, to: slotKey(slotId) }, { put: CAREERS_INDEX_KEY, value: index }, { del: tmp }]);
  indexCache = index;
}

async function writeIndex(index: CareersIndex): Promise<void> {
  await idb.set(CAREERS_INDEX_KEY, index);
  indexCache = index;
}

/** Grava a carreira carregada no slot dela. Devolve a mensagem de erro (ou null). */
async function persist(): Promise<string | null> {
  if (!world || !state || !meta) return null;
  const t0 = performance.now();
  const savedAt = new Date().toISOString();
  const save: CareerSave = {
    v: CAREER_SAVE_VERSION, kind: 'career', clubId: meta.clubId, startedAt: meta.startedAt,
    world, state, history, summary, savedAt,
  };
  // tamanho aproximado (JSON) — calculado aqui para não pesar no thread principal
  const bytes = approxBytes(state, world);
  const slotId = meta.slotId;
  let slotMeta: CareerSlotMeta;
  try {
    const { index } = await readIndex();
    const cur = index.slots.find((s) => s.id === slotId);
    if (cur) {
      slotMeta = { ...cur, season: state.season, date: state.date, savedAt, bytes, v: CAREER_SAVE_VERSION };
      // (Fase 3) o técnico trocou de clube: escudo/cores do slot mudam; o nome só se ainda for o padrão ("<clube> <ano>")
      if (cur.club.id !== meta.clubId) {
        const club = await clubInfo(meta.clubId);
        const isDefault = cur.name.startsWith(`${cur.club.name} `) && /^\d{4}$/.test(cur.name.slice(cur.club.name.length + 1));
        slotMeta = { ...slotMeta, club, name: isDefault ? `${club.name} ${state.season}` : cur.name };
      }
    } else {
      const club = await clubInfo(meta.clubId);
      slotMeta = metaOf(slotId, `${club.name} ${state.season}`, club, save, bytes);
    }
    await writeSlotAtomic(slotId, save, withSlot(index, slotMeta));
  } catch (e) {
    console.warn('[carreira] falha ao salvar no IndexedDB', e);
    const message = friendly(e, 'Falha ao salvar a carreira');
    send({ t: 'saveError', slotId, quota: isQuotaError(e), message });
    return message;
  }
  send({ t: 'saved', ms: performance.now() - t0, bytes, slotId, meta: slotMeta });
  return null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon(delay = 800) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void enqueue(async () => {
      await persist();
    });
  }, delay);
}
async function persistNow(): Promise<string | null> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return persist();
}
/** Grava o que estiver pendente (debounce do mercado) antes de trocar/copiar/exportar. */
async function flushPending() {
  if (saveTimer) await persistNow();
}

function clearMemory() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  world = null;
  state = null;
  meta = null;
  history = [];
  summary = null;
  wb = null;
  wbWorld = null;
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'carreira';

/** Valida o arquivo importado (formato, versão, estrutura mínima). Mensagens para o jogador. */
function parseCareerFile(text: string): CareerFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const f = raw as Partial<CareerFile> | null;
  if (!f || typeof f !== 'object' || f.format !== CAREER_FILE_FORMAT) throw new Error('Este arquivo não é uma carreira exportada do COSMICFUT.');
  if (typeof f.fileVersion !== 'number' || f.fileVersion > CAREER_FILE_VERSION) throw new Error('O arquivo foi gerado por uma versão mais nova do jogo.');
  const s = f.save as Partial<CareerSave> | undefined;
  if (!s || s.kind !== 'career' || typeof s.v !== 'number') throw new Error('O arquivo não contém um save de carreira.');
  if (s.v > CAREER_SAVE_VERSION) throw new Error(`Save de versão mais nova (v${s.v}); atualize o jogo para importar.`);
  if (s.v < CAREER_SAVE_VERSION) throw new Error(`Save de versão antiga (v${s.v}) não pode ser convertido.`);
  const st = s.state as Partial<SeasonState> | undefined;
  if (typeof s.clubId !== 'string' || !s.world || !st || !Array.isArray(st.competitions) || !st.clubs || typeof st.date !== 'string' || !st.clubs[s.clubId]) {
    throw new Error('O save está incompleto ou corrompido.');
  }
  return f as CareerFile;
}

function applySetup(s: SeasonState, setup: HumanSetup) {
  syncHuman();
  const c = humanId ? s.clubs[humanId] : undefined;
  if (!c) return;
  c.tactic = { ...setup.tactic };
  c.lineup = setup.lineup ? { ...setup.lineup, starters: setup.lineup.starters.slice(), bench: setup.lineup.bench.slice() } : null;
  if (setup.presets) c.tacticPresets = setup.presets.map((p) => (p ? { ...p } : null));
}

function pushBalance(s: SeasonState, force = false) {
  if (!humanId) return;
  const bal = s.clubs[humanId]?.balance ?? 0;
  if (force || history[history.length - 1]?.balance !== bal) history.push({ date: s.date, balance: bal });
  if (history.length > 1200) history = history.slice(-1200);
}

// (17/11) hot-seat: o dia de jogo de QUALQUER técnico local para o Continuar (cada um escala na sua vez)
const isMine = (f: Fixture) =>
  world?.hotseat && state
    ? state.humanClubIds.includes(f.homeId) || state.humanClubIds.includes(f.awayId)
    : !!humanId && (f.homeId === humanId || f.awayId === humanId);

/* ───────────── (Fase 3) carreira do técnico ───────────── */

function coachPatch(): CoachPatch {
  return { coach: world?.coach ?? null, humanClubIds: world?.humanClubIds.slice() ?? [] };
}

async function ensureCoachPools(): Promise<void> {
  const code = world?.countryCode;
  if (!code || coachPools[code]) return;
  const pool = await loadNamePool(code);
  if (pool) coachPools = { ...coachPools, [code]: pool };
}

/** Dia da carreira do técnico, depois do advanceDay (só com world.coach). */
function runCoachDay(s: SeasonState, played: { fixture: Fixture; result: import('@cosmicfut/engine').MatchResult }[]) {
  if (!world?.coach || !data) return null;
  // (13/11) elencos efetivos sob demanda: a meta da temporada segue a força real do elenco
  const ev = coachDay(world, s, played, { data, pools: coachPools, squads: lazyCareerSquads(s, squads()) });
  syncHuman();
  return ev;
}

/** (Etapa 1) pools de nomes de todos os países em escopo (juniores de qualquer região), carregados uma vez */
let allPools: Record<string, NamePool> | null = null;
async function namePools(): Promise<Record<string, NamePool>> {
  if (allPools) return allPools;
  if (!data) throw new Error('worker não inicializado');
  const codes = [...new Set([...scopeNamePoolCodes(data), ...(world && state ? careerNamePoolCodes(world, data, state) : [])])];
  const loaded = await Promise.all(codes.map(async (code) => [code, await loadNamePool(code)] as const));
  const pools: Record<string, NamePool> = {};
  for (const [code, pool] of loaded) if (pool) pools[code] = pool;
  allPools = pools;
  return pools;
}

/**
 * Virada (renovações informadas, ou nenhuma — técnico desempregado). (Etapa 1) `auto`: virada regional sem o
 * humano (ex.: Europa em 30/06 numa carreira brasileira) — mantém o histórico de saldo e o resumo da última virada
 * do humano.
 */
async function rolloverNow(renew: import('./protocol').RenewInput, auto = false): Promise<void> {
  if (!world || !state || !data || !base) throw new Error('carreira não carregada');
  const pools = await namePools();
  const r = nextSeason(world, state, base, data, pools, { renew });
  world = r.world;
  state = r.state;
  if (!auto) {
    summary = r.summary;
    history = [];
  }
  syncHuman();
  pushBalance(state, !auto);
  wb = null;
}

/** (Etapa 1) Último dia da temporada da região do clube humano (o fim do trecho em que a virada dele acontece). */
function humanSeasonEnd(s: SeasonState): string | null {
  if (!s.segment) return null;
  const r = humanId ? regionOfClub(s, humanId) : null;
  if (!r) return s.segment.end;
  const cyc = cycleOfRegion(r);
  return cycleEnd(cyc, cycleSeason(cyc, s.date));
}

function coachAction(a: CoachAction): CoachActionResult {
  if (!world || !state || !data) throw new Error('carreira não carregada');
  if (!world.coach) return { ok: false, error: 'Carreira de técnico desligada neste save.' };
  switch (a.type) {
    case 'apply':
      return applyForJob(world, state, a.vacancyId);
    case 'declare':
      return declareInterest(world, state, a.clubId, data);
    case 'accept':
      return acceptJobOffer(world, state, a.offerId, data, { payFine: a.payFine });
    case 'decline':
      return declineJobOffer(world, a.offerId);
    case 'resign':
      return resignJob(world, state, data, { mutual: a.mutual, national: a.national });
    case 'read':
      markInboxRead(world, a.ids);
      return { ok: true };
    case 'rename':
      return renameCoach(world, a.name);
    case 'dev': {
      if (!import.meta.env.DEV) return { ok: false, error: 'somente em desenvolvimento' };
      const cc = world.coach;
      if (a.reputation !== undefined) cc.coach.reputationPoints = Math.max(0, a.reputation * 20);
      const b = cc.board;
      if (b) {
        if (a.stability !== undefined) b.stability = a.stability;
        if (a.board !== undefined) b.boardConfidence = a.board;
        if (a.fans !== undefined) b.fanConfidence = a.fans;
        b.gamesSinceHire = Math.max(b.gamesSinceHire, 5);
      }
      if (a.fire && b) {
        // força a regra de demissão no próximo jogo (estabilidade abaixo de 20%)
        b.stability = 5;
      }
      return { ok: true, message: 'dev: carreira do técnico ajustada' };
    }
  }
}

function fixtureToday(s: SeasonState): Fixture | null {
  for (const c of s.competitions) for (const f of c.fixtures) if (f.date === s.date && !f.result && isMine(f)) return f;
  return null;
}

function horizon(s: SeasonState): { target: string | null; last: string | null } {
  let target: string | null = null;
  let last: string | null = null;
  // (Etapa 1) só até o fim da temporada do humano (as competições da outra região seguem depois)
  const cap = humanSeasonEnd(s);
  if (cap) last = cap;
  for (const c of s.competitions) {
    for (const f of c.fixtures) {
      if (f.result || f.date < s.date || (cap && f.date > cap)) continue;
      if (!last || f.date > last) last = f.date;
      if (isMine(f) && (!target || f.date < target)) target = f.date;
    }
  }
  return { target, last };
}

const dayMs = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function pendingOffers(s: SeasonState): Set<string> {
  return new Set((s.market?.offers ?? []).filter((o) => o.status === 'pending' && o.fromClubId === humanId).map((o) => o.id));
}

function finishedMine(s: SeasonState): Set<string> {
  return new Set(s.competitions.filter((c) => c.finished && c.clubIds.includes(humanId)).map((c) => c.id));
}

async function handle(m: ToWorker): Promise<void> {
  const t0 = performance.now();
  if ('slotId' in m && m.t !== 'discard' && (typeof m.slotId !== 'string' || !m.slotId)) throw new Error(`${m.t}: slot de carreira não informado`);
  switch (m.t) {
    case 'init': {
      const [d, market] = await Promise.all([loadCareerData(), loadMarketSquads()]);
      data = d;
      humanId = m.clubId;
      base = careerBase(market, m.clubId, m.humanPlayers);
      wb = null;
      // (Fase 3) troca de clube com a carreira carregada: o meta do slot passa a ser o novo clube
      if (meta && state && state.humanClubIds[0] === m.clubId) meta.clubId = m.clubId;
      syncHuman();
      if (!state) humanId = m.clubId;
      send({ t: 'ok', id: m.id, ms: performance.now() - t0 });
      return;
    }
    case 'load': {
      if (!m.clubId) throw new Error('load: clube não informado');
      // troca de slot: grava o pendente do slot anterior e começa limpo
      await flushPending();
      clearMemory();
      const { index } = await readIndex();
      const slotMeta = index.slots.find((s) => s.id === m.slotId) ?? null;
      const save = await readSlot(m.slotId).catch(() => undefined);
      // (Etapa 1) carreira de uma versão anterior (calendário de ano civil, sem escopo): não migra
      if (isCareerSave(save) && (save.v < CAREER_SAVE_VERSION || isLegacyCareer(save.world))) {
        send({ t: 'loaded', id: m.id, save: null, meta: slotMeta, legacy: false, legacyCareer: true, otherCareer: false, ms: performance.now() - t0 });
        return;
      }
      const match = isCareerSave(save) && save.v === CAREER_SAVE_VERSION && save.clubId === m.clubId;
      if (match && save) {
        meta = { slotId: m.slotId, clubId: save.clubId, startedAt: save.startedAt };
        // (Fase 2) migração idempotente: saves da Fase 1 ganham rev 2 (opções, finanças persistentes)
        // (Fase 3) a carreira solo liga a carreira do técnico: saves sem `world.coach` ganham o técnico do clube atual
        const mig = migrateCareer(save.world, save.state, data ? { coachCareer: true, data, ...(base ? { squads: base } : {}) } : {});
        world = mig.world;
        state = mig.state ?? save.state;
        history = save.history ?? [];
        summary = save.summary ?? null;
        wb = null;
        syncHuman();
        await ensureCoachPools();
        send({ t: 'loaded', id: m.id, save: payload(), meta: slotMeta, legacy: false, otherCareer: false, migrated: mig.migrated, coachCreated: !!mig.coachCreated, econMigrated: !!mig.econMigrated, ms: performance.now() - t0 });
        // grava o resultado da migração (o aviso aparece uma vez só)
        if (mig.migrated || mig.coachCreated || mig.econMigrated || mig.recordsMigrated || mig.dedupMigrated || mig.awardsMigrated || mig.potCapMigrated) await persistNow();
        return;
      }
      if (save && isCareerSave(save) && save.clubId !== m.clubId) throw new Error('o save deste slot é de outro clube');
      const legacy = await idb.has(LEGACY_SAVE_KEY).catch(() => false);
      send({ t: 'loaded', id: m.id, save: null, meta: slotMeta, legacy, otherCareer: !!save, ms: performance.now() - t0 });
      return;
    }
    case 'create': {
      if (!data || !base) throw new Error('worker não inicializado');
      await flushPending();
      clearMemory();
      const { index } = await readIndex();
      if (!index.slots.some((s) => s.id === m.slotId) && index.slots.length >= MAX_CAREER_SLOTS) {
        throw new Error(`Limite de ${MAX_CAREER_SLOTS} carreiras atingido. Exclua ou exporte uma carreira antes de começar outra.`);
      }
      // (Fase 3) carreira solo: com a carreira do técnico (o servidor online não liga a opção)
      // (Etapa 1) clube europeu/saudita começa em 01/07: o 1º semestre sul-americano é simulado aqui (pools para a
      // virada de 30/06)
      // (17/11) hot-seat: todos os técnicos locais são humanos (sem a carreira do técnico, que é de um só)
      const hot = m.hotseat && m.hotseat.length > 1 ? createHotseat(m.hotseat) : null;
      const r = createCareer({
        data, humanClubIds: hot ? hot.managers.map((x) => x.clubId) : [m.clubId], season: m.season, seed: m.seed, squads: base,
        options: { coachCareer: !hot }, ...(hot ? {} : { coach: { name: m.coachName } }), pools: await namePools(),
      });
      if (hot) r.world.hotseat = hot;
      // registra o slot (nome/escudo) antes do primeiro save
      const prev = index.slots.find((s) => s.id === m.slotId);
      const created: CareerSlotMeta = {
        id: m.slotId, name: prev?.name ?? m.name, club: m.club, season: r.state.season, date: r.state.date,
        createdAt: m.startedAt ?? new Date().toISOString(), savedAt: null, bytes: 0, v: CAREER_SAVE_VERSION,
      };
      indexCache = withSlot(index, created);
      meta = { slotId: m.slotId, clubId: m.clubId, startedAt: m.startedAt };
      world = r.world;
      state = r.state;
      summary = null;
      history = [];
      syncHuman();
      pushBalance(state, true);
      wb = null;
      await ensureCoachPools();
      send({ t: 'snapshot', id: m.id, payload: payload(), ms: performance.now() - t0 });
      await persistNow();
      return;
    }
    case 'coach': {
      if (!world || !state) throw new Error('carreira não carregada');
      const before = humanId;
      const result = coachAction(m.action);
      syncHuman();
      if (result.clubChanged) {
        // novo clube: o slot passa a ser dele (o elenco completo chega no próximo `init` do thread principal)
        if (meta) meta.clubId = result.clubChanged;
        history = [];
        pushBalance(state, true);
      } else if (before !== humanId) history = [];
      if (m.action.type === 'read') persistSoon();
      else await persistNow();
      const { index } = await readIndex();
      send({ t: 'coachDone', id: m.id, result, coach: coachPatch(), state, meta: meta ? index.slots.find((s) => s.id === meta!.slotId) ?? null : null, ms: performance.now() - t0 });
      return;
    }
    case 'continue': {
      if (!state) throw new Error('carreira não carregada');
      let s = state;
      let sq = squads();
      applySetup(s, m.setup);
      let reason: StopReason = 'idle';
      let note: string | undefined;
      let days = 0;
      let games = 0;
      let simMs = 0;
      let worldReplaced = false;
      const jobless = m.mode === 'job';
      const { target, last } = horizon(s);
      // desempregado: até 120 dias por clique (para numa proposta/resposta)
      const total = jobless ? 120 : Math.max(1, m.mode === 'end' ? (last ? dayMs(s.date, last) + 1 : 1) : target ? dayMs(s.date, target) : last ? dayMs(s.date, last) + 1 : 7);
      const offers0 = pendingOffers(s);
      const done0 = finishedMine(s);
      for (;;) {
        // (Etapa 1) virada regional devida: sem humano na região (ou técnico desempregado) é automática; com humano,
        // para no fim de temporada (renovações). Vem antes do dia de jogo: nada se joga depois do fim do trecho.
        if (turnoverDue(s)) {
          if (autoTurnoverDue(s)) {
            const wasJobless = !humanId;
            await rolloverNow([], !wasJobless);
            s = state!;
            sq = squads();
            worldReplaced = true;
            if (wasJobless) {
              note = `Começou a temporada ${s.season}.`;
              if (humanId) { reason = 'job'; break; }
            }
            continue;
          }
          reason = 'season-over';
          break;
        }
        if (m.mode === 'match' && fixtureToday(s)) {
          reason = 'matchday';
          break;
        }
        if (days >= (jobless ? 120 : 420)) {
          reason = 'limit';
          break;
        }
        const d0 = performance.now();
        const r = advanceDay(s, sq, {}, { inPlace: true });
        simMs += performance.now() - d0;
        days++;
        games += r.played.length;
        pushBalance(s);
        send({ t: 'progress', id: m.id, day: Math.min(days, total), total, date: s.date });
        // (Fase 3) estabilidade, demissão, vagas, propostas e respostas
        const ev = runCoachDay(s, r.played);
        if (ev?.fired && m.mode !== 'end') {
          reason = 'fired';
          note = 'Você foi demitido!';
          break;
        }
        if (ev && (ev.offers > 0 || ev.answers > 0) && m.mode !== 'end') {
          reason = 'job';
          note = ev.offers > 0 ? 'Nova proposta de emprego na caixa de entrada.' : 'Resposta da sua candidatura na caixa de entrada.';
          break;
        }
        if (m.mode === 'match') {
          // notícias importantes: título/fim de competição do humano, oferta recebida
          const done = [...finishedMine(s)].find((id) => !done0.has(id));
          if (done) {
            const comp = s.competitions.find((c) => c.id === done)!;
            reason = 'news';
            note = comp.championId === humanId ? `Campeão: ${comp.name}!` : `${comp.name} encerrado.`;
            break;
          }
          const offer = [...pendingOffers(s)].find((id) => !offers0.has(id));
          if (offer) {
            const o = s.market!.offers.find((x) => x.id === offer)!;
            reason = 'offer';
            note = `Proposta do ${o.toName} por ${o.player.name}.`;
            break;
          }
        }
      }
      // (17/11) hot-seat: no dia de jogo o controle passa ao 1º técnico (na ordem) que joga hoje — ele joga ao vivo;
      // os jogos dos outros técnicos do dia são simulados com a escalação de cada um
      if (reason === 'matchday' && world?.hotseat) {
        const playing = hotseatPlayingToday(world, s);
        if (playing.length && !playing.includes(world.hotseat.active)) {
          activateHotseat(world, s, playing[0]);
          syncHuman();
        }
      }
      send({
        t: 'advanced', id: m.id, state: s, history, reason, days, games, note, ms: performance.now() - t0, simMs, saveMs: 0,
        coach: coachPatch(), ...(worldReplaced ? { world: world!, summary } : {}), ...(world?.hotseat ? { hotseat: world.hotseat } : {}),
      });
      if (days > 0 || worldReplaced) await persistNow();
      return;
    }
    case 'finishDay': {
      if (!state) throw new Error('carreira não carregada');
      applySetup(state, m.setup);
      const d0 = performance.now();
      const r = advanceDay(state, squads(), { [m.fixtureId]: m.result }, { inPlace: true });
      const simMs = performance.now() - d0;
      pushBalance(state, true);
      const ev = runCoachDay(state, r.played);
      send({
        t: 'advanced', id: m.id, state, history, reason: ev?.fired ? 'fired' : 'idle', days: 1, games: r.played.length,
        played: r.played, ms: performance.now() - t0, simMs, saveMs: 0, coach: coachPatch(),
        ...(ev?.fired ? { note: 'Você foi demitido!' } : {}),
      });
      await persistNow();
      return;
    }
    case 'setState': {
      state = m.state;
      syncHuman();
      pushBalance(state);
      send({ t: 'ok', id: m.id, ms: performance.now() - t0 });
      persistSoon();
      return;
    }
    case 'skip': {
      if (!world || !state || !data || !base) throw new Error('carreira não carregada');
      applySetup(state, m.setup);
      const pools = await namePools();
      await ensureCoachPools();
      skipCancel = false;
      let wasJobless = !humanId;
      const sk = new TimeSkip({
        world, state, base, data, pools, until: m.until, stops: m.stops,
        onDay: (s) => pushBalance(s),
        onTurnover: (t, w, s) => {
          world = w;
          state = s;
          // fim de temporada do humano (ou virada de técnico desempregado): resumo novo e gráfico de saldo zerado,
          // como na virada do Continuar
          if (t.human || wasJobless) {
            summary = t.summary;
            history = [];
          }
          syncHuman();
          wasJobless = !humanId;
          pushBalance(s, true);
          wb = null;
        },
      });
      const clock = () => performance.now();
      while (!sk.done) {
        // pedaços de ~90 ms: progresso no máximo ~11×/s e o worker atende o cancelamento entre os pedaços
        sk.step({ ms: 90, now: clock });
        world = sk.world;
        state = sk.state;
        const h0 = humanId;
        syncHuman();
        if (h0 && !humanId) wasJobless = true;
        else if (humanId) wasJobless = false;
        send({ t: 'progress', id: m.id, day: Math.round(sk.progress * sk.total), total: sk.total, date: sk.state.date });
        await new Promise((r) => setTimeout(r, 0));
        if (skipCancel) sk.cancel();
      }
      skipCancel = false;
      wb = null;
      // salva ANTES de responder (o fim do salto e o cancelamento deixam o save consistente)
      await persistNow();
      send({
        t: 'skipped', id: m.id, payload: payload(), reason: sk.reason ?? 'done', note: sk.note, days: sk.days, games: sk.games,
        turnovers: sk.turnovers.length, ms: performance.now() - t0, simMs: sk.simMs, rolloverMs: sk.rolloverMs, bytes: approxBytes(state, world),
      });
      return;
    }
    case 'skipCancel': {
      // (normalmente tratado fora da fila; aqui só se chegar sem salto em andamento)
      skipCancel = false;
      send({ t: 'ok', id: m.id, ms: 0 });
      return;
    }
    case 'hotseat': {
      if (!world?.hotseat || !state) throw new Error('esta carreira não tem vários técnicos');
      // a escalação/tática do técnico que sai fica no clube dele
      applySetup(state, m.setup);
      const hs = world.hotseat;
      let next: number | null;
      if (m.action === 'activate') next = m.index ?? 0;
      else next = endHotseatTurn(hs);
      // fim da rodada (todos concluíram): o controle volta ao 1º técnico; o Continuar avança o dia
      activateHotseat(world, state, next ?? 0);
      syncHuman();
      send({ t: 'snapshot', id: m.id, payload: payload(), ms: performance.now() - t0 });
      persistSoon();
      return;
    }
    case 'rollover': {
      // (17/11) hot-seat: os outros técnicos renovam as peças-chave pelo assistente (a tela de fim de temporada é do ativo)
      if (world?.hotseat && state && base) {
        const extra = state.humanClubIds.slice(1).flatMap((id) => assistantRenewals(world!, state!, base!, id));
        if (extra.length) m.renew = Array.isArray(m.renew) ? [...m.renew, ...extra] : { ...m.renew, ...Object.fromEntries(extra.map((id) => [id, true])) } as typeof m.renew;
      }
      await rolloverNow(m.renew);
      send({ t: 'snapshot', id: m.id, payload: payload(), ms: performance.now() - t0 });
      await persistNow();
      return;
    }
    case 'discard': {
      // apaga só os DADOS do slot (o slot continua no índice e é recriado no próximo boot)
      const sid = m.slotId ?? meta?.slotId ?? null;
      clearMemory();
      if (sid) await idb.batch([{ del: slotKey(sid) }, { del: slotTmpKey(sid) }]).catch(() => undefined);
      if (m.legacy) await idb.del(LEGACY_SAVE_KEY).catch(() => undefined);
      send({ t: 'ok', id: m.id, ms: performance.now() - t0 });
      return;
    }
    case 'save': {
      if (!meta) throw new Error('nenhuma carreira carregada');
      const err = await persistNow();
      if (err) throw new Error(err);
      send({ t: 'ok', id: m.id, ms: performance.now() - t0 });
      return;
    }
    case 'unload': {
      await flushPending();
      clearMemory();
      send({ t: 'ok', id: m.id, ms: performance.now() - t0 });
      return;
    }
    case 'slots:list': {
      const { index, migrated } = await readIndex();
      send({ t: 'slots', id: m.id, index, migratedFromCurrent: migrated });
      return;
    }
    case 'slots:get': {
      const { index } = await readIndex();
      send({ t: 'slot', id: m.id, meta: index.slots.find((s) => s.id === m.slotId) ?? null });
      return;
    }
    case 'slots:rename': {
      const { index } = await readIndex();
      const name = m.name.trim().slice(0, 60);
      if (!name) throw new Error('O nome não pode ficar vazio.');
      if (!index.slots.some((s) => s.id === m.slotId)) throw new Error('carreira não encontrada');
      await writeIndex({ v: 1, slots: index.slots.map((s) => (s.id === m.slotId ? { ...s, name } : s)) }).catch((e) => {
        throw new Error(friendly(e, 'Falha ao renomear'));
      });
      send({ t: 'slots', id: m.id, index: indexCache! });
      return;
    }
    case 'slots:duplicate': {
      if (meta?.slotId === m.slotId) await flushPending();
      const { index } = await readIndex();
      if (index.slots.length >= MAX_CAREER_SLOTS) throw new Error(`Limite de ${MAX_CAREER_SLOTS} carreiras atingido. Exclua ou exporte uma carreira para liberar espaço.`);
      const src = index.slots.find((s) => s.id === m.slotId);
      if (!src) throw new Error('carreira não encontrada');
      if (!(await idb.has(slotKey(m.slotId)))) throw new Error('Esta carreira ainda não tem dados salvos.');
      const copy: CareerSlotMeta = { ...src, id: m.newId, name: m.name.trim().slice(0, 60) || `${src.name} (cópia)`, savedAt: new Date().toISOString() };
      const next = withSlot(index, copy);
      // cópia dos dados + índice na mesma transação (atômico)
      await idb.batch([{ copy: slotKey(m.slotId), to: slotKey(m.newId) }, { put: CAREERS_INDEX_KEY, value: next }]).catch((e) => {
        throw new Error(friendly(e, 'Falha ao duplicar'));
      });
      indexCache = next;
      send({ t: 'slot', id: m.id, meta: copy });
      return;
    }
    case 'slots:delete': {
      if (meta?.slotId === m.slotId) clearMemory();
      const { index } = await readIndex();
      const next: CareersIndex = { v: 1, slots: index.slots.filter((s) => s.id !== m.slotId) };
      await idb.batch([{ del: slotKey(m.slotId) }, { del: slotTmpKey(m.slotId) }, { put: CAREERS_INDEX_KEY, value: next }]);
      indexCache = next;
      send({ t: 'slots', id: m.id, index: next });
      return;
    }
    case 'slots:export': {
      if (meta?.slotId === m.slotId) await flushPending();
      const { index } = await readIndex();
      const sm = index.slots.find((s) => s.id === m.slotId);
      const save = await readSlot(m.slotId);
      if (!sm || !isCareerSave(save)) throw new Error('Esta carreira ainda não tem dados salvos.');
      const file: CareerFile = { format: CAREER_FILE_FORMAT, fileVersion: CAREER_FILE_VERSION, exportedAt: new Date().toISOString(), meta: sm, prefs: m.prefs, save };
      const text = JSON.stringify(file);
      const blob = new Blob([text], { type: 'application/json' });
      send({ t: 'exported', id: m.id, blob, filename: `cosmicfut-${slug(sm.name)}-${save.state.date}.json`, bytes: text.length });
      return;
    }
    case 'slots:import': {
      const { index } = await readIndex();
      if (index.slots.length >= MAX_CAREER_SLOTS) throw new Error(`Limite de ${MAX_CAREER_SLOTS} carreiras atingido. Exclua uma carreira antes de importar.`);
      const file = parseCareerFile(m.text);
      const src = file.save;
      // migração idempotente (saves da Fase 1 → rev atual)
      const mig = migrateCareer(src.world, src.state);
      const save: CareerSave = {
        ...src, world: mig.world, state: mig.state ?? src.state, history: src.history ?? [], summary: src.summary ?? null,
        savedAt: new Date().toISOString(),
      };
      const fm = file.meta as Partial<CareerSlotMeta> | undefined;
      const club = fm?.club && typeof fm.club.name === 'string' && fm.club.id === save.clubId ? fm.club : await clubInfo(save.clubId);
      const baseName = (typeof fm?.name === 'string' && fm.name.trim()) || `${club.name} ${save.state.season}`;
      const taken = new Set(index.slots.map((s) => s.name));
      const name = taken.has(baseName) ? `${baseName.slice(0, 48)} (importada)` : baseName.slice(0, 60);
      const sm = metaOf(m.newId, name, club, save, approxBytes(save.state, save.world));
      await writeSlotAtomic(m.newId, save, withSlot(index, sm)).catch((e) => {
        throw new Error(friendly(e, 'Falha ao importar'));
      });
      send({ t: 'slot', id: m.id, meta: sm, prefs: file.prefs && typeof file.prefs === 'object' ? file.prefs : null });
      return;
    }
  }
}

let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn, fn);
  return queue;
}

/** (Calendário) cancelamento pedido para o salto em andamento */
let skipCancel = false;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  // (Calendário) o salto ocupa a fila: o cancelamento é atendido na hora (o laço do salto confere entre os pedaços)
  if (m.t === 'skipCancel') {
    skipCancel = true;
    send({ t: 'ok', id: m.id, ms: 0 });
    return;
  }
  void enqueue(async () => {
    try {
      await handle(m);
    } catch (err) {
      send({ t: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
