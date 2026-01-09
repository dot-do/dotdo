/**
 * @dotdo/lib/sql - Unified SQL Parser Types
 *
 * Type definitions for pluggable SQL parsing with support for:
 * - node-sql-parser: Lightweight (298KB), multi-dialect
 * - pgsql-parser: Fast PostgreSQL WASM parser (1.2MB, 5-13x faster)
 *
 * @module lib/sql/types
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Supported SQL dialects
 */
export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'mariadb' | 'transactsql' | 'bigquery'

/**
 * SQL statement types
 */
export type StatementType =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'create_table'
  | 'create_index'
  | 'drop_table'
  | 'drop_index'
  | 'alter_table'
  | 'truncate'
  | 'begin'
  | 'commit'
  | 'rollback'
  | 'set'
  | 'show'
  | 'explain'
  | 'with'
  | 'unknown'

/**
 * Abstract Syntax Tree node base
 */
export interface ASTNode {
  /** Node type identifier */
  type: string
  /** Location in source SQL (optional) */
  loc?: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
}

/**
 * Column reference in AST
 */
export interface ColumnRef extends ASTNode {
  type: 'column_ref'
  table?: string
  column: string | '*'
  as?: string
}

/**
 * Table reference in AST
 */
export interface TableRef extends ASTNode {
  type: 'table_ref'
  db?: string
  schema?: string
  table: string
  as?: string
}

/**
 * Expression node
 */
export interface Expression extends ASTNode {
  type: 'binary_expr' | 'unary_expr' | 'function' | 'aggr_func' | 'case' | 'cast' | string
  operator?: string
  left?: Expression | ColumnRef | LiteralValue
  right?: Expression | ColumnRef | LiteralValue
  args?: Expression[]
}

/**
 * Literal value node
 */
export interface LiteralValue extends ASTNode {
  type: 'number' | 'string' | 'bool' | 'null' | 'param'
  value: string | number | boolean | null
}

/**
 * Order by clause
 */
export interface OrderByClause {
  expr: ColumnRef | Expression
  type: 'ASC' | 'DESC'
  nulls?: 'FIRST' | 'LAST'
}

/**
 * Limit clause
 */
export interface LimitClause {
  value: number | LiteralValue
  offset?: number | LiteralValue
}

/**
 * SELECT statement AST
 */
export interface SelectStatement extends ASTNode {
  type: 'select'
  distinct?: boolean
  columns: (ColumnRef | Expression | { expr: Expression; as?: string })[] | '*'
  from?: TableRef[]
  where?: Expression
  groupby?: (ColumnRef | Expression)[]
  having?: Expression
  orderby?: OrderByClause[]
  limit?: LimitClause
  with?: WithClause[]
}

/**
 * INSERT statement AST
 */
export interface InsertStatement extends ASTNode {
  type: 'insert'
  table: TableRef
  columns?: string[]
  values?: LiteralValue[][]
  select?: SelectStatement
  returning?: ColumnRef[]
  on_conflict?: OnConflictClause
}

/**
 * UPDATE statement AST
 */
export interface UpdateStatement extends ASTNode {
  type: 'update'
  table: TableRef
  set: { column: string; value: Expression | LiteralValue }[]
  where?: Expression
  returning?: ColumnRef[]
}

/**
 * DELETE statement AST
 */
export interface DeleteStatement extends ASTNode {
  type: 'delete'
  from: TableRef
  where?: Expression
  returning?: ColumnRef[]
}

/**
 * CREATE TABLE statement AST
 */
export interface CreateTableStatement extends ASTNode {
  type: 'create_table'
  table: TableRef
  if_not_exists?: boolean
  columns: ColumnDefinition[]
  constraints?: TableConstraint[]
}

/**
 * Column definition in CREATE TABLE
 */
export interface ColumnDefinition {
  name: string
  dataType: string
  nullable?: boolean
  default?: Expression | LiteralValue
  primary_key?: boolean
  unique?: boolean
  auto_increment?: boolean
  references?: ForeignKeyRef
}

/**
 * Table constraint
 */
export interface TableConstraint {
  type: 'primary_key' | 'unique' | 'foreign_key' | 'check'
  name?: string
  columns?: string[]
  references?: ForeignKeyRef
  expression?: Expression
}

/**
 * Foreign key reference
 */
export interface ForeignKeyRef {
  table: string
  columns: string[]
  on_delete?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION'
  on_update?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION'
}

/**
 * WITH clause (CTE)
 */
export interface WithClause {
  name: string
  columns?: string[]
  query: SelectStatement
  recursive?: boolean
}

/**
 * ON CONFLICT clause (UPSERT)
 */
export interface OnConflictClause {
  target?: string[] | { constraint: string }
  action: 'nothing' | { update: { column: string; value: Expression | LiteralValue }[] }
}

/**
 * Generic AST - union of all statement types
 */
export type AST =
  | SelectStatement
  | InsertStatement
  | UpdateStatement
  | DeleteStatement
  | CreateTableStatement
  | ASTNode

/**
 * Parse result containing one or more statements
 */
export interface ParseResult {
  /** Parsed AST nodes */
  ast: AST | AST[]
  /** Source SQL */
  sql: string
  /** Detected dialect */
  dialect: Dialect
  /** Parse time in microseconds */
  parseTimeUs?: number
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation severity levels
 */
export type ValidationSeverity = 'error' | 'warning' | 'info'

/**
 * Single validation issue
 */
export interface ValidationIssue {
  /** Issue severity */
  severity: ValidationSeverity
  /** Issue message */
  message: string
  /** Location in source SQL */
  location?: {
    line: number
    column: number
    offset?: number
    length?: number
  }
  /** Error code for programmatic handling */
  code?: string
  /** Suggested fix (if available) */
  suggestion?: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the SQL is valid */
  valid: boolean
  /** List of validation issues */
  issues: ValidationIssue[]
  /** The original SQL */
  sql: string
  /** Detected/validated dialect */
  dialect: Dialect
}

// ============================================================================
// PARSER INTERFACE
// ============================================================================

/**
 * SQL Parser options
 */
export interface ParseOptions {
  /** SQL dialect (default: postgresql) */
  dialect?: Dialect
  /** Whether to include location info in AST */
  includeLocations?: boolean
  /** Whether to throw on parse error (default: true) */
  throwOnError?: boolean
}

/**
 * Stringify options
 */
export interface StringifyOptions {
  /** Target dialect for output */
  dialect?: Dialect
  /** Format output with indentation/newlines */
  format?: boolean
  /** Indentation string (default: '  ') */
  indent?: string
  /** Quote identifier style */
  identifierQuote?: '"' | '`' | '['
}

/**
 * Unified SQL Parser interface
 *
 * All parser adapters must implement this interface, allowing
 * seamless switching between node-sql-parser and pgsql-parser.
 *
 * @example
 * ```typescript
 * import { createSQLParser } from 'lib/sql'
 *
 * // Use node-sql-parser (lightweight, multi-dialect)
 * const parser = createSQLParser({ adapter: 'node-sql-parser' })
 *
 * // Or use pgsql-parser (fast PostgreSQL)
 * const parser = createSQLParser({ adapter: 'pgsql-parser' })
 *
 * // Parse SQL to AST
 * const result = parser.parse('SELECT * FROM users WHERE active = true')
 *
 * // Convert AST back to SQL
 * const sql = parser.stringify(result.ast)
 *
 * // Validate SQL syntax
 * const validation = parser.validate('SELEC * FROM users')
 * // { valid: false, issues: [{ message: 'Syntax error...' }] }
 * ```
 */
export interface SQLParser {
  /**
   * Parse SQL string to AST
   *
   * @param sql - SQL string to parse
   * @param options - Parse options
   * @returns Parse result with AST
   * @throws SQLParseError if parsing fails and throwOnError is true
   */
  parse(sql: string, options?: ParseOptions): ParseResult

  /**
   * Convert AST back to SQL string
   *
   * @param ast - AST to stringify
   * @param options - Stringify options
   * @returns SQL string
   */
  stringify(ast: AST | AST[], options?: StringifyOptions): string

  /**
   * Validate SQL syntax without full parse
   *
   * @param sql - SQL string to validate
   * @param dialect - Target dialect
   * @returns Validation result
   */
  validate(sql: string, dialect?: Dialect): ValidationResult

  /**
   * Get the adapter name
   */
  readonly adapterName: string

  /**
   * Get supported dialects
   */
  readonly supportedDialects: Dialect[]
}

// ============================================================================
// RPC TYPES
// ============================================================================

/**
 * SQL Parser RPC method definitions for service binding
 */
export interface SQLParserRPCMethods {
  'sql.parse': {
    params: { sql: string; options?: ParseOptions }
    result: ParseResult
  }
  'sql.stringify': {
    params: { ast: AST | AST[]; options?: StringifyOptions }
    result: { sql: string }
  }
  'sql.validate': {
    params: { sql: string; dialect?: Dialect }
    result: ValidationResult
  }
  'sql.info': {
    params: Record<string, never>
    result: {
      adapter: string
      version: string
      dialects: Dialect[]
    }
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * SQL parse error with location information
 */
export class SQLParseError extends Error {
  readonly code = 'SQL_PARSE_ERROR'
  readonly location?: {
    line: number
    column: number
    offset?: number
  }
  readonly sql: string
  readonly dialect: Dialect
  readonly cause?: Error

  constructor(
    message: string,
    options: {
      sql: string
      dialect: Dialect
      location?: { line: number; column: number; offset?: number }
      cause?: Error
    }
  ) {
    super(message)
    this.name = 'SQLParseError'
    this.sql = options.sql
    this.dialect = options.dialect
    this.location = options.location
    this.cause = options.cause
  }

  /**
   * Get formatted error message with source context
   */
  toFormattedString(): string {
    const lines = this.sql.split('\n')
    let context = ''

    if (this.location && this.location.line <= lines.length) {
      const line = lines[this.location.line - 1]
      const pointer = ' '.repeat(this.location.column - 1) + '^'
      context = `\n  ${this.location.line} | ${line}\n    | ${pointer}`
    }

    return `${this.message}${context}`
  }
}

/**
 * SQL stringify error
 */
export class SQLStringifyError extends Error {
  readonly code = 'SQL_STRINGIFY_ERROR'
  readonly cause?: Error

  constructor(message: string, options?: { cause?: Error }) {
    super(message)
    this.name = 'SQLStringifyError'
    this.cause = options?.cause
  }
}

// ============================================================================
// FACTORY TYPES
// ============================================================================

/**
 * Available parser adapters
 */
export type ParserAdapter = 'node-sql-parser' | 'pgsql-parser'

/**
 * Cloudflare service binding (Fetcher interface)
 */
export interface ServiceBinding {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
}

/**
 * SQL Parser factory options
 */
export interface CreateSQLParserOptions {
  /**
   * Parser adapter to use
   * - 'node-sql-parser': Lightweight (298KB), supports multiple dialects
   * - 'pgsql-parser': Fast PostgreSQL WASM (1.2MB), 5-13x faster
   */
  adapter: ParserAdapter

  /**
   * Optional service binding for RPC-based parsing
   * When provided, parsing is offloaded to a separate Worker
   */
  worker?: ServiceBinding

  /**
   * Default dialect for parsing
   */
  defaultDialect?: Dialect

  /**
   * RPC timeout in milliseconds (default: 5000)
   */
  rpcTimeout?: number

  /**
   * Enable debug logging
   */
  debug?: boolean
}
