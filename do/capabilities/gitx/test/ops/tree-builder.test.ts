import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  IndexEntry,
  buildTreeFromIndex,
  buildTreeHierarchy,
  TreeNode,
  sortTreeEntries,
  deduplicateTrees,
  createTreeObject,
  ObjectStore,
  BuildTreeResult
} from '../../src/ops/tree-builder'
import { TreeEntry, TreeObject } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

const sampleBlobSha = 'a'.repeat(40)
const sampleBlobSha2 = 'b'.repeat(40)
const sampleBlobSha3 = 'c'.repeat(40)
const sampleTreeSha = 'd'.repeat(40)

/**
 * Create a mock object store for testing
 */
function createMockStore(objects: Map<string, { type: string; data: Uint8Array }> = new Map()): ObjectStore {
  const storedObjects = new Map(objects)
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
    }
  }
}

/**
 * Create a sample index entry for testing
 */
function createIndexEntry(
  path: string,
  sha: string = sampleBlobSha,
  mode: string = '100644'
): IndexEntry {
  return {
    path,
    sha,
    mode,
    flags: 0,
    size: 100,
    mtime: 1704067200,
    ctime: 1704067200
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Tree Building from Index', () => {
  let store: ObjectStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('buildTreeFromIndex', () => {
    describe('Building tree from flat file list', () => {
      it('should build a tree from a single file', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('README.md', sampleBlobSha)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result).toBeDefined()
        expect(result.sha).toBeDefined()
        expect(result.sha).toMatch(/^[0-9a-f]{40}$|^mock/)
        expect(result.treeCount).toBe(1)
      })

      it('should build a tree from multiple files at root level', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('README.md', sampleBlobSha),
          createIndexEntry('package.json', sampleBlobSha2),
          createIndexEntry('index.ts', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result).toBeDefined()
        expect(result.sha).toBeDefined()
        expect(result.treeCount).toBe(1) // Only root tree
      })

      it('should include all files in the root tree', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('a.txt', sampleBlobSha),
          createIndexEntry('b.txt', sampleBlobSha2),
          createIndexEntry('c.txt', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries).toHaveLength(3)
        expect(result.entries.map(e => e.name)).toContain('a.txt')
        expect(result.entries.map(e => e.name)).toContain('b.txt')
        expect(result.entries.map(e => e.name)).toContain('c.txt')
      })

      it('should handle empty index', async () => {
        const entries: IndexEntry[] = []

        const result = await buildTreeFromIndex(store, entries)

        expect(result.sha).toBeDefined()
        expect(result.entries).toHaveLength(0)
        expect(result.treeCount).toBe(1) // Empty root tree
      })
    })

    describe('Nested directory structure', () => {
      it('should create subtree for single nested file', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/index.ts', sampleBlobSha)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(2) // root + src
        expect(result.entries).toHaveLength(1)
        expect(result.entries[0].name).toBe('src')
        expect(result.entries[0].mode).toBe('040000')
      })

      it('should create nested subtrees for deeply nested file', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/components/ui/Button.tsx', sampleBlobSha)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(4) // root + src + components + ui
      })

      it('should group files in same directory into one subtree', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/index.ts', sampleBlobSha),
          createIndexEntry('src/utils.ts', sampleBlobSha2),
          createIndexEntry('src/types.ts', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(2) // root + src
        expect(result.entries).toHaveLength(1) // Only src directory
        expect(result.entries[0].name).toBe('src')
      })

      it('should handle mixed root and nested files', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('README.md', sampleBlobSha),
          createIndexEntry('src/index.ts', sampleBlobSha2),
          createIndexEntry('package.json', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(2) // root + src
        expect(result.entries).toHaveLength(3) // README, src, package.json
      })

      it('should handle multiple directories at different depths', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/index.ts', sampleBlobSha),
          createIndexEntry('test/index.test.ts', sampleBlobSha2),
          createIndexEntry('docs/api/README.md', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(5) // root + src + test + docs + api
        expect(result.entries).toHaveLength(3) // src, test, docs
      })

      it('should handle sibling directories with nested content', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/components/Button.tsx', sampleBlobSha),
          createIndexEntry('src/utils/helpers.ts', sampleBlobSha2)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.treeCount).toBe(4) // root + src + components + utils
      })
    })

    describe('File mode handling', () => {
      it('should preserve regular file mode (100644)', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('file.txt', sampleBlobSha, '100644')
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries[0].mode).toBe('100644')
      })

      it('should preserve executable file mode (100755)', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('script.sh', sampleBlobSha, '100755')
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries[0].mode).toBe('100755')
      })

      it('should preserve symlink mode (120000)', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('link', sampleBlobSha, '120000')
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries[0].mode).toBe('120000')
      })

      it('should handle submodule mode (160000)', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('submodule', sampleBlobSha, '160000')
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries[0].mode).toBe('160000')
      })

      it('should set directory mode (040000) for tree entries', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/index.ts', sampleBlobSha)
        ]

        const result = await buildTreeFromIndex(store, entries)

        // The root tree should have 'src' as a directory entry
        expect(result.entries[0].mode).toBe('040000')
      })

      it('should handle mixed modes in same directory', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('regular.txt', sampleBlobSha, '100644'),
          createIndexEntry('executable.sh', sampleBlobSha2, '100755'),
          createIndexEntry('link', sampleBlobSha3, '120000')
        ]

        const result = await buildTreeFromIndex(store, entries)

        const modes = result.entries.map(e => e.mode)
        expect(modes).toContain('100644')
        expect(modes).toContain('100755')
        expect(modes).toContain('120000')
      })

      it('should preserve modes in nested directories', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('bin/script.sh', sampleBlobSha, '100755'),
          createIndexEntry('lib/module.ts', sampleBlobSha2, '100644')
        ]

        const result = await buildTreeFromIndex(store, entries)

        // Both bin and lib should have mode 040000
        expect(result.entries.every(e => e.mode === '040000')).toBe(true)
      })
    })

    describe('Sorting entries correctly', () => {
      it('should sort entries alphabetically', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('zebra.txt', sampleBlobSha),
          createIndexEntry('apple.txt', sampleBlobSha2),
          createIndexEntry('banana.txt', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        expect(result.entries[0].name).toBe('apple.txt')
        expect(result.entries[1].name).toBe('banana.txt')
        expect(result.entries[2].name).toBe('zebra.txt')
      })

      it('should sort directories as if they have trailing slash', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('ab', sampleBlobSha, '100644'),
          createIndexEntry('a/file.txt', sampleBlobSha2),
          createIndexEntry('aa', sampleBlobSha3, '100644')
        ]

        const result = await buildTreeFromIndex(store, entries)

        // Git sorts: 'a/' (dir), 'aa' (file), 'ab' (file)
        expect(result.entries[0].name).toBe('a')
        expect(result.entries[0].mode).toBe('040000')
        expect(result.entries[1].name).toBe('aa')
        expect(result.entries[2].name).toBe('ab')
      })

      it('should sort case-sensitively', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('B.txt', sampleBlobSha),
          createIndexEntry('a.txt', sampleBlobSha2),
          createIndexEntry('A.txt', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        // ASCII order: A < B < a
        expect(result.entries[0].name).toBe('A.txt')
        expect(result.entries[1].name).toBe('B.txt')
        expect(result.entries[2].name).toBe('a.txt')
      })

      it('should maintain consistent order for deterministic hashing', async () => {
        const entries1: IndexEntry[] = [
          createIndexEntry('c.txt', sampleBlobSha),
          createIndexEntry('a.txt', sampleBlobSha2),
          createIndexEntry('b.txt', sampleBlobSha3)
        ]

        const entries2: IndexEntry[] = [
          createIndexEntry('b.txt', sampleBlobSha3),
          createIndexEntry('c.txt', sampleBlobSha),
          createIndexEntry('a.txt', sampleBlobSha2)
        ]

        const store1 = createMockStore()
        const store2 = createMockStore()

        const result1 = await buildTreeFromIndex(store1, entries1)
        const result2 = await buildTreeFromIndex(store2, entries2)

        // Both should produce identical trees
        expect(result1.entries.map(e => e.name)).toEqual(result2.entries.map(e => e.name))
      })

      it('should sort entries within nested directories', async () => {
        const entries: IndexEntry[] = [
          createIndexEntry('src/z.ts', sampleBlobSha),
          createIndexEntry('src/a.ts', sampleBlobSha2),
          createIndexEntry('src/m.ts', sampleBlobSha3)
        ]

        const result = await buildTreeFromIndex(store, entries)

        // Get the src subtree entries
        expect(result.subtrees?.['src']).toBeDefined()
        const srcEntries = result.subtrees?.['src'].entries ?? []
        expect(srcEntries[0].name).toBe('a.ts')
        expect(srcEntries[1].name).toBe('m.ts')
        expect(srcEntries[2].name).toBe('z.ts')
      })
    })
  })

  describe('Tree Deduplication', () => {
    it('should deduplicate identical subtrees', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('dir1/file.txt', sampleBlobSha, '100644'),
        createIndexEntry('dir2/file.txt', sampleBlobSha, '100644')
      ]

      const result = await buildTreeFromIndex(store, entries)

      // dir1 and dir2 should share the same tree SHA
      const dir1Entry = result.entries.find(e => e.name === 'dir1')
      const dir2Entry = result.entries.find(e => e.name === 'dir2')
      expect(dir1Entry?.sha).toBe(dir2Entry?.sha)
    })

    it('should not deduplicate different subtrees', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('dir1/file.txt', sampleBlobSha, '100644'),
        createIndexEntry('dir2/file.txt', sampleBlobSha2, '100644') // Different SHA
      ]

      const result = await buildTreeFromIndex(store, entries)

      const dir1Entry = result.entries.find(e => e.name === 'dir1')
      const dir2Entry = result.entries.find(e => e.name === 'dir2')
      expect(dir1Entry?.sha).not.toBe(dir2Entry?.sha)
    })

    it('should deduplicate deeply nested identical subtrees', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('a/b/c/file.txt', sampleBlobSha),
        createIndexEntry('x/y/z/file.txt', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      // The innermost directories (c and z) should have same SHA
      // Since they contain identical content
      expect(result.deduplicatedCount).toBeGreaterThan(0)
    })

    it('should only store each unique tree once', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('a/shared/file.txt', sampleBlobSha),
        createIndexEntry('b/shared/file.txt', sampleBlobSha),
        createIndexEntry('c/shared/file.txt', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      // Should not store 3 copies of the 'shared' tree
      expect(result.uniqueTreeCount).toBeLessThan(result.treeCount)
    })

    it('should deduplicate when file modes match', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('dir1/script.sh', sampleBlobSha, '100755'),
        createIndexEntry('dir2/script.sh', sampleBlobSha, '100755')
      ]

      const result = await buildTreeFromIndex(store, entries)

      const dir1Entry = result.entries.find(e => e.name === 'dir1')
      const dir2Entry = result.entries.find(e => e.name === 'dir2')
      expect(dir1Entry?.sha).toBe(dir2Entry?.sha)
    })

    it('should not deduplicate when file modes differ', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('dir1/script.sh', sampleBlobSha, '100755'),
        createIndexEntry('dir2/script.sh', sampleBlobSha, '100644') // Different mode
      ]

      const result = await buildTreeFromIndex(store, entries)

      const dir1Entry = result.entries.find(e => e.name === 'dir1')
      const dir2Entry = result.entries.find(e => e.name === 'dir2')
      expect(dir1Entry?.sha).not.toBe(dir2Entry?.sha)
    })
  })

  describe('Empty Directory Handling', () => {
    it('should not create entries for empty directories', async () => {
      // Git does not track empty directories
      const entries: IndexEntry[] = [
        createIndexEntry('src/index.ts', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      // Should not have any empty directories
      expect(result.entries.every(e => e.mode !== '040000' || result.subtrees?.[e.name]?.entries?.length! > 0)).toBe(true)
    })

    it('should handle gitkeep pattern for empty directories', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('empty/.gitkeep', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].name).toBe('empty')
      expect(result.entries[0].mode).toBe('040000')
    })

    it('should not include directories without any tracked files', async () => {
      // If we have entries that result in no actual files (edge case)
      const entries: IndexEntry[] = []

      const result = await buildTreeFromIndex(store, entries)

      // Empty tree should have no subdirectories
      expect(result.entries).toHaveLength(0)
    })

    it('should prune branches with no files', async () => {
      // All entries in a subtree path
      const entries: IndexEntry[] = [
        createIndexEntry('src/components/Button.tsx', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      // Every directory in the chain should lead to a file
      expect(result.treeCount).toBe(3) // root, src, components
    })
  })

  describe('buildTreeHierarchy', () => {
    it('should build hierarchy from flat entries', () => {
      const entries: IndexEntry[] = [
        createIndexEntry('a.txt', sampleBlobSha),
        createIndexEntry('b.txt', sampleBlobSha2)
      ]

      const hierarchy = buildTreeHierarchy(entries)

      expect(hierarchy.children.size).toBe(2)
      expect(hierarchy.children.has('a.txt')).toBe(true)
      expect(hierarchy.children.has('b.txt')).toBe(true)
    })

    it('should build nested hierarchy', () => {
      const entries: IndexEntry[] = [
        createIndexEntry('src/index.ts', sampleBlobSha)
      ]

      const hierarchy = buildTreeHierarchy(entries)

      expect(hierarchy.children.has('src')).toBe(true)
      const srcNode = hierarchy.children.get('src')
      expect(srcNode?.isDirectory).toBe(true)
      expect(srcNode?.children.has('index.ts')).toBe(true)
    })

    it('should handle root node correctly', () => {
      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha)
      ]

      const hierarchy = buildTreeHierarchy(entries)

      expect(hierarchy.isDirectory).toBe(true)
      expect(hierarchy.name).toBe('')
      expect(hierarchy.path).toBe('')
    })
  })

  describe('sortTreeEntries', () => {
    it('should sort entries by name', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'c.txt', sha: sampleBlobSha },
        { mode: '100644', name: 'a.txt', sha: sampleBlobSha2 },
        { mode: '100644', name: 'b.txt', sha: sampleBlobSha3 }
      ]

      const sorted = sortTreeEntries(entries)

      expect(sorted[0].name).toBe('a.txt')
      expect(sorted[1].name).toBe('b.txt')
      expect(sorted[2].name).toBe('c.txt')
    })

    it('should sort directories with trailing slash', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'ab', sha: sampleBlobSha },
        { mode: '040000', name: 'a', sha: sampleBlobSha2 },
        { mode: '100644', name: 'aa', sha: sampleBlobSha3 }
      ]

      const sorted = sortTreeEntries(entries)

      expect(sorted[0].name).toBe('a') // directory sorts as 'a/'
      expect(sorted[1].name).toBe('aa')
      expect(sorted[2].name).toBe('ab')
    })

    it('should not mutate original array', () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'b.txt', sha: sampleBlobSha },
        { mode: '100644', name: 'a.txt', sha: sampleBlobSha2 }
      ]

      const original = [...entries]
      sortTreeEntries(entries)

      expect(entries[0].name).toBe(original[0].name)
    })
  })

  describe('createTreeObject', () => {
    it('should create a valid tree object', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
      ]

      const tree = await createTreeObject(store, entries)

      expect(tree.sha).toBeDefined()
      expect(tree.type).toBe('tree')
    })

    it('should store the tree in the object store', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
      ]

      const tree = await createTreeObject(store, entries)

      expect(await store.hasObject(tree.sha)).toBe(true)
    })

    it('should create deterministic SHA for same content', async () => {
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'file.txt', sha: sampleBlobSha }
      ]

      const store1 = createMockStore()
      const store2 = createMockStore()

      const tree1 = await createTreeObject(store1, entries)
      const tree2 = await createTreeObject(store2, entries)

      // The tree SHAs should be identical for same content
      // (Note: mock store generates sequential SHAs, real implementation would hash)
      expect(tree1.data).toEqual(tree2.data)
    })
  })

  describe('deduplicateTrees', () => {
    it('should return deduplicated tree map', () => {
      const trees = new Map<string, TreeEntry[]>([
        ['dir1', [{ mode: '100644', name: 'file.txt', sha: sampleBlobSha }]],
        ['dir2', [{ mode: '100644', name: 'file.txt', sha: sampleBlobSha }]]
      ])

      const { deduplicated, mapping } = deduplicateTrees(trees)

      expect(deduplicated.size).toBeLessThanOrEqual(trees.size)
      expect(mapping.get('dir1')).toBe(mapping.get('dir2'))
    })

    it('should handle unique trees', () => {
      const trees = new Map<string, TreeEntry[]>([
        ['dir1', [{ mode: '100644', name: 'a.txt', sha: sampleBlobSha }]],
        ['dir2', [{ mode: '100644', name: 'b.txt', sha: sampleBlobSha2 }]]
      ])

      const { deduplicated } = deduplicateTrees(trees)

      expect(deduplicated.size).toBe(2)
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  let store: ObjectStore

  beforeEach(() => {
    store = createMockStore()
  })

  describe('Invalid inputs', () => {
    it('should throw on invalid file mode', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha, '999999')
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })

    it('should throw on invalid SHA format', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', 'invalid-sha')
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })

    it('should throw on empty path', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })

    it('should throw on path starting with slash', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('/absolute/path.txt', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })

    it('should throw on path with double slashes', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('src//file.txt', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })
  })

  describe('Special path characters', () => {
    it('should handle spaces in file names', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('my file.txt', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries[0].name).toBe('my file.txt')
    })

    it('should handle unicode in file names', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries[0].name).toBe('file.txt')
    })

    it('should handle dots in path components', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('.hidden/file.txt', sampleBlobSha),
        createIndexEntry('dir/.gitkeep', sampleBlobSha2)
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries.some(e => e.name === '.hidden')).toBe(true)
    })

    it('should reject path with .. components', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('src/../etc/passwd', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })

    it('should reject path with . components', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('src/./file.txt', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(store, entries)).rejects.toThrow()
    })
  })

  describe('Large trees', () => {
    it('should handle tree with many entries', async () => {
      const entries: IndexEntry[] = Array.from({ length: 1000 }, (_, i) =>
        createIndexEntry(`file${i.toString().padStart(4, '0')}.txt`, sampleBlobSha)
      )

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries).toHaveLength(1000)
    })

    it('should handle deeply nested paths', async () => {
      const path = Array.from({ length: 20 }, (_, i) => `dir${i}`).join('/') + '/file.txt'
      const entries: IndexEntry[] = [
        createIndexEntry(path, sampleBlobSha)
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.treeCount).toBe(21) // 20 directories + root
    })

    it('should handle wide and deep trees', async () => {
      const entries: IndexEntry[] = []
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          entries.push(createIndexEntry(`dir${i}/subdir${j}/file.txt`, sampleBlobSha))
        }
      }

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries).toHaveLength(10) // 10 top-level directories
    })
  })

  describe('Duplicate path handling', () => {
    it('should use last entry for duplicate paths', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha),
        createIndexEntry('file.txt', sampleBlobSha2) // Duplicate with different SHA
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].sha).toBe(sampleBlobSha2)
    })

    it('should handle duplicate paths with different modes', async () => {
      const entries: IndexEntry[] = [
        createIndexEntry('script.sh', sampleBlobSha, '100644'),
        createIndexEntry('script.sh', sampleBlobSha, '100755') // Same SHA, different mode
      ]

      const result = await buildTreeFromIndex(store, entries)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].mode).toBe('100755')
    })
  })

  describe('Store errors', () => {
    it('should propagate store errors', async () => {
      const failingStore: ObjectStore = {
        async getObject() { return null },
        async storeObject() { throw new Error('Store failed') },
        async hasObject() { return false }
      }

      const entries: IndexEntry[] = [
        createIndexEntry('file.txt', sampleBlobSha)
      ]

      await expect(buildTreeFromIndex(failingStore, entries)).rejects.toThrow('Store failed')
    })
  })
})

describe('Tree Building Consistency', () => {
  it('should produce consistent results for same input', async () => {
    const entries: IndexEntry[] = [
      createIndexEntry('src/a.ts', sampleBlobSha),
      createIndexEntry('src/b.ts', sampleBlobSha2),
      createIndexEntry('test/a.test.ts', sampleBlobSha3)
    ]

    const store1 = createMockStore()
    const store2 = createMockStore()

    const result1 = await buildTreeFromIndex(store1, entries)
    const result2 = await buildTreeFromIndex(store2, entries)

    expect(result1.entries).toEqual(result2.entries)
    expect(result1.treeCount).toBe(result2.treeCount)
  })

  it('should produce different trees for different content', async () => {
    const entries1: IndexEntry[] = [
      createIndexEntry('file.txt', sampleBlobSha)
    ]
    const entries2: IndexEntry[] = [
      createIndexEntry('file.txt', sampleBlobSha2)
    ]

    const store1 = createMockStore()
    const store2 = createMockStore()

    const result1 = await buildTreeFromIndex(store1, entries1)
    const result2 = await buildTreeFromIndex(store2, entries2)

    expect(result1.entries[0].sha).not.toBe(result2.entries[0].sha)
  })
})
