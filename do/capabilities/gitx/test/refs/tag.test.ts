/**
 * @fileoverview Tests for Tag Manager (TDD RED phase)
 *
 * These tests are written BEFORE implementation (RED phase of TDD).
 * They should FAIL because the implementation in src/refs/tag.ts
 * currently throws 'Not implemented' errors.
 *
 * Tests cover:
 * - createTag: lightweight and annotated tags
 * - deleteTag: removing tags
 * - listTags: listing and filtering tags
 * - Error cases and validation
 *
 * @module test/refs/tag
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TagManager,
  Tag,
  CreateTagOptions,
  DeleteTagOptions,
  ListTagsOptions,
  GetTagOptions,
  TagError,
  TagObjectStorage,
  GPGSigner,
  TagSignatureVerification,
  isValidTagName,
  isAnnotatedTag,
  formatTagMessage,
  parseTagMessage
} from '../../src/refs/tag'
import { RefStorage } from '../../src/refs/storage'
import { Author, TagObject, ObjectType } from '../../src/types/objects'

// ============================================================================
// Test Helpers and Mocks
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const sampleCommitSha = 'a'.repeat(40)
const sampleCommitSha2 = 'b'.repeat(40)
const sampleTagSha = 'c'.repeat(40)
const sampleTreeSha = 'd'.repeat(40)

const sampleTagger: Author = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

/**
 * Create a mock RefStorage for testing
 */
function createMockRefStorage(): RefStorage {
  const refs = new Map<string, string>()

  return {
    async getRef(name: string): Promise<string | null> {
      return refs.get(name) ?? null
    },
    async setRef(name: string, sha: string): Promise<void> {
      refs.set(name, sha)
    },
    async deleteRef(name: string): Promise<boolean> {
      return refs.delete(name)
    },
    async listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>> {
      const result: Array<{ name: string; sha: string }> = []
      for (const [name, sha] of refs) {
        if (name.startsWith(prefix)) {
          result.push({ name, sha })
        }
      }
      return result
    },
    async hasRef(name: string): Promise<boolean> {
      return refs.has(name)
    }
  } as RefStorage
}

/**
 * Create a mock TagObjectStorage for testing
 */
function createMockObjectStorage(): TagObjectStorage {
  const objects = new Map<string, TagObject>()
  let nextSha = 1

  return {
    async readTagObject(sha: string): Promise<TagObject | null> {
      return objects.get(sha) ?? null
    },
    async writeTagObject(tag: Omit<TagObject, 'type' | 'data'>): Promise<string> {
      const sha = `mock${String(nextSha++).padStart(36, '0')}`
      const tagObj: TagObject = {
        type: 'tag',
        data: new Uint8Array(),
        ...tag
      }
      objects.set(sha, tagObj)
      return sha
    },
    async readObjectType(sha: string): Promise<ObjectType | null> {
      if (sha === sampleCommitSha || sha === sampleCommitSha2) return 'commit'
      if (sha === sampleTreeSha) return 'tree'
      const obj = objects.get(sha)
      if (obj) return 'tag'
      return null
    }
  }
}

/**
 * Create a mock GPGSigner for testing
 */
function createMockGPGSigner(): GPGSigner {
  return {
    async sign(_data: Uint8Array, _keyId?: string): Promise<string> {
      return '-----BEGIN PGP SIGNATURE-----\n\nmock signature\n-----END PGP SIGNATURE-----'
    },
    async verify(_data: Uint8Array, _signature: string): Promise<TagSignatureVerification> {
      return {
        valid: true,
        keyId: 'ABCD1234',
        signer: 'Test User <test@example.com.ai>',
        trustLevel: 'full'
      }
    }
  }
}

// ============================================================================
// TagManager.createTag Tests
// ============================================================================

describe('TagManager.createTag', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage
  let gpgSigner: GPGSigner

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    gpgSigner = createMockGPGSigner()
    manager = new TagManager(refStorage, objectStorage, gpgSigner)
  })

  describe('Lightweight tags', () => {
    it('should create lightweight tag pointing to commit', async () => {
      const tag = await manager.createTag('v1.0.0', sampleCommitSha)

      expect(tag.name).toBe('v1.0.0')
      expect(tag.type).toBe('lightweight')
      expect(tag.sha).toBe(sampleCommitSha)
      expect(tag.targetSha).toBeUndefined()
      expect(tag.tagger).toBeUndefined()
      expect(tag.message).toBeUndefined()
    })

    it('should create lightweight tag with simple name', async () => {
      const tag = await manager.createTag('release', sampleCommitSha)

      expect(tag.name).toBe('release')
      expect(tag.type).toBe('lightweight')
    })

    it('should create lightweight tag with version-like name', async () => {
      const tag = await manager.createTag('v2.3.4-beta.1', sampleCommitSha)

      expect(tag.name).toBe('v2.3.4-beta.1')
      expect(tag.type).toBe('lightweight')
    })

    it('should create lightweight tag with path-like name', async () => {
      const tag = await manager.createTag('releases/v1.0.0', sampleCommitSha)

      expect(tag.name).toBe('releases/v1.0.0')
      expect(tag.type).toBe('lightweight')
    })

    it('should store ref under refs/tags/', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const refSha = await refStorage.getRef('refs/tags/v1.0.0')
      expect(refSha).toBe(sampleCommitSha)
    })
  })

  describe('Annotated tags', () => {
    it('should create annotated tag with message', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.name).toBe('v1.0.0')
      expect(tag.type).toBe('annotated')
      expect(tag.sha).toBeDefined()
      expect(tag.sha).toMatch(/^[0-9a-f]{40}$|^mock/)
      expect(tag.targetSha).toBe(sampleCommitSha)
      expect(tag.targetType).toBe('commit')
      expect(tag.message).toBe('Release v1.0.0')
      expect(tag.tagger).toEqual(sampleTagger)
    })

    it('should create annotated tag with multiline message', async () => {
      const message = 'Release v1.0.0\n\nThis release includes:\n- Feature A\n- Bug fix B'
      const options: CreateTagOptions = {
        annotated: true,
        message,
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.message).toBe(message)
      expect(tag.type).toBe('annotated')
    })

    it('should create annotated tag when message is provided (implicit annotated)', async () => {
      const options: CreateTagOptions = {
        message: 'Release v1.0.0',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.type).toBe('annotated')
    })

    it('should create tag object and store it', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      // The ref should point to the tag object SHA, not the commit SHA
      const refSha = await refStorage.getRef('refs/tags/v1.0.0')
      expect(refSha).toBe(tag.sha)
      expect(refSha).not.toBe(sampleCommitSha)

      // The tag object should exist
      const tagObj = await objectStorage.readTagObject(tag.sha)
      expect(tagObj).toBeDefined()
      expect(tagObj?.object).toBe(sampleCommitSha)
      expect(tagObj?.message).toBe('Release v1.0.0')
    })

    it('should use current timestamp when tagger timestamp is not provided', async () => {
      const beforeTime = Math.floor(Date.now() / 1000)

      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: {
          name: 'Test User',
          email: 'test@example.com.ai',
          timezone: '+0000'
        } as Author
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)
      const afterTime = Math.floor(Date.now() / 1000)

      expect(tag.tagger?.timestamp).toBeGreaterThanOrEqual(beforeTime)
      expect(tag.tagger?.timestamp).toBeLessThanOrEqual(afterTime)
    })

    it('should throw TagError when message is required but missing', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        tagger: sampleTagger
      }

      await expect(manager.createTag('v1.0.0', sampleCommitSha, options))
        .rejects.toThrow(TagError)
    })

    it('should throw TagError with MESSAGE_REQUIRED code', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        tagger: sampleTagger
      }

      try {
        await manager.createTag('v1.0.0', sampleCommitSha, options)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('MESSAGE_REQUIRED')
      }
    })
  })

  describe('Signed tags', () => {
    it('should create signed tag when sign option is true', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger,
        sign: true
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.signature).toBeDefined()
      expect(tag.signature).toContain('BEGIN PGP SIGNATURE')
    })

    it('should use provided keyId for signing', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger,
        sign: true,
        keyId: 'SPECIFIC-KEY-ID'
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.signature).toBeDefined()
    })

    it('should throw TagError when GPG signer is not available', async () => {
      const managerWithoutGPG = new TagManager(refStorage, objectStorage)
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger,
        sign: true
      }

      try {
        await managerWithoutGPG.createTag('v1.0.0', sampleCommitSha, options)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('GPG_ERROR')
      }
    })
  })

  describe('Tag name validation', () => {
    it('should throw TagError for empty tag name', async () => {
      try {
        await manager.createTag('', sampleCommitSha)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('INVALID_TAG_NAME')
      }
    })

    it('should throw TagError for tag name with spaces', async () => {
      try {
        await manager.createTag('invalid tag name', sampleCommitSha)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('INVALID_TAG_NAME')
      }
    })

    it('should throw TagError for tag name ending with .lock', async () => {
      try {
        await manager.createTag('v1.0.0.lock', sampleCommitSha)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('INVALID_TAG_NAME')
      }
    })

    it('should throw TagError for tag name with consecutive dots', async () => {
      try {
        await manager.createTag('v1..0', sampleCommitSha)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('INVALID_TAG_NAME')
      }
    })

    it('should throw TagError for tag name with control characters', async () => {
      try {
        await manager.createTag('v1.0.0\x00', sampleCommitSha)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('INVALID_TAG_NAME')
      }
    })

    it('should throw TagError for tag name with special characters', async () => {
      const invalidChars = ['~', '^', ':', '?', '*', '[', '\\']

      for (const char of invalidChars) {
        try {
          await manager.createTag(`v1.0.0${char}`, sampleCommitSha)
          expect.fail(`Should have thrown TagError for character: ${char}`)
        } catch (e) {
          expect(e).toBeInstanceOf(TagError)
          expect((e as TagError).code).toBe('INVALID_TAG_NAME')
        }
      }
    })
  })

  describe('Overwriting existing tags', () => {
    it('should throw TagError when tag already exists', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      try {
        await manager.createTag('v1.0.0', sampleCommitSha2)
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('TAG_EXISTS')
        expect((e as TagError).tagName).toBe('v1.0.0')
      }
    })

    it('should overwrite existing tag when force is true', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const options: CreateTagOptions = { force: true }
      const tag = await manager.createTag('v1.0.0', sampleCommitSha2, options)

      expect(tag.sha).toBe(sampleCommitSha2)

      const refSha = await refStorage.getRef('refs/tags/v1.0.0')
      expect(refSha).toBe(sampleCommitSha2)
    })

    it('should overwrite annotated tag with lightweight tag when force is true', async () => {
      const annotatedOptions: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, annotatedOptions)

      const forceOptions: CreateTagOptions = { force: true }
      const tag = await manager.createTag('v1.0.0', sampleCommitSha2, forceOptions)

      expect(tag.type).toBe('lightweight')
      expect(tag.sha).toBe(sampleCommitSha2)
    })
  })

  describe('Target object types', () => {
    it('should create tag pointing to commit (default)', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.targetType).toBe('commit')
    })

    it('should create tag pointing to tree', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Tag a tree',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('tree-tag', sampleTreeSha, options)

      expect(tag.targetSha).toBe(sampleTreeSha)
    })

    it('should create tag pointing to another tag (nested tag)', async () => {
      const options1: CreateTagOptions = {
        annotated: true,
        message: 'First tag',
        tagger: sampleTagger
      }
      const tag1 = await manager.createTag('v1.0.0', sampleCommitSha, options1)

      const options2: CreateTagOptions = {
        annotated: true,
        message: 'Alias tag',
        tagger: sampleTagger
      }
      const tag2 = await manager.createTag('v1.0.0-alias', tag1.sha, options2)

      expect(tag2.targetSha).toBe(tag1.sha)
      expect(tag2.targetType).toBe('tag')
    })
  })
})

// ============================================================================
// TagManager.deleteTag Tests
// ============================================================================

describe('TagManager.deleteTag', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    manager = new TagManager(refStorage, objectStorage)
  })

  it('should delete existing lightweight tag', async () => {
    await manager.createTag('v1.0.0', sampleCommitSha)

    const result = await manager.deleteTag('v1.0.0')

    expect(result).toBe(true)

    const refSha = await refStorage.getRef('refs/tags/v1.0.0')
    expect(refSha).toBeNull()
  })

  it('should delete existing annotated tag', async () => {
    const options: CreateTagOptions = {
      annotated: true,
      message: 'Release',
      tagger: sampleTagger
    }
    await manager.createTag('v1.0.0', sampleCommitSha, options)

    const result = await manager.deleteTag('v1.0.0')

    expect(result).toBe(true)

    const refSha = await refStorage.getRef('refs/tags/v1.0.0')
    expect(refSha).toBeNull()
  })

  it('should throw TagError when tag does not exist', async () => {
    try {
      await manager.deleteTag('nonexistent')
      expect.fail('Should have thrown TagError')
    } catch (e) {
      expect(e).toBeInstanceOf(TagError)
      expect((e as TagError).code).toBe('TAG_NOT_FOUND')
      expect((e as TagError).tagName).toBe('nonexistent')
    }
  })

  it('should return false when tag does not exist and force is true', async () => {
    const options: DeleteTagOptions = { force: true }
    const result = await manager.deleteTag('nonexistent', options)

    expect(result).toBe(false)
  })

  it('should not throw when force is true', async () => {
    const options: DeleteTagOptions = { force: true }
    await expect(manager.deleteTag('nonexistent', options)).resolves.toBe(false)
  })

  it('should delete tag and allow recreation', async () => {
    await manager.createTag('v1.0.0', sampleCommitSha)
    await manager.deleteTag('v1.0.0')

    const tag = await manager.createTag('v1.0.0', sampleCommitSha2)

    expect(tag.sha).toBe(sampleCommitSha2)
  })

  it('should not delete tag object when deleting annotated tag', async () => {
    const options: CreateTagOptions = {
      annotated: true,
      message: 'Release',
      tagger: sampleTagger
    }
    const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)
    const tagObjectSha = tag.sha

    await manager.deleteTag('v1.0.0')

    // Tag object should still exist (for reflog, etc.)
    const tagObj = await objectStorage.readTagObject(tagObjectSha)
    expect(tagObj).toBeDefined()
  })
})

// ============================================================================
// TagManager.listTags Tests
// ============================================================================

describe('TagManager.listTags', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    manager = new TagManager(refStorage, objectStorage)
  })

  it('should return empty array when no tags exist', async () => {
    const tags = await manager.listTags()

    expect(tags).toEqual([])
  })

  it('should list all lightweight tags', async () => {
    await manager.createTag('v1.0.0', sampleCommitSha)
    await manager.createTag('v1.0.1', sampleCommitSha)
    await manager.createTag('v2.0.0', sampleCommitSha)

    const tags = await manager.listTags()

    expect(tags).toHaveLength(3)
    expect(tags.map(t => t.name)).toContain('v1.0.0')
    expect(tags.map(t => t.name)).toContain('v1.0.1')
    expect(tags.map(t => t.name)).toContain('v2.0.0')
  })

  it('should list all annotated tags', async () => {
    const options: CreateTagOptions = {
      annotated: true,
      message: 'Release',
      tagger: sampleTagger
    }

    await manager.createTag('v1.0.0', sampleCommitSha, options)
    await manager.createTag('v2.0.0', sampleCommitSha, options)

    const tags = await manager.listTags()

    expect(tags).toHaveLength(2)
    expect(tags.every(t => t.type === 'annotated')).toBe(true)
  })

  it('should list mixed lightweight and annotated tags', async () => {
    await manager.createTag('lightweight', sampleCommitSha)

    const annotatedOptions: CreateTagOptions = {
      annotated: true,
      message: 'Annotated',
      tagger: sampleTagger
    }
    await manager.createTag('annotated', sampleCommitSha, annotatedOptions)

    const tags = await manager.listTags()

    expect(tags).toHaveLength(2)

    const lightTag = tags.find(t => t.name === 'lightweight')
    const annotTag = tags.find(t => t.name === 'annotated')

    expect(lightTag?.type).toBe('lightweight')
    expect(annotTag?.type).toBe('annotated')
  })

  it('should sort tags alphabetically by default', async () => {
    await manager.createTag('c-tag', sampleCommitSha)
    await manager.createTag('a-tag', sampleCommitSha)
    await manager.createTag('b-tag', sampleCommitSha)

    const tags = await manager.listTags()

    expect(tags[0].name).toBe('a-tag')
    expect(tags[1].name).toBe('b-tag')
    expect(tags[2].name).toBe('c-tag')
  })

  describe('Pattern filtering', () => {
    beforeEach(async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)
      await manager.createTag('v1.0.1', sampleCommitSha)
      await manager.createTag('v2.0.0', sampleCommitSha)
      await manager.createTag('release-1', sampleCommitSha)
      await manager.createTag('release-2', sampleCommitSha)
    })

    it('should filter tags by exact pattern', async () => {
      const options: ListTagsOptions = { pattern: 'v1.0.0' }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('v1.0.0')
    })

    it('should filter tags by wildcard pattern (v1.*)', async () => {
      const options: ListTagsOptions = { pattern: 'v1.*' }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toContain('v1.0.0')
      expect(tags.map(t => t.name)).toContain('v1.0.1')
    })

    it('should filter tags by wildcard pattern (release-*)', async () => {
      const options: ListTagsOptions = { pattern: 'release-*' }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toContain('release-1')
      expect(tags.map(t => t.name)).toContain('release-2')
    })

    it('should filter tags by wildcard pattern (v*.0)', async () => {
      const options: ListTagsOptions = { pattern: 'v*.0' }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toContain('v1.0.0')
      expect(tags.map(t => t.name)).toContain('v2.0.0')
    })

    it('should filter tags by single-char wildcard (?)', async () => {
      const options: ListTagsOptions = { pattern: 'v?.0.0' }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toContain('v1.0.0')
      expect(tags.map(t => t.name)).toContain('v2.0.0')
    })

    it('should return empty array when pattern does not match', async () => {
      const options: ListTagsOptions = { pattern: 'nonexistent-*' }
      const tags = await manager.listTags(options)

      expect(tags).toEqual([])
    })
  })

  describe('Sorting', () => {
    beforeEach(async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)
      await manager.createTag('v1.10.0', sampleCommitSha)
      await manager.createTag('v1.2.0', sampleCommitSha)
      await manager.createTag('v2.0.0', sampleCommitSha)
    })

    it('should sort tags by name alphabetically (default)', async () => {
      const tags = await manager.listTags()

      const names = tags.map(t => t.name)
      expect(names).toEqual(['v1.0.0', 'v1.10.0', 'v1.2.0', 'v2.0.0'])
    })

    it('should sort tags by version', async () => {
      const options: ListTagsOptions = { sort: 'version' }
      const tags = await manager.listTags(options)

      const names = tags.map(t => t.name)
      expect(names).toEqual(['v1.0.0', 'v1.2.0', 'v1.10.0', 'v2.0.0'])
    })

    it('should sort tags in ascending order by default', async () => {
      const options: ListTagsOptions = { sort: 'version' }
      const tags = await manager.listTags(options)

      const names = tags.map(t => t.name)
      expect(names).toEqual(['v1.0.0', 'v1.2.0', 'v1.10.0', 'v2.0.0'])
    })

    it('should sort tags in descending order', async () => {
      const options: ListTagsOptions = { sort: 'version', sortDirection: 'desc' }
      const tags = await manager.listTags(options)

      const names = tags.map(t => t.name)
      expect(names).toEqual(['v2.0.0', 'v1.10.0', 'v1.2.0', 'v1.0.0'])
    })

    it('should sort tags by date', async () => {
      const options1: CreateTagOptions = {
        annotated: true,
        message: 'Old release',
        tagger: { ...sampleTagger, timestamp: 1000000 }
      }
      const options2: CreateTagOptions = {
        annotated: true,
        message: 'New release',
        tagger: { ...sampleTagger, timestamp: 2000000 }
      }

      await manager.createTag('old-tag', sampleCommitSha, options1)
      await manager.createTag('new-tag', sampleCommitSha, options2)

      const listOptions: ListTagsOptions = {
        sort: 'date',
        includeMetadata: true
      }
      const tags = await manager.listTags(listOptions)

      const names = tags.map(t => t.name)
      expect(names[0]).toBe('old-tag')
      expect(names[names.length - 1]).toBe('new-tag')
    })
  })

  describe('Limiting results', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await manager.createTag(`v1.0.${i}`, sampleCommitSha)
      }
    })

    it('should limit number of results', async () => {
      const options: ListTagsOptions = { limit: 5 }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(5)
    })

    it('should return all tags when limit is greater than total', async () => {
      const options: ListTagsOptions = { limit: 100 }
      const tags = await manager.listTags(options)

      expect(tags).toHaveLength(10)
    })

    it('should return empty array when limit is 0', async () => {
      const options: ListTagsOptions = { limit: 0 }
      const tags = await manager.listTags(options)

      expect(tags).toEqual([])
    })
  })

  describe('Including metadata', () => {
    it('should include tagger and message when includeMetadata is true', async () => {
      const createOptions: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, createOptions)

      const listOptions: ListTagsOptions = { includeMetadata: true }
      const tags = await manager.listTags(listOptions)

      expect(tags[0].tagger).toEqual(sampleTagger)
      expect(tags[0].message).toBe('Release v1.0.0')
    })

    it('should not include metadata by default', async () => {
      const createOptions: CreateTagOptions = {
        annotated: true,
        message: 'Release v1.0.0',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, createOptions)

      const tags = await manager.listTags()

      // Without includeMetadata, tagger and message might be undefined
      // (depending on implementation optimization)
      expect(tags[0].name).toBe('v1.0.0')
    })
  })
})

// ============================================================================
// TagManager.getTag Tests
// ============================================================================

describe('TagManager.getTag', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    manager = new TagManager(refStorage, objectStorage)
  })

  it('should return null for non-existent tag', async () => {
    const tag = await manager.getTag('nonexistent')

    expect(tag).toBeNull()
  })

  it('should return lightweight tag info', async () => {
    await manager.createTag('v1.0.0', sampleCommitSha)

    const tag = await manager.getTag('v1.0.0')

    expect(tag).toBeDefined()
    expect(tag?.name).toBe('v1.0.0')
    expect(tag?.type).toBe('lightweight')
    expect(tag?.sha).toBe(sampleCommitSha)
  })

  it('should return annotated tag info without resolve', async () => {
    const createOptions: CreateTagOptions = {
      annotated: true,
      message: 'Release',
      tagger: sampleTagger
    }
    await manager.createTag('v1.0.0', sampleCommitSha, createOptions)

    const tag = await manager.getTag('v1.0.0')

    expect(tag).toBeDefined()
    expect(tag?.name).toBe('v1.0.0')
    expect(tag?.type).toBe('annotated')
  })

  it('should return full annotated tag info with resolve', async () => {
    const createOptions: CreateTagOptions = {
      annotated: true,
      message: 'Release v1.0.0',
      tagger: sampleTagger
    }
    await manager.createTag('v1.0.0', sampleCommitSha, createOptions)

    const getOptions: GetTagOptions = { resolve: true }
    const tag = await manager.getTag('v1.0.0', getOptions)

    expect(tag).toBeDefined()
    expect(tag?.message).toBe('Release v1.0.0')
    expect(tag?.tagger).toEqual(sampleTagger)
    expect(tag?.targetSha).toBe(sampleCommitSha)
  })

  it('should return tag with signature if signed', async () => {
    const gpgSigner = createMockGPGSigner()
    const managerWithGPG = new TagManager(refStorage, objectStorage, gpgSigner)

    const createOptions: CreateTagOptions = {
      annotated: true,
      message: 'Release',
      tagger: sampleTagger,
      sign: true
    }
    await managerWithGPG.createTag('v1.0.0', sampleCommitSha, createOptions)

    const tag = await managerWithGPG.getTag('v1.0.0', { resolve: true })

    expect(tag?.signature).toBeDefined()
    expect(tag?.signature).toContain('BEGIN PGP SIGNATURE')
  })
})

// ============================================================================
// TagManager utility methods Tests
// ============================================================================

describe('TagManager utility methods', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    manager = new TagManager(refStorage, objectStorage)
  })

  describe('tagExists', () => {
    it('should return true for existing tag', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const exists = await manager.tagExists('v1.0.0')

      expect(exists).toBe(true)
    })

    it('should return false for non-existent tag', async () => {
      const exists = await manager.tagExists('nonexistent')

      expect(exists).toBe(false)
    })
  })

  describe('getTagTarget', () => {
    it('should return commit SHA for lightweight tag', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const target = await manager.getTagTarget('v1.0.0')

      expect(target).toBe(sampleCommitSha)
    })

    it('should return commit SHA for annotated tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, options)

      const target = await manager.getTagTarget('v1.0.0')

      expect(target).toBe(sampleCommitSha)
    })

    it('should throw TagError for non-existent tag', async () => {
      try {
        await manager.getTagTarget('nonexistent')
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('TAG_NOT_FOUND')
      }
    })
  })

  describe('isAnnotatedTag', () => {
    it('should return true for annotated tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, options)

      const isAnnotated = await manager.isAnnotatedTag('v1.0.0')

      expect(isAnnotated).toBe(true)
    })

    it('should return false for lightweight tag', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const isAnnotated = await manager.isAnnotatedTag('v1.0.0')

      expect(isAnnotated).toBe(false)
    })

    it('should throw TagError for non-existent tag', async () => {
      try {
        await manager.isAnnotatedTag('nonexistent')
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('TAG_NOT_FOUND')
      }
    })
  })

  describe('verifyTag', () => {
    let gpgSigner: GPGSigner

    beforeEach(() => {
      gpgSigner = createMockGPGSigner()
      manager = new TagManager(refStorage, objectStorage, gpgSigner)
    })

    it('should verify signed tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger,
        sign: true
      }
      await manager.createTag('v1.0.0', sampleCommitSha, options)

      const result = await manager.verifyTag('v1.0.0')

      expect(result.valid).toBe(true)
      expect(result.keyId).toBe('ABCD1234')
      expect(result.signer).toBe('Test User <test@example.com.ai>')
    })

    it('should return invalid for unsigned tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0', sampleCommitSha, options)

      const result = await manager.verifyTag('v1.0.0')

      expect(result.valid).toBe(false)
    })

    it('should return invalid for lightweight tag', async () => {
      await manager.createTag('v1.0.0', sampleCommitSha)

      const result = await manager.verifyTag('v1.0.0')

      expect(result.valid).toBe(false)
    })

    it('should throw TagError for non-existent tag', async () => {
      try {
        await manager.verifyTag('nonexistent')
        expect.fail('Should have thrown TagError')
      } catch (e) {
        expect(e).toBeInstanceOf(TagError)
        expect((e as TagError).code).toBe('TAG_NOT_FOUND')
      }
    })
  })
})

// ============================================================================
// Validation Functions Tests
// ============================================================================

describe('Validation functions', () => {
  describe('isValidTagName', () => {
    it('should return true for valid tag names', () => {
      expect(isValidTagName('v1.0.0')).toBe(true)
      expect(isValidTagName('release')).toBe(true)
      expect(isValidTagName('releases/v1.0.0')).toBe(true)
      expect(isValidTagName('v2.3.4-beta.1')).toBe(true)
    })

    it('should return false for empty name', () => {
      expect(isValidTagName('')).toBe(false)
    })

    it('should return false for name ending with .lock', () => {
      expect(isValidTagName('v1.0.0.lock')).toBe(false)
    })

    it('should return false for name with consecutive dots', () => {
      expect(isValidTagName('v1..0')).toBe(false)
    })

    it('should return false for name with spaces', () => {
      expect(isValidTagName('invalid tag')).toBe(false)
    })

    it('should return false for name with control characters', () => {
      expect(isValidTagName('v1.0.0\x00')).toBe(false)
      expect(isValidTagName('v1.0.0\n')).toBe(false)
    })

    it('should return false for name with special characters', () => {
      expect(isValidTagName('v1.0.0~')).toBe(false)
      expect(isValidTagName('v1.0.0^')).toBe(false)
      expect(isValidTagName('v1:0:0')).toBe(false)
      expect(isValidTagName('v1.0.0?')).toBe(false)
      expect(isValidTagName('v1.0.*')).toBe(false)
      expect(isValidTagName('v1.0.0[')).toBe(false)
      expect(isValidTagName('v1.0.0\\')).toBe(false)
    })
  })

  describe('isAnnotatedTag (type guard)', () => {
    it('should return true for annotated tag with full metadata', () => {
      const tag: Tag = {
        name: 'v1.0.0',
        type: 'annotated',
        sha: sampleTagSha,
        targetSha: sampleCommitSha,
        targetType: 'commit',
        tagger: sampleTagger,
        message: 'Release'
      }

      expect(isAnnotatedTag(tag)).toBe(true)
    })

    it('should return false for lightweight tag', () => {
      const tag: Tag = {
        name: 'v1.0.0',
        type: 'lightweight',
        sha: sampleCommitSha
      }

      expect(isAnnotatedTag(tag)).toBe(false)
    })

    it('should return false for annotated tag without metadata', () => {
      const tag: Tag = {
        name: 'v1.0.0',
        type: 'annotated',
        sha: sampleTagSha
      }

      expect(isAnnotatedTag(tag)).toBe(false)
    })
  })

  describe('formatTagMessage', () => {
    it('should normalize line endings', () => {
      const message = 'Hello\r\nWorld\r\n'
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Hello\nWorld\n')
    })

    it('should trim whitespace', () => {
      const message = '  Hello World  '
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Hello World')
    })

    it('should handle multiline messages', () => {
      const message = 'Subject\n\nBody text'
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Subject\n\nBody text')
    })

    it('should preserve internal formatting', () => {
      const message = 'Subject\n\n- Item 1\n- Item 2'
      const formatted = formatTagMessage(message)

      expect(formatted).toBe('Subject\n\n- Item 1\n- Item 2')
    })
  })

  describe('parseTagMessage', () => {
    it('should parse message without signature', () => {
      const content = 'Release v1.0.0'
      const result = parseTagMessage(content)

      expect(result.message).toBe('Release v1.0.0')
      expect(result.signature).toBeUndefined()
    })

    it('should parse message with signature', () => {
      const content = `Release v1.0.0
-----BEGIN PGP SIGNATURE-----

mock signature
-----END PGP SIGNATURE-----`
      const result = parseTagMessage(content)

      expect(result.message).toBe('Release v1.0.0')
      expect(result.signature).toContain('BEGIN PGP SIGNATURE')
    })

    it('should handle multiline message with signature', () => {
      const content = `Release v1.0.0

This is a longer description.
-----BEGIN PGP SIGNATURE-----

mock signature
-----END PGP SIGNATURE-----`
      const result = parseTagMessage(content)

      expect(result.message).toContain('Release v1.0.0')
      expect(result.message).toContain('longer description')
      expect(result.signature).toContain('BEGIN PGP SIGNATURE')
    })
  })
})

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

describe('Edge cases and error scenarios', () => {
  let manager: TagManager
  let refStorage: RefStorage
  let objectStorage: TagObjectStorage

  beforeEach(() => {
    refStorage = createMockRefStorage()
    objectStorage = createMockObjectStorage()
    manager = new TagManager(refStorage, objectStorage)
  })

  describe('Unicode handling', () => {
    it('should handle unicode in tag names', async () => {
      // Note: Git allows unicode in tag names
      const tag = await manager.createTag('版本-1.0.0', sampleCommitSha)

      expect(tag.name).toBe('版本-1.0.0')
    })

    it('should handle unicode in tag messages', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: 'リリース バージョン 1.0.0',
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.message).toBe('リリース バージョン 1.0.0')
    })

    it('should handle unicode in tagger name', async () => {
      const tagger: Author = {
        name: '山田 太郎',
        email: 'yamada@example.jp',
        timestamp: 1704067200,
        timezone: '+0900'
      }
      const options: CreateTagOptions = {
        annotated: true,
        message: 'Release',
        tagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.tagger?.name).toBe('山田 太郎')
    })
  })

  describe('Very long inputs', () => {
    it('should handle very long tag message', async () => {
      const longMessage = 'A'.repeat(100000)
      const options: CreateTagOptions = {
        annotated: true,
        message: longMessage,
        tagger: sampleTagger
      }

      const tag = await manager.createTag('v1.0.0', sampleCommitSha, options)

      expect(tag.message).toBe(longMessage)
    })

    it('should handle tag name at max length', async () => {
      // Git typically allows tag names up to 255 characters
      const longName = 'v' + '1.0.0-'.repeat(40)
      const tag = await manager.createTag(longName, sampleCommitSha)

      expect(tag.name).toBe(longName)
    })
  })

  describe('Concurrent operations', () => {
    it('should handle concurrent tag creations', async () => {
      const promises = [
        manager.createTag('tag1', sampleCommitSha),
        manager.createTag('tag2', sampleCommitSha),
        manager.createTag('tag3', sampleCommitSha)
      ]

      const tags = await Promise.all(promises)

      expect(tags).toHaveLength(3)
      expect(new Set(tags.map(t => t.name)).size).toBe(3)
    })

    it('should handle concurrent same-tag creation attempts', async () => {
      const promises = [
        manager.createTag('v1.0.0', sampleCommitSha),
        manager.createTag('v1.0.0', sampleCommitSha2)
      ]

      // One should succeed, one should fail with TAG_EXISTS
      const results = await Promise.allSettled(promises)

      const succeeded = results.filter(r => r.status === 'fulfilled')
      const failed = results.filter(r => r.status === 'rejected')

      expect(succeeded).toHaveLength(1)
      expect(failed).toHaveLength(1)
    })
  })

  describe('Empty and whitespace values', () => {
    it('should throw for empty tag name', async () => {
      await expect(manager.createTag('', sampleCommitSha))
        .rejects.toThrow(TagError)
    })

    it('should throw for whitespace-only tag name', async () => {
      await expect(manager.createTag('   ', sampleCommitSha))
        .rejects.toThrow(TagError)
    })

    it('should throw for empty message in annotated tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: '',
        tagger: sampleTagger
      }

      await expect(manager.createTag('v1.0.0', sampleCommitSha, options))
        .rejects.toThrow(TagError)
    })

    it('should throw for whitespace-only message in annotated tag', async () => {
      const options: CreateTagOptions = {
        annotated: true,
        message: '   \n\n   ',
        tagger: sampleTagger
      }

      await expect(manager.createTag('v1.0.0', sampleCommitSha, options))
        .rejects.toThrow(TagError)
    })
  })

  describe('Nested tags resolution', () => {
    it('should resolve nested tags to final commit', async () => {
      // Create first annotated tag
      const options1: CreateTagOptions = {
        annotated: true,
        message: 'First tag',
        tagger: sampleTagger
      }
      const tag1 = await manager.createTag('v1.0.0', sampleCommitSha, options1)

      // Create second tag pointing to first tag
      const options2: CreateTagOptions = {
        annotated: true,
        message: 'Second tag',
        tagger: sampleTagger
      }
      await manager.createTag('v1.0.0-alias', tag1.sha, options2)

      // getTagTarget should resolve through the nested tag
      const finalTarget = await manager.getTagTarget('v1.0.0-alias')

      expect(finalTarget).toBe(sampleCommitSha)
    })

    it('should handle deeply nested tags', async () => {
      let currentSha = sampleCommitSha

      // Create a chain of 5 nested tags
      for (let i = 0; i < 5; i++) {
        const options: CreateTagOptions = {
          annotated: true,
          message: `Tag ${i}`,
          tagger: sampleTagger
        }
        const tag = await manager.createTag(`tag-${i}`, currentSha, options)
        currentSha = tag.sha
      }

      // Should be able to resolve through the chain
      const finalTarget = await manager.getTagTarget('tag-4')
      expect(finalTarget).toBe(sampleCommitSha)
    })
  })
})
