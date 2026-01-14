import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  withFs,
  hasFsCapability,
  FsModule,
  type WithFsOptions,
  type SqlStorage,
  type R2BucketLike,
} from '../../src/do/withFs'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simple base class for testing mixins.
 */
class BaseClass {
  name: string

  constructor(name: string) {
    this.name = name
  }

  greet(): string {
    return `Hello, ${this.name}!`
  }
}

/**
 * Base class with environment-like properties (simulates DO).
 */
class DOLikeClass {
  env: Record<string, unknown>
  ctx: { storage?: { sql?: SqlStorage } }
  state: { storage?: { sql?: SqlStorage } }
  $?: Record<string, unknown>

  constructor(
    env: Record<string, unknown> = {},
    ctx: { storage?: { sql?: SqlStorage } } = {},
    state: { storage?: { sql?: SqlStorage } } = {},
    $?: Record<string, unknown>
  ) {
    this.env = env
    this.ctx = ctx
    this.state = state
    this.$ = $
  }
}

/**
 * Create a mock SQL storage for testing.
 */
function createMockSqlStorage(): SqlStorage {
  const tables: Map<string, unknown[]> = new Map()
  let idCounter = 1

  return {
    exec<T = unknown>(sql: string, ...params: unknown[]) {
      const sqlLower = sql.toLowerCase().trim()

      if (sqlLower.startsWith('create table') || sqlLower.startsWith('create index')) {
        return { one: () => null, toArray: () => [] }
      }

      if (sqlLower.startsWith('insert')) {
        const match = sql.match(/INSERT.*INTO\s+(\w+)/i)
        const tableName = match?.[1] || 'unknown'
        if (!tables.has(tableName)) {
          tables.set(tableName, [])
        }
        const table = tables.get(tableName)!

        // Parse column values based on tableName
        if (tableName === 'files') {
          const id = idCounter++
          const now = Date.now()
          // Simplified file record parsing
          const row = {
            id,
            path: params[0] as string,
            name: params[1] as string,
            parent_id: params[2],
            type: params[3] as string,
            mode: params[4] as number,
            uid: params[5] as number,
            gid: params[6] as number,
            size: params[7] as number,
            blob_id: params[8] as string | null,
            tier: params[9] as string,
            atime: params[10] as number || now,
            mtime: params[11] as number || now,
            ctime: params[12] as number || now,
            birthtime: params[13] as number || now,
            nlink: params[14] as number || 1,
            link_target: null,
          }
          table.push(row)
          return { one: () => row as T, toArray: () => [row as T] }
        } else if (tableName === 'blobs') {
          const row = {
            id: params[0] as string,
            data: params[1] as ArrayBuffer | null,
            size: params[2] as number,
            tier: params[3] as string,
            created_at: params[4] as number,
          }
          table.push(row)
          return { one: () => row as T, toArray: () => [row as T] }
        }

        const row = { id: idCounter++, params }
        table.push(row)
        return { one: () => row as T, toArray: () => [row as T] }
      }

      if (sqlLower.startsWith('select')) {
        const match = sql.match(/FROM\s+(\w+)/i)
        const tableName = match?.[1] || 'unknown'
        const table = tables.get(tableName) || []

        // Handle WHERE clause if present
        if (sql.includes('WHERE')) {
          const pathMatch = sql.match(/path\s*=\s*\?/i)
          if (pathMatch && params[0]) {
            const path = params[0] as string
            const found = table.find((row: any) => row.path === path)
            return { one: () => (found as T) || null, toArray: () => found ? [found as T] : [] }
          }

          const idMatch = sql.match(/id\s*=\s*\?/i)
          if (idMatch && params[0]) {
            const id = params[0] as number
            const found = table.find((row: any) => row.id === id)
            return { one: () => (found as T) || null, toArray: () => found ? [found as T] : [] }
          }

          const parentIdMatch = sql.match(/parent_id\s*=\s*\?/i)
          if (parentIdMatch) {
            const parentId = params[0] as number
            const found = table.filter((row: any) => row.parent_id === parentId)
            return { one: () => (found[0] as T) || null, toArray: () => found as T[] }
          }
        }

        return { one: () => (table[0] as T) || null, toArray: () => table as T[] }
      }

      if (sqlLower.startsWith('update')) {
        return { one: () => null, toArray: () => [] }
      }

      if (sqlLower.startsWith('delete')) {
        const match = sql.match(/FROM\s+(\w+)/i)
        const tableName = match?.[1] || 'unknown'
        const table = tables.get(tableName) || []

        if (sql.includes('WHERE') && params[0] !== undefined) {
          const idMatch = sql.match(/id\s*=\s*\?/i)
          if (idMatch) {
            const id = params[0]
            const filtered = table.filter((row: any) => row.id !== id)
            tables.set(tableName, filtered)
          }
        }
        return { one: () => null, toArray: () => [] }
      }

      return { one: () => null, toArray: () => [] }
    },
  }
}

/**
 * Create a mock R2 bucket for testing.
 */
function createMockR2Bucket(): R2BucketLike {
  const objects = new Map<string, ArrayBuffer>()

  return {
    get: vi.fn(async (key: string) => {
      const data = objects.get(key)
      if (!data) return null
      return {
        key,
        size: data.byteLength,
        arrayBuffer: async () => data,
        text: async () => new TextDecoder().decode(data),
      }
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | string) => {
      let buffer: ArrayBuffer
      if (typeof value === 'string') {
        buffer = new TextEncoder().encode(value).buffer
      } else if (value instanceof Uint8Array) {
        buffer = value.buffer
      } else {
        buffer = value
      }
      objects.set(key, buffer)
      return {
        key,
        size: buffer.byteLength,
        arrayBuffer: async () => buffer,
        text: async () => new TextDecoder().decode(buffer),
      }
    }),
    delete: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        objects.delete(k)
      }
    }),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('withFs mixin', () => {
  describe('basic composition', () => {
    it('should extend a base class with fs capability', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(instance).toBeInstanceOf(BaseClass)
      expect(instance.name).toBe('Test')
      expect(instance.greet()).toBe('Hello, Test!')
      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should work without options', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should preserve base class prototype chain', () => {
      class ChildClass extends BaseClass {
        age: number
        constructor(name: string, age: number) {
          super(name)
          this.age = age
        }
      }

      const ExtendedClass = withFs(ChildClass)
      const instance = new ExtendedClass('Test', 25)

      expect(instance).toBeInstanceOf(ChildClass)
      expect(instance).toBeInstanceOf(BaseClass)
      expect(instance.name).toBe('Test')
      expect(instance.age).toBe(25)
      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should allow multiple instances with independent fs modules', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance1 = new ExtendedClass('One')
      const instance2 = new ExtendedClass('Two')

      expect(instance1.fs).not.toBe(instance2.fs)
      expect(instance1.fs).toBeInstanceOf(FsModule)
      expect(instance2.fs).toBeInstanceOf(FsModule)
    })
  })

  describe('lazy initialization', () => {
    it('should lazily create FsModule on first access', () => {
      let accessCount = 0
      const options: WithFsOptions = {
        getSql: () => {
          accessCount++
          return createMockSqlStorage()
        },
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Factory should not be called yet
      expect(accessCount).toBe(0)

      // Access fs property
      const fs1 = instance.fs
      expect(accessCount).toBe(1)
      expect(fs1).toBeInstanceOf(FsModule)

      // Second access should return same instance, not call factory again
      const fs2 = instance.fs
      expect(accessCount).toBe(1)
      expect(fs2).toBe(fs1)
    })

    it('should resolve sql factory at first access', () => {
      const mockSql = createMockSqlStorage()
      const options: WithFsOptions = {
        getSql: vi.fn(() => mockSql),
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getSql).not.toHaveBeenCalled()

      // Access fs
      instance.fs

      expect(options.getSql).toHaveBeenCalledTimes(1)
      expect(options.getSql).toHaveBeenCalledWith(instance)
    })

    it('should resolve r2 factory at first access', () => {
      const mockR2 = createMockR2Bucket()
      const options: WithFsOptions = {
        getR2: vi.fn(() => mockR2),
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getR2).not.toHaveBeenCalled()

      // Access fs
      instance.fs

      expect(options.getR2).toHaveBeenCalledTimes(1)
      expect(options.getR2).toHaveBeenCalledWith(instance)
    })

    it('should resolve archive factory at first access', () => {
      const mockArchive = createMockR2Bucket()
      const options: WithFsOptions = {
        getArchive: vi.fn(() => mockArchive),
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getArchive).not.toHaveBeenCalled()

      // Access fs
      instance.fs

      expect(options.getArchive).toHaveBeenCalledTimes(1)
      expect(options.getArchive).toHaveBeenCalledWith(instance)
    })
  })

  describe('options configuration', () => {
    it('should pass basePath option to FsModule', () => {
      const ExtendedClass = withFs(BaseClass, { basePath: '/app' })
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should pass hotMaxSize option to FsModule', () => {
      const ExtendedClass = withFs(BaseClass, { hotMaxSize: 512 * 1024 })
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should pass defaultMode option to FsModule', () => {
      const ExtendedClass = withFs(BaseClass, { defaultMode: 0o600 })
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should pass defaultDirMode option to FsModule', () => {
      const ExtendedClass = withFs(BaseClass, { defaultDirMode: 0o700 })
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
    })
  })

  describe('factory functions', () => {
    it('should access DO-like instance ctx.storage.sql via getSql', () => {
      const mockSql = createMockSqlStorage()

      const options: WithFsOptions = {
        getSql: (instance) => {
          const doInstance = instance as DOLikeClass
          return doInstance.ctx.storage?.sql
        },
      }

      const ExtendedClass = withFs(DOLikeClass, options)
      const instance = new ExtendedClass({}, { storage: { sql: mockSql } })

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should access DO-like instance env via getR2', () => {
      const mockR2 = createMockR2Bucket()

      const options: WithFsOptions = {
        getR2: (instance) => {
          const doInstance = instance as DOLikeClass
          return doInstance.env.R2_BUCKET as R2BucketLike | undefined
        },
      }

      const ExtendedClass = withFs(DOLikeClass, options)
      const instance = new ExtendedClass({ R2_BUCKET: mockR2 })

      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should handle undefined returns from factory functions', () => {
      const options: WithFsOptions = {
        getSql: () => undefined,
        getR2: () => undefined,
        getArchive: () => undefined,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Should still create a valid FsModule with mock storage
      expect(instance.fs).toBeInstanceOf(FsModule)
    })
  })

  describe('contextMode', () => {
    it('should extend $ context when contextMode is true', () => {
      const options: WithFsOptions = {
        contextMode: true,
      }

      const ExtendedClass = withFs(DOLikeClass, options)
      const instance = new ExtendedClass({}, {}, {}, { existingProp: 'value' })

      // Access fs via $
      expect((instance.$ as Record<string, unknown>).fs).toBe(instance.fs)
      // Existing props should still work
      expect((instance.$ as Record<string, unknown>).existingProp).toBe('value')
    })

    it('should not modify $ when no $ context exists', () => {
      const options: WithFsOptions = {
        contextMode: true,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Should not throw, just work normally
      expect(instance.fs).toBeInstanceOf(FsModule)
    })
  })

  describe('autoInit option', () => {
    it('should auto-initialize when autoInit is true', () => {
      const mockSql = createMockSqlStorage()

      const options: WithFsOptions = {
        getSql: () => mockSql,
        autoInit: true,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Should already have fs module created
      expect(instance.fs).toBeInstanceOf(FsModule)
    })
  })

  describe('initializeFs method', () => {
    it('should be available on extended class instances', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(typeof (instance as any).initializeFs).toBe('function')
    })

    it('should call FsModule.initialize', async () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      // Should not throw
      await (instance as any).initializeFs()
    })

    it('should be idempotent', async () => {
      const mockSql = createMockSqlStorage()
      let initCount = 0
      const options: WithFsOptions = {
        getSql: () => {
          initCount++
          return mockSql
        },
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      await (instance as any).initializeFs()
      await (instance as any).initializeFs()
      await (instance as any).initializeFs()

      // getSql is called once during first fs access
      expect(initCount).toBe(1)
    })
  })

  describe('disposeFs method', () => {
    it('should be available on extended class instances', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(typeof (instance as any).disposeFs).toBe('function')
    })

    it('should dispose the FsModule', async () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      // Create the module
      const fs1 = instance.fs
      expect(fs1).toBeInstanceOf(FsModule)

      // Dispose
      await (instance as any).disposeFs()

      // Next access should create a new module
      const fs2 = instance.fs
      expect(fs2).toBeInstanceOf(FsModule)
      expect(fs2).not.toBe(fs1)
    })
  })

  describe('hasCapability method', () => {
    it('should return true for fs capability', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect((instance as any).hasCapability('fs')).toBe(true)
    })

    it('should return false for unknown capabilities', () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      expect((instance as any).hasCapability('git')).toBe(false)
      expect((instance as any).hasCapability('bash')).toBe(false)
    })
  })

  describe('fs module functionality', () => {
    it('should provide file operations', async () => {
      const mockSql = createMockSqlStorage()
      const options: WithFsOptions = {
        getSql: () => mockSql,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Initialize
      await instance.fs.initialize()

      // Write a file
      await instance.fs.writeFile('/test.txt', 'Hello, World!')

      // Read the file back
      const content = await instance.fs.readFile('/test.txt', { encoding: 'utf-8' })
      expect(content).toBe('Hello, World!')
    })

    it('should provide directory operations', async () => {
      const mockSql = createMockSqlStorage()
      const options: WithFsOptions = {
        getSql: () => mockSql,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Initialize
      await instance.fs.initialize()

      // Create a directory
      await instance.fs.mkdir('/mydir')

      // Check it exists
      const exists = await instance.fs.exists('/mydir')
      expect(exists).toBe(true)
    })

    it('should provide stat operations', async () => {
      const mockSql = createMockSqlStorage()
      const options: WithFsOptions = {
        getSql: () => mockSql,
      }

      const ExtendedClass = withFs(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Initialize
      await instance.fs.initialize()

      // Stat root
      const stats = await instance.fs.stat('/')
      expect(stats.isDirectory()).toBe(true)
    })

    it('should provide lifecycle methods', async () => {
      const ExtendedClass = withFs(BaseClass)
      const instance = new ExtendedClass('Test')

      await expect(instance.fs.initialize()).resolves.toBeUndefined()
      await expect(instance.fs.dispose()).resolves.toBeUndefined()
    })
  })

  describe('mixin chaining', () => {
    it('should work when chained with other mixins', () => {
      // Simulated withGit mixin
      function withGit<T extends new (...args: any[]) => any>(
        Base: T,
        options: { repo: string }
      ) {
        return class extends Base {
          git = { repo: options.repo }
        }
      }

      const ExtendedClass = withFs(withGit(BaseClass, { repo: 'org/repo' }))
      const instance = new ExtendedClass('Test')

      expect(instance.name).toBe('Test')
      expect((instance as any).git.repo).toBe('org/repo')
      expect(instance.fs).toBeInstanceOf(FsModule)
    })

    it('should work when applied before other mixins', () => {
      function withLogger<T extends new (...args: any[]) => any>(Base: T) {
        return class extends Base {
          logs: string[] = []
          log(msg: string) {
            this.logs.push(msg)
          }
        }
      }

      const ExtendedClass = withLogger(withFs(BaseClass))
      const instance = new ExtendedClass('Test')

      expect(instance.fs).toBeInstanceOf(FsModule)
      expect((instance as any).logs).toEqual([])
      ;(instance as any).log('test')
      expect((instance as any).logs).toEqual(['test'])
    })
  })

  describe('static capabilities', () => {
    it('should add fs to static capabilities list', () => {
      const ExtendedClass = withFs(BaseClass)

      expect((ExtendedClass as any).capabilities).toContain('fs')
    })

    it('should preserve existing capabilities', () => {
      class BaseWithCaps {
        static capabilities = ['base']
      }

      const ExtendedClass = withFs(BaseWithCaps)

      expect((ExtendedClass as any).capabilities).toContain('base')
      expect((ExtendedClass as any).capabilities).toContain('fs')
    })
  })
})

describe('hasFsCapability', () => {
  it('should return true for instances with fs capability', () => {
    const ExtendedClass = withFs(BaseClass)
    const instance = new ExtendedClass('Test')

    expect(hasFsCapability(instance)).toBe(true)
  })

  it('should return false for plain objects', () => {
    expect(hasFsCapability({})).toBe(false)
  })

  it('should return false for null', () => {
    expect(hasFsCapability(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(hasFsCapability(undefined)).toBe(false)
  })

  it('should return false for objects with fs property that is not FsModule', () => {
    const obj = { fs: { readFile: () => {} } }
    expect(hasFsCapability(obj)).toBe(false)
  })

  it('should work with type narrowing', () => {
    const ExtendedClass = withFs(BaseClass)
    const instance: unknown = new ExtendedClass('Test')

    if (hasFsCapability(instance)) {
      // TypeScript should recognize instance.fs exists
      expect(instance.fs.name).toBe('fs')
    } else {
      // Should not reach here
      expect(true).toBe(false)
    }
  })
})

describe('edge cases', () => {
  it('should handle class with no constructor', () => {
    class NoConstructorClass {}

    const ExtendedClass = withFs(NoConstructorClass)
    const instance = new ExtendedClass()

    expect(instance.fs).toBeInstanceOf(FsModule)
  })

  it('should handle class with complex constructor', () => {
    class ComplexClass {
      a: string
      b: number
      c: boolean
      d: object

      constructor(a: string, b: number, c: boolean, d: object) {
        this.a = a
        this.b = b
        this.c = c
        this.d = d
      }
    }

    const ExtendedClass = withFs(ComplexClass)
    const instance = new ExtendedClass('test', 42, true, { key: 'value' })

    expect(instance.a).toBe('test')
    expect(instance.b).toBe(42)
    expect(instance.c).toBe(true)
    expect(instance.d).toEqual({ key: 'value' })
    expect(instance.fs).toBeInstanceOf(FsModule)
  })

  it('should handle empty options object', () => {
    const ExtendedClass = withFs(BaseClass, {})
    const instance = new ExtendedClass('Test')

    expect(instance.fs).toBeInstanceOf(FsModule)
  })

  it('should handle all options combined', () => {
    const mockSql = createMockSqlStorage()
    const mockR2 = createMockR2Bucket()
    const mockArchive = createMockR2Bucket()

    const options: WithFsOptions = {
      basePath: '/data',
      hotMaxSize: 256 * 1024,
      defaultMode: 0o600,
      defaultDirMode: 0o700,
      getSql: () => mockSql,
      getR2: () => mockR2,
      getArchive: () => mockArchive,
    }

    const ExtendedClass = withFs(BaseClass, options)
    const instance = new ExtendedClass('Test')

    expect(instance.fs).toBeInstanceOf(FsModule)
    expect(instance.fs.name).toBe('fs')
  })
})

describe('composition with other mixins', () => {
  // Simulated withBash mixin
  function withBash<T extends new (...args: any[]) => any>(
    Base: T,
    options: { cwd?: string } = {}
  ) {
    return class extends Base {
      bash = {
        cwd: options.cwd ?? '/',
        exec: async (cmd: string) => ({ stdout: cmd, stderr: '', exitCode: 0 }),
      }
    }
  }

  // Simulated withGit mixin
  function withGit<T extends new (...args: any[]) => any>(
    Base: T,
    options: { repo: string }
  ) {
    return class extends Base {
      git = { repo: options.repo }
    }
  }

  it('should compose with withBash', () => {
    const DOWithBashAndFs = withFs(withBash(BaseClass, { cwd: '/app' }))
    const instance = new DOWithBashAndFs('Test')

    expect(instance.fs).toBeInstanceOf(FsModule)
    expect((instance as any).bash.cwd).toBe('/app')
    expect(instance.name).toBe('Test')
  })

  it('should compose with withGit', () => {
    const DOWithGitAndFs = withFs(withGit(BaseClass, { repo: 'org/repo' }))
    const instance = new DOWithGitAndFs('Test')

    expect(instance.fs).toBeInstanceOf(FsModule)
    expect((instance as any).git.repo).toBe('org/repo')
    expect(instance.name).toBe('Test')
  })

  it('should compose with both withBash and withGit', () => {
    const FullDO = withFs(
      withBash(withGit(BaseClass, { repo: 'org/repo' }), { cwd: '/workspace' })
    )
    const instance = new FullDO('Test')

    expect(instance.fs).toBeInstanceOf(FsModule)
    expect((instance as any).bash.cwd).toBe('/workspace')
    expect((instance as any).git.repo).toBe('org/repo')
    expect(instance.name).toBe('Test')
  })

  it('should allow reverse composition order', () => {
    const DOWithFsFirst = withBash(withGit(withFs(BaseClass), { repo: 'org/repo' }), { cwd: '/app' })
    const instance = new DOWithFsFirst('Test')

    expect((instance as any).fs).toBeInstanceOf(FsModule)
    expect((instance as any).bash.cwd).toBe('/app')
    expect((instance as any).git.repo).toBe('org/repo')
  })

  it('should have independent modules per instance', () => {
    const FullDO = withFs(withBash(BaseClass))
    const instance1 = new FullDO('One')
    const instance2 = new FullDO('Two')

    expect(instance1.fs).not.toBe(instance2.fs)
    expect((instance1 as any).bash).not.toBe((instance2 as any).bash)
  })
})
