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
  type ShardConfig,
  type ShardQueryResult,
  DEFAULT_SHARD_CONFIG,
} from '../../../core/shard'
import {
  ReplicaManager,
  type ReplicaConfig,
  type WriteResult,
} from '../../../core/replica'
import type { TierConfig } from '../../../core/types'
import {
  detectCommand,
  translateDialect,
} from './parser'
import type {
  SQLValue,
  ExecutionResult,
  DialectConfig,
  TransactionMode,
  SQLCommand,
} from './types'
import { POSTGRES_DIALECT, SQLError } from './types'
import type { SQLEngine } from './engine'

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
  rows: SQLValue[][]
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
 */
export class DOSQLEngine implements SQLEngine {
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
    const mergedRows: SQLValue[][] = []
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

  /**
   * Begin a transaction
   *
   * Note: Transactions in sharded mode are complex - each shard maintains
   * its own transaction state. For simplicity, we track transaction state
   * locally and pass it to DO calls.
   */
  beginTransaction(mode: TransactionMode = 'write'): void {
    this.inTransaction = true
    this.transactionMode = mode
  }

  /**
   * Commit the current transaction
   */
  commitTransaction(): void {
    this.inTransaction = false
    this.transactionMode = 'write'
  }

  /**
   * Rollback the current transaction
   */
  rollbackTransaction(): void {
    this.inTransaction = false
    this.transactionMode = 'write'
  }

  /**
   * Check if a transaction is active
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
