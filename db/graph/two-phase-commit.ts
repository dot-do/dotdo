/**
 * Two-Phase Commit Protocol for Cross-DO Graph Operations
 *
 * Implements distributed transaction coordination for graph mutations that
 * span multiple Durable Objects. This ensures atomicity across DO boundaries.
 *
 * Key Features:
 * - Prepare phase: All participants validate and lock resources
 * - Commit/Rollback phase: Coordinator decides based on prepare responses
 * - Distributed locking with timeout-based lease expiration
 * - Recovery mechanism for failed transactions
 * - Saga-style compensation for partial failures
 *
 * @module db/graph/two-phase-commit
 *
 * @example
 * ```typescript
 * import { TwoPhaseCoordinator, createTwoPhaseCoordinator } from 'db/graph/two-phase-commit'
 *
 * const coordinator = createTwoPhaseCoordinator({
 *   store: graphStore,
 *   timeoutMs: 5000,
 * })
 *
 * // Execute a distributed transaction
 * const result = await coordinator.executeTransaction({
 *   operations: [
 *     { doUrl: 'https://users.do/alice', type: 'create', data: {...} },
 *     { doUrl: 'https://orgs.do/acme', type: 'createRelationship', data: {...} },
 *   ],
 * })
 * ```
 */

import { GraphError } from './errors'

// ============================================================================
// TYPES - Transaction States
// ============================================================================

/**
 * Transaction states in the 2PC protocol
 */
export type TransactionState =
  | 'pending'      // Transaction created but not started
  | 'preparing'    // Prepare phase in progress
  | 'prepared'     // All participants voted to commit
  | 'committing'   // Commit phase in progress
  | 'committed'    // Transaction successfully committed
  | 'aborting'     // Abort phase in progress
  | 'aborted'      // Transaction aborted
  | 'failed'       // Transaction failed (requires recovery)

/**
 * Participant vote in the prepare phase
 */
export type ParticipantVote = 'commit' | 'abort' | 'timeout'

/**
 * Lock types for distributed locking
 */
export type LockType = 'read' | 'write' | 'exclusive'

// ============================================================================
// TYPES - Operations
// ============================================================================

/**
 * Types of graph operations that can be part of a transaction
 */
export type GraphOperationType =
  | 'createThing'
  | 'updateThing'
  | 'deleteThing'
  | 'createRelationship'
  | 'deleteRelationship'

/**
 * A single graph operation within a transaction
 */
export interface TransactionOperation {
  /** Unique ID for this operation */
  id: string
  /** Target DO URL (e.g., 'https://users.do/alice') */
  doUrl: string
  /** Type of graph operation */
  type: GraphOperationType
  /** Operation-specific data */
  data: Record<string, unknown>
  /** Resources that need to be locked */
  resources?: string[]
}

/**
 * Result of a single operation
 */
export interface OperationResult {
  /** Operation ID */
  operationId: string
  /** Whether the operation succeeded */
  success: boolean
  /** Result data if successful */
  result?: unknown
  /** Error message if failed */
  error?: string
}

// ============================================================================
// TYPES - Transaction
// ============================================================================

/**
 * A distributed transaction spanning multiple DOs
 */
export interface DistributedTransaction {
  /** Unique transaction ID */
  id: string
  /** Current state of the transaction */
  state: TransactionState
  /** Operations in this transaction */
  operations: TransactionOperation[]
  /** Coordinator DO URL */
  coordinatorUrl: string
  /** Creation timestamp */
  createdAt: number
  /** Last updated timestamp */
  updatedAt: number
  /** Timeout for the entire transaction (ms) */
  timeoutMs: number
  /** Prepare phase results by participant */
  prepareResults: Map<string, PrepareResult>
  /** Commit phase results by participant */
  commitResults: Map<string, CommitResult>
  /** Compensation operations for rollback */
  compensations: CompensationOperation[]
}

/**
 * Input for creating a new transaction
 */
export interface CreateTransactionInput {
  /** Operations to execute */
  operations: Omit<TransactionOperation, 'id'>[]
  /** Transaction timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Custom transaction ID (auto-generated if not provided) */
  id?: string
}

/**
 * Result of a prepare phase request
 */
export interface PrepareResult {
  /** Participant DO URL */
  participantUrl: string
  /** Participant's vote */
  vote: ParticipantVote
  /** Lock IDs acquired during prepare */
  lockIds: string[]
  /** Prepared state snapshot for rollback */
  snapshot?: Record<string, unknown>
  /** Error message if vote is abort */
  error?: string
  /** Timestamp of the prepare response */
  timestamp: number
}

/**
 * Result of a commit phase request
 */
export interface CommitResult {
  /** Participant DO URL */
  participantUrl: string
  /** Whether commit succeeded */
  success: boolean
  /** Operation results */
  results: OperationResult[]
  /** Error message if failed */
  error?: string
  /** Timestamp of the commit response */
  timestamp: number
}

/**
 * A compensation operation for rollback
 */
export interface CompensationOperation {
  /** Target DO URL */
  doUrl: string
  /** Type of compensation */
  type: 'undo' | 'restore'
  /** Compensation data (snapshot or inverse operation) */
  data: Record<string, unknown>
  /** Whether this compensation has been applied */
  applied: boolean
}

// ============================================================================
// TYPES - Locking
// ============================================================================

/**
 * A distributed lock on a resource
 */
export interface DistributedLock {
  /** Unique lock ID */
  id: string
  /** Transaction ID that holds this lock */
  transactionId: string
  /** Resource URL being locked */
  resourceUrl: string
  /** Type of lock */
  lockType: LockType
  /** DO URL that owns this resource */
  doUrl: string
  /** When the lock was acquired */
  acquiredAt: number
  /** When the lock expires (lease-based) */
  expiresAt: number
}

/**
 * Request to acquire a lock
 */
export interface AcquireLockRequest {
  /** Transaction ID */
  transactionId: string
  /** Resource to lock */
  resourceUrl: string
  /** Type of lock */
  lockType: LockType
  /** Lock duration in ms */
  durationMs?: number
}

/**
 * Result of a lock acquisition attempt
 */
export interface AcquireLockResult {
  /** Whether the lock was acquired */
  acquired: boolean
  /** Lock details if acquired */
  lock?: DistributedLock
  /** Conflicting lock if not acquired */
  conflictingLock?: DistributedLock
  /** Error message if failed */
  error?: string
}

// ============================================================================
// TYPES - Participant Interface
// ============================================================================

/**
 * Interface for a 2PC participant (implemented by each DO)
 */
export interface TwoPhaseParticipant {
  /**
   * Prepare phase: Validate operations, acquire locks, save snapshot
   * @param transactionId - The transaction ID
   * @param operations - Operations to prepare
   * @returns Prepare result with vote
   */
  prepare(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<PrepareResult>

  /**
   * Commit phase: Apply the operations
   * @param transactionId - The transaction ID
   * @param operations - Operations to commit
   * @returns Commit result
   */
  commit(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<CommitResult>

  /**
   * Abort phase: Release locks and restore from snapshot
   * @param transactionId - The transaction ID
   * @returns Whether abort succeeded
   */
  abort(transactionId: string): Promise<boolean>

  /**
   * Acquire a lock on a resource
   * @param request - Lock request
   * @returns Lock acquisition result
   */
  acquireLock(request: AcquireLockRequest): Promise<AcquireLockResult>

  /**
   * Release a lock
   * @param lockId - ID of the lock to release
   * @returns Whether the lock was released
   */
  releaseLock(lockId: string): Promise<boolean>

  /**
   * Get current locks for a transaction
   * @param transactionId - Transaction ID
   * @returns Array of locks held by this transaction
   */
  getTransactionLocks(transactionId: string): Promise<DistributedLock[]>
}

// ============================================================================
// TYPES - Coordinator Options
// ============================================================================

/**
 * Options for creating a TwoPhaseCoordinator
 */
export interface TwoPhaseCoordinatorOptions {
  /** Default transaction timeout in ms */
  defaultTimeoutMs?: number
  /** Lock lease duration in ms */
  lockLeaseMs?: number
  /** Maximum retry attempts for failed phases */
  maxRetries?: number
  /** Delay between retries in ms */
  retryDelayMs?: number
  /** Function to get a participant stub for a DO URL */
  getParticipant?: (doUrl: string) => TwoPhaseParticipant
  /** Persistence store for transaction logs */
  transactionStore?: TransactionStore
}

/**
 * Interface for persisting transaction state (for recovery)
 */
export interface TransactionStore {
  /** Save transaction state */
  save(transaction: DistributedTransaction): Promise<void>
  /** Get transaction by ID */
  get(transactionId: string): Promise<DistributedTransaction | null>
  /** List pending/failed transactions for recovery */
  listRecoverable(): Promise<DistributedTransaction[]>
  /** Delete completed transaction */
  delete(transactionId: string): Promise<boolean>
}

/**
 * Result of executing a transaction
 */
export interface TransactionExecutionResult {
  /** Transaction ID */
  transactionId: string
  /** Final state */
  state: TransactionState
  /** Whether the transaction succeeded */
  success: boolean
  /** Results by participant */
  results: Map<string, CommitResult>
  /** Error message if failed */
  error?: string
  /** Duration in ms */
  durationMs: number
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when a transaction times out
 */
export class TransactionTimeoutError extends GraphError {
  readonly transactionId: string
  readonly phase: 'prepare' | 'commit' | 'abort'

  constructor(transactionId: string, phase: 'prepare' | 'commit' | 'abort', message?: string) {
    super(
      message ?? `Transaction ${transactionId} timed out during ${phase} phase`,
      'TRANSACTION_TIMEOUT'
    )
    this.name = 'TransactionTimeoutError'
    this.transactionId = transactionId
    this.phase = phase
  }
}

/**
 * Error thrown when a transaction is aborted
 */
export class TransactionAbortedError extends GraphError {
  readonly transactionId: string
  readonly reason: string
  readonly failedParticipants: string[]

  constructor(transactionId: string, reason: string, failedParticipants: string[] = [], message?: string) {
    super(
      message ?? `Transaction ${transactionId} aborted: ${reason}`,
      'TRANSACTION_ABORTED'
    )
    this.name = 'TransactionAbortedError'
    this.transactionId = transactionId
    this.reason = reason
    this.failedParticipants = failedParticipants
  }
}

/**
 * Error thrown when a lock cannot be acquired
 */
export class LockConflictError extends GraphError {
  readonly resourceUrl: string
  readonly conflictingTransactionId: string

  constructor(resourceUrl: string, conflictingTransactionId: string, message?: string) {
    super(
      message ?? `Cannot acquire lock on ${resourceUrl}: held by transaction ${conflictingTransactionId}`,
      'LOCK_CONFLICT'
    )
    this.name = 'LockConflictError'
    this.resourceUrl = resourceUrl
    this.conflictingTransactionId = conflictingTransactionId
  }
}

/**
 * Error thrown when recovery fails
 */
export class RecoveryFailedError extends GraphError {
  readonly transactionId: string
  readonly originalError?: string

  constructor(transactionId: string, originalError?: string, message?: string) {
    super(
      message ?? `Failed to recover transaction ${transactionId}`,
      'RECOVERY_FAILED'
    )
    this.name = 'RecoveryFailedError'
    this.transactionId = transactionId
    this.originalError = originalError
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique transaction ID
 */
export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `txn-${timestamp}-${random}`
}

/**
 * Generate a unique operation ID
 */
export function generateOperationId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `op-${timestamp}-${random}`
}

/**
 * Generate a unique lock ID
 */
export function generateLockId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `lock-${timestamp}-${random}`
}

/**
 * Extract the DO namespace from a URL
 * e.g., 'https://users.do/alice' -> 'https://users.do'
 */
export function extractDoNamespace(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    // If not a valid URL, return as-is
    return url
  }
}

/**
 * Group operations by their target DO
 */
export function groupOperationsByDo(
  operations: TransactionOperation[]
): Map<string, TransactionOperation[]> {
  const groups = new Map<string, TransactionOperation[]>()

  for (const op of operations) {
    const doNamespace = extractDoNamespace(op.doUrl)
    const existing = groups.get(doNamespace) || []
    existing.push(op)
    groups.set(doNamespace, existing)
  }

  return groups
}

/**
 * Check if a lock has expired
 */
export function isLockExpired(lock: DistributedLock): boolean {
  return Date.now() > lock.expiresAt
}

/**
 * Check if two locks conflict
 */
export function locksConflict(lock1: DistributedLock, lock2: DistributedLock): boolean {
  // Same resource?
  if (lock1.resourceUrl !== lock2.resourceUrl) {
    return false
  }

  // Same transaction?
  if (lock1.transactionId === lock2.transactionId) {
    return false
  }

  // Expired locks don't conflict
  if (isLockExpired(lock1) || isLockExpired(lock2)) {
    return false
  }

  // Read locks don't conflict with other read locks
  if (lock1.lockType === 'read' && lock2.lockType === 'read') {
    return false
  }

  // Everything else conflicts
  return true
}

// ============================================================================
// TWO PHASE COORDINATOR
// ============================================================================

/**
 * TwoPhaseCoordinator orchestrates distributed transactions across multiple DOs.
 *
 * The coordinator implements the classic 2PC protocol:
 * 1. Prepare Phase: Send prepare to all participants, collect votes
 * 2. Decision: If all vote commit, proceed to commit; otherwise abort
 * 3. Commit/Abort Phase: Apply or rollback changes on all participants
 *
 * Additional features:
 * - Distributed locking with lease-based expiration
 * - Transaction logging for recovery
 * - Retry logic for transient failures
 * - Saga-style compensation for complex rollbacks
 */
export class TwoPhaseCoordinator {
  private readonly options: Required<TwoPhaseCoordinatorOptions>
  private activeTransactions: Map<string, DistributedTransaction> = new Map()

  constructor(options: TwoPhaseCoordinatorOptions = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
      lockLeaseMs: options.lockLeaseMs ?? 60000,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      getParticipant: options.getParticipant ?? this.defaultGetParticipant,
      transactionStore: options.transactionStore ?? new InMemoryTransactionStore(),
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  /**
   * Execute a distributed transaction using 2PC
   *
   * @param input - Transaction input with operations
   * @returns Transaction execution result
   */
  async executeTransaction(input: CreateTransactionInput): Promise<TransactionExecutionResult> {
    const startTime = Date.now()

    // Create the transaction
    const transaction = this.createTransaction(input)

    // Persist initial state
    await this.options.transactionStore.save(transaction)

    try {
      // Phase 1: Prepare
      transaction.state = 'preparing'
      await this.options.transactionStore.save(transaction)

      const prepareSuccess = await this.executePreparePhase(transaction)

      if (!prepareSuccess) {
        // Abort if prepare failed
        transaction.state = 'aborting'
        await this.options.transactionStore.save(transaction)
        await this.executeAbortPhase(transaction)

        return {
          transactionId: transaction.id,
          state: 'aborted',
          success: false,
          results: new Map(),
          error: 'Prepare phase failed - transaction aborted',
          durationMs: Date.now() - startTime,
        }
      }

      // Update state to prepared
      transaction.state = 'prepared'
      await this.options.transactionStore.save(transaction)

      // Phase 2: Commit
      transaction.state = 'committing'
      await this.options.transactionStore.save(transaction)

      const commitSuccess = await this.executeCommitPhase(transaction)

      if (commitSuccess) {
        transaction.state = 'committed'
        await this.options.transactionStore.save(transaction)

        // Clean up completed transaction
        await this.options.transactionStore.delete(transaction.id)
        this.activeTransactions.delete(transaction.id)

        return {
          transactionId: transaction.id,
          state: 'committed',
          success: true,
          results: transaction.commitResults,
          durationMs: Date.now() - startTime,
        }
      } else {
        // This is a problematic state - some commits may have succeeded
        // Mark as failed for recovery
        transaction.state = 'failed'
        await this.options.transactionStore.save(transaction)

        return {
          transactionId: transaction.id,
          state: 'failed',
          success: false,
          results: transaction.commitResults,
          error: 'Commit phase failed - requires recovery',
          durationMs: Date.now() - startTime,
        }
      }
    } catch (error) {
      // Handle unexpected errors
      transaction.state = 'failed'
      await this.options.transactionStore.save(transaction)

      return {
        transactionId: transaction.id,
        state: 'failed',
        success: false,
        results: new Map(),
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Get the current state of a transaction
   *
   * @param transactionId - Transaction ID
   * @returns Transaction state or null if not found
   */
  async getTransactionState(transactionId: string): Promise<DistributedTransaction | null> {
    // Check active transactions first
    const active = this.activeTransactions.get(transactionId)
    if (active) {
      return active
    }

    // Fall back to persistent store
    return this.options.transactionStore.get(transactionId)
  }

  /**
   * Recover a failed or interrupted transaction
   *
   * @param transactionId - Transaction ID to recover
   * @returns Recovery result
   */
  async recoverTransaction(transactionId: string): Promise<TransactionExecutionResult> {
    const startTime = Date.now()

    const transaction = await this.options.transactionStore.get(transactionId)
    if (!transaction) {
      throw new RecoveryFailedError(transactionId, 'Transaction not found')
    }

    // Determine recovery action based on state
    switch (transaction.state) {
      case 'pending':
      case 'preparing':
        // Never got to prepared state - safe to abort
        await this.executeAbortPhase(transaction)
        transaction.state = 'aborted'
        await this.options.transactionStore.save(transaction)
        break

      case 'prepared':
      case 'committing':
        // Was prepared or committing - try to complete commit
        const commitSuccess = await this.executeCommitPhase(transaction)
        if (commitSuccess) {
          transaction.state = 'committed'
        } else {
          transaction.state = 'failed'
        }
        await this.options.transactionStore.save(transaction)
        break

      case 'aborting':
        // Was aborting - complete abort
        await this.executeAbortPhase(transaction)
        transaction.state = 'aborted'
        await this.options.transactionStore.save(transaction)
        break

      case 'committed':
      case 'aborted':
        // Already in terminal state - nothing to do
        break

      case 'failed':
        // Try to abort/compensate
        await this.executeCompensations(transaction)
        transaction.state = 'aborted'
        await this.options.transactionStore.save(transaction)
        break
    }

    return {
      transactionId: transaction.id,
      state: transaction.state,
      success: transaction.state === 'committed',
      results: transaction.commitResults,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Recover all failed transactions
   *
   * @returns Array of recovery results
   */
  async recoverAllFailedTransactions(): Promise<TransactionExecutionResult[]> {
    const recoverable = await this.options.transactionStore.listRecoverable()
    const results: TransactionExecutionResult[] = []

    for (const transaction of recoverable) {
      try {
        const result = await this.recoverTransaction(transaction.id)
        results.push(result)
      } catch (error) {
        // Log error but continue with other transactions
        console.error(`Failed to recover transaction ${transaction.id}:`, error)
        results.push({
          transactionId: transaction.id,
          state: 'failed',
          success: false,
          results: new Map(),
          error: error instanceof Error ? error.message : 'Recovery failed',
          durationMs: 0,
        })
      }
    }

    return results
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Transaction Creation
  // -------------------------------------------------------------------------

  private createTransaction(input: CreateTransactionInput): DistributedTransaction {
    const id = input.id ?? generateTransactionId()
    const now = Date.now()

    const operations = input.operations.map((op) => ({
      ...op,
      id: generateOperationId(),
    }))

    const transaction: DistributedTransaction = {
      id,
      state: 'pending',
      operations,
      coordinatorUrl: '', // Would be set by the calling DO
      createdAt: now,
      updatedAt: now,
      timeoutMs: input.timeoutMs ?? this.options.defaultTimeoutMs,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    this.activeTransactions.set(id, transaction)
    return transaction
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Prepare Phase
  // -------------------------------------------------------------------------

  private async executePreparePhase(transaction: DistributedTransaction): Promise<boolean> {
    const operationsByDo = groupOperationsByDo(transaction.operations)
    const preparePromises: Promise<PrepareResult>[] = []

    // Send prepare to all participants in parallel
    for (const [doUrl, operations] of operationsByDo) {
      preparePromises.push(
        this.prepareParticipant(transaction.id, doUrl, operations, transaction.timeoutMs)
      )
    }

    // Wait for all prepare responses
    const results = await Promise.allSettled(preparePromises)

    // Process results
    let allVotedCommit = true
    const failedParticipants: string[] = []

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const prepareResult = result.value
        transaction.prepareResults.set(prepareResult.participantUrl, prepareResult)

        if (prepareResult.vote !== 'commit') {
          allVotedCommit = false
          failedParticipants.push(prepareResult.participantUrl)

          // Record compensation for rollback
          if (prepareResult.snapshot) {
            transaction.compensations.push({
              doUrl: prepareResult.participantUrl,
              type: 'restore',
              data: prepareResult.snapshot,
              applied: false,
            })
          }
        }
      } else {
        // Promise rejected - treat as abort vote
        allVotedCommit = false
        const error = result.reason instanceof Error ? result.reason.message : 'Unknown error'
        // We don't know which participant failed from the rejection
        console.error(`Prepare failed:`, error)
      }
    }

    return allVotedCommit
  }

  private async prepareParticipant(
    transactionId: string,
    doUrl: string,
    operations: TransactionOperation[],
    timeoutMs: number
  ): Promise<PrepareResult> {
    const participant = this.options.getParticipant(doUrl)

    // Execute prepare with timeout
    const preparePromise = participant.prepare(transactionId, operations)
    const timeoutPromise = new Promise<PrepareResult>((_, reject) => {
      setTimeout(() => {
        reject(new TransactionTimeoutError(transactionId, 'prepare'))
      }, timeoutMs)
    })

    try {
      return await Promise.race([preparePromise, timeoutPromise])
    } catch (error) {
      if (error instanceof TransactionTimeoutError) {
        return {
          participantUrl: doUrl,
          vote: 'timeout',
          lockIds: [],
          error: 'Prepare timed out',
          timestamp: Date.now(),
        }
      }
      return {
        participantUrl: doUrl,
        vote: 'abort',
        lockIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      }
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Commit Phase
  // -------------------------------------------------------------------------

  private async executeCommitPhase(transaction: DistributedTransaction): Promise<boolean> {
    const operationsByDo = groupOperationsByDo(transaction.operations)
    const commitPromises: Promise<CommitResult>[] = []

    // Send commit to all participants in parallel
    for (const [doUrl, operations] of operationsByDo) {
      commitPromises.push(
        this.commitParticipant(transaction.id, doUrl, operations, transaction.timeoutMs)
      )
    }

    // Wait for all commit responses
    const results = await Promise.allSettled(commitPromises)

    // Process results
    let allCommitted = true

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const commitResult = result.value
        transaction.commitResults.set(commitResult.participantUrl, commitResult)

        if (!commitResult.success) {
          allCommitted = false
        }
      } else {
        // Promise rejected - commit failed
        allCommitted = false
      }
    }

    transaction.updatedAt = Date.now()
    return allCommitted
  }

  private async commitParticipant(
    transactionId: string,
    doUrl: string,
    operations: TransactionOperation[],
    timeoutMs: number
  ): Promise<CommitResult> {
    const participant = this.options.getParticipant(doUrl)

    // Execute commit with timeout
    const commitPromise = participant.commit(transactionId, operations)
    const timeoutPromise = new Promise<CommitResult>((_, reject) => {
      setTimeout(() => {
        reject(new TransactionTimeoutError(transactionId, 'commit'))
      }, timeoutMs)
    })

    try {
      return await Promise.race([commitPromise, timeoutPromise])
    } catch (error) {
      return {
        participantUrl: doUrl,
        success: false,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      }
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Abort Phase
  // -------------------------------------------------------------------------

  private async executeAbortPhase(transaction: DistributedTransaction): Promise<void> {
    const participantUrls = new Set<string>()

    // Collect all participant URLs
    for (const op of transaction.operations) {
      participantUrls.add(extractDoNamespace(op.doUrl))
    }

    // Send abort to all participants in parallel
    const abortPromises: Promise<boolean>[] = []
    for (const doUrl of participantUrls) {
      abortPromises.push(this.abortParticipant(transaction.id, doUrl))
    }

    await Promise.allSettled(abortPromises)
    transaction.updatedAt = Date.now()
  }

  private async abortParticipant(transactionId: string, doUrl: string): Promise<boolean> {
    try {
      const participant = this.options.getParticipant(doUrl)
      return await participant.abort(transactionId)
    } catch {
      // Best effort - log and continue
      console.error(`Failed to abort participant ${doUrl}`)
      return false
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Compensation
  // -------------------------------------------------------------------------

  private async executeCompensations(transaction: DistributedTransaction): Promise<void> {
    // Execute compensations in reverse order
    for (let i = transaction.compensations.length - 1; i >= 0; i--) {
      const compensation = transaction.compensations[i]!
      if (compensation.applied) continue

      try {
        // Compensation logic would depend on the operation type
        // For now, we use the participant's abort which handles cleanup
        const participant = this.options.getParticipant(compensation.doUrl)
        await participant.abort(transaction.id)
        compensation.applied = true
      } catch (error) {
        console.error(`Compensation failed for ${compensation.doUrl}:`, error)
        // Continue with other compensations
      }
    }

    transaction.updatedAt = Date.now()
  }

  // -------------------------------------------------------------------------
  // PRIVATE - Default Participant
  // -------------------------------------------------------------------------

  private defaultGetParticipant(_doUrl: string): TwoPhaseParticipant {
    // Default implementation throws - must be overridden
    throw new GraphError('getParticipant must be provided in options', 'NOT_IMPLEMENTED')
  }
}

// ============================================================================
// IN-MEMORY TRANSACTION STORE
// ============================================================================

/**
 * In-memory implementation of TransactionStore for testing and simple use cases.
 * For production, use a durable store (SQLite, R2, etc.)
 */
export class InMemoryTransactionStore implements TransactionStore {
  private transactions: Map<string, DistributedTransaction> = new Map()

  async save(transaction: DistributedTransaction): Promise<void> {
    // Deep clone to avoid mutation issues
    this.transactions.set(transaction.id, {
      ...transaction,
      prepareResults: new Map(transaction.prepareResults),
      commitResults: new Map(transaction.commitResults),
      compensations: [...transaction.compensations],
    })
  }

  async get(transactionId: string): Promise<DistributedTransaction | null> {
    return this.transactions.get(transactionId) ?? null
  }

  async listRecoverable(): Promise<DistributedTransaction[]> {
    const recoverable: DistributedTransaction[] = []

    for (const transaction of this.transactions.values()) {
      if (
        transaction.state !== 'committed' &&
        transaction.state !== 'aborted'
      ) {
        recoverable.push(transaction)
      }
    }

    return recoverable
  }

  async delete(transactionId: string): Promise<boolean> {
    return this.transactions.delete(transactionId)
  }

  /** Clear all transactions (for testing) */
  clear(): void {
    this.transactions.clear()
  }
}

// ============================================================================
// IN-MEMORY LOCK MANAGER
// ============================================================================

/**
 * In-memory implementation of distributed locking for single-node testing.
 * For production with real DOs, each DO manages its own locks.
 */
export class InMemoryLockManager {
  private locks: Map<string, DistributedLock> = new Map()
  private locksByResource: Map<string, Set<string>> = new Map()
  private locksByTransaction: Map<string, Set<string>> = new Map()

  /**
   * Acquire a lock on a resource
   */
  acquireLock(request: AcquireLockRequest, durationMs = 60000): AcquireLockResult {
    const now = Date.now()

    // Clean up expired locks first
    this.cleanupExpiredLocks()

    // Check for conflicting locks
    const existingLockIds = this.locksByResource.get(request.resourceUrl)
    if (existingLockIds) {
      for (const lockId of existingLockIds) {
        const existingLock = this.locks.get(lockId)
        if (existingLock && !isLockExpired(existingLock)) {
          // Check if locks conflict
          const testLock: DistributedLock = {
            id: '',
            transactionId: request.transactionId,
            resourceUrl: request.resourceUrl,
            lockType: request.lockType,
            doUrl: '',
            acquiredAt: now,
            expiresAt: now + durationMs,
          }

          if (locksConflict(existingLock, testLock)) {
            return {
              acquired: false,
              conflictingLock: existingLock,
            }
          }
        }
      }
    }

    // Create the lock
    const lock: DistributedLock = {
      id: generateLockId(),
      transactionId: request.transactionId,
      resourceUrl: request.resourceUrl,
      lockType: request.lockType,
      doUrl: '', // Would be set by the DO
      acquiredAt: now,
      expiresAt: now + (request.durationMs ?? durationMs),
    }

    // Store the lock
    this.locks.set(lock.id, lock)

    // Index by resource
    if (!this.locksByResource.has(request.resourceUrl)) {
      this.locksByResource.set(request.resourceUrl, new Set())
    }
    this.locksByResource.get(request.resourceUrl)!.add(lock.id)

    // Index by transaction
    if (!this.locksByTransaction.has(request.transactionId)) {
      this.locksByTransaction.set(request.transactionId, new Set())
    }
    this.locksByTransaction.get(request.transactionId)!.add(lock.id)

    return {
      acquired: true,
      lock,
    }
  }

  /**
   * Release a lock
   */
  releaseLock(lockId: string): boolean {
    const lock = this.locks.get(lockId)
    if (!lock) {
      return false
    }

    // Remove from indices
    this.locksByResource.get(lock.resourceUrl)?.delete(lockId)
    this.locksByTransaction.get(lock.transactionId)?.delete(lockId)

    // Remove the lock
    this.locks.delete(lockId)

    return true
  }

  /**
   * Release all locks for a transaction
   */
  releaseTransactionLocks(transactionId: string): number {
    const lockIds = this.locksByTransaction.get(transactionId)
    if (!lockIds) {
      return 0
    }

    let released = 0
    for (const lockId of lockIds) {
      if (this.releaseLock(lockId)) {
        released++
      }
    }

    this.locksByTransaction.delete(transactionId)
    return released
  }

  /**
   * Get all locks for a transaction
   */
  getTransactionLocks(transactionId: string): DistributedLock[] {
    const lockIds = this.locksByTransaction.get(transactionId)
    if (!lockIds) {
      return []
    }

    const locks: DistributedLock[] = []
    for (const lockId of lockIds) {
      const lock = this.locks.get(lockId)
      if (lock && !isLockExpired(lock)) {
        locks.push(lock)
      }
    }

    return locks
  }

  /**
   * Clean up expired locks
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now()
    const expired: string[] = []

    for (const [lockId, lock] of this.locks) {
      if (lock.expiresAt < now) {
        expired.push(lockId)
      }
    }

    for (const lockId of expired) {
      this.releaseLock(lockId)
    }
  }

  /** Clear all locks (for testing) */
  clear(): void {
    this.locks.clear()
    this.locksByResource.clear()
    this.locksByTransaction.clear()
  }
}

// ============================================================================
// BASE PARTICIPANT IMPLEMENTATION
// ============================================================================

/**
 * Base implementation of TwoPhaseParticipant that can be extended by DOs.
 * Provides lock management and basic prepare/commit/abort structure.
 */
export abstract class BaseTwoPhaseParticipant implements TwoPhaseParticipant {
  protected lockManager: InMemoryLockManager
  protected preparedSnapshots: Map<string, Record<string, unknown>> = new Map()
  protected lockLeaseMs: number

  constructor(options?: { lockLeaseMs?: number }) {
    this.lockManager = new InMemoryLockManager()
    this.lockLeaseMs = options?.lockLeaseMs ?? 60000
  }

  async prepare(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<PrepareResult> {
    const lockIds: string[] = []

    try {
      // 1. Validate operations
      for (const op of operations) {
        await this.validateOperation(op)
      }

      // 2. Acquire locks on all resources
      for (const op of operations) {
        const resources = op.resources ?? [op.doUrl]
        for (const resource of resources) {
          const result = this.lockManager.acquireLock({
            transactionId,
            resourceUrl: resource,
            lockType: this.getLockTypeForOperation(op.type),
            durationMs: this.lockLeaseMs,
          })

          if (!result.acquired) {
            // Release already acquired locks
            for (const lockId of lockIds) {
              this.lockManager.releaseLock(lockId)
            }

            return {
              participantUrl: this.getParticipantUrl(),
              vote: 'abort',
              lockIds: [],
              error: `Lock conflict on ${resource}`,
              timestamp: Date.now(),
            }
          }

          lockIds.push(result.lock!.id)
        }
      }

      // 3. Create snapshot for rollback
      const snapshot = await this.createSnapshot(operations)
      this.preparedSnapshots.set(transactionId, snapshot)

      return {
        participantUrl: this.getParticipantUrl(),
        vote: 'commit',
        lockIds,
        snapshot,
        timestamp: Date.now(),
      }
    } catch (error) {
      // Release locks on error
      for (const lockId of lockIds) {
        this.lockManager.releaseLock(lockId)
      }

      return {
        participantUrl: this.getParticipantUrl(),
        vote: 'abort',
        lockIds: [],
        error: error instanceof Error ? error.message : 'Validation failed',
        timestamp: Date.now(),
      }
    }
  }

  async commit(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<CommitResult> {
    const results: OperationResult[] = []

    try {
      // Execute operations
      for (const op of operations) {
        const result = await this.executeOperation(op)
        results.push(result)

        if (!result.success) {
          // Partial failure - this is problematic
          return {
            participantUrl: this.getParticipantUrl(),
            success: false,
            results,
            error: `Operation ${op.id} failed: ${result.error}`,
            timestamp: Date.now(),
          }
        }
      }

      // Release locks and clean up snapshot
      this.lockManager.releaseTransactionLocks(transactionId)
      this.preparedSnapshots.delete(transactionId)

      return {
        participantUrl: this.getParticipantUrl(),
        success: true,
        results,
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        participantUrl: this.getParticipantUrl(),
        success: false,
        results,
        error: error instanceof Error ? error.message : 'Commit failed',
        timestamp: Date.now(),
      }
    }
  }

  async abort(transactionId: string): Promise<boolean> {
    try {
      // Restore from snapshot if available
      const snapshot = this.preparedSnapshots.get(transactionId)
      if (snapshot) {
        await this.restoreSnapshot(snapshot)
        this.preparedSnapshots.delete(transactionId)
      }

      // Release all locks
      this.lockManager.releaseTransactionLocks(transactionId)

      return true
    } catch {
      return false
    }
  }

  async acquireLock(request: AcquireLockRequest): Promise<AcquireLockResult> {
    return this.lockManager.acquireLock(request, this.lockLeaseMs)
  }

  async releaseLock(lockId: string): Promise<boolean> {
    return this.lockManager.releaseLock(lockId)
  }

  async getTransactionLocks(transactionId: string): Promise<DistributedLock[]> {
    return this.lockManager.getTransactionLocks(transactionId)
  }

  // -------------------------------------------------------------------------
  // ABSTRACT METHODS - To be implemented by concrete participants
  // -------------------------------------------------------------------------

  /** Get this participant's URL */
  protected abstract getParticipantUrl(): string

  /** Validate an operation before prepare */
  protected abstract validateOperation(operation: TransactionOperation): Promise<void>

  /** Execute an operation during commit */
  protected abstract executeOperation(operation: TransactionOperation): Promise<OperationResult>

  /** Create a snapshot for rollback */
  protected abstract createSnapshot(operations: TransactionOperation[]): Promise<Record<string, unknown>>

  /** Restore from a snapshot during abort */
  protected abstract restoreSnapshot(snapshot: Record<string, unknown>): Promise<void>

  // -------------------------------------------------------------------------
  // HELPER METHODS
  // -------------------------------------------------------------------------

  protected getLockTypeForOperation(type: GraphOperationType): LockType {
    switch (type) {
      case 'createThing':
      case 'createRelationship':
        return 'write'
      case 'updateThing':
        return 'write'
      case 'deleteThing':
      case 'deleteRelationship':
        return 'exclusive'
      default:
        return 'write'
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a TwoPhaseCoordinator with the specified options
 *
 * @param options - Coordinator options
 * @returns A new TwoPhaseCoordinator instance
 */
export function createTwoPhaseCoordinator(
  options?: TwoPhaseCoordinatorOptions
): TwoPhaseCoordinator {
  return new TwoPhaseCoordinator(options)
}
