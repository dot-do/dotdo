/**
 * @dotdo/db/compat/sql/shared - Shared SQL Engine Infrastructure
 *
 * This module consolidates ~3,000+ lines of duplicated SQL parsing and
 * execution logic from the postgres, mysql, turso, and planetscale compat layers.
 *
 * The shared infrastructure provides:
 * - A unified in-memory SQL engine with SQLite-compatible behavior
 * - SQL parsing utilities for all common operations
 * - Dialect-specific adapters for PostgreSQL, MySQL, and SQLite/Turso
 * - Consistent error handling across all dialects
 *
 * @example
 * ```typescript
 * import { createSQLEngine, POSTGRES_DIALECT, MYSQL_DIALECT } from '@dotdo/db/compat/sql/shared'
 *
 * // Create PostgreSQL-compatible engine
 * const pgEngine = createSQLEngine(POSTGRES_DIALECT)
 * const result = pgEngine.execute('SELECT * FROM users WHERE id = $1', [1])
 *
 * // Create MySQL-compatible engine
 * const mysqlEngine = createSQLEngine(MYSQL_DIALECT)
 * const result = mysqlEngine.execute('SELECT * FROM users WHERE id = ?', [1])
 * ```
 *
 * @example Using dialect adapters
 * ```typescript
 * import { createPostgresDialect, createMySQLDialect, createTursoDialect } from '@dotdo/db/compat/sql/shared'
 *
 * // PostgreSQL adapter with pg-compatible result format
 * const pg = createPostgresDialect()
 * const { rows, fields, rowCount } = pg.query('SELECT * FROM users')
 *
 * // MySQL adapter with mysql2-compatible result format
 * const mysql = createMySQLDialect()
 * const [rows, fields] = mysql.query('SELECT * FROM users')
 *
 * // Turso adapter with libSQL-compatible result format
 * const turso = createTursoDialect()
 * const { rows, columns, rowsAffected } = turso.execute('SELECT * FROM users')
 * ```
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type {
  SQLValue,
  StorageValue,
  TableSchema,
  StoredRow,
  ParsedQuery,
  SQLCommand,
  ExecutionResult,
  SQLDialect,
  DialectConfig,
  TransactionMode,
  TransactionState,
} from './types'

export {
  POSTGRES_DIALECT,
  MYSQL_DIALECT,
  SQLITE_DIALECT,
  SQLError,
  SQLParseError,
  TableNotFoundError,
  TableExistsError,
  UniqueConstraintError,
  ReadOnlyTransactionError,
} from './types'

// ============================================================================
// SQL ENGINE
// ============================================================================

export type { SQLEngine } from './engine'
export { InMemorySQLEngine, createSQLEngine } from './engine'

// ============================================================================
// PARSER UTILITIES
// ============================================================================

export {
  parseValueToken,
  normalizeValue,
  resolveValuePart,
  splitValues,
  splitColumnDefs,
  parseMultipleValueSets,
  detectCommand,
  parseTableName,
  parseColumnList,
  extractColumnName,
  translateDialect,
  parseCondition,
  splitWhereConditions,
  parseOrderBy,
  parseSetClause,
} from './parser'

export type {
  ConditionOperator,
  ParsedCondition,
  OrderByClause,
  SetAssignment,
} from './parser'

// ============================================================================
// DIALECT ADAPTERS
// ============================================================================

// PostgreSQL
export {
  PostgresDialect,
  createPostgresDialect,
  PostgresDatabaseError,
  mapToPostgresError,
  PgTypes,
} from './dialects/postgres'
export type { PgFieldDef, PgQueryResult } from './dialects/postgres'

// MySQL
export {
  MySQLDialect,
  createMySQLDialect,
  MySQLDatabaseError,
  MySQLConnectionError,
  mapToMySQLError,
  MySQLTypes,
} from './dialects/mysql'
export type {
  MySQLFieldPacket,
  MySQLResultSetHeader,
  MySQLRowDataPacket,
  MySQLQueryResult,
} from './dialects/mysql'

// Turso/libSQL
export {
  TursoDialect,
  TursoTransaction,
  createTursoDialect,
  TursoLibsqlError,
  TursoLibsqlBatchError,
  mapToTursoError,
  parseStatement,
} from './dialects/turso'
export type {
  TursoValue,
  TursoRow,
  TursoResultSet,
  TursoInStatement,
  TursoInArgs,
  TursoInValue,
} from './dialects/turso'
