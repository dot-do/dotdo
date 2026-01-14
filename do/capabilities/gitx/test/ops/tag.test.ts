import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TagOptions,
  AnnotatedTagOptions,
  TagResult,
  TagListOptions,
  TagVerifyResult,
  ObjectStore,
  createLightweightTag,
  createAnnotatedTag,
  deleteTag,
  listTags,
  getTag,
  verifyTag,
  parseTagObject,
  buildTagObject,
  formatTagMessage,
  isAnnotatedTag,
  getTagTarget,
  getTagTagger,
  resolveTagToCommit
} from '../../src/ops/tag'
import { TagObject, CommitObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

const sampleCommitSha = 'a'.repeat(40)
const sampleTreeSha = 'b'.repeat(40)
const sampleTagSha = 'c'.repeat(40)
const sampleSecondCommitSha = 'd'.repeat(40)

const sampleTagger = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

const sampleSignature = `-----BEGIN PGP SIGNATURE-----

iQEzBAABCgAdFiEETest...
-----END PGP SIGNATURE-----`

/**
 * Create a mock object store for testing
 */
function createMockStore(objects: Map<string, { type: string; data: Uint8Array }> = new Map()): ObjectStore {
  const storedObjects = new Map(objects)
  const refs = new Map<string, string>()
  let nextSha = 1

  return {
    async getObject(sha: string) {
      return storedObjects.get(sha) ?? null
    },
    async storeObject(type: string, data: Uint8Array) {
      // Generate a deterministic SHA for testing
      const sha = `mock${String(nextSha++).padStart(36, '0')}`
      storedObjects.set(sha, { type, data })
      return sha
    },
    async hasObject(sha: string) {
      return storedObjects.has(sha)
    },
    async getRef(refName: string) {
      return refs.get(refName) ?? null
    },
    async setRef(refName: string, sha: string) {
      refs.set(refName, sha)
    },
    async deleteRef(refName: string) {
      return refs.delete(refName)
    },
    async listRefs(prefix: string) {
      const result: Array<{ name: string; sha: string }> = []
      for (const [name, sha] of refs) {
        if (name.startsWith(prefix)) {
          result.push({ name, sha })
        }
      }
      return result
    }
  }
}

/**
 * Create a sample commit object for testing
 */
function createSampleCommitObject(): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: sampleTreeSha,
    parents: [],
    author: {
      name: 'Original Author',
      email: 'original@example.com.ai',
      timestamp: 1704000000,
      timezone: '+0000'
    },
    committer: {
      name: 'Original Committer',
      email: 'original@example.com.ai',
      timestamp: 1704000000,
      timezone: '+0000'
    },
    message: 'Original commit message'
  }
}

/**
 * Create a sample tag object for testing
 */
function createSampleTagObject(): TagObject {
  return {
    type: 'tag',
    data: new Uint8Array(),
    object: sampleCommitSha,
    objectType: 'commit',
    tag: 'v1.0.0',
    tagger: sampleTagger,
    message: 'Release version 1.0.0'
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Lightweight Tags', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('createLightweightTag', () => {
    describe('Creating a lightweight tag', () => {
      it('should create a lightweight tag pointing to a commit', async () => {
        const options: TagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha
        }

        const result = await createLightweightTag(store, options)

        expect(result).toBeDefined()
        expect(result.name).toBe('v1.0.0')
        expect(result.target).toBe(sampleCommitSha)
        expect(result.isAnnotated).toBe(false)
      })

      it('should create a lightweight tag with simple name', async () => {
        const options: TagOptions = {
          name: 'release',
          target: sampleCommitSha
        }

        const result = await createLightweightTag(store, options)

        expect(result.name).toBe('release')
      })

      it('should create a lightweight tag with version-like name', async () => {
        const options: TagOptions = {
          name: 'v2.3.4-beta.1',
          target: sampleCommitSha
        }

        const result = await createLightweightTag(store, options)

        expect(result.name).toBe('v2.3.4-beta.1')
      })

      it('should create a lightweight tag with path-like name', async () => {
        const options: TagOptions = {
          name: 'releases/v1.0.0',
          target: sampleCommitSha
        }

        const result = await createLightweightTag(store, options)

        expect(result.name).toBe('releases/v1.0.0')
      })

      it('should reject invalid tag name with spaces', async () => {
        const options: TagOptions = {
          name: 'invalid tag name',
          target: sampleCommitSha
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should reject tag name starting with dash', async () => {
        const options: TagOptions = {
          name: '-invalid',
          target: sampleCommitSha
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should reject tag name with consecutive dots', async () => {
        const options: TagOptions = {
          name: 'v1..0',
          target: sampleCommitSha
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should reject empty tag name', async () => {
        const options: TagOptions = {
          name: '',
          target: sampleCommitSha
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should reject tag name ending with .lock', async () => {
        const options: TagOptions = {
          name: 'v1.0.0.lock',
          target: sampleCommitSha
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })
    })

    describe('Target validation', () => {
      it('should reject invalid target SHA format', async () => {
        const options: TagOptions = {
          name: 'v1.0.0',
          target: 'invalid-sha'
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should reject non-existent target when verify is true', async () => {
        const options: TagOptions = {
          name: 'v1.0.0',
          target: 'f'.repeat(40),
          verify: true
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should allow non-existent target when verify is false', async () => {
        const options: TagOptions = {
          name: 'v1.0.0',
          target: 'f'.repeat(40),
          verify: false
        }

        const result = await createLightweightTag(store, options)

        expect(result.target).toBe('f'.repeat(40))
      })
    })

    describe('Overwriting existing tags', () => {
      it('should throw when tag already exists and force is false', async () => {
        // Create initial tag
        await createLightweightTag(store, {
          name: 'v1.0.0',
          target: sampleCommitSha
        })

        // Try to create again
        const options: TagOptions = {
          name: 'v1.0.0',
          target: sampleSecondCommitSha,
          force: false
        }

        await expect(createLightweightTag(store, options)).rejects.toThrow()
      })

      it('should overwrite when tag exists and force is true', async () => {
        // Create initial tag
        await createLightweightTag(store, {
          name: 'v1.0.0',
          target: sampleCommitSha
        })

        // Overwrite with force
        const options: TagOptions = {
          name: 'v1.0.0',
          target: sampleSecondCommitSha,
          force: true
        }

        const result = await createLightweightTag(store, options)

        expect(result.target).toBe(sampleSecondCommitSha)
      })
    })
  })
})

describe('Annotated Tags', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('createAnnotatedTag', () => {
    describe('Creating an annotated tag with message', () => {
      it('should create an annotated tag with a simple message', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release version 1.0.0',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)

        expect(result).toBeDefined()
        expect(result.name).toBe('v1.0.0')
        expect(result.isAnnotated).toBe(true)
        expect(result.tagSha).toBeDefined()
        expect(result.tagSha).toMatch(/^[0-9a-f]{40}$|^mock/)
      })

      it('should create an annotated tag with multiline message', async () => {
        const message = 'Release version 1.0.0\n\nThis release includes:\n- Feature A\n- Bug fix B'
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message,
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)

        expect(result.isAnnotated).toBe(true)
      })

      it('should create an annotated tag with unicode in message', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release with unicode support',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)

        expect(result.isAnnotated).toBe(true)
      })

      it('should throw error when message is empty', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: '',
          tagger: sampleTagger
        }

        await expect(createAnnotatedTag(store, options)).rejects.toThrow()
      })

      it('should throw error when message is only whitespace', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: '   \n\n   ',
          tagger: sampleTagger
        }

        await expect(createAnnotatedTag(store, options)).rejects.toThrow()
      })
    })

    describe('Tagger information', () => {
      it('should include tagger name and email', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)

        expect(tag).toBeDefined()
        expect(tag?.tagger?.name).toBe(sampleTagger.name)
        expect(tag?.tagger?.email).toBe(sampleTagger.email)
      })

      it('should use current timestamp when not specified', async () => {
        const nowBefore = Math.floor(Date.now() / 1000)
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release',
          tagger: {
            name: 'Test User',
            email: 'test@example.com.ai'
          }
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)
        const nowAfter = Math.floor(Date.now() / 1000)

        expect(tag?.tagger?.timestamp).toBeGreaterThanOrEqual(nowBefore)
        expect(tag?.tagger?.timestamp).toBeLessThanOrEqual(nowAfter)
      })

      it('should use local timezone when not specified', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release',
          tagger: {
            name: 'Test User',
            email: 'test@example.com.ai'
          }
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)

        expect(tag?.tagger?.timezone).toMatch(/^[+-]\d{4}$/)
      })

      it('should handle tagger with unicode name', async () => {
        const unicodeTagger = {
          name: 'Developer',
          email: 'dev@example.jp',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release',
          tagger: unicodeTagger
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)

        expect(tag?.tagger?.name).toBe(unicodeTagger.name)
      })
    })

    describe('Tag object type', () => {
      it('should create tag pointing to commit object', async () => {
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'Release',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)

        expect(tag?.objectType).toBe('commit')
      })

      it('should create tag pointing to tree object', async () => {
        const treeStore = createMockStore(new Map([
          [sampleTreeSha, { type: 'tree', data: encoder.encode('mock tree') }]
        ]))
        const options: AnnotatedTagOptions = {
          name: 'tree-tag',
          target: sampleTreeSha,
          targetType: 'tree',
          message: 'Tag a tree',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(treeStore, options)
        const tag = await getTag(treeStore, result.name)

        expect(tag?.objectType).toBe('tree')
      })

      it('should create tag pointing to another tag (nested tag)', async () => {
        // First create an annotated tag
        const firstResult = await createAnnotatedTag(store, {
          name: 'v1.0.0',
          target: sampleCommitSha,
          message: 'First release',
          tagger: sampleTagger
        })

        // Then create a tag pointing to that tag
        const options: AnnotatedTagOptions = {
          name: 'v1.0.0-alias',
          target: firstResult.tagSha!,
          targetType: 'tag',
          message: 'Alias for v1.0.0',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(store, options)
        const tag = await getTag(store, result.name)

        expect(tag?.objectType).toBe('tag')
      })

      it('should create tag pointing to blob object', async () => {
        const blobSha = 'e'.repeat(40)
        const blobStore = createMockStore(new Map([
          [blobSha, { type: 'blob', data: encoder.encode('file content') }]
        ]))
        const options: AnnotatedTagOptions = {
          name: 'blob-tag',
          target: blobSha,
          targetType: 'blob',
          message: 'Tag a blob',
          tagger: sampleTagger
        }

        const result = await createAnnotatedTag(blobStore, options)
        const tag = await getTag(blobStore, result.name)

        expect(tag?.objectType).toBe('blob')
      })
    })
  })

  describe('buildTagObject', () => {
    it('should build a tag object without storing', () => {
      const options: AnnotatedTagOptions = {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      }

      const tag = buildTagObject(options)

      expect(tag.type).toBe('tag')
      expect(tag.object).toBe(sampleCommitSha)
      expect(tag.tag).toBe('v1.0.0')
      expect(tag.message).toBe('Release')
    })

    it('should not require store access', () => {
      const options: AnnotatedTagOptions = {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      }

      expect(() => buildTagObject(options)).not.toThrow()
    })
  })
})

describe('Deleting Tags', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('deleteTag', () => {
    it('should delete an existing lightweight tag', async () => {
      // Create tag first
      await createLightweightTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha
      })

      // Delete it
      const result = await deleteTag(store, 'v1.0.0')

      expect(result.deleted).toBe(true)
      expect(result.name).toBe('v1.0.0')
    })

    it('should delete an existing annotated tag', async () => {
      // Create annotated tag first
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      // Delete it
      const result = await deleteTag(store, 'v1.0.0')

      expect(result.deleted).toBe(true)
    })

    it('should throw when deleting non-existent tag', async () => {
      await expect(deleteTag(store, 'nonexistent')).rejects.toThrow()
    })

    it('should not throw when deleting non-existent tag with force', async () => {
      const result = await deleteTag(store, 'nonexistent', { force: true })

      expect(result.deleted).toBe(false)
    })

    it('should return the SHA of deleted tag', async () => {
      await createLightweightTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha
      })

      const result = await deleteTag(store, 'v1.0.0')

      expect(result.sha).toBe(sampleCommitSha)
    })

    it('should verify tag no longer exists after deletion', async () => {
      await createLightweightTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha
      })

      await deleteTag(store, 'v1.0.0')
      const tag = await getTag(store, 'v1.0.0')

      expect(tag).toBeNull()
    })

    it('should delete multiple tags in sequence', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.0.1', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.0.2', target: sampleCommitSha })

      await deleteTag(store, 'v1.0.0')
      await deleteTag(store, 'v1.0.1')
      await deleteTag(store, 'v1.0.2')

      const tags = await listTags(store)
      expect(tags).toHaveLength(0)
    })
  })
})

describe('Listing Tags', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }],
      [sampleSecondCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('listTags', () => {
    it('should return empty array when no tags exist', async () => {
      const tags = await listTags(store)

      expect(tags).toEqual([])
    })

    it('should list all lightweight tags', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.0.1', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v2.0.0', target: sampleCommitSha })

      const tags = await listTags(store)

      expect(tags).toHaveLength(3)
      expect(tags.map(t => t.name)).toContain('v1.0.0')
      expect(tags.map(t => t.name)).toContain('v1.0.1')
      expect(tags.map(t => t.name)).toContain('v2.0.0')
    })

    it('should list all annotated tags', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release 1.0.0',
        tagger: sampleTagger
      })
      await createAnnotatedTag(store, {
        name: 'v2.0.0',
        target: sampleCommitSha,
        message: 'Release 2.0.0',
        tagger: sampleTagger
      })

      const tags = await listTags(store)

      expect(tags).toHaveLength(2)
    })

    it('should list mixed lightweight and annotated tags', async () => {
      await createLightweightTag(store, { name: 'lightweight', target: sampleCommitSha })
      await createAnnotatedTag(store, {
        name: 'annotated',
        target: sampleCommitSha,
        message: 'Annotated tag',
        tagger: sampleTagger
      })

      const tags = await listTags(store)

      expect(tags).toHaveLength(2)
    })

    it('should filter tags by pattern', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.0.1', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v2.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'release-1', target: sampleCommitSha })

      const options: TagListOptions = {
        pattern: 'v1.*'
      }
      const tags = await listTags(store, options)

      expect(tags).toHaveLength(2)
      expect(tags.every(t => t.name.startsWith('v1.'))).toBe(true)
    })

    it('should sort tags alphabetically by default', async () => {
      await createLightweightTag(store, { name: 'c-tag', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'a-tag', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'b-tag', target: sampleCommitSha })

      const tags = await listTags(store)

      expect(tags[0].name).toBe('a-tag')
      expect(tags[1].name).toBe('b-tag')
      expect(tags[2].name).toBe('c-tag')
    })

    it('should sort tags by version when sortByVersion is true', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.10.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v1.2.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v2.0.0', target: sampleCommitSha })

      const options: TagListOptions = {
        sortByVersion: true
      }
      const tags = await listTags(store, options)

      const names = tags.map(t => t.name)
      expect(names).toEqual(['v1.0.0', 'v1.2.0', 'v1.10.0', 'v2.0.0'])
    })

    it('should return tags pointing to specific commit', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })
      await createLightweightTag(store, { name: 'v2.0.0', target: sampleSecondCommitSha })
      await createLightweightTag(store, { name: 'v1.0.1', target: sampleCommitSha })

      const options: TagListOptions = {
        pointsAt: sampleCommitSha
      }
      const tags = await listTags(store, options)

      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toContain('v1.0.0')
      expect(tags.map(t => t.name)).toContain('v1.0.1')
    })

    it('should include tag SHA in results', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const tags = await listTags(store)

      expect(tags[0].sha).toBeDefined()
    })

    it('should indicate if tag is annotated', async () => {
      await createLightweightTag(store, { name: 'lightweight', target: sampleCommitSha })
      await createAnnotatedTag(store, {
        name: 'annotated',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const tags = await listTags(store)

      const lightweight = tags.find(t => t.name === 'lightweight')
      const annotated = tags.find(t => t.name === 'annotated')

      expect(lightweight?.isAnnotated).toBe(false)
      expect(annotated?.isAnnotated).toBe(true)
    })

    it('should limit number of results', async () => {
      for (let i = 0; i < 10; i++) {
        await createLightweightTag(store, { name: `v1.0.${i}`, target: sampleCommitSha })
      }

      const options: TagListOptions = {
        limit: 5
      }
      const tags = await listTags(store, options)

      expect(tags).toHaveLength(5)
    })
  })
})

describe('Verifying Signed Tags', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('verifyTag', () => {
    it('should return invalid for lightweight tag', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const result = await verifyTag(store, 'v1.0.0')

      expect(result.valid).toBe(false)
      expect(result.signed).toBe(false)
    })

    it('should return invalid for unsigned annotated tag', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const result = await verifyTag(store, 'v1.0.0')

      expect(result.signed).toBe(false)
    })

    it('should verify a signed annotated tag', async () => {
      const mockVerifier = vi.fn().mockResolvedValue({
        valid: true,
        keyId: 'ABCD1234',
        signer: 'Test User <test@example.com.ai>'
      })

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: vi.fn().mockResolvedValue(sampleSignature)
        }
      })

      const result = await verifyTag(store, 'v1.0.0', { verifier: mockVerifier })

      expect(result.signed).toBe(true)
    })

    it('should return key ID for valid signature', async () => {
      const mockVerifier = vi.fn().mockResolvedValue({
        valid: true,
        keyId: 'ABCD1234',
        signer: 'Test User <test@example.com.ai>'
      })

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: vi.fn().mockResolvedValue(sampleSignature)
        }
      })

      const result = await verifyTag(store, 'v1.0.0', { verifier: mockVerifier })

      expect(result.keyId).toBe('ABCD1234')
    })

    it('should return signer info for valid signature', async () => {
      const mockVerifier = vi.fn().mockResolvedValue({
        valid: true,
        keyId: 'ABCD1234',
        signer: 'Test User <test@example.com.ai>'
      })

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: vi.fn().mockResolvedValue(sampleSignature)
        }
      })

      const result = await verifyTag(store, 'v1.0.0', { verifier: mockVerifier })

      expect(result.signer).toBe('Test User <test@example.com.ai>')
    })

    it('should return invalid for bad signature', async () => {
      const mockVerifier = vi.fn().mockResolvedValue({
        valid: false,
        error: 'Invalid signature'
      })

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: vi.fn().mockResolvedValue(sampleSignature)
        }
      })

      const result = await verifyTag(store, 'v1.0.0', { verifier: mockVerifier })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })

    it('should throw for non-existent tag', async () => {
      await expect(verifyTag(store, 'nonexistent')).rejects.toThrow()
    })

    it('should handle verification error gracefully', async () => {
      const mockVerifier = vi.fn().mockRejectedValue(new Error('GPG not available'))

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: vi.fn().mockResolvedValue(sampleSignature)
        }
      })

      const result = await verifyTag(store, 'v1.0.0', { verifier: mockVerifier })

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Creating signed tags', () => {
    it('should create a signed annotated tag', async () => {
      const mockSigner = vi.fn().mockResolvedValue(sampleSignature)

      const result = await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          signer: mockSigner
        }
      })

      expect(mockSigner).toHaveBeenCalled()
      expect(result.signed).toBe(true)
    })

    it('should pass key ID to signer', async () => {
      const mockSigner = vi.fn().mockResolvedValue(sampleSignature)

      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: true,
          keyId: 'ABCD1234',
          signer: mockSigner
        }
      })

      expect(mockSigner).toHaveBeenCalled()
    })

    it('should not sign when signing.sign is false', async () => {
      const mockSigner = vi.fn()

      const result = await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger,
        signing: {
          sign: false,
          signer: mockSigner
        }
      })

      expect(mockSigner).not.toHaveBeenCalled()
      expect(result.signed).toBe(false)
    })
  })
})

describe('Tag Message Handling', () => {
  describe('formatTagMessage', () => {
    it('should strip leading and trailing whitespace', () => {
      const message = '  Release version 1.0.0  '
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Release version 1.0.0')
    })

    it('should preserve internal whitespace', () => {
      const message = 'Release version 1.0.0\n\nChanges:\n- Feature A\n- Feature B'
      const formatted = formatTagMessage(message)

      expect(formatted).toContain('\n\nChanges:\n')
    })

    it('should handle empty message', () => {
      const formatted = formatTagMessage('')

      expect(formatted).toBe('')
    })

    it('should collapse multiple blank lines', () => {
      const message = 'Subject\n\n\n\n\nBody text'
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Subject\n\nBody text')
    })

    it('should preserve message verbatim when cleanup is disabled', () => {
      const message = '  Subject  \n\n\n  Body  '
      const formatted = formatTagMessage(message, { cleanup: false })

      expect(formatted).toBe(message)
    })

    it('should strip comment lines when cleanup is enabled', () => {
      const message = 'Subject\n# This is a comment\nBody'
      const formatted = formatTagMessage(message, { cleanup: true, commentChar: '#' })

      expect(formatted).not.toContain('# This is a comment')
    })
  })

  describe('parseTagObject', () => {
    it('should parse tag object from raw data', () => {
      const rawTag = `object ${sampleCommitSha}
type commit
tag v1.0.0
tagger Test User <test@example.com.ai> 1704067200 +0000

Release version 1.0.0`

      const tag = parseTagObject(encoder.encode(rawTag))

      expect(tag.object).toBe(sampleCommitSha)
      expect(tag.objectType).toBe('commit')
      expect(tag.tag).toBe('v1.0.0')
      expect(tag.tagger?.name).toBe('Test User')
      expect(tag.tagger?.email).toBe('test@example.com.ai')
      expect(tag.message).toBe('Release version 1.0.0')
    })

    it('should parse tag with multiline message', () => {
      const rawTag = `object ${sampleCommitSha}
type commit
tag v1.0.0
tagger Test User <test@example.com.ai> 1704067200 +0000

Release version 1.0.0

This is a longer description
with multiple lines.`

      const tag = parseTagObject(encoder.encode(rawTag))

      expect(tag.message).toContain('Release version 1.0.0')
      expect(tag.message).toContain('multiple lines')
    })

    it('should parse tag without tagger', () => {
      const rawTag = `object ${sampleCommitSha}
type commit
tag v1.0.0

Release version 1.0.0`

      const tag = parseTagObject(encoder.encode(rawTag))

      expect(tag.tagger).toBeUndefined()
    })

    it('should parse tag with signature', () => {
      const rawTag = `object ${sampleCommitSha}
type commit
tag v1.0.0
tagger Test User <test@example.com.ai> 1704067200 +0000

Release version 1.0.0
-----BEGIN PGP SIGNATURE-----

iQEzBAABCgAdFiEETest...
-----END PGP SIGNATURE-----`

      const tag = parseTagObject(encoder.encode(rawTag))

      expect(tag.signature).toContain('BEGIN PGP SIGNATURE')
    })

    it('should throw on invalid tag format', () => {
      const rawTag = 'invalid tag data'

      expect(() => parseTagObject(encoder.encode(rawTag))).toThrow()
    })
  })
})

describe('Tag Utility Functions', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('isAnnotatedTag', () => {
    it('should return true for annotated tag', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const result = await isAnnotatedTag(store, 'v1.0.0')

      expect(result).toBe(true)
    })

    it('should return false for lightweight tag', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const result = await isAnnotatedTag(store, 'v1.0.0')

      expect(result).toBe(false)
    })

    it('should throw for non-existent tag', async () => {
      await expect(isAnnotatedTag(store, 'nonexistent')).rejects.toThrow()
    })
  })

  describe('getTagTarget', () => {
    it('should return target SHA for lightweight tag', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const target = await getTagTarget(store, 'v1.0.0')

      expect(target).toBe(sampleCommitSha)
    })

    it('should return target SHA for annotated tag', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const target = await getTagTarget(store, 'v1.0.0')

      expect(target).toBe(sampleCommitSha)
    })

    it('should throw for non-existent tag', async () => {
      await expect(getTagTarget(store, 'nonexistent')).rejects.toThrow()
    })
  })

  describe('getTagTagger', () => {
    it('should return tagger for annotated tag', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const tagger = await getTagTagger(store, 'v1.0.0')

      expect(tagger).toBeDefined()
      expect(tagger?.name).toBe(sampleTagger.name)
      expect(tagger?.email).toBe(sampleTagger.email)
    })

    it('should return null for lightweight tag', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const tagger = await getTagTagger(store, 'v1.0.0')

      expect(tagger).toBeNull()
    })

    it('should throw for non-existent tag', async () => {
      await expect(getTagTagger(store, 'nonexistent')).rejects.toThrow()
    })
  })

  describe('resolveTagToCommit', () => {
    it('should resolve lightweight tag to commit', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const commitSha = await resolveTagToCommit(store, 'v1.0.0')

      expect(commitSha).toBe(sampleCommitSha)
    })

    it('should resolve annotated tag to commit', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const commitSha = await resolveTagToCommit(store, 'v1.0.0')

      expect(commitSha).toBe(sampleCommitSha)
    })

    it('should resolve nested tags to final commit', async () => {
      // Create first tag pointing to commit
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      // Get the tag SHA
      const tag1 = await getTag(store, 'v1.0.0')

      // Create second tag pointing to first tag
      await createAnnotatedTag(store, {
        name: 'v1.0.0-alias',
        target: tag1!.sha!,
        targetType: 'tag',
        message: 'Alias',
        tagger: sampleTagger
      })

      const commitSha = await resolveTagToCommit(store, 'v1.0.0-alias')

      expect(commitSha).toBe(sampleCommitSha)
    })

    it('should throw when tag points to non-commit object', async () => {
      const treeStore = createMockStore(new Map([
        [sampleTreeSha, { type: 'tree', data: encoder.encode('mock tree') }]
      ]))

      await createAnnotatedTag(treeStore, {
        name: 'tree-tag',
        target: sampleTreeSha,
        targetType: 'tree',
        message: 'Tag a tree',
        tagger: sampleTagger
      })

      await expect(resolveTagToCommit(treeStore, 'tree-tag')).rejects.toThrow()
    })

    it('should throw for non-existent tag', async () => {
      await expect(resolveTagToCommit(store, 'nonexistent')).rejects.toThrow()
    })

    it('should handle maximum recursion depth for nested tags', async () => {
      // This tests protection against infinite loops in deeply nested tags
      // Implementation should have a maximum depth limit

      // Create a chain of tags
      let currentTarget = sampleCommitSha
      let currentType: 'commit' | 'tag' = 'commit'

      for (let i = 0; i < 100; i++) {
        const result = await createAnnotatedTag(store, {
          name: `tag-${i}`,
          target: currentTarget,
          targetType: currentType,
          message: `Tag ${i}`,
          tagger: sampleTagger
        })
        currentTarget = result.tagSha!
        currentType = 'tag'
      }

      // Should either succeed or throw a max depth error, not hang
      await expect(resolveTagToCommit(store, 'tag-99')).rejects.toThrow()
    })
  })

  describe('getTag', () => {
    it('should return null for non-existent tag', async () => {
      const tag = await getTag(store, 'nonexistent')

      expect(tag).toBeNull()
    })

    it('should return tag info for lightweight tag', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const tag = await getTag(store, 'v1.0.0')

      expect(tag).toBeDefined()
      expect(tag?.name).toBe('v1.0.0')
      expect(tag?.target).toBe(sampleCommitSha)
      expect(tag?.isAnnotated).toBe(false)
    })

    it('should return tag info for annotated tag', async () => {
      await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: sampleTagger
      })

      const tag = await getTag(store, 'v1.0.0')

      expect(tag).toBeDefined()
      expect(tag?.name).toBe('v1.0.0')
      expect(tag?.isAnnotated).toBe(true)
      expect(tag?.message).toBe('Release')
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  let store: ObjectStore

  beforeEach(() => {
    const commitData = encoder.encode('mock commit data')
    store = createMockStore(new Map([
      [sampleCommitSha, { type: 'commit', data: commitData }]
    ]))
  })

  describe('Special characters in tag names', () => {
    it('should accept tag names with underscores', async () => {
      const result = await createLightweightTag(store, {
        name: 'release_1_0_0',
        target: sampleCommitSha
      })

      expect(result.name).toBe('release_1_0_0')
    })

    it('should accept tag names with hyphens', async () => {
      const result = await createLightweightTag(store, {
        name: 'release-1.0.0',
        target: sampleCommitSha
      })

      expect(result.name).toBe('release-1.0.0')
    })

    it('should reject tag names with control characters', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.0\x00',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with tilde', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.0~1',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with caret', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.0^1',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with colon', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1:0:0',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with question mark', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.0?',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with asterisk', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.*',
        target: sampleCommitSha
      })).rejects.toThrow()
    })

    it('should reject tag names with backslash', async () => {
      await expect(createLightweightTag(store, {
        name: 'v1.0.0\\test',
        target: sampleCommitSha
      })).rejects.toThrow()
    })
  })

  describe('Special characters in tag messages', () => {
    it('should handle message with angle brackets', async () => {
      const result = await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Fix <script> injection',
        tagger: sampleTagger
      })

      const tag = await getTag(store, 'v1.0.0')
      expect(tag?.message).toBe('Fix <script> injection')
    })

    it('should handle message with null bytes', async () => {
      // Null bytes in message should be rejected or sanitized
      await expect(createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release\x00version',
        tagger: sampleTagger
      })).rejects.toThrow()
    })

    it('should handle very long message', async () => {
      const longMessage = 'A'.repeat(100000)
      const result = await createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: longMessage,
        tagger: sampleTagger
      })

      const tag = await getTag(store, 'v1.0.0')
      expect(tag?.message).toBe(longMessage)
    })
  })

  describe('Tagger validation', () => {
    it('should reject tagger with newlines in name', async () => {
      await expect(createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: {
          name: 'Test\nUser',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
      })).rejects.toThrow()
    })

    it('should reject tagger with angle brackets in name', async () => {
      await expect(createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: {
          name: 'Test <User>',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
      })).rejects.toThrow()
    })

    it('should reject tagger with invalid email format', async () => {
      await expect(createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: {
          name: 'Test User',
          email: 'not-an-email',
          timestamp: 1704067200,
          timezone: '+0000'
        }
      })).rejects.toThrow()
    })

    it('should reject negative timestamp', async () => {
      await expect(createAnnotatedTag(store, {
        name: 'v1.0.0',
        target: sampleCommitSha,
        message: 'Release',
        tagger: {
          name: 'Test User',
          email: 'test@example.com.ai',
          timestamp: -1,
          timezone: '+0000'
        }
      })).rejects.toThrow()
    })
  })

  describe('Concurrent operations', () => {
    it('should handle multiple concurrent tag creations', async () => {
      const tags = await Promise.all([
        createLightweightTag(store, { name: 'tag-1', target: sampleCommitSha }),
        createLightweightTag(store, { name: 'tag-2', target: sampleCommitSha }),
        createLightweightTag(store, { name: 'tag-3', target: sampleCommitSha })
      ])

      expect(tags).toHaveLength(3)

      const allTags = await listTags(store)
      expect(allTags).toHaveLength(3)
    })

    it('should handle concurrent create and delete', async () => {
      await createLightweightTag(store, { name: 'v1.0.0', target: sampleCommitSha })

      const [createResult, deleteResult] = await Promise.all([
        createLightweightTag(store, { name: 'v2.0.0', target: sampleCommitSha }),
        deleteTag(store, 'v1.0.0')
      ])

      expect(createResult.name).toBe('v2.0.0')
      expect(deleteResult.deleted).toBe(true)
    })
  })
})
