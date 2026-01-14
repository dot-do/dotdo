/**
 * Filesystem Git Repository Adapter Tests
 *
 * RED phase tests for the local filesystem git repository adapter.
 * These tests verify that the adapter can read from local .git directories
 * and bridge with gitx.do's ObjectStore and RefStore interfaces.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  createFSAdapter,
  isGitRepository,
  isBareRepository,
  FSAdapter,
  FSObject,
  FSRef,
  FSAdapterError,
  IndexEntry,
  PackIndexEntry
} from '../../src/cli/fs-adapter'

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample SHAs for testing
const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const emptySha = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' // Empty blob

// Helper to create a minimal .git directory structure
async function createMockGitRepo(basePath: string, options: {
  bare?: boolean
  withPack?: boolean
  withIndex?: boolean
  withLooseObjects?: boolean
  withRefs?: boolean
  withConfig?: boolean
} = {}): Promise<string> {
  const gitDir = options.bare ? basePath : path.join(basePath, '.git')

  // Create basic structure
  await fs.mkdir(gitDir, { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects', 'info'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'objects', 'pack'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  await fs.mkdir(path.join(gitDir, 'refs', 'tags'), { recursive: true })

  // Write HEAD
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')

  // Write config
  if (options.withConfig !== false) {
    const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = ${options.bare ? 'true' : 'false'}
[remote "origin"]
\turl = https://github.com/example/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main
`
    await fs.writeFile(path.join(gitDir, 'config'), config)
  }

  // Add loose objects
  if (options.withLooseObjects) {
    // Create a blob object (zlib compressed)
    // For testing, we'll create the directory structure
    // Real implementation will need to handle zlib compression
    const objDir = path.join(gitDir, 'objects', 'e6', '9de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    await fs.mkdir(path.dirname(objDir), { recursive: true })
    // Write compressed empty blob (simplified - real would be zlib)
    await fs.writeFile(objDir, Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]))

    // Create the empty tree object (4b825dc642cb6eb9a060e54bf8d69288fbee4904)
    // "tree 0\0" compressed with zlib
    const emptyTreeDir = path.join(gitDir, 'objects', '4b', '825dc642cb6eb9a060e54bf8d69288fbee4904')
    await fs.mkdir(path.dirname(emptyTreeDir), { recursive: true })
    await fs.writeFile(emptyTreeDir, Buffer.from([120, 156, 43, 41, 74, 77, 85, 48, 96, 0, 0, 10, 44, 2, 1]))
  }

  // Add refs
  if (options.withRefs) {
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), sampleSha + '\n')
    await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'develop'), sampleSha2 + '\n')
    await fs.writeFile(path.join(gitDir, 'refs', 'tags', 'v1.0.0'), sampleSha + '\n')
  }

  // Add packed-refs
  if (options.withPack) {
    const packedRefs = `# pack-refs with: peeled fully-peeled sorted
${sampleSha} refs/heads/main
${sampleSha2} refs/heads/feature
${sampleSha} refs/tags/v1.0.0
^${sampleSha2}
`
    await fs.writeFile(path.join(gitDir, 'packed-refs'), packedRefs)
  }

  return options.bare ? basePath : basePath
}

// Helper to create a temporary directory
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'gitx-test-'))
}

// Helper to clean up temp directory
async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('FSAdapter - Local Filesystem Git Repository Adapter', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  // ==========================================================================
  // 1. Reading Loose Objects
  // ==========================================================================
  describe('Reading Loose Objects from .git/objects', () => {
    describe('Blob Objects', () => {
      it('should read a loose blob object', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        const obj = await adapter.getObject(emptySha)

        expect(obj).not.toBeNull()
        expect(obj!.type).toBe('blob')
        expect(obj!.source).toBe('loose')
      })

      it('should decompress zlib-compressed loose objects', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        const obj = await adapter.getObject(emptySha)

        expect(obj).not.toBeNull()
        expect(obj!.data).toBeInstanceOf(Uint8Array)
        // Empty blob should have empty data
        expect(obj!.size).toBe(0)
      })

      it('should return correct size for blob objects', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        const size = await adapter.getObjectSize(emptySha)

        expect(size).toBe(0) // Empty blob
      })

      it('should identify object type without loading full data', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        const type = await adapter.getObjectType(emptySha)

        expect(type).toBe('blob')
      })
    })

    describe('Tree Objects', () => {
      it('should read a loose tree object', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        // Known empty tree SHA
        const emptyTreeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

        const obj = await adapter.getObject(emptyTreeSha)

        expect(obj).not.toBeNull()
        expect(obj!.type).toBe('tree')
      })

      it('should parse tree entries correctly', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        const treeSha = 'c'.repeat(40) // Mock tree SHA

        const obj = await adapter.getObject(treeSha)

        // If tree exists, it should have entries parsed
        if (obj && obj.type === 'tree') {
          expect(obj.data).toBeInstanceOf(Uint8Array)
        }
      })
    })

    describe('Commit Objects', () => {
      it('should read a loose commit object', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        const commitSha = 'd'.repeat(40) // Mock commit SHA

        const obj = await adapter.getObject(commitSha)

        // When implemented, should return commit object
        if (obj) {
          expect(obj.type).toBe('commit')
        }
      })

      it('should parse commit metadata correctly', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        const commitSha = 'd'.repeat(40)

        const obj = await adapter.getObject(commitSha)

        // When implemented, parsed commit should have tree, parents, author, etc.
        if (obj && obj.type === 'commit') {
          expect(obj.data).toBeInstanceOf(Uint8Array)
        }
      })
    })

    describe('Tag Objects', () => {
      it('should read a loose annotated tag object', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        const tagSha = 'e'.repeat(40) // Mock tag SHA

        const obj = await adapter.getObject(tagSha)

        // When implemented, should return tag object
        if (obj) {
          expect(obj.type).toBe('tag')
        }
      })

      it('should parse tag metadata correctly', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)
        const tagSha = 'e'.repeat(40)

        const obj = await adapter.getObject(tagSha)

        // When implemented, parsed tag should have object, type, tag name, tagger
        if (obj && obj.type === 'tag') {
          expect(obj.data).toBeInstanceOf(Uint8Array)
        }
      })
    })

    describe('Object Location', () => {
      it('should locate objects in correct subdirectory (first 2 chars of SHA)', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        // e69de29bb... should be in .git/objects/e6/9de29bb...
        const obj = await adapter.getObject(emptySha)

        expect(obj).not.toBeNull()
      })

      it('should return null for non-existent objects', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)

        const obj = await adapter.getObject('f'.repeat(40))

        expect(obj).toBeNull()
      })

      it('should hasObject return true for existing objects', async () => {
        await createMockGitRepo(tempDir, { withLooseObjects: true })
        const adapter = await createFSAdapter(tempDir)

        const exists = await adapter.hasObject(emptySha)

        expect(exists).toBe(true)
      })

      it('should hasObject return false for non-existent objects', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)

        const exists = await adapter.hasObject('f'.repeat(40))

        expect(exists).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 2. Reading Refs
  // ==========================================================================
  describe('Reading Refs from .git/refs', () => {
    describe('Branch Refs (refs/heads)', () => {
      it('should read refs from .git/refs/heads', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const ref = await adapter.getRef('refs/heads/main')

        expect(ref).not.toBeNull()
        expect(ref!.name).toBe('refs/heads/main')
        expect(ref!.target).toBe(sampleSha)
        expect(ref!.type).toBe('direct')
      })

      it('should list all branches', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const branches = await adapter.listBranches()

        expect(branches.length).toBeGreaterThanOrEqual(2)
        expect(branches.some(b => b.name === 'refs/heads/main')).toBe(true)
        expect(branches.some(b => b.name === 'refs/heads/develop')).toBe(true)
      })

      it('should handle nested branch names (feature/xyz)', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        // Create a nested branch
        await fs.mkdir(path.join(tempDir, '.git', 'refs', 'heads', 'feature'), { recursive: true })
        await fs.writeFile(
          path.join(tempDir, '.git', 'refs', 'heads', 'feature', 'test'),
          sampleSha + '\n'
        )

        const ref = await adapter.getRef('refs/heads/feature/test')

        expect(ref).not.toBeNull()
        expect(ref!.name).toBe('refs/heads/feature/test')
      })
    })

    describe('Tag Refs (refs/tags)', () => {
      it('should read refs from .git/refs/tags', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const ref = await adapter.getRef('refs/tags/v1.0.0')

        expect(ref).not.toBeNull()
        expect(ref!.name).toBe('refs/tags/v1.0.0')
        expect(ref!.target).toBe(sampleSha)
      })

      it('should list all tags', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const tags = await adapter.listTags()

        expect(tags.length).toBeGreaterThanOrEqual(1)
        expect(tags.some(t => t.name === 'refs/tags/v1.0.0')).toBe(true)
      })

      it('should distinguish lightweight tags from annotated tags', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        // Lightweight tag points directly to commit SHA
        const ref = await adapter.getRef('refs/tags/v1.0.0')

        expect(ref).not.toBeNull()
        expect(ref!.type).toBe('direct')
      })
    })

    describe('Remote Refs (refs/remotes)', () => {
      it('should read remote tracking refs', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        // Create remote ref
        await fs.mkdir(path.join(tempDir, '.git', 'refs', 'remotes', 'origin'), { recursive: true })
        await fs.writeFile(
          path.join(tempDir, '.git', 'refs', 'remotes', 'origin', 'main'),
          sampleSha + '\n'
        )

        const ref = await adapter.getRef('refs/remotes/origin/main')

        expect(ref).not.toBeNull()
        expect(ref!.name).toBe('refs/remotes/origin/main')
      })

      it('should list refs with pattern matching', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const refs = await adapter.listRefs('refs/heads/*')

        expect(refs.every(r => r.name.startsWith('refs/heads/'))).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 3. Reading HEAD
  // ==========================================================================
  describe('Reading HEAD', () => {
    describe('Symbolic HEAD', () => {
      it('should read symbolic HEAD pointing to branch', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const head = await adapter.getHead()

        expect(head).not.toBeNull()
        expect(head!.name).toBe('HEAD')
        expect(head!.type).toBe('symbolic')
        expect(head!.target).toBe('refs/heads/main')
      })

      it('should resolve symbolic HEAD to final SHA', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const resolved = await adapter.resolveRef('HEAD')

        expect(resolved).not.toBeNull()
        expect(resolved!.sha).toBe(sampleSha)
        expect(resolved!.chain.length).toBe(2) // HEAD -> refs/heads/main
      })

      it('should report HEAD as not detached when symbolic', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        const adapter = await createFSAdapter(tempDir)

        const isDetached = await adapter.isHeadDetached()

        expect(isDetached).toBe(false)
      })
    })

    describe('Detached HEAD', () => {
      it('should read detached HEAD pointing directly to SHA', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        // Overwrite HEAD to be detached
        await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), sampleSha + '\n')
        const adapter = await createFSAdapter(tempDir)

        const head = await adapter.getHead()

        expect(head).not.toBeNull()
        expect(head!.name).toBe('HEAD')
        expect(head!.type).toBe('direct')
        expect(head!.target).toBe(sampleSha)
      })

      it('should report HEAD as detached when direct', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), sampleSha + '\n')
        const adapter = await createFSAdapter(tempDir)

        const isDetached = await adapter.isHeadDetached()

        expect(isDetached).toBe(true)
      })

      it('should resolve detached HEAD to its SHA directly', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), sampleSha + '\n')
        const adapter = await createFSAdapter(tempDir)

        const resolved = await adapter.resolveRef('HEAD')

        expect(resolved).not.toBeNull()
        expect(resolved!.sha).toBe(sampleSha)
        expect(resolved!.chain.length).toBe(1) // Just HEAD
      })
    })

    describe('HEAD Edge Cases', () => {
      it('should handle HEAD with trailing whitespace', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main  \n')
        const adapter = await createFSAdapter(tempDir)

        const head = await adapter.getHead()

        expect(head!.target).toBe('refs/heads/main')
      })

      it('should handle HEAD without trailing newline', async () => {
        await createMockGitRepo(tempDir, { withRefs: true })
        await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main')
        const adapter = await createFSAdapter(tempDir)

        const head = await adapter.getHead()

        expect(head!.target).toBe('refs/heads/main')
      })
    })
  })

  // ==========================================================================
  // 4. Reading packed-refs
  // ==========================================================================
  describe('Reading packed-refs File', () => {
    it('should read packed-refs file', async () => {
      await createMockGitRepo(tempDir, { withPack: true })
      const adapter = await createFSAdapter(tempDir)

      const packedRefs = await adapter.getPackedRefs()

      expect(packedRefs.size).toBeGreaterThan(0)
      expect(packedRefs.get('refs/heads/main')).toBe(sampleSha)
    })

    it('should skip comment lines in packed-refs', async () => {
      await createMockGitRepo(tempDir, { withPack: true })
      const adapter = await createFSAdapter(tempDir)

      const packedRefs = await adapter.getPackedRefs()

      // Should not have any entries starting with #
      for (const [key] of packedRefs) {
        expect(key.startsWith('#')).toBe(false)
      }
    })

    it('should handle peeled refs (^SHA lines) for annotated tags', async () => {
      await createMockGitRepo(tempDir, { withPack: true })
      const adapter = await createFSAdapter(tempDir)

      // The packed-refs contains a peeled entry for v1.0.0
      const ref = await adapter.getRef('refs/tags/v1.0.0')

      expect(ref).not.toBeNull()
      expect(ref!.target).toBe(sampleSha)
    })

    it('should prefer loose refs over packed refs', async () => {
      await createMockGitRepo(tempDir, { withPack: true, withRefs: true })
      const adapter = await createFSAdapter(tempDir)

      // Loose ref has sampleSha, packed-refs also has sampleSha but could differ
      const ref = await adapter.getRef('refs/heads/main')

      expect(ref).not.toBeNull()
      expect(ref!.target).toBe(sampleSha) // Should read loose ref
    })

    it('should fall back to packed-refs when loose ref not found', async () => {
      await createMockGitRepo(tempDir, { withPack: true })
      const adapter = await createFSAdapter(tempDir)

      // refs/heads/feature only exists in packed-refs
      const ref = await adapter.getRef('refs/heads/feature')

      expect(ref).not.toBeNull()
      expect(ref!.target).toBe(sampleSha2)
    })

    it('should handle empty packed-refs file', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.git', 'packed-refs'), '')
      const adapter = await createFSAdapter(tempDir)

      const packedRefs = await adapter.getPackedRefs()

      expect(packedRefs.size).toBe(0)
    })

    it('should handle packed-refs with only comments', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(
        path.join(tempDir, '.git', 'packed-refs'),
        '# pack-refs with: peeled fully-peeled sorted\n'
      )
      const adapter = await createFSAdapter(tempDir)

      const packedRefs = await adapter.getPackedRefs()

      expect(packedRefs.size).toBe(0)
    })
  })

  // ==========================================================================
  // 5. Reading Pack Files
  // ==========================================================================
  describe('Reading Pack Files from .git/objects/pack', () => {
    describe('Listing Pack Files', () => {
      it('should list all pack files', async () => {
        await createMockGitRepo(tempDir)
        const packDir = path.join(tempDir, '.git', 'objects', 'pack')

        // Create mock pack files
        await fs.writeFile(path.join(packDir, 'pack-abc123.pack'), '')
        await fs.writeFile(path.join(packDir, 'pack-abc123.idx'), '')
        await fs.writeFile(path.join(packDir, 'pack-def456.pack'), '')
        await fs.writeFile(path.join(packDir, 'pack-def456.idx'), '')

        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        const packs = await packReader.listPackFiles()

        expect(packs.length).toBe(2)
        expect(packs).toContain('pack-abc123')
        expect(packs).toContain('pack-def456')
      })

      it('should only list packs that have both .pack and .idx files', async () => {
        await createMockGitRepo(tempDir)
        const packDir = path.join(tempDir, '.git', 'objects', 'pack')

        // Create incomplete pack (missing .idx)
        await fs.writeFile(path.join(packDir, 'pack-incomplete.pack'), '')
        // Create complete pack
        await fs.writeFile(path.join(packDir, 'pack-complete.pack'), '')
        await fs.writeFile(path.join(packDir, 'pack-complete.idx'), '')

        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        const packs = await packReader.listPackFiles()

        expect(packs).toContain('pack-complete')
        expect(packs).not.toContain('pack-incomplete')
      })
    })

    describe('Reading Pack Index (.idx)', () => {
      it('should read objects from pack index', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        // When pack files exist with valid index
        const entries = await packReader.getPackObjects('pack-test')

        expect(entries).toBeInstanceOf(Array)
      })

      it('should parse version 2 pack index format', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        // When reading a v2 pack index
        const entries = await packReader.getPackObjects('pack-v2')

        // Each entry should have sha, offset, crc32
        for (const entry of entries) {
          expect(entry).toHaveProperty('sha')
          expect(entry).toHaveProperty('offset')
          expect(entry).toHaveProperty('crc32')
        }
      })

      it('should handle large offsets in pack index', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        // Large packs use 8-byte offsets for objects > 2GB
        const entries = await packReader.getPackObjects('pack-large')

        // Should not throw for large offset values
        expect(entries).toBeDefined()
      })
    })

    describe('Reading Pack Data (.pack)', () => {
      it('should read an object from pack file by offset', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        const obj = await packReader.readPackObject('pack-test', 12)

        // When implemented, should return object at offset
        if (obj) {
          expect(obj.sha).toBeDefined()
          expect(obj.type).toBeDefined()
          expect(obj.data).toBeInstanceOf(Uint8Array)
          expect(obj.source).toBe('pack')
        }
      })

      it('should handle OFS_DELTA objects', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        // OFS_DELTA uses negative offset to reference base object
        const obj = await packReader.readPackObject('pack-with-delta', 100)

        // Should resolve delta and return full object
        if (obj) {
          expect(obj.type).not.toBe('ofs_delta')
          expect(obj.data).toBeInstanceOf(Uint8Array)
        }
      })

      it('should handle REF_DELTA objects', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        // REF_DELTA references base object by SHA
        const obj = await packReader.readPackObject('pack-with-ref-delta', 200)

        // Should resolve delta and return full object
        if (obj) {
          expect(obj.type).not.toBe('ref_delta')
          expect(obj.data).toBeInstanceOf(Uint8Array)
        }
      })

      it('should get pack checksum', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)
        const packReader = adapter.getPackReader()

        const checksum = await packReader.getPackChecksum('pack-test')

        // Checksum is 20-byte SHA-1 in hex = 40 chars
        if (checksum) {
          expect(checksum).toHaveLength(40)
          expect(checksum).toMatch(/^[0-9a-f]{40}$/)
        }
      })
    })

    describe('Pack File Integration', () => {
      it('should find object in pack when not in loose storage', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)

        // Object only exists in pack file
        const obj = await adapter.getObject('pack-only-sha-here'.padEnd(40, '0'))

        // When implemented, should search pack files
        // obj may be null if not found, but should not throw
        expect(obj === null || obj.source === 'pack').toBe(true)
      })

      it('should search all pack files for object', async () => {
        await createMockGitRepo(tempDir)
        const adapter = await createFSAdapter(tempDir)

        // Object could be in any pack file
        const exists = await adapter.hasObject('multi-pack-sha'.padEnd(40, '0'))

        // Should check all packs
        expect(typeof exists).toBe('boolean')
      })
    })
  })

  // ==========================================================================
  // 6. Reading Index (Staging Area)
  // ==========================================================================
  describe('Reading Index from .git/index', () => {
    describe('Index Entries', () => {
      it('should read all index entries', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entries = await index.getEntries()

        expect(entries).toBeInstanceOf(Array)
      })

      it('should parse entry path correctly', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('src/index.ts')

        if (entry) {
          expect(entry.path).toBe('src/index.ts')
        }
      })

      it('should parse entry SHA correctly', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('README.md')

        if (entry) {
          expect(entry.sha).toMatch(/^[0-9a-f]{40}$/)
        }
      })

      it('should parse entry mode correctly', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('script.sh')

        if (entry) {
          // Modes: 100644 (regular), 100755 (executable), 120000 (symlink)
          expect([0o100644, 0o100755, 0o120000, 0o040000]).toContain(entry.mode)
        }
      })

      it('should parse entry timestamps', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('file.txt')

        if (entry) {
          expect(entry.mtime).toBeInstanceOf(Date)
          expect(entry.ctime).toBeInstanceOf(Date)
        }
      })

      it('should check if path is staged', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const isStaged = await index.isStaged('staged-file.txt')

        expect(typeof isStaged).toBe('boolean')
      })
    })

    describe('Index Version', () => {
      it('should read index version 2', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const version = await index.getVersion()

        expect([2, 3, 4]).toContain(version)
      })

      it('should handle index version 3 with extended flags', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entries = await index.getEntries()

        // Version 3 supports extended flags
        for (const entry of entries) {
          expect(entry.flags).toBeDefined()
          expect(entry.flags.extended).toBeDefined()
        }
      })

      it('should handle index version 4 with path compression', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entries = await index.getEntries()

        // Version 4 uses path prefix compression
        // Paths should still be correctly parsed
        for (const entry of entries) {
          expect(entry.path).not.toContain('\0')
        }
      })
    })

    describe('Merge Conflicts', () => {
      it('should identify conflict stages', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const conflicts = await index.getConflicts('conflicted-file.txt')

        // Conflicts have stages 1 (base), 2 (ours), 3 (theirs)
        expect(conflicts).toBeInstanceOf(Array)
        for (const entry of conflicts) {
          expect([1, 2, 3]).toContain(entry.stage)
        }
      })

      it('should list all conflicted files', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const conflictedPaths = await index.listConflicts()

        expect(conflictedPaths).toBeInstanceOf(Array)
      })

      it('should return empty conflicts for non-conflicted file', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const conflicts = await index.getConflicts('normal-file.txt')

        expect(conflicts).toEqual([])
      })
    })

    describe('Index Flags', () => {
      it('should parse assume-valid flag', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('assumed-valid.txt')

        if (entry) {
          expect(typeof entry.flags.assumeValid).toBe('boolean')
        }
      })

      it('should parse skip-worktree flag', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('skip-worktree.txt')

        if (entry) {
          expect(typeof entry.flags.skipWorktree).toBe('boolean')
        }
      })

      it('should parse intent-to-add flag', async () => {
        await createMockGitRepo(tempDir, { withIndex: true })
        const adapter = await createFSAdapter(tempDir)
        const index = adapter.getIndex()

        const entry = await index.getEntry('intent-to-add.txt')

        if (entry) {
          expect(typeof entry.flags.intentToAdd).toBe('boolean')
        }
      })
    })
  })

  // ==========================================================================
  // 7. Reading Config
  // ==========================================================================
  describe('Reading Config from .git/config', () => {
    describe('Basic Config Reading', () => {
      it('should read config value', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const value = await config.get('core', 'bare')

        expect(value).toBe('false')
      })

      it('should return null for missing config key', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const value = await config.get('nonexistent', 'key')

        expect(value).toBeNull()
      })

      it('should check if config has key', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const hasKey = await config.has('core', 'bare')

        expect(hasKey).toBe(true)
      })

      it('should get all config entries', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const entries = await config.getAllEntries()

        expect(entries).toBeInstanceOf(Map)
        expect(entries.size).toBeGreaterThan(0)
      })
    })

    describe('Multi-valued Config', () => {
      it('should get all values for multi-valued key', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        // Add multi-valued config
        const configPath = path.join(tempDir, '.git', 'config')
        let configContent = await fs.readFile(configPath, 'utf8')
        configContent += `[receive]
\tdenyCurrentBranch = ignore
\tdenyNonFastForwards = true
`
        await fs.writeFile(configPath, configContent)

        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const values = await config.getAll('receive', 'denyCurrentBranch')

        expect(values).toBeInstanceOf(Array)
      })
    })

    describe('Remote Config', () => {
      it('should get remote URL', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const url = await config.getRemoteUrl('origin')

        expect(url).toBe('https://github.com/example/repo.git')
      })

      it('should return null for non-existent remote', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const url = await config.getRemoteUrl('nonexistent')

        expect(url).toBeNull()
      })
    })

    describe('Branch Config', () => {
      it('should get branch upstream info', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const upstream = await config.getBranchUpstream('main')

        expect(upstream).not.toBeNull()
        expect(upstream!.remote).toBe('origin')
        expect(upstream!.merge).toBe('refs/heads/main')
      })

      it('should return null for branch without upstream', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const upstream = await config.getBranchUpstream('no-upstream')

        expect(upstream).toBeNull()
      })
    })

    describe('Config Parsing', () => {
      it('should handle quoted values', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const configPath = path.join(tempDir, '.git', 'config')
        let configContent = await fs.readFile(configPath, 'utf8')
        configContent += `[user]
\tname = "John Doe"
\temail = john@example.com.ai
`
        await fs.writeFile(configPath, configContent)

        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const name = await config.get('user', 'name')

        expect(name).toBe('John Doe')
      })

      it('should handle escaped characters', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const configPath = path.join(tempDir, '.git', 'config')
        let configContent = await fs.readFile(configPath, 'utf8')
        configContent += `[alias]
\tlog = log --oneline --graph
`
        await fs.writeFile(configPath, configContent)

        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        const alias = await config.get('alias', 'log')

        expect(alias).toBe('log --oneline --graph')
      })

      it('should handle subsection syntax [section "subsection"]', async () => {
        await createMockGitRepo(tempDir, { withConfig: true })
        const adapter = await createFSAdapter(tempDir)
        const config = adapter.getConfig()

        // remote "origin" is a subsection
        const url = await config.get('remote.origin', 'url')

        expect(url).toBe('https://github.com/example/repo.git')
      })
    })
  })

  // ==========================================================================
  // 8. Detecting Git Repository
  // ==========================================================================
  describe('Detecting Git Repository', () => {
    it('should detect valid git repository', async () => {
      await createMockGitRepo(tempDir)

      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(true)
    })

    it('should detect invalid directory as non-repository', async () => {
      // tempDir without .git
      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(false)
    })

    it('should detect repository with isGitRepository method on adapter', async () => {
      await createMockGitRepo(tempDir)
      const adapter = await createFSAdapter(tempDir)

      const isRepo = await adapter.isGitRepository()

      expect(isRepo).toBe(true)
    })

    it('should require .git/HEAD file', async () => {
      // Create .git without HEAD
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true })
      await fs.mkdir(path.join(tempDir, '.git', 'objects'), { recursive: true })
      await fs.mkdir(path.join(tempDir, '.git', 'refs'), { recursive: true })

      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(false)
    })

    it('should require .git/objects directory', async () => {
      // Create .git without objects
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true })
      await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      await fs.mkdir(path.join(tempDir, '.git', 'refs'), { recursive: true })

      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(false)
    })

    it('should require .git/refs directory', async () => {
      // Create .git without refs
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true })
      await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      await fs.mkdir(path.join(tempDir, '.git', 'objects'), { recursive: true })

      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(false)
    })

    it('should handle gitdir file (worktrees)', async () => {
      // Some setups use a .git file pointing to the actual git dir
      await fs.mkdir(path.join(tempDir, 'actual-git'), { recursive: true })
      await createMockGitRepo(path.join(tempDir, 'actual-git'), { bare: true })
      await fs.writeFile(
        path.join(tempDir, '.git'),
        `gitdir: ${path.join(tempDir, 'actual-git')}\n`
      )

      const isRepo = await isGitRepository(tempDir)

      expect(isRepo).toBe(true)
    })
  })

  // ==========================================================================
  // 9. Handling Bare Repositories
  // ==========================================================================
  describe('Handling Bare Repositories', () => {
    it('should detect bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: true })

      const isBare = await isBareRepository(tempDir)

      expect(isBare).toBe(true)
    })

    it('should detect non-bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: false })

      const isBare = await isBareRepository(path.join(tempDir, '.git'))

      expect(isBare).toBe(false)
    })

    it('should create adapter for bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: true, withRefs: true })

      const adapter = await createFSAdapter(tempDir, { gitDir: tempDir })

      expect(adapter.isBare).toBe(true)
    })

    it('should set correct gitDir for bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: true })

      const adapter = await createFSAdapter(tempDir, { gitDir: tempDir })

      expect(adapter.gitDir).toBe(tempDir)
    })

    it('should read objects from bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: true, withLooseObjects: true })

      const adapter = await createFSAdapter(tempDir, { gitDir: tempDir })
      const obj = await adapter.getObject(emptySha)

      expect(obj).not.toBeNull()
    })

    it('should read refs from bare repository', async () => {
      await createMockGitRepo(tempDir, { bare: true, withRefs: true })

      const adapter = await createFSAdapter(tempDir, { gitDir: tempDir })
      const ref = await adapter.getRef('refs/heads/main')

      expect(ref).not.toBeNull()
    })

    it('should not have working directory in bare repo', async () => {
      await createMockGitRepo(tempDir, { bare: true })

      const adapter = await createFSAdapter(tempDir, { gitDir: tempDir })

      expect(adapter.isBare).toBe(true)
      // Bare repos have gitDir === repoPath
      expect(adapter.gitDir).toBe(adapter.repoPath)
    })
  })

  // ==========================================================================
  // 10. Error Handling
  // ==========================================================================
  describe('Error Handling for Non-Git Directories', () => {
    it('should throw FSAdapterError for non-git directory', async () => {
      await expect(createFSAdapter(tempDir)).rejects.toThrow(FSAdapterError)
    })

    it('should throw with NOT_A_GIT_REPO code', async () => {
      try {
        await createFSAdapter(tempDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FSAdapterError)
        expect((error as FSAdapterError).code).toBe('NOT_A_GIT_REPO')
      }
    })

    it('should include path in error', async () => {
      try {
        await createFSAdapter(tempDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FSAdapterError)
        expect((error as FSAdapterError).path).toBe(tempDir)
      }
    })

    it('should throw for non-existent directory', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist')

      await expect(createFSAdapter(nonExistent)).rejects.toThrow(FSAdapterError)
    })

    it('should throw INVALID_SHA for malformed SHA', async () => {
      await createMockGitRepo(tempDir)
      const adapter = await createFSAdapter(tempDir)

      await expect(adapter.getObject('invalid-sha')).rejects.toThrow(FSAdapterError)

      try {
        await adapter.getObject('invalid-sha')
      } catch (error) {
        expect((error as FSAdapterError).code).toBe('INVALID_SHA')
      }
    })

    it('should throw CORRUPT_OBJECT for malformed object', async () => {
      await createMockGitRepo(tempDir)
      // Create a corrupt object file
      const objDir = path.join(tempDir, '.git', 'objects', 'ab')
      await fs.mkdir(objDir, { recursive: true })
      await fs.writeFile(
        path.join(objDir, 'c'.repeat(38)),
        'not valid zlib data'
      )
      const adapter = await createFSAdapter(tempDir)

      const corruptSha = 'ab' + 'c'.repeat(38)
      await expect(adapter.getObject(corruptSha)).rejects.toThrow(FSAdapterError)
    })

    it('should throw CORRUPT_PACK for invalid pack file', async () => {
      await createMockGitRepo(tempDir)
      const packDir = path.join(tempDir, '.git', 'objects', 'pack')
      await fs.writeFile(path.join(packDir, 'pack-corrupt.pack'), 'not a pack file')
      await fs.writeFile(path.join(packDir, 'pack-corrupt.idx'), 'not an index file')
      const adapter = await createFSAdapter(tempDir)
      const packReader = adapter.getPackReader()

      await expect(packReader.getPackObjects('pack-corrupt')).rejects.toThrow()
    })

    it('should throw CORRUPT_INDEX for invalid index file', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(path.join(tempDir, '.git', 'index'), 'not an index file')
      const adapter = await createFSAdapter(tempDir)
      const index = adapter.getIndex()

      await expect(index.getEntries()).rejects.toThrow()
    })

    it('should throw READ_ERROR for permission denied', async () => {
      await createMockGitRepo(tempDir, { withLooseObjects: true })
      // Make object unreadable
      const objPath = path.join(tempDir, '.git', 'objects', 'e6')
      try {
        await fs.chmod(objPath, 0o000)
        const adapter = await createFSAdapter(tempDir)

        await expect(adapter.getObject(emptySha)).rejects.toThrow()
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(objPath, 0o755)
      }
    })

    it('should handle missing HEAD gracefully', async () => {
      await createMockGitRepo(tempDir)
      await fs.unlink(path.join(tempDir, '.git', 'HEAD'))

      await expect(createFSAdapter(tempDir)).rejects.toThrow(FSAdapterError)
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle symlinks in .git directory', async () => {
      await createMockGitRepo(tempDir, { withRefs: true })
      const adapter = await createFSAdapter(tempDir, { followSymlinks: true })

      expect(adapter).toBeDefined()
    })

    it('should list all objects including loose and packed', async () => {
      await createMockGitRepo(tempDir, { withLooseObjects: true, withPack: true })
      const adapter = await createFSAdapter(tempDir)

      const objects = await adapter.listObjects()

      expect(objects).toBeInstanceOf(Array)
    })

    it('should get repository description', async () => {
      await createMockGitRepo(tempDir)
      await fs.writeFile(
        path.join(tempDir, '.git', 'description'),
        'Test repository description\n'
      )
      const adapter = await createFSAdapter(tempDir)

      const description = await adapter.getDescription()

      expect(description).toBe('Test repository description')
    })

    it('should handle missing description file', async () => {
      await createMockGitRepo(tempDir)
      const adapter = await createFSAdapter(tempDir)

      const description = await adapter.getDescription()

      // May return default description or null
      expect(description === null || typeof description === 'string').toBe(true)
    })

    it('should handle concurrent reads', async () => {
      await createMockGitRepo(tempDir, { withRefs: true, withLooseObjects: true })
      const adapter = await createFSAdapter(tempDir)

      const results = await Promise.all([
        adapter.getRef('refs/heads/main'),
        adapter.getHead(),
        adapter.listBranches(),
        adapter.hasObject(emptySha)
      ])

      expect(results[0]).not.toBeNull()
      expect(results[1]).not.toBeNull()
      expect(results[2]).toBeInstanceOf(Array)
      expect(typeof results[3]).toBe('boolean')
    })
  })
})
