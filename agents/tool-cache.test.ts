/**
 * Tool Result Caching Tests
 *
 * Tests for:
 * - generateCacheKey() - Stable cache key generation
 * - stableStringify() - Deterministic JSON serialization
 * - InMemoryCacheStorage - LRU cache storage
 * - ToolResultCache - Main cache class
 * - createToolCache() - Factory function
 * - createCacheHooks() - Hook integration
 * - withCaching() - Hook wrapper
 * - cacheable() - Tool wrapper
 * - executeCached() - Cached execution utility
 *
 * @see dotdo-wjyvp - [REFACTOR] Tool result caching
 * @module agents/tool-cache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  generateCacheKey,
  stableStringify,
  InMemoryCacheStorage,
  ToolResultCache,
  createToolCache,
  createCacheHooks,
  withCaching,
  cacheable,
  executeCached,
  type CacheableToolDefinition,
  type CacheEntry,
  type CacheStats,
  type ToolCacheConfig,
} from './tool-cache'
import { tool } from './Tool'
import type { ToolCall, ToolResult, AgentHooks } from './types'

// ============================================================================
// stableStringify() Tests
// ============================================================================

describe('stableStringify()', () => {
  it('produces identical output for objects with same properties in different order', () => {
    const obj1 = { b: 2, a: 1 }
    const obj2 = { a: 1, b: 2 }

    expect(stableStringify(obj1)).toBe(stableStringify(obj2))
  })

  it('handles primitive values', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify(undefined)).toBe('undefined')
    expect(stableStringify(true)).toBe('true')
    expect(stableStringify(false)).toBe('false')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify('hello')).toBe('"hello"')
  })

  it('handles special number values', () => {
    expect(stableStringify(NaN)).toBe('"NaN"')
    expect(stableStringify(Infinity)).toBe('"Infinity"')
    expect(stableStringify(-Infinity)).toBe('"-Infinity"')
  })

  it('handles bigint values', () => {
    expect(stableStringify(BigInt(9007199254740991))).toBe('"9007199254740991n"')
  })

  it('handles symbols', () => {
    expect(stableStringify(Symbol('test'))).toBe('"Symbol(test)"')
    expect(stableStringify(Symbol())).toBe('"Symbol()"')
  })

  it('handles functions', () => {
    expect(stableStringify(() => {})).toBe('"[Function]"')
  })

  it('handles Date objects', () => {
    const date = new Date('2024-01-15T12:00:00.000Z')
    expect(stableStringify(date)).toBe('"2024-01-15T12:00:00.000Z"')
  })

  it('handles RegExp objects', () => {
    expect(stableStringify(/test/gi)).toBe('"/test/gi"')
  })

  it('handles arrays', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]')
    expect(stableStringify(['a', 'b'])).toBe('["a","b"]')
  })

  it('handles nested objects', () => {
    const obj = { outer: { inner: { value: 1 } } }
    const result = stableStringify(obj)
    expect(result).toBe('{"outer":{"inner":{"value":1}}}')
  })

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj

    const result = stableStringify(obj)
    expect(result).toContain('[Circular]')
  })

  it('handles deeply nested objects with same structure', () => {
    const obj1 = { z: { y: { x: 1 } }, a: { b: { c: 2 } } }
    const obj2 = { a: { b: { c: 2 } }, z: { y: { x: 1 } } }

    expect(stableStringify(obj1)).toBe(stableStringify(obj2))
  })
})

// ============================================================================
// generateCacheKey() Tests
// ============================================================================

describe('generateCacheKey()', () => {
  it('generates key from tool name and arguments', () => {
    const key = generateCacheKey('lookup', { id: 'user-123' })
    expect(key).toContain('lookup:')
    expect(key).toContain('id')
    expect(key).toContain('user-123')
  })

  it('generates identical keys for same tool and args', () => {
    const key1 = generateCacheKey('search', { query: 'test', limit: 10 })
    const key2 = generateCacheKey('search', { query: 'test', limit: 10 })

    expect(key1).toBe(key2)
  })

  it('generates identical keys regardless of property order', () => {
    const key1 = generateCacheKey('tool', { a: 1, b: 2, c: 3 })
    const key2 = generateCacheKey('tool', { c: 3, a: 1, b: 2 })

    expect(key1).toBe(key2)
  })

  it('generates different keys for different tools', () => {
    const key1 = generateCacheKey('tool1', { id: 1 })
    const key2 = generateCacheKey('tool2', { id: 1 })

    expect(key1).not.toBe(key2)
  })

  it('generates different keys for different arguments', () => {
    const key1 = generateCacheKey('lookup', { id: 'a' })
    const key2 = generateCacheKey('lookup', { id: 'b' })

    expect(key1).not.toBe(key2)
  })

  it('handles complex nested arguments', () => {
    const key1 = generateCacheKey('query', {
      filter: { status: 'active', type: ['a', 'b'] },
      sort: { field: 'date', order: 'desc' },
    })
    const key2 = generateCacheKey('query', {
      sort: { order: 'desc', field: 'date' },
      filter: { type: ['a', 'b'], status: 'active' },
    })

    expect(key1).toBe(key2)
  })

  it('handles empty arguments', () => {
    const key = generateCacheKey('tool', {})
    expect(key).toBe('tool:{}')
  })
})

// ============================================================================
// InMemoryCacheStorage Tests
// ============================================================================

describe('InMemoryCacheStorage', () => {
  let storage: InMemoryCacheStorage

  beforeEach(() => {
    storage = new InMemoryCacheStorage(5) // Small size for testing LRU
  })

  it('stores and retrieves entries', () => {
    const entry: CacheEntry = {
      result: { data: 'test' },
      createdAt: Date.now(),
      ttl: 60000,
      hits: 0,
      toolName: 'test',
    }

    storage.set('key1', entry)
    const retrieved = storage.get('key1')

    expect(retrieved).toEqual(entry)
  })

  it('returns undefined for missing keys', () => {
    expect(storage.get('nonexistent')).toBeUndefined()
  })

  it('evicts oldest entries when at capacity (LRU)', () => {
    for (let i = 0; i < 7; i++) {
      storage.set(`key${i}`, {
        result: i,
        createdAt: Date.now(),
        ttl: 60000,
        hits: 0,
        toolName: 'test',
      })
    }

    // First two should be evicted (maxSize is 5)
    expect(storage.get('key0')).toBeUndefined()
    expect(storage.get('key1')).toBeUndefined()
    // Later ones should exist
    expect(storage.get('key6')).toBeDefined()
    expect(storage.get('key5')).toBeDefined()
  })

  it('moves accessed entries to end (most recently used)', () => {
    // Fill cache
    for (let i = 0; i < 5; i++) {
      storage.set(`key${i}`, {
        result: i,
        createdAt: Date.now(),
        ttl: 60000,
        hits: 0,
        toolName: 'test',
      })
    }

    // Access key0, making it most recently used
    storage.get('key0')

    // Add new entry, should evict key1 (oldest not accessed)
    storage.set('key5', {
      result: 5,
      createdAt: Date.now(),
      ttl: 60000,
      hits: 0,
      toolName: 'test',
    })

    // key0 should still exist (was accessed), key1 should be evicted
    expect(storage.get('key0')).toBeDefined()
    expect(storage.get('key1')).toBeUndefined()
  })

  it('deletes entries', () => {
    storage.set('key', {
      result: 'test',
      createdAt: Date.now(),
      ttl: 60000,
      hits: 0,
      toolName: 'test',
    })

    expect(storage.delete('key')).toBe(true)
    expect(storage.get('key')).toBeUndefined()
    expect(storage.delete('key')).toBe(false)
  })

  it('clears all entries', () => {
    storage.set('key1', { result: 1, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })
    storage.set('key2', { result: 2, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })

    storage.clear()

    expect(storage.size()).toBe(0)
    expect(storage.get('key1')).toBeUndefined()
  })

  it('reports correct size', () => {
    expect(storage.size()).toBe(0)

    storage.set('key1', { result: 1, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })
    expect(storage.size()).toBe(1)

    storage.set('key2', { result: 2, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })
    expect(storage.size()).toBe(2)
  })

  it('iterates over keys', () => {
    storage.set('key1', { result: 1, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })
    storage.set('key2', { result: 2, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })

    const keys = Array.from(storage.keys())
    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
  })

  it('updates existing entries in place', () => {
    storage.set('key', { result: 1, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })
    storage.set('key', { result: 2, createdAt: Date.now(), ttl: 60000, hits: 0, toolName: 'test' })

    expect(storage.size()).toBe(1)
    expect(storage.get('key')?.result).toBe(2)
  })
})

// ============================================================================
// ToolResultCache Tests
// ============================================================================

describe('ToolResultCache', () => {
  let cache: ToolResultCache
  let lookupTool: CacheableToolDefinition

  beforeEach(() => {
    cache = createToolCache({ maxSize: 100, defaultTTL: 60000 })

    lookupTool = {
      name: 'lookup',
      description: 'Look up data',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ found: true, id }),
      cacheable: true,
      cacheTTL: 30000,
    }

    cache.registerTool(lookupTool)
  })

  describe('registerTool()', () => {
    it('registers cacheable tools', () => {
      const newTool: CacheableToolDefinition = {
        name: 'newTool',
        description: 'A new tool',
        inputSchema: z.object({}),
        execute: async () => 'result',
        cacheable: true,
      }

      cache.registerTool(newTool)
      expect(cache.isCacheable('newTool')).toBe(true)
    })

    it('ignores non-cacheable tools', () => {
      const nonCacheableTool: CacheableToolDefinition = {
        name: 'nonCacheable',
        description: 'Not cacheable',
        inputSchema: z.object({}),
        execute: async () => 'result',
        cacheable: false,
      }

      cache.registerTool(nonCacheableTool)
      expect(cache.isCacheable('nonCacheable')).toBe(false)
    })

    it('registers multiple tools via registerTools()', () => {
      const tools: CacheableToolDefinition[] = [
        { name: 'tool1', description: 't1', inputSchema: z.object({}), execute: async () => 1, cacheable: true },
        { name: 'tool2', description: 't2', inputSchema: z.object({}), execute: async () => 2, cacheable: true },
      ]

      const newCache = createToolCache()
      newCache.registerTools(tools)

      expect(newCache.isCacheable('tool1')).toBe(true)
      expect(newCache.isCacheable('tool2')).toBe(true)
    })
  })

  describe('get() and set()', () => {
    it('returns undefined for cache miss', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'missing' } }
      expect(cache.get(toolCall)).toBeUndefined()
    })

    it('stores and retrieves results', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: { data: 'test' } }

      cache.set(toolCall, result)
      const cached = cache.get(toolCall)

      expect(cached).toBeDefined()
      expect(cached?.result).toEqual({ data: 'test' })
    })

    it('returns result with correct toolCallId from request', () => {
      const toolCall1: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result1: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall1, result1)

      // Same args, different call ID
      const toolCall2: ToolCall = { id: 'call2', name: 'lookup', arguments: { id: 'user-1' } }
      const cached = cache.get(toolCall2)

      expect(cached?.toolCallId).toBe('call2') // Should use new call ID
    })

    it('does not cache error results', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'err' } }
      const errorResult: ToolResult = {
        toolCallId: 'call1',
        toolName: 'lookup',
        result: null,
        error: 'Something went wrong',
      }

      cache.set(toolCall, errorResult)
      expect(cache.get(toolCall)).toBeUndefined()
    })

    it('returns undefined for non-cacheable tools', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'unknown', arguments: {} }
      expect(cache.get(toolCall)).toBeUndefined()
    })
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns cached result within TTL', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall, result)

      // Advance time but stay within TTL (30s for lookup tool)
      vi.advanceTimersByTime(29000)

      expect(cache.get(toolCall)).toBeDefined()
    })

    it('returns undefined after TTL expires', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall, result)

      // Advance time past TTL (30s for lookup tool)
      vi.advanceTimersByTime(31000)

      expect(cache.get(toolCall)).toBeUndefined()
    })

    it('uses tool-specific TTL over default', () => {
      // Create tool with custom TTL
      const shortTTLTool: CacheableToolDefinition = {
        name: 'shortTTL',
        description: 'Short TTL tool',
        inputSchema: z.object({}),
        execute: async () => 'result',
        cacheable: true,
        cacheTTL: 5000, // 5 seconds
      }

      cache.registerTool(shortTTLTool)

      const toolCall: ToolCall = { id: 'call1', name: 'shortTTL', arguments: {} }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'shortTTL', result: 'data' }

      cache.set(toolCall, result)

      // Still within 5s
      vi.advanceTimersByTime(4000)
      expect(cache.get(toolCall)).toBeDefined()

      // Past 5s
      vi.advanceTimersByTime(2000)
      expect(cache.get(toolCall)).toBeUndefined()
    })

    it('uses default TTL when tool has no custom TTL', () => {
      const defaultTTLTool: CacheableToolDefinition = {
        name: 'defaultTTL',
        description: 'Uses default TTL',
        inputSchema: z.object({}),
        execute: async () => 'result',
        cacheable: true,
        // No cacheTTL specified
      }

      cache.registerTool(defaultTTLTool)

      const toolCall: ToolCall = { id: 'call1', name: 'defaultTTL', arguments: {} }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'defaultTTL', result: 'data' }

      cache.set(toolCall, result)

      // Within default TTL (60s)
      vi.advanceTimersByTime(59000)
      expect(cache.get(toolCall)).toBeDefined()

      // Past default TTL
      vi.advanceTimersByTime(2000)
      expect(cache.get(toolCall)).toBeUndefined()
    })
  })

  describe('invalidation', () => {
    it('invalidates specific tool call', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall, result)
      expect(cache.get(toolCall)).toBeDefined()

      cache.invalidate(toolCall)
      expect(cache.get(toolCall)).toBeUndefined()
    })

    it('invalidates all entries for a tool', () => {
      // Add multiple entries for lookup tool
      for (let i = 0; i < 5; i++) {
        const toolCall: ToolCall = { id: `call${i}`, name: 'lookup', arguments: { id: `user-${i}` } }
        const result: ToolResult = { toolCallId: `call${i}`, toolName: 'lookup', result: `data-${i}` }
        cache.set(toolCall, result)
      }

      // Add entry for different tool
      const otherTool: CacheableToolDefinition = {
        name: 'other',
        description: 'Other tool',
        inputSchema: z.object({}),
        execute: async () => 'result',
        cacheable: true,
      }
      cache.registerTool(otherTool)
      const otherCall: ToolCall = { id: 'other1', name: 'other', arguments: {} }
      cache.set(otherCall, { toolCallId: 'other1', toolName: 'other', result: 'other-data' })

      // Invalidate lookup tool
      const count = cache.invalidateTool('lookup')

      expect(count).toBe(5)
      expect(cache.get({ id: 'call0', name: 'lookup', arguments: { id: 'user-0' } })).toBeUndefined()
      // Other tool should still be cached
      expect(cache.get(otherCall)).toBeDefined()
    })

    it('clears entire cache', () => {
      for (let i = 0; i < 3; i++) {
        const toolCall: ToolCall = { id: `call${i}`, name: 'lookup', arguments: { id: `user-${i}` } }
        const result: ToolResult = { toolCallId: `call${i}`, toolName: 'lookup', result: `data-${i}` }
        cache.set(toolCall, result)
      }

      cache.clear()

      const stats = cache.getStats()
      expect(stats.size).toBe(0)
    })
  })

  describe('statistics', () => {
    it('tracks cache hits', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall, result)

      // Multiple gets
      cache.get(toolCall)
      cache.get(toolCall)
      cache.get(toolCall)

      const stats = cache.getStats()
      expect(stats.hits).toBe(3)
    })

    it('tracks cache misses', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'missing' } }

      cache.get(toolCall)
      cache.get(toolCall)

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
    })

    it('calculates hit rate', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      // 1 miss (before caching)
      cache.get(toolCall)

      // Cache it
      cache.set(toolCall, result)

      // 3 hits
      cache.get(toolCall)
      cache.get(toolCall)
      cache.get(toolCall)

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(0.75) // 3 hits / 4 total
    })

    it('tracks entries by tool', () => {
      // Add entries for lookup tool
      cache.set(
        { id: 'call1', name: 'lookup', arguments: { id: 'a' } },
        { toolCallId: 'call1', toolName: 'lookup', result: 'a' }
      )
      cache.set(
        { id: 'call2', name: 'lookup', arguments: { id: 'b' } },
        { toolCallId: 'call2', toolName: 'lookup', result: 'b' }
      )

      // Add different tool
      const searchTool: CacheableToolDefinition = {
        name: 'search',
        description: 'Search',
        inputSchema: z.object({}),
        execute: async () => [],
        cacheable: true,
      }
      cache.registerTool(searchTool)
      cache.set(
        { id: 'call3', name: 'search', arguments: {} },
        { toolCallId: 'call3', toolName: 'search', result: [] }
      )

      const stats = cache.getStats()
      expect(stats.byTool.lookup.entries).toBe(2)
      expect(stats.byTool.search.entries).toBe(1)
    })

    it('estimates bytes used', () => {
      cache.set(
        { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } },
        { toolCallId: 'call1', toolName: 'lookup', result: { large: 'data'.repeat(100) } }
      )

      const stats = cache.getStats()
      expect(stats.bytesUsed).toBeGreaterThan(0)
    })

    it('resets stats on clear', () => {
      const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'user-1' } }
      const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

      cache.set(toolCall, result)
      cache.get(toolCall)
      cache.get({ id: 'call2', name: 'lookup', arguments: { id: 'missing' } })

      cache.clear()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })

  describe('custom cache key function', () => {
    it('uses custom key function when provided', () => {
      const customKeyTool: CacheableToolDefinition = {
        name: 'customKey',
        description: 'Uses custom key',
        inputSchema: z.object({ query: z.string(), timestamp: z.number() }),
        execute: async ({ query }) => ({ results: [query] }),
        cacheable: true,
        // Ignore timestamp in cache key
        cacheKeyFn: (input) => (input as { query: string }).query,
      }

      cache.registerTool(customKeyTool)

      // Same query, different timestamps should hit same cache
      const call1: ToolCall = { id: 'call1', name: 'customKey', arguments: { query: 'test', timestamp: 1 } }
      const call2: ToolCall = { id: 'call2', name: 'customKey', arguments: { query: 'test', timestamp: 2 } }

      cache.set(call1, { toolCallId: 'call1', toolName: 'customKey', result: 'cached' })

      const cached = cache.get(call2)
      expect(cached).toBeDefined()
      expect(cached?.result).toBe('cached')
    })
  })
})

// ============================================================================
// createToolCache() Tests
// ============================================================================

describe('createToolCache()', () => {
  it('creates cache with default options', () => {
    const cache = createToolCache()

    expect(cache).toBeInstanceOf(ToolResultCache)
    expect(cache.getStats().size).toBe(0)
  })

  it('creates cache with custom options', () => {
    const cache = createToolCache({
      maxSize: 1000,
      defaultTTL: 600000,
    })

    expect(cache).toBeInstanceOf(ToolResultCache)
  })

  it('accepts custom storage backend', () => {
    const customStorage = new InMemoryCacheStorage(50)

    const cache = createToolCache({
      storage: customStorage,
    })

    // Verify it uses our storage by checking operations work
    const tool: CacheableToolDefinition = {
      name: 'test',
      description: 'test',
      inputSchema: z.object({}),
      execute: async () => 'result',
      cacheable: true,
    }

    cache.registerTool(tool)
    cache.set(
      { id: 'call1', name: 'test', arguments: {} },
      { toolCallId: 'call1', toolName: 'test', result: 'data' }
    )

    // Should be in our custom storage
    expect(customStorage.size()).toBe(1)
  })

  it('can disable statistics tracking', () => {
    const cache = createToolCache({
      trackStats: false,
    })

    const tool: CacheableToolDefinition = {
      name: 'test',
      description: 'test',
      inputSchema: z.object({}),
      execute: async () => 'result',
      cacheable: true,
    }

    cache.registerTool(tool)
    cache.set(
      { id: 'call1', name: 'test', arguments: {} },
      { toolCallId: 'call1', toolName: 'test', result: 'data' }
    )
    cache.get({ id: 'call2', name: 'test', arguments: {} })

    const stats = cache.getStats()
    // Stats should not be tracked (stay at 0)
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
  })
})

// ============================================================================
// cacheable() Tests
// ============================================================================

describe('cacheable()', () => {
  it('marks tool as cacheable', () => {
    const baseTool = tool({
      name: 'search',
      description: 'Search documents',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => [query],
    })

    const cacheableTool = cacheable(baseTool)

    expect(cacheableTool.cacheable).toBe(true)
    expect(cacheableTool.name).toBe('search')
  })

  it('allows custom TTL', () => {
    const baseTool = tool({
      name: 'lookup',
      description: 'Lookup data',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ id }),
    })

    const cacheableTool = cacheable(baseTool, { ttl: 120000 })

    expect(cacheableTool.cacheTTL).toBe(120000)
  })

  it('allows custom key function', () => {
    const baseTool = tool({
      name: 'query',
      description: 'Query with timestamp',
      inputSchema: z.object({ q: z.string(), ts: z.number() }),
      execute: async ({ q }) => [q],
    })

    const cacheableTool = cacheable(baseTool, {
      keyFn: (input) => input.q, // Ignore timestamp
    })

    expect(cacheableTool.cacheKeyFn).toBeDefined()
    expect(cacheableTool.cacheKeyFn!({ q: 'test', ts: 123 })).toBe('test')
  })

  it('preserves original tool properties', () => {
    const baseTool = tool({
      name: 'sensitive',
      description: 'Sensitive operation',
      inputSchema: z.object({}),
      execute: async () => 'done',
      permission: 'confirm',
      interruptible: true,
    })

    const cacheableTool = cacheable(baseTool)

    expect(cacheableTool.permission).toBe('confirm')
    expect(cacheableTool.interruptible).toBe(true)
  })
})

// ============================================================================
// createCacheHooks() Tests
// ============================================================================

describe('createCacheHooks()', () => {
  let cache: ToolResultCache
  let hooks: ReturnType<typeof createCacheHooks>

  beforeEach(() => {
    cache = createToolCache()
    const tool: CacheableToolDefinition = {
      name: 'lookup',
      description: 'Lookup',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ id }),
      cacheable: true,
    }
    cache.registerTool(tool)
    hooks = createCacheHooks(cache)
  })

  it('provides getCachedResult method', () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

    cache.set(toolCall, result)

    const cached = hooks.getCachedResult(toolCall)
    expect(cached).toBeDefined()
    expect(cached?.result).toBe('data')
  })

  it('onPreToolUse allows calls by default', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }

    const decision = await hooks.onPreToolUse(toolCall)
    expect(decision.action).toBe('allow')
  })

  it('onPostToolUse stores results for cacheable tools', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

    await hooks.onPostToolUse(toolCall, result)

    const cached = cache.get(toolCall)
    expect(cached).toBeDefined()
  })

  it('onPostToolUse does not store error results', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const errorResult: ToolResult = {
      toolCallId: 'call1',
      toolName: 'lookup',
      result: null,
      error: 'Failed',
    }

    await hooks.onPostToolUse(toolCall, errorResult)

    expect(cache.get(toolCall)).toBeUndefined()
  })
})

// ============================================================================
// withCaching() Tests
// ============================================================================

describe('withCaching()', () => {
  let cache: ToolResultCache

  beforeEach(() => {
    cache = createToolCache()
    const tool: CacheableToolDefinition = {
      name: 'lookup',
      description: 'Lookup',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ id }),
      cacheable: true,
    }
    cache.registerTool(tool)
  })

  it('creates hooks with caching', () => {
    const hooks = withCaching(cache)

    expect(hooks.onPreToolUse).toBeDefined()
    expect(hooks.onPostToolUse).toBeDefined()
  })

  it('preserves existing hooks', async () => {
    const preSpy = vi.fn().mockResolvedValue({ action: 'allow' })
    const postSpy = vi.fn()
    const stepStartSpy = vi.fn()

    const existingHooks: Partial<AgentHooks> = {
      onPreToolUse: preSpy,
      onPostToolUse: postSpy,
      onStepStart: stepStartSpy,
    }

    const hooks = withCaching(cache, existingHooks)

    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

    await hooks.onPreToolUse!(toolCall)
    await hooks.onPostToolUse!(toolCall, result)

    expect(preSpy).toHaveBeenCalledWith(toolCall)
    expect(postSpy).toHaveBeenCalledWith(toolCall, result)
    expect(hooks.onStepStart).toBe(stepStartSpy)
  })

  it('caches results through hooks', async () => {
    const hooks = withCaching(cache)

    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const result: ToolResult = { toolCallId: 'call1', toolName: 'lookup', result: 'data' }

    await hooks.onPostToolUse!(toolCall, result)

    const cached = cache.get(toolCall)
    expect(cached).toBeDefined()
    expect(cached?.result).toBe('data')
  })

  it('preserves other hook properties', () => {
    const onError = vi.fn()
    const onPermissionRequest = vi.fn()

    const hooks = withCaching(cache, {
      onError,
      onPermissionRequest,
    })

    expect(hooks.onError).toBe(onError)
    expect(hooks.onPermissionRequest).toBe(onPermissionRequest)
  })
})

// ============================================================================
// executeCached() Tests
// ============================================================================

describe('executeCached()', () => {
  let cache: ToolResultCache
  let mockTool: CacheableToolDefinition

  beforeEach(() => {
    cache = createToolCache()
    mockTool = {
      name: 'lookup',
      description: 'Lookup',
      inputSchema: z.object({ id: z.string() }),
      execute: vi.fn().mockResolvedValue({ found: true }),
      cacheable: true,
    }
    cache.registerTool(mockTool)
  })

  it('returns cached result without executing', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }

    // Pre-cache a result
    cache.set(toolCall, { toolCallId: 'call1', toolName: 'lookup', result: 'cached-data' })

    const result = await executeCached(cache, mockTool, toolCall, { agentId: 'agent1' })

    expect(result.result).toBe('cached-data')
    expect(mockTool.execute).not.toHaveBeenCalled()
  })

  it('executes and caches on miss', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }

    const result = await executeCached(cache, mockTool, toolCall, { agentId: 'agent1' })

    expect(result.result).toEqual({ found: true })
    expect(mockTool.execute).toHaveBeenCalledWith({ id: 'test' }, expect.any(Object))

    // Should now be cached
    const cached = cache.get(toolCall)
    expect(cached).toBeDefined()
  })

  it('handles execution errors', async () => {
    const errorTool: CacheableToolDefinition = {
      name: 'error',
      description: 'Throws error',
      inputSchema: z.object({}),
      execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      cacheable: true,
    }
    cache.registerTool(errorTool)

    const toolCall: ToolCall = { id: 'call1', name: 'error', arguments: {} }

    const result = await executeCached(cache, errorTool, toolCall, { agentId: 'agent1' })

    expect(result.error).toBe('Execution failed')
    expect(result.result).toBeNull()

    // Should not cache errors
    expect(cache.get(toolCall)).toBeUndefined()
  })

  it('passes context to execute function', async () => {
    const toolCall: ToolCall = { id: 'call1', name: 'lookup', arguments: { id: 'test' } }
    const context = { agentId: 'agent1', sessionId: 'session1' }

    await executeCached(cache, mockTool, toolCall, context)

    expect(mockTool.execute).toHaveBeenCalledWith({ id: 'test' }, expect.objectContaining(context))
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Tool Cache Integration', () => {
  it('full workflow: register, cache, retrieve, invalidate', () => {
    const cache = createToolCache({ maxSize: 100, defaultTTL: 60000 })

    // Create and register cacheable tools
    const lookupTool = cacheable(
      tool({
        name: 'lookup',
        description: 'Look up user',
        inputSchema: z.object({ userId: z.string() }),
        execute: async ({ userId }) => ({ id: userId, name: 'User' }),
      }),
      { ttl: 30000 }
    )

    const searchTool = cacheable(
      tool({
        name: 'search',
        description: 'Search documents',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => [{ title: query }],
      })
    )

    cache.registerTools([lookupTool, searchTool])

    // Verify registration
    expect(cache.isCacheable('lookup')).toBe(true)
    expect(cache.isCacheable('search')).toBe(true)
    expect(cache.isCacheable('unknown')).toBe(false)

    // Cache some results
    cache.set(
      { id: 'call1', name: 'lookup', arguments: { userId: 'u1' } },
      { toolCallId: 'call1', toolName: 'lookup', result: { id: 'u1', name: 'Alice' } }
    )
    cache.set(
      { id: 'call2', name: 'lookup', arguments: { userId: 'u2' } },
      { toolCallId: 'call2', toolName: 'lookup', result: { id: 'u2', name: 'Bob' } }
    )
    cache.set(
      { id: 'call3', name: 'search', arguments: { query: 'test' } },
      { toolCallId: 'call3', toolName: 'search', result: [{ title: 'Test Doc' }] }
    )

    // Verify retrieval
    const cachedLookup = cache.get({ id: 'new-call', name: 'lookup', arguments: { userId: 'u1' } })
    expect(cachedLookup?.result).toEqual({ id: 'u1', name: 'Alice' })

    // Check stats
    const stats = cache.getStats()
    expect(stats.size).toBe(3)
    expect(stats.byTool.lookup.entries).toBe(2)
    expect(stats.byTool.search.entries).toBe(1)

    // Invalidate one tool
    const invalidated = cache.invalidateTool('lookup')
    expect(invalidated).toBe(2)

    // Verify invalidation
    expect(cache.get({ id: 'any', name: 'lookup', arguments: { userId: 'u1' } })).toBeUndefined()
    expect(cache.get({ id: 'any', name: 'search', arguments: { query: 'test' } })).toBeDefined()

    // Clear all
    cache.clear()
    expect(cache.getStats().size).toBe(0)
  })

  it('works with agent hooks workflow', async () => {
    const cache = createToolCache()
    const executionCount = { value: 0 }

    const expensiveTool: CacheableToolDefinition = {
      name: 'expensive',
      description: 'Expensive computation',
      inputSchema: z.object({ input: z.string() }),
      execute: async ({ input }) => {
        executionCount.value++
        return { computed: input.toUpperCase() }
      },
      cacheable: true,
    }

    cache.registerTool(expensiveTool)
    const hooks = withCaching(cache)

    // Simulate first tool call (cache miss)
    const toolCall1: ToolCall = { id: 'call1', name: 'expensive', arguments: { input: 'hello' } }
    await hooks.onPreToolUse!(toolCall1)

    // Execute tool (simulated)
    const result1 = await expensiveTool.execute({ input: 'hello' }, { agentId: 'test' })
    const toolResult1: ToolResult = { toolCallId: 'call1', toolName: 'expensive', result: result1 }

    await hooks.onPostToolUse!(toolCall1, toolResult1)

    expect(executionCount.value).toBe(1)

    // Verify cached
    expect(cache.get(toolCall1)).toBeDefined()

    // Simulate second call with same args (cache hit available)
    const toolCall2: ToolCall = { id: 'call2', name: 'expensive', arguments: { input: 'hello' } }

    // In a real scenario, the agent would check getCachedResult before executing
    const cacheHooks = createCacheHooks(cache)
    const cached = cacheHooks.getCachedResult(toolCall2)

    if (!cached) {
      // Would execute - but we have a cache hit
      throw new Error('Expected cache hit')
    }

    expect(cached.result).toEqual({ computed: 'HELLO' })
    // executionCount should still be 1 (no re-execution)
    expect(executionCount.value).toBe(1)
  })
})
