/**
 * Concurrency Primitives for DocumentStore
 *
 * Provides write serialization, conflict detection, and retry logic
 * for handling concurrent writes to SQLite-backed document stores.
 *
 * SQLite is single-writer, so concurrent writes need to be serialized.
 * This module provides:
 * - WriteLockManager: Mutex-based write serialization
 * - withRetry: Retry logic with exponential/constant backoff
 * - Conflict detection helpers
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for configuring WriteLockManager
 */
export interface WriteLockManagerOptions {
  /**
   * Maximum number of requests that can be queued per key.
   * When exceeded, new requests are rejected with QueueFullError.
   * Default: 1000
   */
  maxQueueDepth?: number
}

/**
 * Handle returned when acquiring a lock
 */
export interface LockHandle {
  /** Unique identifier for this lock acquisition */
  id: string
  /** Key that was locked */
  key: string
  /** Timestamp when lock was acquired */
  acquiredAt: number
  /** Release the lock */
  release: () => void
}

/**
 * Options for acquiring a lock
 */
export interface LockOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
  /** Priority level (higher = more urgent) */
  priority?: number
}

/**
 * Retry options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Backoff strategy (default: 'exponential') */
  backoff?: 'exponential' | 'constant'
  /** Base delay in milliseconds (default: 10) */
  baseDelayMs?: number
  /** Maximum delay in milliseconds (default: 1000) */
  maxDelayMs?: number
  /** Jitter factor 0-1 to add randomness (default: 0.1) */
  jitter?: number
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean
}

/**
 * Conflict information
 */
export interface Conflict<T> {
  key: string
  currentVersion: number
  expectedVersion: number
  currentValue: T
  incomingValue: T
}

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'reject' | 'last-write-wins' | 'merge' | 'custom'

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when a lock queue is full and cannot accept more requests.
 * This prevents unbounded memory growth when locks are held indefinitely.
 */
export class QueueFullError extends Error {
  name = 'QueueFullError' as const

  constructor(
    /** The key for which the queue is full */
    public readonly key: string,
    /** Current depth of the queue */
    public readonly queueDepth: number,
    /** Maximum allowed queue depth */
    public readonly maxQueueDepth: number
  ) {
    super(`Queue full for key "${key}": ${queueDepth}/${maxQueueDepth} requests queued`)
  }
}

// ============================================================================
// LOCK QUEUE ITEM
// ============================================================================

interface QueuedLockRequest {
  id: string
  key: string
  priority: number
  resolve: (handle: LockHandle) => void
  reject: (error: Error) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

// ============================================================================
// WRITE LOCK MANAGER
// ============================================================================

/**
 * WriteLockManager provides mutex-based serialization for document writes.
 *
 * Ensures that concurrent writes to the same document are serialized,
 * preventing race conditions in read-modify-write cycles.
 *
 * @example
 * ```typescript
 * const lockManager = new WriteLockManager()
 *
 * // Acquire lock before writing
 * const handle = await lockManager.acquireLock('doc_123')
 * try {
 *   await performWrite()
 * } finally {
 *   handle.release()
 * }
 * ```
 */
export class WriteLockManager {
  /** Currently held locks by key */
  private locks = new Map<string, LockHandle>()

  /** Queued lock requests by key */
  private queues = new Map<string, QueuedLockRequest[]>()

  /** Counter for generating unique lock IDs */
  private lockIdCounter = 0

  /** Maximum queue depth per key */
  private readonly maxQueueDepth: number

  /** Metrics for monitoring */
  private metrics = {
    locksAcquired: 0,
    locksReleased: 0,
    lockTimeouts: 0,
    queueDepthMax: 0,
    totalWaitTimeMs: 0,
    queueFullRejections: 0,
  }

  constructor(options: WriteLockManagerOptions = {}) {
    this.maxQueueDepth = options.maxQueueDepth ?? 1000
  }

  /**
   * Acquire a lock for a specific key
   *
   * @param key - The document key to lock
   * @param options - Lock options including timeout
   * @returns Promise that resolves with a LockHandle when lock is acquired
   */
  async acquireLock(key: string, options: LockOptions = {}): Promise<LockHandle> {
    const timeout = options.timeout ?? 5000
    const priority = options.priority ?? 0
    const requestId = `lock_${++this.lockIdCounter}_${Date.now()}`
    const startTime = Date.now()

    // If no lock held for this key, acquire immediately
    if (!this.locks.has(key)) {
      return this.createLockHandle(key, requestId)
    }

    // Check queue bounds before queueing
    const currentQueue = this.queues.get(key)
    const currentQueueLength = currentQueue?.length ?? 0
    if (currentQueueLength >= this.maxQueueDepth) {
      this.metrics.queueFullRejections++
      throw new QueueFullError(key, currentQueueLength, this.maxQueueDepth)
    }

    // Otherwise, queue the request
    return new Promise((resolve, reject) => {
      const request: QueuedLockRequest = {
        id: requestId,
        key,
        priority,
        resolve: (handle) => {
          this.metrics.totalWaitTimeMs += Date.now() - startTime
          resolve(handle)
        },
        reject,
      }

      // Set up timeout
      if (timeout > 0) {
        request.timeoutId = setTimeout(() => {
          this.removeFromQueue(key, requestId)
          this.metrics.lockTimeouts++
          reject(new Error(`Lock acquisition timed out after ${timeout}ms for key: ${key}`))
        }, timeout)
      }

      // Add to queue (sorted by priority, high to low)
      if (!this.queues.has(key)) {
        this.queues.set(key, [])
      }
      const queue = this.queues.get(key)!
      queue.push(request)
      queue.sort((a, b) => b.priority - a.priority)

      // Update metrics
      this.metrics.queueDepthMax = Math.max(this.metrics.queueDepthMax, queue.length)
    })
  }

  /**
   * Try to acquire a lock without waiting
   *
   * @param key - The document key to lock
   * @returns LockHandle if acquired, null if lock is held
   */
  tryAcquireLock(key: string): LockHandle | null {
    if (this.locks.has(key)) {
      return null
    }
    return this.createLockHandle(key, `lock_${++this.lockIdCounter}_${Date.now()}`)
  }

  /**
   * Release a lock
   *
   * @param handle - The lock handle to release
   */
  releaseLock(handle: LockHandle): void {
    const currentLock = this.locks.get(handle.key)

    // Only release if this handle owns the lock
    if (currentLock && currentLock.id === handle.id) {
      this.locks.delete(handle.key)
      this.metrics.locksReleased++

      // Process next queued request
      this.processQueue(handle.key)
    }
  }

  /**
   * Check if a key is currently locked
   */
  isLocked(key: string): boolean {
    return this.locks.has(key)
  }

  /**
   * Get the number of pending requests for a key
   */
  getQueueLength(key: string): number {
    return this.queues.get(key)?.length ?? 0
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): typeof this.metrics & { activeLocksCount: number; queuedRequestsCount: number; maxQueueDepth: number } {
    let queuedRequestsCount = 0
    this.queues.forEach((queue) => {
      queuedRequestsCount += queue.length
    })

    return {
      ...this.metrics,
      activeLocksCount: this.locks.size,
      queuedRequestsCount,
      maxQueueDepth: this.maxQueueDepth,
    }
  }

  /**
   * Clear all locks (use with caution, mainly for testing)
   */
  clearAll(): void {
    this.locks.clear()
    this.queues.forEach((queue) => {
      queue.forEach((request) => {
        if (request.timeoutId) {
          clearTimeout(request.timeoutId)
        }
        request.reject(new Error('Lock manager cleared'))
      })
    })
    this.queues.clear()
  }

  /**
   * Create a lock handle
   */
  private createLockHandle(key: string, id: string): LockHandle {
    const handle: LockHandle = {
      id,
      key,
      acquiredAt: Date.now(),
      release: () => this.releaseLock(handle),
    }

    this.locks.set(key, handle)
    this.metrics.locksAcquired++

    return handle
  }

  /**
   * Process the next request in the queue for a key
   */
  private processQueue(key: string): void {
    const queue = this.queues.get(key)
    if (!queue || queue.length === 0) {
      return
    }

    // Get next request (already sorted by priority)
    const nextRequest = queue.shift()!

    // Clear timeout
    if (nextRequest.timeoutId) {
      clearTimeout(nextRequest.timeoutId)
    }

    // Create and deliver lock handle
    const handle = this.createLockHandle(key, nextRequest.id)
    nextRequest.resolve(handle)

    // Clean up empty queue
    if (queue.length === 0) {
      this.queues.delete(key)
    }
  }

  /**
   * Remove a request from the queue
   */
  private removeFromQueue(key: string, requestId: string): void {
    const queue = this.queues.get(key)
    if (!queue) return

    const index = queue.findIndex((r) => r.id === requestId)
    if (index !== -1) {
      const request = queue[index]
      if (request.timeoutId) {
        clearTimeout(request.timeoutId)
      }
      queue.splice(index, 1)
    }

    if (queue.length === 0) {
      this.queues.delete(key)
    }
  }
}

// ============================================================================
// GLOBAL LOCK MANAGER (for single-process scenarios)
// ============================================================================

/**
 * Global lock manager instance for single-process scenarios
 */
let globalLockManager: WriteLockManager | null = null

/**
 * Get or create the global lock manager
 */
export function getGlobalLockManager(): WriteLockManager {
  if (!globalLockManager) {
    globalLockManager = new WriteLockManager()
  }
  return globalLockManager
}

/**
 * Reset the global lock manager (for testing)
 */
export function resetGlobalLockManager(): void {
  if (globalLockManager) {
    globalLockManager.clearAll()
  }
  globalLockManager = null
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

/**
 * Default function to determine if an error is retryable
 */
function defaultIsRetryable(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('sqlite_busy') ||
    message.includes('sqlite_locked') ||
    message.includes('database is locked') ||
    message.includes('database table is locked') ||
    message.includes('version mismatch') ||
    message.includes('conflict') ||
    message.includes('concurrent')
  )
}

/**
 * Calculate delay with optional jitter
 */
function calculateDelay(
  attempt: number,
  backoff: 'exponential' | 'constant',
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number
): number {
  let delay: number

  if (backoff === 'exponential') {
    delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
  } else {
    delay = baseDelayMs
  }

  // Add jitter
  if (jitter > 0) {
    const jitterAmount = delay * jitter * (Math.random() * 2 - 1)
    delay = Math.max(0, delay + jitterAmount)
  }

  return delay
}

/**
 * Execute a function with retry logic for transient failures
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     const doc = await store.get(id)
 *     return store.updateIfVersion(id, updates, doc.$version)
 *   },
 *   { maxRetries: 5, backoff: 'exponential' }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    backoff = 'exponential',
    baseDelayMs = 10,
    maxDelayMs = 1000,
    jitter = 0.1,
    isRetryable = defaultIsRetryable,
  } = options

  let lastError: Error | undefined
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      return await fn()
    } catch (e) {
      const error = e as Error
      lastError = error

      // Don't retry non-retryable errors
      if (!isRetryable(error)) {
        throw error
      }

      // Don't delay after last attempt
      if (attempt < maxRetries) {
        const delay = calculateDelay(attempt, backoff, baseDelayMs, maxDelayMs, jitter)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      attempt++
    }
  }

  throw lastError
}

/**
 * Execute a function with lock and retry
 *
 * Combines lock acquisition with retry logic for robust concurrent writes.
 *
 * @example
 * ```typescript
 * const result = await withLockAndRetry(
 *   lockManager,
 *   'doc_123',
 *   async () => store.update(id, updates),
 *   { maxRetries: 3 }
 * )
 * ```
 */
export async function withLockAndRetry<T>(
  lockManager: WriteLockManager,
  key: string,
  fn: () => Promise<T>,
  options: RetryOptions & LockOptions = {}
): Promise<T> {
  const { timeout, priority, ...retryOptions } = options

  return withRetry(
    async () => {
      const handle = await lockManager.acquireLock(key, { timeout, priority })
      try {
        return await fn()
      } finally {
        handle.release()
      }
    },
    retryOptions
  )
}

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * ConflictDetector helps identify and handle write conflicts
 */
export class ConflictDetector<T> {
  /**
   * Detect if there's a version conflict
   */
  detectVersionConflict(
    key: string,
    current: { $version: number; value: T },
    expected: { $version: number; value: T }
  ): Conflict<T> | null {
    if (current.$version !== expected.$version) {
      return {
        key,
        currentVersion: current.$version,
        expectedVersion: expected.$version,
        currentValue: current.value,
        incomingValue: expected.value,
      }
    }
    return null
  }

  /**
   * Create a version mismatch error
   */
  createVersionMismatchError(conflict: Conflict<T>): Error {
    return new Error(
      `Version mismatch for key "${conflict.key}": ` +
      `expected ${conflict.expectedVersion}, found ${conflict.currentVersion}. ` +
      `Document was modified concurrently.`
    )
  }
}

// ============================================================================
// ATOMIC OPERATIONS HELPER
// ============================================================================

/**
 * AtomicOperations provides helpers for atomic read-modify-write cycles
 */
export class AtomicOperations<T extends { $id: string; $version: number }> {
  private lockManager: WriteLockManager

  constructor(lockManager?: WriteLockManager) {
    this.lockManager = lockManager ?? getGlobalLockManager()
  }

  /**
   * Perform an atomic read-modify-write operation
   *
   * @param key - Document key
   * @param read - Function to read current state
   * @param modify - Function to compute new state from current
   * @param write - Function to write new state (should check version)
   * @param options - Retry options
   */
  async atomicUpdate<R>(
    key: string,
    read: () => Promise<T | null>,
    modify: (current: T) => R,
    write: (key: string, updates: R, version: number) => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    return withLockAndRetry(
      this.lockManager,
      key,
      async () => {
        const current = await read()
        if (!current) {
          throw new Error(`Document with key "${key}" not found`)
        }
        const updates = modify(current)
        return write(key, updates, current.$version)
      },
      options
    )
  }

  /**
   * Perform an atomic increment operation
   *
   * @param key - Document key
   * @param field - Field to increment
   * @param amount - Amount to increment by (default: 1)
   * @param read - Function to read current state
   * @param write - Function to write new state
   * @param options - Retry options
   */
  async atomicIncrement(
    key: string,
    field: string,
    amount: number = 1,
    read: () => Promise<T | null>,
    write: (key: string, updates: Record<string, unknown>, version: number) => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    return this.atomicUpdate(
      key,
      read,
      (current) => {
        const currentValue = (current as unknown as Record<string, unknown>)[field]
        const numericValue = typeof currentValue === 'number' ? currentValue : 0
        return { [field]: numericValue + amount }
      },
      write,
      options
    )
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  defaultIsRetryable,
}
