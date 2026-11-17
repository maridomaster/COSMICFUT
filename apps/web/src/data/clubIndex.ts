/**
 * Registro síncrono do índice de clubes (clubs-index.json) para nomes/escudos/cores de QUALQUER clube.
 * A carreira tem ≈690 clubes e só o humano tem o bundle completo carregado: os componentes
 * (ClubCrest, clubLabel) caem aqui quando o bundle não está em cache.
 */
import type { ClubIndexEntry } from '@cosmicfut/shared';
import { loadClubIndex } from './source';

let index = new Map<string, ClubIndexEntry>();
let loading: Promise<void> | null = null;

export function ensureClubIndex(): Promise<void> {
  if (index.size) return Promise.resolve();
  loading ??= loadClubIndex()
    .then(({ data }) => {
      index = new Map(data.map((c) => [c.id, c]));
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

export function clubIndexEntry(id: string): ClubIndexEntry | undefined {
  return index.get(id);
}

/** Nome curto derivado (o índice não tem `shortName`). */
export function shortFromName(name: string): string {
  if (name.length <= 14) return name;
  const words = name.split(/\s+/).filter((w) => !/^(de|da|do|dos|das|e|FC|EC|SC|AC|CA|CR|SE|EC)$/i.test(w));
  const s = words.slice(0, 2).join(' ');
  return s.length >= 3 ? s : name;
}
