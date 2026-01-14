import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DiffStatus,
  FileMode,
  DiffEntry,
  DiffOptions,
  DiffResult,
  ObjectStore,
  IndexEntry,
  diffTrees,
  detectRenames,
  detectCopies,
  diffTreeToIndex,
  diffTreeToWorktree,
  isBinaryContent,
  calculateSimilarity,
  filterByPathspecs,
  walkTree,
  parseMode,
  isModeChangeSignificant
} from '../../src/ops/tree-diff'
import { TreeEntry, TreeObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const sampleBlobSha = 'a'.repeat(40)
const sampleBlobSha2 = 'b'.repeat(40)
const sampleBlobSha3 = 'c'.repeat(40)
const sampleTreeSha = 'd'.repeat(40)
const sampleTreeSha2 = 'e'.repeat(40)

/**
 * Create a mock tree object for testing
 */
function createMockTree(entries: TreeEntry[]): TreeObject {
  return {
    type: 'tree',
    data: new Uint8Array(),
    entries
  }
}

/**
 * Create a mock object store for testing
 */
function createMockStore(
  trees: Map<string, TreeObject> = new Map(),
  blobs: Map<string, Uint8Array> = new Map()
): ObjectStore {
  return {
    async getTree(sha: string): Promise<TreeObject | null> {
      return trees.get(sha) ?? null
    },
    async getBlob(sha: string): Promise<Uint8Array | null> {
      return blobs.get(sha) ?? null
    },
    async exists(sha: string): Promise<boolean> {
      return trees.has(sha) || blobs.has(sha)
    }
  }
}

/**
 * Create a simple tree entry
 */
function createTreeEntry(
  name: string,
  sha: string = sampleBlobSha,
  mode: string = FileMode.REGULAR
): TreeEntry {
  return { mode, name, sha }
}

/**
 * Create an index entry for testing
 */
function createIndexEntry(
  path: string,
  sha: string = sampleBlobSha,
  mode: string = FileMode.REGULAR,
  stage: number = 0
): IndexEntry {
  return { path, sha, mode, stage }
}

/**
 * Create sample blob content
 */
function createBlobContent(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Tree Diff Algorithm', () => {
  let store: ObjectStore

  beforeEach(() => {
    store = createMockStore()
  })

  // ==========================================================================
  // Added Files Detection
  // ==========================================================================

  describe('Added files detection', () => {
    it('should detect a single added file', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('newfile.txt', sampleBlobSha)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
      expect(result.entries[0].path).toBe('newfile.txt')
      expect(result.entries[0].oldSha).toBeNull()
      expect(result.entries[0].newSha).toBe(sampleBlobSha)
      expect(result.stats.added).toBe(1)
    })

    it('should detect multiple added files', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha),
        createTreeEntry('file2.txt', sampleBlobSha2),
        createTreeEntry('file3.txt', sampleBlobSha3)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(3)
      expect(result.entries.every(e => e.status === DiffStatus.ADDED)).toBe(true)
      expect(result.stats.added).toBe(3)
    })

    it('should detect added files in subdirectories', async () => {
      const subTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('src', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e => e.path === 'src/nested.txt')).toBe(true)
      expect(result.entries.some(e => e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should detect added files when comparing against null (initial commit)', async () => {
      const newTree = createMockTree([
        createTreeEntry('README.md', sampleBlobSha),
        createTreeEntry('package.json', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, null, sampleTreeSha2)

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every(e => e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should preserve file mode for added files', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha, FileMode.EXECUTABLE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries[0].oldMode).toBeNull()
      expect(result.entries[0].newMode).toBe(FileMode.EXECUTABLE)
    })

    it('should detect added symlinks', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('link', sampleBlobSha, FileMode.SYMLINK)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
      expect(result.entries[0].newMode).toBe(FileMode.SYMLINK)
    })

    it('should detect added submodules', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('vendor/lib', sampleBlobSha, FileMode.GITLINK)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
      expect(result.entries[0].newMode).toBe(FileMode.GITLINK)
    })
  })

  // ==========================================================================
  // Deleted Files Detection
  // ==========================================================================

  describe('Deleted files detection', () => {
    it('should detect a single deleted file', async () => {
      const oldTree = createMockTree([
        createTreeEntry('oldfile.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.DELETED)
      expect(result.entries[0].path).toBe('oldfile.txt')
      expect(result.entries[0].oldSha).toBe(sampleBlobSha)
      expect(result.entries[0].newSha).toBeNull()
      expect(result.stats.deleted).toBe(1)
    })

    it('should detect multiple deleted files', async () => {
      const oldTree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha),
        createTreeEntry('file2.txt', sampleBlobSha2),
        createTreeEntry('file3.txt', sampleBlobSha3)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(3)
      expect(result.entries.every(e => e.status === DiffStatus.DELETED)).toBe(true)
      expect(result.stats.deleted).toBe(3)
    })

    it('should detect deleted files in subdirectories', async () => {
      const subTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([
        createTreeEntry('src', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e => e.path === 'src/nested.txt')).toBe(true)
      expect(result.entries.some(e => e.status === DiffStatus.DELETED)).toBe(true)
    })

    it('should detect all deleted files when new tree is null (reverse initial commit)', async () => {
      const oldTree = createMockTree([
        createTreeEntry('README.md', sampleBlobSha),
        createTreeEntry('package.json', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, null)

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every(e => e.status === DiffStatus.DELETED)).toBe(true)
    })

    it('should preserve file mode for deleted files', async () => {
      const oldTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha, FileMode.EXECUTABLE)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries[0].oldMode).toBe(FileMode.EXECUTABLE)
      expect(result.entries[0].newMode).toBeNull()
    })

    it('should handle deletion of entire directory tree', async () => {
      const deepTree = createMockTree([
        createTreeEntry('deep.txt', sampleBlobSha)
      ])
      const subTree = createMockTree([
        createTreeEntry('nested', 'deeptree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const oldTree = createMockTree([
        createTreeEntry('src', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree],
        ['deeptree'.padEnd(40, '0'), deepTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e => e.path === 'src/nested/deep.txt')).toBe(true)
    })
  })

  // ==========================================================================
  // Modified Files Detection
  // ==========================================================================

  describe('Modified files detection', () => {
    it('should detect a modified file (content change)', async () => {
      const oldTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha2) // Different SHA
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.MODIFIED)
      expect(result.entries[0].path).toBe('file.txt')
      expect(result.entries[0].oldSha).toBe(sampleBlobSha)
      expect(result.entries[0].newSha).toBe(sampleBlobSha2)
      expect(result.stats.modified).toBe(1)
    })

    it('should detect multiple modified files', async () => {
      const oldTree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha),
        createTreeEntry('file2.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha2),
        createTreeEntry('file2.txt', sampleBlobSha3)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every(e => e.status === DiffStatus.MODIFIED)).toBe(true)
      expect(result.stats.modified).toBe(2)
    })

    it('should detect mode-only changes (file to executable)', async () => {
      const oldTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha, FileMode.REGULAR)
      ])
      const newTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha, FileMode.EXECUTABLE) // Same SHA, different mode
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.MODIFIED)
      expect(result.entries[0].oldMode).toBe(FileMode.REGULAR)
      expect(result.entries[0].newMode).toBe(FileMode.EXECUTABLE)
    })

    it('should detect type change (file to symlink)', async () => {
      const oldTree = createMockTree([
        createTreeEntry('link', sampleBlobSha, FileMode.REGULAR)
      ])
      const newTree = createMockTree([
        createTreeEntry('link', sampleBlobSha2, FileMode.SYMLINK)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.TYPE_CHANGED)
    })

    it('should detect modified files in nested directories', async () => {
      const oldSubTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha)
      ])
      const newSubTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha2)
      ])
      const oldTree = createMockTree([
        createTreeEntry('src', 'oldsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([
        createTreeEntry('src', 'newsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['oldsubtree'.padEnd(40, '0'), oldSubTree],
        ['newsubtree'.padEnd(40, '0'), newSubTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e => e.path === 'src/nested.txt' && e.status === DiffStatus.MODIFIED)).toBe(true)
    })

    it('should not report unmodified files', async () => {
      const oldTree = createMockTree([
        createTreeEntry('unchanged.txt', sampleBlobSha),
        createTreeEntry('changed.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('unchanged.txt', sampleBlobSha), // Same
        createTreeEntry('changed.txt', sampleBlobSha2)   // Different
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('changed.txt')
    })

    it('should detect content and mode changes together', async () => {
      const oldTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha, FileMode.REGULAR)
      ])
      const newTree = createMockTree([
        createTreeEntry('script.sh', sampleBlobSha2, FileMode.EXECUTABLE) // Both changed
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.MODIFIED)
      expect(result.entries[0].oldSha).not.toBe(result.entries[0].newSha)
      expect(result.entries[0].oldMode).not.toBe(result.entries[0].newMode)
    })
  })

  // ==========================================================================
  // Renamed Files Detection
  // ==========================================================================

  describe('Renamed files detection', () => {
    it('should detect a simple rename (same content, different path)', async () => {
      const blobContent = createBlobContent('file content')
      const oldTree = createMockTree([
        createTreeEntry('old-name.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-name.txt', sampleBlobSha) // Same SHA
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, blobContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectRenames: true })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.RENAMED)
      expect(result.entries[0].oldPath).toBe('old-name.txt')
      expect(result.entries[0].path).toBe('new-name.txt')
      expect(result.entries[0].similarity).toBe(100)
      expect(result.stats.renamed).toBe(1)
    })

    it('should detect rename with modifications (similar content)', async () => {
      const oldContent = createBlobContent('original file content here')
      const newContent = createBlobContent('original file content here with changes')
      const oldTree = createMockTree([
        createTreeEntry('old-name.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-name.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, oldContent],
        [sampleBlobSha2, newContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        detectRenames: true,
        similarityThreshold: 50
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.RENAMED)
      expect(result.entries[0].similarity).toBeGreaterThanOrEqual(50)
      expect(result.entries[0].similarity).toBeLessThan(100)
    })

    it('should not detect rename when content is too different', async () => {
      const oldContent = createBlobContent('completely different content A')
      const newContent = createBlobContent('nothing similar at all B')
      const oldTree = createMockTree([
        createTreeEntry('old-name.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-name.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, oldContent],
        [sampleBlobSha2, newContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        detectRenames: true,
        similarityThreshold: 50
      })

      // Should be treated as delete + add, not rename
      expect(result.entries.some(e => e.status === DiffStatus.DELETED)).toBe(true)
      expect(result.entries.some(e => e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should detect rename across directories', async () => {
      const blobContent = createBlobContent('file content')
      const oldSubTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const newSubTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([
        createTreeEntry('old-dir', 'oldsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-dir', 'newsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['oldsubtree'.padEnd(40, '0'), oldSubTree],
        ['newsubtree'.padEnd(40, '0'), newSubTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, blobContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        recursive: true,
        detectRenames: true
      })

      expect(result.entries.some(e =>
        e.status === DiffStatus.RENAMED &&
        e.oldPath === 'old-dir/file.txt' &&
        e.path === 'new-dir/file.txt'
      )).toBe(true)
    })

    it('should not detect renames when disabled', async () => {
      const blobContent = createBlobContent('file content')
      const oldTree = createMockTree([
        createTreeEntry('old-name.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-name.txt', sampleBlobSha)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, blobContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectRenames: false })

      // Should be separate delete and add
      expect(result.entries).toHaveLength(2)
      expect(result.entries.some(e => e.status === DiffStatus.DELETED)).toBe(true)
      expect(result.entries.some(e => e.status === DiffStatus.ADDED)).toBe(true)
      expect(result.stats.renamed).toBe(0)
    })

    it('should respect similarity threshold option', async () => {
      const oldContent = createBlobContent('AAAAAAAAAA')
      const newContent = createBlobContent('AAAAAABBBB') // 60% similar
      const oldTree = createMockTree([
        createTreeEntry('old.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('new.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, oldContent],
        [sampleBlobSha2, newContent]
      ])
      store = createMockStore(trees, blobs)

      // With high threshold, should not detect rename
      const highThresholdResult = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        detectRenames: true,
        similarityThreshold: 90
      })
      expect(highThresholdResult.entries.some(e => e.status === DiffStatus.RENAMED)).toBe(false)

      // With low threshold, should detect rename
      const lowThresholdResult = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        detectRenames: true,
        similarityThreshold: 50
      })
      expect(lowThresholdResult.entries.some(e => e.status === DiffStatus.RENAMED)).toBe(true)
    })

    it('should handle multiple renames in same diff', async () => {
      const content1 = createBlobContent('content 1')
      const content2 = createBlobContent('content 2')
      const oldTree = createMockTree([
        createTreeEntry('old1.txt', sampleBlobSha),
        createTreeEntry('old2.txt', sampleBlobSha2)
      ])
      const newTree = createMockTree([
        createTreeEntry('new1.txt', sampleBlobSha),
        createTreeEntry('new2.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content1],
        [sampleBlobSha2, content2]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectRenames: true })

      expect(result.entries.filter(e => e.status === DiffStatus.RENAMED)).toHaveLength(2)
      expect(result.stats.renamed).toBe(2)
    })
  })

  // ==========================================================================
  // Directory Changes
  // ==========================================================================

  describe('Directory changes', () => {
    it('should detect added directory with files', async () => {
      const subTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('new-dir', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e => e.path === 'new-dir/file.txt' && e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should detect deleted directory with all its files', async () => {
      const subTree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha),
        createTreeEntry('file2.txt', sampleBlobSha2)
      ])
      const oldTree = createMockTree([
        createTreeEntry('old-dir', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.filter(e => e.status === DiffStatus.DELETED)).toHaveLength(2)
      expect(result.entries.some(e => e.path === 'old-dir/file1.txt')).toBe(true)
      expect(result.entries.some(e => e.path === 'old-dir/file2.txt')).toBe(true)
    })

    it('should detect file replaced by directory', async () => {
      const subTree = createMockTree([
        createTreeEntry('inside.txt', sampleBlobSha2)
      ])
      const oldTree = createMockTree([
        createTreeEntry('name', sampleBlobSha, FileMode.REGULAR)
      ])
      const newTree = createMockTree([
        createTreeEntry('name', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      // Old file should be deleted
      expect(result.entries.some(e => e.path === 'name' && e.status === DiffStatus.DELETED)).toBe(true)
      // New file inside directory should be added
      expect(result.entries.some(e => e.path === 'name/inside.txt' && e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should detect directory replaced by file', async () => {
      const subTree = createMockTree([
        createTreeEntry('inside.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([
        createTreeEntry('name', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([
        createTreeEntry('name', sampleBlobSha2, FileMode.REGULAR)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      // File inside old directory should be deleted
      expect(result.entries.some(e => e.path === 'name/inside.txt' && e.status === DiffStatus.DELETED)).toBe(true)
      // New file should be added
      expect(result.entries.some(e => e.path === 'name' && e.status === DiffStatus.ADDED)).toBe(true)
    })

    it('should handle deeply nested directory changes', async () => {
      const deepTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const midTree = createMockTree([
        createTreeEntry('deep', 'deeptree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const topTree = createMockTree([
        createTreeEntry('mid', 'midtree'.padEnd(40, '0'), FileMode.TREE)
      ])

      const newDeepTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha2) // Modified
      ])
      const newMidTree = createMockTree([
        createTreeEntry('deep', 'newdeeptree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTopTree = createMockTree([
        createTreeEntry('mid', 'newmidtree'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, topTree],
        [sampleTreeSha2, newTopTree],
        ['midtree'.padEnd(40, '0'), midTree],
        ['newmidtree'.padEnd(40, '0'), newMidTree],
        ['deeptree'.padEnd(40, '0'), deepTree],
        ['newdeeptree'.padEnd(40, '0'), newDeepTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: true })

      expect(result.entries.some(e =>
        e.path === 'mid/deep/file.txt' && e.status === DiffStatus.MODIFIED
      )).toBe(true)
    })

    it('should handle directory rename detection', async () => {
      const content = createBlobContent('file content')
      const subTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([
        createTreeEntry('old-dir', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([
        createTreeEntry('new-dir', 'subtree0'.padEnd(40, '0'), FileMode.TREE) // Same subtree SHA
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        recursive: true,
        detectRenames: true
      })

      // Should detect rename at file level
      expect(result.entries.some(e =>
        e.status === DiffStatus.RENAMED &&
        e.oldPath === 'old-dir/file.txt' &&
        e.path === 'new-dir/file.txt'
      )).toBe(true)
    })

    it('should not recurse into directories when recursive is false', async () => {
      const subTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha)
      ])
      const oldTree = createMockTree([
        createTreeEntry('src', 'oldsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])
      const newTree = createMockTree([
        createTreeEntry('src', 'newsubtree'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree],
        ['oldsubtree'.padEnd(40, '0'), subTree],
        ['newsubtree'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { recursive: false })

      // Should only show directory-level change
      expect(result.entries.some(e => e.path === 'src/nested.txt')).toBe(false)
    })
  })

  // ==========================================================================
  // Copy Detection
  // ==========================================================================

  describe('Copy detection', () => {
    it('should detect copied file', async () => {
      const content = createBlobContent('file content')
      const oldTree = createMockTree([
        createTreeEntry('original.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('original.txt', sampleBlobSha),
        createTreeEntry('copy.txt', sampleBlobSha) // Same content
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectCopies: true })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.COPIED)
      expect(result.entries[0].oldPath).toBe('original.txt')
      expect(result.entries[0].path).toBe('copy.txt')
      expect(result.stats.copied).toBe(1)
    })

    it('should not detect copies when disabled', async () => {
      const content = createBlobContent('file content')
      const oldTree = createMockTree([
        createTreeEntry('original.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('original.txt', sampleBlobSha),
        createTreeEntry('copy.txt', sampleBlobSha)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectCopies: false })

      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
    })
  })

  // ==========================================================================
  // Path Filtering
  // ==========================================================================

  describe('Path filtering', () => {
    it('should filter by pathspec (include)', async () => {
      const oldTree = createMockTree([
        createTreeEntry('src/file.ts', sampleBlobSha),
        createTreeEntry('test/file.ts', sampleBlobSha2)
      ])
      const newTree = createMockTree([
        createTreeEntry('src/file.ts', sampleBlobSha2),
        createTreeEntry('test/file.ts', sampleBlobSha3)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        pathspecs: ['src/*']
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('src/file.ts')
    })

    it('should filter by excludePaths', async () => {
      const oldTree = createMockTree([
        createTreeEntry('src/file.ts', sampleBlobSha),
        createTreeEntry('vendor/lib.ts', sampleBlobSha2)
      ])
      const newTree = createMockTree([
        createTreeEntry('src/file.ts', sampleBlobSha2),
        createTreeEntry('vendor/lib.ts', sampleBlobSha3)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, {
        excludePaths: ['vendor/*']
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('src/file.ts')
    })
  })

  // ==========================================================================
  // Binary File Detection
  // ==========================================================================

  describe('Binary file detection', () => {
    it('should detect binary files', async () => {
      // Create binary content (contains null bytes)
      const binaryContent = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00])
      const oldTree = createMockTree([
        createTreeEntry('image.png', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('image.png', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, binaryContent],
        [sampleBlobSha2, binaryContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectBinary: true })

      expect(result.entries[0].isBinary).toBe(true)
    })

    it('should mark text files as non-binary', async () => {
      const textContent = createBlobContent('Hello, world!')
      const oldTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, textContent],
        [sampleBlobSha2, textContent]
      ])
      store = createMockStore(trees, blobs)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2, { detectBinary: true })

      expect(result.entries[0].isBinary).toBe(false)
    })
  })

  // ==========================================================================
  // Helper Function Tests
  // ==========================================================================

  describe('isBinaryContent', () => {
    it('should return true for content with null bytes', () => {
      const binary = new Uint8Array([0x48, 0x65, 0x00, 0x6C, 0x6C, 0x6F])
      expect(isBinaryContent(binary)).toBe(true)
    })

    it('should return false for pure text content', () => {
      const text = new TextEncoder().encode('Hello, world!')
      expect(isBinaryContent(text)).toBe(false)
    })

    it('should return false for empty content', () => {
      const empty = new Uint8Array([])
      expect(isBinaryContent(empty)).toBe(false)
    })

    it('should only check first 8000 bytes', () => {
      // Null byte after 8000 should not make it binary
      const content = new Uint8Array(9000)
      content.fill(0x41) // Fill with 'A'
      content[8500] = 0x00 // Null byte after threshold
      expect(isBinaryContent(content)).toBe(false)
    })
  })

  describe('calculateSimilarity', () => {
    it('should return 100 for identical content', async () => {
      const content = createBlobContent('same content')
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content],
        [sampleBlobSha2, content]
      ])
      store = createMockStore(new Map(), blobs)

      const similarity = await calculateSimilarity(store, sampleBlobSha, sampleBlobSha2)
      expect(similarity).toBe(100)
    })

    it('should return 0 for completely different content', async () => {
      const content1 = createBlobContent('AAAAAAAAAA')
      const content2 = createBlobContent('BBBBBBBBBB')
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content1],
        [sampleBlobSha2, content2]
      ])
      store = createMockStore(new Map(), blobs)

      const similarity = await calculateSimilarity(store, sampleBlobSha, sampleBlobSha2)
      expect(similarity).toBe(0)
    })

    it('should return partial similarity for similar content', async () => {
      const content1 = createBlobContent('AAAAABBBBB')
      const content2 = createBlobContent('AAAAACCCCC')
      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content1],
        [sampleBlobSha2, content2]
      ])
      store = createMockStore(new Map(), blobs)

      const similarity = await calculateSimilarity(store, sampleBlobSha, sampleBlobSha2)
      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThan(100)
    })
  })

  describe('parseMode', () => {
    it('should identify regular file', () => {
      const mode = parseMode(FileMode.REGULAR)
      expect(mode.isFile).toBe(true)
      expect(mode.isDirectory).toBe(false)
      expect(mode.isExecutable).toBe(false)
    })

    it('should identify executable file', () => {
      const mode = parseMode(FileMode.EXECUTABLE)
      expect(mode.isFile).toBe(true)
      expect(mode.isExecutable).toBe(true)
    })

    it('should identify directory', () => {
      const mode = parseMode(FileMode.TREE)
      expect(mode.isDirectory).toBe(true)
      expect(mode.isFile).toBe(false)
    })

    it('should identify symlink', () => {
      const mode = parseMode(FileMode.SYMLINK)
      expect(mode.isSymlink).toBe(true)
    })

    it('should identify submodule', () => {
      const mode = parseMode(FileMode.GITLINK)
      expect(mode.isSubmodule).toBe(true)
    })
  })

  describe('isModeChangeSignificant', () => {
    it('should return true for file to symlink change', () => {
      expect(isModeChangeSignificant(FileMode.REGULAR, FileMode.SYMLINK)).toBe(true)
    })

    it('should return true for file to submodule change', () => {
      expect(isModeChangeSignificant(FileMode.REGULAR, FileMode.GITLINK)).toBe(true)
    })

    it('should return false for regular to executable change', () => {
      expect(isModeChangeSignificant(FileMode.REGULAR, FileMode.EXECUTABLE)).toBe(false)
    })

    it('should return false for no change', () => {
      expect(isModeChangeSignificant(FileMode.REGULAR, FileMode.REGULAR)).toBe(false)
    })
  })

  describe('walkTree', () => {
    it('should walk a flat tree', async () => {
      const tree = createMockTree([
        createTreeEntry('file1.txt', sampleBlobSha),
        createTreeEntry('file2.txt', sampleBlobSha2)
      ])
      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const entries = await walkTree(store, sampleTreeSha)

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.fullPath)).toContain('file1.txt')
      expect(entries.map(e => e.fullPath)).toContain('file2.txt')
    })

    it('should walk nested trees with full paths', async () => {
      const subTree = createMockTree([
        createTreeEntry('nested.txt', sampleBlobSha)
      ])
      const tree = createMockTree([
        createTreeEntry('src', 'subtree0'.padEnd(40, '0'), FileMode.TREE)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree],
        ['subtree0'.padEnd(40, '0'), subTree]
      ])
      store = createMockStore(trees)

      const entries = await walkTree(store, sampleTreeSha)

      expect(entries.some(e => e.fullPath === 'src/nested.txt')).toBe(true)
    })

    it('should use prefix when provided', async () => {
      const tree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const entries = await walkTree(store, sampleTreeSha, 'prefix')

      expect(entries[0].fullPath).toBe('prefix/file.txt')
    })
  })

  describe('filterByPathspecs', () => {
    it('should include matching paths', () => {
      const entries: DiffEntry[] = [
        { path: 'src/file.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 },
        { path: 'test/file.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 }
      ]

      const filtered = filterByPathspecs(entries, ['src/*'])

      expect(filtered).toHaveLength(1)
      expect(filtered[0].path).toBe('src/file.ts')
    })

    it('should exclude matching paths', () => {
      const entries: DiffEntry[] = [
        { path: 'src/file.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 },
        { path: 'vendor/lib.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 }
      ]

      const filtered = filterByPathspecs(entries, undefined, ['vendor/*'])

      expect(filtered).toHaveLength(1)
      expect(filtered[0].path).toBe('src/file.ts')
    })

    it('should return all entries when no filters provided', () => {
      const entries: DiffEntry[] = [
        { path: 'file1.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 },
        { path: 'file2.ts', status: DiffStatus.MODIFIED, oldMode: FileMode.REGULAR, newMode: FileMode.REGULAR, oldSha: sampleBlobSha, newSha: sampleBlobSha2 }
      ]

      const filtered = filterByPathspecs(entries)

      expect(filtered).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Diff to Index/Worktree Tests
  // ==========================================================================

  describe('diffTreeToIndex', () => {
    it('should detect added files in index', async () => {
      const tree = createMockTree([])
      const index: IndexEntry[] = [
        createIndexEntry('newfile.txt', sampleBlobSha)
      ]

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const result = await diffTreeToIndex(store, sampleTreeSha, index)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
    })

    it('should detect deleted files from index', async () => {
      const tree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const index: IndexEntry[] = []

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const result = await diffTreeToIndex(store, sampleTreeSha, index)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.DELETED)
    })

    it('should detect modified files in index', async () => {
      const tree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const index: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha2)
      ]

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const result = await diffTreeToIndex(store, sampleTreeSha, index)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.MODIFIED)
    })

    it('should handle null tree (initial commit staging)', async () => {
      const index: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha)
      ]

      const result = await diffTreeToIndex(store, null, index)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe(DiffStatus.ADDED)
    })
  })

  describe('diffTreeToWorktree', () => {
    it('should detect modified files in worktree', async () => {
      const tree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])
      const worktree: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha2)
      ]

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, tree]
      ])
      store = createMockStore(trees)

      const result = await diffTreeToWorktree(store, sampleTreeSha, worktree)

      expect(result.entries[0].status).toBe(DiffStatus.MODIFIED)
    })
  })

  // ==========================================================================
  // detectRenames and detectCopies
  // ==========================================================================

  describe('detectRenames', () => {
    it('should convert delete+add pairs to renames when similar', async () => {
      const content = createBlobContent('file content')
      const entries: DiffEntry[] = [
        { path: 'old.txt', status: DiffStatus.DELETED, oldMode: FileMode.REGULAR, newMode: null, oldSha: sampleBlobSha, newSha: null },
        { path: 'new.txt', status: DiffStatus.ADDED, oldMode: null, newMode: FileMode.REGULAR, oldSha: null, newSha: sampleBlobSha }
      ]

      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content]
      ])
      store = createMockStore(new Map(), blobs)

      const result = await detectRenames(store, entries)

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe(DiffStatus.RENAMED)
    })
  })

  describe('detectCopies', () => {
    it('should mark added files as copies when matching existing content', async () => {
      const content = createBlobContent('file content')
      const entries: DiffEntry[] = [
        { path: 'copy.txt', status: DiffStatus.ADDED, oldMode: null, newMode: FileMode.REGULAR, oldSha: null, newSha: sampleBlobSha }
      ]
      const existingPaths = new Map<string, string>([
        ['original.txt', sampleBlobSha]
      ])

      const blobs = new Map<string, Uint8Array>([
        [sampleBlobSha, content]
      ])
      store = createMockStore(new Map(), blobs)

      const result = await detectCopies(store, entries, existingPaths)

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe(DiffStatus.COPIED)
      expect(result[0].oldPath).toBe('original.txt')
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge cases and error handling', () => {
    it('should handle empty trees on both sides', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(0)
      expect(result.stats.added).toBe(0)
      expect(result.stats.deleted).toBe(0)
      expect(result.stats.modified).toBe(0)
    })

    it('should handle null on both sides', async () => {
      const result = await diffTrees(store, null, null)

      expect(result.entries).toHaveLength(0)
    })

    it('should handle non-existent tree SHA', async () => {
      const nonExistentSha = 'f'.repeat(40)

      await expect(diffTrees(store, nonExistentSha, null)).rejects.toThrow(/tree not found|does not exist/i)
    })

    it('should handle files with same name but different cases', async () => {
      const oldTree = createMockTree([
        createTreeEntry('File.txt', sampleBlobSha)
      ])
      const newTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha2)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      // Should be treated as delete + add (case-sensitive)
      expect(result.entries.some(e => e.status === DiffStatus.DELETED && e.path === 'File.txt')).toBe(true)
      expect(result.entries.some(e => e.status === DiffStatus.ADDED && e.path === 'file.txt')).toBe(true)
    })

    it('should handle special characters in filenames', async () => {
      const oldTree = createMockTree([
        createTreeEntry('file with spaces.txt', sampleBlobSha),
        createTreeEntry('file-with-dashes.txt', sampleBlobSha2)
      ])
      const newTree = createMockTree([
        createTreeEntry('file with spaces.txt', sampleBlobSha2),
        createTreeEntry('file-with-dashes.txt', sampleBlobSha3)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries).toHaveLength(2)
    })

    it('should handle unicode filenames', async () => {
      const oldTree = createMockTree([])
      const newTree = createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ])

      const trees = new Map<string, TreeObject>([
        [sampleTreeSha, oldTree],
        [sampleTreeSha2, newTree]
      ])
      store = createMockStore(trees)

      const result = await diffTrees(store, sampleTreeSha, sampleTreeSha2)

      expect(result.entries[0].path).toBe('file.txt')
    })

    it('should handle very deep directory structures', async () => {
      // Create a chain of nested directories
      let currentTreeSha = 'leaf'.padEnd(40, '0')
      const trees = new Map<string, TreeObject>()

      // Leaf tree with a file
      trees.set(currentTreeSha, createMockTree([
        createTreeEntry('file.txt', sampleBlobSha)
      ]))

      // Create 20 levels of nesting
      // Use zero-padded numbers to avoid SHA collisions (e.g., level01 vs level10)
      for (let i = 19; i >= 0; i--) {
        const paddedNum = i.toString().padStart(2, '0')
        const parentSha = `level${paddedNum}`.padEnd(40, '0')
        trees.set(parentSha, createMockTree([
          createTreeEntry(`dir${i}`, currentTreeSha, FileMode.TREE)
        ]))
        currentTreeSha = parentSha
      }

      store = createMockStore(trees)

      const result = await diffTrees(store, null, currentTreeSha, { recursive: true })

      // Should find the deeply nested file
      const expectedPath = Array.from({ length: 20 }, (_, i) => `dir${i}`).join('/') + '/file.txt'
      expect(result.entries.some(e => e.path === expectedPath)).toBe(true)
    })
  })
})
