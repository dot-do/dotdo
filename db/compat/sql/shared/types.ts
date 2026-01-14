/**
 * @dotdo/db/compat/sql/shared - Shared SQL Engine Types
 *
 * Common types and interfaces for the shared SQL engine infrastructure
 * that powers all SQL compat layers (postgres, mysql, turso, planetscale, etc.)
 */

// ============================================================================
// CORE DATA TYPES
// ============================================================================

/**
 * SQL parameter value - union of all supported types
 */
export type SQLValue = string | number | bigint | boolean | null | undefined | ArrayBuffer | Uint8Array | Date

/**
 * Normalized SQL value for storage/comparison
 */
export type StorageValue = string | number | boolean | null | Uint8Array

/**
 * Table schema metadata
 */
export interface TableSchema {
  name: string
  columns: string[]
  columnTypes: string[]
  primaryKey?: string
  uniqueConstraints: string[]
  autoIncrement?: string
}

/**
 * Stored row with rowid and values map
 */
export interface StoredRow {
  rowid: number
  values: Map<string, StorageValue>
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Parsed query information
 */
export interface ParsedQuery {
  /** Original SQL string */
  sql: string
  /** SQL command type */
  command: SQLCommand
  /** Table name if applicable */
  table?: string
  /** Column names for SELECT */
  columns?: string[]
  /** WHERE condition string */
  whereClause?: string
  /** ORDER BY clause */
  orderBy?: string
  /** LIMIT value */
  limit?: number
  /** OFFSET value */
  offset?: number
  /** SET clause for UPDATE */
  setClause?: string
  /** VALUES clause for INSERT */
  valuesClause?: string
  /** RETURNING clause for PostgreSQL */
  returningClause?: string
  /** Column definitions for CREATE TABLE */
  columnDefs?: string[]
  /** IF NOT EXISTS flag */
  ifNotExists?: boolean
  /** IF EXISTS flag */
  ifExists?: boolean
}

/**
 * SQL command types
 */
export type SQLCommand =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'CREATE TABLE'
  | 'CREATE INDEX'
  | 'DROP TABLE'
  | 'BEGIN'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'SET'
  | 'SHOW'
  | 'SAVEPOINT'
  | 'RELEASE'

// ============================================================================
// EXECUTION RESULT TYPES
// ============================================================================

/**
 * Raw execution result from the engine
 */
export interface ExecutionResult {
  /** Column names */
  columns: string[]
  /** Column types */
  columnTypes: string[]
  /** Raw row data as arrays */
  rows: StorageValue[][]
  /** Number of affected rows (INSERT/UPDATE/DELETE) */
  affectedRows: number
  /** Last insert rowid (INSERT) */
  lastInsertRowid: number
  /** Number of changed rows (UPDATE) */
  changedRows: number
  /** SQL command executed */
  command: SQLCommand
}

// ============================================================================
// DIALECT CONFIGURATION
// ============================================================================

/**
 * SQL dialect identifiers
 */
export type SQLDialect = 'postgresql' | 'mysql' | 'sqlite'

/**
 * Dialect-specific configuration
 */
export interface DialectConfig {
  /** Dialect name */
  dialect: SQLDialect
  /** Parameter placeholder style: '$1' for postgres, '?' for mysql */
  parameterStyle: 'indexed' | 'positional'
  /** Quote character for identifiers */
  identifierQuote: '"' | '`'
  /** Boolean representation */
  booleanType: 'boolean' | 'integer'
  /** Auto-increment keyword */
  autoIncrementKeyword: 'SERIAL' | 'AUTO_INCREMENT' | 'AUTOINCREMENT'
  /** Support RETURNING clause */
  supportsReturning: boolean
  /** Support ON DUPLICATE KEY UPDATE (MySQL upsert) */
  supportsOnDuplicateKey: boolean
  /** Type translation map (source -> target) */
  typeTranslations?: Map<RegExp, string>
}

/**
 * PostgreSQL dialect configuration
 */
export const POSTGRES_DIALECT: DialectConfig = {
  dialect: 'postgresql',
  parameterStyle: 'indexed',
  identifierQuote: '"',
  booleanType: 'boolean',
  autoIncrementKeyword: 'SERIAL',
  supportsReturning: true,
  supportsOnDuplicateKey: false,
}

/**
 * MySQL dialect configuration
 */
export const MYSQL_DIALECT: DialectConfig = {
  dialect: 'mysql',
  parameterStyle: 'positional',
  identifierQuote: '`',
  booleanType: 'integer',
  autoIncrementKeyword: 'AUTO_INCREMENT',
  supportsReturning: false,
  supportsOnDuplicateKey: true,
  typeTranslations: new Map([
    [/TINYINT\s*\(\s*\d+\s*\)/gi, 'INTEGER'],
    [/INT\s*\(\s*\d+\s*\)/gi, 'INTEGER'],
    [/BIGINT\s*\(\s*\d+\s*\)/gi, 'INTEGER'],
    [/VARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT'],
    [/\bDATETIME\b/gi, 'TEXT'],
    [/\bTIMESTAMP\b/gi, 'TEXT'],
    [/\bDATE\b/gi, 'TEXT'],
    [/\bTIME\b/gi, 'TEXT'],
    [/ENUM\s*\([^)]+\)/gi, 'TEXT'],
    [/\bDOUBLE\b/gi, 'REAL'],
    [/\bFLOAT\b/gi, 'REAL'],
    [/\bBOOLEAN\b/gi, 'INTEGER'],
    [/\bBOOL\b/gi, 'INTEGER'],
    [/\bJSON\b/gi, 'TEXT'],
    [/\bMEDIUMTEXT\b/gi, 'TEXT'],
    [/\bLONGTEXT\b/gi, 'TEXT'],
    [/\bTINYTEXT\b/gi, 'TEXT'],
    [/\s+UNSIGNED/gi, ''],
    [/\s+ENGINE\s*=\s*\w+/gi, ''],
    [/\s+DEFAULT\s+CHARSET\s*=\s*\w+/gi, ''],
    [/\s+COLLATE\s*=\s*\w+/gi, ''],
    [/\s+CHARACTER\s+SET\s+\w+/gi, ''],
  ]),
}

/**
 * SQLite dialect configuration
 */
export const SQLITE_DIALECT: DialectConfig = {
  dialect: 'sqlite',
  parameterStyle: 'positional',
  identifierQuote: '"',
  booleanType: 'integer',
  autoIncrementKeyword: 'AUTOINCREMENT',
  supportsReturning: true,
  supportsOnDuplicateKey: false,
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

/**
 * Transaction mode (read-only or read-write)
 */
export type TransactionMode = 'read' | 'write' | 'deferred'

/**
 * Transaction state
 */
export interface TransactionState {
  /** Whether a transaction is active */
  active: boolean
  /** Transaction mode */
  mode: TransactionMode
  /** Data snapshot for rollback */
  dataSnapshot: Map<string, StoredRow[]> | null
  /** Auto-increment snapshot for rollback */
  autoIncrementSnapshot: Map<string, number> | null
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base SQL error class
 */
export class SQLError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly errno?: number
  ) {
    super(message)
    this.name = 'SQLError'
  }
}

/**
 * Parse error
 */
export class SQLParseError extends SQLError {
  constructor(message: string, code: string = 'PARSE_ERROR') {
    super(message, code)
    this.name = 'SQLParseError'
  }
}

/**
 * Table not found error
 */
export class TableNotFoundError extends SQLError {
  constructor(tableName: string, code: string = 'TABLE_NOT_FOUND') {
    super(`Table '${tableName}' does not exist`, code)
    this.name = 'TableNotFoundError'
  }
}

/**
 * Table exists error
 */
export class TableExistsError extends SQLError {
  constructor(tableName: string, code: string = 'TABLE_EXISTS') {
    super(`Table '${tableName}' already exists`, code)
    this.name = 'TableExistsError'
  }
}

/**
 * Unique constraint violation
 */
export class UniqueConstraintError extends SQLError {
  constructor(tableName: string, constraint: string, value: unknown, code: string = 'UNIQUE_VIOLATION') {
    super(`Duplicate key value violates unique constraint "${tableName}_${constraint}_key": ${value}`, code)
    this.name = 'UniqueConstraintError'
  }
}

/**
 * Read-only transaction error
 */
export class ReadOnlyTransactionError extends SQLError {
  constructor() {
    super('Cannot write in read-only transaction', 'SQLITE_READONLY', 8)
    this.name = 'ReadOnlyTransactionError'
  }
}
