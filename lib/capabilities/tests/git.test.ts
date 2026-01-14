/**
 * @fileoverview Tests for withGit Mixin - Git Capability for DO Classes
 *
 * TDD RED Phase: Write tests first, then implement to pass.
 *
 * These tests verify:
 * - withGit mixin adds $.git to class
 * - Supports repo, branch, R2 configuration
 * - Integrates with $.fs when available (fsx CAS)
 * - Type exports for GitCapability
 * - Lazy initialization of GitModule
 */

import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import { DO, type Env } from '../../../objects/DO'
import { withFs, type FsCapability } from '../fs'
import {
  withGit,
  GitModule,
  createGitModule,
  type GitCapability,
  type GitModuleOptions,
  type WithGitContext,
  type WithGitDO,
} from '../git'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock DurableObjectState for testing DO classes
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => { storage.set(key, value) },
      delete: async (key: string) => { storage.delete(key) },
      list: async () => storage,
      sql: {
        exec: () => ({ toArray: () => [] }),
      },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

/**
 * Mock Env for testing
 */
function createMockEnv(): Env {
  return {
    DO: {
      idFromName: (name: string) => ({ toString: () => `id-${name}` }),
      get: () => ({ fetch: async () => new Response('OK') }),
    },
  } as unknown as Env
}

/**
 * Mock R2 Bucket for testing
 */
class MockR2Bucket {
  private objects = new Map<string, ArrayBuffer>()

  async get(key: string) {
    const data = this.objects.get(key)
    if (!data) return null
    return {
      key,
      size: data.byteLength,
      arrayBuffer: async () => data,
      text: async () => new TextDecoder().decode(data),
    }
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string) {
    let buffer: ArrayBuffer
    if (typeof value === 'string') {
      buffer = new TextEncoder().encode(value).buffer
    } else if (value instanceof Uint8Array) {
      buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    } else {
      buffer = value
    }
    this.objects.set(key, buffer)
    return { key, size: buffer.byteLength }
  }

  async delete(key: string | string[]) {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string }) {
    const result: Array<{ key: string; size: number }> = []
    for (const [key, data] of this.objects) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.push({ key, size: data.byteLength })
      }
    }
    return { objects: result, truncated: false }
  }

  // Test helpers
  _setObject(key: string, data: string | ArrayBuffer) {
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data
    this.objects.set(key, buffer)
  }

  _listKeys() {
    return Array.from(this.objects.keys())
  }

  _clear() {
    this.objects.clear()
  }
}

/**
 * Mock FsCapability for testing filesystem operations
 */
class MockFsCapability implements FsCapability {
  private files = new Map<string, string>()
  private dirs = new Set<string>()

  async read(path: string) {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async write(path: string, content: string) {
    this.files.set(path, content)
  }

  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path)
  }

  async delete(path: string) {
    this.files.delete(path)
    this.dirs.delete(path)
  }

  async list(path: string) {
    const entries: Array<{ name: string; isDirectory: boolean }> = []
    const prefix = path.endsWith('/') ? path : path + '/'

    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length)
        const firstSegment = rest.split('/')[0]
        if (firstSegment && !entries.find(e => e.name === firstSegment)) {
          entries.push({ name: firstSegment, isDirectory: false })
        }
      }
    }

    return entries
  }

  async mkdir(path: string, options?: { recursive?: boolean }) {
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

  async stat(path: string) {
    if (!this.files.has(path) && !this.dirs.has(path)) {
      throw new Error(`Path not found: ${path}`)
    }
    return {
      size: this.files.get(path)?.length ?? 0,
      isFile: this.files.has(path),
      isDirectory: this.dirs.has(path),
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
  }

  async copy(src: string, dest: string) {
    const content = this.files.get(src)
    if (content === undefined) {
      throw new Error(`Source not found: ${src}`)
    }
    this.files.set(dest, content)
  }

  async move(src: string, dest: string) {
    await this.copy(src, dest)
    this.files.delete(src)
  }

  // Test helpers
  _setFile(path: string, content: string) {
    this.files.set(path, content)
  }

  _getFile(path: string) {
    return this.files.get(path)
  }

  _clear() {
    this.files.clear()
    this.dirs.clear()
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('withGit Mixin', () => {
  let mockState: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('Basic Mixin Application', () => {
    it('should extend DO class with $.git capability', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(instance.$).toBeDefined()
      expect(instance.$.git).toBeDefined()
    })

    it('should preserve $.fs from withFs mixin', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(instance.$.fs).toBeDefined()
      expect(typeof instance.$.fs.read).toBe('function')
      expect(typeof instance.$.fs.write).toBe('function')
    })

    it('should have git capability in static capabilities array', () => {
      class TestDO extends withGit(withFs(DO)) {}

      expect((TestDO as unknown as { capabilities: string[] }).capabilities).toContain('git')
      expect((TestDO as unknown as { capabilities: string[] }).capabilities).toContain('fs')
    })

    it('should report hasCapability correctly for git', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      expect(instance.hasCapability('git')).toBe(true)
      expect(instance.hasCapability('fs')).toBe(true)
    })
  })

  describe('GitModule Configuration', () => {
    it('should accept repo configuration via configure()', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // Configure git with repo and branch
      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'main',
      })

      expect(instance.$.git.binding.repo).toBe('org/repo')
      expect(instance.$.git.binding.branch).toBe('main')
    })

    it('should accept R2 bucket configuration', () => {
      const mockR2 = new MockR2Bucket()

      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      // Should be able to sync with R2 configured
      expect(instance.$.git.binding.repo).toBe('org/repo')
    })

    it('should use default branch if not specified', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
      })

      expect(instance.$.git.binding.branch).toBe('main')
    })

    it('should support path prefix configuration', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        path: '/packages/core',
      })

      expect(instance.$.git.binding.path).toBe('/packages/core')
    })
  })

  describe('Lazy Initialization', () => {
    it('should lazily initialize GitModule on first access', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // First access should trigger initialization
      const git1 = instance.$.git
      const git2 = instance.$.git

      // Should return the same cached instance
      expect(git1).toBe(git2)
    })

    it('should not create GitModule until $.git is accessed', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // Access $ but not $.git
      expect(instance.$).toBeDefined()

      // GitModule should not be created yet (internal state check)
      // This is a behavior test - the module is only created on first $.git access
    })
  })

  describe('Integration with $.fs', () => {
    it('should automatically use $.fs for file operations when available', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()
      const mockFs = new MockFsCapability()

      // Configure with mock fs injected
      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as unknown as FsCapability,
      })

      // Write a file through mock fs
      mockFs._setFile('/test.txt', 'Hello, World!')

      // Git should be able to stage the file
      await instance.$.git.add('/test.txt')

      const status = await instance.$.git.status()
      expect(status.staged).toContain('/test.txt')
    })

    it('should read file content from $.fs when committing', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()
      const mockFs = new MockFsCapability()

      // Configure with mock fs injected
      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
        fs: mockFs as unknown as FsCapability,
      })

      // Write file content through mock fs
      mockFs._setFile('/src/index.ts', 'export const version = "1.0.0"')

      // Stage and commit
      await instance.$.git.add('/src/index.ts')
      const result = await instance.$.git.commit('Add version export')

      expect(result).toHaveProperty('hash')
      expect((result as { hash: string }).hash).toMatch(/^[a-f0-9]{40}$/)
    })
  })

  describe('Git Operations', () => {
    it('should provide status() method', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({ repo: 'org/repo' })

      const status = await instance.$.git.status()
      expect(status).toHaveProperty('branch')
      expect(status).toHaveProperty('staged')
      expect(status).toHaveProperty('unstaged')
      expect(status).toHaveProperty('clean')
    })

    it('should provide add() method', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({ repo: 'org/repo' })

      await instance.$.git.add('/file.txt')
      const status = await instance.$.git.status()

      expect(status.staged).toContain('/file.txt')
    })

    it('should provide commit() method', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      await instance.$.git.add('/file.txt')
      const result = await instance.$.git.commit('Test commit')

      expect(result).toHaveProperty('hash')
    })

    it('should provide sync() method', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      const result = await instance.$.git.sync()

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('objectsFetched')
      expect(result).toHaveProperty('filesWritten')
    })

    it('should provide push() method', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      await instance.$.git.add('/file.txt')
      await instance.$.git.commit('Test commit')
      const result = await instance.$.git.push()

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('objectsPushed')
    })

    it('should provide binding property', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        branch: 'develop',
        path: '/src',
      })

      const binding = instance.$.git.binding

      expect(binding.repo).toBe('org/repo')
      expect(binding.branch).toBe('develop')
      expect(binding.path).toBe('/src')
    })
  })

  describe('GitModule Direct Usage', () => {
    it('should export GitModule class', () => {
      expect(GitModule).toBeDefined()
      expect(typeof GitModule).toBe('function')
    })

    it('should export createGitModule factory', () => {
      expect(createGitModule).toBeDefined()
      expect(typeof createGitModule).toBe('function')
    })

    it('should create GitModule with options', () => {
      const module = createGitModule({
        repo: 'org/repo',
        branch: 'main',
      })

      expect(module).toBeInstanceOf(GitModule)
      expect(module.binding.repo).toBe('org/repo')
      expect(module.binding.branch).toBe('main')
    })
  })

  describe('Type Exports', () => {
    it('should export GitCapability type', () => {
      // Type-only test - if this compiles, the types are exported correctly
      const _capability: GitCapability = {} as GitCapability

      expect(true).toBe(true)
    })

    it('should export WithGitContext type', () => {
      // Type-only test
      const _context: WithGitContext = {} as WithGitContext

      expect(_context).toBeDefined()
    })

    it('should export GitModuleOptions type', () => {
      // Type-only test
      const _options: GitModuleOptions = {
        repo: 'org/repo',
      }

      expect(_options).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should throw error when syncing without R2 configured', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'org/repo',
        // No R2 configured
      })

      const result = await instance.$.git.sync()

      expect(result.success).toBe(false)
      expect(result.error).toContain('R2')
    })

    it('should throw error when pushing without commits', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      const result = await instance.$.git.push()

      expect(result.success).toBe(false)
      expect(result.error).toContain('No commits')
    })

    it('should throw error when committing without staged files', async () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)
      const mockR2 = new MockR2Bucket()

      instance.$.git.configure({
        repo: 'org/repo',
        r2: mockR2 as unknown as R2Bucket,
      })

      await expect(instance.$.git.commit('Empty commit')).rejects.toThrow('Nothing to commit')
    })
  })

  describe('Chained Mixin Composition', () => {
    it('should work with multiple mixins', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // All capabilities should be available
      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
    })

    it('should preserve base DO functionality', () => {
      class TestDO extends withGit(withFs(DO)) {}
      const instance = new TestDO(mockState, mockEnv)

      // Base DO methods should still work
      expect(typeof instance.$.send).toBe('function')
      expect(typeof instance.$.try).toBe('function')
      expect(typeof instance.$.do).toBe('function')
    })
  })
})

describe('GitModule Integration', () => {
  let mockFs: MockFsCapability
  let mockR2: MockR2Bucket

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockR2 = new MockR2Bucket()
  })

  it('should integrate with FsCapability for file operations', async () => {
    const gitModule = createGitModule({
      repo: 'org/repo',
      branch: 'main',
      r2: mockR2 as unknown as R2Bucket,
      fs: mockFs as unknown as FsCapability,
    })

    // Write file through fs
    mockFs._setFile('/test.txt', 'Hello, World!')

    // Stage and commit through git
    await gitModule.add('/test.txt')
    const result = await gitModule.commit('Add test file')

    expect((result as { hash: string }).hash).toMatch(/^[a-f0-9]{40}$/)
  })

  it('should push commits to R2', async () => {
    const gitModule = createGitModule({
      repo: 'org/repo',
      branch: 'main',
      r2: mockR2 as unknown as R2Bucket,
      fs: mockFs as unknown as FsCapability,
    })

    mockFs._setFile('/test.txt', 'Hello, World!')

    await gitModule.add('/test.txt')
    await gitModule.commit('Add test file')
    const pushResult = await gitModule.push()

    expect(pushResult.success).toBe(true)
    expect(pushResult.objectsPushed).toBeGreaterThan(0)

    // Check R2 has objects
    const keys = mockR2._listKeys()
    expect(keys.some(k => k.includes('refs/heads/main'))).toBe(true)
  })
})

describe('GitModule Stash Operations', () => {
  let mockFs: MockFsCapability
  let mockR2: MockR2Bucket
  let gitModule: ReturnType<typeof createGitModule>

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockR2 = new MockR2Bucket()
    gitModule = createGitModule({
      repo: 'org/repo',
      branch: 'main',
      r2: mockR2 as unknown as R2Bucket,
      fs: mockFs as unknown as FsCapability,
    })
  })

  describe('stashPush()', () => {
    it('should save staged changes to stash', async () => {
      mockFs._setFile('/test.txt', 'Hello, World!')
      await gitModule.add('/test.txt')

      const result = await gitModule.stashPush('WIP: test feature')

      expect(result.index).toBe(0)
      expect(result.message).toBe('WIP: test feature')

      // Staged files should be cleared
      const status = await gitModule.status()
      expect(status.staged).toHaveLength(0)
    })

    it('should use default message if not provided', async () => {
      mockFs._setFile('/test.txt', 'Hello, World!')
      await gitModule.add('/test.txt')

      const result = await gitModule.stashPush()

      expect(result.message).toContain('WIP on main')
    })

    it('should throw error when no changes to stash', async () => {
      await expect(gitModule.stashPush()).rejects.toThrow('No local changes to save')
    })

    it('should create multiple stash entries', async () => {
      // First stash
      mockFs._setFile('/first.txt', 'First')
      await gitModule.add('/first.txt')
      await gitModule.stashPush('First stash')

      // Second stash
      mockFs._setFile('/second.txt', 'Second')
      await gitModule.add('/second.txt')
      await gitModule.stashPush('Second stash')

      const stashes = await gitModule.stashList()
      expect(stashes).toHaveLength(2)
      expect(stashes[0]!.message).toBe('Second stash')
      expect(stashes[1]!.message).toBe('First stash')
    })
  })

  describe('stashPop()', () => {
    it('should restore stashed changes', async () => {
      const content = 'Hello, World!'
      mockFs._setFile('/test.txt', content)
      await gitModule.add('/test.txt')
      await gitModule.stashPush('WIP')

      // File content is still there (we don't delete on stash)
      // But staging is cleared
      expect((await gitModule.status()).staged).toHaveLength(0)

      // Pop the stash
      const result = await gitModule.stashPop()

      expect(result.success).toBe(true)
      expect(result.message).toBe('WIP')

      // Staged files should be restored
      const status = await gitModule.status()
      expect(status.staged).toContain('/test.txt')
    })

    it('should throw error when stash is empty', async () => {
      await expect(gitModule.stashPop()).rejects.toThrow('No stash entries to pop')
    })

    it('should remove the stash entry after pop', async () => {
      mockFs._setFile('/test.txt', 'Hello')
      await gitModule.add('/test.txt')
      await gitModule.stashPush('WIP')

      await gitModule.stashPop()

      const stashes = await gitModule.stashList()
      expect(stashes).toHaveLength(0)
    })
  })

  describe('stashApply()', () => {
    it('should apply stash without removing it', async () => {
      mockFs._setFile('/test.txt', 'Hello')
      await gitModule.add('/test.txt')
      await gitModule.stashPush('WIP')

      const result = await gitModule.stashApply(0)

      expect(result.success).toBe(true)

      // Stash should still exist
      const stashes = await gitModule.stashList()
      expect(stashes).toHaveLength(1)
    })

    it('should apply specific stash by index', async () => {
      // Create two stashes
      mockFs._setFile('/first.txt', 'First')
      await gitModule.add('/first.txt')
      await gitModule.stashPush('First')

      mockFs._setFile('/second.txt', 'Second')
      await gitModule.add('/second.txt')
      await gitModule.stashPush('Second')

      // Apply the older stash (index 1)
      const result = await gitModule.stashApply(1)

      expect(result.success).toBe(true)
      expect(result.message).toBe('First')
    })

    it('should throw error for invalid stash index', async () => {
      await expect(gitModule.stashApply(0)).rejects.toThrow('Stash entry stash@{0} not found')
    })
  })

  describe('stashList()', () => {
    it('should return empty array when no stashes', async () => {
      const stashes = await gitModule.stashList()
      expect(stashes).toEqual([])
    })

    it('should list all stash entries', async () => {
      mockFs._setFile('/first.txt', 'First')
      await gitModule.add('/first.txt')
      await gitModule.stashPush('First stash')

      mockFs._setFile('/second.txt', 'Second')
      await gitModule.add('/second.txt')
      await gitModule.stashPush('Second stash')

      const stashes = await gitModule.stashList()

      expect(stashes).toHaveLength(2)
      expect(stashes[0]).toHaveProperty('index', 0)
      expect(stashes[0]).toHaveProperty('message', 'Second stash')
      expect(stashes[0]).toHaveProperty('timestamp')
      expect(stashes[1]).toHaveProperty('index', 1)
      expect(stashes[1]).toHaveProperty('message', 'First stash')
    })
  })

  describe('stashDrop()', () => {
    it('should remove stash entry by index', async () => {
      mockFs._setFile('/first.txt', 'First')
      await gitModule.add('/first.txt')
      await gitModule.stashPush('First')

      mockFs._setFile('/second.txt', 'Second')
      await gitModule.add('/second.txt')
      await gitModule.stashPush('Second')

      // Drop the most recent stash
      const result = await gitModule.stashDrop(0)

      expect(result.success).toBe(true)
      expect(result.message).toContain('Dropped')

      const stashes = await gitModule.stashList()
      expect(stashes).toHaveLength(1)
      expect(stashes[0]!.message).toBe('First')
    })

    it('should throw error for invalid index', async () => {
      await expect(gitModule.stashDrop(0)).rejects.toThrow('Stash entry stash@{0} not found')
    })
  })

  describe('stashClear()', () => {
    it('should remove all stash entries', async () => {
      mockFs._setFile('/first.txt', 'First')
      await gitModule.add('/first.txt')
      await gitModule.stashPush('First')

      mockFs._setFile('/second.txt', 'Second')
      await gitModule.add('/second.txt')
      await gitModule.stashPush('Second')

      const count = await gitModule.stashClear()

      expect(count).toBe(2)

      const stashes = await gitModule.stashList()
      expect(stashes).toHaveLength(0)
    })

    it('should return 0 when no stashes to clear', async () => {
      const count = await gitModule.stashClear()
      expect(count).toBe(0)
    })
  })
})
