/**
 * @dotdo/postgres - PostgresClient
 *
 * pg (node-postgres) compatible Client implementation.
 * Uses an in-memory SQL engine for testing and edge-native execution.
 *
 * @example
 * ```typescript
 * import { Client } from '@dotdo/postgres'
 *
 * const client = new Client({
 *   host: 'localhost',
 *   database: 'mydb',
 *   user: 'postgres',
 *   password: 'secret',
 * })
 *
 * await client.connect()
 * const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])
 * await client.end()
 * ```
 */

import type {
  Client as IClient,
  ClientConfig,
  ConnectionConfig,
  QueryConfig,
  QueryResult,
  FieldDef,
} from './types'
import { DatabaseError, types } from './types'
import {
  InMemorySQLEngine,
  createInMemoryEngine,
  SQLParseError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  type ExecutionResult,
  type SQLValue,
} from './backends/memory'

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

  removeListener(event: string, handler: EventHandler): this {
    return this.off(event, handler)
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

  removeAllListeners(event?: string): this {
    if (event) {
      this._handlers.delete(event)
    } else {
      this._handlers.clear()
    }
    return this
  }
}

// ============================================================================
// ERROR MAPPING
// ============================================================================

function mapToPostgresError(error: unknown): DatabaseError {
  if (error instanceof TableNotFoundError) {
    return new DatabaseError(error.message, '42P01', 'ERROR')
  }
  if (error instanceof TableExistsError) {
    return new DatabaseError(error.message, '42P07', 'ERROR')
  }
  if (error instanceof UniqueConstraintError) {
    return new DatabaseError(error.message, '23505', 'ERROR')
  }
  if (error instanceof SQLParseError) {
    return new DatabaseError(error.message, '42601', 'ERROR')
  }
  if (error instanceof Error) {
    return new DatabaseError(error.message, '42601', 'ERROR')
  }
  return new DatabaseError(String(error), '42601', 'ERROR')
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

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
      obj[result.columns[i]!] = row[i]
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
// POSTGRES CLIENT
// ============================================================================

// @ts-expect-error - EventEmitter 'on' method signature differs from pg Client interface
export class PostgresClient extends EventEmitter implements IClient {
  protected engine: InMemorySQLEngine
  private config: ClientConfig
  private connected = false
  private _processID = Math.floor(Math.random() * 100000)
  private _secretKey = Math.floor(Math.random() * 1000000)

  constructor(config?: string | ClientConfig, sharedEngine?: InMemorySQLEngine) {
    super()
    this.config = this.parseConfig(config)
    this.engine = sharedEngine ?? createInMemoryEngine()
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

export { PostgresClient as Client }
