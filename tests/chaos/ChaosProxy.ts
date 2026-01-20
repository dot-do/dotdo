/**
 * Chaos Engineering Utilities for dotdo Framework
 *
 * Provides chaos injection capabilities for testing system resilience:
 * - Network latency injection
 * - Random request failures
 * - Storage failures
 * - Concurrent request storms
 * - Large payload handling
 *
 * @module tests/chaos/ChaosProxy
 */

/**
 * Configuration for latency injection
 */
export interface LatencyConfig {
  minMs: number
  maxMs: number
  probability?: number // 0-1, defaults to 1 (always inject)
}

/**
 * Configuration for failure injection
 */
export interface FailureConfig {
  probability: number // 0-1, probability of failure
  errorMessage?: string
  errorCode?: string
}

/**
 * Configuration for storage chaos
 */
export interface StorageChaosConfig {
  readFailureProbability?: number
  writeFailureProbability?: number
  deleteFailureProbability?: number
  latency?: LatencyConfig
}

/**
 * Statistics collected during chaos testing
 */
export interface ChaosStats {
  totalRequests: number
  injectedLatencies: number
  injectedFailures: number
  storageFailures: number
  largePayloads: number
  maxLatencyMs: number
  totalLatencyMs: number
}

/**
 * ChaosProxy - Utility for injecting chaos into system operations
 *
 * Usage:
 * ```typescript
 * const chaos = new ChaosProxy()
 * chaos.injectLatency(10, 100)
 * chaos.injectFailure(0.2) // 20% failure rate
 *
 * // Wrap operations
 * const result = await chaos.wrap(async () => {
 *   return await doInstance.fetch(request)
 * })
 *
 * // Reset for clean tests
 * chaos.reset()
 * ```
 */
export class ChaosProxy {
  private latencyConfig: LatencyConfig | null = null
  private failureConfig: FailureConfig | null = null
  private storageConfig: StorageChaosConfig | null = null
  private enabled = true

  private stats: ChaosStats = {
    totalRequests: 0,
    injectedLatencies: 0,
    injectedFailures: 0,
    storageFailures: 0,
    largePayloads: 0,
    maxLatencyMs: 0,
    totalLatencyMs: 0,
  }

  /**
   * Configure latency injection
   * @param minMs Minimum latency in milliseconds
   * @param maxMs Maximum latency in milliseconds
   * @param probability Probability of injecting latency (0-1)
   */
  injectLatency(minMs: number, maxMs: number, probability = 1): void {
    this.latencyConfig = { minMs, maxMs, probability }
  }

  /**
   * Configure failure injection
   * @param probability Probability of failure (0-1)
   * @param errorMessage Optional custom error message
   * @param errorCode Optional error code
   */
  injectFailure(probability: number, errorMessage?: string, errorCode?: string): void {
    this.failureConfig = { probability, errorMessage, errorCode }
  }

  /**
   * Configure storage chaos
   * @param config Storage chaos configuration
   */
  injectStorageChaos(config: StorageChaosConfig): void {
    this.storageConfig = config
  }

  /**
   * Enable chaos injection
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable chaos injection (operations pass through without chaos)
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if chaos is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Reset all chaos configurations and statistics
   */
  reset(): void {
    this.latencyConfig = null
    this.failureConfig = null
    this.storageConfig = null
    this.enabled = true
    this.stats = {
      totalRequests: 0,
      injectedLatencies: 0,
      injectedFailures: 0,
      storageFailures: 0,
      largePayloads: 0,
      maxLatencyMs: 0,
      totalLatencyMs: 0,
    }
  }

  /**
   * Get chaos statistics
   */
  getStats(): ChaosStats {
    return { ...this.stats }
  }

  /**
   * Apply latency if configured
   */
  private async applyLatency(): Promise<number> {
    if (!this.latencyConfig || !this.enabled) return 0

    const { minMs, maxMs, probability = 1 } = this.latencyConfig

    if (Math.random() > probability) return 0

    const latency = minMs + Math.random() * (maxMs - minMs)
    await this.delay(latency)

    this.stats.injectedLatencies++
    this.stats.totalLatencyMs += latency
    this.stats.maxLatencyMs = Math.max(this.stats.maxLatencyMs, latency)

    return latency
  }

  /**
   * Check and potentially throw failure
   */
  private checkFailure(): void {
    if (!this.failureConfig || !this.enabled) return

    const { probability, errorMessage, errorCode } = this.failureConfig

    if (Math.random() < probability) {
      this.stats.injectedFailures++
      const error = new Error(errorMessage || 'Chaos-injected failure')
      ;(error as Error & { code: string }).code = errorCode || 'CHAOS_FAILURE'
      throw error
    }
  }

  /**
   * Wrap an async operation with chaos injection
   * @param operation The operation to wrap
   * @returns The operation result
   */
  async wrap<T>(operation: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++

    // Apply latency before operation
    await this.applyLatency()

    // Check for failure injection
    this.checkFailure()

    // Execute the operation
    return operation()
  }

  /**
   * Wrap a storage read operation with chaos
   */
  async wrapStorageRead<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.storageConfig || !this.enabled) {
      return operation()
    }

    // Apply storage-specific latency
    if (this.storageConfig.latency) {
      const { minMs, maxMs, probability = 1 } = this.storageConfig.latency
      if (Math.random() <= probability) {
        const latency = minMs + Math.random() * (maxMs - minMs)
        await this.delay(latency)
      }
    }

    // Check for read failure
    if (this.storageConfig.readFailureProbability &&
        Math.random() < this.storageConfig.readFailureProbability) {
      this.stats.storageFailures++
      throw new Error('Chaos-injected storage read failure')
    }

    return operation()
  }

  /**
   * Wrap a storage write operation with chaos
   */
  async wrapStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.storageConfig || !this.enabled) {
      return operation()
    }

    // Apply storage-specific latency
    if (this.storageConfig.latency) {
      const { minMs, maxMs, probability = 1 } = this.storageConfig.latency
      if (Math.random() <= probability) {
        const latency = minMs + Math.random() * (maxMs - minMs)
        await this.delay(latency)
      }
    }

    // Check for write failure
    if (this.storageConfig.writeFailureProbability &&
        Math.random() < this.storageConfig.writeFailureProbability) {
      this.stats.storageFailures++
      throw new Error('Chaos-injected storage write failure')
    }

    return operation()
  }

  /**
   * Wrap a storage delete operation with chaos
   */
  async wrapStorageDelete<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.storageConfig || !this.enabled) {
      return operation()
    }

    // Check for delete failure
    if (this.storageConfig.deleteFailureProbability &&
        Math.random() < this.storageConfig.deleteFailureProbability) {
      this.stats.storageFailures++
      throw new Error('Chaos-injected storage delete failure')
    }

    return operation()
  }

  /**
   * Helper to create a delay promise
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Generate a large payload for testing
   * @param sizeKb Size in kilobytes
   * @returns String of specified size
   */
  generateLargePayload(sizeKb: number): string {
    this.stats.largePayloads++
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const size = sizeKb * 1024
    let result = ''
    for (let i = 0; i < size; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Generate a large JSON object for testing
   * @param depth Nesting depth
   * @param breadth Number of keys at each level
   * @returns Large nested object
   */
  generateLargeObject(depth: number, breadth: number): Record<string, unknown> {
    this.stats.largePayloads++
    const generate = (d: number): Record<string, unknown> => {
      if (d === 0) {
        return { value: this.generateLargePayload(1) }
      }
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < breadth; i++) {
        obj[`key_${i}`] = generate(d - 1)
      }
      return obj
    }
    return generate(depth)
  }
}

/**
 * Create a mock DurableObjectState with chaos injection capabilities
 */
export function createChaoticMockState(chaos: ChaosProxy): DurableObjectState & {
  _storage: Map<string, unknown>
} {
  const storage = new Map<string, unknown>()
  const websockets = new Map<string, Set<WebSocket>>()

  return {
    id: { toString: () => 'chaos-test-do-id' } as DurableObjectId,
    _storage: storage,
    storage: {
      get: async (key: string) => {
        return chaos.wrapStorageRead(() => Promise.resolve(storage.get(key)))
      },
      put: async (key: string, value: unknown) => {
        return chaos.wrapStorageWrite(async () => {
          storage.set(key, value)
        })
      },
      delete: async (key: string) => {
        return chaos.wrapStorageDelete(async () => {
          storage.delete(key)
          return true
        })
      },
      list: async () => {
        return chaos.wrapStorageRead(() => Promise.resolve(storage))
      },
      deleteAll: async () => {
        return chaos.wrapStorageDelete(async () => {
          storage.clear()
        })
      },
      transaction: async (callback: () => Promise<void>) => {
        await callback()
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => {
      return fn()
    },
    waitUntil: () => {},
    acceptWebSocket: (ws: WebSocket, tags?: string[]) => {
      const tagList = tags || []
      for (const tag of tagList) {
        if (!websockets.has(tag)) {
          websockets.set(tag, new Set())
        }
        websockets.get(tag)!.add(ws)
      }
    },
    getWebSockets: (tag?: string) => {
      if (tag) {
        return Array.from(websockets.get(tag) || [])
      }
      const all = new Set<WebSocket>()
      for (const set of websockets.values()) {
        for (const ws of set) {
          all.add(ws)
        }
      }
      return Array.from(all)
    },
    setAlarm: () => {},
    getAlarm: () => null,
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

/**
 * Utility for running concurrent request storms
 */
export async function runRequestStorm<T>(
  count: number,
  requestFn: (index: number) => Promise<T>,
  options: {
    batchSize?: number
    delayBetweenBatches?: number
    onProgress?: (completed: number, total: number) => void
  } = {}
): Promise<{
  results: T[]
  errors: Error[]
  duration: number
  successRate: number
}> {
  const { batchSize = count, delayBetweenBatches = 0, onProgress } = options
  const startTime = Date.now()
  const results: T[] = []
  const errors: Error[] = []
  let completed = 0

  for (let i = 0; i < count; i += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, count - i) },
      (_, j) => i + j
    )

    const batchResults = await Promise.allSettled(
      batch.map(index => requestFn(index))
    )

    for (const result of batchResults) {
      completed++
      if (result.status === 'fulfilled') {
        results.push(result.value)
      } else {
        errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
      }
    }

    if (onProgress) {
      onProgress(completed, count)
    }

    if (delayBetweenBatches > 0 && i + batchSize < count) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches))
    }
  }

  const duration = Date.now() - startTime
  const successRate = results.length / count

  return { results, errors, duration, successRate }
}

/**
 * Utility for testing retry behavior
 */
export class RetryTester {
  private attempts = 0
  private failUntilAttempt: number
  private failError: Error

  constructor(failUntilAttempt: number, error?: Error) {
    this.failUntilAttempt = failUntilAttempt
    this.failError = error || new Error('Retry test failure')
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.attempts++
    if (this.attempts < this.failUntilAttempt) {
      throw this.failError
    }
    return operation()
  }

  getAttempts(): number {
    return this.attempts
  }

  reset(): void {
    this.attempts = 0
  }
}

/**
 * Utility for testing timeout behavior
 */
export function createTimeoutOperation<T>(
  operation: () => Promise<T>,
  delayMs: number
): () => Promise<T> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return operation()
  }
}

/**
 * Utility for testing data corruption detection
 */
export class CorruptionInjector {
  private corruptionProbability: number

  constructor(probability = 0.1) {
    this.corruptionProbability = probability
  }

  maybeCorrupt<T extends object>(data: T): T {
    if (Math.random() >= this.corruptionProbability) {
      return data
    }

    // Create a corrupted copy
    const corrupted = JSON.parse(JSON.stringify(data))
    const keys = Object.keys(corrupted)
    if (keys.length > 0) {
      const randomKey = keys[Math.floor(Math.random() * keys.length)]
      // Corrupt by nullifying a random field
      corrupted[randomKey] = null
    }
    return corrupted
  }

  setProbability(probability: number): void {
    this.corruptionProbability = probability
  }
}
