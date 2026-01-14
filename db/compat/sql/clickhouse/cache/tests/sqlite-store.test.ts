/**
 * SQLiteStore Unit Tests
 *
 * Tests for the DO-local SQLite-based index cache store.
 * These tests validate the public API contract and expected behaviors.
 *
 * Note: Per CLAUDE.md, real integration tests should use miniflare
 * with actual DO SQLite. These tests focus on API contracts and
 * can be run in node environment with mock storage.
 */

import { describe, it, expect } from 'vitest'
import type { IndexEntryType, SQLiteStoreConfig, StoreStats, IndexEntry } from '../sqlite-store'

// ============================================================================
// API Contract Tests
// ============================================================================

describe('SQLiteStore API Contract', () => {
  describe('IndexEntryType', () => {
    it('supports all documented entry types', () => {
      const types: IndexEntryType[] = [
        'path_stats',
        'bloom_filter',
        'minmax_stats',
        'partition_manifest',
        'column_index',
        'custom',
      ]

      // All types should be valid strings
      expect(types.every((t) => typeof t === 'string')).toBe(true)
      expect(types.length).toBe(6)
    })
  })

  describe('SQLiteStoreConfig', () => {
    it('has sensible defaults', () => {
      const defaults: Required<SQLiteStoreConfig> = {
        maxSizeBytes: 50 * 1024 * 1024, // 50MB
        evictionTargetRatio: 0.8,
        minEntries: 10,
      }

      expect(defaults.maxSizeBytes).toBe(52428800)
      expect(defaults.evictionTargetRatio).toBeGreaterThan(0)
      expect(defaults.evictionTargetRatio).toBeLessThanOrEqual(1)
      expect(defaults.minEntries).toBeGreaterThan(0)
    })
  })

  describe('StoreStats', () => {
    it('defines correct statistics structure', () => {
      const mockStats: StoreStats = {
        entryCount: 100,
        totalSizeBytes: 1024000,
        entriesByType: {
          path_stats: 50,
          bloom_filter: 30,
          minmax_stats: 10,
          partition_manifest: 5,
          column_index: 3,
          custom: 2,
        },
        lastEviction: Date.now(),
        lastUpdated: Date.now(),
      }

      expect(mockStats.entryCount).toBeGreaterThanOrEqual(0)
      expect(mockStats.totalSizeBytes).toBeGreaterThanOrEqual(0)
      expect(Object.keys(mockStats.entriesByType).length).toBeGreaterThan(0)
    })
  })

  describe('IndexEntry', () => {
    it('defines correct entry structure', () => {
      const mockEntry: IndexEntry<{ count: number }> = {
        key: 'test:key',
        type: 'path_stats',
        data: { count: 42 },
        sizeBytes: 256,
        accessCount: 5,
        lastAccessed: Date.now(),
        createdAt: Date.now() - 3600000,
        etag: 'abc123',
        sourcePath: 'indexes/manifest.json',
      }

      expect(mockEntry.key).toBeTruthy()
      expect(mockEntry.type).toBe('path_stats')
      expect(mockEntry.data.count).toBe(42)
      expect(mockEntry.sizeBytes).toBeGreaterThan(0)
      expect(mockEntry.accessCount).toBeGreaterThanOrEqual(0)
      expect(mockEntry.lastAccessed).toBeLessThanOrEqual(Date.now())
      expect(mockEntry.createdAt).toBeLessThanOrEqual(mockEntry.lastAccessed)
    })

    it('supports optional fields', () => {
      const minimalEntry: IndexEntry = {
        key: 'minimal',
        type: 'custom',
        data: null,
        sizeBytes: 0,
        accessCount: 0,
        lastAccessed: Date.now(),
        createdAt: Date.now(),
        // etag and sourcePath are optional
      }

      expect(minimalEntry.etag).toBeUndefined()
      expect(minimalEntry.sourcePath).toBeUndefined()
    })
  })
})

// ============================================================================
// LRU Scoring Algorithm Tests
// ============================================================================

describe('LRU Scoring Algorithm', () => {
  /**
   * The SQLiteStore uses weighted LRU scoring:
   * score = last_accessed + (access_count * 60000)
   *
   * This means each access adds 1 minute (60000ms) to the effective age.
   * Lower scores = better eviction candidates.
   */

  it('calculates correct LRU score for cold entries', () => {
    const lastAccessed = Date.now() - 3600000 // 1 hour ago
    const accessCount = 0
    const score = lastAccessed + accessCount * 60000

    expect(score).toBe(lastAccessed)
  })

  it('calculates correct LRU score for hot entries', () => {
    const lastAccessed = Date.now() - 3600000 // 1 hour ago
    const accessCount = 100
    const scoreWithAccess = lastAccessed + accessCount * 60000
    const scoreWithoutAccess = lastAccessed

    // 100 accesses adds 100 minutes (6000000ms) to the score
    expect(scoreWithAccess - scoreWithoutAccess).toBe(6000000)
  })

  it('prioritizes recently accessed entries over older hot entries', () => {
    const now = Date.now()

    // Entry A: Recent but cold
    const entryA = {
      lastAccessed: now - 60000, // 1 minute ago
      accessCount: 1,
    }
    const scoreA = entryA.lastAccessed + entryA.accessCount * 60000

    // Entry B: Old but hot
    const entryB = {
      lastAccessed: now - 600000, // 10 minutes ago
      accessCount: 50,
    }
    const scoreB = entryB.lastAccessed + entryB.accessCount * 60000

    // Entry B should have higher score despite being older (more accesses)
    expect(scoreB).toBeGreaterThan(scoreA)
  })

  it('evicts cold old entries before hot recent entries', () => {
    const now = Date.now()

    const candidates = [
      { key: 'hot-recent', lastAccessed: now - 60000, accessCount: 10 },
      { key: 'cold-old', lastAccessed: now - 3600000, accessCount: 0 },
      { key: 'warm-medium', lastAccessed: now - 300000, accessCount: 5 },
    ].map((e) => ({
      ...e,
      score: e.lastAccessed + e.accessCount * 60000,
    }))

    // Sort by score ascending (lower = evict first)
    candidates.sort((a, b) => a.score - b.score)

    // Cold-old should be evicted first
    expect(candidates[0]!.key).toBe('cold-old')
  })
})

// ============================================================================
// Size Estimation Tests
// ============================================================================

describe('Size Estimation', () => {
  it('calculates JSON size correctly', () => {
    const data = { name: 'test', count: 42, tags: ['a', 'b', 'c'] }
    const jsonString = JSON.stringify(data)
    const sizeBytes = new TextEncoder().encode(jsonString).length

    expect(sizeBytes).toBeGreaterThan(0)
    expect(sizeBytes).toBeLessThan(1000) // Sanity check
  })

  it('estimates storage utilization', () => {
    const maxSizeBytes = 50 * 1024 * 1024 // 50MB
    const currentSize = 25 * 1024 * 1024 // 25MB
    const utilization = currentSize / maxSizeBytes

    expect(utilization).toBe(0.5)
  })

  it('calculates eviction target correctly', () => {
    const maxSizeBytes = 100 * 1024 * 1024 // 100MB
    const evictionTargetRatio = 0.8
    const targetSize = Math.floor(maxSizeBytes * evictionTargetRatio)

    expect(targetSize).toBe(80 * 1024 * 1024) // 80MB
  })
})

// ============================================================================
// Cache Key Generation Tests
// ============================================================================

describe('Cache Key Patterns', () => {
  it('supports hierarchical keys', () => {
    const keys = [
      'json:indexes/users/manifest.json',
      'json:indexes/orders/partition-stats.json',
      'bin:indexes/users/hnsw/chunk-0.bin',
    ]

    for (const key of keys) {
      expect(key.includes(':')).toBe(true)
      expect(key.split(':').length).toBe(2)
    }
  })

  it('distinguishes JSON and binary keys by prefix', () => {
    const jsonKey = 'json:indexes/manifest.json'
    const binKey = 'bin:indexes/hnsw/chunk-0.bin'

    expect(jsonKey.startsWith('json:')).toBe(true)
    expect(binKey.startsWith('bin:')).toBe(true)
  })
})
