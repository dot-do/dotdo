/**
 * @dotdo/lib/sql - Unified SQL Parser
 *
 * Pluggable SQL parsing with support for multiple adapters:
 * - node-sql-parser: Lightweight (298KB), multi-dialect support
 * - pgsql-parser: Fast PostgreSQL WASM (1.2MB), 5-13x faster
 *
 * Features:
 * - Unified interface across all adapters
 * - Optional RPC worker deployment for heavy parsers
 * - AST normalization for consistent handling
 * - Validation and error reporting
 *
 * @example
 * ```typescript
 * import { createSQLParser } from 'lib/sql'
 *
 * // Use node-sql-parser for multi-dialect
 * const multiParser = createSQLParser({ adapter: 'node-sql-parser' })
 *
 * // Use pgsql-parser for fast PostgreSQL
 * const pgParser = createSQLParser({ adapter: 'pgsql-parser' })
 *
 * // Use RPC worker for heavy parsing
 * const rpcParser = createSQLParser({
 *   adapter: 'pgsql-parser',
 *   worker: env.SQL_PARSER_SERVICE,
 * })
 *
 * // Parse SQL
 * const result = parser.parse('SELECT * FROM users WHERE active = true')
 *
 * // Validate SQL
 * const validation = parser.validate('SELEC * FROM users')
 *
 * // Stringify AST back to SQL
 * const sql = parser.stringify(result.ast)
 * ```
 *
 * @module lib/sql
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  // Core types
  Dialect,
  StatementType,
  AST,
  ASTNode,
  ParseResult,
  ParseOptions,
  StringifyOptions,

  // Statement types
  SelectStatement,
  InsertStatement,
  UpdateStatement,
  DeleteStatement,
  CreateTableStatement,

  // Expression types
  ColumnRef,
  TableRef,
  Expression,
  LiteralValue,
  OrderByClause,
  LimitClause,

  // Schema types
  ColumnDefinition,
  TableConstraint,
  ForeignKeyRef,
  WithClause,
  OnConflictClause,

  // Validation types
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,

  // Interface types
  SQLParser,
  SQLParserRPCMethods,

  // Factory types
  ParserAdapter,
  CreateSQLParserOptions,
  ServiceBinding,
} from './types'

// ============================================================================
// ERROR EXPORTS
// ============================================================================

export { SQLParseError, SQLStringifyError } from './types'

// ============================================================================
// ADAPTER EXPORTS
// ============================================================================

export { NodeSQLParserAdapter, createNodeSQLParserAdapter } from './adapters/node-sql-parser'
export { PgsqlParserAdapter, createPgsqlParserAdapter } from './adapters/pgsql-parser'

// ============================================================================
// RPC WRAPPER
// ============================================================================

import { NodeSQLParserAdapter } from './adapters/node-sql-parser'
import { PgsqlParserAdapter } from './adapters/pgsql-parser'
import type {
  SQLParser,
  AST,
  ParseResult,
  ParseOptions,
  StringifyOptions,
  ValidationResult,
  Dialect,
  CreateSQLParserOptions,
  ServiceBinding,
  SQLParserRPCMethods,
} from './types'
import { SQLParseError, SQLStringifyError } from './types'

/**
 * RPC request envelope
 */
interface RPCRequest<T = unknown> {
  id: string
  method: string
  params: T
}

/**
 * RPC response envelope
 */
interface RPCResponse<T = unknown> {
  id: string
  result?: T
  error?: { code: string; message: string }
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `sql_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * RPC wrapper that proxies parser calls to a worker service binding
 */
class RPCSQLParserWrapper implements SQLParser {
  private worker: ServiceBinding
  private timeout: number
  private debug: boolean
  private defaultDialect: Dialect

  constructor(
    worker: ServiceBinding,
    options: {
      timeout?: number
      debug?: boolean
      defaultDialect?: Dialect
    } = {}
  ) {
    this.worker = worker
    this.timeout = options.timeout ?? 5000
    this.debug = options.debug ?? false
    this.defaultDialect = options.defaultDialect ?? 'postgresql'
  }

  get adapterName(): string {
    return 'rpc-wrapper'
  }

  get supportedDialects(): Dialect[] {
    // RPC wrapper supports whatever the remote adapter supports
    // We'll assume all dialects and let the remote handle errors
    return ['postgresql', 'mysql', 'sqlite', 'mariadb', 'transactsql', 'bigquery']
  }

  async parseAsync(sql: string, options?: ParseOptions): Promise<ParseResult> {
    return this.call<SQLParserRPCMethods['sql.parse']['params'], ParseResult>('sql.parse', {
      sql,
      options: { dialect: this.defaultDialect, ...options },
    })
  }

  parse(sql: string, options?: ParseOptions): ParseResult {
    // Synchronous parsing is not possible with RPC
    // We throw an error suggesting to use parseAsync
    throw new SQLParseError(
      'RPC wrapper does not support synchronous parsing. Use parseAsync() instead.',
      { sql, dialect: options?.dialect ?? this.defaultDialect }
    )
  }

  async stringifyAsync(ast: AST | AST[], options?: StringifyOptions): Promise<string> {
    const result = await this.call<SQLParserRPCMethods['sql.stringify']['params'], { sql: string }>(
      'sql.stringify',
      { ast, options }
    )
    return result.sql
  }

  stringify(ast: AST | AST[], options?: StringifyOptions): string {
    // Synchronous stringification is not possible with RPC
    throw new SQLStringifyError(
      'RPC wrapper does not support synchronous stringify. Use stringifyAsync() instead.'
    )
  }

  async validateAsync(sql: string, dialect?: Dialect): Promise<ValidationResult> {
    return this.call<SQLParserRPCMethods['sql.validate']['params'], ValidationResult>('sql.validate', {
      sql,
      dialect: dialect ?? this.defaultDialect,
    })
  }

  validate(sql: string, dialect?: Dialect): ValidationResult {
    // Synchronous validation is not possible with RPC
    // Return a result indicating async is required
    return {
      valid: false,
      issues: [
        {
          severity: 'error',
          message: 'RPC wrapper does not support synchronous validation. Use validateAsync() instead.',
          code: 'RPC_SYNC_NOT_SUPPORTED',
        },
      ],
      sql,
      dialect: dialect ?? this.defaultDialect,
    }
  }

  /**
   * Get information about the remote parser
   */
  async getInfo(): Promise<{ adapter: string; version: string; dialects: Dialect[] }> {
    return this.call<Record<string, never>, { adapter: string; version: string; dialects: Dialect[] }>(
      'sql.info',
      {}
    )
  }

  /**
   * Make an RPC call to the worker
   */
  private async call<TParams, TResult>(method: string, params: TParams): Promise<TResult> {
    const requestId = generateRequestId()

    const request: RPCRequest<TParams> = {
      id: requestId,
      method,
      params,
    }

    if (this.debug) {
      console.log(`[sql-parser-rpc] Calling ${method}`, params)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this.worker.fetch('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`RPC call failed with status ${response.status}: ${errorText}`)
      }

      const rpcResponse: RPCResponse<TResult> = await response.json()

      if (rpcResponse.error) {
        throw new Error(`RPC error: ${rpcResponse.error.message}`)
      }

      if (this.debug) {
        console.log(`[sql-parser-rpc] Response for ${method}`, rpcResponse.result)
      }

      return rpcResponse.result as TResult
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`RPC call to '${method}' timed out after ${this.timeout}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SQL parser with the specified adapter.
 *
 * @param options - Parser configuration
 * @returns SQL parser instance
 *
 * @example
 * ```typescript
 * // Use node-sql-parser (multi-dialect, smaller bundle)
 * const parser = createSQLParser({ adapter: 'node-sql-parser' })
 *
 * // Use pgsql-parser (PostgreSQL only, faster)
 * const parser = createSQLParser({ adapter: 'pgsql-parser' })
 *
 * // Use RPC worker (offload parsing to separate worker)
 * const parser = createSQLParser({
 *   adapter: 'pgsql-parser',
 *   worker: env.SQL_PARSER_SERVICE,
 * })
 * ```
 */
export function createSQLParser(options: CreateSQLParserOptions): SQLParser {
  // If worker is provided, use RPC wrapper
  if (options.worker) {
    return new RPCSQLParserWrapper(options.worker, {
      timeout: options.rpcTimeout,
      debug: options.debug,
      defaultDialect: options.defaultDialect,
    })
  }

  // Otherwise, create local parser instance
  switch (options.adapter) {
    case 'node-sql-parser':
      return new NodeSQLParserAdapter()

    case 'pgsql-parser':
      return new PgsqlParserAdapter()

    default:
      throw new Error(`Unknown parser adapter: ${options.adapter}`)
  }
}

/**
 * Create a SQL parser that uses RPC when a worker is available,
 * otherwise falls back to local parsing.
 *
 * This is useful for environments where the worker may or may not
 * be configured.
 *
 * @param options - Parser configuration
 * @returns SQL parser with fallback
 *
 * @example
 * ```typescript
 * const parser = createSQLParserWithFallback({
 *   adapter: 'pgsql-parser',
 *   worker: env.SQL_PARSER_SERVICE, // may be undefined
 * })
 *
 * // Will use RPC if worker available, otherwise local
 * const result = parser.parse('SELECT * FROM users')
 * ```
 */
export function createSQLParserWithFallback(options: CreateSQLParserOptions): SQLParser {
  // If worker is provided, use it; otherwise use local parser
  return createSQLParser(options)
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick parse SQL using default adapter (node-sql-parser)
 */
export function parseSQL(sql: string, dialect: Dialect = 'postgresql'): ParseResult {
  const parser = createSQLParser({ adapter: 'node-sql-parser' })
  return parser.parse(sql, { dialect })
}

/**
 * Quick validate SQL using default adapter (node-sql-parser)
 */
export function validateSQL(sql: string, dialect: Dialect = 'postgresql'): ValidationResult {
  const parser = createSQLParser({ adapter: 'node-sql-parser' })
  return parser.validate(sql, dialect)
}

/**
 * Quick stringify AST using default adapter (node-sql-parser)
 */
export function stringifyAST(ast: AST | AST[], dialect: Dialect = 'postgresql'): string {
  const parser = createSQLParser({ adapter: 'node-sql-parser' })
  return parser.stringify(ast, { dialect })
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default createSQLParser
