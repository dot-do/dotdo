/**
 * @dotdo/postgres - PostgresPool
 *
 * pg (node-postgres) compatible Pool implementation.
 * Manages a pool of connections backed by an in-memory SQL engine.
 *
 * @example
 * ```typescript
 * import { Pool } from '@dotdo/postgres'
 *
 * const pool = new Pool({
 *   connectionString: 'postgres://localhost/mydb',
 *   max: 20,
 * })
 *
 * const { rows } = await pool.query('SELECT * FROM users')
 *
 * // Transaction with checkout
 * const client = await pool.connect()
 * try {
 *   await client.query('BEGIN')
 *   await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
 *   await client.query('COMMIT')
 * } catch (e) {
 *   await client.query('ROLLBACK')
 *   throw e
 * } finally {
 *   client.release()
 * }
 *
 * await pool.end()
 * ```
 */

import type {
  Pool as IPool,
  PoolConfig,
  PoolClient,
  QueryConfig,
  QueryResult,
} from './types'
import { ConnectionError } from './types'
import { PostgresClient } from './client'
import { InMemorySQLEngine, createInMemoryEngine } from './backends/memory'

// ============================================================================
// EVENT EMITTER
// ============================================================================

type EventHandler = (...args: unknown[]) => void

interface ListenerEntry {
  callback: EventHandler
  once: boolean
}

class EventEmitter {
  protected _handlers = new Map<string, Set<ListenerEntry>>()

  on(event: string, handler: EventHandler): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler, once: false })
    return this
  }

  once(event: string, handler: EventHandler): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set())
    }
    this._handlers.get(event)!.add({ callback: handler, once: true })
    return this
  }

  off(event: string, handler: EventHandler): this {
    const handlers = this._handlers.get(event)
    if (handlers) {
      for (const entry of handlers) {
        if (entry.callback === handler) {
          handlers.delete(entry)
          break
        }
      }
    }
    return this
  }

  emit(event: string, ...args: unknown[]): boolean {
    const handlers = this._handlers.get(event)
    if (!handlers || handlers.size === 0) return false

    const toRemove: ListenerEntry[] = []

    for (const entry of handlers) {
      try {
        entry.callback(...args)
      } catch (e) {
        if (event !== 'error') {
          this.emit('error', e)
        }
      }
      if (entry.once) {
        toRemove.push(entry)
      }
    }

    for (const entry of toRemove) {
      handlers.delete(entry)
    }

    return true
  }
}

// ============================================================================
// POOL CLIENT
// ============================================================================

// @ts-expect-error - EventEmitter methods differ from pg interface
class PostgresPoolClient extends PostgresClient implements PoolClient {
  private pool: PostgresPool

  constructor(config: PoolConfig, pool: PostgresPool, sharedEngine: InMemorySQLEngine) {
    super(config, sharedEngine)
    this.pool = pool
  }

  release(destroy?: boolean): void {
    this.pool._releaseClient(this, destroy)
  }
}

// ============================================================================
// POSTGRES POOL
// ============================================================================

// @ts-expect-error - EventEmitter methods differ from pg Pool interface
export class PostgresPool extends EventEmitter implements IPool {
  private config: PoolConfig
  private clients: Set<PostgresPoolClient> = new Set()
  private idleClients: PostgresPoolClient[] = []
  private waitingRequests: Array<{
    resolve: (client: PoolClient) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false
  private sharedEngine: InMemorySQLEngine

  constructor(config?: string | PoolConfig) {
    super()
    this.config = this.parseConfig(config)
    // All pool connections share the same engine for consistent state
    this.sharedEngine = createInMemoryEngine()
  }

  private parseConfig(config?: string | PoolConfig): PoolConfig {
    if (!config) {
      return { max: 10, min: 0, idleTimeoutMillis: 10000 }
    }
    if (typeof config === 'string') {
      return { connectionString: config, max: 10, min: 0, idleTimeoutMillis: 10000 }
    }
    return {
      max: 10,
      min: 0,
      idleTimeoutMillis: 10000,
      ...config,
    }
  }

  get totalCount(): number {
    return this.clients.size
  }

  get idleCount(): number {
    return this.idleClients.length
  }

  get waitingCount(): number {
    return this.waitingRequests.length
  }

  get ended(): boolean {
    return this._ended
  }

  async query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: I
  ): Promise<QueryResult<R>> {
    const client = await this.connect()
    try {
      const result = await client.query<R, I>(queryTextOrConfig, values)
      client.release()
      return result
    } catch (e) {
      client.release(true)
      throw e
    }
  }

  async connect(): Promise<PoolClient> {
    if (this._ended) {
      throw new ConnectionError('Pool has been ended')
    }

    // Check for idle client
    if (this.idleClients.length > 0) {
      const client = this.idleClients.pop()!
      this.emit('acquire', client)
      return client as unknown as PoolClient
    }

    // Create new client if under max
    const max = this.config.max ?? 10
    if (this.clients.size < max) {
      const client = new PostgresPoolClient(this.config, this, this.sharedEngine)
      this.clients.add(client)
      await client.connect()
      this.emit('connect', client)
      this.emit('acquire', client)
      return client as unknown as PoolClient
    }

    // Wait for available client
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectionTimeoutMillis ?? 30000
      const timer = setTimeout(() => {
        const index = this.waitingRequests.findIndex(
          (r) => r.resolve === resolve && r.reject === reject
        )
        if (index >= 0) {
          this.waitingRequests.splice(index, 1)
        }
        reject(new ConnectionError('Connection timeout'))
      }, timeoutMs)

      this.waitingRequests.push({
        resolve: (client) => {
          clearTimeout(timer)
          resolve(client)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  _releaseClient(client: PostgresPoolClient, destroy?: boolean): void {
    if (destroy) {
      this.clients.delete(client)
      this.emit('remove', client)
      return
    }

    // Check for waiting requests
    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', client)
      waiter.resolve(client as unknown as PoolClient)
      return
    }

    // Return to idle pool
    this.idleClients.push(client)
    this.emit('release', undefined, client)
  }

  async end(): Promise<void> {
    this._ended = true

    // Reject all waiting requests
    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool has been ended'))
    }
    this.waitingRequests = []

    // End all clients
    const endPromises: Promise<void>[] = []
    for (const client of this.clients) {
      endPromises.push(client.end())
    }
    await Promise.all(endPromises)

    this.clients.clear()
    this.idleClients = []
  }
}

export { PostgresPool as Pool }
