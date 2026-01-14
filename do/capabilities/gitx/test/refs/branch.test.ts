import { describe, it, expect, beforeEach } from 'vitest'
import {
  BranchManager,
  BranchManagerOptions,
  Branch,
  BranchError,
  CreateBranchOptions,
  DeleteBranchOptions,
  RenameBranchOptions,
  ListBranchesOptions,
  SetUpstreamOptions
} from '../../src/refs/branch'
import {
  RefStorage,
  RefStorageBackend,
  Ref,
  RefLock,
  RefError
} from '../../src/refs/storage'

// ============================================================================
// Test Helpers
// ============================================================================

const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)

/**
 * Create a mock backend for testing
 */
function createMockBackend(): RefStorageBackend {
  const refs = new Map<string, Ref>()
  const packedRefs = new Map<string, string>()
  const locks = new Set<string>()

  // Initialize with HEAD pointing to main, plus a remote tracking branch
  refs.set('HEAD', { name: 'HEAD', target: 'refs/heads/main', type: 'symbolic' })
  refs.set('refs/heads/main', { name: 'refs/heads/main', target: sampleSha, type: 'direct' })
  refs.set('refs/remotes/origin/main', { name: 'refs/remotes/origin/main', target: sampleSha, type: 'direct' })
  refs.set('refs/remotes/origin/develop', { name: 'refs/remotes/origin/develop', target: sampleSha2, type: 'direct' })

  return {
    async readRef(name: string): Promise<Ref | null> {
      return refs.get(name) ?? null
    },
    async writeRef(ref: Ref): Promise<void> {
      refs.set(ref.name, ref)
    },
    async deleteRef(name: string): Promise<boolean> {
      return refs.delete(name)
    },
    async listRefs(pattern?: string): Promise<Ref[]> {
      const allRefs = Array.from(refs.values())
      if (!pattern) return allRefs
      // Simple glob matching for testing
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return allRefs.filter(r => regex.test(r.name))
    },
    async acquireLock(name: string, _timeout?: number): Promise<RefLock> {
      if (locks.has(name)) {
        throw new RefError('Ref is locked', 'LOCKED', name)
      }
      locks.add(name)
      return {
        refName: name,
        async release() {
          locks.delete(name)
        },
        isHeld() {
          return locks.has(name)
        }
      }
    },
    async readPackedRefs(): Promise<Map<string, string>> {
      return new Map(packedRefs)
    },
    async writePackedRefs(newRefs: Map<string, string>): Promise<void> {
      packedRefs.clear()
      for (const [k, v] of newRefs) {
        packedRefs.set(k, v)
      }
    }
  }
}

/**
 * Create a mock backend with sample branches
 */
function createMockBackendWithBranches(): RefStorageBackend {
  const backend = createMockBackend()
  const refs = new Map<string, Ref>([
    ['HEAD', { name: 'HEAD', target: 'refs/heads/main', type: 'symbolic' }],
    ['refs/heads/main', { name: 'refs/heads/main', target: sampleSha, type: 'direct' }],
    ['refs/heads/develop', { name: 'refs/heads/develop', target: sampleSha2, type: 'direct' }],
    ['refs/heads/feature/auth', { name: 'refs/heads/feature/auth', target: sampleSha3, type: 'direct' }],
    ['refs/remotes/origin/main', { name: 'refs/remotes/origin/main', target: sampleSha, type: 'direct' }]
  ])

  // Override readRef to use our predefined refs
  const originalReadRef = backend.readRef.bind(backend)
  backend.readRef = async (name: string) => {
    return refs.get(name) ?? null
  }

  // Override listRefs to use our predefined refs
  backend.listRefs = async (pattern?: string) => {
    const allRefs = Array.from(refs.values())
    if (!pattern) return allRefs
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return allRefs.filter(r => regex.test(r.name))
  }

  return backend
}

// ============================================================================
// BranchManager Tests
// ============================================================================

describe('BranchManager', () => {
  let backend: RefStorageBackend
  let storage: RefStorage
  let manager: BranchManager
  // Set of valid commit SHAs for testing
  const validCommits = new Set([sampleSha, sampleSha2, sampleSha3])

  beforeEach(() => {
    backend = createMockBackend()
    storage = new RefStorage(backend)
    // Create manager with commitExists validator that checks our set of valid commits
    const options: BranchManagerOptions = {
      commitExists: async (sha: string) => validCommits.has(sha)
    }
    manager = new BranchManager(storage, options)
  })

  // ==========================================================================
  // createBranch Tests
  // ==========================================================================

  describe('createBranch', () => {
    describe('Basic branch creation', () => {
      it('should create a branch at HEAD', async () => {
        const branch = await manager.createBranch('feature/new')

        expect(branch).toBeDefined()
        expect(branch.name).toBe('feature/new')
        expect(branch.ref).toBe('refs/heads/feature/new')
        expect(branch.sha).toBe(sampleSha) // Points to HEAD (main)
        expect(branch.isCurrent).toBe(false)
        expect(branch.isRemote).toBe(false)
      })

      it('should create a branch at specific commit SHA', async () => {
        const options: CreateBranchOptions = {
          startPoint: sampleSha2
        }

        const branch = await manager.createBranch('hotfix', options)

        expect(branch.sha).toBe(sampleSha2)
        expect(branch.name).toBe('hotfix')
      })

      it('should create a branch from another branch name', async () => {
        // First create develop branch
        await manager.createBranch('develop', { startPoint: sampleSha2 })

        // Then create from develop
        const branch = await manager.createBranch('feature', { startPoint: 'develop' })

        expect(branch.sha).toBe(sampleSha2)
      })

      it('should create a branch from a full ref path', async () => {
        const branch = await manager.createBranch('feature', { startPoint: 'refs/heads/main' })

        expect(branch.sha).toBe(sampleSha)
      })

      it('should create a branch with nested paths', async () => {
        const branch = await manager.createBranch('feature/user/authentication')

        expect(branch.name).toBe('feature/user/authentication')
        expect(branch.ref).toBe('refs/heads/feature/user/authentication')
      })
    })

    describe('Branch already exists', () => {
      it('should fail if branch already exists without force', async () => {
        await manager.createBranch('duplicate')

        await expect(
          manager.createBranch('duplicate')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.createBranch('duplicate')
        ).rejects.toMatchObject({
          code: 'ALREADY_EXISTS'
        })
      })

      it('should overwrite existing branch with force option', async () => {
        await manager.createBranch('overwrite', { startPoint: sampleSha })

        const branch = await manager.createBranch('overwrite', {
          startPoint: sampleSha2,
          force: true
        })

        expect(branch.sha).toBe(sampleSha2)
      })
    })

    describe('Invalid start points', () => {
      it('should fail if start point commit does not exist', async () => {
        const invalidSha = 'f'.repeat(40)
        const options: CreateBranchOptions = {
          startPoint: invalidSha
        }

        await expect(
          manager.createBranch('feature', options)
        ).rejects.toThrow(BranchError)

        await expect(
          manager.createBranch('feature', options)
        ).rejects.toMatchObject({
          code: 'INVALID_START_POINT'
        })
      })

      it('should fail if start point branch does not exist', async () => {
        const options: CreateBranchOptions = {
          startPoint: 'non-existent-branch'
        }

        await expect(
          manager.createBranch('feature', options)
        ).rejects.toThrow(BranchError)

        await expect(
          manager.createBranch('feature', options)
        ).rejects.toMatchObject({
          code: 'INVALID_START_POINT'
        })
      })

      it('should fail if start point is empty string', async () => {
        const options: CreateBranchOptions = {
          startPoint: ''
        }

        await expect(
          manager.createBranch('feature', options)
        ).rejects.toThrow(BranchError)
      })
    })

    describe('Invalid branch names', () => {
      it('should fail if branch name contains spaces', async () => {
        await expect(
          manager.createBranch('invalid name')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.createBranch('invalid name')
        ).rejects.toMatchObject({
          code: 'INVALID_NAME'
        })
      })

      it('should fail if branch name starts with dash', async () => {
        await expect(
          manager.createBranch('-invalid')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name contains double dots', async () => {
        await expect(
          manager.createBranch('invalid..name')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name ends with .lock', async () => {
        await expect(
          manager.createBranch('branch.lock')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name contains control characters', async () => {
        await expect(
          manager.createBranch('invalid\x00name')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name is empty', async () => {
        await expect(
          manager.createBranch('')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name is HEAD', async () => {
        await expect(
          manager.createBranch('HEAD')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name contains ~', async () => {
        await expect(
          manager.createBranch('branch~1')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name contains ^', async () => {
        await expect(
          manager.createBranch('branch^2')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if branch name contains :', async () => {
        await expect(
          manager.createBranch('branch:name')
        ).rejects.toThrow(BranchError)
      })
    })

    describe('Tracking configuration', () => {
      it('should set up tracking when track is true', async () => {
        const branch = await manager.createBranch('feature', {
          startPoint: 'refs/remotes/origin/main',
          track: true
        })

        expect(branch.tracking).toBeDefined()
        expect(branch.tracking?.remoteBranch).toBe('refs/remotes/origin/main')
      })

      it('should set up tracking with explicit upstream ref', async () => {
        const branch = await manager.createBranch('feature', {
          track: 'refs/remotes/origin/develop'
        })

        expect(branch.tracking).toBeDefined()
        expect(branch.tracking?.remoteBranch).toBe('refs/remotes/origin/develop')
      })

      it('should not set tracking when track is false', async () => {
        const branch = await manager.createBranch('feature', {
          track: false
        })

        expect(branch.tracking).toBeUndefined()
      })
    })

    describe('Dry run mode', () => {
      it('should not create branch when dryRun is true', async () => {
        const branch = await manager.createBranch('dry-test', { dryRun: true })

        expect(branch).toBeDefined()
        expect(branch.name).toBe('dry-test')

        // Branch should not actually exist
        const exists = await manager.branchExists('dry-test')
        expect(exists).toBe(false)
      })

      it('should validate branch name in dry run mode', async () => {
        await expect(
          manager.createBranch('invalid name', { dryRun: true })
        ).rejects.toThrow(BranchError)
      })
    })
  })

  // ==========================================================================
  // deleteBranch Tests
  // ==========================================================================

  describe('deleteBranch', () => {
    beforeEach(async () => {
      // Create some branches for deletion tests
      await manager.createBranch('feature')
      await manager.createBranch('hotfix')
      await manager.createBranch('experiment')
    })

    describe('Basic branch deletion', () => {
      it('should delete an existing branch', async () => {
        await manager.deleteBranch('feature')

        const exists = await manager.branchExists('feature')
        expect(exists).toBe(false)
      })

      it('should delete branch and verify it no longer exists', async () => {
        const existsBefore = await manager.branchExists('hotfix')
        expect(existsBefore).toBe(true)

        await manager.deleteBranch('hotfix')

        const existsAfter = await manager.branchExists('hotfix')
        expect(existsAfter).toBe(false)
      })

      it('should delete multiple branches in sequence', async () => {
        await manager.deleteBranch('feature')
        await manager.deleteBranch('hotfix')
        await manager.deleteBranch('experiment')

        expect(await manager.branchExists('feature')).toBe(false)
        expect(await manager.branchExists('hotfix')).toBe(false)
        expect(await manager.branchExists('experiment')).toBe(false)
      })
    })

    describe('Branch does not exist', () => {
      it('should fail if branch does not exist', async () => {
        await expect(
          manager.deleteBranch('non-existent')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.deleteBranch('non-existent')
        ).rejects.toMatchObject({
          code: 'NOT_FOUND'
        })
      })
    })

    describe('Cannot delete current branch', () => {
      it('should fail if branch is current HEAD', async () => {
        // main is the current branch (from HEAD)
        await expect(
          manager.deleteBranch('main')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.deleteBranch('main')
        ).rejects.toMatchObject({
          code: 'CANNOT_DELETE_CURRENT'
        })
      })
    })

    describe('Unmerged branches', () => {
      it('should fail if branch is not fully merged without force', async () => {
        // Update experiment branch to point to a different SHA (simulating unmerged commits)
        // Use force:true to overwrite the existing branch created in beforeEach
        await manager.createBranch('experiment', { startPoint: sampleSha2, force: true })

        const options: DeleteBranchOptions = {
          force: false
        }

        await expect(
          manager.deleteBranch('experiment', options)
        ).rejects.toThrow(BranchError)

        await expect(
          manager.deleteBranch('experiment', options)
        ).rejects.toMatchObject({
          code: 'NOT_FULLY_MERGED'
        })
      })

      it('should delete unmerged branch with force option', async () => {
        // Update experiment branch to point to a different SHA (simulating unmerged commits)
        // Use force:true to overwrite the existing branch created in beforeEach
        await manager.createBranch('experiment', { startPoint: sampleSha2, force: true })

        const options: DeleteBranchOptions = {
          force: true
        }

        await manager.deleteBranch('experiment', options)

        const exists = await manager.branchExists('experiment')
        expect(exists).toBe(false)
      })
    })

    describe('Remote branch deletion', () => {
      it('should delete remote tracking branch', async () => {
        // First ensure remote branch exists
        const exists = await manager.branchExists('origin/main')
        if (exists) {
          const options: DeleteBranchOptions = {
            remote: 'origin'
          }

          await manager.deleteBranch('main', options)

          const existsAfter = await manager.branchExists('origin/main')
          expect(existsAfter).toBe(false)
        }
      })
    })

    describe('Dry run mode', () => {
      it('should not delete branch when dryRun is true', async () => {
        const options: DeleteBranchOptions = {
          dryRun: true
        }

        await manager.deleteBranch('feature', options)

        // Branch should still exist
        const exists = await manager.branchExists('feature')
        expect(exists).toBe(true)
      })

      it('should still validate branch exists in dry run mode', async () => {
        const options: DeleteBranchOptions = {
          dryRun: true
        }

        await expect(
          manager.deleteBranch('non-existent', options)
        ).rejects.toThrow(BranchError)
      })
    })
  })

  // ==========================================================================
  // renameBranch Tests
  // ==========================================================================

  describe('renameBranch', () => {
    beforeEach(async () => {
      // Create branches for renaming tests
      await manager.createBranch('old-name', { startPoint: sampleSha2 })
      await manager.createBranch('another-branch', { startPoint: sampleSha3 })
    })

    describe('Basic branch renaming', () => {
      it('should rename a branch', async () => {
        const branch = await manager.renameBranch('old-name', 'new-name')

        expect(branch).toBeDefined()
        expect(branch.name).toBe('new-name')
        expect(branch.ref).toBe('refs/heads/new-name')
      })

      it('should preserve SHA when renaming', async () => {
        const branch = await manager.renameBranch('old-name', 'new-name')

        expect(branch.sha).toBe(sampleSha2)
      })

      it('should remove old branch after rename', async () => {
        await manager.renameBranch('old-name', 'new-name')

        const oldExists = await manager.branchExists('old-name')
        const newExists = await manager.branchExists('new-name')

        expect(oldExists).toBe(false)
        expect(newExists).toBe(true)
      })

      it('should rename branch with nested paths', async () => {
        await manager.createBranch('feature/auth')
        const branch = await manager.renameBranch('feature/auth', 'feature/authentication')

        expect(branch.name).toBe('feature/authentication')
      })
    })

    describe('Renaming current branch', () => {
      it('should update HEAD when renaming current branch', async () => {
        // Rename main (which is current)
        const branch = await manager.renameBranch('main', 'master')

        expect(branch.name).toBe('master')

        // HEAD should now point to master
        const current = await manager.getCurrentBranch()
        expect(current?.name).toBe('master')
      })
    })

    describe('Old branch does not exist', () => {
      it('should fail if old branch does not exist', async () => {
        await expect(
          manager.renameBranch('non-existent', 'new-name')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.renameBranch('non-existent', 'new-name')
        ).rejects.toMatchObject({
          code: 'NOT_FOUND'
        })
      })
    })

    describe('New branch name already exists', () => {
      it('should fail if new name already exists without force', async () => {
        await expect(
          manager.renameBranch('old-name', 'another-branch')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.renameBranch('old-name', 'another-branch')
        ).rejects.toMatchObject({
          code: 'ALREADY_EXISTS'
        })
      })

      it('should overwrite existing branch with force option', async () => {
        const options: RenameBranchOptions = {
          force: true
        }

        const branch = await manager.renameBranch('old-name', 'another-branch', options)

        expect(branch.name).toBe('another-branch')
        expect(branch.sha).toBe(sampleSha2) // Should have old-name's SHA
      })
    })

    describe('Invalid new branch name', () => {
      it('should fail if new name is invalid', async () => {
        await expect(
          manager.renameBranch('old-name', 'invalid name')
        ).rejects.toThrow(BranchError)

        await expect(
          manager.renameBranch('old-name', 'invalid name')
        ).rejects.toMatchObject({
          code: 'INVALID_NAME'
        })
      })

      it('should fail if new name is HEAD', async () => {
        await expect(
          manager.renameBranch('old-name', 'HEAD')
        ).rejects.toThrow(BranchError)
      })

      it('should fail if new name contains double dots', async () => {
        await expect(
          manager.renameBranch('old-name', 'invalid..name')
        ).rejects.toThrow(BranchError)
      })
    })

    describe('Upstream tracking', () => {
      it('should preserve upstream tracking when renaming', async () => {
        // Set up tracking for old-name
        await manager.setUpstream('old-name', {
          remote: 'origin',
          remoteBranch: 'old-name'
        })

        const branch = await manager.renameBranch('old-name', 'new-name')

        // Tracking should be updated to new-name
        const tracking = await manager.getTrackingInfo('new-name')
        expect(tracking).toBeDefined()
      })
    })

    describe('Dry run mode', () => {
      it('should not rename branch when dryRun is true', async () => {
        const options: RenameBranchOptions = {
          dryRun: true
        }

        const branch = await manager.renameBranch('old-name', 'new-name', options)

        expect(branch.name).toBe('new-name')

        // Old branch should still exist
        const oldExists = await manager.branchExists('old-name')
        const newExists = await manager.branchExists('new-name')

        expect(oldExists).toBe(true)
        expect(newExists).toBe(false)
      })

      it('should validate new name in dry run mode', async () => {
        const options: RenameBranchOptions = {
          dryRun: true
        }

        await expect(
          manager.renameBranch('old-name', 'invalid name', options)
        ).rejects.toThrow(BranchError)
      })
    })
  })

  // ==========================================================================
  // Additional BranchManager method tests
  // ==========================================================================

  describe('listBranches', () => {
    beforeEach(async () => {
      backend = createMockBackendWithBranches()
      storage = new RefStorage(backend)
      manager = new BranchManager(storage)
    })

    it('should list all local branches', async () => {
      const branches = await manager.listBranches()

      expect(branches).toBeDefined()
      expect(Array.isArray(branches)).toBe(true)
      expect(branches.length).toBeGreaterThan(0)
    })

    it('should include remote branches when requested', async () => {
      const options: ListBranchesOptions = {
        includeRemotes: true
      }

      const branches = await manager.listBranches(options)

      const remoteBranches = branches.filter(b => b.isRemote)
      expect(remoteBranches.length).toBeGreaterThan(0)
    })

    it('should filter branches by pattern', async () => {
      const options: ListBranchesOptions = {
        pattern: 'feature/*'
      }

      const branches = await manager.listBranches(options)

      expect(branches.every(b => b.name.startsWith('feature/'))).toBe(true)
    })
  })

  describe('getCurrentBranch', () => {
    it('should return current branch', async () => {
      const current = await manager.getCurrentBranch()

      expect(current).toBeDefined()
      expect(current?.name).toBe('main')
      expect(current?.isCurrent).toBe(true)
    })

    it('should return null when HEAD is detached', async () => {
      // Simulate detached HEAD
      await backend.writeRef({ name: 'HEAD', target: sampleSha, type: 'direct' })

      const current = await manager.getCurrentBranch()

      expect(current).toBeNull()
    })
  })

  describe('getBranch', () => {
    beforeEach(async () => {
      await manager.createBranch('test-branch', { startPoint: sampleSha2 })
    })

    it('should return branch info for existing branch', async () => {
      const branch = await manager.getBranch('test-branch')

      expect(branch).toBeDefined()
      expect(branch?.name).toBe('test-branch')
      expect(branch?.sha).toBe(sampleSha2)
    })

    it('should return null for non-existent branch', async () => {
      const branch = await manager.getBranch('non-existent')

      expect(branch).toBeNull()
    })
  })

  describe('branchExists', () => {
    beforeEach(async () => {
      await manager.createBranch('exists')
    })

    it('should return true for existing branch', async () => {
      const exists = await manager.branchExists('exists')

      expect(exists).toBe(true)
    })

    it('should return false for non-existent branch', async () => {
      const exists = await manager.branchExists('does-not-exist')

      expect(exists).toBe(false)
    })
  })

  describe('setUpstream', () => {
    beforeEach(async () => {
      await manager.createBranch('feature')
    })

    it('should set upstream tracking branch', async () => {
      const options: SetUpstreamOptions = {
        remote: 'origin',
        remoteBranch: 'feature'
      }

      await manager.setUpstream('feature', options)

      const tracking = await manager.getTrackingInfo('feature')
      expect(tracking).toBeDefined()
      expect(tracking?.remote).toBe('origin')
    })

    it('should fail if branch does not exist', async () => {
      const options: SetUpstreamOptions = {
        remote: 'origin',
        remoteBranch: 'main'
      }

      await expect(
        manager.setUpstream('non-existent', options)
      ).rejects.toThrow(BranchError)

      await expect(
        manager.setUpstream('non-existent', options)
      ).rejects.toMatchObject({
        code: 'NOT_FOUND'
      })
    })

    it('should remove upstream when unset is true', async () => {
      const options: SetUpstreamOptions = {
        remote: 'origin',
        remoteBranch: 'feature'
      }

      await manager.setUpstream('feature', options)

      const unsetOptions: SetUpstreamOptions = {
        unset: true
      }

      await manager.setUpstream('feature', unsetOptions)

      const tracking = await manager.getTrackingInfo('feature')
      expect(tracking).toBeNull()
    })
  })

  describe('getTrackingInfo', () => {
    it('should return tracking info for tracked branch', async () => {
      await manager.createBranch('tracked')
      await manager.setUpstream('tracked', {
        remote: 'origin',
        remoteBranch: 'tracked'
      })

      const tracking = await manager.getTrackingInfo('tracked')

      expect(tracking).toBeDefined()
      expect(tracking?.remote).toBe('origin')
    })

    it('should return null for untracked branch', async () => {
      await manager.createBranch('untracked')

      const tracking = await manager.getTrackingInfo('untracked')

      expect(tracking).toBeNull()
    })
  })

  describe('isMerged', () => {
    beforeEach(async () => {
      await manager.createBranch('merged-branch')
      await manager.createBranch('unmerged-branch', { startPoint: sampleSha3 })
    })

    it('should return true if branch is fully merged', async () => {
      const isMerged = await manager.isMerged('merged-branch', 'main')

      expect(typeof isMerged).toBe('boolean')
    })

    it('should return false if branch has unmerged commits', async () => {
      const isMerged = await manager.isMerged('unmerged-branch', 'main')

      expect(typeof isMerged).toBe('boolean')
    })
  })

  describe('forceDeleteBranch', () => {
    beforeEach(async () => {
      await manager.createBranch('force-delete-test')
    })

    it('should delete branch without merge check', async () => {
      await manager.forceDeleteBranch('force-delete-test')

      const exists = await manager.branchExists('force-delete-test')
      expect(exists).toBe(false)
    })

    it('should fail if branch does not exist', async () => {
      await expect(
        manager.forceDeleteBranch('non-existent')
      ).rejects.toThrow(BranchError)
    })

    it('should fail if branch is current', async () => {
      await expect(
        manager.forceDeleteBranch('main')
      ).rejects.toThrow(BranchError)

      await expect(
        manager.forceDeleteBranch('main')
      ).rejects.toMatchObject({
        code: 'CANNOT_DELETE_CURRENT'
      })
    })
  })
})
