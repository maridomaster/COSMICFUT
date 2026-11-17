/**
 * Modo de jogo global: 'solo' (carreira local, save no IndexedDB) ou 'online' (sala no servidor).
 *
 * Os hooks `useGame` e `useSeason` são "proxies": leem do store do modo ativo. Assim Dashboard,
 * Calendário, Elenco, Táticas etc. funcionam nos dois modos sem saber de onde vêm os dados.
 * Os dois modos nunca se misturam: o online não toca no save solo (localStorage/IndexedDB).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type GameMode = 'solo' | 'online';

interface ModeStore {
  mode: GameMode;
  setMode: (mode: GameMode) => void;
}

export const useMode = create<ModeStore>()(
  persist(
    (set) => ({
      mode: 'solo',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'cosmicfut:mode',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ mode }) => ({ mode }),
    },
  ),
);

export const getMode = (): GameMode => useMode.getState().mode;
export const isOnline = (): boolean => getMode() === 'online';
/** Hook: o modo ativo é o online? */
export const useIsOnline = (): boolean => useMode((s) => s.mode === 'online');
