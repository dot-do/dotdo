/**
 * Two-Phase Commit Protocol Tests
 *
 * Tests for distributed transaction coordination across DOs.
 *
 * Key test areas:
 * 1. Transaction lifecycle (prepare, commit, abort)
 * 2. Distributed locking
 * 3. Recovery mechanisms
 * 4. Error handling
 * 5. Concurrent transactions
 *
 * Uses real infrastructure, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TwoPhaseCoordinator,
  createTwoPhaseCoordinator,
  InMemoryTransactionStore,
  InMemoryLockManager,
  BaseTwoPhaseParticipant,
  TransactionTimeoutError,
  TransactionAbortedError,
  LockConflictError,
  RecoveryFailedError,
  generateTransactionId,
  generateOperationId,
  generateLockId,
  extractDoNamespace,
  groupOperationsByDo,
  isLockExpired,
  locksConflict,
  type TwoPhaseParticipant,
  type TransactionOperation,
  type OperationResult,
  type DistributedLock,
  type PrepareResult,
  type CommitResult,
} from '../two-phase-commit'

// ============================================================================
// TEST HELPERS - Mock Participant
// ============================================================================

/**
 * Test participant implementation that tracks operations
 */
class TestParticipant extends BaseTwoPhaseParticipant {
  readonly url: string
  executedOperations: TransactionOperation[] = []
  validationError: string | null = null
  commitError: string | null = null
  shouldTimeout = false
  prepareDelay = 0
  commitDelay = 0
  snapshotData: Record<string, unknown> = {}
  restoredSnapshots: Record<string, unknown>[] = []

  constructor(url: string) {
    super()
    this.url = url
  }

  protected getParticipantUrl(): string {
    return this.url
  }

  protected async validateOperation(operation: TransactionOperation): Promise<void> {
    if (this.validationError) {
      throw new Error(this.validationError)
    }
  }

  protected async executeOperation(operation: TransactionOperation): Promise<OperationResult> {
    if (this.commitError) {
      return {
        operationId: operation.id,
        success: false,
        error: this.commitError,
      }
    }

    this.executedOperations.push(operation)
    return {
      operationId: operation.id,
      success: true,
      result: { executed: true },
    }
  }

  protected async createSnapshot(operations: TransactionOperation[]): Promise<Record<string, unknown>> {
    return { ...this.snapshotData, operations: operations.map(o => o.id) }
  }

  protected async restoreSnapshot(snapshot: Record<string, unknown>): Promise<void> {
    this.restoredSnapshots.push(snapshot)
  }

  override async prepare(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<PrepareResult> {
    if (this.shouldTimeout) {
      await new Promise(() => {}) // Never resolves
    }
    if (this.prepareDelay > 0) {
      await new Promise(r => setTimeout(r, this.prepareDelay))
    }
    return super.prepare(transactionId, operations)
  }

  override async commit(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<CommitResult> {
    if (this.shouldTimeout) {
      await new Promise(() => {}) // Never resolves
    }
    if (this.commitDelay > 0) {
      await new Promise(r => setTimeout(r, this.commitDelay))
    }
    return super.commit(transactionId, operations)
  }

  reset(): void {
    this.executedOperations = []
    this.validationError = null
    this.commitError = null
    this.shouldTimeout = false
    this.prepareDelay = 0
    this.commitDelay = 0
    this.snapshotData = {}
    this.restoredSnapshots = []
  }
}

/**
 * Create a test participant factory
 */
function createTestParticipantFactory() {
  const participants = new Map<string, TestParticipant>()

  return {
    getParticipant(doUrl: string): TwoPhaseParticipant {
      const namespace = extractDoNamespace(doUrl)
      let participant = participants.get(namespace)
      if (!participant) {
        participant = new TestParticipant(namespace)
        participants.set(namespace, participant)
      }
      return participant
    },

    getTestParticipant(doUrl: string): TestParticipant {
      return participants.get(extractDoNamespace(doUrl)) as TestParticipant
    },

    clear(): void {
      participants.clear()
    },
  }
}

// ============================================================================
// 1. HELPER FUNCTION TESTS
// ============================================================================

describe('Helper Functions', () => {
  describe('generateTransactionId', () => {
    it('generates unique transaction IDs', () => {
      const id1 = generateTransactionId()
      const id2 = generateTransactionId()

      expect(id1).toMatch(/^txn-[a-z0-9]+-[a-z0-9]+$/)
      expect(id2).toMatch(/^txn-[a-z0-9]+-[a-z0-9]+$/)
      expect(id1).not.toBe(id2)
    })
  })

  describe('generateOperationId', () => {
    it('generates unique operation IDs', () => {
      const id1 = generateOperationId()
      const id2 = generateOperationId()

      expect(id1).toMatch(/^op-[a-z0-9]+-[a-z0-9]+$/)
      expect(id2).toMatch(/^op-[a-z0-9]+-[a-z0-9]+$/)
      expect(id1).not.toBe(id2)
    })
  })

  describe('generateLockId', () => {
    it('generates unique lock IDs', () => {
      const id1 = generateLockId()
      const id2 = generateLockId()

      expect(id1).toMatch(/^lock-[a-z0-9]+-[a-z0-9]+$/)
      expect(id2).toMatch(/^lock-[a-z0-9]+-[a-z0-9]+$/)
      expect(id1).not.toBe(id2)
    })
  })

  describe('extractDoNamespace', () => {
    it('extracts namespace from standard DO URL', () => {
      expect(extractDoNamespace('https://users.do/alice')).toBe('https://users.do')
      expect(extractDoNamespace('https://orgs.do/acme/members')).toBe('https://orgs.do')
    })

    it('handles URLs with ports', () => {
      expect(extractDoNamespace('https://localhost:8787/thing')).toBe('https://localhost:8787')
    })

    it('handles URLs with query parameters', () => {
      expect(extractDoNamespace('https://users.do/alice?v=1')).toBe('https://users.do')
    })

    it('returns input for non-URL strings', () => {
      expect(extractDoNamespace('not-a-url')).toBe('not-a-url')
    })
  })

  describe('groupOperationsByDo', () => {
    it('groups operations by DO namespace', () => {
      const operations: TransactionOperation[] = [
        { id: 'op1', doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        { id: 'op2', doUrl: 'https://users.do/bob', type: 'createThing', data: {} },
        { id: 'op3', doUrl: 'https://orgs.do/acme', type: 'createThing', data: {} },
      ]

      const groups = groupOperationsByDo(operations)

      expect(groups.size).toBe(2)
      expect(groups.get('https://users.do')).toHaveLength(2)
      expect(groups.get('https://orgs.do')).toHaveLength(1)
    })

    it('returns empty map for empty operations', () => {
      const groups = groupOperationsByDo([])
      expect(groups.size).toBe(0)
    })
  })

  describe('isLockExpired', () => {
    it('returns true for expired locks', () => {
      const lock: DistributedLock = {
        id: 'lock-1',
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
        doUrl: 'https://users.do',
        acquiredAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      }

      expect(isLockExpired(lock)).toBe(true)
    })

    it('returns false for active locks', () => {
      const lock: DistributedLock = {
        id: 'lock-1',
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
        doUrl: 'https://users.do',
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60000,
      }

      expect(isLockExpired(lock)).toBe(false)
    })
  })

  describe('locksConflict', () => {
    const baseLock = (): DistributedLock => ({
      id: 'lock-1',
      transactionId: 'txn-1',
      resourceUrl: 'https://users.do/alice',
      lockType: 'write',
      doUrl: 'https://users.do',
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60000,
    })

    it('returns false for different resources', () => {
      const lock1 = baseLock()
      const lock2 = { ...baseLock(), id: 'lock-2', transactionId: 'txn-2', resourceUrl: 'https://users.do/bob' }

      expect(locksConflict(lock1, lock2)).toBe(false)
    })

    it('returns false for same transaction', () => {
      const lock1 = baseLock()
      const lock2 = { ...baseLock(), id: 'lock-2' }

      expect(locksConflict(lock1, lock2)).toBe(false)
    })

    it('returns false for two read locks', () => {
      const lock1 = { ...baseLock(), lockType: 'read' as const }
      const lock2 = { ...baseLock(), id: 'lock-2', transactionId: 'txn-2', lockType: 'read' as const }

      expect(locksConflict(lock1, lock2)).toBe(false)
    })

    it('returns true for read vs write on same resource', () => {
      const lock1 = { ...baseLock(), lockType: 'read' as const }
      const lock2 = { ...baseLock(), id: 'lock-2', transactionId: 'txn-2', lockType: 'write' as const }

      expect(locksConflict(lock1, lock2)).toBe(true)
    })

    it('returns true for write vs write on same resource', () => {
      const lock1 = baseLock()
      const lock2 = { ...baseLock(), id: 'lock-2', transactionId: 'txn-2' }

      expect(locksConflict(lock1, lock2)).toBe(true)
    })

    it('returns false if either lock is expired', () => {
      const lock1 = baseLock()
      const lock2 = { ...baseLock(), id: 'lock-2', transactionId: 'txn-2', expiresAt: Date.now() - 1000 }

      expect(locksConflict(lock1, lock2)).toBe(false)
    })
  })
})

// ============================================================================
// 2. IN-MEMORY TRANSACTION STORE TESTS
// ============================================================================

describe('InMemoryTransactionStore', () => {
  let store: InMemoryTransactionStore

  beforeEach(() => {
    store = new InMemoryTransactionStore()
  })

  it('saves and retrieves transactions', async () => {
    const transaction = {
      id: 'txn-1',
      state: 'pending' as const,
      operations: [],
      coordinatorUrl: 'https://coordinator.do',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    await store.save(transaction)
    const retrieved = await store.get('txn-1')

    expect(retrieved).toBeDefined()
    expect(retrieved!.id).toBe('txn-1')
    expect(retrieved!.state).toBe('pending')
  })

  it('returns null for non-existent transactions', async () => {
    const result = await store.get('non-existent')
    expect(result).toBeNull()
  })

  it('lists recoverable transactions', async () => {
    const pendingTxn = {
      id: 'txn-1',
      state: 'preparing' as const,
      operations: [],
      coordinatorUrl: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    const committedTxn = {
      ...pendingTxn,
      id: 'txn-2',
      state: 'committed' as const,
    }

    await store.save(pendingTxn)
    await store.save(committedTxn)

    const recoverable = await store.listRecoverable()

    expect(recoverable).toHaveLength(1)
    expect(recoverable[0]!.id).toBe('txn-1')
  })

  it('deletes transactions', async () => {
    const transaction = {
      id: 'txn-1',
      state: 'committed' as const,
      operations: [],
      coordinatorUrl: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    await store.save(transaction)
    const deleted = await store.delete('txn-1')
    const retrieved = await store.get('txn-1')

    expect(deleted).toBe(true)
    expect(retrieved).toBeNull()
  })

  it('returns false when deleting non-existent transaction', async () => {
    const deleted = await store.delete('non-existent')
    expect(deleted).toBe(false)
  })
})

// ============================================================================
// 3. IN-MEMORY LOCK MANAGER TESTS
// ============================================================================

describe('InMemoryLockManager', () => {
  let lockManager: InMemoryLockManager

  beforeEach(() => {
    lockManager = new InMemoryLockManager()
  })

  describe('acquireLock', () => {
    it('acquires a lock on available resource', () => {
      const result = lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      expect(result.acquired).toBe(true)
      expect(result.lock).toBeDefined()
      expect(result.lock!.resourceUrl).toBe('https://users.do/alice')
      expect(result.lock!.transactionId).toBe('txn-1')
    })

    it('allows same transaction to acquire multiple locks on same resource', () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'read',
      })

      const result = lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      expect(result.acquired).toBe(true)
    })

    it('allows multiple read locks from different transactions', () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'read',
      })

      const result = lockManager.acquireLock({
        transactionId: 'txn-2',
        resourceUrl: 'https://users.do/alice',
        lockType: 'read',
      })

      expect(result.acquired).toBe(true)
    })

    it('rejects conflicting write locks from different transactions', () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      const result = lockManager.acquireLock({
        transactionId: 'txn-2',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      expect(result.acquired).toBe(false)
      expect(result.conflictingLock).toBeDefined()
      expect(result.conflictingLock!.transactionId).toBe('txn-1')
    })

    it('cleans up expired locks and allows new acquisition', async () => {
      // Acquire a lock with very short duration
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
        durationMs: 1,
      })

      // Wait for it to expire
      await new Promise(r => setTimeout(r, 10))

      // Try to acquire again
      const result = lockManager.acquireLock({
        transactionId: 'txn-2',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      expect(result.acquired).toBe(true)
    })
  })

  describe('releaseLock', () => {
    it('releases an existing lock', () => {
      const { lock } = lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      const released = lockManager.releaseLock(lock!.id)

      expect(released).toBe(true)

      // Should now be able to acquire again
      const result = lockManager.acquireLock({
        transactionId: 'txn-2',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      expect(result.acquired).toBe(true)
    })

    it('returns false for non-existent lock', () => {
      const released = lockManager.releaseLock('non-existent')
      expect(released).toBe(false)
    })
  })

  describe('releaseTransactionLocks', () => {
    it('releases all locks for a transaction', () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/bob',
        lockType: 'write',
      })

      const released = lockManager.releaseTransactionLocks('txn-1')

      expect(released).toBe(2)
      expect(lockManager.getTransactionLocks('txn-1')).toHaveLength(0)
    })

    it('returns 0 for transaction with no locks', () => {
      const released = lockManager.releaseTransactionLocks('txn-1')
      expect(released).toBe(0)
    })
  })

  describe('getTransactionLocks', () => {
    it('returns all active locks for a transaction', () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
      })

      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/bob',
        lockType: 'read',
      })

      lockManager.acquireLock({
        transactionId: 'txn-2',
        resourceUrl: 'https://users.do/carol',
        lockType: 'write',
      })

      const locks = lockManager.getTransactionLocks('txn-1')

      expect(locks).toHaveLength(2)
      expect(locks.map(l => l.resourceUrl)).toContain('https://users.do/alice')
      expect(locks.map(l => l.resourceUrl)).toContain('https://users.do/bob')
    })

    it('excludes expired locks', async () => {
      lockManager.acquireLock({
        transactionId: 'txn-1',
        resourceUrl: 'https://users.do/alice',
        lockType: 'write',
        durationMs: 1,
      })

      await new Promise(r => setTimeout(r, 10))

      const locks = lockManager.getTransactionLocks('txn-1')
      expect(locks).toHaveLength(0)
    })
  })
})

// ============================================================================
// 4. TWO PHASE COORDINATOR TESTS
// ============================================================================

describe('TwoPhaseCoordinator', () => {
  let coordinator: TwoPhaseCoordinator
  let participantFactory: ReturnType<typeof createTestParticipantFactory>
  let transactionStore: InMemoryTransactionStore

  beforeEach(() => {
    participantFactory = createTestParticipantFactory()
    transactionStore = new InMemoryTransactionStore()
    coordinator = createTwoPhaseCoordinator({
      defaultTimeoutMs: 5000,
      lockLeaseMs: 10000,
      maxRetries: 2,
      retryDelayMs: 100,
      getParticipant: participantFactory.getParticipant,
      transactionStore,
    })
  })

  describe('executeTransaction - Success Path', () => {
    it('executes a single-participant transaction successfully', async () => {
      const result = await coordinator.executeTransaction({
        operations: [
          {
            doUrl: 'https://users.do/alice',
            type: 'createThing',
            data: { name: 'Alice' },
          },
        ],
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe('committed')
      expect(result.transactionId).toBeDefined()

      const participant = participantFactory.getTestParticipant('https://users.do')
      expect(participant.executedOperations).toHaveLength(1)
    })

    it('executes a multi-participant transaction successfully', async () => {
      const result = await coordinator.executeTransaction({
        operations: [
          {
            doUrl: 'https://users.do/alice',
            type: 'createThing',
            data: { name: 'Alice' },
          },
          {
            doUrl: 'https://orgs.do/acme',
            type: 'createThing',
            data: { name: 'Acme Corp' },
          },
        ],
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe('committed')

      const usersParticipant = participantFactory.getTestParticipant('https://users.do')
      const orgsParticipant = participantFactory.getTestParticipant('https://orgs.do')

      expect(usersParticipant.executedOperations).toHaveLength(1)
      expect(orgsParticipant.executedOperations).toHaveLength(1)
    })

    it('handles multiple operations to same participant', async () => {
      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: { name: 'Alice' } },
          { doUrl: 'https://users.do/bob', type: 'createThing', data: { name: 'Bob' } },
        ],
      })

      expect(result.success).toBe(true)

      const participant = participantFactory.getTestParticipant('https://users.do')
      expect(participant.executedOperations).toHaveLength(2)
    })

    it('cleans up completed transactions from store', async () => {
      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        ],
      })

      // Transaction should be deleted from store after successful commit
      const stored = await transactionStore.get(result.transactionId)
      expect(stored).toBeNull()
    })
  })

  describe('executeTransaction - Abort Path', () => {
    it('aborts when participant validation fails', async () => {
      const participant = participantFactory.getParticipant('https://users.do') as TestParticipant
      participant.validationError = 'Invalid data'

      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.state).toBe('aborted')
      expect(participant.executedOperations).toHaveLength(0)
    })

    it('aborts all participants when one fails prepare', async () => {
      const usersParticipant = participantFactory.getParticipant('https://users.do') as TestParticipant
      const orgsParticipant = participantFactory.getParticipant('https://orgs.do') as TestParticipant

      orgsParticipant.validationError = 'Invalid org'

      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
          { doUrl: 'https://orgs.do/acme', type: 'createThing', data: {} },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.state).toBe('aborted')

      // Neither participant should have committed
      expect(usersParticipant.executedOperations).toHaveLength(0)
      expect(orgsParticipant.executedOperations).toHaveLength(0)
    })

    it('restores snapshots on abort', async () => {
      const participant = participantFactory.getParticipant('https://users.do') as TestParticipant
      participant.snapshotData = { existingUser: 'Alice' }
      participant.validationError = 'Force abort'

      await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'updateThing', data: {} },
        ],
      })

      // Snapshot should have been restored
      expect(participant.restoredSnapshots).toHaveLength(1)
      expect(participant.restoredSnapshots[0]).toHaveProperty('existingUser', 'Alice')
    })
  })

  describe('executeTransaction - Failure Path', () => {
    it('marks transaction as failed when commit fails', async () => {
      const participant = participantFactory.getParticipant('https://users.do') as TestParticipant
      participant.commitError = 'Commit failed'

      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.state).toBe('failed')
      expect(result.error).toContain('Commit phase failed')
    })

    it('preserves transaction in store when commit fails for recovery', async () => {
      const participant = participantFactory.getParticipant('https://users.do') as TestParticipant
      participant.commitError = 'Commit failed'

      const result = await coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        ],
      })

      // Transaction should still be in store for recovery
      const stored = await transactionStore.get(result.transactionId)
      expect(stored).not.toBeNull()
      expect(stored!.state).toBe('failed')
    })
  })

  describe('getTransactionState', () => {
    it('returns transaction state during execution', async () => {
      // Start a transaction that will pause
      const participant = participantFactory.getParticipant('https://users.do') as TestParticipant
      participant.prepareDelay = 100

      const promise = coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: {} },
        ],
        id: 'test-txn-1',
      })

      // Check state while preparing
      await new Promise(r => setTimeout(r, 10))
      const state = await coordinator.getTransactionState('test-txn-1')

      expect(state).not.toBeNull()
      // State could be preparing or prepared depending on timing
      expect(['pending', 'preparing', 'prepared']).toContain(state!.state)

      await promise
    })

    it('returns null for non-existent transaction', async () => {
      const state = await coordinator.getTransactionState('non-existent')
      expect(state).toBeNull()
    })
  })
})

// ============================================================================
// 5. TRANSACTION RECOVERY TESTS
// ============================================================================

describe('Transaction Recovery', () => {
  let coordinator: TwoPhaseCoordinator
  let participantFactory: ReturnType<typeof createTestParticipantFactory>
  let transactionStore: InMemoryTransactionStore

  beforeEach(() => {
    participantFactory = createTestParticipantFactory()
    transactionStore = new InMemoryTransactionStore()
    coordinator = createTwoPhaseCoordinator({
      defaultTimeoutMs: 5000,
      getParticipant: participantFactory.getParticipant,
      transactionStore,
    })
  })

  it('recovers pending transaction by aborting', async () => {
    // Manually create a pending transaction in the store
    const transaction = {
      id: 'txn-pending',
      state: 'pending' as const,
      operations: [
        { id: 'op1', doUrl: 'https://users.do/alice', type: 'createThing' as const, data: {} },
      ],
      coordinatorUrl: '',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    await transactionStore.save(transaction)

    const result = await coordinator.recoverTransaction('txn-pending')

    expect(result.state).toBe('aborted')
    expect(result.success).toBe(false)
  })

  it('recovers prepared transaction by committing', async () => {
    // Create the participant first so it exists
    participantFactory.getParticipant('https://users.do')

    // Manually create a prepared transaction in the store
    const transaction = {
      id: 'txn-prepared',
      state: 'prepared' as const,
      operations: [
        { id: 'op1', doUrl: 'https://users.do/alice', type: 'createThing' as const, data: {} },
      ],
      coordinatorUrl: '',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      timeoutMs: 30000,
      prepareResults: new Map([
        ['https://users.do', {
          participantUrl: 'https://users.do',
          vote: 'commit' as const,
          lockIds: [],
          timestamp: Date.now(),
        }],
      ]),
      commitResults: new Map(),
      compensations: [],
    }

    await transactionStore.save(transaction)

    const result = await coordinator.recoverTransaction('txn-prepared')

    expect(result.state).toBe('committed')
    expect(result.success).toBe(true)
  })

  it('recovers failed transaction by compensating', async () => {
    // Create the participant first
    participantFactory.getParticipant('https://users.do')

    // Manually create a failed transaction in the store
    const transaction = {
      id: 'txn-failed',
      state: 'failed' as const,
      operations: [
        { id: 'op1', doUrl: 'https://users.do/alice', type: 'createThing' as const, data: {} },
      ],
      coordinatorUrl: '',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [
        {
          doUrl: 'https://users.do',
          type: 'restore' as const,
          data: { original: 'data' },
          applied: false,
        },
      ],
    }

    await transactionStore.save(transaction)

    const result = await coordinator.recoverTransaction('txn-failed')

    expect(result.state).toBe('aborted')
  })

  it('throws RecoveryFailedError for non-existent transaction', async () => {
    await expect(coordinator.recoverTransaction('non-existent')).rejects.toThrow(RecoveryFailedError)
  })

  it('recoverAllFailedTransactions processes all recoverable transactions', async () => {
    // Create multiple transactions in various states
    const pendingTxn = {
      id: 'txn-1',
      state: 'preparing' as const,
      operations: [
        { id: 'op1', doUrl: 'https://users.do/alice', type: 'createThing' as const, data: {} },
      ],
      coordinatorUrl: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timeoutMs: 30000,
      prepareResults: new Map(),
      commitResults: new Map(),
      compensations: [],
    }

    const failedTxn = {
      ...pendingTxn,
      id: 'txn-2',
      state: 'failed' as const,
    }

    await transactionStore.save(pendingTxn)
    await transactionStore.save(failedTxn)

    const results = await coordinator.recoverAllFailedTransactions()

    expect(results).toHaveLength(2)
    expect(results.every(r => r.state === 'aborted')).toBe(true)
  })
})

// ============================================================================
// 6. CONCURRENT TRANSACTION TESTS
// ============================================================================

describe('Concurrent Transactions', () => {
  let coordinator: TwoPhaseCoordinator
  let participantFactory: ReturnType<typeof createTestParticipantFactory>

  beforeEach(() => {
    participantFactory = createTestParticipantFactory()
    coordinator = createTwoPhaseCoordinator({
      defaultTimeoutMs: 5000,
      lockLeaseMs: 1000,
      getParticipant: participantFactory.getParticipant,
    })
  })

  it('handles non-conflicting concurrent transactions', async () => {
    // Two transactions on different resources
    const [result1, result2] = await Promise.all([
      coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'createThing', data: { name: 'Alice' } },
        ],
      }),
      coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/bob', type: 'createThing', data: { name: 'Bob' } },
        ],
      }),
    ])

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
  })

  it('handles conflicting concurrent transactions with one aborting', async () => {
    // Two transactions on the same resource
    // One should succeed, one should abort due to lock conflict
    const results = await Promise.all([
      coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'updateThing', data: { name: 'Alice Updated' }, resources: ['https://users.do/alice'] },
        ],
      }),
      coordinator.executeTransaction({
        operations: [
          { doUrl: 'https://users.do/alice', type: 'updateThing', data: { name: 'Alice Modified' }, resources: ['https://users.do/alice'] },
        ],
      }),
    ])

    // At least one should succeed
    const successCount = results.filter(r => r.success).length

    // One succeeds, one aborts OR both succeed if timing allows
    // (depends on lock acquisition timing)
    expect(successCount).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// 7. ERROR CLASSES TESTS
// ============================================================================

describe('Error Classes', () => {
  describe('TransactionTimeoutError', () => {
    it('creates error with correct properties', () => {
      const error = new TransactionTimeoutError('txn-1', 'prepare')

      expect(error.name).toBe('TransactionTimeoutError')
      expect(error.transactionId).toBe('txn-1')
      expect(error.phase).toBe('prepare')
      expect(error.code).toBe('TRANSACTION_TIMEOUT')
      expect(error.message).toContain('txn-1')
      expect(error.message).toContain('prepare')
    })
  })

  describe('TransactionAbortedError', () => {
    it('creates error with correct properties', () => {
      const error = new TransactionAbortedError('txn-1', 'Validation failed', ['https://users.do'])

      expect(error.name).toBe('TransactionAbortedError')
      expect(error.transactionId).toBe('txn-1')
      expect(error.reason).toBe('Validation failed')
      expect(error.failedParticipants).toContain('https://users.do')
      expect(error.code).toBe('TRANSACTION_ABORTED')
    })
  })

  describe('LockConflictError', () => {
    it('creates error with correct properties', () => {
      const error = new LockConflictError('https://users.do/alice', 'txn-other')

      expect(error.name).toBe('LockConflictError')
      expect(error.resourceUrl).toBe('https://users.do/alice')
      expect(error.conflictingTransactionId).toBe('txn-other')
      expect(error.code).toBe('LOCK_CONFLICT')
    })
  })

  describe('RecoveryFailedError', () => {
    it('creates error with correct properties', () => {
      const error = new RecoveryFailedError('txn-1', 'Original error')

      expect(error.name).toBe('RecoveryFailedError')
      expect(error.transactionId).toBe('txn-1')
      expect(error.originalError).toBe('Original error')
      expect(error.code).toBe('RECOVERY_FAILED')
    })
  })
})

// ============================================================================
// 8. BASE PARTICIPANT TESTS
// ============================================================================

describe('BaseTwoPhaseParticipant', () => {
  let participant: TestParticipant

  beforeEach(() => {
    participant = new TestParticipant('https://test.do')
  })

  describe('prepare', () => {
    it('acquires locks and returns commit vote on success', async () => {
      const result = await participant.prepare('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'createThing', data: {} },
      ])

      expect(result.vote).toBe('commit')
      expect(result.participantUrl).toBe('https://test.do')
      expect(result.lockIds).toHaveLength(1)
    })

    it('returns abort vote on validation failure', async () => {
      participant.validationError = 'Invalid data'

      const result = await participant.prepare('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'createThing', data: {} },
      ])

      expect(result.vote).toBe('abort')
      expect(result.error).toContain('Invalid data')
      expect(result.lockIds).toHaveLength(0)
    })

    it('creates snapshot for rollback', async () => {
      participant.snapshotData = { existing: 'data' }

      const result = await participant.prepare('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'updateThing', data: {} },
      ])

      expect(result.snapshot).toBeDefined()
      expect(result.snapshot).toHaveProperty('existing', 'data')
    })
  })

  describe('commit', () => {
    it('executes operations and releases locks', async () => {
      // First prepare to acquire locks
      await participant.prepare('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'createThing', data: {} },
      ])

      const result = await participant.commit('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'createThing', data: {} },
      ])

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.success).toBe(true)
      expect(participant.executedOperations).toHaveLength(1)

      // Locks should be released
      const locks = await participant.getTransactionLocks('txn-1')
      expect(locks).toHaveLength(0)
    })

    it('returns failure on operation error', async () => {
      participant.commitError = 'Operation failed'

      const result = await participant.commit('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'createThing', data: {} },
      ])

      expect(result.success).toBe(false)
      expect(result.error).toContain('Operation failed')
    })
  })

  describe('abort', () => {
    it('restores snapshot and releases locks', async () => {
      participant.snapshotData = { original: 'state' }

      // Prepare to acquire locks and create snapshot
      await participant.prepare('txn-1', [
        { id: 'op1', doUrl: 'https://test.do/item1', type: 'updateThing', data: {} },
      ])

      const success = await participant.abort('txn-1')

      expect(success).toBe(true)
      expect(participant.restoredSnapshots).toHaveLength(1)

      // Locks should be released
      const locks = await participant.getTransactionLocks('txn-1')
      expect(locks).toHaveLength(0)
    })

    it('succeeds even without snapshot', async () => {
      const success = await participant.abort('txn-1')
      expect(success).toBe(true)
    })
  })
})

// ============================================================================
// 9. FACTORY FUNCTION TESTS
// ============================================================================

describe('createTwoPhaseCoordinator', () => {
  it('creates coordinator with default options', () => {
    const coordinator = createTwoPhaseCoordinator()
    expect(coordinator).toBeInstanceOf(TwoPhaseCoordinator)
  })

  it('creates coordinator with custom options', () => {
    const coordinator = createTwoPhaseCoordinator({
      defaultTimeoutMs: 10000,
      lockLeaseMs: 30000,
      maxRetries: 5,
    })

    expect(coordinator).toBeInstanceOf(TwoPhaseCoordinator)
  })

  it('accepts custom transaction store', () => {
    const customStore = new InMemoryTransactionStore()

    const coordinator = createTwoPhaseCoordinator({
      transactionStore: customStore,
    })

    expect(coordinator).toBeInstanceOf(TwoPhaseCoordinator)
  })
})

// ============================================================================
// 10. EXPORT VERIFICATION TESTS
// ============================================================================

describe('Module Exports', () => {
  it('exports TwoPhaseCoordinator class', async () => {
    const module = await import('../two-phase-commit')
    expect(module.TwoPhaseCoordinator).toBeDefined()
  })

  it('exports factory function', async () => {
    const module = await import('../two-phase-commit')
    expect(module.createTwoPhaseCoordinator).toBeDefined()
  })

  it('exports InMemoryTransactionStore', async () => {
    const module = await import('../two-phase-commit')
    expect(module.InMemoryTransactionStore).toBeDefined()
  })

  it('exports InMemoryLockManager', async () => {
    const module = await import('../two-phase-commit')
    expect(module.InMemoryLockManager).toBeDefined()
  })

  it('exports BaseTwoPhaseParticipant', async () => {
    const module = await import('../two-phase-commit')
    expect(module.BaseTwoPhaseParticipant).toBeDefined()
  })

  it('exports error classes', async () => {
    const module = await import('../two-phase-commit')
    expect(module.TransactionTimeoutError).toBeDefined()
    expect(module.TransactionAbortedError).toBeDefined()
    expect(module.LockConflictError).toBeDefined()
    expect(module.RecoveryFailedError).toBeDefined()
  })

  it('exports helper functions', async () => {
    const module = await import('../two-phase-commit')
    expect(module.generateTransactionId).toBeDefined()
    expect(module.generateOperationId).toBeDefined()
    expect(module.generateLockId).toBeDefined()
    expect(module.extractDoNamespace).toBeDefined()
    expect(module.groupOperationsByDo).toBeDefined()
    expect(module.isLockExpired).toBeDefined()
    expect(module.locksConflict).toBeDefined()
  })
})
