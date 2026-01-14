/**
 * ShardRouter - Routes requests to appropriate DO shards based on partition key
 *
 * Supports multiple routing strategies:
 * - Hash-based: Consistent distribution using hash of partition key
 * - Consistent hash: Minimizes redistribution when shards change
 * - Range-based: Routes based on key ranges (time, alphabetic)
 *
 * @module objects/unified-storage/shard-router
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * DurableObject-like ID interface
 */
export interface DurableObjectId {
  toString(): string
  name?: string
}

/**
 * DurableObject-like stub interface
 */
export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * DurableObject namespace interface
 */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

/**
 * Range definition for range-based routing
 */
export interface RangeDefinition<T = string | number> {
  start: T
  end: T
  shard: number
}

/**
 * Generic range definition for RangeRouter
 */
export interface GenericRange<T = string, V = string> {
  start: T
  end: T
  value: V
}

/**
 * Retry configuration for forward operations
 */
export interface RetryConfig {
  maxRetries: number
  retryDelayMs: number
  retryableStatuses: number[]
}

/**
 * Shard info returned by getShardInfo
 */
export interface ShardInfo {
  shardIndex: number
  shardName: string
}

/**
 * ShardRouter configuration
 */
export interface ShardRouterConfig {
  namespace: DurableObjectNamespace
  shardCount?: number
  strategy: 'hash' | 'consistent-hash' | 'range'
  virtualNodes?: number
  ranges?: RangeDefinition[]
  defaultShard?: number
  comparator?: (key: string) => string | number
  shardNamePrefix?: string
  retryConfig?: RetryConfig
  addRoutingHeaders?: boolean
  enableMetrics?: boolean
}

/**
 * Metrics for ShardRouter
 */
export interface ShardRouterMetrics {
  routingOperations: number
  forwardOperations: number
  averageLatencyMs: number
  errorCount: number
  shardDistribution: Map<number, number>
}

/**
 * Aggregation options for scatter-gather
 */
export interface AggregateOptions<T> {
  aggregate: (responses: Record<string, unknown>[]) => T
}

// ============================================================================
// CONSISTENT HASH RING
// ============================================================================

/**
 * Configuration for ConsistentHashRing
 */
export interface ConsistentHashRingConfig {
  nodes: string[]
  virtualNodes?: number
}

/**
 * ConsistentHashRing - Implements consistent hashing with virtual nodes
 *
 * Provides minimal redistribution when nodes are added or removed.
 * Virtual nodes improve distribution uniformity.
 */
export class ConsistentHashRing {
  private ring: Map<number, string> = new Map()
  private sortedKeys: number[] = []
  private readonly virtualNodes: number
  private nodes: Set<string>

  constructor(config: ConsistentHashRingConfig) {
    this.virtualNodes = config.virtualNodes ?? 100
    this.nodes = new Set()

    for (const node of config.nodes) {
      this.addNode(node)
    }
  }

  /**
   * Add a node to the ring with virtual nodes
   */
  addNode(node: string): void {
    if (this.nodes.has(node)) return

    this.nodes.add(node)

    for (let i = 0; i < this.virtualNodes; i++) {
      // Use multiple hash variations for better distribution
      const virtualKey = `${node}#${i}`
      const hash = this.hash(virtualKey)
      this.ring.set(hash, node)
    }

    this.rebuildSortedKeys()
  }

  /**
   * Remove a node from the ring
   */
  removeNode(node: string): void {
    if (!this.nodes.has(node)) return

    this.nodes.delete(node)

    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${node}#${i}`
      const hash = this.hash(virtualKey)
      this.ring.delete(hash)
    }

    this.rebuildSortedKeys()
  }

  /**
   * Get the node responsible for a given key
   */
  getNode(key: string): string {
    if (this.sortedKeys.length === 0) {
      throw new Error('No nodes in ring')
    }

    const hash = this.hash(key)

    // Find the first node with hash >= key hash
    let left = 0
    let right = this.sortedKeys.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.sortedKeys[mid] < hash) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    // Wrap around if we're past the last node
    const idx = left === this.sortedKeys.length ? 0 : left
    return this.ring.get(this.sortedKeys[idx])!
  }

  /**
   * MurmurHash3-like hash function for better distribution
   * This provides more uniform distribution than FNV-1a
   */
  private hash(key: string): number {
    let h1 = 0xdeadbeef
    const c1 = 0xcc9e2d51
    const c2 = 0x1b873593

    for (let i = 0; i < key.length; i++) {
      let k1 = key.charCodeAt(i)

      k1 = Math.imul(k1, c1)
      k1 = (k1 << 15) | (k1 >>> 17)
      k1 = Math.imul(k1, c2)

      h1 ^= k1
      h1 = (h1 << 13) | (h1 >>> 19)
      h1 = Math.imul(h1, 5) + 0xe6546b64
    }

    // Finalization
    h1 ^= key.length
    h1 ^= h1 >>> 16
    h1 = Math.imul(h1, 0x85ebca6b)
    h1 ^= h1 >>> 13
    h1 = Math.imul(h1, 0xc2b2ae35)
    h1 ^= h1 >>> 16

    return h1 >>> 0 // Convert to unsigned 32-bit
  }

  private rebuildSortedKeys(): void {
    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b)
  }
}

// ============================================================================
// RANGE ROUTER
// ============================================================================

/**
 * Configuration for RangeRouter
 */
export interface RangeRouterConfig<T = string, V = string> {
  ranges: GenericRange<T, V>[]
  defaultValue?: V
  comparator?: (key: string) => T
}

/**
 * RangeRouter - Routes based on key ranges
 *
 * Supports string (alphabetic), numeric, and time-based ranges.
 */
export class RangeRouter<T = string, V = string> {
  private readonly ranges: GenericRange<T, V>[]
  private readonly defaultValue: V | undefined
  private readonly comparator: (key: string) => T

  constructor(config: RangeRouterConfig<T, V>) {
    this.ranges = [...config.ranges].sort((a, b) => {
      if (a.start < b.start) return -1
      if (a.start > b.start) return 1
      return 0
    })
    this.defaultValue = config.defaultValue
    this.comparator = config.comparator ?? ((key: string) => key as unknown as T)
  }

  /**
   * Look up the value for a key
   * Range is [start, end) - start inclusive, end exclusive
   * For string keys, the first character is compared against range boundaries
   * Special case: the last range includes its end boundary to cover remaining values
   */
  lookup(key: string): V | undefined {
    const comparableKey = this.comparator(key)

    for (let i = 0; i < this.ranges.length; i++) {
      const range = this.ranges[i]
      const isLastRange = i === this.ranges.length - 1

      // Check if it's a single-character alphabetic range
      const isSingleCharRange =
        typeof range.start === 'string' &&
        typeof range.end === 'string' &&
        (range.start as string).length === 1 &&
        (range.end as string).length === 1

      if (isSingleCharRange && typeof comparableKey === 'string') {
        // For single-char ranges, compare first character with half-open interval
        // Exception: last range includes the end character
        const firstChar = (comparableKey as string).charAt(0)
        const endComparison = isLastRange ? firstChar <= range.end : firstChar < range.end
        if (firstChar >= range.start && endComparison) {
          return range.value
        }
      } else {
        // Standard half-open interval [start, end)
        if (comparableKey >= range.start && comparableKey < range.end) {
          return range.value
        }
      }
    }

    return this.defaultValue
  }
}

// ============================================================================
// SHARD ROUTER
// ============================================================================

/**
 * ShardRouter - Routes requests to appropriate DO shards
 *
 * @example
 * ```typescript
 * const router = new ShardRouter({
 *   namespace: env.DO,
 *   shardCount: 16,
 *   strategy: 'hash',
 * })
 *
 * // Get shard for a key
 * const shardIndex = router.getShardIndex('customer-12345')
 *
 * // Forward a request
 * const response = await router.forward('customer-12345', request)
 *
 * // Scatter-gather across all shards
 * const responses = await router.scatterGather(request)
 * ```
 */
export class ShardRouter {
  private readonly namespace: DurableObjectNamespace
  private readonly shardCount: number
  private readonly strategy: 'hash' | 'consistent-hash' | 'range'
  private readonly virtualNodes: number
  private readonly shardNamePrefix: string
  private readonly retryConfig?: RetryConfig
  private readonly addRoutingHeaders: boolean
  private readonly enableMetrics: boolean
  private readonly defaultShard: number

  // Strategy-specific implementations
  private readonly consistentHashRing?: ConsistentHashRing
  private readonly rangeRouter?: RangeRouter<string | number, number>
  private readonly comparator?: (key: string) => string | number

  // Stub cache
  private readonly stubCache: Map<number, DurableObjectStub> = new Map()

  // Metrics
  private metrics: {
    routingOperations: number
    forwardOperations: number
    totalLatencyMs: number
    errorCount: number
    shardDistribution: Map<number, number>
  }

  constructor(config: ShardRouterConfig) {
    // Validate config
    this.validateConfig(config)

    this.namespace = config.namespace
    this.strategy = config.strategy
    this.virtualNodes = config.virtualNodes ?? 100
    this.shardNamePrefix = config.shardNamePrefix ?? 'shard-'
    this.retryConfig = config.retryConfig
    this.addRoutingHeaders = config.addRoutingHeaders ?? false
    this.enableMetrics = config.enableMetrics ?? false
    this.comparator = config.comparator
    this.defaultShard = config.defaultShard ?? 0

    // Initialize metrics
    this.metrics = {
      routingOperations: 0,
      forwardOperations: 0,
      totalLatencyMs: 0,
      errorCount: 0,
      shardDistribution: new Map(),
    }

    // Strategy-specific setup
    if (config.strategy === 'range') {
      this.shardCount = this.getMaxShardFromRanges(config.ranges!) + 1
      // Handle the default shard
      const maxShard = Math.max(this.shardCount - 1, config.defaultShard ?? 0)
      this.shardCount = maxShard + 1

      this.rangeRouter = new RangeRouter<string | number, number>({
        ranges: config.ranges!.map((r) => ({
          start: r.start,
          end: r.end,
          value: r.shard,
        })),
        defaultValue: config.defaultShard,
        comparator: config.comparator,
      })
    } else {
      this.shardCount = config.shardCount!
    }

    if (config.strategy === 'consistent-hash') {
      const nodes = Array.from({ length: this.shardCount }, (_, i) => `${this.shardNamePrefix}${i}`)
      this.consistentHashRing = new ConsistentHashRing({
        nodes,
        virtualNodes: this.virtualNodes,
      })
    }
  }

  private validateConfig(config: ShardRouterConfig): void {
    const validStrategies = ['hash', 'consistent-hash', 'range']
    if (!validStrategies.includes(config.strategy)) {
      throw new Error(`Invalid strategy: ${config.strategy}. Must be one of: ${validStrategies.join(', ')}`)
    }

    if (config.strategy === 'range') {
      if (!config.ranges || config.ranges.length === 0) {
        throw new Error('Range strategy requires ranges to be defined')
      }
    } else {
      if (!config.shardCount || config.shardCount < 1) {
        throw new Error('shardCount must be a positive integer')
      }
    }
  }

  private getMaxShardFromRanges(ranges: RangeDefinition[]): number {
    return Math.max(...ranges.map((r) => r.shard))
  }

  /**
   * Get the shard index for a partition key
   */
  getShardIndex(partitionKey: string): number {
    if (this.enableMetrics) {
      this.metrics.routingOperations++
    }

    let shardIndex: number

    switch (this.strategy) {
      case 'hash':
        shardIndex = this.hashRoute(partitionKey)
        break
      case 'consistent-hash':
        shardIndex = this.consistentHashRoute(partitionKey)
        break
      case 'range':
        shardIndex = this.rangeRoute(partitionKey)
        break
      default:
        throw new Error(`Unknown strategy: ${this.strategy}`)
    }

    if (this.enableMetrics) {
      const count = this.metrics.shardDistribution.get(shardIndex) ?? 0
      this.metrics.shardDistribution.set(shardIndex, count + 1)
    }

    return shardIndex
  }

  /**
   * Simple modulo hash routing
   */
  private hashRoute(key: string): number {
    const hash = this.simpleHash(key)
    return hash % this.shardCount
  }

  /**
   * Consistent hash routing
   */
  private consistentHashRoute(key: string): number {
    const nodeName = this.consistentHashRing!.getNode(key)
    // Extract shard index from node name (e.g., "shard-5" -> 5)
    const match = nodeName.match(/(\d+)$/)
    if (match) {
      return parseInt(match[1], 10)
    }
    return 0
  }

  /**
   * Range-based routing
   */
  private rangeRoute(key: string): number {
    const result = this.rangeRouter!.lookup(key)
    return result ?? this.defaultShard
  }

  /**
   * Simple hash function (FNV-1a)
   */
  private simpleHash(key: string): number {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0 // Convert to unsigned 32-bit
  }

  /**
   * Get the DO stub for a partition key
   */
  getStub(partitionKey: string): DurableObjectStub {
    const shardIndex = this.getShardIndex(partitionKey)
    return this.getStubByIndex(shardIndex)
  }

  /**
   * Get a stub by shard index (with caching)
   */
  private getStubByIndex(shardIndex: number): DurableObjectStub {
    if (this.stubCache.has(shardIndex)) {
      return this.stubCache.get(shardIndex)!
    }

    const shardName = `${this.shardNamePrefix}${shardIndex}`
    const id = this.namespace.idFromName(shardName)
    const stub = this.namespace.get(id)

    this.stubCache.set(shardIndex, stub)
    return stub
  }

  /**
   * Get all shard stubs for scatter-gather queries
   */
  getAllStubs(): DurableObjectStub[] {
    const stubs: DurableObjectStub[] = []
    for (let i = 0; i < this.shardCount; i++) {
      stubs.push(this.getStubByIndex(i))
    }
    return stubs
  }

  /**
   * Get shard info for a partition key
   */
  getShardInfo(partitionKey: string): ShardInfo {
    const shardIndex = this.getShardIndex(partitionKey)
    return {
      shardIndex,
      shardName: `${this.shardNamePrefix}${shardIndex}`,
    }
  }

  /**
   * Forward a request to the correct shard
   */
  async forward(partitionKey: string, request: Request): Promise<Response> {
    const startTime = this.enableMetrics ? performance.now() : 0

    if (this.enableMetrics) {
      this.metrics.forwardOperations++
    }

    const stub = this.getStub(partitionKey)
    const forwardRequest = this.prepareForwardRequest(partitionKey, request)

    try {
      const response = await this.executeWithRetry(stub, forwardRequest)

      if (this.enableMetrics) {
        const latency = performance.now() - startTime
        this.metrics.totalLatencyMs += latency
      }

      return response
    } catch (error) {
      if (this.enableMetrics) {
        this.metrics.errorCount++
      }
      throw error
    }
  }

  /**
   * Prepare the request for forwarding
   */
  private prepareForwardRequest(partitionKey: string, request: Request): Request {
    if (!this.addRoutingHeaders) {
      return request.clone()
    }

    const headers = new Headers(request.headers)
    const shardInfo = this.getShardInfo(partitionKey)
    headers.set('X-Shard-Index', shardInfo.shardIndex.toString())
    headers.set('X-Shard-Name', shardInfo.shardName)
    headers.set('X-Partition-Key', partitionKey)

    return new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect,
    })
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(stub: DurableObjectStub, request: Request): Promise<Response> {
    if (!this.retryConfig) {
      return stub.fetch(request)
    }

    let lastError: Error | undefined
    let lastResponse: Response | undefined

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await stub.fetch(request.clone())

        if (!this.retryConfig.retryableStatuses.includes(response.status)) {
          return response
        }

        lastResponse = response

        if (attempt < this.retryConfig.maxRetries) {
          await this.sleep(this.retryConfig.retryDelayMs)
        }
      } catch (error) {
        lastError = error as Error
        if (attempt < this.retryConfig.maxRetries) {
          await this.sleep(this.retryConfig.retryDelayMs)
        }
      }
    }

    if (lastResponse) {
      return lastResponse
    }

    throw lastError ?? new Error('Request failed after retries')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Scatter-gather: Send request to all shards
   */
  async scatterGather(request: Request): Promise<Response[]> {
    const stubs = this.getAllStubs()
    const promises = stubs.map((stub) => stub.fetch(request.clone()))
    return Promise.all(promises)
  }

  /**
   * Scatter-gather with aggregation
   */
  async scatterGatherAggregate<T>(request: Request, options: AggregateOptions<T>): Promise<T> {
    const responses = await this.scatterGather(request)
    const data = await Promise.all(responses.map((r) => r.json() as Promise<Record<string, unknown>>))
    return options.aggregate(data)
  }

  /**
   * Get the current configuration
   */
  getConfig(): { shardCount: number; strategy: string; virtualNodes: number } {
    return {
      shardCount: this.shardCount,
      strategy: this.strategy,
      virtualNodes: this.virtualNodes,
    }
  }

  /**
   * Get metrics (if enabled)
   */
  getMetrics(): ShardRouterMetrics {
    const avgLatency =
      this.metrics.forwardOperations > 0 ? this.metrics.totalLatencyMs / this.metrics.forwardOperations : 0

    return {
      routingOperations: this.metrics.routingOperations,
      forwardOperations: this.metrics.forwardOperations,
      averageLatencyMs: avgLatency,
      errorCount: this.metrics.errorCount,
      shardDistribution: new Map(this.metrics.shardDistribution),
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      routingOperations: 0,
      forwardOperations: 0,
      totalLatencyMs: 0,
      errorCount: 0,
      shardDistribution: new Map(),
    }
  }
}
