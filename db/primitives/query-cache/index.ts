/**
 * QueryCacheLayer - Comprehensive query result caching for Cloudflare
 *
 * Provides a multi-tier caching layer for query results with:
 * - Query fingerprinting for cache keys
 * - TTL-based expiration
 * - Event-driven invalidation (on data changes)
 * - Cache warming for common queries
 * - Multi-tier caching (memory, KV, R2)
 * - Cache partitioning by tenant
 * - Cache statistics and monitoring
 *
 * Integration with Cloudflare:
 * - Workers KV for hot cache
 * - R2 for large result sets
 * - Durable Objects for coordination
 *
 * @see dotdo-si6zj
 *
 * @example
 * ```typescript
 * import { QueryCacheLayer } from './query-cache'
 *
 * const cache = new QueryCacheLayer({
 *   kv: env.CACHE_KV,
 *   r2: env.CACHE_R2,
 *   defaultTTL: 60000,
 *   multiTenant: true,
 * })
 *
 * // Cache a query result
 * const result = await cache.getOrSet(
 *   { sql: 'SELECT * FROM users WHERE status = ?', params: ['active'] },
 *   { tenantId: 'acme' },
 *   async () => executeQuery(...)
 * )
 *
 * // Invalidate on data change
 * await cache.invalidateByTable('users')
 * ```
 */

import { createHash } from 'node:crypto'

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Error thrown when cache entry has expired
 */
export class CacheExpiredError extends Error {
  constructor(key: string) {
    super(`Cache entry '${key}' has expired`)
    this.name = 'CacheExpiredError'
  }
}

/**
 * Error thrown when cache entry is not found
 */
export class CacheMissError extends Error {
  constructor(key: string) {
    super(`Cache miss for key '${key}'`)
    this.name = 'CacheMissError'
  }
}

/**
 * Error thrown when cache entry has been invalidated
 */
export class CacheInvalidatedError extends Error {
  constructor(key: string, reason?: string) {
    super(`Cache entry '${key}' was invalidated${reason ? `: ${reason}` : ''}`)
    this.name = 'CacheInvalidatedError'
  }
}

/**
 * Error thrown when tenant context is required but missing
 */
export class TenantIsolationError extends Error {
  constructor(operation: string) {
    super(`Tenant context required for operation: ${operation}`)
    this.name = 'TenantIsolationError'
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Cache tier options
 */
export type CacheTier = 'memory' | 'kv' | 'r2'

/**
 * Query definition for caching
 */
export interface Query {
  sql: string
  params: unknown[]
}

/**
 * Query fingerprint components
 */
export interface QueryFingerprint {
  tenantId?: string
  queryHash: string
  paramsHash: string
  full: string
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = unknown> {
  value: T
  fingerprint: string
  tier: CacheTier
  createdAt: number
  expiresAt: number
  lastAccessedAt: number
  accessCount: number
  sizeBytes: number
  tables?: string[]
  entities?: string[]
  dependsOn?: string[]
  tenantId?: string
  sql?: string
}

/**
 * Invalidation event
 */
export interface InvalidationEvent {
  type: 'table' | 'entity' | 'prefix' | 'cascade' | 'manual' | 'ttl'
  target: string
  fingerprints: string[]
  timestamp: number
  tenantId?: string
  reason?: string
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number
  misses: number
  hitRatio: number
  evictions: number
  entries: number
  totalEntries: number
  memoryEntries: number
  kvEntries: number
  r2Entries: number
  totalSizeBytes: number
  avgLatencyMs: {
    get: number
    set: number
    hit: number
    miss: number
  }
}

/**
 * Tenant-specific configuration
 */
export interface TenantConfig {
  tenantId: string
  defaultTTL?: number
  maxEntries?: number
  allowedTiers?: CacheTier[]
}

/**
 * Cache warming configuration
 */
export interface WarmingConfig {
  queries: Query[]
  interval?: number
  skipExisting?: boolean
}

/**
 * Set options for cache entries
 */
export interface SetOptions {
  ttl?: number
  tier?: CacheTier
  tables?: string[]
  entities?: string[]
  dependsOn?: string[]
  tenantId?: string
}

/**
 * Get options for cache retrieval
 */
export interface GetOptions {
  tenantId?: string
}

/**
 * Hot query info
 */
export interface HotQueryInfo {
  query: Query
  accessCount: number
  lastAccessedAt: number
}

/**
 * KV namespace interface (Cloudflare Workers KV)
 */
export interface KVNamespace {
  get<T>(key: string, options?: { type?: string }): Promise<T | null>
  put(key: string, value: unknown, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
}

/**
 * R2 bucket interface (Cloudflare R2)
 */
export interface R2Bucket {
  get(key: string): Promise<{ json: () => Promise<unknown>; customMetadata: Record<string, unknown> } | null>
  put(key: string, body: unknown, options?: { customMetadata?: Record<string, unknown> }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

/**
 * DO namespace interface
 */
export interface DONamespace {
  idFromName(name: string): { toString: () => string }
  get(id: unknown): { fetch: (req: Request) => Promise<Response> }
}

/**
 * Cache configuration options
 */
export interface QueryCacheConfig {
  /** Workers KV namespace for hot cache */
  kv?: KVNamespace
  /** R2 bucket for large result sets */
  r2?: R2Bucket
  /** Durable Objects namespace for coordination */
  do?: DONamespace
  /** Default TTL in milliseconds */
  defaultTTL?: number
  /** Whether to refresh TTL on read */
  refreshTTLOnRead?: boolean
  /** Enabled cache tiers */
  tiers?: CacheTier[]
  /** Size thresholds for automatic tier selection */
  tierThresholds?: Record<CacheTier, number>
  /** Maximum entries in memory tier */
  maxMemoryEntries?: number
  /** Enable multi-tenant mode */
  multiTenant?: boolean
  /** Require tenant context for all operations */
  requireTenant?: boolean
  /** Per-tenant configurations */
  tenantConfigs?: TenantConfig[]
  /** Enable metrics tracking */
  enableMetrics?: boolean
  /** Callback for metrics events */
  onMetrics?: (stats: CacheStats) => void
  /** Strict mode - throw on miss/expire */
  strictMode?: boolean
}

// =============================================================================
// FINGERPRINTING FUNCTIONS
// =============================================================================

/**
 * Hash a string using SHA-256
 */
function hashString(str: string): string {
  // Use a simple hash for browser compatibility when crypto is not available
  if (typeof createHash === 'function') {
    try {
      return createHash('sha256').update(str).digest('hex').substring(0, 16)
    } catch {
      // Fall through to simple hash
    }
  }

  // Simple hash fallback
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * Normalize SQL for consistent fingerprinting
 */
function normalizeSQL(sql: string): string {
  return sql
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim()
    .toLowerCase()
}

/**
 * Generate a fingerprint for a query
 */
export function fingerprintQuery(
  query: Query,
  context?: { tenantId?: string }
): string {
  const normalizedSQL = normalizeSQL(query.sql)
  const queryHash = hashString(normalizedSQL)
  const paramsHash = hashString(JSON.stringify(query.params))

  const parts = []
  if (context?.tenantId) {
    parts.push(`t:${context.tenantId}`)
  }
  parts.push(`q:${queryHash}`)
  parts.push(`p:${paramsHash}`)

  return parts.join(':')
}

/**
 * Parse a fingerprint back to components
 */
export function parseFingerprint(fingerprint: string): QueryFingerprint {
  const parts = fingerprint.split(':')
  let tenantId: string | undefined
  let queryHash = ''
  let paramsHash = ''

  for (let i = 0; i < parts.length; i += 2) {
    const type = parts[i]
    const value = parts[i + 1]
    if (type === 't') tenantId = value
    if (type === 'q') queryHash = value || ''
    if (type === 'p') paramsHash = value || ''
  }

  return {
    tenantId,
    queryHash,
    paramsHash,
    full: fingerprint,
  }
}

// =============================================================================
// QUERY CACHE LAYER
// =============================================================================

/**
 * QueryCacheLayer - Multi-tier caching for query results
 */
export class QueryCacheLayer {
  private kv?: KVNamespace
  private r2?: R2Bucket
  private do?: DONamespace
  private config: Required<Omit<QueryCacheConfig, 'kv' | 'r2' | 'do' | 'tenantConfigs' | 'onMetrics'>> & {
    tenantConfigs: Map<string, TenantConfig>
    onMetrics?: (stats: CacheStats) => void
  }

  // In-memory cache tier
  private memoryCache = new Map<string, CacheEntry>()

  // Dependency tracking: table/entity -> Set of fingerprints
  private tableIndex = new Map<string, Set<string>>()
  private entityIndex = new Map<string, Set<string>>()
  private dependencyIndex = new Map<string, Set<string>>()

  // Query tracking for hot queries
  private queryAccessLog = new Map<string, { query: Query; accessCount: number; lastAccessedAt: number }>()

  // Recently expired keys (for error distinction)
  private recentlyExpired = new Set<string>()

  // Metrics
  private metrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    latencies: {
      get: [] as number[],
      set: [] as number[],
      hit: [] as number[],
      miss: [] as number[],
    },
  }

  // Event listeners
  private invalidationListeners: ((event: InvalidationEvent) => void)[] = []

  // Scheduled warming
  private warmingInterval?: ReturnType<typeof setInterval>

  constructor(config: QueryCacheConfig = {}) {
    this.kv = config.kv
    this.r2 = config.r2
    this.do = config.do

    const tenantConfigMap = new Map<string, TenantConfig>()
    if (config.tenantConfigs) {
      for (const tc of config.tenantConfigs) {
        tenantConfigMap.set(tc.tenantId, tc)
      }
    }

    this.config = {
      defaultTTL: config.defaultTTL ?? 60000,
      refreshTTLOnRead: config.refreshTTLOnRead ?? false,
      tiers: config.tiers ?? ['memory', 'kv', 'r2'],
      tierThresholds: config.tierThresholds ?? {
        memory: 10 * 1024, // 10KB
        kv: 25 * 1024 * 1024, // 25MB (KV limit)
        r2: Infinity,
      },
      maxMemoryEntries: config.maxMemoryEntries ?? 1000,
      multiTenant: config.multiTenant ?? false,
      requireTenant: config.requireTenant ?? false,
      tenantConfigs: tenantConfigMap,
      enableMetrics: config.enableMetrics ?? false,
      strictMode: config.strictMode ?? false,
      onMetrics: config.onMetrics,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private validateTenantContext(options?: GetOptions | SetOptions, operation = 'operation'): void {
    if (this.config.requireTenant && !options?.tenantId) {
      throw new TenantIsolationError(operation)
    }
  }

  private getTTLForTenant(tenantId?: string): number {
    if (tenantId) {
      const tenantConfig = this.config.tenantConfigs.get(tenantId)
      if (tenantConfig?.defaultTTL) {
        return tenantConfig.defaultTTL
      }
    }
    return this.config.defaultTTL
  }

  private selectTierBySize(sizeBytes: number): CacheTier {
    if (sizeBytes < this.config.tierThresholds.memory) return 'memory'
    if (sizeBytes < this.config.tierThresholds.kv) return 'kv'
    return 'r2'
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() >= entry.expiresAt
  }

  private evictMemoryIfNeeded(): void {
    while (this.memoryCache.size >= this.config.maxMemoryEntries) {
      // Evict LRU entry
      let oldestKey: string | null = null
      let oldestTime = Infinity

      for (const [key, entry] of this.memoryCache) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt
          oldestKey = key
        }
      }

      if (oldestKey) {
        this.memoryCache.delete(oldestKey)
        this.metrics.evictions++
      }
    }
  }

  private emitInvalidationEvent(event: InvalidationEvent): void {
    for (const listener of this.invalidationListeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  private recordLatency(operation: 'get' | 'set' | 'hit' | 'miss', latencyMs: number): void {
    if (this.config.enableMetrics) {
      this.metrics.latencies[operation].push(latencyMs)
      // Keep only last 1000 samples
      if (this.metrics.latencies[operation].length > 1000) {
        this.metrics.latencies[operation].shift()
      }
    }
  }

  private avgLatency(arr: number[]): number {
    if (arr.length === 0) return 0
    return arr.reduce((a, b) => a + b, 0) / arr.length
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a cached query result
   */
  async get<T>(query: Query, options?: GetOptions): Promise<T | undefined> {
    this.validateTenantContext(options, 'get')

    const startTime = performance.now()
    const fingerprint = fingerprintQuery(query, options)

    // Track query access
    const existing = this.queryAccessLog.get(fingerprint)
    if (existing) {
      existing.accessCount++
      existing.lastAccessedAt = Date.now()
    } else {
      this.queryAccessLog.set(fingerprint, {
        query,
        accessCount: 1,
        lastAccessedAt: Date.now(),
      })
    }

    // Try memory tier first
    const memoryEntry = this.memoryCache.get(fingerprint)
    if (memoryEntry) {
      if (this.isExpired(memoryEntry)) {
        this.memoryCache.delete(fingerprint)
        this.recentlyExpired.add(fingerprint)
        this.metrics.misses++
        this.recordLatency('miss', performance.now() - startTime)
        return undefined
      }

      // Update access info
      memoryEntry.lastAccessedAt = Date.now()
      memoryEntry.accessCount++

      // Refresh TTL if configured
      if (this.config.refreshTTLOnRead) {
        const ttl = memoryEntry.expiresAt - memoryEntry.createdAt
        memoryEntry.expiresAt = Date.now() + ttl
      }

      this.metrics.hits++
      this.recordLatency('hit', performance.now() - startTime)
      this.recordLatency('get', performance.now() - startTime)
      return memoryEntry.value as T
    }

    // Try KV tier
    if (this.kv) {
      try {
        const kvEntry = await this.kv.get<{ value: T; expiresAt: number }>(fingerprint, { type: 'json' })
        if (kvEntry) {
          if (Date.now() >= kvEntry.expiresAt) {
            await this.kv.delete(fingerprint)
            this.recentlyExpired.add(fingerprint)
            this.metrics.misses++
            this.recordLatency('miss', performance.now() - startTime)
            return undefined
          }

          // Promote to memory tier
          const entry: CacheEntry<T> = {
            value: kvEntry.value,
            fingerprint,
            tier: 'kv',
            createdAt: Date.now(),
            expiresAt: kvEntry.expiresAt,
            lastAccessedAt: Date.now(),
            accessCount: 1,
            sizeBytes: JSON.stringify(kvEntry.value).length,
            tenantId: options?.tenantId,
          }
          this.memoryCache.set(fingerprint, entry)

          this.metrics.hits++
          this.recordLatency('hit', performance.now() - startTime)
          this.recordLatency('get', performance.now() - startTime)
          return kvEntry.value
        }
      } catch {
        // KV error, continue to R2
      }
    }

    // Try R2 tier
    if (this.r2) {
      try {
        const r2Object = await this.r2.get(fingerprint)
        if (r2Object) {
          const expiresAt = Number(r2Object.customMetadata.expiresAt)
          if (Date.now() >= expiresAt) {
            await this.r2.delete(fingerprint)
            this.recentlyExpired.add(fingerprint)
            this.metrics.misses++
            this.recordLatency('miss', performance.now() - startTime)
            return undefined
          }

          const value = await r2Object.json() as T

          // Promote to KV tier
          if (this.kv) {
            const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000)
            await this.kv.put(fingerprint, JSON.stringify({ value, expiresAt }), {
              expirationTtl: ttlSeconds,
            })
          }

          this.metrics.hits++
          this.recordLatency('hit', performance.now() - startTime)
          this.recordLatency('get', performance.now() - startTime)
          return value
        }
      } catch {
        // R2 error, continue to miss
      }
    }

    this.metrics.misses++
    this.recordLatency('miss', performance.now() - startTime)
    this.recordLatency('get', performance.now() - startTime)
    return undefined
  }

  /**
   * Get a cached query result or throw
   */
  async getOrThrow<T>(query: Query, options?: GetOptions): Promise<T> {
    const fingerprint = fingerprintQuery(query, options)

    // Check if recently expired
    if (this.recentlyExpired.has(fingerprint)) {
      throw new CacheExpiredError(fingerprint)
    }

    const result = await this.get<T>(query, options)
    if (result === undefined) {
      if (this.recentlyExpired.has(fingerprint)) {
        throw new CacheExpiredError(fingerprint)
      }
      throw new CacheMissError(fingerprint)
    }
    return result
  }

  /**
   * Set a cached query result
   */
  async set<T>(query: Query, value: T, options?: SetOptions): Promise<void> {
    this.validateTenantContext(options, 'set')

    const startTime = performance.now()
    const fingerprint = fingerprintQuery(query, options)
    const valueStr = JSON.stringify(value)
    const sizeBytes = valueStr.length
    const ttl = options?.ttl ?? this.getTTLForTenant(options?.tenantId)
    const expiresAt = Date.now() + ttl
    const tier = options?.tier ?? this.selectTierBySize(sizeBytes)

    // Clear recently expired status
    this.recentlyExpired.delete(fingerprint)

    const entry: CacheEntry<T> = {
      value,
      fingerprint,
      tier,
      createdAt: Date.now(),
      expiresAt,
      lastAccessedAt: Date.now(),
      accessCount: 0,
      sizeBytes,
      tables: options?.tables,
      entities: options?.entities,
      dependsOn: options?.dependsOn,
      tenantId: options?.tenantId,
      sql: query.sql,
    }

    // Update indexes
    if (options?.tables) {
      for (const table of options.tables) {
        const key = options?.tenantId ? `${options.tenantId}:${table}` : table
        if (!this.tableIndex.has(key)) {
          this.tableIndex.set(key, new Set())
        }
        this.tableIndex.get(key)!.add(fingerprint)
      }
    }

    if (options?.entities) {
      for (const entity of options.entities) {
        const key = options?.tenantId ? `${options.tenantId}:${entity}` : entity
        if (!this.entityIndex.has(key)) {
          this.entityIndex.set(key, new Set())
        }
        this.entityIndex.get(key)!.add(fingerprint)
      }
    }

    if (options?.dependsOn) {
      for (const dep of options.dependsOn) {
        const key = options?.tenantId ? `${options.tenantId}:${dep}` : dep
        if (!this.dependencyIndex.has(key)) {
          this.dependencyIndex.set(key, new Set())
        }
        this.dependencyIndex.get(key)!.add(fingerprint)
      }
    }

    // Store in appropriate tier(s)
    if (tier === 'memory' || this.config.tiers.includes('memory')) {
      this.evictMemoryIfNeeded()
      this.memoryCache.set(fingerprint, entry)
    }

    if (tier === 'kv' && this.kv) {
      const ttlSeconds = Math.ceil(ttl / 1000)
      await this.kv.put(fingerprint, JSON.stringify({ value, expiresAt }), {
        expirationTtl: ttlSeconds,
        metadata: { tables: options?.tables, entities: options?.entities },
      })
    }

    if (tier === 'r2' && this.r2) {
      await this.r2.put(fingerprint, JSON.stringify(value), {
        customMetadata: {
          expiresAt: String(expiresAt),
          tables: options?.tables?.join(',') ?? '',
          entities: options?.entities?.join(',') ?? '',
        },
      })
    }

    this.recordLatency('set', performance.now() - startTime)
  }

  /**
   * Get or compute and set a cached value
   */
  async getOrSet<T>(
    query: Query,
    options: SetOptions | undefined,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get<T>(query, options)
    if (cached !== undefined) {
      return cached
    }

    const value = await compute()
    await this.set(query, value, options)
    return value
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INVALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Invalidate cache entries by table name
   */
  async invalidateByTable(table: string, options?: { tenantId?: string }): Promise<void> {
    const key = options?.tenantId ? `${options.tenantId}:${table}` : table
    const fingerprints = this.tableIndex.get(key) || new Set<string>()

    // Also check non-tenant-scoped entries if no tenant specified
    if (!options?.tenantId) {
      for (const [indexKey, fps] of this.tableIndex) {
        if (indexKey === table || indexKey.endsWith(`:${table}`)) {
          for (const fp of fps) {
            fingerprints.add(fp)
          }
        }
      }
    }

    const invalidatedFingerprints: string[] = []

    for (const fingerprint of fingerprints) {
      this.memoryCache.delete(fingerprint)
      if (this.kv) {
        try {
          await this.kv.delete(fingerprint)
        } catch {
          // Ignore KV errors
        }
      }
      if (this.r2) {
        try {
          await this.r2.delete(fingerprint)
        } catch {
          // Ignore R2 errors
        }
      }
      invalidatedFingerprints.push(fingerprint)
    }

    this.tableIndex.delete(key)

    this.emitInvalidationEvent({
      type: 'table',
      target: table,
      fingerprints: invalidatedFingerprints,
      timestamp: Date.now(),
      tenantId: options?.tenantId,
    })
  }

  /**
   * Invalidate cache entries by entity pattern
   */
  async invalidateByEntity(entity: string, options?: { tenantId?: string }): Promise<void> {
    const key = options?.tenantId ? `${options.tenantId}:${entity}` : entity
    const fingerprints = this.entityIndex.get(key) || new Set<string>()

    const invalidatedFingerprints: string[] = []

    for (const fingerprint of fingerprints) {
      this.memoryCache.delete(fingerprint)
      if (this.kv) {
        try {
          await this.kv.delete(fingerprint)
        } catch {
          // Ignore KV errors
        }
      }
      invalidatedFingerprints.push(fingerprint)
    }

    this.entityIndex.delete(key)

    this.emitInvalidationEvent({
      type: 'entity',
      target: entity,
      fingerprints: invalidatedFingerprints,
      timestamp: Date.now(),
      tenantId: options?.tenantId,
    })
  }

  /**
   * Invalidate cache entries by SQL prefix
   */
  async invalidateByPrefix(sqlPrefix: string): Promise<void> {
    const normalizedPrefix = normalizeSQL(sqlPrefix)
    const invalidatedFingerprints: string[] = []

    // We store SQL in the entry so we can match against prefix
    for (const [fingerprint, entry] of this.memoryCache) {
      // Check if entry has the original SQL stored and matches prefix
      if (entry.sql && normalizeSQL(entry.sql).startsWith(normalizedPrefix)) {
        this.memoryCache.delete(fingerprint)
        invalidatedFingerprints.push(fingerprint)
      }
    }

    // For KV/R2, we would need to list and filter, which is expensive
    // In production, consider using a separate index

    this.emitInvalidationEvent({
      type: 'prefix',
      target: sqlPrefix,
      fingerprints: invalidatedFingerprints,
      timestamp: Date.now(),
    })
  }

  /**
   * Cascade invalidation from a parent entity
   */
  async invalidateCascade(entity: string, options?: { tenantId?: string }): Promise<void> {
    const visited = new Set<string>()
    const toInvalidate: string[] = [entity]
    const invalidatedFingerprints: string[] = []

    while (toInvalidate.length > 0) {
      const current = toInvalidate.pop()!
      if (visited.has(current)) continue
      visited.add(current)

      const key = options?.tenantId ? `${options.tenantId}:${current}` : current

      // Get fingerprints for this entity
      const entityFps = this.entityIndex.get(key) || new Set<string>()
      for (const fp of entityFps) {
        this.memoryCache.delete(fp)
        invalidatedFingerprints.push(fp)
      }
      this.entityIndex.delete(key)

      // Get dependents
      const dependentFps = this.dependencyIndex.get(key) || new Set<string>()
      for (const fp of dependentFps) {
        this.memoryCache.delete(fp)
        invalidatedFingerprints.push(fp)
      }
      this.dependencyIndex.delete(key)

      // Find child entities (entities that start with this entity's key)
      for (const [indexKey, fps] of this.entityIndex) {
        if (indexKey.startsWith(`${current}:`)) {
          toInvalidate.push(indexKey.replace(`${options?.tenantId}:`, ''))
        }
      }
    }

    this.emitInvalidationEvent({
      type: 'cascade',
      target: entity,
      fingerprints: invalidatedFingerprints,
      timestamp: Date.now(),
      tenantId: options?.tenantId,
    })
  }

  /**
   * Broadcast invalidation to other DOs
   */
  async broadcastInvalidation(
    target: string,
    options: { targetDOs: string[] }
  ): Promise<void> {
    if (!this.do) return

    for (const doName of options.targetDOs) {
      try {
        const id = this.do.idFromName(doName)
        const stub = this.do.get(id)
        await stub.fetch(new Request('https://internal/invalidate', {
          method: 'POST',
          body: JSON.stringify({ target }),
        }))
      } catch {
        // Ignore DO errors
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHE WARMING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Warm cache with provided queries
   */
  async warm(
    queries: Query[],
    loader: (query: Query) => Promise<unknown>,
    options?: { skipExisting?: boolean; tenantId?: string }
  ): Promise<void> {
    for (const query of queries) {
      const fingerprint = fingerprintQuery(query, options)

      if (options?.skipExisting) {
        const existing = this.memoryCache.get(fingerprint)
        if (existing && !this.isExpired(existing)) {
          continue
        }
      }

      const value = await loader(query)
      await this.set(query, value, { tenantId: options?.tenantId })
    }
  }

  /**
   * Get hot queries based on access patterns
   */
  async getHotQueries(options?: { threshold?: number; limit?: number }): Promise<HotQueryInfo[]> {
    const threshold = options?.threshold ?? 1
    const limit = options?.limit ?? 100

    const hotQueries: HotQueryInfo[] = []

    for (const [, info] of this.queryAccessLog) {
      if (info.accessCount >= threshold) {
        hotQueries.push(info)
      }
    }

    // Sort by access count descending
    hotQueries.sort((a, b) => b.accessCount - a.accessCount)

    return hotQueries.slice(0, limit)
  }

  /**
   * Start scheduled cache warming
   */
  async startScheduledWarming(
    config: WarmingConfig,
    loader: (query: Query) => Promise<unknown>
  ): Promise<void> {
    // Initial warm
    await this.warm(config.queries, loader, { skipExisting: config.skipExisting })

    // Schedule periodic warming
    if (config.interval) {
      this.warmingInterval = setInterval(async () => {
        await this.warm(config.queries, loader, { skipExisting: config.skipExisting })
      }, config.interval)
    }
  }

  /**
   * Stop scheduled cache warming
   */
  stopScheduledWarming(): void {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval)
      this.warmingInterval = undefined
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTICS AND MONITORING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get cache statistics
   */
  async getStats(options?: { tenantId?: string }): Promise<CacheStats> {
    let memoryEntries = 0
    let kvEntries = 0
    let r2Entries = 0
    let totalSizeBytes = 0
    let hits = this.metrics.hits
    let misses = this.metrics.misses

    // Count memory entries
    for (const [, entry] of this.memoryCache) {
      if (options?.tenantId && entry.tenantId !== options.tenantId) {
        continue
      }
      memoryEntries++
      totalSizeBytes += entry.sizeBytes
    }

    // Count KV entries (estimate from memory tracking)
    // In production, you might want to use KV.list() with pagination

    // Count R2 entries (estimate from memory tracking)
    // In production, you might want to use R2.list() with pagination

    const total = hits + misses

    const stats: CacheStats = {
      hits,
      misses,
      hitRatio: total > 0 ? hits / total : 0,
      evictions: this.metrics.evictions,
      totalEntries: memoryEntries + kvEntries + r2Entries,
      memoryEntries,
      kvEntries,
      r2Entries,
      totalSizeBytes,
      avgLatencyMs: {
        get: this.avgLatency(this.metrics.latencies.get),
        set: this.avgLatency(this.metrics.latencies.set),
        hit: this.avgLatency(this.metrics.latencies.hit),
        miss: this.avgLatency(this.metrics.latencies.miss),
      },
    }

    // Call metrics callback if configured
    if (this.config.onMetrics) {
      this.config.onMetrics(stats)
    }

    return stats
  }

  /**
   * Get stats for a specific entry
   */
  async getEntryStats(query: Query, options?: GetOptions): Promise<CacheEntry | undefined> {
    const fingerprint = fingerprintQuery(query, options)
    return this.memoryCache.get(fingerprint)
  }

  /**
   * Register an invalidation event listener
   */
  onInvalidation(callback: (event: InvalidationEvent) => void): void {
    this.invalidationListeners.push(callback)
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear()
    this.tableIndex.clear()
    this.entityIndex.clear()
    this.dependencyIndex.clear()
    this.queryAccessLog.clear()
    this.recentlyExpired.clear()

    // Note: KV and R2 would need to be cleared separately
    // as there's no bulk delete operation
  }
}
