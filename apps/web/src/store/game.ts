import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ClubIndexEntry, Player } from '@cosmicfut/shared';
import { autoPickLineup, DEFAULT_TACTIC, getFormationSlots, normalizePresets, sanitizePositions, slotFit, type Lineup, type SlotPos, type Tactic, type TacticPreset } from '@cosmicfut/engine';
import { isOnline, useIsOnline } from './mode';
export const MAX_BENCH = 9;

/**
 * Store LEVE (localStorage): clube, tática, escalação e preferências.
 * A temporada (SeasonState: data, moral, finanças, tabela…) fica em store/season.ts + IndexedDB.
 *
 * Slots de carreira: `cosmicfut:game` guarda só o que é GLOBAL (mudo + slot ativo). O estado leve de cada
 * carreira (clube, tática, escalação, observados) fica em `cosmicfut:career:<slotId>` (ver SLOT_FIELDS).
 */
export interface GameState {
  /** Slot de carreira ativo (solo). null = nenhuma carreira aberta. */
  slotId: string | null;
  clubId: string | null;
  /**
   * (17/11) hot-seat ("vários técnicos no mesmo computador"): clube do técnico que está com o controle, quando não é o
   * do slot (`clubId`, o 1º técnico — que continua identificando o save). As telas usam `useViewClubId()`.
   */
  activeClubId?: string | null;
  /** Snapshot leve do clube escolhido (para o tema renderizar antes do bundle carregar). */
  clubPreview: Pick<ClubIndexEntry, 'id' | 'name' | 'colors' | 'crestMini'> | null;
  /** Identifica a carreira (o save no IndexedDB é amarrado a ele). */
  startedAt: string | null;
  /** Tática do clube humano. */
  tactic: Tactic;
  /** Escalação do clube humano (null ⇒ será montada pelo autoPick quando o elenco carregar). */
  lineup: Lineup | null;
  /** Sons da partida (efeitos de gol, apito…). */
  muted: boolean;
  /** Mercado: jogadores observados (ids). */
  shortlist: string[];
  /** (Táticas) 3 vagas de predefinição do clube humano (null = vazia). Também vão ao save (ClubSeasonState). */
  presets: (TacticPreset | null)[];

  toggleShortlist: (playerId: string) => void;
  /** Nova carreira com o clube, no slot informado (o slot é registrado no índice no primeiro boot). */
  selectClub: (club: ClubIndexEntry, slotId?: string) => void;
  /** Abre um slot existente: carrega o estado leve dele (`cosmicfut:career:<id>`). */
  openSlot: (slotId: string, fallback?: Partial<SlotPrefs>) => void;
  /** Fecha a carreira ativa (sem apagar nada). */
  closeSlot: () => void;
  resetGame: () => void;
  setMuted: (muted: boolean) => void;

  /** Altera a tática. Ao trocar de formação, os 11 titulares são redistribuídos nos novos slots
   *  pela melhor adequação (se `players` for informado); sem `players`, mantém a ordem. */
  setTactic: (patch: Partial<Tactic>, players?: Player[]) => void;
  setLineup: (lineup: Lineup | null) => void;
  autoPick: (players: Player[], unavailable?: Set<string>) => void;
  /** Troca dois jogadores de lugar: titular↔titular, titular↔reserva, titular↔fora, reserva↔reserva, reserva↔fora. */
  swapPlayers: (aId: string, bId: string) => void;
  /** Leva um não relacionado para uma vaga livre do banco. */
  benchPlayer: (id: string) => void;
  /** Tira um reserva do banco (vira não relacionado). */
  unlistPlayer: (id: string) => void;
  setCaptain: (id: string | undefined) => void;
  setPenaltyTaker: (id: string | undefined) => void;
  /** (Táticas) move o slot i para (x, y) (null = volta à posição da formação). */
  setSlotPosition: (index: number, pos: SlotPos | null) => void;
  /** (Táticas) troca todas as posições personalizadas (null = formação padrão). */
  setPositions: (positions: (SlotPos | null)[] | null) => void;
  /** (Táticas) grava/limpa uma vaga de predefinição. */
  setPreset: (index: number, preset: TacticPreset | null) => void;
}

const initial = {
  clubId: null,
  activeClubId: null,
  clubPreview: null,
  startedAt: null,
  tactic: DEFAULT_TACTIC,
  lineup: null,
  shortlist: [] as string[],
  presets: [null, null, null] as (TacticPreset | null)[],
} satisfies Partial<GameState>;

/* ── estado leve por slot ── */

/** Campos do store que pertencem à carreira (por slot). O mudo é global. */
export const SLOT_FIELDS = ['clubId', 'clubPreview', 'startedAt', 'tactic', 'lineup', 'shortlist', 'presets'] as const;
export type SlotPrefs = Pick<GameState, (typeof SLOT_FIELDS)[number]>;
export const slotPrefsKey = (slotId: string) => `cosmicfut:career:${slotId}`;

/** Slot gerado para a carreira que existia antes dos slots (mesmo id do slot migrado no IndexedDB). */
const MIGRATED_SLOT_ID = 'slot-1';

export function newSlotId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function pickPrefs(s: Partial<GameState>): SlotPrefs {
  return {
    clubId: s.clubId ?? null,
    clubPreview: s.clubPreview ?? null,
    startedAt: s.startedAt ?? null,
    tactic: s.tactic ?? DEFAULT_TACTIC,
    lineup: s.lineup ?? null,
    shortlist: s.shortlist ?? [],
    presets: s.presets ?? [null, null, null],
  };
}

/** Normaliza prefs vindas do localStorage ou de um arquivo importado. */
export function normalizePrefs(raw: unknown): SlotPrefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<SlotPrefs>;
  return {
    clubId: typeof p.clubId === 'string' ? p.clubId : null,
    clubPreview: p.clubPreview && typeof p.clubPreview === 'object' ? p.clubPreview : null,
    startedAt: typeof p.startedAt === 'string' ? p.startedAt : null,
    tactic: { ...DEFAULT_TACTIC, ...(p.tactic && typeof p.tactic === 'object' ? p.tactic : {}) },
    lineup: normalizeLineup(p.lineup, p.tactic?.formation),
    shortlist: Array.isArray(p.shortlist) ? p.shortlist.filter((x): x is string => typeof x === 'string') : [],
    // (Táticas) prefs antigas não têm vagas ⇒ 3 vazias; posições inválidas são descartadas
    presets: normalizePresets(p.presets),
  };
}

/** (Táticas) escalação salva: estrutura mínima + posições personalizadas limpas (migração de saves antigos). */
function normalizeLineup(raw: unknown, formation: Tactic['formation'] | undefined): Lineup | null {
  const l = raw as Lineup | null | undefined;
  if (!l || typeof l !== 'object' || !Array.isArray(l.starters) || !Array.isArray(l.bench)) return null;
  const pos = sanitizePositions(l.positions, formation ?? DEFAULT_TACTIC.formation);
  const { positions: _drop, ...rest } = l;
  void _drop;
  return pos ? { ...rest, positions: pos } : rest;
}

export function readSlotPrefs(slotId: string): SlotPrefs | null {
  try {
    const raw = localStorage.getItem(slotPrefsKey(slotId));
    return raw ? normalizePrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeSlotPrefs(slotId: string, prefs: SlotPrefs): void {
  try {
    localStorage.setItem(slotPrefsKey(slotId), JSON.stringify(prefs));
  } catch (e) {
    console.warn('[carreira] não foi possível gravar as preferências do slot', e);
  }
}

export function removeSlotPrefs(slotId: string): void {
  try {
    localStorage.removeItem(slotPrefsKey(slotId));
  } catch {
    /* ignora */
  }
}

type Spot = { kind: 'starter' | 'bench'; index: number } | { kind: 'out' };

function locate(l: Lineup, id: string): Spot {
  const s = l.starters.indexOf(id);
  if (s >= 0) return { kind: 'starter', index: s };
  const b = l.bench.indexOf(id);
  if (b >= 0) return { kind: 'bench', index: b };
  return { kind: 'out' };
}

/** Capitão/batedor só fazem sentido entre os titulares: quem sai do XI perde a função
 *  e ela passa para quem entrou no lugar dele. */
function inheritRoles(l: Lineup, leaving: string, entering: string): Lineup {
  const next = { ...l };
  if (l.captainId === leaving && !l.starters.includes(leaving)) next.captainId = entering;
  if (l.penaltyTakerId === leaving && !l.starters.includes(leaving)) next.penaltyTakerId = entering;
  return next;
}

/** Reatribui os mesmos 11 jogadores aos slots de outra formação, maximizando a adequação (guloso). */
function reassignStarters(starters: string[], players: Player[], formation: Tactic['formation']): string[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = getFormationSlots(formation);
  const pairs: { s: number; id: string; v: number }[] = [];
  starters.forEach((id) => {
    const p = byId.get(id);
    if (!p) return;
    slots.forEach((slot, s) => pairs.push({ s, id, v: slotFit(p, slot) * 100 + p.overall / 100 }));
  });
  pairs.sort((a, b) => b.v - a.v || a.s - b.s);
  const out: (string | null)[] = new Array(slots.length).fill(null);
  const used = new Set<string>();
  for (const { s, id } of pairs) {
    if (out[s] || used.has(id)) continue;
    out[s] = id;
    used.add(id);
  }
  // jogadores sem dados (não deveria ocorrer): preenche na ordem original
  const leftovers = starters.filter((id) => !used.has(id));
  return out.map((id) => id ?? leftovers.shift() ?? '').filter(Boolean);
}

type SetFn = (patch: Partial<GameState>) => void;
type GetFn = () => GameState;

/** Corpo do store, compartilhado pelo store solo (persistido) e pelo online (em memória). */
function gameSlice(set: SetFn, get: GetFn): GameState {
  return {
      ...initial,
      slotId: null,
      // som da partida começa DESLIGADO; o usuário liga pelo botão (preferência persistida)
      muted: true,
      selectClub: (club, slotId) =>
        set({
          ...initial,
          slotId: slotId ?? get().slotId,
          clubId: club.id,
          clubPreview: { id: club.id, name: club.name, colors: club.colors, crestMini: club.crestMini },
          startedAt: new Date().toISOString(),
        }),
      openSlot: (slotId, identity) => {
        const stored = readSlotPrefs(slotId) ?? normalizePrefs({});
        // a identidade do slot (clube/escudo do índice) prevalece sobre o que estiver no localStorage
        const id = identity ?? {};
        const sameClub = !id.clubId || id.clubId === stored.clubId;
        set({
          ...initial,
          ...stored,
          ...(sameClub ? {} : { tactic: DEFAULT_TACTIC, lineup: null, shortlist: [], presets: [null, null, null] }),
          ...Object.fromEntries(Object.entries(id).filter(([, v]) => v !== undefined)),
          slotId,
        });
      },
      closeSlot: () => set({ ...initial, slotId: null }),
      resetGame: () => set({ ...initial, slotId: null }),
      setMuted: (muted) => set({ muted }),
      toggleShortlist: (id) => {
        const s = get().shortlist;
        set({ shortlist: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
      },

      setTactic: (patch, players) => {
        const { tactic, lineup } = get();
        const next = { ...tactic, ...patch };
        if (lineup && players && patch.formation && patch.formation !== tactic.formation && lineup.starters.length === 11) {
          // formação nova: as posições personalizadas (da formação anterior) são descartadas
          const { positions: _old, ...rest } = lineup;
          void _old;
          set({ tactic: next, lineup: { ...rest, starters: reassignStarters(lineup.starters, players, next.formation) } });
        } else {
          set({ tactic: next });
        }
      },
      setLineup: (lineup) => set({ lineup }),
      autoPick: (players, unavailable) => {
        const positions = get().lineup?.positions;
        const l = autoPickLineup(players, get().tactic, unavailable);
        set({ lineup: positions ? { ...l, positions } : l });
      },

      swapPlayers: (aId, bId) => {
        const l = get().lineup;
        if (!l || aId === bId) return;
        const a = locate(l, aId);
        const b = locate(l, bId);
        if (a.kind === 'out' && b.kind === 'out') return;
        const starters = [...l.starters];
        const bench = [...l.bench];
        const put = (spot: Spot, id: string) => {
          if (spot.kind === 'starter') starters[spot.index] = id;
          else if (spot.kind === 'bench') bench[spot.index] = id;
        };
        put(a, bId);
        put(b, aId);
        let next: Lineup = { ...l, starters, bench };
        // quem saiu do XI passa capitania/pênalti para quem entrou
        if (a.kind === 'starter' && b.kind !== 'starter') next = inheritRoles(next, aId, bId);
        if (b.kind === 'starter' && a.kind !== 'starter') next = inheritRoles(next, bId, aId);
        set({ lineup: next });
      },
      benchPlayer: (id) => {
        const l = get().lineup;
        if (!l || l.bench.length >= MAX_BENCH || l.starters.includes(id) || l.bench.includes(id)) return;
        set({ lineup: { ...l, bench: [...l.bench, id] } });
      },
      unlistPlayer: (id) => {
        const l = get().lineup;
        if (!l || !l.bench.includes(id)) return;
        set({ lineup: { ...l, bench: l.bench.filter((b) => b !== id) } });
      },
      setCaptain: (id) => {
        const l = get().lineup;
        if (l) set({ lineup: { ...l, captainId: id } });
      },
      setPenaltyTaker: (id) => {
        const l = get().lineup;
        if (l) set({ lineup: { ...l, penaltyTakerId: id } });
      },
      setSlotPosition: (index, pos) => {
        const { lineup: l, tactic } = get();
        if (!l || index < 0 || index > 10) return;
        const cur = l.positions && l.positions.length === 11 ? l.positions.slice() : new Array<SlotPos | null>(11).fill(null);
        cur[index] = pos;
        const clean = sanitizePositions(cur, tactic.formation);
        const { positions: _old, ...rest } = l;
        void _old;
        set({ lineup: clean ? { ...rest, positions: clean } : rest });
      },
      setPositions: (positions) => {
        const { lineup: l, tactic } = get();
        if (!l) return;
        const clean = sanitizePositions(positions, tactic.formation);
        const { positions: _old, ...rest } = l;
        void _old;
        set({ lineup: clean ? { ...rest, positions: clean } : rest });
      },
      setPreset: (index, preset) => {
        if (index < 0 || index > 2) return;
        const next = normalizePresets(get().presets).slice();
        next[index] = preset;
        set({ presets: next });
      },
  };
}

/**
 * Carreira SOLO: `cosmicfut:game` v6 guarda o global (mudo + slot ativo); o estado leve de cada carreira
 * fica em `cosmicfut:career:<slotId>` (gravado pela assinatura abaixo, lido no `merge` e no `openSlot`).
 */
export const useSoloGame = create<GameState>()(
  persist(
    (set, get) => gameSlice(set, get),
    {
      name: 'cosmicfut:game',
      version: 6,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ slotId, muted }) => ({ slotId, muted }),
      /**
       * v1 → v2: adiciona `tactic` (padrão da engine) e `lineup: null`.
       * Com lineup nulo, o AppShell roda o autoPick assim que o elenco do clube carrega.
       * v3 → v4: som desligado por padrão (ver abaixo).
       * v2 → v3: data/moral/temporada saem do localStorage (agora vivem na SeasonState, no IndexedDB).
       * Como não há save de temporada para essa carreira, o AppShell cria a SeasonState no primeiro boot.
       */
      migrate: (persisted, version) => {
        let s = { ...((persisted ?? {}) as Record<string, unknown>) };
        if (version < 2) s = { ...s, tactic: { ...DEFAULT_TACTIC }, lineup: null };
        if (version < 3) {
          delete s.date;
          delete s.morale;
          delete s.season;
          // carreiras antigas sem marcador ganham um (amarra o save novo do IndexedDB)
          s.startedAt ??= new Date().toISOString();
        }
        // v3 → v4: áudio passa a ser OFF por padrão; força o mudo em saves antigos (inclusive com som ligado)
        if (version < 4) s.muted = true;
        // v4 → v5: lista de observados do mercado (o áudio NÃO é tocado: mantém o mudo como está)
        if (version < 5) s.shortlist = [];
        // v5 → v6: slots de carreira. A carreira única vira o slot 1 (mesmo id do save migrado no IndexedDB):
        // clube, tática, escalação e observados vão para `cosmicfut:career:slot-1`; o mudo continua global.
        if (version < 6) {
          if (typeof s.clubId === 'string' && s.clubId) {
            if (!readSlotPrefs(MIGRATED_SLOT_ID)) writeSlotPrefs(MIGRATED_SLOT_ID, normalizePrefs(pickPrefs(s as Partial<GameState>)));
            s.slotId = MIGRATED_SLOT_ID;
          } else s.slotId = null;
          for (const k of SLOT_FIELDS) delete s[k];
        }
        return s as unknown as GameState;
      },
      // estado leve do slot ativo (síncrono: o localStorage é lido durante a hidratação)
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GameState>;
        const slotId = typeof p.slotId === 'string' ? p.slotId : null;
        const prefs = slotId ? readSlotPrefs(slotId) : null;
        return { ...current, muted: typeof p.muted === 'boolean' ? p.muted : current.muted, slotId: prefs ? slotId : null, ...(prefs ?? {}) };
      },
    },
  ),
);

// Grava o estado leve da carreira ativa no slot dela.
useSoloGame.subscribe((s, prev) => {
  if (!s.slotId) return;
  if (s.slotId === prev.slotId && SLOT_FIELDS.every((k) => s[k] === prev[k])) return;
  if (!s.clubId) return;
  writeSlotPrefs(s.slotId, pickPrefs(s));
});

/** Estado leve atual de um slot (o ativo vem do store; os outros do localStorage). */
export function slotPrefsOf(slotId: string): SlotPrefs | null {
  const s = useSoloGame.getState();
  return s.slotId === slotId ? pickPrefs(s) : readSlotPrefs(slotId);
}

/**
 * Modo ONLINE: mesmo formato, só em memória (não toca no save solo). O clube/tática/escalação vêm do
 * `season:snapshot` do servidor (store/online.ts) e as mudanças de tática/escalação voltam para o
 * servidor via `round:set-lineup` (com debounce). O áudio fica SEMPRE mudo no online.
 */
export const useOnlineGame = create<GameState>()((set, get) => ({
  ...gameSlice(set, get),
  muted: true,
  setMuted: () => undefined,
}));

const activeGame = () => (isOnline() ? useOnlineGame : useSoloGame);

function useGameProxy<T>(selector: (s: GameState) => T): T {
  const online = useIsOnline();
  // os dois hooks são sempre chamados (ordem estável de hooks); devolve o do modo ativo
  const solo = useSoloGame(selector);
  const net = useOnlineGame(selector);
  return online ? net : solo;
}

/**
 * Store do clube humano do MODO ATIVO (solo ou online). Mesma API de um hook Zustand:
 * `useGame(selector)`, `useGame.getState()`, `useGame.setState()`, `useGame.subscribe()`.
 */
export const useGame = Object.assign(useGameProxy, {
  getState: (): GameState => activeGame().getState(),
  setState: (patch: Partial<GameState>) => activeGame().setState(patch),
  subscribe: (listener: (s: GameState, prev: GameState) => void) => activeGame().subscribe(listener),
});

/** (17/11) Clube que as telas mostram: o do técnico ativo no hot-seat, senão o do jogo. */
export function useViewClubId(): string | null {
  return useGame((s) => s.activeClubId ?? s.clubId);
}

/** Escalação é válida para este elenco? (11 titulares existentes, sem repetidos). */
export function isLineupValid(lineup: Lineup | null, players: Player[]): lineup is Lineup {
  if (!lineup || lineup.starters.length !== 11) return false;
  const ids = new Set(players.map((p) => p.id));
  const all = [...lineup.starters, ...lineup.bench];
  return all.every((id) => ids.has(id)) && new Set(all).size === all.length;
}
