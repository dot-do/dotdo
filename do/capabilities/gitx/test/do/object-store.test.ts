import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectStore,
  StoredObject
} from '../../src/do/object-store'
import { DurableObjectStorage } from '../../src/do/schema'
import {
  ObjectType,
  BlobObject,
  TreeObject,
  CommitObject,
  TagObject,
  TreeEntry,
  Author,
  serializeBlob,
  serializeTree,
  serializeCommit,
  serializeTag
} from '../../src/types/objects'

// Helper to create test data
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample test data
const sampleAuthor: Author = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

const sampleSha = 'a'.repeat(40) // Valid SHA-1 hex string

/**
 * Mock DurableObjectStorage for testing ObjectStore operations
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
        const type = params[1] as ObjectType
        const size = params[2] as number
        const data = params[3] as Uint8Array
        const createdAt = params[4] as number

        this.objects.set(sha, { sha, type, size, data, createdAt })
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

      // Handle WAL flush
      if (query.includes('UPDATE wal') && query.includes('flushed = 1')) {
        for (const entry of this.walEntries) {
          entry.flushed = true
        }
        return { toArray: () => [] }
      }

      // Handle WAL COUNT
      if (query.includes('SELECT COUNT') && query.includes('FROM wal')) {
        const count = this.walEntries.filter(e => !e.flushed).length
        return { toArray: () => [{ count }] }
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

describe('ObjectStore', () => {
  let storage: MockObjectStorage
  let objectStore: ObjectStore

  beforeEach(() => {
    storage = new MockObjectStorage()
    objectStore = new ObjectStore(storage)
  })

  describe('putObject', () => {
    describe('blob objects', () => {
      it('should store a blob object and return its SHA', async () => {
        const content = encoder.encode('hello world')

        const sha = await objectStore.putObject('blob', content)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        expect(sha).toMatch(/^[0-9a-f]{40}$/)
      })

      it('should store blob data correctly', async () => {
        const content = encoder.encode('hello world')

        const sha = await objectStore.putObject('blob', content)

        const objects = storage.getObjects()
        expect(objects.has(sha)).toBe(true)
        const stored = objects.get(sha)!
        expect(stored.type).toBe('blob')
        expect(stored.size).toBe(content.length)
      })

      it('should produce consistent SHA for same content', async () => {
        const content = encoder.encode('hello')

        const sha1 = await objectStore.putObject('blob', content)
        const sha2 = await objectStore.putObject('blob', content)

        expect(sha1).toBe(sha2)
      })

      it('should produce known SHA for empty blob', async () => {
        // git hash-object -t blob /dev/null gives e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
        const sha = await objectStore.putObject('blob', new Uint8Array(0))

        expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
      })

      it('should produce known SHA for "hello" blob', async () => {
        // echo -n "hello" | git hash-object --stdin
        const sha = await objectStore.putObject('blob', encoder.encode('hello'))

        expect(sha).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
      })

      it('should handle binary content', async () => {
        const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])

        const sha = await objectStore.putObject('blob', binaryData)

        expect(sha).toBeDefined()
        const stored = storage.getObjects().get(sha)!
        expect(stored.data).toEqual(binaryData)
      })

      it('should handle large content', async () => {
        const largeData = new Uint8Array(1024 * 1024) // 1MB
        for (let i = 0; i < largeData.length; i++) {
          largeData[i] = i % 256
        }

        const sha = await objectStore.putObject('blob', largeData)

        expect(sha).toBeDefined()
        const stored = storage.getObjects().get(sha)!
        expect(stored.size).toBe(1024 * 1024)
      })
    })

    describe('tree objects', () => {
      it('should store an empty tree', async () => {
        const entries: TreeEntry[] = []

        const sha = await objectStore.putTreeObject(entries)

        expect(sha).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
      })

      it('should store a tree with entries', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleSha }
        ]

        const sha = await objectStore.putTreeObject(entries)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        const stored = storage.getObjects().get(sha)!
        expect(stored.type).toBe('tree')
      })

      it('should sort tree entries correctly', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'z.txt', sha: sampleSha },
          { mode: '100644', name: 'a.txt', sha: sampleSha },
          { mode: '040000', name: 'dir', sha: sampleSha }
        ]

        const sha = await objectStore.putTreeObject(entries)

        expect(sha).toBeDefined()
      })
    })

    describe('commit objects', () => {
      it('should store a commit without parents', async () => {
        const commit = {
          tree: sampleSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Initial commit'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        const stored = storage.getObjects().get(sha)!
        expect(stored.type).toBe('commit')
      })

      it('should store a commit with parents', async () => {
        const parentSha = 'b'.repeat(40)
        const commit = {
          tree: sampleSha,
          parents: [parentSha],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Second commit'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
        const stored = storage.getObjects().get(sha)!
        expect(stored.type).toBe('commit')
      })

      it('should store a merge commit', async () => {
        const commit = {
          tree: sampleSha,
          parents: ['b'.repeat(40), 'c'.repeat(40)],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Merge commit'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
      })
    })

    describe('tag objects', () => {
      it('should store an annotated tag', async () => {
        const tag = {
          object: sampleSha,
          objectType: 'commit' as ObjectType,
          tagger: sampleAuthor,
          message: 'Release v1.0.0',
          name: 'v1.0.0'
        }

        const sha = await objectStore.putTagObject(tag)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        const stored = storage.getObjects().get(sha)!
        expect(stored.type).toBe('tag')
      })
    })

    describe('WAL integration', () => {
      it('should log PUT operation to WAL', async () => {
        const content = encoder.encode('test')

        await objectStore.putObject('blob', content)

        const walEntries = storage.getWALEntries()
        expect(walEntries.length).toBeGreaterThan(0)
        expect(walEntries[0].operation).toBe('PUT')
      })
    })
  })

  describe('getObject', () => {
    it('should retrieve a stored blob object', async () => {
      const content = encoder.encode('hello world')
      const sha = await objectStore.putObject('blob', content)

      const obj = await objectStore.getObject(sha)

      expect(obj).not.toBeNull()
      expect(obj!.type).toBe('blob')
      expect(obj!.data).toEqual(content)
    })

    it('should return null for non-existent object', async () => {
      const obj = await objectStore.getObject('nonexistent'.repeat(4))

      expect(obj).toBeNull()
    })

    it('should retrieve blob with correct type', async () => {
      const content = encoder.encode('blob content')
      const sha = await objectStore.putObject('blob', content)

      const obj = await objectStore.getObject(sha)

      expect(obj!.type).toBe('blob')
    })

    it('should retrieve tree with correct type', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleSha }
      ]
      const sha = await objectStore.putTreeObject(entries)

      const obj = await objectStore.getObject(sha)

      expect(obj!.type).toBe('tree')
    })

    it('should retrieve commit with correct type', async () => {
      const commit = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'test'
      }
      const sha = await objectStore.putCommitObject(commit)

      const obj = await objectStore.getObject(sha)

      expect(obj!.type).toBe('commit')
    })

    it('should retrieve tag with correct type', async () => {
      const tag = {
        object: sampleSha,
        objectType: 'commit' as ObjectType,
        tagger: sampleAuthor,
        message: 'test',
        name: 'v1.0'
      }
      const sha = await objectStore.putTagObject(tag)

      const obj = await objectStore.getObject(sha)

      expect(obj!.type).toBe('tag')
    })
  })

  describe('deleteObject', () => {
    it('should delete an existing object', async () => {
      const content = encoder.encode('to be deleted')
      const sha = await objectStore.putObject('blob', content)

      const deleted = await objectStore.deleteObject(sha)

      expect(deleted).toBe(true)
      const obj = await objectStore.getObject(sha)
      expect(obj).toBeNull()
    })

    it('should return false for non-existent object', async () => {
      const deleted = await objectStore.deleteObject('nonexistent'.repeat(4))

      expect(deleted).toBe(false)
    })

    it('should remove from object index', async () => {
      const content = encoder.encode('indexed object')
      const sha = await objectStore.putObject('blob', content)

      await objectStore.deleteObject(sha)

      const index = storage.getObjectIndex()
      expect(index.has(sha)).toBe(false)
    })

    it('should log DELETE operation to WAL', async () => {
      const content = encoder.encode('test')
      const sha = await objectStore.putObject('blob', content)
      storage.clearAll()
      storage.injectObject(sha, 'blob', content)

      await objectStore.deleteObject(sha)

      const walEntries = storage.getWALEntries()
      expect(walEntries.some(e => e.operation === 'DELETE')).toBe(true)
    })
  })

  describe('hasObject', () => {
    it('should return true for existing object', async () => {
      const content = encoder.encode('exists')
      const sha = await objectStore.putObject('blob', content)

      const exists = await objectStore.hasObject(sha)

      expect(exists).toBe(true)
    })

    it('should return false for non-existent object', async () => {
      const exists = await objectStore.hasObject('nonexistent'.repeat(4))

      expect(exists).toBe(false)
    })
  })

  describe('object verification', () => {
    it('should verify stored object matches computed hash', async () => {
      const content = encoder.encode('verify me')
      const sha = await objectStore.putObject('blob', content)

      const isValid = await objectStore.verifyObject(sha)

      expect(isValid).toBe(true)
    })

    it('should return false for corrupted object', async () => {
      const content = encoder.encode('original')
      const sha = await objectStore.putObject('blob', content)

      // Corrupt the data
      const objects = storage.getObjects()
      const obj = objects.get(sha)!
      obj.data = encoder.encode('corrupted')

      const isValid = await objectStore.verifyObject(sha)

      expect(isValid).toBe(false)
    })

    it('should return false for non-existent object', async () => {
      const isValid = await objectStore.verifyObject('nonexistent'.repeat(4))

      expect(isValid).toBe(false)
    })
  })

  describe('getObjectType', () => {
    it('should return type for blob', async () => {
      const sha = await objectStore.putObject('blob', encoder.encode('test'))

      const type = await objectStore.getObjectType(sha)

      expect(type).toBe('blob')
    })

    it('should return type for tree', async () => {
      const sha = await objectStore.putTreeObject([])

      const type = await objectStore.getObjectType(sha)

      expect(type).toBe('tree')
    })

    it('should return type for commit', async () => {
      const sha = await objectStore.putCommitObject({
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'test'
      })

      const type = await objectStore.getObjectType(sha)

      expect(type).toBe('commit')
    })

    it('should return null for non-existent object', async () => {
      const type = await objectStore.getObjectType('nonexistent'.repeat(4))

      expect(type).toBeNull()
    })
  })

  describe('getObjectSize', () => {
    it('should return size for existing object', async () => {
      const content = encoder.encode('size test')
      const sha = await objectStore.putObject('blob', content)

      const size = await objectStore.getObjectSize(sha)

      expect(size).toBe(content.length)
    })

    it('should return null for non-existent object', async () => {
      const size = await objectStore.getObjectSize('nonexistent'.repeat(4))

      expect(size).toBeNull()
    })
  })

  describe('batch operations', () => {
    it('should store multiple objects in a batch', async () => {
      const objects = [
        { type: 'blob' as ObjectType, data: encoder.encode('obj1') },
        { type: 'blob' as ObjectType, data: encoder.encode('obj2') },
        { type: 'blob' as ObjectType, data: encoder.encode('obj3') }
      ]

      const shas = await objectStore.putObjects(objects)

      expect(shas).toHaveLength(3)
      for (const sha of shas) {
        expect(await objectStore.hasObject(sha)).toBe(true)
      }
    })

    it('should retrieve multiple objects at once', async () => {
      const sha1 = await objectStore.putObject('blob', encoder.encode('get1'))
      const sha2 = await objectStore.putObject('blob', encoder.encode('get2'))

      const objects = await objectStore.getObjects([sha1, sha2])

      expect(objects).toHaveLength(2)
      expect(objects.every(o => o !== null)).toBe(true)
    })

    it('should return null for non-existent objects in batch get', async () => {
      const sha1 = await objectStore.putObject('blob', encoder.encode('exists'))
      const sha2 = 'nonexistent'.repeat(4)

      const objects = await objectStore.getObjects([sha1, sha2])

      expect(objects[0]).not.toBeNull()
      expect(objects[1]).toBeNull()
    })
  })

  describe('object deserialization helpers', () => {
    it('should get blob content', async () => {
      const content = encoder.encode('blob data')
      const sha = await objectStore.putObject('blob', content)

      const blob = await objectStore.getBlobObject(sha)

      expect(blob).not.toBeNull()
      expect(blob!.type).toBe('blob')
      expect(decoder.decode(blob!.data)).toBe('blob data')
    })

    it('should get tree entries', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleSha }
      ]
      const sha = await objectStore.putTreeObject(entries)

      const tree = await objectStore.getTreeObject(sha)

      expect(tree).not.toBeNull()
      expect(tree!.type).toBe('tree')
      expect(tree!.entries).toHaveLength(1)
      expect(tree!.entries[0].name).toBe('file.txt')
    })

    it('should get commit details', async () => {
      const commitData = {
        tree: sampleSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test message'
      }
      const sha = await objectStore.putCommitObject(commitData)

      const commit = await objectStore.getCommitObject(sha)

      expect(commit).not.toBeNull()
      expect(commit!.type).toBe('commit')
      expect(commit!.tree).toBe(sampleSha)
      expect(commit!.message).toBe('Test message')
    })

    it('should get tag details', async () => {
      const tagData = {
        object: sampleSha,
        objectType: 'commit' as ObjectType,
        tagger: sampleAuthor,
        message: 'Tag message',
        name: 'v1.0'
      }
      const sha = await objectStore.putTagObject(tagData)

      const tag = await objectStore.getTagObject(sha)

      expect(tag).not.toBeNull()
      expect(tag!.type).toBe('tag')
      expect(tag!.name).toBe('v1.0')
      expect(tag!.message).toBe('Tag message')
    })

    it('should return null for wrong type', async () => {
      const sha = await objectStore.putObject('blob', encoder.encode('not a tree'))

      const tree = await objectStore.getTreeObject(sha)

      expect(tree).toBeNull()
    })
  })

  describe('raw object access', () => {
    it('should get raw serialized object', async () => {
      const content = encoder.encode('raw content')
      const sha = await objectStore.putObject('blob', content)

      const raw = await objectStore.getRawObject(sha)

      expect(raw).not.toBeNull()
      // The raw object should contain the git header
      const rawStr = decoder.decode(raw!)
      expect(rawStr).toContain('blob')
    })
  })

  describe('error handling', () => {
    it('should handle invalid SHA gracefully', async () => {
      const obj = await objectStore.getObject('invalid')

      expect(obj).toBeNull()
    })

    it('should handle empty SHA', async () => {
      const obj = await objectStore.getObject('')

      expect(obj).toBeNull()
    })
  })
})

describe('StoredObject interface', () => {
  it('should have all required fields', () => {
    const stored: StoredObject = {
      sha: 'a'.repeat(40),
      type: 'blob',
      size: 100,
      data: new Uint8Array(100),
      createdAt: Date.now()
    }

    expect(stored.sha).toBeDefined()
    expect(stored.type).toBeDefined()
    expect(stored.size).toBeDefined()
    expect(stored.data).toBeDefined()
    expect(stored.createdAt).toBeDefined()
  })
})
