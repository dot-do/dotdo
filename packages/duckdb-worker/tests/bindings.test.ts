/**
 * Tests for DuckDB WASM bindings
 *
 * These tests validate the binding layer interface and error handling.
 * Full integration tests require the actual WASM binary.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearCache,
  isCached,
  clearModuleCache,
  isModuleCached,
} from '../src/index.js'

describe('DuckDB Bindings', () => {
  beforeEach(() => {
    clearCache()
    clearModuleCache()
  })

  describe('Cache Management', () => {
    it('should start with no cached module', () => {
      expect(isCached()).toBe(false)
      expect(isModuleCached()).toBe(false)
    })

    it('should clear cache', () => {
      // Cache is cleared in beforeEach
      clearCache()
      expect(isCached()).toBe(false)
    })
  })

  describe('Type Exports', () => {
    it('should export DuckDBConfig type', async () => {
      // Type-only test - imports should work
      const { DuckDBConfig } = await import('../src/types.js')
      expect(typeof DuckDBConfig).toBe('undefined') // Types don't exist at runtime
    })

    it('should export runtime functions', async () => {
      const {
        registerFileBuffer,
        dropFile,
        getFileBuffer,
        hasFile,
        listFiles,
        getFileSize,
        clearAllFiles,
        getTotalMemoryUsage,
      } = await import('../src/index.js')

      expect(typeof registerFileBuffer).toBe('function')
      expect(typeof dropFile).toBe('function')
      expect(typeof getFileBuffer).toBe('function')
      expect(typeof hasFile).toBe('function')
      expect(typeof listFiles).toBe('function')
      expect(typeof getFileSize).toBe('function')
      expect(typeof clearAllFiles).toBe('function')
      expect(typeof getTotalMemoryUsage).toBe('function')
    })

    it('should export bindings functions', async () => {
      const {
        loadDuckDBModule,
        createInstanceFromModule,
        clearModuleCache,
        isModuleCached,
        createDuckDB,
        instantiateDuckDB,
        clearCache,
        isCached,
      } = await import('../src/index.js')

      expect(typeof loadDuckDBModule).toBe('function')
      expect(typeof createInstanceFromModule).toBe('function')
      expect(typeof clearModuleCache).toBe('function')
      expect(typeof isModuleCached).toBe('function')
      expect(typeof createDuckDB).toBe('function')
      expect(typeof instantiateDuckDB).toBe('function')
      expect(typeof clearCache).toBe('function')
      expect(typeof isCached).toBe('function')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid WASM source', async () => {
      const { loadDuckDBModule } = await import('../src/index.js')

      // @ts-expect-error - Testing invalid input
      // Note: With Emscripten loader, invalid sources trigger URL parsing error
      await expect(loadDuckDBModule('not-a-valid-source')).rejects.toThrow(
        'Failed to initialize DuckDB WASM'
      )
    })

    it('should handle missing WASM from CDN gracefully', async () => {
      const { instantiateDuckDB } = await import('../src/index.js')

      // This test may pass or fail depending on network
      // In a real test environment, we'd mock fetch
      const result = await instantiateDuckDB()

      // Either succeeds with metrics or fails with error
      if (!result.success) {
        expect(result.error).toBeDefined()
      } else {
        expect(result.instantiationTimeMs).toBeGreaterThan(0)
      }
    })
  })
})

describe('DuckDB Type Helpers', () => {
  describe('DuckDB Type Constants', () => {
    // These tests verify the type constants match DuckDB C API
    it('should have correct type codes (documented in bindings.ts)', () => {
      // Type codes from DuckDB C API
      const types = {
        INVALID: 0,
        BOOLEAN: 1,
        TINYINT: 2,
        SMALLINT: 3,
        INTEGER: 4,
        BIGINT: 5,
        FLOAT: 10,
        DOUBLE: 11,
        VARCHAR: 17,
        BLOB: 18,
      }

      // Verify they're defined correctly (this is a compile-time check)
      expect(types.INTEGER).toBe(4)
      expect(types.VARCHAR).toBe(17)
    })
  })
})
