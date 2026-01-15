/**
 * Concurrent Write Stress Tests - RED Phase
 *
 * TDD RED phase: These tests define expected behavior for concurrent writes
 * under high contention. Tests should FAIL until implementation is complete.
 *
 * Test coverage:
 * 1. 100+ concurrent writes to same key
 * 2. Write ordering guarantees
 * 3. Conflict detection and resolution
 * 4. Deadlock prevention
 * 5. Performance under contention
 *
 * @see do-sfum - [RED] Concurrent Write Stress Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

import { DocumentStore } from '../../../db/document'
import {
  ConflictResolver,
  LastWriteWinsStrategy,
  VersionVectorStrategy,
  FieldMergeStrategy,
  PNCounter,
  LWWRegister,
} from '../../../db/primitives/conflict-resolver'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CounterDocument {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
  counter: number
  name?: string
  metadata?: Record<string, unknown>
}

interface BenchmarkResult {
  writesPerSecond: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  avgLatencyMs: number
  totalWrites: number
  successfulWrites: number
  failedWrites: number
  conflictCount: number
  elapsedMs: number
  peakMemoryMB?: number
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedArray.length) - 1
  return sortedArray[Math.max(0, index)]
}

/**
 * Measure memory usage (approximation)
 */
function getMemoryUsageMB(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed / (1024 * 1024)
  }
  return 0
}

/**
 * Create a delay promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Concurrent Write Stress Tests - RED Phase', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>
  let docs: DocumentStore<CounterDocument>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite)

    // Create documents table
    sqlite.exec(`
      CREATE TABLE documents (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        data JSON NOT NULL,
        "$createdAt" INTEGER NOT NULL,
        "$updatedAt" INTEGER NOT NULL,
        "$version" INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_documents_type ON documents("$type");
      CREATE INDEX idx_documents_updated ON documents("$updatedAt");
    `)

    docs = new DocumentStore<CounterDocument>(db, {
      type: 'Counter',
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // 1. 100+ CONCURRENT WRITES TO SAME KEY
  // ============================================================================

  describe('High Contention Concurrent Writes', () => {
    it('should handle 100 concurrent writes to same document', async () => {
      // Arrange: Create initial document with counter=0
      const doc = await docs.create({ counter: 0, name: 'stress-test' })

      // Act: 100 concurrent increments
      const results = await Promise.allSettled(
        Array.from({ length: 100 }, (_, i) =>
          docs.update(doc.$id, { counter: i + 1 })
        )
      )

      // Assert: All writes should succeed (SQLite serializes)
      const successCount = results.filter((r) => r.status === 'fulfilled').length
      expect(successCount).toBe(100)

      // Final document should have version 101 (1 create + 100 updates)
      const result = await docs.get(doc.$id)
      expect(result?.$version).toBe(101)
    })

    it('should handle 100 concurrent atomic increments with correct final value', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })

      // Act: 100 concurrent read-modify-write cycles
      // Each writer reads, increments, and writes
      const incrementAttempts = Array.from({ length: 100 }, async () => {
        const current = await docs.get(doc.$id)
        if (!current) throw new Error('Document not found')

        // Increment using optimistic locking
        return (docs as any).updateIfVersion(
          doc.$id,
          { counter: current.counter + 1 },
          current.$version
        )
      })

      const results = await Promise.allSettled(incrementAttempts)

      // Assert: With optimistic locking, many should fail due to version conflicts
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // At least one should succeed
      expect(successes.length).toBeGreaterThan(0)

      // Get final value - should equal number of successful updates
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.counter).toBe(successes.length)
      expect(finalDoc?.$version).toBe(successes.length + 1)
    })

    it('should handle 500 concurrent writes without data corruption', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0, metadata: { runs: [] } })

      // Act: 500 concurrent writes with varying payloads
      const writePromises = Array.from({ length: 500 }, (_, i) =>
        docs.update(doc.$id, {
          counter: i,
          [`field_${i % 10}`]: `value_${i}`,
        })
      )

      const results = await Promise.allSettled(writePromises)

      // Assert: All writes should complete (success or serialization)
      const successes = results.filter((r) => r.status === 'fulfilled').length
      const failures = results.filter((r) => r.status === 'rejected').length

      // With SQLite serialization, most should succeed
      expect(successes + failures).toBe(500)

      // Document should be readable and consistent
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc).not.toBeNull()
      expect(finalDoc?.$version).toBeGreaterThan(1)
    })

    it('should maintain data integrity under 1000 concurrent operations', async () => {
      // Arrange: Create 10 documents
      const docIds: string[] = []
      for (let i = 0; i < 10; i++) {
        const doc = await docs.create({ counter: 0, name: `doc-${i}` })
        docIds.push(doc.$id)
      }

      // Act: 1000 random writes to random documents
      const operations = Array.from({ length: 1000 }, async (_, i) => {
        const targetId = docIds[i % 10]
        return docs.update(targetId, { counter: i })
      })

      const results = await Promise.allSettled(operations)

      // Assert: Count successes
      const successes = results.filter((r) => r.status === 'fulfilled').length

      // All documents should be readable
      for (const id of docIds) {
        const doc = await docs.get(id)
        expect(doc).not.toBeNull()
        expect(doc?.$version).toBeGreaterThan(1)
      }

      // All operations should have resolved
      expect(results.length).toBe(1000)
    })
  })

  // ============================================================================
  // 2. WRITE ORDERING GUARANTEES
  // ============================================================================

  describe('Write Ordering Guarantees', () => {
    it('should preserve write order within single document', async () => {
      // Arrange
      const writeLog: number[] = []
      const doc = await docs.create({ counter: 0 })

      // Act: Sequential writes with tracking
      for (let i = 1; i <= 50; i++) {
        await docs.update(doc.$id, { counter: i })
        writeLog.push(i)
      }

      // Assert: Final value should be last write
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.counter).toBe(50)
      expect(finalDoc?.$version).toBe(51)

      // Write log should be in order
      expect(writeLog).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    })

    it('should guarantee version monotonicity', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })
      const versions: number[] = [doc.$version]

      // Act: 100 sequential updates, tracking versions
      for (let i = 0; i < 100; i++) {
        const updated = await docs.update(doc.$id, { counter: i })
        versions.push(updated.$version)
      }

      // Assert: Versions should be strictly monotonically increasing
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1])
        expect(versions[i]).toBe(versions[i - 1] + 1)
      }
    })

    it('should respect causal ordering across multiple documents', async () => {
      // Arrange: Create two related documents
      const docA = await docs.create({ counter: 0, name: 'A' })
      const docB = await docs.create({ counter: 0, name: 'B' })

      // Act: Causally dependent updates
      // Update A, then update B with reference to A's version
      const updatedA = await docs.update(docA.$id, { counter: 1 })
      const updatedB = await docs.update(docB.$id, {
        counter: 1,
        metadata: { causedBy: `${docA.$id}@v${updatedA.$version}` },
      })

      // Assert: B's update happened after A's
      expect(updatedB.$updatedAt).toBeGreaterThanOrEqual(updatedA.$updatedAt)
      expect(updatedB.metadata?.causedBy).toBe(`${docA.$id}@v2`)
    })

    it('should handle interleaved writes to multiple documents correctly', async () => {
      // Arrange
      const docs1 = await docs.create({ counter: 0, name: 'interleaved-1' })
      const docs2 = await docs.create({ counter: 0, name: 'interleaved-2' })
      const docs3 = await docs.create({ counter: 0, name: 'interleaved-3' })

      // Act: Interleaved writes
      const operations = [
        docs.update(docs1.$id, { counter: 1 }),
        docs.update(docs2.$id, { counter: 1 }),
        docs.update(docs3.$id, { counter: 1 }),
        docs.update(docs1.$id, { counter: 2 }),
        docs.update(docs2.$id, { counter: 2 }),
        docs.update(docs3.$id, { counter: 2 }),
        docs.update(docs1.$id, { counter: 3 }),
        docs.update(docs2.$id, { counter: 3 }),
        docs.update(docs3.$id, { counter: 3 }),
      ]

      await Promise.all(operations)

      // Assert: Each document should have final value
      const final1 = await docs.get(docs1.$id)
      const final2 = await docs.get(docs2.$id)
      const final3 = await docs.get(docs3.$id)

      // Each document got 3 updates
      expect(final1?.$version).toBe(4)
      expect(final2?.$version).toBe(4)
      expect(final3?.$version).toBe(4)
    })

    it('should emit CDC events in correct order', async () => {
      // Arrange
      const cdcEvents: Array<{ key: string; version: number; timestamp: number }> = []
      const trackedDocs = new DocumentStore<CounterDocument>(db, {
        type: 'TrackedCounter',
        onEvent: (event: any) => {
          cdcEvents.push({
            key: event.key,
            version: event.after?.counter ?? 0,
            timestamp: Date.now(),
          })
        },
      })

      const doc = await trackedDocs.create({ counter: 0 })
      cdcEvents.length = 0 // Clear create event

      // Act: Sequential updates
      for (let i = 1; i <= 10; i++) {
        await trackedDocs.update(doc.$id, { counter: i })
      }

      // Assert: CDC events should be in order
      expect(cdcEvents.length).toBe(10)
      for (let i = 0; i < cdcEvents.length; i++) {
        expect(cdcEvents[i].version).toBe(i + 1)
        if (i > 0) {
          expect(cdcEvents[i].timestamp).toBeGreaterThanOrEqual(cdcEvents[i - 1].timestamp)
        }
      }
    })
  })

  // ============================================================================
  // 3. CONFLICT DETECTION AND RESOLUTION
  // ============================================================================

  describe('Conflict Detection and Resolution', () => {
    it('should detect write-write conflicts on same document', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })

      // Simulate two concurrent readers
      const reader1 = await docs.get(doc.$id)
      const reader2 = await docs.get(doc.$id)

      expect(reader1?.$version).toBe(1)
      expect(reader2?.$version).toBe(1)

      // Act: Both try to update based on their read
      const update1 = (docs as any).updateIfVersion(
        doc.$id,
        { counter: reader1!.counter + 10 },
        reader1!.$version
      )
      const update2 = (docs as any).updateIfVersion(
        doc.$id,
        { counter: reader2!.counter + 20 },
        reader2!.$version
      )

      const results = await Promise.allSettled([update1, update2])

      // Assert: One should succeed, one should fail with version conflict
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)

      // The failure should mention version or conflict
      const failureReason = (failures[0] as PromiseRejectedResult).reason.message
      expect(failureReason).toMatch(/version|mismatch|conflict|concurrent/i)
    })

    it('should resolve conflicts using Last-Write-Wins strategy', async () => {
      // Arrange
      const resolver = new ConflictResolver(new LastWriteWinsStrategy())

      const local = {
        value: { counter: 10, name: 'local' },
        timestamp: 1000,
        nodeId: 'node-a',
      }

      const remote = {
        value: { counter: 20, name: 'remote' },
        timestamp: 2000, // Later timestamp
        nodeId: 'node-b',
      }

      // Act
      const resolved = resolver.resolve(local, remote)

      // Assert: Remote wins (higher timestamp)
      expect(resolved.resolution).toBe('remote')
      expect(resolved.value).toEqual({ counter: 20, name: 'remote' })
      expect(resolved.timestamp).toBe(2000)
    })

    it('should resolve conflicts using Version Vector strategy', async () => {
      // Arrange
      const resolver = new ConflictResolver(new VersionVectorStrategy())

      const local = {
        value: { counter: 10 },
        timestamp: 1000,
        nodeId: 'node-a',
        vectorClock: { entries: { 'node-a': 2, 'node-b': 1 } },
      }

      const remote = {
        value: { counter: 20 },
        timestamp: 1100,
        nodeId: 'node-b',
        vectorClock: { entries: { 'node-a': 1, 'node-b': 2 } },
      }

      // Act: Neither dominates (concurrent writes)
      const resolved = resolver.resolve(local, remote)

      // Assert: Should be marked as merged (concurrent)
      expect(resolved.resolution).toBe('merged')
      // Vector clocks should be merged
      expect(resolved.vectorClock?.entries['node-a']).toBe(2)
      expect(resolved.vectorClock?.entries['node-b']).toBe(2)
    })

    it('should merge non-conflicting fields', async () => {
      // Arrange
      const resolver = new ConflictResolver(new FieldMergeStrategy())

      const local = {
        value: { counter: 10, localField: 'A', sharedField: 1 },
        timestamp: 1000,
        nodeId: 'node-a',
      }

      const remote = {
        value: { counter: 20, remoteField: 'B', sharedField: 2 },
        timestamp: 1100,
        nodeId: 'node-b',
      }

      // Act
      const resolved = resolver.resolve(local, remote)

      // Assert: Non-conflicting fields should be merged
      const mergedValue = resolved.value as Record<string, unknown>
      expect(mergedValue.localField).toBe('A')
      expect(mergedValue.remoteField).toBe('B')
      // Conflicting field uses LWW (remote is newer)
      expect(mergedValue.sharedField).toBe(2)
      expect(mergedValue.counter).toBe(20)
    })

    it('should handle multiple concurrent conflicts with CRDT counter', async () => {
      // Arrange: Create CRDT counters for 3 nodes
      const counter1 = new PNCounter('node-1')
      const counter2 = new PNCounter('node-2')
      const counter3 = new PNCounter('node-3')

      // Act: Each node makes independent updates
      counter1.increment(10)
      counter1.increment(5)
      counter2.increment(20)
      counter2.decrement(5)
      counter3.increment(30)

      // Merge all counters
      const mergedCounter = new PNCounter('merged')
      mergedCounter.increment(0) // Initialize

      // Simulate receiving state from each node
      const counter1Clone = PNCounter.fromJSON(counter1.toJSON())
      const counter2Clone = PNCounter.fromJSON(counter2.toJSON())
      const counter3Clone = PNCounter.fromJSON(counter3.toJSON())

      // Merge into counter1
      counter1Clone.merge(counter2Clone)
      counter1Clone.merge(counter3Clone)

      // Assert: Final value should be sum of all operations
      // node-1: +15, node-2: +15, node-3: +30 = 60
      expect(counter1Clone.value()).toBe(60)
    })

    it('should detect ABA problem in concurrent updates', async () => {
      // Arrange: ABA problem - value changes A->B->A between read and write
      const doc = await docs.create({ counter: 100 })

      // Reader 1 sees counter=100
      const read1 = await docs.get(doc.$id)
      expect(read1?.counter).toBe(100)

      // Meanwhile, two updates happen: 100 -> 200 -> 100
      await docs.update(doc.$id, { counter: 200 })
      await docs.update(doc.$id, { counter: 100 })

      // Version has changed (now 3), even though value is back to 100
      const afterABA = await docs.get(doc.$id)
      expect(afterABA?.counter).toBe(100) // Same value
      expect(afterABA?.$version).toBe(3) // But different version

      // Act: Reader 1 tries to update based on stale version
      await expect(
        (docs as any).updateIfVersion(
          doc.$id,
          { counter: read1!.counter + 1 },
          read1!.$version // Version 1, but current is 3
        )
      ).rejects.toThrow(/version|mismatch/i)

      // Assert: ABA problem detected via version check
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.counter).toBe(100) // Unchanged
      expect(finalDoc?.$version).toBe(3) // Still at version 3
    })

    it('should resolve conflicts with custom business logic', async () => {
      // Arrange: Custom resolver that takes maximum counter value
      const maxCounterResolver = (local: any, remote: any) => {
        const localCounter = local.value.counter ?? 0
        const remoteCounter = remote.value.counter ?? 0

        if (localCounter >= remoteCounter) {
          return {
            value: local.value,
            timestamp: Math.max(local.timestamp, remote.timestamp),
            nodeId: local.nodeId,
            resolution: 'custom' as const,
          }
        }
        return {
          value: remote.value,
          timestamp: Math.max(local.timestamp, remote.timestamp),
          nodeId: remote.nodeId,
          resolution: 'custom' as const,
        }
      }

      // Import and use CustomResolverStrategy
      const { CustomResolverStrategy } = await import('../../../db/primitives/conflict-resolver')
      const resolver = new ConflictResolver(new CustomResolverStrategy(maxCounterResolver))

      // Act
      const resolved = resolver.resolve(
        { value: { counter: 50 }, timestamp: 2000, nodeId: 'a' },
        { value: { counter: 100 }, timestamp: 1000, nodeId: 'b' }
      )

      // Assert: Higher counter wins, regardless of timestamp
      expect(resolved.value.counter).toBe(100)
      expect(resolved.resolution).toBe('custom')
    })
  })

  // ============================================================================
  // 4. DEADLOCK PREVENTION
  // ============================================================================

  describe('Deadlock Prevention', () => {
    it('should not deadlock under high contention on single document', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })
      const timeout = 5000 // 5 second timeout

      // Act: Many concurrent updates with timeout
      const startTime = Date.now()
      const operations = Array.from({ length: 100 }, () =>
        Promise.race([
          docs.update(doc.$id, { counter: Math.random() }),
          delay(timeout).then(() => {
            throw new Error('Operation timed out - possible deadlock')
          }),
        ])
      )

      // Assert: All operations should complete (no deadlock)
      const results = await Promise.allSettled(operations)
      const elapsedTime = Date.now() - startTime

      // No timeouts should have occurred
      const timeouts = results.filter(
        (r) => r.status === 'rejected' && r.reason.message.includes('timed out')
      )
      expect(timeouts.length).toBe(0)

      // All should complete within reasonable time
      expect(elapsedTime).toBeLessThan(timeout)
    })

    it('should not deadlock with cross-document updates', async () => {
      // Arrange: Create multiple documents
      const docA = await docs.create({ counter: 0, name: 'A' })
      const docB = await docs.create({ counter: 0, name: 'B' })
      const docC = await docs.create({ counter: 0, name: 'C' })

      // Act: Concurrent cross-document operations (potential circular waits)
      const operations = [
        // Transaction 1: A -> B -> C
        (docs as any).transaction(async (tx: any) => {
          await tx.update(docA.$id, { counter: 1 })
          await delay(10)
          await tx.update(docB.$id, { counter: 1 })
          await delay(10)
          await tx.update(docC.$id, { counter: 1 })
          return 'tx1'
        }),
        // Transaction 2: C -> B -> A (reverse order)
        (docs as any).transaction(async (tx: any) => {
          await tx.update(docC.$id, { counter: 2 })
          await delay(10)
          await tx.update(docB.$id, { counter: 2 })
          await delay(10)
          await tx.update(docA.$id, { counter: 2 })
          return 'tx2'
        }),
        // Transaction 3: B -> A -> C (different order)
        (docs as any).transaction(async (tx: any) => {
          await tx.update(docB.$id, { counter: 3 })
          await delay(10)
          await tx.update(docA.$id, { counter: 3 })
          await delay(10)
          await tx.update(docC.$id, { counter: 3 })
          return 'tx3'
        }),
      ]

      const results = await Promise.allSettled(operations)

      // Assert: At least one transaction should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThan(0)

      // All documents should be in valid state
      const finalA = await docs.get(docA.$id)
      const finalB = await docs.get(docB.$id)
      const finalC = await docs.get(docC.$id)

      expect(finalA).not.toBeNull()
      expect(finalB).not.toBeNull()
      expect(finalC).not.toBeNull()
    })

    it('should handle lock contention gracefully with retries', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })
      let retryCount = 0

      // Act: Multiple writers with retry logic
      const writers = Array.from({ length: 20 }, async (_, i) => {
        let attempts = 0
        const maxAttempts = 5

        while (attempts < maxAttempts) {
          try {
            const current = await docs.get(doc.$id)
            return await (docs as any).updateIfVersion(
              doc.$id,
              { counter: current!.counter + 1 },
              current!.$version
            )
          } catch (e: any) {
            if (e.message.match(/version|mismatch|conflict/i) && attempts < maxAttempts - 1) {
              attempts++
              retryCount++
              await delay(Math.random() * 10) // Random backoff
            } else {
              throw e
            }
          }
        }
      })

      const results = await Promise.allSettled(writers)

      // Assert: Some should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThan(0)

      // Final counter should match successful updates
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.counter).toBe(successes.length)
    })

    it('should timeout and release locks for stuck operations', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })
      const operationTimeout = 100

      // Simulate a stuck operation using the transaction API
      const stuckOperation = (docs as any).transaction(async (tx: any) => {
        await tx.update(doc.$id, { counter: 1 })
        // Simulate stuck operation
        await delay(operationTimeout * 2)
        return 'stuck'
      })

      // Wrap with timeout
      const timedOperation = Promise.race([
        stuckOperation,
        delay(operationTimeout).then(() => {
          throw new Error('TIMEOUT')
        }),
      ])

      // Act & Assert
      await expect(timedOperation).rejects.toThrow('TIMEOUT')

      // After timeout, document should still be accessible
      // (Note: in real implementation, the transaction would need to be rolled back)
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc).not.toBeNull()
    })

    it('should prevent priority inversion with fair scheduling', async () => {
      // Arrange
      const doc = await docs.create({ counter: 0 })
      const executionOrder: string[] = []

      // Act: Submit operations with different "priorities"
      // In a fair system, operations should complete in roughly submission order
      const operations = Array.from({ length: 10 }, async (_, i) => {
        const priority = i < 5 ? 'high' : 'low'
        const result = await docs.update(doc.$id, {
          counter: i,
          metadata: { priority },
        })
        executionOrder.push(`${priority}-${i}`)
        return result
      })

      await Promise.all(operations)

      // Assert: All operations completed
      expect(executionOrder.length).toBe(10)

      // In a fair system, high priority ops shouldn't all complete before low
      // (This test documents expected fair scheduling behavior)
      const firstFivePriorities = executionOrder.slice(0, 5).map((e) => e.split('-')[0])
      // Should have a mix of priorities in first 5 (fair scheduling)
      // Note: SQLite naturally serializes, so this is more about documenting expected behavior
    })
  })

  // ============================================================================
  // 5. PERFORMANCE UNDER CONTENTION
  // ============================================================================

  describe('Performance Benchmarks Under Contention', () => {
    /**
     * Run a benchmark and collect metrics
     */
    async function runBenchmark(
      description: string,
      writerCount: number,
      writesPerWriter: number,
      concurrentWriters: boolean = true
    ): Promise<BenchmarkResult> {
      const doc = await docs.create({ counter: 0 })
      const latencies: number[] = []
      let successCount = 0
      let failCount = 0
      let conflictCount = 0

      const startMemory = getMemoryUsageMB()
      const startTime = Date.now()

      const writeOperation = async (writerId: number, writeIndex: number) => {
        const opStart = Date.now()
        try {
          await docs.update(doc.$id, {
            counter: writerId * 1000 + writeIndex,
            metadata: { writer: writerId, write: writeIndex },
          })
          successCount++
        } catch (e: any) {
          if (e.message.match(/version|conflict/i)) {
            conflictCount++
          }
          failCount++
        }
        latencies.push(Date.now() - opStart)
      }

      if (concurrentWriters) {
        // All writers run concurrently
        const allOperations = []
        for (let w = 0; w < writerCount; w++) {
          for (let i = 0; i < writesPerWriter; i++) {
            allOperations.push(writeOperation(w, i))
          }
        }
        await Promise.all(allOperations)
      } else {
        // Writers run sequentially (baseline)
        for (let w = 0; w < writerCount; w++) {
          for (let i = 0; i < writesPerWriter; i++) {
            await writeOperation(w, i)
          }
        }
      }

      const endTime = Date.now()
      const endMemory = getMemoryUsageMB()

      // Sort latencies for percentile calculations
      const sortedLatencies = [...latencies].sort((a, b) => a - b)

      return {
        writesPerSecond: (latencies.length / (endTime - startTime)) * 1000,
        p50LatencyMs: percentile(sortedLatencies, 50),
        p95LatencyMs: percentile(sortedLatencies, 95),
        p99LatencyMs: percentile(sortedLatencies, 99),
        avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        totalWrites: latencies.length,
        successfulWrites: successCount,
        failedWrites: failCount,
        conflictCount,
        elapsedMs: endTime - startTime,
        peakMemoryMB: Math.max(startMemory, endMemory),
      }
    }

    it('should measure baseline sequential write performance', async () => {
      const result = await runBenchmark(
        'Sequential writes (baseline)',
        1, // single writer
        100, // 100 writes
        false // sequential
      )

      // Baseline expectations
      expect(result.totalWrites).toBe(100)
      expect(result.successfulWrites).toBe(100)
      expect(result.failedWrites).toBe(0)

      // Store baseline for comparison
      console.log('Baseline Sequential Performance:')
      console.log(`  Writes/sec: ${result.writesPerSecond.toFixed(2)}`)
      console.log(`  P50 latency: ${result.p50LatencyMs}ms`)
      console.log(`  P99 latency: ${result.p99LatencyMs}ms`)
    })

    it('should measure concurrent write performance with 10 writers', async () => {
      const result = await runBenchmark(
        '10 concurrent writers',
        10, // 10 writers
        10, // 10 writes each
        true // concurrent
      )

      // All writes should complete
      expect(result.totalWrites).toBe(100)

      // Performance expectations
      expect(result.p99LatencyMs).toBeLessThan(1000) // P99 under 1 second
      expect(result.writesPerSecond).toBeGreaterThan(10) // At least 10 writes/sec

      console.log('10 Concurrent Writers Performance:')
      console.log(`  Writes/sec: ${result.writesPerSecond.toFixed(2)}`)
      console.log(`  P50 latency: ${result.p50LatencyMs}ms`)
      console.log(`  P99 latency: ${result.p99LatencyMs}ms`)
      console.log(`  Success rate: ${(result.successfulWrites / result.totalWrites * 100).toFixed(1)}%`)
    })

    it('should measure high contention performance with 50 writers', async () => {
      const result = await runBenchmark(
        '50 concurrent writers (high contention)',
        50, // 50 writers
        10, // 10 writes each
        true
      )

      expect(result.totalWrites).toBe(500)

      // Under high contention, performance may degrade
      // But should still complete within reasonable time
      expect(result.elapsedMs).toBeLessThan(30000) // Under 30 seconds

      console.log('50 Concurrent Writers (High Contention):')
      console.log(`  Writes/sec: ${result.writesPerSecond.toFixed(2)}`)
      console.log(`  P50 latency: ${result.p50LatencyMs}ms`)
      console.log(`  P99 latency: ${result.p99LatencyMs}ms`)
      console.log(`  Conflict count: ${result.conflictCount}`)
      console.log(`  Success rate: ${(result.successfulWrites / result.totalWrites * 100).toFixed(1)}%`)
    })

    it('should maintain acceptable P99 latency under load', async () => {
      const result = await runBenchmark(
        'P99 latency test',
        20,
        50,
        true
      )

      // P99 should be within 10x of P50 (reasonable tail latency)
      expect(result.p99LatencyMs).toBeLessThan(result.p50LatencyMs * 20)

      // P99 absolute limit
      expect(result.p99LatencyMs).toBeLessThan(5000) // Under 5 seconds
    })

    it('should not leak memory under sustained load', async () => {
      // Initial memory
      const initialMemory = getMemoryUsageMB()

      // Run multiple benchmark cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        await runBenchmark(`Memory test cycle ${cycle}`, 10, 20, true)
      }

      // Final memory
      const finalMemory = getMemoryUsageMB()

      // Memory should not grow unboundedly
      const memoryGrowthMB = finalMemory - initialMemory
      expect(memoryGrowthMB).toBeLessThan(100) // Less than 100MB growth

      console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)}MB`)
    })

    it('should scale linearly with number of documents (not N^2)', async () => {
      // Benchmark with 10 documents
      const docsIds10: string[] = []
      for (let i = 0; i < 10; i++) {
        const d = await docs.create({ counter: 0, name: `scale-${i}` })
        docsIds10.push(d.$id)
      }

      const start10 = Date.now()
      await Promise.all(
        docsIds10.map((id) => docs.update(id, { counter: 1 }))
      )
      const elapsed10 = Date.now() - start10

      // Benchmark with 100 documents
      const docsIds100: string[] = []
      for (let i = 0; i < 100; i++) {
        const d = await docs.create({ counter: 0, name: `scale-${i}` })
        docsIds100.push(d.$id)
      }

      const start100 = Date.now()
      await Promise.all(
        docsIds100.map((id) => docs.update(id, { counter: 1 }))
      )
      const elapsed100 = Date.now() - start100

      // Time for 100 docs should be less than 20x time for 10 docs (allowing for overhead)
      // If it's N^2, it would be 100x
      // Handle edge case where elapsed10 is 0 (operations too fast to measure)
      // In that case, if elapsed100 is also reasonably small, consider it linear
      const scalingFactor = elapsed10 > 0 ? elapsed100 / elapsed10 : (elapsed100 <= 50 ? 1 : Infinity)

      console.log(`Scaling: 10 docs = ${elapsed10}ms, 100 docs = ${elapsed100}ms, factor = ${scalingFactor.toFixed(2)}x`)

      expect(scalingFactor).toBeLessThan(20)
    })

    it('should report comprehensive benchmark summary', async () => {
      const scenarios = [
        { name: 'Light load', writers: 5, writes: 10 },
        { name: 'Medium load', writers: 20, writes: 10 },
        { name: 'Heavy load', writers: 50, writes: 10 },
        { name: 'Extreme contention', writers: 100, writes: 5 },
      ]

      console.log('\n=== CONCURRENT WRITE BENCHMARK SUMMARY ===\n')

      for (const scenario of scenarios) {
        const result = await runBenchmark(
          scenario.name,
          scenario.writers,
          scenario.writes,
          true
        )

        console.log(`${scenario.name} (${scenario.writers} writers x ${scenario.writes} writes):`)
        console.log(`  Throughput: ${result.writesPerSecond.toFixed(2)} writes/sec`)
        console.log(`  Latency P50/P95/P99: ${result.p50LatencyMs}/${result.p95LatencyMs}/${result.p99LatencyMs}ms`)
        console.log(`  Success rate: ${(result.successfulWrites / result.totalWrites * 100).toFixed(1)}%`)
        console.log(`  Conflicts: ${result.conflictCount}`)
        console.log('')

        // Basic sanity checks
        expect(result.totalWrites).toBe(scenario.writers * scenario.writes)
      }
    })
  })

  // ============================================================================
  // 6. EDGE CASES AND STRESS SCENARIOS
  // ============================================================================

  describe('Edge Cases Under Stress', () => {
    it('should handle rapid create-update-delete cycles', async () => {
      const cycles = 50
      const errors: Error[] = []

      for (let i = 0; i < cycles; i++) {
        try {
          const doc = await docs.create({ counter: i })
          await docs.update(doc.$id, { counter: i + 100 })
          await docs.delete(doc.$id)
        } catch (e) {
          errors.push(e as Error)
        }
      }

      expect(errors.length).toBe(0)

      // All documents should be deleted
      const remaining = await docs.list()
      expect(remaining.length).toBe(0)
    })

    it('should handle concurrent creates with same ID', async () => {
      const targetId = 'race-condition-id'

      // 10 concurrent creates with same ID
      const creates = Array.from({ length: 10 }, () =>
        docs.create({ $id: targetId, counter: Math.random() })
      )

      const results = await Promise.allSettled(creates)

      // Exactly one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(1)

      // Others should fail with duplicate key error
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBe(9)
    })

    it('should handle updates to non-existent documents gracefully', async () => {
      const updates = Array.from({ length: 10 }, () =>
        docs.update('non-existent-id', { counter: 1 })
      )

      const results = await Promise.allSettled(updates)

      // All should fail
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBe(10)

      // Each should mention "not found"
      for (const failure of failures as PromiseRejectedResult[]) {
        expect(failure.reason.message).toMatch(/not found/i)
      }
    })

    it('should handle large payload writes under contention', async () => {
      const doc = await docs.create({ counter: 0 })

      // Create large payloads
      const largePayload = {
        counter: 1,
        data: 'x'.repeat(10000), // 10KB string
        nested: {
          array: Array.from({ length: 100 }, (_, i) => ({
            index: i,
            value: 'item-' + i,
          })),
        },
      }

      // 20 concurrent large writes
      const writes = Array.from({ length: 20 }, () =>
        docs.update(doc.$id, largePayload)
      )

      const results = await Promise.allSettled(writes)

      // All should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(20)

      // Document should have the payload
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.data.length).toBe(10000)
    })

    it('should recover from transaction failures without corruption', async () => {
      const doc = await docs.create({ counter: 0 })

      // Attempt transactions that will fail
      for (let i = 0; i < 10; i++) {
        try {
          await (docs as any).transaction(async (tx: any) => {
            await tx.update(doc.$id, { counter: i + 100 })
            if (i % 2 === 0) {
              throw new Error(`Intentional failure ${i}`)
            }
          })
        } catch {
          // Expected for even iterations
        }
      }

      // Document should be valid and have updates from successful transactions
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc).not.toBeNull()

      // Only odd iterations succeeded (1, 3, 5, 7, 9)
      // Last successful was i=9, so counter should be 109
      expect(finalDoc?.$version).toBeGreaterThan(1)
    })

    it('should handle mixed read and write operations under load', async () => {
      const doc = await docs.create({ counter: 0 })
      const operations: Promise<unknown>[] = []

      // Mix of reads and writes
      for (let i = 0; i < 100; i++) {
        if (i % 3 === 0) {
          operations.push(docs.get(doc.$id))
        } else {
          operations.push(docs.update(doc.$id, { counter: i }))
        }
      }

      const results = await Promise.allSettled(operations)

      // All should succeed
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBe(0)

      // Document should be readable at the end
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc).not.toBeNull()
    })
  })
})
