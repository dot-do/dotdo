/**
 * @dotdo/postgres - PostgreSQL SDK compat
 *
 * Drop-in replacement for pg (node-postgres) backed by DO SQLite.
 * This in-memory implementation matches the pg Client and Pool API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~900 lines of duplicated code.
 *
 * @see https://node-postgres.com/
 */
import type {
  Client as IClient,
  Pool as IPool,
  PoolClient,
  ClientConfig,
  PoolConfig,
  ExtendedPostgresConfig,
  QueryResult,
  QueryConfig,
  FieldDef,
  ConnectionConfig,
} from './types'
import { DatabaseError, ConnectionError, types } from './types'
import { EventEmitter } from '../../../../compat/shared/event-emitter'

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  POSTGRES_DIALECT,
  type SQLEngine,
  type SQLValue,
  type ExecutionResult,
  SQLError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  SQLParseError,
} from '../shared'

// ============================================================================
// ERROR MAPPING
// ============================================================================

/**
 * Map shared SQL errors to PostgreSQL DatabaseError format
 */
function mapToPostgresError(error: unknown): DatabaseError {
  if (error instanceof SQLError) {
    let pgCode = error.code
    if (error instanceof TableNotFoundError) pgCode = '42P01'
    else if (error instanceof TableExistsError) pgCode = '42P07'
    else if (error instanceof UniqueConstraintError) pgCode = '23505'
    else if (error instanceof SQLParseError) pgCode = '42601'

    return new DatabaseError(error.message, pgCode, 'ERROR')
  }

  if (error instanceof Error) {
    return new DatabaseError(error.message, '42601', 'ERROR')
  }

  return new DatabaseError(String(error), '42601', 'ERROR')
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to PostgreSQL QueryResult format
 */
function transformToQueryResult<R>(result: ExecutionResult): QueryResult<R> {
  const fields: FieldDef[] = result.columns.map((name, i) => ({
    name,
    tableID: 0,
    columnID: i,
    dataTypeID: types.TEXT, // Default to TEXT, could be enhanced
    dataTypeSize: -1,
    dataTypeModifier: -1,
    format: 'text',
  }))

  const rows = result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i]] = row[i]
    }
    return obj as R
  })

  return {
    fields,
    rows,
    rowCount: result.affectedRows || result.rows.length,
    command: result.command,
    oid: 0,
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

// @ts-expect-error - EventEmitter 'on' method signature differs from pg Client interface
class PostgresClient extends EventEmitter implements IClient {
  protected engine: SQLEngine
  private config: ExtendedPostgresConfig
  private connected = false
  private _processID = Math.floor(Math.random() * 100000)
  private _secretKey = Math.floor(Math.random() * 1000000)

  constructor(config?: string | ClientConfig | ExtendedPostgresConfig, sharedEngine?: SQLEngine) {
    super()
    this.config = this.parseConfig(config)
    this.engine = sharedEngine ?? createSQLEngine(POSTGRES_DIALECT)
  }

  private parseConfig(config?: string | ClientConfig | ExtendedPostgresConfig): ExtendedPostgresConfig {
    if (!config) {
      return {}
    }
    if (typeof config === 'string') {
      // Parse connection string
      return { connectionString: config }
    }
    return config as ExtendedPostgresConfig
  }

  get connectionParameters(): ConnectionConfig {
    return this.config
  }

  get processID(): number | null {
    return this.connected ? this._processID : null
  }

  get secretKey(): number | null {
    return this.connected ? this._secretKey : null
  }

  connect(): Promise<void>
  connect(callback: (err?: Error) => void): void
  connect(callback?: (err?: Error) => void): void | Promise<void> {
    const doConnect = (): Promise<void> => {
      return new Promise((resolve) => {
        this.connected = true
        this.emit('connect')
        resolve()
      })
    }

    if (callback) {
      doConnect()
        .then(() => callback())
        .catch(callback)
    } else {
      return doConnect()
    }
  }

  query<R = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>>
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values: I,
    callback: (err: Error | null, result: QueryResult<R>) => void
  ): void
  query<R = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    valuesOrCallback?: I | ((err: Error | null, result: QueryResult<R>) => void),
    callback?: (err: Error | null, result: QueryResult<R>) => void
  ): void | Promise<QueryResult<R>> {
    let text: string
    let values: SQLValue[] = []
    let cb: ((err: Error | null, result: QueryResult<R>) => void) | undefined

    if (typeof queryTextOrConfig === 'string') {
      text = queryTextOrConfig
      if (typeof valuesOrCallback === 'function') {
        cb = valuesOrCallback as (err: Error | null, result: QueryResult<R>) => void
      } else if (Array.isArray(valuesOrCallback)) {
        values = valuesOrCallback as SQLValue[]
        cb = callback
      }
    } else {
      text = queryTextOrConfig.text
      values = (queryTextOrConfig.values ?? []) as SQLValue[]
      if (typeof valuesOrCallback === 'function') {
        cb = valuesOrCallback as (err: Error | null, result: QueryResult<R>) => void
      }
    }

    const doQuery = (): Promise<QueryResult<R>> => {
      try {
        const result = this.engine.execute(text, values)
        return Promise.resolve(transformToQueryResult<R>(result))
      } catch (e) {
        return Promise.reject(mapToPostgresError(e))
      }
    }

    if (cb) {
      doQuery()
        .then((result) => cb!(null, result))
        .catch((err) => cb!(err, null as any))
    } else {
      return doQuery()
    }
  }

  end(): Promise<void>
  end(callback: (err?: Error) => void): void
  end(callback?: (err?: Error) => void): void | Promise<void> {
    const doEnd = (): Promise<void> => {
      return new Promise((resolve) => {
        this.connected = false
        this.emit('end')
        resolve()
      })
    }

    if (callback) {
      doEnd()
        .then(() => callback())
        .catch(callback)
    } else {
      return doEnd()
    }
  }

  copyFrom(_queryText: string): any {
    throw new Error('COPY FROM not supported in in-memory implementation')
  }

  copyTo(_queryText: string): any {
    throw new Error('COPY TO not supported in in-memory implementation')
  }

  pauseDrain(): void {
    // No-op for in-memory
  }

  resumeDrain(): void {
    // No-op for in-memory
  }

  escapeLiteral(value: string): string {
    return "'" + value.replace(/'/g, "''") + "'"
  }

  escapeIdentifier(value: string): string {
    return '"' + value.replace(/"/g, '""') + '"'
  }
}

// ============================================================================
// POOL IMPLEMENTATION
// ============================================================================

// @ts-expect-error - EventEmitter 'on' method signature differs from pg Pool interface
class PostgresPool extends EventEmitter implements IPool {
  private config: ExtendedPostgresConfig
  private clients: Set<PostgresPoolClient> = new Set()
  private idleClients: PostgresPoolClient[] = []
  private waitingRequests: Array<{
    resolve: (client: PoolClient) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false
  private sharedEngine: SQLEngine

  constructor(config?: string | PoolConfig | ExtendedPostgresConfig) {
    super()
    this.config = this.parseConfig(config)
    // All pool connections share the same engine for consistent state
    this.sharedEngine = createSQLEngine(POSTGRES_DIALECT)
  }

  private parseConfig(config?: string | PoolConfig | ExtendedPostgresConfig): ExtendedPostgresConfig {
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
    } as ExtendedPostgresConfig
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

// @ts-expect-error - EventEmitter 'on' method signature differs from pg PoolClient interface
class PostgresPoolClient extends PostgresClient implements PoolClient {
  private pool: PostgresPool

  constructor(config: ExtendedPostgresConfig, pool: PostgresPool, sharedEngine: SQLEngine) {
    super(config, sharedEngine)
    this.pool = pool
  }

  release(destroy?: boolean): void {
    this.pool._releaseClient(this, destroy)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { PostgresClient as Client }
export { PostgresPool as Pool }
export { types }
export { DatabaseError, ConnectionError }

/**
 * Create a new native PostgreSQL binding (simulated)
 */
export function native(): { Client: typeof PostgresClient; Pool: typeof PostgresPool } {
  return { Client: PostgresClient, Pool: PostgresPool }
}

/**
 * Default export matching pg module structure
 */
export default {
  Client: PostgresClient,
  Pool: PostgresPool,
  types,
  DatabaseError,
  ConnectionError,
  native,
}
