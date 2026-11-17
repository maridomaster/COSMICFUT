/**
 * (Carreira online salva) "Minhas carreiras online": as carreiras que ESTE navegador já entrou, guardadas no
 * localStorage por origem do servidor (`cosmicfut:online-careers:<SERVER_URL>`), cada uma com o token durável da vaga.
 * A situação ao vivo (data, técnicos on-line, vez de quem) vem de POST /careers/status — o servidor nunca devolve tokens.
 */
import { create } from 'zustand';
import type { Ack, CareerStatus } from '@cosmicfut/shared';
import { SERVER_URL } from './config';

export interface SavedCareer {
  code: string;
  token: string;
  playerId: string;
  nickname: string;
  joinedAt: number;
  /** última vez aberta neste navegador */
  openedAt: number;
}

const KEY = `cosmicfut:online-careers:${SERVER_URL}`;
const MAX = 30;

function read(): SavedCareer[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedCareer[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.code === 'string' && typeof c.token === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: SavedCareer[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* modo privado: segue sem persistir */
  }
}

interface CareersStore {
  list: SavedCareer[];
  status: Record<string, CareerStatus>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useSavedCareers = create<CareersStore>()((set) => ({
  list: read(),
  status: {},
  loading: false,
  error: null,
  refresh: async () => {
    const list = read();
    set({ list });
    if (!list.length) return set({ status: {}, error: null });
    set({ loading: true });
    try {
      const res = await fetch(`${SERVER_URL}/careers/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: list.map((c) => ({ code: c.code, token: c.token })) }),
      });
      const j = (await res.json()) as Ack<CareerStatus[]>;
      if (!j.ok) return set({ error: j.error });
      const status: Record<string, CareerStatus> = {};
      for (const s of j.data) status[s.code] = s;
      set({ status, error: null });
    } catch {
      set({ error: 'Servidor indisponível.' });
    } finally {
      set({ loading: false });
    }
  },
}));

/** Guarda/atualiza a carreira (entrar, criar, voltar). */
export function rememberCareer(c: Omit<SavedCareer, 'joinedAt' | 'openedAt'> & { joinedAt?: number }): void {
  const list = read();
  const prev = list.find((x) => x.code === c.code);
  const entry: SavedCareer = { ...prev, ...c, joinedAt: prev?.joinedAt ?? c.joinedAt ?? Date.now(), openedAt: Date.now() } as SavedCareer;
  write([entry, ...list.filter((x) => x.code !== c.code)]);
  useSavedCareers.setState({ list: read() });
}

/** Remove só deste navegador (a carreira continua no servidor). */
export function forgetCareer(code: string): void {
  write(read().filter((x) => x.code !== code));
  const status = { ...useSavedCareers.getState().status };
  delete status[code];
  useSavedCareers.setState({ list: read(), status });
}

export function savedCareer(code: string): SavedCareer | undefined {
  return read().find((x) => x.code === code);
}
