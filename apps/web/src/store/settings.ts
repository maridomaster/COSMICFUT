import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setDisplayCurrency, type DisplayCurrency } from '@/lib/format';

/**
 * (Etapa 4) Preferências globais de exibição (localStorage `cosmicfut:settings`). A moeda do jogo é o euro; a
 * exibição em reais usa o câmbio fixo 1 € = R$ 6,30 (só a formatação muda — os valores do save são em euros).
 */
export interface SettingsState {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'EUR',
      setCurrency: (currency) => {
        setDisplayCurrency(currency);
        set({ currency });
      },
    }),
    {
      name: 'cosmicfut:settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ currency }) => ({ currency }),
      onRehydrateStorage: () => (s) => {
        if (s) setDisplayCurrency(s.currency === 'BRL' ? 'BRL' : 'EUR');
      },
    },
  ),
);

// aplica já no carregamento do módulo (a hidratação do localStorage é síncrona)
setDisplayCurrency(useSettings.getState().currency === 'BRL' ? 'BRL' : 'EUR');
