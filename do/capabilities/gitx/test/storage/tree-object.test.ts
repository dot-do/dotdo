/**
 * @fileoverview RED Phase Tests for Git Tree Object Storage
 *
 * These tests define the expected behavior for tree object storage operations.
 * They should fail initially (RED phase) until the implementation is complete.
 *
 * Tree objects in Git represent directories and contain entries for files and subdirectories.
 * Each entry has:
 * - mode: Unix file mode (100644, 100755, 040000, 120000, 160000)
 * - name: File or directory name
 * - sha: 40-character hex SHA-1 reference to blob or tree
 *
 * Tree format: "{mode} {name}\0{20-byte-sha}" for each entry
 *
 * @module test/storage/tree-object
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectStore,
  StoredObject
} from '../../src/durable-object/object-store'
import { DurableObjectStorage } from '../../src/durable-object/schema'
import {
  TreeEntry,
  TreeObject
} from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Sample valid 40-character SHA-1 hashes for testing */
const sampleBlobSha = 'a'.repeat(40)
const sampleBlobSha2 = 'b'.repeat(40)
const sampleBlobSha3 = 'c'.repeat(40)
const sampleTreeSha = 'd'.repeat(40)

/**
 * Mock DurableObjectStorage for testing tree object operations
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

        this.objects.set(sha, { sha, type: type as 'tree', size, data, createdAt })
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
  injectObject(sha: string, type: 'blob' | 'tree' | 'commit' | 'tag', data: Uint8Array): void {
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
 * Convert hex string to bytes (20 bytes for SHA)
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build tree content manually for testing
 */
function buildTreeContent(entries: TreeEntry[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const sha20 = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeName.length + 20)
    entryData.set(modeName)
    entryData.set(sha20, modeName.length)
    parts.push(entryData)
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Tree Object Storage', () => {
  let storage: MockObjectStorage
  let objectStore: ObjectStore

  beforeEach(() => {
    storage = new MockObjectStorage()
    objectStore = new ObjectStore(storage)
  })

  describe('putTreeObject - Storing tree objects', () => {
    describe('Basic tree storage', () => {
      it('should store an empty tree and return known SHA', async () => {
        // Empty tree has a well-known SHA in Git
        const entries: TreeEntry[] = []

        const sha = await objectStore.putTreeObject(entries)

        // Empty tree SHA is: 4b825dc642cb6eb9a060e54bf8d69288fbee4904
        expect(sha).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
      })

      it('should store a tree with a single file entry', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)

        expect(sha).toBeDefined()
        expect(sha).toHaveLength(40)
        expect(sha).toMatch(/^[0-9a-f]{40}$/)
      })

      it('should store tree data correctly in object store', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'README.md', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)

        const objects = storage.getObjects()
        expect(objects.has(sha)).toBe(true)
        const stored = objects.get(sha)!
        expect(stored.type).toBe('tree')
        expect(stored.size).toBeGreaterThan(0)
      })

      it('should store tree with multiple entries', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'a.txt', sha: sampleBlobSha },
          { mode: '100644', name: 'b.txt', sha: sampleBlobSha2 },
          { mode: '100644', name: 'c.txt', sha: sampleBlobSha3 }
        ]

        const sha = await objectStore.putTreeObject(entries)

        expect(sha).toBeDefined()
        const stored = storage.getObjects().get(sha)!
        expect(stored.type).toBe('tree')
      })
    })

    describe('Tree entry modes', () => {
      it('should handle regular file mode (100644)', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].mode).toBe('100644')
      })

      it('should handle executable file mode (100755)', async () => {
        const entries: TreeEntry[] = [
          { mode: '100755', name: 'script.sh', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].mode).toBe('100755')
      })

      it('should handle directory mode (040000)', async () => {
        const entries: TreeEntry[] = [
          { mode: '040000', name: 'subdir', sha: sampleTreeSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].mode).toBe('040000')
      })

      it('should handle symlink mode (120000)', async () => {
        const entries: TreeEntry[] = [
          { mode: '120000', name: 'link', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].mode).toBe('120000')
      })

      it('should handle submodule mode (160000)', async () => {
        const entries: TreeEntry[] = [
          { mode: '160000', name: 'submodule', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].mode).toBe('160000')
      })

      it('should handle mixed modes in same tree', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha },
          { mode: '100755', name: 'script.sh', sha: sampleBlobSha2 },
          { mode: '040000', name: 'subdir', sha: sampleTreeSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries).toHaveLength(3)
        const modes = tree!.entries.map(e => e.mode)
        expect(modes).toContain('100644')
        expect(modes).toContain('100755')
        expect(modes).toContain('040000')
      })
    })

    describe('Tree entry sorting', () => {
      it('should sort entries alphabetically', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'zebra.txt', sha: sampleBlobSha },
          { mode: '100644', name: 'apple.txt', sha: sampleBlobSha2 },
          { mode: '100644', name: 'banana.txt', sha: sampleBlobSha3 }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].name).toBe('apple.txt')
        expect(tree!.entries[1].name).toBe('banana.txt')
        expect(tree!.entries[2].name).toBe('zebra.txt')
      })

      it('should sort directories as if they have trailing slash', async () => {
        // Git sorts "a/" before "aa" and "ab"
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'ab', sha: sampleBlobSha },
          { mode: '040000', name: 'a', sha: sampleTreeSha },
          { mode: '100644', name: 'aa', sha: sampleBlobSha2 }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        // Git sorts: 'a/' (directory), 'aa', 'ab'
        expect(tree!.entries[0].name).toBe('a')
        expect(tree!.entries[0].mode).toBe('040000')
        expect(tree!.entries[1].name).toBe('aa')
        expect(tree!.entries[2].name).toBe('ab')
      })

      it('should sort case-sensitively (ASCII order)', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'B.txt', sha: sampleBlobSha },
          { mode: '100644', name: 'a.txt', sha: sampleBlobSha2 },
          { mode: '100644', name: 'A.txt', sha: sampleBlobSha3 }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        // ASCII order: A < B < a
        expect(tree!.entries[0].name).toBe('A.txt')
        expect(tree!.entries[1].name).toBe('B.txt')
        expect(tree!.entries[2].name).toBe('a.txt')
      })

      it('should produce consistent SHA regardless of input order', async () => {
        const entries1: TreeEntry[] = [
          { mode: '100644', name: 'c.txt', sha: sampleBlobSha3 },
          { mode: '100644', name: 'a.txt', sha: sampleBlobSha },
          { mode: '100644', name: 'b.txt', sha: sampleBlobSha2 }
        ]

        const entries2: TreeEntry[] = [
          { mode: '100644', name: 'b.txt', sha: sampleBlobSha2 },
          { mode: '100644', name: 'c.txt', sha: sampleBlobSha3 },
          { mode: '100644', name: 'a.txt', sha: sampleBlobSha }
        ]

        const sha1 = await objectStore.putTreeObject(entries1)
        const sha2 = await objectStore.putTreeObject(entries2)

        // Same content, different order, should produce same SHA
        expect(sha1).toBe(sha2)
      })
    })

    describe('SHA calculation', () => {
      it('should compute SHA-1 with 20-byte binary SHA in entries', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'test.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)

        // SHA should be valid hex
        expect(sha).toMatch(/^[0-9a-f]{40}$/)

        // The stored data should contain 20-byte binary SHA, not 40-char hex
        const stored = storage.getObjects().get(sha)!
        // Find the null byte after "100644 test.txt"
        const nullIndex = stored.data.indexOf(0)
        // After null should be exactly 20 bytes (binary SHA)
        const remainingLength = stored.data.length - nullIndex - 1
        expect(remainingLength).toBe(20)
      })

      it('should produce deterministic SHA for identical content', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha1 = await objectStore.putTreeObject(entries)
        const sha2 = await objectStore.putTreeObject(entries)

        expect(sha1).toBe(sha2)
      })

      it('should produce different SHA for different content', async () => {
        const entries1: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const entries2: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha2 }
        ]

        const sha1 = await objectStore.putTreeObject(entries1)
        const sha2 = await objectStore.putTreeObject(entries2)

        expect(sha1).not.toBe(sha2)
      })

      it('should produce different SHA for different modes', async () => {
        const entries1: TreeEntry[] = [
          { mode: '100644', name: 'script.sh', sha: sampleBlobSha }
        ]

        const entries2: TreeEntry[] = [
          { mode: '100755', name: 'script.sh', sha: sampleBlobSha }
        ]

        const sha1 = await objectStore.putTreeObject(entries1)
        const sha2 = await objectStore.putTreeObject(entries2)

        expect(sha1).not.toBe(sha2)
      })
    })
  })

  describe('getTreeObject - Retrieving tree objects', () => {
    describe('Basic retrieval', () => {
      it('should retrieve a stored tree object', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.type).toBe('tree')
      })

      it('should return null for non-existent tree', async () => {
        const tree = await objectStore.getTreeObject('nonexistent'.repeat(4))

        expect(tree).toBeNull()
      })

      it('should return null for non-tree object type', async () => {
        // Store a blob
        const blobSha = await objectStore.putObject('blob', encoder.encode('hello'))

        const tree = await objectStore.getTreeObject(blobSha)

        expect(tree).toBeNull()
      })
    })

    describe('Entry parsing', () => {
      it('should parse tree entries correctly', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries).toHaveLength(1)
        expect(tree!.entries[0].mode).toBe('100644')
        expect(tree!.entries[0].name).toBe('file.txt')
        expect(tree!.entries[0].sha).toBe(sampleBlobSha)
      })

      it('should parse multiple entries', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'a.txt', sha: sampleBlobSha },
          { mode: '100755', name: 'b.sh', sha: sampleBlobSha2 },
          { mode: '040000', name: 'c', sha: sampleTreeSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries).toHaveLength(3)
      })

      it('should preserve SHA references as 40-char hex strings', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].sha).toHaveLength(40)
        expect(tree!.entries[0].sha).toBe(sampleBlobSha)
      })

      it('should handle empty tree entries array', async () => {
        const entries: TreeEntry[] = []

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries).toHaveLength(0)
      })
    })

    describe('File name handling', () => {
      it('should handle spaces in file names', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'my file.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].name).toBe('my file.txt')
      })

      it('should handle unicode in file names', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'cafe.txt', sha: sampleBlobSha }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        expect(tree!.entries[0].name).toBe('cafe.txt')
      })

      it('should handle dots in file names', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: '.gitignore', sha: sampleBlobSha },
          { mode: '100644', name: '..gitkeep', sha: sampleBlobSha2 }
        ]

        const sha = await objectStore.putTreeObject(entries)
        const tree = await objectStore.getTreeObject(sha)

        expect(tree).not.toBeNull()
        const names = tree!.entries.map(e => e.name)
        expect(names).toContain('.gitignore')
        expect(names).toContain('..gitkeep')
      })
    })
  })

  describe('Nested Trees - Subdirectories', () => {
    describe('Creating nested structure', () => {
      it('should store nested trees (directory with subdirectory)', async () => {
        // Create inner tree (subdirectory)
        const innerEntries: TreeEntry[] = [
          { mode: '100644', name: 'inner.txt', sha: sampleBlobSha }
        ]
        const innerTreeSha = await objectStore.putTreeObject(innerEntries)

        // Create outer tree (parent directory)
        const outerEntries: TreeEntry[] = [
          { mode: '040000', name: 'subdir', sha: innerTreeSha }
        ]
        const outerTreeSha = await objectStore.putTreeObject(outerEntries)

        // Verify outer tree
        const outerTree = await objectStore.getTreeObject(outerTreeSha)
        expect(outerTree).not.toBeNull()
        expect(outerTree!.entries).toHaveLength(1)
        expect(outerTree!.entries[0].mode).toBe('040000')
        expect(outerTree!.entries[0].name).toBe('subdir')
        expect(outerTree!.entries[0].sha).toBe(innerTreeSha)
      })

      it('should store deeply nested trees', async () => {
        // Create deepest level
        const level3Entries: TreeEntry[] = [
          { mode: '100644', name: 'deep.txt', sha: sampleBlobSha }
        ]
        const level3Sha = await objectStore.putTreeObject(level3Entries)

        // Create middle level
        const level2Entries: TreeEntry[] = [
          { mode: '040000', name: 'level3', sha: level3Sha }
        ]
        const level2Sha = await objectStore.putTreeObject(level2Entries)

        // Create top level
        const level1Entries: TreeEntry[] = [
          { mode: '040000', name: 'level2', sha: level2Sha }
        ]
        const level1Sha = await objectStore.putTreeObject(level1Entries)

        // Verify each level exists and is correct
        const level1Tree = await objectStore.getTreeObject(level1Sha)
        expect(level1Tree).not.toBeNull()
        expect(level1Tree!.entries[0].name).toBe('level2')

        const level2Tree = await objectStore.getTreeObject(level2Sha)
        expect(level2Tree).not.toBeNull()
        expect(level2Tree!.entries[0].name).toBe('level3')

        const level3Tree = await objectStore.getTreeObject(level3Sha)
        expect(level3Tree).not.toBeNull()
        expect(level3Tree!.entries[0].name).toBe('deep.txt')
      })

      it('should store tree with mixed files and subdirectories', async () => {
        // Create subdirectory tree
        const subdirEntries: TreeEntry[] = [
          { mode: '100644', name: 'sub.txt', sha: sampleBlobSha2 }
        ]
        const subdirSha = await objectStore.putTreeObject(subdirEntries)

        // Create root tree with file and subdirectory
        const rootEntries: TreeEntry[] = [
          { mode: '100644', name: 'root.txt', sha: sampleBlobSha },
          { mode: '040000', name: 'subdir', sha: subdirSha }
        ]
        const rootSha = await objectStore.putTreeObject(rootEntries)

        const rootTree = await objectStore.getTreeObject(rootSha)
        expect(rootTree).not.toBeNull()
        expect(rootTree!.entries).toHaveLength(2)

        // Find file and directory
        const fileEntry = rootTree!.entries.find(e => e.name === 'root.txt')
        const dirEntry = rootTree!.entries.find(e => e.name === 'subdir')

        expect(fileEntry).toBeDefined()
        expect(fileEntry!.mode).toBe('100644')

        expect(dirEntry).toBeDefined()
        expect(dirEntry!.mode).toBe('040000')
      })
    })

    describe('Traversing nested structures', () => {
      it('should be able to traverse from root to leaf', async () => {
        // Build a tree: root -> src -> index.ts
        const fileEntries: TreeEntry[] = [
          { mode: '100644', name: 'index.ts', sha: sampleBlobSha }
        ]
        const srcTreeSha = await objectStore.putTreeObject(fileEntries)

        const rootEntries: TreeEntry[] = [
          { mode: '040000', name: 'src', sha: srcTreeSha }
        ]
        const rootTreeSha = await objectStore.putTreeObject(rootEntries)

        // Traverse from root
        const rootTree = await objectStore.getTreeObject(rootTreeSha)
        expect(rootTree).not.toBeNull()

        const srcEntry = rootTree!.entries.find(e => e.name === 'src')
        expect(srcEntry).toBeDefined()

        // Navigate to src
        const srcTree = await objectStore.getTreeObject(srcEntry!.sha)
        expect(srcTree).not.toBeNull()

        const indexEntry = srcTree!.entries.find(e => e.name === 'index.ts')
        expect(indexEntry).toBeDefined()
        expect(indexEntry!.sha).toBe(sampleBlobSha)
      })
    })
  })

  describe('Tree SHA Calculation Verification', () => {
    it('should match Git SHA for known tree content', async () => {
      // This test verifies our SHA calculation matches actual Git
      // Empty tree has a well-known SHA
      const emptyTreeSha = await objectStore.putTreeObject([])
      expect(emptyTreeSha).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    })

    it('should include type and size header in SHA calculation', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'test', sha: sampleBlobSha }
      ]

      const sha = await objectStore.putTreeObject(entries)

      // SHA is computed from "tree {size}\0{content}"
      // This should produce a valid SHA
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should use 20-byte binary SHA in serialized format', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
      ]

      const sha = await objectStore.putTreeObject(entries)
      const stored = storage.getObjects().get(sha)!

      // Verify the format: "100644 file.txt\0" followed by 20 bytes
      const modeNameNull = encoder.encode('100644 file.txt\0')
      expect(stored.data.length).toBe(modeNameNull.length + 20)

      // Verify the 20-byte SHA starts at the right position
      const sha20Bytes = stored.data.slice(modeNameNull.length)
      expect(sha20Bytes.length).toBe(20)

      // Convert back to hex and verify
      const recoveredSha = bytesToHex(sha20Bytes)
      expect(recoveredSha).toBe(sampleBlobSha)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid SHA gracefully in getTreeObject', async () => {
      const tree = await objectStore.getTreeObject('invalid')
      expect(tree).toBeNull()
    })

    it('should handle empty SHA gracefully in getTreeObject', async () => {
      const tree = await objectStore.getTreeObject('')
      expect(tree).toBeNull()
    })

    describe('Invalid entry handling', () => {
      it('should reject tree entry with invalid mode', async () => {
        const entries: TreeEntry[] = [
          { mode: '999999', name: 'file.txt', sha: sampleBlobSha }
        ]

        // Should throw or reject when storing with invalid mode
        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with empty mode', async () => {
        const entries: TreeEntry[] = [
          { mode: '', name: 'file.txt', sha: sampleBlobSha }
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with null byte in name', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file\0.txt', sha: sampleBlobSha }
        ]

        // Null bytes in filenames are invalid - they are used as delimiters
        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with empty name', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: '', sha: sampleBlobSha }
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with path separator in name', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'path/to/file.txt', sha: sampleBlobSha }
        ]

        // Tree entries should only contain single directory component names
        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with invalid SHA format', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: 'not-a-valid-sha' }
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with SHA of wrong length', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: 'abc123' }  // Too short
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject tree entry with uppercase SHA', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: 'A'.repeat(40) }  // Should be lowercase
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject duplicate entry names in tree', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha },
          { mode: '100644', name: 'file.txt', sha: sampleBlobSha2 }  // Duplicate name
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject . as entry name', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: '.', sha: sampleBlobSha }
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })

      it('should reject .. as entry name', async () => {
        const entries: TreeEntry[] = [
          { mode: '100644', name: '..', sha: sampleBlobSha }
        ]

        await expect(objectStore.putTreeObject(entries)).rejects.toThrow()
      })
    })

    describe('Malformed tree parsing', () => {
      it('should handle corrupted tree data gracefully', async () => {
        // Inject malformed tree data directly into storage
        const corruptedData = encoder.encode('not a valid tree format')
        storage.injectObject('e'.repeat(40), 'tree', corruptedData)

        // Attempting to parse should throw or return null
        const tree = await objectStore.getTreeObject('e'.repeat(40))
        // Either returns null or throws - implementation dependent
        expect(tree === null || tree.entries.length === 0).toBe(true)
      })

      it('should handle tree with truncated SHA bytes', async () => {
        // Build tree with truncated SHA (less than 20 bytes after null)
        const mode = '100644'
        const name = 'file.txt'
        const modeNameNull = encoder.encode(`${mode} ${name}\0`)
        // Only provide 10 bytes of SHA instead of 20
        const truncatedSha = new Uint8Array(10)
        const corruptedTree = new Uint8Array(modeNameNull.length + truncatedSha.length)
        corruptedTree.set(modeNameNull)
        corruptedTree.set(truncatedSha, modeNameNull.length)

        storage.injectObject('f'.repeat(40), 'tree', corruptedTree)

        // Parsing truncated data should be handled gracefully
        const tree = await objectStore.getTreeObject('f'.repeat(40))
        // Either returns null, throws, or returns malformed entry
        // The important thing is it doesn't crash
        expect(tree === null || tree.entries[0]?.sha.length !== 40).toBe(true)
      })

      it('should handle tree with missing null byte between entries', async () => {
        // Build malformed tree data without proper null separator
        const malformed = encoder.encode('100644 file.txt')
        // Missing null byte and SHA
        storage.injectObject('0'.repeat(40), 'tree', malformed)

        const tree = await objectStore.getTreeObject('0'.repeat(40))
        // Should handle gracefully
        expect(tree === null || tree.entries.length === 0).toBe(true)
      })
    })
  })
})
