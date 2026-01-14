/**
 * @fileoverview Comprehensive Integration Tests for GitModule with Durable Objects
 *
 * These tests verify the complete GitModule integration with dotdo DOs,
 * covering:
 * 1. GitModule lifecycle (initialization, lazy loading)
 * 2. Git operations through DO context
 * 3. R2 storage integration
 * 4. Error handling
 *
 * @module test/do/GitModule-integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
  type GitStorage,
  type GitRow,
  type GitBranchRow,
  type GitContentRow,
} from '../../src/do/GitModule'
import { withGit, hasGitCapability, type WithGitCapability } from '../../src/do/withGit'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock FsCapability with enhanced tracking capabilities
 */
class MockFsCapability implements FsCapability {
  private files: Map<string, string | Buffer> = new Map()
  private dirs: Set<string> = new Set()
  public operationLog: Array<{ op: string; path: string; args?: unknown }> = []

  async readFile(path: string): Promise<string | Buffer> {
    this.operationLog.push({ op: 'readFile', path })
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    return content
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.operationLog.push({ op: 'writeFile', path })
    this.files.set(path, content)
  }

  async readDir(path: string): Promise<string[]> {
    this.operationLog.push({ op: 'readDir', path })
    const entries: string[] = []
    const prefix = path.endsWith('/') ? path : path + '/'

    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length)
        const firstSegment = rest.split('/')[0]
        if (firstSegment && !entries.includes(firstSegment)) {
          entries.push(firstSegment)
        }
      }
    }

    return entries
  }

  async exists(path: string): Promise<boolean> {
    this.operationLog.push({ op: 'exists', path })
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.operationLog.push({ op: 'mkdir', path, args: options })
    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.dirs.add(current)
      }
    } else {
      this.dirs.add(path)
    }
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.operationLog.push({ op: 'rm', path, args: options })
    if (options?.recursive) {
      const prefix = path.endsWith('/') ? path : path + '/'
      for (const key of this.files.keys()) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key)
        }
      }
    } else {
      this.files.delete(path)
    }
    this.dirs.delete(path)
  }

  // Test helpers
  _setFile(path: string, content: string | Buffer): void {
    this.files.set(path, content)
  }

  _getFile(path: string): string | Buffer | undefined {
    return this.files.get(path)
  }

  _clear(): void {
    this.files.clear()
    this.dirs.clear()
    this.operationLog = []
  }

  _listFiles(): string[] {
    return Array.from(this.files.keys())
  }
}

/**
 * Mock R2Object for testing
 */
class MockR2Object implements R2ObjectLike {
  constructor(
    public key: string,
    private data: ArrayBuffer
  ) {}

  get size(): number {
    return this.data.byteLength
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data)
  }
}

/**
 * Mock R2 Bucket with operation tracking
 */
class MockR2Bucket implements R2BucketLike {
  private objects: Map<string, ArrayBuffer> = new Map()
  public operationLog: Array<{ op: string; key: string; size?: number }> = []

  async get(key: string): Promise<R2ObjectLike | null> {
    this.operationLog.push({ op: 'get', key })
    const data = this.objects.get(key)
    if (!data) return null
    return new MockR2Object(key, data)
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike> {
    let buffer: ArrayBuffer
    if (typeof value === 'string') {
      buffer = new TextEncoder().encode(value).buffer
    } else if (value instanceof Uint8Array) {
      buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    } else {
      buffer = value
    }
    this.operationLog.push({ op: 'put', key, size: buffer.byteLength })
    this.objects.set(key, buffer)
    return new MockR2Object(key, buffer)
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.operationLog.push({ op: 'delete', key: k })
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike> {
    this.operationLog.push({ op: 'list', key: options?.prefix ?? '' })
    const result: R2ObjectLike[] = []
    for (const [key, data] of this.objects) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.push(new MockR2Object(key, data))
      }
    }
    return {
      objects: result.slice(0, options?.limit ?? result.length),
      truncated: false,
    }
  }

  // Test helpers
  _setObject(key: string, data: string | ArrayBuffer): void {
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data
    this.objects.set(key, buffer)
  }

  _getObject(key: string): ArrayBuffer | undefined {
    return this.objects.get(key)
  }

  _clear(): void {
    this.objects.clear()
    this.operationLog = []
  }

  _listKeys(): string[] {
    return Array.from(this.objects.keys())
  }
}

/**
 * Mock GitStorage with enhanced tracking
 */
class MockGitStorage implements GitStorage {
  private gitTable: Map<number, GitRow> = new Map()
  private gitBranchesTable: Map<number, GitBranchRow> = new Map()
  private gitContentTable: Map<number, GitContentRow> = new Map()
  private autoIncrement = { git: 1, git_branches: 1, git_content: 1 }
  public queryLog: string[] = []

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.queryLog.push(query)

      // Handle SELECT id, commit, last_sync FROM git WHERE repo = ?
      if (query.includes('SELECT id, commit, last_sync FROM git WHERE repo =')) {
        const repo = params[0] as string
        for (const row of this.gitTable.values()) {
          if (row.repo === repo) {
            return { toArray: () => [{ id: row.id, commit: row.commit, last_sync: row.last_sync }] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT id FROM git WHERE repo = ?
      if (query.includes('SELECT id FROM git WHERE repo =')) {
        const repo = params[0] as string
        for (const row of this.gitTable.values()) {
          if (row.repo === repo) {
            return { toArray: () => [{ id: row.id }] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT path FROM git_content WHERE repo_id = ? AND status = ?
      if (query.includes('SELECT path FROM git_content WHERE repo_id =') && query.includes('status =')) {
        const repoId = params[0] as number
        const status = params[1] as string
        const results: { path: string }[] = []
        for (const row of this.gitContentTable.values()) {
          if (row.repo_id === repoId && row.status === status) {
            results.push({ path: row.path })
          }
        }
        return { toArray: () => results }
      }

      // Handle INSERT INTO git_branches
      if (query.includes('INSERT INTO git_branches')) {
        const id = this.autoIncrement.git_branches++
        const row: GitBranchRow = {
          id,
          repo_id: params[0] as number,
          name: params[1] as string,
          head: null,
          upstream: null,
          tracking: 1,
          ahead: 0,
          behind: 0,
          created_at: params[2] as number | null,
          updated_at: params[3] as number | null,
        }
        this.gitBranchesTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle INSERT INTO git_content (with file_id for shared files table integration)
      if (query.includes('INSERT INTO git_content')) {
        const repoId = params[0] as number
        const fileId = params[1] as number | null
        const path = params[2] as string

        for (const [id, row] of this.gitContentTable) {
          if (row.repo_id === repoId && row.path === path) {
            row.status = 'staged'
            row.file_id = params[5] as number | null
            row.updated_at = params[6] as number | null
            return { toArray: () => [] }
          }
        }

        const id = this.autoIncrement.git_content++
        const row: GitContentRow = {
          id,
          repo_id: repoId,
          file_id: fileId,
          path,
          content: null,
          mode: '100644',
          status: 'staged',
          sha: null,
          created_at: params[3] as number | null,
          updated_at: params[4] as number | null,
        }
        this.gitContentTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle INSERT INTO git (base table)
      if (query.includes('INSERT INTO git (') || query.includes('INSERT INTO git\n')) {
        const id = this.autoIncrement.git++
        const row: GitRow = {
          id,
          repo: params[0] as string,
          path: params[1] as string | null,
          branch: params[2] as string,
          commit: null,
          last_sync: null,
          object_prefix: params[3] as string,
          created_at: params[4] as number | null,
          updated_at: params[5] as number | null,
        }
        this.gitTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle UPDATE git SET commit = ?, last_sync = ?, updated_at = ? WHERE id = ?
      if (query.includes('UPDATE git SET commit =') && query.includes('last_sync =')) {
        const commit = params[0] as string | null
        const lastSync = params[1] as number
        const updatedAt = params[2] as number
        const id = params[3] as number
        const row = this.gitTable.get(id)
        if (row) {
          row.commit = commit
          row.last_sync = lastSync
          row.updated_at = updatedAt
        }
        return { toArray: () => [] }
      }

      // Handle UPDATE git SET commit = ?, updated_at = ? WHERE id = ?
      if (query.includes('UPDATE git SET commit =') && !query.includes('last_sync =')) {
        const commit = params[0] as string
        const updatedAt = params[1] as number
        const id = params[2] as number
        const row = this.gitTable.get(id)
        if (row) {
          row.commit = commit
          row.updated_at = updatedAt
        }
        return { toArray: () => [] }
      }

      // Handle UPDATE git_branches SET head = ?, updated_at = ?
      if (query.includes('UPDATE git_branches SET head =')) {
        const head = params[0] as string
        const updatedAt = params[1] as number
        const repoId = params[2] as number
        const name = params[3] as string
        for (const row of this.gitBranchesTable.values()) {
          if (row.repo_id === repoId && row.name === name) {
            row.head = head
            row.updated_at = updatedAt
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE FROM git_content WHERE repo_id = ? AND status = 'staged'
      if (query.includes('DELETE FROM git_content WHERE repo_id =') && query.includes('staged')) {
        const repoId = params[0] as number
        for (const [id, row] of this.gitContentTable) {
          if (row.repo_id === repoId && row.status === 'staged') {
            this.gitContentTable.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getGitRow(repo: string): GitRow | undefined {
    for (const row of this.gitTable.values()) {
      if (row.repo === repo) return row
    }
    return undefined
  }

  getGitBranchRow(repoId: number, name: string): GitBranchRow | undefined {
    for (const row of this.gitBranchesTable.values()) {
      if (row.repo_id === repoId && row.name === name) return row
    }
    return undefined
  }

  getGitContentRows(repoId: number): GitContentRow[] {
    const results: GitContentRow[] = []
    for (const row of this.gitContentTable.values()) {
      if (row.repo_id === repoId) results.push(row)
    }
    return results
  }

  clear(): void {
    this.gitTable.clear()
    this.gitBranchesTable.clear()
    this.gitContentTable.clear()
    this.autoIncrement = { git: 1, git_branches: 1, git_content: 1 }
    this.queryLog = []
  }
}

/**
 * Mock DO base class for testing mixin integration
 */
class MockDO {
  public readonly id: string
  public readonly env: Record<string, unknown>
  public readonly $: Record<string, unknown>

  constructor(id?: string, env?: Record<string, unknown>) {
    this.id = id ?? 'test-do-id'
    this.env = env ?? {}
    this.$ = {}
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response('OK')
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('GitModule DO Integration', () => {
  describe('Lifecycle - Initialization', () => {
    let mockFs: MockFsCapability
    let mockR2: MockR2Bucket
    let mockStorage: MockGitStorage

    beforeEach(() => {
      mockFs = new MockFsCapability()
      mockR2 = new MockR2Bucket()
      mockStorage = new MockGitStorage()
    })

    it('should initialize with minimal configuration', () => {
      const git = new GitModule({ repo: 'org/repo' })

      expect(git).toBeInstanceOf(GitModule)
      expect(git.name).toBe('git')
      expect(git.binding.repo).toBe('org/repo')
      expect(git.binding.branch).toBe('main')
    })

    it('should initialize with full configuration', () => {
      const git = new GitModule({
        repo: 'my-org/my-repo',
        branch: 'develop',
        path: 'packages/core',
        r2: mockR2,
        fs: mockFs,
        objectPrefix: 'custom/prefix',
        storage: mockStorage,
      })

      expect(git.binding.repo).toBe('my-org/my-repo')
      expect(git.binding.branch).toBe('develop')
      expect(git.binding.path).toBe('packages/core')
    })

    it('should call initialize() without error', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await expect(git.initialize()).resolves.toBeUndefined()
    })

    it('should create database records on first initialize with storage', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage: mockStorage,
      })

      await git.initialize()

      const row = mockStorage.getGitRow('org/repo')
      expect(row).toBeDefined()
      expect(row?.repo).toBe('org/repo')
      expect(row?.branch).toBe('main')
    })

    it('should load existing state on subsequent initializations', async () => {
      // First instance creates state
      const git1 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage: mockStorage,
      })
      await git1.initialize()
      await git1.add('file.ts')
      await git1.commit('Initial commit')
      const commitHash = git1.binding.commit

      // Second instance loads state
      const git2 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage: mockStorage,
      })
      await git2.initialize()

      expect(git2.binding.commit).toBe(commitHash)
    })

    it('should support dispose() lifecycle method', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('file.ts')

      const statusBefore = await git.status()
      expect(statusBefore.staged.length).toBe(1)

      await git.dispose()

      const statusAfter = await git.status()
      expect(statusAfter.staged.length).toBe(0)
    })
  })

  describe('Lifecycle - Lazy Loading', () => {
    it('should not perform heavy operations until needed', () => {
      const git = new GitModule({ repo: 'org/repo' })

      // Just creating the module shouldn't trigger operations
      expect(git.binding.commit).toBeUndefined()
      expect(git.binding.lastSync).toBeUndefined()
    })

    it('should lazily initialize when using withGit mixin', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      // git property should exist
      expect(instance.git).toBeDefined()

      // Accessing git multiple times should return same instance
      const git1 = instance.git
      const git2 = instance.git
      expect(git1).toBe(git2)
    })

    it('should create separate instances for different DOs', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance1 = new DOWithGit('do-1')
      const instance2 = new DOWithGit('do-2')

      expect(instance1.git).not.toBe(instance2.git)
    })
  })

  describe('Git Operations through DO Context', () => {
    let mockFs: MockFsCapability
    let mockR2: MockR2Bucket
    let git: GitModule

    beforeEach(() => {
      mockFs = new MockFsCapability()
      mockR2 = new MockR2Bucket()
      git = new GitModule({
        repo: 'test-org/test-repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
      })
    })

    describe('status()', () => {
      it('should return initial clean status', async () => {
        const status = await git.status()

        expect(status.branch).toBe('main')
        expect(status.head).toBeUndefined()
        expect(status.staged).toEqual([])
        expect(status.unstaged).toEqual([])
        expect(status.clean).toBe(true)
      })

      it('should reflect staged files', async () => {
        await git.add('src/index.ts')
        await git.add('src/utils.ts')

        const status = await git.status()

        expect(status.staged).toContain('src/index.ts')
        expect(status.staged).toContain('src/utils.ts')
        expect(status.clean).toBe(false)
      })

      it('should reflect head commit after commit', async () => {
        await git.add('file.ts')
        const result = await git.commit('Test commit')
        const hash = typeof result === 'string' ? result : result.hash

        const status = await git.status()

        expect(status.head).toBe(hash)
        expect(status.staged).toEqual([])
        expect(status.clean).toBe(true)
      })
    })

    describe('add()', () => {
      it('should stage single file', async () => {
        await git.add('file.ts')

        const status = await git.status()
        expect(status.staged).toEqual(['file.ts'])
      })

      it('should stage multiple files from array', async () => {
        await git.add(['a.ts', 'b.ts', 'c.ts'])

        const status = await git.status()
        expect(status.staged).toHaveLength(3)
        expect(status.staged).toContain('a.ts')
        expect(status.staged).toContain('b.ts')
        expect(status.staged).toContain('c.ts')
      })

      it('should not duplicate staged files', async () => {
        await git.add('file.ts')
        await git.add('file.ts')
        await git.add('file.ts')

        const status = await git.status()
        expect(status.staged).toEqual(['file.ts'])
      })

      it('should handle paths with directories', async () => {
        await git.add('src/components/Button.tsx')

        const status = await git.status()
        expect(status.staged).toContain('src/components/Button.tsx')
      })
    })

    describe('commit()', () => {
      it('should create commit with valid SHA-1 hash', async () => {
        await git.add('file.ts')
        const result = await git.commit('Add file')

        const hash = typeof result === 'string' ? result : result.hash
        expect(hash).toMatch(/^[a-f0-9]{40}$/)
      })

      it('should clear staged files after commit', async () => {
        await git.add('file.ts')
        await git.commit('Add file')

        const status = await git.status()
        expect(status.staged).toEqual([])
      })

      it('should update binding.commit', async () => {
        expect(git.binding.commit).toBeUndefined()

        await git.add('file.ts')
        const result = await git.commit('Add file')
        const hash = typeof result === 'string' ? result : result.hash

        expect(git.binding.commit).toBe(hash)
      })

      it('should fail without staged files', async () => {
        await expect(git.commit('Empty commit')).rejects.toThrow('Nothing to commit')
      })

      it('should read file content from filesystem', async () => {
        mockFs._setFile('/src/index.ts', 'export const hello = "world"')

        await git.add('/src/index.ts')
        await git.commit('Add index.ts')

        // Verify fs was accessed
        expect(mockFs.operationLog.some(op => op.op === 'readFile' && op.path === '/src/index.ts')).toBe(true)
      })

      it('should create parent commits correctly', async () => {
        await git.add('file1.ts')
        const result1 = await git.commit('First commit')
        const hash1 = typeof result1 === 'string' ? result1 : result1.hash

        await git.add('file2.ts')
        const result2 = await git.commit('Second commit')
        const hash2 = typeof result2 === 'string' ? result2 : result2.hash

        expect(hash1).not.toBe(hash2)
        expect(git.binding.commit).toBe(hash2)
      })
    })

    describe('log()', () => {
      it('should return empty for new repo', async () => {
        const log = await git.log()
        expect(log).toEqual([])
      })

      it('should return current commit', async () => {
        await git.add('file.ts')
        await git.commit('Test commit')

        const log = await git.log()

        expect(log.length).toBe(1)
        expect(log[0].hash).toBe(git.binding.commit)
      })
    })

    describe('diff()', () => {
      it('should return diff placeholder', async () => {
        const diff = await git.diff()
        expect(diff).toContain('diff')
      })
    })
  })

  describe('R2 Storage Integration', () => {
    let mockFs: MockFsCapability
    let mockR2: MockR2Bucket
    let git: GitModule

    beforeEach(() => {
      mockFs = new MockFsCapability()
      mockR2 = new MockR2Bucket()
      git = new GitModule({
        repo: 'test-org/test-repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
        objectPrefix: 'git/objects',
      })
    })

    describe('sync()', () => {
      it('should fail without R2 bucket', async () => {
        const gitNoR2 = new GitModule({
          repo: 'org/repo',
          fs: mockFs,
        })

        const result = await gitNoR2.sync()

        expect(result.success).toBe(false)
        expect(result.error).toBe('R2 bucket not configured')
      })

      it('should fail without FsCapability', async () => {
        const gitNoFs = new GitModule({
          repo: 'org/repo',
          r2: mockR2,
        })

        const result = await gitNoFs.sync()

        expect(result.success).toBe(false)
        expect(result.error).toBe('Filesystem capability not available')
      })

      it('should succeed with empty repository', async () => {
        const result = await git.sync()

        expect(result.success).toBe(true)
        expect(result.objectsFetched).toBe(0)
        expect(result.filesWritten).toBe(0)
        expect(result.commit).toBeUndefined()
      })

      it('should update lastSync timestamp', async () => {
        expect(git.binding.lastSync).toBeUndefined()

        await git.sync()

        expect(git.binding.lastSync).toBeInstanceOf(Date)
      })

      it('should fetch from R2 when ref exists', async () => {
        const commitSha = 'a'.repeat(40)
        mockR2._setObject('git/objects/refs/heads/main', commitSha)

        const result = await git.sync()

        expect(result.success).toBe(true)
        expect(mockR2.operationLog.some(op => op.op === 'get' && op.key.includes('refs/heads/main'))).toBe(true)
      })

      it('should handle sync errors gracefully', async () => {
        // Set up R2 to throw error
        const errorR2: R2BucketLike = {
          get: async () => { throw new Error('R2 unavailable') },
          put: async () => { throw new Error('R2 unavailable') },
          delete: async () => {},
          list: async () => ({ objects: [], truncated: false }),
        }

        const gitWithErrorR2 = new GitModule({
          repo: 'org/repo',
          r2: errorR2,
          fs: mockFs,
        })

        const result = await gitWithErrorR2.sync()

        expect(result.success).toBe(false)
        expect(result.error).toBe('R2 unavailable')
      })
    })

    describe('push()', () => {
      it('should fail without R2 bucket', async () => {
        const gitNoR2 = new GitModule({ repo: 'org/repo' })

        const result = await gitNoR2.push()

        expect(result.success).toBe(false)
        expect(result.error).toBe('R2 bucket not configured')
      })

      it('should fail without commits', async () => {
        const result = await git.push()

        expect(result.success).toBe(false)
        expect(result.error).toBe('No commits to push')
      })

      it('should push objects to R2 after commit', async () => {
        mockFs._setFile('/test.txt', 'Hello, World!')

        await git.add('/test.txt')
        await git.commit('Add test file')
        const result = await git.push()

        expect(result.success).toBe(true)
        expect(result.objectsPushed).toBeGreaterThanOrEqual(3) // blob, tree, commit
      })

      it('should update ref in R2', async () => {
        await git.add('file.ts')
        const commitResult = await git.commit('Test commit')
        const commitHash = typeof commitResult === 'string' ? commitResult : commitResult.hash

        await git.push()

        const refKey = 'git/objects/refs/heads/main'
        const refData = mockR2._getObject(refKey)
        expect(refData).toBeDefined()

        const refContent = new TextDecoder().decode(new Uint8Array(refData!))
        expect(refContent).toBe(commitHash)
      })

      it('should store objects using correct path format', async () => {
        await git.add('file.ts')
        await git.commit('Test')
        await git.push()

        const keys = mockR2._listKeys()
        // Check for objects stored in git/objects/xx/xxxxxx format
        const objectKeys = keys.filter(k => k.match(/git\/objects\/[a-f0-9]{2}\/[a-f0-9]{38}/))
        expect(objectKeys.length).toBeGreaterThanOrEqual(3)
      })

      it('should clear pending objects after push', async () => {
        await git.add('file1.ts')
        await git.commit('Commit 1')
        const push1 = await git.push()

        await git.add('file2.ts')
        await git.commit('Commit 2')
        const push2 = await git.push()

        // Both pushes should succeed
        expect(push1.success).toBe(true)
        expect(push2.success).toBe(true)
      })

      it('should handle push errors gracefully', async () => {
        const errorR2: R2BucketLike = {
          get: async () => null,
          put: async () => { throw new Error('Storage quota exceeded') },
          delete: async () => {},
          list: async () => ({ objects: [], truncated: false }),
        }

        const gitWithErrorR2 = new GitModule({
          repo: 'org/repo',
          r2: errorR2,
          fs: mockFs,
        })

        await gitWithErrorR2.add('file.ts')
        await gitWithErrorR2.commit('Test')
        const result = await gitWithErrorR2.push()

        expect(result.success).toBe(false)
        expect(result.error).toBe('Storage quota exceeded')
      })
    })

    describe('pull()', () => {
      it('should be alias for sync', async () => {
        await expect(git.pull()).resolves.toBeUndefined()
      })

      it('should throw when sync fails', async () => {
        const gitNoR2 = new GitModule({ repo: 'org/repo' })

        await expect(gitNoR2.pull()).rejects.toThrow('R2 bucket not configured')
      })
    })

    describe('Cross-DO Synchronization', () => {
      it('should allow syncing changes between DO instances via R2', async () => {
        // DO instance 1 makes changes and pushes
        const git1 = new GitModule({
          repo: 'shared/repo',
          branch: 'main',
          r2: mockR2,
          fs: mockFs,
        })

        mockFs._setFile('/shared.txt', 'Shared content')
        await git1.add('/shared.txt')
        await git1.commit('Add shared file')
        await git1.push()

        const pushedCommit = git1.binding.commit

        // DO instance 2 syncs
        const mockFs2 = new MockFsCapability()
        const git2 = new GitModule({
          repo: 'shared/repo',
          branch: 'main',
          r2: mockR2,
          fs: mockFs2,
        })

        const syncResult = await git2.sync()

        expect(syncResult.success).toBe(true)
        expect(git2.binding.commit).toBe(pushedCommit)
      })
    })
  })

  describe('Error Handling', () => {
    describe('Configuration Errors', () => {
      it('should work without optional dependencies', () => {
        const git = new GitModule({ repo: 'org/repo' })

        expect(git).toBeInstanceOf(GitModule)
        expect(git.binding.repo).toBe('org/repo')
      })

      it('should handle missing R2 gracefully', async () => {
        const git = new GitModule({ repo: 'org/repo' })

        const syncResult = await git.sync()
        expect(syncResult.success).toBe(false)

        const pushResult = await git.push()
        expect(pushResult.success).toBe(false)
      })

      it('should handle missing fs gracefully', async () => {
        const mockR2 = new MockR2Bucket()
        const git = new GitModule({
          repo: 'org/repo',
          r2: mockR2,
        })

        const syncResult = await git.sync()
        expect(syncResult.success).toBe(false)
        expect(syncResult.error).toContain('Filesystem')
      })
    })

    describe('Operation Errors', () => {
      it('should reject commit without staged files', async () => {
        const git = new GitModule({ repo: 'org/repo' })

        await expect(git.commit('Empty')).rejects.toThrow('Nothing to commit')
      })

      it('should handle file read errors during commit', async () => {
        const mockFs = new MockFsCapability()
        const git = new GitModule({
          repo: 'org/repo',
          fs: mockFs,
        })

        // Add file that doesn't exist
        await git.add('/nonexistent.ts')
        const result = await git.commit('Commit missing file')

        // Should still succeed with placeholder/empty content
        expect(typeof result === 'string' ? result : result.hash).toMatch(/^[a-f0-9]{40}$/)
      })
    })

    describe('Storage Errors', () => {
      it('should handle database errors during initialize', async () => {
        const errorStorage: GitStorage = {
          sql: {
            exec: () => { throw new Error('Database locked') }
          }
        }

        const git = new GitModule({
          repo: 'org/repo',
          storage: errorStorage,
        })

        await expect(git.initialize()).rejects.toThrow('Database locked')
      })
    })
  })

  describe('withGit Mixin Integration', () => {
    let mockR2: MockR2Bucket

    beforeEach(() => {
      mockR2 = new MockR2Bucket()
    })

    it('should add git capability to DO class', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance.git).toBeInstanceOf(GitModule)
      expect(hasGitCapability(instance)).toBe(true)
    })

    it('should preserve DO properties', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit('custom-id', { KEY: 'value' })

      expect(instance.id).toBe('custom-id')
      expect(instance.env).toEqual({ KEY: 'value' })
    })

    it('should resolve R2 from env binding', () => {
      const DOWithGit = withGit(MockDO, {
        repo: 'org/repo',
        r2Binding: 'GIT_R2',
      })
      const instance = new DOWithGit('id', { GIT_R2: mockR2 })

      expect(instance.git).toBeInstanceOf(GitModule)
    })

    it('should pass configuration to GitModule', () => {
      const DOWithGit = withGit(MockDO, {
        repo: 'my-org/my-repo',
        branch: 'develop',
        path: 'packages/core',
        objectPrefix: 'custom/prefix',
      })
      const instance = new DOWithGit()

      expect(instance.git.binding.repo).toBe('my-org/my-repo')
      expect(instance.git.binding.branch).toBe('develop')
      expect(instance.git.binding.path).toBe('packages/core')
    })

    it('should support hasGitCapability type guard', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit()
      const plainDO = new MockDO()

      expect(hasGitCapability(instance)).toBe(true)
      expect(hasGitCapability(plainDO)).toBe(false)
      expect(hasGitCapability(null)).toBe(false)
      expect(hasGitCapability(undefined)).toBe(false)
    })

    it('should maintain instanceof relationship', () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      expect(instance).toBeInstanceOf(MockDO)
    })

    it('should provide git operations via mixin', async () => {
      const DOWithGit = withGit(MockDO, { repo: 'org/repo' })
      const instance = new DOWithGit()

      await instance.git.add('file.ts')
      const status = await instance.git.status()

      expect(status.staged).toContain('file.ts')
    })
  })

  describe('Factory and Type Guards', () => {
    it('createGitModule should create GitModule instance', () => {
      const git = createGitModule({
        repo: 'org/repo',
        branch: 'main',
      })

      expect(git).toBeInstanceOf(GitModule)
      expect(git.binding.repo).toBe('org/repo')
    })

    it('isGitModule should correctly identify GitModule', () => {
      const git = new GitModule({ repo: 'org/repo' })

      expect(isGitModule(git)).toBe(true)
      expect(isGitModule(null)).toBe(false)
      expect(isGitModule(undefined)).toBe(false)
      expect(isGitModule({})).toBe(false)
      expect(isGitModule({ name: 'git' })).toBe(false)
    })
  })

  describe('Complete Workflow Integration', () => {
    it('should support full git workflow: init -> add -> commit -> push -> sync', async () => {
      const mockFs = new MockFsCapability()
      const mockR2 = new MockR2Bucket()
      const mockStorage = new MockGitStorage()

      // Create DO with git capability
      const git = new GitModule({
        repo: 'workflow-test/repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
        storage: mockStorage,
      })

      // Step 1: Initialize
      await git.initialize()
      expect(mockStorage.getGitRow('workflow-test/repo')).toBeDefined()

      // Step 2: Create file and add
      mockFs._setFile('/src/app.ts', 'export const app = () => "Hello"')
      await git.add('/src/app.ts')

      // Step 3: Check status
      let status = await git.status()
      expect(status.staged).toContain('/src/app.ts')
      expect(status.clean).toBe(false)

      // Step 4: Commit
      const commitResult = await git.commit('Initial commit')
      const commitHash = typeof commitResult === 'string' ? commitResult : commitResult.hash

      // Step 5: Verify commit
      status = await git.status()
      expect(status.staged).toEqual([])
      expect(status.head).toBe(commitHash)
      expect(status.clean).toBe(true)

      // Step 6: Push to R2
      const pushResult = await git.push()
      expect(pushResult.success).toBe(true)
      expect(pushResult.commit).toBe(commitHash)

      // Step 7: Verify R2 state
      const refKey = 'git/objects/refs/heads/main'
      const refData = mockR2._getObject(refKey)
      expect(refData).toBeDefined()

      // Step 8: Sync (should be no-op with same commit)
      const syncResult = await git.sync()
      expect(syncResult.success).toBe(true)
      expect(git.binding.commit).toBe(commitHash)

      // Step 9: Cleanup
      await git.dispose()
    })

    it('should support multiple commits and pushes', async () => {
      const mockFs = new MockFsCapability()
      const mockR2 = new MockR2Bucket()

      const git = new GitModule({
        repo: 'multi-commit/repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
      })

      // First commit
      mockFs._setFile('/file1.ts', 'content 1')
      await git.add('/file1.ts')
      const commit1 = await git.commit('First')
      await git.push()

      const hash1 = typeof commit1 === 'string' ? commit1 : commit1.hash

      // Second commit
      mockFs._setFile('/file2.ts', 'content 2')
      await git.add('/file2.ts')
      const commit2 = await git.commit('Second')
      await git.push()

      const hash2 = typeof commit2 === 'string' ? commit2 : commit2.hash

      // Third commit
      mockFs._setFile('/file3.ts', 'content 3')
      await git.add('/file3.ts')
      const commit3 = await git.commit('Third')
      await git.push()

      const hash3 = typeof commit3 === 'string' ? commit3 : commit3.hash

      // Verify progression
      expect(hash1).not.toBe(hash2)
      expect(hash2).not.toBe(hash3)
      expect(git.binding.commit).toBe(hash3)

      // Verify R2 has latest
      const refData = mockR2._getObject('git/objects/refs/heads/main')
      const refContent = new TextDecoder().decode(new Uint8Array(refData!))
      expect(refContent).toBe(hash3)
    })
  })
})
