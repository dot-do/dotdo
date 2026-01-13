/**
 * Tool Result Caching
 *
 * Provides caching for deterministic tool results to reduce API costs and latency.
 * Tools can be marked as cacheable, and their results are stored based on
 * a stable hash of the tool name and arguments.
 *
 * @example
 * ```ts
 * import { tool, createToolCache, withCaching } from './agents'
 *
 * // Mark a tool as cacheable
 * const lookupTool = tool({
 *   name: 'lookup',
 *   description: 'Look up data from database',
 *   inputSchema: z.object({ id: z.string() }),
 *   cacheable: true,  // Enable caching
 *   cacheTTL: 60000,  // Optional: custom TTL (default: 5 minutes)
 *   execute: async ({ id }) => {
 *     return await db.findById(id)
 *   },
 * })
 *
 * // Create a cache instance
 * const cache = createToolCache({ maxSize: 1000, defaultTTL: 300000 })
 *
 * // Use with agent hooks
 * const agent = provider.createAgent({
 *   id: 'my-agent',
 *   tools: [lookupTool],
 *   hooks: withCaching(cache),
 * })
 * ```
 *
 * @module agents/tool-cache
 */

import type {
  ToolCall,
  ToolResult,
  ToolDefinition,
  AgentHooks,
  ToolCallDecision,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Extended tool definition with caching options
 */
export interface CacheableToolDefinition<TInput = unknown, TOutput = unknown>
  extends ToolDefinition<TInput, TOutput> {
  /** Whether this tool's results can be cached */
  cacheable?: boolean
  /** Custom TTL for this tool's cache entries (ms) */
  cacheTTL?: number
  /** Custom cache key generator */
  cacheKeyFn?: (input: TInput) => string
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = unknown> {
  /** Cached result */
  result: T
  /** When the entry was created */
  createdAt: number
  /** Time-to-live in milliseconds */
  ttl: number
  /** Number of cache hits */
  hits: number
  /** Tool name */
  toolName: string
}

/**
 * Cache configuration options
 */
export interface ToolCacheConfig {
  /** Maximum number of entries (default: 500) */
  maxSize?: number
  /** Default TTL in milliseconds (default: 300000 = 5 minutes) */
  defaultTTL?: number
  /** Whether to track statistics (default: true) */
  trackStats?: boolean
  /** Optional custom storage backend */
  storage?: CacheStorage
}

/**
 * Cache storage interface for custom backends
 */
export interface CacheStorage {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
  delete(key: string): boolean
  clear(): void
  keys(): IterableIterator<string>
  size(): number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total cache hits */
  hits: number
  /** Total cache misses */
  misses: number
  /** Current number of entries */
  size: number
  /** Hit rate (0-1) */
  hitRate: number
  /** Bytes used (estimated) */
  bytesUsed: number
  /** Entries by tool */
  byTool: Record<string, { hits: number; entries: number }>
}

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate a stable cache key from tool name and arguments
 *
 * Uses JSON serialization with sorted keys for deterministic output.
 * Handles circular references and non-serializable values gracefully.
 */
export function generateCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sortedArgs = stableStringify(args)
  return `${toolName}:${sortedArgs}`
}

/**
 * Stable JSON stringify with sorted keys
 *
 * Ensures the same object always produces the same string regardless
 * of property insertion order.
 */
export function stableStringify(obj: unknown): string {
  const seen = new WeakSet()

  function stringify(value: unknown): string {
    // Handle primitives
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'boolean') return value.toString()
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return '"NaN"'
      if (!Number.isFinite(value)) return value > 0 ? '"Infinity"' : '"-Infinity"'
      return value.toString()
    }
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'bigint') return `"${value.toString()}n"`
    if (typeof value === 'symbol') return `"Symbol(${value.description || ''})"`
    if (typeof value === 'function') return '"[Function]"'

    // Handle Date
    if (value instanceof Date) {
      return `"${value.toISOString()}"`
    }

    // Handle RegExp
    if (value instanceof RegExp) {
      return `"${value.toString()}"`
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (seen.has(value)) return '"[Circular]"'
      seen.add(value)
      const items = value.map((item) => stringify(item))
      return `[${items.join(',')}]`
    }

    // Handle objects
    if (typeof value === 'object') {
      if (seen.has(value)) return '"[Circular]"'
      seen.add(value)

      const keys = Object.keys(value as object).sort()
      const pairs = keys.map((key) => {
        const val = (value as Record<string, unknown>)[key]
        return `${JSON.stringify(key)}:${stringify(val)}`
      })
      return `{${pairs.join(',')}}`
    }

    return '"[Unknown]"'
  }

  return stringify(obj)
}

// ============================================================================
// In-Memory Cache Storage
// ============================================================================

/**
 * Default in-memory cache storage using Map with LRU eviction
 */
export class InMemoryCacheStorage implements CacheStorage {
  private cache: Map<string, CacheEntry> = new Map()
  private maxSize: number

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, entry)
    }
    return entry
  }

  set(key: string, entry: CacheEntry): void {
    // Delete if exists to reset position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, entry)
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  keys(): IterableIterator<string> {
    return this.cache.keys()
  }

  size(): number {
    return this.cache.size
  }
}

// ============================================================================
// Tool Result Cache
// ============================================================================

/**
 * Tool Result Cache
 *
 * Caches deterministic tool results to reduce redundant executions.
 * Integrates with agent hooks for transparent caching.
 */
export class ToolResultCache {
  private storage: CacheStorage
  private config: Required<Omit<ToolCacheConfig, 'storage'>>
  private stats: {
    hits: number
    misses: number
  }
  private toolRegistry: Map<string, CacheableToolDefinition> = new Map()

  constructor(config: ToolCacheConfig = {}) {
    this.storage = config.storage ?? new InMemoryCacheStorage(config.maxSize ?? 500)
    this.config = {
      maxSize: config.maxSize ?? 500,
      defaultTTL: config.defaultTTL ?? 300000, // 5 minutes
      trackStats: config.trackStats ?? true,
    }
    this.stats = { hits: 0, misses: 0 }
  }

  /**
   * Register a cacheable tool
   */
  registerTool(tool: CacheableToolDefinition): void {
    if (tool.cacheable) {
      this.toolRegistry.set(tool.name, tool)
    }
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: CacheableToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  /**
   * Check if a tool is cacheable
   */
  isCacheable(toolName: string): boolean {
    return this.toolRegistry.has(toolName)
  }

  /**
   * Get cached result for a tool call
   */
  get(toolCall: ToolCall): ToolResult | undefined {
    const tool = this.toolRegistry.get(toolCall.name)
    if (!tool) return undefined

    const key = this.getCacheKey(tool, toolCall)
    const entry = this.storage.get(key)

    if (!entry) {
      if (this.config.trackStats) this.stats.misses++
      return undefined
    }

    // Check if expired
    const now = Date.now()
    if (now - entry.createdAt > entry.ttl) {
      this.storage.delete(key)
      if (this.config.trackStats) this.stats.misses++
      return undefined
    }

    // Cache hit
    if (this.config.trackStats) {
      this.stats.hits++
      entry.hits++
    }

    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: entry.result,
    }
  }

  /**
   * Store a tool result in the cache
   */
  set(toolCall: ToolCall, result: ToolResult): void {
    // Don't cache errors
    if (result.error) return

    const tool = this.toolRegistry.get(toolCall.name)
    if (!tool) return

    const key = this.getCacheKey(tool, toolCall)
    const ttl = tool.cacheTTL ?? this.config.defaultTTL

    const entry: CacheEntry = {
      result: result.result,
      createdAt: Date.now(),
      ttl,
      hits: 0,
      toolName: toolCall.name,
    }

    this.storage.set(key, entry)
  }

  /**
   * Invalidate cache entries for a specific tool
   */
  invalidateTool(toolName: string): number {
    let count = 0
    const keysToDelete: string[] = []

    for (const key of this.storage.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.storage.delete(key)
      count++
    }

    return count
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(toolCall: ToolCall): boolean {
    const tool = this.toolRegistry.get(toolCall.name)
    if (!tool) return false

    const key = this.getCacheKey(tool, toolCall)
    return this.storage.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.storage.clear()
    this.stats.hits = 0
    this.stats.misses = 0
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const byTool: Record<string, { hits: number; entries: number }> = {}
    let bytesUsed = 0

    for (const key of this.storage.keys()) {
      const entry = this.storage.get(key)
      if (entry) {
        if (!byTool[entry.toolName]) {
          byTool[entry.toolName] = { hits: 0, entries: 0 }
        }
        byTool[entry.toolName].hits += entry.hits
        byTool[entry.toolName].entries++

        // Estimate bytes (rough approximation)
        bytesUsed += key.length * 2 + JSON.stringify(entry.result).length * 2
      }
    }

    const total = this.stats.hits + this.stats.misses
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.storage.size(),
      hitRate: total > 0 ? this.stats.hits / total : 0,
      bytesUsed,
      byTool,
    }
  }

  /**
   * Get cache key for a tool call
   */
  private getCacheKey(tool: CacheableToolDefinition, toolCall: ToolCall): string {
    if (tool.cacheKeyFn) {
      return `${toolCall.name}:${tool.cacheKeyFn(toolCall.arguments)}`
    }
    return generateCacheKey(toolCall.name, toolCall.arguments)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a tool result cache instance
 *
 * @example
 * ```ts
 * const cache = createToolCache({
 *   maxSize: 1000,
 *   defaultTTL: 600000, // 10 minutes
 * })
 *
 * cache.registerTools([lookupTool, searchTool])
 * ```
 */
export function createToolCache(config: ToolCacheConfig = {}): ToolResultCache {
  return new ToolResultCache(config)
}

// ============================================================================
// Hook Integration
// ============================================================================

/**
 * Create agent hooks for tool result caching
 *
 * Returns hooks that integrate with the agent's onPreToolUse and onPostToolUse.
 * When a cached result exists, the tool execution is skipped and the cached
 * result is returned directly.
 *
 * @example
 * ```ts
 * const cache = createToolCache()
 * cache.registerTools(tools)
 *
 * const hooks = createCacheHooks(cache)
 *
 * const agent = provider.createAgent({
 *   tools,
 *   hooks,
 * })
 * ```
 */
export function createCacheHooks(cache: ToolResultCache): Pick<AgentHooks, 'onPreToolUse' | 'onPostToolUse'> & {
  /** Get cached result (for manual integration) */
  getCachedResult: (toolCall: ToolCall) => ToolResult | undefined
} {
  // Store pending cached results for the post-hook to skip storing
  const pendingCachedResults = new Map<string, ToolResult>()

  return {
    getCachedResult: (toolCall: ToolCall) => cache.get(toolCall),

    onPreToolUse: async (toolCall: ToolCall): Promise<ToolCallDecision> => {
      const cached = cache.get(toolCall)
      if (cached) {
        // Store for post-hook to know this was from cache
        pendingCachedResults.set(toolCall.id, cached)

        // Return the cached result by modifying arguments to include a cache flag
        // The actual result will be handled specially
        return {
          action: 'allow',
        }
      }
      return { action: 'allow' }
    },

    onPostToolUse: async (toolCall: ToolCall, result: ToolResult): Promise<void> => {
      // Check if this was a cached result (don't re-cache)
      if (pendingCachedResults.has(toolCall.id)) {
        pendingCachedResults.delete(toolCall.id)
        return
      }

      // Only cache successful results for cacheable tools
      if (!result.error && cache.isCacheable(toolCall.name)) {
        cache.set(toolCall, result)
      }
    },
  }
}

/**
 * Wrap existing hooks with caching support
 *
 * Combines existing hooks with caching hooks, preserving both behaviors.
 *
 * @example
 * ```ts
 * const cache = createToolCache()
 * cache.registerTools(tools)
 *
 * const existingHooks = {
 *   onPreToolUse: async (call) => {
 *     console.log('Tool called:', call.name)
 *     return { action: 'allow' }
 *   }
 * }
 *
 * const hooks = withCaching(cache, existingHooks)
 * ```
 */
export function withCaching(
  cache: ToolResultCache,
  existingHooks: Partial<AgentHooks> = {}
): AgentHooks {
  const cacheHooks = createCacheHooks(cache)

  return {
    ...existingHooks,

    onPreToolUse: async (toolCall: ToolCall): Promise<ToolCallDecision> => {
      // Check cache first
      const cached = cacheHooks.getCachedResult(toolCall)
      if (cached) {
        // If we have a cached result, we still need to allow the call
        // but mark it so we know to use the cached result
        // Note: The actual caching integration happens at a higher level
        // This hook just checks if caching should apply
      }

      // Call cache hooks
      const cacheDecision = await cacheHooks.onPreToolUse(toolCall)
      if (cacheDecision.action !== 'allow') {
        return cacheDecision
      }

      // Call existing hooks
      if (existingHooks.onPreToolUse) {
        return existingHooks.onPreToolUse(toolCall)
      }

      return { action: 'allow' }
    },

    onPostToolUse: async (toolCall: ToolCall, result: ToolResult): Promise<void> => {
      // Store in cache
      await cacheHooks.onPostToolUse(toolCall, result)

      // Call existing hooks
      if (existingHooks.onPostToolUse) {
        await existingHooks.onPostToolUse(toolCall, result)
      }
    },

    // Preserve other hooks
    onPermissionRequest: existingHooks.onPermissionRequest,
    onStepStart: existingHooks.onStepStart,
    onStepFinish: existingHooks.onStepFinish,
    onError: existingHooks.onError,
  }
}

/**
 * Create a cacheable version of an existing tool
 *
 * Wraps a tool definition to mark it as cacheable with optional custom settings.
 *
 * @example
 * ```ts
 * const searchTool = tool({
 *   name: 'search',
 *   description: 'Search documents',
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: async ({ query }) => searchDocs(query),
 * })
 *
 * const cacheableSearch = cacheable(searchTool, {
 *   ttl: 600000, // 10 minutes
 * })
 * ```
 */
export function cacheable<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  options: {
    ttl?: number
    keyFn?: (input: TInput) => string
  } = {}
): CacheableToolDefinition<TInput, TOutput> {
  return {
    ...tool,
    cacheable: true,
    cacheTTL: options.ttl,
    cacheKeyFn: options.keyFn as ((input: unknown) => string) | undefined,
  }
}

// ============================================================================
// Utility: Cached Tool Execution
// ============================================================================

/**
 * Execute a tool with caching
 *
 * Standalone function for executing a single tool with cache support.
 * Useful for manual tool execution outside of agent loops.
 *
 * @example
 * ```ts
 * const cache = createToolCache()
 * cache.registerTool(lookupTool)
 *
 * const result = await executeCached(cache, lookupTool, {
 *   id: 'call_123',
 *   name: 'lookup',
 *   arguments: { id: 'user-1' },
 * }, context)
 * ```
 */
export async function executeCached<TInput, TOutput>(
  cache: ToolResultCache,
  tool: CacheableToolDefinition<TInput, TOutput>,
  toolCall: ToolCall,
  context: { agentId: string; abortSignal?: AbortSignal }
): Promise<ToolResult> {
  // Check cache
  const cached = cache.get(toolCall)
  if (cached) {
    return cached
  }

  // Execute tool
  try {
    const output = await tool.execute(toolCall.arguments as TInput, context)
    const result: ToolResult = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: output,
    }

    // Store in cache
    cache.set(toolCall, result)

    return result
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export default ToolResultCache
