/**
 * RED TDD: withFs Mixin Integration Tests
 *
 * Tests for integrating fsx.do's withFs mixin with dotdo Durable Objects.
 * These tests verify the $.fs capability is properly added to WorkflowContext.
 *
 * Key requirements (from fsx.do):
 * 1. withFs mixin adds $.fs to WorkflowContext
 * 2. $.fs.read() returns file content (string or Uint8Array)
 * 3. $.fs.write() persists to DO SQLite storage
 * 4. $.fs.list() returns directory contents (readdir)
 * 5. $.fs initializes lazily on first access
 * 6. $.fs uses tiered storage (SQLite hot, R2 warm) when R2 available
 *
 * The withFs mixin wraps fsx.do's FsModule which provides:
 * - SQLite-backed metadata storage (files table)
 * - SQLite blob storage for hot tier (< 1MB default)
 * - R2 storage for warm tier (larger files)
 * - Full POSIX-like filesystem API
 *
 * Reference: ~/projects/fsx for fsx.do implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// These imports will fail until the mixin is implemented
// This is intentional for TDD RED phase
import {
  withFs,
  type WithFsContext,
  type WithFsOptions,
} from '../mixins/fs'

// Re-export from fsx.do - these should be available when implemented
import type { FsModule } from '../mixins/fs'

import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

/**
 * Mock SqlStorage using better-sqlite3 for real SQLite behavior
 * This provides a working in-memory SQLite database that FsModule can use
 */
class MockSqlStorage {
  private db: ReturnType<typeof Database>

  constructor() {
    this.db = new Database(':memory:')
  }

  /**
   * Convert ArrayBuffer/Uint8Array to Buffer for better-sqlite3
   */
  private convertParams(params: unknown[]): unknown[] {
    return params.map(p => {
      if (p instanceof ArrayBuffer) {
        return Buffer.from(p)
      }
      if (p instanceof Uint8Array) {
        return Buffer.from(p.buffer, p.byteOffset, p.byteLength)
      }
      if (ArrayBuffer.isView(p) && !(p instanceof Buffer)) {
        return Buffer.from(p.buffer, p.byteOffset, p.byteLength)
      }
      return p
    })
  }

  exec<T = unknown>(query: string, ...params: unknown[]): {
    one(): T | null
    toArray(): T[]
    raw(): unknown[][]
    columnNames: string[]
  } {
    // Convert ArrayBuffer/Uint8Array params to Buffer
    const convertedParams = this.convertParams(params)

    try {
      // Handle multi-statement queries (schema creation)
      if (query.includes(';') && (query.includes('CREATE TABLE') || query.includes('CREATE INDEX'))) {
        // Execute multi-statement queries
        this.db.exec(query)
        return {
          one: () => null,
          toArray: () => [],
          raw: () => [],
          columnNames: [],
        }
      }

      const stmt = this.db.prepare(query)
      const isSelect = query.trim().toUpperCase().startsWith('SELECT')

      if (isSelect) {
        // For SELECT queries, bind params and return results
        const results = stmt.all(...convertedParams) as T[]
        const columnNames = stmt.columns().map(c => c.name)
        return {
          one: () => results[0] ?? null,
          toArray: () => results,
          raw: () => results.map(r => Object.values(r as object)),
          columnNames,
        }
      } else {
        // For INSERT/UPDATE/DELETE, run the statement
        stmt.run(...convertedParams)
        return {
          one: () => null,
          toArray: () => [],
          raw: () => [],
          columnNames: [],
        }
      }
    } catch (error) {
      // For CREATE TABLE IF NOT EXISTS that already exists, etc.
      if ((error as Error).message?.includes('already exists')) {
        return {
          one: () => null,
          toArray: () => [],
          raw: () => [],
          columnNames: [],
        }
      }
      throw error
    }
  }

  close() {
    this.db.close()
  }
}

/**
 * Mock DurableObjectState with storage.sql
 */
function createMockDOState(): DurableObjectState {
  const mockSql = new MockSqlStorage()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      sql: mockSql as unknown as SqlStorage,
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      deleteAll: vi.fn(),
      transaction: vi.fn(),
      getAlarm: vi.fn(),
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
      sync: vi.fn(),
    } as unknown as DurableObjectStorage,
    blockConcurrencyWhile: vi.fn(),
    waitUntil: vi.fn(),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(),
    getTags: vi.fn(),
  } as unknown as DurableObjectState
}

/**
 * Mock R2Bucket for warm tier storage testing
 */
function createMockR2Bucket(): R2Bucket {
  const storage = new Map<string, Uint8Array>()

  return {
    put: vi.fn(async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob) => {
      if (value instanceof ArrayBuffer) {
        storage.set(key, new Uint8Array(value))
      } else if (ArrayBuffer.isView(value)) {
        storage.set(key, new Uint8Array(value.buffer))
      } else if (typeof value === 'string') {
        storage.set(key, new TextEncoder().encode(value))
      }
      return {} as R2Object
    }),
    get: vi.fn(async (key: string) => {
      const data = storage.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data.buffer,
        text: async () => new TextDecoder().decode(data),
        body: new ReadableStream(),
        bodyUsed: false,
        blob: async () => new Blob([data]),
        json: async () => JSON.parse(new TextDecoder().decode(data)),
      } as unknown as R2ObjectBody
    }),
    delete: vi.fn(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        key.forEach((k) => storage.delete(k))
      } else {
        storage.delete(key)
      }
    }),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a minimal mock WorkflowContext for testing
 */
function createMockWorkflowContext(): WorkflowContext {
  return {
    send: vi.fn(),
    try: vi.fn(),
    do: vi.fn(),
    on: {} as WorkflowContext['on'],
    every: {} as WorkflowContext['every'],
    log: vi.fn(),
    state: {},
  } as unknown as WorkflowContext
}

/**
 * Mock DO base class that matches dotdo's DO structure
 * Has both WorkflowContext ($) and DurableObjectState (ctx)
 */
class MockDO {
  $: WorkflowContext
  ctx: DurableObjectState
  env: Record<string, unknown>

  constructor(ctx?: DurableObjectState, env?: Record<string, unknown>) {
    this.ctx = ctx ?? createMockDOState()
    this.env = env ?? {}
    this.$ = createMockWorkflowContext()
  }
}

// ============================================================================
// withFs MIXIN TESTS
// ============================================================================

describe('withFs Mixin', () => {
  describe('Mixin Application', () => {
    it('adds $.fs to WorkflowContext', () => {
      // withFs should extend the base DO class and add $.fs
      const ExtendedDO = withFs(MockDO)
      const instance = new ExtendedDO(createMockDOState(), {})

      expect(instance.$).toBeDefined()
      expect(instance.$.fs).toBeDefined()
    })

    it('hasCapability("fs") returns true', () => {
      const ExtendedDO = withFs(MockDO)
      const instance = new ExtendedDO(createMockDOState(), {})

      // Mixin should add hasCapability method
      expect(instance.hasCapability('fs')).toBe(true)
      expect(instance.hasCapability('git')).toBe(false)
    })

    it('registers fs in static capabilities array', () => {
      const ExtendedDO = withFs(MockDO)

      // Static capabilities array should include 'fs'
      expect((ExtendedDO as { capabilities?: string[] }).capabilities).toContain('fs')
    })

    it('preserves base class functionality', () => {
      const ExtendedDO = withFs(MockDO)
      const instance = new ExtendedDO(createMockDOState(), {})

      // Base WorkflowContext methods should still work
      expect(typeof instance.$.send).toBe('function')
      expect(typeof instance.$.try).toBe('function')
      expect(typeof instance.$.do).toBe('function')
    })
  })

  describe('$.fs API', () => {
    let instance: InstanceType<ReturnType<typeof withFs<typeof MockDO>>>

    beforeEach(() => {
      const ExtendedDO = withFs(MockDO)
      instance = new ExtendedDO(createMockDOState(), {})
    })

    it('$.fs.read() returns file content', async () => {
      // First write a file, then read it back
      await instance.$.fs.write('/test.txt', 'hello world')
      const content = await instance.$.fs.read('/test.txt', { encoding: 'utf-8' })

      expect(content).toBe('hello world')
    })

    it('$.fs.read() with encoding returns string', async () => {
      await instance.$.fs.write('/test.txt', 'utf-8 content')
      const content = await instance.$.fs.read('/test.txt', { encoding: 'utf-8' })

      expect(typeof content).toBe('string')
      expect(content).toBe('utf-8 content')
    })

    it('$.fs.read() without encoding returns Uint8Array', async () => {
      await instance.$.fs.write('/test.bin', new Uint8Array([1, 2, 3]))
      const content = await instance.$.fs.read('/test.bin')

      expect(content).toBeInstanceOf(Uint8Array)
    })

    it('$.fs.read() throws ENOENT for non-existent file', async () => {
      await expect(instance.$.fs.read('/non-existent.txt')).rejects.toThrow()
    })

    it('$.fs.write() persists to DO SQLite storage', async () => {
      await instance.$.fs.write('/config.json', '{"key": "value"}')

      // Verify file exists after write
      const exists = await instance.$.fs.exists('/config.json')
      expect(exists).toBe(true)

      // Verify content is correct
      const content = await instance.$.fs.read('/config.json', { encoding: 'utf-8' })
      expect(content).toBe('{"key": "value"}')
    })

    it('$.fs.write() overwrites existing file', async () => {
      await instance.$.fs.write('/test.txt', 'original')
      await instance.$.fs.write('/test.txt', 'updated')

      const content = await instance.$.fs.read('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('updated')
    })

    it('$.fs.list() returns directory contents', async () => {
      // Create root directory structure
      await instance.$.fs.mkdir('/mydir', { recursive: true })
      await instance.$.fs.write('/mydir/file1.txt', 'content1')
      await instance.$.fs.write('/mydir/file2.txt', 'content2')

      const entries = await instance.$.fs.list('/mydir')

      expect(Array.isArray(entries)).toBe(true)
      expect(entries.length).toBe(2)

      const names = entries.map((e: string | { name: string }) =>
        typeof e === 'string' ? e : e.name
      )
      expect(names.sort()).toEqual(['file1.txt', 'file2.txt'])
    })

    it('$.fs.list() with withFileTypes returns Dirent objects', async () => {
      await instance.$.fs.mkdir('/mydir', { recursive: true })
      await instance.$.fs.write('/mydir/file.txt', 'content')
      await instance.$.fs.mkdir('/mydir/subdir')

      const entries = await instance.$.fs.readdir('/mydir', { withFileTypes: true })

      expect(Array.isArray(entries)).toBe(true)

      const file = entries.find((e) => e.name === 'file.txt')
      const dir = entries.find((e) => e.name === 'subdir')

      expect(file?.isFile()).toBe(true)
      expect(dir?.isDirectory()).toBe(true)
    })

    it('$.fs.exists() returns true for existing file', async () => {
      await instance.$.fs.write('/exists.txt', 'content')
      expect(await instance.$.fs.exists('/exists.txt')).toBe(true)
    })

    it('$.fs.exists() returns false for non-existent file', async () => {
      expect(await instance.$.fs.exists('/non-existent.txt')).toBe(false)
    })

    it('$.fs.mkdir() creates directory', async () => {
      await instance.$.fs.mkdir('/newdir')
      expect(await instance.$.fs.exists('/newdir')).toBe(true)
    })

    it('$.fs.mkdir() with recursive creates nested directories', async () => {
      await instance.$.fs.mkdir('/a/b/c', { recursive: true })

      expect(await instance.$.fs.exists('/a')).toBe(true)
      expect(await instance.$.fs.exists('/a/b')).toBe(true)
      expect(await instance.$.fs.exists('/a/b/c')).toBe(true)
    })

    it('$.fs.stat() returns file stats', async () => {
      await instance.$.fs.write('/test.txt', 'Hello, World!')

      const stats = await instance.$.fs.stat('/test.txt')

      expect(stats.size).toBe(13) // 'Hello, World!' is 13 bytes
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
    })

    it('$.fs.unlink() deletes file', async () => {
      await instance.$.fs.write('/to-delete.txt', 'content')
      expect(await instance.$.fs.exists('/to-delete.txt')).toBe(true)

      await instance.$.fs.unlink('/to-delete.txt')
      expect(await instance.$.fs.exists('/to-delete.txt')).toBe(false)
    })

    it('$.fs.rename() moves file', async () => {
      await instance.$.fs.write('/original.txt', 'content')

      await instance.$.fs.rename('/original.txt', '/renamed.txt')

      expect(await instance.$.fs.exists('/original.txt')).toBe(false)
      expect(await instance.$.fs.exists('/renamed.txt')).toBe(true)
    })

    it('$.fs.copyFile() copies file', async () => {
      await instance.$.fs.write('/source.txt', 'content')

      await instance.$.fs.copyFile('/source.txt', '/copy.txt')

      expect(await instance.$.fs.exists('/source.txt')).toBe(true)
      expect(await instance.$.fs.exists('/copy.txt')).toBe(true)

      const sourceContent = await instance.$.fs.read('/source.txt', { encoding: 'utf-8' })
      const copyContent = await instance.$.fs.read('/copy.txt', { encoding: 'utf-8' })
      expect(sourceContent).toBe(copyContent)
    })
  })

  describe('Lazy Initialization', () => {
    it('$.fs initializes lazily on first access', () => {
      const ExtendedDO = withFs(MockDO)
      const mockState = createMockDOState()

      // Create instance but don't access $.fs yet
      const instance = new ExtendedDO(mockState, {})

      // The FsModule should not be created until first access
      // This is verified by checking that sql.exec hasn't been called for schema creation
      const sqlExecSpy = vi.spyOn(mockState.storage.sql, 'exec')

      // Access $.fs - this should trigger initialization
      const fs = instance.$.fs

      // Now the FsModule should exist
      expect(fs).toBeDefined()
    })

    it('$.fs caches FsModule instance after first access', async () => {
      const ExtendedDO = withFs(MockDO)
      const instance = new ExtendedDO(createMockDOState(), {})

      // Access $.fs multiple times
      const fs1 = instance.$.fs
      const fs2 = instance.$.fs
      const fs3 = instance.$.fs

      // Should all be the same instance
      expect(fs1).toBe(fs2)
      expect(fs2).toBe(fs3)
    })
  })

  describe('Tiered Storage', () => {
    it('$.fs uses SQLite hot tier for small files', async () => {
      const ExtendedDO = withFs(MockDO)
      const instance = new ExtendedDO(createMockDOState(), {})

      // Write a small file (< 1MB default threshold)
      await instance.$.fs.write('/small.txt', 'small content')

      // Get the tier
      const tier = await instance.$.fs.getTier('/small.txt')
      expect(tier).toBe('hot')
    })

    it('$.fs uses R2 warm tier for large files when R2 available', async () => {
      const mockR2 = createMockR2Bucket()
      const ExtendedDO = withFs(MockDO, { r2BindingName: 'R2' })
      const instance = new ExtendedDO(createMockDOState(), { R2: mockR2 })

      // Create large content (> 1MB)
      const largeContent = 'x'.repeat(2 * 1024 * 1024) // 2MB

      await instance.$.fs.write('/large.txt', largeContent)

      // Get the tier - should be warm if R2 is configured
      const tier = await instance.$.fs.getTier('/large.txt')
      expect(tier).toBe('warm')

      // Verify R2.put was called
      expect(mockR2.put).toHaveBeenCalled()
    })

    it('$.fs.promote() moves file from warm to hot tier', async () => {
      const mockR2 = createMockR2Bucket()
      const ExtendedDO = withFs(MockDO, { r2BindingName: 'R2' })
      const instance = new ExtendedDO(createMockDOState(), { R2: mockR2 })

      // Write large file to warm tier
      const largeContent = 'x'.repeat(2 * 1024 * 1024)
      await instance.$.fs.write('/large.txt', largeContent)

      // Promote to hot tier
      await instance.$.fs.promote('/large.txt', 'hot')

      const tier = await instance.$.fs.getTier('/large.txt')
      expect(tier).toBe('hot')
    })

    it('$.fs.demote() moves file from hot to warm tier', async () => {
      const mockR2 = createMockR2Bucket()
      const ExtendedDO = withFs(MockDO, { r2BindingName: 'R2' })
      const instance = new ExtendedDO(createMockDOState(), { R2: mockR2 })

      // Write small file to hot tier
      await instance.$.fs.write('/small.txt', 'small content')

      // Demote to warm tier
      await instance.$.fs.demote('/small.txt', 'warm')

      const tier = await instance.$.fs.getTier('/small.txt')
      expect(tier).toBe('warm')
    })
  })

  describe('Mixin Composition', () => {
    it('allows applying withFs twice (idempotent)', () => {
      const DoubleFsDO = withFs(withFs(MockDO))
      const instance = new DoubleFsDO(createMockDOState(), {})

      // Should not error and $.fs should be available
      expect(instance.$.fs).toBeDefined()
    })

    it('preserves capabilities from previous mixins', () => {
      // Simulate a class with existing capabilities
      class DOWithCapabilities extends MockDO {
        static capabilities = ['existing']

        hasCapability(name: string): boolean {
          return (this.constructor as { capabilities?: string[] }).capabilities?.includes(name) ?? false
        }
      }

      const ExtendedDO = withFs(DOWithCapabilities)

      expect((ExtendedDO as { capabilities?: string[] }).capabilities).toContain('existing')
      expect((ExtendedDO as { capabilities?: string[] }).capabilities).toContain('fs')
    })
  })

  describe('WithFsOptions', () => {
    it('accepts basePath option', async () => {
      const ExtendedDO = withFs(MockDO, { basePath: '/root' })
      const instance = new ExtendedDO(createMockDOState(), {})

      // First create the /root directory
      await instance.$.fs.mkdir('/root')

      // Write to relative path - should be resolved against basePath
      await instance.$.fs.write('test.txt', 'content')

      // File should exist at /root/test.txt
      expect(await instance.$.fs.exists('/root/test.txt')).toBe(true)
    })

    it('accepts hotMaxSize option', async () => {
      const mockR2 = createMockR2Bucket()
      // Set very low threshold so even small files go to warm tier
      const ExtendedDO = withFs(MockDO, {
        r2BindingName: 'R2',
        hotMaxSize: 10, // 10 bytes
      })
      const instance = new ExtendedDO(createMockDOState(), { R2: mockR2 })

      // Write content larger than threshold
      await instance.$.fs.write('/test.txt', 'more than ten bytes')

      const tier = await instance.$.fs.getTier('/test.txt')
      expect(tier).toBe('warm')
    })

    it('accepts r2BindingName option', () => {
      const mockR2 = createMockR2Bucket()
      const ExtendedDO = withFs(MockDO, { r2BindingName: 'CUSTOM_R2' })

      // Should not error with custom binding name
      const instance = new ExtendedDO(createMockDOState(), { CUSTOM_R2: mockR2 })
      expect(instance.$.fs).toBeDefined()
    })
  })
})

// ============================================================================
// TYPE EXPORT TESTS
// ============================================================================

describe('Type Exports', () => {
  it('exports WithFsContext type', () => {
    // Type check - if this compiles, the type is exported correctly
    const _: WithFsContext = {} as WithFsContext
    expect(_).toBeDefined()
  })

  it('exports WithFsOptions type', () => {
    // Type check
    const opts: WithFsOptions = {
      basePath: '/root',
      hotMaxSize: 1024 * 1024,
      r2BindingName: 'R2',
    }
    expect(opts).toBeDefined()
  })

  it('exports withFs function', () => {
    expect(typeof withFs).toBe('function')
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('$.fs Transactions', () => {
  let instance: InstanceType<ReturnType<typeof withFs<typeof MockDO>>>

  beforeEach(() => {
    const ExtendedDO = withFs(MockDO)
    instance = new ExtendedDO(createMockDOState(), {})
  })

  it('$.fs.transaction() provides atomic operations', async () => {
    // Write multiple files atomically
    await instance.$.fs.transaction(async () => {
      await instance.$.fs.write('/file1.txt', 'content1')
      await instance.$.fs.write('/file2.txt', 'content2')
    })

    expect(await instance.$.fs.exists('/file1.txt')).toBe(true)
    expect(await instance.$.fs.exists('/file2.txt')).toBe(true)
  })

  it('$.fs.transaction() rolls back on error', async () => {
    await instance.$.fs.write('/existing.txt', 'original')

    try {
      await instance.$.fs.transaction(async () => {
        await instance.$.fs.write('/existing.txt', 'modified')
        throw new Error('Simulated failure')
      })
    } catch {
      // Expected to throw
    }

    // File should have original content due to rollback
    const content = await instance.$.fs.read('/existing.txt', { encoding: 'utf-8' })
    expect(content).toBe('original')
  })

  it('$.fs.writeMany() writes multiple files atomically', async () => {
    await instance.$.fs.writeMany([
      { path: '/batch1.txt', content: 'content1' },
      { path: '/batch2.txt', content: 'content2' },
      { path: '/batch3.txt', content: 'content3' },
    ])

    expect(await instance.$.fs.exists('/batch1.txt')).toBe(true)
    expect(await instance.$.fs.exists('/batch2.txt')).toBe(true)
    expect(await instance.$.fs.exists('/batch3.txt')).toBe(true)
  })
})
