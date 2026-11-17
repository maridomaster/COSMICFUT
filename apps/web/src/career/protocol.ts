/**
 * Protocolo thread principal ⇄ worker da carreira (career.worker.ts).
 *
 * O worker é o DONO do estado durante a simulação: guarda `world` + `state`, roda `advanceDay`
 * com `inPlace` e grava no IndexedDB. O thread principal recebe cópias (structured clone) ao fim
 * de cada operação para desenhar a UI e montar o Match Day.
 */
import type { Player } from '@cosmicfut/shared';
import type {
  CoachActionResult, CoachCareer, Fixture, HotseatManager, HotseatState, Lineup, MatchResult, RenewTerms, SeasonState, SeasonSummary, SkipReason, SkipStops, Tactic, TacticPreset, WorldState,
} from '@cosmicfut/engine';

/**
 * Renovações na virada: lista de ids (Fase 1, aceita sempre) ou mapa id → { wage, years } (Fase 2: o jogador
 * pode recusar salário abaixo de `renewalDemand`; recusas em `summary.contracts.refused`).
 */
export type RenewInput = string[] | Record<string, RenewTerms | true>;

/**
 * Versão do save de carreira (IndexedDB). v1 = temporada antiga (só a liga, chave `save:current`); v2 = carreira de
 * ano civil centrada num país (Fases 1–3); v3 = (Etapa 1) linha do tempo global com calendário duplo e escopo
 * geográfico. Saves v2 não migram: aparecem como "legado — iniciar nova carreira" (dá para exportar/excluir).
 */
export const CAREER_SAVE_VERSION = 3;

/** (Etapa 1) Slot com save de uma versão anterior (não abre; só exportar/excluir). */
export const isLegacySlot = (meta: { v: number; savedAt: string | null }) => !!meta.savedAt && meta.v < CAREER_SAVE_VERSION;
/** Slot único de antes dos slots múltiplos: migrado para o slot 1 (`career:slot-1`) na primeira abertura. */
export const CAREER_SAVE_KEY = 'career:current';
/** Save do modo antigo (v1): detectado para avisar o jogador e descartado. */
export const LEGACY_SAVE_KEY = 'save:current';

/* ── Slots de carreira ── */
export const MAX_CAREER_SLOTS = 8;
/** Índice dos slots (metadados leves, lidos sem abrir os saves). */
export const CAREERS_INDEX_KEY = 'careers:index';
/** Id do slot que recebe o save migrado de `career:current`. */
export const FIRST_SLOT_ID = 'slot-1';
/** Dados do slot: `career:<id>`; escrita atômica via `career:<id>:tmp`. */
export const slotKey = (slotId: string) => `career:${slotId}`;
export const slotTmpKey = (slotId: string) => `career:${slotId}:tmp`;

export interface SlotClub {
  id: string;
  name: string;
  colors: { primary: string; secondary: string };
  crestMini: string | null;
}

export interface CareerSlotMeta {
  id: string;
  /** nome editável (padrão: clube + ano) */
  name: string;
  club: SlotClub;
  /** temporada e data atuais do jogo */
  season: number;
  date: string;
  /** início da carreira (marcador antigo `startedAt`) */
  createdAt: string;
  /** último salvamento (ISO, relógio real) */
  savedAt: string | null;
  /** tamanho aproximado do save (JSON, bytes) */
  bytes: number;
  /** versão do save (CAREER_SAVE_VERSION) */
  v: number;
}

export interface CareersIndex {
  v: 1;
  slots: CareerSlotMeta[];
}

/** Estado leve por slot (tática, escalação, observados…) — vive no localStorage, viaja no arquivo exportado. */
export type SlotPrefsPayload = Record<string, unknown>;

/** Arquivo exportado (.json). */
export const CAREER_FILE_FORMAT = 'cosmicfut-career';
export const CAREER_FILE_VERSION = 1;
export interface CareerFile {
  format: typeof CAREER_FILE_FORMAT;
  fileVersion: number;
  exportedAt: string;
  meta: CareerSlotMeta;
  prefs: SlotPrefsPayload | null;
  save: CareerSave;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface CareerSave {
  v: number;
  kind: 'career';
  clubId: string;
  startedAt: string | null;
  world: WorldState;
  state: SeasonState;
  history: BalancePoint[];
  /** resumo da última virada (aposentadorias, juniores, contratos) */
  summary: SeasonSummary | null;
  savedAt: string;
}

export interface HumanSetup {
  tactic: Tactic;
  lineup: Lineup | null;
  /** (Táticas) 3 vagas de predefinição do técnico ativo (ClubSeasonState.tacticPresets) */
  presets?: (TacticPreset | null)[];
}

/** Por que o Continuar parou. (Fase 3) 'fired' = técnico demitido; 'job' = proposta/resposta de emprego; 'coach' = carreira do técnico ativada num save antigo. */
export type StopReason = 'matchday' | 'season-over' | 'news' | 'offer' | 'limit' | 'idle' | 'migrated' | 'fired' | 'job' | 'coach' | 'skip';

/** (Fase 3) Ações da carreira do técnico (executadas no worker, dono do world/state). */
export type CoachAction =
  | { type: 'apply'; vacancyId: string }
  | { type: 'declare'; clubId: string }
  | { type: 'accept'; offerId: string; payFine?: boolean }
  | { type: 'decline'; offerId: string }
  | { type: 'resign'; mutual?: boolean; national?: boolean }
  | { type: 'read'; ids?: string[] }
  | { type: 'rename'; name: string }
  /** somente em desenvolvimento: força estabilidade/confiança/reputação ou a demissão */
  | { type: 'dev'; stability?: number; board?: number; fans?: number; reputation?: number; fire?: boolean };

/** (Fase 3) Parte da carreira do técnico que muda a cada operação (o thread principal remenda o `world`). */
export interface CoachPatch {
  coach: CoachCareer | null;
  humanClubIds: string[];
}

export interface PlayedLite {
  fixture: Fixture;
  result: MatchResult;
}

export type ToWorker =
  | { t: 'init'; id: number; clubId: string; humanPlayers: Player[] | null }
  /** carrega o slot (grava antes o que estiver pendente do slot anterior) */
  | { t: 'load'; id: number; slotId: string; clubId: string }
  | { t: 'create'; id: number; slotId: string; clubId: string; name: string; club: SlotClub; startedAt: string | null; season: number; seed: string; coachName?: string; hotseat?: HotseatManager[] }
  /** "Salvar agora" */
  | { t: 'save'; id: number }
  /** solta a carreira em memória (troca de slot): grava o pendente e limpa tudo */
  | { t: 'unload'; id: number }
  | { t: 'slots:list'; id: number }
  | { t: 'slots:get'; id: number; slotId: string }
  | { t: 'slots:rename'; id: number; slotId: string; name: string }
  | { t: 'slots:duplicate'; id: number; slotId: string; newId: string; name: string }
  | { t: 'slots:delete'; id: number; slotId: string }
  | { t: 'slots:export'; id: number; slotId: string; prefs: SlotPrefsPayload | null }
  | { t: 'slots:import'; id: number; text: string; newId: string }
  /** 'job' (Fase 3): técnico desempregado — avança até uma proposta/resposta (com virada automática no fim do ano) */
  | { t: 'continue'; id: number; setup: HumanSetup; mode: 'match' | 'end' | 'job' }
  | { t: 'coach'; id: number; action: CoachAction }
  | { t: 'finishDay'; id: number; setup: HumanSetup; fixtureId: string; result: MatchResult }
  | { t: 'setState'; id: number; state: SeasonState }
  | { t: 'rollover'; id: number; renew: RenewInput }
  /** (17/11) hot-seat: concluir a vez do técnico ativo (passa ao próximo) ou passar o controle a um técnico; setup = a do ativo que sai */
  | { t: 'hotseat'; id: number; setup: HumanSetup; action: 'end-turn' | 'activate'; index?: number }
  /**
   * (Calendário) Pular no tempo até `until` com o assistente (engine `TimeSkip`): progresso por `progress` (no máximo
   * ~10/s), fim por `skipped`. Grava no fim (e no cancelamento).
   */
  | { t: 'skip'; id: number; setup: HumanSetup; until: string; stops: Partial<SkipStops> }
  /** cancela o salto em andamento (tratado FORA da fila: para no fim do dia atual) */
  | { t: 'skipCancel'; id: number }
  /** apaga os dados do slot ativo (mantém o slot no índice) — save antigo (v1) / carreira nova no mesmo slot */
  | { t: 'discard'; id: number; slotId: string | null; legacy?: boolean };

export interface SnapshotPayload {
  world: WorldState;
  state: SeasonState;
  history: BalancePoint[];
  summary: SeasonSummary | null;
}

export type FromWorker =
  | { t: 'ok'; id: number; ms: number }
  /** `migrated`: o save era da Fase 1 e foi migrado (migrateCareer) — avisar uma vez */
  /** `legacyCareer` (Etapa 1): o slot tem uma carreira de versão anterior (rev < 3) — não abre */
  | { t: 'loaded'; id: number; save: SnapshotPayload | null; meta: CareerSlotMeta | null; legacy: boolean; legacyCareer?: boolean; otherCareer: boolean; migrated?: boolean; coachCreated?: boolean; econMigrated?: boolean; ms: number }
  /** índice dos slots; `migratedFromCurrent`: o save único antigo virou o slot 1 nesta chamada */
  | { t: 'slots'; id: number; index: CareersIndex; migratedFromCurrent?: boolean }
  | { t: 'slot'; id: number; meta: CareerSlotMeta | null; prefs?: SlotPrefsPayload | null }
  | { t: 'exported'; id: number; blob: Blob; filename: string; bytes: number }
  | { t: 'snapshot'; id: number; payload: SnapshotPayload; ms: number }
  | {
      t: 'advanced';
      id: number;
      state: SeasonState;
      history: BalancePoint[];
      reason: StopReason;
      days: number;
      games: number;
      /** só no finishDay: jogos do dia (resumo da rodada) */
      played?: PlayedLite[];
      /** texto da notícia que fez parar (reason 'news' | 'offer') */
      note?: string;
      /** (Fase 3) carreira do técnico depois da operação */
      coach?: CoachPatch;
      /** (17/11) hot-seat: quem está com o controle depois da operação (dia de jogo passa a quem joga) */
      hotseat?: HotseatState;
      /** (Fase 3) o mundo foi substituído (virada automática do técnico desempregado) */
      world?: WorldState;
      summary?: SeasonSummary | null;
      ms: number;
      /** ms gastos só nos advanceDay (sem clonagem/salvamento) */
      simMs: number;
      saveMs: number;
    }
  | { t: 'progress'; id: number; day: number; total: number; date: string }
  /** (Calendário) fim do salto: estado completo (o mundo muda nas viradas), motivo da parada e tempos */
  | {
      t: 'skipped';
      id: number;
      payload: SnapshotPayload;
      reason: SkipReason;
      note?: string;
      days: number;
      games: number;
      turnovers: number;
      ms: number;
      simMs: number;
      rolloverMs: number;
      bytes: number;
    }
  /** (Fase 3) resultado de uma ação da carreira do técnico; `state` sempre (caixa, clube humano e escalação podem mudar) */
  | { t: 'coachDone'; id: number; result: CoachActionResult; coach: CoachPatch; state: SeasonState; meta: CareerSlotMeta | null; ms: number }
  /** gravação no IndexedDB concluída (tempo e tamanho aproximado em JSON) */
  | { t: 'saved'; ms: number; bytes: number; slotId: string; meta: CareerSlotMeta }
  /** falha ao gravar (quota: disco/limite do navegador cheio) */
  | { t: 'saveError'; slotId: string; quota: boolean; message: string }
  | { t: 'error'; id: number; message: string };
