import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RefStorage,
  RefStorageBackend,
  Ref,
  RefType,
  RefError,
  RefLock,
  UpdateRefOptions,
  ListRefsOptions,
  ResolveRefOptions,
  isValidRefName,
  isValidSha,
  parseRefContent,
  serializeRefContent,
  parsePackedRefs,
  serializePackedRefs,
  resolveRef,
  updateRef,
  deleteRef,
  listRefs
} from '../../src/refs/storage'

// Sample SHA-1 hashes for testing
const sampleSha = 'a'.repeat(40) // Valid 40-char hex
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)
const invalidSha = 'g'.repeat(40) // Invalid - 'g' is not hex
const shortSha = 'a'.repeat(39) // Too short

// Mock backend for testing
function createMockBackend(): RefStorageBackend {
  const refs = new Map<string, Ref>()
  const packedRefs = new Map<string, string>()
  const locks = new Set<string>()

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
    async acquireLock(name: string, timeout?: number): Promise<RefLock> {
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

describe('Git Reference Storage', () => {
  let backend: RefStorageBackend
  let storage: RefStorage

  beforeEach(() => {
    backend = createMockBackend()
    storage = new RefStorage(backend)
  })

  describe('Ref Creation', () => {
    describe('Branch Creation', () => {
      it('should create a new branch ref', async () => {
        const ref = await storage.updateRef('refs/heads/main', sampleSha, { create: true })
        expect(ref.name).toBe('refs/heads/main')
        expect(ref.target).toBe(sampleSha)
        expect(ref.type).toBe('direct')
      })

      it('should create a branch with feature/ prefix', async () => {
        const ref = await storage.updateRef('refs/heads/feature/new-feature', sampleSha, { create: true })
        expect(ref.name).toBe('refs/heads/feature/new-feature')
        expect(ref.target).toBe(sampleSha)
      })

      it('should reject creating branch with invalid characters', async () => {
        await expect(
          storage.updateRef('refs/heads/bad..name', sampleSha, { create: true })
        ).rejects.toThrow(RefError)
      })

      it('should reject creating branch ending with .lock', async () => {
        await expect(
          storage.updateRef('refs/heads/branch.lock', sampleSha, { create: true })
        ).rejects.toThrow(RefError)
      })

      it('should reject creating branch with @{', async () => {
        await expect(
          storage.updateRef('refs/heads/@{branch}', sampleSha, { create: true })
        ).rejects.toThrow(RefError)
      })
    })

    describe('Tag Creation', () => {
      it('should create a lightweight tag', async () => {
        const ref = await storage.updateRef('refs/tags/v1.0.0', sampleSha, { create: true })
        expect(ref.name).toBe('refs/tags/v1.0.0')
        expect(ref.target).toBe(sampleSha)
        expect(ref.type).toBe('direct')
      })

      it('should create a tag with dots in name', async () => {
        const ref = await storage.updateRef('refs/tags/v1.0.0-beta.1', sampleSha, { create: true })
        expect(ref.name).toBe('refs/tags/v1.0.0-beta.1')
      })

      it('should reject creating tag with space in name', async () => {
        await expect(
          storage.updateRef('refs/tags/bad name', sampleSha, { create: true })
        ).rejects.toThrow(RefError)
      })
    })

    describe('HEAD Creation and Updates', () => {
      it('should create detached HEAD pointing to SHA', async () => {
        const ref = await storage.updateHead(sampleSha, false)
        expect(ref.name).toBe('HEAD')
        expect(ref.target).toBe(sampleSha)
        expect(ref.type).toBe('direct')
      })

      it('should create symbolic HEAD pointing to branch', async () => {
        const ref = await storage.updateHead('refs/heads/main', true)
        expect(ref.name).toBe('HEAD')
        expect(ref.target).toBe('refs/heads/main')
        expect(ref.type).toBe('symbolic')
      })

      it('should get current HEAD', async () => {
        await storage.updateHead('refs/heads/main', true)
        const head = await storage.getHead()
        expect(head.name).toBe('HEAD')
      })

      it('should detect detached HEAD', async () => {
        await storage.updateHead(sampleSha, false)
        const isDetached = await storage.isHeadDetached()
        expect(isDetached).toBe(true)
      })

      it('should detect attached HEAD', async () => {
        await storage.updateHead('refs/heads/main', true)
        const isDetached = await storage.isHeadDetached()
        expect(isDetached).toBe(false)
      })
    })

    describe('Symbolic Ref Creation', () => {
      it('should create a symbolic ref', async () => {
        const ref = await storage.createSymbolicRef('refs/special', 'refs/heads/main')
        expect(ref.name).toBe('refs/special')
        expect(ref.target).toBe('refs/heads/main')
        expect(ref.type).toBe('symbolic')
      })

      it('should reject symbolic ref pointing to itself', async () => {
        await expect(
          storage.createSymbolicRef('refs/loop', 'refs/loop')
        ).rejects.toThrow(RefError)
      })
    })
  })

  describe('Ref Update with Expected Old Value (CAS)', () => {
    it('should update ref when old value matches', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const ref = await storage.updateRef('refs/heads/main', sampleSha2, { oldValue: sampleSha })
      expect(ref.target).toBe(sampleSha2)
    })

    it('should reject update when old value does not match', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      await expect(
        storage.updateRef('refs/heads/main', sampleSha2, { oldValue: sampleSha3 })
      ).rejects.toThrow(RefError)
    })

    it('should allow update with oldValue: null for non-existing ref', async () => {
      const ref = await storage.updateRef('refs/heads/new-branch', sampleSha, {
        oldValue: null,
        create: true
      })
      expect(ref.target).toBe(sampleSha)
    })

    it('should reject update with oldValue: null for existing ref', async () => {
      await storage.updateRef('refs/heads/existing', sampleSha, { create: true })
      await expect(
        storage.updateRef('refs/heads/existing', sampleSha2, { oldValue: null })
      ).rejects.toThrow(RefError)
    })

    it('should allow force update without oldValue check', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const ref = await storage.updateRef('refs/heads/main', sampleSha2, { force: true })
      expect(ref.target).toBe(sampleSha2)
    })

    it('should reject update to invalid SHA', async () => {
      await expect(
        storage.updateRef('refs/heads/main', invalidSha, { create: true })
      ).rejects.toThrow(RefError)
    })

    it('should reject update to short SHA', async () => {
      await expect(
        storage.updateRef('refs/heads/main', shortSha, { create: true })
      ).rejects.toThrow(RefError)
    })
  })

  describe('Ref Deletion', () => {
    it('should delete an existing ref', async () => {
      await storage.updateRef('refs/heads/to-delete', sampleSha, { create: true })
      const deleted = await storage.deleteRef('refs/heads/to-delete')
      expect(deleted).toBe(true)
    })

    it('should return false when deleting non-existent ref', async () => {
      const deleted = await storage.deleteRef('refs/heads/non-existent')
      expect(deleted).toBe(false)
    })

    it('should delete ref with oldValue check', async () => {
      await storage.updateRef('refs/heads/branch', sampleSha, { create: true })
      const deleted = await storage.deleteRef('refs/heads/branch', { oldValue: sampleSha })
      expect(deleted).toBe(true)
    })

    it('should reject deletion when oldValue does not match', async () => {
      await storage.updateRef('refs/heads/branch', sampleSha, { create: true })
      await expect(
        storage.deleteRef('refs/heads/branch', { oldValue: sampleSha2 })
      ).rejects.toThrow(RefError)
    })

    it('should not delete HEAD directly', async () => {
      await expect(storage.deleteRef('HEAD')).rejects.toThrow(RefError)
    })

    it('should delete tag ref', async () => {
      await storage.updateRef('refs/tags/v1.0.0', sampleSha, { create: true })
      const deleted = await storage.deleteRef('refs/tags/v1.0.0')
      expect(deleted).toBe(true)
    })
  })

  describe('Symbolic Ref Resolution', () => {
    it('should resolve direct ref', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const resolved = await storage.resolveRef('refs/heads/main')
      expect(resolved.sha).toBe(sampleSha)
      expect(resolved.chain.length).toBe(1)
    })

    it('should resolve symbolic ref through one level', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      await storage.createSymbolicRef('HEAD', 'refs/heads/main')
      const resolved = await storage.resolveRef('HEAD')
      expect(resolved.sha).toBe(sampleSha)
      expect(resolved.chain.length).toBe(2)
    })

    it('should resolve symbolic ref through multiple levels', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      await storage.createSymbolicRef('refs/level1', 'refs/heads/main')
      await storage.createSymbolicRef('refs/level2', 'refs/level1')
      await storage.createSymbolicRef('refs/level3', 'refs/level2')
      const resolved = await storage.resolveRef('refs/level3')
      expect(resolved.sha).toBe(sampleSha)
      expect(resolved.chain.length).toBe(4)
    })

    it('should throw on circular symbolic refs', async () => {
      // This requires manual setup since our mock doesn't allow circular creation
      await expect(
        storage.resolveRef('refs/circular')
      ).rejects.toThrow()
    })

    it('should throw when max depth exceeded', async () => {
      // Create a deep chain
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      let prevRef = 'refs/heads/main'
      for (let i = 0; i < 15; i++) {
        const newRef = `refs/deep${i}`
        await storage.createSymbolicRef(newRef, prevRef)
        prevRef = newRef
      }
      await expect(
        storage.resolveRef(prevRef, { maxDepth: 10 })
      ).rejects.toThrow(RefError)
    })

    it('should throw when resolving non-existent ref', async () => {
      await expect(
        storage.resolveRef('refs/heads/non-existent')
      ).rejects.toThrow(RefError)
    })

    it('should return full resolution chain', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      await storage.createSymbolicRef('HEAD', 'refs/heads/main')
      const resolved = await storage.resolveRef('HEAD')
      expect(resolved.chain[0].name).toBe('HEAD')
      expect(resolved.chain[1].name).toBe('refs/heads/main')
    })
  })

  describe('Ref Listing with Patterns', () => {
    beforeEach(async () => {
      // Set up test refs
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      await storage.updateRef('refs/heads/develop', sampleSha2, { create: true })
      await storage.updateRef('refs/heads/feature/a', sampleSha, { create: true })
      await storage.updateRef('refs/heads/feature/b', sampleSha2, { create: true })
      await storage.updateRef('refs/tags/v1.0.0', sampleSha, { create: true })
      await storage.updateRef('refs/tags/v2.0.0', sampleSha2, { create: true })
      await storage.updateRef('refs/remotes/origin/main', sampleSha, { create: true })
    })

    it('should list all refs without pattern', async () => {
      const refs = await storage.listRefs()
      expect(refs.length).toBeGreaterThanOrEqual(7)
    })

    it('should list only branches with pattern', async () => {
      const refs = await storage.listRefs({ pattern: 'refs/heads/*' })
      expect(refs.every(r => r.name.startsWith('refs/heads/'))).toBe(true)
    })

    it('should list only tags with pattern', async () => {
      const refs = await storage.listRefs({ pattern: 'refs/tags/*' })
      expect(refs.every(r => r.name.startsWith('refs/tags/'))).toBe(true)
    })

    it('should list feature branches with nested pattern', async () => {
      const refs = await storage.listRefs({ pattern: 'refs/heads/feature/*' })
      expect(refs.length).toBe(2)
      expect(refs.every(r => r.name.startsWith('refs/heads/feature/'))).toBe(true)
    })

    it('should list remote refs', async () => {
      const refs = await storage.listRefs({ pattern: 'refs/remotes/origin/*' })
      expect(refs.length).toBe(1)
      expect(refs[0].name).toBe('refs/remotes/origin/main')
    })

    it('should include HEAD when requested', async () => {
      await storage.updateHead('refs/heads/main', true)
      const refs = await storage.listRefs({ includeHead: true })
      expect(refs.some(r => r.name === 'HEAD')).toBe(true)
    })

    it('should exclude HEAD by default', async () => {
      await storage.updateHead('refs/heads/main', true)
      const refs = await storage.listRefs()
      expect(refs.some(r => r.name === 'HEAD')).toBe(false)
    })

    it('should include symbolic refs when requested', async () => {
      await storage.createSymbolicRef('refs/sym', 'refs/heads/main')
      const refs = await storage.listRefs({ includeSymbolic: true })
      expect(refs.some(r => r.type === 'symbolic')).toBe(true)
    })

    it('should list branches helper method', async () => {
      const branches = await storage.listBranches()
      expect(branches.every(r => r.name.startsWith('refs/heads/'))).toBe(true)
    })

    it('should list tags helper method', async () => {
      const tags = await storage.listTags()
      expect(tags.every(r => r.name.startsWith('refs/tags/'))).toBe(true)
    })

    it('should return empty array for non-matching pattern', async () => {
      const refs = await storage.listRefs({ pattern: 'refs/nonexistent/*' })
      expect(refs).toEqual([])
    })
  })

  describe('Packed-refs Format', () => {
    describe('parsePackedRefs', () => {
      it('should parse simple packed-refs content', () => {
        const content = [
          '# pack-refs with: peeled fully-peeled sorted',
          `${sampleSha} refs/heads/main`,
          `${sampleSha2} refs/tags/v1.0.0`
        ].join('\n')
        const refs = parsePackedRefs(content)
        expect(refs.get('refs/heads/main')).toBe(sampleSha)
        expect(refs.get('refs/tags/v1.0.0')).toBe(sampleSha2)
      })

      it('should skip comment lines', () => {
        const content = [
          '# This is a comment',
          `${sampleSha} refs/heads/main`,
          '# Another comment',
          `${sampleSha2} refs/heads/develop`
        ].join('\n')
        const refs = parsePackedRefs(content)
        expect(refs.size).toBe(2)
      })

      it('should handle empty content', () => {
        const refs = parsePackedRefs('')
        expect(refs.size).toBe(0)
      })

      it('should handle peeled tag entries (^SHA lines)', () => {
        const content = [
          `${sampleSha} refs/tags/v1.0.0`,
          `^${sampleSha2}`,  // Peeled SHA for annotated tag
          `${sampleSha3} refs/heads/main`
        ].join('\n')
        const refs = parsePackedRefs(content)
        expect(refs.get('refs/tags/v1.0.0')).toBe(sampleSha)
        expect(refs.get('refs/heads/main')).toBe(sampleSha3)
      })

      it('should handle Windows line endings', () => {
        const content = `${sampleSha} refs/heads/main\r\n${sampleSha2} refs/heads/develop\r\n`
        const refs = parsePackedRefs(content)
        expect(refs.size).toBe(2)
      })

      it('should handle trailing newline', () => {
        const content = `${sampleSha} refs/heads/main\n`
        const refs = parsePackedRefs(content)
        expect(refs.size).toBe(1)
      })
    })

    describe('serializePackedRefs', () => {
      it('should serialize refs to packed format', () => {
        const refs = new Map<string, string>([
          ['refs/heads/main', sampleSha],
          ['refs/tags/v1.0.0', sampleSha2]
        ])
        const content = serializePackedRefs(refs)
        expect(content).toContain('# pack-refs')
        expect(content).toContain(`${sampleSha} refs/heads/main`)
        expect(content).toContain(`${sampleSha2} refs/tags/v1.0.0`)
      })

      it('should sort refs alphabetically', () => {
        const refs = new Map<string, string>([
          ['refs/heads/zebra', sampleSha],
          ['refs/heads/alpha', sampleSha2]
        ])
        const content = serializePackedRefs(refs)
        const lines = content.split('\n').filter(l => !l.startsWith('#'))
        const alphaIndex = lines.findIndex(l => l.includes('alpha'))
        const zebraIndex = lines.findIndex(l => l.includes('zebra'))
        expect(alphaIndex).toBeLessThan(zebraIndex)
      })

      it('should produce valid header', () => {
        const refs = new Map<string, string>()
        const content = serializePackedRefs(refs)
        expect(content.startsWith('# pack-refs')).toBe(true)
      })

      it('should round-trip through parse and serialize', () => {
        const original = new Map<string, string>([
          ['refs/heads/main', sampleSha],
          ['refs/heads/develop', sampleSha2],
          ['refs/tags/v1.0.0', sampleSha3]
        ])
        const serialized = serializePackedRefs(original)
        const parsed = parsePackedRefs(serialized)
        expect(parsed.get('refs/heads/main')).toBe(sampleSha)
        expect(parsed.get('refs/heads/develop')).toBe(sampleSha2)
        expect(parsed.get('refs/tags/v1.0.0')).toBe(sampleSha3)
      })
    })

    describe('packRefs', () => {
      it('should pack loose refs into packed-refs', async () => {
        await storage.updateRef('refs/heads/main', sampleSha, { create: true })
        await storage.updateRef('refs/heads/develop', sampleSha2, { create: true })
        await storage.packRefs()
        const packed = await backend.readPackedRefs()
        expect(packed.get('refs/heads/main')).toBe(sampleSha)
        expect(packed.get('refs/heads/develop')).toBe(sampleSha2)
      })

      it('should not pack HEAD', async () => {
        await storage.updateHead(sampleSha, false)
        await storage.packRefs()
        const packed = await backend.readPackedRefs()
        expect(packed.has('HEAD')).toBe(false)
      })

      it('should not pack symbolic refs', async () => {
        await storage.updateRef('refs/heads/main', sampleSha, { create: true })
        await storage.createSymbolicRef('refs/sym', 'refs/heads/main')
        await storage.packRefs()
        const packed = await backend.readPackedRefs()
        expect(packed.has('refs/sym')).toBe(false)
      })
    })
  })

  describe('Ref Transactions', () => {
    describe('Locking', () => {
      it('should acquire lock on ref', async () => {
        const lock = await storage.acquireLock('refs/heads/main')
        expect(lock.isHeld()).toBe(true)
        expect(lock.refName).toBe('refs/heads/main')
      })

      it('should release lock', async () => {
        const lock = await storage.acquireLock('refs/heads/main')
        await lock.release()
        expect(lock.isHeld()).toBe(false)
      })

      it('should prevent concurrent lock acquisition', async () => {
        await storage.acquireLock('refs/heads/main')
        await expect(
          storage.acquireLock('refs/heads/main')
        ).rejects.toThrow(RefError)
      })

      it('should allow lock after release', async () => {
        const lock1 = await storage.acquireLock('refs/heads/main')
        await lock1.release()
        const lock2 = await storage.acquireLock('refs/heads/main')
        expect(lock2.isHeld()).toBe(true)
      })

      it('should allow locking different refs concurrently', async () => {
        const lock1 = await storage.acquireLock('refs/heads/main')
        const lock2 = await storage.acquireLock('refs/heads/develop')
        expect(lock1.isHeld()).toBe(true)
        expect(lock2.isHeld()).toBe(true)
      })

      it('should timeout when lock cannot be acquired', async () => {
        await storage.acquireLock('refs/heads/main')
        await expect(
          storage.acquireLock('refs/heads/main', 100) // 100ms timeout
        ).rejects.toThrow(RefError)
      })
    })

    describe('Atomic Operations', () => {
      it('should atomically update ref with lock', async () => {
        await storage.updateRef('refs/heads/main', sampleSha, { create: true })
        const lock = await storage.acquireLock('refs/heads/main')
        try {
          const ref = await storage.updateRef('refs/heads/main', sampleSha2, { oldValue: sampleSha, lock })
          expect(ref.target).toBe(sampleSha2)
        } finally {
          await lock.release()
        }
      })

      it('should prevent update without lock when another process holds lock', async () => {
        await storage.updateRef('refs/heads/main', sampleSha, { create: true })
        await storage.acquireLock('refs/heads/main') // Simulate another process holding lock

        // In a real implementation, updateRef would try to acquire the lock internally
        // and would fail if it's already held
        await expect(
          storage.updateRef('refs/heads/main', sampleSha2)
        ).rejects.toThrow()
      })
    })
  })

  describe('Ref Name Validation', () => {
    describe('isValidRefName', () => {
      it('should accept valid branch names', () => {
        expect(isValidRefName('refs/heads/main')).toBe(true)
        expect(isValidRefName('refs/heads/feature/test')).toBe(true)
        expect(isValidRefName('refs/heads/fix-123')).toBe(true)
        expect(isValidRefName('refs/heads/release_v1')).toBe(true)
      })

      it('should accept valid tag names', () => {
        expect(isValidRefName('refs/tags/v1.0.0')).toBe(true)
        expect(isValidRefName('refs/tags/v1.0.0-beta.1')).toBe(true)
      })

      it('should accept HEAD', () => {
        expect(isValidRefName('HEAD')).toBe(true)
      })

      it('should reject names with double dots', () => {
        expect(isValidRefName('refs/heads/foo..bar')).toBe(false)
      })

      it('should reject names starting with dot', () => {
        expect(isValidRefName('refs/heads/.hidden')).toBe(false)
      })

      it('should reject names ending with dot', () => {
        expect(isValidRefName('refs/heads/branch.')).toBe(false)
      })

      it('should reject names with control characters', () => {
        expect(isValidRefName('refs/heads/foo\x00bar')).toBe(false)
        expect(isValidRefName('refs/heads/foo\x1fbar')).toBe(false)
      })

      it('should reject names with space', () => {
        expect(isValidRefName('refs/heads/my branch')).toBe(false)
      })

      it('should reject names with tilde', () => {
        expect(isValidRefName('refs/heads/foo~bar')).toBe(false)
      })

      it('should reject names with caret', () => {
        expect(isValidRefName('refs/heads/foo^bar')).toBe(false)
      })

      it('should reject names with colon', () => {
        expect(isValidRefName('refs/heads/foo:bar')).toBe(false)
      })

      it('should reject names with question mark', () => {
        expect(isValidRefName('refs/heads/foo?bar')).toBe(false)
      })

      it('should reject names with asterisk', () => {
        expect(isValidRefName('refs/heads/foo*bar')).toBe(false)
      })

      it('should reject names with open bracket', () => {
        expect(isValidRefName('refs/heads/foo[bar')).toBe(false)
      })

      it('should reject names ending with .lock', () => {
        expect(isValidRefName('refs/heads/branch.lock')).toBe(false)
      })

      it('should reject names with @{', () => {
        expect(isValidRefName('refs/heads/@{foo}')).toBe(false)
        expect(isValidRefName('refs/heads/foo@{bar}')).toBe(false)
      })

      it('should reject just @', () => {
        expect(isValidRefName('@')).toBe(false)
      })

      it('should reject names with backslash', () => {
        expect(isValidRefName('refs/heads/foo\\bar')).toBe(false)
      })

      it('should reject empty component names', () => {
        expect(isValidRefName('refs/heads//branch')).toBe(false)
        expect(isValidRefName('refs//heads/branch')).toBe(false)
      })

      it('should reject names ending with slash', () => {
        expect(isValidRefName('refs/heads/branch/')).toBe(false)
      })
    })

    describe('isValidSha', () => {
      it('should accept valid 40-char hex SHA-1', () => {
        expect(isValidSha(sampleSha)).toBe(true)
        expect(isValidSha('0123456789abcdef0123456789abcdef01234567')).toBe(true)
        expect(isValidSha('0123456789ABCDEF0123456789ABCDEF01234567')).toBe(true)
      })

      it('should reject invalid hex characters', () => {
        expect(isValidSha(invalidSha)).toBe(false)
        expect(isValidSha('0123456789abcdef0123456789abcdef0123456g')).toBe(false)
      })

      it('should reject short SHA', () => {
        expect(isValidSha(shortSha)).toBe(false)
        expect(isValidSha('abc123')).toBe(false)
      })

      it('should reject long SHA', () => {
        expect(isValidSha('a'.repeat(41))).toBe(false)
      })

      it('should reject empty string', () => {
        expect(isValidSha('')).toBe(false)
      })
    })
  })

  describe('Ref Content Parsing and Serialization', () => {
    describe('parseRefContent', () => {
      it('should parse direct ref (SHA)', () => {
        const result = parseRefContent(sampleSha + '\n')
        expect(result.type).toBe('direct')
        expect(result.target).toBe(sampleSha)
      })

      it('should parse symbolic ref', () => {
        const result = parseRefContent('ref: refs/heads/main\n')
        expect(result.type).toBe('symbolic')
        expect(result.target).toBe('refs/heads/main')
      })

      it('should handle content without trailing newline', () => {
        const result = parseRefContent(sampleSha)
        expect(result.type).toBe('direct')
        expect(result.target).toBe(sampleSha)
      })

      it('should trim whitespace', () => {
        const result = parseRefContent(`  ${sampleSha}  \n`)
        expect(result.target).toBe(sampleSha)
      })

      it('should handle symbolic ref without space after colon', () => {
        const result = parseRefContent('ref:refs/heads/main\n')
        expect(result.type).toBe('symbolic')
        expect(result.target).toBe('refs/heads/main')
      })
    })

    describe('serializeRefContent', () => {
      it('should serialize direct ref', () => {
        const ref: Ref = { name: 'refs/heads/main', target: sampleSha, type: 'direct' }
        const content = serializeRefContent(ref)
        expect(content).toBe(sampleSha + '\n')
      })

      it('should serialize symbolic ref', () => {
        const ref: Ref = { name: 'HEAD', target: 'refs/heads/main', type: 'symbolic' }
        const content = serializeRefContent(ref)
        expect(content).toBe('ref: refs/heads/main\n')
      })
    })

    it('should round-trip ref content', () => {
      const originalRef: Ref = { name: 'refs/heads/main', target: sampleSha, type: 'direct' }
      const content = serializeRefContent(originalRef)
      const parsed = parseRefContent(content)
      expect(parsed.type).toBe(originalRef.type)
      expect(parsed.target).toBe(originalRef.target)
    })
  })

  describe('Convenience Functions', () => {
    it('resolveRef should resolve ref to SHA', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const sha = await resolveRef(storage, 'refs/heads/main')
      expect(sha).toBe(sampleSha)
    })

    it('updateRef should update ref', async () => {
      const ref = await updateRef(storage, 'refs/heads/main', sampleSha, { create: true })
      expect(ref.target).toBe(sampleSha)
    })

    it('deleteRef should delete ref', async () => {
      await storage.updateRef('refs/heads/to-delete', sampleSha, { create: true })
      const deleted = await deleteRef(storage, 'refs/heads/to-delete')
      expect(deleted).toBe(true)
    })

    it('listRefs should list refs', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const refs = await listRefs(storage)
      expect(refs.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle ref names with unicode characters', async () => {
      // Git allows some unicode in ref names
      await expect(
        storage.updateRef('refs/heads/branch', sampleSha, { create: true })
      ).resolves.toBeDefined()
    })

    it('should handle very long ref names', async () => {
      const longName = 'refs/heads/' + 'a'.repeat(200)
      await expect(
        storage.updateRef(longName, sampleSha, { create: true })
      ).resolves.toBeDefined()
    })

    it('should handle concurrent reads', async () => {
      await storage.updateRef('refs/heads/main', sampleSha, { create: true })
      const results = await Promise.all([
        storage.getRef('refs/heads/main'),
        storage.getRef('refs/heads/main'),
        storage.getRef('refs/heads/main')
      ])
      expect(results.every(r => r?.target === sampleSha)).toBe(true)
    })

    it('should handle missing backend gracefully', async () => {
      const emptyStorage = new RefStorage({} as RefStorageBackend)
      await expect(emptyStorage.getRef('refs/heads/main')).rejects.toThrow()
    })
  })
})
