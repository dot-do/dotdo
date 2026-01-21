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

// ============================================================================
// Network Partition Simulation
// ============================================================================

/**
 * Configuration for network partition types
 */
export type PartitionType =
  | 'full'           // Complete isolation between partitions
  | 'asymmetric'     // One direction works, other doesn't
  | 'intermittent'   // Periodic connectivity

/**
 * Configuration for network partition
 */
export interface NetworkPartitionConfig {
  /** Type of network partition */
  type: PartitionType
  /** Nodes in partition A (can communicate with each other) */
  partitionA: string[]
  /** Nodes in partition B (can communicate with each other) */
  partitionB: string[]
  /** For asymmetric partitions: A->B works? */
  aToBAllowed?: boolean
  /** For asymmetric partitions: B->A works? */
  bToAAllowed?: boolean
  /** For intermittent: connectivity probability (0-1) */
  connectivityProbability?: number
  /** Optional latency to add when partition allows traffic */
  degradedLatencyMs?: number
  /** Duration of partition in ms (0 = indefinite) */
  durationMs?: number
}

/**
 * Result of a network operation through a partition
 */
export type NetworkResult =
  | { status: 'success'; latencyMs: number }
  | { status: 'dropped'; reason: 'partition' | 'asymmetric' | 'intermittent' }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'error'; error: Error }

/**
 * Statistics for network partition simulation
 */
export interface NetworkPartitionStats {
  totalRequests: number
  successfulRequests: number
  droppedRequests: number
  timeoutRequests: number
  errorRequests: number
  totalLatencyMs: number
  partitionEvents: number
  healEvents: number
}

/**
 * NetworkPartitionSimulator - Simulates network partitions between nodes/services
 *
 * Supports multiple partition types:
 * - Full partition: Complete isolation between partitions
 * - Asymmetric: Traffic flows in one direction only
 * - Intermittent: Random connectivity with configurable probability
 *
 * @example
 * ```typescript
 * const partition = new NetworkPartitionSimulator()
 *
 * // Create a full partition between API and DB nodes
 * partition.createPartition({
 *   type: 'full',
 *   partitionA: ['api-1', 'api-2'],
 *   partitionB: ['db-1', 'db-2']
 * })
 *
 * // Check if request can go through
 * const result = await partition.simulateRequest('api-1', 'db-1')
 * if (result.status === 'dropped') {
 *   // Handle partition
 * }
 *
 * // Heal the partition
 * partition.heal()
 * ```
 */
export class NetworkPartitionSimulator {
  private config: NetworkPartitionConfig | null = null
  private partitionStartTime: number | null = null
  private enabled = true

  private stats: NetworkPartitionStats = {
    totalRequests: 0,
    successfulRequests: 0,
    droppedRequests: 0,
    timeoutRequests: 0,
    errorRequests: 0,
    totalLatencyMs: 0,
    partitionEvents: 0,
    healEvents: 0,
  }

  /**
   * Create a network partition
   */
  createPartition(config: NetworkPartitionConfig): void {
    this.config = config
    this.partitionStartTime = Date.now()
    this.stats.partitionEvents++

    // Auto-heal after duration if specified
    if (config.durationMs && config.durationMs > 0) {
      setTimeout(() => {
        this.heal()
      }, config.durationMs)
    }
  }

  /**
   * Heal the current partition
   */
  heal(): void {
    if (this.config) {
      this.config = null
      this.partitionStartTime = null
      this.stats.healEvents++
    }
  }

  /**
   * Check if a partition is active
   */
  isPartitioned(): boolean {
    return this.config !== null && this.enabled
  }

  /**
   * Enable partition simulation
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable partition simulation (all requests pass through)
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if two nodes can communicate
   */
  canCommunicate(fromNode: string, toNode: string): boolean {
    if (!this.config || !this.enabled) return true

    const { type, partitionA, partitionB, aToBAllowed, bToAAllowed, connectivityProbability } = this.config

    const fromInA = partitionA.includes(fromNode)
    const fromInB = partitionB.includes(fromNode)
    const toInA = partitionA.includes(toNode)
    const toInB = partitionB.includes(toNode)

    // Same partition - always works
    if ((fromInA && toInA) || (fromInB && toInB)) {
      return true
    }

    // Cross-partition communication
    switch (type) {
      case 'full':
        return false

      case 'asymmetric':
        if (fromInA && toInB) return aToBAllowed ?? false
        if (fromInB && toInA) return bToAAllowed ?? false
        return false

      case 'intermittent':
        return Math.random() < (connectivityProbability ?? 0.5)

      default:
        return true
    }
  }

  /**
   * Simulate a network request between nodes
   */
  async simulateRequest(
    fromNode: string,
    toNode: string,
    operation?: () => Promise<unknown>
  ): Promise<NetworkResult> {
    this.stats.totalRequests++

    if (!this.enabled || !this.config) {
      // No partition - execute normally
      const startTime = Date.now()
      if (operation) {
        try {
          await operation()
        } catch (error) {
          this.stats.errorRequests++
          return { status: 'error', error: error instanceof Error ? error : new Error(String(error)) }
        }
      }
      const latencyMs = Date.now() - startTime
      this.stats.successfulRequests++
      this.stats.totalLatencyMs += latencyMs
      return { status: 'success', latencyMs }
    }

    // Check if communication is allowed
    const canCommunicate = this.canCommunicate(fromNode, toNode)

    if (!canCommunicate) {
      this.stats.droppedRequests++
      let reason: 'partition' | 'asymmetric' | 'intermittent' = 'partition'
      if (this.config.type === 'asymmetric') reason = 'asymmetric'
      if (this.config.type === 'intermittent') reason = 'intermittent'
      return { status: 'dropped', reason }
    }

    // Communication allowed but possibly degraded
    const startTime = Date.now()
    if (this.config.degradedLatencyMs) {
      await new Promise(resolve => setTimeout(resolve, this.config!.degradedLatencyMs))
    }

    if (operation) {
      try {
        await operation()
      } catch (error) {
        this.stats.errorRequests++
        return { status: 'error', error: error instanceof Error ? error : new Error(String(error)) }
      }
    }

    const latencyMs = Date.now() - startTime
    this.stats.successfulRequests++
    this.stats.totalLatencyMs += latencyMs
    return { status: 'success', latencyMs }
  }

  /**
   * Get partition duration (ms since partition started)
   */
  getPartitionDuration(): number {
    if (!this.partitionStartTime) return 0
    return Date.now() - this.partitionStartTime
  }

  /**
   * Get partition statistics
   */
  getStats(): NetworkPartitionStats {
    return { ...this.stats }
  }

  /**
   * Reset the simulator
   */
  reset(): void {
    this.config = null
    this.partitionStartTime = null
    this.enabled = true
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      droppedRequests: 0,
      timeoutRequests: 0,
      errorRequests: 0,
      totalLatencyMs: 0,
      partitionEvents: 0,
      healEvents: 0,
    }
  }
}

// ============================================================================
// Advanced Latency Profiles
// ============================================================================

/**
 * Type of latency profile
 */
export type LatencyProfileType =
  | 'constant'       // Fixed latency
  | 'uniform'        // Random between min and max
  | 'normal'         // Normal distribution (gaussian)
  | 'spike'          // Normal with periodic spikes
  | 'degrading'      // Gradually increasing latency
  | 'jitter'         // Base latency with random jitter

/**
 * Configuration for latency profiles
 */
export interface LatencyProfileConfig {
  type: LatencyProfileType
  /** Base latency for constant/jitter */
  baseLatencyMs?: number
  /** Min latency for uniform */
  minLatencyMs?: number
  /** Max latency for uniform */
  maxLatencyMs?: number
  /** Mean for normal distribution */
  meanMs?: number
  /** Standard deviation for normal distribution */
  stdDevMs?: number
  /** Spike probability for spike profile (0-1) */
  spikeProbability?: number
  /** Spike multiplier for spike profile */
  spikeMultiplier?: number
  /** Degradation rate (ms per call) for degrading profile */
  degradationRateMs?: number
  /** Max degradation for degrading profile */
  maxDegradationMs?: number
  /** Jitter range (+/- this value) for jitter profile */
  jitterRangeMs?: number
}

/**
 * Statistics for latency injection
 */
export interface LatencyProfileStats {
  totalCalls: number
  totalLatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  avgLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  spikeCount: number
}

/**
 * LatencyProfile - Advanced latency injection with multiple patterns
 *
 * Supports various latency patterns:
 * - Constant: Fixed delay
 * - Uniform: Random between min and max
 * - Normal: Gaussian distribution
 * - Spike: Normal with periodic spikes
 * - Degrading: Gradually increasing latency
 * - Jitter: Base latency with random jitter
 *
 * @example
 * ```typescript
 * const latency = new LatencyProfile({
 *   type: 'spike',
 *   meanMs: 50,
 *   stdDevMs: 10,
 *   spikeProbability: 0.1,
 *   spikeMultiplier: 10
 * })
 *
 * // Apply latency before operations
 * await latency.apply()
 *
 * // Get stats
 * const stats = latency.getStats()
 * console.log(`P99: ${stats.p99LatencyMs}ms`)
 * ```
 */
export class LatencyProfile {
  private config: LatencyProfileConfig
  private enabled = true
  private callCount = 0
  private latencies: number[] = []

  constructor(config: LatencyProfileConfig) {
    this.config = config
  }

  /**
   * Calculate the next latency value based on the profile
   */
  private calculateLatency(): number {
    const {
      type,
      baseLatencyMs = 0,
      minLatencyMs = 0,
      maxLatencyMs = 100,
      meanMs = 50,
      stdDevMs = 10,
      spikeProbability = 0.1,
      spikeMultiplier = 5,
      degradationRateMs = 1,
      maxDegradationMs = 500,
      jitterRangeMs = 10,
    } = this.config

    this.callCount++

    switch (type) {
      case 'constant':
        return baseLatencyMs

      case 'uniform':
        return minLatencyMs + Math.random() * (maxLatencyMs - minLatencyMs)

      case 'normal':
        return this.normalRandom(meanMs, stdDevMs)

      case 'spike': {
        let latency = this.normalRandom(meanMs, stdDevMs)
        if (Math.random() < spikeProbability) {
          latency *= spikeMultiplier
        }
        return Math.max(0, latency)
      }

      case 'degrading': {
        const degradation = Math.min(this.callCount * degradationRateMs, maxDegradationMs)
        return baseLatencyMs + degradation
      }

      case 'jitter': {
        const jitter = (Math.random() * 2 - 1) * jitterRangeMs
        return Math.max(0, baseLatencyMs + jitter)
      }

      default:
        return 0
    }
  }

  /**
   * Generate a normally distributed random number (Box-Muller transform)
   */
  private normalRandom(mean: number, stdDev: number): number {
    const u1 = Math.random()
    const u2 = Math.random()
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
    return Math.max(0, z0 * stdDev + mean)
  }

  /**
   * Apply the latency (delay execution)
   */
  async apply(): Promise<number> {
    if (!this.enabled) return 0

    const latency = this.calculateLatency()
    this.latencies.push(latency)

    if (latency > 0) {
      await new Promise(resolve => setTimeout(resolve, latency))
    }

    return latency
  }

  /**
   * Wrap an operation with latency
   */
  async wrap<T>(operation: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
    const latencyMs = await this.apply()
    const result = await operation()
    return { result, latencyMs }
  }

  /**
   * Enable latency injection
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable latency injection
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get statistics
   */
  getStats(): LatencyProfileStats {
    if (this.latencies.length === 0) {
      return {
        totalCalls: 0,
        totalLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        spikeCount: 0,
      }
    }

    const sorted = [...this.latencies].sort((a, b) => a - b)
    const sum = this.latencies.reduce((a, b) => a + b, 0)

    // Detect spikes (latency > mean + 3*stdDev)
    const mean = sum / this.latencies.length
    const variance = this.latencies.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / this.latencies.length
    const stdDev = Math.sqrt(variance)
    const spikeThreshold = mean + 3 * stdDev
    const spikeCount = this.latencies.filter(l => l > spikeThreshold).length

    return {
      totalCalls: this.latencies.length,
      totalLatencyMs: sum,
      minLatencyMs: sorted[0],
      maxLatencyMs: sorted[sorted.length - 1],
      avgLatencyMs: mean,
      p50LatencyMs: sorted[Math.floor(sorted.length * 0.5)],
      p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)],
      p99LatencyMs: sorted[Math.floor(sorted.length * 0.99)],
      spikeCount,
    }
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.callCount = 0
    this.latencies = []
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LatencyProfileConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// ============================================================================
// Partial Failure Simulator
// ============================================================================

/**
 * Configuration for partial failure scenarios
 */
export interface PartialFailureConfig {
  /** Node/service identifier */
  nodeId: string
  /** Failure probability for reads (0-1) */
  readFailureProbability?: number
  /** Failure probability for writes (0-1) */
  writeFailureProbability?: number
  /** Failure probability for specific operations */
  operationFailureProbabilities?: Record<string, number>
  /** Latency profile for this node */
  latencyProfile?: LatencyProfileConfig
  /** Whether node is in "degraded" mode */
  degraded?: boolean
  /** Capacity reduction when degraded (0-1, e.g., 0.5 = 50% capacity) */
  degradedCapacity?: number
}

/**
 * Result of a partial failure check
 */
export interface PartialFailureResult {
  nodeId: string
  allowed: boolean
  reason?: 'read_failure' | 'write_failure' | 'operation_failure' | 'capacity_exceeded' | 'degraded'
  latencyMs?: number
}

/**
 * Statistics for partial failures
 */
export interface PartialFailureStats {
  totalChecks: number
  readFailures: number
  writeFailures: number
  operationFailures: Record<string, number>
  capacityExceeded: number
  degradedOperations: number
  totalLatencyMs: number
}

/**
 * PartialFailureSimulator - Simulates partial/asymmetric failures
 *
 * Supports:
 * - Per-node failure rates
 * - Different failure rates for reads vs writes
 * - Operation-specific failures
 * - Degraded mode with reduced capacity
 * - Per-node latency profiles
 *
 * @example
 * ```typescript
 * const partial = new PartialFailureSimulator()
 *
 * // Configure a partially failing node
 * partial.configureNode({
 *   nodeId: 'db-replica-1',
 *   readFailureProbability: 0.1,  // 10% read failures
 *   writeFailureProbability: 0.5,  // 50% write failures
 *   degraded: true,
 *   degradedCapacity: 0.3
 * })
 *
 * // Check if operation should succeed
 * const result = partial.checkOperation('db-replica-1', 'write')
 * if (!result.allowed) {
 *   // Handle partial failure
 * }
 * ```
 */
export class PartialFailureSimulator {
  private nodes: Map<string, PartialFailureConfig> = new Map()
  private nodeLatencyProfiles: Map<string, LatencyProfile> = new Map()
  private nodeRequestCounts: Map<string, number> = new Map()
  private enabled = true

  private stats: PartialFailureStats = {
    totalChecks: 0,
    readFailures: 0,
    writeFailures: 0,
    operationFailures: {},
    capacityExceeded: 0,
    degradedOperations: 0,
    totalLatencyMs: 0,
  }

  /**
   * Configure a node with partial failure settings
   */
  configureNode(config: PartialFailureConfig): void {
    this.nodes.set(config.nodeId, config)
    this.nodeRequestCounts.set(config.nodeId, 0)

    if (config.latencyProfile) {
      this.nodeLatencyProfiles.set(config.nodeId, new LatencyProfile(config.latencyProfile))
    }
  }

  /**
   * Remove node configuration
   */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId)
    this.nodeLatencyProfiles.delete(nodeId)
    this.nodeRequestCounts.delete(nodeId)
  }

  /**
   * Check if a read operation should succeed
   */
  async checkRead(nodeId: string): Promise<PartialFailureResult> {
    return this.checkOperation(nodeId, 'read')
  }

  /**
   * Check if a write operation should succeed
   */
  async checkWrite(nodeId: string): Promise<PartialFailureResult> {
    return this.checkOperation(nodeId, 'write')
  }

  /**
   * Check if an operation should succeed
   */
  async checkOperation(
    nodeId: string,
    operationType: 'read' | 'write' | string
  ): Promise<PartialFailureResult> {
    this.stats.totalChecks++

    if (!this.enabled) {
      return { nodeId, allowed: true }
    }

    const config = this.nodes.get(nodeId)
    if (!config) {
      return { nodeId, allowed: true }
    }

    // Check capacity if degraded
    if (config.degraded && config.degradedCapacity !== undefined) {
      const currentCount = (this.nodeRequestCounts.get(nodeId) || 0) + 1
      this.nodeRequestCounts.set(nodeId, currentCount)

      // Simulate capacity by randomly rejecting requests beyond capacity
      if (Math.random() > config.degradedCapacity) {
        this.stats.capacityExceeded++
        this.stats.degradedOperations++
        return { nodeId, allowed: false, reason: 'capacity_exceeded' }
      }
      this.stats.degradedOperations++
    }

    // Check operation-specific failure
    if (config.operationFailureProbabilities?.[operationType] !== undefined) {
      if (Math.random() < config.operationFailureProbabilities[operationType]) {
        if (!this.stats.operationFailures[operationType]) {
          this.stats.operationFailures[operationType] = 0
        }
        this.stats.operationFailures[operationType]++
        return { nodeId, allowed: false, reason: 'operation_failure' }
      }
    }

    // Check read/write specific failure
    if (operationType === 'read' && config.readFailureProbability !== undefined) {
      if (Math.random() < config.readFailureProbability) {
        this.stats.readFailures++
        return { nodeId, allowed: false, reason: 'read_failure' }
      }
    }

    if (operationType === 'write' && config.writeFailureProbability !== undefined) {
      if (Math.random() < config.writeFailureProbability) {
        this.stats.writeFailures++
        return { nodeId, allowed: false, reason: 'write_failure' }
      }
    }

    // Apply latency if configured
    let latencyMs = 0
    const latencyProfile = this.nodeLatencyProfiles.get(nodeId)
    if (latencyProfile) {
      latencyMs = await latencyProfile.apply()
      this.stats.totalLatencyMs += latencyMs
    }

    return { nodeId, allowed: true, latencyMs }
  }

  /**
   * Wrap an operation with partial failure simulation
   */
  async wrapOperation<T>(
    nodeId: string,
    operationType: 'read' | 'write' | string,
    operation: () => Promise<T>
  ): Promise<T> {
    const result = await this.checkOperation(nodeId, operationType)

    if (!result.allowed) {
      throw new Error(`Partial failure: ${result.reason} on node ${nodeId}`)
    }

    return operation()
  }

  /**
   * Enable simulation
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable simulation
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Set node to degraded mode
   */
  setDegraded(nodeId: string, degraded: boolean, capacity?: number): void {
    const config = this.nodes.get(nodeId)
    if (config) {
      config.degraded = degraded
      if (capacity !== undefined) {
        config.degradedCapacity = capacity
      }
    }
  }

  /**
   * Get stats
   */
  getStats(): PartialFailureStats {
    return { ...this.stats }
  }

  /**
   * Get node configuration
   */
  getNodeConfig(nodeId: string): PartialFailureConfig | undefined {
    return this.nodes.get(nodeId)
  }

  /**
   * List all configured nodes
   */
  listNodes(): string[] {
    return Array.from(this.nodes.keys())
  }

  /**
   * Reset all configurations and stats
   */
  reset(): void {
    this.nodes.clear()
    this.nodeLatencyProfiles.clear()
    this.nodeRequestCounts.clear()
    this.enabled = true
    this.stats = {
      totalChecks: 0,
      readFailures: 0,
      writeFailures: 0,
      operationFailures: {},
      capacityExceeded: 0,
      degradedOperations: 0,
      totalLatencyMs: 0,
    }
  }

  /**
   * Reset request counts (useful for testing capacity over time windows)
   */
  resetRequestCounts(): void {
    this.nodeRequestCounts.clear()
  }
}

// ============================================================================
// Split-Brain Simulator
// ============================================================================

/**
 * Configuration for split-brain scenarios
 */
export interface SplitBrainConfig {
  /** Nodes that think they are the leader */
  leaders: string[]
  /** Nodes in each partition (for quorum calculations) */
  partitions: string[][]
  /** Whether to allow writes from minority partition */
  allowMinorityWrites?: boolean
  /** Conflict detection enabled */
  detectConflicts?: boolean
}

/**
 * SplitBrainSimulator - Simulates split-brain scenarios
 *
 * Useful for testing:
 * - Multiple leaders scenario
 * - Quorum-based decisions
 * - Conflict detection and resolution
 *
 * @example
 * ```typescript
 * const splitBrain = new SplitBrainSimulator()
 *
 * splitBrain.configure({
 *   leaders: ['node-1', 'node-3'],  // Two nodes think they're leader
 *   partitions: [['node-1', 'node-2'], ['node-3', 'node-4', 'node-5']],
 *   allowMinorityWrites: false
 * })
 *
 * // Check if write should be accepted
 * const canWrite = splitBrain.canWrite('node-1')
 * ```
 */
export class SplitBrainSimulator {
  private config: SplitBrainConfig | null = null
  private writes: Map<string, { nodeId: string; timestamp: number; data: unknown }[]> = new Map()

  /**
   * Configure split-brain scenario
   */
  configure(config: SplitBrainConfig): void {
    this.config = config
  }

  /**
   * Check if a node is currently a leader
   */
  isLeader(nodeId: string): boolean {
    return this.config?.leaders.includes(nodeId) ?? false
  }

  /**
   * Check if we have split-brain (multiple leaders)
   */
  hasSplitBrain(): boolean {
    return (this.config?.leaders.length ?? 0) > 1
  }

  /**
   * Get the partition containing a node
   */
  getPartition(nodeId: string): string[] | undefined {
    return this.config?.partitions.find(p => p.includes(nodeId))
  }

  /**
   * Check if a partition has quorum (> 50% of total nodes)
   */
  hasQuorum(nodeId: string): boolean {
    if (!this.config) return true

    const partition = this.getPartition(nodeId)
    if (!partition) return false

    const totalNodes = this.config.partitions.flat().length
    return partition.length > totalNodes / 2
  }

  /**
   * Check if a node can accept writes
   */
  canWrite(nodeId: string): boolean {
    if (!this.config) return true

    // Must be a leader to write
    if (!this.isLeader(nodeId)) return false

    // Check quorum requirement
    if (!this.config.allowMinorityWrites && !this.hasQuorum(nodeId)) {
      return false
    }

    return true
  }

  /**
   * Record a write operation (for conflict detection)
   */
  recordWrite(nodeId: string, key: string, data: unknown): void {
    if (!this.writes.has(key)) {
      this.writes.set(key, [])
    }
    this.writes.get(key)!.push({
      nodeId,
      timestamp: Date.now(),
      data,
    })
  }

  /**
   * Detect conflicts for a key
   */
  detectConflicts(key: string): boolean {
    if (!this.config?.detectConflicts) return false

    const keyWrites = this.writes.get(key)
    if (!keyWrites || keyWrites.length < 2) return false

    // Check if writes came from different partitions
    const partitions = new Set<number>()
    for (const write of keyWrites) {
      const partitionIndex = this.config.partitions.findIndex(p => p.includes(write.nodeId))
      if (partitionIndex >= 0) {
        partitions.add(partitionIndex)
      }
    }

    return partitions.size > 1
  }

  /**
   * Get conflicting writes for a key
   */
  getConflictingWrites(key: string): { nodeId: string; timestamp: number; data: unknown }[] {
    return this.writes.get(key) || []
  }

  /**
   * Clear recorded writes
   */
  clearWrites(): void {
    this.writes.clear()
  }

  /**
   * Reset the simulator
   */
  reset(): void {
    this.config = null
    this.writes.clear()
  }
}
