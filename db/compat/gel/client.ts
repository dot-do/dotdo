/**
 * GEL Client - @dotdo/gel EdgeQL-like interface on SQLite
 *
 * TDD RED Phase Stubs - All methods throw "Not implemented"
 *
 * This client ties together:
 * - SDL Parser (schema definitions)
 * - DDL Generator (SQLite DDL from Schema IR)
 * - EdgeQL Parser (query parsing)
 * - Query Translator (EdgeQL AST to SQL)
 */

import type { Schema } from './sdl-parser'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error class for all GEL errors
 */
export class GelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GelError'
  }
}

/**
 * Error for schema-related issues (parsing, validation, migration)
 */
export class SchemaError extends GelError {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaError'
  }
}

/**
 * Error for query-related issues (parsing, execution, validation)
 */
export class QueryError extends GelError {
  constructor(message: string) {
    super(message)
    this.name = 'QueryError'
  }
}

/**
 * Error for cardinality violations (expected single result, got multiple or none)
 */
export class CardinalityViolationError extends GelError {
  constructor(message: string) {
    super(message)
    this.name = 'CardinalityViolationError'
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Storage interface that the GEL client operates on
 * Compatible with better-sqlite3, sql.js, and D1
 */
export interface GelStorage {
  exec(sql: string): void
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number }
  get<T>(sql: string, params?: unknown[]): T | undefined
  all<T>(sql: string, params?: unknown[]): T[]
  prepare(sql: string): GelStatement
  transaction<T>(fn: () => T): T
  inTransaction: boolean
}

export interface GelStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number }
  get<T>(...params: unknown[]): T | undefined
  all<T>(...params: unknown[]): T[]
  finalize(): void
}

/**
 * Client configuration options
 */
export interface GelClientOptions {
  /** Enable debug SQL logging */
  debug?: boolean
  /** Enable strict schema validation */
  strict?: boolean
  /** Custom logger function */
  logger?: (message: string) => void
  /** Prefix for all table names */
  tablePrefix?: string
  /** Convert identifiers to snake_case */
  snakeCase?: boolean
}

/**
 * Transaction client with same query methods
 */
export interface GelTransaction {
  query<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T[]>
  querySingle<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T | null>
  queryRequired<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T>
  execute(edgeql: string, params?: Record<string, unknown>): Promise<void>
  transaction<T>(fn: (tx: GelTransaction) => Promise<T>): Promise<T>
}

// =============================================================================
// GEL CLIENT CLASS
// =============================================================================

/**
 * GEL Client - EdgeQL-like interface on SQLite
 */
export class GelClient implements GelTransaction {
  private storage: GelStorage
  private options: GelClientOptions
  private schema: Schema | null = null
  private closed = false

  constructor(storage: GelStorage, options: GelClientOptions = {}) {
    this.storage = storage
    this.options = options
  }

  // ---------------------------------------------------------------------------
  // Schema Operations
  // ---------------------------------------------------------------------------

  /**
   * Parse and apply SDL schema to the database
   *
   * @param sdl - SDL schema definition string
   * @throws SchemaError if SDL is invalid or migration fails
   */
  ensureSchema(sdl: string): void {
    throw new GelError('Not implemented: ensureSchema')
  }

  /**
   * Get the current schema IR
   *
   * @returns Schema IR or null if no schema applied
   */
  getSchema(): Schema | null {
    throw new GelError('Not implemented: getSchema')
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Execute an EdgeQL query and return all results
   *
   * @param edgeql - EdgeQL query string
   * @param params - Optional named parameters
   * @returns Array of result objects
   * @throws QueryError if query is invalid
   */
  async query<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T[]> {
    throw new GelError('Not implemented: query')
  }

  /**
   * Execute an EdgeQL query and return a single result
   *
   * @param edgeql - EdgeQL query string
   * @param params - Optional named parameters
   * @returns Single result object or null
   * @throws CardinalityViolationError if more than one result
   */
  async querySingle<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T | null> {
    throw new GelError('Not implemented: querySingle')
  }

  /**
   * Execute an EdgeQL query and return exactly one result
   *
   * @param edgeql - EdgeQL query string
   * @param params - Optional named parameters
   * @returns Single result object (never null)
   * @throws CardinalityViolationError if zero or more than one result
   */
  async queryRequired<T = unknown>(edgeql: string, params?: Record<string, unknown>): Promise<T> {
    throw new GelError('Not implemented: queryRequired')
  }

  /**
   * Execute an EdgeQL mutation without returning results
   *
   * @param edgeql - EdgeQL mutation string (INSERT, UPDATE, DELETE)
   * @param params - Optional named parameters
   * @throws QueryError if query is invalid or is a SELECT
   */
  async execute(edgeql: string, params?: Record<string, unknown>): Promise<void> {
    throw new GelError('Not implemented: execute')
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Execute operations within a transaction
   *
   * @param fn - Async function receiving transaction client
   * @returns Result of the callback function
   * @throws Error on rollback (original error is re-thrown)
   */
  async transaction<T>(fn: (tx: GelTransaction) => Promise<T>): Promise<T> {
    throw new GelError('Not implemented: transaction')
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the client and release resources
   */
  close(): void {
    throw new GelError('Not implemented: close')
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new GEL client instance
 *
 * @param storage - SQLite-compatible storage interface
 * @param options - Client configuration options
 * @returns Configured GelClient instance
 * @throws GelError if storage is invalid
 */
export function createClient(storage: GelStorage, options?: GelClientOptions): GelClient {
  // Validate storage
  if (!storage) {
    throw new GelError('Storage is required')
  }

  const requiredMethods = ['exec', 'run', 'get', 'all', 'prepare', 'transaction']
  for (const method of requiredMethods) {
    if (typeof (storage as any)[method] !== 'function') {
      throw new GelError(`Storage missing required method: ${method}`)
    }
  }

  return new GelClient(storage, options ?? {})
}
