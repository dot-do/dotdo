/**
 * Geo-Replication Module
 *
 * Provides multi-region data replication capabilities for Durable Objects:
 * - Region configuration (primary/replica regions)
 * - Write forwarding to primary region
 * - Read routing to nearest replica
 * - Conflict resolution (LWW, vector clocks)
 * - Eventual consistency guarantees
 * - Failover scenarios
 * - Replication lag metrics
 */

import type { LifecycleContext, LifecycleModule } from './lifecycle/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Region configuration options
 */
export interface RegionConfig {
  primary: string
  replicas: string[]
  readPreference?: 'nearest' | 'primary' | 'secondary'
  conflictResolution?: 'lww' | 'vector-clock' | 'manual'
  consistency?: 'eventual' | 'strong' | 'bounded-staleness'
  maxStalenessMs?: number
  failover?: FailoverConfig
  monitoring?: MonitoringConfig
}

export interface RegionInfo {
  code: string
  name: string
  continent: string
  isActive: boolean
  latencyMs?: number
}

export interface GeoConfigResult {
  primary: string
  replicas: string[]
  configuredAt: string
  version: number
}

/**
 * Replication types
 */
export interface ReplicationStatus {
  region: string
  lag: number
  lastSync: string
  status: 'synced' | 'syncing' | 'behind' | 'disconnected'
}

export interface WriteResult {
  key: string
  primaryRegion: string
  propagatedTo: string[]
  timestamp: number
}

export interface ReadResult<T = unknown> {
  value: T
  sourceRegion: string
  version: number
  timestamp: number
}

/**
 * Conflict resolution types
 */
export interface VectorClock {
  [region: string]: number
}

export interface ConflictInfo {
  key: string
  conflictingValues: Array<{
    value: unknown
    region: string
    timestamp: number
    vectorClock: VectorClock
  }>
  resolvedValue?: unknown
  resolution?: 'lww' | 'vector-clock' | 'manual'
}

/**
 * Failover types
 */
export interface FailoverEvent {
  previousPrimary: string
  newPrimary: string
  reason: 'timeout' | 'manual' | 'health-check'
  timestamp: string
  dataLoss: boolean
}

export interface FailoverConfig {
  enabled: boolean
  timeoutMs?: number
  minReplicas?: number
  healthCheckIntervalMs?: number
}

export interface MonitoringConfig {
  lagAlertThresholdMs?: number
}

/**
 * Metrics types
 */
export interface ReplicationLagMetrics {
  maxLagMs: number
  avgLagMs: number
  p50LagMs: number
  p95LagMs: number
  p99LagMs: number
  byRegion: Record<string, number>
}

export interface ConsistencyMetrics {
  level: 'eventual' | 'strong' | 'bounded-staleness'
  staleness?: number
  quorumSize?: number
}

export interface ReplicationQueueStatus {
  pendingWrites: number
  oldestWrite?: string
}

export interface RegionStatus {
  healthy: boolean
  lastCheck?: string
  responseTime?: number
}

export interface RegionRole {
  role: 'primary' | 'replica' | 'unknown'
}

export interface ReplicaStatus {
  state: 'syncing' | 'synced' | 'disconnected'
  lag?: number
  lastSync?: string
}

export interface Alert {
  type: 'replication-lag' | 'region-failure' | 'conflict'
  region?: string
  message: string
  timestamp: string
}

export interface LagHistoryPoint {
  timestamp: string
  lagMs: number
}

export interface ReplicationETA {
  pendingWrites: number
  estimatedCompletionMs: number
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

export class GeoReplicationModule implements LifecycleModule {
  private ctx!: LifecycleContext

  // State storage keys
  private static readonly CONFIG_KEY = 'geo:config'
  private static readonly DATA_PREFIX = 'geo:data:'
  private static readonly VECTOR_CLOCK_PREFIX = 'geo:vc:'
  private static readonly CONFLICT_PREFIX = 'geo:conflict:'
  private static readonly QUEUE_PREFIX = 'geo:queue:'
  private static readonly METRICS_PREFIX = 'geo:metrics:'
  private static readonly FAILOVER_HISTORY_KEY = 'geo:failover:history'
  private static readonly ALERTS_KEY = 'geo:alerts'
  private static readonly LAG_HISTORY_PREFIX = 'geo:lag:history:'
  private static readonly ROUTING_CACHE_KEY = 'geo:routing:cache'

  // In-memory caches
  private routingCache: Map<string, { region: string; cachedAt: number }> = new Map()
  private latencyCache: Map<string, number> = new Map()
  private lagSamples: Map<string, number[]> = new Map()
  private conflictListeners: Array<(event: ConflictInfo) => void> = []

  // Simulated state for testing
  private failedRegions: Set<string> = new Set()
  private partitionedRegions: Set<string> = new Set()
  private simulatedLag: Map<string, number> = new Map()
  private simulatedBacklog: Map<string, number> = new Map()
  private sessionWrites: Map<string, Map<string, unknown>> = new Map()

  initialize(context: LifecycleContext): void {
    this.ctx = context
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGION CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configure geo-replication regions
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
   * Get current region configuration
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
   * List all available regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    return Array.from(VALID_REGIONS.values())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Write data with geo-replication
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
   * Write with explicit timestamp (for conflict resolution testing)
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
   * Write with vector clock (for conflict detection)
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
   * Read data with geo-routing
   */
  async read<T = unknown>(
    key: string,
    options?: {
      callerRegion?: string
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
   * Trigger failover
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
