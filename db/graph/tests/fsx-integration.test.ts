/**
 * fsx-as-Things Integration Tests
 *
 * RED PHASE: Tests for representing filesystem entities as Things in the graph.
 *
 * @see dotdo-1k3sz - [RED] fsx-as-Things - Files in graph tests
 *
 * These tests demonstrate how fsx files and directories can be represented
 * as graph nodes (Things) with parent-child relationships forming the
 * directory structure. File content is stored externally (blob storage)
 * and referenced via contentRef in the Thing data.
 *
 * Key Design Decisions:
 * 1. File Thing: type='File', data contains path, size, mtime, contentType, contentRef
 * 2. Directory Thing: type='Directory', data contains path, mtime
 * 3. Directory 'contains' File/Directory relationships form the tree structure
 * 4. File 'hasContent' Blob relationships link files to their content storage
 * 5. Path resolution uses graph traversal through parent-child relationships
 *
 * NO MOCKS - Uses real SQLiteGraphStore for all tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { GraphStore, GraphThing } from '../types'
import { SQLiteGraphStore } from '../stores'
import {
  createFileGraphAdapter,
  type FileGraphAdapter,
  type FileData,
  type DirectoryData,
  type CreateFileOptions,
  type MkdirOptions,
} from '../adapters/file-graph-adapter'

// ============================================================================
// TEST SUITE
// ============================================================================

describe('fsx-as-Things Integration', () => {
  let adapter: FileGraphAdapter

  beforeEach(async () => {
    // This will fail until FileGraphAdapter is implemented
    try {
      adapter = await createFileGraphAdapter()
    } catch {
      // Expected to fail in RED phase
    }
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.close()
    }
  })

  // ==========================================================================
  // 1. FILE CRUD VIA GRAPH
  // ==========================================================================

  describe('File CRUD Operations', () => {
    describe('createFile', () => {
      it('creates File Thing with correct type and path', async () => {
        const file = await adapter.createFile('/readme.md', 'Hello World')

        expect(file).toBeDefined()
        expect(file.typeName).toBe('File')
        expect((file.data as FileData).path).toBe('/readme.md')
      })

      it('creates File Thing with size calculated from content', async () => {
        const content = 'Hello World'
        const file = await adapter.createFile('/test.txt', content)

        expect((file.data as FileData).size).toBe(new TextEncoder().encode(content).length)
      })

      it('creates File Thing with current timestamp as mtime', async () => {
        const before = Date.now()
        const file = await adapter.createFile('/test.txt', 'content')
        const after = Date.now()

        const mtime = (file.data as FileData).mtime
        expect(mtime).toBeGreaterThanOrEqual(before)
        expect(mtime).toBeLessThanOrEqual(after)
      })

      it('creates File Thing with contentRef pointing to blob storage', async () => {
        const file = await adapter.createFile('/test.txt', 'Hello World')

        const contentRef = (file.data as FileData).contentRef
        expect(contentRef).not.toBeNull()
        expect(contentRef).toMatch(/^blob:sha256-[a-f0-9]+$/i)
      })

      it('creates File Thing with auto-detected content type for markdown', async () => {
        const file = await adapter.createFile('/docs/readme.md', '# Hello')

        expect((file.data as FileData).contentType).toBe('text/markdown')
      })

      it('creates File Thing with auto-detected content type for JSON', async () => {
        const file = await adapter.createFile('/config.json', '{}')

        expect((file.data as FileData).contentType).toBe('application/json')
      })

      it('creates File Thing with custom content type', async () => {
        const file = await adapter.createFile('/data.bin', new Uint8Array([1, 2, 3]), {
          contentType: 'application/octet-stream',
        })

        expect((file.data as FileData).contentType).toBe('application/octet-stream')
      })

      it('creates parent directory Things automatically', async () => {
        const file = await adapter.createFile('/a/b/c.txt', 'nested')

        // Should create /a and /a/b directories
        const dirA = await adapter.resolvePath('/a')
        const dirB = await adapter.resolvePath('/a/b')

        expect(dirA).not.toBeNull()
        expect(dirA?.typeName).toBe('Directory')
        expect(dirB).not.toBeNull()
        expect(dirB?.typeName).toBe('Directory')
      })

      it('creates "contains" relationship from parent directory to file', async () => {
        const file = await adapter.createFile('/docs/readme.md', 'content')

        const parentContents = await adapter.ls('/docs')
        const fileInParent = parentContents.find((t) => (t.data as FileData).path === '/docs/readme.md')

        expect(fileInParent).toBeDefined()
      })
    })

    describe('readFile', () => {
      it('reads File Thing with content', async () => {
        await adapter.createFile('/readme.md', 'Hello World')

        const { metadata, content } = await adapter.readFile('/readme.md')

        expect(metadata.typeName).toBe('File')
        expect(content).toBe('Hello World')
      })

      it('reads binary content correctly', async () => {
        const originalContent = new Uint8Array([0, 1, 2, 3, 255])
        await adapter.createFile('/binary.bin', originalContent)

        const { content } = await adapter.readFile('/binary.bin')

        expect(content).toBeInstanceOf(Uint8Array)
        expect(content).toEqual(originalContent)
      })

      it('throws ENOENT for non-existent file', async () => {
        await expect(adapter.readFile('/does-not-exist.txt')).rejects.toThrow(/ENOENT|not found/i)
      })
    })

    describe('writeFile', () => {
      it('updates file content and size', async () => {
        await adapter.createFile('/test.txt', 'initial')
        const updated = await adapter.writeFile('/test.txt', 'updated content')

        expect((updated.data as FileData).size).toBe(new TextEncoder().encode('updated content').length)

        const { content } = await adapter.readFile('/test.txt')
        expect(content).toBe('updated content')
      })

      it('updates mtime on write', async () => {
        await adapter.createFile('/test.txt', 'initial')
        const originalFile = await adapter.getFile('/test.txt')
        const originalMtime = (originalFile!.data as FileData).mtime

        // Small delay to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await adapter.writeFile('/test.txt', 'updated')
        const newMtime = (updated.data as FileData).mtime

        expect(newMtime).toBeGreaterThan(originalMtime)
      })

      it('updates contentRef on write', async () => {
        await adapter.createFile('/test.txt', 'initial')
        const originalFile = await adapter.getFile('/test.txt')
        const originalRef = (originalFile!.data as FileData).contentRef

        await adapter.writeFile('/test.txt', 'different content')
        const updatedFile = await adapter.getFile('/test.txt')
        const updatedRef = (updatedFile!.data as FileData).contentRef

        // Different content should have different hash
        expect(updatedRef).not.toBe(originalRef)
      })

      it('creates file if it does not exist', async () => {
        const file = await adapter.writeFile('/new-file.txt', 'created via write')

        expect(file.typeName).toBe('File')
        expect((file.data as FileData).path).toBe('/new-file.txt')
      })
    })

    describe('deleteFile', () => {
      it('deletes File Thing', async () => {
        await adapter.createFile('/test.txt', 'content')
        const result = await adapter.deleteFile('/test.txt')

        expect(result).toBe(true)

        const file = await adapter.getFile('/test.txt')
        expect(file).toBeNull()
      })

      it('removes file from parent directory contents', async () => {
        await adapter.createFile('/docs/file.txt', 'content')
        await adapter.deleteFile('/docs/file.txt')

        const contents = await adapter.ls('/docs')
        const deleted = contents.find((t) => (t.data as FileData).path === '/docs/file.txt')

        expect(deleted).toBeUndefined()
      })

      it('returns false for non-existent file', async () => {
        const result = await adapter.deleteFile('/does-not-exist.txt')
        expect(result).toBe(false)
      })
    })

    describe('getFile', () => {
      it('retrieves File Thing by path', async () => {
        await adapter.createFile('/readme.md', 'content')
        const file = await adapter.getFile('/readme.md')

        expect(file).not.toBeNull()
        expect(file?.typeName).toBe('File')
        expect((file?.data as FileData).path).toBe('/readme.md')
      })

      it('returns null for non-existent path', async () => {
        const file = await adapter.getFile('/does-not-exist.txt')
        expect(file).toBeNull()
      })
    })
  })

  // ==========================================================================
  // 2. DIRECTORY OPERATIONS
  // ==========================================================================

  describe('Directory Operations', () => {
    describe('mkdir', () => {
      it('creates Directory Thing', async () => {
        const dir = await adapter.mkdir('/docs')

        expect(dir).toBeDefined()
        expect(dir.typeName).toBe('Directory')
        expect((dir.data as DirectoryData).path).toBe('/docs')
      })

      it('creates Directory Thing with current timestamp', async () => {
        const before = Date.now()
        const dir = await adapter.mkdir('/docs')
        const after = Date.now()

        const mtime = (dir.data as DirectoryData).mtime
        expect(mtime).toBeGreaterThanOrEqual(before)
        expect(mtime).toBeLessThanOrEqual(after)
      })

      it('creates parent directories with recursive option', async () => {
        const dir = await adapter.mkdir('/a/b/c', { recursive: true })

        expect(dir).toBeDefined()
        expect((dir.data as DirectoryData).path).toBe('/a/b/c')

        // Verify parents exist
        const a = await adapter.resolvePath('/a')
        const ab = await adapter.resolvePath('/a/b')

        expect(a).not.toBeNull()
        expect(ab).not.toBeNull()
      })

      it('throws ENOENT without recursive option for missing parent', async () => {
        await expect(adapter.mkdir('/missing/deep/path')).rejects.toThrow(/ENOENT|not found/i)
      })

      it('creates "contains" relationship from parent to child directory', async () => {
        await adapter.mkdir('/parent', { recursive: true })
        await adapter.mkdir('/parent/child')

        const contents = await adapter.ls('/parent')
        const child = contents.find((t) => (t.data as DirectoryData).path === '/parent/child')

        expect(child).toBeDefined()
        expect(child?.typeName).toBe('Directory')
      })
    })

    describe('rmdir', () => {
      it('removes empty Directory Thing', async () => {
        await adapter.mkdir('/empty-dir')
        const result = await adapter.rmdir('/empty-dir')

        expect(result).toBe(true)

        const dir = await adapter.resolvePath('/empty-dir')
        expect(dir).toBeNull()
      })

      it('throws ENOTEMPTY for non-empty directory', async () => {
        await adapter.mkdir('/non-empty')
        await adapter.createFile('/non-empty/file.txt', 'content')

        await expect(adapter.rmdir('/non-empty')).rejects.toThrow(/ENOTEMPTY|not empty/i)
      })

      it('returns false for non-existent directory', async () => {
        const result = await adapter.rmdir('/does-not-exist')
        expect(result).toBe(false)
      })
    })

    describe('ls', () => {
      it('lists directory contents via relationships', async () => {
        await adapter.mkdir('/docs')
        await adapter.createFile('/docs/a.txt', 'A')
        await adapter.createFile('/docs/b.txt', 'B')

        const contents = await adapter.ls('/docs')

        expect(contents).toHaveLength(2)
        expect(contents.every((t) => t.typeName === 'File')).toBe(true)
      })

      it('lists mixed files and directories', async () => {
        await adapter.mkdir('/mixed')
        await adapter.createFile('/mixed/file.txt', 'content')
        await adapter.mkdir('/mixed/subdir')

        const contents = await adapter.ls('/mixed')

        expect(contents).toHaveLength(2)

        const types = contents.map((t) => t.typeName).sort()
        expect(types).toEqual(['Directory', 'File'])
      })

      it('returns empty array for empty directory', async () => {
        await adapter.mkdir('/empty')

        const contents = await adapter.ls('/empty')

        expect(contents).toHaveLength(0)
      })

      it('throws ENOENT for non-existent directory', async () => {
        await expect(adapter.ls('/does-not-exist')).rejects.toThrow(/ENOENT|not found/i)
      })

      it('lists root directory contents', async () => {
        await adapter.createFile('/file1.txt', 'content')
        await adapter.mkdir('/dir1')

        const contents = await adapter.ls('/')

        expect(contents.length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  // ==========================================================================
  // 3. PATH RESOLUTION VIA GRAPH
  // ==========================================================================

  describe('Path Resolution via Graph', () => {
    describe('resolvePath', () => {
      it('resolves path through parent-child relationships', async () => {
        await adapter.mkdir('/a')
        await adapter.mkdir('/a/b')
        await adapter.createFile('/a/b/c.txt', 'content')

        const file = await adapter.resolvePath('/a/b/c.txt')

        expect(file).not.toBeNull()
        expect(file?.typeName).toBe('File')
        expect((file?.data as FileData).path).toBe('/a/b/c.txt')
      })

      it('resolves directory path', async () => {
        await adapter.mkdir('/a/b/c', { recursive: true })

        const dir = await adapter.resolvePath('/a/b/c')

        expect(dir).not.toBeNull()
        expect(dir?.typeName).toBe('Directory')
      })

      it('resolves root directory', async () => {
        const root = await adapter.resolvePath('/')

        expect(root).not.toBeNull()
        expect(root?.typeName).toBe('Directory')
        expect((root?.data as DirectoryData).path).toBe('/')
      })

      it('normalizes path before resolution', async () => {
        await adapter.createFile('/test.txt', 'content')

        // Unnormalized paths should still resolve
        const file1 = await adapter.resolvePath('/./test.txt')
        const file2 = await adapter.resolvePath('/foo/../test.txt')

        expect(file1).not.toBeNull()
        expect(file2).not.toBeNull()
      })

      it('returns null for non-existent path', async () => {
        const result = await adapter.resolvePath('/does/not/exist.txt')
        expect(result).toBeNull()
      })

      it('returns null for partially existing path', async () => {
        await adapter.mkdir('/a/b', { recursive: true })
        // /a/b exists, but /a/b/c does not

        const result = await adapter.resolvePath('/a/b/c/d.txt')
        expect(result).toBeNull()
      })
    })

    describe('exists', () => {
      it('returns true for existing file', async () => {
        await adapter.createFile('/exists.txt', 'content')

        const result = await adapter.exists('/exists.txt')
        expect(result).toBe(true)
      })

      it('returns true for existing directory', async () => {
        await adapter.mkdir('/exists')

        const result = await adapter.exists('/exists')
        expect(result).toBe(true)
      })

      it('returns false for non-existent path', async () => {
        const result = await adapter.exists('/does-not-exist')
        expect(result).toBe(false)
      })

      it('returns true for root directory', async () => {
        const result = await adapter.exists('/')
        expect(result).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 4. FILE METADATA UPDATES VIA THING UPDATE
  // ==========================================================================

  describe('File Metadata Updates', () => {
    it('updates file metadata via Thing update', async () => {
      await adapter.createFile('/test.txt', 'initial')
      const originalFile = await adapter.getFile('/test.txt')
      const originalMtime = (originalFile!.data as FileData).mtime

      await new Promise((resolve) => setTimeout(resolve, 10))

      await adapter.writeFile('/test.txt', 'updated')

      const updatedFile = await adapter.getFile('/test.txt')
      expect((updatedFile!.data as FileData).mtime).toBeGreaterThan(originalMtime)
    })

    it('preserves path after content update', async () => {
      await adapter.createFile('/important.txt', 'v1')
      await adapter.writeFile('/important.txt', 'v2')

      const file = await adapter.getFile('/important.txt')
      expect((file!.data as FileData).path).toBe('/important.txt')
    })

    it('updates size on content change', async () => {
      await adapter.createFile('/grow.txt', 'short')
      const shortFile = await adapter.getFile('/grow.txt')
      const shortSize = (shortFile!.data as FileData).size

      await adapter.writeFile('/grow.txt', 'much longer content here')
      const longFile = await adapter.getFile('/grow.txt')
      const longSize = (longFile!.data as FileData).size

      expect(longSize).toBeGreaterThan(shortSize)
    })
  })

  // ==========================================================================
  // 5. INTEGRATION WITH GRAPHSTORE
  // ==========================================================================

  describe('Integration with GraphStore', () => {
    it('uses SQLiteGraphStore for all operations', async () => {
      const store = adapter.getStore()

      // Verify we can query Things directly
      const things = await store.getThingsByType({ typeName: 'File' })
      expect(Array.isArray(things)).toBe(true)
    })

    it('creates proper relationships queryable via GraphStore', async () => {
      await adapter.mkdir('/parent')
      await adapter.createFile('/parent/child.txt', 'content')

      const store = adapter.getStore()

      // Query relationships from parent directory
      const parentDir = await adapter.resolvePath('/parent')
      const relationships = await store.queryRelationshipsFrom(`thing://${parentDir!.id}`)

      expect(relationships.length).toBeGreaterThan(0)
      expect(relationships.some((r) => r.verb === 'contains')).toBe(true)
    })

    it('file content reference is queryable', async () => {
      await adapter.createFile('/test.txt', 'Hello World')

      const file = await adapter.getFile('/test.txt')
      const store = adapter.getStore()

      // Query 'hasContent' relationship
      const contentRels = await store.queryRelationshipsFrom(`thing://${file!.id}`, { verb: 'hasContent' })

      expect(contentRels.length).toBe(1)
      expect(contentRels[0]!.to).toMatch(/^blob:/)
    })

    it('supports graph traversal from root to nested files', async () => {
      await adapter.mkdir('/a/b/c', { recursive: true })
      await adapter.createFile('/a/b/c/deep.txt', 'nested content')

      const store = adapter.getStore()
      const root = await adapter.resolvePath('/')

      // Traverse via relationships
      let current = root
      const pathSegments = ['a', 'b', 'c', 'deep.txt']

      for (const _segment of pathSegments) {
        const children = await store.queryRelationshipsFrom(`thing://${current!.id}`, { verb: 'contains' })
        expect(children.length).toBeGreaterThan(0)

        // Get the child Thing
        const childUrl = children[0]!.to
        const childId = childUrl.replace('thing://', '')
        current = await store.getThing(childId)
        expect(current).not.toBeNull()
      }

      // Final node should be the file
      expect(current?.typeName).toBe('File')
    })
  })

  // ==========================================================================
  // 6. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles files at root level', async () => {
      const file = await adapter.createFile('/root-file.txt', 'at root')

      expect(file.typeName).toBe('File')
      expect((file.data as FileData).path).toBe('/root-file.txt')

      const contents = await adapter.ls('/')
      expect(contents.some((t) => (t.data as FileData).path === '/root-file.txt')).toBe(true)
    })

    it('handles files with special characters in name', async () => {
      const file = await adapter.createFile('/file with spaces.txt', 'content')

      expect(file).toBeDefined()

      const retrieved = await adapter.getFile('/file with spaces.txt')
      expect(retrieved).not.toBeNull()
    })

    it('handles empty files', async () => {
      const file = await adapter.createFile('/empty.txt', '')

      expect((file.data as FileData).size).toBe(0)
      expect((file.data as FileData).contentRef).not.toBeNull()
    })

    it('handles large files', async () => {
      const largeContent = 'x'.repeat(1024 * 1024) // 1MB
      const file = await adapter.createFile('/large.txt', largeContent)

      expect((file.data as FileData).size).toBe(1024 * 1024)

      const { content } = await adapter.readFile('/large.txt')
      expect(content).toBe(largeContent)
    })

    it('handles deeply nested paths', async () => {
      const deepPath = '/a/b/c/d/e/f/g/h/i/j/k.txt'
      const file = await adapter.createFile(deepPath, 'deep')

      expect(file).toBeDefined()

      const retrieved = await adapter.resolvePath(deepPath)
      expect(retrieved).not.toBeNull()
    })

    it('handles concurrent file creation', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        adapter.createFile(`/concurrent-${i}.txt`, `content ${i}`)
      )

      const files = await Promise.all(promises)

      expect(files).toHaveLength(10)
      expect(new Set(files.map((f) => f.id)).size).toBe(10)
    })

    it('handles binary content with null bytes', async () => {
      const binaryContent = new Uint8Array([0, 1, 0, 2, 0, 3])
      await adapter.createFile('/binary-nulls.bin', binaryContent)

      const { content } = await adapter.readFile('/binary-nulls.bin')

      expect(content).toBeInstanceOf(Uint8Array)
      expect(content).toEqual(binaryContent)
    })
  })
})
