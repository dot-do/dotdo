/**
 * Test Infrastructure Mocks
 *
 * Mock classes for testing clone operations, shard coordination,
 * replica behavior, and enhanced pipeline functionality.
 */

// =============================================================================
// Types
// =============================================================================

export interface CloneOperationOptions {
  /** Progress percentage at which to simulate failure (0-100) */
  failAt?: number
  /** Progress percentage at which to simulate delay (0-100) */
  delayAt?: number
  /** Duration of delay in milliseconds */
  delayMs?: number
}

export type ShardRoutingStrategy = 'hash' | 'range' | 'roundRobin'

export interface ShardMetadata {
  index: number
  id: string
  status: 'healthy' | 'unhealthy' | 'draining'
}

export interface ShardCoordinatorOptions {
  strategy?: ShardRoutingStrategy
}

export interface ReplicaState {
  primaryRef: string
  lag: number
  consistent: boolean
  lastSyncAt: Date
}

export interface EnhancedMockPipelineOptions {
  /** If true, queue events during backpressure instead of rejecting */
  queueOnBackpressure?: boolean
  /** Inherit from base mock pipeline */
  errorOnSend?: Error
  sendDelayMs?: number
}

export type EventMatcher = Record<string, unknown> | ((event: unknown) => boolean)

// =============================================================================
// MockCloneOperation
// =============================================================================

export class MockCloneOperation {
  private options: CloneOperationOptions
  private progress: number = 0
  private progressCallbacks: Array<(progress: number) => void> = []

  constructor(options?: CloneOperationOptions) {
    this.options = options ?? {}
  }

  async execute(): Promise<void> {
    const { failAt, delayAt, delayMs } = this.options

    // Progress from 0 to 100 in steps
    for (let p = 0; p <= 100; p += 10) {
      // Check if we should fail at this progress point
      if (failAt !== undefined && p >= failAt) {
        this.progress = failAt
        this.notifyProgress(failAt)
        throw new Error(`Clone failed at ${failAt}%`)
      }

      // Check if we should delay at this progress point
      if (delayAt !== undefined && delayMs !== undefined && p >= delayAt && p < delayAt + 10) {
        await this.delay(delayMs)
      }

      this.progress = p
      this.notifyProgress(p)
    }

    this.progress = 100
    this.notifyProgress(100)
  }

  getProgress(): number {
    return this.progress
  }

  onProgress(callback: (progress: number) => void): void {
    this.progressCallbacks.push(callback)
  }

  reset(): void {
    this.progress = 0
    this.progressCallbacks = []
  }

  setOptions(options: CloneOperationOptions): void {
    this.options = options
  }

  private notifyProgress(progress: number): void {
    for (const callback of this.progressCallbacks) {
      callback(progress)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export function createMockCloneOperation(
  options?: CloneOperationOptions
): MockCloneOperation {
  return new MockCloneOperation(options)
}

// =============================================================================
// MockShardCoordinator
// =============================================================================

export class MockShardCoordinator {
  private shardCount: number
  private strategy: ShardRoutingStrategy
  private shards: ShardMetadata[]
  private roundRobinCounter: number = 0

  constructor(shardCount: number, options?: ShardCoordinatorOptions) {
    if (shardCount < 1) {
      throw new Error('Shard count must be at least 1')
    }

    this.shardCount = shardCount
    this.strategy = options?.strategy ?? 'hash'
    this.shards = Array.from({ length: shardCount }, (_, i) => ({
      index: i,
      id: `shard-${i}`,
      status: 'healthy' as const,
    }))
  }

  route(id: string): number {
    switch (this.strategy) {
      case 'hash':
        return this.hashRoute(id)
      case 'range':
        return this.rangeRoute(id)
      case 'roundRobin':
        return this.roundRobinRoute()
      default:
        return this.hashRoute(id)
    }
  }

  getStrategy(): ShardRoutingStrategy {
    return this.strategy
  }

  getShards(): ShardMetadata[] {
    return [...this.shards]
  }

  setShardStatus(index: number, status: 'healthy' | 'unhealthy'): void {
    if (index < 0 || index >= this.shardCount) {
      throw new Error('Invalid shard index')
    }
    this.shards[index].status = status
  }

  private hashRoute(id: string): number {
    // Simple hash function
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash) % this.shardCount
  }

  private rangeRoute(id: string): number {
    // Route based on first character's position in alphabet
    if (id.length === 0) {
      return 0
    }
    const firstChar = id.toLowerCase().charCodeAt(0)
    // Map a-z (97-122) to 0-25, then distribute across shards
    const charIndex = Math.max(0, Math.min(25, firstChar - 97))
    const rangeSize = Math.ceil(26 / this.shardCount)
    return Math.min(Math.floor(charIndex / rangeSize), this.shardCount - 1)
  }

  private roundRobinRoute(): number {
    const shard = this.roundRobinCounter % this.shardCount
    this.roundRobinCounter++
    return shard
  }
}

export function createMockShardCoordinator(
  shardCount: number,
  options?: ShardCoordinatorOptions
): MockShardCoordinator {
  return new MockShardCoordinator(shardCount, options)
}

// =============================================================================
// MockReplica
// =============================================================================

export class MockReplica {
  private primaryRef: string
  private lag: number = 0
  private consistent: boolean = true
  private lastSyncAt: Date = new Date()

  constructor(primaryRef: string) {
    this.primaryRef = primaryRef
  }

  setLag(ms: number): void {
    this.lag = ms
    this.consistent = false
  }

  getLag(): number {
    return this.lag
  }

  async sync(): Promise<void> {
    if (this.consistent) {
      // No-op when already consistent
      return
    }

    // Wait for lag duration
    if (this.lag > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.lag))
    }

    this.consistent = true
    this.lastSyncAt = new Date()
  }

  getState(): ReplicaState {
    return {
      primaryRef: this.primaryRef,
      lag: this.lag,
      consistent: this.consistent,
      lastSyncAt: this.lastSyncAt,
    }
  }

  isConsistent(): boolean {
    return this.consistent
  }

  simulateWrite(): void {
    this.consistent = false
    // Apply default lag if none set, or keep existing lag
    if (this.lag === 0) {
      this.lag = 10 // Default lag on write
    }
  }
}

export function createMockReplica(primaryRef: string): MockReplica {
  return new MockReplica(primaryRef)
}

// =============================================================================
// EnhancedMockPipeline
// =============================================================================

export interface EnhancedMockPipeline {
  events: unknown[]
  send(events: unknown[]): Promise<void>
  clear(): void
  setError(error: Error | null): void
  setDelay(ms: number): void
  getBatches(): unknown[][]
  getLastBatch(): unknown[] | undefined
  assertEventSent(matcher: EventMatcher): void
  assertNoEvents(): void
  setBackpressure(enabled: boolean): void
  hasBackpressure(): boolean
  getQueuedEvents(): unknown[]
  flushQueue(): Promise<void>
}

export function createEnhancedMockPipeline(
  options?: EnhancedMockPipelineOptions
): EnhancedMockPipeline {
  const events: unknown[] = []
  const batches: unknown[][] = []
  const queuedEvents: unknown[] = []
  let backpressure = false
  let error: Error | null = options?.errorOnSend ?? null
  let delay: number = options?.sendDelayMs ?? 0
  const queueOnBackpressure = options?.queueOnBackpressure ?? false

  return {
    events,

    async send(newEvents: unknown[]): Promise<void> {
      if (error) {
        throw error
      }

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      if (backpressure) {
        if (queueOnBackpressure) {
          // Queue events instead of rejecting
          queuedEvents.push(...newEvents)
          return
        }
        throw new Error('Pipeline backpressure')
      }

      events.push(...newEvents)
      batches.push([...newEvents])
    },

    clear(): void {
      events.length = 0
      batches.length = 0
      queuedEvents.length = 0
      backpressure = false
    },

    setError(newError: Error | null): void {
      error = newError
    },

    setDelay(ms: number): void {
      delay = ms
    },

    getBatches(): unknown[][] {
      return [...batches]
    },

    getLastBatch(): unknown[] | undefined {
      if (batches.length === 0) {
        return undefined
      }
      return batches[batches.length - 1]
    },

    assertEventSent(matcher: EventMatcher): void {
      const isMatch = (event: unknown): boolean => {
        if (typeof matcher === 'function') {
          return matcher(event)
        }
        // Partial object matching
        if (typeof event !== 'object' || event === null) {
          return false
        }
        const eventObj = event as Record<string, unknown>
        for (const key of Object.keys(matcher)) {
          if (eventObj[key] !== matcher[key]) {
            return false
          }
        }
        return true
      }

      const found = events.some(isMatch)
      if (!found) {
        const matcherDesc = typeof matcher === 'function' ? 'function' : JSON.stringify(matcher)
        throw new Error(
          `Expected event matching ${matcherDesc} but found ${events.length} events`
        )
      }
    },

    assertNoEvents(): void {
      if (events.length > 0) {
        throw new Error(`Expected no events but found ${events.length}`)
      }
    },

    setBackpressure(enabled: boolean): void {
      backpressure = enabled
    },

    hasBackpressure(): boolean {
      return backpressure
    },

    getQueuedEvents(): unknown[] {
      return [...queuedEvents]
    },

    async flushQueue(): Promise<void> {
      if (queuedEvents.length > 0 && !backpressure) {
        events.push(...queuedEvents)
        batches.push([...queuedEvents])
        queuedEvents.length = 0
      }
    },
  }
}
