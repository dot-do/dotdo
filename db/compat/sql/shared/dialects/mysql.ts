/**
 * @dotdo/db/compat/sql/shared/dialects - MySQL Dialect
 *
 * MySQL-specific adapter for the shared SQL engine.
 * Provides MySQL-compatible result transformations and error handling.
 */

import { InMemorySQLEngine, type SQLEngine } from '../engine'
import {
  MYSQL_DIALECT,
  type ExecutionResult,
  type SQLValue,
  SQLError,
} from '../types'

// ============================================================================
// MYSQL RESULT TYPES
// ============================================================================

/**
 * MySQL-style field packet
 */
export interface MySQLFieldPacket {
  name: string
  table: string
  db: string
  orgName: string
  orgTable: string
  characterSet: number
  columnLength: number
  columnType: number
  flags: number
  decimals: number
}

/**
 * MySQL-style result set header (for INSERT/UPDATE/DELETE)
 */
export interface MySQLResultSetHeader {
  affectedRows: number
  changedRows: number
  fieldCount: number
  insertId: number
  serverStatus: number
  warningCount: number
  info: string
}

/**
 * MySQL-style row data packet
 */
export type MySQLRowDataPacket = Record<string, unknown>

/**
 * MySQL query result tuple: [rows/header, fields]
 */
export type MySQLQueryResult<T = MySQLRowDataPacket[]> = [T, MySQLFieldPacket[]]

// ============================================================================
// MYSQL TYPE CONSTANTS
// ============================================================================

export const MySQLTypes = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  VARCHAR: 15,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255,
} as const

// ============================================================================
// MYSQL ERROR MAPPING
// ============================================================================

/**
 * MySQL-style database error
 */
export class MySQLDatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly errno: number
  ) {
    super(message)
    this.name = 'MySQLError'
  }
}

/**
 * MySQL-style connection error
 */
export class MySQLConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Map internal SQL errors to MySQL error format
 */
export function mapToMySQLError(error: unknown): MySQLDatabaseError {
  if (error instanceof SQLError) {
    // Map to MySQL error codes
    let mysqlCode = 'ER_UNKNOWN'
    let errno = 1000

    if (error.name === 'TableNotFoundError') {
      mysqlCode = 'ER_NO_SUCH_TABLE'
      errno = 1146
    } else if (error.name === 'TableExistsError') {
      mysqlCode = 'ER_TABLE_EXISTS_ERROR'
      errno = 1050
    } else if (error.name === 'UniqueConstraintError') {
      mysqlCode = 'ER_DUP_ENTRY'
      errno = 1062
    } else if (error.name === 'SQLParseError') {
      mysqlCode = 'ER_PARSE_ERROR'
      errno = 1064
    }

    return new MySQLDatabaseError(error.message, mysqlCode, errno)
  }

  if (error instanceof Error) {
    return new MySQLDatabaseError(error.message, 'ER_UNKNOWN', 1000)
  }

  return new MySQLDatabaseError(String(error), 'ER_UNKNOWN', 1000)
}

// ============================================================================
// MYSQL DIALECT ADAPTER
// ============================================================================

/**
 * MySQL dialect adapter
 *
 * Wraps the shared SQL engine and transforms results to MySQL format.
 */
export class MySQLDialect {
  private engine: SQLEngine
  private database: string

  constructor(engine?: SQLEngine, database?: string) {
    this.engine = engine ?? new InMemorySQLEngine(MYSQL_DIALECT)
    this.database = database ?? ''
  }

  /**
   * Execute a query and return MySQL-style result
   */
  query<T = MySQLRowDataPacket[]>(
    sql: string,
    params: SQLValue[] = []
  ): MySQLQueryResult<T> {
    try {
      const result = this.engine.execute(sql, params)
      return this.transformResult<T>(result)
    } catch (error) {
      throw mapToMySQLError(error)
    }
  }

  /**
   * Execute (alias for query, for prepared statement compatibility)
   */
  execute<T = MySQLRowDataPacket[]>(
    sql: string,
    params: SQLValue[] = []
  ): MySQLQueryResult<T> {
    return this.query<T>(sql, params)
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
   * Transform execution result to MySQL format
   */
  private transformResult<T>(result: ExecutionResult): MySQLQueryResult<T> {
    const fields: MySQLFieldPacket[] = result.columns.map((name) => ({
      name,
      table: '',
      db: this.database,
      orgName: name,
      orgTable: '',
      characterSet: 33, // utf8
      columnLength: 255,
      columnType: MySQLTypes.VARCHAR,
      flags: 0,
      decimals: 0,
    }))

    if (result.command === 'SELECT') {
      // Return rows as objects
      const rows = result.rows.map((row) => {
        const obj: Record<string, unknown> = {}
        for (let i = 0; i < result.columns.length; i++) {
          obj[result.columns[i]] = row[i]
        }
        return obj
      })
      return [rows as T, fields]
    } else {
      // Return result set header for DML operations
      const header: MySQLResultSetHeader = {
        affectedRows: result.affectedRows,
        changedRows: result.changedRows,
        fieldCount: 0,
        insertId: result.lastInsertRowid,
        serverStatus: 2,
        warningCount: 0,
        info: '',
      }
      return [header as T, fields]
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a MySQL dialect adapter
 */
export function createMySQLDialect(engine?: SQLEngine, database?: string): MySQLDialect {
  return new MySQLDialect(engine, database)
}
