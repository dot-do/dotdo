/**
 * DO Storage - libSQL-backed DurableObjectStorage implementation
 *
 * Provides a drop-in replacement for Cloudflare DurableObjectStorage
 * that can run on any platform (Vercel, fly.io, K8s, etc.) with:
 *
 * - KV API (get, put, delete, list)
 * - SQL API (exec with prepared statements)
 * - Transaction support
 * - Iceberg checkpoint/restore for time-travel
 *
 * @example
 * ```typescript
 * import { LibSQLStorage } from 'dotdo/db/do-storage'
 *
 * const storage = new LibSQLStorage({
 *   doId: 'my-do-123',
 *   tursoUrl: 'libsql://my-db.turso.io',
 *   tursoToken: env.TURSO_AUTH_TOKEN,
 * })
 *
 * // Use like regular DO storage
 * await storage.put('key', { value: 42 })
 * const data = await storage.get('key')
 *
 * // SQL operations
 * storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
 * storage.sql.exec('INSERT INTO users (id, name) VALUES (?, ?)', 1, 'Alice')
 *
 * // Transactions
 * await storage.transaction(async (txn) => {
 *   await txn.put('a', 1)
 *   await txn.put('b', 2)
 * })
 *
 * // Iceberg snapshots
 * const snapshotId = await storage.checkpoint()
 * await storage.restore(snapshotId)
 * ```
 *
 * @see dotdo-hstgj libSQL DO Storage Adapter (TDD)
 * @module db/do-storage
 */

export {
  LibSQLStorage,
  StorageLimitError,
  DEFAULT_STORAGE_LIMITS,
  type LibSQLStorageOptions,
  type ListOptions,
  type SqlStorage,
  type SqlStorageCursor,
  type LibSQLTransaction,
  type StorageLimits,
  type AlarmOptions,
  type StorageStats,
} from './libsql-storage'
