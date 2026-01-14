/**
 * GitxBranchStorage Unit Tests
 *
 * Tests for the GitxBranchStorage adapter that integrates bashx sessions
 * with gitx for version control semantics.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  GitxBranchStorage,
  createGitxBranchStorage,
  createMockGitxAdapter,
  type GitxAdapter,
} from '../../../src/session/gitx-branch-storage.js'

import type { SessionBranch, BranchStorage } from '../../../src/session/types.js'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test branch object.
 */
function createTestBranch(
  name: string,
  sessionId: string,
  checkpointHash?: string
): SessionBranch {
  return {
    name,
    checkpointHash: checkpointHash || generateSha(),
    type: 'branch',
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: { test: true },
  }
}

/**
 * Generate a random SHA-like string.
 */
function generateSha(): string {
  return Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

// ============================================================================
// GitxBranchStorage Tests
// ============================================================================

describe('GitxBranchStorage', () => {
  let adapter: GitxAdapter & { _refs: Map<string, string>; _branches: Set<string> }
  let storage: GitxBranchStorage
  const sessionId = 'test-session-123'

  beforeEach(() => {
    adapter = createMockGitxAdapter()
    storage = new GitxBranchStorage(sessionId, adapter)
  })

  describe('Constructor', () => {
    it('creates instance with session ID and adapter', () => {
      const storage = new GitxBranchStorage('my-session', adapter)
      expect(storage).toBeDefined()
      expect(storage).toBeInstanceOf(GitxBranchStorage)
    })

    it('accepts custom ref prefix option', () => {
      const storage = new GitxBranchStorage('my-session', adapter, {
        refPrefix: 'refs/custom',
      })
      expect(storage).toBeDefined()
    })

    it('accepts autoCreate option', () => {
      const storage = new GitxBranchStorage('my-session', adapter, {
        autoCreate: false,
      })
      expect(storage).toBeDefined()
    })
  })

  describe('saveBranch()', () => {
    it('saves a branch to gitx storage', async () => {
      const branch = createTestBranch('my-branch', sessionId)

      await storage.saveBranch(branch)

      // Verify the ref was set
      const expectedRef = `refs/sessions/${sessionId}/branches/my-branch`
      expect(adapter._refs.has(expectedRef)).toBe(true)
      expect(adapter._refs.get(expectedRef)).toBe(branch.checkpointHash)
    })

    it('can save multiple branches', async () => {
      const branch1 = createTestBranch('branch-1', sessionId)
      const branch2 = createTestBranch('branch-2', sessionId)
      const branch3 = createTestBranch('branch-3', sessionId)

      await storage.saveBranch(branch1)
      await storage.saveBranch(branch2)
      await storage.saveBranch(branch3)

      expect(adapter._refs.size).toBe(3)
    })

    it('updates existing branch when called twice', async () => {
      const branch = createTestBranch('update-me', sessionId, 'original-hash')
      await storage.saveBranch(branch)

      const updatedBranch = { ...branch, checkpointHash: 'updated-hash' }
      await storage.saveBranch(updatedBranch)

      const expectedRef = `refs/sessions/${sessionId}/branches/update-me`
      expect(adapter._refs.get(expectedRef)).toBe('updated-hash')
    })
  })

  describe('getBranch()', () => {
    it('returns branch when it exists', async () => {
      const branch = createTestBranch('existing-branch', sessionId)
      await storage.saveBranch(branch)

      const retrieved = await storage.getBranch('existing-branch')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('existing-branch')
      expect(retrieved!.checkpointHash).toBe(branch.checkpointHash)
      expect(retrieved!.sessionId).toBe(sessionId)
      expect(retrieved!.type).toBe('branch')
    })

    it('returns null when branch does not exist', async () => {
      const retrieved = await storage.getBranch('nonexistent')

      expect(retrieved).toBeNull()
    })

    it('returns correct branch among multiple', async () => {
      const branch1 = createTestBranch('branch-a', sessionId, 'hash-a')
      const branch2 = createTestBranch('branch-b', sessionId, 'hash-b')

      await storage.saveBranch(branch1)
      await storage.saveBranch(branch2)

      const retrieved = await storage.getBranch('branch-b')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.checkpointHash).toBe('hash-b')
    })
  })

  describe('listBranches()', () => {
    it('returns empty array when no branches exist', async () => {
      const branches = await storage.listBranches()

      expect(branches).toEqual([])
    })

    it('returns all branches for the session', async () => {
      await storage.saveBranch(createTestBranch('alpha', sessionId))
      await storage.saveBranch(createTestBranch('beta', sessionId))
      await storage.saveBranch(createTestBranch('gamma', sessionId))

      const branches = await storage.listBranches()

      expect(branches.length).toBe(3)
      const names = branches.map(b => b.name)
      expect(names).toContain('alpha')
      expect(names).toContain('beta')
      expect(names).toContain('gamma')
    })

    it('only returns branches for the specific session', async () => {
      // Create branch for our session
      await storage.saveBranch(createTestBranch('our-branch', sessionId))

      // Create branch for another session (directly via adapter)
      const otherRef = 'refs/sessions/other-session/branches/other-branch'
      await adapter.setRef(otherRef, generateSha())

      const branches = await storage.listBranches()

      expect(branches.length).toBe(1)
      expect(branches[0].name).toBe('our-branch')
    })

    it('returns branches with correct metadata', async () => {
      const branch = createTestBranch('detailed-branch', sessionId)
      await storage.saveBranch(branch)

      const branches = await storage.listBranches()

      expect(branches[0].sessionId).toBe(sessionId)
      expect(branches[0].type).toBe('branch')
      expect(branches[0].checkpointHash).toBe(branch.checkpointHash)
    })
  })

  describe('deleteBranch()', () => {
    it('deletes existing branch and returns true', async () => {
      const branch = createTestBranch('to-delete', sessionId)
      await storage.saveBranch(branch)

      const result = await storage.deleteBranch('to-delete')

      expect(result).toBe(true)
      const retrieved = await storage.getBranch('to-delete')
      expect(retrieved).toBeNull()
    })

    it('returns false when branch does not exist', async () => {
      const result = await storage.deleteBranch('nonexistent')

      expect(result).toBe(false)
    })

    it('does not affect other branches', async () => {
      await storage.saveBranch(createTestBranch('keep-me', sessionId))
      await storage.saveBranch(createTestBranch('delete-me', sessionId))

      await storage.deleteBranch('delete-me')

      const branches = await storage.listBranches()
      expect(branches.length).toBe(1)
      expect(branches[0].name).toBe('keep-me')
    })
  })

  describe('branchExists()', () => {
    it('returns true when branch exists', async () => {
      const branch = createTestBranch('existing', sessionId)
      await storage.saveBranch(branch)

      const exists = await storage.branchExists('existing')

      expect(exists).toBe(true)
    })

    it('returns false when branch does not exist', async () => {
      const exists = await storage.branchExists('nonexistent')

      expect(exists).toBe(false)
    })

    it('returns false after branch is deleted', async () => {
      const branch = createTestBranch('temp', sessionId)
      await storage.saveBranch(branch)
      await storage.deleteBranch('temp')

      const exists = await storage.branchExists('temp')

      expect(exists).toBe(false)
    })
  })
})

// ============================================================================
// Extended Git-like Operations Tests
// ============================================================================

describe('GitxBranchStorage - Extended Operations', () => {
  let adapter: GitxAdapter & { _refs: Map<string, string>; _branches: Set<string> }
  let storage: GitxBranchStorage
  const sessionId = 'test-session-456'

  beforeEach(() => {
    adapter = createMockGitxAdapter()
    storage = new GitxBranchStorage(sessionId, adapter)
  })

  describe('createBranch()', () => {
    it('creates a branch from HEAD when no source specified', async () => {
      // Set up HEAD
      const headRef = `refs/sessions/${sessionId}/HEAD`
      const headSha = generateSha()
      await adapter.setRef(headRef, headSha)

      const branch = await storage.createBranch('new-branch')

      expect(branch.name).toBe('new-branch')
      expect(branch.checkpointHash).toBe(headSha)
      expect(branch.sessionId).toBe(sessionId)
      expect(branch.type).toBe('branch')
    })

    it('creates a branch from specified source branch', async () => {
      // Set up source branch
      const sourceBranch = createTestBranch('source', sessionId, 'source-sha')
      await storage.saveBranch(sourceBranch)

      const branch = await storage.createBranch('derived', 'source')

      expect(branch.name).toBe('derived')
      expect(branch.checkpointHash).toBe('source-sha')
    })

    it('throws error when source branch does not exist', async () => {
      await expect(storage.createBranch('new', 'nonexistent')).rejects.toThrow(
        'Source branch not found'
      )
    })

    it('throws error when HEAD is not set', async () => {
      await expect(storage.createBranch('orphan')).rejects.toThrow(
        'No HEAD ref found'
      )
    })

    it('sets createdAt timestamp', async () => {
      const headRef = `refs/sessions/${sessionId}/HEAD`
      await adapter.setRef(headRef, generateSha())

      const before = Date.now()
      const branch = await storage.createBranch('timed')
      const after = Date.now()

      expect(branch.createdAt).toBeGreaterThanOrEqual(before)
      expect(branch.createdAt).toBeLessThanOrEqual(after)
    })
  })

  describe('getCurrentBranch()', () => {
    it('returns null when HEAD is not set', async () => {
      const current = await storage.getCurrentBranch()

      expect(current).toBeNull()
    })

    it('returns branch that HEAD points to', async () => {
      const branch = createTestBranch('main', sessionId, 'main-sha')
      await storage.saveBranch(branch)

      const headRef = `refs/sessions/${sessionId}/HEAD`
      await adapter.setRef(headRef, 'main-sha')

      const current = await storage.getCurrentBranch()

      expect(current).not.toBeNull()
      expect(current!.name).toBe('main')
    })

    it('returns null when HEAD points to unknown SHA', async () => {
      const headRef = `refs/sessions/${sessionId}/HEAD`
      await adapter.setRef(headRef, 'orphan-sha')

      const current = await storage.getCurrentBranch()

      expect(current).toBeNull()
    })
  })

  describe('checkout()', () => {
    it('sets HEAD to the branch checkpoint hash', async () => {
      const branch = createTestBranch('target', sessionId, 'target-sha')
      await storage.saveBranch(branch)

      await storage.checkout('target')

      const head = await storage.getHead()
      expect(head).toBe('target-sha')
    })

    it('throws error when branch does not exist', async () => {
      await expect(storage.checkout('nonexistent')).rejects.toThrow(
        'Branch not found'
      )
    })
  })

  describe('updateHead()', () => {
    it('updates HEAD to specified checkpoint hash', async () => {
      const newHash = generateSha()

      await storage.updateHead(newHash)

      const head = await storage.getHead()
      expect(head).toBe(newHash)
    })
  })

  describe('getHead()', () => {
    it('returns null when HEAD is not set', async () => {
      const head = await storage.getHead()

      expect(head).toBeNull()
    })

    it('returns HEAD checkpoint hash when set', async () => {
      const hash = generateSha()
      await storage.updateHead(hash)

      const head = await storage.getHead()

      expect(head).toBe(hash)
    })
  })

  describe('merge()', () => {
    it('returns success for valid branches', async () => {
      const source = createTestBranch('feature', sessionId, 'feature-sha')
      const target = createTestBranch('main', sessionId, 'main-sha')
      await storage.saveBranch(source)
      await storage.saveBranch(target)

      const result = await storage.merge('feature', 'main')

      expect(result.success).toBe(true)
    })

    it('returns failure when source branch does not exist', async () => {
      const target = createTestBranch('main', sessionId, 'main-sha')
      await storage.saveBranch(target)

      const result = await storage.merge('nonexistent', 'main')

      expect(result.success).toBe(false)
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts![0]).toContain('Source branch not found')
    })

    it('returns failure when target branch does not exist', async () => {
      const source = createTestBranch('feature', sessionId, 'feature-sha')
      await storage.saveBranch(source)

      const result = await storage.merge('feature', 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.conflicts).toBeDefined()
      expect(result.conflicts![0]).toContain('Target branch not found')
    })

    it('uses HEAD as target when not specified', async () => {
      const source = createTestBranch('feature', sessionId, 'feature-sha')
      await storage.saveBranch(source)

      // Set up HEAD
      const headRef = `refs/sessions/${sessionId}/HEAD`
      await adapter.setRef(headRef, 'head-sha')

      const result = await storage.merge('feature')

      // Mock adapter always succeeds
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// BranchStorage Interface Compliance Tests
// ============================================================================

describe('GitxBranchStorage - BranchStorage Interface', () => {
  let storage: BranchStorage

  beforeEach(() => {
    const adapter = createMockGitxAdapter()
    storage = new GitxBranchStorage('interface-test', adapter)
  })

  it('implements saveBranch method', () => {
    expect(typeof storage.saveBranch).toBe('function')
  })

  it('implements getBranch method', () => {
    expect(typeof storage.getBranch).toBe('function')
  })

  it('implements listBranches method', () => {
    expect(typeof storage.listBranches).toBe('function')
  })

  it('implements deleteBranch method', () => {
    expect(typeof storage.deleteBranch).toBe('function')
  })

  it('implements optional branchExists method', () => {
    expect(typeof storage.branchExists).toBe('function')
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createGitxBranchStorage()', () => {
  it('creates GitxBranchStorage instance', () => {
    const adapter = createMockGitxAdapter()
    const storage = createGitxBranchStorage('factory-test', adapter)

    expect(storage).toBeInstanceOf(GitxBranchStorage)
  })

  it('passes options to constructor', async () => {
    const adapter = createMockGitxAdapter()
    const storage = createGitxBranchStorage('factory-test', adapter, {
      refPrefix: 'refs/custom',
    })

    // Save a branch and verify custom prefix is used
    await storage.saveBranch(createTestBranch('test', 'factory-test'))

    const expectedRef = 'refs/custom/factory-test/branches/test'
    expect(adapter._refs.has(expectedRef)).toBe(true)
  })
})

// ============================================================================
// Mock Adapter Tests
// ============================================================================

describe('createMockGitxAdapter()', () => {
  it('creates a mock adapter', () => {
    const adapter = createMockGitxAdapter()

    expect(adapter).toBeDefined()
    expect(adapter._refs).toBeInstanceOf(Map)
    expect(adapter._branches).toBeInstanceOf(Set)
  })

  describe('resolveRef', () => {
    it('returns null for unknown ref', async () => {
      const adapter = createMockGitxAdapter()

      const result = await adapter.resolveRef('unknown')

      expect(result).toBeNull()
    })

    it('returns SHA for known ref', async () => {
      const adapter = createMockGitxAdapter()
      await adapter.setRef('refs/test', 'test-sha')

      const result = await adapter.resolveRef('refs/test')

      expect(result).toBe('test-sha')
    })
  })

  describe('setRef', () => {
    it('sets ref in internal map', async () => {
      const adapter = createMockGitxAdapter()

      await adapter.setRef('refs/new', 'new-sha')

      expect(adapter._refs.get('refs/new')).toBe('new-sha')
    })
  })

  describe('listBranches', () => {
    it('returns all refs without prefix', async () => {
      const adapter = createMockGitxAdapter()
      await adapter.setRef('refs/a', 'sha-a')
      await adapter.setRef('refs/b', 'sha-b')

      const result = await adapter.listBranches()

      expect(result).toContain('refs/a')
      expect(result).toContain('refs/b')
    })

    it('filters by prefix', async () => {
      const adapter = createMockGitxAdapter()
      await adapter.setRef('refs/heads/main', 'sha-1')
      await adapter.setRef('refs/heads/dev', 'sha-2')
      await adapter.setRef('refs/tags/v1', 'sha-3')

      const result = await adapter.listBranches('refs/heads/')

      expect(result.length).toBe(2)
      expect(result).toContain('refs/heads/main')
      expect(result).toContain('refs/heads/dev')
      expect(result).not.toContain('refs/tags/v1')
    })
  })

  describe('deleteBranch', () => {
    it('removes ref and returns true', async () => {
      const adapter = createMockGitxAdapter()
      await adapter.setRef('refs/delete-me', 'sha')

      const result = await adapter.deleteBranch('refs/delete-me')

      expect(result).toBe(true)
      expect(adapter._refs.has('refs/delete-me')).toBe(false)
    })

    it('returns false for unknown ref', async () => {
      const adapter = createMockGitxAdapter()

      const result = await adapter.deleteBranch('refs/unknown')

      expect(result).toBe(false)
    })
  })

  describe('merge', () => {
    it('always returns success in mock', async () => {
      const adapter = createMockGitxAdapter()

      const result = await adapter.merge('from', 'into')

      expect(result.success).toBe(true)
    })
  })

  describe('commit', () => {
    it('returns a 40-character SHA', async () => {
      const adapter = createMockGitxAdapter()

      const sha = await adapter.commit('test commit', {})

      expect(sha.length).toBe(40)
      expect(/^[0-9a-f]+$/.test(sha)).toBe(true)
    })
  })
})

// ============================================================================
// Custom Ref Prefix Tests
// ============================================================================

describe('GitxBranchStorage - Custom Ref Prefix', () => {
  it('uses default prefix when not specified', async () => {
    const adapter = createMockGitxAdapter()
    const storage = new GitxBranchStorage('session-1', adapter)

    await storage.saveBranch(createTestBranch('test', 'session-1'))

    const expectedRef = 'refs/sessions/session-1/branches/test'
    expect(adapter._refs.has(expectedRef)).toBe(true)
  })

  it('uses custom prefix when specified', async () => {
    const adapter = createMockGitxAdapter()
    const storage = new GitxBranchStorage('session-1', adapter, {
      refPrefix: 'refs/bashx',
    })

    await storage.saveBranch(createTestBranch('test', 'session-1'))

    const expectedRef = 'refs/bashx/session-1/branches/test'
    expect(adapter._refs.has(expectedRef)).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('GitxBranchStorage - Edge Cases', () => {
  let adapter: ReturnType<typeof createMockGitxAdapter>
  let storage: GitxBranchStorage

  beforeEach(() => {
    adapter = createMockGitxAdapter()
    storage = new GitxBranchStorage('edge-test', adapter)
  })

  it('handles branch names with slashes', async () => {
    const branch = createTestBranch('feature/nested/deep', 'edge-test')

    await storage.saveBranch(branch)

    const retrieved = await storage.getBranch('feature/nested/deep')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.name).toBe('feature/nested/deep')
  })

  it('handles branch names with special characters', async () => {
    const branch = createTestBranch('fix-bug-123', 'edge-test')

    await storage.saveBranch(branch)

    const retrieved = await storage.getBranch('fix-bug-123')
    expect(retrieved).not.toBeNull()
  })

  it('handles empty metadata', async () => {
    const branch: SessionBranch = {
      name: 'no-metadata',
      checkpointHash: generateSha(),
      type: 'branch',
      sessionId: 'edge-test',
      createdAt: Date.now(),
    }

    await storage.saveBranch(branch)

    const retrieved = await storage.getBranch('no-metadata')
    expect(retrieved).not.toBeNull()
  })

  it('handles concurrent branch operations', async () => {
    const branches = Array.from({ length: 10 }, (_, i) =>
      createTestBranch(`concurrent-${i}`, 'edge-test')
    )

    // Save all branches concurrently
    await Promise.all(branches.map(b => storage.saveBranch(b)))

    const retrieved = await storage.listBranches()
    expect(retrieved.length).toBe(10)
  })
})

/**
 * Helper to create a test branch for edge case tests.
 */
function createTestBranch(
  name: string,
  sessionId: string,
  checkpointHash?: string
): SessionBranch {
  return {
    name,
    checkpointHash: checkpointHash || generateSha(),
    type: 'branch',
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Generate a random SHA-like string.
 */
function generateSha(): string {
  return Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}
