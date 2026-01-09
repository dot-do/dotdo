/**
 * Payload Adapter Transaction Operations
 *
 * Provides transaction support for atomic operations across multiple
 * creates, updates, and deletes with commit/rollback semantics.
 *
 * @module @dotdo/payload/adapter/operations/transactions
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Transaction state
 */
export type TransactionState = 'active' | 'committed' | 'rolled_back'

/**
 * Transaction operation record
 */
export interface TransactionOperation {
  type: 'create' | 'update' | 'delete'
  collection: string
  id: string
  data?: Record<string, unknown>
  previousData?: Record<string, unknown>
  timestamp: number
}

/**
 * Savepoint within a transaction
 */
export interface Savepoint {
  name: string
  operationIndex: number
  timestamp: number
  // Snapshots of pending state at savepoint time
  pendingThingsSnapshot: Map<string, any>
  pendingRelationshipsSnapshot: Array<{
    action: 'add' | 'remove'
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
  pendingCollectionDocsSnapshot: Map<string, Map<string, any>>
}

/**
 * Transaction handle returned to callers
 */
export interface Transaction {
  id: string
  startedAt: number
  timeout: number
  operations: TransactionOperation[]
  savepoints: Map<string, Savepoint>
  state: TransactionState
}

/**
 * Options for beginning a transaction
 */
export interface BeginTransactionOptions {
  timeout?: number
}

/**
 * Internal transaction state tracking
 */
export interface TransactionState_Internal {
  transaction: Transaction
  pendingThings: Map<string, any>
  pendingRelationships: Array<{
    action: 'add' | 'remove'
    from: string
    to: string
    verb: string
    data?: Record<string, unknown>
  }>
  pendingCollectionDocs: Map<string, Map<string, any>>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default transaction timeout in milliseconds (30 seconds)
 */
export const DEFAULT_TRANSACTION_TIMEOUT = 30000

// ============================================================================
// TRANSACTION MANAGER
// ============================================================================

/**
 * Create a transaction manager for an adapter
 */
export function createTransactionManager() {
  let activeTransactionState: TransactionState_Internal | null = null
  let transactionCounter = 0
  // Track closed transactions for better error messages
  const closedTransactions = new Map<string, 'committed' | 'rolled_back'>()

  return {
    /**
     * Get the active transaction if any
     */
    get activeTransaction(): Transaction | undefined {
      return activeTransactionState?.transaction
    },

    /**
     * Begin a new transaction
     */
    async beginTransaction(options?: BeginTransactionOptions): Promise<Transaction> {
      if (activeTransactionState) {
        throw new Error('Cannot begin transaction: a transaction is already active. Nested transactions are not supported.')
      }

      const id = `tx_${++transactionCounter}_${Date.now()}`
      const timeout = options?.timeout ?? DEFAULT_TRANSACTION_TIMEOUT

      const transaction: Transaction = {
        id,
        startedAt: Date.now(),
        timeout,
        operations: [],
        savepoints: new Map(),
        state: 'active',
      }

      activeTransactionState = {
        transaction,
        pendingThings: new Map(),
        pendingRelationships: [],
        pendingCollectionDocs: new Map(),
      }

      return transaction
    },

    /**
     * Commit the active transaction
     */
    async commitTransaction(
      tx: Transaction,
      applyOperations: (state: TransactionState_Internal) => Promise<void>
    ): Promise<void> {
      // Check if this transaction was already closed
      const closedState = closedTransactions.get(tx.id)
      if (closedState === 'committed') {
        throw new Error('Cannot commit: transaction is already committed and not active')
      }
      if (closedState === 'rolled_back') {
        throw new Error('Cannot commit: transaction was rolled back and is not active')
      }

      if (!activeTransactionState) {
        throw new Error('Cannot commit: no active transaction')
      }

      if (activeTransactionState.transaction.id !== tx.id) {
        throw new Error('Cannot commit: transaction ID does not match active transaction')
      }

      if (activeTransactionState.transaction.state !== 'active') {
        throw new Error(`Cannot commit: transaction is already ${activeTransactionState.transaction.state}`)
      }

      // Apply all pending operations
      await applyOperations(activeTransactionState)

      // Mark as committed
      activeTransactionState.transaction.state = 'committed'

      // Track closed transaction
      closedTransactions.set(tx.id, 'committed')

      // Clear active transaction
      activeTransactionState = null
    },

    /**
     * Rollback the active transaction
     */
    async rollbackTransaction(tx: Transaction): Promise<void> {
      // Check if this transaction was already closed
      const closedState = closedTransactions.get(tx.id)
      if (closedState === 'committed') {
        throw new Error('Cannot rollback: transaction was committed and is not active')
      }
      if (closedState === 'rolled_back') {
        throw new Error('Cannot rollback: transaction was already rolled back and is not active')
      }

      if (!activeTransactionState) {
        throw new Error('Cannot rollback: no active transaction')
      }

      if (activeTransactionState.transaction.id !== tx.id) {
        throw new Error('Cannot rollback: transaction ID does not match active transaction')
      }

      if (activeTransactionState.transaction.state !== 'active') {
        throw new Error(`Cannot rollback: transaction is already ${activeTransactionState.transaction.state}`)
      }

      // Mark as rolled back
      activeTransactionState.transaction.state = 'rolled_back'

      // Track closed transaction
      closedTransactions.set(tx.id, 'rolled_back')

      // Clear all pending state (discard operations)
      activeTransactionState = null
    },

    /**
     * Create a savepoint within the active transaction
     */
    async savepoint(tx: Transaction, name: string): Promise<Savepoint> {
      if (!activeTransactionState) {
        throw new Error('Cannot create savepoint: no active transaction')
      }

      if (activeTransactionState.transaction.id !== tx.id) {
        throw new Error('Cannot create savepoint: transaction ID does not match active transaction')
      }

      // Deep clone the pending state maps for snapshot
      const pendingThingsSnapshot = new Map(activeTransactionState.pendingThings)
      const pendingRelationshipsSnapshot = [...activeTransactionState.pendingRelationships]
      const pendingCollectionDocsSnapshot = new Map<string, Map<string, any>>()
      for (const [collection, docs] of activeTransactionState.pendingCollectionDocs) {
        pendingCollectionDocsSnapshot.set(collection, new Map(docs))
      }

      const savepoint: Savepoint = {
        name,
        operationIndex: activeTransactionState.transaction.operations.length,
        timestamp: Date.now(),
        pendingThingsSnapshot,
        pendingRelationshipsSnapshot,
        pendingCollectionDocsSnapshot,
      }

      activeTransactionState.transaction.savepoints.set(name, savepoint)

      return savepoint
    },

    /**
     * Rollback to a savepoint
     */
    async rollbackToSavepoint(tx: Transaction, sp: Savepoint | string): Promise<void> {
      if (!activeTransactionState) {
        throw new Error('Cannot rollback to savepoint: no active transaction')
      }

      if (activeTransactionState.transaction.id !== tx.id) {
        throw new Error('Cannot rollback to savepoint: transaction ID does not match active transaction')
      }

      const savepointName = typeof sp === 'string' ? sp : sp.name
      const savepoint = activeTransactionState.transaction.savepoints.get(savepointName)

      if (!savepoint) {
        throw new Error(`Cannot rollback to savepoint: savepoint '${savepointName}' not found or already released`)
      }

      // Truncate operations to savepoint
      activeTransactionState.transaction.operations.length = savepoint.operationIndex

      // Restore pending state from savepoint snapshot
      activeTransactionState.pendingThings = new Map(savepoint.pendingThingsSnapshot)
      activeTransactionState.pendingRelationships = [...savepoint.pendingRelationshipsSnapshot]
      activeTransactionState.pendingCollectionDocs = new Map<string, Map<string, any>>()
      for (const [collection, docs] of savepoint.pendingCollectionDocsSnapshot) {
        activeTransactionState.pendingCollectionDocs.set(collection, new Map(docs))
      }
    },

    /**
     * Release a savepoint
     */
    async releaseSavepoint(tx: Transaction, sp: Savepoint | string): Promise<void> {
      if (!activeTransactionState) {
        throw new Error('Cannot release savepoint: no active transaction')
      }

      if (activeTransactionState.transaction.id !== tx.id) {
        throw new Error('Cannot release savepoint: transaction ID does not match active transaction')
      }

      const savepointName = typeof sp === 'string' ? sp : sp.name

      if (!activeTransactionState.transaction.savepoints.has(savepointName)) {
        throw new Error(`Cannot release savepoint: savepoint '${savepointName}' not found`)
      }

      activeTransactionState.transaction.savepoints.delete(savepointName)
    },

    /**
     * Execute a callback within a transaction (auto-commit/rollback)
     */
    async transaction<T>(
      callback: (tx: Transaction) => Promise<T>,
      applyOperations: (state: TransactionState_Internal) => Promise<void>
    ): Promise<T> {
      const tx = await this.beginTransaction()

      try {
        const result = await callback(tx)
        await this.commitTransaction(tx, applyOperations)
        return result
      } catch (error) {
        await this.rollbackTransaction(tx)
        throw error
      }
    },

    /**
     * Check if a transaction is valid (active and matches current)
     */
    isValidTransaction(tx: Transaction): boolean {
      return (
        activeTransactionState !== null &&
        activeTransactionState.transaction.id === tx.id &&
        activeTransactionState.transaction.state === 'active'
      )
    },

    /**
     * Record an operation within the active transaction
     */
    recordOperation(operation: TransactionOperation): void {
      if (activeTransactionState) {
        activeTransactionState.transaction.operations.push(operation)
      }
    },

    /**
     * Get the pending state for transaction-aware operations
     */
    getPendingState(): TransactionState_Internal | null {
      return activeTransactionState
    },

    /**
     * Add a pending thing (for transaction-aware creates)
     */
    addPendingThing(id: string, thing: any): void {
      if (activeTransactionState) {
        activeTransactionState.pendingThings.set(id, thing)
      }
    },

    /**
     * Get a pending thing
     */
    getPendingThing(id: string): any | undefined {
      return activeTransactionState?.pendingThings.get(id)
    },

    /**
     * Add a pending relationship
     */
    addPendingRelationship(rel: {
      action: 'add' | 'remove'
      from: string
      to: string
      verb: string
      data?: Record<string, unknown>
    }): void {
      if (activeTransactionState) {
        activeTransactionState.pendingRelationships.push(rel)
      }
    },

    /**
     * Add a pending collection document
     */
    addPendingCollectionDoc(collection: string, id: string, doc: any): void {
      if (activeTransactionState) {
        if (!activeTransactionState.pendingCollectionDocs.has(collection)) {
          activeTransactionState.pendingCollectionDocs.set(collection, new Map())
        }
        activeTransactionState.pendingCollectionDocs.get(collection)!.set(id, doc)
      }
    },

    /**
     * Get a pending collection document
     */
    getPendingCollectionDoc(collection: string, id: string): any | undefined {
      return activeTransactionState?.pendingCollectionDocs.get(collection)?.get(id)
    },

    /**
     * Mark a pending document as deleted
     */
    markPendingDeleted(collection: string, id: string): void {
      if (activeTransactionState) {
        if (!activeTransactionState.pendingCollectionDocs.has(collection)) {
          activeTransactionState.pendingCollectionDocs.set(collection, new Map())
        }
        // Mark with special deleted marker
        activeTransactionState.pendingCollectionDocs.get(collection)!.set(id, { __deleted: true })
      }
    },

    /**
     * Check if a pending document is marked as deleted
     */
    isPendingDeleted(collection: string, id: string): boolean {
      const doc = activeTransactionState?.pendingCollectionDocs.get(collection)?.get(id)
      return doc?.__deleted === true
    },
  }
}

/**
 * Type for the transaction manager
 */
export type TransactionManager = ReturnType<typeof createTransactionManager>
