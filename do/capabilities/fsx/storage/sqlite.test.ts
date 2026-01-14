/**
 * Tests for SQLiteMetadata - SQLite-backed metadata store for fsx
 *
 * This test file covers:
 * - Metadata CRUD operations (create, read, update, delete)
 * - Index queries (list by path prefix)
 * - Path lookups (getByPath, getById, getChildren)
 * - Timestamp handling (atime, mtime, ctime, birthtime)
 * - Schema operations (init, blob management)
 *
 * @module storage/sqlite.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SQLiteMetadata } from './sqlite.js'
import type { FileEntry, FileType, BlobRef } from '../core/types.js'

// ============================================================================
// Mock SqlStorage Implementation
// ============================================================================

/**
 * Mock SQL result interface matching Cloudflare's SqlStorage
 */
interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SqlStorage behavior
 */
class MockSqlStorage {
  private files: Map<string, Record<string, unknown>> = new Map()
  private blobs: Map<string, Record<string, unknown>> = new Map()
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

    // Handle last_insert_rowid()
    if (normalizedSql.includes('last_insert_rowid')) {
      return {
        one: () => ({ id: this.nextFileId - 1 } as T),
        toArray: () => [{ id: this.nextFileId - 1 } as T],
      }
    }

    // Handle INSERT into files
    if (normalizedSql.includes('insert into files')) {
      // Check if explicit id is provided in the INSERT columns
      const columnsMatch = sql.match(/\(([^)]+)\)\s*values/i)
      const columns = columnsMatch ? columnsMatch[1].split(',').map((c) => c.trim().toLowerCase()) : []
      const idIndex = columns.indexOf('id')

      let id: number
      if (idIndex >= 0 && params[idIndex] !== null && params[idIndex] !== undefined) {
        // Explicit id provided - use it without incrementing auto-increment counter
        id = params[idIndex] as number
      } else {
        // Auto-generate id
        id = this.nextFileId++
      }

      const entry = this.parseFileInsert(sql, params, id)
      // Ensure the entry uses our computed id
      entry.id = id
      this.files.set(entry.path as string, entry)
      return this.emptyResult<T>()
    }

    // Handle INSERT into blobs
    if (normalizedSql.includes('insert into blobs')) {
      const blob = {
        id: params[0] as string,
        tier: params[1] as string,
        size: params[2] as number,
        checksum: params[3] as string | null,
        created_at: params[4] as number,
      }
      this.blobs.set(blob.id, blob)
      return this.emptyResult<T>()
    }

    // Handle SELECT from files WHERE path = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path = ?')) {
      const path = params[0] as string
      const entry = this.files.get(path)
      return {
        one: () => (entry as T) || null,
        toArray: () => (entry ? [entry as T] : []),
      }
    }

    // Handle SELECT from files WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where id = ?')) {
      const id = params[0] as number
      for (const entry of this.files.values()) {
        if (entry.id === id) {
          return {
            one: () => entry as T,
            toArray: () => [entry as T],
          }
        }
      }
      return this.emptyResult<T>()
    }

    // Handle SELECT from files WHERE parent_id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where parent_id = ?')) {
      const parentId = params[0] as number
      const children: Record<string, unknown>[] = []
      for (const entry of this.files.values()) {
        if (entry.parent_id === parentId) {
          children.push(entry)
        }
      }
      return {
        one: () => (children.length > 0 ? (children[0] as T) : null),
        toArray: () => children as T[],
      }
    }

    // Handle SELECT from files WHERE path LIKE ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where path like')) {
      const patterns = params.map((p) => p as string)
      const matches: Record<string, unknown>[] = []
      for (const entry of this.files.values()) {
        const path = entry.path as string
        let matchesAll = true
        for (const pattern of patterns) {
          if (!this.matchLikePattern(path, pattern)) {
            matchesAll = false
            break
          }
        }
        if (matchesAll) {
          matches.push(entry)
        }
      }
      return {
        one: () => (matches.length > 0 ? (matches[0] as T) : null),
        toArray: () => matches as T[],
      }
    }

    // Handle SELECT from blobs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from blobs') && normalizedSql.includes('where id = ?')) {
      const id = params[0] as string
      const blob = this.blobs.get(id)
      return {
        one: () => (blob as T) || null,
        toArray: () => (blob ? [blob as T] : []),
      }
    }

    // Handle UPDATE files
    if (normalizedSql.includes('update files set')) {
      const id = params[params.length - 1] as number
      for (const [path, entry] of this.files) {
        if (entry.id === id) {
          // Apply updates based on SET clauses
          this.applyFileUpdate(entry, sql, params)
          break
        }
      }
      return this.emptyResult<T>()
    }

    // Handle UPDATE blobs
    if (normalizedSql.includes('update blobs set')) {
      const id = params[params.length - 1] as string
      const blob = this.blobs.get(id)
      if (blob && normalizedSql.includes('tier = ?')) {
        blob.tier = params[0] as string
      }
      return this.emptyResult<T>()
    }

    // Handle DELETE from files
    if (normalizedSql.includes('delete from files')) {
      const id = params[0] as number
      for (const [path, entry] of this.files) {
        if (entry.id === id) {
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

    // Handle COUNT queries for stats
    if (normalizedSql.includes('count(*)') && normalizedSql.includes('from files')) {
      let count = 0
      if (normalizedSql.includes("type = 'file'")) {
        for (const entry of this.files.values()) {
          if (entry.type === 'file') count++
        }
      } else if (normalizedSql.includes("type = 'directory'")) {
        for (const entry of this.files.values()) {
          if (entry.type === 'directory') count++
        }
      }
      return {
        one: () => ({ count } as T),
        toArray: () => [{ count } as T],
      }
    }

    // Handle SUM(size) query
    if (normalizedSql.includes('sum(size)') && normalizedSql.includes('from files')) {
      let total = 0
      for (const entry of this.files.values()) {
        total += (entry.size as number) || 0
      }
      return {
        one: () => ({ total } as T),
        toArray: () => [{ total } as T],
      }
    }

    // Handle GROUP BY tier stats
    if (normalizedSql.includes('group by tier')) {
      const tierStats: Record<string, { tier: string; count: number; size: number }> = {}
      for (const blob of this.blobs.values()) {
        const tier = blob.tier as string
        if (!tierStats[tier]) {
          tierStats[tier] = { tier, count: 0, size: 0 }
        }
        tierStats[tier].count++
        tierStats[tier].size += (blob.size as number) || 0
      }
      const results = Object.values(tierStats)
      return {
        one: () => (results.length > 0 ? (results[0] as T) : null),
        toArray: () => results as T[],
      }
    }

    return this.emptyResult<T>()
  }

  private parseFileInsert(sql: string, params: unknown[], id: number): Record<string, unknown> {
    // Parse column order from SQL
    const columnsMatch = sql.match(/\(([^)]+)\)\s*values/i)
    if (!columnsMatch) {
      return { id, path: params[0] }
    }

    const columns = columnsMatch[1].split(',').map((c) => c.trim())
    const entry: Record<string, unknown> = { id }
    columns.forEach((col, i) => {
      entry[col] = params[i]
    })
    return entry
  }

  private applyFileUpdate(entry: Record<string, unknown>, sql: string, params: unknown[]): void {
    // Simple update parsing - in reality would need proper SQL parsing
    const setClause = sql.match(/set\s+(.+)\s+where/i)?.[1] || ''
    const assignments = setClause.split(',').map((a) => a.trim())
    let paramIndex = 0

    for (const assignment of assignments) {
      const [column] = assignment.split('=').map((s) => s.trim())
      if (column && params[paramIndex] !== undefined) {
        entry[column] = params[paramIndex]
        paramIndex++
      }
    }
  }

  private matchLikePattern(value: string, pattern: string): boolean {
    // Convert SQL LIKE pattern to regex
    const regexPattern = pattern.replace(/%/g, '.*').replace(/_/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(value)
  }

  private emptyResult<T>(): MockSqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  // Test helpers
  getFiles(): Map<string, Record<string, unknown>> {
    return this.files
  }

  getBlobs(): Map<string, Record<string, unknown>> {
    return this.blobs
  }

  clear(): void {
    this.files.clear()
    this.blobs.clear()
    this.nextFileId = 1
    this.execCalls = []
  }
}

// ============================================================================
// Schema Operations Tests
// ============================================================================

describe('SQLiteMetadata Schema', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(() => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
  })

  describe('init()', () => {
    it('should create files table with correct schema', async () => {
      await metadata.init()

      const createTableCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('create table if not exists files'))
      expect(createTableCall).toBeDefined()
      expect(createTableCall!.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT')
      expect(createTableCall!.sql).toContain('path TEXT UNIQUE NOT NULL')
      expect(createTableCall!.sql).toContain('parent_id INTEGER')
      expect(createTableCall!.sql).toContain("type TEXT NOT NULL CHECK(type IN ('file', 'directory', 'symlink'))")
    })

    it('should create blobs table with correct schema', async () => {
      await metadata.init()

      const createTableCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('create table if not exists blobs'))
      expect(createTableCall).toBeDefined()
      expect(createTableCall!.sql).toContain('id TEXT PRIMARY KEY')
      expect(createTableCall!.sql).toContain("tier TEXT NOT NULL DEFAULT 'hot'")
    })

    it('should create required indexes', async () => {
      await metadata.init()

      const indexCalls = sql.execCalls.filter((c) => c.sql.toLowerCase().includes('create index'))
      expect(indexCalls.length).toBeGreaterThanOrEqual(4)

      const indexNames = indexCalls.map((c) => {
        const match = c.sql.match(/create index if not exists\s+(\w+)/i)
        return match?.[1]
      })

      expect(indexNames).toContain('idx_files_path')
      expect(indexNames).toContain('idx_files_parent')
      expect(indexNames).toContain('idx_files_tier')
      expect(indexNames).toContain('idx_blobs_tier')
    })

    it('should create root directory if not exists', async () => {
      await metadata.init()

      const rootEntry = await metadata.getByPath('/')
      expect(rootEntry).not.toBeNull()
      expect(rootEntry?.path).toBe('/')
      expect(rootEntry?.type).toBe('directory')
      expect(rootEntry?.mode).toBe(0o755)
    })

    it('should not recreate root if already exists', async () => {
      await metadata.init()
      const insertCalls1 = sql.execCalls.filter((c) => c.sql.toLowerCase().includes('insert into files'))

      sql.execCalls = [] // Reset
      await metadata.init()
      const insertCalls2 = sql.execCalls.filter((c) => c.sql.toLowerCase().includes('insert into files'))

      // Second init should not insert root again
      expect(insertCalls2.length).toBeLessThan(insertCalls1.length)
    })

    it('should be idempotent', async () => {
      await metadata.init()
      await metadata.init()
      await metadata.init()

      // Should not throw and schema should be consistent
      const root = await metadata.getByPath('/')
      expect(root).not.toBeNull()
    })
  })
})

// ============================================================================
// CRUD Operations Tests
// ============================================================================

describe('SQLiteMetadata CRUD Operations', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('createEntry()', () => {
    it('should create a file entry with all required fields', async () => {
      const id = await metadata.createEntry({
        path: '/test.txt',
        name: 'test.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 1000,
        gid: 1000,
        size: 100,
        blobId: 'blob-123',
        linkTarget: null,
        nlink: 1,
      })

      expect(id).toBeGreaterThan(0)
      const entry = await metadata.getByPath('/test.txt')
      expect(entry).not.toBeNull()
      expect(entry?.path).toBe('/test.txt')
      expect(entry?.name).toBe('test.txt')
      expect(entry?.type).toBe('file')
      expect(entry?.size).toBe(100)
    })

    it('should create a directory entry', async () => {
      const id = await metadata.createEntry({
        path: '/mydir',
        name: 'mydir',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      expect(id).toBeGreaterThan(0)
      const entry = await metadata.getByPath('/mydir')
      expect(entry?.type).toBe('directory')
    })

    it('should create a symlink entry', async () => {
      const id = await metadata.createEntry({
        path: '/link',
        name: 'link',
        parentId: '0',
        type: 'symlink',
        mode: 0o777,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: '/target',
        nlink: 1,
      })

      const entry = await metadata.getByPath('/link')
      expect(entry?.type).toBe('symlink')
      expect(entry?.linkTarget).toBe('/target')
    })

    it('should set timestamps on creation', async () => {
      const before = Date.now()
      await metadata.createEntry({
        path: '/timestamped.txt',
        name: 'timestamped.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })
      const after = Date.now()

      const entry = await metadata.getByPath('/timestamped.txt')
      expect(entry?.atime).toBeGreaterThanOrEqual(before)
      expect(entry?.atime).toBeLessThanOrEqual(after)
      expect(entry?.mtime).toBeGreaterThanOrEqual(before)
      expect(entry?.mtime).toBeLessThanOrEqual(after)
      expect(entry?.ctime).toBeGreaterThanOrEqual(before)
      expect(entry?.ctime).toBeLessThanOrEqual(after)
      expect(entry?.birthtime).toBeGreaterThanOrEqual(before)
      expect(entry?.birthtime).toBeLessThanOrEqual(after)
    })

    it('should default tier to hot', async () => {
      await metadata.createEntry({
        path: '/default-tier.txt',
        name: 'default-tier.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const insertCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('insert into files') && c.params.includes('/default-tier.txt'))
      expect(insertCall?.params).toContain('hot')
    })

    it('should allow specifying tier', async () => {
      await metadata.createEntry({
        path: '/cold-storage.txt',
        name: 'cold-storage.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 1000000,
        blobId: 'cold-blob',
        linkTarget: null,
        nlink: 1,
        tier: 'cold',
      })

      const insertCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('insert into files') && c.params.includes('/cold-storage.txt'))
      expect(insertCall?.params).toContain('cold')
    })

    it('should return auto-generated ID', async () => {
      const id1 = await metadata.createEntry({
        path: '/file1.txt',
        name: 'file1.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const id2 = await metadata.createEntry({
        path: '/file2.txt',
        name: 'file2.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      expect(id1).toBe(1)
      expect(id2).toBe(2)
      expect(id2).toBeGreaterThan(id1)
    })
  })

  describe('getByPath()', () => {
    it('should return entry for existing path', async () => {
      await metadata.createEntry({
        path: '/existing.txt',
        name: 'existing.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 1000,
        gid: 1000,
        size: 512,
        blobId: 'blob-456',
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/existing.txt')
      expect(entry).not.toBeNull()
      expect(entry?.path).toBe('/existing.txt')
      expect(entry?.size).toBe(512)
    })

    it('should return null for non-existent path', async () => {
      const entry = await metadata.getByPath('/does-not-exist.txt')
      expect(entry).toBeNull()
    })

    it('should return root directory', async () => {
      const root = await metadata.getByPath('/')
      expect(root).not.toBeNull()
      expect(root?.path).toBe('/')
      expect(root?.type).toBe('directory')
    })

    it('should return entry with correct type conversions', async () => {
      await metadata.createEntry({
        path: '/typed.txt',
        name: 'typed.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 1000,
        gid: 1000,
        size: 256,
        blobId: 'blob-789',
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/typed.txt')
      expect(typeof entry?.id).toBe('string')
      expect(typeof entry?.size).toBe('number')
      expect(typeof entry?.mode).toBe('number')
      expect(typeof entry?.atime).toBe('number')
    })
  })

  describe('getById()', () => {
    it('should return entry for existing ID', async () => {
      const id = await metadata.createEntry({
        path: '/by-id.txt',
        name: 'by-id.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getById(String(id))
      expect(entry).not.toBeNull()
      expect(entry?.path).toBe('/by-id.txt')
    })

    it('should return null for non-existent ID', async () => {
      const entry = await metadata.getById('99999')
      expect(entry).toBeNull()
    })

    it('should return null for invalid ID format', async () => {
      const entry = await metadata.getById('not-a-number')
      expect(entry).toBeNull()
    })

    it('should return null for empty string ID', async () => {
      const entry = await metadata.getById('')
      expect(entry).toBeNull()
    })
  })

  describe('updateEntry()', () => {
    it('should update file size', async () => {
      const id = await metadata.createEntry({
        path: '/update-size.txt',
        name: 'update-size.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { size: 500 })

      const entry = await metadata.getById(String(id))
      expect(entry?.size).toBe(500)
    })

    it('should update file path and name (rename)', async () => {
      const id = await metadata.createEntry({
        path: '/old-name.txt',
        name: 'old-name.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), {
        path: '/new-name.txt',
        name: 'new-name.txt',
      })

      const entry = await metadata.getById(String(id))
      expect(entry?.path).toBe('/new-name.txt')
      expect(entry?.name).toBe('new-name.txt')
    })

    it('should update file mode (chmod)', async () => {
      const id = await metadata.createEntry({
        path: '/chmod.txt',
        name: 'chmod.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { mode: 0o755 })

      const entry = await metadata.getById(String(id))
      expect(entry?.mode).toBe(0o755)
    })

    it('should update uid and gid (chown)', async () => {
      const id = await metadata.createEntry({
        path: '/chown.txt',
        name: 'chown.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { uid: 1000, gid: 1000 })

      const entry = await metadata.getById(String(id))
      expect(entry?.uid).toBe(1000)
      expect(entry?.gid).toBe(1000)
    })

    it('should update blobId', async () => {
      const id = await metadata.createEntry({
        path: '/blob-update.txt',
        name: 'blob-update.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: 'old-blob',
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { blobId: 'new-blob' })

      const entry = await metadata.getById(String(id))
      expect(entry?.blobId).toBe('new-blob')
    })

    it('should update tier', async () => {
      const id = await metadata.createEntry({
        path: '/tier-update.txt',
        name: 'tier-update.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: 'blob',
        linkTarget: null,
        nlink: 1,
        tier: 'hot',
      })

      await metadata.updateEntry(String(id), { tier: 'cold' })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('update files') && c.params.includes('cold'))
      expect(updateCall).toBeDefined()
    })

    it('should always update ctime on any update', async () => {
      const id = await metadata.createEntry({
        path: '/ctime-update.txt',
        name: 'ctime-update.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entryBefore = await metadata.getById(String(id))
      const ctimeBefore = entryBefore?.ctime

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await metadata.updateEntry(String(id), { size: 200 })

      // Check that ctime = ? is in the update SQL
      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('update files set') && c.sql.toLowerCase().includes('ctime = ?'))
      expect(updateCall).toBeDefined()
    })

    it('should update atime', async () => {
      const id = await metadata.createEntry({
        path: '/atime-update.txt',
        name: 'atime-update.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const newAtime = Date.now() + 1000
      await metadata.updateEntry(String(id), { atime: newAtime })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('atime = ?'))
      expect(updateCall).toBeDefined()
    })

    it('should update mtime', async () => {
      const id = await metadata.createEntry({
        path: '/mtime-update.txt',
        name: 'mtime-update.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const newMtime = Date.now() + 1000
      await metadata.updateEntry(String(id), { mtime: newMtime })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('mtime = ?'))
      expect(updateCall).toBeDefined()
    })

    it('should update parent_id (move)', async () => {
      const id = await metadata.createEntry({
        path: '/subdir/file.txt',
        name: 'file.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { parentId: '2' })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('parent_id = ?'))
      expect(updateCall).toBeDefined()
    })

    it('should silently ignore invalid ID', async () => {
      // Should not throw
      await metadata.updateEntry('invalid', { size: 100 })
      await metadata.updateEntry('', { size: 100 })
    })
  })

  describe('deleteEntry()', () => {
    it('should delete existing entry', async () => {
      const id = await metadata.createEntry({
        path: '/to-delete.txt',
        name: 'to-delete.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.deleteEntry(String(id))

      const entry = await metadata.getById(String(id))
      expect(entry).toBeNull()
    })

    it('should silently handle non-existent ID', async () => {
      // Should not throw
      await metadata.deleteEntry('99999')
    })

    it('should silently handle invalid ID', async () => {
      // Should not throw
      await metadata.deleteEntry('invalid')
      await metadata.deleteEntry('')
    })

    it('should delete by numeric ID in SQL', async () => {
      const id = await metadata.createEntry({
        path: '/delete-sql.txt',
        name: 'delete-sql.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.deleteEntry(String(id))

      const deleteCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('delete from files where id = ?'))
      expect(deleteCall).toBeDefined()
      expect(deleteCall?.params[0]).toBe(id)
    })
  })
})

// ============================================================================
// Path Lookup and Children Tests
// ============================================================================

describe('SQLiteMetadata Path Lookups', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('getChildren()', () => {
    it('should return children of a directory', async () => {
      const parentId = await metadata.createEntry({
        path: '/parent',
        name: 'parent',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      await metadata.createEntry({
        path: '/parent/child1.txt',
        name: 'child1.txt',
        parentId: String(parentId),
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.createEntry({
        path: '/parent/child2.txt',
        name: 'child2.txt',
        parentId: String(parentId),
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 200,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const children = await metadata.getChildren(String(parentId))
      expect(children.length).toBe(2)
      expect(children.map((c) => c.name).sort()).toEqual(['child1.txt', 'child2.txt'])
    })

    it('should return empty array for directory with no children', async () => {
      const emptyDirId = await metadata.createEntry({
        path: '/empty',
        name: 'empty',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const children = await metadata.getChildren(String(emptyDirId))
      expect(children).toEqual([])
    })

    it('should return empty array for invalid parent ID', async () => {
      const children = await metadata.getChildren('invalid')
      expect(children).toEqual([])
    })

    it('should not return grandchildren', async () => {
      const parentId = await metadata.createEntry({
        path: '/parent',
        name: 'parent',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const childId = await metadata.createEntry({
        path: '/parent/child',
        name: 'child',
        parentId: String(parentId),
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      await metadata.createEntry({
        path: '/parent/child/grandchild.txt',
        name: 'grandchild.txt',
        parentId: String(childId),
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const children = await metadata.getChildren(String(parentId))
      expect(children.length).toBe(1)
      expect(children[0].name).toBe('child')
    })

    it('should include both files and directories', async () => {
      const parentId = await metadata.createEntry({
        path: '/mixed',
        name: 'mixed',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      await metadata.createEntry({
        path: '/mixed/file.txt',
        name: 'file.txt',
        parentId: String(parentId),
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.createEntry({
        path: '/mixed/subdir',
        name: 'subdir',
        parentId: String(parentId),
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const children = await metadata.getChildren(String(parentId))
      expect(children.length).toBe(2)

      const types = children.map((c) => c.type).sort()
      expect(types).toEqual(['directory', 'file'])
    })
  })
})

// ============================================================================
// Index Query Tests (findByPattern)
// ============================================================================

describe('SQLiteMetadata Index Queries', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()

    // Create test file structure
    await metadata.createEntry({
      path: '/docs',
      name: 'docs',
      parentId: '0',
      type: 'directory',
      mode: 0o755,
      uid: 0,
      gid: 0,
      size: 0,
      blobId: null,
      linkTarget: null,
      nlink: 2,
    })

    await metadata.createEntry({
      path: '/docs/readme.md',
      name: 'readme.md',
      parentId: '2',
      type: 'file',
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 1000,
      blobId: null,
      linkTarget: null,
      nlink: 1,
    })

    await metadata.createEntry({
      path: '/docs/guide.md',
      name: 'guide.md',
      parentId: '2',
      type: 'file',
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 2000,
      blobId: null,
      linkTarget: null,
      nlink: 1,
    })

    await metadata.createEntry({
      path: '/docs/api.txt',
      name: 'api.txt',
      parentId: '2',
      type: 'file',
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 500,
      blobId: null,
      linkTarget: null,
      nlink: 1,
    })

    await metadata.createEntry({
      path: '/src/index.ts',
      name: 'index.ts',
      parentId: '0',
      type: 'file',
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 3000,
      blobId: null,
      linkTarget: null,
      nlink: 1,
    })
  })

  describe('findByPattern()', () => {
    it('should find files matching glob pattern with *', async () => {
      const results = await metadata.findByPattern('*.md')

      expect(results.length).toBe(2)
      const names = results.map((r) => r.name).sort()
      expect(names).toEqual(['guide.md', 'readme.md'])
    })

    it('should find files matching exact path', async () => {
      const results = await metadata.findByPattern('/docs/readme.md')

      expect(results.length).toBe(1)
      expect(results[0].path).toBe('/docs/readme.md')
    })

    it('should find files with wildcard prefix', async () => {
      const results = await metadata.findByPattern('/docs/*')

      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.path.startsWith('/docs/')).toBe(true)
      }
    })

    it('should find files with single character wildcard ?', async () => {
      const results = await metadata.findByPattern('/docs/???.txt')

      expect(results.length).toBe(1)
      expect(results[0].name).toBe('api.txt')
    })

    it('should return empty array for no matches', async () => {
      const results = await metadata.findByPattern('*.xyz')

      expect(results).toEqual([])
    })

    it('should filter by parent path when provided', async () => {
      const results = await metadata.findByPattern('*.md', '/docs')

      expect(results.length).toBe(2)
      for (const result of results) {
        expect(result.path.startsWith('/docs/')).toBe(true)
        expect(result.name.endsWith('.md')).toBe(true)
      }
    })

    it('should handle recursive patterns with **', async () => {
      // ** in glob should match any path
      const results = await metadata.findByPattern('/docs/**')

      expect(results.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Timestamp Handling Tests
// ============================================================================

describe('SQLiteMetadata Timestamp Handling', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('timestamps on creation', () => {
    it('should set birthtime to current time on creation', async () => {
      const before = Date.now()
      await metadata.createEntry({
        path: '/birthtime.txt',
        name: 'birthtime.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })
      const after = Date.now()

      const entry = await metadata.getByPath('/birthtime.txt')
      expect(entry?.birthtime).toBeGreaterThanOrEqual(before)
      expect(entry?.birthtime).toBeLessThanOrEqual(after)
    })

    it('should set all timestamps equal on creation', async () => {
      await metadata.createEntry({
        path: '/equal-times.txt',
        name: 'equal-times.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/equal-times.txt')
      expect(entry?.atime).toBe(entry?.birthtime)
      expect(entry?.mtime).toBe(entry?.birthtime)
      expect(entry?.ctime).toBe(entry?.birthtime)
    })
  })

  describe('timestamps on update', () => {
    it('should update ctime on metadata changes', async () => {
      const id = await metadata.createEntry({
        path: '/ctime-test.txt',
        name: 'ctime-test.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.updateEntry(String(id), { mode: 0o755 })

      const updateCalls = sql.execCalls.filter((c) => c.sql.toLowerCase().includes('update files') && c.sql.toLowerCase().includes('ctime'))
      expect(updateCalls.length).toBeGreaterThan(0)
    })

    it('should allow explicit atime update (touch)', async () => {
      const id = await metadata.createEntry({
        path: '/atime-test.txt',
        name: 'atime-test.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const newAtime = Date.now() + 60000 // 1 minute in future
      await metadata.updateEntry(String(id), { atime: newAtime })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('atime = ?'))
      expect(updateCall?.params).toContain(newAtime)
    })

    it('should allow explicit mtime update', async () => {
      const id = await metadata.createEntry({
        path: '/mtime-test.txt',
        name: 'mtime-test.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const newMtime = Date.now() - 60000 // 1 minute in past
      await metadata.updateEntry(String(id), { mtime: newMtime })

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('mtime = ?'))
      expect(updateCall?.params).toContain(newMtime)
    })

    it('should preserve birthtime on updates', async () => {
      const id = await metadata.createEntry({
        path: '/preserve-birthtime.txt',
        name: 'preserve-birthtime.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entryBefore = await metadata.getById(String(id))
      await metadata.updateEntry(String(id), { size: 1000 })

      // birthtime should NOT be in the update SQL
      const updateCalls = sql.execCalls.filter((c) => c.sql.toLowerCase().includes('update files'))
      for (const call of updateCalls) {
        expect(call.sql.toLowerCase()).not.toContain('birthtime')
      }
    })
  })

  describe('timestamp precision', () => {
    it('should store timestamps as milliseconds since epoch', async () => {
      const now = Date.now()
      await metadata.createEntry({
        path: '/timestamp-precision.txt',
        name: 'timestamp-precision.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const insertCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('insert into files') && c.params.includes('/timestamp-precision.txt'))

      // Timestamps should be numbers close to Date.now()
      const timestampParams = insertCall?.params.filter((p) => typeof p === 'number' && p > 1000000000000) // Millis since epoch
      expect(timestampParams?.length).toBeGreaterThanOrEqual(4) // atime, mtime, ctime, birthtime
    })
  })
})

// ============================================================================
// Blob Operations Tests
// ============================================================================

describe('SQLiteMetadata Blob Operations', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('registerBlob()', () => {
    it('should register a new blob', async () => {
      await metadata.registerBlob({
        id: 'blob-123',
        tier: 'hot',
        size: 1024,
        checksum: 'abc123',
      })

      const blob = await metadata.getBlob('blob-123')
      expect(blob).not.toBeNull()
      expect(blob?.id).toBe('blob-123')
      expect(blob?.tier).toBe('hot')
      expect(blob?.size).toBe(1024)
    })

    it('should store blob without checksum', async () => {
      await metadata.registerBlob({
        id: 'blob-no-checksum',
        tier: 'warm',
        size: 2048,
      })

      const insertCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('insert into blobs') && c.params.includes('blob-no-checksum'))
      expect(insertCall).toBeDefined()
      // Checksum should be null
      expect(insertCall?.params[3]).toBeNull()
    })

    it('should set created_at timestamp', async () => {
      const before = Date.now()
      await metadata.registerBlob({
        id: 'blob-timestamp',
        tier: 'cold',
        size: 4096,
      })
      const after = Date.now()

      const insertCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('insert into blobs') && c.params.includes('blob-timestamp'))

      // created_at is the last param
      const createdAt = insertCall?.params[4] as number
      expect(createdAt).toBeGreaterThanOrEqual(before)
      expect(createdAt).toBeLessThanOrEqual(after)
    })

    it('should support all tier values', async () => {
      await metadata.registerBlob({ id: 'hot-blob', tier: 'hot', size: 100 })
      await metadata.registerBlob({ id: 'warm-blob', tier: 'warm', size: 100 })
      await metadata.registerBlob({ id: 'cold-blob', tier: 'cold', size: 100 })

      const hotBlob = await metadata.getBlob('hot-blob')
      const warmBlob = await metadata.getBlob('warm-blob')
      const coldBlob = await metadata.getBlob('cold-blob')

      expect(hotBlob?.tier).toBe('hot')
      expect(warmBlob?.tier).toBe('warm')
      expect(coldBlob?.tier).toBe('cold')
    })
  })

  describe('getBlob()', () => {
    it('should return blob by ID', async () => {
      await metadata.registerBlob({
        id: 'get-blob-test',
        tier: 'hot',
        size: 512,
        checksum: 'xyz789',
      })

      const blob = await metadata.getBlob('get-blob-test')
      expect(blob?.id).toBe('get-blob-test')
      expect(blob?.checksum).toBe('xyz789')
    })

    it('should return null for non-existent blob', async () => {
      const blob = await metadata.getBlob('does-not-exist')
      expect(blob).toBeNull()
    })
  })

  describe('updateBlobTier()', () => {
    it('should update blob tier from hot to warm', async () => {
      await metadata.registerBlob({
        id: 'tier-change',
        tier: 'hot',
        size: 1024,
      })

      await metadata.updateBlobTier('tier-change', 'warm')

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('update blobs set tier'))
      expect(updateCall).toBeDefined()
      expect(updateCall?.params).toContain('warm')
    })

    it('should update blob tier from warm to cold', async () => {
      await metadata.registerBlob({
        id: 'warm-to-cold',
        tier: 'warm',
        size: 1024,
      })

      await metadata.updateBlobTier('warm-to-cold', 'cold')

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('update blobs set tier') && c.params.includes('cold'))
      expect(updateCall).toBeDefined()
    })

    it('should allow promotion from cold to hot', async () => {
      await metadata.registerBlob({
        id: 'cold-to-hot',
        tier: 'cold',
        size: 1024,
      })

      await metadata.updateBlobTier('cold-to-hot', 'hot')

      const updateCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('update blobs set tier') && c.params.includes('hot'))
      expect(updateCall).toBeDefined()
    })
  })

  describe('deleteBlob()', () => {
    it('should delete existing blob', async () => {
      await metadata.registerBlob({
        id: 'to-delete-blob',
        tier: 'hot',
        size: 256,
      })

      await metadata.deleteBlob('to-delete-blob')

      const blob = await metadata.getBlob('to-delete-blob')
      expect(blob).toBeNull()
    })

    it('should silently handle non-existent blob deletion', async () => {
      // Should not throw
      await metadata.deleteBlob('never-existed')
    })
  })
})

// ============================================================================
// Statistics Tests
// ============================================================================

describe('SQLiteMetadata Statistics', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('getStats()', () => {
    it('should return correct file count', async () => {
      await metadata.createEntry({
        path: '/file1.txt',
        name: 'file1.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.createEntry({
        path: '/file2.txt',
        name: 'file2.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 200,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const stats = await metadata.getStats()
      expect(stats.totalFiles).toBe(2)
    })

    it('should return correct directory count', async () => {
      await metadata.createEntry({
        path: '/dir1',
        name: 'dir1',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      await metadata.createEntry({
        path: '/dir2',
        name: 'dir2',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const stats = await metadata.getStats()
      // +1 for root directory
      expect(stats.totalDirectories).toBeGreaterThanOrEqual(2)
    })

    it('should return correct total size', async () => {
      await metadata.createEntry({
        path: '/size1.txt',
        name: 'size1.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 1000,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      await metadata.createEntry({
        path: '/size2.txt',
        name: 'size2.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 2000,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const stats = await metadata.getStats()
      expect(stats.totalSize).toBe(3000)
    })

    it('should return blobs grouped by tier', async () => {
      await metadata.registerBlob({ id: 'hot1', tier: 'hot', size: 100 })
      await metadata.registerBlob({ id: 'hot2', tier: 'hot', size: 200 })
      await metadata.registerBlob({ id: 'warm1', tier: 'warm', size: 500 })
      await metadata.registerBlob({ id: 'cold1', tier: 'cold', size: 1000 })

      const stats = await metadata.getStats()

      expect(stats.blobsByTier.hot).toEqual({ count: 2, size: 300 })
      expect(stats.blobsByTier.warm).toEqual({ count: 1, size: 500 })
      expect(stats.blobsByTier.cold).toEqual({ count: 1, size: 1000 })
    })

    it('should return empty stats for empty filesystem', async () => {
      const stats = await metadata.getStats()

      expect(stats.totalFiles).toBe(0)
      // Root directory always exists
      expect(stats.totalDirectories).toBeGreaterThanOrEqual(0)
      expect(stats.blobsByTier).toEqual({})
    })

    it('should handle missing tiers gracefully', async () => {
      await metadata.registerBlob({ id: 'only-hot', tier: 'hot', size: 100 })

      const stats = await metadata.getStats()

      expect(stats.blobsByTier.hot).toBeDefined()
      expect(stats.blobsByTier.warm).toBeUndefined()
      expect(stats.blobsByTier.cold).toBeUndefined()
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('SQLiteMetadata Edge Cases', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('path normalization', () => {
    it('should handle paths with special characters', async () => {
      await metadata.createEntry({
        path: '/file with spaces.txt',
        name: 'file with spaces.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/file with spaces.txt')
      expect(entry?.name).toBe('file with spaces.txt')
    })

    it('should handle unicode paths', async () => {
      await metadata.createEntry({
        path: '/folder/readme.txt',
        name: 'readme.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/folder/readme.txt')
      expect(entry).not.toBeNull()
    })

    it('should handle very long paths', async () => {
      const longName = 'a'.repeat(255)
      await metadata.createEntry({
        path: `/${longName}`,
        name: longName,
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath(`/${longName}`)
      expect(entry?.name.length).toBe(255)
    })
  })

  describe('concurrent operations', () => {
    it('should handle multiple simultaneous creates', async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          metadata.createEntry({
            path: `/concurrent-${i}.txt`,
            name: `concurrent-${i}.txt`,
            parentId: '0',
            type: 'file',
            mode: 0o644,
            uid: 0,
            gid: 0,
            size: i * 100,
            blobId: null,
            linkTarget: null,
            nlink: 1,
          })
        )
      }

      const ids = await Promise.all(promises)
      expect(new Set(ids).size).toBe(10) // All IDs should be unique
    })
  })

  describe('null handling', () => {
    it('should handle null parentId for root-level entries', async () => {
      const id = await metadata.createEntry({
        path: '/root-level.txt',
        name: 'root-level.txt',
        parentId: null,
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getById(String(id))
      expect(entry?.parentId).toBeNull()
    })

    it('should handle null blobId for directories', async () => {
      await metadata.createEntry({
        path: '/dir-no-blob',
        name: 'dir-no-blob',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const entry = await metadata.getByPath('/dir-no-blob')
      expect(entry?.blobId).toBeNull()
    })

    it('should handle null linkTarget for non-symlinks', async () => {
      await metadata.createEntry({
        path: '/not-a-link.txt',
        name: 'not-a-link.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getByPath('/not-a-link.txt')
      expect(entry?.linkTarget).toBeNull()
    })
  })

  describe('type conversions', () => {
    it('should convert numeric ID to string in FileEntry', async () => {
      const id = await metadata.createEntry({
        path: '/type-test.txt',
        name: 'type-test.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const entry = await metadata.getById(String(id))
      expect(typeof entry?.id).toBe('string')
    })

    it('should convert numeric parentId to string in FileEntry', async () => {
      const parentId = await metadata.createEntry({
        path: '/parent-type-test',
        name: 'parent-type-test',
        parentId: '0',
        type: 'directory',
        mode: 0o755,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 2,
      })

      const childId = await metadata.createEntry({
        path: '/parent-type-test/child.txt',
        name: 'child.txt',
        parentId: String(parentId),
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        blobId: null,
        linkTarget: null,
        nlink: 1,
      })

      const child = await metadata.getById(String(childId))
      expect(typeof child?.parentId).toBe('string')
    })
  })
})
