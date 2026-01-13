/**
 * BatchUpserter - TDD Test Suite
 *
 * Tests for batch upsert operations for efficient bulk sync.
 *
 * Requirements:
 * - Split records into configured batch sizes
 * - Respect parallelism limit
 * - Report progress correctly
 * - Handle partial batch failures
 * - Return aggregate results (success/failure counts)
 *
 * @module db/sync/batch-upserter.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BatchUpserter,
  type BatchUpsertOptions,
  type BatchProgress,
  type UpsertResult,
  type Destination,
  type SyncRecord,
} from './batch-upserter'

// ============================================================================
// MOCK DESTINATION
// ============================================================================

/**
 * Create a mock destination for testing
 */
function createMockDestination(options: {
  upsertDelay?: number
  failOnIds?: string[]
  failBatch?: number[]
} = {}): Destination {
  const { upsertDelay = 0, failOnIds = [], failBatch = [] } = options
  let batchCount = 0

  return {
    name: 'mock-destination',
    async upsert(records: SyncRecord[]): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }> {
      batchCount++

      if (upsertDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, upsertDelay))
      }

      // Fail entire batch if batch number is in failBatch
      if (failBatch.includes(batchCount)) {
        return {
          success: [],
          failed: records.map((r) => ({ id: r.id, error: 'Batch failed' })),
        }
      }

      const success: string[] = []
      const failed: Array<{ id: string; error: string }> = []

      for (const record of records) {
        if (failOnIds.includes(record.id)) {
          failed.push({ id: record.id, error: `Record ${record.id} failed` })
        } else {
          success.push(record.id)
        }
      }

      return { success, failed }
    },
  }
}

// ============================================================================
// BATCH SPLITTING TESTS
// ============================================================================

describe('BatchUpserter - Batch Splitting', () => {
  it('splits records into configured batch sizes', async () => {
    const destination = createMockDestination()
    const upsertSpy = vi.spyOn(destination, 'upsert')

    const upserter = new BatchUpserter()

    // Create 10 records
    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    // Batch size of 3 should result in 4 batches (3+3+3+1)
    const result = await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
    })

    expect(upsertSpy).toHaveBeenCalledTimes(4)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(3)
    expect(upsertSpy.mock.calls[1][0]).toHaveLength(3)
    expect(upsertSpy.mock.calls[2][0]).toHaveLength(3)
    expect(upsertSpy.mock.calls[3][0]).toHaveLength(1)
    expect(result.totalProcessed).toBe(10)
    expect(result.successCount).toBe(10)
  })

  it('handles empty records array', async () => {
    const destination = createMockDestination()
    const upserter = new BatchUpserter()

    const result = await upserter.upsert([], destination, {
      batchSize: 10,
      parallelism: 1,
    })

    expect(result.totalProcessed).toBe(0)
    expect(result.successCount).toBe(0)
    expect(result.failureCount).toBe(0)
    expect(result.batchCount).toBe(0)
  })

  it('handles records less than batch size', async () => {
    const destination = createMockDestination()
    const upsertSpy = vi.spyOn(destination, 'upsert')
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 10,
      parallelism: 1,
    })

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(5)
  })

  it('handles records exactly equal to batch size', async () => {
    const destination = createMockDestination()
    const upsertSpy = vi.spyOn(destination, 'upsert')
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 10,
      parallelism: 1,
    })

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(10)
  })
})

// ============================================================================
// PARALLELISM TESTS
// ============================================================================

describe('BatchUpserter - Parallelism', () => {
  it('respects parallelism limit of 1 (sequential)', async () => {
    const executionOrder: number[] = []
    let batchNum = 0

    const destination: Destination = {
      name: 'tracking-destination',
      async upsert(records: SyncRecord[]) {
        const currentBatch = ++batchNum
        executionOrder.push(currentBatch)
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { success: records.map((r) => r.id), failed: [] }
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = Array.from({ length: 9 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
    })

    // With parallelism 1, batches should complete in order
    expect(executionOrder).toEqual([1, 2, 3])
  })

  it('respects parallelism limit of 2', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const destination: Destination = {
      name: 'concurrency-tracking-destination',
      async upsert(records: SyncRecord[]) {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise((resolve) => setTimeout(resolve, 20))
        currentConcurrent--
        return { success: records.map((r) => r.id), failed: [] }
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = Array.from({ length: 12 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 2,
    })

    // With 4 batches and parallelism 2, max concurrent should be 2
    expect(maxConcurrent).toBe(2)
  })

  it('respects parallelism limit of 3', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const destination: Destination = {
      name: 'concurrency-tracking-destination',
      async upsert(records: SyncRecord[]) {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise((resolve) => setTimeout(resolve, 20))
        currentConcurrent--
        return { success: records.map((r) => r.id), failed: [] }
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = Array.from({ length: 15 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 3,
    })

    // With 5 batches and parallelism 3, max concurrent should be 3
    expect(maxConcurrent).toBe(3)
  })

  it('handles parallelism greater than batch count', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const destination: Destination = {
      name: 'concurrency-tracking-destination',
      async upsert(records: SyncRecord[]) {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise((resolve) => setTimeout(resolve, 10))
        currentConcurrent--
        return { success: records.map((r) => r.id), failed: [] }
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 10, // Higher than batch count (2 batches)
    })

    // With 2 batches and parallelism 10, max concurrent should be 2
    expect(maxConcurrent).toBe(2)
  })
})

// ============================================================================
// PROGRESS REPORTING TESTS
// ============================================================================

describe('BatchUpserter - Progress Reporting', () => {
  it('reports progress correctly', async () => {
    const destination = createMockDestination()
    const upserter = new BatchUpserter()

    const progressUpdates: BatchProgress[] = []

    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress })
      },
    })

    // Should have 4 progress updates (4 batches)
    expect(progressUpdates).toHaveLength(4)

    // Verify first progress update
    expect(progressUpdates[0].completedBatches).toBe(1)
    expect(progressUpdates[0].totalBatches).toBe(4)
    expect(progressUpdates[0].processedRecords).toBe(3)
    expect(progressUpdates[0].totalRecords).toBe(10)

    // Verify last progress update
    expect(progressUpdates[3].completedBatches).toBe(4)
    expect(progressUpdates[3].totalBatches).toBe(4)
    expect(progressUpdates[3].processedRecords).toBe(10)
    expect(progressUpdates[3].totalRecords).toBe(10)
  })

  it('reports progress with success and failure counts', async () => {
    const destination = createMockDestination({ failOnIds: ['record-1', 'record-5'] })
    const upserter = new BatchUpserter()

    const progressUpdates: BatchProgress[] = []

    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress })
      },
    })

    // Final progress should show correct success/failure counts
    const finalProgress = progressUpdates[progressUpdates.length - 1]
    expect(finalProgress.successCount).toBe(8)
    expect(finalProgress.failureCount).toBe(2)
  })

  it('progress includes percentage complete', async () => {
    const destination = createMockDestination()
    const upserter = new BatchUpserter()

    const progressUpdates: BatchProgress[] = []

    const records: SyncRecord[] = Array.from({ length: 8 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, {
      batchSize: 2,
      parallelism: 1,
      onProgress: (progress) => {
        progressUpdates.push({ ...progress })
      },
    })

    // 4 batches should give us 25%, 50%, 75%, 100%
    expect(progressUpdates[0].percentComplete).toBe(25)
    expect(progressUpdates[1].percentComplete).toBe(50)
    expect(progressUpdates[2].percentComplete).toBe(75)
    expect(progressUpdates[3].percentComplete).toBe(100)
  })
})

// ============================================================================
// PARTIAL FAILURE HANDLING TESTS
// ============================================================================

describe('BatchUpserter - Partial Batch Failures', () => {
  it('handles partial batch failures', async () => {
    const destination = createMockDestination({ failOnIds: ['record-1', 'record-3'] })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 2,
      parallelism: 1,
    })

    expect(result.successCount).toBe(3) // record-0, record-2, record-4
    expect(result.failureCount).toBe(2) // record-1, record-3
    expect(result.failures).toHaveLength(2)
    expect(result.failures.map((f) => f.id)).toContain('record-1')
    expect(result.failures.map((f) => f.id)).toContain('record-3')
  })

  it('continues processing after batch failure', async () => {
    // Fail entire second batch
    const destination = createMockDestination({ failBatch: [2] })
    const upsertSpy = vi.spyOn(destination, 'upsert')
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 9 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
    })

    // All 3 batches should be attempted
    expect(upsertSpy).toHaveBeenCalledTimes(3)
    // Batch 1 and 3 succeed (6 records), batch 2 fails (3 records)
    expect(result.successCount).toBe(6)
    expect(result.failureCount).toBe(3)
  })

  it('collects error details for failed records', async () => {
    const destination = createMockDestination({ failOnIds: ['record-2'] })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 5,
      parallelism: 1,
    })

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].id).toBe('record-2')
    expect(result.failures[0].error).toContain('record-2')
  })

  it('handles destination throwing exception', async () => {
    const destination: Destination = {
      name: 'throwing-destination',
      async upsert(_records: SyncRecord[]) {
        throw new Error('Destination unavailable')
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = [{ id: 'record-0', data: {} }]

    const result = await upserter.upsert(records, destination, {
      batchSize: 1,
      parallelism: 1,
    })

    expect(result.failureCount).toBe(1)
    expect(result.failures[0].error).toContain('Destination unavailable')
  })
})

// ============================================================================
// AGGREGATE RESULTS TESTS
// ============================================================================

describe('BatchUpserter - Aggregate Results', () => {
  it('returns aggregate results (success/failure counts)', async () => {
    const destination = createMockDestination({ failOnIds: ['record-2', 'record-7'] })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 2,
    })

    expect(result.totalProcessed).toBe(10)
    expect(result.successCount).toBe(8)
    expect(result.failureCount).toBe(2)
    expect(result.batchCount).toBe(4)
  })

  it('returns success IDs', async () => {
    const destination = createMockDestination({ failOnIds: ['record-1'] })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 3 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 10,
      parallelism: 1,
    })

    expect(result.successIds).toContain('record-0')
    expect(result.successIds).toContain('record-2')
    expect(result.successIds).not.toContain('record-1')
  })

  it('includes timing information', async () => {
    const destination = createMockDestination({ upsertDelay: 10 })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 3 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 3,
      parallelism: 1,
    })

    expect(result.durationMs).toBeGreaterThanOrEqual(10)
    expect(result.startedAt).toBeInstanceOf(Date)
    expect(result.completedAt).toBeInstanceOf(Date)
  })

  it('calculates records per second', async () => {
    const destination = createMockDestination({ upsertDelay: 50 })
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    const result = await upserter.upsert(records, destination, {
      batchSize: 5,
      parallelism: 2, // 2 batches in parallel = ~50ms total
    })

    // 10 records in ~50ms = ~200 records/sec (with some variance)
    expect(result.recordsPerSecond).toBeGreaterThan(0)
    expect(result.recordsPerSecond).toBeDefined()
  })
})

// ============================================================================
// OPTIONS VALIDATION TESTS
// ============================================================================

describe('BatchUpserter - Options Validation', () => {
  it('uses default batch size if not specified', async () => {
    const destination = createMockDestination()
    const upsertSpy = vi.spyOn(destination, 'upsert')
    const upserter = new BatchUpserter()

    // Default batch size should be 100
    const records: SyncRecord[] = Array.from({ length: 150 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    await upserter.upsert(records, destination, { parallelism: 1 })

    // 150 records / 100 batch size = 2 batches
    expect(upsertSpy).toHaveBeenCalledTimes(2)
    expect(upsertSpy.mock.calls[0][0]).toHaveLength(100)
    expect(upsertSpy.mock.calls[1][0]).toHaveLength(50)
  })

  it('uses default parallelism if not specified', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const destination: Destination = {
      name: 'concurrency-tracking-destination',
      async upsert(records: SyncRecord[]) {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise((resolve) => setTimeout(resolve, 10))
        currentConcurrent--
        return { success: records.map((r) => r.id), failed: [] }
      },
    }

    const upserter = new BatchUpserter()
    const records: SyncRecord[] = Array.from({ length: 15 }, (_, i) => ({
      id: `record-${i}`,
      data: { value: i },
    }))

    // Default parallelism should be 1 (sequential)
    await upserter.upsert(records, destination, { batchSize: 3 })

    expect(maxConcurrent).toBe(1)
  })

  it('throws error for invalid batch size', async () => {
    const destination = createMockDestination()
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = [{ id: 'record-0', data: {} }]

    await expect(
      upserter.upsert(records, destination, {
        batchSize: 0,
        parallelism: 1,
      })
    ).rejects.toThrow('batchSize must be greater than 0')
  })

  it('throws error for invalid parallelism', async () => {
    const destination = createMockDestination()
    const upserter = new BatchUpserter()

    const records: SyncRecord[] = [{ id: 'record-0', data: {} }]

    await expect(
      upserter.upsert(records, destination, {
        batchSize: 10,
        parallelism: 0,
      })
    ).rejects.toThrow('parallelism must be greater than 0')
  })
})
