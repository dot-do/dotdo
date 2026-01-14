/**
 * Tests for withFs Mixin - Filesystem capability integration with Durable Objects
 *
 * This test file covers:
 * - Mixin application to DO classes
 * - $.fs capability access
 * - Lazy initialization through mixin
 * - Configuration options
 * - Capability introspection
 *
 * @module durable-object/mixin.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { withFs, hasFs, getFs, type WithFsContext } from './mixin.js'

// ============================================================================
// Mock SqlStorage and R2Bucket
// ============================================================================

/**
 * Mock SQL result interface
 */
interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SQLite behavior
 */
class MockSqlStorage {
  private files: Map<string, any> = new Map()
  private blobs: Map<string, any> = new Map()
  private nextFileId = 1
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  exec<T = unknown>(sql: string, ...params: unknown[]): MockSqlResult<T> {
    this.execCalls.push({ sql, params })
    const normalizedSql = sql.trim().toLowerCase()

    // Handle CREATE TABLE
    if (normalizedSql.includes('create table')) {
      this.schemaCreated = true
      return this.emptyResult<T>()
    }

    // Handle CREATE INDEX
    if (normalizedSql.includes('create index')) {
      return this.emptyResult<T>()
    }

    // Handle INSERT into files
    if (normalizedSql.includes('insert into files') || normalizedSql.includes('insert or replace into files')) {
      // Check if this has blob_id
      if (normalizedSql.includes('blob_id') && !normalizedSql.includes('link_target')) {
        const entry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as string,
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: params[8] as string | null,
          tier: params[9] as string,
          atime: params[10] as number,
          mtime: params[11] as number,
          ctime: params[12] as number,
          birthtime: params[13] as number,
          nlink: params[14] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
      } else if (!normalizedSql.includes('blob_id') && !normalizedSql.includes('link_target')) {
        // Directory insert (no blob_id)
        const entry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as string,
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: null,
          tier: params[8] as string,
          atime: params[9] as number,
          mtime: params[10] as number,
          ctime: params[11] as number,
          birthtime: params[12] as number,
          nlink: params[13] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
      }
      return this.emptyResult<T>()
    }

    // Handle INSERT into blobs
    if (normalizedSql.includes('insert') && normalizedSql.includes('blobs')) {
      const entry = {
        id: params[0] as string,
        data: params[1] as ArrayBuffer | null,
        size: params[2] as number,
        tier: params[3] as string,
        created_at: params[4] as number,
      }
      this.blobs.set(entry.id, entry)
      return this.emptyResult<T>()
    }

    // Handle SELECT from files WHERE path = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path')) {
      const path = params[0] as string
      const file = this.files.get(path)
      return {
        one: () => (file as T) || null,
        toArray: () => (file ? [file as T] : []),
      }
    }

    // Handle SELECT from files WHERE parent_id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where parent_id')) {
      const parentId = params[0] as number
      const children: any[] = []
      for (const file of this.files.values()) {
        if (file.parent_id === parentId) {
          children.push(file)
        }
      }
      return {
        one: () => (children[0] as T) || null,
        toArray: () => children as T[],
      }
    }

    // Handle SELECT from blobs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from blobs') && normalizedSql.includes('where id')) {
      const id = params[0] as string
      const blob = this.blobs.get(id)
      return {
        one: () => (blob ? ({ data: blob.data } as T) : null),
        toArray: () => (blob ? [{ data: blob.data } as T] : []),
      }
    }

    // Handle UPDATE files
    if (normalizedSql.includes('update files')) {
      const id = params[params.length - 1] as number
      for (const [path, file] of this.files.entries()) {
        if (file.id === id) {
          if (normalizedSql.includes('set blob_id') && normalizedSql.includes('size') && params.length === 6) {
            file.blob_id = params[0] as string
            file.size = params[1] as number
            file.tier = params[2] as string
            file.mtime = params[3] as number
            file.ctime = params[4] as number
          }
          break
        }
      }
      return this.emptyResult<T>()
    }

    return this.emptyResult<T>()
  }

  private emptyResult<T>(): MockSqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  getFile(path: string): any {
    return this.files.get(path)
  }
}

/**
 * Mock R2 bucket for testing
 */
class MockR2Bucket {
  private objects: Map<string, Uint8Array> = new Map()

  async put(key: string, value: Uint8Array | ArrayBuffer | string): Promise<void> {
    if (typeof value === 'string') {
      this.objects.set(key, new TextEncoder().encode(value))
    } else if (value instanceof ArrayBuffer) {
      this.objects.set(key, new Uint8Array(value))
    } else {
      this.objects.set(key, value)
    }
  }

  async get(key: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> {
    const data = this.objects.get(key)
    if (!data) return null
    return {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

// ============================================================================
// Mock Base DO Class
// ============================================================================

/**
 * Mock base DO class that simulates dotdo's DO
 */
class MockBaseDO {
  ctx: {
    storage: {
      sql: MockSqlStorage
    }
  }
  env?: {
    R2?: MockR2Bucket
    ARCHIVE?: MockR2Bucket
    [key: string]: unknown
  }
  $: {
    [key: string]: unknown
  }

  static capabilities: string[] = ['base']

  constructor() {
    this.ctx = {
      storage: {
        sql: new MockSqlStorage(),
      },
    }
    this.env = {
      R2: new MockR2Bucket(),
    }
    this.$ = {
      send: () => {},
      try: () => {},
      do: () => {},
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('withFs Mixin', () => {
  // ==========================================================================
  // Basic Mixin Application Tests
  // ==========================================================================

  describe('mixin application', () => {
    it('should create a new class extending the base', () => {
      const WithFsDO = withFs(MockBaseDO)
      expect(WithFsDO).toBeDefined()
      expect(WithFsDO.prototype).toBeInstanceOf(Object)
    })

    it('should preserve base class prototype chain', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance).toBeInstanceOf(MockBaseDO)
      expect(instance).toBeInstanceOf(WithFsDO)
    })

    it('should add fs to static capabilities array', () => {
      const WithFsDO = withFs(MockBaseDO)

      expect(WithFsDO.capabilities).toContain('fs')
      expect(WithFsDO.capabilities).toContain('base')
    })

    it('should preserve base class static capabilities', () => {
      const WithFsDO = withFs(MockBaseDO)

      expect(WithFsDO.capabilities).toEqual(['base', 'fs'])
    })
  })

  // ==========================================================================
  // $.fs Capability Access Tests
  // ==========================================================================

  describe('$.fs capability access', () => {
    it('should provide $.fs on instance', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should return FsModule instance from $.fs', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
      expect(typeof instance.$.fs.read).toBe('function')
      expect(typeof instance.$.fs.write).toBe('function')
      expect(typeof instance.$.fs.mkdir).toBe('function')
    })

    it('should preserve original $ properties', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.$.send).toBeDefined()
      expect(instance.$.try).toBeDefined()
      expect(instance.$.do).toBeDefined()
    })

    it('should return same FsModule instance on multiple accesses', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      const fs1 = instance.$.fs
      const fs2 = instance.$.fs

      expect(fs1).toBe(fs2)
    })

    it('should include fs in $ ownKeys', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      const keys = Object.keys(instance.$)
      expect(keys).toContain('fs')
    })

    it('should report fs as property of $', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect('fs' in instance.$).toBe(true)
    })
  })

  // ==========================================================================
  // Lazy Initialization Tests
  // ==========================================================================

  describe('lazy initialization', () => {
    it('should not initialize FsModule until accessed', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      // Just creating instance should not trigger SQL
      expect(instance.ctx.storage.sql.schemaCreated).toBe(false)
    })

    it('should initialize FsModule on first fs access', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      // Access fs and trigger initialization
      await instance.$.fs.exists('/')

      expect(instance.ctx.storage.sql.schemaCreated).toBe(true)
    })

    it('should only initialize once across multiple operations', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      await instance.$.fs.exists('/')
      await instance.$.fs.mkdir('/test')

      // Count CREATE TABLE statements
      const createTableCalls = instance.ctx.storage.sql.execCalls.filter((c) =>
        c.sql.toLowerCase().includes('create table')
      )

      expect(createTableCalls.length).toBeLessThanOrEqual(1)
    })
  })

  // ==========================================================================
  // Configuration Options Tests
  // ==========================================================================

  describe('configuration options', () => {
    it('should accept basePath option', () => {
      const WithFsDO = withFs(MockBaseDO, { basePath: '/app' })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should accept hotMaxSize option', () => {
      const WithFsDO = withFs(MockBaseDO, { hotMaxSize: 100 })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should accept defaultMode option', () => {
      const WithFsDO = withFs(MockBaseDO, { defaultMode: 0o600 })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should accept defaultDirMode option', () => {
      const WithFsDO = withFs(MockBaseDO, { defaultDirMode: 0o700 })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should accept custom r2BindingName', () => {
      class CustomEnvDO extends MockBaseDO {
        constructor() {
          super()
          this.env = {
            CUSTOM_R2: new MockR2Bucket(),
          }
        }
      }

      const WithFsDO = withFs(CustomEnvDO, { r2BindingName: 'CUSTOM_R2' })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })

    it('should accept custom archiveBindingName', () => {
      class CustomEnvDO extends MockBaseDO {
        constructor() {
          super()
          this.env = {
            R2: new MockR2Bucket(),
            CUSTOM_ARCHIVE: new MockR2Bucket(),
          }
        }
      }

      const WithFsDO = withFs(CustomEnvDO, { archiveBindingName: 'CUSTOM_ARCHIVE' })
      const instance = new WithFsDO()

      expect(instance.$.fs).toBeDefined()
    })
  })

  // ==========================================================================
  // hasCapability Tests
  // ==========================================================================

  describe('hasCapability method', () => {
    it('should return true for fs capability', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.hasCapability('fs')).toBe(true)
    })

    it('should return false for unknown capability', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.hasCapability('unknown')).toBe(false)
    })
  })

  // ==========================================================================
  // hasFs Helper Function Tests
  // ==========================================================================

  describe('hasFs helper function', () => {
    it('should return true for objects with $.fs', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(hasFs(instance)).toBe(true)
    })

    it('should return false for objects without $.fs', () => {
      const instance = new MockBaseDO()

      expect(hasFs(instance)).toBe(false)
    })

    it('should return false for null $ context', () => {
      const obj = { $: null }

      expect(hasFs(obj as any)).toBe(false)
    })
  })

  // ==========================================================================
  // getFs Helper Function Tests
  // ==========================================================================

  describe('getFs helper function', () => {
    it('should return FsModule for objects with $.fs', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      const fs = getFs(instance)

      expect(fs).toBeDefined()
      expect(typeof fs.read).toBe('function')
    })

    it('should throw for objects without $.fs', () => {
      const instance = new MockBaseDO()

      expect(() => getFs(instance)).toThrow('Filesystem capability is not available')
    })
  })

  // ==========================================================================
  // File Operations Through Mixin Tests
  // ==========================================================================

  describe('file operations through mixin', () => {
    it('should write and read files through $.fs', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      await instance.$.fs.write('/test.txt', 'Hello, World!')
      const content = await instance.$.fs.read('/test.txt', { encoding: 'utf-8' })

      expect(content).toBe('Hello, World!')
    })

    it('should create directories through $.fs', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      await instance.$.fs.mkdir('/mydir')
      const exists = await instance.$.fs.exists('/mydir')

      expect(exists).toBe(true)
    })

    it('should check file existence through $.fs', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      const beforeExists = await instance.$.fs.exists('/test.txt')
      await instance.$.fs.write('/test.txt', 'content')
      const afterExists = await instance.$.fs.exists('/test.txt')

      expect(beforeExists).toBe(false)
      expect(afterExists).toBe(true)
    })
  })

  // ==========================================================================
  // Multiple Instances Tests
  // ==========================================================================

  describe('multiple instances', () => {
    it('should have independent FsModule instances', async () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance1 = new WithFsDO()
      const instance2 = new WithFsDO()

      await instance1.$.fs.write('/file1.txt', 'content1')
      await instance2.$.fs.write('/file2.txt', 'content2')

      // Each instance has its own storage
      expect(instance1.ctx.storage.sql.getFile('/file1.txt')).toBeDefined()
      expect(instance1.ctx.storage.sql.getFile('/file2.txt')).toBeUndefined()
      expect(instance2.ctx.storage.sql.getFile('/file2.txt')).toBeDefined()
      expect(instance2.ctx.storage.sql.getFile('/file1.txt')).toBeUndefined()
    })

    it('should have independent $ contexts', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance1 = new WithFsDO()
      const instance2 = new WithFsDO()

      expect(instance1.$).not.toBe(instance2.$)
      expect(instance1.$.fs).not.toBe(instance2.$.fs)
    })
  })

  // ==========================================================================
  // Chained Mixin Tests
  // ==========================================================================

  describe('chained mixins', () => {
    it('should work with already extended classes', () => {
      class ExtendedDO extends MockBaseDO {
        customMethod() {
          return 'custom'
        }
      }

      const WithFsDO = withFs(ExtendedDO)
      const instance = new WithFsDO()

      expect(instance.customMethod()).toBe('custom')
      expect(instance.$.fs).toBeDefined()
    })

    it('should preserve capabilities from parent classes', () => {
      class ExtendedDO extends MockBaseDO {
        static capabilities = ['base', 'custom']
      }

      const WithFsDO = withFs(ExtendedDO)

      expect(WithFsDO.capabilities).toContain('base')
      expect(WithFsDO.capabilities).toContain('custom')
      expect(WithFsDO.capabilities).toContain('fs')
    })
  })

  // ==========================================================================
  // Proxy Behavior Tests
  // ==========================================================================

  describe('proxy behavior', () => {
    it('should correctly handle getOwnPropertyDescriptor for fs', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      const descriptor = Object.getOwnPropertyDescriptor(instance.$, 'fs')

      expect(descriptor).toBeDefined()
      expect(descriptor?.configurable).toBe(true)
      expect(descriptor?.enumerable).toBe(true)
    })

    it('should bind function properties from original context', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      // Original functions should be bound and callable
      expect(() => instance.$.send).not.toThrow()
      expect(typeof instance.$.send).toBe('function')
    })
  })

  // ==========================================================================
  // Module Name Property Tests
  // ==========================================================================

  describe('FsModule properties through mixin', () => {
    it('should expose FsModule name property', () => {
      const WithFsDO = withFs(MockBaseDO)
      const instance = new WithFsDO()

      expect(instance.$.fs.name).toBe('fs')
    })
  })
})
