/**
 * Tests for FsModule - Filesystem capability module with lazy initialization
 *
 * This test file covers:
 * - Lazy initialization (schema creation only on first use)
 * - Root directory auto-creation
 * - File CRUD operations
 * - Directory operations
 * - Tiered storage selection
 * - Error handling for POSIX errors
 *
 * @module durable-object/module.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FsModule, type FsModuleConfig } from './module.js'

// ============================================================================
// Mock SqlStorage Implementation
// ============================================================================

/**
 * Mock SQL result interface
 */
interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Internal file entry for mock storage
 */
interface MockFileEntry {
  id: number
  path: string
  name: string
  parent_id: number | null
  type: 'file' | 'directory' | 'symlink'
  mode: number
  uid: number
  gid: number
  size: number
  blob_id: string | null
  link_target: string | null
  tier: 'hot' | 'warm' | 'cold'
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
}

/**
 * Mock blob entry for mock storage
 */
interface MockBlobEntry {
  id: string
  data: ArrayBuffer | null
  size: number
  tier: 'hot' | 'warm' | 'cold'
  created_at: number
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SQLite behavior
 */
class MockSqlStorage {
  private files: Map<string, MockFileEntry> = new Map()
  private blobs: Map<string, MockBlobEntry> = new Map()
  private nextFileId = 1
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  exec<T = unknown>(sql: string, ...params: unknown[]): MockSqlResult<T> {
    this.execCalls.push({ sql, params })
    const normalizedSql = sql.trim().toLowerCase()

    // Handle CREATE TABLE
    if (normalizedSql.includes('create table')) {
      this.schemaCreated = true
      return this.emptyResult<T>()
    }

    // Handle CREATE INDEX
    if (normalizedSql.includes('create index')) {
      return this.emptyResult<T>()
    }

    // Handle INSERT into files
    if (normalizedSql.includes('insert into files') || normalizedSql.includes('insert or replace into files')) {
      // Check if this is a symlink insert (with link_target)
      if (normalizedSql.includes('link_target')) {
        // INSERT INTO files (..., link_target, ...) VALUES (...)
        // path, name, parent_id, type, mode, uid, gid, size, link_target, tier, atime, mtime, ctime, birthtime, nlink
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: null,
          link_target: params[8] as string | null,
          tier: params[9] as 'hot' | 'warm' | 'cold',
          atime: params[10] as number,
          mtime: params[11] as number,
          ctime: params[12] as number,
          birthtime: params[13] as number,
          nlink: params[14] as number,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      }

      // Check if this has blob_id (15 params: path, name, parent_id, type, mode, uid, gid, size, blob_id, tier, atime, mtime, ctime, birthtime, nlink)
      // or not (14 params: path, name, parent_id, type, mode, uid, gid, size, tier, atime, mtime, ctime, birthtime, nlink)
      if (normalizedSql.includes('blob_id')) {
        // With blob_id (file type)
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: params[8] as string | null,
          tier: params[9] as 'hot' | 'warm' | 'cold',
          atime: params[10] as number,
          mtime: params[11] as number,
          ctime: params[12] as number,
          birthtime: params[13] as number,
          nlink: params[14] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      } else {
        // Without blob_id (directory type)
        const entry: MockFileEntry = {
          id: this.nextFileId++,
          path: params[0] as string,
          name: params[1] as string,
          parent_id: params[2] as number | null,
          type: params[3] as 'file' | 'directory' | 'symlink',
          mode: params[4] as number,
          uid: params[5] as number,
          gid: params[6] as number,
          size: params[7] as number,
          blob_id: null,
          tier: params[8] as 'hot' | 'warm' | 'cold', // Shifted by 1 - no blob_id
          atime: params[9] as number,
          mtime: params[10] as number,
          ctime: params[11] as number,
          birthtime: params[12] as number,
          nlink: params[13] as number,
          link_target: null,
        }
        this.files.set(entry.path, entry)
        return this.emptyResult<T>()
      }
    }

    // Handle INSERT into blobs
    if (normalizedSql.includes('insert') && normalizedSql.includes('blobs')) {
      const entry: MockBlobEntry = {
        id: params[0] as string,
        data: params[1] as ArrayBuffer | null,
        size: params[2] as number,
        tier: params[3] as 'hot' | 'warm' | 'cold',
        created_at: params[4] as number,
      }
      this.blobs.set(entry.id, entry)
      return this.emptyResult<T>()
    }

    // Handle SELECT from files WHERE path = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path')) {
      const path = params[0] as string
      const file = this.files.get(path)
      return {
        one: () => (file as T) || null,
        toArray: () => (file ? [file as T] : []),
      }
    }

    // Handle SELECT from files WHERE parent_id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where parent_id')) {
      const parentId = params[0] as number
      const children: MockFileEntry[] = []
      for (const file of this.files.values()) {
        if (file.parent_id === parentId) {
          children.push(file)
        }
      }
      return {
        one: () => (children[0] as T) || null,
        toArray: () => children as T[],
      }
    }

    // Handle SELECT from files WHERE path LIKE ? (for directory rename)
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path like')) {
      const pattern = params[0] as string
      const prefix = pattern.replace(/%$/, '')
      const matches: MockFileEntry[] = []
      for (const file of this.files.values()) {
        if (file.path.startsWith(prefix)) {
          matches.push(file)
        }
      }
      return {
        one: () => (matches[0] as T) || null,
        toArray: () => matches as T[],
      }
    }

    // Handle SELECT from blobs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from blobs') && normalizedSql.includes('where id')) {
      const id = params[0] as string
      const blob = this.blobs.get(id)
      return {
        one: () => (blob ? ({ data: blob.data } as T) : null),
        toArray: () => (blob ? [{ data: blob.data } as T] : []),
      }
    }

    // Handle UPDATE files
    if (normalizedSql.includes('update files')) {
      const id = params[params.length - 1] as number
      for (const [path, file] of this.files.entries()) {
        if (file.id === id) {
          // Parse SET clause and update fields based on the SQL pattern
          if (normalizedSql.includes('set path') && normalizedSql.includes('name') && normalizedSql.includes('parent_id')) {
            // UPDATE files SET path = ?, name = ?, parent_id = ?, ctime = ? WHERE id = ?
            const newPath = params[0] as string
            const newName = params[1] as string
            const newParentId = params[2] as number | null
            const newCtime = params[3] as number

            // Remove from old path and add to new path
            this.files.delete(path)
            file.path = newPath
            file.name = newName
            file.parent_id = newParentId
            file.ctime = newCtime
            this.files.set(newPath, file)
          } else if (normalizedSql.includes('set path') && !normalizedSql.includes('name')) {
            // UPDATE files SET path = ? WHERE id = ?
            const newPath = params[0] as string

            // Remove from old path and add to new path
            this.files.delete(path)
            file.path = newPath
            this.files.set(newPath, file)
          } else if (normalizedSql.includes('set blob_id') && normalizedSql.includes('tier') && params.length === 3) {
            // UPDATE files SET blob_id = ?, tier = ? WHERE id = ? (promote/demote)
            file.blob_id = params[0] as string
            file.tier = params[1] as 'hot' | 'warm' | 'cold'
          } else if (normalizedSql.includes('set blob_id') && normalizedSql.includes('size') && params.length === 6) {
            // UPDATE files SET blob_id = ?, size = ?, tier = ?, mtime = ?, ctime = ? WHERE id = ?
            file.blob_id = params[0] as string
            file.size = params[1] as number
            file.tier = params[2] as 'hot' | 'warm' | 'cold'
            file.mtime = params[3] as number
            file.ctime = params[4] as number
          } else if (normalizedSql.includes('set atime') && normalizedSql.includes('mtime') && normalizedSql.includes('ctime')) {
            // UPDATE files SET atime = ?, mtime = ?, ctime = ? WHERE id = ?
            file.atime = params[0] as number
            file.mtime = params[1] as number
            file.ctime = params[2] as number
          } else if (normalizedSql.includes('set atime') && !normalizedSql.includes('mtime')) {
            // UPDATE files SET atime = ? WHERE id = ?
            file.atime = params[0] as number
          } else if (normalizedSql.includes('set mode')) {
            file.mode = params[0] as number
            file.ctime = params[1] as number
          } else if (normalizedSql.includes('set uid')) {
            file.uid = params[0] as number
            file.gid = params[1] as number
            file.ctime = params[2] as number
          } else if (normalizedSql.includes('set nlink')) {
            // UPDATE files SET nlink = nlink + 1 WHERE id = ?
            file.nlink = (file.nlink || 1) + 1
          }
          break
        }
      }
      return this.emptyResult<T>()
    }

    // Handle DELETE from files
    if (normalizedSql.includes('delete from files')) {
      const id = params[0] as number
      for (const [path, file] of this.files.entries()) {
        if (file.id === id) {
          this.files.delete(path)
          break
        }
      }
      return this.emptyResult<T>()
    }

    // Handle DELETE from blobs
    if (normalizedSql.includes('delete from blobs')) {
      const id = params[0] as string
      this.blobs.delete(id)
      return this.emptyResult<T>()
    }

    return this.emptyResult<T>()
  }

  private emptyResult<T>(): MockSqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  // Test helpers
  getFile(path: string): MockFileEntry | undefined {
    return this.files.get(path)
  }

  getBlob(id: string): MockBlobEntry | undefined {
    return this.blobs.get(id)
  }

  getFileCount(): number {
    return this.files.size
  }

  getBlobCount(): number {
    return this.blobs.size
  }

  clear(): void {
    this.files.clear()
    this.blobs.clear()
    this.execCalls = []
    this.schemaCreated = false
    this.nextFileId = 1
  }
}

/**
 * Mock R2 bucket for testing tiered storage
 */
class MockR2Bucket {
  private objects: Map<string, Uint8Array> = new Map()

  async put(key: string, value: Uint8Array | ArrayBuffer | string): Promise<void> {
    if (typeof value === 'string') {
      this.objects.set(key, new TextEncoder().encode(value))
    } else if (value instanceof ArrayBuffer) {
      this.objects.set(key, new Uint8Array(value))
    } else {
      this.objects.set(key, value)
    }
  }

  async get(key: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> {
    const data = this.objects.get(key)
    if (!data) return null
    return {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  clear(): void {
    this.objects.clear()
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('FsModule', () => {
  let mockSql: MockSqlStorage
  let mockR2: MockR2Bucket
  let fsModule: FsModule

  beforeEach(() => {
    mockSql = new MockSqlStorage()
    mockR2 = new MockR2Bucket()
    fsModule = new FsModule({
      sql: mockSql as unknown as SqlStorage,
      r2: mockR2 as unknown as R2Bucket,
    })
  })

  // ==========================================================================
  // Lazy Initialization Tests
  // ==========================================================================

  describe('lazy initialization', () => {
    it('should not execute any SQL until first operation', () => {
      // Just creating the module should not trigger any SQL
      const freshModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
      })

      expect(mockSql.execCalls.length).toBe(0)
      expect(mockSql.schemaCreated).toBe(false)
    })

    it('should create schema on first read operation', async () => {
      expect(mockSql.schemaCreated).toBe(false)

      // This will fail with ENOENT, but should still initialize
      try {
        await fsModule.read('/nonexistent.txt')
      } catch {
        // Expected ENOENT error
      }

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should create schema on first write operation', async () => {
      expect(mockSql.schemaCreated).toBe(false)

      await fsModule.write('/test.txt', 'Hello, World!')

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should create schema on first mkdir operation', async () => {
      expect(mockSql.schemaCreated).toBe(false)

      await fsModule.mkdir('/newdir')

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should create schema on first stat operation', async () => {
      expect(mockSql.schemaCreated).toBe(false)

      try {
        await fsModule.stat('/nonexistent')
      } catch {
        // Expected ENOENT error
      }

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should create schema on first exists check', async () => {
      expect(mockSql.schemaCreated).toBe(false)

      await fsModule.exists('/anything')

      expect(mockSql.schemaCreated).toBe(true)
    })

    it('should only create schema once across multiple operations', async () => {
      const initialCalls = mockSql.execCalls.length

      // Multiple operations
      await fsModule.exists('/test1')
      await fsModule.exists('/test2')
      await fsModule.mkdir('/dir1')

      // Count CREATE TABLE statements
      const createTableCalls = mockSql.execCalls.filter((c) => c.sql.toLowerCase().includes('create table'))

      // Should only have one schema creation (files + blobs = 2 tables, but in single statement)
      expect(createTableCalls.length).toBeLessThanOrEqual(1)
    })

    it('should create root directory on first initialization', async () => {
      await fsModule.exists('/')

      const root = mockSql.getFile('/')
      expect(root).toBeDefined()
      expect(root?.type).toBe('directory')
      expect(root?.path).toBe('/')
    })

    it('should not recreate root directory on subsequent operations', async () => {
      await fsModule.exists('/')
      const rootId1 = mockSql.getFile('/')?.id

      await fsModule.exists('/')
      const rootId2 = mockSql.getFile('/')?.id

      expect(rootId1).toBe(rootId2)
    })
  })

  // ==========================================================================
  // File Operations Tests
  // ==========================================================================

  describe('file operations', () => {
    beforeEach(async () => {
      // Initialize the module first
      await fsModule.exists('/')
    })

    describe('write', () => {
      it('should write string content as UTF-8', async () => {
        await fsModule.write('/test.txt', 'Hello, World!')

        const file = mockSql.getFile('/test.txt')
        expect(file).toBeDefined()
        expect(file?.type).toBe('file')
        expect(file?.size).toBe(13) // "Hello, World!" is 13 bytes in UTF-8
      })

      it('should write binary content', async () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
        await fsModule.write('/binary.bin', data)

        const file = mockSql.getFile('/binary.bin')
        expect(file).toBeDefined()
        expect(file?.size).toBe(4)
      })

      it('should create blob for file content', async () => {
        await fsModule.write('/test.txt', 'Content')

        const file = mockSql.getFile('/test.txt')
        expect(file?.blob_id).toBeDefined()

        const blob = mockSql.getBlob(file!.blob_id!)
        expect(blob).toBeDefined()
        expect(blob?.size).toBe(7)
      })

      it('should select hot tier for small files', async () => {
        await fsModule.write('/small.txt', 'Small content')

        const file = mockSql.getFile('/small.txt')
        expect(file?.tier).toBe('hot')
      })

      it('should update existing file', async () => {
        await fsModule.write('/test.txt', 'Original')
        const file1 = mockSql.getFile('/test.txt')
        const blobId1 = file1?.blob_id

        await fsModule.write('/test.txt', 'Updated content')
        const file2 = mockSql.getFile('/test.txt')

        expect(file2?.blob_id).not.toBe(blobId1)
        expect(file2?.size).toBe(15)
      })

      it('should throw ENOENT when parent directory does not exist', async () => {
        await expect(fsModule.write('/nonexistent/test.txt', 'Content')).rejects.toThrow()
      })

      it('should support exclusive write flag', async () => {
        await fsModule.write('/existing.txt', 'First')

        // Should throw when trying to exclusively create existing file
        await expect(fsModule.write('/existing.txt', 'Second', { flag: 'wx' })).rejects.toThrow()
      })
    })

    describe('read', () => {
      it('should read file content as Uint8Array by default', async () => {
        await fsModule.write('/test.txt', 'Hello')
        const content = await fsModule.read('/test.txt')

        expect(content).toBeInstanceOf(Uint8Array)
      })

      it('should read file content as string with encoding option', async () => {
        await fsModule.write('/test.txt', 'Hello')
        const content = await fsModule.read('/test.txt', { encoding: 'utf-8' })

        expect(typeof content).toBe('string')
        expect(content).toBe('Hello')
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.read('/nonexistent.txt')).rejects.toThrow()
      })

      it('should throw EISDIR when reading a directory', async () => {
        await fsModule.mkdir('/testdir')

        await expect(fsModule.read('/testdir')).rejects.toThrow()
      })

      it('should return empty content for empty file', async () => {
        await fsModule.write('/empty.txt', '')
        const content = await fsModule.read('/empty.txt', { encoding: 'utf-8' })

        expect(content).toBe('')
      })
    })

    describe('unlink', () => {
      it('should delete a file', async () => {
        await fsModule.write('/test.txt', 'Content')
        expect(mockSql.getFile('/test.txt')).toBeDefined()

        await fsModule.unlink('/test.txt')
        expect(mockSql.getFile('/test.txt')).toBeUndefined()
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.unlink('/nonexistent.txt')).rejects.toThrow()
      })

      it('should throw EISDIR when trying to unlink a directory', async () => {
        await fsModule.mkdir('/testdir')

        await expect(fsModule.unlink('/testdir')).rejects.toThrow()
      })
    })

    describe('append', () => {
      it('should append to existing file', async () => {
        await fsModule.write('/log.txt', 'Line 1\n')
        await fsModule.append('/log.txt', 'Line 2\n')

        const content = await fsModule.read('/log.txt', { encoding: 'utf-8' })
        expect(content).toBe('Line 1\nLine 2\n')
      })

      it('should create file if it does not exist', async () => {
        await fsModule.append('/new.txt', 'Content')

        const file = mockSql.getFile('/new.txt')
        expect(file).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // Directory Operations Tests
  // ==========================================================================

  describe('directory operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('mkdir', () => {
      it('should create a directory', async () => {
        await fsModule.mkdir('/newdir')

        const dir = mockSql.getFile('/newdir')
        expect(dir).toBeDefined()
        expect(dir?.type).toBe('directory')
      })

      it('should create nested directories with recursive option', async () => {
        await fsModule.mkdir('/a/b/c', { recursive: true })

        expect(mockSql.getFile('/a')).toBeDefined()
        expect(mockSql.getFile('/a/b')).toBeDefined()
        expect(mockSql.getFile('/a/b/c')).toBeDefined()
      })

      it('should throw ENOENT without recursive option when parent missing', async () => {
        await expect(fsModule.mkdir('/missing/child')).rejects.toThrow()
      })

      it('should throw EEXIST when directory already exists', async () => {
        await fsModule.mkdir('/existing')

        await expect(fsModule.mkdir('/existing')).rejects.toThrow()
      })

      it('should apply custom mode', async () => {
        await fsModule.mkdir('/private', { mode: 0o700 })

        const dir = mockSql.getFile('/private')
        expect(dir?.mode).toBe(0o700)
      })
    })

    describe('rmdir', () => {
      it('should remove an empty directory', async () => {
        await fsModule.mkdir('/emptydir')
        await fsModule.rmdir('/emptydir')

        expect(mockSql.getFile('/emptydir')).toBeUndefined()
      })

      it('should throw ENOENT for non-existent directory', async () => {
        await expect(fsModule.rmdir('/nonexistent')).rejects.toThrow()
      })

      it('should throw ENOTDIR when path is a file', async () => {
        await fsModule.write('/file.txt', 'content')

        await expect(fsModule.rmdir('/file.txt')).rejects.toThrow()
      })
    })

    describe('readdir', () => {
      it('should list directory contents', async () => {
        await fsModule.mkdir('/dir')
        await fsModule.write('/dir/file1.txt', 'content1')
        await fsModule.write('/dir/file2.txt', 'content2')

        const entries = await fsModule.readdir('/dir')

        expect(entries).toHaveLength(2)
        expect(entries).toContain('file1.txt')
        expect(entries).toContain('file2.txt')
      })

      it('should return Dirent objects with withFileTypes option', async () => {
        await fsModule.mkdir('/dir')
        await fsModule.write('/dir/file.txt', 'content')
        await fsModule.mkdir('/dir/subdir')

        const entries = (await fsModule.readdir('/dir', { withFileTypes: true })) as Array<{
          name: string
          isFile: () => boolean
          isDirectory: () => boolean
        }>

        expect(entries).toHaveLength(2)

        const file = entries.find((e) => e.name === 'file.txt')
        const subdir = entries.find((e) => e.name === 'subdir')

        expect(file?.isFile()).toBe(true)
        expect(subdir?.isDirectory()).toBe(true)
      })

      it('should throw ENOENT for non-existent directory', async () => {
        await expect(fsModule.readdir('/nonexistent')).rejects.toThrow()
      })

      it('should throw ENOTDIR when path is a file', async () => {
        await fsModule.write('/file.txt', 'content')

        await expect(fsModule.readdir('/file.txt')).rejects.toThrow()
      })
    })
  })

  // ==========================================================================
  // Metadata Operations Tests
  // ==========================================================================

  describe('metadata operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('stat', () => {
      it('should return stats for a file', async () => {
        await fsModule.write('/test.txt', 'Hello')

        const stats = await fsModule.stat('/test.txt')

        expect(stats.isFile()).toBe(true)
        expect(stats.isDirectory()).toBe(false)
        expect(stats.size).toBe(5)
      })

      it('should return stats for a directory', async () => {
        await fsModule.mkdir('/testdir')

        const stats = await fsModule.stat('/testdir')

        expect(stats.isFile()).toBe(false)
        expect(stats.isDirectory()).toBe(true)
      })

      it('should throw ENOENT for non-existent path', async () => {
        await expect(fsModule.stat('/nonexistent')).rejects.toThrow()
      })

      it('should include timestamps', async () => {
        await fsModule.write('/test.txt', 'content')

        const stats = await fsModule.stat('/test.txt')

        expect(stats.atime).toBeInstanceOf(Date)
        expect(stats.mtime).toBeInstanceOf(Date)
        expect(stats.ctime).toBeInstanceOf(Date)
        expect(stats.birthtime).toBeInstanceOf(Date)
      })
    })

    describe('exists', () => {
      it('should return true for existing file', async () => {
        await fsModule.write('/test.txt', 'content')

        expect(await fsModule.exists('/test.txt')).toBe(true)
      })

      it('should return true for existing directory', async () => {
        await fsModule.mkdir('/testdir')

        expect(await fsModule.exists('/testdir')).toBe(true)
      })

      it('should return false for non-existent path', async () => {
        expect(await fsModule.exists('/nonexistent')).toBe(false)
      })

      it('should return true for root directory', async () => {
        expect(await fsModule.exists('/')).toBe(true)
      })
    })

    describe('access', () => {
      it('should succeed for existing file', async () => {
        await fsModule.write('/test.txt', 'content')

        await expect(fsModule.access('/test.txt')).resolves.not.toThrow()
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.access('/nonexistent')).rejects.toThrow()
      })
    })

    describe('chmod', () => {
      it('should change file permissions', async () => {
        await fsModule.write('/test.txt', 'content')
        await fsModule.chmod('/test.txt', 0o755)

        const stats = await fsModule.stat('/test.txt')
        // Mode includes file type bits, so we need to mask them
        expect(stats.mode & 0o777).toBe(0o755)
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.chmod('/nonexistent', 0o644)).rejects.toThrow()
      })
    })
  })

  // ==========================================================================
  // Path Normalization Tests
  // ==========================================================================

  describe('path normalization', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should handle relative paths', async () => {
      await fsModule.write('test.txt', 'content')

      expect(await fsModule.exists('/test.txt')).toBe(true)
    })

    it('should handle trailing slashes', async () => {
      await fsModule.mkdir('/testdir')

      expect(await fsModule.exists('/testdir/')).toBe(true)
    })

    it('should handle double slashes', async () => {
      await fsModule.mkdir('/testdir')

      expect(await fsModule.exists('//testdir')).toBe(true)
    })

    it('should resolve dot segments', async () => {
      await fsModule.mkdir('/a')
      await fsModule.mkdir('/a/b')

      expect(await fsModule.exists('/a/./b')).toBe(true)
    })

    it('should resolve double dot segments', async () => {
      await fsModule.mkdir('/a')
      await fsModule.mkdir('/a/b')

      expect(await fsModule.exists('/a/b/../b')).toBe(true)
    })
  })

  // ==========================================================================
  // Tiered Storage Tests
  // ==========================================================================

  describe('tiered storage', () => {
    it('should use hot tier for files under threshold', async () => {
      const smallContent = 'Small file content'
      await fsModule.write('/small.txt', smallContent)

      const file = mockSql.getFile('/small.txt')
      expect(file?.tier).toBe('hot')
    })

    it('should store blob data in SQLite for hot tier', async () => {
      await fsModule.write('/hot.txt', 'Hot tier content')

      const file = mockSql.getFile('/hot.txt')
      const blob = mockSql.getBlob(file!.blob_id!)

      expect(blob?.data).toBeDefined()
    })

    it('should allow explicit tier selection', async () => {
      await fsModule.write('/warm.txt', 'Content', { tier: 'warm' })

      const file = mockSql.getFile('/warm.txt')
      expect(file?.tier).toBe('warm')
    })
  })

  // ==========================================================================
  // Module Configuration Tests
  // ==========================================================================

  describe('module configuration', () => {
    it('should accept custom hot tier max size', async () => {
      const customModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
        hotMaxSize: 100, // 100 bytes
      })

      // Large content that exceeds threshold
      const largeContent = 'x'.repeat(200)
      await customModule.write('/large.txt', largeContent)

      const file = mockSql.getFile('/large.txt')
      // Without R2, should still use hot tier
      expect(file?.tier).toBe('hot')
    })

    it('should accept custom default file mode', async () => {
      const customModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
        defaultMode: 0o600,
      })

      await customModule.write('/private.txt', 'secret')

      const file = mockSql.getFile('/private.txt')
      expect(file?.mode).toBe(0o600)
    })

    it('should accept custom default directory mode', async () => {
      const customModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
        defaultDirMode: 0o700,
      })

      await customModule.mkdir('/private')

      const dir = mockSql.getFile('/private')
      expect(dir?.mode).toBe(0o700)
    })

    it('should accept custom base path', async () => {
      const customModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
        basePath: '/app',
      })

      // Initialize to create root and /app
      await customModule.mkdir('/app', { recursive: true })
      await customModule.write('test.txt', 'content')

      // File should be at /app/test.txt
      expect(mockSql.getFile('/app/test.txt')).toBeDefined()
    })
  })

  // ==========================================================================
  // Dispose Tests
  // ==========================================================================

  describe('dispose', () => {
    it('should complete without error', async () => {
      await fsModule.exists('/') // Initialize first

      await expect(fsModule.dispose()).resolves.not.toThrow()
    })
  })

  // ==========================================================================
  // Symbolic Link Operations Tests
  // ==========================================================================

  describe('symbolic link operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('symlink', () => {
      it('should create a symbolic link', async () => {
        await fsModule.write('/target.txt', 'Target content')
        await fsModule.symlink('/target.txt', '/link.txt')

        const link = mockSql.getFile('/link.txt')
        expect(link).toBeDefined()
        expect(link?.type).toBe('symlink')
        expect(link?.link_target).toBe('/target.txt')
      })

      it('should allow symlink to non-existent target', async () => {
        // Symlinks can point to non-existent files (dangling symlinks)
        await fsModule.symlink('/nonexistent.txt', '/dangling-link.txt')

        const link = mockSql.getFile('/dangling-link.txt')
        expect(link).toBeDefined()
        expect(link?.type).toBe('symlink')
        expect(link?.link_target).toBe('/nonexistent.txt')
      })

      it('should throw EEXIST when link path already exists', async () => {
        await fsModule.write('/existing.txt', 'content')

        await expect(fsModule.symlink('/target.txt', '/existing.txt')).rejects.toThrow()
      })

      it('should throw ENOENT when parent directory does not exist', async () => {
        await expect(fsModule.symlink('/target.txt', '/nonexistent/link.txt')).rejects.toThrow()
      })

      it('should set symlink mode to 0o777', async () => {
        await fsModule.write('/target.txt', 'content')
        await fsModule.symlink('/target.txt', '/link.txt')

        const link = mockSql.getFile('/link.txt')
        expect(link?.mode).toBe(0o777)
      })
    })

    describe('readlink', () => {
      it('should return the target path of a symlink', async () => {
        await fsModule.write('/target.txt', 'content')
        await fsModule.symlink('/target.txt', '/link.txt')

        const target = await fsModule.readlink('/link.txt')
        expect(target).toBe('/target.txt')
      })

      it('should throw ENOENT for non-existent path', async () => {
        await expect(fsModule.readlink('/nonexistent.txt')).rejects.toThrow()
      })

      it('should throw EINVAL when path is not a symlink', async () => {
        await fsModule.write('/regular.txt', 'content')

        await expect(fsModule.readlink('/regular.txt')).rejects.toThrow()
      })
    })

    describe('realpath', () => {
      it('should return the path for regular files', async () => {
        await fsModule.write('/regular.txt', 'content')

        const real = await fsModule.realpath('/regular.txt')
        expect(real).toBe('/regular.txt')
      })

      it('should throw ENOENT for non-existent path', async () => {
        await expect(fsModule.realpath('/nonexistent.txt')).rejects.toThrow()
      })
    })

    describe('link (hard link)', () => {
      it('should create a hard link', async () => {
        await fsModule.write('/original.txt', 'content')
        await fsModule.link('/original.txt', '/hardlink.txt')

        const hardlink = mockSql.getFile('/hardlink.txt')
        expect(hardlink).toBeDefined()
        expect(hardlink?.type).toBe('file')
        // Hard links share the same blob_id
        const original = mockSql.getFile('/original.txt')
        expect(hardlink?.blob_id).toBe(original?.blob_id)
      })

      it('should have matching nlink count on both files', async () => {
        await fsModule.write('/original.txt', 'content')

        await fsModule.link('/original.txt', '/hardlink.txt')

        const original = mockSql.getFile('/original.txt')
        const hardlink = mockSql.getFile('/hardlink.txt')

        // After creating a hard link, both files should have nlink >= 2
        expect(original?.nlink).toBeGreaterThanOrEqual(2)
        // Hardlink nlink should be >= 2 as well
        expect(hardlink?.nlink).toBeGreaterThanOrEqual(2)
      })

      it('should throw ENOENT when source does not exist', async () => {
        await expect(fsModule.link('/nonexistent.txt', '/link.txt')).rejects.toThrow()
      })

      it('should throw EEXIST when destination already exists', async () => {
        await fsModule.write('/original.txt', 'content')
        await fsModule.write('/existing.txt', 'other')

        await expect(fsModule.link('/original.txt', '/existing.txt')).rejects.toThrow()
      })
    })
  })

  // ==========================================================================
  // File Rename and Copy Operations Tests
  // ==========================================================================

  describe('rename and copy operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('rename', () => {
      it('should rename a file', async () => {
        await fsModule.write('/old.txt', 'content')
        await fsModule.rename('/old.txt', '/new.txt')

        expect(mockSql.getFile('/old.txt')).toBeUndefined()
        expect(mockSql.getFile('/new.txt')).toBeDefined()
      })

      it('should preserve file content after rename', async () => {
        await fsModule.write('/old.txt', 'Important content')
        await fsModule.rename('/old.txt', '/new.txt')

        const content = await fsModule.read('/new.txt', { encoding: 'utf-8' })
        expect(content).toBe('Important content')
      })

      it('should throw ENOENT when source does not exist', async () => {
        await expect(fsModule.rename('/nonexistent.txt', '/new.txt')).rejects.toThrow()
      })

      it('should throw ENOENT when destination parent does not exist', async () => {
        await fsModule.write('/file.txt', 'content')

        await expect(fsModule.rename('/file.txt', '/nonexistent/file.txt')).rejects.toThrow()
      })

      it('should throw EEXIST when destination exists without overwrite option', async () => {
        await fsModule.write('/source.txt', 'source')
        await fsModule.write('/dest.txt', 'dest')

        await expect(fsModule.rename('/source.txt', '/dest.txt')).rejects.toThrow()
      })

      it('should overwrite destination with overwrite option', async () => {
        await fsModule.write('/source.txt', 'source content')
        await fsModule.write('/dest.txt', 'dest content')

        await fsModule.rename('/source.txt', '/dest.txt', { overwrite: true })

        expect(mockSql.getFile('/source.txt')).toBeUndefined()
        const content = await fsModule.read('/dest.txt', { encoding: 'utf-8' })
        expect(content).toBe('source content')
      })

      it('should rename directory', async () => {
        await fsModule.mkdir('/olddir')
        await fsModule.rename('/olddir', '/newdir')

        expect(mockSql.getFile('/olddir')).toBeUndefined()
        expect(mockSql.getFile('/newdir')).toBeDefined()
        expect(mockSql.getFile('/newdir')?.type).toBe('directory')
      })
    })

    describe('copyFile', () => {
      it('should copy a file', async () => {
        await fsModule.write('/original.txt', 'original content')
        await fsModule.copyFile('/original.txt', '/copy.txt')

        expect(mockSql.getFile('/original.txt')).toBeDefined()
        expect(mockSql.getFile('/copy.txt')).toBeDefined()
      })

      it('should preserve content in copy', async () => {
        await fsModule.write('/original.txt', 'content to copy')
        await fsModule.copyFile('/original.txt', '/copy.txt')

        const originalContent = await fsModule.read('/original.txt', { encoding: 'utf-8' })
        const copyContent = await fsModule.read('/copy.txt', { encoding: 'utf-8' })
        expect(copyContent).toBe(originalContent)
      })

      it('should create independent copy', async () => {
        await fsModule.write('/original.txt', 'original')
        await fsModule.copyFile('/original.txt', '/copy.txt')

        // Modify original
        await fsModule.write('/original.txt', 'modified')

        // Copy should be unchanged
        const copyContent = await fsModule.read('/copy.txt', { encoding: 'utf-8' })
        expect(copyContent).toBe('original')
      })

      it('should throw ENOENT when source does not exist', async () => {
        await expect(fsModule.copyFile('/nonexistent.txt', '/copy.txt')).rejects.toThrow()
      })

      it('should throw EEXIST when destination exists without overwrite', async () => {
        await fsModule.write('/source.txt', 'source')
        await fsModule.write('/dest.txt', 'dest')

        await expect(fsModule.copyFile('/source.txt', '/dest.txt')).rejects.toThrow()
      })

      it('should overwrite destination with overwrite option', async () => {
        await fsModule.write('/source.txt', 'source content')
        await fsModule.write('/dest.txt', 'old dest content')

        await fsModule.copyFile('/source.txt', '/dest.txt', { overwrite: true })

        const content = await fsModule.read('/dest.txt', { encoding: 'utf-8' })
        expect(content).toBe('source content')
      })
    })
  })

  // ==========================================================================
  // Truncate Operations Tests
  // ==========================================================================

  describe('truncate operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should truncate file to specified length', async () => {
      await fsModule.write('/file.txt', 'Hello, World!')
      await fsModule.truncate('/file.txt', 5)

      const content = await fsModule.read('/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('Hello')
    })

    it('should truncate file to zero length', async () => {
      await fsModule.write('/file.txt', 'content')
      await fsModule.truncate('/file.txt', 0)

      const content = await fsModule.read('/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('')
    })

    it('should update file size after truncate', async () => {
      await fsModule.write('/file.txt', 'Hello, World!')
      await fsModule.truncate('/file.txt', 5)

      const stats = await fsModule.stat('/file.txt')
      expect(stats.size).toBe(5)
    })

    it('should throw ENOENT for non-existent file', async () => {
      await expect(fsModule.truncate('/nonexistent.txt', 10)).rejects.toThrow()
    })

    it('should throw EISDIR for directories', async () => {
      await fsModule.mkdir('/testdir')

      await expect(fsModule.truncate('/testdir', 10)).rejects.toThrow()
    })
  })

  // ==========================================================================
  // File utimes Operations Tests
  // ==========================================================================

  describe('utimes operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should update access and modification times', async () => {
      await fsModule.write('/file.txt', 'content')
      const newAtime = new Date('2024-01-15T10:00:00Z')
      const newMtime = new Date('2024-01-15T11:00:00Z')

      await fsModule.utimes('/file.txt', newAtime, newMtime)

      const stats = await fsModule.stat('/file.txt')
      expect(stats.atimeMs).toBe(newAtime.getTime())
      expect(stats.mtimeMs).toBe(newMtime.getTime())
    })

    it('should accept numeric timestamps', async () => {
      await fsModule.write('/file.txt', 'content')
      const newAtime = Date.now() - 10000
      const newMtime = Date.now() - 5000

      await fsModule.utimes('/file.txt', newAtime, newMtime)

      const stats = await fsModule.stat('/file.txt')
      expect(stats.atimeMs).toBe(newAtime)
      expect(stats.mtimeMs).toBe(newMtime)
    })

    it('should throw ENOENT for non-existent file', async () => {
      await expect(fsModule.utimes('/nonexistent.txt', new Date(), new Date())).rejects.toThrow()
    })
  })

  // ==========================================================================
  // File chown Operations Tests
  // ==========================================================================

  describe('chown operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should change file ownership', async () => {
      await fsModule.write('/file.txt', 'content')
      await fsModule.chown('/file.txt', 1000, 1000)

      const stats = await fsModule.stat('/file.txt')
      expect(stats.uid).toBe(1000)
      expect(stats.gid).toBe(1000)
    })

    it('should throw ENOENT for non-existent file', async () => {
      await expect(fsModule.chown('/nonexistent.txt', 1000, 1000)).rejects.toThrow()
    })
  })

  // ==========================================================================
  // rm Operations Tests
  // ==========================================================================

  describe('rm operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should remove a file', async () => {
      await fsModule.write('/file.txt', 'content')
      await fsModule.rm('/file.txt')

      expect(mockSql.getFile('/file.txt')).toBeUndefined()
    })

    it('should remove an empty directory', async () => {
      await fsModule.mkdir('/emptydir')
      await fsModule.rm('/emptydir')

      expect(mockSql.getFile('/emptydir')).toBeUndefined()
    })

    it('should throw ENOENT for non-existent path', async () => {
      await expect(fsModule.rm('/nonexistent')).rejects.toThrow()
    })

    it('should not throw with force option for non-existent path', async () => {
      await expect(fsModule.rm('/nonexistent', { force: true })).resolves.not.toThrow()
    })

    it('should remove directory recursively with recursive option', async () => {
      await fsModule.mkdir('/parent')
      await fsModule.write('/parent/file.txt', 'content')
      await fsModule.mkdir('/parent/child')

      await fsModule.rm('/parent', { recursive: true })

      expect(mockSql.getFile('/parent')).toBeUndefined()
      expect(mockSql.getFile('/parent/file.txt')).toBeUndefined()
      expect(mockSql.getFile('/parent/child')).toBeUndefined()
    })
  })

  // ==========================================================================
  // Streaming Operations Tests
  // ==========================================================================

  describe('streaming operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('createReadStream', () => {
      it('should create a readable stream', async () => {
        await fsModule.write('/file.txt', 'Hello, World!')
        const stream = await fsModule.createReadStream('/file.txt')

        expect(stream).toBeInstanceOf(ReadableStream)
      })

      it('should read file content through stream', async () => {
        await fsModule.write('/file.txt', 'Stream content')
        const stream = await fsModule.createReadStream('/file.txt')

        const reader = stream.getReader()
        const chunks: Uint8Array[] = []

        let done = false
        while (!done) {
          const result = await reader.read()
          if (result.done) {
            done = true
          } else {
            chunks.push(result.value)
          }
        }

        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }

        const content = new TextDecoder().decode(combined)
        expect(content).toBe('Stream content')
      })
    })

    describe('createWriteStream', () => {
      it('should create a writable stream', async () => {
        const stream = await fsModule.createWriteStream('/output.txt')

        expect(stream).toBeInstanceOf(WritableStream)
      })

      it('should write file content through stream', async () => {
        const stream = await fsModule.createWriteStream('/output.txt')
        const writer = stream.getWriter()

        await writer.write(new TextEncoder().encode('Streamed '))
        await writer.write(new TextEncoder().encode('content'))
        await writer.close()

        const content = await fsModule.read('/output.txt', { encoding: 'utf-8' })
        expect(content).toBe('Streamed content')
      })
    })
  })

  // ==========================================================================
  // File Handle Operations Tests
  // ==========================================================================

  describe('file handle operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    describe('open', () => {
      it('should open an existing file', async () => {
        await fsModule.write('/file.txt', 'content')
        const handle = await fsModule.open('/file.txt', 'r')

        expect(handle).toBeDefined()
        expect(handle.fd).toBeGreaterThan(0)
      })

      it('should create file with w flag', async () => {
        const handle = await fsModule.open('/newfile.txt', 'w')

        expect(handle).toBeDefined()
        expect(mockSql.getFile('/newfile.txt')).toBeDefined()
      })

      it('should throw ENOENT for non-existent file with r flag', async () => {
        await expect(fsModule.open('/nonexistent.txt', 'r')).rejects.toThrow()
      })

      describe('handle.read', () => {
        it('should read data into buffer', async () => {
          await fsModule.write('/file.txt', 'Hello')
          const handle = await fsModule.open('/file.txt', 'r')
          const buffer = new Uint8Array(10)

          const result = await handle.read(buffer, 0, 5, 0)

          expect(result.bytesRead).toBe(5)
          expect(new TextDecoder().decode(buffer.slice(0, result.bytesRead))).toBe('Hello')
        })
      })

      describe('handle.write', () => {
        it('should write data to file', async () => {
          const handle = await fsModule.open('/file.txt', 'w')

          await handle.write('Hello, World!')
          await handle.close()

          const content = await fsModule.read('/file.txt', { encoding: 'utf-8' })
          expect(content).toBe('Hello, World!')
        })
      })

      describe('handle.stat', () => {
        it('should return file stats', async () => {
          await fsModule.write('/file.txt', 'content')
          const handle = await fsModule.open('/file.txt', 'r')

          const stats = await handle.stat()

          expect(stats.isFile()).toBe(true)
          expect(stats.size).toBe(7)
        })
      })

      describe('handle.truncate', () => {
        it('should truncate file through handle', async () => {
          await fsModule.write('/file.txt', 'Hello, World!')
          const handle = await fsModule.open('/file.txt', 'w')

          await handle.truncate(5)
          await handle.close()

          const content = await fsModule.read('/file.txt', { encoding: 'utf-8' })
          expect(content).toBe('Hello')
        })
      })

      describe('handle.sync and handle.close', () => {
        it('should sync and close without error', async () => {
          const handle = await fsModule.open('/file.txt', 'w')
          await handle.write('content')

          await expect(handle.sync()).resolves.not.toThrow()
          await expect(handle.close()).resolves.not.toThrow()
        })
      })
    })
  })

  // ==========================================================================
  // Tiered Storage Backend Switching Tests
  // ==========================================================================

  describe('storage backend switching', () => {
    let mockArchive: MockR2Bucket

    beforeEach(async () => {
      mockArchive = new MockR2Bucket()
      fsModule = new FsModule({
        sql: mockSql as unknown as SqlStorage,
        r2: mockR2 as unknown as R2Bucket,
        archive: mockArchive as unknown as R2Bucket,
        hotMaxSize: 100, // 100 bytes threshold
      })
      await fsModule.exists('/')
    })

    describe('getTier', () => {
      it('should return current tier for a file', async () => {
        await fsModule.write('/file.txt', 'content')

        const tier = await fsModule.getTier('/file.txt')

        expect(tier).toBe('hot')
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.getTier('/nonexistent.txt')).rejects.toThrow()
      })
    })

    describe('promote', () => {
      it('should promote file to hot tier', async () => {
        await fsModule.write('/file.txt', 'content', { tier: 'warm' })

        await fsModule.promote('/file.txt', 'hot')

        const tier = await fsModule.getTier('/file.txt')
        expect(tier).toBe('hot')
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.promote('/nonexistent.txt', 'hot')).rejects.toThrow()
      })

      it('should be no-op when file is already in target tier', async () => {
        await fsModule.write('/file.txt', 'content') // Default is hot

        await expect(fsModule.promote('/file.txt', 'hot')).resolves.not.toThrow()
      })
    })

    describe('demote', () => {
      it('should demote file to warm tier', async () => {
        await fsModule.write('/file.txt', 'content') // Hot tier

        await fsModule.demote('/file.txt', 'warm')

        const tier = await fsModule.getTier('/file.txt')
        expect(tier).toBe('warm')
      })

      it('should demote file to cold tier', async () => {
        await fsModule.write('/file.txt', 'content') // Hot tier

        await fsModule.demote('/file.txt', 'cold')

        const tier = await fsModule.getTier('/file.txt')
        expect(tier).toBe('cold')
      })

      it('should throw ENOENT for non-existent file', async () => {
        await expect(fsModule.demote('/nonexistent.txt', 'warm')).rejects.toThrow()
      })

      it('should be no-op when file is already in target tier', async () => {
        await fsModule.write('/file.txt', 'content', { tier: 'warm' })

        await expect(fsModule.demote('/file.txt', 'warm')).resolves.not.toThrow()
      })
    })

    describe('automatic tier selection', () => {
      it('should select warm tier for files exceeding hot threshold when R2 is configured', async () => {
        const largeContent = 'x'.repeat(200) // Exceeds 100 byte threshold
        await fsModule.write('/large.txt', largeContent)

        const file = mockSql.getFile('/large.txt')
        expect(file?.tier).toBe('warm')
      })

      it('should store warm tier data in R2', async () => {
        const largeContent = 'x'.repeat(200)
        await fsModule.write('/large.txt', largeContent)

        const file = mockSql.getFile('/large.txt')
        expect(mockR2.has(file!.blob_id!)).toBe(true)
      })
    })
  })

  // ==========================================================================
  // Error Code Verification Tests
  // ==========================================================================

  describe('error code verification', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should throw error with code ENOENT for missing file', async () => {
      try {
        await fsModule.read('/nonexistent.txt')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('ENOENT')
      }
    })

    it('should throw error with code EISDIR when reading directory', async () => {
      await fsModule.mkdir('/testdir')

      try {
        await fsModule.read('/testdir')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('EISDIR')
      }
    })

    it('should throw error with code EEXIST when creating existing directory', async () => {
      await fsModule.mkdir('/existing')

      try {
        await fsModule.mkdir('/existing')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('EEXIST')
      }
    })

    it('should throw error with code ENOTDIR when rmdir on file', async () => {
      await fsModule.write('/file.txt', 'content')

      try {
        await fsModule.rmdir('/file.txt')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('ENOTDIR')
      }
    })

    it('should throw error with code ENOTEMPTY for non-empty directory', async () => {
      await fsModule.mkdir('/nonempty')
      await fsModule.write('/nonempty/file.txt', 'content')

      try {
        await fsModule.rmdir('/nonempty')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('ENOTEMPTY')
      }
    })
  })

  // ==========================================================================
  // lstat Operations Tests
  // ==========================================================================

  describe('lstat operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should return stats for regular file', async () => {
      await fsModule.write('/file.txt', 'content')

      const stats = await fsModule.lstat('/file.txt')

      expect(stats.isFile()).toBe(true)
      expect(stats.isSymbolicLink()).toBe(false)
    })

    it('should return stats for symlink without following', async () => {
      await fsModule.write('/target.txt', 'content')
      await fsModule.symlink('/target.txt', '/link.txt')

      const stats = await fsModule.lstat('/link.txt')

      expect(stats.isSymbolicLink()).toBe(true)
      expect(stats.isFile()).toBe(false)
    })

    it('should throw ENOENT for non-existent path', async () => {
      await expect(fsModule.lstat('/nonexistent')).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Range Read Tests
  // ==========================================================================

  describe('range read operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should read partial file with start option', async () => {
      await fsModule.write('/file.txt', 'Hello, World!')

      const content = await fsModule.read('/file.txt', { start: 7 })

      expect(content).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(content as Uint8Array)).toBe('World!')
    })

    it('should read partial file with start and end options', async () => {
      await fsModule.write('/file.txt', 'Hello, World!')

      const content = await fsModule.read('/file.txt', { start: 0, end: 4 })

      expect(new TextDecoder().decode(content as Uint8Array)).toBe('Hello')
    })

    it('should read partial file with only end option', async () => {
      await fsModule.write('/file.txt', 'Hello, World!')

      const content = await fsModule.read('/file.txt', { end: 4 })

      expect(new TextDecoder().decode(content as Uint8Array)).toBe('Hello')
    })
  })

  // ==========================================================================
  // Watch Operations Tests (Stub verification)
  // ==========================================================================

  describe('watch operations', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should return FSWatcher with close method', () => {
      const watcher = fsModule.watch('/file.txt')

      expect(watcher).toBeDefined()
      expect(typeof watcher.close).toBe('function')
      expect(typeof watcher.ref).toBe('function')
      expect(typeof watcher.unref).toBe('function')
    })

    it('should allow close without error', () => {
      const watcher = fsModule.watch('/file.txt')

      expect(() => watcher.close()).not.toThrow()
    })

    it('should return self from ref and unref', () => {
      const watcher = fsModule.watch('/file.txt')

      expect(watcher.ref()).toBe(watcher)
      expect(watcher.unref()).toBe(watcher)
    })
  })

  // ==========================================================================
  // list alias Tests
  // ==========================================================================

  describe('list (readdir alias)', () => {
    beforeEach(async () => {
      await fsModule.exists('/')
    })

    it('should list directory contents like readdir', async () => {
      await fsModule.mkdir('/dir')
      await fsModule.write('/dir/a.txt', 'a')
      await fsModule.write('/dir/b.txt', 'b')

      const entries = await fsModule.list('/dir')

      expect(entries).toHaveLength(2)
      expect(entries).toContain('a.txt')
      expect(entries).toContain('b.txt')
    })
  })

  // ==========================================================================
  // Module name property Tests
  // ==========================================================================

  describe('module properties', () => {
    it('should have name property set to "fs"', () => {
      expect(fsModule.name).toBe('fs')
    })
  })
})
