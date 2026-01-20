/**
 * DO Sharding Support (do-rljr.4)
 *
 * Provides sharding capabilities beyond simple namespace-based routing.
 * Supports consistent hashing to distribute load across multiple DO instances.
 *
 * Current routing: tenant.api.dotdo.dev → DO('tenant')
 * With sharding: tenant.api.dotdo.dev/users/123 → DO('tenant:user:shard-2')
 *
 * Sharding strategies:
 * - Namespace-only (default): DO('tenant')
 * - Entity-based: DO('tenant:entity-type:shard-N')
 * - Key-based: DO('tenant:custom-key:shard-N')
 * - Composite: DO('tenant:entity:key:shard-N')
 */

/**
 * Shard key configuration
 */
export interface ShardKeyConfig {
  /** Type of sharding: by entity type, by custom key, or composite */
  type: 'entity' | 'key' | 'composite'
  /** Number of shards for this configuration */
  shardCount: number
  /** Extract key from request/context */
  extractKey?: (ctx: ShardContext) => string | undefined
}

/**
 * Context for shard key extraction
 */
export interface ShardContext {
  /** Namespace (from subdomain) */
  namespace: string
  /** Request path */
  path: string
  /** URL search params */
  params?: URLSearchParams
  /** Request headers */
  headers?: Headers
  /** Entity type (if known from route) */
  entityType?: string
  /** Entity ID (if known from route) */
  entityId?: string
  /** Custom shard key override */
  shardKey?: string
}

/**
 * Shard routing result
 */
export interface ShardResult {
  /** Full DO name to use */
  doName: string
  /** Shard index (0-based) */
  shardIndex: number
  /** Whether sharding was applied */
  sharded: boolean
  /** Key used for sharding */
  key?: string
}

/**
 * Shard router configuration
 */
export interface ShardRouterConfig {
  /** Default number of shards */
  defaultShardCount: number
  /** Entity-specific shard configurations */
  entityShards?: Record<string, number>
  /** Custom shard key extractors by path pattern */
  keyExtractors?: Record<string, (ctx: ShardContext) => string | undefined>
  /** Separator for DO name components (default: ':') */
  separator?: string
  /** Enable sharding (default: true) */
  enabled?: boolean
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ShardRouterConfig> = {
  defaultShardCount: 16,
  entityShards: {},
  keyExtractors: {},
  separator: ':',
  enabled: true,
}

/**
 * FNV-1a hash - fast, simple, good distribution
 * Used for consistent hashing to distribute keys across shards
 */
export function fnv1aHash(str: string): number {
  const FNV_OFFSET_BASIS = 2166136261
  const FNV_PRIME = 16777619

  let hash = FNV_OFFSET_BASIS

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * FNV_PRIME) >>> 0 // Convert to unsigned 32-bit
  }

  return hash
}

/**
 * Get shard index for a key using consistent hashing
 * @param key - The key to hash
 * @param shardCount - Number of shards
 * @returns Shard index (0 to shardCount - 1)
 */
export function getShardIndex(key: string, shardCount: number): number {
  if (shardCount <= 0) {
    throw new Error('Shard count must be positive')
  }
  if (shardCount === 1) {
    return 0
  }

  const hash = fnv1aHash(key)
  return hash % shardCount
}

/**
 * ShardRouter - Routes requests to sharded DO instances
 *
 * @example
 * ```typescript
 * const router = new ShardRouter({
 *   defaultShardCount: 16,
 *   entityShards: {
 *     'users': 32,      // Users sharded across 32 DOs
 *     'orders': 64,     // Orders across 64 DOs
 *     'analytics': 4,   // Analytics across 4 DOs
 *   }
 * })
 *
 * // Route a request
 * const { doName } = router.route({
 *   namespace: 'acme',
 *   path: '/users/user-123',
 *   entityType: 'users',
 *   entityId: 'user-123',
 * })
 * // doName might be 'acme:users:shard-7'
 * ```
 */
export class ShardRouter {
  private config: Required<ShardRouterConfig>

  constructor(config: Partial<ShardRouterConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      entityShards: {
        ...DEFAULT_CONFIG.entityShards,
        ...config.entityShards,
      },
      keyExtractors: {
        ...DEFAULT_CONFIG.keyExtractors,
        ...config.keyExtractors,
      },
    }
  }

  /**
   * Get shard count for an entity type
   */
  getShardCount(entityType?: string): number {
    if (entityType && this.config.entityShards[entityType] !== undefined) {
      return this.config.entityShards[entityType]
    }
    return this.config.defaultShardCount
  }

  /**
   * Extract shard key from context
   *
   * Priority:
   * 1. Explicit shardKey in context
   * 2. Custom key extractor for path
   * 3. EntityId if available
   * 4. Path-based extraction
   */
  extractKey(ctx: ShardContext): string | undefined {
    // 1. Explicit shard key
    if (ctx.shardKey) {
      return ctx.shardKey
    }

    // 2. Custom key extractor
    for (const [pattern, extractor] of Object.entries(this.config.keyExtractors)) {
      if (this.matchPattern(ctx.path, pattern)) {
        const key = extractor(ctx)
        if (key) return key
      }
    }

    // 3. Entity ID
    if (ctx.entityId) {
      return ctx.entityId
    }

    // 4. Path-based extraction (e.g., /users/123 → '123')
    return this.extractKeyFromPath(ctx.path)
  }

  /**
   * Match a path against a pattern
   * Supports simple wildcards: /users/* matches /users/123
   */
  private matchPattern(path: string, pattern: string): boolean {
    const patternParts = pattern.split('/')
    const pathParts = path.split('/')

    if (patternParts.length !== pathParts.length) {
      return false
    }

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') continue
      if (patternParts[i] !== pathParts[i]) return false
    }

    return true
  }

  /**
   * Extract a key from the path
   * Default: uses the last path segment that looks like an ID
   */
  private extractKeyFromPath(path: string): string | undefined {
    const segments = path.split('/').filter(Boolean)

    // Look for ID-like segments (not pure route names)
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i]!
      // Skip common route names
      if (['api', 'v1', 'v2', 'rpc'].includes(segment)) continue
      // Return if it looks like an ID (has numbers, dashes, or is long)
      if (/\d/.test(segment) || segment.includes('-') || segment.length > 20) {
        return segment
      }
    }

    return undefined
  }

  /**
   * Extract entity type from path
   * Default: uses the first non-api path segment
   */
  private extractEntityType(path: string): string | undefined {
    const segments = path.split('/').filter(Boolean)

    for (const segment of segments) {
      // Skip common prefixes
      if (['api', 'v1', 'v2', 'rpc'].includes(segment)) continue
      // Return the first entity-like segment
      if (/^[a-z]+$/i.test(segment)) {
        return segment
      }
    }

    return undefined
  }

  /**
   * Route a request to the appropriate shard
   *
   * @param ctx - Shard context with request information
   * @returns Shard routing result with DO name
   */
  route(ctx: ShardContext): ShardResult {
    const { namespace, path } = ctx
    const separator = this.config.separator

    // If sharding is disabled, return namespace only
    if (!this.config.enabled) {
      return {
        doName: namespace,
        shardIndex: 0,
        sharded: false,
      }
    }

    // Extract entity type
    const entityType = ctx.entityType || this.extractEntityType(path)

    // Extract shard key
    const key = this.extractKey(ctx)

    // If no key found, return namespace only
    if (!key) {
      return {
        doName: namespace,
        shardIndex: 0,
        sharded: false,
      }
    }

    // Get shard count for this entity type
    const shardCount = this.getShardCount(entityType)

    // Calculate shard index
    const shardIndex = getShardIndex(key, shardCount)

    // Build DO name
    const parts = [namespace]
    if (entityType) {
      parts.push(entityType)
    }
    parts.push(`shard-${shardIndex}`)

    return {
      doName: parts.join(separator),
      shardIndex,
      sharded: true,
      key,
    }
  }

  /**
   * Get the DO stub for a sharded request
   *
   * @param env - Worker environment with DO binding
   * @param ctx - Shard context
   * @param binding - Name of the DO binding (default: 'DO')
   * @returns DO stub
   */
  getStub<T extends DurableObjectNamespace>(
    env: Record<string, T>,
    ctx: ShardContext,
    binding: string = 'DO'
  ): DurableObjectStub {
    const ns = env[binding]
    if (!ns) {
      throw new Error(`DO binding '${binding}' not found in environment`)
    }

    const { doName } = this.route(ctx)
    const id = ns.idFromName(doName)
    return ns.get(id)
  }

  /**
   * Create a shard-aware fetch handler
   *
   * @example
   * ```typescript
   * const router = new ShardRouter({ defaultShardCount: 16 })
   *
   * export default {
   *   fetch: router.createFetchHandler('DO')
   * }
   * ```
   */
  createFetchHandler(binding: string = 'DO') {
    return async (
      request: Request,
      env: Record<string, DurableObjectNamespace>
    ): Promise<Response> => {
      const url = new URL(request.url)
      const hostParts = url.hostname.split('.')
      const namespace = hostParts.length > 2 ? hostParts[0] : 'default'

      const ctx: ShardContext = {
        namespace,
        path: url.pathname,
        params: url.searchParams,
        headers: request.headers,
      }

      const stub = this.getStub(env, ctx, binding)
      return stub.fetch(request)
    }
  }
}

/**
 * Create a simple shard router with default configuration
 */
export function createShardRouter(config?: Partial<ShardRouterConfig>): ShardRouter {
  return new ShardRouter(config)
}

/**
 * Middleware for Hono to add shard context
 *
 * @example
 * ```typescript
 * import { shardMiddleware } from '@dotdo/do'
 *
 * const router = new ShardRouter({ defaultShardCount: 16 })
 * app.use('*', shardMiddleware(router))
 *
 * app.get('/users/:id', (c) => {
 *   const shardResult = c.get('shard')
 *   // shardResult.doName, shardResult.shardIndex, etc.
 * })
 * ```
 */
/**
 * Hono Context interface for shard middleware
 */
interface HonoShardContext {
  req: {
    url: string
    headers: Headers
    param: (name: string) => string | undefined
  }
  set: (key: string, value: unknown) => void
}

export function shardMiddleware(router: ShardRouter) {
  return async (c: HonoShardContext, next: () => Promise<void>) => {
    const url = new URL(c.req.url)
    const hostParts = url.hostname.split('.')
    const namespace = hostParts.length > 2 ? hostParts[0] : 'default'

    const ctx: ShardContext = {
      namespace,
      path: url.pathname,
      params: url.searchParams,
      headers: c.req.headers,
      entityType: c.req.param('entityType'),
      entityId: c.req.param('id') || c.req.param('entityId'),
    }

    const result = router.route(ctx)
    c.set('shard', result)
    c.set('shardContext', ctx)

    await next()
  }
}

/**
 * Route to shard by user ID header
 *
 * @example
 * ```typescript
 * const router = new ShardRouter({
 *   keyExtractors: {
 *     '/api/*': extractUserIdFromHeader,
 *   }
 * })
 * ```
 */
export function extractUserIdFromHeader(ctx: ShardContext): string | undefined {
  return ctx.headers?.get('X-User-ID') || ctx.headers?.get('Authorization')?.split(' ')[1]
}

/**
 * Route to shard by query parameter
 *
 * @example
 * ```typescript
 * const router = new ShardRouter({
 *   keyExtractors: {
 *     '/search': extractShardFromQuery('tenant_id'),
 *   }
 * })
 * ```
 */
export function extractShardFromQuery(paramName: string) {
  return (ctx: ShardContext): string | undefined => {
    return ctx.params?.get(paramName) || undefined
  }
}

// ============================================================================
// Load Metrics Store (do-ftgn)
// ============================================================================

export interface LoadMetricsStoreConfig {
  loadWeights?: Record<string, number>
  decayFactor?: number
  decayIntervalMs?: number
}

export interface LeastLoadedResult {
  shardIndex: number
  doName: string
  load: number
}

export class LoadMetricsStore {
  private loads: Map<string, number> = new Map()
  private metrics: Map<string, Map<string, number>> = new Map()
  private config: Required<LoadMetricsStoreConfig>
  private lastDecayTime: number = Date.now()

  constructor(config: LoadMetricsStoreConfig = {}) {
    this.config = {
      loadWeights: config.loadWeights ?? { requests: 1 },
      decayFactor: config.decayFactor ?? 0.9,
      decayIntervalMs: config.decayIntervalMs ?? 60000,
    }
  }

  recordLoad(doName: string, load: number): void {
    this.loads.set(doName, load)
  }

  recordRequest(doName: string): void {
    const current = this.loads.get(doName) ?? 0
    this.loads.set(doName, current + 1)
  }

  getLoad(doName: string): number {
    return this.loads.get(doName) ?? 0
  }

  recordMetric(doName: string, metricType: string, value: number): void {
    if (!this.metrics.has(doName)) {
      this.metrics.set(doName, new Map())
    }
    this.metrics.get(doName)!.set(metricType, value)
  }

  getMetric(doName: string, metricType: string): number {
    return this.metrics.get(doName)?.get(metricType) ?? 0
  }

  getCompositeLoad(doName: string): number {
    const shardMetrics = this.metrics.get(doName)
    if (!shardMetrics) return 0

    let compositeLoad = 0
    for (const [metricType, value] of shardMetrics) {
      const weight = this.config.loadWeights[metricType] ?? 1
      compositeLoad += value * weight
    }
    return compositeLoad
  }

  getShardLoads(
    namespace: string,
    entityType: string,
    shardCount: number
  ): Record<string, number> {
    const loads: Record<string, number> = {}
    for (let i = 0; i < shardCount; i++) {
      const doName = `${namespace}:${entityType}:shard-${i}`
      loads[doName] = this.getLoad(doName)
    }
    return loads
  }

  findLeastLoaded(
    namespace: string,
    entityType: string,
    shardCount: number
  ): LeastLoadedResult {
    let minLoad = Infinity
    let minIndex = 0
    let minDoName = `${namespace}:${entityType}:shard-0`

    for (let i = 0; i < shardCount; i++) {
      const doName = `${namespace}:${entityType}:shard-${i}`
      const load = this.getLoad(doName)
      if (load < minLoad) {
        minLoad = load
        minIndex = i
        minDoName = doName
      }
    }

    return {
      shardIndex: minIndex,
      doName: minDoName,
      load: minLoad === Infinity ? 0 : minLoad,
    }
  }

  applyDecay(): void {
    const now = Date.now()
    const elapsed = now - this.lastDecayTime

    if (elapsed >= this.config.decayIntervalMs) {
      const decayMultiplier = this.config.decayFactor

      for (const [doName, load] of this.loads) {
        this.loads.set(doName, Math.floor(load * decayMultiplier))
      }

      for (const [, shardMetrics] of this.metrics) {
        for (const [metricType, value] of shardMetrics) {
          shardMetrics.set(metricType, Math.floor(value * decayMultiplier))
        }
      }

      this.lastDecayTime = now
    }
  }

  reset(): void {
    this.loads.clear()
    this.metrics.clear()
    this.lastDecayTime = Date.now()
  }

  getSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {}
    for (const [doName, load] of this.loads) {
      snapshot[doName] = load
    }
    return snapshot
  }
}

// ============================================================================
// Load Balanced Router (do-ftgn)
// ============================================================================

export interface LoadBalanceTelemetryEvent {
  type: 'load_balance_decision'
  namespace: string
  entityType?: string | undefined
  selectedShard: number
  selectedDoName: string
  loadSnapshot: Record<string, number>
  strategy: 'least-loaded' | 'weighted' | 'round-robin'
  timestamp: number
}

export interface LoadBalancedShardResult extends ShardResult {
  loadBalanced: boolean
}

export interface LoadBalancedRouterConfig extends ShardRouterConfig {
  metricsStore?: LoadMetricsStore
  strategy?: 'least-loaded' | 'weighted' | 'round-robin'
  weights?: Record<string, number>
  onTelemetry?: (event: LoadBalanceTelemetryEvent) => void
}

export class LoadBalancedRouter extends ShardRouter {
  private metricsStore: LoadMetricsStore
  private lbConfig: LoadBalancedRouterConfig
  private roundRobinCounter: Map<string, number> = new Map()

  constructor(config: LoadBalancedRouterConfig = {}) {
    super(config)
    this.lbConfig = {
      ...config,
      strategy: config.strategy ?? 'least-loaded',
      weights: config.weights ?? {},
    }
    this.metricsStore = config.metricsStore ?? new LoadMetricsStore()
  }

  route(ctx: ShardContext): LoadBalancedShardResult {
    const { namespace, path } = ctx
    const separator = (this as unknown as { config: ShardRouterConfig }).config?.separator ?? ':'

    if ((this as unknown as { config: ShardRouterConfig }).config?.enabled === false) {
      return {
        doName: namespace,
        shardIndex: 0,
        sharded: false,
        loadBalanced: false,
      }
    }

    const entityType =
      ctx.entityType ||
      (
        this as unknown as { extractEntityType: (path: string) => string | undefined }
      ).extractEntityType?.(path)

    const key = this.extractKey(ctx)

    if (ctx.entityId || key) {
      const baseResult = super.route(ctx)
      return {
        ...baseResult,
        loadBalanced: false,
      }
    }

    const shardCount = this.getShardCount(entityType)
    const { shardIndex, doName } = this.selectShard(
      namespace,
      entityType,
      shardCount,
      separator
    )

    const loadSnapshot = this.buildLoadSnapshot(
      namespace,
      entityType,
      shardCount,
      separator
    )

    if (this.lbConfig.onTelemetry) {
      this.lbConfig.onTelemetry({
        type: 'load_balance_decision',
        namespace,
        entityType,
        selectedShard: shardIndex,
        selectedDoName: doName,
        loadSnapshot,
        strategy: this.lbConfig.strategy!,
        timestamp: Date.now(),
      })
    }

    return {
      doName,
      shardIndex,
      sharded: true,
      loadBalanced: true,
    }
  }

  private selectShard(
    namespace: string,
    entityType: string | undefined,
    shardCount: number,
    separator: string
  ): { shardIndex: number; doName: string } {
    const prefix = entityType
      ? `${namespace}${separator}${entityType}`
      : namespace

    switch (this.lbConfig.strategy) {
      case 'weighted':
        return this.selectWeightedShard(prefix, shardCount, separator)
      case 'round-robin':
        return this.selectRoundRobinShard(prefix, shardCount, separator)
      case 'least-loaded':
      default:
        return this.selectLeastLoadedShard(prefix, shardCount, separator)
    }
  }

  private selectLeastLoadedShard(
    prefix: string,
    shardCount: number,
    separator: string
  ): { shardIndex: number; doName: string } {
    let minLoad = Infinity
    let minIndex = 0
    const equalLoadIndices: number[] = []

    for (let i = 0; i < shardCount; i++) {
      const doName = `${prefix}${separator}shard-${i}`
      const load = this.metricsStore.getLoad(doName)

      if (load < minLoad) {
        minLoad = load
        minIndex = i
        equalLoadIndices.length = 0
        equalLoadIndices.push(i)
      } else if (load === minLoad) {
        equalLoadIndices.push(i)
      }
    }

    if (equalLoadIndices.length > 1) {
      const rrKey = `${prefix}:rr`
      const rrIndex =
        (this.roundRobinCounter.get(rrKey) ?? 0) % equalLoadIndices.length
      this.roundRobinCounter.set(rrKey, rrIndex + 1)
      minIndex = equalLoadIndices[rrIndex]
    }

    return {
      shardIndex: minIndex,
      doName: `${prefix}${separator}shard-${minIndex}`,
    }
  }

  private selectWeightedShard(
    prefix: string,
    shardCount: number,
    separator: string
  ): { shardIndex: number; doName: string } {
    let minEffectiveLoad = Infinity
    let minIndex = 0

    for (let i = 0; i < shardCount; i++) {
      const doName = `${prefix}${separator}shard-${i}`
      const load = this.metricsStore.getLoad(doName)
      const weight = this.lbConfig.weights?.[doName] ?? 1
      const effectiveLoad = load / weight

      if (effectiveLoad < minEffectiveLoad) {
        minEffectiveLoad = effectiveLoad
        minIndex = i
      }
    }

    return {
      shardIndex: minIndex,
      doName: `${prefix}${separator}shard-${minIndex}`,
    }
  }

  private selectRoundRobinShard(
    prefix: string,
    shardCount: number,
    separator: string
  ): { shardIndex: number; doName: string } {
    const rrKey = `${prefix}:rr`
    const index = (this.roundRobinCounter.get(rrKey) ?? 0) % shardCount
    this.roundRobinCounter.set(rrKey, index + 1)

    return {
      shardIndex: index,
      doName: `${prefix}${separator}shard-${index}`,
    }
  }

  private buildLoadSnapshot(
    namespace: string,
    entityType: string | undefined,
    shardCount: number,
    separator: string
  ): Record<string, number> {
    const prefix = entityType
      ? `${namespace}${separator}${entityType}`
      : namespace
    const snapshot: Record<string, number> = {}

    for (let i = 0; i < shardCount; i++) {
      const doName = `${prefix}${separator}shard-${i}`
      snapshot[doName] = this.metricsStore.getLoad(doName)
    }

    return snapshot
  }

  getMetricsStore(): LoadMetricsStore {
    return this.metricsStore
  }
}

export function createLoadBalancedRouter(
  config?: LoadBalancedRouterConfig
): LoadBalancedRouter {
  return new LoadBalancedRouter(config)
}
