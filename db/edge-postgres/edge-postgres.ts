/**
 * EdgePostgres - Postgres for Durable Objects
 *
 * PGLite WASM + FSX storage integration for running Postgres in Durable Objects.
 * Provides full Postgres SQL support including pgvector for semantic search.
 *
 * Features:
 * - Full Postgres SQL parser via PGLite WASM
 * - pgvector extension for vector similarity search
 * - FSX-backed persistence with checkpointing
 * - Transaction support with automatic rollback
 * - Query options (timeout, tier, sessionToken)
 *
 * @module db/edge-postgres
 */

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for EdgePostgres tiering behavior
 */
export interface TieringConfig {
  /** How long to keep data in hot tier (ms). Default: 5 minutes */
  hotRetentionMs?: number
  /** Number of writes before triggering flush. Default: 1000 */
  flushThreshold?: number
  /** Interval between automatic flushes (ms). Default: 60 seconds */
  flushIntervalMs?: number
}

/**
 * Configuration for PGLite WASM runtime
 */
export interface PGLiteConfig {
  /** Extensions to load. 'pgvector' is supported */
  extensions?: string[]
  /** Initial WASM memory allocation in bytes. Default: 16MB */
  initialMemory?: number
}

/**
 * Configuration for sharding (future feature)
 */
export interface ShardingConfig {
  /** Column to shard on */
  key: string
  /** Number of shards */
  count: number
  /** Sharding algorithm */
  algorithm: 'consistent' | 'range' | 'hash'
}

/**
 * Configuration for replication (future feature)
 */
export interface ReplicationConfig {
  /** Data jurisdiction */
  jurisdiction?: 'eu' | 'us' | 'fedramp'
  /** AWS-style region names */
  regions?: string[]
  /** IATA airport codes for cities */
  cities?: string[]
  /** Where to read from */
  readFrom: 'primary' | 'nearest' | 'session'
  /** Whether to sync writes to all replicas */
  writeThrough?: boolean
}

/**
 * Full EdgePostgres configuration
 */
export interface EdgePostgresConfig {
  /** Tiering configuration */
  tiering?: TieringConfig
  /** PGLite configuration */
  pglite?: PGLiteConfig
  /** Sharding configuration (future) */
  sharding?: ShardingConfig
  /** Replication configuration (future) */
  replication?: ReplicationConfig
}

/**
 * Options for query execution
 */
export interface QueryOptions {
  /** Query timeout in milliseconds */
  timeout?: number
  /** Force reading from specific tier */
  tier?: 'hot' | 'warm' | 'all'
  /** Session token for read-your-writes consistency */
  sessionToken?: string
}

/**
 * Result of a query execution
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Array of returned rows */
  rows: T[]
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  affectedRows?: number
  /** Session token for subsequent reads */
  sessionToken?: string
}

/**
 * Transaction interface for running operations within a transaction
 */
export interface Transaction {
  /** Execute a query within the transaction */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>>
  /** Execute SQL without returning rows */
  exec(sql: string): Promise<void>
  /** Rollback the transaction */
  rollback(): Promise<void>
}

// ============================================================================
// DURABLE OBJECT CONTEXT TYPES
// ============================================================================

/**
 * Durable Object storage interface
 */
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Durable Object state interface
 */
interface DOState {
  storage: DOStorage
  id: {
    toString(): string
    name?: string
  }
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Environment bindings interface
 */
interface Env {
  FSX?: unknown
  R2_BUCKET?: unknown
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE_KEYS = {
  CHECKPOINT: 'edge_postgres_checkpoint',
  CHECKPOINT_VERSION: 'edge_postgres_checkpoint_version',
  WRITE_COUNT: 'edge_postgres_write_count',
} as const

// ============================================================================
// EDGEPOSTGRES CLASS
// ============================================================================

/**
 * EdgePostgres - Postgres for Durable Objects
 *
 * Wraps PGLite WASM with FSX persistence for running full Postgres
 * in Cloudflare Durable Objects.
 *
 * @example
 * ```typescript
 * const db = new EdgePostgres(ctx, env)
 *
 * await db.exec(`
 *   CREATE TABLE users (
 *     id TEXT PRIMARY KEY,
 *     email TEXT UNIQUE,
 *     embedding vector(1536)
 *   )
 * `)
 *
 * await db.query(
 *   'INSERT INTO users VALUES ($1, $2, $3)',
 *   ['user-1', 'alice@example.com', embedding]
 * )
 *
 * const result = await db.query(
 *   'SELECT * FROM users WHERE id = $1',
 *   ['user-1']
 * )
 * ```
 */
export class EdgePostgres {
  private ctx: DOState
  private env: Env
  private config: EdgePostgresConfig
  private pglite: PGlite | null = null
  private initPromise: Promise<PGlite> | null = null
  private closed = false
  private dirty = false
  private writeCount = 0
  private checkpointVersion = 0

  constructor(ctx: DOState, env: Env, config?: EdgePostgresConfig) {
    this.ctx = ctx
    this.env = env
    this.config = config ?? {}
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Get or create the PGLite instance (lazy singleton pattern)
   */
  private async getPGLite(): Promise<PGlite> {
    if (this.closed) {
      throw new Error('EdgePostgres is closed or terminated')
    }

    // Return existing instance
    if (this.pglite) {
      return this.pglite
    }

    // Return pending initialization
    if (this.initPromise) {
      return this.initPromise
    }

    // Start initialization
    this.initPromise = this.initializePGLite()
    try {
      this.pglite = await this.initPromise
      return this.pglite
    } finally {
      this.initPromise = null
    }
  }

  /**
   * Initialize PGLite instance with extensions and restore from checkpoint
   */
  private async initializePGLite(): Promise<PGlite> {
    // Check if we should load pgvector
    const usePgVector = this.config.pglite?.extensions?.includes('pgvector')

    // Create PGLite options
    const options: {
      extensions?: Record<string, unknown>
      initialMemory?: number
    } = {}

    if (usePgVector) {
      options.extensions = { vector }
    }

    if (this.config.pglite?.initialMemory) {
      options.initialMemory = this.config.pglite.initialMemory
    }

    // Create PGLite instance
    const pg = await PGlite.create(options)

    // Try to restore from checkpoint
    await this.restoreFromCheckpoint(pg)

    return pg
  }

  /**
   * Restore database state from FSX checkpoint
   */
  private async restoreFromCheckpoint(pg: PGlite): Promise<void> {
    // Load checkpoint data from storage
    // If storage access fails, let the error propagate to indicate initialization failure
    const checkpointData = await this.ctx.storage.get<string>(
      STORAGE_KEYS.CHECKPOINT
    )

    if (checkpointData) {
      try {
        // Parse the checkpoint SQL and execute it to restore state
        await pg.exec(checkpointData)

        // Load checkpoint version
        const version = await this.ctx.storage.get<number>(
          STORAGE_KEYS.CHECKPOINT_VERSION
        )
        this.checkpointVersion = version ?? 0
      } catch (error) {
        // If SQL execution fails, log but don't fail initialization
        // This handles corrupt checkpoint data gracefully
        console.warn('Failed to restore checkpoint SQL:', error)
      }
    }
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Execute a SQL query with optional parameters
   *
   * @param sql - SQL query string with $1, $2, etc. for parameters
   * @param params - Array of parameter values
   * @param options - Query options (timeout, tier, sessionToken)
   * @returns Query result with rows
   *
   * @example
   * ```typescript
   * const result = await db.query(
   *   'SELECT * FROM users WHERE id = $1',
   *   ['user-1']
   * )
   * console.log(result.rows[0])
   * ```
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const pg = await this.getPGLite()

    // Handle timeout if specified
    if (options?.timeout) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), options.timeout)
      })

      const queryPromise = this.executeQuery<T>(pg, sql, params)
      const result = await Promise.race([queryPromise, timeoutPromise])

      // Add session token if provided
      if (options?.sessionToken) {
        return {
          ...result,
          sessionToken: this.generateSessionToken(),
        }
      }

      return result
    }

    const result = await this.executeQuery<T>(pg, sql, params)

    // Add session token if provided
    if (options?.sessionToken) {
      return {
        ...result,
        sessionToken: this.generateSessionToken(),
      }
    }

    return result
  }

  /**
   * Execute a query and process the result
   */
  private async executeQuery<T>(
    pg: PGlite,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    // Convert params for PGLite
    const processedParams = params?.map((p) => {
      if (Array.isArray(p)) {
        // Check if this looks like a vector (all numbers)
        const isVector = p.every((item) => typeof item === 'number')
        if (isVector) {
          // For pgvector types, use bracket notation: [1,2,3]
          return `[${p.join(',')}]`
        } else {
          // For Postgres TEXT[] arrays, use curly brace notation: {a,b,c}
          return `{${p.join(',')}}`
        }
      }
      return p
    })

    const result = await pg.query<T>(sql, processedParams)

    // Track writes for checkpoint threshold
    const isWrite =
      sql.trim().toUpperCase().startsWith('INSERT') ||
      sql.trim().toUpperCase().startsWith('UPDATE') ||
      sql.trim().toUpperCase().startsWith('DELETE')

    if (isWrite) {
      this.dirty = true
      this.writeCount++
    }

    // Convert numeric strings to numbers for better DX
    // PGLite returns DECIMAL/NUMERIC as strings to preserve precision,
    // but for most use cases, users expect JavaScript numbers
    const processedRows = result.rows.map((row) => {
      const processedRow: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
          // Looks like a numeric string - convert to number
          const num = Number(value)
          // Only convert if it's a valid number and doesn't lose precision
          if (!isNaN(num) && String(num) === value) {
            processedRow[key] = num
          } else {
            processedRow[key] = value
          }
        } else {
          processedRow[key] = value
        }
      }
      return processedRow as T extends Record<string, unknown> ? T : T
    })

    return {
      rows: processedRows as T[],
      affectedRows: result.affectedRows,
    }
  }

  /**
   * Execute SQL statements without returning rows
   *
   * Supports multiple statements separated by semicolons.
   *
   * @param sql - SQL statements to execute
   *
   * @example
   * ```typescript
   * await db.exec(`
   *   CREATE TABLE users (id TEXT PRIMARY KEY);
   *   CREATE TABLE posts (id TEXT, user_id TEXT);
   *   CREATE INDEX idx_posts_user ON posts(user_id);
   * `)
   * ```
   */
  async exec(sql: string): Promise<void> {
    const pg = await this.getPGLite()
    await pg.exec(sql)

    // Mark as dirty since exec typically modifies schema/data
    this.dirty = true
    this.writeCount++
  }

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  /**
   * Execute operations within a transaction
   *
   * If the callback throws an error, the transaction is automatically rolled back.
   * If the callback completes successfully, the transaction is committed.
   *
   * @param callback - Async function receiving a Transaction object
   * @returns The value returned by the callback
   *
   * @example
   * ```typescript
   * await db.transaction(async (tx) => {
   *   await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 'acc-1'])
   *   await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 'acc-2'])
   * })
   * ```
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    const pg = await this.getPGLite()

    // PGLite has a transaction method we can use
    return await pg.transaction(async (pgliteTx) => {
      // Create our transaction wrapper
      const tx: Transaction = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
          _options?: QueryOptions
        ): Promise<QueryResult<R>> => {
          // Convert params for PGLite
          const processedParams = params?.map((p) => {
            if (Array.isArray(p)) {
              // Check if this looks like a vector (all numbers)
              const isVector = p.every((item) => typeof item === 'number')
              if (isVector) {
                // For pgvector types, use bracket notation: [1,2,3]
                return `[${p.join(',')}]`
              } else {
                // For Postgres TEXT[] arrays, use curly brace notation: {a,b,c}
                return `{${p.join(',')}}`
              }
            }
            return p
          })

          const result = await pgliteTx.query<R>(sql, processedParams)

          // Convert numeric strings to numbers for consistency with query()
          const processedRows = result.rows.map((row) => {
            const processedRow: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
              if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
                const num = Number(value)
                if (!isNaN(num) && String(num) === value) {
                  processedRow[key] = num
                } else {
                  processedRow[key] = value
                }
              } else {
                processedRow[key] = value
              }
            }
            return processedRow as R extends Record<string, unknown> ? R : R
          })

          return {
            rows: processedRows as R[],
            affectedRows: result.affectedRows,
          }
        },
        exec: async (sql: string): Promise<void> => {
          await pgliteTx.exec(sql)
        },
        rollback: async (): Promise<void> => {
          await pgliteTx.rollback()
        },
      }

      const result = await callback(tx)

      // Mark as dirty after successful transaction
      this.dirty = true
      this.writeCount++

      return result
    })
  }

  // ==========================================================================
  // CHECKPOINT AND PERSISTENCE
  // ==========================================================================

  /**
   * Save database state to FSX storage
   *
   * Creates a checkpoint of the current database state that can be
   * restored on cold start.
   *
   * @example
   * ```typescript
   * await db.query('INSERT INTO users VALUES ($1, $2)', ['user-1', 'Alice'])
   * await db.checkpoint()  // State is now durable
   * ```
   */
  async checkpoint(): Promise<void> {
    if (!this.pglite) {
      // Nothing to checkpoint if PGLite hasn't been initialized
      return
    }

    // Export the database state as SQL
    // For GREEN phase, we'll use a simple approach: dump all data as INSERT statements
    const checkpointSql = await this.generateCheckpointSql()

    // Save to FSX storage
    await this.ctx.storage.put(STORAGE_KEYS.CHECKPOINT, checkpointSql)

    // Increment and save version
    this.checkpointVersion++
    await this.ctx.storage.put(
      STORAGE_KEYS.CHECKPOINT_VERSION,
      this.checkpointVersion
    )

    // Reset dirty flag and write count
    this.dirty = false
    this.writeCount = 0
  }

  /**
   * Generate SQL for checkpoint
   */
  private async generateCheckpointSql(): Promise<string> {
    if (!this.pglite) {
      return ''
    }

    const statements: string[] = []

    // Get all user tables
    const tablesResult = await this.pglite.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `)

    for (const { tablename } of tablesResult.rows) {
      // Get table schema with full type info including vector dimensions
      const columnsResult = await this.pglite.query<{
        column_name: string
        data_type: string
        udt_name: string
        column_default: string | null
        is_nullable: string
        character_maximum_length: number | null
        numeric_precision: number | null
      }>(`
        SELECT column_name, data_type, udt_name, column_default, is_nullable,
               character_maximum_length, numeric_precision
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [tablename])

      // Get vector column dimensions from pg_attribute
      const vectorDimensions = new Map<string, number>()
      const vectorColsResult = await this.pglite.query<{
        attname: string
        atttypmod: number
      }>(`
        SELECT a.attname, a.atttypmod
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_type t ON a.atttypid = t.oid
        WHERE c.relname = $1 AND t.typname = 'vector' AND a.attnum > 0
      `, [tablename])

      for (const { attname, atttypmod } of vectorColsResult.rows) {
        // atttypmod contains the dimension for vector types
        if (atttypmod > 0) {
          vectorDimensions.set(attname, atttypmod)
        }
      }

      // Build CREATE TABLE statement
      const columns = columnsResult.rows.map((col) => {
        let dataType: string

        // Handle USER-DEFINED types (like pgvector)
        if (col.data_type === 'USER-DEFINED' && col.udt_name === 'vector') {
          const dim = vectorDimensions.get(col.column_name)
          dataType = dim ? `vector(${dim})` : 'vector'
        } else {
          dataType = col.data_type.toUpperCase()
        }

        let def = `${col.column_name} ${dataType}`
        if (col.column_default) {
          def += ` DEFAULT ${col.column_default}`
        }
        if (col.is_nullable === 'NO') {
          def += ' NOT NULL'
        }
        return def
      })

      // Get primary key
      const pkResult = await this.pglite.query<{ attname: string }>(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [tablename])

      if (pkResult.rows.length > 0) {
        const pkColumns = pkResult.rows.map((r) => r.attname).join(', ')
        columns.push(`PRIMARY KEY (${pkColumns})`)
      }

      statements.push(
        `CREATE TABLE IF NOT EXISTS ${tablename} (${columns.join(', ')});`
      )

      // Get indexes
      const indexResult = await this.pglite.query<{
        indexname: string
        indexdef: string
      }>(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        AND indexname NOT LIKE '%_pkey'
      `, [tablename])

      for (const { indexdef } of indexResult.rows) {
        // Convert CREATE INDEX to CREATE INDEX IF NOT EXISTS
        const ifNotExists = indexdef.replace(
          'CREATE INDEX',
          'CREATE INDEX IF NOT EXISTS'
        )
        statements.push(`${ifNotExists};`)
      }

      // Get all data
      const dataResult = await this.pglite.query(`SELECT * FROM ${tablename}`)

      for (const row of dataResult.rows) {
        const cols = Object.keys(row as object)
        const vals = Object.values(row as object).map((v) => {
          if (v === null) return 'NULL'
          if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
          if (typeof v === 'boolean') return v ? 'true' : 'false'
          if (typeof v === 'number') return String(v)
          if (v instanceof Date) return `'${v.toISOString()}'`
          if (Array.isArray(v)) return `'[${v.join(',')}]'`
          return `'${JSON.stringify(v).replace(/'/g, "''")}'`
        })

        statements.push(
          `INSERT INTO ${tablename} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;`
        )
      }
    }

    // Check for vector extension usage
    const hasVector = await this.hasVectorExtension()
    if (hasVector) {
      statements.unshift('CREATE EXTENSION IF NOT EXISTS vector;')
    }

    return statements.join('\n')
  }

  /**
   * Check if vector extension is being used
   */
  private async hasVectorExtension(): Promise<boolean> {
    if (!this.pglite) return false

    try {
      const result = await this.pglite.query<{ extname: string }>(`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `)
      return result.rows.length > 0
    } catch {
      return false
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Close the EdgePostgres instance and release resources
   *
   * If there are uncommitted changes, they will be checkpointed before closing.
   *
   * @example
   * ```typescript
   * const db = new EdgePostgres(ctx, env)
   * // ... use db ...
   * await db.close()
   * ```
   */
  async close(): Promise<void> {
    if (this.closed) {
      return // Already closed, safe to call multiple times
    }

    // Checkpoint if dirty
    if (this.dirty && this.pglite) {
      await this.checkpoint()
    }

    // Close PGLite
    if (this.pglite) {
      await this.pglite.close()
      this.pglite = null
    }

    this.closed = true
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Generate a session token for read-your-writes consistency
   */
  private generateSessionToken(): string {
    const timestamp = Date.now()
    const version = this.checkpointVersion
    const doId = this.ctx.id.toString()
    return `${doId}:${version}:${timestamp}`
  }
}
