/**
 * Tests for file buffer isolation between DuckDB instances
 *
 * These tests verify that:
 * 1. Each DuckDB instance has its own file buffer registry
 * 2. Closing one instance does NOT affect files in other instances
 * 3. The FileBufferRegistry class provides proper instance isolation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FileBufferRegistry,
  clearAllFiles,
  registerFileBuffer,
  hasFile,
  listFiles,
} from '../src/runtime.js'

describe('FileBufferRegistry Class', () => {
  describe('Instance Isolation', () => {
    it('should create isolated registries', () => {
      const registry1 = new FileBufferRegistry()
      const registry2 = new FileBufferRegistry()

      // Register file in registry1 only
      registry1.register('file1.parquet', new Uint8Array([1, 2, 3]))

      // registry1 should have the file
      expect(registry1.has('file1.parquet')).toBe(true)
      expect(registry1.list()).toContain('file1.parquet')

      // registry2 should NOT have the file
      expect(registry2.has('file1.parquet')).toBe(false)
      expect(registry2.list()).not.toContain('file1.parquet')
    })

    it('should allow same filename in different registries', () => {
      const registry1 = new FileBufferRegistry()
      const registry2 = new FileBufferRegistry()

      // Register same filename with different data
      registry1.register('data.bin', new Uint8Array([1, 2, 3]))
      registry2.register('data.bin', new Uint8Array([4, 5, 6, 7, 8]))

      // Each should have its own copy
      expect(registry1.size('data.bin')).toBe(3)
      expect(registry2.size('data.bin')).toBe(5)

      // Verify contents are different
      expect(Array.from(registry1.get('data.bin')!)).toEqual([1, 2, 3])
      expect(Array.from(registry2.get('data.bin')!)).toEqual([4, 5, 6, 7, 8])
    })

    it('should NOT affect other registries when clearing', () => {
      const registry1 = new FileBufferRegistry()
      const registry2 = new FileBufferRegistry()

      // Register files in both
      registry1.register('file-a.bin', new Uint8Array([1]))
      registry1.register('file-b.bin', new Uint8Array([2]))
      registry2.register('file-c.bin', new Uint8Array([3]))
      registry2.register('file-d.bin', new Uint8Array([4]))

      // Clear registry1
      registry1.clear()

      // registry1 should be empty
      expect(registry1.list()).toHaveLength(0)
      expect(registry1.fileCount).toBe(0)

      // registry2 should still have its files
      expect(registry2.list()).toHaveLength(2)
      expect(registry2.has('file-c.bin')).toBe(true)
      expect(registry2.has('file-d.bin')).toBe(true)
    })

    it('should NOT affect other registries when dropping files', () => {
      const registry1 = new FileBufferRegistry()
      const registry2 = new FileBufferRegistry()

      // Register same-named file in both
      registry1.register('shared-name.parquet', new Uint8Array([1, 2]))
      registry2.register('shared-name.parquet', new Uint8Array([3, 4]))

      // Drop from registry1
      const dropped = registry1.drop('shared-name.parquet')
      expect(dropped).toBe(true)

      // registry1 should not have the file
      expect(registry1.has('shared-name.parquet')).toBe(false)

      // registry2 should still have its file
      expect(registry2.has('shared-name.parquet')).toBe(true)
      expect(Array.from(registry2.get('shared-name.parquet')!)).toEqual([3, 4])
    })
  })

  describe('Registry Methods', () => {
    let registry: FileBufferRegistry

    beforeEach(() => {
      registry = new FileBufferRegistry()
    })

    it('should register and retrieve buffers', () => {
      const data = new Uint8Array([10, 20, 30])
      registry.register('test.bin', data)

      expect(registry.has('test.bin')).toBe(true)
      expect(registry.size('test.bin')).toBe(3)
      expect(Array.from(registry.get('test.bin')!)).toEqual([10, 20, 30])
    })

    it('should handle ArrayBuffer input', () => {
      const buffer = new ArrayBuffer(100)
      registry.register('array-buffer.bin', buffer)

      expect(registry.has('array-buffer.bin')).toBe(true)
      expect(registry.size('array-buffer.bin')).toBe(100)
      expect(registry.get('array-buffer.bin')).toBeInstanceOf(Uint8Array)
    })

    it('should list all files', () => {
      registry.register('a.bin', new Uint8Array([1]))
      registry.register('b.bin', new Uint8Array([2]))
      registry.register('c.bin', new Uint8Array([3]))

      const files = registry.list()
      expect(files).toHaveLength(3)
      expect(files).toContain('a.bin')
      expect(files).toContain('b.bin')
      expect(files).toContain('c.bin')
    })

    it('should calculate total memory usage', () => {
      registry.register('a.bin', new Uint8Array(100))
      registry.register('b.bin', new Uint8Array(200))
      registry.register('c.bin', new Uint8Array(300))

      expect(registry.totalMemoryUsage()).toBe(600)
    })

    it('should track file count', () => {
      expect(registry.fileCount).toBe(0)

      registry.register('a.bin', new Uint8Array([1]))
      expect(registry.fileCount).toBe(1)

      registry.register('b.bin', new Uint8Array([2]))
      expect(registry.fileCount).toBe(2)

      registry.drop('a.bin')
      expect(registry.fileCount).toBe(1)

      registry.clear()
      expect(registry.fileCount).toBe(0)
    })

    it('should return -1 for non-existent file size', () => {
      expect(registry.size('missing.bin')).toBe(-1)
    })

    it('should return undefined for non-existent file buffer', () => {
      expect(registry.get('missing.bin')).toBeUndefined()
    })

    it('should return false when dropping non-existent file', () => {
      expect(registry.drop('missing.bin')).toBe(false)
    })
  })
})

describe('Global Registry Independence', () => {
  beforeEach(() => {
    clearAllFiles()
  })

  it('should keep global and instance registries separate', () => {
    const instanceRegistry = new FileBufferRegistry()

    // Register in global using imported functions
    registerFileBuffer('global-file.bin', new Uint8Array([1, 2, 3]))

    // Register in instance
    instanceRegistry.register('instance-file.bin', new Uint8Array([4, 5, 6]))

    // Global should only have global file
    expect(hasFile('global-file.bin')).toBe(true)
    expect(hasFile('instance-file.bin')).toBe(false)
    expect(listFiles()).toContain('global-file.bin')
    expect(listFiles()).not.toContain('instance-file.bin')

    // Instance should only have instance file
    expect(instanceRegistry.has('instance-file.bin')).toBe(true)
    expect(instanceRegistry.has('global-file.bin')).toBe(false)
    expect(instanceRegistry.list()).toContain('instance-file.bin')
    expect(instanceRegistry.list()).not.toContain('global-file.bin')
  })

  it('should not affect instance registries when clearing global', () => {
    const instanceRegistry = new FileBufferRegistry()
    instanceRegistry.register('important-data.bin', new Uint8Array([1, 2, 3]))

    // Clear global registry
    clearAllFiles()

    // Instance registry should be unaffected
    expect(instanceRegistry.has('important-data.bin')).toBe(true)
    expect(instanceRegistry.fileCount).toBe(1)
  })
})

describe('Concurrent Instance Simulation', () => {
  it('should handle multiple concurrent instances without interference', () => {
    // Simulate multiple DuckDB instances running concurrently
    const instances = Array.from({ length: 5 }, (_, i) => ({
      id: `instance-${i}`,
      registry: new FileBufferRegistry(),
    }))

    // Each instance registers its own files
    for (const instance of instances) {
      instance.registry.register(
        `${instance.id}-data.parquet`,
        new Uint8Array([instance.id.charCodeAt(9)]) // Use instance number as data
      )
      instance.registry.register(
        `${instance.id}-temp.bin`,
        new Uint8Array(100)
      )
    }

    // Close half of the instances (simulate db.close())
    for (let i = 0; i < 3; i++) {
      instances[i].registry.clear()
    }

    // Verify closed instances have no files
    for (let i = 0; i < 3; i++) {
      expect(instances[i].registry.fileCount).toBe(0)
      expect(instances[i].registry.list()).toHaveLength(0)
    }

    // Verify remaining instances still have their files
    for (let i = 3; i < 5; i++) {
      expect(instances[i].registry.fileCount).toBe(2)
      expect(instances[i].registry.has(`instance-${i}-data.parquet`)).toBe(true)
      expect(instances[i].registry.has(`instance-${i}-temp.bin`)).toBe(true)
    }
  })

  it('should isolate file operations between instances', () => {
    const instance1 = new FileBufferRegistry()
    const instance2 = new FileBufferRegistry()

    // Both instances use the same filename (common scenario)
    const parquetName = 'users.parquet'

    // Instance 1 loads user data
    instance1.register(parquetName, new Uint8Array([1, 2, 3, 4, 5]))

    // Instance 2 loads different user data
    instance2.register(parquetName, new Uint8Array([10, 20, 30]))

    // Verify data is correctly isolated
    expect(instance1.size(parquetName)).toBe(5)
    expect(instance2.size(parquetName)).toBe(3)

    // Instance 1 finishes and closes
    instance1.clear()

    // Instance 2 should still be able to access its data
    expect(instance2.has(parquetName)).toBe(true)
    expect(instance2.size(parquetName)).toBe(3)
    expect(Array.from(instance2.get(parquetName)!)).toEqual([10, 20, 30])
  })
})
