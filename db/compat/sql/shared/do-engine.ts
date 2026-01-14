/**
 * @dotdo/db/compat/sql/shared - DO-backed SQL Engine
 *
 * SQL engine implementation that routes queries through Durable Objects,
 * integrating with the db/core managers for sharding, replication, and tiering.
 *
 * This engine is used when a DO namespace is configured in the ExtendedConfig.
 * It wraps the managers from db/core/ to provide:
 * - Shard routing: Routes queries to appropriate shards based on shard key
 * - Replica routing: Routes reads/writes to appropriate replicas
 * - Tier management: (Future) Manages data across hot/warm/cold storage
 *
 * ## WARNING: Transaction Safety Limitations
 *
 * **The transaction methods in this engine have significant limitations that can
 * cause data inconsistency in distributed scenarios.**
 *
 * ### Current Behavior
 *
 * The `beginTransaction()`, `commitTransaction()`, and `rollbackTransaction()` methods
 * only toggle LOCAL flags in the engine instance. They do NOT:
 *
 * 1. **Send transaction commands to DOs**: No `BEGIN`/`COMMIT`/`ROLLBACK` SQL
 *    statements are actually sent to the Durable Objects.
 *
 * 2. **Coordinate across shards**: Each shard maintains completely independent state.
 *    A "transaction" spanning multiple shards is NOT atomic - partial failures can
 *    leave data in an inconsistent state.
 *
 * 3. **Provide isolation guarantees**: There is no read isolation between queries
 *    that may be routed to different shards or replicas.
 *
 * ### Data Inconsistency Scenarios
 *
 * ```typescript
 * // DANGEROUS: This is NOT atomic across shards!
 * engine.beginTransaction()
 * await engine.execute('UPDATE accounts SET balance = balance - 100 WHERE tenant_id = $1', ['tenant-a'])
 * await engine.execute('UPDATE accounts SET balance = balance + 100 WHERE tenant_id = $1', ['tenant-b'])
 * // If second query fails, first write is already committed on shard-a!
 * engine.commitTransaction()
 * ```
 *
 * ### Safe Usage Patterns
 *
 * - **Single-shard transactions**: If all operations target the same shard key,
 *   transactions work at the DO level (though you must manually send BEGIN/COMMIT SQL).
 *
 * - **Idempotent operations**: Design writes to be idempotent so partial failures
 *   can be safely retried.
 *
 * - **Saga pattern**: Use compensating transactions for multi-shard operations.
 *
 * - **Single DO mode**: Disable sharding for strong transactional guarantees.
 *
 * ### Future Improvements
 *
 * Cross-shard transactions would require implementing two-phase commit (2PC) or
 * a similar distributed transaction protocol. This is complex and adds latency.
 * See: https://github.com/dotdo/dotdo/issues/xxx for tracking.
 *
 * @example
 * ```typescript
 * import { createDOSQLEngine } from '@dotdo/db/compat/sql/shared/do-engine'
 *
 * const engine = createDOSQLEngine({
 *   namespace: env.MY_DO,
 *   shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },
 *   replica: { jurisdiction: 'eu', readFrom: 'nearest' },
 * })
 *
 * // Queries are automatically routed to the right shard
 * await engine.execute('SELECT * FROM users WHERE tenant_id = $1', ['tenant-123'])
 * ```
 */

import {
  ShardManager,
  extractShardKey,
} from '../../../core/shard'
import type { ShardQueryResult } from '../../../core/shard'
import { ReplicaManager } from '../../../core/replica'
import type {
  ShardConfig,
  ReplicaConfig,
  TierConfig,
} from '../../../core/types'
import { DEFAULT_SHARD_CONFIG } from '../../../core/types'
import {
  detectCommand,
  translateDialect,
} from './parser'
import type {
  SQLValue,
  StorageValue,
  ExecutionResult,
  DialectConfig,
  TransactionMode,
  SQLCommand,
} from './types'
import { POSTGRES_DIALECT, SQLError } from './types'
import type { AsyncSQLEngine } from './engine'

// ============================================================================
// DO ENGINE CONFIGURATION
// ============================================================================

/**
 * Configuration for DO-backed SQL engine
 */
export interface DOSQLEngineConfig {
  /** DO namespace binding (required for DO mode) */
  namespace: DurableObjectNamespace

  /** Shard configuration */
  shard?: Partial<ShardConfig>

  /** Replica configuration */
  replica?: Partial<ReplicaConfig>

  /** Tier configuration (for future use) */
  tier?: Partial<TierConfig>

  /** SQL dialect */
  dialect?: DialectConfig

  /** Base name for DO instances (default: 'sql') */
  baseName?: string
}

/**
 * Response format from DO SQL endpoint
 */
interface DOSQLResponse {
  columns: string[]
  columnTypes: string[]
  rows: StorageValue[][]
  affectedRows: number
  lastInsertRowid: number
  changedRows: number
  command: SQLCommand
  error?: string
}

// ============================================================================
// DO SQL ENGINE
// ============================================================================

/**
 * DO-backed SQL engine that routes queries through Durable Objects.
 *
 * This engine integrates with ShardManager and ReplicaManager from db/core/
 * to provide automatic query routing based on configuration.
 *
 * Query routing logic:
 * 1. Parse the SQL to detect command type (SELECT, INSERT, UPDATE, DELETE)
 * 2. Extract shard key from the query if sharding is enabled
 * 3. Route to appropriate DO:
 *    - Writes: Always go to primary (or shard primary)
 *    - Reads: Route based on read preference (primary, secondary, nearest)
 * 4. For queries without shard key: Fan out to all shards and merge results
 *
 * ---
 *
 * ## WARNING: Transaction Limitations
 *
 * **Transaction methods in this class are NOT safe for cross-shard operations.**
 *
 * The `beginTransaction()`, `commitTransaction()`, and `rollbackTransaction()` methods
 * only maintain local state flags. They do NOT coordinate across Durable Objects or
 * provide ACID guarantees when queries are routed to different shards.
 *
 * ### What these methods actually do:
 * - Set `this.inTransaction = true/false`
 * - Set `this.transactionMode` to 'read'/'write'
 * - **Nothing else** - no SQL sent, no coordination, no isolation
 *
 * ### When it's safe to use transactions:
 * - Single DO mode (no sharding configured)
 * - All queries guaranteed to hit the same shard (same shard key value)
 *
 * ### When it's UNSAFE (data loss/inconsistency risk):
 * - Multi-shard operations
 * - Mixed shard key values
 * - Fan-out queries
 *
 * See module-level documentation for safe usage patterns (saga, idempotency, etc.)
 */
export class DOSQLEngine implements AsyncSQLEngine {
  private namespace: DurableObjectNamespace
  private shardManager?: ShardManager
  private replicaManager?: ReplicaManager
  private dialect: DialectConfig
  private baseName: string
  private inTransaction = false
  private transactionMode: TransactionMode = 'write'

  constructor(config: DOSQLEngineConfig) {
    this.namespace = config.namespace
    this.dialect = config.dialect ?? POSTGRES_DIALECT
    this.baseName = config.baseName ?? 'sql'

    // Initialize shard manager if sharding is configured
    if (config.shard && config.shard.count && config.shard.count > 1) {
      this.shardManager = new ShardManager(this.namespace, {
        ...DEFAULT_SHARD_CONFIG,
        ...config.shard,
      })
    }

    // Initialize replica manager if replication is configured
    if (config.replica && (config.replica.jurisdiction || config.replica.regions || config.replica.cities)) {
      this.replicaManager = new ReplicaManager(this.namespace, {
        readFrom: 'nearest',
        ...config.replica,
      })
    }
  }

  /**
   * Get the dialect configuration
   */
  getDialect(): DialectConfig {
    return this.dialect
  }

  /**
   * Execute a SQL statement
   *
   * Routing logic:
   * 1. If sharding enabled and shard key found: Route to specific shard
   * 2. If sharding enabled but no shard key: Fan out to all shards
   * 3. If replication enabled: Route reads/writes appropriately
   * 4. Otherwise: Route to default DO instance
   */
  async execute(sql: string, params: SQLValue[] = []): Promise<ExecutionResult> {
    const translatedSql = translateDialect(sql, this.dialect)
    const command = detectCommand(translatedSql)
    const isWrite = this.isWriteCommand(command)

    // Determine routing
    if (this.shardManager) {
      return this.executeSharded(translatedSql, params, command, isWrite)
    }

    if (this.replicaManager) {
      return this.executeReplicated(translatedSql, params, isWrite)
    }

    // Default: single DO instance
    return this.executeSingle(translatedSql, params)
  }

  /**
   * Execute on sharded infrastructure
   */
  private async executeSharded(
    sql: string,
    params: SQLValue[],
    command: SQLCommand,
    isWrite: boolean
  ): Promise<ExecutionResult> {
    const shardKey = this.shardManager!.shardKey
    const keyValue = extractShardKey(sql, shardKey, params as unknown[] | Record<string, unknown>)

    if (keyValue) {
      // Route to specific shard
      const stub = await this.shardManager!.getShardStub(keyValue)
      return this.executeOnStub(stub, sql, params)
    }

    // No shard key found - need to handle differently based on command
    if (isWrite) {
      // Writes without shard key are an error (can't determine which shard)
      throw new SQLError(
        `Write operation requires shard key '${shardKey}' in query`,
        'SHARD_KEY_REQUIRED'
      )
    }

    // Read without shard key: fan out to all shards and merge
    return this.executeOnAllShards(sql, params, command)
  }

  /**
   * Execute on all shards and merge results
   */
  private async executeOnAllShards(
    sql: string,
    params: SQLValue[],
    command: SQLCommand
  ): Promise<ExecutionResult> {
    const results = await this.shardManager!.queryAll<DOSQLResponse>('/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })

    // Merge results from all shards
    return this.mergeShardResults(results, command)
  }

  /**
   * Merge results from multiple shards
   */
  private mergeShardResults(
    results: ShardQueryResult<DOSQLResponse>[],
    command: SQLCommand
  ): ExecutionResult {
    // Check for errors
    const errors = results.filter((r) => r.error)
    if (errors.length > 0) {
      const errorMessages = errors.map((e) => `Shard ${e.shard}: ${e.error?.message}`).join('; ')
      throw new SQLError(`Query failed on ${errors.length} shards: ${errorMessages}`, 'SHARD_ERROR')
    }

    // Merge successful results
    const successful = results.filter((r) => r.data)
    if (successful.length === 0) {
      return this.emptyResult(command)
    }

    // Use first result for structure
    const first = successful[0]!.data!
    const mergedRows: StorageValue[][] = []
    let totalAffected = 0
    let totalChanged = 0

    for (const result of successful) {
      if (result.data) {
        mergedRows.push(...result.data.rows)
        totalAffected += result.data.affectedRows
        totalChanged += result.data.changedRows
      }
    }

    return {
      columns: first.columns,
      columnTypes: first.columnTypes,
      rows: mergedRows,
      affectedRows: totalAffected,
      lastInsertRowid: first.lastInsertRowid,
      changedRows: totalChanged,
      command,
    }
  }

  /**
   * Execute on replicated infrastructure
   */
  private async executeReplicated(
    sql: string,
    params: SQLValue[],
    isWrite: boolean
  ): Promise<ExecutionResult> {
    if (isWrite) {
      // Writes go to primary
      const stub = await this.replicaManager!.getWriteStub(this.baseName)
      const result = await this.executeOnStub(stub, sql, params)

      // If write-through is enabled, also write to replicas
      if (this.replicaManager!.config.writeThrough) {
        await this.writeThroughReplicas(sql, params)
      }

      return result
    }

    // Reads go to read replica based on preference
    const stub = await this.replicaManager!.getReadStub(this.baseName)
    return this.executeOnStub(stub, sql, params)
  }

  /**
   * Write through to all replicas
   */
  private async writeThroughReplicas(sql: string, params: SQLValue[]): Promise<void> {
    try {
      await this.replicaManager!.writeThroughAll(this.baseName, '/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      })
    } catch (error) {
      // Log but don't fail - write-through is async replication
      console.error('Write-through replication failed:', error)
    }
  }

  /**
   * Execute on a single DO instance (no sharding or replication)
   */
  private async executeSingle(sql: string, params: SQLValue[]): Promise<ExecutionResult> {
    const id = this.namespace.idFromName(this.baseName)
    const stub = this.namespace.get(id)
    return this.executeOnStub(stub, sql, params)
  }

  /**
   * Execute SQL on a specific DO stub
   */
  private async executeOnStub(
    stub: DurableObjectStub,
    sql: string,
    params: SQLValue[]
  ): Promise<ExecutionResult> {
    const response = await stub.fetch('http://do/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new SQLError(`DO SQL execution failed: ${errorText}`, 'DO_ERROR')
    }

    const result = (await response.json()) as DOSQLResponse

    if (result.error) {
      throw new SQLError(result.error, 'SQL_ERROR')
    }

    return {
      columns: result.columns,
      columnTypes: result.columnTypes,
      rows: result.rows,
      affectedRows: result.affectedRows,
      lastInsertRowid: result.lastInsertRowid,
      changedRows: result.changedRows,
      command: result.command,
    }
  }

  /**
   * Check if a command is a write operation
   */
  private isWriteCommand(command: SQLCommand): boolean {
    return ['INSERT', 'UPDATE', 'DELETE', 'CREATE TABLE', 'DROP TABLE'].includes(command)
  }

  /**
   * Create an empty result
   */
  private emptyResult(command: SQLCommand): ExecutionResult {
    return {
      columns: [],
      columnTypes: [],
      rows: [],
      affectedRows: 0,
      lastInsertRowid: 0,
      changedRows: 0,
      command,
    }
  }

  // ============================================================================
  // TRANSACTION MANAGEMENT
  // ============================================================================
  //
  // WARNING: These methods only toggle LOCAL flags - they do NOT coordinate
  // across shards or send transaction commands to Durable Objects!
  //
  // See class and module documentation for full details on limitations.
  // ============================================================================

  /**
   * Begin a transaction (LOCAL FLAG ONLY)
   *
   * @warning **This method does NOT provide cross-shard ACID guarantees.**
   *
   * This method only sets a local `inTransaction` flag. It does NOT:
   * - Send a `BEGIN` statement to any Durable Object
   * - Coordinate transaction state across shards
   * - Provide isolation from concurrent queries
   * - Enable rollback of already-executed queries
   *
   * ### When is this safe?
   * - Single DO mode (no sharding) - but you must still send `BEGIN` SQL manually
   * - Tracking intent for logging/debugging purposes only
   *
   * ### When is this UNSAFE?
   * - Any multi-shard scenario
   * - When you expect rollback to actually undo changes
   * - When you expect isolation between queries
   *
   * @param mode - Transaction mode ('read', 'write', or 'deferred'). Only stored locally.
   *
   * @example Safe single-shard pattern (manual SQL)
   * ```typescript
   * // For single-shard transactions, send BEGIN/COMMIT yourself:
   * await engine.execute('BEGIN')
   * try {
   *   await engine.execute('INSERT INTO users ...', [...])
   *   await engine.execute('INSERT INTO logs ...', [...])
   *   await engine.execute('COMMIT')
   * } catch (e) {
   *   await engine.execute('ROLLBACK')
   *   throw e
   * }
   * ```
   */
  beginTransaction(mode: TransactionMode = 'write'): void {
    if (this.shardManager) {
      console.warn(
        '[DOSQLEngine] WARNING: beginTransaction() called with sharding enabled. ' +
        'Transactions do NOT coordinate across shards - partial failures may cause data inconsistency. ' +
        'Consider using single-shard operations, the saga pattern, or disabling sharding for transactional workloads.'
      )
    }
    this.inTransaction = true
    this.transactionMode = mode
  }

  /**
   * Commit the current transaction (LOCAL FLAG ONLY)
   *
   * @warning **This method does NOT send COMMIT to Durable Objects.**
   *
   * This method only clears the local `inTransaction` flag. It does NOT:
   * - Send a `COMMIT` statement to any Durable Object
   * - Finalize any pending changes across shards
   * - Provide atomicity guarantees
   *
   * If queries were executed during the "transaction", they have already been
   * committed individually to their respective shards. This method is essentially
   * a no-op from a data consistency perspective.
   */
  commitTransaction(): void {
    this.inTransaction = false
    this.transactionMode = 'write'
  }

  /**
   * Rollback the current transaction (LOCAL FLAG ONLY)
   *
   * @warning **This method does NOT rollback any changes.**
   *
   * This method only clears the local `inTransaction` flag. It does NOT:
   * - Send a `ROLLBACK` statement to any Durable Object
   * - Undo any changes made during the "transaction"
   * - Restore any previous state
   *
   * Any queries executed during the "transaction" have already been committed
   * to their respective shards and CANNOT be undone by this method.
   *
   * ### To actually rollback changes:
   * - For single DO: Send `ROLLBACK` SQL directly via `execute()`
   * - For multi-shard: Implement compensating transactions (saga pattern)
   */
  rollbackTransaction(): void {
    this.inTransaction = false
    this.transactionMode = 'write'
  }

  /**
   * Check if a transaction is active (LOCAL FLAG ONLY)
   *
   * @returns Whether a transaction has been started via `beginTransaction()`.
   *
   * @note This only reflects the local flag state. Individual Durable Objects
   * maintain their own independent transaction state which may differ.
   */
  isInTransaction(): boolean {
    return this.inTransaction
  }

  // ============================================================================
  // MANAGER ACCESS
  // ============================================================================

  /**
   * Get the shard manager (if configured)
   */
  getShardManager(): ShardManager | undefined {
    return this.shardManager
  }

  /**
   * Get the replica manager (if configured)
   */
  getReplicaManager(): ReplicaManager | undefined {
    return this.replicaManager
  }

  /**
   * Check if sharding is enabled
   */
  isSharded(): boolean {
    return !!this.shardManager
  }

  /**
   * Check if replication is enabled
   */
  isReplicated(): boolean {
    return !!this.replicaManager
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a DO-backed SQL engine
 *
 * @param config - Engine configuration
 * @returns DO SQL engine instance
 *
 * @example
 * ```typescript
 * const engine = createDOSQLEngine({
 *   namespace: env.MY_DO,
 *   shard: { key: 'tenant_id', count: 16 },
 *   dialect: POSTGRES_DIALECT,
 * })
 *
 * const result = await engine.execute('SELECT * FROM users WHERE tenant_id = $1', ['t1'])
 * ```
 */
export function createDOSQLEngine(config: DOSQLEngineConfig): DOSQLEngine {
  return new DOSQLEngine(config)
}
