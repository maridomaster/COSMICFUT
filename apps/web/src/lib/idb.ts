/**
 * Wrapper mínimo sobre a API nativa do IndexedDB (sem dependências).
 * Um único object store chave→valor; valores são clonados estruturalmente (sem JSON).
 */
const DB_NAME = 'cosmicfut';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste navegador'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // outra aba atualizou o schema: fecha para não bloquear
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        let value: T | undefined;
        if (req) req.onsuccess = () => (value = req.result);
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(tx.error ?? req?.error ?? new Error('Transação IndexedDB falhou'));
      }),
  );
}

/** Operação de um lote atômico (uma única transação readwrite). */
export type IdbOp =
  | { put: string; value: unknown }
  | { del: string }
  /** copia o valor de `from` para `to` (se `from` existir) — lido e gravado dentro da mesma transação */
  | { copy: string; to: string };

/** Erro de cota (disco cheio / limite do navegador)? */
export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(msg);
}

export const idb = {
  /**
   * Lote atômico: todas as operações numa só transação (ou todas valem, ou nenhuma).
   * As requisições executam na ordem; um `copy` lê o valor antes de um `del` posterior da mesma chave.
   */
  batch(ops: IdbOp[]): Promise<void> {
    return openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const s = tx.objectStore(STORE);
          for (const op of ops) {
            if ('put' in op) s.put(op.value, op.put);
            else if ('del' in op) s.delete(op.del);
            else {
              const r = s.get(op.copy);
              const to = op.to;
              r.onsuccess = () => {
                if (r.result !== undefined) s.put(r.result, to);
              };
            }
          }
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Transação IndexedDB falhou'));
        }),
    );
  },
  get<T>(key: string): Promise<T | undefined> {
    return run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  },
  set<T>(key: string, value: T): Promise<void> {
    return run('readwrite', (s) => s.put(value, key)).then(() => undefined);
  },
  /** Existe a chave? (sem ler/clonar o valor — útil para saves grandes) */
  has(key: string): Promise<boolean> {
    return run<number>('readonly', (s) => s.count(key)).then((n) => (n ?? 0) > 0);
  },
  del(key: string): Promise<void> {
    return run('readwrite', (s) => s.delete(key)).then(() => undefined);
  },
};
