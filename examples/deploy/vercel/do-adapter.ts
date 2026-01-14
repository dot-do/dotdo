/**
 * Vercel DO Adapter
 *
 * Adapts stateless Durable Objects for Vercel Edge Functions.
 * Provides state management via libSQL/Turso and concurrency
 * control via ConsistencyGuard.
 *
 * @module deploy/vercel/do-adapter
 *
 * @example
 * ```typescript
 * import { createVercelDoHandler } from 'dotdo/deploy/vercel'
 * import { Business } from 'dotdo/objects'
 *
 * const handler = createVercelDoHandler(Business, env)
 * const response = await handler.fetch(request, 'my-business-id')
 * ```
 */

import { createClient, type Client } from '@libsql/client/web'
import type { VercelEnv } from './env.d'
import { isConsistencyGuardEnabled, getLockTtl } from './env.d'
import {
  HybridConsistencyGuard,
  executeWithLock,
  type Lock,
  type ConsistencyGuard,
} from '../../db/spikes/consistency-poc'

// ============================================================================
// TYPES
// ============================================================================

/**
 * DO class constructor interface
 * Matches the signature of dotdo DO classes
 */
export interface DOClass {
  new (state: VercelDoState, env: VercelEnv): DOInstance
  readonly $type?: string
  readonly name: string
}

/**
 * DO instance interface
 */
export interface DOInstance {
  fetch(request: Request): Promise<Response>
  initialize?(config: { ns: string; parent?: string }): Promise<void>
}

/**
 * Vercel DO state - replaces DurableObjectState
 */
export class VercelDoState {
  readonly id: VercelDoId
  readonly storage: VercelDoStorage

  private _db: Client | null = null
  private _guard: ConsistencyGuard | null = null
  private _lock: Lock | null = null

  constructor(
    doId: string,
    private tursoUrl: string,
    private tursoToken: string,
    private nodeId: string
  ) {
    this.id = new VercelDoId(doId)
    this.storage = new VercelDoStorage(
      doId,
      () => this.getDb(),
      () => this._lock?.fencingToken
    )
  }

  /**
   * Get or create libSQL client
   */
  getDb(): Client {
    if (!this._db) {
      this._db = createClient({
        url: this.tursoUrl,
        authToken: this.tursoToken,
      })
    }
    return this._db
  }

  /**
   * Get or create consistency guard
   */
  getGuard(): ConsistencyGuard {
    if (!this._guard) {
      this._guard = new HybridConsistencyGuard(
        this.getDb(),
        this.nodeId
      )
    }
    return this._guard
  }

  /**
   * Set the current lock (internal use)
   */
  setLock(lock: Lock | null): void {
    this._lock = lock
  }

  /**
   * Get the current lock
   */
  getLock(): Lock | null {
    return this._lock
  }

  /**
   * Get the current fencing token
   */
  getFencingToken(): number | undefined {
    return this._lock?.fencingToken
  }

  /**
   * Close resources
   */
  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }

  /**
   * Block concurrency alarm - no-op for Vercel
   * (alarms not supported in edge functions)
   */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback()
  }

  /**
   * Wait until - returns immediately for Vercel
   * (no hibernation support in edge functions)
   */
  waitUntil(_promise: Promise<unknown>): void {
    // No-op - Vercel edge functions don't support waitUntil
  }
}

/**
 * Vercel DO ID - replaces DurableObjectId
 */
export class VercelDoId {
  private _id: string

  constructor(id: string) {
    this._id = id
  }

  toString(): string {
    return this._id
  }

  equals(other: VercelDoId): boolean {
    return this._id === other._id
  }

  get name(): string | undefined {
    return this._id
  }
}

/**
 * Vercel DO Storage - replaces DurableObjectStorage
 * Backed by libSQL/Turso
 */
export class VercelDoStorage {
  private cache = new Map<string, unknown>()
  private dirty = new Set<string>()

  constructor(
    private doId: string,
    private getDb: () => Client,
    private getFencingToken: () => number | undefined
  ) {}

  /**
   * Get a value from storage
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key) as T
    }

    // Query database
    const db = this.getDb()
    const result = await db.execute({
      sql: 'SELECT value FROM do_storage WHERE do_id = ? AND key = ?',
      args: [this.doId, key],
    })

    if (result.rows.length === 0) {
      return undefined
    }

    const value = JSON.parse(result.rows[0]['value'] as string) as T
    this.cache.set(key, value)
    return value
  }

  /**
   * Get multiple values from storage
   */
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    const uncachedKeys: string[] = []

    // Check cache first
    for (const key of keys) {
      if (this.cache.has(key)) {
        result.set(key, this.cache.get(key) as T)
      } else {
        uncachedKeys.push(key)
      }
    }

    // Query database for uncached keys
    if (uncachedKeys.length > 0) {
      const db = this.getDb()
      const placeholders = uncachedKeys.map(() => '?').join(',')
      const queryResult = await db.execute({
        sql: `SELECT key, value FROM do_storage WHERE do_id = ? AND key IN (${placeholders})`,
        args: [this.doId, ...uncachedKeys],
      })

      for (const row of queryResult.rows) {
        const key = row['key'] as string
        const value = JSON.parse(row['value'] as string) as T
        result.set(key, value)
        this.cache.set(key, value)
      }
    }

    return result
  }

  /**
   * Put a value into storage
   */
  async put<T>(key: string, value: T): Promise<void> {
    const db = this.getDb()
    const fencingToken = this.getFencingToken()

    await db.execute({
      sql: `
        INSERT INTO do_storage (do_id, key, value, fencing_token, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (do_id, key) DO UPDATE SET
          value = excluded.value,
          fencing_token = excluded.fencing_token,
          updated_at = excluded.updated_at
        WHERE do_storage.fencing_token IS NULL OR do_storage.fencing_token <= excluded.fencing_token
      `,
      args: [this.doId, key, JSON.stringify(value), fencingToken ?? null, Date.now()],
    })

    this.cache.set(key, value)
    this.dirty.add(key)
  }

  /**
   * Put multiple values into storage
   */
  async put<T>(entries: Record<string, T>): Promise<void> {
    const db = this.getDb()
    const fencingToken = this.getFencingToken()
    const now = Date.now()

    const statements = Object.entries(entries).map(([key, value]) => ({
      sql: `
        INSERT INTO do_storage (do_id, key, value, fencing_token, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (do_id, key) DO UPDATE SET
          value = excluded.value,
          fencing_token = excluded.fencing_token,
          updated_at = excluded.updated_at
        WHERE do_storage.fencing_token IS NULL OR do_storage.fencing_token <= excluded.fencing_token
      `,
      args: [this.doId, key, JSON.stringify(value), fencingToken ?? null, now],
    }))

    await db.batch(statements)

    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value)
      this.dirty.add(key)
    }
  }

  /**
   * Delete a value from storage
   */
  async delete(key: string): Promise<boolean> {
    const db = this.getDb()
    const result = await db.execute({
      sql: 'DELETE FROM do_storage WHERE do_id = ? AND key = ?',
      args: [this.doId, key],
    })

    this.cache.delete(key)
    this.dirty.delete(key)

    return result.rowsAffected > 0
  }

  /**
   * Delete multiple values from storage
   */
  async delete(keys: string[]): Promise<number> {
    const db = this.getDb()
    const placeholders = keys.map(() => '?').join(',')
    const result = await db.execute({
      sql: `DELETE FROM do_storage WHERE do_id = ? AND key IN (${placeholders})`,
      args: [this.doId, ...keys],
    })

    for (const key of keys) {
      this.cache.delete(key)
      this.dirty.delete(key)
    }

    return result.rowsAffected
  }

  /**
   * List keys in storage
   */
  async list<T = unknown>(options?: {
    prefix?: string
    start?: string
    end?: string
    limit?: number
    reverse?: boolean
  }): Promise<Map<string, T>> {
    const db = this.getDb()
    const conditions: string[] = ['do_id = ?']
    const args: (string | number)[] = [this.doId]

    if (options?.prefix) {
      conditions.push("key LIKE ? || '%'")
      args.push(options.prefix)
    }

    if (options?.start) {
      conditions.push('key >= ?')
      args.push(options.start)
    }

    if (options?.end) {
      conditions.push('key < ?')
      args.push(options.end)
    }

    const orderDir = options?.reverse ? 'DESC' : 'ASC'
    const limitClause = options?.limit ? `LIMIT ${options.limit}` : ''

    const result = await db.execute({
      sql: `
        SELECT key, value FROM do_storage
        WHERE ${conditions.join(' AND ')}
        ORDER BY key ${orderDir}
        ${limitClause}
      `,
      args,
    })

    const map = new Map<string, T>()
    for (const row of result.rows) {
      const key = row['key'] as string
      const value = JSON.parse(row['value'] as string) as T
      map.set(key, value)
      this.cache.set(key, value)
    }

    return map
  }

  /**
   * Delete all values for this DO
   */
  async deleteAll(): Promise<void> {
    const db = this.getDb()
    await db.execute({
      sql: 'DELETE FROM do_storage WHERE do_id = ?',
      args: [this.doId],
    })

    this.cache.clear()
    this.dirty.clear()
  }

  /**
   * Sync not supported in Vercel
   */
  sync(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * Transaction support
   */
  async transaction<T>(callback: (txn: VercelDoStorage) => Promise<T>): Promise<T> {
    // For now, just execute in the same storage context
    // Full transaction support would require libSQL transaction API
    return callback(this)
  }

  /**
   * Get alarm time - not supported in Vercel
   */
  getAlarm(): Promise<number | null> {
    return Promise.resolve(null)
  }

  /**
   * Set alarm - not supported in Vercel
   */
  setAlarm(_time: number | Date): Promise<void> {
    console.warn('[VercelDoStorage] Alarms are not supported in Vercel Edge Functions')
    return Promise.resolve()
  }

  /**
   * Delete alarm - not supported in Vercel
   */
  deleteAlarm(): Promise<void> {
    return Promise.resolve()
  }
}

// ============================================================================
// STORAGE SCHEMA
// ============================================================================

/**
 * SQL schema for DO storage table
 */
export const DO_STORAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS do_storage (
  do_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  fencing_token INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (do_id, key)
);

CREATE INDEX IF NOT EXISTS idx_do_storage_do_id ON do_storage(do_id);
CREATE INDEX IF NOT EXISTS idx_do_storage_key_prefix ON do_storage(do_id, key);
`

// ============================================================================
// HANDLER
// ============================================================================

/**
 * Vercel DO Handler interface
 */
export interface VercelDoHandler {
  /**
   * Handle a request for a DO
   */
  fetch(request: Request, doId: string): Promise<Response>

  /**
   * Initialize the handler (create tables if needed)
   */
  initialize(): Promise<void>
}

/**
 * Create a Vercel DO handler for the given class
 */
export function createVercelDoHandler(
  DoClass: DOClass,
  env: VercelEnv
): VercelDoHandler {
  const nodeId = env.NODE_ID || `vercel-${Math.random().toString(36).slice(2, 8)}`
  const useConsistencyGuard = isConsistencyGuardEnabled(env)
  const lockTtl = getLockTtl(env)

  let initialized = false

  /**
   * Ensure storage tables exist
   */
  async function ensureInitialized(): Promise<void> {
    if (initialized) return

    const db = createClient({
      url: env.TURSO_URL,
      authToken: env.TURSO_TOKEN,
    })

    try {
      await db.executeMultiple(DO_STORAGE_SCHEMA)
      initialized = true
    } finally {
      db.close()
    }
  }

  /**
   * Handle request without consistency guard
   */
  async function handleWithoutGuard(
    request: Request,
    doId: string
  ): Promise<Response> {
    const state = new VercelDoState(doId, env.TURSO_URL, env.TURSO_TOKEN, nodeId)

    try {
      const instance = new DoClass(state, env)

      // Initialize if method exists
      if (instance.initialize) {
        await instance.initialize({ ns: doId })
      }

      return await instance.fetch(request)
    } finally {
      state.close()
    }
  }

  /**
   * Handle request with consistency guard
   */
  async function handleWithGuard(
    request: Request,
    doId: string
  ): Promise<Response> {
    const state = new VercelDoState(doId, env.TURSO_URL, env.TURSO_TOKEN, nodeId)
    const guard = state.getGuard()

    try {
      // Initialize guard tables
      await (guard as HybridConsistencyGuard).initialize()

      // Execute with lock
      return await executeWithLock(guard, {
        doId,
        lockOptions: { ttlMs: lockTtl },
        operation: async (lock) => {
          state.setLock(lock)

          const instance = new DoClass(state, env)

          // Initialize if method exists
          if (instance.initialize) {
            await instance.initialize({ ns: doId })
          }

          return instance.fetch(request)
        },
      })
    } finally {
      state.close()
    }
  }

  return {
    async fetch(request: Request, doId: string): Promise<Response> {
      await ensureInitialized()

      if (useConsistencyGuard) {
        return handleWithGuard(request, doId)
      } else {
        return handleWithoutGuard(request, doId)
      }
    },

    async initialize(): Promise<void> {
      await ensureInitialized()
    },
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createVercelDoHandler as default,
  DO_STORAGE_SCHEMA,
}
