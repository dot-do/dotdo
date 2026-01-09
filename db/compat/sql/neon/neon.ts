/**
 * @dotdo/neon - Neon SDK compat
 *
 * Drop-in replacement for @neondatabase/serverless backed by DO SQLite.
 * This in-memory implementation matches the Neon serverless driver API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~850 lines of duplicated code.
 *
 * @see https://neon.tech/docs/serverless/serverless-driver
 */
import type {
  NeonOptions,
  NeonConfig,
  NeonSqlFunction,
  QueryResult,
  FieldDef,
  PoolConfig,
  ClientConfig,
  PoolClient,
  TransactionCallback,
} from './types'
import { NeonDbError, ConnectionError, types } from './types'
import { EventEmitter } from '../../../../compat/shared/event-emitter'

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  POSTGRES_DIALECT,
  type SQLEngine,
  type SQLValue,
  type ExecutionResult,
  SQLError as BaseSQLError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  SQLParseError,
} from '../shared'

// ============================================================================
// ERROR MAPPING
// ============================================================================

/**
 * Map shared SQL errors to Neon NeonDbError format
 */
function mapToNeonError(error: unknown): NeonDbError {
  if (error instanceof BaseSQLError) {
    let code = '42601'

    if (error instanceof TableNotFoundError) {
      code = '42P01'
    } else if (error instanceof TableExistsError) {
      code = '42P07'
    } else if (error instanceof UniqueConstraintError) {
      code = '23505'
    } else if (error instanceof SQLParseError) {
      code = '42601'
    }

    return new NeonDbError(error.message, code, 'ERROR')
  }

  if (error instanceof Error) {
    return new NeonDbError(error.message, '42601')
  }

  return new NeonDbError(String(error), '42601')
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to Neon QueryResult format
 */
function transformToQueryResult<R>(result: ExecutionResult): QueryResult<R> {
  const fields: FieldDef[] = result.columns.map((name, i) => ({
    name,
    tableID: 0,
    columnID: i,
    dataTypeID: types.TEXT,
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
// GLOBAL DATABASE INSTANCES
// ============================================================================

// Global shared database for all connections
// Each unique connection string gets its own database instance
const dbInstances = new Map<string, SQLEngine>()

function getGlobalDb(connectionString?: string): SQLEngine {
  // Use a default key for tests without connection string
  const key = connectionString || 'default'

  if (!dbInstances.has(key)) {
    dbInstances.set(key, createSQLEngine(POSTGRES_DIALECT))
  }
  return dbInstances.get(key)!
}

// For testing: reset all databases or a specific one
export function resetDatabase(connectionString?: string): void {
  if (connectionString) {
    dbInstances.delete(connectionString)
  } else {
    dbInstances.clear()
  }
}

// ============================================================================
// NEON CONFIG
// ============================================================================

export const neonConfig: NeonConfig = {
  fetchConnectionCache: false,
  poolQueryViaFetch: false,
  fetchEndpoint: undefined,
  wsProxy: undefined,
  useSecureWebSocket: true,
  pipelineConnect: 'password',
  coalesceWrites: true,
}

// ============================================================================
// NEON SQL FUNCTION
// ============================================================================

/**
 * Create a SQL function for executing queries via HTTP
 */
export function neon(connectionString: string, options?: NeonOptions): NeonSqlFunction {
  const engine = getGlobalDb(connectionString)
  const fullResults = options?.fullResults ?? false
  const arrayMode = options?.arrayMode ?? false

  // SQL template tag and function call handler
  function sql(stringsOrText: TemplateStringsArray | string, ...valuesOrParams: unknown[]): Promise<unknown> {
    let text: string
    let params: unknown[]

    if (typeof stringsOrText === 'string') {
      // Called as sql('SELECT ...', [params])
      text = stringsOrText
      params = (valuesOrParams[0] as unknown[]) ?? []
    } else {
      // Called as sql`SELECT ...`
      const strings = stringsOrText as TemplateStringsArray
      text = strings[0]
      params = []

      for (let i = 0; i < valuesOrParams.length; i++) {
        params.push(valuesOrParams[i])
        text += `$${i + 1}${strings[i + 1]}`
      }
    }

    return executeQuery(engine, text, params, fullResults, arrayMode)
  }

  // Add transaction support
  sql.transaction = async function <T = unknown>(
    queriesOrCallback: Promise<unknown>[] | TransactionCallback<T>
  ): Promise<unknown> {
    if (typeof queriesOrCallback === 'function') {
      // Callback style transaction
      const callback = queriesOrCallback as TransactionCallback<T>
      engine.beginTransaction()
      try {
        const result = await callback(sql as NeonSqlFunction)
        engine.commitTransaction()
        return result
      } catch (e) {
        engine.rollbackTransaction()
        throw e
      }
    } else {
      // Array of queries style
      const queries = queriesOrCallback as Promise<unknown>[]
      engine.beginTransaction()
      try {
        const results = await Promise.all(queries)
        engine.commitTransaction()
        return results
      } catch (e) {
        engine.rollbackTransaction()
        throw e
      }
    }
  }

  return sql as NeonSqlFunction
}

async function executeQuery(
  engine: SQLEngine,
  text: string,
  params: unknown[],
  fullResults: boolean,
  arrayMode: boolean
): Promise<unknown> {
  try {
    const result = engine.execute(text, params as SQLValue[])
    const fields: FieldDef[] = result.columns.map((name, i) => ({
      name,
      tableID: 0,
      columnID: i,
      dataTypeID: types.TEXT,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text',
    }))

    if (arrayMode) {
      // Return rows as arrays
      if (fullResults) {
        return {
          fields,
          rows: result.rows,
          rowCount: result.affectedRows || result.rows.length,
          command: result.command,
          oid: 0,
        }
      }
      return result.rows
    }

    // Convert rows to objects
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj
    })

    if (fullResults) {
      return {
        fields,
        rows,
        rowCount: result.affectedRows || result.rows.length,
        command: result.command,
        oid: 0,
      }
    }

    return rows
  } catch (e) {
    if (e instanceof NeonDbError) {
      throw e
    }
    throw mapToNeonError(e)
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

export class NeonClient extends EventEmitter {
  private engine: SQLEngine
  private config: ClientConfig
  private connected = false
  private _processID = Math.floor(Math.random() * 100000)
  private _secretKey = Math.floor(Math.random() * 1000000)

  constructor(config?: string | ClientConfig) {
    super()
    this.config = this.parseConfig(config)
    this.engine = getGlobalDb()
  }

  private parseConfig(config?: string | ClientConfig): ClientConfig {
    if (!config) {
      return {}
    }
    if (typeof config === 'string') {
      return { connectionString: config }
    }
    return config
  }

  get connectionParameters(): ClientConfig {
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

  async query<R = unknown>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    try {
      const result = this.engine.execute(text, (values ?? []) as SQLValue[])
      return transformToQueryResult<R>(result)
    } catch (e) {
      if (e instanceof NeonDbError) {
        throw e
      }
      throw mapToNeonError(e)
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

class NeonPoolClient extends NeonClient implements PoolClient {
  private pool: NeonPool

  constructor(config: ClientConfig, pool: NeonPool) {
    super(config)
    this.pool = pool
  }

  release(destroy?: boolean): void {
    this.pool._releaseClient(this, destroy)
  }
}

export class NeonPool extends EventEmitter {
  private config: PoolConfig
  private clients: Set<NeonPoolClient> = new Set()
  private idleClients: NeonPoolClient[] = []
  private waitingRequests: Array<{
    resolve: (client: PoolClient) => void
    reject: (err: Error) => void
  }> = []
  private _ended = false

  constructor(config?: string | PoolConfig) {
    super()
    this.config = this.parseConfig(config)
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

  async query<R = unknown>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    const client = await this.connect()
    try {
      const result = await client.query<R>(text, values)
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

    if (this.idleClients.length > 0) {
      const client = this.idleClients.pop()!
      this.emit('acquire', client)
      return client
    }

    const max = this.config.max ?? 10
    if (this.clients.size < max) {
      const client = new NeonPoolClient(this.config, this)
      this.clients.add(client)
      await client.connect()
      this.emit('connect', client)
      this.emit('acquire', client)
      return client
    }

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

  _releaseClient(client: NeonPoolClient, destroy?: boolean): void {
    if (destroy) {
      this.clients.delete(client)
      this.emit('remove', client)
      return
    }

    if (this.waitingRequests.length > 0) {
      const waiter = this.waitingRequests.shift()!
      this.emit('acquire', client)
      waiter.resolve(client)
      return
    }

    this.idleClients.push(client)
    this.emit('release', undefined, client)
  }

  async end(): Promise<void> {
    this._ended = true

    for (const waiter of this.waitingRequests) {
      waiter.reject(new ConnectionError('Pool has been ended'))
    }
    this.waitingRequests = []

    const endPromises: Promise<void>[] = []
    for (const client of this.clients) {
      endPromises.push(client.end())
    }
    await Promise.all(endPromises)

    this.clients.clear()
    this.idleClients = []
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { NeonClient as Client }
export { NeonPool as Pool }
export { types }
export { NeonDbError, ConnectionError }
