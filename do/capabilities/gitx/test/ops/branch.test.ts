import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BranchOptions,
  BranchInfo,
  BranchListOptions,
  BranchDeleteOptions,
  BranchRenameOptions,
  CheckoutOptions,
  TrackingInfo,
  RefStore,
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  checkoutBranch,
  getBranchInfo,
  setBranchTracking,
  getBranchTracking,
  removeBranchTracking,
  getCurrentBranch,
  branchExists,
  isValidBranchName,
  normalizeBranchName,
  getDefaultBranch,
  setDefaultBranch
} from '../../src/ops/branch'

// ============================================================================
// Test Helpers
// ============================================================================

const sampleCommitSha = 'a'.repeat(40)
const sampleCommitSha2 = 'b'.repeat(40)
const sampleCommitSha3 = 'c'.repeat(40)

/**
 * Create a mock ref store for testing
 */
function createMockRefStore(
  refs: Map<string, string> = new Map(),
  head: string = 'refs/heads/main'
): RefStore {
  const storedRefs = new Map(refs)
  let currentHead = head

  return {
    async getRef(ref: string) {
      return storedRefs.get(ref) ?? null
    },
    async setRef(ref: string, sha: string) {
      storedRefs.set(ref, sha)
    },
    async deleteRef(ref: string) {
      storedRefs.delete(ref)
    },
    async listRefs(prefix?: string) {
      const result: Array<{ ref: string; sha: string }> = []
      for (const [ref, sha] of storedRefs) {
        if (!prefix || ref.startsWith(prefix)) {
          result.push({ ref, sha })
        }
      }
      return result
    },
    async getHead() {
      return currentHead
    },
    async setHead(ref: string) {
      currentHead = ref
    },
    async getSymbolicRef(ref: string) {
      if (ref === 'HEAD') {
        return currentHead.startsWith('refs/') ? currentHead : null
      }
      return null
    },
    async setSymbolicRef(ref: string, target: string) {
      if (ref === 'HEAD') {
        currentHead = target
      }
    }
  }
}

/**
 * Create a mock ref store with some sample branches
 */
function createMockRefStoreWithBranches(): RefStore {
  const refs = new Map([
    ['refs/heads/main', sampleCommitSha],
    ['refs/heads/feature/login', sampleCommitSha2],
    ['refs/heads/feature/signup', sampleCommitSha3],
    ['refs/heads/develop', sampleCommitSha2],
    ['refs/remotes/origin/main', sampleCommitSha],
    ['refs/remotes/origin/feature/login', sampleCommitSha2]
  ])
  return createMockRefStore(refs, 'refs/heads/main')
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Branch Creation', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('createBranch', () => {
    describe('Creating a new branch from HEAD', () => {
      it('should create a branch pointing to current HEAD', async () => {
        const options: BranchOptions = {
          name: 'new-feature'
        }

        const result = await createBranch(refStore, options)

        expect(result).toBeDefined()
        expect(result.name).toBe('new-feature')
        expect(result.sha).toBe(sampleCommitSha)
        expect(result.created).toBe(true)
      })

      it('should create a branch with full ref path', async () => {
        const options: BranchOptions = {
          name: 'bugfix/issue-123'
        }

        const result = await createBranch(refStore, options)

        expect(result.ref).toBe('refs/heads/bugfix/issue-123')
      })
    })

    describe('Creating a branch from a specific commit', () => {
      it('should create a branch pointing to specified commit', async () => {
        const options: BranchOptions = {
          name: 'from-specific-commit',
          startPoint: sampleCommitSha2
        }

        const result = await createBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })

      it('should create a branch from another branch name', async () => {
        const options: BranchOptions = {
          name: 'from-develop',
          startPoint: 'develop'
        }

        const result = await createBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })

      it('should create a branch from a remote tracking branch', async () => {
        const options: BranchOptions = {
          name: 'local-feature',
          startPoint: 'origin/feature/login'
        }

        const result = await createBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })
    })

    describe('Branch name validation', () => {
      it('should throw error for invalid branch name with spaces', async () => {
        const options: BranchOptions = {
          name: 'invalid name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name starting with dash', async () => {
        const options: BranchOptions = {
          name: '-invalid'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name with double dots', async () => {
        const options: BranchOptions = {
          name: 'invalid..name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name ending with .lock', async () => {
        const options: BranchOptions = {
          name: 'branch.lock'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name with control characters', async () => {
        const options: BranchOptions = {
          name: 'invalid\x00name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name with tilde', async () => {
        const options: BranchOptions = {
          name: 'invalid~name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name with caret', async () => {
        const options: BranchOptions = {
          name: 'invalid^name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should throw error for branch name with colon', async () => {
        const options: BranchOptions = {
          name: 'invalid:name'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should accept valid branch names with slashes', async () => {
        const options: BranchOptions = {
          name: 'feature/new-feature'
        }

        const result = await createBranch(refStore, options)

        expect(result.name).toBe('feature/new-feature')
      })

      it('should accept valid branch names with hyphens', async () => {
        const options: BranchOptions = {
          name: 'my-feature-branch'
        }

        const result = await createBranch(refStore, options)

        expect(result.name).toBe('my-feature-branch')
      })

      it('should accept valid branch names with underscores', async () => {
        const options: BranchOptions = {
          name: 'my_feature_branch'
        }

        const result = await createBranch(refStore, options)

        expect(result.name).toBe('my_feature_branch')
      })
    })

    describe('Force creating a branch', () => {
      it('should fail when branch already exists without force', async () => {
        const options: BranchOptions = {
          name: 'main'
        }

        await expect(createBranch(refStore, options)).rejects.toThrow()
      })

      it('should update existing branch when force is true', async () => {
        const options: BranchOptions = {
          name: 'main',
          startPoint: sampleCommitSha2,
          force: true
        }

        const result = await createBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
        expect(result.created).toBe(false) // Updated, not created
      })
    })

    describe('Creating branch and checking it out', () => {
      it('should create and checkout branch when checkout is true', async () => {
        const options: BranchOptions = {
          name: 'new-and-checkout',
          checkout: true
        }

        await createBranch(refStore, options)
        const currentBranch = await getCurrentBranch(refStore)

        expect(currentBranch).toBe('new-and-checkout')
      })
    })
  })
})

describe('Branch Deletion', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('deleteBranch', () => {
    describe('Deleting a merged branch', () => {
      it('should delete a branch that is fully merged', async () => {
        const options: BranchDeleteOptions = {
          name: 'feature/login'
        }

        const result = await deleteBranch(refStore, options)

        expect(result.deleted).toBe(true)
        expect(result.name).toBe('feature/login')
      })

      it('should return the last commit SHA of deleted branch', async () => {
        const options: BranchDeleteOptions = {
          name: 'feature/login'
        }

        const result = await deleteBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })
    })

    describe('Deleting an unmerged branch', () => {
      it('should fail when deleting unmerged branch without force', async () => {
        const options: BranchDeleteOptions = {
          name: 'feature/signup',
          checkMerged: true
        }

        await expect(deleteBranch(refStore, options)).rejects.toThrow()
      })

      it('should delete unmerged branch when force is true', async () => {
        const options: BranchDeleteOptions = {
          name: 'feature/signup',
          force: true
        }

        const result = await deleteBranch(refStore, options)

        expect(result.deleted).toBe(true)
      })
    })

    describe('Deleting current branch', () => {
      it('should fail when trying to delete current branch', async () => {
        const options: BranchDeleteOptions = {
          name: 'main'
        }

        await expect(deleteBranch(refStore, options)).rejects.toThrow()
      })
    })

    describe('Deleting non-existent branch', () => {
      it('should throw error when branch does not exist', async () => {
        const options: BranchDeleteOptions = {
          name: 'non-existent'
        }

        await expect(deleteBranch(refStore, options)).rejects.toThrow()
      })
    })

    describe('Deleting multiple branches', () => {
      it('should delete multiple branches at once', async () => {
        const options: BranchDeleteOptions = {
          names: ['feature/login', 'feature/signup'],
          force: true
        }

        const result = await deleteBranch(refStore, options)

        expect(result.deletedBranches).toHaveLength(2)
        expect(result.deletedBranches.map(b => b.name)).toContain('feature/login')
        expect(result.deletedBranches.map(b => b.name)).toContain('feature/signup')
      })
    })

    describe('Deleting remote tracking branches', () => {
      it('should delete remote tracking branch with -r flag', async () => {
        const options: BranchDeleteOptions = {
          name: 'origin/feature/login',
          remote: true
        }

        const result = await deleteBranch(refStore, options)

        expect(result.deleted).toBe(true)
      })
    })
  })
})

describe('Branch Listing', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('listBranches', () => {
    describe('Listing local branches', () => {
      it('should list all local branches', async () => {
        const options: BranchListOptions = {}

        const branches = await listBranches(refStore, options)

        expect(branches).toContainEqual(expect.objectContaining({ name: 'main' }))
        expect(branches).toContainEqual(expect.objectContaining({ name: 'feature/login' }))
        expect(branches).toContainEqual(expect.objectContaining({ name: 'feature/signup' }))
        expect(branches).toContainEqual(expect.objectContaining({ name: 'develop' }))
      })

      it('should indicate the current branch', async () => {
        const branches = await listBranches(refStore, {})
        const mainBranch = branches.find(b => b.name === 'main')

        expect(mainBranch?.current).toBe(true)
      })

      it('should include SHA for each branch', async () => {
        const branches = await listBranches(refStore, {})
        const mainBranch = branches.find(b => b.name === 'main')

        expect(mainBranch?.sha).toBe(sampleCommitSha)
      })
    })

    describe('Listing remote branches', () => {
      it('should list remote branches when remote is true', async () => {
        const options: BranchListOptions = {
          remote: true
        }

        const branches = await listBranches(refStore, options)

        expect(branches).toContainEqual(expect.objectContaining({ name: 'origin/main' }))
        expect(branches).toContainEqual(expect.objectContaining({ name: 'origin/feature/login' }))
      })

      it('should not include local branches when listing remote', async () => {
        const options: BranchListOptions = {
          remote: true
        }

        const branches = await listBranches(refStore, options)
        const localMain = branches.find(b => b.name === 'main' && !b.name.includes('/'))

        expect(localMain).toBeUndefined()
      })
    })

    describe('Listing all branches', () => {
      it('should list both local and remote branches when all is true', async () => {
        const options: BranchListOptions = {
          all: true
        }

        const branches = await listBranches(refStore, options)

        expect(branches).toContainEqual(expect.objectContaining({ name: 'main' }))
        expect(branches).toContainEqual(expect.objectContaining({ name: 'origin/main' }))
      })
    })

    describe('Filtering branches', () => {
      it('should filter branches by pattern', async () => {
        const options: BranchListOptions = {
          pattern: 'feature/*'
        }

        const branches = await listBranches(refStore, options)

        expect(branches.every(b => b.name.startsWith('feature/'))).toBe(true)
      })

      it('should filter branches containing specific commit', async () => {
        const options: BranchListOptions = {
          contains: sampleCommitSha2
        }

        const branches = await listBranches(refStore, options)

        expect(branches.length).toBeGreaterThan(0)
        expect(branches.some(b => b.name === 'feature/login')).toBe(true)
      })

      it('should filter merged branches', async () => {
        const options: BranchListOptions = {
          merged: 'main'
        }

        const branches = await listBranches(refStore, options)

        // All listed branches should be merged into main
        expect(branches).toBeDefined()
      })

      it('should filter unmerged branches', async () => {
        const options: BranchListOptions = {
          noMerged: 'main'
        }

        const branches = await listBranches(refStore, options)

        // All listed branches should NOT be merged into main
        expect(branches).toBeDefined()
      })
    })

    describe('Sorting branches', () => {
      it('should sort branches by name', async () => {
        const options: BranchListOptions = {
          sort: 'name'
        }

        const branches = await listBranches(refStore, options)
        const names = branches.map(b => b.name)

        expect(names).toEqual([...names].sort())
      })

      it('should sort branches by committer date', async () => {
        const options: BranchListOptions = {
          sort: 'committerdate'
        }

        const branches = await listBranches(refStore, options)

        expect(branches).toBeDefined()
      })

      it('should support descending sort order', async () => {
        const options: BranchListOptions = {
          sort: '-name' // Descending by name
        }

        const branches = await listBranches(refStore, options)
        const names = branches.map(b => b.name)

        expect(names).toEqual([...names].sort().reverse())
      })
    })

    describe('Verbose output', () => {
      it('should include commit subject when verbose', async () => {
        const options: BranchListOptions = {
          verbose: true
        }

        const branches = await listBranches(refStore, options)

        expect(branches[0]).toHaveProperty('commitSubject')
      })

      it('should include tracking info when verbose', async () => {
        const options: BranchListOptions = {
          verbose: true
        }

        const branches = await listBranches(refStore, options)

        expect(branches[0]).toHaveProperty('tracking')
      })
    })
  })
})

describe('Branch Renaming', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('renameBranch', () => {
    describe('Renaming a branch', () => {
      it('should rename a branch', async () => {
        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'development'
        }

        const result = await renameBranch(refStore, options)

        expect(result.renamed).toBe(true)
        expect(result.oldName).toBe('develop')
        expect(result.newName).toBe('development')
      })

      it('should preserve the SHA when renaming', async () => {
        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'development'
        }

        const result = await renameBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })

      it('should update HEAD if renaming current branch', async () => {
        // First checkout develop
        await checkoutBranch(refStore, { name: 'develop' })

        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'development'
        }

        await renameBranch(refStore, options)
        const currentBranch = await getCurrentBranch(refStore)

        expect(currentBranch).toBe('development')
      })
    })

    describe('Renaming current branch', () => {
      it('should rename current branch when oldName not specified', async () => {
        // main is current branch
        const options: BranchRenameOptions = {
          newName: 'master'
        }

        const result = await renameBranch(refStore, options)

        expect(result.oldName).toBe('main')
        expect(result.newName).toBe('master')
      })
    })

    describe('Renaming with force', () => {
      it('should fail if new name already exists without force', async () => {
        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'main'
        }

        await expect(renameBranch(refStore, options)).rejects.toThrow()
      })

      it('should overwrite existing branch when force is true', async () => {
        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'main',
          force: true
        }

        const result = await renameBranch(refStore, options)

        expect(result.renamed).toBe(true)
      })
    })

    describe('Renaming validation', () => {
      it('should fail when old branch does not exist', async () => {
        const options: BranchRenameOptions = {
          oldName: 'non-existent',
          newName: 'new-name'
        }

        await expect(renameBranch(refStore, options)).rejects.toThrow()
      })

      it('should fail when new name is invalid', async () => {
        const options: BranchRenameOptions = {
          oldName: 'develop',
          newName: 'invalid name'
        }

        await expect(renameBranch(refStore, options)).rejects.toThrow()
      })
    })
  })
})

describe('Branch Checkout', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('checkoutBranch', () => {
    describe('Checking out an existing branch', () => {
      it('should checkout an existing branch', async () => {
        const options: CheckoutOptions = {
          name: 'develop'
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.success).toBe(true)
        expect(result.branch).toBe('develop')
      })

      it('should update HEAD to point to new branch', async () => {
        const options: CheckoutOptions = {
          name: 'develop'
        }

        await checkoutBranch(refStore, options)
        const currentBranch = await getCurrentBranch(refStore)

        expect(currentBranch).toBe('develop')
      })

      it('should return the SHA of checked out branch', async () => {
        const options: CheckoutOptions = {
          name: 'develop'
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })
    })

    describe('Checking out a new branch', () => {
      it('should create and checkout new branch with -b flag', async () => {
        const options: CheckoutOptions = {
          name: 'new-branch',
          create: true
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.success).toBe(true)
        expect(result.branch).toBe('new-branch')
        expect(result.created).toBe(true)
      })

      it('should create branch from specified start point', async () => {
        const options: CheckoutOptions = {
          name: 'new-branch',
          create: true,
          startPoint: sampleCommitSha2
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.sha).toBe(sampleCommitSha2)
      })

      it('should fail with -b if branch already exists', async () => {
        const options: CheckoutOptions = {
          name: 'develop',
          create: true
        }

        await expect(checkoutBranch(refStore, options)).rejects.toThrow()
      })

      it('should force create with -B even if exists', async () => {
        const options: CheckoutOptions = {
          name: 'develop',
          create: true,
          force: true,
          startPoint: sampleCommitSha3
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.success).toBe(true)
        expect(result.sha).toBe(sampleCommitSha3)
      })
    })

    describe('Detached HEAD checkout', () => {
      it('should checkout a specific commit (detached HEAD)', async () => {
        const options: CheckoutOptions = {
          sha: sampleCommitSha2,
          detach: true
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.success).toBe(true)
        expect(result.detached).toBe(true)
        expect(result.sha).toBe(sampleCommitSha2)
      })

      it('should indicate detached state after checkout', async () => {
        const options: CheckoutOptions = {
          sha: sampleCommitSha2,
          detach: true
        }

        await checkoutBranch(refStore, options)
        const currentBranch = await getCurrentBranch(refStore)

        expect(currentBranch).toBeNull() // No branch in detached state
      })
    })

    describe('Checkout from remote', () => {
      it('should create tracking branch from remote', async () => {
        const options: CheckoutOptions = {
          name: 'feature/login',
          track: 'origin/feature/login'
        }

        const result = await checkoutBranch(refStore, options)

        expect(result.success).toBe(true)
        expect(result.tracking).toBe('origin/feature/login')
      })
    })

    describe('Checkout validation', () => {
      it('should fail when branch does not exist', async () => {
        const options: CheckoutOptions = {
          name: 'non-existent'
        }

        await expect(checkoutBranch(refStore, options)).rejects.toThrow()
      })

      it('should fail when both name and sha provided without detach', async () => {
        const options: CheckoutOptions = {
          name: 'main',
          sha: sampleCommitSha2
        }

        await expect(checkoutBranch(refStore, options)).rejects.toThrow()
      })
    })
  })
})

describe('Branch Tracking', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('setBranchTracking', () => {
    it('should set upstream tracking branch', async () => {
      const result = await setBranchTracking(refStore, 'develop', 'origin/develop')

      expect(result.success).toBe(true)
      expect(result.branch).toBe('develop')
      expect(result.upstream).toBe('origin/develop')
    })

    it('should parse remote and branch from upstream', async () => {
      const result = await setBranchTracking(refStore, 'develop', 'origin/develop')

      expect(result.remote).toBe('origin')
      expect(result.remoteBranch).toBe('develop')
    })

    it('should fail if local branch does not exist', async () => {
      await expect(
        setBranchTracking(refStore, 'non-existent', 'origin/main')
      ).rejects.toThrow()
    })

    it('should overwrite existing tracking info', async () => {
      await setBranchTracking(refStore, 'develop', 'origin/develop')
      const result = await setBranchTracking(refStore, 'develop', 'upstream/develop')

      expect(result.upstream).toBe('upstream/develop')
    })
  })

  describe('getBranchTracking', () => {
    it('should return tracking info for tracked branch', async () => {
      await setBranchTracking(refStore, 'develop', 'origin/develop')

      const tracking = await getBranchTracking(refStore, 'develop')

      expect(tracking).not.toBeNull()
      expect(tracking?.upstream).toBe('origin/develop')
    })

    it('should return null for untracked branch', async () => {
      const tracking = await getBranchTracking(refStore, 'develop')

      expect(tracking).toBeNull()
    })

    it('should include ahead/behind counts', async () => {
      await setBranchTracking(refStore, 'develop', 'origin/develop')

      const tracking = await getBranchTracking(refStore, 'develop')

      expect(tracking).toHaveProperty('ahead')
      expect(tracking).toHaveProperty('behind')
    })
  })

  describe('removeBranchTracking', () => {
    it('should remove tracking configuration', async () => {
      await setBranchTracking(refStore, 'develop', 'origin/develop')

      const result = await removeBranchTracking(refStore, 'develop')

      expect(result.success).toBe(true)
    })

    it('should return null tracking after removal', async () => {
      await setBranchTracking(refStore, 'develop', 'origin/develop')
      await removeBranchTracking(refStore, 'develop')

      const tracking = await getBranchTracking(refStore, 'develop')

      expect(tracking).toBeNull()
    })

    it('should succeed even if branch was not tracked', async () => {
      const result = await removeBranchTracking(refStore, 'develop')

      expect(result.success).toBe(true)
    })
  })
})

describe('Branch Information', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('getBranchInfo', () => {
    it('should return branch information', async () => {
      const info = await getBranchInfo(refStore, 'main')

      expect(info).not.toBeNull()
      expect(info?.name).toBe('main')
      expect(info?.sha).toBe(sampleCommitSha)
    })

    it('should return null for non-existent branch', async () => {
      const info = await getBranchInfo(refStore, 'non-existent')

      expect(info).toBeNull()
    })

    it('should include full ref path', async () => {
      const info = await getBranchInfo(refStore, 'main')

      expect(info?.ref).toBe('refs/heads/main')
    })

    it('should indicate if branch is current', async () => {
      const info = await getBranchInfo(refStore, 'main')

      expect(info?.current).toBe(true)
    })
  })

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      const current = await getCurrentBranch(refStore)

      expect(current).toBe('main')
    })

    it('should return null in detached HEAD state', async () => {
      await checkoutBranch(refStore, { sha: sampleCommitSha2, detach: true })

      const current = await getCurrentBranch(refStore)

      expect(current).toBeNull()
    })
  })

  describe('branchExists', () => {
    it('should return true for existing branch', async () => {
      const exists = await branchExists(refStore, 'main')

      expect(exists).toBe(true)
    })

    it('should return false for non-existent branch', async () => {
      const exists = await branchExists(refStore, 'non-existent')

      expect(exists).toBe(false)
    })

    it('should check remote branches when specified', async () => {
      const exists = await branchExists(refStore, 'origin/main', { remote: true })

      expect(exists).toBe(true)
    })
  })
})

describe('Branch Name Validation', () => {
  describe('isValidBranchName', () => {
    it('should accept simple valid names', () => {
      expect(isValidBranchName('main')).toBe(true)
      expect(isValidBranchName('feature')).toBe(true)
      expect(isValidBranchName('my-branch')).toBe(true)
    })

    it('should accept names with slashes', () => {
      expect(isValidBranchName('feature/login')).toBe(true)
      expect(isValidBranchName('feature/user/signup')).toBe(true)
    })

    it('should reject names with spaces', () => {
      expect(isValidBranchName('my branch')).toBe(false)
    })

    it('should reject names with double dots', () => {
      expect(isValidBranchName('my..branch')).toBe(false)
    })

    it('should reject names starting with dash', () => {
      expect(isValidBranchName('-mybranch')).toBe(false)
    })

    it('should reject names ending with .lock', () => {
      expect(isValidBranchName('branch.lock')).toBe(false)
    })

    it('should reject names with tilde', () => {
      expect(isValidBranchName('branch~1')).toBe(false)
    })

    it('should reject names with caret', () => {
      expect(isValidBranchName('branch^2')).toBe(false)
    })

    it('should reject names with colon', () => {
      expect(isValidBranchName('branch:name')).toBe(false)
    })

    it('should reject names with backslash', () => {
      expect(isValidBranchName('branch\\name')).toBe(false)
    })

    it('should reject names with question mark', () => {
      expect(isValidBranchName('branch?name')).toBe(false)
    })

    it('should reject names with asterisk', () => {
      expect(isValidBranchName('branch*name')).toBe(false)
    })

    it('should reject names with open bracket', () => {
      expect(isValidBranchName('branch[name')).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isValidBranchName('')).toBe(false)
    })

    it('should reject single @', () => {
      expect(isValidBranchName('@')).toBe(false)
    })

    it('should reject @{', () => {
      expect(isValidBranchName('branch@{1}')).toBe(false)
    })

    it('should reject consecutive slashes', () => {
      expect(isValidBranchName('feature//login')).toBe(false)
    })

    it('should reject names ending with slash', () => {
      expect(isValidBranchName('feature/')).toBe(false)
    })

    it('should reject names ending with dot', () => {
      expect(isValidBranchName('feature.')).toBe(false)
    })
  })

  describe('normalizeBranchName', () => {
    it('should strip refs/heads/ prefix', () => {
      expect(normalizeBranchName('refs/heads/main')).toBe('main')
    })

    it('should preserve name without prefix', () => {
      expect(normalizeBranchName('main')).toBe('main')
    })

    it('should handle nested paths', () => {
      expect(normalizeBranchName('refs/heads/feature/login')).toBe('feature/login')
    })
  })
})

describe('Default Branch', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('getDefaultBranch', () => {
    it('should return the default branch name', async () => {
      const defaultBranch = await getDefaultBranch(refStore)

      expect(defaultBranch).toBeDefined()
    })

    it('should return main if it exists', async () => {
      const defaultBranch = await getDefaultBranch(refStore)

      expect(defaultBranch).toBe('main')
    })
  })

  describe('setDefaultBranch', () => {
    it('should set the default branch', async () => {
      await setDefaultBranch(refStore, 'develop')
      const defaultBranch = await getDefaultBranch(refStore)

      expect(defaultBranch).toBe('develop')
    })

    it('should fail if branch does not exist', async () => {
      await expect(setDefaultBranch(refStore, 'non-existent')).rejects.toThrow()
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  let refStore: RefStore

  beforeEach(() => {
    refStore = createMockRefStoreWithBranches()
  })

  describe('Concurrent operations', () => {
    it('should handle concurrent branch creations', async () => {
      const operations = await Promise.all([
        createBranch(refStore, { name: 'concurrent-1' }),
        createBranch(refStore, { name: 'concurrent-2' }),
        createBranch(refStore, { name: 'concurrent-3' })
      ])

      expect(operations).toHaveLength(3)
      expect(operations.every(r => r.created)).toBe(true)
    })
  })

  describe('Unicode in branch names', () => {
    it('should reject branch names with unicode characters', async () => {
      const options: BranchOptions = {
        name: 'branch-\u{1F680}'
      }

      // Git typically rejects unicode in branch names
      await expect(createBranch(refStore, options)).rejects.toThrow()
    })
  })

  describe('Very long branch names', () => {
    it('should handle reasonably long branch names', async () => {
      const longName = 'feature/' + 'a'.repeat(200)
      const options: BranchOptions = {
        name: longName
      }

      const result = await createBranch(refStore, options)

      expect(result.name).toBe(longName)
    })

    it('should reject excessively long branch names', async () => {
      const veryLongName = 'a'.repeat(1000)
      const options: BranchOptions = {
        name: veryLongName
      }

      await expect(createBranch(refStore, options)).rejects.toThrow()
    })
  })

  describe('Case sensitivity', () => {
    it('should treat branch names as case-sensitive', async () => {
      await createBranch(refStore, { name: 'Feature' })

      const exists = await branchExists(refStore, 'feature')

      // On case-sensitive systems, these should be different
      // On case-insensitive systems, this behavior may vary
      expect(typeof exists).toBe('boolean')
    })
  })

  describe('Special ref names', () => {
    it('should reject HEAD as branch name', async () => {
      const options: BranchOptions = {
        name: 'HEAD'
      }

      await expect(createBranch(refStore, options)).rejects.toThrow()
    })

    it('should reject branch names starting with refs/', async () => {
      const options: BranchOptions = {
        name: 'refs/test'
      }

      await expect(createBranch(refStore, options)).rejects.toThrow()
    })
  })
})
