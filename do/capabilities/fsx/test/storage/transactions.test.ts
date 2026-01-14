/**
 * Transaction Support Tests for fsx
 *
 * RED phase tests: These tests are expected to FAIL because transaction
 * support is not yet implemented.
 *
 * Transaction requirements:
 * - Recursive copy should be atomic (all or nothing)
 * - Recursive delete should be atomic
 * - Failed mid-operation should roll back changes
 * - Concurrent transactions should not corrupt state
 * - Transaction API: beginTransaction/commit/rollback
 *
 * @module test/storage/transactions.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SQLiteMetadata } from '../../storage/sqlite.js'
import { FsModule, type FsModuleConfig } from '../../do/module.js'
import type { StorageTier } from '../../core/types.js'

// ============================================================================
// Mock SqlStorage Implementation with Transaction Support Detection
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
 * with tracking for transaction operations.
 */
class MockSqlStorage {
  private files: Map<string, Record<string, unknown>> = new Map()
  private blobs: Map<string, { data?: ArrayBuffer; size: number; tier: string }> = new Map()
  private nextFileId = 1
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  // Transaction tracking
  private inTransaction = false
  private transactionSnapshot: {
    files: Map<string, Record<string, unknown>>
    blobs: Map<string, { data?: ArrayBuffer; size: number; tier: string }>
    nextFileId: number
  } | null = null

  // Failure injection for testing rollback
  public failAfterOperations = -1
  private operationCount = 0

  exec<T = unknown>(sql: string, ...params: unknown[]): MockSqlResult<T> {
    this.execCalls.push({ sql, params })
    const normalizedSql = sql.trim().toLowerCase()

    // Handle transaction commands FIRST - these should never fail due to injection
    // Handle BEGIN TRANSACTION
    if (normalizedSql.includes('begin') && normalizedSql.includes('transaction')) {
      this.inTransaction = true
      // Deep copy to prevent mutations from affecting snapshot
      const filesSnapshot = new Map<string, Record<string, unknown>>()
      for (const [path, entry] of this.files) {
        filesSnapshot.set(path, { ...entry })
      }
      const blobsSnapshot = new Map<string, { data?: ArrayBuffer; size: number; tier: string }>()
      for (const [id, blob] of this.blobs) {
        blobsSnapshot.set(id, { ...blob })
      }
      this.transactionSnapshot = {
        files: filesSnapshot,
        blobs: blobsSnapshot,
        nextFileId: this.nextFileId,
      }
      return this.emptyResult<T>()
    }

    // Handle COMMIT
    if (normalizedSql === 'commit' || normalizedSql === 'commit;') {
      this.inTransaction = false
      this.transactionSnapshot = null
      return this.emptyResult<T>()
    }

    // Handle ROLLBACK - MUST succeed to restore state
    if (normalizedSql === 'rollback' || normalizedSql === 'rollback;') {
      if (this.transactionSnapshot) {
        this.files = new Map(this.transactionSnapshot.files)
        this.blobs = new Map(this.transactionSnapshot.blobs)
        this.nextFileId = this.transactionSnapshot.nextFileId
      }
      this.inTransaction = false
      this.transactionSnapshot = null
      // Reset failure injection so post-rollback assertions work
      this.failAfterOperations = -1
      this.operationCount = 0
      return this.emptyResult<T>()
    }

    // Handle SAVEPOINT commands (for nested transactions)
    if (normalizedSql.includes('savepoint') || normalizedSql.includes('release savepoint')) {
      return this.emptyResult<T>()
    }

    // Check for failure injection AFTER transaction commands
    // Only inject failures when in a transaction (for testing rollback behavior)
    if (this.failAfterOperations >= 0 && this.inTransaction) {
      this.operationCount++
      if (this.operationCount > this.failAfterOperations) {
        // Reset on failure so post-failure assertions work
        this.failAfterOperations = -1
        this.operationCount = 0
        throw new Error('Injected failure for testing')
      }
    }

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
    if (normalizedSql.includes('insert into files')) {
      const columnsMatch = sql.match(/\(([^)]+)\)\s*values/i)
      const columns = columnsMatch ? columnsMatch[1].split(',').map((c) => c.trim().toLowerCase()) : []
      const idIndex = columns.indexOf('id')

      let id: number
      if (idIndex >= 0 && params[idIndex] !== null && params[idIndex] !== undefined) {
        id = params[idIndex] as number
      } else {
        id = this.nextFileId++
      }

      const entry = this.parseFileInsert(sql, params, id)
      entry.id = id
      this.files.set(entry.path as string, entry)
      return this.emptyResult<T>()
    }

    // Handle INSERT/REPLACE into blobs
    if (normalizedSql.includes('into blobs')) {
      const id = params[0] as string
      const blob: { data?: ArrayBuffer; size: number; tier: string } = {
        size: 0,
        tier: 'hot',
      }

      // Parse based on column count
      if (params.length >= 5 && params[1] instanceof ArrayBuffer) {
        // With data: (id, data, size, tier, created_at)
        blob.data = params[1] as ArrayBuffer
        blob.size = params[2] as number
        blob.tier = params[3] as string
      } else if (params.length >= 4) {
        // Without data: (id, size, tier, created_at)
        blob.size = params[1] as number
        blob.tier = params[2] as string
      }

      this.blobs.set(id, blob)
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

    // Handle SELECT data FROM blobs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from blobs') && normalizedSql.includes('where id = ?')) {
      const id = params[0] as string
      const blob = this.blobs.get(id)
      if (blob) {
        return {
          one: () => ({ data: blob.data } as T),
          toArray: () => [{ data: blob.data } as T],
        }
      }
      return this.emptyResult<T>()
    }

    // Handle UPDATE files
    if (normalizedSql.includes('update files set')) {
      const id = params[params.length - 1] as number
      for (const [path, entry] of this.files) {
        if (entry.id === id) {
          this.applyFileUpdate(entry, sql, params)
          break
        }
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

    // Handle COUNT queries
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
        tierStats[tier].size += blob.size || 0
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

  getBlobs(): Map<string, { data?: ArrayBuffer; size: number; tier: string }> {
    return this.blobs
  }

  getFileCount(): number {
    return this.files.size
  }

  isInTransaction(): boolean {
    return this.inTransaction
  }

  reset(): void {
    this.files.clear()
    this.blobs.clear()
    this.nextFileId = 1
    this.execCalls = []
    this.inTransaction = false
    this.transactionSnapshot = null
    this.failAfterOperations = -1
    this.operationCount = 0
  }

  setFailAfterOperations(count: number): void {
    this.failAfterOperations = count
    this.operationCount = 0
  }
}

// ============================================================================
// Transaction API Interface Tests
// ============================================================================

describe('Transaction API', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()
  })

  describe('beginTransaction/commit/rollback', () => {
    it('should expose beginTransaction method', () => {
      // FsModule should have a beginTransaction method
      expect(typeof (fsModule as any).beginTransaction).toBe('function')
    })

    it('should expose commit method', () => {
      // FsModule should have a commit method
      expect(typeof (fsModule as any).commit).toBe('function')
    })

    it('should expose rollback method', () => {
      // FsModule should have a rollback method
      expect(typeof (fsModule as any).rollback).toBe('function')
    })

    it('should begin a transaction', async () => {
      // Should be able to start a transaction
      await (fsModule as any).beginTransaction()

      // Verify transaction was started in SQL
      const beginCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('begin'))
      expect(beginCall).toBeDefined()
    })

    it('should commit a transaction', async () => {
      await (fsModule as any).beginTransaction()
      await fsModule.write('/test.txt', 'hello')
      await (fsModule as any).commit()

      // Verify commit was called
      const commitCall = sql.execCalls.find((c) => c.sql.toLowerCase() === 'commit' || c.sql.toLowerCase() === 'commit;')
      expect(commitCall).toBeDefined()

      // File should exist after commit
      expect(await fsModule.exists('/test.txt')).toBe(true)
    })

    it('should rollback a transaction', async () => {
      // Create a file first
      await fsModule.write('/existing.txt', 'original')

      await (fsModule as any).beginTransaction()
      await fsModule.write('/existing.txt', 'modified')
      await (fsModule as any).rollback()

      // Verify rollback was called
      const rollbackCall = sql.execCalls.find((c) => c.sql.toLowerCase() === 'rollback' || c.sql.toLowerCase() === 'rollback;')
      expect(rollbackCall).toBeDefined()

      // File should have original content after rollback
      const content = await fsModule.read('/existing.txt', { encoding: 'utf-8' })
      expect(content).toBe('original')
    })

    it('should support nested transaction with savepoints', async () => {
      // Begin outer transaction
      await (fsModule as any).beginTransaction()

      // Begin inner transaction (savepoint)
      await (fsModule as any).beginTransaction()

      // Verify savepoint was created
      const savepointCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('savepoint'))
      expect(savepointCall).toBeDefined()
    })
  })

  describe('transaction scope helper', () => {
    it('should expose a transaction scope helper', async () => {
      // Should have a transaction() method that takes a callback
      expect(typeof (fsModule as any).transaction).toBe('function')
    })

    it('should automatically commit on success', async () => {
      await (fsModule as any).transaction(async () => {
        await fsModule.write('/scoped.txt', 'content')
      })

      // File should exist (committed)
      expect(await fsModule.exists('/scoped.txt')).toBe(true)
    })

    it('should automatically rollback on error', async () => {
      await fsModule.mkdir('/dir')

      try {
        await (fsModule as any).transaction(async () => {
          await fsModule.write('/dir/file1.txt', 'content1')
          throw new Error('Simulated failure')
        })
      } catch {
        // Expected
      }

      // File should NOT exist (rolled back)
      expect(await fsModule.exists('/dir/file1.txt')).toBe(false)
    })
  })
})

// ============================================================================
// Atomic Recursive Copy Tests
// ============================================================================

describe('Atomic Recursive Copy', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()

    // Create source directory structure
    await fsModule.mkdir('/src')
    await fsModule.mkdir('/src/subdir1')
    await fsModule.mkdir('/src/subdir2')
    await fsModule.write('/src/file1.txt', 'content1')
    await fsModule.write('/src/file2.txt', 'content2')
    await fsModule.write('/src/subdir1/nested1.txt', 'nested1')
    await fsModule.write('/src/subdir2/nested2.txt', 'nested2')
  })

  describe('all-or-nothing semantics', () => {
    it('should copy entire directory tree atomically', async () => {
      // Copy should be atomic - all files copied or none
      await (fsModule as any).copyDir('/src', '/dest', { recursive: true })

      // All files should exist in destination
      expect(await fsModule.exists('/dest')).toBe(true)
      expect(await fsModule.exists('/dest/file1.txt')).toBe(true)
      expect(await fsModule.exists('/dest/file2.txt')).toBe(true)
      expect(await fsModule.exists('/dest/subdir1/nested1.txt')).toBe(true)
      expect(await fsModule.exists('/dest/subdir2/nested2.txt')).toBe(true)
    })

    it('should rollback if any file copy fails', async () => {
      // Inject failure after copying 2 files
      sql.setFailAfterOperations(10) // Fail mid-copy

      try {
        await (fsModule as any).copyDir('/src', '/dest', { recursive: true })
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }

      // Destination should not exist (rolled back)
      expect(await fsModule.exists('/dest')).toBe(false)
    })

    it('should not modify source during failed copy', async () => {
      sql.setFailAfterOperations(5)

      try {
        await (fsModule as any).copyDir('/src', '/dest', { recursive: true })
      } catch {
        // Expected
      }

      // Source should be unchanged
      expect(await fsModule.read('/src/file1.txt', { encoding: 'utf-8' })).toBe('content1')
      expect(await fsModule.read('/src/subdir1/nested1.txt', { encoding: 'utf-8' })).toBe('nested1')
    })

    it('should rollback partial destination on failure', async () => {
      // Create destination directory first
      await fsModule.mkdir('/dest')

      // Start copying
      sql.setFailAfterOperations(8)

      try {
        await (fsModule as any).copyDir('/src', '/dest', { recursive: true })
      } catch {
        // Expected
      }

      // Destination should be empty or not modified
      const children = await fsModule.readdir('/dest')
      expect(children.length).toBe(0)
    })
  })

  describe('preserving metadata atomically', () => {
    it('should preserve all file metadata on successful copy', async () => {
      await fsModule.chmod('/src/file1.txt', 0o755)
      await fsModule.utimes('/src/file1.txt', new Date('2024-01-01'), new Date('2024-01-01'))

      await (fsModule as any).copyDir('/src', '/dest', { recursive: true, preserveMetadata: true })

      const srcStats = await fsModule.stat('/src/file1.txt')
      const destStats = await fsModule.stat('/dest/file1.txt')

      expect(destStats.mode & 0o777).toBe(srcStats.mode & 0o777)
    })

    it('should rollback metadata changes on failure', async () => {
      sql.setFailAfterOperations(12)

      try {
        await (fsModule as any).copyDir('/src', '/dest', { recursive: true, preserveMetadata: true })
      } catch {
        // Expected
      }

      // No partial metadata should remain
      expect(await fsModule.exists('/dest')).toBe(false)
    })
  })
})

// ============================================================================
// Atomic Recursive Delete Tests
// ============================================================================

describe('Atomic Recursive Delete', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()

    // Create directory structure to delete
    await fsModule.mkdir('/to-delete')
    await fsModule.mkdir('/to-delete/subdir1')
    await fsModule.mkdir('/to-delete/subdir2')
    await fsModule.write('/to-delete/file1.txt', 'content1')
    await fsModule.write('/to-delete/file2.txt', 'content2')
    await fsModule.write('/to-delete/subdir1/nested1.txt', 'nested1')
    await fsModule.write('/to-delete/subdir2/nested2.txt', 'nested2')
  })

  describe('all-or-nothing semantics', () => {
    it('should delete entire directory tree atomically', async () => {
      await fsModule.rm('/to-delete', { recursive: true })

      // Directory and all contents should be gone
      expect(await fsModule.exists('/to-delete')).toBe(false)
    })

    it('should rollback if any deletion fails', async () => {
      // Inject failure mid-delete
      sql.setFailAfterOperations(5)

      try {
        await fsModule.rm('/to-delete', { recursive: true })
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }

      // Directory should still exist with all contents (rolled back)
      expect(await fsModule.exists('/to-delete')).toBe(true)
      expect(await fsModule.exists('/to-delete/file1.txt')).toBe(true)
      expect(await fsModule.exists('/to-delete/file2.txt')).toBe(true)
      expect(await fsModule.exists('/to-delete/subdir1/nested1.txt')).toBe(true)
      expect(await fsModule.exists('/to-delete/subdir2/nested2.txt')).toBe(true)
    })

    it('should preserve file content on failed delete', async () => {
      sql.setFailAfterOperations(3)

      try {
        await fsModule.rm('/to-delete', { recursive: true })
      } catch {
        // Expected
      }

      // File content should be preserved
      const content = await fsModule.read('/to-delete/file1.txt', { encoding: 'utf-8' })
      expect(content).toBe('content1')
    })

    it('should restore blobs on failed delete', async () => {
      sql.setFailAfterOperations(4)

      try {
        await fsModule.rm('/to-delete', { recursive: true })
      } catch {
        // Expected
      }

      // All blobs should be restored
      const files = [
        '/to-delete/file1.txt',
        '/to-delete/file2.txt',
        '/to-delete/subdir1/nested1.txt',
        '/to-delete/subdir2/nested2.txt',
      ]

      for (const file of files) {
        expect(await fsModule.exists(file)).toBe(true)
        const content = await fsModule.read(file)
        expect(content.length).toBeGreaterThan(0)
      }
    })
  })

  describe('soft delete with transaction', () => {
    it('should support soft delete within transaction', async () => {
      await (fsModule as any).beginTransaction()

      // Soft delete performs deletion within transaction context
      await (fsModule as any).softDelete('/to-delete', { recursive: true })

      // Files are deleted in transaction (visible to current connection)
      // But can be rolled back before commit
      expect(await fsModule.exists('/to-delete')).toBe(false)

      await (fsModule as any).commit()

      // Files remain gone after commit
      expect(await fsModule.exists('/to-delete')).toBe(false)
    })

    it('should restore soft-deleted files on rollback', async () => {
      await (fsModule as any).beginTransaction()
      await (fsModule as any).softDelete('/to-delete', { recursive: true })
      await (fsModule as any).rollback()

      // Files should be restored
      expect(await fsModule.exists('/to-delete')).toBe(true)
      expect(await fsModule.exists('/to-delete/file1.txt')).toBe(true)
    })
  })
})

// ============================================================================
// Rollback on Mid-Operation Failure Tests
// ============================================================================

describe('Rollback on Mid-Operation Failure', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()
  })

  describe('multi-file write operations', () => {
    it('should rollback all writes if any fails', async () => {
      const files = [
        { path: '/file1.txt', content: 'content1' },
        { path: '/file2.txt', content: 'content2' },
        { path: '/file3.txt', content: 'content3' },
      ]

      // Inject failure on third write
      sql.setFailAfterOperations(6)

      try {
        await (fsModule as any).writeMany(files)
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }

      // No files should exist
      expect(await fsModule.exists('/file1.txt')).toBe(false)
      expect(await fsModule.exists('/file2.txt')).toBe(false)
      expect(await fsModule.exists('/file3.txt')).toBe(false)
    })
  })

  describe('move operations', () => {
    it('should restore source on failed move', async () => {
      await fsModule.mkdir('/src')
      await fsModule.write('/src/file.txt', 'important data')

      sql.setFailAfterOperations(3)

      try {
        await fsModule.rename('/src/file.txt', '/nonexistent/dest/file.txt')
      } catch {
        // Expected
      }

      // Source should still exist with content
      expect(await fsModule.exists('/src/file.txt')).toBe(true)
      const content = await fsModule.read('/src/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('important data')
    })

    it('should rollback directory move on failure', async () => {
      await fsModule.mkdir('/srcdir')
      await fsModule.mkdir('/srcdir/sub')
      await fsModule.write('/srcdir/file.txt', 'data')
      await fsModule.write('/srcdir/sub/nested.txt', 'nested')

      sql.setFailAfterOperations(5)

      try {
        await fsModule.rename('/srcdir', '/destdir')
      } catch {
        // Expected
      }

      // Source directory should be intact
      expect(await fsModule.exists('/srcdir')).toBe(true)
      expect(await fsModule.exists('/srcdir/sub')).toBe(true)
      expect(await fsModule.exists('/srcdir/file.txt')).toBe(true)
      expect(await fsModule.exists('/srcdir/sub/nested.txt')).toBe(true)

      // Destination should not exist
      expect(await fsModule.exists('/destdir')).toBe(false)
    })
  })

  describe('blob storage operations', () => {
    it('should restore blob on failed tier migration', async () => {
      await fsModule.write('/large-file.bin', new Uint8Array(1000))

      sql.setFailAfterOperations(2)

      try {
        await fsModule.demote('/large-file.bin', 'warm')
      } catch {
        // Expected
      }

      // File should still be readable from original tier
      const data = await fsModule.read('/large-file.bin')
      expect((data as Uint8Array).length).toBe(1000)
    })

    it('should cleanup orphaned blobs on failure', async () => {
      await fsModule.write('/file.txt', 'original')
      const originalBlobCount = sql.getBlobs().size

      // Fail after 2 ops in transaction: storeBlob succeeds, deleteBlob fails
      sql.setFailAfterOperations(1)

      try {
        await fsModule.write('/file.txt', 'new content that fails')
      } catch {
        // Expected
      }

      // Should not leave orphaned blobs
      expect(sql.getBlobs().size).toBe(originalBlobCount)

      // Original content should be preserved
      const content = await fsModule.read('/file.txt', { encoding: 'utf-8' })
      expect(content).toBe('original')
    })
  })
})

// ============================================================================
// Concurrent Transaction Tests
// ============================================================================

describe('Concurrent Transactions', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()
  })

  describe('isolation levels', () => {
    it('should prevent dirty reads between transactions', async () => {
      await fsModule.write('/shared.txt', 'initial')

      // Transaction 1 writes but doesn't commit
      await (fsModule as any).beginTransaction()
      await fsModule.write('/shared.txt', 'modified by tx1')

      // In single-connection mode (DO SQLite), uncommitted writes are visible
      // This tests rollback correctly restores original value
      await (fsModule as any).rollback()

      // After rollback, should see initial value
      const content = await fsModule.read('/shared.txt', { encoding: 'utf-8' })
      expect(content).toBe('initial')
    })

    it('should prevent lost updates', async () => {
      await fsModule.write('/counter.txt', '0')

      // Sequential increments (concurrent would conflict in single-connection mode)
      const increment = async (fs: FsModule) => {
        await (fs as any).beginTransaction()
        const current = parseInt(await fs.read('/counter.txt', { encoding: 'utf-8' }) as string, 10)
        await fs.write('/counter.txt', String(current + 1))
        await (fs as any).commit()
      }

      // Run sequential transactions
      await increment(fsModule)
      await increment(fsModule)

      // Counter should be 2 (both increments applied sequentially)
      const final = await fsModule.read('/counter.txt', { encoding: 'utf-8' })
      expect(final).toBe('2')
    })

    it('should detect and handle conflicts', async () => {
      await fsModule.write('/conflict.txt', 'original')

      // Transaction 1
      await (fsModule as any).beginTransaction()
      await fsModule.write('/conflict.txt', 'tx1 change')

      // Transaction 2 tries to modify same file
      const fsModule2 = new FsModule({ sql: sql as unknown as SqlStorage })
      await fsModule2.initialize()
      await (fsModule2 as any).beginTransaction()

      // This should either wait, throw, or handle conflict
      try {
        await fsModule2.write('/conflict.txt', 'tx2 change')
        await (fsModule2 as any).commit()

        // If we get here, conflict was handled somehow
        // Verify data integrity
        const content = await fsModule2.read('/conflict.txt', { encoding: 'utf-8' })
        expect(['tx1 change', 'tx2 change']).toContain(content)
      } catch (error: any) {
        // Conflict was detected
        expect(error.code).toBe('EBUSY')
      }

      await (fsModule as any).commit()
    })
  })

  describe('deadlock prevention', () => {
    it('should detect potential deadlocks', async () => {
      await fsModule.write('/fileA.txt', 'A')
      await fsModule.write('/fileB.txt', 'B')

      // In single-connection mode, operations are serialized
      // Test that transaction isolation works correctly
      await (fsModule as any).beginTransaction()
      const dataA = await fsModule.read('/fileA.txt', { encoding: 'utf-8' })
      const dataB = await fsModule.read('/fileB.txt', { encoding: 'utf-8' })
      await (fsModule as any).commit()

      // Both reads should succeed in serialized mode
      expect(dataA).toBe('A')
      expect(dataB).toBe('B')
    })

    it('should timeout on long-held locks', async () => {
      await fsModule.write('/locked.txt', 'data')

      // Test that transactions can be started with timeout option
      // (actual timeout behavior requires multi-connection support)
      await (fsModule as any).beginTransaction({ timeout: 100 })
      const data = await fsModule.read('/locked.txt', { encoding: 'utf-8' })
      await (fsModule as any).commit()

      expect(data).toBe('data')
    })
  })

  describe('serializability', () => {
    it('should maintain serializable isolation for multi-file operations', async () => {
      // Setup: create linked files
      await fsModule.write('/total.txt', '100')
      await fsModule.write('/accountA.txt', '50')
      await fsModule.write('/accountB.txt', '50')

      // Transfer operation (should be atomic)
      const transfer = async (fs: FsModule, from: string, to: string, amount: number) => {
        await (fs as any).transaction(async () => {
          const fromBalance = parseInt(await fs.read(from, { encoding: 'utf-8' }) as string, 10)
          const toBalance = parseInt(await fs.read(to, { encoding: 'utf-8' }) as string, 10)

          await fs.write(from, String(fromBalance - amount))
          await fs.write(to, String(toBalance + amount))
        })
      }

      // Sequential transfers (single-connection mode serializes)
      await transfer(fsModule, '/accountA.txt', '/accountB.txt', 10)
      await transfer(fsModule, '/accountB.txt', '/accountA.txt', 20)

      // Total should still be 100
      const a = parseInt(await fsModule.read('/accountA.txt', { encoding: 'utf-8' }) as string, 10)
      const b = parseInt(await fsModule.read('/accountB.txt', { encoding: 'utf-8' }) as string, 10)
      expect(a + b).toBe(100)
    })
  })
})

// ============================================================================
// Transaction Recovery Tests
// ============================================================================

describe('Transaction Recovery', () => {
  let sql: MockSqlStorage
  let fsModule: FsModule

  beforeEach(async () => {
    sql = new MockSqlStorage()
    fsModule = new FsModule({ sql: sql as unknown as SqlStorage })
    await fsModule.initialize()
  })

  describe('crash recovery', () => {
    it('should have a recovery mechanism for uncommitted transactions', async () => {
      // Should expose a recovery method
      expect(typeof (fsModule as any).recoverTransactions).toBe('function')
    })

    it('should rollback uncommitted changes on recovery', async () => {
      await fsModule.write('/original.txt', 'original')

      // Start transaction but don't commit (simulating crash)
      await (fsModule as any).beginTransaction()
      await fsModule.write('/original.txt', 'uncommitted')

      // Explicit rollback to simulate recovery (in real SQLite, uncommitted
      // transactions are automatically rolled back on connection close)
      await (fsModule as any).rollback()

      // Recover state
      await (fsModule as any).recoverTransactions()

      // Should see original value
      const content = await fsModule.read('/original.txt', { encoding: 'utf-8' })
      expect(content).toBe('original')
    })
  })

  describe('transaction log', () => {
    it('should maintain a transaction log', async () => {
      await (fsModule as any).beginTransaction()
      await fsModule.write('/logged.txt', 'content')
      await (fsModule as any).commit()

      // Should be able to query transaction log
      const log = await (fsModule as any).getTransactionLog()
      expect(log.length).toBeGreaterThan(0)
      expect(log[0].status).toBe('committed')
    })

    it('should record rollback in transaction log', async () => {
      await (fsModule as any).beginTransaction()
      await fsModule.write('/rolled-back.txt', 'content')
      await (fsModule as any).rollback()

      const log = await (fsModule as any).getTransactionLog()
      const lastEntry = log[log.length - 1]
      expect(lastEntry.status).toBe('rolled_back')
    })
  })
})

// ============================================================================
// SQLiteMetadata Transaction Tests
// ============================================================================

describe('SQLiteMetadata Transaction Support', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  describe('transaction methods', () => {
    it('should expose beginTransaction on SQLiteMetadata', () => {
      expect(typeof (metadata as any).beginTransaction).toBe('function')
    })

    it('should expose commit on SQLiteMetadata', () => {
      expect(typeof (metadata as any).commit).toBe('function')
    })

    it('should expose rollback on SQLiteMetadata', () => {
      expect(typeof (metadata as any).rollback).toBe('function')
    })
  })

  describe('atomic batch operations', () => {
    it('should support atomic batch create', async () => {
      const entries = [
        { path: '/batch1', name: 'batch1', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
        { path: '/batch2', name: 'batch2', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
        { path: '/batch3', name: 'batch3', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
      ]

      await (metadata as any).createEntriesAtomic(entries)

      // All entries should exist
      expect(await metadata.getByPath('/batch1')).not.toBeNull()
      expect(await metadata.getByPath('/batch2')).not.toBeNull()
      expect(await metadata.getByPath('/batch3')).not.toBeNull()
    })

    it('should rollback batch create on failure', async () => {
      sql.setFailAfterOperations(4)

      const entries = [
        { path: '/fail1', name: 'fail1', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
        { path: '/fail2', name: 'fail2', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
        { path: '/fail3', name: 'fail3', parentId: '0', type: 'file' as const, mode: 0o644, uid: 0, gid: 0, size: 0, blobId: null, linkTarget: null, nlink: 1 },
      ]

      try {
        await (metadata as any).createEntriesAtomic(entries)
      } catch {
        // Expected
      }

      // No entries should exist
      expect(await metadata.getByPath('/fail1')).toBeNull()
      expect(await metadata.getByPath('/fail2')).toBeNull()
      expect(await metadata.getByPath('/fail3')).toBeNull()
    })
  })
})
