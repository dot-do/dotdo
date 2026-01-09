/**
 * @dotdo/planetscale - PlanetScale SDK compat
 *
 * Drop-in replacement for @planetscale/database backed by DO SQLite.
 * This in-memory implementation matches the PlanetScale API.
 * Production version routes to Durable Objects based on config.
 *
 * REFACTORED: Now uses the shared SQL engine infrastructure at
 * db/compat/sql/shared/ instead of duplicating SQL parsing/execution.
 * This reduces ~1290 lines of duplicated code.
 *
 * @see https://github.com/planetscale/database-js
 */
import type { Config, ExecutedQuery, Row, Transaction } from './types'
import { DatabaseError } from './types'

// Import the shared SQL engine infrastructure
import {
  createSQLEngine,
  MYSQL_DIALECT,
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
 * Map shared SQL errors to PlanetScale DatabaseError format
 */
function mapToPlanetScaleError(error: unknown): DatabaseError {
  if (error instanceof BaseSQLError) {
    let code = 'UNKNOWN'

    if (error instanceof TableNotFoundError) {
      code = 'ER_NO_SUCH_TABLE'
    } else if (error instanceof TableExistsError) {
      code = 'ER_TABLE_EXISTS_ERROR'
    } else if (error instanceof UniqueConstraintError) {
      code = 'ER_DUP_ENTRY'
    } else if (error instanceof SQLParseError) {
      code = 'ER_PARSE_ERROR'
    }

    return new DatabaseError(error.message, code)
  }

  if (error instanceof Error) {
    return new DatabaseError(error.message, 'UNKNOWN')
  }

  return new DatabaseError(String(error), 'UNKNOWN')
}

// ============================================================================
// RESULT TRANSFORMATION
// ============================================================================

/**
 * Transform shared engine result to PlanetScale ExecutedQuery format
 */
function transformToExecutedQuery<T>(
  result: ExecutionResult,
  time: number
): ExecutedQuery<T> {
  if (result.command === 'SELECT') {
    // Build rows as objects
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj as T
    })

    return {
      headers: result.columns,
      rows,
      size: rows.length,
      time,
    }
  } else {
    // For INSERT, UPDATE, DELETE
    return {
      headers: [],
      rows: [],
      size: 0,
      time,
      insertId: result.lastInsertRowid || undefined,
      rowsAffected: result.affectedRows,
    }
  }
}

// ============================================================================
// CONNECTION CLASS
// ============================================================================

export class Connection {
  private engine: SQLEngine
  private config: Config

  constructor(config: Config) {
    this.config = config
    this.engine = createSQLEngine(MYSQL_DIALECT)
  }

  async execute<T = Row>(sql: string, args?: unknown[]): Promise<ExecutedQuery<T>> {
    const startTime = performance.now()

    try {
      const result = this.engine.execute(sql, (args ?? []) as SQLValue[])
      const endTime = performance.now()
      return transformToExecutedQuery<T>(result, endTime - startTime)
    } catch (e) {
      if (e instanceof DatabaseError) {
        throw e
      }
      throw mapToPlanetScaleError(e)
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // Begin transaction
    this.engine.beginTransaction()

    const tx: Transaction = {
      execute: async <R = Row>(sql: string, args?: unknown[]): Promise<ExecutedQuery<R>> => {
        return this.execute<R>(sql, args)
      },
    }

    try {
      const result = await fn(tx)
      this.engine.commitTransaction()
      return result
    } catch (e) {
      this.engine.rollbackTransaction()
      throw e
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function connect(config: Config): Connection {
  // Validate config
  if (!config.url && !config.host) {
    throw new DatabaseError('Either url or host is required', 'INVALID_CONFIG')
  }
  if (!config.url && config.host === '') {
    throw new DatabaseError('Host cannot be empty', 'INVALID_CONFIG')
  }

  return new Connection(config)
}

// ============================================================================
// CAST HELPERS
// ============================================================================

export function hex(data: Buffer | Uint8Array): string {
  const bytes = data instanceof Buffer ? data : Buffer.from(data)
  return bytes.toString('hex')
}

export function datetime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function json(obj: unknown): string {
  return JSON.stringify(obj)
}

export const cast = {
  hex,
  datetime,
  json,
}

export { DatabaseError }
