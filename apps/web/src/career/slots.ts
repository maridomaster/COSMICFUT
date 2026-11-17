/**
 * Slots de carreira solo (até 8) — API do thread principal.
 *
 * Armazenamento (todas as escritas no IndexedDB passam pela fila do worker da carreira):
 *  - `careers:index`        → índice (CareersIndex): id, nome, clube/escudo/cores, temporada, data, último save, tamanho, versão;
 *  - `career:<id>`          → save v2 (world + state + histórico de saldo + resumo da virada);
 *  - `career:<id>:tmp`      → escrita atômica (grava aqui e só então troca);
 *  - localStorage `cosmicfut:career:<id>` → estado leve do slot (tática, escalação, observados). O mudo é global.
 * Migração: o save único antigo (`career:current`) vira o slot `slot-1` (worker) e o estado leve de
 * `cosmicfut:game` v5 vira `cosmicfut:career:slot-1` (store/game.ts).
 */
import { create } from 'zustand';
import type { ClubIndexEntry } from '@cosmicfut/shared';
import { careerCall, onCareerSaved } from './client';
import { MAX_CAREER_SLOTS, type CareerSlotMeta } from './protocol';
import { newSlotId, normalizePrefs, removeSlotPrefs, slotPrefsOf, useSoloGame, writeSlotPrefs } from '@/store/game';
import { useSoloSeason } from '@/store/season';
import { useMatch } from '@/store/match';
import { useMode } from '@/store/mode';
import { resetMarketIndex } from '@/pages/market/searchClient';

export { MAX_CAREER_SLOTS };
export type { CareerSlotMeta };

interface SlotsStore {
  slots: CareerSlotMeta[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** o save único antigo acabou de virar o slot 1 */
  migrated: boolean;
}

export const useCareerSlots = create<SlotsStore>()(() => ({ slots: [], status: 'idle', error: null, migrated: false }));

const sortSlots = (s: CareerSlotMeta[]) => [...s].sort((a, b) => (b.savedAt ?? b.createdAt).localeCompare(a.savedAt ?? a.createdAt));

function setSlots(slots: CareerSlotMeta[]) {
  useCareerSlots.setState({ slots: sortSlots(slots), status: 'ready', error: null });
}

/** Lê o índice (e faz a migração do save único na primeira vez). */
export async function refreshSlots(): Promise<CareerSlotMeta[]> {
  if (useCareerSlots.getState().status !== 'ready') useCareerSlots.setState({ status: 'loading' });
  try {
    const r = await careerCall<'slots'>({ t: 'slots:list' });
    setSlots(r.index.slots);
    if (r.migratedFromCurrent) useCareerSlots.setState({ migrated: true });
    return r.index.slots;
  } catch (e) {
    useCareerSlots.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

// mantém o card do slot ativo atualizado a cada autosave
onCareerSaved((ev) => {
  if (ev.t !== 'saved') return;
  const { slots, status } = useCareerSlots.getState();
  if (status !== 'ready') return;
  const has = slots.some((s) => s.id === ev.slotId);
  setSlots(has ? slots.map((s) => (s.id === ev.slotId ? ev.meta : s)) : [...slots, ev.meta]);
});

/** Solta a carreira em memória (worker, stores, partida, índice do mercado) sem apagar nada. */
async function unloadActive() {
  useMatch.getState().reset();
  resetMarketIndex();
  await useSoloSeason.getState().unload();
}

/** Continuar uma carreira: troca de slot de forma limpa (o AppShell faz o boot do slot novo). */
export async function openCareer(slot: CareerSlotMeta): Promise<void> {
  const game = useSoloGame.getState();
  const same = game.slotId === slot.id && useSoloSeason.getState().save?.slotId === slot.id;
  if (!same) {
    await unloadActive();
    useSoloGame.getState().openSlot(slot.id, {
      clubId: slot.club.id,
      clubPreview: { id: slot.club.id, name: slot.club.name, colors: slot.club.colors, crestMini: slot.club.crestMini },
      startedAt: slot.createdAt,
    });
  }
  useMode.getState().setMode('solo');
}

/** Nova carreira com o clube escolhido (novo slot). Lança erro se o limite foi atingido. */
export async function startNewCareer(club: ClubIndexEntry): Promise<void> {
  const slots = useCareerSlots.getState().status === 'ready' ? useCareerSlots.getState().slots : await refreshSlots();
  if (slots.length >= MAX_CAREER_SLOTS) {
    throw new Error(`Você já tem ${MAX_CAREER_SLOTS} carreiras. Exclua ou exporte uma para começar outra.`);
  }
  await unloadActive();
  useSoloGame.getState().selectClub(club, newSlotId());
  useMode.getState().setMode('solo');
}

export async function renameCareer(slotId: string, name: string): Promise<void> {
  const r = await careerCall<'slots'>({ t: 'slots:rename', slotId, name });
  setSlots(r.index.slots);
}

/** "Salvar como": copia dados + estado leve para um slot novo. */
export async function duplicateCareer(slot: CareerSlotMeta, name?: string): Promise<CareerSlotMeta> {
  const newId = newSlotId();
  const r = await careerCall<'slot'>({ t: 'slots:duplicate', slotId: slot.id, newId, name: name ?? `${slot.name} (cópia)` });
  const prefs = slotPrefsOf(slot.id);
  if (prefs) writeSlotPrefs(newId, prefs);
  await refreshSlots();
  return r.meta!;
}

/** Exclui (irreversível). Se for a carreira ativa, ela é fechada. */
export async function deleteCareer(slotId: string): Promise<void> {
  const active = useSoloGame.getState().slotId === slotId;
  if (active) await unloadActive();
  const r = await careerCall<'slots'>({ t: 'slots:delete', slotId });
  removeSlotPrefs(slotId);
  if (active) useSoloGame.getState().closeSlot();
  setSlots(r.index.slots);
}

/** Gera o arquivo .json da carreira (localmente, no worker). */
export async function exportCareer(slotId: string): Promise<{ blob: Blob; filename: string; bytes: number }> {
  const r = await careerCall<'exported'>({ t: 'slots:export', slotId, prefs: slotPrefsOf(slotId) as Record<string, unknown> | null });
  return { blob: r.blob, filename: r.filename, bytes: r.bytes };
}

/** Baixa um Blob como arquivo (link temporário; nada sai do navegador). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Importa um arquivo exportado: valida formato/versão e migra no worker; cria um slot novo. */
export async function importCareer(file: File | Blob): Promise<CareerSlotMeta> {
  if (file.size > 200 * 1024 * 1024) throw new Error('Arquivo grande demais para uma carreira.');
  const text = await file.text();
  const newId = newSlotId();
  const r = await careerCall<'slot'>({ t: 'slots:import', text, newId });
  const meta = r.meta!;
  const prefs = r.prefs ? normalizePrefs(r.prefs) : normalizePrefs({});
  // identidade do slot vem do save (o arquivo pode ter prefs de outro clube)
  writeSlotPrefs(newId, {
    ...(prefs.clubId === meta.club.id ? prefs : normalizePrefs({})),
    clubId: meta.club.id,
    clubPreview: { id: meta.club.id, name: meta.club.name, colors: meta.club.colors, crestMini: meta.club.crestMini },
    startedAt: meta.createdAt,
  });
  await refreshSlots();
  return meta;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // inspeção no navegador (validação dos slots)
  const w = window as unknown as { __cf?: Record<string, unknown> };
  w.__cf = { ...(w.__cf ?? {}), slots: { useCareerSlots, refreshSlots, exportCareer, importCareer, duplicateCareer, deleteCareer, renameCareer, openCareer } };
}
