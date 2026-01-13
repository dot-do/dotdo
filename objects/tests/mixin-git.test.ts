/**
 * RED TDD: withGit Mixin Integration Tests
 *
 * These tests verify the withGit mixin integration with gitx.do.
 * Tests should FAIL initially until withGit is properly integrated.
 *
 * Key requirements:
 * 1. withGit requires withFs capability (throws if missing)
 * 2. withGit adds $.git to WorkflowContext when fs present
 * 3. $.git.init() creates repository
 * 4. $.git.add() stages files
 * 5. $.git.commit() creates commit with SHA
 * 6. $.git.log() returns commit history
 * 7. $.git.diff() shows changes
 *
 * Reference: dotdo-bgj32 issue
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import directly from fs.ts and git.ts to avoid importing bash.ts/npm.ts with missing deps
import { withFs, type FsCapability, type WithFsContext } from '../../lib/mixins/fs'
import {
  withGit,
  type GitCapability,
  type WithGitContext,
  type GitStatus,
  type GitBinding,
} from '../../lib/mixins/git'

import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// MOCK FIXTURES
// ============================================================================

/**
 * Create mock DurableObjectState for testing
 */
function createMockDOState(): DurableObjectState {
  const storageMap = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'test-do-id',
      name: 'test-do',
    },
    storage: {
      get: vi.fn(async (key: string) => storageMap.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storageMap.set(key, value)
      }),
      delete: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          for (const k of key) storageMap.delete(k)
          return true
        }
        storageMap.delete(key)
        return true
      }),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        const prefix = options?.prefix ?? ''
        for (const [k, v] of storageMap) {
          if (k.startsWith(prefix)) {
            result.set(k, v)
          }
        }
        return result
      }),
      deleteAll: vi.fn(async () => {
        storageMap.clear()
      }),
      transaction: vi.fn(async (cb: () => Promise<void>) => {
        await cb()
      }),
      getAlarm: vi.fn(async () => null),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
    } as unknown as DurableObjectStorage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (cb: () => Promise<void>) => {
      await cb()
    }),
  } as unknown as DurableObjectState
}

/**
 * Create mock Env for testing
 */
function createMockEnv(): Record<string, unknown> {
  return {
    R2_BUCKET: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    },
  }
}

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
    branch: vi.fn(),
    checkout: vi.fn(),
    merge: vi.fn(),
    log: vi.fn(),
    state: {},
  } as unknown as WorkflowContext
}

/**
 * Mock DO base class for mixin testing
 * Simulates the basic DO structure that mixins extend
 */
class MockDO {
  $: WorkflowContext
  env: Record<string, unknown>

  constructor(state?: DurableObjectState, env?: Record<string, unknown>) {
    this.$ = createMockWorkflowContext()
    this.env = env ?? createMockEnv()
  }
}

/**
 * Mock DOBase class - simulates the actual DOBase that has DurableObjectStorage
 */
class MockDOBase {
  $: WorkflowContext
  env: Record<string, unknown>
  protected ctx: DurableObjectState

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    this.$ = createMockWorkflowContext()
    this.env = env
    this.ctx = state
  }
}

// ============================================================================
// WITHGIT MIXIN TESTS
// ============================================================================

describe('withGit Mixin', () => {
  let mockState: DurableObjectState
  let mockEnv: Record<string, unknown>

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  // ==========================================================================
  // 1. DEPENDENCY REQUIREMENT TESTS
  // ==========================================================================

  describe('Dependency Requirements', () => {
    it('requires withFs capability - should throw if fs is missing', () => {
      // RED: withGit should throw at runtime when applied to a class without fs
      // Currently the implementation does NOT enforce this at runtime

      // Applying withGit directly to MockDO without withFs should fail
      // @ts-expect-error - Intentionally testing runtime behavior with wrong type
      const BadDO = withGit(MockDO)

      // Creating an instance should throw because $.fs is not available
      expect(() => {
        const instance = new BadDO(mockState, mockEnv)
        // Accessing git should throw if fs is missing
        const _git = instance.$.git
      }).toThrow(/requires.*fs/i)
    })

    it('should have git capability when fs is present', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      expect(instance.$.git).toBeDefined()
    })

    it('should preserve fs capability when git is added', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. CAPABILITY DETECTION TESTS
  // ==========================================================================

  describe('Capability Detection', () => {
    it('hasCapability returns true for git', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      expect(instance.hasCapability('git')).toBe(true)
    })

    it('hasCapability returns true for fs (preserved from parent)', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      expect(instance.hasCapability('fs')).toBe(true)
    })

    it('hasCapability returns false for unknown capabilities', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      expect(instance.hasCapability('bash')).toBe(false)
      expect(instance.hasCapability('npm')).toBe(false)
    })

    it('static capabilities array includes git', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)

      expect((DOWithGit as any).capabilities).toContain('git')
    })

    it('static capabilities array includes both fs and git', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)

      expect((DOWithGit as any).capabilities).toContain('fs')
      expect((DOWithGit as any).capabilities).toContain('git')
    })
  })

  // ==========================================================================
  // 3. $.git.init() TESTS
  // ==========================================================================

  describe('$.git.init()', () => {
    it('creates a repository with .git directory', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      // Configure git first
      instance.$.git.configure({
        repo: 'test/repo',
        branch: 'main',
      })

      // RED: init() should create .git directory structure
      // Currently GitModule doesn't have an init() method
      await expect(instance.$.git.init()).resolves.toBeUndefined()

      // After init, .git/HEAD should exist
      const headExists = await instance.$.fs.exists('/.git/HEAD')
      expect(headExists).toBe(true)
    })

    it('creates .git/HEAD pointing to main branch', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      const headContent = await instance.$.fs.read('/.git/HEAD')
      expect(headContent).toBe('ref: refs/heads/main')
    })

    it('creates .git/config with repository info', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      const configExists = await instance.$.fs.exists('/.git/config')
      expect(configExists).toBe(true)
    })

    it('creates .git/objects directory', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Objects directory should exist (as a directory marker)
      const stat = await instance.$.fs.stat('/.git/objects')
      expect(stat.isDirectory).toBe(true)
    })

    it('creates .git/refs/heads directory', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      const stat = await instance.$.fs.stat('/.git/refs/heads')
      expect(stat.isDirectory).toBe(true)
    })
  })

  // ==========================================================================
  // 4. $.git.add() TESTS
  // ==========================================================================

  describe('$.git.add()', () => {
    it('stages a single file', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      // Create a file
      await instance.$.fs.write('/test.txt', 'hello world')

      // Stage it
      await instance.$.git.add('/test.txt')

      // Verify it's staged
      const status = await instance.$.git.status()
      expect(status.staged).toContain('test.txt')
    })

    it('stages multiple files via array', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/file1.txt', 'content1')
      await instance.$.fs.write('/file2.txt', 'content2')

      await instance.$.git.add(['/file1.txt', '/file2.txt'])

      const status = await instance.$.git.status()
      expect(status.staged).toContain('file1.txt')
      expect(status.staged).toContain('file2.txt')
    })

    it('stages all files with "." pattern', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      await instance.$.fs.write('/a.txt', 'a')
      await instance.$.fs.write('/b.txt', 'b')
      await instance.$.fs.mkdir('/src', { recursive: true })
      await instance.$.fs.write('/src/c.txt', 'c')

      // RED: add('.') should stage all files
      await instance.$.git.add('.')

      const status = await instance.$.git.status()
      expect(status.staged.length).toBeGreaterThanOrEqual(3)
    })

    it('clears staged files after commit', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')

      const statusBefore = await instance.$.git.status()
      expect(statusBefore.staged.length).toBe(1)

      await instance.$.git.commit('test commit')

      const statusAfter = await instance.$.git.status()
      expect(statusAfter.staged.length).toBe(0)
    })
  })

  // ==========================================================================
  // 5. $.git.commit() TESTS
  // ==========================================================================

  describe('$.git.commit()', () => {
    it('creates a commit and returns SHA hash', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')

      const result = await instance.$.git.commit('Initial commit')

      // Should return a valid SHA-1 hash (40 hex characters)
      const sha = typeof result === 'string' ? result : result.hash
      expect(sha).toMatch(/^[a-f0-9]{40}$/)
    })

    it('throws when nothing is staged', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await expect(instance.$.git.commit('Empty commit')).rejects.toThrow(/nothing to commit/i)
    })

    it('updates HEAD to point to new commit', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')

      const result = await instance.$.git.commit('Initial commit')
      const sha = typeof result === 'string' ? result : result.hash

      const status = await instance.$.git.status()
      expect(status.head).toBe(sha)
    })

    it('creates commit with correct parent chain', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      // First commit
      await instance.$.fs.write('/test.txt', 'v1')
      await instance.$.git.add('/test.txt')
      const commit1 = await instance.$.git.commit('First commit')
      const sha1 = typeof commit1 === 'string' ? commit1 : commit1.hash

      // Second commit
      await instance.$.fs.write('/test.txt', 'v2')
      await instance.$.git.add('/test.txt')
      const commit2 = await instance.$.git.commit('Second commit')
      const sha2 = typeof commit2 === 'string' ? commit2 : commit2.hash

      // SHA should be different
      expect(sha1).not.toBe(sha2)

      // Log should show parent relationship
      const log = await instance.$.git.log()
      expect(log.length).toBeGreaterThanOrEqual(2)
    })

    it('stores commit message correctly', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Test message: special chars <>&"\'')

      const log = await instance.$.git.log({ limit: 1 })
      expect(log[0].message).toBe('Test message: special chars <>&"\'')
    })
  })

  // ==========================================================================
  // 6. $.git.log() TESTS
  // ==========================================================================

  describe('$.git.log()', () => {
    it('returns empty array when no commits', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      const log = await instance.$.git.log()
      expect(log).toEqual([])
    })

    it('returns commit history in reverse chronological order', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      // Create multiple commits
      await instance.$.fs.write('/test.txt', 'v1')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('First')

      await instance.$.fs.write('/test.txt', 'v2')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Second')

      await instance.$.fs.write('/test.txt', 'v3')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Third')

      const log = await instance.$.git.log()

      expect(log).toHaveLength(3)
      expect(log[0].message).toBe('Third')
      expect(log[1].message).toBe('Second')
      expect(log[2].message).toBe('First')
    })

    it('respects limit option', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      // Create 5 commits
      for (let i = 1; i <= 5; i++) {
        await instance.$.fs.write('/test.txt', `v${i}`)
        await instance.$.git.add('/test.txt')
        await instance.$.git.commit(`Commit ${i}`)
      }

      const log = await instance.$.git.log({ limit: 2 })

      expect(log).toHaveLength(2)
      expect(log[0].message).toBe('Commit 5')
      expect(log[1].message).toBe('Commit 4')
    })

    it('includes commit hash in log entries', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')
      const commitResult = await instance.$.git.commit('Test commit')
      const expectedSha = typeof commitResult === 'string' ? commitResult : commitResult.hash

      const log = await instance.$.git.log()

      expect(log[0].hash).toBe(expectedSha)
    })
  })

  // ==========================================================================
  // 7. $.git.diff() TESTS
  // ==========================================================================

  describe('$.git.diff()', () => {
    it('shows no diff when working tree is clean', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      await instance.$.fs.write('/test.txt', 'original')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Initial commit')

      const diff = await instance.$.git.diff()

      // Should be empty or whitespace only when clean
      expect(diff.trim()).toBe('')
    })

    it('shows changes for modified files', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      await instance.$.fs.write('/test.txt', 'original')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Initial commit')

      // Modify the file
      await instance.$.fs.write('/test.txt', 'modified')

      const diff = await instance.$.git.diff()

      // Should show the diff with old and new content
      expect(diff).toContain('-original')
      expect(diff).toContain('+modified')
    })

    it('shows additions for new files', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Add a new file without committing
      await instance.$.fs.write('/new.txt', 'new content')
      await instance.$.git.add('/new.txt')

      // Diff against HEAD (staged vs committed)
      const diff = await instance.$.git.diff()

      expect(diff).toContain('new.txt')
      expect(diff).toContain('+new content')
    })

    it('shows deletions for removed files', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      await instance.$.fs.write('/delete-me.txt', 'goodbye')
      await instance.$.git.add('/delete-me.txt')
      await instance.$.git.commit('Add file')

      // Delete the file
      await instance.$.fs.delete('/delete-me.txt')

      const diff = await instance.$.git.diff()

      expect(diff).toContain('delete-me.txt')
      expect(diff).toContain('-goodbye')
    })

    it('supports diff between two refs', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // First commit
      await instance.$.fs.write('/test.txt', 'v1')
      await instance.$.git.add('/test.txt')
      const commit1 = await instance.$.git.commit('First')
      const sha1 = typeof commit1 === 'string' ? commit1 : commit1.hash

      // Second commit
      await instance.$.fs.write('/test.txt', 'v2')
      await instance.$.git.add('/test.txt')
      const commit2 = await instance.$.git.commit('Second')
      const sha2 = typeof commit2 === 'string' ? commit2 : commit2.hash

      // RED: diff(ref1, ref2) should show diff between two commits
      const diff = await instance.$.git.diff(sha1, sha2)

      expect(diff).toContain('-v1')
      expect(diff).toContain('+v2')
    })
  })

  // ==========================================================================
  // 8. $.git.status() TESTS
  // ==========================================================================

  describe('$.git.status()', () => {
    it('returns correct branch name', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'develop' })

      const status = await instance.$.git.status()

      expect(status.branch).toBe('develop')
    })

    it('returns clean: true when no changes', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      const status = await instance.$.git.status()

      expect(status.clean).toBe(true)
      expect(status.staged).toEqual([])
      expect(status.unstaged).toEqual([])
    })

    it('tracks unstaged changes', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      await instance.$.fs.write('/test.txt', 'original')
      await instance.$.git.add('/test.txt')
      await instance.$.git.commit('Initial')

      // Modify file without staging
      await instance.$.fs.write('/test.txt', 'modified')

      const status = await instance.$.git.status()

      // RED: status should track unstaged changes
      expect(status.unstaged).toContain('test.txt')
      expect(status.clean).toBe(false)
    })

    it('tracks untracked files', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Create file without adding to git
      await instance.$.fs.write('/untracked.txt', 'content')

      const status = await instance.$.git.status()

      // RED: status should track untracked files
      expect(status.untracked).toContain('untracked.txt')
    })
  })

  // ==========================================================================
  // 9. $.git.binding TESTS
  // ==========================================================================

  describe('$.git.binding', () => {
    it('returns configured repo name', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'myorg/myrepo', branch: 'main' })

      expect(instance.$.git.binding.repo).toBe('myorg/myrepo')
    })

    it('returns configured branch', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'myorg/myrepo', branch: 'feature/test' })

      expect(instance.$.git.binding.branch).toBe('feature/test')
    })

    it('returns current commit SHA after commit', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      await instance.$.fs.write('/test.txt', 'hello')
      await instance.$.git.add('/test.txt')
      const result = await instance.$.git.commit('Test')
      const expectedSha = typeof result === 'string' ? result : result.hash

      expect(instance.$.git.binding.commit).toBe(expectedSha)
    })

    it('returns optional path prefix', () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({
        repo: 'myorg/monorepo',
        branch: 'main',
        path: 'packages/core',
      })

      expect(instance.$.git.binding.path).toBe('packages/core')
    })
  })

  // ==========================================================================
  // 10. INTEGRATION WITH FS CAPABILITY
  // ==========================================================================

  describe('Integration with $.fs', () => {
    it('reads file content through $.fs for staging', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })

      // Write through $.fs
      await instance.$.fs.write('/myfile.txt', 'content from fs')

      // Add and commit through $.git
      await instance.$.git.add('/myfile.txt')
      await instance.$.git.commit('Test fs integration')

      // Content should be preserved
      const content = await instance.$.fs.read('/myfile.txt')
      expect(content).toBe('content from fs')
    })

    it('works with nested directories', async () => {
      const DOWithFs = withFs(MockDO as any)
      const DOWithGit = withGit(DOWithFs)
      const instance = new DOWithGit(mockState, mockEnv)

      instance.$.git.configure({ repo: 'test/repo', branch: 'main' })
      await instance.$.git.init()

      // Create nested structure
      await instance.$.fs.mkdir('/src/lib', { recursive: true })
      await instance.$.fs.write('/src/lib/index.ts', 'export {}')
      await instance.$.fs.write('/src/main.ts', 'import "./lib"')

      // Stage all
      await instance.$.git.add('.')

      const status = await instance.$.git.status()
      expect(status.staged.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // 11. TYPE EXPORTS
  // ==========================================================================

  describe('Type Exports', () => {
    it('exports GitCapability type', () => {
      const _: GitCapability = {} as GitCapability
      expect(_).toBeDefined()
    })

    it('exports WithGitContext type', () => {
      const _: WithGitContext = {} as WithGitContext
      expect(_).toBeDefined()
    })

    it('exports GitStatus type', () => {
      const _: GitStatus = {
        branch: 'main',
        staged: [],
        unstaged: [],
        clean: true,
      }
      expect(_).toBeDefined()
    })

    it('exports GitBinding type', () => {
      const _: GitBinding = {
        repo: 'org/repo',
        branch: 'main',
      }
      expect(_).toBeDefined()
    })
  })
})
