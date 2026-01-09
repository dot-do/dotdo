/**
 * VectorSearchCoordinator - Distributed Vector Search Orchestration
 *
 * The coordinator handles scatter-gather vector search across multiple shards:
 * - Scatters queries to all shards in parallel
 * - Gathers and merges results by score
 * - Handles shard failures, timeouts, deduplication
 * - Implements circuit breaker pattern for unhealthy shards
 * - Tracks latency metrics per shard
 *
 * @see tests/vector/search-coordinator.test.ts for expected behavior
 * @module db/vector/search-coordinator
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result from a single shard search operation
 */
export interface ShardSearchResult {
  /** Matched results from the shard */
  results: Array<{
    id: string
    score: number
    metadata?: Record<string, unknown>
  }>
  /** Number of vectors scanned during search */
  vectorsScanned: number
  /** Time taken for the search in milliseconds */
  searchTimeMs: number
}

/**
 * Shard health status
 */
export interface ShardHealthStatus {
  /** Whether the shard is healthy */
  healthy: boolean
  /** Number of vectors in the shard */
  vectorCount: number
  /** Timestamp of last update */
  lastUpdated: number
}

/**
 * Stub interface representing a vector shard
 */
export interface ShardStub {
  /** Unique identifier for the shard */
  shardId: string
  /** Execute a vector search on this shard */
  search(
    query: Float32Array,
    k: number,
    options?: { filter?: Record<string, unknown> }
  ): Promise<ShardSearchResult>
  /** Check shard health */
  health(): Promise<ShardHealthStatus>
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number
  /** Time in ms before attempting to close circuit */
  resetTimeMs: number
}

/**
 * Circuit breaker state for a shard
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Configuration for the search coordinator
 */
export interface SearchCoordinatorConfig {
  /** List of shard stubs to query */
  shards: ShardStub[]
  /** Timeout for shard queries in milliseconds */
  timeoutMs: number
  /** Circuit breaker configuration (optional) */
  circuitBreaker?: CircuitBreakerConfig
}

/**
 * Options for a coordinated search
 */
export interface CoordinatedSearchOptions {
  /** Minimum score threshold for results */
  minScore?: number
  /** Metadata filter to pass to shards */
  filter?: Record<string, unknown>
}

/**
 * Metrics for a single shard's performance
 */
export interface ShardMetrics {
  /** Shard identifier */
  shardId: string
  /** Latency in milliseconds */
  latencyMs: number
  /** Number of vectors scanned */
  vectorsScanned: number
  /** Whether the shard responded successfully */
  success: boolean
}

/**
 * Latency statistics across all shards
 */
export interface LatencyStats {
  /** Minimum latency */
  min: number
  /** Maximum latency */
  max: number
  /** Average latency */
  avg: number
  /** 50th percentile */
  p50: number
  /** 95th percentile */
  p95: number
  /** 99th percentile */
  p99: number
}

/**
 * Timing breakdown for the search operation
 */
export interface TimingBreakdown {
  /** Time to scatter queries to shards */
  scatterMs: number
  /** Time to gather responses */
  gatherMs: number
  /** Time to merge and sort results */
  mergeMs: number
  /** Total time */
  totalMs: number
}

/**
 * Information about a failed shard
 */
export interface FailedShardInfo {
  /** Shard identifier */
  shardId: string
  /** Error message */
  error: string
}

/**
 * A single result from the coordinated search
 */
export interface CoordinatedSearchMatch {
  /** Vector ID */
  id: string
  /** Similarity score */
  score: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
  /** Which shard the result came from */
  sourceShard: string
}

/**
 * Result of a coordinated search across all shards
 */
export interface CoordinatedSearchResult {
  /** Merged and sorted results */
  results: CoordinatedSearchMatch[]
  /** Whether the result is partial (some shards failed/timed out) */
  partial?: boolean
  /** List of shards that failed */
  failedShards?: FailedShardInfo[]
  /** List of shards that timed out */
  timedOutShards?: string[]
  /** List of shards skipped due to circuit breaker */
  skippedShards?: string[]
  /** Number of duplicate results that were merged */
  totalDeduplicated?: number
  /** Number of results filtered by score threshold */
  filteredByThreshold?: number
  /** Total latency in milliseconds */
  totalLatencyMs: number
  /** Per-shard metrics */
  shardMetrics?: ShardMetrics[]
  /** Aggregate latency statistics */
  latencyStats?: LatencyStats
  /** Total vectors scanned across all shards */
  totalVectorsScanned?: number
  /** Timing breakdown */
  timingBreakdown?: TimingBreakdown
  /** Circuit breaker states for each shard */
  circuitBreakerStates?: Record<string, CircuitBreakerState>
}

// ============================================================================
// CIRCUIT BREAKER INTERNAL STATE
// ============================================================================

interface CircuitBreakerInternalState {
  state: CircuitBreakerState
  failureCount: number
  lastFailureTime: number
  lastStateChangeTime: number
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * VectorSearchCoordinator orchestrates distributed vector search
 */
export class VectorSearchCoordinator {
  private config: SearchCoordinatorConfig
  private circuitBreakers: Map<string, CircuitBreakerInternalState>

  constructor(config: SearchCoordinatorConfig) {
    // Validate config
    if (!config.shards || config.shards.length === 0) {
      throw new Error('At least one shard must be configured')
    }

    this.config = config
    this.circuitBreakers = new Map()

    // Initialize circuit breakers for each shard
    for (const shard of config.shards) {
      this.circuitBreakers.set(shard.shardId, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        lastStateChangeTime: Date.now(),
      })
    }
  }

  /**
   * Execute a distributed vector search across all shards
   */
  async search(
    query: Float32Array,
    k: number,
    options?: CoordinatedSearchOptions
  ): Promise<CoordinatedSearchResult> {
    const totalStartTime = Date.now()

    // Validate query
    if (query.length === 0) {
      throw new Error('Invalid query: empty vector')
    }

    // Early return for k=0
    if (k === 0) {
      return {
        results: [],
        totalLatencyMs: Date.now() - totalStartTime,
      }
    }

    // Update circuit breaker states (check for half-open transitions)
    this.updateCircuitBreakerStates()

    // Determine which shards to query
    const shardsToQuery: ShardStub[] = []
    const skippedShards: string[] = []

    for (const shard of this.config.shards) {
      const cbState = this.circuitBreakers.get(shard.shardId)!
      if (cbState.state === 'open') {
        skippedShards.push(shard.shardId)
      } else {
        shardsToQuery.push(shard)
      }
    }

    // Scatter phase - query all eligible shards in parallel
    const scatterStartTime = Date.now()

    const shardPromises = shardsToQuery.map(shard =>
      this.queryShardWithTimeout(shard, query, k, options)
    )

    const scatterMs = Date.now() - scatterStartTime

    // Gather phase - wait for all results
    const gatherStartTime = Date.now()
    const shardResults = await Promise.all(shardPromises)
    const gatherMs = Date.now() - gatherStartTime

    // Merge phase - combine, deduplicate, sort, and filter results
    const mergeStartTime = Date.now()

    const allResults: CoordinatedSearchMatch[] = []
    const failedShards: FailedShardInfo[] = []
    const timedOutShards: string[] = []
    const shardMetrics: ShardMetrics[] = []
    let totalVectorsScanned = 0

    for (const shardResult of shardResults) {
      shardMetrics.push({
        shardId: shardResult.shardId,
        latencyMs: shardResult.latencyMs,
        vectorsScanned: shardResult.vectorsScanned,
        success: shardResult.success,
      })

      if (shardResult.timedOut) {
        timedOutShards.push(shardResult.shardId)
      } else if (shardResult.error) {
        failedShards.push({
          shardId: shardResult.shardId,
          error: shardResult.error,
        })
      } else {
        totalVectorsScanned += shardResult.vectorsScanned
        for (const result of shardResult.results) {
          allResults.push({
            id: result.id,
            score: result.score,
            metadata: result.metadata,
            sourceShard: shardResult.shardId,
          })
        }
      }
    }

    // Deduplicate by ID, keeping highest score
    const deduplicatedResults = this.deduplicateResults(allResults)
    const totalDeduplicated = allResults.length - deduplicatedResults.length

    // Sort by score descending
    deduplicatedResults.sort((a, b) => b.score - a.score)

    // Apply score threshold filter
    let filteredByThreshold = 0
    let filteredResults = deduplicatedResults
    if (options?.minScore !== undefined) {
      const beforeCount = filteredResults.length
      filteredResults = filteredResults.filter(r => r.score >= options.minScore!)
      filteredByThreshold = beforeCount - filteredResults.length
    }

    // Apply k limit
    const finalResults = filteredResults.slice(0, k)

    const mergeMs = Date.now() - mergeStartTime
    const totalLatencyMs = Date.now() - totalStartTime

    // Determine if result is partial
    const partial = failedShards.length > 0 || timedOutShards.length > 0 || skippedShards.length > 0

    // Calculate latency statistics
    const latencyStats = this.calculateLatencyStats(shardMetrics)

    // Build circuit breaker states for response
    const circuitBreakerStates: Record<string, CircuitBreakerState> = {}
    for (const [shardId, cbState] of this.circuitBreakers) {
      circuitBreakerStates[shardId] = cbState.state
    }

    // Build timing breakdown
    const timingBreakdown: TimingBreakdown = {
      scatterMs,
      gatherMs,
      mergeMs,
      totalMs: totalLatencyMs,
    }

    return {
      results: finalResults,
      partial: partial || undefined,
      failedShards: failedShards.length > 0 ? failedShards : undefined,
      timedOutShards: timedOutShards.length > 0 ? timedOutShards : undefined,
      skippedShards: skippedShards.length > 0 ? skippedShards : undefined,
      totalDeduplicated: totalDeduplicated > 0 ? totalDeduplicated : undefined,
      filteredByThreshold: filteredByThreshold > 0 ? filteredByThreshold : undefined,
      totalLatencyMs,
      shardMetrics,
      latencyStats,
      totalVectorsScanned,
      timingBreakdown,
      circuitBreakerStates,
    }
  }

  /**
   * Query a single shard with timeout handling
   */
  private async queryShardWithTimeout(
    shard: ShardStub,
    query: Float32Array,
    k: number,
    options?: CoordinatedSearchOptions
  ): Promise<{
    shardId: string
    results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>
    vectorsScanned: number
    latencyMs: number
    success: boolean
    error?: string
    timedOut?: boolean
  }> {
    const startTime = Date.now()
    const cbState = this.circuitBreakers.get(shard.shardId)!

    try {
      // Create search promise
      const searchPromise = shard.search(query, k, { filter: options?.filter })

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT'))
        }, this.config.timeoutMs)
      })

      // Race between search and timeout
      const result = await Promise.race([searchPromise, timeoutPromise])
      const latencyMs = Date.now() - startTime

      // Success - update circuit breaker
      this.recordSuccess(shard.shardId)

      return {
        shardId: shard.shardId,
        results: result.results,
        vectorsScanned: result.vectorsScanned,
        latencyMs,
        success: true,
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isTimeout = errorMessage === 'TIMEOUT'

      // Record failure for circuit breaker
      this.recordFailure(shard.shardId)

      return {
        shardId: shard.shardId,
        results: [],
        vectorsScanned: 0,
        latencyMs,
        success: false,
        error: isTimeout ? undefined : errorMessage,
        timedOut: isTimeout,
      }
    }
  }

  /**
   * Record a successful request for circuit breaker
   */
  private recordSuccess(shardId: string): void {
    const cbState = this.circuitBreakers.get(shardId)!

    // If in half-open state, close the circuit
    if (cbState.state === 'half-open') {
      cbState.state = 'closed'
      cbState.lastStateChangeTime = Date.now()
    }

    // Reset failure count on success
    cbState.failureCount = 0
  }

  /**
   * Record a failed request for circuit breaker
   */
  private recordFailure(shardId: string): void {
    const cbState = this.circuitBreakers.get(shardId)!

    cbState.failureCount++
    cbState.lastFailureTime = Date.now()

    // If in half-open state, immediately reopen
    if (cbState.state === 'half-open') {
      cbState.state = 'open'
      cbState.lastStateChangeTime = Date.now()
      return
    }

    // Check if we should open the circuit
    if (this.config.circuitBreaker) {
      if (cbState.failureCount >= this.config.circuitBreaker.failureThreshold) {
        cbState.state = 'open'
        cbState.lastStateChangeTime = Date.now()
      }
    }
  }

  /**
   * Update circuit breaker states (check for half-open transitions)
   */
  private updateCircuitBreakerStates(): void {
    if (!this.config.circuitBreaker) return

    const now = Date.now()

    for (const [shardId, cbState] of this.circuitBreakers) {
      if (cbState.state === 'open') {
        const timeSinceOpen = now - cbState.lastStateChangeTime
        if (timeSinceOpen >= this.config.circuitBreaker.resetTimeMs) {
          cbState.state = 'half-open'
          cbState.lastStateChangeTime = now
        }
      }
    }
  }

  /**
   * Deduplicate results by ID, keeping highest score
   */
  private deduplicateResults(results: CoordinatedSearchMatch[]): CoordinatedSearchMatch[] {
    const resultMap = new Map<string, CoordinatedSearchMatch>()

    for (const result of results) {
      const existing = resultMap.get(result.id)
      if (!existing || result.score > existing.score) {
        resultMap.set(result.id, result)
      }
    }

    return Array.from(resultMap.values())
  }

  /**
   * Calculate latency statistics from shard metrics
   */
  private calculateLatencyStats(metrics: ShardMetrics[]): LatencyStats {
    if (metrics.length === 0) {
      return {
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      }
    }

    const latencies = metrics.map(m => m.latencyMs).sort((a, b) => a - b)
    const sum = latencies.reduce((a, b) => a + b, 0)

    return {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg: sum / latencies.length,
      p50: this.percentile(latencies, 50),
      p95: this.percentile(latencies, 95),
      p99: this.percentile(latencies, 99),
    }
  }

  /**
   * Calculate percentile value from sorted array
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0
    const index = Math.ceil((p / 100) * sortedValues.length) - 1
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))]
  }

  /**
   * Get the circuit breaker state for a shard
   */
  getCircuitState(shardId: string): CircuitBreakerState {
    // First update states to check for half-open transitions
    this.updateCircuitBreakerStates()

    const cbState = this.circuitBreakers.get(shardId)
    if (!cbState) {
      return 'closed'
    }
    return cbState.state
  }

  /**
   * Manually reset the circuit breaker for a shard
   */
  resetCircuit(shardId: string): void {
    const cbState = this.circuitBreakers.get(shardId)
    if (cbState) {
      cbState.state = 'closed'
      cbState.failureCount = 0
      cbState.lastStateChangeTime = Date.now()
    }
  }
}
