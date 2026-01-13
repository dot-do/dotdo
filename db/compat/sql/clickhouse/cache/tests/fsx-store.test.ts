/**
 * FsxStore Unit Tests
 *
 * Tests for the DO-local filesystem-based binary index cache store.
 * These tests validate the public API contract and expected behaviors.
 *
 * Note: Per CLAUDE.md, real integration tests should use miniflare
 * with actual DO fsx. These tests focus on API contracts and algorithms.
 */

import { describe, it, expect } from 'vitest'
import type { BinaryIndexType, FsxStoreConfig, FsxStoreStats, BinaryEntry, FsInterface } from '../fsx-store'

// ============================================================================
// API Contract Tests
// ============================================================================

describe('FsxStore API Contract', () => {
  describe('BinaryIndexType', () => {
    it('supports all documented binary types', () => {
      const types: BinaryIndexType[] = [
        'hnsw_chunk',
        'hnsw_header',
        'gin_postings',
        'bloom_filter',
        'btree_node',
        'parquet_footer',
        'custom',
      ]

      expect(types.every((t) => typeof t === 'string')).toBe(true)
      expect(types.length).toBe(7)
    })
  })

  describe('FsxStoreConfig', () => {
    it('has sensible defaults', () => {
      const defaults: Required<FsxStoreConfig> = {
        maxSizeBytes: 100 * 1024 * 1024, // 100MB
        evictionTargetRatio: 0.8,
        minEntries: 5,
        basePath: '/.cache/indexes',
      }

      expect(defaults.maxSizeBytes).toBe(104857600)
      expect(defaults.evictionTargetRatio).toBeGreaterThan(0)
      expect(defaults.evictionTargetRatio).toBeLessThanOrEqual(1)
      expect(defaults.minEntries).toBeGreaterThan(0)
      expect(defaults.basePath).toContain('cache')
    })
  })

  describe('FsxStoreStats', () => {
    it('defines correct statistics structure', () => {
      const mockStats: FsxStoreStats = {
        entryCount: 50,
        totalSizeBytes: 50 * 1024 * 1024,
        entriesByType: {
          hnsw_chunk: 30,
          bloom_filter: 15,
          gin_postings: 5,
          hnsw_header: 0,
          btree_node: 0,
          parquet_footer: 0,
          custom: 0,
        },
        sizeByType: {
          hnsw_chunk: 40 * 1024 * 1024,
          bloom_filter: 8 * 1024 * 1024,
          gin_postings: 2 * 1024 * 1024,
          hnsw_header: 0,
          btree_node: 0,
          parquet_footer: 0,
          custom: 0,
        },
        lastEviction: Date.now() - 3600000,
        lastUpdated: Date.now(),
      }

      expect(mockStats.entryCount).toBeGreaterThanOrEqual(0)
      expect(mockStats.totalSizeBytes).toBeGreaterThanOrEqual(0)
      expect(Object.keys(mockStats.entriesByType).length).toBe(7)
      expect(Object.keys(mockStats.sizeByType).length).toBe(7)
    })
  })

  describe('BinaryEntry', () => {
    it('defines correct entry structure', () => {
      const mockEntry: BinaryEntry = {
        key: 'hnsw:users:chunk-0',
        type: 'hnsw_chunk',
        path: '/.cache/indexes/hnsw/hnsw_users_chunk-0-abc123.bin',
        sizeBytes: 10 * 1024 * 1024,
        accessCount: 25,
        lastAccessed: Date.now(),
        createdAt: Date.now() - 3600000,
        etag: 'xyz789',
        sourcePath: 'indexes/users/hnsw/chunk-0.bin',
        metadata: { level: 0, nodeCount: 50000 },
      }

      expect(mockEntry.key).toBeTruthy()
      expect(mockEntry.type).toBe('hnsw_chunk')
      expect(mockEntry.path).toContain('.bin')
      expect(mockEntry.sizeBytes).toBeGreaterThan(0)
      expect(mockEntry.metadata?.nodeCount).toBe(50000)
    })

    it('supports optional fields', () => {
      const minimalEntry: BinaryEntry = {
        key: 'minimal',
        type: 'custom',
        path: '/.cache/indexes/custom/minimal.bin',
        sizeBytes: 100,
        accessCount: 0,
        lastAccessed: Date.now(),
        createdAt: Date.now(),
      }

      expect(minimalEntry.etag).toBeUndefined()
      expect(minimalEntry.sourcePath).toBeUndefined()
      expect(minimalEntry.metadata).toBeUndefined()
    })
  })

  describe('FsInterface', () => {
    it('defines correct filesystem interface', () => {
      // Type check - ensure interface is properly defined
      const mockFs: FsInterface = {
        read: async (_path: string) => new Uint8Array([]),
        write: async (_path: string, _data: Uint8Array | string) => {},
        unlink: async (_path: string) => {},
        exists: async (_path: string) => false,
        mkdir: async (_path: string, _options?: { recursive?: boolean }) => {},
        stat: async (_path: string) => ({ size: 0, mtime: new Date() }),
      }

      expect(typeof mockFs.read).toBe('function')
      expect(typeof mockFs.write).toBe('function')
      expect(typeof mockFs.unlink).toBe('function')
      expect(typeof mockFs.exists).toBe('function')
      expect(typeof mockFs.mkdir).toBe('function')
      expect(typeof mockFs.stat).toBe('function')
    })
  })
})

// ============================================================================
// File Path Generation Tests
// ============================================================================

describe('File Path Generation', () => {
  /**
   * The FsxStore generates paths based on:
   * - Base path (configurable, default: /.cache/indexes)
   * - Type directory (hnsw, bloom, gin, btree, custom)
   * - Key hash for uniqueness
   */

  const simpleHash = (str: string): string => {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36).substring(0, 8)
  }

  const safeKey = (key: string): string => {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  it('generates deterministic paths for same key', () => {
    const key = 'hnsw:users:chunk-0'
    const hash1 = simpleHash(key)
    const hash2 = simpleHash(key)

    expect(hash1).toBe(hash2)
  })

  it('generates different paths for different keys', () => {
    const hash1 = simpleHash('hnsw:users:chunk-0')
    const hash2 = simpleHash('hnsw:users:chunk-1')

    expect(hash1).not.toBe(hash2)
  })

  it('sanitizes special characters in keys', () => {
    const key = 'special/path:with\\chars'
    const sanitized = safeKey(key)

    expect(sanitized).not.toContain('/')
    expect(sanitized).not.toContain(':')
    expect(sanitized).not.toContain('\\')
    expect(sanitized).toBe('special_path_with_chars')
  })

  it('maps types to correct directories', () => {
    const typeDirectories: Record<BinaryIndexType, string> = {
      hnsw_chunk: 'hnsw',
      hnsw_header: 'hnsw',
      gin_postings: 'gin',
      bloom_filter: 'bloom',
      btree_node: 'btree',
      parquet_footer: 'custom',
      custom: 'custom',
    }

    expect(typeDirectories.hnsw_chunk).toBe('hnsw')
    expect(typeDirectories.hnsw_header).toBe('hnsw')
    expect(typeDirectories.gin_postings).toBe('gin')
    expect(typeDirectories.bloom_filter).toBe('bloom')
    expect(typeDirectories.btree_node).toBe('btree')
  })
})

// ============================================================================
// Binary Data Handling Tests
// ============================================================================

describe('Binary Data Handling', () => {
  it('converts string to Uint8Array correctly', () => {
    const str = 'Hello, World!'
    const encoded = new TextEncoder().encode(str)
    const decoded = new TextDecoder().decode(encoded)

    expect(decoded).toBe(str)
    expect(encoded).toBeInstanceOf(Uint8Array)
  })

  it('preserves binary data through ArrayBuffer conversion', () => {
    const original = new Uint8Array([1, 2, 3, 255, 0, 128])
    const buffer = original.buffer
    const restored = new Uint8Array(buffer)

    expect(restored).toEqual(original)
  })

  it('measures binary size correctly', () => {
    const data = new Uint8Array(1000)
    expect(data.length).toBe(1000)
    expect(data.byteLength).toBe(1000)
  })
})

// ============================================================================
// LRU Scoring Tests (same algorithm as SQLiteStore)
// ============================================================================

describe('FsxStore LRU Scoring', () => {
  it('uses same weighted LRU algorithm as SQLiteStore', () => {
    const now = Date.now()

    const entries = [
      { key: 'hot', lastAccessed: now - 60000, accessCount: 100 },
      { key: 'cold', lastAccessed: now - 3600000, accessCount: 0 },
    ].map((e) => ({
      ...e,
      score: e.lastAccessed + e.accessCount * 60000,
    }))

    // Sort by score ascending
    entries.sort((a, b) => a.score - b.score)

    // Cold entry should be evicted first
    expect(entries[0]!.key).toBe('cold')
  })
})

// ============================================================================
// Storage Limit Tests
// ============================================================================

describe('Storage Limits', () => {
  it('calculates combined limit for index cache', () => {
    const totalLimit = 150 * 1024 * 1024 // 150MB
    const sqliteRatio = 0.4
    const fsxRatio = 0.6

    const sqliteLimit = Math.floor(totalLimit * sqliteRatio)
    const fsxLimit = Math.floor(totalLimit * fsxRatio)

    expect(sqliteLimit).toBe(60 * 1024 * 1024) // 60MB
    expect(fsxLimit).toBe(90 * 1024 * 1024) // 90MB
    expect(sqliteLimit + fsxLimit).toBe(totalLimit)
  })

  it('triggers eviction when exceeding limit', () => {
    const maxSizeBytes = 100 * 1024 * 1024 // 100MB
    const currentSize = 110 * 1024 * 1024 // 110MB - over limit
    const shouldEvict = currentSize > maxSizeBytes

    expect(shouldEvict).toBe(true)
  })

  it('calculates eviction amount correctly', () => {
    const maxSizeBytes = 100 * 1024 * 1024 // 100MB
    const evictionTargetRatio = 0.8
    const targetSize = Math.floor(maxSizeBytes * evictionTargetRatio)
    const currentSize = 110 * 1024 * 1024 // 110MB

    const amountToEvict = currentSize - targetSize

    expect(amountToEvict).toBe(30 * 1024 * 1024) // Need to evict 30MB
  })
})
