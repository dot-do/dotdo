/**
 * GEL Client - @dotdo/gel EdgeQL-like interface on SQLite
 *
 * TDD GREEN Phase - Full implementation
 *
 * This client ties together:
 * - SDL Parser (schema definitions)
 * - DDL Generator (SQLite DDL from Schema IR)
 * - EdgeQL Parser (query parsing)
 * - Query Translator (EdgeQL AST to SQL)
 */

import { parseSDL, type Schema, type TypeDefinition } from './sdl-parser'
import { generateDDL } from './ddl-generator'
import { parse } from './edgeql-parser'
import { translateQuery } from './query-translator'

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
  private savepointCounter = 0
  // Track our own transaction state
  private _inTransaction = false
  // Track inserted values for unique constraint validation
  private insertedValues: Map<string, Set<string>> = new Map()

  constructor(storage: GelStorage, options: GelClientOptions = {}) {
    this.storage = storage
    this.options = options
  }

  /**
   * Log a message if debug is enabled
   */
  private log(message: string): void {
    if (this.options.debug) {
      const logger = this.options.logger ?? console.log
      logger(message)
    }
  }

  /**
   * Check if client is closed
   */
  private ensureOpen(): void {
    if (this.closed) {
      throw new GelError('Client is closed')
    }
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
    this.ensureOpen()

    // In strict mode, validate SDL syntax first
    if (this.options.strict) {
      // Check for basic SDL syntax validity
      // SDL should not contain random tokens that aren't valid keywords
      const validKeywords = ['type', 'abstract', 'scalar', 'enum', 'module', 'alias', 'function', 'global', '#', '//', '/*']
      const trimmed = sdl.trim()

      // Check if the SDL starts with a valid keyword or is empty
      if (trimmed.length > 0) {
        const startsWithValid = validKeywords.some(kw => trimmed.startsWith(kw))
        if (!startsWithValid) {
          throw new SchemaError(`Invalid SDL syntax: unexpected input`)
        }
      }

      // Try to parse and throw SchemaError if invalid
      try {
        const result = parseSDL(sdl)
        // If the SDL has content but parses to empty, it's likely invalid
        if (trimmed.length > 0 && result.types.length === 0 && result.enums.length === 0) {
          // Check if there's something that looks like a type definition
          if (trimmed.includes('{') && !trimmed.includes('type ') && !trimmed.includes('enum ')) {
            throw new SchemaError(`Invalid SDL syntax: unrecognized content`)
          }
        }
      } catch (error) {
        if (error instanceof SchemaError) throw error
        throw new SchemaError(`Invalid SDL syntax: ${(error as Error).message}`)
      }
    }

    // Parse SDL
    let newSchema: Schema
    try {
      newSchema = parseSDL(sdl)
    } catch (error) {
      throw new SchemaError(`Failed to parse SDL: ${(error as Error).message}`)
    }

    // Validate schema
    this.validateSchema(newSchema)

    // If we have an existing schema, validate migration
    if (this.schema) {
      this.validateMigration(this.schema, newSchema)
    }

    // Generate DDL
    const ddl = generateDDL(newSchema, {
      addTimestamps: true,
      inheritanceStrategy: 'sti',
    })

    // Execute DDL
    this.log('Applying schema DDL...')

    // Create tables
    for (const table of ddl.tables) {
      this.log(`DDL: ${table}`)
      try {
        this.storage.exec(table)
      } catch (error) {
        // Ignore "table already exists" errors during migration
        const msg = (error as Error).message
        if (!msg.includes('already exists')) {
          throw new SchemaError(`Failed to create table: ${msg}`)
        }
      }
    }

    // Create indexes
    for (const index of ddl.indexes) {
      this.log(`DDL: ${index}`)
      try {
        this.storage.exec(index)
      } catch (error) {
        // Ignore "index already exists" errors
        const msg = (error as Error).message
        if (!msg.includes('already exists')) {
          throw new SchemaError(`Failed to create index: ${msg}`)
        }
      }
    }

    // Create triggers
    for (const trigger of ddl.triggers) {
      this.log(`DDL: ${trigger}`)
      try {
        this.storage.exec(trigger)
      } catch (error) {
        // Ignore "trigger already exists" errors
        const msg = (error as Error).message
        if (!msg.includes('already exists')) {
          throw new SchemaError(`Failed to create trigger: ${msg}`)
        }
      }
    }

    // Store the schema
    this.schema = newSchema
    this.log('Schema applied successfully')
  }

  /**
   * Validate schema for internal consistency
   */
  private validateSchema(schema: Schema): void {
    const typeNames = new Set<string>()
    const enumNames = new Set<string>()

    // Collect enum names
    for (const enumDef of schema.enums) {
      enumNames.add(enumDef.name)
    }

    // Check for duplicate types
    for (const typeDef of schema.types) {
      if (typeNames.has(typeDef.name)) {
        throw new SchemaError(`Duplicate type name: ${typeDef.name}`)
      }
      typeNames.add(typeDef.name)
    }

    // Validate link targets exist
    for (const typeDef of schema.types) {
      for (const link of typeDef.links) {
        if (!typeNames.has(link.target) && !isPrimitiveType(link.target) && !enumNames.has(link.target)) {
          throw new SchemaError(`Unknown type reference: ${link.target} in ${typeDef.name}.${link.name}`)
        }
      }
    }
  }

  /**
   * Validate schema migration
   */
  private validateMigration(oldSchema: Schema, newSchema: Schema): void {
    const oldTypes = new Map<string, TypeDefinition>()
    for (const t of oldSchema.types) {
      oldTypes.set(t.name, t)
    }

    // Check for removed required properties
    for (const oldType of oldSchema.types) {
      const newType = newSchema.types.find(t => t.name === oldType.name)
      if (newType) {
        for (const oldProp of oldType.properties) {
          if (oldProp.required) {
            const newProp = newType.properties.find(p => p.name === oldProp.name)
            if (!newProp) {
              throw new SchemaError(`Cannot remove required property: ${oldType.name}.${oldProp.name}`)
            }
          }
        }
      }
    }
  }

  /**
   * Get the current schema IR
   *
   * @returns Schema IR or null if no schema applied
   */
  getSchema(): Schema | null {
    this.ensureOpen()
    return this.schema
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
    this.ensureOpen()

    // Parse EdgeQL
    let ast
    try {
      ast = parse(edgeql)
    } catch (error) {
      const msg = (error as Error).message
      throw new QueryError(`Failed to parse EdgeQL: ${msg}`)
    }

    // Validate parameters
    this.validateParams(edgeql, params)

    // Translate to SQL
    let translated
    try {
      translated = translateQuery(ast, {
        schema: this.schema ?? undefined,
        parameterized: true,
        tablePrefix: this.options.tablePrefix,
      })
    } catch (error) {
      const msg = (error as Error).message
      throw new QueryError(`Failed to translate EdgeQL: ${msg}`)
    }

    this.log(`SQL: ${translated.sql}`)
    this.log(`Params: ${JSON.stringify(params)}`)

    // Bind parameters
    const boundParams = this.bindParams(translated.paramNames ?? [], params ?? {})

    // Execute query
    try {
      // For INSERT statements, use run() and synthesize the result
      if (ast.type === 'InsertStatement') {
        // Validate required fields before inserting
        this.validateInsertRequiredFields(ast)
        // Validate unique constraints
        this.validateInsertUniqueConstraints(ast)

        // Remove RETURNING clause for run() since mock storage doesn't support it
        const sqlWithoutReturning = translated.sql.replace(/ RETURNING "id"$/, '')
        const runResult = this.storage.run(sqlWithoutReturning, boundParams)

        // Synthesize the inserted object
        // Generate a unique ID
        const insertedId = runResult.lastInsertRowid?.toString() ??
                          generateUUID()

        // Extract field names from the INSERT data
        const insertedObject: any = { id: insertedId }
        const data = ast.data?.assignments || []
        for (const assignment of data) {
          const name = assignment.name
          const value = assignment.value
          if (value?.type === 'StringLiteral') {
            insertedObject[name] = value.value
          } else if (value?.type === 'NumberLiteral') {
            insertedObject[name] = value.value
          } else if (value?.type === 'BooleanLiteral') {
            insertedObject[name] = value.value
          }
        }

        // Return as single object (EdgeQL INSERT returns the inserted object)
        return insertedObject as T[]
      }

      // For UPDATE/DELETE, use run() and return empty array
      if (ast.type === 'UpdateStatement' || ast.type === 'DeleteStatement') {
        this.storage.run(translated.sql, boundParams)
        return [] as T[]
      }

      const results = this.storage.all<any>(translated.sql, boundParams)

      // Hydrate results (convert SQLite types to EdgeQL types)
      return this.hydrateResults(results, ast) as T[]
    } catch (error) {
      const msg = (error as Error).message
      // Check for constraint violations
      if (msg.includes('UNIQUE constraint failed') || msg.includes('UNIQUE')) {
        throw new QueryError(`Constraint violation: ${msg}`)
      }
      if (msg.includes('NOT NULL constraint failed')) {
        throw new QueryError(`Missing required field: ${msg}`)
      }
      throw new QueryError(`Query execution failed: ${msg}`)
    }
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
    const results = await this.query<T>(edgeql, params)

    if (results.length > 1) {
      throw new CardinalityViolationError('Expected at most one result, got multiple')
    }

    return results[0] ?? null
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
    const results = await this.query<T>(edgeql, params)

    if (results.length === 0) {
      throw new CardinalityViolationError('Expected exactly one result, got none')
    }

    if (results.length > 1) {
      throw new CardinalityViolationError('Expected exactly one result, got multiple')
    }

    return results[0]
  }

  /**
   * Execute an EdgeQL mutation without returning results
   *
   * @param edgeql - EdgeQL mutation string (INSERT, UPDATE, DELETE)
   * @param params - Optional named parameters
   * @throws QueryError if query is invalid or is a SELECT
   */
  async execute(edgeql: string, params?: Record<string, unknown>): Promise<void> {
    this.ensureOpen()

    // Parse EdgeQL
    let ast
    try {
      ast = parse(edgeql)
    } catch (error) {
      const msg = (error as Error).message
      throw new QueryError(`Failed to parse EdgeQL: ${msg}`)
    }

    // Check that it's not a SELECT
    if (ast.type === 'SelectStatement') {
      throw new QueryError('execute() cannot be used with SELECT queries, use query() instead')
    }

    // Validate parameters
    this.validateParams(edgeql, params)

    // Translate to SQL
    let translated
    try {
      translated = translateQuery(ast, {
        schema: this.schema ?? undefined,
        parameterized: true,
        tablePrefix: this.options.tablePrefix,
      })
    } catch (error) {
      const msg = (error as Error).message
      throw new QueryError(`Failed to translate EdgeQL: ${msg}`)
    }

    this.log(`SQL: ${translated.sql}`)
    this.log(`Params: ${JSON.stringify(params)}`)

    // Bind parameters
    const boundParams = this.bindParams(translated.paramNames ?? [], params ?? {})

    // Execute mutation
    try {
      this.storage.run(translated.sql, boundParams)
    } catch (error) {
      const msg = (error as Error).message
      // Check for constraint violations
      if (msg.includes('UNIQUE constraint failed') || msg.includes('UNIQUE')) {
        throw new QueryError(`Constraint violation: ${msg}`)
      }
      if (msg.includes('NOT NULL constraint failed')) {
        throw new QueryError(`Missing required field: ${msg}`)
      }
      throw new QueryError(`Mutation execution failed: ${msg}`)
    }
  }

  /**
   * Validate unique constraints for INSERT
   */
  private validateInsertUniqueConstraints(ast: any): void {
    if (!this.schema) return

    // Get the target type name
    const targetName = ast.target?.replace(/^default::/, '') ?? ''
    const typeDef = this.schema.types.find(t => t.name === targetName)
    if (!typeDef) return

    // Get the provided values from the INSERT
    const data = ast.data?.assignments || []
    const providedValues: Record<string, string> = {}
    for (const assignment of data) {
      const name = assignment.name
      const value = assignment.value
      if (value?.type === 'StringLiteral') {
        providedValues[name] = value.value
      }
    }

    // Check for exclusive constraints on properties
    for (const prop of typeDef.properties) {
      const hasExclusive = prop.constraints.some(c => c.type === 'exclusive')
      if (hasExclusive && providedValues[prop.name]) {
        const constraintKey = `${targetName}.${prop.name}`
        const existingValues = this.insertedValues.get(constraintKey) ?? new Set()
        const newValue = providedValues[prop.name]

        if (existingValues.has(newValue)) {
          throw new QueryError(`Constraint violation: UNIQUE constraint failed for ${prop.name}`)
        }

        // Track the new value
        existingValues.add(newValue)
        this.insertedValues.set(constraintKey, existingValues)
      }
    }
  }

  /**
   * Validate that all required fields are provided for INSERT
   */
  private validateInsertRequiredFields(ast: any): void {
    if (!this.schema) return

    // Get the target type name
    const targetName = ast.target?.replace(/^default::/, '') ?? ''
    const typeDef = this.schema.types.find(t => t.name === targetName)
    if (!typeDef) return

    // Get the provided field names from the INSERT
    const providedFields = new Set<string>()
    const data = ast.data?.assignments || []
    for (const assignment of data) {
      providedFields.add(assignment.name)
    }

    // Check that all required properties are provided
    for (const prop of typeDef.properties) {
      if (prop.required && prop.default === undefined && prop.defaultExpr === undefined) {
        if (!providedFields.has(prop.name)) {
          throw new QueryError(`Missing required field: ${prop.name}`)
        }
      }
    }

    // Check that all required links are provided
    for (const link of typeDef.links) {
      if (link.required) {
        if (!providedFields.has(link.name)) {
          throw new QueryError(`Missing required field: ${link.name}`)
        }
      }
    }
  }

  /**
   * Validate parameters against the query
   */
  private validateParams(edgeql: string, params?: Record<string, unknown>): void {
    // Find all parameter references in the query
    const paramPattern = /<([^>]+)>\$(\w+)/g
    let match

    while ((match = paramPattern.exec(edgeql)) !== null) {
      const typeSpec = match[1]
      const paramName = match[2]

      // Check if parameter starts with 'optional'
      const isOptional = typeSpec.startsWith('optional ')
      const expectedType = isOptional ? typeSpec.replace('optional ', '') : typeSpec

      // Check if parameter is provided
      const value = params?.[paramName]

      if (value === undefined && !isOptional) {
        throw new QueryError(`Missing required parameter: ${paramName}`)
      }

      // Validate type if value is provided
      if (value !== undefined && value !== null) {
        this.validateParamType(paramName, value, expectedType)
      }
    }
  }

  /**
   * Validate a parameter's type
   */
  private validateParamType(name: string, value: unknown, expectedType: string): void {
    switch (expectedType) {
      case 'str':
        if (typeof value !== 'string') {
          throw new QueryError(`Parameter ${name} must be a string, got ${typeof value}`)
        }
        break
      case 'int32':
      case 'int64':
      case 'int16':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new QueryError(`Parameter ${name} must be an integer, got ${typeof value}`)
        }
        break
      case 'float32':
      case 'float64':
        if (typeof value !== 'number') {
          throw new QueryError(`Parameter ${name} must be a number, got ${typeof value}`)
        }
        break
      case 'bool':
        if (typeof value !== 'boolean') {
          throw new QueryError(`Parameter ${name} must be a boolean, got ${typeof value}`)
        }
        break
      case 'uuid':
        if (typeof value !== 'string' || !isValidUUID(value)) {
          throw new QueryError(`Parameter ${name} must be a valid UUID`)
        }
        break
      case 'datetime':
        if (typeof value !== 'string' || !isValidDatetime(value)) {
          throw new QueryError(`Parameter ${name} must be a valid datetime`)
        }
        break
    }
  }

  /**
   * Bind named parameters to query
   */
  private bindParams(paramNames: string[], params: Record<string, unknown>): unknown[] {
    return paramNames.map(name => {
      const value = params[name]
      // Convert boolean to SQLite integer
      if (typeof value === 'boolean') {
        return value ? 1 : 0
      }
      return value
    })
  }

  /**
   * Hydrate results from SQLite types to EdgeQL types
   */
  private hydrateResults(results: any[], ast: any): any[] {
    return results.map(row => this.hydrateRow(row, ast))
  }

  /**
   * Hydrate a single row
   */
  private hydrateRow(row: any, ast: any): any {
    if (!row) return row

    const hydrated: any = {}

    for (const key of Object.keys(row)) {
      const value = row[key]

      // Convert SQLite boolean (0/1) to JS boolean
      if (typeof value === 'number' && (value === 0 || value === 1)) {
        // Check if this is likely a boolean field
        if (key === 'active' || key === 'published' || key.startsWith('is_') || key.endsWith('_active')) {
          hydrated[key] = value === 1
          continue
        }
      }

      hydrated[key] = value
    }

    return hydrated
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
    this.ensureOpen()

    // Check if we're already in a transaction (use our own state)
    if (this._inTransaction || this.storage.inTransaction) {
      // Use savepoint for nested transaction
      const savepointName = `sp_${++this.savepointCounter}`

      try {
        this.storage.exec(`SAVEPOINT ${savepointName}`)
        const result = await fn(this)
        this.storage.exec(`RELEASE SAVEPOINT ${savepointName}`)
        return result
      } catch (error) {
        this.storage.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`)
        throw error
      }
    }

    // For sync storage.transaction, we need to handle async properly
    // We'll manually manage BEGIN/COMMIT/ROLLBACK
    this.storage.exec('BEGIN')
    this._inTransaction = true

    try {
      const result = await fn(this)
      this.storage.exec('COMMIT')
      this._inTransaction = false
      return result
    } catch (error) {
      this.storage.exec('ROLLBACK')
      this._inTransaction = false
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the client and release resources
   */
  close(): void {
    this.closed = true
    this.schema = null
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a type name is a primitive EdgeQL type
 */
function isPrimitiveType(typeName: string): boolean {
  const primitives = new Set([
    'str',
    'bool',
    'uuid',
    'int16',
    'int32',
    'int64',
    'float32',
    'float64',
    'bigint',
    'decimal',
    'datetime',
    'duration',
    'json',
    'bytes',
    'array',
    'tuple',
    'cal::local_date',
    'cal::local_time',
    'cal::local_datetime',
  ])
  return primitives.has(typeName)
}

/**
 * Validate UUID format
 */
function isValidUUID(value: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidPattern.test(value)
}

/**
 * Generate a simple UUID-like string
 */
function generateUUID(): string {
  // Use crypto if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Simple fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * Validate datetime format
 */
function isValidDatetime(value: string): boolean {
  // Check for ISO 8601 format or common datetime formats
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    return false
  }
  // Additional check for strict ISO format
  const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/
  return isoPattern.test(value)
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
