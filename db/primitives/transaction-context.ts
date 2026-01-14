/**
 * TransactionContext - Redis MULTI/EXEC-style atomic transactions
 *
 * Provides atomic multi-operation transactions with optimistic locking:
 * - begin() to start transaction
 * - Commands queued until exec()
 * - exec() executes atomically
 * - discard() to abort
 * - watch(keys) for optimistic locking (CAS)
 *
 * Maps to Redis: MULTI, EXEC, DISCARD, WATCH, UNWATCH
 *
 * ## Features
 * - **Atomic execution** - All commands succeed or none are applied
 * - **Optimistic locking** - WATCH/UNWATCH for CAS operations
 * - **Version tracking** - Per-key version numbers for conflict detection
 * - **Rollback on failure** - Automatic rollback on watch conflict or error
 *
 * ## Performance Characteristics
 * | Operation | Time Complexity | Target Latency |
 * |-----------|-----------------|----------------|
 * | begin | O(1) | < 1ms |
 * | queue | O(1) | < 1ms |
 * | exec | O(n) | < 10ms for n=100 |
 * | watch | O(1) | < 1ms |
 *
 * @module db/primitives/transaction-context
 */

import { type MetricsCollector, noopMetrics } from './observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Error returned when a WATCH conflict is detected
 */
export interface WatchError {
  /** The key that was modified externally */
  key: string
  /** Expected version at watch time */
  expectedVersion: number
  /** Actual version at exec time */
  actualVersion: number
  /** Human-readable error message */
  message: string
}

/**
 * Represents a queued command in a transaction
 */
export interface QueuedCommand {
  /** Command name (e.g., 'SET', 'GET', 'DEL') */
  name: string
  /** Command arguments */
  args: unknown[]
}

/**
 * Result of transaction execution
 */
export interface TransactionResult {
  /** Whether the transaction succeeded */
  success: boolean
  /** Results of each command in order */
  results: unknown[]
  /** Watch error if transaction failed due to WATCH conflict */
  watchError?: WatchError
  /** Error messages for commands that failed */
  errors?: string[]
}

/**
 * Configuration options for TransactionContext
 */
export interface TransactionContextOptions {
  /**
   * Share state with another TransactionContext instance.
   * Useful for simulating multiple clients against the same data.
   */
  shareStateWith?: TransactionContext

  /**
   * Enable version tracking for TemporalStore integration.
   * When enabled, getAtVersion() and watchVersion() are available.
   * @default false
   */
  enableVersionTracking?: boolean

  /**
   * Metrics collector for observability.
   * @default noopMetrics (zero overhead)
   */
  metrics?: MetricsCollector
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Internal representation of a stored value with version
 * @internal
 */
interface VersionedValue {
  value: string | null
  version: number
  /** History of values for TemporalStore integration */
  history?: Array<{ value: string | null; version: number }>
}

/**
 * Watch entry tracking version at watch time
 * @internal
 */
interface WatchEntry {
  key: string
  version: number
}

/**
 * Shared state container for multiple TransactionContext instances
 * @internal
 */
interface SharedState {
  /** Key-value store with versioning */
  store: Map<string, VersionedValue>
  /** Lock for serializing transactions */
  transactionLock: Promise<void> | null
  /** Resolver for the current transaction lock */
  lockResolver: (() => void) | null
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const TransactionMetricNames = {
  EXEC_LATENCY: 'transaction_context.exec.latency',
  BEGIN_LATENCY: 'transaction_context.begin.latency',
  COMMANDS_EXECUTED: 'transaction_context.commands_executed',
  WATCH_FAILURES: 'transaction_context.watch_failures',
  TRANSACTIONS_COMMITTED: 'transaction_context.transactions_committed',
  TRANSACTIONS_ROLLED_BACK: 'transaction_context.transactions_rolled_back',
  COMMANDS_QUEUED: 'transaction_context.commands_queued',
} as const

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * TransactionContext implementation providing Redis MULTI/EXEC semantics
 */
export class TransactionContext {
  /** Shared state (can be shared across instances) */
  private sharedState: SharedState

  /** Whether we own the shared state (for cleanup) */
  private ownsState: boolean

  /** Currently queued commands */
  private queue: QueuedCommand[] = []

  /** Whether we are currently in a transaction */
  private inTransaction: boolean = false

  /** Keys being watched with their versions at watch time */
  private watchedKeys: Map<string, WatchEntry> = new Map()

  /** Error to inject at a specific command index (for testing) */
  private errorInjectionIndex: number | null = null

  /** Simulated external modifications (for testing WATCH) */
  private simulatedModifications: Set<string> = new Set()

  /** Whether version tracking is enabled */
  private readonly enableVersionTracking: boolean

  /** Metrics collector */
  private readonly metrics: MetricsCollector

  constructor(options?: TransactionContextOptions) {
    this.metrics = options?.metrics ?? noopMetrics
    this.enableVersionTracking = options?.enableVersionTracking ?? false

    if (options?.shareStateWith) {
      this.sharedState = options.shareStateWith.sharedState
      this.ownsState = false
    } else {
      this.sharedState = {
        store: new Map(),
        transactionLock: null,
        lockResolver: null,
      }
      this.ownsState = true
    }
  }

  // ===========================================================================
  // TRANSACTION LIFECYCLE
  // ===========================================================================

  /**
   * Start a new transaction (MULTI).
   * Commands will be queued until exec() or discard() is called.
   * @throws Error if already in a transaction
   */
  async begin(): Promise<void> {
    const start = performance.now()
    try {
      if (this.inTransaction) {
        throw new Error('Already in a transaction. Call exec() or discard() first.')
      }

      // Wait for any existing transaction to complete
      while (this.sharedState.transactionLock) {
        await this.sharedState.transactionLock
      }

      // Acquire lock
      let resolver: () => void
      this.sharedState.transactionLock = new Promise<void>((resolve) => {
        resolver = resolve
      })
      this.sharedState.lockResolver = resolver!

      this.inTransaction = true
      this.queue = []
      this.errorInjectionIndex = null
    } finally {
      this.metrics.recordLatency(TransactionMetricNames.BEGIN_LATENCY, performance.now() - start)
    }
  }

  /**
   * Execute all queued commands atomically (EXEC).
   * @returns Transaction result with success status and command results
   * @throws Error if not in a transaction
   */
  async exec(): Promise<TransactionResult> {
    const start = performance.now()

    if (!this.inTransaction) {
      throw new Error('Not in a transaction. Call begin() first.')
    }

    try {
      // Check for watch conflicts
      const watchError = this.checkWatchConflicts()
      if (watchError) {
        this.metrics.incrementCounter(TransactionMetricNames.WATCH_FAILURES)
        this.metrics.incrementCounter(TransactionMetricNames.TRANSACTIONS_ROLLED_BACK)
        return {
          success: false,
          results: [],
          watchError,
        }
      }

      // Create snapshot for rollback
      const snapshot = this.createSnapshot()

      // Execute all commands
      const results: unknown[] = []
      const errors: string[] = []
      let hasError = false

      for (let i = 0; i < this.queue.length; i++) {
        // Check for injected error (testing)
        if (this.errorInjectionIndex === i) {
          hasError = true
          errors[i] = 'Injected error for testing'
          break
        }

        const cmd = this.queue[i]!
        try {
          const result = this.executeCommand(cmd)
          results.push(result)
        } catch (error) {
          hasError = true
          errors[i] = error instanceof Error ? error.message : String(error)
          break
        }
      }

      if (hasError) {
        // Rollback
        this.restoreSnapshot(snapshot)
        this.metrics.incrementCounter(TransactionMetricNames.TRANSACTIONS_ROLLED_BACK)
        return {
          success: false,
          results: [],
          errors,
        }
      }

      this.metrics.incrementCounter(TransactionMetricNames.COMMANDS_EXECUTED, undefined, this.queue.length)
      this.metrics.incrementCounter(TransactionMetricNames.TRANSACTIONS_COMMITTED)

      return {
        success: true,
        results,
      }
    } finally {
      // Clean up
      this.inTransaction = false
      this.queue = []
      this.watchedKeys.clear()
      this.simulatedModifications.clear()
      this.errorInjectionIndex = null

      // Release lock
      if (this.sharedState.lockResolver) {
        this.sharedState.lockResolver()
        this.sharedState.transactionLock = null
        this.sharedState.lockResolver = null
      }

      this.metrics.recordLatency(TransactionMetricNames.EXEC_LATENCY, performance.now() - start)
    }
  }

  /**
   * Discard all queued commands and abort transaction (DISCARD).
   * @throws Error if not in a transaction
   */
  async discard(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('Not in a transaction. Call begin() first.')
    }

    this.inTransaction = false
    this.queue = []
    this.watchedKeys.clear()
    this.simulatedModifications.clear()
    this.errorInjectionIndex = null

    // Release lock
    if (this.sharedState.lockResolver) {
      this.sharedState.lockResolver()
      this.sharedState.transactionLock = null
      this.sharedState.lockResolver = null
    }
  }

  // ===========================================================================
  // WATCH COMMANDS
  // ===========================================================================

  /**
   * Watch keys for modifications (WATCH).
   * If any watched key is modified before exec(), the transaction will fail.
   * @param keys - Keys to watch
   */
  async watch(...keys: string[]): Promise<void> {
    for (const key of keys) {
      const version = this.getKeyVersion(key)
      this.watchedKeys.set(key, { key, version })
    }
  }

  /**
   * Stop watching all keys (UNWATCH).
   */
  async unwatch(): Promise<void> {
    this.watchedKeys.clear()
  }

  /**
   * Watch a key at a specific version.
   * The transaction will fail if the key's version doesn't match.
   * @param key - Key to watch
   * @param version - Expected version
   */
  async watchVersion(key: string, version: number): Promise<void> {
    if (!this.enableVersionTracking) {
      throw new Error('Version tracking is not enabled')
    }
    this.watchedKeys.set(key, { key, version })
  }

  /**
   * Get the list of currently watched keys.
   */
  getWatchedKeys(): string[] {
    return Array.from(this.watchedKeys.keys())
  }

  // ===========================================================================
  // REDIS-LIKE COMMANDS
  // ===========================================================================

  /**
   * Set a key to a value (SET).
   * @param key - Key to set
   * @param value - Value to set
   */
  set(key: string, value: string): void {
    this.assertInTransaction()
    this.queueCommand('SET', [key, value])
  }

  /**
   * Get a key's value (GET).
   * @param key - Key to get
   */
  get(key: string): void {
    this.assertInTransaction()
    this.queueCommand('GET', [key])
  }

  /**
   * Delete a key (DEL).
   * @param key - Key to delete
   */
  del(key: string): void {
    this.assertInTransaction()
    this.queueCommand('DEL', [key])
  }

  /**
   * Increment a key's numeric value by 1 (INCR).
   * @param key - Key to increment
   */
  incr(key: string): void {
    this.assertInTransaction()
    this.queueCommand('INCR', [key])
  }

  /**
   * Decrement a key's numeric value by 1 (DECR).
   * @param key - Key to decrement
   */
  decr(key: string): void {
    this.assertInTransaction()
    this.queueCommand('DECR', [key])
  }

  /**
   * Increment a key's numeric value by a specific amount (INCRBY).
   * @param key - Key to increment
   * @param increment - Amount to increment by
   */
  incrBy(key: string, increment: number): void {
    this.assertInTransaction()
    this.queueCommand('INCRBY', [key, increment])
  }

  /**
   * Set a key only if it doesn't exist (SETNX).
   * @param key - Key to set
   * @param value - Value to set
   */
  setNX(key: string, value: string): void {
    this.assertInTransaction()
    this.queueCommand('SETNX', [key, value])
  }

  /**
   * Set a key and return the old value (GETSET).
   * @param key - Key to set
   * @param value - New value
   */
  getSet(key: string, value: string): void {
    this.assertInTransaction()
    this.queueCommand('GETSET', [key, value])
  }

  /**
   * Set multiple keys at once (MSET).
   * @param kvPairs - Object with key-value pairs
   */
  mset(kvPairs: Record<string, string>): void {
    this.assertInTransaction()
    this.queueCommand('MSET', [kvPairs])
  }

  /**
   * Get multiple keys at once (MGET).
   * @param keys - Keys to get
   */
  mget(...keys: string[]): void {
    this.assertInTransaction()
    this.queueCommand('MGET', [keys])
  }

  /**
   * Append to a key's value (APPEND).
   * @param key - Key to append to
   * @param value - Value to append
   */
  append(key: string, value: string): void {
    this.assertInTransaction()
    this.queueCommand('APPEND', [key, value])
  }

  /**
   * Check if a key exists (EXISTS).
   * @param key - Key to check
   */
  exists(key: string): void {
    this.assertInTransaction()
    this.queueCommand('EXISTS', [key])
  }

  /**
   * Get a value at a specific version (for TemporalStore integration).
   * @param key - Key to get
   * @param version - Version to get
   */
  getAtVersion(key: string, version: number): void {
    if (!this.enableVersionTracking) {
      throw new Error('Version tracking is not enabled')
    }
    this.assertInTransaction()
    this.queueCommand('GET_AT_VERSION', [key, version])
  }

  // ===========================================================================
  // STATE INSPECTION
  // ===========================================================================

  /**
   * Check if currently in a transaction.
   */
  isInTransaction(): boolean {
    return this.inTransaction
  }

  /**
   * Get the number of queued commands.
   */
  getQueuedCommandCount(): number {
    return this.queue.length
  }

  /**
   * Get the current version of a key.
   * Returns 0 if the key doesn't exist.
   * @param key - Key to check
   */
  getKeyVersion(key: string): number {
    const entry = this.sharedState.store.get(key)
    return entry?.version ?? 0
  }

  // ===========================================================================
  // TESTING UTILITIES
  // ===========================================================================

  /**
   * Simulate an external modification to a key.
   * This will cause WATCH to fail on exec().
   * @internal For testing only
   */
  _simulateExternalModification(key: string): void {
    this.simulatedModifications.add(key)
    // Increment the key's version to simulate external change
    const entry = this.sharedState.store.get(key)
    if (entry) {
      entry.version++
    }
  }

  /**
   * Inject an error at a specific command index.
   * @internal For testing only
   */
  _injectError(index: number): void {
    this.errorInjectionIndex = index
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Assert that we are in a transaction.
   * @throws Error if not in a transaction
   */
  private assertInTransaction(): void {
    if (!this.inTransaction) {
      throw new Error('Not in a transaction. Call begin() first.')
    }
  }

  /**
   * Queue a command for later execution.
   */
  private queueCommand(name: string, args: unknown[]): void {
    this.queue.push({ name, args })
    this.metrics.incrementCounter(TransactionMetricNames.COMMANDS_QUEUED)
  }

  /**
   * Check for watch conflicts.
   * @returns WatchError if conflict detected, undefined otherwise
   */
  private checkWatchConflicts(): WatchError | undefined {
    for (const [key, watch] of this.watchedKeys) {
      const currentVersion = this.getKeyVersion(key)

      // Check for simulated external modification
      if (this.simulatedModifications.has(key)) {
        return {
          key,
          expectedVersion: watch.version,
          actualVersion: currentVersion,
          message: `Key "${key}" was modified externally during transaction`,
        }
      }

      // Check for version mismatch
      if (currentVersion !== watch.version) {
        return {
          key,
          expectedVersion: watch.version,
          actualVersion: currentVersion,
          message: `Key "${key}" version changed from ${watch.version} to ${currentVersion}`,
        }
      }
    }
    return undefined
  }

  /**
   * Create a snapshot of current state for rollback.
   */
  private createSnapshot(): Map<string, VersionedValue> {
    const snapshot = new Map<string, VersionedValue>()
    for (const [key, value] of this.sharedState.store) {
      snapshot.set(key, {
        value: value.value,
        version: value.version,
        history: value.history ? [...value.history] : undefined,
      })
    }
    return snapshot
  }

  /**
   * Restore state from a snapshot.
   */
  private restoreSnapshot(snapshot: Map<string, VersionedValue>): void {
    this.sharedState.store.clear()
    for (const [key, value] of snapshot) {
      this.sharedState.store.set(key, {
        value: value.value,
        version: value.version,
        history: value.history ? [...value.history] : undefined,
      })
    }
  }

  /**
   * Execute a single command.
   */
  private executeCommand(cmd: QueuedCommand): unknown {
    switch (cmd.name) {
      case 'SET':
        return this.executeSet(cmd.args[0] as string, cmd.args[1] as string)
      case 'GET':
        return this.executeGet(cmd.args[0] as string)
      case 'DEL':
        return this.executeDel(cmd.args[0] as string)
      case 'INCR':
        return this.executeIncr(cmd.args[0] as string, 1)
      case 'DECR':
        return this.executeIncr(cmd.args[0] as string, -1)
      case 'INCRBY':
        return this.executeIncr(cmd.args[0] as string, cmd.args[1] as number)
      case 'SETNX':
        return this.executeSetNX(cmd.args[0] as string, cmd.args[1] as string)
      case 'GETSET':
        return this.executeGetSet(cmd.args[0] as string, cmd.args[1] as string)
      case 'MSET':
        return this.executeMSet(cmd.args[0] as Record<string, string>)
      case 'MGET':
        return this.executeMGet(cmd.args[0] as string[])
      case 'APPEND':
        return this.executeAppend(cmd.args[0] as string, cmd.args[1] as string)
      case 'EXISTS':
        return this.executeExists(cmd.args[0] as string)
      case 'GET_AT_VERSION':
        return this.executeGetAtVersion(cmd.args[0] as string, cmd.args[1] as number)
      default:
        throw new Error(`Unknown command: ${cmd.name}`)
    }
  }

  /**
   * Execute SET command.
   */
  private executeSet(key: string, value: string): string {
    // Handle null/undefined values
    if (value === null || value === undefined) {
      const entry = this.sharedState.store.get(key)
      if (entry) {
        // Store history if version tracking enabled
        if (this.enableVersionTracking) {
          if (!entry.history) entry.history = []
          entry.history.push({ value: entry.value, version: entry.version })
        }
        entry.value = null
        entry.version++
      } else {
        this.sharedState.store.set(key, { value: null, version: 1 })
      }
      return 'OK'
    }

    const entry = this.sharedState.store.get(key)
    if (entry) {
      // Store history if version tracking enabled
      if (this.enableVersionTracking) {
        if (!entry.history) entry.history = []
        entry.history.push({ value: entry.value, version: entry.version })
      }
      entry.value = value
      entry.version++
    } else {
      this.sharedState.store.set(key, {
        value,
        version: 1,
        history: this.enableVersionTracking ? [] : undefined,
      })
    }
    return 'OK'
  }

  /**
   * Execute GET command.
   */
  private executeGet(key: string): string | null {
    const entry = this.sharedState.store.get(key)
    return entry?.value ?? null
  }

  /**
   * Execute DEL command.
   */
  private executeDel(key: string): number {
    const entry = this.sharedState.store.get(key)
    if (!entry) return 0

    // Update version and null out value (preserves history)
    if (this.enableVersionTracking) {
      if (!entry.history) entry.history = []
      entry.history.push({ value: entry.value, version: entry.version })
    }
    entry.value = null
    entry.version++
    return 1
  }

  /**
   * Execute INCR/DECR/INCRBY command.
   */
  private executeIncr(key: string, delta: number): number {
    const entry = this.sharedState.store.get(key)

    if (!entry || entry.value === null) {
      // Key doesn't exist, start at 0
      this.sharedState.store.set(key, {
        value: String(delta),
        version: 1,
        history: this.enableVersionTracking ? [] : undefined,
      })
      return delta
    }

    const currentValue = parseInt(entry.value, 10)
    if (isNaN(currentValue)) {
      throw new Error('ERR value is not an integer or out of range')
    }

    const newValue = currentValue + delta
    if (this.enableVersionTracking) {
      if (!entry.history) entry.history = []
      entry.history.push({ value: entry.value, version: entry.version })
    }
    entry.value = String(newValue)
    entry.version++
    return newValue
  }

  /**
   * Execute SETNX command.
   */
  private executeSetNX(key: string, value: string): number {
    const entry = this.sharedState.store.get(key)
    if (entry && entry.value !== null) {
      return 0 // Key already exists
    }

    this.sharedState.store.set(key, {
      value,
      version: 1,
      history: this.enableVersionTracking ? [] : undefined,
    })
    return 1
  }

  /**
   * Execute GETSET command.
   */
  private executeGetSet(key: string, value: string): string | null {
    const entry = this.sharedState.store.get(key)
    const oldValue = entry?.value ?? null

    if (entry) {
      if (this.enableVersionTracking) {
        if (!entry.history) entry.history = []
        entry.history.push({ value: entry.value, version: entry.version })
      }
      entry.value = value
      entry.version++
    } else {
      this.sharedState.store.set(key, {
        value,
        version: 1,
        history: this.enableVersionTracking ? [] : undefined,
      })
    }

    return oldValue
  }

  /**
   * Execute MSET command.
   */
  private executeMSet(kvPairs: Record<string, string>): string {
    for (const [key, value] of Object.entries(kvPairs)) {
      this.executeSet(key, value)
    }
    return 'OK'
  }

  /**
   * Execute MGET command.
   */
  private executeMGet(keys: string[]): (string | null)[] {
    return keys.map((key) => this.executeGet(key))
  }

  /**
   * Execute APPEND command.
   */
  private executeAppend(key: string, value: string): number {
    const entry = this.sharedState.store.get(key)

    if (!entry || entry.value === null) {
      this.sharedState.store.set(key, {
        value,
        version: 1,
        history: this.enableVersionTracking ? [] : undefined,
      })
      return value.length
    }

    if (this.enableVersionTracking) {
      if (!entry.history) entry.history = []
      entry.history.push({ value: entry.value, version: entry.version })
    }
    entry.value = entry.value + value
    entry.version++
    return entry.value.length
  }

  /**
   * Execute EXISTS command.
   */
  private executeExists(key: string): number {
    const entry = this.sharedState.store.get(key)
    return entry && entry.value !== null ? 1 : 0
  }

  /**
   * Execute GET_AT_VERSION command.
   */
  private executeGetAtVersion(key: string, version: number): string | null {
    if (!this.enableVersionTracking) {
      throw new Error('Version tracking is not enabled')
    }

    const entry = this.sharedState.store.get(key)
    if (!entry) return null

    // Check if current version matches
    if (entry.version === version) {
      return entry.value
    }

    // Look in history
    if (entry.history) {
      for (const h of entry.history) {
        if (h.version === version) {
          return h.value
        }
      }
    }

    return null
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TransactionContext instance.
 *
 * @param options - Configuration options
 * @returns A new TransactionContext instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const ctx = createTransactionContext()
 *
 * // Start transaction
 * await ctx.begin()
 * ctx.set('user:1', 'Alice')
 * ctx.set('user:2', 'Bob')
 * const result = await ctx.exec()
 *
 * // With optimistic locking
 * await ctx.watch('balance')
 * await ctx.begin()
 * ctx.get('balance')
 * ctx.set('balance', newBalance)
 * const result = await ctx.exec()
 * if (!result.success && result.watchError) {
 *   // Handle concurrent modification
 * }
 * ```
 */
export function createTransactionContext(options?: TransactionContextOptions): TransactionContext {
  return new TransactionContext(options)
}
