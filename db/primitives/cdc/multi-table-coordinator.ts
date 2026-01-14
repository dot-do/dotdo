/**
 * Multi-Table Coordinator - Coordinated CDC across multiple related tables
 *
 * Provides:
 * - Single WAL reader with multi-table demultiplexing
 * - Cross-table transaction boundary preservation
 * - Coordinated snapshots across related tables
 * - Foreign key relationship handling with correct ordering
 * - Dynamic table addition/removal
 * - Table group management for related tables
 *
 * @module db/primitives/cdc/multi-table-coordinator
 */

import {
  type WALReader,
  type WALEntry,
  type WALPosition,
  WALOperationType,
} from './wal-reader'
import {
  type SnapshotManager,
  type TableScanner,
  type SnapshotState,
  type SnapshotProgress,
  SnapshotPhase,
  createSnapshotManager,
} from './snapshot-manager'
import { ChangeType } from './stream'

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Foreign key relationship between tables
 */
export interface ForeignKeyRelation {
  /** Source table (with the foreign key) */
  sourceTable: string
  /** Source column(s) containing the foreign key */
  sourceColumns: string[]
  /** Target table (referenced by the foreign key) */
  targetTable: string
  /** Target column(s) being referenced */
  targetColumns: string[]
  /** Whether the relationship is optional (nullable FK) */
  optional?: boolean
  /** Cascade behavior on delete */
  onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT' | 'NO_ACTION'
}

/**
 * Table configuration for multi-table coordination
 */
export interface TableConfig<T = unknown> {
  /** Table name */
  name: string
  /** Schema/database name */
  schema?: string
  /** Primary key column(s) */
  primaryKey: string | string[]
  /** Foreign key relationships */
  foreignKeys?: ForeignKeyRelation[]
  /** Table scanner for snapshot operations */
  scanner?: TableScanner<T>
  /** Table-specific change handler */
  onChange?: (entry: WALEntry<T>) => Promise<void>
  /** Whether to include in coordinated snapshots */
  includeInSnapshot?: boolean
  /** Priority for snapshot ordering (lower = first) */
  snapshotPriority?: number
}

/**
 * Table group for managing related tables
 */
export interface TableGroup {
  /** Group identifier */
  id: string
  /** Group name for display */
  name: string
  /** Tables in this group */
  tables: string[]
  /** Whether group is enabled */
  enabled: boolean
  /** Group-level change handler */
  onChange?: (entry: WALEntry<unknown>, tableName: string) => Promise<void>
}

/**
 * Transaction with cross-table changes
 */
export interface MultiTableTransaction {
  /** Transaction ID */
  transactionId: string
  /** Start position */
  startPosition: WALPosition
  /** End position (set on commit) */
  endPosition?: WALPosition
  /** Changes grouped by table */
  changesByTable: Map<string, WALEntry<unknown>[]>
  /** Total change count */
  changeCount: number
  /** Timestamp when transaction started */
  startedAt: number
  /** Timestamp when transaction committed */
  committedAt?: number
}

/**
 * Coordinated snapshot state across multiple tables
 */
export interface CoordinatedSnapshotState {
  /** Overall phase */
  phase: 'pending' | 'capturing_position' | 'snapshotting' | 'completed' | 'failed' | 'cancelled'
  /** WAL position at snapshot start */
  walPositionAtStart: WALPosition | null
  /** Per-table snapshot states */
  tableStates: Map<string, SnapshotState>
  /** Tables in snapshot order */
  tableOrder: string[]
  /** Current table being snapshotted */
  currentTableIndex: number
  /** Overall progress */
  totalRowsProcessed: number
  /** Total rows across all tables */
  totalRowsEstimate: number
  /** Start timestamp */
  startedAt: number
  /** Completion timestamp */
  completedAt?: number
  /** Error if failed */
  error?: string
}

/**
 * Progress for coordinated snapshot
 */
export interface CoordinatedSnapshotProgress {
  /** Overall phase */
  phase: CoordinatedSnapshotState['phase']
  /** Current table name */
  currentTable: string | null
  /** Tables completed */
  tablesCompleted: number
  /** Total tables */
  totalTables: number
  /** Overall percentage */
  percentComplete: number
  /** Rows processed */
  rowsProcessed: number
  /** Estimated total rows */
  totalRows: number
  /** Rows per second */
  rowsPerSecond: number
  /** Estimated time remaining (ms) */
  estimatedRemainingMs: number
}

/**
 * Event emitted when a table change is routed
 */
export interface TableChangeEvent<T = unknown> {
  /** Table name */
  table: string
  /** Schema name */
  schema: string
  /** The WAL entry */
  entry: WALEntry<T>
  /** Transaction ID if part of a transaction */
  transactionId?: string
  /** Whether this completes a cross-table transaction */
  transactionComplete?: boolean
}

/**
 * Handler for table change events
 */
export type TableChangeHandler<T = unknown> = (event: TableChangeEvent<T>) => Promise<void>

/**
 * Handler for transaction events
 */
export type TransactionHandler = (transaction: MultiTableTransaction) => Promise<void>

/**
 * Options for MultiTableCoordinator
 */
export interface MultiTableCoordinatorOptions {
  /** Table configurations */
  tables: TableConfig[]
  /** Table groups */
  groups?: TableGroup[]
  /** Global change handler (called for all tables) */
  onChange?: TableChangeHandler
  /** Handler for completed transactions */
  onTransaction?: TransactionHandler
  /** Handler for snapshot progress */
  onSnapshotProgress?: (progress: CoordinatedSnapshotProgress) => Promise<void>
  /** Handler for snapshot completion */
  onSnapshotComplete?: (state: CoordinatedSnapshotState) => Promise<void>
  /** Whether to group changes by transaction */
  groupByTransaction?: boolean
  /** Buffer incomplete transactions in memory */
  bufferTransactions?: boolean
  /** Maximum transaction buffer size */
  maxTransactionBufferSize?: number
  /** Transaction timeout (ms) for incomplete transactions */
  transactionTimeoutMs?: number
}

/**
 * Options for coordinated snapshot
 */
export interface CoordinatedSnapshotOptions {
  /** Tables to include (default: all with scanners) */
  tables?: string[]
  /** Chunk size for scanning */
  chunkSize?: number
  /** Maximum in-flight records per table */
  maxInFlightRecords?: number
  /** WAL reader to capture position from */
  walReader?: WALReader<unknown>
  /** Handler for each snapshot event */
  onEvent?: (table: string, record: unknown) => Promise<void>
  /** Resume from saved state */
  resumeFrom?: CoordinatedSnapshotState
}

// ============================================================================
// MULTI-TABLE COORDINATOR
// ============================================================================

/**
 * Coordinates CDC operations across multiple related tables
 */
export class MultiTableCoordinator {
  private options: MultiTableCoordinatorOptions
  private tableConfigs: Map<string, TableConfig> = new Map()
  private tableGroups: Map<string, TableGroup> = new Map()
  private dependencyOrder: string[] = []
  private reverseDependencyOrder: string[] = []
  private activeTransactions: Map<string, MultiTableTransaction> = new Map()
  private snapshotState: CoordinatedSnapshotState | null = null
  private snapshotManagers: Map<string, SnapshotManager<unknown>> = new Map()
  private isRunning: boolean = false
  private startTime: number = 0

  constructor(options: MultiTableCoordinatorOptions) {
    this.options = options

    // Index tables
    for (const table of options.tables) {
      this.tableConfigs.set(table.name, table)
    }

    // Index groups
    if (options.groups) {
      for (const group of options.groups) {
        this.tableGroups.set(group.id, group)
      }
    }

    // Compute dependency ordering
    this.computeDependencyOrder()
  }

  // ============================================================================
  // PUBLIC API - Table Management
  // ============================================================================

  /**
   * Add a table configuration
   */
  addTable<T>(config: TableConfig<T>): void {
    this.tableConfigs.set(config.name, config as TableConfig)
    this.computeDependencyOrder()
  }

  /**
   * Remove a table configuration
   */
  removeTable(tableName: string): boolean {
    const removed = this.tableConfigs.delete(tableName)
    if (removed) {
      this.computeDependencyOrder()
    }
    return removed
  }

  /**
   * Get table configuration
   */
  getTable(tableName: string): TableConfig | undefined {
    return this.tableConfigs.get(tableName)
  }

  /**
   * Get all table names
   */
  getTableNames(): string[] {
    return Array.from(this.tableConfigs.keys())
  }

  /**
   * Check if table is configured
   */
  hasTable(tableName: string): boolean {
    return this.tableConfigs.has(tableName)
  }

  // ============================================================================
  // PUBLIC API - Group Management
  // ============================================================================

  /**
   * Add a table group
   */
  addGroup(group: TableGroup): void {
    this.tableGroups.set(group.id, group)
  }

  /**
   * Remove a table group
   */
  removeGroup(groupId: string): boolean {
    return this.tableGroups.delete(groupId)
  }

  /**
   * Get a table group
   */
  getGroup(groupId: string): TableGroup | undefined {
    return this.tableGroups.get(groupId)
  }

  /**
   * Get all group IDs
   */
  getGroupIds(): string[] {
    return Array.from(this.tableGroups.keys())
  }

  /**
   * Enable/disable a group
   */
  setGroupEnabled(groupId: string, enabled: boolean): boolean {
    const group = this.tableGroups.get(groupId)
    if (group) {
      group.enabled = enabled
      return true
    }
    return false
  }

  /**
   * Get tables in a group
   */
  getGroupTables(groupId: string): string[] {
    return this.tableGroups.get(groupId)?.tables ?? []
  }

  // ============================================================================
  // PUBLIC API - Dependency Ordering
  // ============================================================================

  /**
   * Get tables in dependency order (parents first)
   * Use for INSERT operations and snapshots
   */
  getDependencyOrder(): string[] {
    return [...this.dependencyOrder]
  }

  /**
   * Get tables in reverse dependency order (children first)
   * Use for DELETE operations
   */
  getReverseDependencyOrder(): string[] {
    return [...this.reverseDependencyOrder]
  }

  /**
   * Get foreign key relationships for a table
   */
  getForeignKeys(tableName: string): ForeignKeyRelation[] {
    return this.tableConfigs.get(tableName)?.foreignKeys ?? []
  }

  /**
   * Get tables that depend on the given table (have FK to it)
   */
  getDependentTables(tableName: string): string[] {
    const dependents: string[] = []
    for (const [name, config] of this.tableConfigs) {
      if (config.foreignKeys?.some((fk) => fk.targetTable === tableName)) {
        dependents.push(name)
      }
    }
    return dependents
  }

  /**
   * Get tables that the given table depends on (FK targets)
   */
  getTableDependencies(tableName: string): string[] {
    const config = this.tableConfigs.get(tableName)
    if (!config?.foreignKeys) return []
    return [...new Set(config.foreignKeys.map((fk) => fk.targetTable))]
  }

  // ============================================================================
  // PUBLIC API - WAL Demultiplexing
  // ============================================================================

  /**
   * Process a WAL entry and route to appropriate table handler
   */
  async routeWALEntry<T>(entry: WALEntry<T>): Promise<void> {
    const tableName = entry.table
    const config = this.tableConfigs.get(tableName)

    // Skip if table not configured
    if (!config) {
      return
    }

    // Check if table is in an enabled group
    const inEnabledGroup = this.isTableInEnabledGroup(tableName)

    // Handle transaction grouping
    if (this.options.groupByTransaction && entry.transactionId) {
      await this.handleTransactionEntry(entry)
    } else {
      // Direct delivery
      const event: TableChangeEvent<T> = {
        table: tableName,
        schema: entry.schema,
        entry,
        transactionId: entry.transactionId,
      }

      // Call table-specific handler
      if (config.onChange) {
        await config.onChange(entry)
      }

      // Call group handler if in enabled group
      if (inEnabledGroup) {
        for (const [, group] of this.tableGroups) {
          if (group.enabled && group.tables.includes(tableName) && group.onChange) {
            await group.onChange(entry as WALEntry<unknown>, tableName)
          }
        }
      }

      // Call global handler
      if (this.options.onChange) {
        await this.options.onChange(event as TableChangeEvent<unknown>)
      }
    }
  }

  /**
   * Process entries from a WAL reader
   */
  async processWALReader<T>(reader: WALReader<T>): Promise<void> {
    this.isRunning = true
    this.startTime = Date.now()

    try {
      for await (const entry of reader) {
        if (!this.isRunning) break
        await this.routeWALEntry(entry)
      }
    } finally {
      // Flush any pending transactions
      await this.flushPendingTransactions()
    }
  }

  /**
   * Stop processing
   */
  stop(): void {
    this.isRunning = false
  }

  // ============================================================================
  // PUBLIC API - Transaction Management
  // ============================================================================

  /**
   * Begin a transaction manually (for testing/manual coordination)
   */
  beginTransaction(transactionId: string, position: WALPosition): void {
    if (this.activeTransactions.has(transactionId)) {
      return
    }

    this.activeTransactions.set(transactionId, {
      transactionId,
      startPosition: position,
      changesByTable: new Map(),
      changeCount: 0,
      startedAt: Date.now(),
    })
  }

  /**
   * Commit a transaction
   */
  async commitTransaction(transactionId: string, position: WALPosition): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId)
    if (!transaction) return

    transaction.endPosition = position
    transaction.committedAt = Date.now()

    // Deliver transaction
    await this.deliverTransaction(transaction)

    // Clean up
    this.activeTransactions.delete(transactionId)
  }

  /**
   * Rollback a transaction
   */
  rollbackTransaction(transactionId: string): void {
    this.activeTransactions.delete(transactionId)
  }

  /**
   * Get active transactions
   */
  getActiveTransactions(): MultiTableTransaction[] {
    return Array.from(this.activeTransactions.values())
  }

  /**
   * Get pending transaction count
   */
  getPendingTransactionCount(): number {
    return this.activeTransactions.size
  }

  // ============================================================================
  // PUBLIC API - Coordinated Snapshots
  // ============================================================================

  /**
   * Start a coordinated snapshot across multiple tables
   */
  async startCoordinatedSnapshot(options: CoordinatedSnapshotOptions): Promise<void> {
    if (this.snapshotState?.phase === 'snapshotting') {
      throw new Error('Snapshot already in progress')
    }

    // Determine tables to snapshot
    const tablesToSnapshot = options.tables ?? this.getSnapshotTables()
    if (tablesToSnapshot.length === 0) {
      throw new Error('No tables configured for snapshot')
    }

    // Sort tables by dependency order (parents first)
    const sortedTables = this.sortTablesByDependency(tablesToSnapshot)

    // Estimate total rows
    let totalRowsEstimate = 0
    for (const tableName of sortedTables) {
      const config = this.tableConfigs.get(tableName)
      if (config?.scanner) {
        const count = await config.scanner.getRowCount()
        totalRowsEstimate += count
      }
    }

    // Capture WAL position before starting
    let walPosition: WALPosition | null = null
    if (options.walReader) {
      walPosition = options.walReader.getPosition()
    }

    // Initialize state
    this.snapshotState = {
      phase: 'capturing_position',
      walPositionAtStart: walPosition,
      tableStates: new Map(),
      tableOrder: sortedTables,
      currentTableIndex: 0,
      totalRowsProcessed: 0,
      totalRowsEstimate,
      startedAt: Date.now(),
    }

    // Resume from saved state if provided
    if (options.resumeFrom) {
      this.snapshotState = {
        ...this.snapshotState,
        ...options.resumeFrom,
        phase: 'snapshotting',
      }
    } else {
      this.snapshotState.phase = 'snapshotting'
    }

    // Snapshot each table in order
    for (let i = this.snapshotState.currentTableIndex; i < sortedTables.length; i++) {
      const tableName = sortedTables[i]!
      this.snapshotState.currentTableIndex = i

      await this.snapshotTable(tableName, options)

      // Report progress
      if (this.options.onSnapshotProgress) {
        await this.options.onSnapshotProgress(this.getSnapshotProgress())
      }
    }

    // Complete
    this.snapshotState.phase = 'completed'
    this.snapshotState.completedAt = Date.now()

    if (this.options.onSnapshotComplete) {
      await this.options.onSnapshotComplete(this.snapshotState)
    }
  }

  /**
   * Pause the coordinated snapshot
   */
  async pauseSnapshot(): Promise<void> {
    for (const manager of this.snapshotManagers.values()) {
      await manager.pause()
    }
  }

  /**
   * Resume the coordinated snapshot
   */
  async resumeSnapshot(): Promise<void> {
    for (const manager of this.snapshotManagers.values()) {
      await manager.resume()
    }
  }

  /**
   * Cancel the coordinated snapshot
   */
  async cancelSnapshot(): Promise<void> {
    if (this.snapshotState) {
      this.snapshotState.phase = 'cancelled'
    }

    for (const manager of this.snapshotManagers.values()) {
      await manager.cancel()
    }

    this.snapshotManagers.clear()
  }

  /**
   * Get current snapshot state
   */
  getSnapshotState(): CoordinatedSnapshotState | null {
    return this.snapshotState
  }

  /**
   * Get current snapshot progress
   */
  getSnapshotProgress(): CoordinatedSnapshotProgress {
    if (!this.snapshotState) {
      return {
        phase: 'pending',
        currentTable: null,
        tablesCompleted: 0,
        totalTables: 0,
        percentComplete: 0,
        rowsProcessed: 0,
        totalRows: 0,
        rowsPerSecond: 0,
        estimatedRemainingMs: 0,
      }
    }

    const elapsed = Date.now() - this.snapshotState.startedAt
    const rowsPerSecond =
      elapsed > 0 ? (this.snapshotState.totalRowsProcessed / elapsed) * 1000 : 0
    const remaining = this.snapshotState.totalRowsEstimate - this.snapshotState.totalRowsProcessed
    const estimatedRemainingMs = rowsPerSecond > 0 ? (remaining / rowsPerSecond) * 1000 : 0

    return {
      phase: this.snapshotState.phase,
      currentTable:
        this.snapshotState.tableOrder[this.snapshotState.currentTableIndex] ?? null,
      tablesCompleted: this.snapshotState.currentTableIndex,
      totalTables: this.snapshotState.tableOrder.length,
      percentComplete:
        this.snapshotState.totalRowsEstimate > 0
          ? Math.round(
              (this.snapshotState.totalRowsProcessed / this.snapshotState.totalRowsEstimate) * 100
            )
          : 0,
      rowsProcessed: this.snapshotState.totalRowsProcessed,
      totalRows: this.snapshotState.totalRowsEstimate,
      rowsPerSecond: Math.round(rowsPerSecond),
      estimatedRemainingMs: Math.round(estimatedRemainingMs),
    }
  }

  // ============================================================================
  // PUBLIC API - Referential Integrity
  // ============================================================================

  /**
   * Validate foreign key references for an insert operation
   * Returns missing references
   */
  validateInsertReferences<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    existingRecords: Map<string, Set<string>>
  ): ForeignKeyRelation[] {
    const config = this.tableConfigs.get(tableName)
    if (!config?.foreignKeys) return []

    const missingRefs: ForeignKeyRelation[] = []

    for (const fk of config.foreignKeys) {
      if (fk.optional) continue

      // Get the FK value(s) from the record
      const fkValues = fk.sourceColumns.map((col) => record[col])
      if (fkValues.some((v) => v === null || v === undefined)) {
        continue // Null FK is valid for optional relationships
      }

      // Build a lookup key
      const lookupKey = fkValues.join(':')

      // Check if target exists
      const targetRecords = existingRecords.get(fk.targetTable)
      if (!targetRecords?.has(lookupKey)) {
        missingRefs.push(fk)
      }
    }

    return missingRefs
  }

  /**
   * Get the correct ordering for a batch of changes
   * INSERTs: parents first; DELETEs: children first; UPDATEs: any order
   */
  orderChangesForReferentialIntegrity<T>(
    changes: Array<{ table: string; operation: WALOperationType; record: T }>
  ): Array<{ table: string; operation: WALOperationType; record: T }> {
    const inserts: Array<{ table: string; operation: WALOperationType; record: T }> = []
    const updates: Array<{ table: string; operation: WALOperationType; record: T }> = []
    const deletes: Array<{ table: string; operation: WALOperationType; record: T }> = []

    // Separate by operation type
    for (const change of changes) {
      switch (change.operation) {
        case WALOperationType.INSERT:
          inserts.push(change)
          break
        case WALOperationType.UPDATE:
          updates.push(change)
          break
        case WALOperationType.DELETE:
          deletes.push(change)
          break
      }
    }

    // Sort inserts by dependency order (parents first)
    const sortedInserts = this.sortChangesByTableOrder(inserts, this.dependencyOrder)

    // Sort deletes by reverse dependency order (children first)
    const sortedDeletes = this.sortChangesByTableOrder(deletes, this.reverseDependencyOrder)

    // Return in correct order: inserts, updates, deletes
    return [...sortedInserts, ...updates, ...sortedDeletes]
  }

  // ============================================================================
  // PRIVATE - Dependency Computation
  // ============================================================================

  private computeDependencyOrder(): void {
    // Build adjacency list for topological sort
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    // Initialize
    for (const [tableName] of this.tableConfigs) {
      graph.set(tableName, [])
      inDegree.set(tableName, 0)
    }

    // Add edges (FK → target)
    for (const [tableName, config] of this.tableConfigs) {
      if (config.foreignKeys) {
        for (const fk of config.foreignKeys) {
          if (this.tableConfigs.has(fk.targetTable)) {
            // tableName depends on targetTable
            graph.get(fk.targetTable)!.push(tableName)
            inDegree.set(tableName, inDegree.get(tableName)! + 1)
          }
        }
      }
    }

    // Topological sort (Kahn's algorithm)
    const queue: string[] = []
    const result: string[] = []

    // Start with tables that have no dependencies
    for (const [tableName, degree] of inDegree) {
      if (degree === 0) {
        queue.push(tableName)
      }
    }

    // Sort by priority if multiple roots
    queue.sort((a, b) => {
      const priorityA = this.tableConfigs.get(a)?.snapshotPriority ?? 100
      const priorityB = this.tableConfigs.get(b)?.snapshotPriority ?? 100
      return priorityA - priorityB
    })

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      for (const dependent of graph.get(current) ?? []) {
        const newDegree = inDegree.get(dependent)! - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) {
          queue.push(dependent)
        }
      }

      // Sort queue by priority
      queue.sort((a, b) => {
        const priorityA = this.tableConfigs.get(a)?.snapshotPriority ?? 100
        const priorityB = this.tableConfigs.get(b)?.snapshotPriority ?? 100
        return priorityA - priorityB
      })
    }

    // Check for cycles
    if (result.length !== this.tableConfigs.size) {
      // There's a cycle - fall back to alphabetical order
      this.dependencyOrder = Array.from(this.tableConfigs.keys()).sort()
    } else {
      this.dependencyOrder = result
    }

    this.reverseDependencyOrder = [...this.dependencyOrder].reverse()
  }

  private sortTablesByDependency(tables: string[]): string[] {
    const tableSet = new Set(tables)
    return this.dependencyOrder.filter((t) => tableSet.has(t))
  }

  private sortChangesByTableOrder<T>(
    changes: Array<{ table: string; operation: WALOperationType; record: T }>,
    order: string[]
  ): Array<{ table: string; operation: WALOperationType; record: T }> {
    const orderMap = new Map(order.map((t, i) => [t, i]))
    return [...changes].sort((a, b) => {
      const orderA = orderMap.get(a.table) ?? Number.MAX_SAFE_INTEGER
      const orderB = orderMap.get(b.table) ?? Number.MAX_SAFE_INTEGER
      return orderA - orderB
    })
  }

  // ============================================================================
  // PRIVATE - Transaction Handling
  // ============================================================================

  private async handleTransactionEntry<T>(entry: WALEntry<T>): Promise<void> {
    const transactionId = entry.transactionId!

    // Create transaction if doesn't exist
    if (!this.activeTransactions.has(transactionId)) {
      this.beginTransaction(transactionId, entry.position)
    }

    const transaction = this.activeTransactions.get(transactionId)!

    // Add entry to transaction
    if (!transaction.changesByTable.has(entry.table)) {
      transaction.changesByTable.set(entry.table, [])
    }
    transaction.changesByTable.get(entry.table)!.push(entry as WALEntry<unknown>)
    transaction.changeCount++

    // Check buffer size limit
    if (
      this.options.maxTransactionBufferSize &&
      transaction.changeCount > this.options.maxTransactionBufferSize
    ) {
      // Flush this transaction
      await this.commitTransaction(transactionId, entry.position)
    }
  }

  private async deliverTransaction(transaction: MultiTableTransaction): Promise<void> {
    // Deliver changes in dependency order
    const orderedTables = this.sortTablesByDependency(
      Array.from(transaction.changesByTable.keys())
    )

    for (const tableName of orderedTables) {
      const entries = transaction.changesByTable.get(tableName) ?? []
      const config = this.tableConfigs.get(tableName)

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const isLast = i === entries.length - 1 && tableName === orderedTables[orderedTables.length - 1]

        const event: TableChangeEvent = {
          table: tableName,
          schema: entry.schema,
          entry,
          transactionId: transaction.transactionId,
          transactionComplete: isLast,
        }

        // Call table-specific handler
        if (config?.onChange) {
          await config.onChange(entry)
        }

        // Call group handlers
        for (const [, group] of this.tableGroups) {
          if (group.enabled && group.tables.includes(tableName) && group.onChange) {
            await group.onChange(entry, tableName)
          }
        }

        // Call global handler
        if (this.options.onChange) {
          await this.options.onChange(event)
        }
      }
    }

    // Call transaction handler
    if (this.options.onTransaction) {
      await this.options.onTransaction(transaction)
    }
  }

  private async flushPendingTransactions(): Promise<void> {
    for (const [transactionId, transaction] of this.activeTransactions) {
      // Flush incomplete transactions
      transaction.committedAt = Date.now()
      await this.deliverTransaction(transaction)
    }
    this.activeTransactions.clear()
  }

  // ============================================================================
  // PRIVATE - Snapshot Helpers
  // ============================================================================

  private getSnapshotTables(): string[] {
    const tables: string[] = []
    for (const [name, config] of this.tableConfigs) {
      if (config.scanner && config.includeInSnapshot !== false) {
        tables.push(name)
      }
    }
    return tables
  }

  private async snapshotTable(
    tableName: string,
    options: CoordinatedSnapshotOptions
  ): Promise<void> {
    const config = this.tableConfigs.get(tableName)
    if (!config?.scanner) {
      throw new Error(`No scanner configured for table: ${tableName}`)
    }

    const manager = createSnapshotManager({
      scanner: config.scanner,
      chunkSize: options.chunkSize ?? 1000,
      maxInFlightRecords: options.maxInFlightRecords,
      initialWalPosition: this.snapshotState?.walPositionAtStart?.lsn ?? undefined,
      onSnapshot: async (event) => {
        // Update progress
        if (this.snapshotState) {
          this.snapshotState.totalRowsProcessed++
        }

        // Call event handler
        if (options.onEvent) {
          await options.onEvent(tableName, event.record)
        }
      },
      onStateChange: async (state) => {
        if (this.snapshotState) {
          this.snapshotState.tableStates.set(tableName, state)
        }
      },
      onProgress: async () => {
        if (this.options.onSnapshotProgress) {
          await this.options.onSnapshotProgress(this.getSnapshotProgress())
        }
      },
    })

    this.snapshotManagers.set(tableName, manager)

    await manager.start()
    await manager.waitForCompletion()

    // Clean up
    this.snapshotManagers.delete(tableName)
  }

  private isTableInEnabledGroup(tableName: string): boolean {
    for (const [, group] of this.tableGroups) {
      if (group.enabled && group.tables.includes(tableName)) {
        return true
      }
    }
    return false
  }
}

// ============================================================================
// MULTI-TABLE WAL DEMUXER
// ============================================================================

/**
 * Options for WAL demultiplexer
 */
export interface WALDemuxerOptions<T> {
  /** WAL reader to demultiplex */
  reader: WALReader<T>
  /** Per-table change handlers */
  handlers: Map<string, (entry: WALEntry<T>) => Promise<void>>
  /** Default handler for unmatched tables */
  defaultHandler?: (entry: WALEntry<T>) => Promise<void>
  /** Whether to filter unmatched tables (default: true) */
  filterUnmatched?: boolean
  /** Group changes by transaction */
  groupByTransaction?: boolean
  /** Transaction commit handler */
  onTransactionCommit?: (entries: WALEntry<T>[], transactionId: string) => Promise<void>
}

/**
 * Demultiplexes a single WAL stream to multiple table handlers
 */
export class MultiTableWALDemuxer<T> {
  private options: WALDemuxerOptions<T>
  private isRunning: boolean = false
  private currentTransaction: Map<string, WALEntry<T>[]> | null = null
  private currentTransactionId: string | null = null

  constructor(options: WALDemuxerOptions<T>) {
    this.options = {
      filterUnmatched: true,
      ...options,
    }
  }

  /**
   * Start demultiplexing
   */
  async start(): Promise<void> {
    this.isRunning = true

    for await (const entry of this.options.reader) {
      if (!this.isRunning) break

      if (this.options.groupByTransaction) {
        await this.handleTransactionEntry(entry)
      } else {
        await this.routeEntry(entry)
      }
    }

    // Flush any pending transaction
    if (this.currentTransaction) {
      await this.flushTransaction()
    }
  }

  /**
   * Stop demultiplexing
   */
  stop(): void {
    this.isRunning = false
  }

  /**
   * Check if running
   */
  isActive(): boolean {
    return this.isRunning
  }

  private async routeEntry(entry: WALEntry<T>): Promise<void> {
    const handler = this.options.handlers.get(entry.table)

    if (handler) {
      await handler(entry)
    } else if (this.options.defaultHandler && !this.options.filterUnmatched) {
      await this.options.defaultHandler(entry)
    }
  }

  private async handleTransactionEntry(entry: WALEntry<T>): Promise<void> {
    // New transaction
    if (entry.transactionId !== this.currentTransactionId) {
      // Flush previous transaction
      if (this.currentTransaction) {
        await this.flushTransaction()
      }

      // Start new transaction
      this.currentTransactionId = entry.transactionId ?? null
      this.currentTransaction = new Map()
    }

    if (this.currentTransaction) {
      if (!this.currentTransaction.has(entry.table)) {
        this.currentTransaction.set(entry.table, [])
      }
      this.currentTransaction.get(entry.table)!.push(entry)
    }
  }

  private async flushTransaction(): Promise<void> {
    if (!this.currentTransaction) return

    // Route all entries
    const allEntries: WALEntry<T>[] = []
    for (const [table, entries] of this.currentTransaction) {
      for (const entry of entries) {
        await this.routeEntry(entry)
        allEntries.push(entry)
      }
    }

    // Call transaction commit handler
    if (this.options.onTransactionCommit && this.currentTransactionId) {
      await this.options.onTransactionCommit(allEntries, this.currentTransactionId)
    }

    this.currentTransaction = null
    this.currentTransactionId = null
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new MultiTableCoordinator
 */
export function createMultiTableCoordinator(
  options: MultiTableCoordinatorOptions
): MultiTableCoordinator {
  return new MultiTableCoordinator(options)
}

/**
 * Create a new MultiTableWALDemuxer
 */
export function createMultiTableWALDemuxer<T>(
  options: WALDemuxerOptions<T>
): MultiTableWALDemuxer<T> {
  return new MultiTableWALDemuxer<T>(options)
}
