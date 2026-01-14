/**
 * RED Phase Tests: SQLite Schema Verification
 *
 * These tests verify the SQLite schema for FileSystemDO:
 * - files table exists with all required columns
 * - blobs table exists with all required columns
 * - Appropriate indexes exist for performance
 * - Root directory "/" is auto-initialized on DO creation
 *
 * @module tests/schema
 * @see fsx-ljp - RED: Write failing tests for SQLite schema
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// Expected columns for files table
const FILES_TABLE_COLUMNS = [
  'path',
  'name',
  'size',
  'mtime',
  'ctime',
  'type',
  'mode',
  'blob_id',
] as const

// Expected columns for blobs table
const BLOBS_TABLE_COLUMNS = ['id', 'data', 'tier', 'ref_count', 'created_at'] as const

/**
 * Helper to make RPC calls to the FileSystemDO
 */
async function rpc(
  stub: DurableObjectStub,
  method: string,
  params: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const response = await stub.fetch('http://fsx.do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const data = await response.json()
  return { status: response.status, data }
}

describe('FileSystemDO SQLite Schema', () => {
  describe('files table structure (via operations)', () => {
    it('should support file entries with path column', async () => {
      const id = env.FSX.idFromName('schema-test-path')
      const stub = env.FSX.get(id)

      // Create a file to test path storage
      const writeResult = await rpc(stub, 'writeFile', {
        path: '/test-path.txt',
        data: 'dGVzdA==', // "test" in base64
        encoding: 'base64',
      })

      // Should succeed if schema supports path column
      expect(writeResult.status).toBe(200)

      // Verify we can read it back by path
      const readResult = await rpc(stub, 'readFile', {
        path: '/test-path.txt',
      })

      expect(readResult.status).toBe(200)
    })

    it('should support file entries with name column', async () => {
      const id = env.FSX.idFromName('schema-test-name')
      const stub = env.FSX.get(id)

      // Create file
      await rpc(stub, 'writeFile', {
        path: '/my-file-name.txt',
        data: 'dGVzdA==',
        encoding: 'base64',
      })

      // Readdir should return the name
      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })

      expect(readdirResult.status).toBe(200)
      const entries = readdirResult.data as Array<{ name: string }>
      const fileEntry = entries.find((e) => e.name === 'my-file-name.txt')
      expect(fileEntry).toBeDefined()
      expect(fileEntry?.name).toBe('my-file-name.txt')
    })

    it('should support file entries with size column', async () => {
      const id = env.FSX.idFromName('schema-test-size')
      const stub = env.FSX.get(id)

      const content = 'Hello, World!'
      const base64Content = btoa(content)

      await rpc(stub, 'writeFile', {
        path: '/sized-file.txt',
        data: base64Content,
        encoding: 'base64',
      })

      const statResult = await rpc(stub, 'stat', { path: '/sized-file.txt' })

      expect(statResult.status).toBe(200)
      const stats = statResult.data as { size: number }
      expect(stats.size).toBe(content.length)
    })

    it('should support file entries with mtime column', async () => {
      const id = env.FSX.idFromName('schema-test-mtime')
      const stub = env.FSX.get(id)

      const beforeWrite = Date.now()

      await rpc(stub, 'writeFile', {
        path: '/timed-file.txt',
        data: 'dGVzdA==',
        encoding: 'base64',
      })

      const afterWrite = Date.now()

      const statResult = await rpc(stub, 'stat', { path: '/timed-file.txt' })

      expect(statResult.status).toBe(200)
      const stats = statResult.data as { mtime: number }

      // mtime should be between before and after write
      expect(stats.mtime).toBeGreaterThanOrEqual(beforeWrite - 1000)
      expect(stats.mtime).toBeLessThanOrEqual(afterWrite + 1000)
    })

    it('should support file entries with ctime column', async () => {
      const id = env.FSX.idFromName('schema-test-ctime')
      const stub = env.FSX.get(id)

      const beforeWrite = Date.now()

      await rpc(stub, 'writeFile', {
        path: '/ctime-file.txt',
        data: 'dGVzdA==',
        encoding: 'base64',
      })

      const afterWrite = Date.now()

      const statResult = await rpc(stub, 'stat', { path: '/ctime-file.txt' })

      expect(statResult.status).toBe(200)
      const stats = statResult.data as { ctime: number }

      // ctime should be valid
      expect(stats.ctime).toBeGreaterThanOrEqual(beforeWrite - 1000)
      expect(stats.ctime).toBeLessThanOrEqual(afterWrite + 1000)
    })

    it('should support file entries with type column (file)', async () => {
      const id = env.FSX.idFromName('schema-test-type-file')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/typed-file.txt',
        data: 'dGVzdA==',
        encoding: 'base64',
      })

      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })

      expect(readdirResult.status).toBe(200)
      const entries = readdirResult.data as Array<{ name: string; type: string }>
      const fileEntry = entries.find((e) => e.name === 'typed-file.txt')
      expect(fileEntry?.type).toBe('file')
    })

    it('should support file entries with type column (directory)', async () => {
      const id = env.FSX.idFromName('schema-test-type-dir')
      const stub = env.FSX.get(id)

      await rpc(stub, 'mkdir', {
        path: '/typed-dir',
      })

      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })

      expect(readdirResult.status).toBe(200)
      const entries = readdirResult.data as Array<{ name: string; type: string }>
      const dirEntry = entries.find((e) => e.name === 'typed-dir')
      expect(dirEntry?.type).toBe('directory')
    })

    it('should support file entries with mode column', async () => {
      const id = env.FSX.idFromName('schema-test-mode')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/mode-file.txt',
        data: 'dGVzdA==',
        encoding: 'base64',
        mode: 0o644,
      })

      const statResult = await rpc(stub, 'stat', { path: '/mode-file.txt' })

      expect(statResult.status).toBe(200)
      const stats = statResult.data as { mode: number }

      // Mode should include permission bits
      const permBits = stats.mode & 0o777
      expect(permBits).toBe(0o644)
    })

    it('should support file entries with blob_id column (file content storage)', async () => {
      const id = env.FSX.idFromName('schema-test-blob')
      const stub = env.FSX.get(id)

      // Write file with content
      const content = 'Content that should be stored as blob'
      const base64Content = btoa(content)

      await rpc(stub, 'writeFile', {
        path: '/blob-file.txt',
        data: base64Content,
        encoding: 'base64',
      })

      // Read it back - if blob_id column works, content should be retrievable
      const readResult = await rpc(stub, 'readFile', {
        path: '/blob-file.txt',
      })

      expect(readResult.status).toBe(200)
      const result = readResult.data as { data: string; encoding: string }

      // Decode and verify
      const decoded = atob(result.data)
      expect(decoded).toBe(content)
    })

    it('should support file entries with all required columns', async () => {
      const id = env.FSX.idFromName('schema-test-all-files')
      const stub = env.FSX.get(id)

      const beforeWrite = Date.now()

      await rpc(stub, 'writeFile', {
        path: '/complete-file.txt',
        data: btoa('Complete file content'),
        encoding: 'base64',
        mode: 0o755,
      })

      const afterWrite = Date.now()

      // Verify all columns are properly stored via stat
      const statResult = await rpc(stub, 'stat', { path: '/complete-file.txt' })
      expect(statResult.status).toBe(200)

      const stats = statResult.data as {
        size: number
        mtime: number
        ctime: number
        birthtime: number
        mode: number
      }

      // size column
      expect(stats.size).toBe('Complete file content'.length)

      // mtime column
      expect(stats.mtime).toBeGreaterThanOrEqual(beforeWrite - 1000)

      // ctime column
      expect(stats.ctime).toBeGreaterThanOrEqual(beforeWrite - 1000)

      // birthtime column
      expect(stats.birthtime).toBeGreaterThanOrEqual(beforeWrite - 1000)

      // mode column
      expect((stats.mode & 0o777)).toBe(0o755)

      // Verify via readdir for name and type
      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })
      expect(readdirResult.status).toBe(200)

      const entries = readdirResult.data as Array<{ name: string; type: string }>
      const entry = entries.find((e) => e.name === 'complete-file.txt')

      // name column
      expect(entry?.name).toBe('complete-file.txt')

      // type column
      expect(entry?.type).toBe('file')
    })
  })

  describe('blobs table structure (via file operations)', () => {
    it('should store blob data for files', async () => {
      const id = env.FSX.idFromName('schema-test-blob-data')
      const stub = env.FSX.get(id)

      // Create file with specific content
      const content = 'Blob data content'
      await rpc(stub, 'writeFile', {
        path: '/blob-data-test.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      // Read back - if blobs table with data column works, this succeeds
      const readResult = await rpc(stub, 'readFile', { path: '/blob-data-test.txt' })
      expect(readResult.status).toBe(200)

      const result = readResult.data as { data: string }
      expect(atob(result.data)).toBe(content)
    })

    it('should support tier tracking for blobs (via getTier RPC)', async () => {
      const id = env.FSX.idFromName('schema-test-blob-tier')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/tier-test.txt',
        data: btoa('Tier test content'),
        encoding: 'base64',
      })

      // getTier should return tier information if tier column exists
      const tierResult = await rpc(stub, 'getTier', { path: '/tier-test.txt' })

      expect(tierResult.status).toBe(200)
      const result = tierResult.data as { tier: string }

      // Small files should default to 'hot' tier
      expect(['hot', 'warm', 'cold']).toContain(result.tier)
    })

    it('should track blob creation time (created_at column)', async () => {
      const id = env.FSX.idFromName('schema-test-blob-created')
      const stub = env.FSX.get(id)

      const beforeWrite = Date.now()

      await rpc(stub, 'writeFile', {
        path: '/created-at-test.txt',
        data: btoa('Created at test'),
        encoding: 'base64',
      })

      const afterWrite = Date.now()

      // The file should be readable (blobs table working)
      const readResult = await rpc(stub, 'readFile', { path: '/created-at-test.txt' })
      expect(readResult.status).toBe(200)

      // File stat birthtime should reflect when blob was created
      const statResult = await rpc(stub, 'stat', { path: '/created-at-test.txt' })
      expect(statResult.status).toBe(200)

      const stats = statResult.data as { birthtime: number }
      expect(stats.birthtime).toBeGreaterThanOrEqual(beforeWrite - 1000)
      expect(stats.birthtime).toBeLessThanOrEqual(afterWrite + 1000)
    })

    it('should support blob reference counting (ref_count column) via hard links', async () => {
      const id = env.FSX.idFromName('schema-test-blob-refcount')
      const stub = env.FSX.get(id)

      // Create original file
      await rpc(stub, 'writeFile', {
        path: '/original.txt',
        data: btoa('Shared content'),
        encoding: 'base64',
      })

      // Create hard link (should increment ref_count if implemented)
      const linkResult = await rpc(stub, 'link', {
        existingPath: '/original.txt',
        newPath: '/hardlink.txt',
      })

      expect(linkResult.status).toBe(200)

      // Both files should be readable
      const originalRead = await rpc(stub, 'readFile', { path: '/original.txt' })
      const linkRead = await rpc(stub, 'readFile', { path: '/hardlink.txt' })

      expect(originalRead.status).toBe(200)
      expect(linkRead.status).toBe(200)

      // Content should be identical (same blob)
      const originalData = (originalRead.data as { data: string }).data
      const linkData = (linkRead.data as { data: string }).data
      expect(originalData).toBe(linkData)

      // Delete original - link should still work if ref_count is tracked
      await rpc(stub, 'unlink', { path: '/original.txt' })

      const linkStillReadable = await rpc(stub, 'readFile', { path: '/hardlink.txt' })
      expect(linkStillReadable.status).toBe(200)
    })
  })

  describe('index performance (via query patterns)', () => {
    it('should support fast path lookups (path index)', async () => {
      const id = env.FSX.idFromName('schema-test-path-index')
      const stub = env.FSX.get(id)

      // Create multiple files
      for (let i = 0; i < 10; i++) {
        await rpc(stub, 'writeFile', {
          path: `/path-test-${i}.txt`,
          data: btoa(`File ${i}`),
          encoding: 'base64',
        })
      }

      // Path lookup should be fast (index used)
      const startTime = Date.now()
      const statResult = await rpc(stub, 'stat', { path: '/path-test-5.txt' })
      const endTime = Date.now()

      expect(statResult.status).toBe(200)
      // Should complete quickly with index
      expect(endTime - startTime).toBeLessThan(1000)
    })

    it('should support fast directory listings (parent_id index)', async () => {
      const id = env.FSX.idFromName('schema-test-parent-index')
      const stub = env.FSX.get(id)

      // Create nested structure
      await rpc(stub, 'mkdir', { path: '/parent-test', recursive: true })

      for (let i = 0; i < 10; i++) {
        await rpc(stub, 'writeFile', {
          path: `/parent-test/child-${i}.txt`,
          data: btoa(`Child ${i}`),
          encoding: 'base64',
        })
      }

      // Directory listing should be fast (parent_id index used)
      const startTime = Date.now()
      const readdirResult = await rpc(stub, 'readdir', {
        path: '/parent-test',
        withFileTypes: true,
      })
      const endTime = Date.now()

      expect(readdirResult.status).toBe(200)
      const entries = readdirResult.data as Array<{ name: string }>
      expect(entries.length).toBe(10)

      // Should complete quickly with index
      expect(endTime - startTime).toBeLessThan(1000)
    })
  })

  describe('root directory initialization', () => {
    it('should auto-create root directory "/" on DO creation', async () => {
      const id = env.FSX.idFromName('schema-test-root-auto')
      const stub = env.FSX.get(id)

      // First access to new DO should have root directory
      const statResult = await rpc(stub, 'stat', { path: '/' })

      expect(statResult.status).toBe(200)
      const stats = statResult.data as { mode: number; size: number }
      expect(stats).toBeDefined()
    })

    it('should have root directory as type directory', async () => {
      const id = env.FSX.idFromName('schema-test-root-type')
      const stub = env.FSX.get(id)

      // Trigger initialization and check root
      const statResult = await rpc(stub, 'stat', { path: '/' })
      expect(statResult.status).toBe(200)

      // Root should be a directory - check via readdir (works on directories)
      const readdirResult = await rpc(stub, 'readdir', { path: '/' })
      expect(readdirResult.status).toBe(200)
    })

    it('should have root directory with correct permissions (0o755)', async () => {
      const id = env.FSX.idFromName('schema-test-root-perms')
      const stub = env.FSX.get(id)

      const statResult = await rpc(stub, 'stat', { path: '/' })
      expect(statResult.status).toBe(200)

      const stats = statResult.data as { mode: number }
      const permBits = stats.mode & 0o777
      expect(permBits).toBe(0o755)
    })

    it('should have root directory with valid timestamps', async () => {
      const id = env.FSX.idFromName('schema-test-root-times')
      const stub = env.FSX.get(id)

      const beforeAccess = Date.now()

      const statResult = await rpc(stub, 'stat', { path: '/' })

      const afterAccess = Date.now()

      expect(statResult.status).toBe(200)
      const stats = statResult.data as {
        birthtime: number
        mtime: number
        ctime: number
      }

      // Timestamps should be valid
      expect(stats.birthtime).toBeGreaterThan(0)
      expect(stats.mtime).toBeGreaterThan(0)
      expect(stats.ctime).toBeGreaterThan(0)

      // Should be reasonably recent
      expect(stats.birthtime).toBeLessThanOrEqual(afterAccess + 1000)
    })

    it('should not create duplicate root entries on multiple accesses', async () => {
      const id = env.FSX.idFromName('schema-test-root-idempotent')
      const stub = env.FSX.get(id)

      // Access multiple times
      for (let i = 0; i < 3; i++) {
        const statResult = await rpc(stub, 'stat', { path: '/' })
        expect(statResult.status).toBe(200)
      }

      // Root should still be a valid single directory
      const readdirResult = await rpc(stub, 'readdir', { path: '/' })
      expect(readdirResult.status).toBe(200)

      // No error about duplicate roots
      const entries = readdirResult.data as Array<{ name: string }>
      expect(Array.isArray(entries)).toBe(true)
    })

    it('should allow creating files in root directory', async () => {
      const id = env.FSX.idFromName('schema-test-root-writable')
      const stub = env.FSX.get(id)

      // Should be able to create files in root
      const writeResult = await rpc(stub, 'writeFile', {
        path: '/root-file.txt',
        data: btoa('File in root'),
        encoding: 'base64',
      })

      expect(writeResult.status).toBe(200)

      // Verify file exists in root
      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })
      expect(readdirResult.status).toBe(200)

      const entries = readdirResult.data as Array<{ name: string }>
      expect(entries.some((e) => e.name === 'root-file.txt')).toBe(true)
    })

    it('should allow creating directories in root directory', async () => {
      const id = env.FSX.idFromName('schema-test-root-mkdir')
      const stub = env.FSX.get(id)

      // Should be able to create subdirectories
      const mkdirResult = await rpc(stub, 'mkdir', { path: '/subdir' })
      expect(mkdirResult.status).toBe(200)

      // Verify directory exists
      const statResult = await rpc(stub, 'stat', { path: '/subdir' })
      expect(statResult.status).toBe(200)
    })
  })

  describe('schema constraints', () => {
    it('should enforce unique paths (no duplicate files)', async () => {
      const id = env.FSX.idFromName('schema-test-unique-path')
      const stub = env.FSX.get(id)

      // Create a file
      const firstWrite = await rpc(stub, 'writeFile', {
        path: '/unique-test.txt',
        data: btoa('First content'),
        encoding: 'base64',
      })
      expect(firstWrite.status).toBe(200)

      // Overwrite should work (update, not create duplicate)
      const secondWrite = await rpc(stub, 'writeFile', {
        path: '/unique-test.txt',
        data: btoa('Second content'),
        encoding: 'base64',
      })
      expect(secondWrite.status).toBe(200)

      // Read back should get latest content
      const readResult = await rpc(stub, 'readFile', { path: '/unique-test.txt' })
      expect(readResult.status).toBe(200)

      const result = readResult.data as { data: string }
      expect(atob(result.data)).toBe('Second content')

      // Directory listing should show only one file
      const readdirResult = await rpc(stub, 'readdir', { path: '/' })
      expect(readdirResult.status).toBe(200)

      const entries = readdirResult.data as string[]
      const matchingEntries = entries.filter((e) => e === 'unique-test.txt')
      expect(matchingEntries.length).toBe(1)
    })

    it('should require valid path (not null)', async () => {
      const id = env.FSX.idFromName('schema-test-null-path')
      const stub = env.FSX.get(id)

      // Attempt to stat null path should fail
      const statResult = await rpc(stub, 'stat', { path: null as unknown as string })

      // Should get error response
      expect(statResult.status).toBeGreaterThanOrEqual(400)
    })

    it('should support different file types in type column', async () => {
      const id = env.FSX.idFromName('schema-test-types')
      const stub = env.FSX.get(id)

      // Create a regular file
      await rpc(stub, 'writeFile', {
        path: '/regular.txt',
        data: btoa('Regular file'),
        encoding: 'base64',
      })

      // Create a directory
      await rpc(stub, 'mkdir', { path: '/directory' })

      // Create a symlink
      const symlinkResult = await rpc(stub, 'symlink', {
        target: '/regular.txt',
        path: '/symlink.txt',
      })
      expect(symlinkResult.status).toBe(200)

      // Verify all types via readdir with file types
      const readdirResult = await rpc(stub, 'readdir', {
        path: '/',
        withFileTypes: true,
      })
      expect(readdirResult.status).toBe(200)

      const entries = readdirResult.data as Array<{ name: string; type: string }>

      const regularEntry = entries.find((e) => e.name === 'regular.txt')
      const dirEntry = entries.find((e) => e.name === 'directory')
      const symlinkEntry = entries.find((e) => e.name === 'symlink.txt')

      expect(regularEntry?.type).toBe('file')
      expect(dirEntry?.type).toBe('directory')
      expect(symlinkEntry?.type).toBe('symlink')
    })
  })
})
