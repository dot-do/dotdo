/**
 * @dotdo/db/compat/sql/shared/dialects - PostgreSQL Dialect
 *
 * PostgreSQL-specific adapter for the shared SQL engine.
 * Provides PostgreSQL-compatible result transformations and error handling.
 */

import { InMemorySQLEngine, type SQLEngine } from '../engine'
import {
  POSTGRES_DIALECT,
  type DialectConfig,
  type ExecutionResult,
  type SQLValue,
  SQLError,
} from '../types'

// ============================================================================
// POSTGRES RESULT TYPES
// ============================================================================

/**
 * PostgreSQL-style field definition
 */
export interface PgFieldDef {
  name: string
  tableID: number
  columnID: number
  dataTypeID: number
  dataTypeSize: number
  dataTypeModifier: number
  format: 'text' | 'binary'
}

/**
 * PostgreSQL-style query result
 */
export interface PgQueryResult<T = Record<string, unknown>> {
  fields: PgFieldDef[]
  rows: T[]
  rowCount: number
  command: string
  oid: number
}

// ============================================================================
// POSTGRES TYPE OIDs
// ============================================================================

export const PgTypes = {
  TEXT: 25,
  INT4: 23,
  INT8: 20,
  FLOAT4: 700,
  FLOAT8: 701,
  BOOL: 16,
  TIMESTAMP: 1114,
  DATE: 1082,
  JSON: 114,
  JSONB: 3802,
  BYTEA: 17,
  VARCHAR: 1043,
  NUMERIC: 1700,
} as const

// ============================================================================
// POSTGRES ERROR MAPPING
// ============================================================================

/**
 * PostgreSQL-style database error
 */
export class PostgresDatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly severity: string = 'ERROR'
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

/**
 * Map internal SQL errors to PostgreSQL error format
 */
export function mapToPostgresError(error: unknown): PostgresDatabaseError {
  if (error instanceof SQLError) {
    // Map common error codes
    let pgCode = error.code
    if (error.name === 'TableNotFoundError') pgCode = '42P01'
    else if (error.name === 'TableExistsError') pgCode = '42P07'
    else if (error.name === 'UniqueConstraintError') pgCode = '23505'
    else if (error.name === 'SQLParseError') pgCode = '42601'

    return new PostgresDatabaseError(error.message, pgCode)
  }

  if (error instanceof Error) {
    return new PostgresDatabaseError(error.message, '42601')
  }

  return new PostgresDatabaseError(String(error), '42601')
}

// ============================================================================
// POSTGRES DIALECT ADAPTER
// ============================================================================

/**
 * PostgreSQL dialect adapter
 *
 * Wraps the shared SQL engine and transforms results to PostgreSQL format.
 */
export class PostgresDialect {
  private engine: SQLEngine

  constructor(engine?: SQLEngine) {
    this.engine = engine ?? new InMemorySQLEngine(POSTGRES_DIALECT)
  }

  /**
   * Execute a query and return PostgreSQL-style result
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params: SQLValue[] = []
  ): PgQueryResult<T> {
    try {
      const result = this.engine.execute(sql, params)
      return this.transformResult<T>(result)
    } catch (error) {
      throw mapToPostgresError(error)
    }
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): void {
    this.engine.beginTransaction()
  }

  /**
   * Commit the current transaction
   */
  commitTransaction(): void {
    this.engine.commitTransaction()
  }

  /**
   * Rollback the current transaction
   */
  rollbackTransaction(): void {
    this.engine.rollbackTransaction()
  }

  /**
   * Check if in transaction
   */
  isInTransaction(): boolean {
    return this.engine.isInTransaction()
  }

  /**
   * Get the underlying engine
   */
  getEngine(): SQLEngine {
    return this.engine
  }

  /**
   * Transform execution result to PostgreSQL format
   */
  private transformResult<T>(result: ExecutionResult): PgQueryResult<T> {
    const fields: PgFieldDef[] = result.columns.map((name, i) => ({
      name,
      tableID: 0,
      columnID: i,
      dataTypeID: this.inferTypeOID(result.columnTypes[i]),
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text',
    }))

    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < result.columns.length; i++) {
        obj[result.columns[i]] = row[i]
      }
      return obj as T
    })

    return {
      fields,
      rows,
      rowCount: result.affectedRows || result.rows.length,
      command: result.command,
      oid: 0,
    }
  }

  /**
   * Infer PostgreSQL type OID from column type string
   */
  private inferTypeOID(typeStr: string): number {
    const upper = (typeStr || 'TEXT').toUpperCase()
    if (upper.includes('INT')) return PgTypes.INT4
    if (upper.includes('BIGINT')) return PgTypes.INT8
    if (upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('REAL')) return PgTypes.FLOAT8
    if (upper.includes('BOOL')) return PgTypes.BOOL
    if (upper.includes('TIMESTAMP')) return PgTypes.TIMESTAMP
    if (upper.includes('DATE')) return PgTypes.DATE
    if (upper.includes('JSON')) return PgTypes.JSON
    if (upper.includes('BYTEA') || upper.includes('BLOB')) return PgTypes.BYTEA
    return PgTypes.TEXT
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a PostgreSQL dialect adapter
 */
export function createPostgresDialect(engine?: SQLEngine): PostgresDialect {
  return new PostgresDialect(engine)
}
