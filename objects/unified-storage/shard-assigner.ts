/**
 * ShardAssigner
 *
 * Determines which shard an entity belongs to using consistent hashing
 * and partition key extraction strategies.
 *
 * Architecture context:
 * - Each entity is assigned to exactly one shard based on partition key
 * - Same partition key always maps to the same shard (deterministic)
 * - Distribution should be even across all shards
 * - Hot shards (high traffic) are detected for potential rebalancing
 *
 * @module unified-storage/shard-assigner
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Thing data structure for shard assignment
 */
export interface ThingData {
  $id: string
  $type: string
  $version?: number
  namespace?: string
  tenantId?: string
  name?: string
  data?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
  [key: string]: unknown
}

/**
 * Partition key strategy types
 */
export type PartitionKeyStrategy = 'hash' | 'consistent' | 'range' | 'tenant'

/**
 * Shard metadata for tracking entity counts and sizes
 */
export interface ShardMetadata {
  shardId: number
  entityCount: number
  byteSize: number
  lastUpdated: Date
}

/**
 * Shard utilization metrics
 */
export interface ShardUtilization {
  entityUtilization: number
  byteUtilization: number
}

/**
 * Migration plan for rebalancing
 */
export interface MigrationPlan {
  entitiesToMove: number
  estimatedDuration: number
  targetShardId: number
}

/**
 * Rebalance hint for shard management
 */
export interface RebalanceHint {
  type: 'split' | 'merge'
  sourceShardId: number
  targetShardId?: number
  reason: 'entity_count' | 'byte_size'
  priority: 'urgent' | 'normal' | 'low'
  migrationPlan?: MigrationPlan
}

/**
 * Access record for hotspot detection
 */
interface AccessRecord {
  timestamp: number
  type: 'read' | 'write'
}

/**
 * Hot shard detection options
 */
export interface HotShardOptions {
  threshold: number
  windowMs: number
}

/**
 * ShardAssigner configuration
 */
export interface ShardAssignerConfig {
  /** Number of shards */
  shardCount: number
  /** Hashing strategy */
  strategy: PartitionKeyStrategy
  /** Partition key field or array of fields for composite keys */
  partitionKey?: string | string[]
  /** Fallback key field if primary is missing */
  fallbackKey?: string
  /** Strict mode - throw if partition key missing */
  strict?: boolean
  /** Custom partition key extraction function */
  partitionKeyFn?: (thing: ThingData) => string
  /** Track metadata for rebalancing */
  trackMetadata?: boolean
  /** Track access patterns for hotspot detection */
  trackAccess?: boolean
  /** Maximum entities per shard before suggesting split */
  maxEntitiesPerShard?: number
  /** Maximum bytes per shard before suggesting split */
  maxBytesPerShard?: number
  /** Minimum entities per shard before suggesting merge */
  minEntitiesPerShard?: number
  /** Number of virtual nodes for consistent hashing */
  virtualNodes?: number
}

/**
 * Serialized state for persistence
 */
interface SerializedState {
  shardCount: number
  strategy: PartitionKeyStrategy
  partitionKey?: string | string[]
  fallbackKey?: string
  strict?: boolean
  trackMetadata?: boolean
  trackAccess?: boolean
  maxEntitiesPerShard?: number
  maxBytesPerShard?: number
  minEntitiesPerShard?: number
  virtualNodes?: number
  metadata: Array<{
    shardId: number
    entityCount: number
    byteSize: number
    lastUpdated: string
  }>
}

/**
 * Stats about the shard assigner
 */
export interface ShardAssignerStats {
  shardCount: number
  strategy: PartitionKeyStrategy
  virtualNodes?: number
}

// ============================================================================
// ShardAssigner Implementation
// ============================================================================

/**
 * ShardAssigner determines which shard an entity belongs to.
 *
 * @example
 * ```typescript
 * const assigner = new ShardAssigner({
 *   shardCount: 8,
 *   strategy: 'hash',
 *   partitionKey: '$id',
 * })
 *
 * const thing = { $id: 'customer_123', $type: 'Customer', name: 'Alice' }
 * const shardId = assigner.assignThing(thing)
 * ```
 */
export class ShardAssigner {
  private config: Required<
    Pick<ShardAssignerConfig, 'shardCount' | 'strategy'>
  > & ShardAssignerConfig

  // Metadata tracking
  private shardMetadata: Map<number, ShardMetadata> = new Map()
  private registeredThings: Map<string, { shardId: number; size: number }> = new Map()

  // Access tracking for hotspot detection
  private accessRecords: Map<string, AccessRecord[]> = new Map()

  // Consistent hashing ring
  private consistentRing: Map<number, number> = new Map()
  private ringPositions: number[] = []

  constructor(config: ShardAssignerConfig) {
    // Validate configuration
    this.validateConfig(config)

    this.config = {
      ...config,
      shardCount: config.shardCount,
      strategy: config.strategy,
    }

    // Initialize shard metadata
    this.initializeMetadata()

    // Initialize consistent hashing ring if needed
    if (config.strategy === 'consistent') {
      this.initializeConsistentRing()
    }
  }

  // ==========================================================================
  // Configuration Validation
  // ==========================================================================

  private validateConfig(config: ShardAssignerConfig): void {
    if (config.shardCount <= 0) {
      throw new Error('shardCount must be positive')
    }
    if (!Number.isInteger(config.shardCount)) {
      throw new Error('shardCount must be an integer')
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  private initializeMetadata(): void {
    for (let i = 0; i < this.config.shardCount; i++) {
      this.shardMetadata.set(i, {
        shardId: i,
        entityCount: 0,
        byteSize: 0,
        lastUpdated: new Date(),
      })
    }
  }

  private initializeConsistentRing(): void {
    const virtualNodes = this.config.virtualNodes ?? 150
    this.consistentRing.clear()
    this.ringPositions = []

    for (let shard = 0; shard < this.config.shardCount; shard++) {
      for (let vn = 0; vn < virtualNodes; vn++) {
        const position = this.hashString(`shard_${shard}_vn_${vn}`)
        this.consistentRing.set(position, shard)
        this.ringPositions.push(position)
      }
    }

    // Sort ring positions for binary search
    this.ringPositions.sort((a, b) => a - b)
  }

  // ==========================================================================
  // Partition Key Extraction
  // ==========================================================================

  /**
   * Extract partition key from a thing
   */
  extractPartitionKey(thing: ThingData): string {
    // Custom function takes precedence
    if (this.config.partitionKeyFn) {
      return this.config.partitionKeyFn(thing)
    }

    const partitionKey = this.config.partitionKey ?? '$id'

    // Handle composite keys
    if (Array.isArray(partitionKey)) {
      const parts = partitionKey.map((field) => this.getFieldValue(thing, field))
      // Check if any part is undefined
      if (parts.some((p) => p === undefined)) {
        return this.handleMissingKey(thing)
      }
      return parts.join(':')
    }

    // Single field key
    const value = this.getFieldValue(thing, partitionKey)
    if (value === undefined) {
      return this.handleMissingKey(thing)
    }

    return String(value)
  }

  private getFieldValue(thing: ThingData, field: string): unknown {
    return thing[field]
  }

  private handleMissingKey(thing: ThingData): string {
    // Try fallback key
    if (this.config.fallbackKey) {
      const fallbackValue = this.getFieldValue(thing, this.config.fallbackKey)
      if (fallbackValue !== undefined) {
        return String(fallbackValue)
      }
    }

    // Strict mode throws
    if (this.config.strict) {
      throw new Error('Missing partition key')
    }

    // Default fallback to $id
    return thing.$id
  }

  // ==========================================================================
  // Shard Assignment
  // ==========================================================================

  /**
   * Assign a partition key to a shard
   */
  assignShard(partitionKey: string): number {
    if (!partitionKey || partitionKey.length === 0) {
      throw new Error('Invalid partition key')
    }

    switch (this.config.strategy) {
      case 'consistent':
        return this.assignConsistent(partitionKey)
      case 'range':
        return this.assignRange(partitionKey)
      case 'tenant':
        return this.assignTenant(partitionKey)
      case 'hash':
      default:
        return this.assignHash(partitionKey)
    }
  }

  /**
   * Assign a thing directly to a shard
   */
  assignThing(thing: ThingData): number {
    const partitionKey = this.extractPartitionKey(thing)
    if (!partitionKey || partitionKey.length === 0) {
      throw new Error('Invalid partition key')
    }
    return this.assignShard(partitionKey)
  }

  private assignHash(key: string): number {
    const hash = this.hashString(key)
    return Math.abs(hash) % this.config.shardCount
  }

  private assignConsistent(key: string): number {
    const keyHash = this.hashString(key)

    // Binary search for the position in the ring
    let left = 0
    let right = this.ringPositions.length - 1

    // Find first position >= keyHash
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.ringPositions[mid] < keyHash) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    // If key hash is greater than all positions, wrap to first
    const position =
      left < this.ringPositions.length ? this.ringPositions[left] : this.ringPositions[0]

    return this.consistentRing.get(position) ?? 0
  }

  private assignRange(key: string): number {
    // Simple range-based assignment using first character
    const firstChar = key.charCodeAt(0) || 0
    const charRange = 256 // Assume ASCII range
    const shardSize = Math.ceil(charRange / this.config.shardCount)
    return Math.min(Math.floor(firstChar / shardSize), this.config.shardCount - 1)
  }

  private assignTenant(key: string): number {
    // Tenant-based: hash the tenant/namespace portion
    // Assumes format like "tenant_xxx" or uses full key
    const parts = key.split('_')
    const tenantPart = parts.length > 1 ? parts.slice(0, -1).join('_') : key
    return this.assignHash(tenantPart)
  }

  private hashString(str: string): number {
    // DJB2 hash algorithm - simple and fast
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) + hash) ^ char
    }
    return hash >>> 0 // Convert to unsigned 32-bit
  }

  // ==========================================================================
  // Metadata Tracking
  // ==========================================================================

  /**
   * Register a thing with the assigner (tracks metadata)
   */
  registerThing(thing: ThingData): void {
    if (!this.config.trackMetadata) {
      return
    }

    const shardId = this.assignThing(thing)
    this.registerThingInShard(thing, shardId)
  }

  /**
   * Register a thing directly in a specific shard (for testing)
   */
  registerThingInShard(thing: ThingData, shardId: number): void {
    const size = this.calculateSize(thing)

    // Track the registration
    this.registeredThings.set(thing.$id, { shardId, size })

    // Update shard metadata
    const metadata = this.shardMetadata.get(shardId)
    if (metadata) {
      metadata.entityCount++
      metadata.byteSize += size
      metadata.lastUpdated = new Date()
    }
  }

  /**
   * Unregister a thing (for delete operations)
   */
  unregisterThing(thing: ThingData): void {
    const registration = this.registeredThings.get(thing.$id)
    if (!registration) {
      return
    }

    const metadata = this.shardMetadata.get(registration.shardId)
    if (metadata) {
      metadata.entityCount = Math.max(0, metadata.entityCount - 1)
      metadata.byteSize = Math.max(0, metadata.byteSize - registration.size)
      metadata.lastUpdated = new Date()
    }

    this.registeredThings.delete(thing.$id)
  }

  /**
   * Get metadata for all shards
   */
  getShardMetadata(): Map<number, ShardMetadata> {
    return new Map(this.shardMetadata)
  }

  /**
   * Calculate the size of a thing in bytes
   */
  private calculateSize(thing: ThingData): number {
    try {
      return JSON.stringify(thing).length * 2 // UTF-16 approximation
    } catch {
      return 256 // Default estimate
    }
  }

  // ==========================================================================
  // Access Tracking (Hotspot Detection)
  // ==========================================================================

  /**
   * Record an access to a key
   */
  recordAccess(key: string, type: 'read' | 'write'): void {
    if (!this.config.trackAccess) {
      return
    }

    const record: AccessRecord = {
      timestamp: Date.now(),
      type,
    }

    const records = this.accessRecords.get(key) ?? []
    records.push(record)
    this.accessRecords.set(key, records)

    // Prune old records (keep last hour)
    const cutoff = Date.now() - 3600000
    this.accessRecords.set(
      key,
      records.filter((r) => r.timestamp > cutoff)
    )
  }

  /**
   * Get hot shards based on access patterns
   */
  getHotShards(options: HotShardOptions): number[] {
    const { threshold, windowMs } = options
    const cutoff = Date.now() - windowMs

    // Count accesses per shard
    const shardAccesses = new Map<number, number>()

    for (const [key, records] of this.accessRecords) {
      const recentRecords = records.filter((r) => r.timestamp > cutoff)
      if (recentRecords.length > 0) {
        const shardId = this.assignShard(key)
        shardAccesses.set(shardId, (shardAccesses.get(shardId) ?? 0) + recentRecords.length)
      }
    }

    // Find shards exceeding threshold
    const hotShards: number[] = []
    for (const [shardId, count] of shardAccesses) {
      if (count >= threshold) {
        hotShards.push(shardId)
      }
    }

    return hotShards
  }

  // ==========================================================================
  // Utilization
  // ==========================================================================

  /**
   * Get utilization metrics for all shards
   */
  getShardUtilization(): Map<number, ShardUtilization> {
    const utilization = new Map<number, ShardUtilization>()

    const maxEntities = this.config.maxEntitiesPerShard ?? 1000
    const maxBytes = this.config.maxBytesPerShard ?? 1024 * 1024

    for (const [shardId, metadata] of this.shardMetadata) {
      utilization.set(shardId, {
        entityUtilization: Math.min(metadata.entityCount / maxEntities, 1),
        byteUtilization: Math.min(metadata.byteSize / maxBytes, 1),
      })
    }

    return utilization
  }

  // ==========================================================================
  // Rebalancing Hints
  // ==========================================================================

  /**
   * Get rebalancing hints for shard management
   */
  getRebalanceHints(): RebalanceHint[] {
    const hints: RebalanceHint[] = []

    const maxEntities = this.config.maxEntitiesPerShard ?? Infinity
    const maxBytes = this.config.maxBytesPerShard ?? Infinity
    const minEntities = this.config.minEntitiesPerShard ?? 0

    // Check each shard
    for (const [shardId, metadata] of this.shardMetadata) {
      // Check for oversized shards (need split)
      if (metadata.entityCount > maxEntities) {
        const overCount = metadata.entityCount - maxEntities
        const priority = overCount > maxEntities * 0.5 ? 'urgent' : 'normal'

        hints.push({
          type: 'split',
          sourceShardId: shardId,
          targetShardId: this.findLeastLoadedShard(shardId),
          reason: 'entity_count',
          priority,
          migrationPlan: {
            entitiesToMove: Math.ceil(overCount),
            estimatedDuration: Math.ceil(overCount / 100) * 1000, // ~100 entities/second
            targetShardId: this.findLeastLoadedShard(shardId),
          },
        })
      }

      // Check for byte size overflow
      if (metadata.byteSize > maxBytes) {
        const overBytes = metadata.byteSize - maxBytes
        const priority = overBytes > maxBytes * 0.5 ? 'urgent' : 'normal'

        hints.push({
          type: 'split',
          sourceShardId: shardId,
          targetShardId: this.findLeastLoadedShard(shardId),
          reason: 'byte_size',
          priority,
          migrationPlan: {
            entitiesToMove: Math.ceil(metadata.entityCount * (overBytes / metadata.byteSize)),
            estimatedDuration: Math.ceil((overBytes / 10000) * 100), // ~10KB/10ms
            targetShardId: this.findLeastLoadedShard(shardId),
          },
        })
      }

      // Check for undersized shards (need merge)
      if (minEntities > 0 && metadata.entityCount < minEntities && metadata.entityCount > 0) {
        hints.push({
          type: 'merge',
          sourceShardId: shardId,
          targetShardId: this.findBestMergeTarget(shardId),
          reason: 'entity_count',
          priority: 'low',
        })
      }
    }

    // Sort by priority (urgent first, then normal, then low)
    const priorityOrder = { urgent: 0, normal: 1, low: 2 }
    hints.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return hints
  }

  private findLeastLoadedShard(excludeShardId: number): number {
    let minCount = Infinity
    let targetShard = 0

    for (const [shardId, metadata] of this.shardMetadata) {
      if (shardId !== excludeShardId && metadata.entityCount < minCount) {
        minCount = metadata.entityCount
        targetShard = shardId
      }
    }

    return targetShard
  }

  private findBestMergeTarget(sourceShardId: number): number {
    const sourceMetadata = this.shardMetadata.get(sourceShardId)
    if (!sourceMetadata) return sourceShardId === 0 ? 1 : 0

    const maxEntities = this.config.maxEntitiesPerShard ?? Infinity
    let bestTarget = -1
    let bestFit = Infinity

    for (const [shardId, metadata] of this.shardMetadata) {
      if (shardId === sourceShardId) continue

      const combinedCount = metadata.entityCount + sourceMetadata.entityCount
      if (combinedCount <= maxEntities) {
        // Prefer shards that are already somewhat populated
        const fit = Math.abs(maxEntities / 2 - combinedCount)
        if (fit < bestFit) {
          bestFit = fit
          bestTarget = shardId
        }
      }
    }

    // If no suitable target found, return a different shard
    if (bestTarget === -1) {
      // Find any shard that isn't the source
      for (const [shardId] of this.shardMetadata) {
        if (shardId !== sourceShardId) {
          return shardId
        }
      }
      // Fallback: return next shard (wrapping)
      return (sourceShardId + 1) % this.config.shardCount
    }

    return bestTarget
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Update the shard count dynamically
   */
  setShardCount(newCount: number): void {
    if (newCount <= 0 || !Number.isInteger(newCount)) {
      throw new Error('Invalid shard count')
    }

    this.config.shardCount = newCount

    // Reinitialize metadata for new shards
    this.initializeMetadata()

    // Reinitialize consistent ring if using consistent hashing
    if (this.config.strategy === 'consistent') {
      this.initializeConsistentRing()
    }
  }

  /**
   * Get statistics about the assigner
   */
  getStats(): ShardAssignerStats {
    return {
      shardCount: this.config.shardCount,
      strategy: this.config.strategy,
      virtualNodes: this.config.virtualNodes,
    }
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  /**
   * Serialize the assigner state for persistence
   */
  serialize(): string {
    const state: SerializedState = {
      shardCount: this.config.shardCount,
      strategy: this.config.strategy,
      partitionKey: this.config.partitionKey,
      fallbackKey: this.config.fallbackKey,
      strict: this.config.strict,
      trackMetadata: this.config.trackMetadata,
      trackAccess: this.config.trackAccess,
      maxEntitiesPerShard: this.config.maxEntitiesPerShard,
      maxBytesPerShard: this.config.maxBytesPerShard,
      minEntitiesPerShard: this.config.minEntitiesPerShard,
      virtualNodes: this.config.virtualNodes,
      metadata: Array.from(this.shardMetadata.entries()).map(([shardId, meta]) => ({
        shardId,
        entityCount: meta.entityCount,
        byteSize: meta.byteSize,
        lastUpdated: meta.lastUpdated.toISOString(),
      })),
    }

    return JSON.stringify(state)
  }

  /**
   * Deserialize and restore assigner state
   */
  static deserialize(serialized: string): ShardAssigner {
    const state: SerializedState = JSON.parse(serialized)

    const assigner = new ShardAssigner({
      shardCount: state.shardCount,
      strategy: state.strategy,
      partitionKey: state.partitionKey,
      fallbackKey: state.fallbackKey,
      strict: state.strict,
      trackMetadata: state.trackMetadata,
      trackAccess: state.trackAccess,
      maxEntitiesPerShard: state.maxEntitiesPerShard,
      maxBytesPerShard: state.maxBytesPerShard,
      minEntitiesPerShard: state.minEntitiesPerShard,
      virtualNodes: state.virtualNodes,
    })

    // Restore metadata
    for (const meta of state.metadata) {
      assigner.shardMetadata.set(meta.shardId, {
        shardId: meta.shardId,
        entityCount: meta.entityCount,
        byteSize: meta.byteSize,
        lastUpdated: new Date(meta.lastUpdated),
      })
    }

    return assigner
  }
}
