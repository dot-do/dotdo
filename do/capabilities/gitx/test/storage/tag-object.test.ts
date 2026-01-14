/**
 * @fileoverview RED Phase Tests for Git Tag Object Storage
 *
 * These tests define the expected behavior for tag object storage operations.
 * They should fail initially (RED phase) until the implementation is complete.
 *
 * Tag objects in Git (annotated tags) store:
 * - object: SHA of the object being tagged
 * - type: Type of the object being tagged (commit, tree, blob, tag)
 * - tag: Name of the tag
 * - tagger: Name, email, timestamp, timezone of the tagger
 * - message: Tag annotation message
 *
 * Tag format:
 * ```
 * object {object-sha}
 * type {object-type}
 * tag {tag-name}
 * tagger {name} <{email}> {timestamp} {timezone}
 *
 * {message}
 * ```
 *
 * Note: Lightweight tags are just refs pointing directly to commits,
 * not tag objects. This module tests annotated tag objects.
 *
 * @module test/storage/tag-object
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectStore,
  StoredObject
} from '../../src/durable-object/object-store'
import { DurableObjectStorage } from '../../src/durable-object/schema'
import {
  Author,
  TagObject,
  ObjectType
} from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Sample valid 40-character SHA-1 hashes for testing */
const sampleCommitSha = 'a'.repeat(40)
const sampleTreeSha = 'b'.repeat(40)
const sampleBlobSha = 'c'.repeat(40)
const sampleTagSha = 'd'.repeat(40)

/** Sample tagger for testing */
const sampleTagger: Author = {
  name: 'Test Tagger',
  email: 'tagger@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

/** Sample tagger with different timezone */
const sampleTagger2: Author = {
  name: 'Another Tagger',
  email: 'another@example.com.ai',
  timestamp: 1704153600, // 2024-01-02 00:00:00 UTC
  timezone: '-0500'
}

/**
 * Mock DurableObjectStorage for testing tag object operations
 */
class MockObjectStorage implements DurableObjectStorage {
  private objects: Map<string, StoredObject> = new Map()
  private objectIndex: Map<string, { tier: string; packId: string | null; offset: number | null; size: number; type: string; updatedAt: number }> = new Map()
  private walEntries: { id: number; operation: string; payload: Uint8Array; flushed: boolean }[] = []
  private nextWalId = 1
  private executedQueries: string[] = []

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.executedQueries.push(query)

      // Handle WAL inserts
      if (query.includes('INSERT INTO wal')) {
        const id = this.nextWalId++
        this.walEntries.push({
          id,
          operation: params[0] as string,
          payload: params[1] as Uint8Array,
          flushed: false
        })
        return { toArray: () => [{ id }] }
      }

      // Handle object inserts
      if (query.includes('INSERT INTO objects') || query.includes('INSERT OR REPLACE INTO objects')) {
        const sha = params[0] as string
        const type = params[1] as string
        const size = params[2] as number
        const data = params[3] as Uint8Array
        const createdAt = params[4] as number

        this.objects.set(sha, { sha, type: type as ObjectType, size, data, createdAt })
        return { toArray: () => [] }
      }

      // Handle object_index inserts
      if (query.includes('INSERT INTO object_index') || query.includes('INSERT OR REPLACE INTO object_index')) {
        const sha = params[0] as string
        const tier = params[1] as string
        const packId = params[2] as string | null
        const offset = params[3] as number | null
        const size = params[4] as number
        const type = params[5] as string
        const updatedAt = params[6] as number

        this.objectIndex.set(sha, { tier, packId, offset, size, type, updatedAt })
        return { toArray: () => [] }
      }

      // Handle object SELECT by sha
      if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const obj = this.objects.get(sha)
        return { toArray: () => obj ? [obj] : [] }
      }

      // Handle object_index SELECT by sha
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const idx = this.objectIndex.get(sha)
        return { toArray: () => idx ? [{ sha, tier: idx.tier, pack_id: idx.packId, offset: idx.offset, size: idx.size, type: idx.type, updated_at: idx.updatedAt }] : [] }
      }

      // Handle object DELETE
      if (query.includes('DELETE FROM objects') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        this.objects.delete(sha)
        return { toArray: () => [] }
      }

      // Handle object_index DELETE
      if (query.includes('DELETE FROM object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        this.objectIndex.delete(sha)
        return { toArray: () => [] }
      }

      // Handle COUNT for objects
      if (query.includes('SELECT COUNT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const exists = this.objects.has(sha)
        return { toArray: () => [{ count: exists ? 1 : 0 }] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getObjects(): Map<string, StoredObject> {
    return this.objects
  }

  getObjectIndex(): Map<string, { tier: string; packId: string | null; offset: number | null; size: number; type: string; updatedAt: number }> {
    return this.objectIndex
  }

  getWALEntries() {
    return [...this.walEntries]
  }

  getExecutedQueries(): string[] {
    return [...this.executedQueries]
  }

  clearAll(): void {
    this.objects.clear()
    this.objectIndex.clear()
    this.walEntries = []
    this.nextWalId = 1
    this.executedQueries = []
  }

  // Inject objects for testing
  injectObject(sha: string, type: ObjectType, data: Uint8Array): void {
    const now = Date.now()
    this.objects.set(sha, {
      sha,
      type,
      size: data.length,
      data,
      createdAt: now
    })
    this.objectIndex.set(sha, {
      tier: 'hot',
      packId: null,
      offset: null,
      size: data.length,
      type,
      updatedAt: now
    })
  }
}

/**
 * Build tag content manually for testing/verification
 */
function buildTagContent(
  object: string,
  objectType: ObjectType,
  tagName: string,
  tagger: Author,
  message: string
): string {
  const lines: string[] = []
  lines.push(`object ${object}`)
  lines.push(`type ${objectType}`)
  lines.push(`tag ${tagName}`)
  lines.push(`tagger ${tagger.name} <${tagger.email}> ${tagger.timestamp} ${tagger.timezone}`)
  lines.push('')
  lines.push(message)
  return lines.join('\n')
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Tag Object Storage', () => {
  let storage: MockObjectStorage
  let objectStore: ObjectStore

  beforeEach(() => {
    storage = new MockObjectStorage()
    objectStore = new ObjectStore(storage)
  })

  // ==========================================================================
  // putTagObject - Storing Tags
  // ==========================================================================

  describe('putTagObject - Storing tag objects', () => {
    describe('Basic tag storage', () => {
      it('should store a tag with object, objectType, name, tagger, message', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Release version 1.0.0'
        }

        const sha = await objectStore.putTagObject(tag)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        expect(sha).toMatch(/^[0-9a-f]{40}$/)

        // Verify it was stored as type 'tag'
        const objects = storage.getObjects()
        expect(objects.has(sha)).toBe(true)
        const stored = objects.get(sha)!
        expect(stored.type).toBe('tag')
      })

      it('should store tag data with correct format', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Release message'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        // Verify content contains all required parts
        expect(content).toContain(`object ${sampleCommitSha}`)
        expect(content).toContain('type commit')
        expect(content).toContain('tag v1.0.0')
        expect(content).toContain(`tagger ${sampleTagger.name} <${sampleTagger.email}>`)
        expect(content).toContain('Release message')
      })

      it('should produce deterministic SHA for identical tags', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Same tag'
        }

        const sha1 = await objectStore.putTagObject(tag)
        const sha2 = await objectStore.putTagObject(tag)

        expect(sha1).toBe(sha2)
      })

      it('should produce different SHA for different object reference', async () => {
        const tag1 = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Same message'
        }
        const tag2 = {
          object: sampleTreeSha, // Different object
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Same message'
        }

        const sha1 = await objectStore.putTagObject(tag1)
        const sha2 = await objectStore.putTagObject(tag2)

        expect(sha1).not.toBe(sha2)
      })

      it('should produce different SHA for different tag name', async () => {
        const tag1 = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Same message'
        }
        const tag2 = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.1', // Different name
          tagger: sampleTagger,
          message: 'Same message'
        }

        const sha1 = await objectStore.putTagObject(tag1)
        const sha2 = await objectStore.putTagObject(tag2)

        expect(sha1).not.toBe(sha2)
      })
    })

    describe('Tag pointing to commit', () => {
      it('should store tag pointing to commit correctly', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Release tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`object ${sampleCommitSha}`)
        expect(content).toContain('type commit')
      })

      it('should parse tag pointing to commit correctly on retrieval', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Release tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleCommitSha)
        expect(retrieved!.objectType).toBe('commit')
      })
    })

    describe('Tag pointing to tree', () => {
      it('should store tag pointing to tree correctly', async () => {
        const tag = {
          object: sampleTreeSha,
          objectType: 'tree' as ObjectType,
          name: 'snapshot-v1',
          tagger: sampleTagger,
          message: 'Snapshot of project state'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`object ${sampleTreeSha}`)
        expect(content).toContain('type tree')
      })

      it('should parse tag pointing to tree correctly on retrieval', async () => {
        const tag = {
          object: sampleTreeSha,
          objectType: 'tree' as ObjectType,
          name: 'tree-snapshot',
          tagger: sampleTagger,
          message: 'Tree snapshot'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleTreeSha)
        expect(retrieved!.objectType).toBe('tree')
      })
    })

    describe('Tag pointing to blob', () => {
      it('should store tag pointing to blob correctly', async () => {
        const tag = {
          object: sampleBlobSha,
          objectType: 'blob' as ObjectType,
          name: 'important-file',
          tagger: sampleTagger,
          message: 'Tag an important file'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`object ${sampleBlobSha}`)
        expect(content).toContain('type blob')
      })

      it('should parse tag pointing to blob correctly on retrieval', async () => {
        const tag = {
          object: sampleBlobSha,
          objectType: 'blob' as ObjectType,
          name: 'blob-tag',
          tagger: sampleTagger,
          message: 'Blob tag message'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleBlobSha)
        expect(retrieved!.objectType).toBe('blob')
      })
    })

    describe('Tag pointing to another tag (nested tag)', () => {
      it('should store tag pointing to another tag correctly', async () => {
        const tag = {
          object: sampleTagSha,
          objectType: 'tag' as ObjectType,
          name: 'v1.0.0-alias',
          tagger: sampleTagger,
          message: 'Alias for v1.0.0'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`object ${sampleTagSha}`)
        expect(content).toContain('type tag')
      })

      it('should parse nested tag correctly on retrieval', async () => {
        const tag = {
          object: sampleTagSha,
          objectType: 'tag' as ObjectType,
          name: 'nested-tag',
          tagger: sampleTagger,
          message: 'Points to another tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleTagSha)
        expect(retrieved!.objectType).toBe('tag')
      })
    })

    describe('Tagger information parsing', () => {
      it('should store tagger with timestamp and timezone', async () => {
        const tagger: Author = {
          name: 'Test Tagger',
          email: 'tagger@test.com',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain('tagger Test Tagger <tagger@test.com> 1704067200 +0000')
      })

      it('should parse tagger timestamp correctly on retrieval', async () => {
        const tagger: Author = {
          name: 'Test User',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.timestamp).toBe(1704067200)
        expect(retrieved!.tagger!.timezone).toBe('+0900')
      })

      it('should handle negative timezone offset', async () => {
        const tagger: Author = {
          name: 'West Coast Dev',
          email: 'dev@west.com',
          timestamp: 1704067200,
          timezone: '-0800'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.timezone).toBe('-0800')
      })

      it('should handle non-hour-aligned timezone offset', async () => {
        // India Standard Time is +0530
        const tagger: Author = {
          name: 'India Dev',
          email: 'dev@india.com',
          timestamp: 1704067200,
          timezone: '+0530'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.timezone).toBe('+0530')
      })

      it('should parse tagger name with spaces correctly', async () => {
        const tagger: Author = {
          name: 'First Middle Last',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.name).toBe('First Middle Last')
      }
      )

      it('should parse tagger email correctly', async () => {
        const tagger: Author = {
          name: 'Test User',
          email: 'complex+tag@subdomain.example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.email).toBe('complex+tag@subdomain.example.com.ai')
      })

      it('should handle tagger with unicode name', async () => {
        const tagger: Author = {
          name: 'Tester',
          email: 'test@example.jp',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.name).toBe('Tester')
      })

      it('should handle epoch timestamp (0)', async () => {
        const tagger: Author = {
          name: 'Epoch User',
          email: 'epoch@test.com',
          timestamp: 0,
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'epoch-tag',
          tagger,
          message: 'Epoch tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.timestamp).toBe(0)
      })

      it('should handle far future timestamp', async () => {
        const tagger: Author = {
          name: 'Future User',
          email: 'future@test.com',
          timestamp: 4102444800, // Year 2100
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'future-tag',
          tagger,
          message: 'Future tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.timestamp).toBe(4102444800)
      })
    })

    describe('Optional tagger field', () => {
      it('should store tag without tagger (optional tagger)', async () => {
        // Git allows tags without tagger information (created by older Git versions)
        // The implementation should support storing tags with optional tagger
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: undefined as Author | undefined,
          message: 'Tag without tagger'
        }

        // This should not throw - tagger should be optional
        const sha = await objectStore.putTagObject(tag as {
          object: string
          objectType: ObjectType
          tagger?: Author
          message: string
          name: string
        })

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
      })

      it('should retrieve tag without tagger correctly', async () => {
        // Inject a tag object without tagger line directly into storage
        const tagContent = [
          `object ${sampleCommitSha}`,
          'type commit',
          'tag no-tagger-tag',
          '',
          'Tag message without tagger'
        ].join('\n')
        storage.injectObject('aa'.repeat(20), 'tag', encoder.encode(tagContent))

        const retrieved = await objectStore.getTagObject('aa'.repeat(20))

        // Should successfully parse tag without tagger
        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleCommitSha)
        expect(retrieved!.objectType).toBe('commit')
        expect(retrieved!.name).toBe('no-tagger-tag')
        expect(retrieved!.tagger).toBeUndefined()
        expect(retrieved!.message).toBe('Tag message without tagger')
      })

      it('should parse stored tag without tagger on roundtrip', async () => {
        // Directly inject tag without tagger to test getTagObject parsing
        const tagContent = [
          `object ${sampleTreeSha}`,
          'type tree',
          'tag snapshot',
          '',
          'Snapshot without tagger info'
        ].join('\n')
        storage.injectObject('bb'.repeat(20), 'tag', encoder.encode(tagContent))

        const retrieved = await objectStore.getTagObject('bb'.repeat(20))

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger).toBeUndefined()
        expect(retrieved!.message).toBe('Snapshot without tagger info')
      })
    })

    describe('Tag message formatting', () => {
      it('should store simple one-line message', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Simple tag message'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe('Simple tag message')
      })

      it('should store message with subject and body', async () => {
        const message = 'Release v1.0.0\n\nThis release includes:\n- Feature A\n- Bug fix B'
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should preserve multiple paragraphs in message body', async () => {
        const message = 'Release v1.0.0\n\nParagraph 1.\n\nParagraph 2.\n\nParagraph 3.'
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
        expect(retrieved!.message.split('\n\n')).toHaveLength(4)
      })

      it('should handle message with special characters', async () => {
        const message = 'Fix bug with <script> tags & special "chars"'
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle message with unicode characters', async () => {
        const message = 'Add emoji support and internationalization'
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle very long message', async () => {
        const longBody = 'A'.repeat(10000)
        const message = `Release v1.0.0\n\n${longBody}`
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle message with trailing newlines', async () => {
        const message = 'Subject line\n\nBody text.\n'
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })
    })

    describe('Tag name variations', () => {
      it('should store tag with semver-style name', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v2.3.4-beta.1',
          tagger: sampleTagger,
          message: 'Beta release'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.name).toBe('v2.3.4-beta.1')
      })

      it('should store tag with simple name', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'release',
          tagger: sampleTagger,
          message: 'Release tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.name).toBe('release')
      })

      it('should store tag with path-like name', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'releases/v1.0.0',
          tagger: sampleTagger,
          message: 'Release tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.name).toBe('releases/v1.0.0')
      })

      it('should store tag with underscores in name', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'release_1_0_0',
          tagger: sampleTagger,
          message: 'Release tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.name).toBe('release_1_0_0')
      })
    })
  })

  // ==========================================================================
  // getTagObject - Retrieving Tags
  // ==========================================================================

  describe('getTagObject - Retrieving tag objects', () => {
    describe('Basic retrieval', () => {
      it('should retrieve a stored tag object', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Test tag'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.type).toBe('tag')
      })

      it('should return null for non-existent tag', async () => {
        const tag = await objectStore.getTagObject('nonexistent'.repeat(4))

        expect(tag).toBeNull()
      })

      it('should return null for non-tag object type', async () => {
        // Store a blob
        const blobSha = await objectStore.putObject('blob', encoder.encode('hello'))

        const tag = await objectStore.getTagObject(blobSha)

        expect(tag).toBeNull()
      })

      it('should return null for commit object', async () => {
        const commitSha = await objectStore.putCommitObject({
          tree: sampleTreeSha,
          parents: [],
          author: sampleTagger,
          committer: sampleTagger,
          message: 'Test commit'
        })

        const tag = await objectStore.getTagObject(commitSha)

        expect(tag).toBeNull()
      })
    })

    describe('Field parsing', () => {
      it('should parse object SHA correctly', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.object).toBe(sampleCommitSha)
        expect(retrieved!.object).toHaveLength(40)
      })

      it('should parse objectType correctly', async () => {
        const tag = {
          object: sampleTreeSha,
          objectType: 'tree' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.objectType).toBe('tree')
      })

      it('should parse tag name correctly', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'my-special-tag',
          tagger: sampleTagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.name).toBe('my-special-tag')
      })

      it('should parse tagger name correctly', async () => {
        const tagger: Author = {
          name: 'John Doe',
          email: 'john@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tagger!.name).toBe('John Doe')
      })

      it('should parse message correctly', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'This is a detailed tag message'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe('This is a detailed tag message')
      })

      it('should include raw data in tag object', async () => {
        const tag = {
          object: sampleCommitSha,
          objectType: 'commit' as ObjectType,
          name: 'v1.0.0',
          tagger: sampleTagger,
          message: 'Test'
        }

        const sha = await objectStore.putTagObject(tag)
        const retrieved = await objectStore.getTagObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.data).toBeDefined()
        expect(retrieved!.data).toBeInstanceOf(Uint8Array)
        expect(retrieved!.data.length).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // SHA Calculation Verification
  // ==========================================================================

  describe('Tag SHA Calculation', () => {
    it('should compute SHA-1 using Git tag format', async () => {
      const tag = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Test tag'
      }

      const sha = await objectStore.putTagObject(tag)

      // SHA should be valid hex
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should include type and size header in SHA calculation', async () => {
      // The SHA is computed from "tag {size}\0{content}"
      const tag = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Test'
      }

      const sha1 = await objectStore.putTagObject(tag)
      const sha2 = await objectStore.putTagObject(tag)

      // Same content should produce same SHA
      expect(sha1).toBe(sha2)
    })

    it('should produce different SHA for different messages', async () => {
      const tag1 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Message A'
      }
      const tag2 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Message B'
      }

      const sha1 = await objectStore.putTagObject(tag1)
      const sha2 = await objectStore.putTagObject(tag2)

      expect(sha1).not.toBe(sha2)
    })

    it('should produce different SHA for different tagger timestamps', async () => {
      const tagger1: Author = { ...sampleTagger, timestamp: 1704067200 }
      const tagger2: Author = { ...sampleTagger, timestamp: 1704067201 } // 1 second later

      const tag1 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: tagger1,
        message: 'Test'
      }
      const tag2 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: tagger2,
        message: 'Test'
      }

      const sha1 = await objectStore.putTagObject(tag1)
      const sha2 = await objectStore.putTagObject(tag2)

      expect(sha1).not.toBe(sha2)
    })

    it('should produce different SHA for different objectType', async () => {
      const tag1 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Test'
      }
      const tag2 = {
        object: sampleCommitSha,
        objectType: 'tree' as ObjectType, // Different type
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Test'
      }

      const sha1 = await objectStore.putTagObject(tag1)
      const sha2 = await objectStore.putTagObject(tag2)

      expect(sha1).not.toBe(sha2)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle invalid SHA gracefully in getTagObject', async () => {
      const tag = await objectStore.getTagObject('invalid')

      expect(tag).toBeNull()
    })

    it('should handle empty SHA gracefully in getTagObject', async () => {
      const tag = await objectStore.getTagObject('')

      expect(tag).toBeNull()
    })

    describe('Malformed tag parsing', () => {
      it('should handle corrupted tag data gracefully', async () => {
        // Inject malformed tag data directly into storage
        const corruptedData = encoder.encode('not a valid tag format')
        storage.injectObject('e'.repeat(40), 'tag', corruptedData)

        // Attempting to parse should return null (missing required fields)
        const tag = await objectStore.getTagObject('e'.repeat(40))
        expect(tag).toBeNull()
      })

      it('should handle tag with missing object line', async () => {
        // Build tag without object line
        const malformedContent = [
          `type commit`,
          `tag v1.0.0`,
          `tagger ${sampleTagger.name} <${sampleTagger.email}> ${sampleTagger.timestamp} ${sampleTagger.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('f'.repeat(40), 'tag', encoder.encode(malformedContent))

        const tag = await objectStore.getTagObject('f'.repeat(40))
        // Should return null or tag with empty object
        expect(tag === null || tag.object === '').toBe(true)
      })

      it('should handle tag with missing type line', async () => {
        const malformedContent = [
          `object ${sampleCommitSha}`,
          `tag v1.0.0`,
          `tagger ${sampleTagger.name} <${sampleTagger.email}> ${sampleTagger.timestamp} ${sampleTagger.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('0'.repeat(40), 'tag', encoder.encode(malformedContent))

        const tag = await objectStore.getTagObject('0'.repeat(40))
        // Should still parse with default objectType or return null
        expect(tag === null || tag.objectType !== undefined).toBe(true)
      })

      it('should handle tag with missing tagger line', async () => {
        // Tags without tagger line are valid - older Git versions create them
        // This is NOT malformed; tagger is optional per Git spec
        const validTagContent = [
          `object ${sampleCommitSha}`,
          `type commit`,
          `tag v1.0.0`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('1'.repeat(40), 'tag', encoder.encode(validTagContent))

        const tag = await objectStore.getTagObject('1'.repeat(40))
        // Should successfully parse - tagger is optional
        expect(tag).not.toBeNull()
        expect(tag!.object).toBe(sampleCommitSha)
        expect(tag!.name).toBe('v1.0.0')
        expect(tag!.tagger).toBeUndefined()
        expect(tag!.message).toBe('Message')
      })

      it('should handle tag with malformed tagger line', async () => {
        const malformedContent = [
          `object ${sampleCommitSha}`,
          `type commit`,
          `tag v1.0.0`,
          `tagger InvalidFormat`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('2'.repeat(40), 'tag', encoder.encode(malformedContent))

        // Should handle gracefully - return null or throw
        try {
          const tag = await objectStore.getTagObject('2'.repeat(40))
          expect(tag).toBeNull()
        } catch {
          // Throwing is also acceptable for malformed data
          expect(true).toBe(true)
        }
      })
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should roundtrip tag through store and retrieve', async () => {
      const originalTag = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'Integration test tag\n\nWith a body paragraph.'
      }

      const sha = await objectStore.putTagObject(originalTag)
      const retrieved = await objectStore.getTagObject(sha)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.object).toBe(originalTag.object)
      expect(retrieved!.objectType).toBe(originalTag.objectType)
      expect(retrieved!.name).toBe(originalTag.name)
      expect(retrieved!.tagger!.name).toBe(originalTag.tagger.name)
      expect(retrieved!.tagger!.email).toBe(originalTag.tagger.email)
      expect(retrieved!.tagger!.timestamp).toBe(originalTag.tagger.timestamp)
      expect(retrieved!.tagger!.timezone).toBe(originalTag.tagger.timezone)
      expect(retrieved!.message).toBe(originalTag.message)
    })

    it('should store and retrieve multiple tags pointing to same object', async () => {
      const tag1 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'First release'
      }
      const tag2 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'stable',
        tagger: sampleTagger,
        message: 'Stable alias'
      }
      const tag3 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'production',
        tagger: sampleTagger2,
        message: 'Production deployment'
      }

      const sha1 = await objectStore.putTagObject(tag1)
      const sha2 = await objectStore.putTagObject(tag2)
      const sha3 = await objectStore.putTagObject(tag3)

      // All should have different SHAs (different names/taggers)
      expect(sha1).not.toBe(sha2)
      expect(sha2).not.toBe(sha3)
      expect(sha1).not.toBe(sha3)

      // All should be retrievable
      const retrieved1 = await objectStore.getTagObject(sha1)
      const retrieved2 = await objectStore.getTagObject(sha2)
      const retrieved3 = await objectStore.getTagObject(sha3)

      expect(retrieved1).not.toBeNull()
      expect(retrieved2).not.toBeNull()
      expect(retrieved3).not.toBeNull()

      // All should point to the same object
      expect(retrieved1!.object).toBe(sampleCommitSha)
      expect(retrieved2!.object).toBe(sampleCommitSha)
      expect(retrieved3!.object).toBe(sampleCommitSha)

      // But have different names
      expect(retrieved1!.name).toBe('v1.0.0')
      expect(retrieved2!.name).toBe('stable')
      expect(retrieved3!.name).toBe('production')
    })

    it('should handle chain of tags (tag -> tag -> commit)', async () => {
      // First, store a commit-like object (simulated by injecting)
      storage.injectObject(sampleCommitSha, 'commit', encoder.encode('mock commit'))

      // Create first tag pointing to commit
      const tag1 = {
        object: sampleCommitSha,
        objectType: 'commit' as ObjectType,
        name: 'v1.0.0',
        tagger: sampleTagger,
        message: 'First release'
      }
      const tag1Sha = await objectStore.putTagObject(tag1)

      // Create second tag pointing to first tag
      const tag2 = {
        object: tag1Sha,
        objectType: 'tag' as ObjectType,
        name: 'v1.0.0-alias',
        tagger: sampleTagger2,
        message: 'Alias for v1.0.0'
      }
      const tag2Sha = await objectStore.putTagObject(tag2)

      // Retrieve second tag
      const retrieved2 = await objectStore.getTagObject(tag2Sha)
      expect(retrieved2).not.toBeNull()
      expect(retrieved2!.objectType).toBe('tag')
      expect(retrieved2!.object).toBe(tag1Sha)

      // Follow the chain to first tag
      const retrieved1 = await objectStore.getTagObject(retrieved2!.object)
      expect(retrieved1).not.toBeNull()
      expect(retrieved1!.objectType).toBe('commit')
      expect(retrieved1!.object).toBe(sampleCommitSha)
    })
  })
})
