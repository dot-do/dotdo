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
      const segment = segments[i]
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
export function shardMiddleware(router: ShardRouter) {
  return async (c: any, next: () => Promise<void>) => {
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
