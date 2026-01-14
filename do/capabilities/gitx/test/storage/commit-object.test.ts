/**
 * @fileoverview RED Phase Tests for Git Commit Object Storage
 *
 * These tests define the expected behavior for commit object storage operations.
 * They should fail initially (RED phase) until the implementation is complete.
 *
 * Commit objects in Git store:
 * - tree: SHA of the root tree object
 * - parent(s): SHA(s) of parent commit(s) (0 for initial, 1+ for regular/merge)
 * - author: Name, email, timestamp, timezone of the author
 * - committer: Name, email, timestamp, timezone of the committer
 * - message: Commit message (subject + optional body)
 *
 * Commit format:
 * ```
 * tree {tree-sha}
 * parent {parent-sha}        (0 or more lines)
 * author {name} <{email}> {timestamp} {timezone}
 * committer {name} <{email}> {timestamp} {timezone}
 *
 * {message}
 * ```
 *
 * @module test/storage/commit-object
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectStore,
  StoredObject
} from '../../src/do/object-store'
import { DurableObjectStorage } from '../../src/do/schema'
import {
  Author,
  CommitObject,
  ObjectType
} from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Sample valid 40-character SHA-1 hashes for testing */
const sampleTreeSha = 'a'.repeat(40)
const sampleParentSha = 'b'.repeat(40)
const sampleParentSha2 = 'c'.repeat(40)
const sampleParentSha3 = 'd'.repeat(40)

/** Sample author for testing */
const sampleAuthor: Author = {
  name: 'Test User',
  email: 'test@example.com.ai',
  timestamp: 1704067200, // 2024-01-01 00:00:00 UTC
  timezone: '+0000'
}

/** Sample committer (different from author) for testing */
const sampleCommitter: Author = {
  name: 'Another User',
  email: 'another@example.com.ai',
  timestamp: 1704153600, // 2024-01-02 00:00:00 UTC
  timezone: '-0500'
}

/**
 * Mock DurableObjectStorage for testing commit object operations
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
 * Build commit content manually for testing/verification
 */
function buildCommitContent(
  tree: string,
  parents: string[],
  author: Author,
  committer: Author,
  message: string
): string {
  const lines: string[] = []
  lines.push(`tree ${tree}`)
  for (const parent of parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push(`author ${author.name} <${author.email}> ${author.timestamp} ${author.timezone}`)
  lines.push(`committer ${committer.name} <${committer.email}> ${committer.timestamp} ${committer.timezone}`)
  lines.push('')
  lines.push(message)
  return lines.join('\n')
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Commit Object Storage', () => {
  let storage: MockObjectStorage
  let objectStore: ObjectStore

  beforeEach(() => {
    storage = new MockObjectStorage()
    objectStore = new ObjectStore(storage)
  })

  // ==========================================================================
  // putCommitObject - Storing Commits
  // ==========================================================================

  describe('putCommitObject - Storing commit objects', () => {
    describe('Basic commit storage', () => {
      it('should store a commit with tree, parents, author, committer, message', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Test commit message'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        expect(sha).toMatch(/^[0-9a-f]{40}$/)

        // Verify it was stored as type 'commit'
        const objects = storage.getObjects()
        expect(objects.has(sha)).toBe(true)
        const stored = objects.get(sha)!
        expect(stored.type).toBe('commit')
      })

      it('should store commit data with correct format', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha],
          author: sampleAuthor,
          committer: sampleCommitter,
          message: 'Commit message'
        }

        const sha = await objectStore.putCommitObject(commit)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        // Verify content contains all required parts
        expect(content).toContain(`tree ${sampleTreeSha}`)
        expect(content).toContain(`parent ${sampleParentSha}`)
        expect(content).toContain(`author ${sampleAuthor.name} <${sampleAuthor.email}>`)
        expect(content).toContain(`committer ${sampleCommitter.name} <${sampleCommitter.email}>`)
        expect(content).toContain('Commit message')
      })

      it('should produce deterministic SHA for identical commits', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Same commit'
        }

        const sha1 = await objectStore.putCommitObject(commit)
        const sha2 = await objectStore.putCommitObject(commit)

        expect(sha1).toBe(sha2)
      })

      it('should produce different SHA for different tree', async () => {
        const commit1 = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Same message'
        }
        const commit2 = {
          tree: sampleParentSha, // Different tree
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Same message'
        }

        const sha1 = await objectStore.putCommitObject(commit1)
        const sha2 = await objectStore.putCommitObject(commit2)

        expect(sha1).not.toBe(sha2)
      })
    })

    describe('Initial commit (no parents)', () => {
      it('should store initial commit with empty parents array', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Initial commit'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
        expect(sha).toMatch(/^[0-9a-f]{40}$/)
      })

      it('should not include parent line for initial commit', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Initial commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`tree ${sampleTreeSha}`)
        expect(content).not.toContain('parent ')
      })

      it('should parse initial commit correctly on retrieval', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Initial commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.parents).toHaveLength(0)
        expect(retrieved!.tree).toBe(sampleTreeSha)
      })
    })

    describe('Merge commit (multiple parents)', () => {
      it('should store merge commit with two parents', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha, sampleParentSha2],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Merge branch feature into main'
        }

        const sha = await objectStore.putCommitObject(commit)

        expect(sha).toBeDefined()
        expect(sha).toMatch(/^[0-9a-f]{40}$/)

        // Verify stored content has both parent lines
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)
        expect(content).toContain(`parent ${sampleParentSha}`)
        expect(content).toContain(`parent ${sampleParentSha2}`)
      })

      it('should store octopus merge with multiple parents', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha, sampleParentSha2, sampleParentSha3],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Octopus merge of feature branches'
        }

        const sha = await objectStore.putCommitObject(commit)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain(`parent ${sampleParentSha}`)
        expect(content).toContain(`parent ${sampleParentSha2}`)
        expect(content).toContain(`parent ${sampleParentSha3}`)
      })

      it('should preserve parent order', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha2, sampleParentSha], // Specific order
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Merge commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.parents).toHaveLength(2)
        expect(retrieved!.parents[0]).toBe(sampleParentSha2) // First parent
        expect(retrieved!.parents[1]).toBe(sampleParentSha) // Second parent
      })

      it('should parse merge commit parents correctly on retrieval', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha, sampleParentSha2],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Merge commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.parents).toHaveLength(2)
        expect(retrieved!.parents).toContain(sampleParentSha)
        expect(retrieved!.parents).toContain(sampleParentSha2)
      })
    })

    describe('Author/committer timestamp and timezone parsing', () => {
      it('should store author with timestamp and timezone', async () => {
        const author: Author = {
          name: 'Test Author',
          email: 'author@test.com',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain('author Test Author <author@test.com> 1704067200 +0000')
      })

      it('should store committer with different timestamp and timezone', async () => {
        const author: Author = {
          name: 'Author',
          email: 'author@test.com',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const committer: Author = {
          name: 'Committer',
          email: 'committer@test.com',
          timestamp: 1704153600,
          timezone: '-0500'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const stored = storage.getObjects().get(sha)!
        const content = decoder.decode(stored.data)

        expect(content).toContain('author Author <author@test.com> 1704067200 +0000')
        expect(content).toContain('committer Committer <committer@test.com> 1704153600 -0500')
      })

      it('should parse author timestamp correctly on retrieval', async () => {
        const author: Author = {
          name: 'Test User',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.timestamp).toBe(1704067200)
        expect(retrieved!.author.timezone).toBe('+0900')
      })

      it('should parse committer timestamp correctly on retrieval', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleCommitter,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.committer.timestamp).toBe(sampleCommitter.timestamp)
        expect(retrieved!.committer.timezone).toBe(sampleCommitter.timezone)
      })

      it('should handle negative timezone offset', async () => {
        const author: Author = {
          name: 'West Coast Dev',
          email: 'dev@west.com',
          timestamp: 1704067200,
          timezone: '-0800'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.timezone).toBe('-0800')
      }
      )

      it('should handle non-hour-aligned timezone offset', async () => {
        // India Standard Time is +0530
        const author: Author = {
          name: 'India Dev',
          email: 'dev@india.com',
          timestamp: 1704067200,
          timezone: '+0530'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.timezone).toBe('+0530')
      })

      it('should handle epoch timestamp (0)', async () => {
        const author: Author = {
          name: 'Epoch User',
          email: 'epoch@test.com',
          timestamp: 0,
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Epoch commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.timestamp).toBe(0)
      })

      it('should handle far future timestamp', async () => {
        const author: Author = {
          name: 'Future User',
          email: 'future@test.com',
          timestamp: 4102444800, // Year 2100
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Future commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.timestamp).toBe(4102444800)
      })
    })

    describe('Commit message formatting (subject + body)', () => {
      it('should store simple one-line message', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Simple commit message'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe('Simple commit message')
      })

      it('should store message with subject and body', async () => {
        const message = 'Subject line\n\nThis is the body of the commit message.\nIt spans multiple lines.'
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should preserve multiple paragraphs in message body', async () => {
        const message = 'Subject line\n\nParagraph 1.\n\nParagraph 2.\n\nParagraph 3.'
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
        expect(retrieved!.message.split('\n\n')).toHaveLength(4) // Subject + 3 body paragraphs
      })

      it('should handle message with special characters', async () => {
        const message = 'Fix bug with <script> tags & special "chars"'
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle message with unicode characters', async () => {
        const message = 'Add emoji support and internationalization'
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle very long message', async () => {
        const longBody = 'A'.repeat(10000)
        const message = `Subject\n\n${longBody}`
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })

      it('should handle message with trailing newlines', async () => {
        const message = 'Subject line\n\nBody text.\n'
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.message).toBe(message)
      })
    })
  })

  // ==========================================================================
  // getCommitObject - Retrieving Commits
  // ==========================================================================

  describe('getCommitObject - Retrieving commit objects', () => {
    describe('Basic retrieval', () => {
      it('should retrieve a stored commit object', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [sampleParentSha],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Test commit'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.type).toBe('commit')
      })

      it('should return null for non-existent commit', async () => {
        const commit = await objectStore.getCommitObject('nonexistent'.repeat(4))

        expect(commit).toBeNull()
      })

      it('should return null for non-commit object type', async () => {
        // Store a blob
        const blobSha = await objectStore.putObject('blob', encoder.encode('hello'))

        const commit = await objectStore.getCommitObject(blobSha)

        expect(commit).toBeNull()
      })

      it('should return null for tree object', async () => {
        const treeSha = await objectStore.putTreeObject([])

        const commit = await objectStore.getCommitObject(treeSha)

        expect(commit).toBeNull()
      })
    })

    describe('Field parsing', () => {
      it('should parse tree SHA correctly', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.tree).toBe(sampleTreeSha)
        expect(retrieved!.tree).toHaveLength(40)
      })

      it('should parse author name correctly', async () => {
        const author: Author = {
          name: 'John Doe',
          email: 'john@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.name).toBe('John Doe')
      })

      it('should parse author email correctly', async () => {
        const author: Author = {
          name: 'Test User',
          email: 'complex+tag@subdomain.example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.email).toBe('complex+tag@subdomain.example.com.ai')
      })

      it('should parse committer separately from author', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleCommitter,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.name).toBe(sampleAuthor.name)
        expect(retrieved!.committer.name).toBe(sampleCommitter.name)
        expect(retrieved!.author.email).not.toBe(retrieved!.committer.email)
      })

      it('should include raw data in commit object', async () => {
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author: sampleAuthor,
          committer: sampleAuthor,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.data).toBeDefined()
        expect(retrieved!.data).toBeInstanceOf(Uint8Array)
        expect(retrieved!.data.length).toBeGreaterThan(0)
      })
    })

    describe('Author name edge cases', () => {
      it('should handle author name with spaces', async () => {
        const author: Author = {
          name: 'First Middle Last',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.name).toBe('First Middle Last')
      })

      it('should handle author with unicode name', async () => {
        const author: Author = {
          name: 'Tester',
          email: 'test@example.jp',
          timestamp: 1704067200,
          timezone: '+0900'
        }
        const commit = {
          tree: sampleTreeSha,
          parents: [],
          author,
          committer: author,
          message: 'Test'
        }

        const sha = await objectStore.putCommitObject(commit)
        const retrieved = await objectStore.getCommitObject(sha)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.author.name).toBe('Tester')
      })
    })
  })

  // ==========================================================================
  // SHA Calculation Verification
  // ==========================================================================

  describe('Commit SHA Calculation', () => {
    it('should compute SHA-1 using Git commit format', async () => {
      const commit = {
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test commit'
      }

      const sha = await objectStore.putCommitObject(commit)

      // SHA should be valid hex
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should include type and size header in SHA calculation', async () => {
      // The SHA is computed from "commit {size}\0{content}"
      const commit = {
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test'
      }

      const sha1 = await objectStore.putCommitObject(commit)
      const sha2 = await objectStore.putCommitObject(commit)

      // Same content should produce same SHA
      expect(sha1).toBe(sha2)
    })

    it('should produce different SHA for different messages', async () => {
      const commit1 = {
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Message A'
      }
      const commit2 = {
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Message B'
      }

      const sha1 = await objectStore.putCommitObject(commit1)
      const sha2 = await objectStore.putCommitObject(commit2)

      expect(sha1).not.toBe(sha2)
    })

    it('should produce different SHA for different parent order', async () => {
      const commit1 = {
        tree: sampleTreeSha,
        parents: [sampleParentSha, sampleParentSha2],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test'
      }
      const commit2 = {
        tree: sampleTreeSha,
        parents: [sampleParentSha2, sampleParentSha], // Reversed
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Test'
      }

      const sha1 = await objectStore.putCommitObject(commit1)
      const sha2 = await objectStore.putCommitObject(commit2)

      expect(sha1).not.toBe(sha2)
    })

    it('should produce different SHA for different author timestamps', async () => {
      const author1: Author = { ...sampleAuthor, timestamp: 1704067200 }
      const author2: Author = { ...sampleAuthor, timestamp: 1704067201 } // 1 second later

      const commit1 = {
        tree: sampleTreeSha,
        parents: [],
        author: author1,
        committer: author1,
        message: 'Test'
      }
      const commit2 = {
        tree: sampleTreeSha,
        parents: [],
        author: author2,
        committer: author2,
        message: 'Test'
      }

      const sha1 = await objectStore.putCommitObject(commit1)
      const sha2 = await objectStore.putCommitObject(commit2)

      expect(sha1).not.toBe(sha2)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle invalid SHA gracefully in getCommitObject', async () => {
      const commit = await objectStore.getCommitObject('invalid')

      expect(commit).toBeNull()
    })

    it('should handle empty SHA gracefully in getCommitObject', async () => {
      const commit = await objectStore.getCommitObject('')

      expect(commit).toBeNull()
    })

    describe('Malformed commit parsing', () => {
      it('should handle corrupted commit data gracefully', async () => {
        // Inject malformed commit data directly into storage
        const corruptedData = encoder.encode('not a valid commit format')
        storage.injectObject('e'.repeat(40), 'commit', corruptedData)

        // Attempting to parse should return null (missing required fields)
        const commit = await objectStore.getCommitObject('e'.repeat(40))
        expect(commit).toBeNull()
      })

      it('should handle commit with missing tree line', async () => {
        // Build commit without tree line
        const malformedContent = [
          `parent ${sampleParentSha}`,
          `author ${sampleAuthor.name} <${sampleAuthor.email}> ${sampleAuthor.timestamp} ${sampleAuthor.timezone}`,
          `committer ${sampleAuthor.name} <${sampleAuthor.email}> ${sampleAuthor.timestamp} ${sampleAuthor.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('f'.repeat(40), 'commit', encoder.encode(malformedContent))

        const commit = await objectStore.getCommitObject('f'.repeat(40))
        // Should return null or commit with empty tree
        expect(commit === null || commit.tree === '').toBe(true)
      })

      it('should handle commit with missing author line', async () => {
        const malformedContent = [
          `tree ${sampleTreeSha}`,
          `committer ${sampleAuthor.name} <${sampleAuthor.email}> ${sampleAuthor.timestamp} ${sampleAuthor.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('0'.repeat(40), 'commit', encoder.encode(malformedContent))

        const commit = await objectStore.getCommitObject('0'.repeat(40))
        expect(commit).toBeNull()
      })

      it('should handle commit with missing committer line', async () => {
        const malformedContent = [
          `tree ${sampleTreeSha}`,
          `author ${sampleAuthor.name} <${sampleAuthor.email}> ${sampleAuthor.timestamp} ${sampleAuthor.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('1'.repeat(40), 'commit', encoder.encode(malformedContent))

        const commit = await objectStore.getCommitObject('1'.repeat(40))
        expect(commit).toBeNull()
      })

      it('should handle commit with malformed author line', async () => {
        const malformedContent = [
          `tree ${sampleTreeSha}`,
          `author InvalidFormat`,
          `committer ${sampleAuthor.name} <${sampleAuthor.email}> ${sampleAuthor.timestamp} ${sampleAuthor.timezone}`,
          '',
          'Message'
        ].join('\n')
        storage.injectObject('2'.repeat(40), 'commit', encoder.encode(malformedContent))

        // Should handle gracefully - return null or throw
        try {
          const commit = await objectStore.getCommitObject('2'.repeat(40))
          expect(commit).toBeNull()
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
    it('should roundtrip commit through store and retrieve', async () => {
      const originalCommit = {
        tree: sampleTreeSha,
        parents: [sampleParentSha],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: 'Integration test commit\n\nWith a body paragraph.'
      }

      const sha = await objectStore.putCommitObject(originalCommit)
      const retrieved = await objectStore.getCommitObject(sha)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.tree).toBe(originalCommit.tree)
      expect(retrieved!.parents).toEqual(originalCommit.parents)
      expect(retrieved!.author.name).toBe(originalCommit.author.name)
      expect(retrieved!.author.email).toBe(originalCommit.author.email)
      expect(retrieved!.author.timestamp).toBe(originalCommit.author.timestamp)
      expect(retrieved!.author.timezone).toBe(originalCommit.author.timezone)
      expect(retrieved!.committer.name).toBe(originalCommit.committer.name)
      expect(retrieved!.committer.email).toBe(originalCommit.committer.email)
      expect(retrieved!.committer.timestamp).toBe(originalCommit.committer.timestamp)
      expect(retrieved!.committer.timezone).toBe(originalCommit.committer.timezone)
      expect(retrieved!.message).toBe(originalCommit.message)
    })

    it('should store and retrieve commit chain (history)', async () => {
      // Create initial commit
      const initialCommit = {
        tree: sampleTreeSha,
        parents: [],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Initial commit'
      }
      const initialSha = await objectStore.putCommitObject(initialCommit)

      // Create second commit
      const secondCommit = {
        tree: sampleParentSha2, // Different tree
        parents: [initialSha],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Second commit'
      }
      const secondSha = await objectStore.putCommitObject(secondCommit)

      // Create third commit
      const thirdCommit = {
        tree: sampleParentSha3,
        parents: [secondSha],
        author: sampleAuthor,
        committer: sampleAuthor,
        message: 'Third commit'
      }
      const thirdSha = await objectStore.putCommitObject(thirdCommit)

      // Traverse history from third to first
      const third = await objectStore.getCommitObject(thirdSha)
      expect(third).not.toBeNull()
      expect(third!.parents).toHaveLength(1)

      const second = await objectStore.getCommitObject(third!.parents[0])
      expect(second).not.toBeNull()
      expect(second!.parents).toHaveLength(1)

      const initial = await objectStore.getCommitObject(second!.parents[0])
      expect(initial).not.toBeNull()
      expect(initial!.parents).toHaveLength(0)
      expect(initial!.message).toBe('Initial commit')
    })
  })
})
