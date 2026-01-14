/**
 * @fileoverview Integration Tests for FsModule with DO Context
 *
 * These tests verify the comprehensive integration of FsModule with
 * dotdo's Durable Object framework, including:
 *
 * - DO context integration ($.fs pattern)
 * - Lifecycle management (initialization, lazy loading, disposal)
 * - withFs mixin composition patterns
 * - Error handling across integration points
 * - Multi-module integration scenarios (with Git, Bash)
 * - Tiered storage with R2 integration
 *
 * @module test/do/FsModule-integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  FsModule,
  createFsModule,
  isFsModule,
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  ENOTEMPTY,
  type FsModuleOptions,
  type SqlStorage,
  type SqlResult,
  type R2BucketLike,
  type R2ObjectLike,
  type Stats,
  type Dirent,
} from '../../src/do/FsModule'
import {
  withFs,
  hasFsCapability,
  type WithFsOptions,
  type WithFsCapability,
} from '../../src/do/withFs'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Internal file entry for mock storage.
 */
interface MockFileEntry {
  id: number
  path: string
  name: string
  parent_id: number | null
  type: 'file' | 'directory' | 'symlink'
  mode: number
  uid: number
  gid: number
  size: number
  blob_id: string | null
  link_target: string | null
  tier: 'hot' | 'warm' | 'cold'
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
}

/**
 * Mock blob entry for mock storage.
 */
interface MockBlobEntry {
  id: string
  data: ArrayBuffer | null
  size: number
  tier: 'hot' | 'warm' | 'cold'
  created_at: number
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SQLite behavior.
 */
class MockSqlStorage implements SqlStorage {
  private files: Map<string, MockFileEntry> = new Map()
  private blobs: Map<string, MockBlobEntry> = new Map()
  private nextFileId = 1
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  exec<T = unknown>(sql: string, ...params: unknown[]): SqlResult<T> {
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
      // Check if this is a symlink insert (with link_target)
      if (normalizedSql.includes('link_target')) {
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: null,
          link_target: params[8] as string | null,
          tier: params[9] as 'hot' | 'warm' | 'cold',
          atime: params[10] as number,
          mtime: params[11] as number,
          ctime: params[12] as number,
          birthtime: params[13] as number,
          nlink: params[14] as number,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      }

      // Check if this has blob_id
      if (normalizedSql.includes('blob_id')) {
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: params[8] as string | null,
          tier: params[9] as 'hot' | 'warm' | 'cold',
          atime: params[10] as number,
          mtime: params[11] as number,
          ctime: params[12] as number,
          birthtime: params[13] as number,
          nlink: params[14] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      } else {
        // Without blob_id (directory type)
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: null,
          tier: params[8] as 'hot' | 'warm' | 'cold',
          atime: params[9] as number,
          mtime: params[10] as number,
          ctime: params[11] as number,
          birthtime: params[12] as number,
          nlink: params[13] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      }
    }

    // Handle INSERT into blobs
    if (normalizedSql.includes('insert') && normalizedSql.includes('blobs')) {
      const entry: MockBlobEntry = {
        id: params[0] as string,
        data: params[1] as ArrayBuffer | null,
        size: params[2] as number,
        tier: params[3] as 'hot' | 'warm' | 'cold',
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

    // Handle SELECT id from files WHERE path = ?
    if (normalizedSql.includes('select id from files') && normalizedSql.includes('where path')) {
      const path = params[0] as string
      const file = this.files.get(path)
      if (file) {
        return {
          one: () => ({ id: file.id } as T),
          toArray: () => [{ id: file.id } as T],
        }
      }
      return this.emptyResult<T>()
    }

    // Handle SELECT from files WHERE parent_id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where parent_id')) {
      const parentId = params[0] as number
      const children: MockFileEntry[] = []
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

    // Handle SELECT from files WHERE path LIKE ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path like')) {
      const pattern = params[0] as string
      const prefix = pattern.replace(/%$/, '')
      const matches: MockFileEntry[] = []
      for (const file of this.files.values()) {
        if (file.path.startsWith(prefix)) {
          matches.push(file)
        }
      }
      return {
        one: () => (matches[0] as T) || null,
        toArray: () => matches as T[],
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
          if (normalizedSql.includes('set path') && normalizedSql.includes('name') && normalizedSql.includes('parent_id')) {
            const newPath = params[0] as string
            const newName = params[1] as string
            const newParentId = params[2] as number | null
            const newCtime = params[3] as number

            this.files.delete(path)
            file.path = newPath
            file.name = newName
            file.parent_id = newParentId
            file.ctime = newCtime
            this.files.set(newPath, file)
          } else if (normalizedSql.includes('set path') && !normalizedSql.includes('name')) {
            const newPath = params[0] as string
            this.files.delete(path)
            file.path = newPath
            this.files.set(newPath, file)
          } else if (normalizedSql.includes('set blob_id') && normalizedSql.includes('tier') && params.length === 3) {
            file.blob_id = params[0] as string
            file.tier = params[1] as 'hot' | 'warm' | 'cold'
          } else if (normalizedSql.includes('set blob_id') && normalizedSql.includes('size') && params.length === 6) {
            file.blob_id = params[0] as string
            file.size = params[1] as number
            file.tier = params[2] as 'hot' | 'warm' | 'cold'
            file.mtime = params[3] as number
            file.ctime = params[4] as number
          } else if (normalizedSql.includes('set atime') && normalizedSql.includes('mtime') && normalizedSql.includes('ctime')) {
            file.atime = params[0] as number
            file.mtime = params[1] as number
            file.ctime = params[2] as number
          } else if (normalizedSql.includes('set atime') && !normalizedSql.includes('mtime')) {
            file.atime = params[0] as number
          } else if (normalizedSql.includes('set mode')) {
            file.mode = params[0] as number
            file.ctime = params[1] as number
          } else if (normalizedSql.includes('set uid')) {
            file.uid = params[0] as number
            file.gid = params[1] as number
            file.ctime = params[2] as number
          } else if (normalizedSql.includes('set nlink')) {
            file.nlink = (file.nlink || 1) + 1
          }
          break
        }
      }
      return this.emptyResult<T>()
    }

    // Handle DELETE from files
    if (normalizedSql.includes('delete from files')) {
      const id = params[0] as number
      for (const [path, file] of this.files.entries()) {
        if (file.id === id) {
          this.files.delete(path)
          break
        }
      }
      return this.emptyResult<T>()
    }

    // Handle DELETE from blobs
    if (normalizedSql.includes('delete from blobs')) {
      const id = params[0] as string
      this.blobs.delete(id)
      return this.emptyResult<T>()
    }

    return this.emptyResult<T>()
  }

  private emptyResult<T>(): SqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  // Test helpers
  getFile(path: string): MockFileEntry | undefined {
    return this.files.get(path)
  }

  getBlob(id: string): MockBlobEntry | undefined {
    return this.blobs.get(id)
  }

  getFileCount(): number {
    return this.files.size
  }

  getBlobCount(): number {
    return this.blobs.size
  }

  clear(): void {
    this.files.clear()
    this.blobs.clear()
    this.execCalls = []
    this.schemaCreated = false
    this.nextFileId = 1
  }
}

/**
 * Mock R2 bucket for testing tiered storage.
 */
class MockR2Bucket implements R2BucketLike {
  private objects: Map<string, Uint8Array> = new Map()
  public putCalls: { key: string; size: number }[] = []
  public getCalls: string[] = []
  public deleteCalls: (string | string[])[] = []

  async put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike> {
    let data: Uint8Array
    if (typeof value === 'string') {
      data = new TextEncoder().encode(value)
    } else if (value instanceof ArrayBuffer) {
      data = new Uint8Array(value)
    } else {
      data = value
    }
    this.objects.set(key, data)
    this.putCalls.push({ key, size: data.length })
    return {
      key,
      size: data.length,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => new TextDecoder().decode(data),
    }
  }

  async get(key: string): Promise<R2ObjectLike | null> {
    this.getCalls.push(key)
    const data = this.objects.get(key)
    if (!data) return null
    return {
      key,
      size: data.length,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => new TextDecoder().decode(data),
    }
  }

  async delete(key: string | string[]): Promise<void> {
    this.deleteCalls.push(key)
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  clear(): void {
    this.objects.clear()
    this.putCalls = []
    this.getCalls = []
    this.deleteCalls = []
  }
}

// ============================================================================
// Mock DO Context ($.fs Pattern)
// ============================================================================

/**
 * Mock WorkflowContext $ for simulating dotdo's DO context
 */
interface MockWorkflowContext {
  fs?: FsModule
  git?: { repo: string; sync: () => Promise<void> }
  bash?: { exec: (cmd: string) => Promise<{ stdout: string; exitCode: number }> }
  send: (event: string, data: unknown) => void
  do: <T>(action: string, data?: unknown) => Promise<T>
}

/**
 * Mock Durable Object class for testing integration
 */
class MockDurableObject {
  protected state: { storage?: { sql?: SqlStorage } }
  protected ctx: { storage?: { sql?: SqlStorage } }
  protected env: Record<string, unknown>
  protected $: MockWorkflowContext

  constructor(
    state: { storage?: { sql?: SqlStorage } } = {},
    env: Record<string, unknown> = {},
    ctx: { storage?: { sql?: SqlStorage } } = {}
  ) {
    this.state = state
    this.ctx = ctx
    this.env = env
    this.$ = {
      send: vi.fn(),
      do: vi.fn().mockResolvedValue(undefined),
    }
  }
}

// ============================================================================
// Integration Test Suites
// ============================================================================

describe('FsModule DO Context Integration', () => {
  let mockSql: MockSqlStorage
  let mockR2: MockR2Bucket
  let mockArchive: MockR2Bucket

  beforeEach(() => {
    mockSql = new MockSqlStorage()
    mockR2 = new MockR2Bucket()
    mockArchive = new MockR2Bucket()
  })

  afterEach(() => {
    mockSql.clear()
    mockR2.clear()
    mockArchive.clear()
  })

  describe('$.fs Context Pattern', () => {
    it('should integrate FsModule as $.fs in DO context', () => {
      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = new FsModule({
            sql: mockSql,
          })
        }

        async readConfig() {
          return this.$.fs!.readFile('/config.json', { encoding: 'utf-8' })
        }
      }

      const durable = new TestDO()
      expect(durable.$.fs).toBeInstanceOf(FsModule)
    })

    it('should execute file operations through $.fs context', async () => {
      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = new FsModule({
            sql: mockSql,
          })
        }

        async saveData(filename: string, content: string) {
          await this.$.fs!.writeFile(filename, content)
          return this.$.fs!.readFile(filename, { encoding: 'utf-8' })
        }
      }

      const durable = new TestDO()
      const result = await durable.saveData('/test.txt', 'Hello, World!')

      expect(result).toBe('Hello, World!')
      expect(mockSql.getFile('/test.txt')).toBeDefined()
    })

    it('should share context between $.fs and $.bash', async () => {
      const mockBashExec = vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 })

      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = new FsModule({ sql: mockSql })
          this.$.bash = { exec: mockBashExec }
        }

        async setupAndRun() {
          // Create file using fs
          await this.$.fs!.mkdir('/app/src', { recursive: true })
          await this.$.fs!.writeFile('/app/src/index.ts', 'console.log("Hello")')

          // Run command (simulated)
          return this.$.bash!.exec('npm run build')
        }
      }

      const durable = new TestDO()
      await durable.setupAndRun()

      expect(await durable.$.fs!.exists('/app/src/index.ts')).toBe(true)
      expect(mockBashExec).toHaveBeenCalled()
    })

    it('should share context between $.fs and $.git', async () => {
      const mockGitSync = vi.fn().mockResolvedValue(undefined)

      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = new FsModule({ sql: mockSql })
          this.$.git = { repo: 'org/repo', sync: mockGitSync }
        }

        async syncAndRead() {
          // Sync git repo
          await this.$.git!.sync()

          // Create file in workspace
          await this.$.fs!.mkdir('/workspace', { recursive: true })
          await this.$.fs!.writeFile('/workspace/README.md', '# Project')

          return this.$.fs!.readFile('/workspace/README.md', { encoding: 'utf-8' })
        }
      }

      const durable = new TestDO()
      const content = await durable.syncAndRead()

      expect(content).toBe('# Project')
      expect(mockGitSync).toHaveBeenCalled()
    })
  })

  describe('Lifecycle Management', () => {
    it('should support lazy initialization of FsModule', () => {
      let initCount = 0

      class TestDO extends MockDurableObject {
        private _fs?: FsModule

        get fs(): FsModule {
          if (!this._fs) {
            initCount++
            this._fs = new FsModule({ sql: mockSql })
          }
          return this._fs
        }
      }

      const durable = new TestDO()
      expect(initCount).toBe(0)

      // First access initializes
      durable.fs
      expect(initCount).toBe(1)

      // Subsequent access returns same instance
      durable.fs
      expect(initCount).toBe(1)
    })

    it('should not create schema until first operation', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      expect(mockSql.schemaCreated).toBe(false)

      // First operation triggers initialization
      await fsModule.exists('/')

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should create schema only once across multiple operations', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      await fsModule.exists('/')
      await fsModule.mkdir('/dir1')
      await fsModule.writeFile('/file1.txt', 'content')

      const createTableCalls = mockSql.execCalls.filter((c) =>
        c.sql.toLowerCase().includes('create table')
      )
      expect(createTableCalls.length).toBeLessThanOrEqual(1)
    })

    it('should create root directory on initialization', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      await fsModule.exists('/')

      const root = mockSql.getFile('/')
      expect(root).toBeDefined()
      expect(root?.type).toBe('directory')
    })

    it('should handle dispose() gracefully', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      await fsModule.initialize()
      await expect(fsModule.dispose()).resolves.toBeUndefined()
    })

    it('should be safe to initialize multiple times', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      await fsModule.initialize()
      await fsModule.initialize()
      await fsModule.initialize()

      // Root should only exist once
      expect(mockSql.getFile('/')).toBeDefined()
    })

    it('should support explicit initialization before operations', async () => {
      const fsModule = new FsModule({ sql: mockSql })

      // Explicit initialization
      await fsModule.initialize()

      expect(mockSql.schemaCreated).toBe(true)
      expect(mockSql.getFile('/')).toBeDefined()
    })
  })

  describe('File Operations Through DO Context', () => {
    it('should handle file CRUD operations', async () => {
      class TestDO extends MockDurableObject {
        fs = new FsModule({ sql: mockSql })

        async crudOperations() {
          // Create
          await this.fs.writeFile('/doc.txt', 'Initial content')

          // Read
          const initial = await this.fs.readFile('/doc.txt', { encoding: 'utf-8' })

          // Update
          await this.fs.writeFile('/doc.txt', 'Updated content')
          const updated = await this.fs.readFile('/doc.txt', { encoding: 'utf-8' })

          // Delete
          await this.fs.unlink('/doc.txt')
          const exists = await this.fs.exists('/doc.txt')

          return { initial, updated, exists }
        }
      }

      const durable = new TestDO()
      const result = await durable.crudOperations()

      expect(result.initial).toBe('Initial content')
      expect(result.updated).toBe('Updated content')
      expect(result.exists).toBe(false)
    })

    it('should handle directory operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      // Create nested directories
      await fs.mkdir('/project/src/components', { recursive: true })

      // Create files
      await fs.writeFile('/project/src/components/App.tsx', 'export const App = () => {}')
      await fs.writeFile('/project/src/index.ts', 'import { App } from "./components/App"')

      // List directory
      const components = await fs.readdir('/project/src/components')
      expect(components).toContain('App.tsx')

      // Check structure
      expect(await fs.exists('/project')).toBe(true)
      expect(await fs.exists('/project/src')).toBe(true)
      expect(await fs.exists('/project/src/components')).toBe(true)
    })

    it('should handle stat operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/test.txt', 'Test content')
      await fs.mkdir('/testdir')

      const fileStats = await fs.stat('/test.txt')
      const dirStats = await fs.stat('/testdir')

      expect(fileStats.isFile()).toBe(true)
      expect(fileStats.isDirectory()).toBe(false)
      expect(fileStats.size).toBe(12)

      expect(dirStats.isFile()).toBe(false)
      expect(dirStats.isDirectory()).toBe(true)
    })

    it('should handle symlink operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/original.txt', 'Original content')
      await fs.symlink('/original.txt', '/link.txt')

      const stats = await fs.lstat('/link.txt')
      expect(stats.isSymbolicLink()).toBe(true)

      const target = await fs.readlink('/link.txt')
      expect(target).toBe('/original.txt')
    })

    it('should handle hardlink operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/original.txt', 'Content')
      await fs.link('/original.txt', '/hardlink.txt')

      const original = mockSql.getFile('/original.txt')
      const hardlink = mockSql.getFile('/hardlink.txt')

      expect(original?.blob_id).toBe(hardlink?.blob_id)
      expect(original?.nlink).toBeGreaterThanOrEqual(2)
    })
  })

  describe('withFs Mixin Composition Patterns', () => {
    it('should compose with base DO class', () => {
      const FsDO = withFs(MockDurableObject, {
        basePath: '/app',
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      expect(durable.fs).toBeInstanceOf(FsModule)
    })

    it('should lazily resolve sql from DO instance', () => {
      let sqlResolved = false

      const FsDO = withFs(MockDurableObject, {
        getSql: (instance) => {
          sqlResolved = true
          const durable = instance as MockDurableObject
          return (durable as unknown as { ctx: { storage?: { sql?: SqlStorage } } }).ctx.storage?.sql
        },
      })

      class TestDO extends FsDO {
        constructor() {
          super({}, {}, { storage: { sql: mockSql } })
        }
      }

      const durable = new TestDO()

      expect(sqlResolved).toBe(false)
      durable.fs // Access triggers lazy resolution
      expect(sqlResolved).toBe(true)
    })

    it('should lazily resolve r2 from DO instance', () => {
      let r2Resolved = false

      const FsDO = withFs(MockDurableObject, {
        getSql: () => mockSql,
        getR2: (instance) => {
          r2Resolved = true
          const durable = instance as MockDurableObject
          return (durable as unknown as { env: { R2?: R2BucketLike } }).env.R2
        },
      })

      class TestDO extends FsDO {
        constructor() {
          super({}, { R2: mockR2 })
        }
      }

      const durable = new TestDO()

      expect(r2Resolved).toBe(false)
      durable.fs // Access triggers lazy resolution
      expect(r2Resolved).toBe(true)
    }

    )

    it('should support chaining multiple mixins', () => {
      // Simple mock withGit mixin
      function withGit<T extends new (...args: unknown[]) => object>(
        Base: T,
        options: { repo: string }
      ) {
        return class extends Base {
          git = { repo: options.repo, sync: vi.fn() }
        }
      }

      // Simple mock withBash mixin
      function withBash<T extends new (...args: unknown[]) => object>(
        Base: T,
        options: { cwd?: string } = {}
      ) {
        return class extends Base {
          bash = { cwd: options.cwd ?? '/', exec: vi.fn() }
        }
      }

      const FullDO = withFs(
        withBash(withGit(MockDurableObject, { repo: 'org/repo' }), { cwd: '/workspace' }),
        { getSql: () => mockSql }
      )

      const durable = new FullDO()

      expect(durable.fs).toBeInstanceOf(FsModule)
      expect((durable as { git: { repo: string } }).git.repo).toBe('org/repo')
      expect((durable as { bash: { cwd: string } }).bash.cwd).toBe('/workspace')
    })

    it('should support initializeFs for async initialization', async () => {
      const FsDO = withFs(MockDurableObject, {
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      // Initialize should not throw
      await (durable as { initializeFs: () => Promise<void> }).initializeFs()

      // Should have created root directory
      expect(mockSql.getFile('/')).toBeDefined()
    })

    it('should support disposeFs for cleanup', async () => {
      const FsDO = withFs(MockDurableObject, {
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      // Create the module
      const fs1 = durable.fs
      expect(fs1).toBeInstanceOf(FsModule)

      // Dispose
      await (durable as { disposeFs: () => Promise<void> }).disposeFs()

      // Next access should create a new module
      const fs2 = durable.fs
      expect(fs2).toBeInstanceOf(FsModule)
      expect(fs2).not.toBe(fs1)
    })

    it('should work with hasFsCapability type guard', () => {
      const FsDO = withFs(MockDurableObject, { getSql: () => mockSql })
      const durable = new FsDO()

      expect(hasFsCapability(durable)).toBe(true)

      const plainObject = {}
      expect(hasFsCapability(plainObject)).toBe(false)
    })

    it('should support hasCapability method', () => {
      const FsDO = withFs(MockDurableObject, { getSql: () => mockSql })
      const durable = new FsDO()

      expect((durable as { hasCapability: (name: string) => boolean }).hasCapability('fs')).toBe(true)
      expect((durable as { hasCapability: (name: string) => boolean }).hasCapability('git')).toBe(false)
    })

    it('should add fs to static capabilities list', () => {
      const FsDO = withFs(MockDurableObject)

      expect((FsDO as unknown as { capabilities: string[] }).capabilities).toContain('fs')
    })
  })

  describe('Mixin Options Configuration', () => {
    it('should pass basePath option to FsModule', async () => {
      const FsDO = withFs(MockDurableObject, {
        basePath: '/data',
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      // Create base directory first
      await durable.fs.mkdir('/data', { recursive: true })

      // Write relative path should be resolved to basePath
      await durable.fs.writeFile('test.txt', 'content')

      expect(mockSql.getFile('/data/test.txt')).toBeDefined()
    })

    it('should pass hotMaxSize option to FsModule', async () => {
      const FsDO = withFs(MockDurableObject, {
        hotMaxSize: 100,
        getSql: () => mockSql,
        getR2: () => mockR2,
      })

      const durable = new FsDO()

      // Small file should use hot tier
      await durable.fs.writeFile('/small.txt', 'small')
      expect(mockSql.getFile('/small.txt')?.tier).toBe('hot')

      // Large file should use warm tier
      await durable.fs.writeFile('/large.txt', 'x'.repeat(200))
      expect(mockSql.getFile('/large.txt')?.tier).toBe('warm')
    })

    it('should pass defaultMode option to FsModule', async () => {
      const FsDO = withFs(MockDurableObject, {
        defaultMode: 0o600,
        getSql: () => mockSql,
      })

      const durable = new FsDO()
      await durable.fs.writeFile('/private.txt', 'secret')

      const file = mockSql.getFile('/private.txt')
      expect(file?.mode).toBe(0o600)
    })

    it('should pass defaultDirMode option to FsModule', async () => {
      const FsDO = withFs(MockDurableObject, {
        defaultDirMode: 0o700,
        getSql: () => mockSql,
      })

      const durable = new FsDO()
      await durable.fs.mkdir('/private')

      const dir = mockSql.getFile('/private')
      expect(dir?.mode).toBe(0o700)
    })

    it('should support contextMode to extend $ context', () => {
      // Create a base class with $ already defined
      class DOWithContext extends MockDurableObject {
        constructor() {
          super()
          this.$ = {
            existingProp: 'value',
            send: vi.fn(),
            do: vi.fn().mockResolvedValue(undefined),
          } as MockWorkflowContext & { existingProp: string }
        }
      }

      const FsDO = withFs(DOWithContext, {
        contextMode: true,
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      // Access fs via $
      expect((durable.$ as { fs?: FsModule }).fs).toBe(durable.fs)
      // Existing props should still work
      expect((durable.$ as { existingProp?: string }).existingProp).toBe('value')
    })

    it('should support autoInit option', async () => {
      const FsDO = withFs(MockDurableObject, {
        autoInit: true,
        getSql: () => mockSql,
      })

      const durable = new FsDO()

      // Should already have fs module created
      expect(durable.fs).toBeInstanceOf(FsModule)

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Root directory should be created
      expect(mockSql.getFile('/')).toBeDefined()
    })
  })

  describe('Error Handling Integration', () => {
    it('should throw ENOENT for non-existent file', async () => {
      const fs = new FsModule({ sql: mockSql })

      try {
        await fs.readFile('/nonexistent.txt')
        expect.fail('Should have thrown ENOENT')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('ENOENT')
      }
    })

    it('should throw EEXIST when creating existing directory', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/existing')

      try {
        await fs.mkdir('/existing')
        expect.fail('Should have thrown EEXIST')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('EEXIST')
      }
    })

    it('should throw EISDIR when reading a directory', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/testdir')

      try {
        await fs.readFile('/testdir')
        expect.fail('Should have thrown EISDIR')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('EISDIR')
      }
    })

    it('should throw ENOTDIR when rmdir on a file', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/file.txt', 'content')

      try {
        await fs.rmdir('/file.txt')
        expect.fail('Should have thrown ENOTDIR')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('ENOTDIR')
      }
    })

    it('should throw ENOTEMPTY when rmdir on non-empty directory', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/nonempty')
      await fs.writeFile('/nonempty/file.txt', 'content')

      try {
        await fs.rmdir('/nonempty')
        expect.fail('Should have thrown ENOTEMPTY')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('ENOTEMPTY')
      }
    })

    it('should handle errors without crashing subsequent operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      // First operation fails
      try {
        await fs.readFile('/nonexistent.txt')
      } catch {
        // Expected
      }

      // Subsequent operations should work
      await fs.writeFile('/working.txt', 'content')
      expect(await fs.exists('/working.txt')).toBe(true)
    })
  })

  describe('Tiered Storage Integration', () => {
    it('should use hot tier for small files', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        hotMaxSize: 1024,
      })

      await fs.writeFile('/small.txt', 'Small content')

      const file = mockSql.getFile('/small.txt')
      expect(file?.tier).toBe('hot')
      expect(mockR2.putCalls.length).toBe(0)
    })

    it('should use warm tier for files exceeding hotMaxSize', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        hotMaxSize: 100,
      })

      await fs.writeFile('/large.txt', 'x'.repeat(200))

      const file = mockSql.getFile('/large.txt')
      expect(file?.tier).toBe('warm')
      expect(mockR2.putCalls.length).toBe(1)
    })

    it('should support explicit tier selection', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        archive: mockArchive,
      })

      await fs.writeFile('/warm.txt', 'Content', { tier: 'warm' })
      await fs.writeFile('/cold.txt', 'Content', { tier: 'cold' })

      expect(mockSql.getFile('/warm.txt')?.tier).toBe('warm')
      expect(mockSql.getFile('/cold.txt')?.tier).toBe('cold')
    })

    it('should demote files to colder tiers', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        archive: mockArchive,
      })

      await fs.writeFile('/file.txt', 'Content')
      expect(mockSql.getFile('/file.txt')?.tier).toBe('hot')

      await fs.demote('/file.txt', 'warm')
      expect(mockSql.getFile('/file.txt')?.tier).toBe('warm')

      await fs.demote('/file.txt', 'cold')
      expect(mockSql.getFile('/file.txt')?.tier).toBe('cold')
    })

    it('should promote files to hotter tiers', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        archive: mockArchive,
      })

      await fs.writeFile('/file.txt', 'Content', { tier: 'cold' })
      expect(mockSql.getFile('/file.txt')?.tier).toBe('cold')

      await fs.promote('/file.txt', 'warm')
      expect(mockSql.getFile('/file.txt')?.tier).toBe('warm')

      await fs.promote('/file.txt', 'hot')
      expect(mockSql.getFile('/file.txt')?.tier).toBe('hot')
    })

    it('should read files from appropriate tier', async () => {
      const fs = new FsModule({
        sql: mockSql,
        r2: mockR2,
        hotMaxSize: 100,
      })

      // Write large file (goes to warm tier)
      const largeContent = 'x'.repeat(200)
      await fs.writeFile('/large.txt', largeContent)

      // Read should get from R2
      const content = await fs.readFile('/large.txt', { encoding: 'utf-8' })
      expect(content).toBe(largeContent)
      expect(mockR2.getCalls.length).toBeGreaterThan(0)
    })
  })

  describe('Multi-Module Integration Scenarios', () => {
    it('should support complex DO with fs, git, and bash', async () => {
      const mockGitSync = vi.fn().mockResolvedValue(undefined)
      const mockBashExec = vi.fn().mockResolvedValue({ stdout: 'success', exitCode: 0 })

      class DevDO extends MockDurableObject {
        fs = new FsModule({ sql: mockSql })
        git = { repo: 'org/repo', sync: mockGitSync }
        bash = { exec: mockBashExec }

        async setupProject() {
          // Sync repository
          await this.git.sync()

          // Create directory structure
          await this.fs.mkdir('/workspace/src', { recursive: true })
          await this.fs.mkdir('/workspace/tests', { recursive: true })

          // Create files
          await this.fs.writeFile('/workspace/src/index.ts', 'export const main = () => {}')
          await this.fs.writeFile('/workspace/tests/index.test.ts', 'test("main", () => {})')

          // Run build
          await this.bash.exec('npm run build')

          return {
            files: await this.fs.readdir('/workspace/src'),
            tests: await this.fs.readdir('/workspace/tests'),
          }
        }
      }

      const durable = new DevDO()
      const result = await durable.setupProject()

      expect(result.files).toContain('index.ts')
      expect(result.tests).toContain('index.test.ts')
      expect(mockGitSync).toHaveBeenCalled()
      expect(mockBashExec).toHaveBeenCalled()
    })

    it('should support file-based configuration loading', async () => {
      class ConfigDO extends MockDurableObject {
        fs = new FsModule({ sql: mockSql })

        async loadConfig() {
          // Check if config exists
          if (!(await this.fs.exists('/config.json'))) {
            // Create default config
            const defaultConfig = { version: '1.0.0', debug: false }
            await this.fs.writeFile('/config.json', JSON.stringify(defaultConfig, null, 2))
          }

          const content = await this.fs.readFile('/config.json', { encoding: 'utf-8' })
          return JSON.parse(content as string)
        }

        async updateConfig(updates: Record<string, unknown>) {
          const current = await this.loadConfig()
          const merged = { ...current, ...updates }
          await this.fs.writeFile('/config.json', JSON.stringify(merged, null, 2))
          return merged
        }
      }

      const durable = new ConfigDO()

      // Load default config
      const config1 = await durable.loadConfig()
      expect(config1.version).toBe('1.0.0')

      // Update config
      const config2 = await durable.updateConfig({ debug: true })
      expect(config2.debug).toBe(true)

      // Reload and verify
      const config3 = await durable.loadConfig()
      expect(config3.debug).toBe(true)
    })

    it('should support log file operations', async () => {
      class LoggerDO extends MockDurableObject {
        fs = new FsModule({ sql: mockSql })
        private logPath = '/var/log/app.log'

        async log(message: string) {
          const timestamp = new Date().toISOString()
          const logLine = `[${timestamp}] ${message}\n`
          await this.fs.appendFile(this.logPath, logLine)
        }

        async getLogs(): Promise<string[]> {
          if (!(await this.fs.exists(this.logPath))) {
            return []
          }
          const content = await this.fs.readFile(this.logPath, { encoding: 'utf-8' })
          return (content as string).split('\n').filter(Boolean)
        }

        async rotateLogs() {
          if (await this.fs.exists(this.logPath)) {
            const archivePath = `/var/log/app.${Date.now()}.log`
            await this.fs.rename(this.logPath, archivePath)
          }
        }
      }

      const durable = new LoggerDO()

      // Create log directory
      await durable.fs.mkdir('/var/log', { recursive: true })

      // Write logs
      await durable.log('Application started')
      await durable.log('Processing request')
      await durable.log('Request completed')

      // Get logs
      const logs = await durable.getLogs()
      expect(logs.length).toBe(3)
      expect(logs[0]).toContain('Application started')

      // Rotate logs
      await durable.rotateLogs()
      expect(await durable.fs.exists('/var/log/app.log')).toBe(false)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent file writes', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/concurrent')

      const writes = await Promise.all([
        fs.writeFile('/concurrent/file1.txt', 'Content 1'),
        fs.writeFile('/concurrent/file2.txt', 'Content 2'),
        fs.writeFile('/concurrent/file3.txt', 'Content 3'),
        fs.writeFile('/concurrent/file4.txt', 'Content 4'),
        fs.writeFile('/concurrent/file5.txt', 'Content 5'),
      ])

      const files = await fs.readdir('/concurrent')
      expect(files.length).toBe(5)
    })

    it('should handle concurrent read operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      // Setup files
      await fs.mkdir('/read-test')
      await fs.writeFile('/read-test/a.txt', 'A')
      await fs.writeFile('/read-test/b.txt', 'B')
      await fs.writeFile('/read-test/c.txt', 'C')

      // Concurrent reads
      const [a, b, c] = await Promise.all([
        fs.readFile('/read-test/a.txt', { encoding: 'utf-8' }),
        fs.readFile('/read-test/b.txt', { encoding: 'utf-8' }),
        fs.readFile('/read-test/c.txt', { encoding: 'utf-8' }),
      ])

      expect(a).toBe('A')
      expect(b).toBe('B')
      expect(c).toBe('C')
    })

    it('should maintain isolation between operations', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/isolation')

      // Start multiple operations that might interfere
      const [result1, result2] = await Promise.all([
        (async () => {
          await fs.writeFile('/isolation/temp.txt', 'Version 1')
          return fs.readFile('/isolation/temp.txt', { encoding: 'utf-8' })
        })(),
        (async () => {
          await fs.writeFile('/isolation/other.txt', 'Other content')
          return fs.readFile('/isolation/other.txt', { encoding: 'utf-8' })
        })(),
      ])

      expect(result2).toBe('Other content')
    })
  })

  describe('Factory Functions and Type Guards', () => {
    it('createFsModule should create an FsModule instance', () => {
      const fs = createFsModule({ sql: mockSql })

      expect(fs).toBeInstanceOf(FsModule)
      expect(fs.name).toBe('fs')
    })

    it('isFsModule should return true for FsModule instances', () => {
      const fs = new FsModule({ sql: mockSql })

      expect(isFsModule(fs)).toBe(true)
    })

    it('isFsModule should return false for non-FsModule values', () => {
      expect(isFsModule({})).toBe(false)
      expect(isFsModule(null)).toBe(false)
      expect(isFsModule(undefined)).toBe(false)
      expect(isFsModule('string')).toBe(false)
      expect(isFsModule({ readFile: () => {} })).toBe(false)
    })
  })

  describe('Path Normalization in DO Context', () => {
    it('should normalize paths correctly', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/app')
      await fs.writeFile('/app/file.txt', 'content')

      // Various path forms should work
      expect(await fs.exists('/app/file.txt')).toBe(true)
      expect(await fs.exists('/app/./file.txt')).toBe(true)
      expect(await fs.exists('/app/../app/file.txt')).toBe(true)
      expect(await fs.exists('/app//file.txt')).toBe(true)
    })

    it('should handle basePath correctly', async () => {
      const fs = new FsModule({
        sql: mockSql,
        basePath: '/workspace',
      })

      await fs.mkdir('/workspace', { recursive: true })
      await fs.writeFile('config.json', '{}')

      expect(mockSql.getFile('/workspace/config.json')).toBeDefined()
    })
  })

  describe('getFileId Operations', () => {
    it('should return file id for existing file', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/test.txt', 'content')

      const fileId = await fs.getFileId('/test.txt')
      expect(fileId).toBeDefined()
      expect(typeof fileId).toBe('number')
    })

    it('should return null for non-existent file', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.exists('/') // Initialize

      const fileId = await fs.getFileId('/nonexistent.txt')
      expect(fileId).toBeNull()
    })

    it('should return root directory id', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.exists('/') // Initialize

      const fileId = await fs.getFileId('/')
      expect(fileId).toBeDefined()
      expect(typeof fileId).toBe('number')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/empty.txt', '')
      const content = await fs.readFile('/empty.txt', { encoding: 'utf-8' })

      expect(content).toBe('')
    })

    it('should handle binary data', async () => {
      const fs = new FsModule({ sql: mockSql })

      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])
      await fs.writeFile('/binary.bin', binaryData)

      const read = (await fs.readFile('/binary.bin')) as Uint8Array
      expect(read.length).toBe(5)
    })

    it('should handle special characters in filenames', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.writeFile('/file with spaces.txt', 'content')
      await fs.writeFile('/file-with-dashes.txt', 'content')
      await fs.writeFile('/file_with_underscores.txt', 'content')

      expect(await fs.exists('/file with spaces.txt')).toBe(true)
      expect(await fs.exists('/file-with-dashes.txt')).toBe(true)
      expect(await fs.exists('/file_with_underscores.txt')).toBe(true)
    })

    it('should handle deeply nested directories', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.mkdir('/a/b/c/d/e/f/g/h/i/j', { recursive: true })
      await fs.writeFile('/a/b/c/d/e/f/g/h/i/j/deep.txt', 'very deep')

      expect(await fs.exists('/a/b/c/d/e/f/g/h/i/j/deep.txt')).toBe(true)
      const content = await fs.readFile('/a/b/c/d/e/f/g/h/i/j/deep.txt', { encoding: 'utf-8' })
      expect(content).toBe('very deep')
    })

    it('should handle module with no R2 configured', async () => {
      const fs = new FsModule({
        sql: mockSql,
        // No R2
        hotMaxSize: 100,
      })

      // Large file should still work (fallback to hot tier)
      const largeContent = 'x'.repeat(200)
      await fs.writeFile('/large.txt', largeContent)

      expect(mockSql.getFile('/large.txt')?.tier).toBe('hot')
    })

    it('should handle re-initialization after dispose', async () => {
      const fs = new FsModule({ sql: mockSql })

      await fs.initialize()
      await fs.writeFile('/before.txt', 'before dispose')

      await fs.dispose()

      // Re-initialization should work
      await fs.initialize()
      await fs.writeFile('/after.txt', 'after dispose')

      expect(await fs.exists('/after.txt')).toBe(true)
    })
  })
})

describe('FsModule Module Properties', () => {
  let mockSql: MockSqlStorage

  beforeEach(() => {
    mockSql = new MockSqlStorage()
  })

  it('should have name property set to "fs"', () => {
    const fs = new FsModule({ sql: mockSql })
    expect(fs.name).toBe('fs')
  })

  it('should expose error classes', () => {
    expect(ENOENT).toBeDefined()
    expect(EEXIST).toBeDefined()
    expect(EISDIR).toBeDefined()
    expect(ENOTDIR).toBeDefined()
    expect(ENOTEMPTY).toBeDefined()
  })

  it('should create proper error instances', () => {
    const enoent = new ENOENT('custom message', '/path')
    expect(enoent.code).toBe('ENOENT')
    expect(enoent.message).toBe('custom message')
    expect(enoent.path).toBe('/path')

    const eexist = new EEXIST(undefined, '/exists')
    expect(eexist.code).toBe('EEXIST')
    expect(eexist.path).toBe('/exists')
  })
})
