/**
 * `RelayStorage` sobre o SQLite do Durable Object (API síncrona `ctx.storage.sql`). Duas tabelas: `kv` (texto) e
 * `blob` (bytes do checkpoint, um pedaço por linha — bem abaixo do limite de 2 MB por valor).
 */
import type { RelayStorage } from './relay.ts';

export function sqlStorage(storage: DurableObjectStorage): RelayStorage {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS blob (k TEXT PRIMARY KEY, v BLOB NOT NULL)');
  return {
    get(key) {
      const rows = sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', key).toArray();
      return rows.length ? rows[0].v : null;
    },
    put(key, value) {
      sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, value);
    },
    del(key) {
      sql.exec('DELETE FROM kv WHERE k = ?', key);
    },
    keys(prefix) {
      return sql.exec<{ k: string }>('SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k', prefix, `${prefix}￿`).toArray().map((r) => r.k);
    },
    getBlob(key) {
      const rows = sql.exec<{ v: ArrayBuffer }>('SELECT v FROM blob WHERE k = ?', key).toArray();
      return rows.length ? new Uint8Array(rows[0].v) : null;
    },
    putBlob(key, value) {
      sql.exec('INSERT INTO blob (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, value);
    },
    delBlobs(prefix) {
      sql.exec('DELETE FROM blob WHERE k >= ? AND k < ?', prefix, `${prefix}￿`);
    },
    transaction(fn) {
      storage.transactionSync(fn);
    },
    deleteAll() {
      sql.exec('DELETE FROM kv');
      sql.exec('DELETE FROM blob');
    },
  };
}
