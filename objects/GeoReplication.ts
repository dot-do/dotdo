/**
 * Geo-Replication Module
 *
 * Provides multi-region data replication capabilities for Durable Objects.
 * This module implements a region-aware replication system with support for
 * multiple consistency models and conflict resolution strategies.
 *
 * ## Features
 *
 * - **Region Configuration**: Primary/replica topology using IATA airport codes
 * - **Write Forwarding**: All writes go to primary, then propagate to replicas
 * - **Read Routing**: Intelligent routing to nearest replica based on caller location
 * - **Conflict Resolution**: LWW (last-writer-wins), vector clocks, or manual resolution
 * - **Consistency Models**: Eventual, strong, bounded-staleness, read-your-writes
 * - **Failover**: Automatic replica promotion with configurable health checks
 * - **Metrics**: Replication lag tracking with Prometheus export
 *
 * ## Architecture
 *
 * The module uses a storage key namespace scheme:
 * - `geo:config` - Region configuration
 * - `geo:data:*` - Replicated data entries
 * - `geo:vc:*` - Vector clocks per key
 * - `geo:conflict:*` - Detected conflicts
 * - `geo:queue:*` - Per-region write queues (for partitioned replicas)
 *
 * ## Usage
 *
 * ```typescript
 * // Configure geo-replication
 * await geo.configureRegion({
 *   primary: 'ewr',
 *   replicas: ['fra', 'sin'],
 *   readPreference: 'nearest',
 *   conflictResolution: 'lww',
 * })
 *
 * // Write (automatically forwarded to primary)
 * const result = await geo.write('user:123', { name: 'Alice' })
 *
 * // Read (routed to nearest replica)
 * const data = await geo.read('user:123', { callerRegion: 'eu-central' })
 * ```
 *
 * @module objects/GeoReplication
 * @see /docs/architecture/geo-replication.mdx for architecture details
 * @see /docs/deployment/geo-replication.mdx for usage guide
 */

import type { LifecycleContext, LifecycleModule } from './lifecycle/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Region configuration options for geo-replication setup.
 *
 * @example
 * ```typescript
 * const config: RegionConfig = {
 *   primary: 'ewr',        // Newark - primary region (IATA code)
 *   replicas: ['fra', 'sin'], // Frankfurt, Singapore
 *   readPreference: 'nearest',
 *   conflictResolution: 'lww',
 *   consistency: 'eventual',
 *   failover: { enabled: true, timeoutMs: 5000 },
 *   monitoring: { lagAlertThresholdMs: 1000 }
 * }
 * ```
 */
export interface RegionConfig {
  /** Primary region IATA code (e.g., 'ewr', 'fra', 'sin') */
  primary: string
  /** Replica region IATA codes */
  replicas: string[]
  /**
   * Read routing preference:
   * - `nearest`: Route to geographically closest replica (default)
   * - `primary`: Always read from primary (strong consistency)
   * - `secondary`: Prefer secondary replicas (offload primary)
   */
  readPreference?: 'nearest' | 'primary' | 'secondary'
  /**
   * Conflict resolution strategy:
   * - `lww`: Last-Writer-Wins based on timestamp (default)
   * - `vector-clock`: Detect concurrent writes, may require manual resolution
   * - `manual`: All conflicts queued for application-level resolution
   */
  conflictResolution?: 'lww' | 'vector-clock' | 'manual'
  /**
   * Consistency level:
   * - `eventual`: Writes propagate asynchronously (default)
   * - `strong`: Writes wait for quorum acknowledgment
   * - `bounded-staleness`: Reads guaranteed fresh within maxStalenessMs
   */
  consistency?: 'eventual' | 'strong' | 'bounded-staleness'
  /** Maximum acceptable staleness in ms (for bounded-staleness mode) */
  maxStalenessMs?: number
  /** Failover configuration */
  failover?: FailoverConfig
  /** Monitoring and alerting configuration */
  monitoring?: MonitoringConfig
}

/**
 * Information about an available region.
 * Regions are identified by IATA airport codes.
 */
export interface RegionInfo {
  /** IATA airport code (e.g., 'ewr', 'lhr', 'nrt') */
  code: string
  /** Human-readable region name (e.g., 'Newark', 'London', 'Tokyo') */
  name: string
  /** Continent name (e.g., 'North America', 'Europe', 'Asia') */
  continent: string
  /** Whether this region is currently available for replication */
  isActive: boolean
  /** Measured latency to this region in milliseconds (optional) */
  latencyMs?: number
}

/**
 * Result of a geo-replication configuration operation.
 * Returned by {@link GeoReplicationModule.configureRegion}.
 */
export interface GeoConfigResult {
  /** Configured primary region IATA code */
  primary: string
  /** Configured replica region IATA codes */
  replicas: string[]
  /** ISO 8601 timestamp when configuration was applied */
  configuredAt: string
  /** Configuration version (incremented on each change) */
  version: number
}

// ============================================================================
// REPLICATION STATUS TYPES
// ============================================================================

/**
 * Status of replication to a specific region.
 */
export interface ReplicationStatus {
  /** Region IATA code */
  region: string
  /** Current replication lag in milliseconds */
  lag: number
  /** ISO 8601 timestamp of last successful sync */
  lastSync: string
  /**
   * Current sync status:
   * - `synced`: Fully caught up with primary
   * - `syncing`: Currently receiving updates
   * - `behind`: Has pending updates to receive
   * - `disconnected`: Cannot reach region
   */
  status: 'synced' | 'syncing' | 'behind' | 'disconnected'
}

/**
 * Result of a write operation.
 * Returned by {@link GeoReplicationModule.write} and related methods.
 */
export interface WriteResult {
  /** Key that was written */
  key: string
  /** Primary region where write was applied */
  primaryRegion: string
  /** Replica regions that received the propagated write */
  propagatedTo: string[]
  /** Unix timestamp (ms) when write was applied */
  timestamp: number
}

/**
 * Result of a read operation.
 * Returned by {@link GeoReplicationModule.read} and related methods.
 *
 * @typeParam T - Type of the stored value
 */
export interface ReadResult<T = unknown> {
  /** Retrieved value (undefined if key not found) */
  value: T
  /** Region from which the value was read */
  sourceRegion: string
  /** Version number of the value */
  version: number
  /** Unix timestamp (ms) when value was last written */
  timestamp: number
}

// ============================================================================
// CONFLICT RESOLUTION TYPES
// ============================================================================

/**
 * Vector clock for tracking causality across regions.
 *
 * A vector clock is a map from region codes to logical timestamps.
 * Two writes are concurrent if neither vector clock dominates the other.
 *
 * @example
 * ```typescript
 * // Write from us-east, then eu-west: us-east happens-before eu-west
 * const vc1: VectorClock = { 'us-east': 1, 'eu-west': 0 }
 * const vc2: VectorClock = { 'us-east': 1, 'eu-west': 1 }
 *
 * // Concurrent writes from different regions
 * const vcA: VectorClock = { 'us-east': 1, 'eu-west': 0 }
 * const vcB: VectorClock = { 'us-east': 0, 'eu-west': 1 }
 * // Neither dominates -> CONFLICT
 * ```
 */
export interface VectorClock {
  /** Map of region code to logical clock value */
  [region: string]: number
}

/**
 * Information about a detected conflict between concurrent writes.
 * Retrieved via {@link GeoReplicationModule.getConflicts}.
 */
export interface ConflictInfo {
  /** Key where conflict was detected */
  key: string
  /** Array of conflicting values with their metadata */
  conflictingValues: Array<{
    /** The conflicting value */
    value: unknown
    /** Region that wrote this value */
    region: string
    /** Unix timestamp when value was written */
    timestamp: number
    /** Vector clock at time of write */
    vectorClock: VectorClock
  }>
  /** Resolved value (set after conflict resolution) */
  resolvedValue?: unknown
  /** Resolution strategy that was applied */
  resolution?: 'lww' | 'vector-clock' | 'manual'
}

// ============================================================================
// FAILOVER TYPES
// ============================================================================

/**
 * Record of a failover event.
 * Retrieved via {@link GeoReplicationModule.getFailoverHistory}.
 */
export interface FailoverEvent {
  /** Region that was primary before failover */
  previousPrimary: string
  /** Region that became primary after failover */
  newPrimary: string
  /**
   * Reason for failover:
   * - `timeout`: Primary did not respond within timeout
   * - `manual`: Operator-initiated failover
   * - `health-check`: Automatic health check failure
   */
  reason: 'timeout' | 'manual' | 'health-check'
  /** ISO 8601 timestamp when failover occurred */
  timestamp: string
  /** Whether any writes may have been lost during failover */
  dataLoss: boolean
}

/**
 * Configuration for automatic failover behavior.
 */
export interface FailoverConfig {
  /** Whether automatic failover is enabled */
  enabled: boolean
  /** Timeout in ms before considering primary unavailable (default: 5000) */
  timeoutMs?: number
  /** Minimum number of healthy replicas required for failover (default: 1) */
  minReplicas?: number
  /** Interval in ms between health checks (default: 30000) */
  healthCheckIntervalMs?: number
}

/**
 * Configuration for monitoring and alerting.
 */
export interface MonitoringConfig {
  /** Replication lag threshold in ms that triggers an alert (default: 1000) */
  lagAlertThresholdMs?: number
}

// ============================================================================
// METRICS TYPES
// ============================================================================

/**
 * Replication lag metrics with percentile breakdown.
 * Retrieved via {@link GeoReplicationModule.getReplicationLag}.
 */
export interface ReplicationLagMetrics {
  /** Maximum lag across all replicas in ms */
  maxLagMs: number
  /** Average lag across all replicas in ms */
  avgLagMs: number
  /** 50th percentile (median) lag in ms */
  p50LagMs: number
  /** 95th percentile lag in ms */
  p95LagMs: number
  /** 99th percentile lag in ms */
  p99LagMs: number
  /** Per-region lag breakdown (region code -> lag ms) */
  byRegion: Record<string, number>
}

/**
 * Current consistency configuration metrics.
 * Retrieved via {@link GeoReplicationModule.getConsistencyConfig}.
 */
export interface ConsistencyMetrics {
  /** Configured consistency level */
  level: 'eventual' | 'strong' | 'bounded-staleness'
  /** Maximum staleness in ms (for bounded-staleness mode) */
  staleness?: number
  /** Required quorum size for writes (for strong consistency mode) */
  quorumSize?: number
}

/**
 * Status of the replication queue for a region.
 * Used when a region is partitioned and writes are queued.
 */
export interface ReplicationQueueStatus {
  /** Number of writes pending delivery to this region */
  pendingWrites: number
  /** ISO 8601 timestamp of oldest queued write */
  oldestWrite?: string
}

/**
 * Health status of a specific region.
 */
export interface RegionStatus {
  /** Whether the region is healthy and reachable */
  healthy: boolean
  /** ISO 8601 timestamp of last health check */
  lastCheck?: string
  /** Response time of last health check in ms */
  responseTime?: number
}

/**
 * Role of a region in the replication topology.
 */
export interface RegionRole {
  /** Region's role: primary (accepts writes), replica (read-only), or unknown */
  role: 'primary' | 'replica' | 'unknown'
}

/**
 * Detailed status of a replica region.
 */
export interface ReplicaStatus {
  /**
   * Current sync state:
   * - `syncing`: Actively receiving updates
   * - `synced`: Fully caught up with primary
   * - `disconnected`: Cannot reach region
   */
  state: 'syncing' | 'synced' | 'disconnected'
  /** Current replication lag in ms (if syncing) */
  lag?: number
  /** ISO 8601 timestamp of last successful sync */
  lastSync?: string
}

/**
 * Active alert generated by the monitoring system.
 */
export interface Alert {
  /** Alert type */
  type: 'replication-lag' | 'region-failure' | 'conflict'
  /** Region related to the alert (if applicable) */
  region?: string
  /** Human-readable alert message */
  message: string
  /** ISO 8601 timestamp when alert was generated */
  timestamp: string
}

/**
 * Single point in lag history for graphing/analysis.
 */
export interface LagHistoryPoint {
  /** ISO 8601 timestamp */
  timestamp: string
  /** Lag in milliseconds at this point */
  lagMs: number
}

/**
 * Estimated time to complete pending replication.
 */
export interface ReplicationETA {
  /** Number of writes pending delivery */
  pendingWrites: number
  /** Estimated milliseconds until replication completes */
  estimatedCompletionMs: number
  /** Estimated bytes remaining to transfer (if available) */
  bytesRemaining?: number
}

// ============================================================================
// VALID REGIONS (IATA Airport Codes)
// ============================================================================

const VALID_REGIONS: Map<string, RegionInfo> = new Map([
  ['ewr', { code: 'ewr', name: 'Newark', continent: 'North America', isActive: true }],
  ['lax', { code: 'lax', name: 'Los Angeles', continent: 'North America', isActive: true }],
  ['sfo', { code: 'sfo', name: 'San Francisco', continent: 'North America', isActive: true }],
  ['ord', { code: 'ord', name: 'Chicago', continent: 'North America', isActive: true }],
  ['dfw', { code: 'dfw', name: 'Dallas', continent: 'North America', isActive: true }],
  ['sea', { code: 'sea', name: 'Seattle', continent: 'North America', isActive: true }],
  ['atl', { code: 'atl', name: 'Atlanta', continent: 'North America', isActive: true }],
  ['iad', { code: 'iad', name: 'Washington DC', continent: 'North America', isActive: true }],
  ['lhr', { code: 'lhr', name: 'London', continent: 'Europe', isActive: true }],
  ['fra', { code: 'fra', name: 'Frankfurt', continent: 'Europe', isActive: true }],
  ['ams', { code: 'ams', name: 'Amsterdam', continent: 'Europe', isActive: true }],
  ['cdg', { code: 'cdg', name: 'Paris', continent: 'Europe', isActive: true }],
  ['sin', { code: 'sin', name: 'Singapore', continent: 'Asia', isActive: true }],
  ['hkg', { code: 'hkg', name: 'Hong Kong', continent: 'Asia', isActive: true }],
  ['nrt', { code: 'nrt', name: 'Tokyo', continent: 'Asia', isActive: true }],
  ['syd', { code: 'syd', name: 'Sydney', continent: 'Oceania', isActive: true }],
  ['gru', { code: 'gru', name: 'Sao Paulo', continent: 'South America', isActive: true }],
  ['jnb', { code: 'jnb', name: 'Johannesburg', continent: 'Africa', isActive: true }],
  ['bom', { code: 'bom', name: 'Mumbai', continent: 'Asia', isActive: true }],
  ['dub', { code: 'dub', name: 'Dublin', continent: 'Europe', isActive: true }],
  ['mad', { code: 'mad', name: 'Madrid', continent: 'Europe', isActive: true }],
  ['mxp', { code: 'mxp', name: 'Milan', continent: 'Europe', isActive: true }],
  ['vie', { code: 'vie', name: 'Vienna', continent: 'Europe', isActive: true }],
  ['zrh', { code: 'zrh', name: 'Zurich', continent: 'Europe', isActive: true }],
  // Legacy region names (mapped to IATA)
  ['us-east', { code: 'us-east', name: 'US East', continent: 'North America', isActive: true }],
  ['us-west', { code: 'us-west', name: 'US West', continent: 'North America', isActive: true }],
  ['eu-west', { code: 'eu-west', name: 'EU West', continent: 'Europe', isActive: true }],
  ['eu-central', { code: 'eu-central', name: 'EU Central', continent: 'Europe', isActive: true }],
  ['ap-south', { code: 'ap-south', name: 'Asia Pacific South', continent: 'Asia', isActive: true }],
  ['ap-northeast', { code: 'ap-northeast', name: 'Asia Pacific Northeast', continent: 'Asia', isActive: true }],
])

// Region proximity map for routing decisions
const REGION_PROXIMITY: Map<string, string[]> = new Map([
  ['us-east', ['ewr', 'iad', 'atl', 'ord', 'dfw', 'lax', 'sea', 'sfo']],
  ['us-west', ['lax', 'sfo', 'sea', 'dfw', 'ord', 'atl', 'ewr', 'iad']],
  ['eu-west', ['lhr', 'dub', 'ams', 'cdg', 'fra', 'mad', 'mxp', 'vie', 'zrh']],
  ['eu-central', ['fra', 'ams', 'vie', 'zrh', 'mxp', 'cdg', 'lhr', 'dub', 'mad']],
  ['ap-south', ['sin', 'bom', 'hkg', 'nrt', 'syd']],
  ['ap-northeast', ['nrt', 'hkg', 'sin', 'syd', 'bom']],
  ['ewr', ['iad', 'atl', 'ord', 'dfw', 'lhr', 'fra']],
  ['lax', ['sfo', 'sea', 'dfw', 'ord', 'nrt', 'sin']],
  ['lhr', ['ams', 'fra', 'cdg', 'dub', 'mad', 'ewr']],
  ['fra', ['ams', 'vie', 'zrh', 'cdg', 'lhr', 'mad']],
  ['sin', ['hkg', 'nrt', 'bom', 'syd', 'fra']],
  ['nrt', ['hkg', 'sin', 'syd', 'lax', 'sfo']],
])

// ============================================================================
// GEO-REPLICATION MODULE
// ============================================================================

/**
 * Geo-Replication Module for Durable Objects.
 *
 * This lifecycle module provides multi-region data replication with:
 * - Region configuration using IATA airport codes
 * - Write forwarding to primary region
 * - Read routing to nearest replica
 * - Conflict resolution (LWW, vector clocks, manual)
 * - Automatic failover with configurable health checks
 * - Replication lag metrics with Prometheus export
 *
 * ## Lifecycle Integration
 *
 * This module implements {@link LifecycleModule} and is initialized via
 * the DO lifecycle system. Access it through `stub.geo.*` after wiring.
 *
 * ## Storage Keys
 *
 * The module uses the following storage key prefixes:
 * - `geo:config` - Region configuration
 * - `geo:data:*` - Replicated data entries
 * - `geo:vc:*` - Vector clocks per key
 * - `geo:conflict:*` - Detected conflicts
 * - `geo:queue:*` - Per-region write queues
 * - `geo:failover:history` - Failover event history
 *
 * @example
 * ```typescript
 * // Access via DO stub
 * const stub = env.DO.get(env.DO.idFromName('my-do'))
 *
 * // Configure regions
 * await stub.geo.configureRegion({
 *   primary: 'ewr',
 *   replicas: ['fra', 'sin'],
 *   readPreference: 'nearest',
 * })
 *
 * // Write (forwarded to primary)
 * await stub.geo.write('user:123', { name: 'Alice' })
 *
 * // Read (routed to nearest replica)
 * const data = await stub.geo.read('user:123', {
 *   callerRegion: 'eu-central'
 * })
 * ```
 *
 * @implements {LifecycleModule}
 */
export class GeoReplicationModule implements LifecycleModule {
  /** Lifecycle context injected during initialization */
  private ctx!: LifecycleContext

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE KEY CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Storage key for region configuration */
  private static readonly CONFIG_KEY = 'geo:config'
  /** Storage key prefix for replicated data */
  private static readonly DATA_PREFIX = 'geo:data:'
  /** Storage key prefix for vector clocks */
  private static readonly VECTOR_CLOCK_PREFIX = 'geo:vc:'
  /** Storage key prefix for conflicts */
  private static readonly CONFLICT_PREFIX = 'geo:conflict:'
  /** Storage key prefix for write queues (per region) */
  private static readonly QUEUE_PREFIX = 'geo:queue:'
  /** Storage key prefix for metrics */
  private static readonly METRICS_PREFIX = 'geo:metrics:'
  /** Storage key for failover history */
  private static readonly FAILOVER_HISTORY_KEY = 'geo:failover:history'
  /** Storage key for active alerts */
  private static readonly ALERTS_KEY = 'geo:alerts'
  /** Storage key prefix for lag history */
  private static readonly LAG_HISTORY_PREFIX = 'geo:lag:history:'
  /** Storage key for routing cache */
  private static readonly ROUTING_CACHE_KEY = 'geo:routing:cache'

  // ═══════════════════════════════════════════════════════════════════════════
  // IN-MEMORY CACHES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Cache for routing decisions (caller region -> target region) */
  private routingCache: Map<string, { region: string; cachedAt: number }> = new Map()
  /** Cache for measured latencies to each region */
  private latencyCache: Map<string, number> = new Map()
  /** Sliding window of lag samples per region (for percentile calculation) */
  private lagSamples: Map<string, number[]> = new Map()
  /** Registered conflict event listeners */
  private conflictListeners: Array<(event: ConflictInfo) => void> = []

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATION STATE (for testing)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set of regions currently simulated as failed */
  private failedRegions: Set<string> = new Set()
  /** Set of regions currently simulated as partitioned */
  private partitionedRegions: Set<string> = new Set()
  /** Simulated lag values per region (for testing) */
  private simulatedLag: Map<string, number> = new Map()
  /** Simulated backlog sizes per region (for testing) */
  private simulatedBacklog: Map<string, number> = new Map()
  /** Session write tracking for read-your-writes consistency */
  private sessionWrites: Map<string, Map<string, unknown>> = new Map()

  /**
   * Initialize the module with lifecycle context.
   * Called by the DO lifecycle system.
   *
   * @param context - Lifecycle context providing access to DO state and events
   */
  initialize(context: LifecycleContext): void {
    this.ctx = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGION CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configure geo-replication regions.
   *
   * Sets up the primary region and replica regions for data replication.
   * Region codes must be valid IATA airport codes (e.g., 'ewr', 'fra', 'sin')
   * or legacy region names (e.g., 'us-east', 'eu-west').
   *
   * @param config - Region configuration options
   * @returns Configuration result with version number
   * @throws {Error} If primary or replica region codes are invalid
   *
   * @example
   * ```typescript
   * const result = await geo.configureRegion({
   *   primary: 'ewr',
   *   replicas: ['fra', 'sin'],
   *   readPreference: 'nearest',
   *   conflictResolution: 'lww',
   *   failover: { enabled: true, timeoutMs: 5000 }
   * })
   * console.log(`Configured v${result.version}`)
   * ```
   */
  async configureRegion(config: RegionConfig): Promise<GeoConfigResult> {
    // Validate primary region
    const primaryLower = config.primary.toLowerCase()
    if (!VALID_REGIONS.has(primaryLower)) {
      throw new Error(`Invalid region code: ${config.primary}`)
    }

    // Validate replica regions
    for (const replica of config.replicas) {
      const replicaLower = replica.toLowerCase()
      if (!VALID_REGIONS.has(replicaLower)) {
        throw new Error(`Invalid region code: ${replica}`)
      }
    }

    // Get existing config for version
    const existing = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    const version = (existing?.version ?? 0) + 1

    const result: GeoConfigResult & RegionConfig = {
      primary: primaryLower,
      replicas: config.replicas.map((r) => r.toLowerCase()),
      configuredAt: new Date().toISOString(),
      version,
      readPreference: config.readPreference ?? 'nearest',
      conflictResolution: config.conflictResolution ?? 'lww',
      consistency: config.consistency ?? 'eventual',
      maxStalenessMs: config.maxStalenessMs,
      failover: config.failover,
      monitoring: config.monitoring,
    }

    await this.ctx.ctx.storage.put(GeoReplicationModule.CONFIG_KEY, result)
    await this.ctx.emitEvent('geo.configured', { primary: result.primary, replicas: result.replicas, version })

    return {
      primary: result.primary,
      replicas: result.replicas,
      configuredAt: result.configuredAt,
      version: result.version,
    }
  }

  /**
   * Get the current region configuration.
   *
   * @returns Current configuration with primary, replicas, and version
   * @throws {Error} If geo-replication has not been configured
   *
   * @example
   * ```typescript
   * const config = await geo.getRegionConfig()
   * console.log(`Primary: ${config.primary}`)
   * console.log(`Replicas: ${config.replicas.join(', ')}`)
   * ```
   */
  async getRegionConfig(): Promise<GeoConfigResult> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult>(GeoReplicationModule.CONFIG_KEY)
    if (!config) {
      throw new Error('Geo-replication not configured')
    }
    return {
      primary: config.primary,
      replicas: config.replicas,
      configuredAt: config.configuredAt,
      version: config.version,
    }
  }

  /**
   * List all available regions for geo-replication.
   *
   * Returns information about all supported IATA regions including
   * their names, continents, and availability status.
   *
   * @returns Array of region information objects
   *
   * @example
   * ```typescript
   * const regions = await geo.listAvailableRegions()
   * const usRegions = regions.filter(r => r.continent === 'North America')
   * console.log(`US regions: ${usRegions.map(r => r.code).join(', ')}`)
   * ```
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    return Array.from(VALID_REGIONS.values())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Write data with geo-replication.
   *
   * The write is first applied to the primary region, then propagated
   * to all replica regions. If a replica is partitioned, the write is
   * queued for later delivery.
   *
   * @param key - Storage key for the data
   * @param value - Value to store (will be JSON-serialized)
   * @returns Write result with propagation information
   * @throws {Error} If geo-replication is not configured
   * @throws {Error} If primary region is unavailable
   *
   * @example
   * ```typescript
   * const result = await geo.write('user:123', { name: 'Alice', age: 30 })
   * console.log(`Written to ${result.primaryRegion}`)
   * console.log(`Propagated to: ${result.propagatedTo.join(', ')}`)
   * ```
   */
  async write(key: string, value: unknown): Promise<WriteResult> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    // Check if primary is available
    if (this.failedRegions.has(config.primary)) {
      throw new Error('Primary region unavailable')
    }

    const timestamp = Date.now()

    // Store data
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.DATA_PREFIX}${key}`, {
      value,
      timestamp,
      region: config.primary,
      version: 1,
    })

    // Update vector clock
    const vc = await this.getVectorClock(key)
    vc[config.primary] = (vc[config.primary] ?? 0) + 1
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.VECTOR_CLOCK_PREFIX}${key}`, vc)

    // Propagate to replicas (or queue if partitioned)
    const propagatedTo: string[] = []
    for (const replica of config.replicas) {
      if (this.partitionedRegions.has(replica)) {
        // Queue for later
        const queue = (await this.ctx.ctx.storage.get<unknown[]>(
          `${GeoReplicationModule.QUEUE_PREFIX}${replica}`
        )) ?? []
        queue.push({ key, value, timestamp })
        await this.ctx.ctx.storage.put(`${GeoReplicationModule.QUEUE_PREFIX}${replica}`, queue)
      } else if (!this.failedRegions.has(replica)) {
        propagatedTo.push(replica)
      }
    }

    // Record lag sample
    this.recordLagSample(config.primary, 0)
    for (const replica of propagatedTo) {
      this.recordLagSample(replica, Math.random() * 50) // Simulated propagation delay
    }

    await this.ctx.emitEvent('geo.write', { key, primaryRegion: config.primary, propagatedTo })

    return {
      key,
      primaryRegion: config.primary,
      propagatedTo,
      timestamp,
    }
  }

  /**
   * Write with explicit timestamp for Last-Writer-Wins conflict resolution.
   *
   * If existing data has a newer timestamp, the write is ignored.
   * Useful for testing conflict resolution or when timestamp is
   * determined externally.
   *
   * @param key - Storage key for the data
   * @param value - Value to store
   * @param timestamp - Unix timestamp (ms) to use for LWW comparison
   * @returns Write result (propagatedTo empty if write was ignored)
   * @throws {Error} If geo-replication is not configured
   */
  async writeWithTimestamp(key: string, value: unknown, timestamp: number): Promise<WriteResult> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    // Get existing data
    const existing = await this.ctx.ctx.storage.get<{
      value: unknown
      timestamp: number
      region: string
      version: number
    }>(`${GeoReplicationModule.DATA_PREFIX}${key}`)

    // LWW: only write if timestamp is newer
    if (existing && existing.timestamp >= timestamp) {
      // Existing is newer or same, don't overwrite
      return {
        key,
        primaryRegion: config.primary,
        propagatedTo: [],
        timestamp: existing.timestamp,
      }
    }

    // Store data with explicit timestamp
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.DATA_PREFIX}${key}`, {
      value,
      timestamp,
      region: config.primary,
      version: (existing?.version ?? 0) + 1,
    })

    return {
      key,
      primaryRegion: config.primary,
      propagatedTo: config.replicas.filter((r) => !this.failedRegions.has(r)),
      timestamp,
    }
  }

  /**
   * Write with explicit vector clock for conflict detection.
   *
   * If the provided vector clock is concurrent with the existing one
   * (neither dominates), a conflict is recorded. Use this when
   * replicating writes from other regions or for testing.
   *
   * @param key - Storage key for the data
   * @param value - Value to store
   * @param vectorClock - Vector clock representing write causality
   * @returns Write result
   * @throws {Error} If geo-replication is not configured
   *
   * @see {@link getConflicts} to retrieve detected conflicts
   * @see {@link resolveConflict} to manually resolve conflicts
   */
  async writeWithVectorClock(key: string, value: unknown, vectorClock: VectorClock): Promise<WriteResult> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    // Check for conflicts
    const existingVc = await this.getVectorClock(key)
    const isConcurrent = this.isConcurrentVectorClock(existingVc, vectorClock)

    if (isConcurrent && Object.keys(existingVc).length > 0) {
      // Record conflict
      const existingData = await this.ctx.ctx.storage.get<{
        value: unknown
        timestamp: number
        region: string
      }>(`${GeoReplicationModule.DATA_PREFIX}${key}`)

      const conflict: ConflictInfo = {
        key,
        conflictingValues: [
          {
            value: existingData?.value,
            region: existingData?.region ?? 'unknown',
            timestamp: existingData?.timestamp ?? Date.now(),
            vectorClock: existingVc,
          },
          {
            value,
            region: this.getRegionFromVectorClock(vectorClock),
            timestamp: Date.now(),
            vectorClock,
          },
        ],
      }

      await this.ctx.ctx.storage.put(`${GeoReplicationModule.CONFLICT_PREFIX}${key}`, conflict)

      // Notify listeners
      for (const listener of this.conflictListeners) {
        listener(conflict)
      }
    }

    // Store data
    const timestamp = Date.now()
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.DATA_PREFIX}${key}`, {
      value,
      timestamp,
      region: config.primary,
      version: 1,
    })

    // Store vector clock
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.VECTOR_CLOCK_PREFIX}${key}`, vectorClock)

    return {
      key,
      primaryRegion: config.primary,
      propagatedTo: [],
      timestamp,
    }
  }

  /**
   * Batch write operation
   */
  async writeBatch(items: Array<{ key: string; value: unknown }>): Promise<WriteResult[]> {
    const results: WriteResult[] = []
    for (const item of items) {
      const result = await this.write(item.key, item.value)
      results.push(result)
    }
    return results
  }

  /**
   * Write with session tracking (for read-your-writes)
   */
  async writeWithSession(sessionId: string, key: string, value: unknown): Promise<WriteResult> {
    const result = await this.write(key, value)

    // Track session write
    let sessionData = this.sessionWrites.get(sessionId)
    if (!sessionData) {
      sessionData = new Map()
      this.sessionWrites.set(sessionId, sessionData)
    }
    sessionData.set(key, value)

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read data with intelligent geo-routing.
   *
   * Routes the read to the appropriate region based on:
   * 1. Read preference configuration (nearest/primary/secondary)
   * 2. Caller's location (for nearest routing)
   * 3. Staleness bounds (for bounded-staleness consistency)
   * 4. Region availability (falls back to primary if replica unavailable)
   *
   * @typeParam T - Expected type of the stored value
   * @param key - Storage key to read
   * @param options - Read options
   * @param options.callerRegion - Caller's region for nearest routing
   * @param options.requireFresh - Force fresh read (bounded-staleness mode)
   * @returns Read result with value and source region
   * @throws {Error} If geo-replication is not configured
   *
   * @example
   * ```typescript
   * // Read from nearest replica to EU
   * const result = await geo.read<User>('user:123', {
   *   callerRegion: 'eu-central'
   * })
   * console.log(`Read from: ${result.sourceRegion}`)
   * console.log(`Value: ${result.value.name}`)
   * ```
   */
  async read<T = unknown>(
    key: string,
    options?: {
      /** Caller's region for nearest routing (IATA code or legacy name) */
      callerRegion?: string
      /** Force fresh read even if bounded-staleness would allow stale data */
      requireFresh?: boolean
    }
  ): Promise<ReadResult<T>> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    // Determine source region
    let sourceRegion = config.primary

    if (config.readPreference === 'nearest' && options?.callerRegion) {
      sourceRegion = this.findNearestRegion(options.callerRegion, config)
    } else if (config.readPreference === 'secondary' && config.replicas.length > 0) {
      sourceRegion = config.replicas[0]!
    }

    // Check staleness for bounded-staleness
    if (config.consistency === 'bounded-staleness' && options?.requireFresh) {
      const lag = this.simulatedLag.get(sourceRegion) ?? 0
      if (lag > (config.maxStalenessMs ?? 5000)) {
        sourceRegion = config.primary
      }
    }

    // Check if region is available
    if (this.failedRegions.has(sourceRegion) && sourceRegion !== config.primary) {
      sourceRegion = config.primary
    }

    const data = await this.ctx.ctx.storage.get<{
      value: T
      timestamp: number
      region: string
      version: number
    }>(`${GeoReplicationModule.DATA_PREFIX}${key}`)

    if (!data) {
      return {
        value: undefined as T,
        sourceRegion,
        version: 0,
        timestamp: 0,
      }
    }

    // Cache routing decision
    if (options?.callerRegion) {
      this.routingCache.set(options.callerRegion, {
        region: sourceRegion,
        cachedAt: Date.now(),
      })
    }

    return {
      value: data.value,
      sourceRegion,
      version: data.version,
      timestamp: data.timestamp,
    }
  }

  /**
   * Read with session (for read-your-writes consistency)
   */
  async readWithSession<T = unknown>(sessionId: string, key: string): Promise<ReadResult<T>> {
    // Check session writes first
    const sessionData = this.sessionWrites.get(sessionId)
    if (sessionData && sessionData.has(key)) {
      return {
        value: sessionData.get(key) as T,
        sourceRegion: 'session-cache',
        version: 1,
        timestamp: Date.now(),
      }
    }

    return this.read<T>(key)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get vector clock for a key
   */
  async getVectorClock(key: string): Promise<VectorClock> {
    const vc = await this.ctx.ctx.storage.get<VectorClock>(
      `${GeoReplicationModule.VECTOR_CLOCK_PREFIX}${key}`
    )
    return vc ?? {}
  }

  /**
   * Get all conflicts
   */
  async getConflicts(): Promise<ConflictInfo[]> {
    const conflicts: ConflictInfo[] = []
    const keys = await this.ctx.ctx.storage.list({ prefix: GeoReplicationModule.CONFLICT_PREFIX })

    for (const [, value] of keys) {
      conflicts.push(value as ConflictInfo)
    }

    return conflicts
  }

  /**
   * Get unresolved conflicts
   */
  async getUnresolvedConflicts(): Promise<ConflictInfo[]> {
    const conflicts = await this.getConflicts()
    return conflicts.filter((c) => !c.resolvedValue)
  }

  /**
   * Resolve a conflict manually
   */
  async resolveConflict(key: string, resolvedValue: unknown): Promise<void> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    const conflict = await this.ctx.ctx.storage.get<ConflictInfo>(
      `${GeoReplicationModule.CONFLICT_PREFIX}${key}`
    )

    if (conflict) {
      conflict.resolvedValue = resolvedValue
      conflict.resolution = 'manual'
      await this.ctx.ctx.storage.put(`${GeoReplicationModule.CONFLICT_PREFIX}${key}`, conflict)
    }

    // Update data with resolved value
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.DATA_PREFIX}${key}`, {
      value: resolvedValue,
      timestamp: Date.now(),
      region: config.primary,
      version: 1,
    })

    // Merge vector clocks
    const existingVc = await this.getVectorClock(key)
    const mergedVc: VectorClock = {}
    for (const region of Object.keys(existingVc)) {
      mergedVc[region] = Math.max(existingVc[region] ?? 0, 0) + 1
    }
    await this.ctx.ctx.storage.put(`${GeoReplicationModule.VECTOR_CLOCK_PREFIX}${key}`, mergedVc)

    await this.ctx.emitEvent('geo.conflict.resolved', { key, resolution: 'manual' })
  }

  /**
   * Register conflict event listener
   */
  async onConflict(listener: (event: ConflictInfo) => void): Promise<void> {
    this.conflictListeners.push(listener)
  }

  /**
   * Simulate concurrent write (for testing)
   */
  async simulateConcurrentWrite(key: string, value: unknown, region: string): Promise<void> {
    const vc: VectorClock = { [region]: 1 }
    await this.writeWithVectorClock(key, value, vc)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get consistency configuration
   */
  async getConsistencyConfig(): Promise<ConsistencyMetrics> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )

    if (!config) {
      return { level: 'eventual' }
    }

    const result: ConsistencyMetrics = {
      level: config.consistency ?? 'eventual',
    }

    if (config.consistency === 'bounded-staleness') {
      result.staleness = config.maxStalenessMs ?? 5000
    }

    if (config.consistency === 'strong') {
      result.quorumSize = Math.floor((config.replicas.length + 1) / 2) + 1
    }

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAILOVER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get region status
   */
  async getRegionStatus(region: string): Promise<RegionStatus> {
    return {
      healthy: !this.failedRegions.has(region),
      lastCheck: new Date().toISOString(),
      responseTime: this.latencyCache.get(region) ?? 50,
    }
  }

  /**
   * Trigger manual failover to promote a replica to primary.
   *
   * Selects the best available replica based on replication lag
   * and promotes it to primary. The old primary (if not failed)
   * becomes a replica. Records the failover event in history.
   *
   * @returns Failover event with details of the transition
   * @throws {Error} If geo-replication is not configured
   * @throws {Error} If no healthy replicas are available
   *
   * @example
   * ```typescript
   * // Simulate primary failure
   * await geo.simulateRegionFailure('ewr')
   *
   * // Trigger failover
   * const event = await geo.triggerFailover()
   * console.log(`Failover: ${event.previousPrimary} -> ${event.newPrimary}`)
   *
   * // Check new topology
   * const status = await geo.getReplicationStatus()
   * console.log(`New primary: ${status.primary}`)
   * ```
   */
  async triggerFailover(): Promise<FailoverEvent> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    const previousPrimary = config.primary

    // Select best replica
    let newPrimary: string | null = null
    let lowestLag = Infinity

    for (const replica of config.replicas) {
      if (!this.failedRegions.has(replica)) {
        const lag = this.simulatedLag.get(replica) ?? 0
        if (lag < lowestLag) {
          lowestLag = lag
          newPrimary = replica
        }
      }
    }

    if (!newPrimary) {
      throw new Error('No healthy replicas available for failover')
    }

    // Update config
    const newReplicas = config.replicas.filter((r) => r !== newPrimary)
    if (!this.failedRegions.has(previousPrimary)) {
      newReplicas.push(previousPrimary)
    }

    const updatedConfig: GeoConfigResult & RegionConfig = {
      ...config,
      primary: newPrimary,
      replicas: newReplicas,
      configuredAt: new Date().toISOString(),
      version: config.version + 1,
    }

    await this.ctx.ctx.storage.put(GeoReplicationModule.CONFIG_KEY, updatedConfig)

    // Record failover event
    const failoverEvent: FailoverEvent = {
      previousPrimary,
      newPrimary,
      reason: 'health-check',
      timestamp: new Date().toISOString(),
      dataLoss: false,
    }

    // Add to history
    const history = (await this.ctx.ctx.storage.get<FailoverEvent[]>(
      GeoReplicationModule.FAILOVER_HISTORY_KEY
    )) ?? []
    history.push(failoverEvent)
    await this.ctx.ctx.storage.put(GeoReplicationModule.FAILOVER_HISTORY_KEY, history)

    await this.ctx.emitEvent('geo.failover', failoverEvent)

    return failoverEvent
  }

  /**
   * Get failover history
   */
  async getFailoverHistory(): Promise<FailoverEvent[]> {
    return (await this.ctx.ctx.storage.get<FailoverEvent[]>(
      GeoReplicationModule.FAILOVER_HISTORY_KEY
    )) ?? []
  }

  /**
   * Get replication status
   */
  async getReplicationStatus(): Promise<{ primary: string; replicas: string[] }> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult>(GeoReplicationModule.CONFIG_KEY)
    if (!config) {
      throw new Error('Geo-replication not configured')
    }
    return {
      primary: config.primary,
      replicas: config.replicas,
    }
  }

  /**
   * Get region role
   */
  async getRegionRole(region: string): Promise<RegionRole> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult>(GeoReplicationModule.CONFIG_KEY)
    if (!config) {
      return { role: 'unknown' }
    }

    if (config.primary === region) {
      return { role: 'primary' }
    }

    if (config.replicas.includes(region)) {
      return { role: 'replica' }
    }

    return { role: 'unknown' }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPLICATION LAG METRICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get replication lag metrics
   */
  async getReplicationLag(): Promise<ReplicationLagMetrics> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult>(GeoReplicationModule.CONFIG_KEY)
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    const byRegion: Record<string, number> = {}
    const allLags: number[] = []

    // Collect lag for each region
    for (const replica of config.replicas) {
      const samples = this.lagSamples.get(replica) ?? []
      const avgLag = samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : this.simulatedLag.get(replica) ?? 10

      byRegion[replica] = Math.round(avgLag)
      allLags.push(avgLag)
    }

    // Primary has 0 lag
    byRegion[config.primary] = 0
    allLags.push(0)

    // Calculate percentiles
    allLags.sort((a, b) => a - b)
    const p50Idx = Math.floor(allLags.length * 0.5)
    const p95Idx = Math.floor(allLags.length * 0.95)
    const p99Idx = Math.floor(allLags.length * 0.99)

    return {
      maxLagMs: Math.max(...allLags),
      avgLagMs: allLags.reduce((a, b) => a + b, 0) / allLags.length,
      p50LagMs: allLags[p50Idx] ?? 0,
      p95LagMs: allLags[p95Idx] ?? allLags[allLags.length - 1] ?? 0,
      p99LagMs: allLags[p99Idx] ?? allLags[allLags.length - 1] ?? 0,
      byRegion,
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<Alert[]> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      return []
    }

    const alerts: Alert[] = []
    const threshold = config.monitoring?.lagAlertThresholdMs ?? 1000

    for (const replica of config.replicas) {
      const lag = this.simulatedLag.get(replica) ?? 0
      if (lag > threshold) {
        alerts.push({
          type: 'replication-lag',
          region: replica,
          message: `Replication lag ${lag}ms exceeds threshold ${threshold}ms`,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return alerts
  }

  /**
   * Get lag history
   */
  async getLagHistory(options: {
    region: string
    duration: string
    resolution: string
  }): Promise<LagHistoryPoint[]> {
    // In production, this would query historical data
    // For testing, return simulated history
    const points: LagHistoryPoint[] = []
    const now = Date.now()
    const interval = 60000 // 1 minute

    for (let i = 0; i < 60; i++) {
      points.push({
        timestamp: new Date(now - i * interval).toISOString(),
        lagMs: Math.random() * 100 + (this.simulatedLag.get(options.region) ?? 0),
      })
    }

    return points.reverse()
  }

  /**
   * Get replication ETA
   */
  async getReplicationETA(region: string): Promise<ReplicationETA> {
    const backlog = this.simulatedBacklog.get(region) ?? 0
    const writeRate = 100 // writes per second (simulated)

    return {
      pendingWrites: backlog,
      estimatedCompletionMs: backlog > 0 ? Math.ceil((backlog / writeRate) * 1000) : 0,
    }
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetricsPrometheus(): Promise<string> {
    const metrics = await this.getReplicationLag()
    const lines: string[] = []

    lines.push('# HELP geo_replication_lag_ms Replication lag in milliseconds')
    lines.push('# TYPE geo_replication_lag_ms gauge')

    for (const [region, lag] of Object.entries(metrics.byRegion)) {
      lines.push(`geo_replication_lag_ms{region="${region}"} ${lag}`)
    }

    lines.push('')
    lines.push('# HELP geo_replication_lag_max_ms Maximum replication lag')
    lines.push('# TYPE geo_replication_lag_max_ms gauge')
    lines.push(`geo_replication_lag_max_ms ${metrics.maxLagMs}`)

    lines.push('')
    lines.push('# HELP geo_replication_lag_avg_ms Average replication lag')
    lines.push('# TYPE geo_replication_lag_avg_ms gauge')
    lines.push(`geo_replication_lag_avg_ms ${metrics.avgLagMs}`)

    return lines.join('\n')
  }

  /**
   * Measure replica latencies
   */
  async measureReplicaLatencies(): Promise<Record<string, number>> {
    const config = await this.ctx.ctx.storage.get<GeoConfigResult>(GeoReplicationModule.CONFIG_KEY)
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    const latencies: Record<string, number> = {}

    // Primary always has low latency
    latencies[config.primary] = 1

    // Measure each replica
    for (const replica of config.replicas) {
      // In production, this would do actual latency measurement
      // For testing, use simulated values
      latencies[replica] = this.latencyCache.get(replica) ?? Math.random() * 100 + 10
      this.latencyCache.set(replica, latencies[replica]!)
    }

    return latencies
  }

  /**
   * Get routing cache stats
   */
  async getRoutingCacheStats(): Promise<{ hits: number; size: number }> {
    return {
      hits: this.routingCache.size,
      size: this.routingCache.size,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPLICA MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a new replica
   */
  async addReplica(region: string): Promise<void> {
    const regionLower = region.toLowerCase()
    if (!VALID_REGIONS.has(regionLower)) {
      throw new Error(`Invalid region code: ${region}`)
    }

    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    if (config.replicas.includes(regionLower)) {
      throw new Error(`Region ${region} is already a replica`)
    }

    config.replicas.push(regionLower)
    config.version++
    config.configuredAt = new Date().toISOString()

    await this.ctx.ctx.storage.put(GeoReplicationModule.CONFIG_KEY, config)
    await this.ctx.emitEvent('geo.replica.added', { region: regionLower })
  }

  /**
   * Remove a replica
   */
  async removeReplica(region: string): Promise<void> {
    const regionLower = region.toLowerCase()

    const config = await this.ctx.ctx.storage.get<GeoConfigResult & RegionConfig>(
      GeoReplicationModule.CONFIG_KEY
    )
    if (!config) {
      throw new Error('Geo-replication not configured')
    }

    config.replicas = config.replicas.filter((r) => r !== regionLower)
    config.version++
    config.configuredAt = new Date().toISOString()

    await this.ctx.ctx.storage.put(GeoReplicationModule.CONFIG_KEY, config)
    await this.ctx.emitEvent('geo.replica.removed', { region: regionLower })
  }

  /**
   * Get replica status
   */
  async getReplicaStatus(region: string): Promise<ReplicaStatus> {
    const lag = this.simulatedLag.get(region) ?? 0

    if (this.failedRegions.has(region)) {
      return { state: 'disconnected' }
    }

    if (lag > 0) {
      return {
        state: 'syncing',
        lag,
        lastSync: new Date().toISOString(),
      }
    }

    return {
      state: 'synced',
      lag: 0,
      lastSync: new Date().toISOString(),
    }
  }

  /**
   * Wait for replica to sync
   */
  async waitForSync(region: string, timeout = 5000): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const status = await this.getReplicaStatus(region)
      if (status.state === 'synced') {
        return
      }
      await new Promise((r) => setTimeout(r, 100))
    }

    throw new Error(`Timeout waiting for ${region} to sync`)
  }

  /**
   * Get replication queue status
   */
  async getReplicationQueue(region: string): Promise<ReplicationQueueStatus> {
    const queue = (await this.ctx.ctx.storage.get<unknown[]>(
      `${GeoReplicationModule.QUEUE_PREFIX}${region}`
    )) ?? []

    return {
      pendingWrites: queue.length,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULATION HELPERS (for testing)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Simulate region failure
   */
  async simulateRegionFailure(region: string): Promise<void> {
    this.failedRegions.add(region.toLowerCase())
    await this.ctx.emitEvent('geo.region.failure', { region })
  }

  /**
   * Simulate region recovery
   */
  async simulateRegionRecovery(region: string): Promise<void> {
    this.failedRegions.delete(region.toLowerCase())
    await this.ctx.emitEvent('geo.region.recovery', { region })
  }

  /**
   * Simulate network partition
   */
  async simulatePartition(regions: string[]): Promise<void> {
    for (const region of regions) {
      this.partitionedRegions.add(region.toLowerCase())
    }
    await this.ctx.emitEvent('geo.partition', { regions })
  }

  /**
   * Simulate replication lag
   */
  async simulateReplicationLag(region: string, lagMs: number): Promise<void> {
    this.simulatedLag.set(region.toLowerCase(), lagMs)
  }

  /**
   * Simulate replication backlog
   */
  async simulateReplicationBacklog(region: string, pendingWrites: number): Promise<void> {
    this.simulatedBacklog.set(region.toLowerCase(), pendingWrites)
  }

  /**
   * Set replica lag for testing
   */
  async setReplicaLag(region: string, lagMs: number): Promise<void> {
    this.simulatedLag.set(region.toLowerCase(), lagMs)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private findNearestRegion(callerRegion: string, config: GeoConfigResult): string {
    const callerLower = callerRegion.toLowerCase()

    // Check routing cache first
    const cached = this.routingCache.get(callerLower)
    if (cached && Date.now() - cached.cachedAt < 60000) {
      return cached.region
    }

    // Get proximity list for caller
    const proximityList = REGION_PROXIMITY.get(callerLower) ?? []

    // Find nearest available region
    const allRegions = [config.primary, ...config.replicas]

    for (const nearRegion of proximityList) {
      if (allRegions.includes(nearRegion) && !this.failedRegions.has(nearRegion)) {
        return nearRegion
      }
    }

    // Check replicas directly
    for (const replica of config.replicas) {
      if (!this.failedRegions.has(replica)) {
        return replica
      }
    }

    // Fall back to primary
    return config.primary
  }

  private isConcurrentVectorClock(vc1: VectorClock, vc2: VectorClock): boolean {
    const allKeys = new Set([...Object.keys(vc1), ...Object.keys(vc2)])

    let vc1Greater = false
    let vc2Greater = false

    for (const key of allKeys) {
      const v1 = vc1[key] ?? 0
      const v2 = vc2[key] ?? 0

      if (v1 > v2) vc1Greater = true
      if (v2 > v1) vc2Greater = true
    }

    // Concurrent if neither dominates the other
    return vc1Greater && vc2Greater
  }

  private getRegionFromVectorClock(vc: VectorClock): string {
    // Return the region with the highest clock value
    let maxRegion = 'unknown'
    let maxValue = -1

    for (const [region, value] of Object.entries(vc)) {
      if (value > maxValue) {
        maxValue = value
        maxRegion = region
      }
    }

    return maxRegion
  }

  private recordLagSample(region: string, lagMs: number): void {
    let samples = this.lagSamples.get(region)
    if (!samples) {
      samples = []
      this.lagSamples.set(region, samples)
    }

    samples.push(lagMs)

    // Keep only last 100 samples
    if (samples.length > 100) {
      samples.shift()
    }
  }
}

// Export singleton factory
export function createGeoReplicationModule(): GeoReplicationModule {
  return new GeoReplicationModule()
}
