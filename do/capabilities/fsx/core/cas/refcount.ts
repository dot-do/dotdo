/**
 * Reference counting for content-addressable storage
 *
 * Tracks how many references exist to each object by its hash.
 * This enables safe deduplication: objects are only deleted when
 * their reference count drops to zero.
 */

/**
 * Callback invoked when refcount reaches zero and GC may be needed
 */
export type GCSignalCallback = (hash: string) => void

/**
 * Metrics for refcount operations
 */
export interface RefCountMetrics {
  /** Total increment operations */
  incrementCount: number
  /** Total decrement operations */
  decrementCount: number
  /** Total CAS operations */
  casCount: number
  /** CAS operations that failed (expected value mismatch) */
  casFailures: number
  /** Times a lock had contention (another operation was waiting) */
  contentionCount: number
  /** Total time spent waiting for locks (ms) */
  totalLockWaitTimeMs: number
  /** Number of GC signals emitted */
  gcSignalCount: number
  /** Number of batch operations */
  batchOperationCount: number
}

/**
 * Creates a fresh metrics object with all counters at zero
 */
export function createMetrics(): RefCountMetrics {
  return {
    incrementCount: 0,
    decrementCount: 0,
    casCount: 0,
    casFailures: 0,
    contentionCount: 0,
    totalLockWaitTimeMs: 0,
    gcSignalCount: 0,
    batchOperationCount: 0,
  }
}

/**
 * Storage interface for reference counts
 *
 * Reference counts are stored separately from objects to allow
 * for efficient querying and updating without touching object data.
 */

export interface RefCountStorage {
  /**
   * Get the reference count for a hash
   * @returns The current reference count, or 0 if not tracked
   */
  getRefCount(hash: string): Promise<number>

  /**
   * Set the reference count for a hash
   */
  setRefCount(hash: string, count: number): Promise<void>

  /**
   * Increment the reference count by 1
   * @returns The new reference count
   */
  incrementRefCount(hash: string): Promise<number>

  /**
   * Decrement the reference count by 1, but not below 0
   * @returns The new reference count
   */
  decrementRefCount(hash: string): Promise<number>

  /**
   * Atomic compare-and-swap for reference count
   * Only updates if current value equals expected value
   * @returns true if swap succeeded, false if expected value didn't match
   */
  compareAndSwapRefCount(hash: string, expected: number, newValue: number): Promise<boolean>

  /**
   * Decrement with GC signal - atomically decrements and signals GC
   * if refcount reaches zero. The callback is only invoked if this
   * operation is the one that caused the count to reach zero.
   * @returns The new reference count
   */
  decrementRefCountWithGCSignal(hash: string, onGC: GCSignalCallback): Promise<number>

  /**
   * Delete the refcount entry for a hash
   */
  deleteRefCount(hash: string): Promise<void>

  /**
   * Get all refcount entries for statistics
   * @returns Map of hash to { refCount, size }
   */
  getAllRefCounts(): Promise<Map<string, { refCount: number; size: number }>>

  /**
   * Set size for a hash (called when object is first stored)
   */
  setSize(hash: string, size: number): Promise<void>

  /**
   * Get size for a hash
   */
  getSize(hash: string): Promise<number>

  /**
   * Batch increment multiple hashes atomically
   * More efficient than individual increments for bulk operations
   * @returns Map of hash to new refcount
   */
  batchIncrementRefCount(hashes: string[]): Promise<Map<string, number>>

  /**
   * Batch decrement multiple hashes atomically
   * @returns Map of hash to new refcount and hashes that reached zero
   */
  batchDecrementRefCount(
    hashes: string[],
    onGC?: GCSignalCallback
  ): Promise<{ results: Map<string, number>; gcHashes: string[] }>

  /**
   * Get current operation metrics
   */
  getMetrics(): RefCountMetrics

  /**
   * Reset metrics to zero
   */
  resetMetrics(): void
}

/**
 * In-memory reference count storage with atomic operations
 *
 * Uses a mutex pattern to ensure atomicity of increment/decrement operations.
 * This prevents race conditions where concurrent operations could cause
 * lost updates or incorrect GC signaling.
 *
 * Features:
 * - Per-hash locking for fine-grained concurrency
 * - Metrics tracking for observability
 * - Batch operations for bulk efficiency
 * - Optimized for single-reference common case
 *
 * Suitable for testing and single-instance use cases.
 * For production, use a persistent storage implementation with database-level atomicity.
 */
export class InMemoryRefCountStorage implements RefCountStorage {
  private refCounts: Map<string, number> = new Map()
  private sizes: Map<string, number> = new Map()

  /**
   * Per-hash mutex locks to ensure atomic operations
   * Maps hash -> queue of pending operations
   */
  private locks: Map<string, Promise<void>> = new Map()

  /**
   * Operation metrics for observability
   */
  private metrics: RefCountMetrics = createMetrics()

  /**
   * Acquire a lock for a hash, execute operation, then release
   * Tracks contention metrics when locks are contested
   */
  private async withLock<T>(hash: string, operation: () => T): Promise<T> {
    const normalizedHash = hash.toLowerCase()

    // Check for contention and wait if needed
    const pendingLock = this.locks.get(normalizedHash)
    if (pendingLock) {
      this.metrics.contentionCount++
      const startWait = performance.now()
      await pendingLock
      this.metrics.totalLockWaitTimeMs += performance.now() - startWait
    }

    // Create a new lock and store it
    let releaseLock: () => void
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    this.locks.set(normalizedHash, newLock)

    try {
      // Execute the operation synchronously while holding the lock
      return operation()
    } finally {
      // Release the lock
      this.locks.delete(normalizedHash)
      releaseLock!()
    }
  }

  async getRefCount(hash: string): Promise<number> {
    return this.refCounts.get(hash.toLowerCase()) ?? 0
  }

  async setRefCount(hash: string, count: number): Promise<void> {
    await this.withLock(hash, () => {
      if (count <= 0) {
        this.refCounts.delete(hash.toLowerCase())
      } else {
        this.refCounts.set(hash.toLowerCase(), count)
      }
    })
  }

  async incrementRefCount(hash: string): Promise<number> {
    this.metrics.incrementCount++
    return this.withLock(hash, () => {
      const normalizedHash = hash.toLowerCase()
      const current = this.refCounts.get(normalizedHash) ?? 0
      const newCount = current + 1
      this.refCounts.set(normalizedHash, newCount)
      return newCount
    })
  }

  async decrementRefCount(hash: string): Promise<number> {
    this.metrics.decrementCount++
    return this.withLock(hash, () => {
      const normalizedHash = hash.toLowerCase()
      const current = this.refCounts.get(normalizedHash) ?? 0
      const newCount = Math.max(0, current - 1)
      if (newCount === 0) {
        this.refCounts.delete(normalizedHash)
      } else {
        this.refCounts.set(normalizedHash, newCount)
      }
      return newCount
    })
  }

  /**
   * Atomic compare-and-swap operation
   * Only updates if current value equals expected value
   */
  async compareAndSwapRefCount(
    hash: string,
    expected: number,
    newValue: number
  ): Promise<boolean> {
    this.metrics.casCount++
    return this.withLock(hash, () => {
      const normalizedHash = hash.toLowerCase()
      const current = this.refCounts.get(normalizedHash) ?? 0

      if (current !== expected) {
        this.metrics.casFailures++
        return false
      }

      if (newValue <= 0) {
        this.refCounts.delete(normalizedHash)
      } else {
        this.refCounts.set(normalizedHash, newValue)
      }
      return true
    })
  }

  /**
   * Decrement with GC signal - atomically decrements and only signals GC
   * if this operation is the one that caused the count to reach zero.
   * Prevents double-deletion race conditions.
   */
  async decrementRefCountWithGCSignal(
    hash: string,
    onGC: GCSignalCallback
  ): Promise<number> {
    this.metrics.decrementCount++
    return this.withLock(hash, () => {
      const normalizedHash = hash.toLowerCase()
      const current = this.refCounts.get(normalizedHash) ?? 0
      const newCount = Math.max(0, current - 1)

      if (newCount === 0) {
        this.refCounts.delete(normalizedHash)
        // Only signal GC if we actually decremented from a positive value to 0
        // This prevents GC signal when already at 0
        if (current > 0) {
          this.metrics.gcSignalCount++
          onGC(hash)
        }
      } else {
        this.refCounts.set(normalizedHash, newCount)
      }

      return newCount
    })
  }

  async deleteRefCount(hash: string): Promise<void> {
    await this.withLock(hash, () => {
      const normalizedHash = hash.toLowerCase()
      this.refCounts.delete(normalizedHash)
      this.sizes.delete(normalizedHash)
    })
  }

  async getAllRefCounts(): Promise<Map<string, { refCount: number; size: number }>> {
    const result = new Map<string, { refCount: number; size: number }>()
    for (const [hash, refCount] of this.refCounts) {
      const size = this.sizes.get(hash) ?? 0
      result.set(hash, { refCount, size })
    }
    return result
  }

  async setSize(hash: string, size: number): Promise<void> {
    this.sizes.set(hash.toLowerCase(), size)
  }

  async getSize(hash: string): Promise<number> {
    return this.sizes.get(hash.toLowerCase()) ?? 0
  }

  /**
   * Batch increment multiple hashes
   * Processes each hash with its own lock for fine-grained concurrency
   * while still being more efficient than individual calls due to
   * reduced async overhead.
   */
  async batchIncrementRefCount(hashes: string[]): Promise<Map<string, number>> {
    this.metrics.batchOperationCount++
    const results = new Map<string, number>()

    // Process in parallel - each hash has its own lock
    await Promise.all(
      hashes.map(async (hash) => {
        const newCount = await this.incrementRefCount(hash)
        results.set(hash.toLowerCase(), newCount)
      })
    )

    return results
  }

  /**
   * Batch decrement multiple hashes with optional GC signaling
   * Returns both the new refcounts and a list of hashes that reached zero.
   */
  async batchDecrementRefCount(
    hashes: string[],
    onGC?: GCSignalCallback
  ): Promise<{ results: Map<string, number>; gcHashes: string[] }> {
    this.metrics.batchOperationCount++
    const results = new Map<string, number>()
    const gcHashes: string[] = []

    // Process in parallel with GC tracking
    await Promise.all(
      hashes.map(async (hash) => {
        let newCount: number
        if (onGC) {
          newCount = await this.decrementRefCountWithGCSignal(hash, (h) => {
            gcHashes.push(h)
            onGC(h)
          })
        } else {
          newCount = await this.decrementRefCount(hash)
        }
        results.set(hash.toLowerCase(), newCount)
      })
    )

    return { results, gcHashes }
  }

  /**
   * Get current operation metrics
   * Returns a copy to prevent external modification
   */
  getMetrics(): RefCountMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset all metrics to zero
   */
  resetMetrics(): void {
    this.metrics = createMetrics()
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.refCounts.clear()
    this.sizes.clear()
    this.locks.clear()
    this.metrics = createMetrics()
  }
}

/**
 * Deduplication statistics
 */
export interface DeduplicationStats {
  /** Number of unique objects stored */
  totalObjects: number
  /** Total number of references (including duplicates) */
  totalReferences: number
  /** Bytes saved by deduplication */
  deduplicatedBytes: number
  /** Average references per object */
  averageRefCount: number
}

/**
 * Calculate deduplication statistics from refcount data
 */
export function calculateStats(
  refCounts: Map<string, { refCount: number; size: number }>
): DeduplicationStats {
  let totalObjects = 0
  let totalReferences = 0
  let deduplicatedBytes = 0

  for (const { refCount, size } of refCounts.values()) {
    totalObjects++
    totalReferences += refCount
    // Bytes saved = (refCount - 1) * size (we only stored one copy)
    if (refCount > 1) {
      deduplicatedBytes += (refCount - 1) * size
    }
  }

  const averageRefCount = totalObjects > 0 ? totalReferences / totalObjects : 0

  return {
    totalObjects,
    totalReferences,
    deduplicatedBytes,
    averageRefCount,
  }
}
