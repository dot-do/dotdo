/**
 * WAL Manager Tests (RED Phase - TDD)
 *
 * Tests for the Write-Ahead Log (WAL) system that provides:
 * - Crash recovery via operation replay
 * - Transaction support with ACID guarantees
 * - Savepoints for partial rollback
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement WALManager to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/wal-manager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  WALEntry,
  WALConfig,
  WALOperationType,
  Transaction,
  TransactionState,
  Savepoint,
  WALRecoveryResult,
  WALRecoveryError,
} from '../types'

// Will be implemented in GREEN phase
// import { WALManager } from '../wal-manager'

// ============================================================================
// MOCK TYPES FOR TESTING
// ============================================================================

interface MockStorage {
  data: Map<string, unknown>
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockStorage(): MockStorage {
  const walEntries: WALEntry[] = []
  const transactions: Transaction[] = []
  let walSeq = 0

  return {
    data: new Map(),
    sql: {
      exec(query: string, ...params: unknown[]) {
        const upperQuery = query.toUpperCase()

        if (upperQuery.includes('INSERT INTO WAL')) {
          walSeq++
          const entry: WALEntry = {
            lsn: walSeq,
            operation: params[0] as WALOperationType,
            table: params[1] as string || '',
            payload: params[2] as Uint8Array,
            transactionId: params[3] as string | undefined,
            schemaVersion: 1,
            createdAt: Date.now(),
            flushed: false,
            checksum: 'test-checksum',
          }
          walEntries.push(entry)
          return { toArray: () => [{ id: walSeq }] }
        }

        if (upperQuery.includes('SELECT') && upperQuery.includes('FROM WAL')) {
          return {
            toArray: () => walEntries.filter(e => !e.flushed)
          }
        }

        if (upperQuery.includes('UPDATE WAL SET FLUSHED')) {
          const count = walEntries.filter(e => !e.flushed).length
          walEntries.forEach(e => e.flushed = true)
          return { toArray: () => [], changes: count }
        }

        if (upperQuery.includes('DELETE FROM WAL')) {
          const countBefore = walEntries.length
          walEntries.length = 0
          return { toArray: () => [], changes: countBefore }
        }

        if (upperQuery.includes('INSERT INTO TRANSACTIONS')) {
          const tx: Transaction = {
            id: params[0] as string,
            state: params[1] as TransactionState,
            startedAt: Date.now(),
            operations: [],
            savepoints: [],
            timeoutMs: 30000,
          }
          transactions.push(tx)
          return { toArray: () => [] }
        }

        if (upperQuery.includes('SELECT') && upperQuery.includes('FROM TRANSACTIONS')) {
          return {
            toArray: () => transactions.filter(t => t.id === params[0])
          }
        }

        if (upperQuery.includes('UPDATE TRANSACTIONS')) {
          const tx = transactions.find(t => t.id === params[1])
          if (tx) tx.state = params[0] as TransactionState
          return { toArray: () => [] }
        }

        if (upperQuery.includes('MAX(LSN)') || upperQuery.includes('MAX(ID)')) {
          const maxLsn = walEntries.length > 0
            ? Math.max(...walEntries.map(e => e.lsn))
            : 0
          return { toArray: () => [{ max_lsn: maxLsn }] }
        }

        if (upperQuery.includes('COUNT(*)')) {
          const count = walEntries.filter(e => !e.flushed).length
          return { toArray: () => [{ count }] }
        }

        return { toArray: () => [] }
      }
    }
  }
}

// ============================================================================
// TEST SUITE: WAL MANAGER
// ============================================================================

describe('WALManager', () => {
  let storage: MockStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // WAL ENTRY OPERATIONS
  // ==========================================================================

  describe('WAL Entry Operations', () => {
    it('should append entry to WAL with monotonically increasing LSN', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
      }

      const lsn1 = await manager.append('INSERT', 'things', new Uint8Array([1, 2, 3]))
      const lsn2 = await manager.append('INSERT', 'things', new Uint8Array([4, 5, 6]))
      const lsn3 = await manager.append('UPDATE', 'things', new Uint8Array([7, 8, 9]))

      expect(lsn2).toBeGreaterThan(lsn1)
      expect(lsn3).toBeGreaterThan(lsn2)
    })

    it('should store operation type correctly', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('DELETE', 'things', new Uint8Array([1]))

      const entry = await manager.getEntry(lsn)

      expect(entry?.operation).toBe('DELETE')
    })

    it('should calculate checksum for entry', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1, 2, 3, 4, 5]))

      const entry = await manager.getEntry(lsn)

      expect(entry?.checksum).toBeDefined()
      expect(typeof entry?.checksum).toBe('string')
      expect(entry?.checksum.length).toBeGreaterThan(0)
    })

    it('should mark new entries as unflushed', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1]))

      const entry = await manager.getEntry(lsn)

      expect(entry?.flushed).toBe(false)
    })

    it('should include schema version in entry', async () => {
      const manager = null as unknown as {
        schemaVersion: number
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1]))

      const entry = await manager.getEntry(lsn)

      expect(entry?.schemaVersion).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // WAL FLUSH OPERATIONS
  // ==========================================================================

  describe('WAL Flush Operations', () => {
    it('should flush unflushed entries', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        flush(): Promise<number>
        getUnflushedCount(): Promise<number>
      }

      await manager.append('INSERT', 'things', new Uint8Array([1]))
      await manager.append('INSERT', 'things', new Uint8Array([2]))
      await manager.append('INSERT', 'things', new Uint8Array([3]))

      const flushed = await manager.flush()

      expect(flushed).toBe(3)
      expect(await manager.getUnflushedCount()).toBe(0)
    })

    it('should mark entries as flushed after flush', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        flush(): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1]))

      await manager.flush()

      const entry = await manager.getEntry(lsn)
      expect(entry?.flushed).toBe(true)
    })

    it('should return 0 when no unflushed entries', async () => {
      const manager = null as unknown as {
        flush(): Promise<number>
      }

      const flushed = await manager.flush()

      expect(flushed).toBe(0)
    })

    it('should sync on flush in sync mode', async () => {
      const config: WALConfig = { syncMode: 'sync' }
      const syncCalled = { value: false }

      const manager = null as unknown as {
        configure(config: WALConfig): void
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        onSync(callback: () => void): void
      }

      manager.configure(config)
      manager.onSync(() => { syncCalled.value = true })

      await manager.append('INSERT', 'things', new Uint8Array([1]))

      expect(syncCalled.value).toBe(true)
    })

    it('should batch sync in async mode', async () => {
      const config: WALConfig = { syncMode: 'async', asyncSyncIntervalMs: 100 }
      let syncCount = 0

      const manager = null as unknown as {
        configure(config: WALConfig): void
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        onSync(callback: () => void): void
        start(): void
      }

      manager.configure(config)
      manager.onSync(() => { syncCount++ })
      manager.start()

      // Add multiple entries quickly
      await manager.append('INSERT', 'things', new Uint8Array([1]))
      await manager.append('INSERT', 'things', new Uint8Array([2]))
      await manager.append('INSERT', 'things', new Uint8Array([3]))

      // Wait for batch sync
      await vi.advanceTimersByTimeAsync(150)

      // Should have synced once (batched)
      expect(syncCount).toBe(1)
    })
  })

  // ==========================================================================
  // TRANSACTION SUPPORT
  // ==========================================================================

  describe('Transaction Support', () => {
    it('should begin transaction with unique ID', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
      }

      const txId1 = await manager.beginTransaction()
      const txId2 = await manager.beginTransaction()

      expect(txId1).toBeDefined()
      expect(txId2).toBeDefined()
      expect(txId1).not.toBe(txId2)
    })

    it('should associate entries with transaction', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const txId = await manager.beginTransaction()
      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1]), txId)

      const entry = await manager.getEntry(lsn)

      expect(entry?.transactionId).toBe(txId)
    })

    it('should commit transaction successfully', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        commitTransaction(txId: string): Promise<void>
        getTransactionState(txId: string): Promise<TransactionState | null>
      }

      const txId = await manager.beginTransaction()
      await manager.append('INSERT', 'things', new Uint8Array([1]), txId)
      await manager.append('INSERT', 'things', new Uint8Array([2]), txId)

      await manager.commitTransaction(txId)

      const state = await manager.getTransactionState(txId)
      expect(state).toBe('COMMITTED')
    })

    it('should rollback transaction successfully', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        rollbackTransaction(txId: string): Promise<void>
        getTransactionState(txId: string): Promise<TransactionState | null>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const txId = await manager.beginTransaction()
      const lsn1 = await manager.append('INSERT', 'things', new Uint8Array([1]), txId)
      const lsn2 = await manager.append('INSERT', 'things', new Uint8Array([2]), txId)

      await manager.rollbackTransaction(txId)

      const state = await manager.getTransactionState(txId)
      expect(state).toBe('ROLLED_BACK')

      // Entries should be marked for rollback
      const entry1 = await manager.getEntry(lsn1)
      const entry2 = await manager.getEntry(lsn2)
      // Entries might be deleted or marked as rolled back
      expect(entry1).toBeNull()
      expect(entry2).toBeNull()
    })

    it('should throw on commit of non-existent transaction', async () => {
      const manager = null as unknown as {
        commitTransaction(txId: string): Promise<void>
      }

      await expect(manager.commitTransaction('non-existent-tx'))
        .rejects.toThrow(/transaction.*not found/i)
    })

    it('should throw on commit of already committed transaction', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        commitTransaction(txId: string): Promise<void>
      }

      const txId = await manager.beginTransaction()
      await manager.commitTransaction(txId)

      await expect(manager.commitTransaction(txId))
        .rejects.toThrow(/transaction.*not active|already committed/i)
    })

    it('should abort transaction on timeout', async () => {
      const config: WALConfig = { transactionTimeoutMs: 5000 }
      const manager = null as unknown as {
        configure(config: WALConfig): void
        beginTransaction(): Promise<string>
        getTransactionState(txId: string): Promise<TransactionState | null>
      }

      manager.configure(config)

      const txId = await manager.beginTransaction()

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(6000)

      const state = await manager.getTransactionState(txId)
      expect(state).toBe('ABORTED')
    })
  })

  // ==========================================================================
  // SAVEPOINTS
  // ==========================================================================

  describe('Savepoints', () => {
    it('should create savepoint within transaction', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        createSavepoint(txId: string, name: string): Promise<Savepoint>
      }

      const txId = await manager.beginTransaction()
      await manager.append('INSERT', 'things', new Uint8Array([1]), txId)

      const savepoint = await manager.createSavepoint(txId, 'sp1')

      expect(savepoint.name).toBe('sp1')
      expect(savepoint.lsn).toBeGreaterThan(0)
    })

    it('should rollback to savepoint', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        createSavepoint(txId: string, name: string): Promise<Savepoint>
        rollbackToSavepoint(txId: string, name: string): Promise<void>
        getTransactionOperations(txId: string): Promise<number[]>
      }

      const txId = await manager.beginTransaction()
      await manager.append('INSERT', 'things', new Uint8Array([1]), txId)
      await manager.createSavepoint(txId, 'sp1')
      await manager.append('INSERT', 'things', new Uint8Array([2]), txId)
      await manager.append('INSERT', 'things', new Uint8Array([3]), txId)

      await manager.rollbackToSavepoint(txId, 'sp1')

      // Should have only 1 operation (before savepoint)
      const ops = await manager.getTransactionOperations(txId)
      expect(ops.length).toBe(1)
    })

    it('should release savepoint', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        createSavepoint(txId: string, name: string): Promise<Savepoint>
        releaseSavepoint(txId: string, name: string): Promise<void>
        getSavepoints(txId: string): Promise<Savepoint[]>
      }

      const txId = await manager.beginTransaction()
      await manager.createSavepoint(txId, 'sp1')
      await manager.createSavepoint(txId, 'sp2')

      await manager.releaseSavepoint(txId, 'sp1')

      const savepoints = await manager.getSavepoints(txId)
      expect(savepoints.length).toBe(1)
      expect(savepoints[0].name).toBe('sp2')
    })

    it('should throw on rollback to non-existent savepoint', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        rollbackToSavepoint(txId: string, name: string): Promise<void>
      }

      const txId = await manager.beginTransaction()

      await expect(manager.rollbackToSavepoint(txId, 'non-existent'))
        .rejects.toThrow(/savepoint.*not found/i)
    })
  })

  // ==========================================================================
  // CRASH RECOVERY
  // ==========================================================================

  describe('Crash Recovery', () => {
    it('should recover unflushed entries after crash', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        recover(): Promise<WALRecoveryResult>
      }

      // Simulate crash by adding entries without flush
      await manager.append('INSERT', 'things', new Uint8Array([1]))
      await manager.append('INSERT', 'things', new Uint8Array([2]))
      await manager.append('INSERT', 'things', new Uint8Array([3]))

      // Simulate restart and recovery
      const result = await manager.recover()

      expect(result.entriesRecovered).toBe(3)
      expect(result.complete).toBe(true)
    })

    it('should replay entries in LSN order', async () => {
      const replayOrder: number[] = []
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        recover(options?: { onReplay?: (entry: WALEntry) => void }): Promise<WALRecoveryResult>
      }

      await manager.append('INSERT', 'things', new Uint8Array([1]))
      await manager.append('INSERT', 'things', new Uint8Array([2]))
      await manager.append('INSERT', 'things', new Uint8Array([3]))

      await manager.recover({
        onReplay: (entry) => replayOrder.push(entry.lsn)
      })

      expect(replayOrder).toEqual([1, 2, 3])
    })

    it('should rollback incomplete transactions during recovery', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        recover(): Promise<WALRecoveryResult>
      }

      // Start transaction but don't commit
      const txId = await manager.beginTransaction()
      await manager.append('INSERT', 'things', new Uint8Array([1]), txId)
      await manager.append('INSERT', 'things', new Uint8Array([2]), txId)
      // No commit - simulates crash

      const result = await manager.recover()

      expect(result.transactionsRolledBack).toBe(1)
    })

    it('should preserve committed transactions during recovery', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        commitTransaction(txId: string): Promise<void>
        recover(): Promise<WALRecoveryResult>
      }

      const txId = await manager.beginTransaction()
      await manager.append('INSERT', 'things', new Uint8Array([1]), txId)
      await manager.commitTransaction(txId)

      const result = await manager.recover()

      expect(result.transactionsRecovered).toBe(1)
      expect(result.transactionsRolledBack).toBe(0)
    })

    it('should verify checksums during recovery', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        corruptEntry(lsn: number): Promise<void>
        recover(): Promise<WALRecoveryResult>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1]))

      // Corrupt the entry
      await manager.corruptEntry(lsn)

      const result = await manager.recover()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].lsn).toBe(lsn)
    })

    it('should skip corrupt entries in recovery', async () => {
      const config: WALConfig = { verifyChecksums: true }
      const manager = null as unknown as {
        configure(config: WALConfig): void
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        corruptEntry(lsn: number): Promise<void>
        recover(): Promise<WALRecoveryResult>
      }

      manager.configure(config)

      await manager.append('INSERT', 'things', new Uint8Array([1]))
      const corruptLsn = await manager.append('INSERT', 'things', new Uint8Array([2]))
      await manager.append('INSERT', 'things', new Uint8Array([3]))

      await manager.corruptEntry(corruptLsn)

      const result = await manager.recover()

      // Should recover 2 of 3 entries
      expect(result.entriesRecovered).toBe(2)
      expect(result.errors.length).toBe(1)
      expect(result.errors[0].action).toBe('skip')
    })

    it('should report recovery duration', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        recover(): Promise<WALRecoveryResult>
      }

      for (let i = 0; i < 10; i++) {
        await manager.append('INSERT', 'things', new Uint8Array([i]))
      }

      const result = await manager.recover()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should handle empty WAL', async () => {
      const manager = null as unknown as {
        recover(): Promise<WALRecoveryResult>
      }

      const result = await manager.recover()

      expect(result.entriesRecovered).toBe(0)
      expect(result.complete).toBe(true)
    })
  })

  // ==========================================================================
  // WAL TRUNCATION
  // ==========================================================================

  describe('WAL Truncation', () => {
    it('should truncate entries before checkpoint', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        flush(): Promise<number>
        truncateBefore(lsn: number): Promise<number>
        getEntryCount(): Promise<number>
      }

      for (let i = 0; i < 10; i++) {
        await manager.append('INSERT', 'things', new Uint8Array([i]))
      }
      await manager.flush()

      const truncated = await manager.truncateBefore(6)

      expect(truncated).toBe(5) // LSNs 1-5
      expect(await manager.getEntryCount()).toBe(5) // LSNs 6-10
    })

    it('should only truncate flushed entries', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        flush(): Promise<number>
        truncateBefore(lsn: number): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn1 = await manager.append('INSERT', 'things', new Uint8Array([1]))
      await manager.flush()
      const lsn2 = await manager.append('INSERT', 'things', new Uint8Array([2])) // unflushed

      await manager.truncateBefore(lsn2 + 1)

      // Flushed entry should be truncated
      expect(await manager.getEntry(lsn1)).toBeNull()
      // Unflushed entry should remain
      expect(await manager.getEntry(lsn2)).not.toBeNull()
    })

    it('should update WAL position after truncation', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        flush(): Promise<number>
        truncateBefore(lsn: number): Promise<number>
        getFirstLsn(): Promise<number>
      }

      for (let i = 0; i < 10; i++) {
        await manager.append('INSERT', 'things', new Uint8Array([i]))
      }
      await manager.flush()

      await manager.truncateBefore(6)

      expect(await manager.getFirstLsn()).toBe(6)
    })
  })

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  describe('Batch Operations', () => {
    it('should append batch of entries atomically', async () => {
      const manager = null as unknown as {
        appendBatch(entries: Array<{ operation: WALOperationType; table: string; payload: Uint8Array }>): Promise<number[]>
        getEntryCount(): Promise<number>
      }

      const entries = [
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([1]) },
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([2]) },
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([3]) },
      ]

      const lsns = await manager.appendBatch(entries)

      expect(lsns.length).toBe(3)
      expect(await manager.getEntryCount()).toBe(3)
    })

    it('should assign consecutive LSNs to batch entries', async () => {
      const manager = null as unknown as {
        appendBatch(entries: Array<{ operation: WALOperationType; table: string; payload: Uint8Array }>): Promise<number[]>
      }

      const entries = [
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([1]) },
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([2]) },
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([3]) },
      ]

      const lsns = await manager.appendBatch(entries)

      expect(lsns[1] - lsns[0]).toBe(1)
      expect(lsns[2] - lsns[1]).toBe(1)
    })

    it('should rollback entire batch on failure', async () => {
      const manager = null as unknown as {
        appendBatch(entries: Array<{ operation: WALOperationType; table: string; payload: Uint8Array }>): Promise<number[]>
        getEntryCount(): Promise<number>
        simulateFailure(): void
      }

      const entries = [
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([1]) },
        { operation: 'INSERT' as WALOperationType, table: 'things', payload: new Uint8Array([2]) },
      ]

      manager.simulateFailure() // Fail during batch

      await expect(manager.appendBatch(entries)).rejects.toThrow()

      // No entries should be written
      expect(await manager.getEntryCount()).toBe(0)
    })
  })

  // ==========================================================================
  // SIZE AND ENTRY LIMITS
  // ==========================================================================

  describe('Size and Entry Limits', () => {
    it('should track WAL size in bytes', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getWalSize(): Promise<number>
      }

      const payload = new Uint8Array(1000) // 1KB
      await manager.append('INSERT', 'things', payload)

      const size = await manager.getWalSize()

      expect(size).toBeGreaterThanOrEqual(1000)
    })

    it('should trigger callback when size limit exceeded', async () => {
      const config: WALConfig = { maxSizeBytes: 5000 }
      let limitExceeded = false

      const manager = null as unknown as {
        configure(config: WALConfig): void
        onSizeLimitExceeded(callback: () => void): void
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
      }

      manager.configure(config)
      manager.onSizeLimitExceeded(() => { limitExceeded = true })

      // Add entries until limit exceeded
      const payload = new Uint8Array(2000)
      await manager.append('INSERT', 'things', payload)
      await manager.append('INSERT', 'things', payload)
      await manager.append('INSERT', 'things', payload)

      expect(limitExceeded).toBe(true)
    })

    it('should trigger callback when entry count exceeded', async () => {
      const config: WALConfig = { maxEntries: 5 }
      let limitExceeded = false

      const manager = null as unknown as {
        configure(config: WALConfig): void
        onEntryLimitExceeded(callback: () => void): void
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
      }

      manager.configure(config)
      manager.onEntryLimitExceeded(() => { limitExceeded = true })

      for (let i = 0; i < 6; i++) {
        await manager.append('INSERT', 'things', new Uint8Array([i]))
      }

      expect(limitExceeded).toBe(true)
    })
  })

  // ==========================================================================
  // CHECKSUM VERIFICATION
  // ==========================================================================

  describe('Checksum Verification', () => {
    it('should verify entry checksum', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
        verifyChecksum(entry: WALEntry): boolean
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1, 2, 3, 4, 5]))

      const entry = await manager.getEntry(lsn)

      expect(manager.verifyChecksum(entry!)).toBe(true)
    })

    it('should detect corrupted entry', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
        verifyChecksum(entry: WALEntry): boolean
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1, 2, 3, 4, 5]))

      const entry = await manager.getEntry(lsn)

      // Corrupt the payload
      entry!.payload[0] = 255

      expect(manager.verifyChecksum(entry!)).toBe(false)
    })

    it('should use SHA-256 for checksum', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntry(lsn: number): Promise<WALEntry | null>
      }

      const lsn = await manager.append('INSERT', 'things', new Uint8Array([1, 2, 3]))

      const entry = await manager.getEntry(lsn)

      // SHA-256 produces 64 hex characters
      expect(entry?.checksum.length).toBe(64)
    })
  })

  // ==========================================================================
  // CONCURRENT ACCESS
  // ==========================================================================

  describe('Concurrent Access', () => {
    it('should handle concurrent appends', async () => {
      const manager = null as unknown as {
        append(operation: WALOperationType, table: string, payload: Uint8Array): Promise<number>
        getEntryCount(): Promise<number>
      }

      const promises = Array.from({ length: 10 }, (_, i) =>
        manager.append('INSERT', 'things', new Uint8Array([i]))
      )

      const lsns = await Promise.all(promises)

      // All should have unique LSNs
      const uniqueLsns = new Set(lsns)
      expect(uniqueLsns.size).toBe(10)
      expect(await manager.getEntryCount()).toBe(10)
    })

    it('should serialize transaction commits', async () => {
      const manager = null as unknown as {
        beginTransaction(): Promise<string>
        append(operation: WALOperationType, table: string, payload: Uint8Array, txId?: string): Promise<number>
        commitTransaction(txId: string): Promise<void>
        getTransactionState(txId: string): Promise<TransactionState | null>
      }

      const tx1 = await manager.beginTransaction()
      const tx2 = await manager.beginTransaction()

      await manager.append('INSERT', 'things', new Uint8Array([1]), tx1)
      await manager.append('INSERT', 'things', new Uint8Array([2]), tx2)

      // Commit both concurrently
      await Promise.all([
        manager.commitTransaction(tx1),
        manager.commitTransaction(tx2),
      ])

      expect(await manager.getTransactionState(tx1)).toBe('COMMITTED')
      expect(await manager.getTransactionState(tx2)).toBe('COMMITTED')
    })
  })
})
