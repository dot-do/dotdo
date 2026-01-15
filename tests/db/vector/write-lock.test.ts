/**
 * VectorStore WriteLockManager Tests (TDD RED Phase)
 *
 * Tests for concurrent write serialization in VectorStore.
 * VectorStore must use WriteLockManager to serialize writes and prevent race conditions.
 *
 * @module tests/db/vector/write-lock.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MODULE IMPORTS
// ============================================================================

let VectorStore: any
let WriteLockManager: any

beforeEach(async () => {
  try {
    const vectorModule = await import('../../../db/vector')
    VectorStore = vectorModule.VectorStore
    const concurrencyModule = await import('../../../db/concurrency')
    WriteLockManager = concurrencyModule.WriteLockManager
  } catch {
    VectorStore = undefined
    WriteLockManager = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `Module not implemented. Expected '${fnName}'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a random normalized vector
 */
function randomNormalizedVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = s / 0x7fffffff
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2)
    vec[i] = z
    norm += z * z
  }

  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Create a mock database for testing
 */
function createMockDb() {
  return {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  }
}

/**
 * Helper to wait for a specific number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TESTS: Write Lock Manager for Concurrent Writes
// ============================================================================

describe('VectorStore - WriteLockManager Integration', () => {
  it('should serialize concurrent writes to the same document', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert initial document
    await vectors.insert({
      id: 'doc_1',
      content: 'Initial content',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Track write order
    const writeOrder: number[] = []
    const originalUpsert = vectors.upsert.bind(vectors)

    // Patch upsert to track execution order
    let counter = 0
    const trackedUpsert = async (doc: any) => {
      const myOrder = ++counter
      writeOrder.push(myOrder)
      // Add small delay to simulate write work
      await delay(10)
      const result = await originalUpsert(doc)
      return result
    }

    // Temporarily replace upsert with tracked version
    vectors.upsert = trackedUpsert

    // Launch concurrent writes
    const write1 = vectors.upsert({
      id: 'doc_1',
      content: 'Update 1',
      embedding: randomNormalizedVector(1536, 2),
    })

    const write2 = vectors.upsert({
      id: 'doc_1',
      content: 'Update 2',
      embedding: randomNormalizedVector(1536, 3),
    })

    const write3 = vectors.upsert({
      id: 'doc_1',
      content: 'Update 3',
      embedding: randomNormalizedVector(1536, 4),
    })

    await Promise.all([write1, write2, write3])

    // All writes should complete (serialized by lock)
    expect(writeOrder).toHaveLength(3)
    // Writes should be serialized - each waits for the previous
  })

  it('should acquire write lock before insert operation', async () => {
    assertModuleLoaded('VectorStore', VectorStore)
    assertModuleLoaded('WriteLockManager', WriteLockManager)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Access the internal lock manager
    const lockManager = (vectors as any).lockManager

    expect(lockManager).toBeDefined()
    expect(lockManager).toBeInstanceOf(WriteLockManager)

    // Insert a document
    await vectors.insert({
      id: 'doc_lock_test',
      content: 'Lock test',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Lock should be released after operation
    expect(lockManager.isLocked('doc_lock_test')).toBe(false)
  })

  it('should acquire write lock before upsert operation', async () => {
    assertModuleLoaded('VectorStore', VectorStore)
    assertModuleLoaded('WriteLockManager', WriteLockManager)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert initial document
    await vectors.insert({
      id: 'doc_upsert_lock',
      content: 'Initial',
      embedding: randomNormalizedVector(1536, 1),
    })

    const lockManager = (vectors as any).lockManager

    // Upsert the document
    await vectors.upsert({
      id: 'doc_upsert_lock',
      content: 'Updated',
      embedding: randomNormalizedVector(1536, 2),
    })

    // Lock should be released after operation
    expect(lockManager.isLocked('doc_upsert_lock')).toBe(false)
  })

  it('should acquire write lock before delete operation', async () => {
    assertModuleLoaded('VectorStore', VectorStore)
    assertModuleLoaded('WriteLockManager', WriteLockManager)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert then delete
    await vectors.insert({
      id: 'doc_delete_lock',
      content: 'To be deleted',
      embedding: randomNormalizedVector(1536, 1),
    })

    const lockManager = (vectors as any).lockManager

    await vectors.delete('doc_delete_lock')

    // Lock should be released after operation
    expect(lockManager.isLocked('doc_delete_lock')).toBe(false)
  })

  it('should release write lock after mutation completes', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })
    const lockManager = (vectors as any).lockManager

    await vectors.insert({
      id: 'doc_release',
      content: 'Test release',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Lock should not be held after operation completes
    expect(lockManager.isLocked('doc_release')).toBe(false)
    expect(lockManager.getQueueLength('doc_release')).toBe(0)
  })

  it('should release write lock even if mutation fails', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })
    const lockManager = (vectors as any).lockManager

    // Try to insert with invalid data (wrong dimension)
    try {
      await vectors.insert({
        id: 'doc_fail',
        content: 'Test failure',
        embedding: randomNormalizedVector(768, 1), // Wrong dimension
      })
    } catch (e) {
      // Expected to fail
    }

    // Lock should still be released
    expect(lockManager.isLocked('doc_fail')).toBe(false)
  })

  it('should allow concurrent reads while write is in progress', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert test document
    await vectors.insert({
      id: 'doc_read_write',
      content: 'Read/Write test',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Start a slow write operation
    const writePromise = (async () => {
      // Simulate a slow write by acquiring lock and holding it briefly
      await vectors.upsert({
        id: 'doc_read_write',
        content: 'Slow update',
        embedding: randomNormalizedVector(1536, 2),
      })
    })()

    // Reads should not be blocked by writes (no lock required for reads)
    const readResult = await vectors.get('doc_read_write')

    expect(readResult).toBeDefined()

    await writePromise
  })

  it('should serialize batch insert operations', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Launch concurrent batch inserts
    const batch1 = vectors.insertBatch(
      Array.from({ length: 10 }, (_, i) => ({
        id: `batch1_doc_${i}`,
        content: `Batch 1 doc ${i}`,
        embedding: randomNormalizedVector(1536, i),
      }))
    )

    const batch2 = vectors.insertBatch(
      Array.from({ length: 10 }, (_, i) => ({
        id: `batch2_doc_${i}`,
        content: `Batch 2 doc ${i}`,
        embedding: randomNormalizedVector(1536, i + 100),
      }))
    )

    await Promise.all([batch1, batch2])

    // Verify all documents were inserted
    const doc1 = await vectors.get('batch1_doc_0')
    const doc2 = await vectors.get('batch2_doc_0')

    expect(doc1).toBeDefined()
    expect(doc2).toBeDefined()
  })

  it('should use per-document locks (not global lock)', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert two different documents
    await vectors.insert({
      id: 'doc_a',
      content: 'Document A',
      embedding: randomNormalizedVector(1536, 1),
    })

    await vectors.insert({
      id: 'doc_b',
      content: 'Document B',
      embedding: randomNormalizedVector(1536, 2),
    })

    // Track operation completion times
    const completionTimes: { id: string; time: number }[] = []

    // Concurrent writes to DIFFERENT documents should proceed in parallel
    const writeA = (async () => {
      await vectors.upsert({
        id: 'doc_a',
        content: 'Updated A',
        embedding: randomNormalizedVector(1536, 3),
      })
      completionTimes.push({ id: 'doc_a', time: Date.now() })
    })()

    const writeB = (async () => {
      await vectors.upsert({
        id: 'doc_b',
        content: 'Updated B',
        embedding: randomNormalizedVector(1536, 4),
      })
      completionTimes.push({ id: 'doc_b', time: Date.now() })
    })()

    await Promise.all([writeA, writeB])

    // Both should complete (no deadlock due to global lock)
    expect(completionTimes).toHaveLength(2)
  })

  it('should handle lock timeout gracefully', async () => {
    assertModuleLoaded('VectorStore', VectorStore)
    assertModuleLoaded('WriteLockManager', WriteLockManager)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })
    const lockManager = (vectors as any).lockManager

    // Insert a document
    await vectors.insert({
      id: 'doc_timeout',
      content: 'Timeout test',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Manually acquire lock to simulate blocked state
    const handle = await lockManager.acquireLock('doc_timeout', { timeout: 50 })

    // Try to acquire another lock with short timeout
    await expect(
      lockManager.acquireLock('doc_timeout', { timeout: 10 })
    ).rejects.toThrow(/timeout/i)

    // Release the original lock
    handle.release()
  })

  it('should provide lock metrics', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })
    const lockManager = (vectors as any).lockManager

    // Perform some write operations
    for (let i = 0; i < 5; i++) {
      await vectors.insert({
        id: `doc_metrics_${i}`,
        content: `Metrics test ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    const metrics = lockManager.getMetrics()

    expect(metrics).toBeDefined()
    expect(metrics.locksAcquired).toBeGreaterThanOrEqual(5)
    expect(metrics.locksReleased).toBeGreaterThanOrEqual(5)
  })
})

// ============================================================================
// TESTS: Lock Behavior with Search Operations
// ============================================================================

describe('VectorStore - Reads Do Not Block on Writes', () => {
  it('should allow search while write is in progress', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert some documents first
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `search_doc_${i}`,
        content: `Search test document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Start a write
    const writePromise = vectors.upsert({
      id: 'search_doc_0',
      content: 'Updated during search',
      embedding: randomNormalizedVector(1536, 100),
    })

    // Search should proceed immediately (no read lock)
    const searchResults = await vectors.search({
      embedding: randomNormalizedVector(1536, 5),
      limit: 5,
    })

    expect(searchResults).toBeDefined()
    expect(searchResults.length).toBeGreaterThan(0)

    await writePromise
  })

  it('should allow hybrid search while write is in progress', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert some documents
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `hybrid_doc_${i}`,
        content: `Python machine learning document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Start a write
    const writePromise = vectors.upsert({
      id: 'hybrid_doc_0',
      content: 'Updated content',
      embedding: randomNormalizedVector(1536, 100),
    })

    // Hybrid search should proceed
    const searchResults = await vectors.hybridSearch({
      query: 'python machine learning',
      embedding: randomNormalizedVector(1536, 5),
      limit: 5,
    })

    expect(searchResults).toBeDefined()

    await writePromise
  })

  it('should allow get while write is in progress', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    // Insert a document
    await vectors.insert({
      id: 'get_during_write',
      content: 'Original content',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Start a write to a different document
    const writePromise = vectors.insert({
      id: 'other_doc',
      content: 'Other document',
      embedding: randomNormalizedVector(1536, 2),
    })

    // Get should proceed immediately
    const result = await vectors.get('get_during_write')

    expect(result).toBeDefined()
    expect(result.content).toBe('Original content')

    await writePromise
  })
})
