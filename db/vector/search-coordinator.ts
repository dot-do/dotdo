/**
 * VectorSearchCoordinator - Distributed Vector Search Orchestration
 *
 * RED phase stub implementation - exports types and throws NotImplemented.
 * This file exists to make tests compile. Actual implementation comes in GREEN phase.
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
// IMPLEMENTATION (RED PHASE STUB)
// ============================================================================

/**
 * VectorSearchCoordinator orchestrates distributed vector search
 *
 * RED phase: All methods throw NotImplemented errors.
 */
export class VectorSearchCoordinator {
  private config: SearchCoordinatorConfig

  constructor(config: SearchCoordinatorConfig) {
    // Validate config
    if (!config.shards || config.shards.length === 0) {
      throw new Error('At least one shard must be configured')
    }

    this.config = config
  }

  /**
   * Execute a distributed vector search across all shards
   */
  async search(
    query: Float32Array,
    k: number,
    options?: CoordinatedSearchOptions
  ): Promise<CoordinatedSearchResult> {
    // RED phase: not implemented
    throw new Error('Not implemented: search')
  }

  /**
   * Get the circuit breaker state for a shard
   */
  getCircuitState(shardId: string): CircuitBreakerState {
    // RED phase: not implemented
    throw new Error('Not implemented: getCircuitState')
  }

  /**
   * Manually reset the circuit breaker for a shard
   */
  resetCircuit(shardId: string): void {
    // RED phase: not implemented
    throw new Error('Not implemented: resetCircuit')
  }
}
