/**
 * @fileoverview Tests for GitModule - DO Integration Module
 *
 * These tests verify the GitModule class that integrates with dotdo's
 * WorkflowContext, providing $.git.sync(), $.git.push(), and $.git.binding
 * functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from '../../src/do/GitModule'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock FsCapability for testing filesystem operations
 */
class MockFsCapability implements FsCapability {
  private files: Map<string, string | Buffer> = new Map()
  private dirs: Set<string> = new Set()

  async readFile(path: string): Promise<string | Buffer> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.files.set(path, content)
  }

  async readDir(path: string): Promise<string[]> {
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
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
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
 * Mock R2 Bucket for testing object storage operations
 */
class MockR2Bucket implements R2BucketLike {
  private objects: Map<string, ArrayBuffer> = new Map()

  async get(key: string): Promise<R2ObjectLike | null> {
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
    this.objects.set(key, buffer)
    return new MockR2Object(key, buffer)
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike> {
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
  }

  _listKeys(): string[] {
    return Array.from(this.objects.keys())
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('GitModule', () => {
  let mockFs: MockFsCapability
  let mockR2: MockR2Bucket
  let gitModule: GitModule

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockR2 = new MockR2Bucket()
    gitModule = new GitModule({
      repo: 'test-org/test-repo',
      branch: 'main',
      r2: mockR2,
      fs: mockFs,
    })
  })

  describe('constructor', () => {
    it('should create instance with required options', () => {
      const module = new GitModule({
        repo: 'org/repo',
      })
      expect(module).toBeInstanceOf(GitModule)
      expect(module.name).toBe('git')
    })

    it('should use default branch if not specified', () => {
      const module = new GitModule({
        repo: 'org/repo',
      })
      expect(module.binding.branch).toBe('main')
    })

    it('should use specified branch', () => {
      const module = new GitModule({
        repo: 'org/repo',
        branch: 'develop',
      })
      expect(module.binding.branch).toBe('develop')
    })

    it('should set repository identifier', () => {
      expect(gitModule.binding.repo).toBe('test-org/test-repo')
    })
  })

  describe('binding property', () => {
    it('should return correct binding structure', () => {
      const binding = gitModule.binding
      expect(binding).toHaveProperty('repo')
      expect(binding).toHaveProperty('branch')
      expect(binding).toHaveProperty('commit')
      expect(binding).toHaveProperty('path')
    })

    it('should have undefined commit initially', () => {
      expect(gitModule.binding.commit).toBeUndefined()
    })

    it('should have lastSync undefined initially', () => {
      expect(gitModule.binding.lastSync).toBeUndefined()
    })
  })

  describe('sync()', () => {
    it('should fail without R2 bucket', async () => {
      const moduleNoR2 = new GitModule({
        repo: 'org/repo',
        fs: mockFs,
      })

      const result = await moduleNoR2.sync()
      expect(result.success).toBe(false)
      expect(result.error).toContain('R2 bucket not configured')
    })

    it('should fail without FsCapability', async () => {
      const moduleNoFs = new GitModule({
        repo: 'org/repo',
        r2: mockR2,
      })

      const result = await moduleNoFs.sync()
      expect(result.success).toBe(false)
      expect(result.error).toContain('Filesystem capability not available')
    })

    it('should succeed with empty repository', async () => {
      // No ref exists in R2
      const result = await gitModule.sync()
      expect(result.success).toBe(true)
      expect(result.objectsFetched).toBe(0)
      expect(result.filesWritten).toBe(0)
    })

    it('should update lastSync after successful sync', async () => {
      const before = gitModule.binding.lastSync
      await gitModule.sync()
      const after = gitModule.binding.lastSync
      expect(after).toBeInstanceOf(Date)
      expect(before).toBeUndefined()
    })
  })

  describe('push()', () => {
    it('should fail without R2 bucket', async () => {
      const moduleNoR2 = new GitModule({
        repo: 'org/repo',
      })

      const result = await moduleNoR2.push()
      expect(result.success).toBe(false)
      expect(result.error).toContain('R2 bucket not configured')
    })

    it('should fail without commits', async () => {
      const result = await gitModule.push()
      expect(result.success).toBe(false)
      expect(result.error).toContain('No commits to push')
    })

    it('should succeed after committing', async () => {
      // Stage and commit
      await gitModule.add('test.txt')
      await gitModule.commit('Test commit')

      const result = await gitModule.push()
      expect(result.success).toBe(true)
      expect(result.commit).toBeTruthy()
    })

    it('should update R2 ref after push', async () => {
      await gitModule.add('test.txt')
      await gitModule.commit('Test commit')
      await gitModule.push()

      const refKey = 'git/objects/refs/heads/main'
      const refData = mockR2._getObject(refKey)
      expect(refData).toBeTruthy()
    })
  })

  describe('status()', () => {
    it('should return branch name', async () => {
      const status = await gitModule.status()
      expect(status.branch).toBe('main')
    })

    it('should return empty staged files initially', async () => {
      const status = await gitModule.status()
      expect(status.staged).toEqual([])
    })

    it('should be clean initially', async () => {
      const status = await gitModule.status()
      expect(status.clean).toBe(true)
    })

    it('should show staged files after add()', async () => {
      await gitModule.add('test.txt')
      const status = await gitModule.status()
      expect(status.staged).toContain('test.txt')
      expect(status.clean).toBe(false)
    })
  })

  describe('add()', () => {
    it('should stage a single file', async () => {
      await gitModule.add('file.txt')
      const status = await gitModule.status()
      expect(status.staged).toContain('file.txt')
    })

    it('should stage multiple files from array', async () => {
      await gitModule.add(['a.txt', 'b.txt', 'c.txt'])
      const status = await gitModule.status()
      expect(status.staged).toContain('a.txt')
      expect(status.staged).toContain('b.txt')
      expect(status.staged).toContain('c.txt')
    })

    it('should not duplicate staged files', async () => {
      await gitModule.add('file.txt')
      await gitModule.add('file.txt')
      const status = await gitModule.status()
      expect(status.staged.filter((f) => f === 'file.txt').length).toBe(1)
    })
  })

  describe('commit()', () => {
    it('should fail without staged files', async () => {
      await expect(gitModule.commit('Empty commit')).rejects.toThrow('Nothing to commit')
    })

    it('should succeed with staged files', async () => {
      await gitModule.add('test.txt')
      const result = await gitModule.commit('Test commit')
      expect(result).toHaveProperty('hash')
      expect((result as { hash: string }).hash).toMatch(/^[a-f0-9]{40}$/)
    })

    it('should clear staged files after commit', async () => {
      await gitModule.add('test.txt')
      await gitModule.commit('Test commit')
      const status = await gitModule.status()
      expect(status.staged).toEqual([])
    })

    it('should update binding.commit after commit', async () => {
      await gitModule.add('test.txt')
      const result = await gitModule.commit('Test commit')
      expect(gitModule.binding.commit).toBe((result as { hash: string }).hash)
    })
  })

  describe('log()', () => {
    it('should return empty array with no commits', async () => {
      const commits = await gitModule.log()
      expect(commits).toEqual([])
    })

    it('should return current commit after committing', async () => {
      await gitModule.add('test.txt')
      await gitModule.commit('Test commit')
      const commits = await gitModule.log()
      expect(commits.length).toBe(1)
      expect(commits[0].hash).toBe(gitModule.binding.commit)
    })
  })

  describe('diff()', () => {
    it('should return placeholder diff', async () => {
      const diffOutput = await gitModule.diff()
      expect(diffOutput).toContain('diff')
    })
  })

  describe('pull()', () => {
    it('should call sync internally', async () => {
      // pull() is an alias for sync()
      await expect(gitModule.pull()).resolves.toBeUndefined()
    })
  })

  describe('lifecycle methods', () => {
    it('should have initialize method', async () => {
      await expect(gitModule.initialize()).resolves.toBeUndefined()
    })

    it('should have dispose method', async () => {
      await gitModule.add('test.txt')
      await gitModule.dispose()
      const status = await gitModule.status()
      expect(status.staged).toEqual([])
    })
  })
})

describe('createGitModule factory', () => {
  it('should create GitModule instance', () => {
    const module = createGitModule({
      repo: 'org/repo',
    })
    expect(module).toBeInstanceOf(GitModule)
  })

  it('should pass options correctly', () => {
    const module = createGitModule({
      repo: 'test/repo',
      branch: 'feature',
      path: '/src',
    })
    expect(module.binding.repo).toBe('test/repo')
    expect(module.binding.branch).toBe('feature')
    expect(module.binding.path).toBe('/src')
  })
})

describe('isGitModule type guard', () => {
  it('should return true for GitModule instance', () => {
    const module = new GitModule({ repo: 'org/repo' })
    expect(isGitModule(module)).toBe(true)
  })

  it('should return false for plain object', () => {
    const obj = { name: 'git' }
    expect(isGitModule(obj)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isGitModule(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isGitModule(undefined)).toBe(false)
  })
})

describe('GitModule integration with FsCapability', () => {
  let mockFs: MockFsCapability
  let mockR2: MockR2Bucket
  let gitModule: GitModule

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockR2 = new MockR2Bucket()
    gitModule = new GitModule({
      repo: 'test-org/test-repo',
      branch: 'main',
      r2: mockR2,
      fs: mockFs,
    })
  })

  it('should depend on FsCapability for file operations', () => {
    // The GitModule uses FsCapability for writing synced files
    expect(gitModule).toBeDefined()
  })

  it('should require FsCapability for sync', async () => {
    const moduleNoFs = new GitModule({
      repo: 'org/repo',
      r2: mockR2,
    })

    const result = await moduleNoFs.sync()
    expect(result.success).toBe(false)
  })
})

describe('GitModule R2 integration', () => {
  let mockFs: MockFsCapability
  let mockR2: MockR2Bucket
  let gitModule: GitModule

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockR2 = new MockR2Bucket()
    gitModule = new GitModule({
      repo: 'test-repo',
      branch: 'main',
      r2: mockR2,
      fs: mockFs,
      objectPrefix: 'git/objects',
    })
  })

  it('should use R2 as global object store', () => {
    // GitModule uses R2 for storing/retrieving git objects
    expect(gitModule).toBeDefined()
  })

  it('should fetch from R2 during sync', async () => {
    // Set up a ref in R2
    const commitSha = 'a'.repeat(40)
    mockR2._setObject('git/objects/refs/heads/main', commitSha)

    const result = await gitModule.sync()
    // It will try to fetch but the commit object won't exist
    expect(result.success).toBe(true)
  })

  it('should write to R2 during push', async () => {
    await gitModule.add('test.txt')
    await gitModule.commit('Test commit')
    await gitModule.push()

    const keys = mockR2._listKeys()
    expect(keys.some((k) => k.includes('refs/heads/main'))).toBe(true)
  })

  it('should push git objects (blob, tree, commit) to R2', async () => {
    // Add a file with content
    mockFs._setFile('/test.txt', 'Hello, World!')

    await gitModule.add('/test.txt')
    const commitResult = await gitModule.commit('Add test file')
    const pushResult = await gitModule.push()

    expect(pushResult.success).toBe(true)
    // Should have pushed at least 3 objects: blob, tree, commit
    expect(pushResult.objectsPushed).toBeGreaterThanOrEqual(3)

    // Check that objects were stored in R2 using the standard git object path format
    const keys = mockR2._listKeys()

    // Verify ref was updated
    expect(keys.some((k) => k.includes('refs/heads/main'))).toBe(true)

    // Verify objects are stored using the two-character prefix directory structure
    const objectKeys = keys.filter((k) => k.match(/git\/objects\/[a-f0-9]{2}\/[a-f0-9]{38}/))
    expect(objectKeys.length).toBeGreaterThanOrEqual(3)

    // The commit SHA should match what was returned
    expect(pushResult.commit).toBe((commitResult as { hash: string }).hash)
  })

  it('should only push new objects on subsequent pushes', async () => {
    // First commit and push
    mockFs._setFile('/file1.txt', 'Content 1')
    await gitModule.add('/file1.txt')
    await gitModule.commit('First commit')
    const firstPush = await gitModule.push()
    expect(firstPush.objectsPushed).toBeGreaterThanOrEqual(3)

    // Second commit and push
    mockFs._setFile('/file2.txt', 'Content 2')
    await gitModule.add('/file2.txt')
    await gitModule.commit('Second commit')
    const secondPush = await gitModule.push()

    // Second push should also have new objects
    expect(secondPush.success).toBe(true)
    expect(secondPush.objectsPushed).toBeGreaterThanOrEqual(3)
  })
})
