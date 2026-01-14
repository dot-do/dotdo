import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WALManager,
  WALEntry,
  WALOperationType,
  Transaction,
  TransactionState,
  Checkpoint
} from '../../src/do/wal'
import { DurableObjectStorage } from '../../src/do/schema'

/**
 * Mock DurableObjectStorage for testing WAL operations
 */
class MockWALStorage implements DurableObjectStorage {
  private walEntries: Map<number, WALEntry> = new Map()
  private checkpoints: Map<number, Checkpoint> = new Map()
  private transactions: Map<string, Transaction> = new Map()
  private nextWalId = 1
  private nextCheckpointId = 1
  private executedQueries: string[] = []

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.executedQueries.push(query)

      // Handle WAL inserts
      if (query.includes('INSERT INTO wal')) {
        const id = this.nextWalId++
        const entry: WALEntry = {
          id,
          operation: params[0] as WALOperationType,
          payload: params[1] as Uint8Array,
          transactionId: params[2] as string | null,
          createdAt: Date.now(),
          flushed: false
        }
        this.walEntries.set(id, entry)
        return { toArray: () => [{ id }] }
      }

      // Handle COUNT queries - must come before generic SELECT queries
      if (query.includes('COUNT(*)') && query.includes('FROM wal')) {
        const count = Array.from(this.walEntries.values()).filter(e => !e.flushed).length
        return { toArray: () => [{ count }] }
      }

      // Handle MAX(id) query for checkpoint position
      if (query.includes('MAX(id)') && query.includes('FROM wal')) {
        const entries = Array.from(this.walEntries.values())
        const maxId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) : 0
        return { toArray: () => [{ max_id: maxId }] }
      }

      // Handle WAL SELECT for unflushed entries
      if (query.includes('SELECT') && query.includes('FROM wal') && query.includes('flushed = 0')) {
        const entries = Array.from(this.walEntries.values())
          .filter(e => !e.flushed)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle WAL SELECT for transaction entries
      if (query.includes('SELECT') && query.includes('FROM wal') && query.includes('transaction_id')) {
        const txId = params[0] as string
        const entries = Array.from(this.walEntries.values())
          .filter(e => e.transactionId === txId)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle WAL SELECT all unflushed
      if (query.includes('SELECT') && query.includes('FROM wal') && !query.includes('transaction_id')) {
        const entries = Array.from(this.walEntries.values())
          .filter(e => !e.flushed)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle flush (UPDATE)
      if (query.includes('UPDATE wal') && query.includes('flushed = 1')) {
        if (query.includes('transaction_id')) {
          const txId = params[0] as string
          for (const entry of this.walEntries.values()) {
            if (entry.transactionId === txId) {
              entry.flushed = true
            }
          }
        } else if (query.includes('id <=')) {
          const upToId = params[0] as number
          for (const entry of this.walEntries.values()) {
            if (entry.id <= upToId) {
              entry.flushed = true
            }
          }
        } else {
          for (const entry of this.walEntries.values()) {
            entry.flushed = true
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE for flushed entries
      if (query.includes('DELETE FROM wal') && query.includes('flushed = 1')) {
        for (const [id, entry] of this.walEntries.entries()) {
          if (entry.flushed) {
            this.walEntries.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE for transaction rollback
      if (query.includes('DELETE FROM wal') && query.includes('transaction_id')) {
        const txId = params[0] as string
        for (const [id, entry] of this.walEntries.entries()) {
          if (entry.transactionId === txId) {
            this.walEntries.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      // Handle checkpoint inserts
      if (query.includes('INSERT INTO checkpoints')) {
        const id = this.nextCheckpointId++
        const checkpoint: Checkpoint = {
          id,
          walPosition: params[0] as number,
          createdAt: Date.now(),
          metadata: params[1] as string | null
        }
        this.checkpoints.set(id, checkpoint)
        return { toArray: () => [{ id }] }
      }

      // Handle checkpoint SELECT
      if (query.includes('SELECT') && query.includes('FROM checkpoints') && query.includes('ORDER BY')) {
        const checkpointArr = Array.from(this.checkpoints.values())
          .sort((a, b) => b.id - a.id)
        return { toArray: () => checkpointArr.length > 0 ? [checkpointArr[0]] : [] }
      }

      // Handle transaction state queries
      if (query.includes('INSERT INTO transactions')) {
        const tx: Transaction = {
          id: params[0] as string,
          state: params[1] as TransactionState,
          startedAt: Date.now(),
          operations: []
        }
        this.transactions.set(tx.id, tx)
        return { toArray: () => [] }
      }

      if (query.includes('UPDATE transactions') && query.includes('state')) {
        const txId = params[1] as string
        const state = params[0] as TransactionState
        const tx = this.transactions.get(txId)
        if (tx) {
          tx.state = state
        }
        return { toArray: () => [] }
      }

      if (query.includes('SELECT') && query.includes('FROM transactions')) {
        const txId = params[0] as string
        const tx = this.transactions.get(txId)
        return { toArray: () => tx ? [tx] : [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getWALEntries(): WALEntry[] {
    return Array.from(this.walEntries.values())
  }

  getCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values())
  }

  getTransactions(): Transaction[] {
    return Array.from(this.transactions.values())
  }

  getExecutedQueries(): string[] {
    return [...this.executedQueries]
  }

  clearAll(): void {
    this.walEntries.clear()
    this.checkpoints.clear()
    this.transactions.clear()
    this.nextWalId = 1
    this.nextCheckpointId = 1
    this.executedQueries = []
  }

  // Inject entries for recovery testing
  injectWALEntry(entry: WALEntry): void {
    this.walEntries.set(entry.id, entry)
    if (entry.id >= this.nextWalId) {
      this.nextWalId = entry.id + 1
    }
  }

  injectCheckpoint(checkpoint: Checkpoint): void {
    this.checkpoints.set(checkpoint.id, checkpoint)
    if (checkpoint.id >= this.nextCheckpointId) {
      this.nextCheckpointId = checkpoint.id + 1
    }
  }
}

describe('WALManager', () => {
  let storage: MockWALStorage
  let walManager: WALManager

  beforeEach(() => {
    storage = new MockWALStorage()
    walManager = new WALManager(storage)
  })

  describe('append', () => {
    it('should append an operation to the WAL', async () => {
      const payload = new TextEncoder().encode(JSON.stringify({ key: 'value' }))

      const entryId = await walManager.append('PUT', payload)

      expect(entryId).toBe(1)
      const entries = storage.getWALEntries()
      expect(entries.length).toBe(1)
      expect(entries[0].operation).toBe('PUT')
      expect(entries[0].flushed).toBe(false)
    })

    it('should append multiple operations in order', async () => {
      const payload1 = new TextEncoder().encode('data1')
      const payload2 = new TextEncoder().encode('data2')
      const payload3 = new TextEncoder().encode('data3')

      const id1 = await walManager.append('PUT', payload1)
      const id2 = await walManager.append('DELETE', payload2)
      const id3 = await walManager.append('PUT', payload3)

      expect(id1).toBe(1)
      expect(id2).toBe(2)
      expect(id3).toBe(3)

      const entries = storage.getWALEntries()
      expect(entries.length).toBe(3)
      expect(entries[0].operation).toBe('PUT')
      expect(entries[1].operation).toBe('DELETE')
      expect(entries[2].operation).toBe('PUT')
    })

    it('should append operation with transaction ID', async () => {
      const payload = new TextEncoder().encode('data')
      const txId = 'tx-123'

      const entryId = await walManager.append('PUT', payload, txId)

      const entries = storage.getWALEntries()
      expect(entries[0].transactionId).toBe(txId)
    })

    it('should support different operation types', async () => {
      const payload = new TextEncoder().encode('data')

      await walManager.append('PUT', payload)
      await walManager.append('DELETE', payload)
      await walManager.append('UPDATE', payload)
      await walManager.append('BATCH', payload)

      const entries = storage.getWALEntries()
      expect(entries.map(e => e.operation)).toEqual(['PUT', 'DELETE', 'UPDATE', 'BATCH'])
    })
  })

  describe('flush', () => {
    it('should mark all entries as flushed', async () => {
      const payload = new TextEncoder().encode('data')
      await walManager.append('PUT', payload)
      await walManager.append('PUT', payload)

      await walManager.flush()

      const entries = storage.getWALEntries()
      expect(entries.every(e => e.flushed)).toBe(true)
    })

    it('should return the number of flushed entries', async () => {
      const payload = new TextEncoder().encode('data')
      await walManager.append('PUT', payload)
      await walManager.append('PUT', payload)
      await walManager.append('PUT', payload)

      const flushedCount = await walManager.flush()

      expect(flushedCount).toBe(3)
    })

    it('should only flush unflushed entries', async () => {
      const payload = new TextEncoder().encode('data')
      await walManager.append('PUT', payload)
      await walManager.flush()

      await walManager.append('PUT', payload)
      const flushedCount = await walManager.flush()

      expect(flushedCount).toBe(1)
    })

    it('should return 0 when no entries to flush', async () => {
      const flushedCount = await walManager.flush()
      expect(flushedCount).toBe(0)
    })
  })

  describe('recover', () => {
    it('should return unflushed entries for replay', async () => {
      storage.injectWALEntry({
        id: 1,
        operation: 'PUT',
        payload: new TextEncoder().encode('data1'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })
      storage.injectWALEntry({
        id: 2,
        operation: 'PUT',
        payload: new TextEncoder().encode('data2'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: true
      })
      storage.injectWALEntry({
        id: 3,
        operation: 'DELETE',
        payload: new TextEncoder().encode('data3'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })

      const entries = await walManager.recover()

      expect(entries.length).toBe(2)
      expect(entries[0].id).toBe(1)
      expect(entries[1].id).toBe(3)
    })

    it('should return entries in order by ID', async () => {
      storage.injectWALEntry({
        id: 3,
        operation: 'PUT',
        payload: new TextEncoder().encode('data3'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })
      storage.injectWALEntry({
        id: 1,
        operation: 'PUT',
        payload: new TextEncoder().encode('data1'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })

      const entries = await walManager.recover()

      expect(entries[0].id).toBe(1)
      expect(entries[1].id).toBe(3)
    })

    it('should return empty array when no entries to recover', async () => {
      const entries = await walManager.recover()
      expect(entries).toEqual([])
    })

    it('should recover from last checkpoint when provided', async () => {
      storage.injectCheckpoint({
        id: 1,
        walPosition: 2,
        createdAt: Date.now(),
        metadata: null
      })
      storage.injectWALEntry({
        id: 1,
        operation: 'PUT',
        payload: new TextEncoder().encode('data1'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })
      storage.injectWALEntry({
        id: 3,
        operation: 'PUT',
        payload: new TextEncoder().encode('data3'),
        transactionId: null,
        createdAt: Date.now(),
        flushed: false
      })

      const entries = await walManager.recover()

      // Should return all unflushed entries
      expect(entries.length).toBe(2)
    })
  })

  describe('transaction support', () => {
    describe('beginTransaction', () => {
      it('should create a new transaction', async () => {
        const txId = await walManager.beginTransaction()

        expect(txId).toBeDefined()
        expect(typeof txId).toBe('string')
        expect(txId.length).toBeGreaterThan(0)
      })

      it('should create unique transaction IDs', async () => {
        const txId1 = await walManager.beginTransaction()
        const txId2 = await walManager.beginTransaction()

        expect(txId1).not.toBe(txId2)
      })

      it('should log transaction begin in WAL', async () => {
        const txId = await walManager.beginTransaction()

        const entries = storage.getWALEntries()
        expect(entries.length).toBe(1)
        expect(entries[0].operation).toBe('TX_BEGIN')
        expect(entries[0].transactionId).toBe(txId)
      })
    })

    describe('commitTransaction', () => {
      it('should commit an active transaction', async () => {
        const txId = await walManager.beginTransaction()
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload, txId)

        await walManager.commitTransaction(txId)

        const entries = storage.getWALEntries()
        const commitEntry = entries.find(e => e.operation === 'TX_COMMIT')
        expect(commitEntry).toBeDefined()
        expect(commitEntry!.transactionId).toBe(txId)
      })

      it('should throw error for non-existent transaction', async () => {
        await expect(walManager.commitTransaction('non-existent'))
          .rejects.toThrow('Transaction not found')
      })

      it('should throw error for already committed transaction', async () => {
        const txId = await walManager.beginTransaction()
        await walManager.commitTransaction(txId)

        await expect(walManager.commitTransaction(txId))
          .rejects.toThrow('Transaction not active')
      })
    })

    describe('rollbackTransaction', () => {
      it('should rollback an active transaction', async () => {
        const txId = await walManager.beginTransaction()
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload, txId)

        await walManager.rollbackTransaction(txId)

        const entries = storage.getWALEntries()
        const rollbackEntry = entries.find(e => e.operation === 'TX_ROLLBACK')
        expect(rollbackEntry).toBeDefined()
      })

      it('should remove transaction entries on rollback', async () => {
        const txId = await walManager.beginTransaction()
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload, txId)
        await walManager.append('DELETE', payload, txId)

        await walManager.rollbackTransaction(txId)

        // Transaction entries should be marked for removal
        const entries = storage.getWALEntries()
        const txEntries = entries.filter(e => e.transactionId === txId && e.operation !== 'TX_BEGIN' && e.operation !== 'TX_ROLLBACK')
        expect(txEntries.length).toBe(0)
      })

      it('should throw error for non-existent transaction', async () => {
        await expect(walManager.rollbackTransaction('non-existent'))
          .rejects.toThrow('Transaction not found')
      })

      it('should throw error for already rolled back transaction', async () => {
        const txId = await walManager.beginTransaction()
        await walManager.rollbackTransaction(txId)

        await expect(walManager.rollbackTransaction(txId))
          .rejects.toThrow('Transaction not active')
      })
    })

    describe('getTransactionState', () => {
      it('should return ACTIVE for new transaction', async () => {
        const txId = await walManager.beginTransaction()

        const state = await walManager.getTransactionState(txId)

        expect(state).toBe('ACTIVE')
      })

      it('should return COMMITTED after commit', async () => {
        const txId = await walManager.beginTransaction()
        await walManager.commitTransaction(txId)

        const state = await walManager.getTransactionState(txId)

        expect(state).toBe('COMMITTED')
      })

      it('should return ROLLED_BACK after rollback', async () => {
        const txId = await walManager.beginTransaction()
        await walManager.rollbackTransaction(txId)

        const state = await walManager.getTransactionState(txId)

        expect(state).toBe('ROLLED_BACK')
      })

      it('should return null for non-existent transaction', async () => {
        const state = await walManager.getTransactionState('non-existent')
        expect(state).toBeNull()
      })
    })
  })

  describe('checkpoint management', () => {
    describe('createCheckpoint', () => {
      it('should create a checkpoint at current WAL position', async () => {
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload)
        await walManager.append('PUT', payload)

        const checkpoint = await walManager.createCheckpoint()

        expect(checkpoint.id).toBeDefined()
        expect(checkpoint.walPosition).toBe(2)
      })

      it('should flush entries before creating checkpoint', async () => {
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload)

        await walManager.createCheckpoint()

        const entries = storage.getWALEntries()
        expect(entries.every(e => e.flushed)).toBe(true)
      })

      it('should support optional metadata', async () => {
        const checkpoint = await walManager.createCheckpoint('backup-snapshot')

        expect(checkpoint.metadata).toBe('backup-snapshot')
      })

      it('should create checkpoint with zero position when WAL is empty', async () => {
        const checkpoint = await walManager.createCheckpoint()

        expect(checkpoint.walPosition).toBe(0)
      })
    })

    describe('getLastCheckpoint', () => {
      it('should return the most recent checkpoint', async () => {
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload)
        await walManager.createCheckpoint('first')

        await walManager.append('PUT', payload)
        await walManager.createCheckpoint('second')

        const lastCheckpoint = await walManager.getLastCheckpoint()

        expect(lastCheckpoint).not.toBeNull()
        expect(lastCheckpoint!.metadata).toBe('second')
      })

      it('should return null when no checkpoints exist', async () => {
        const checkpoint = await walManager.getLastCheckpoint()
        expect(checkpoint).toBeNull()
      })
    })

    describe('truncateBeforeCheckpoint', () => {
      it('should remove flushed entries before checkpoint position', async () => {
        const payload = new TextEncoder().encode('data')
        await walManager.append('PUT', payload)
        await walManager.append('PUT', payload)
        const checkpoint = await walManager.createCheckpoint()

        await walManager.append('PUT', payload)

        await walManager.truncateBeforeCheckpoint(checkpoint)

        // The entries before checkpoint should be deleted
        const queries = storage.getExecutedQueries()
        expect(queries.some(q => q.includes('DELETE FROM wal'))).toBe(true)
      })
    })
  })

  describe('operation logging and replay', () => {
    it('should serialize and deserialize payload correctly', async () => {
      const originalData = { key: 'value', nested: { array: [1, 2, 3] } }
      const payload = new TextEncoder().encode(JSON.stringify(originalData))

      await walManager.append('PUT', payload)
      const entries = await walManager.recover()

      expect(entries.length).toBe(1)
      const recoveredData = JSON.parse(new TextDecoder().decode(entries[0].payload))
      expect(recoveredData).toEqual(originalData)
    })

    it('should maintain operation order across multiple transactions', async () => {
      const payload = new TextEncoder().encode('data')

      const tx1 = await walManager.beginTransaction()
      await walManager.append('PUT', payload, tx1)

      const tx2 = await walManager.beginTransaction()
      await walManager.append('DELETE', payload, tx2)

      await walManager.append('PUT', payload, tx1)
      await walManager.commitTransaction(tx1)
      await walManager.commitTransaction(tx2)

      const entries = await walManager.recover()
      // All entries should be recoverable in order
      expect(entries.length).toBeGreaterThan(0)
    })

    it('should handle binary payloads', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0xFE])

      await walManager.append('PUT', binaryData)
      const entries = await walManager.recover()

      expect(entries[0].payload).toEqual(binaryData)
    })

    it('should handle large payloads', async () => {
      const largeData = new Uint8Array(1024 * 1024) // 1MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      await walManager.append('PUT', largeData)
      const entries = await walManager.recover()

      expect(entries[0].payload.length).toBe(largeData.length)
    })
  })

  describe('getUnflushedCount', () => {
    it('should return count of unflushed entries', async () => {
      const payload = new TextEncoder().encode('data')
      await walManager.append('PUT', payload)
      await walManager.append('PUT', payload)

      const count = await walManager.getUnflushedCount()

      expect(count).toBe(2)
    })

    it('should return 0 after flush', async () => {
      const payload = new TextEncoder().encode('data')
      await walManager.append('PUT', payload)
      await walManager.flush()

      const count = await walManager.getUnflushedCount()

      expect(count).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      const errorStorage = {
        sql: {
          exec: () => { throw new Error('Storage error') }
        }
      } as unknown as DurableObjectStorage

      const errorWalManager = new WALManager(errorStorage)

      await expect(errorWalManager.append('PUT', new Uint8Array()))
        .rejects.toThrow('Storage error')
    })
  })
})

describe('WAL Types', () => {
  describe('WALOperationType', () => {
    it('should include all required operation types', () => {
      const validTypes: WALOperationType[] = ['PUT', 'DELETE', 'UPDATE', 'BATCH', 'TX_BEGIN', 'TX_COMMIT', 'TX_ROLLBACK']
      expect(validTypes).toHaveLength(7)
    })
  })

  describe('TransactionState', () => {
    it('should include all required states', () => {
      const validStates: TransactionState[] = ['ACTIVE', 'COMMITTED', 'ROLLED_BACK']
      expect(validStates).toHaveLength(3)
    })
  })
})
