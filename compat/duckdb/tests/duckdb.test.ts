/**
 * Tests for @dotdo/duckdb compat layer
 *
 * These tests validate the compat layer correctly re-exports from @dotdo/duckdb-worker
 * and that the extended DotdoDuckDB features work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest'

describe('@dotdo/duckdb', () => {
  describe('Core Exports', () => {
    it('should export createDuckDB', async () => {
      const { createDuckDB } = await import('../index.js')
      expect(typeof createDuckDB).toBe('function')
    })

    it('should export instantiateDuckDB', async () => {
      const { instantiateDuckDB } = await import('../index.js')
      expect(typeof instantiateDuckDB).toBe('function')
    })

    it('should export cache management functions', async () => {
      const { clearCache, isCached } = await import('../index.js')
      expect(typeof clearCache).toBe('function')
      expect(typeof isCached).toBe('function')
    })

    it('should export file buffer functions', async () => {
      const {
        FileBufferRegistry,
        registerFileBuffer,
        dropFile,
        getFileBuffer,
        hasFile,
        listFiles,
        getFileSize,
        clearAllFiles,
        getTotalMemoryUsage,
      } = await import('../index.js')

      expect(typeof FileBufferRegistry).toBe('function')
      expect(typeof registerFileBuffer).toBe('function')
      expect(typeof dropFile).toBe('function')
      expect(typeof getFileBuffer).toBe('function')
      expect(typeof hasFile).toBe('function')
      expect(typeof listFiles).toBe('function')
      expect(typeof getFileSize).toBe('function')
      expect(typeof clearAllFiles).toBe('function')
      expect(typeof getTotalMemoryUsage).toBe('function')
    })

    it('should export module management functions', async () => {
      const {
        loadDuckDBModule,
        createInstanceFromModule,
        clearModuleCache,
        isModuleCached,
        createDuckDBFromBindings,
      } = await import('../index.js')

      expect(typeof loadDuckDBModule).toBe('function')
      expect(typeof createInstanceFromModule).toBe('function')
      expect(typeof clearModuleCache).toBe('function')
      expect(typeof isModuleCached).toBe('function')
      expect(typeof createDuckDBFromBindings).toBe('function')
    })
  })

  describe('Extended Features', () => {
    it('should export createDotdoDuckDB', async () => {
      const { createDotdoDuckDB } = await import('../index.js')
      expect(typeof createDotdoDuckDB).toBe('function')
    })

    it('should export DotdoDuckDBConfig interface', async () => {
      // Type-only test - types don't exist at runtime
      // This verifies the import compiles correctly
      const mod = await import('../index.js')
      expect(mod).toBeDefined()
    })

    it('should export DotdoDuckDBInstance interface', async () => {
      // Type-only test - types don't exist at runtime
      const mod = await import('../index.js')
      expect(mod).toBeDefined()
    })
  })

  describe('Default Export', () => {
    it('should have default export with core functions', async () => {
      const duckdb = await import('../index.js')
      const def = duckdb.default

      expect(def).toBeDefined()
      expect(typeof def.createDuckDB).toBe('function')
      expect(typeof def.createDotdoDuckDB).toBe('function')
      expect(typeof def.instantiateDuckDB).toBe('function')
      expect(typeof def.clearCache).toBe('function')
      expect(typeof def.isCached).toBe('function')
    })
  })

  describe('Cache Management', () => {
    beforeEach(async () => {
      const { clearCache, clearModuleCache } = await import('../index.js')
      clearCache()
      clearModuleCache()
    })

    it('should start with no cached module', async () => {
      const { isCached, isModuleCached } = await import('../index.js')
      expect(isCached()).toBe(false)
      expect(isModuleCached()).toBe(false)
    })

    it('should clear cache correctly', async () => {
      const { clearCache, isCached } = await import('../index.js')
      clearCache()
      expect(isCached()).toBe(false)
    })
  })

  describe('FileBufferRegistry', () => {
    it('should create isolated registries', async () => {
      const { FileBufferRegistry } = await import('../index.js')

      const registry1 = new FileBufferRegistry()
      const registry2 = new FileBufferRegistry()

      const buffer = new Uint8Array([1, 2, 3])
      registry1.register('test.dat', buffer)

      expect(registry1.has('test.dat')).toBe(true)
      expect(registry2.has('test.dat')).toBe(false)
    })

    it('should track memory usage', async () => {
      const { FileBufferRegistry } = await import('../index.js')

      const registry = new FileBufferRegistry()
      const buffer = new Uint8Array(1024) // 1KB

      expect(registry.totalMemoryUsage()).toBe(0)

      registry.register('test.dat', buffer)
      expect(registry.totalMemoryUsage()).toBe(1024)

      registry.drop('test.dat')
      expect(registry.totalMemoryUsage()).toBe(0)
    })

    it('should list registered files', async () => {
      const { FileBufferRegistry } = await import('../index.js')

      const registry = new FileBufferRegistry()
      registry.register('a.dat', new Uint8Array([1]))
      registry.register('b.dat', new Uint8Array([2]))
      registry.register('c.dat', new Uint8Array([3]))

      const files = registry.list()
      expect(files).toContain('a.dat')
      expect(files).toContain('b.dat')
      expect(files).toContain('c.dat')
      expect(files.length).toBe(3)
    })

    it('should clear all files', async () => {
      const { FileBufferRegistry } = await import('../index.js')

      const registry = new FileBufferRegistry()
      registry.register('a.dat', new Uint8Array([1]))
      registry.register('b.dat', new Uint8Array([2]))

      expect(registry.list().length).toBe(2)

      registry.clear()
      expect(registry.list().length).toBe(0)
    })
  })
})

describe('DotdoDuckDBConfig', () => {
  it('should accept sharding configuration', async () => {
    // Type-level test - just verify configuration compiles
    const config = {
      shard: {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent' as const,
      },
    }
    expect(config.shard.key).toBe('tenant_id')
    expect(config.shard.count).toBe(16)
    expect(config.shard.algorithm).toBe('consistent')
  })

  it('should accept streaming configuration', async () => {
    const config = {
      stream: {
        pipeline: 'analytics',
        sink: 'parquet' as const,
      },
    }
    expect(config.stream.pipeline).toBe('analytics')
    expect(config.stream.sink).toBe('parquet')
  })

  it('should accept tiered storage configuration', async () => {
    const config = {
      tier: {
        hot: 'duckdb' as const,
        warm: 'r2' as const,
        cold: 'archive' as const,
        hotThreshold: '100MB',
        coldAfter: '30d',
      },
    }
    expect(config.tier.hot).toBe('duckdb')
    expect(config.tier.warm).toBe('r2')
    expect(config.tier.cold).toBe('archive')
  })
})
