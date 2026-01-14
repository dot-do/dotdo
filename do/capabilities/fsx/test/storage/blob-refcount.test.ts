/**
 * Tests for blob reference counting with hard links
 *
 * This test file verifies that blobs shared by hard links are properly
 * reference-counted. When multiple file entries point to the same blob:
 *
 * - Creating a hard link should increment the blob's ref count
 * - Deleting one hard link should decrement but NOT delete the blob
 * - Deleting ALL hard links should delete the blob (ref count = 0)
 * - Ref counts should persist across DO restarts
 * - Concurrent link/unlink operations should be safe
 *
 * These tests are expected to FAIL initially because blob reference
 * counting is not yet implemented in the storage layer.
 *
 * @module test/storage/blob-refcount
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SQLiteMetadata } from '../../storage/sqlite.js'
import type { FileEntry, BlobRef, StorageTier } from '../../core/types.js'
import type { CreateEntryOptions, MetadataStorage } from '../../storage/interfaces.js'

// ============================================================================
// Mock SqlStorage Implementation for Testing
// ============================================================================

interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SqlStorage behavior.
 * Extended to support blob reference counting tests.
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

    // Handle INSERT into blobs
    if (normalizedSql.includes('insert into blobs')) {
      const blob: Record<string, unknown> = {
        id: params[0] as string,
        tier: params[1] as string,
        size: params[2] as number,
        checksum: params[3] as string | null,
        created_at: params[4] as number,
        // NOTE: ref_count is NOT in the current schema - this is what we're testing
        ref_count: params[5] as number | undefined ?? 1,
      }
      this.blobs.set(blob.id as string, blob)
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

    // Handle COUNT files WHERE blob_id = ? (must come before SELECT to match COUNT queries first)
    if (normalizedSql.includes('count(*)') && normalizedSql.includes('from files') && normalizedSql.includes('where blob_id = ?')) {
      const blobId = params[0] as string
      let count = 0
      for (const entry of this.files.values()) {
        if (entry.blob_id === blobId) {
          count++
        }
      }
      return {
        one: () => ({ count } as T),
        toArray: () => [{ count } as T],
      }
    }

    // Handle SELECT from files WHERE blob_id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from files') && normalizedSql.includes('where blob_id = ?')) {
      const blobId = params[0] as string
      const matches: Record<string, unknown>[] = []
      for (const entry of this.files.values()) {
        if (entry.blob_id === blobId) {
          matches.push(entry)
        }
      }
      return {
        one: () => (matches.length > 0 ? (matches[0] as T) : null),
        toArray: () => matches as T[],
      }
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

    // Handle SELECT from blobs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('from blobs') && normalizedSql.includes('where id = ?')) {
      const id = params[0] as string
      const blob = this.blobs.get(id)
      return {
        one: () => (blob as T) || null,
        toArray: () => (blob ? [blob as T] : []),
      }
    }

    // Handle UPDATE blobs SET ref_count = ?
    if (normalizedSql.includes('update blobs') && normalizedSql.includes('ref_count')) {
      const id = params[params.length - 1] as string
      const blob = this.blobs.get(id)
      if (blob) {
        // Handle increment
        if (normalizedSql.includes('ref_count = ref_count + 1')) {
          blob.ref_count = ((blob.ref_count as number) || 1) + 1
        }
        // Handle decrement
        else if (normalizedSql.includes('ref_count = ref_count - 1')) {
          blob.ref_count = ((blob.ref_count as number) || 1) - 1
        }
        // Handle direct set
        else {
          blob.ref_count = params[0] as number
        }
      }
      return this.emptyResult<T>()
    }

    // Handle UPDATE blobs SET tier
    if (normalizedSql.includes('update blobs set tier')) {
      const id = params[params.length - 1] as string
      const blob = this.blobs.get(id)
      if (blob && normalizedSql.includes('tier = ?')) {
        blob.tier = params[0] as string
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

  getBlobRefCount(blobId: string): number | undefined {
    const blob = this.blobs.get(blobId)
    return blob?.ref_count as number | undefined
  }

  clear(): void {
    this.files.clear()
    this.blobs.clear()
    this.nextFileId = 1
    this.execCalls = []
  }
}

// ============================================================================
// Extended Metadata Interface for Ref Counting
// ============================================================================

/**
 * Extended metadata storage interface with ref counting support.
 * This interface represents what the implementation SHOULD provide.
 */
interface MetadataStorageWithRefCount extends MetadataStorage {
  /**
   * Increment blob reference count when creating a hard link.
   * @param blobId - The blob ID to increment
   */
  incrementBlobRefCount(blobId: string): Promise<void>

  /**
   * Decrement blob reference count when deleting a hard link.
   * Returns true if blob should be deleted (ref count reached 0).
   * @param blobId - The blob ID to decrement
   * @returns true if blob should be deleted
   */
  decrementBlobRefCount(blobId: string): Promise<boolean>

  /**
   * Get current reference count for a blob.
   * @param blobId - The blob ID
   * @returns Reference count or null if blob not found
   */
  getBlobRefCount(blobId: string): Promise<number | null>

  /**
   * Count files referencing a specific blob.
   * @param blobId - The blob ID
   * @returns Number of file entries with this blob_id
   */
  countBlobReferences(blobId: string): Promise<number>
}

// ============================================================================
// Blob Reference Counting Tests
// ============================================================================

describe('Blob Reference Counting with Hard Links', () => {
  let sql: MockSqlStorage
  let metadata: SQLiteMetadata

  beforeEach(async () => {
    sql = new MockSqlStorage()
    metadata = new SQLiteMetadata(sql as unknown as SqlStorage)
    await metadata.init()
  })

  // ==========================================================================
  // Test: Creating hard link increments blob ref count
  // ==========================================================================

  describe('creating hard links', () => {
    it('should increment blob ref count when creating a hard link', async () => {
      // Create original file with blob
      const blobId = 'shared-blob-123'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 1024,
        checksum: 'sha256:abc',
      })

      const originalId = await metadata.createEntry({
        path: '/original.txt',
        name: 'original.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 1024,
        blobId,
        linkTarget: null,
        nlink: 1,
      })

      // EXPECTED: Initial ref count should be 1
      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount
      const initialRefCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(initialRefCount).toBe(1)

      // Create hard link (same blobId, different path)
      await metadata.createEntry({
        path: '/hardlink.txt',
        name: 'hardlink.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 1024,
        blobId, // Same blob as original
        linkTarget: null,
        nlink: 2,
      })

      // Increment ref count for the shared blob
      await extendedMetadata.incrementBlobRefCount(blobId)

      // EXPECTED: Ref count should now be 2
      const newRefCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(newRefCount).toBe(2)
    })

    it('should track ref count for multiple hard links to same blob', async () => {
      const blobId = 'multi-link-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 512,
        checksum: 'sha256:xyz',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create 5 hard links to the same blob
      for (let i = 0; i < 5; i++) {
        await metadata.createEntry({
          path: `/link${i}.txt`,
          name: `link${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 512,
          blobId,
          linkTarget: null,
          nlink: i + 1,
        })

        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // EXPECTED: Ref count should be 5
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(5)
    })
  })

  // ==========================================================================
  // Test: Deleting one hard link doesn't delete shared blob
  // ==========================================================================

  describe('deleting hard links', () => {
    it('should NOT delete blob when one of multiple hard links is deleted', async () => {
      const blobId = 'protected-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 2048,
        checksum: 'sha256:protected',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create original file
      const originalId = await metadata.createEntry({
        path: '/original.txt',
        name: 'original.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 2048,
        blobId,
        linkTarget: null,
        nlink: 1,
      })

      // Create hard link
      const linkId = await metadata.createEntry({
        path: '/link.txt',
        name: 'link.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 2048,
        blobId,
        linkTarget: null,
        nlink: 2,
      })

      await extendedMetadata.incrementBlobRefCount(blobId)

      // Delete ONE hard link
      await metadata.deleteEntry(String(linkId))
      const shouldDeleteBlob = await extendedMetadata.decrementBlobRefCount(blobId)

      // EXPECTED: Should NOT delete blob (ref count is still 1)
      expect(shouldDeleteBlob).toBe(false)

      // EXPECTED: Blob should still exist
      const blob = await metadata.getBlob(blobId)
      expect(blob).not.toBeNull()

      // EXPECTED: Ref count should be 1
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(1)
    })

    it('should maintain blob integrity when deleting from middle of link chain', async () => {
      const blobId = 'chain-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 1000,
        checksum: 'sha256:chain',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount
      const linkIds: number[] = []

      // Create 5 hard links
      for (let i = 0; i < 5; i++) {
        const id = await metadata.createEntry({
          path: `/chainlink${i}.txt`,
          name: `chainlink${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 1000,
          blobId,
          linkTarget: null,
          nlink: 5,
        })
        linkIds.push(id)
        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // Delete links 1, 2, and 3 (middle of chain)
      for (const i of [1, 2, 3]) {
        await metadata.deleteEntry(String(linkIds[i]))
        await extendedMetadata.decrementBlobRefCount(blobId)
      }

      // EXPECTED: Blob should still exist (2 links remain)
      const blob = await metadata.getBlob(blobId)
      expect(blob).not.toBeNull()

      // EXPECTED: Ref count should be 2
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(2)

      // EXPECTED: Remaining files should still be accessible
      const link0 = await metadata.getByPath('/chainlink0.txt')
      const link4 = await metadata.getByPath('/chainlink4.txt')
      expect(link0?.blobId).toBe(blobId)
      expect(link4?.blobId).toBe(blobId)
    })
  })

  // ==========================================================================
  // Test: Deleting ALL hard links deletes the blob
  // ==========================================================================

  describe('deleting all hard links', () => {
    it('should delete blob when ALL hard links are deleted', async () => {
      const blobId = 'deletable-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 4096,
        checksum: 'sha256:deletable',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create two hard links
      const id1 = await metadata.createEntry({
        path: '/file1.txt',
        name: 'file1.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 4096,
        blobId,
        linkTarget: null,
        nlink: 2,
      })

      const id2 = await metadata.createEntry({
        path: '/file2.txt',
        name: 'file2.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 4096,
        blobId,
        linkTarget: null,
        nlink: 2,
      })

      await extendedMetadata.incrementBlobRefCount(blobId)

      // Verify ref count is 2
      let refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(2)

      // Delete first hard link
      await metadata.deleteEntry(String(id1))
      let shouldDelete = await extendedMetadata.decrementBlobRefCount(blobId)
      expect(shouldDelete).toBe(false)

      // Delete second (last) hard link
      await metadata.deleteEntry(String(id2))
      shouldDelete = await extendedMetadata.decrementBlobRefCount(blobId)

      // EXPECTED: Should signal blob deletion (ref count = 0)
      expect(shouldDelete).toBe(true)

      // Actually delete the blob
      if (shouldDelete) {
        await metadata.deleteBlob(blobId)
      }

      // EXPECTED: Blob should be deleted
      const blob = await metadata.getBlob(blobId)
      expect(blob).toBeNull()
    })

    it('should return correct shouldDelete flag for last reference', async () => {
      const blobId = 'single-ref-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 100,
        checksum: 'sha256:single',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create single file (no hard links)
      const id = await metadata.createEntry({
        path: '/single.txt',
        name: 'single.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 100,
        blobId,
        linkTarget: null,
        nlink: 1,
      })

      // Delete the only file
      await metadata.deleteEntry(String(id))
      const shouldDelete = await extendedMetadata.decrementBlobRefCount(blobId)

      // EXPECTED: Should delete blob since it was the only reference
      expect(shouldDelete).toBe(true)
    })
  })

  // ==========================================================================
  // Test: Ref count survives DO restarts (persisted)
  // ==========================================================================

  describe('persistence across restarts', () => {
    it('should persist blob ref count in storage', async () => {
      const blobId = 'persistent-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 512,
        checksum: 'sha256:persist',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create multiple hard links
      for (let i = 0; i < 3; i++) {
        await metadata.createEntry({
          path: `/persist${i}.txt`,
          name: `persist${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 512,
          blobId,
          linkTarget: null,
          nlink: 3,
        })
        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // Verify INSERT/UPDATE included ref_count column
      const blobInsertCalls = sql.execCalls.filter(
        (c) => c.sql.toLowerCase().includes('blobs') && (c.sql.toLowerCase().includes('insert') || c.sql.toLowerCase().includes('update'))
      )

      // EXPECTED: SQL should include ref_count column
      const hasRefCountColumn = blobInsertCalls.some((c) => c.sql.toLowerCase().includes('ref_count'))
      expect(hasRefCountColumn).toBe(true)

      // Simulate DO restart by creating new metadata instance with same storage
      const metadata2 = new SQLiteMetadata(sql as unknown as SqlStorage)
      await metadata2.init()
      const extendedMetadata2 = metadata2 as unknown as MetadataStorageWithRefCount

      // EXPECTED: Ref count should persist after "restart"
      const refCount = await extendedMetadata2.getBlobRefCount(blobId)
      expect(refCount).toBe(3)
    })

    it('should include ref_count in blob schema', async () => {
      // Check that blobs table creation includes ref_count column
      const createBlobsCall = sql.execCalls.find((c) => c.sql.toLowerCase().includes('create table') && c.sql.toLowerCase().includes('blobs'))

      // EXPECTED: Blobs table should have ref_count column
      expect(createBlobsCall?.sql.toLowerCase()).toContain('ref_count')
    })

    it('should default ref_count to 1 for new blobs', async () => {
      const blobId = 'default-refcount-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 256,
        checksum: 'sha256:default',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // EXPECTED: New blob should have ref_count = 1
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(1)
    })
  })

  // ==========================================================================
  // Test: Concurrent link/unlink operations are safe
  // ==========================================================================

  describe('concurrent operations', () => {
    it('should handle concurrent hard link creation safely', async () => {
      const blobId = 'concurrent-create-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 1024,
        checksum: 'sha256:concurrent-create',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create original file
      await metadata.createEntry({
        path: '/original-concurrent.txt',
        name: 'original-concurrent.txt',
        parentId: '0',
        type: 'file',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 1024,
        blobId,
        linkTarget: null,
        nlink: 1,
      })

      // Simulate concurrent hard link creations
      const concurrentCreates = Array.from({ length: 10 }, (_, i) =>
        (async () => {
          await metadata.createEntry({
            path: `/concurrent-link-${i}.txt`,
            name: `concurrent-link-${i}.txt`,
            parentId: '0',
            type: 'file',
            mode: 0o644,
            uid: 0,
            gid: 0,
            size: 1024,
            blobId,
            linkTarget: null,
            nlink: i + 2,
          })
          await extendedMetadata.incrementBlobRefCount(blobId)
        })()
      )

      await Promise.all(concurrentCreates)

      // EXPECTED: Ref count should be 11 (1 original + 10 links)
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(11)
    })

    it('should handle concurrent hard link deletion safely', async () => {
      const blobId = 'concurrent-delete-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 2048,
        checksum: 'sha256:concurrent-delete',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount
      const linkIds: number[] = []

      // Create 10 hard links
      for (let i = 0; i < 10; i++) {
        const id = await metadata.createEntry({
          path: `/delete-concurrent-${i}.txt`,
          name: `delete-concurrent-${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 2048,
          blobId,
          linkTarget: null,
          nlink: 10,
        })
        linkIds.push(id)
        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // Verify initial ref count
      let refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(10)

      // Delete first 8 concurrently (keep 2)
      const concurrentDeletes = linkIds.slice(0, 8).map((id) =>
        (async () => {
          await metadata.deleteEntry(String(id))
          await extendedMetadata.decrementBlobRefCount(blobId)
        })()
      )

      await Promise.all(concurrentDeletes)

      // EXPECTED: Ref count should be 2
      refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(2)

      // EXPECTED: Blob should still exist
      const blob = await metadata.getBlob(blobId)
      expect(blob).not.toBeNull()
    })

    it('should handle mixed concurrent create/delete safely', async () => {
      const blobId = 'mixed-concurrent-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 1500,
        checksum: 'sha256:mixed',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create initial links
      const initialIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const id = await metadata.createEntry({
          path: `/mixed-initial-${i}.txt`,
          name: `mixed-initial-${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 1500,
          blobId,
          linkTarget: null,
          nlink: 5,
        })
        initialIds.push(id)
        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // Concurrent: delete 3, create 4 new
      const deleteOps = initialIds.slice(0, 3).map((id) =>
        (async () => {
          await metadata.deleteEntry(String(id))
          await extendedMetadata.decrementBlobRefCount(blobId)
        })()
      )

      let newLinkId = 100
      const createOps = Array.from({ length: 4 }, (_, i) =>
        (async () => {
          await metadata.createEntry({
            path: `/mixed-new-${i}.txt`,
            name: `mixed-new-${i}.txt`,
            parentId: '0',
            type: 'file',
            mode: 0o644,
            uid: 0,
            gid: 0,
            size: 1500,
            blobId,
            linkTarget: null,
            nlink: 6,
          })
          await extendedMetadata.incrementBlobRefCount(blobId)
        })()
      )

      await Promise.all([...deleteOps, ...createOps])

      // EXPECTED: Ref count should be 5 - 3 + 4 = 6
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(6)
    })
  })

  // ==========================================================================
  // Test: countBlobReferences helper
  // ==========================================================================

  describe('countBlobReferences utility', () => {
    it('should count files referencing a blob', async () => {
      const blobId = 'counted-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 500,
        checksum: 'sha256:counted',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create several files with the same blob
      for (let i = 0; i < 4; i++) {
        await metadata.createEntry({
          path: `/counted-${i}.txt`,
          name: `counted-${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 500,
          blobId,
          linkTarget: null,
          nlink: 4,
        })
      }

      // EXPECTED: Should count 4 file entries referencing this blob
      const count = await extendedMetadata.countBlobReferences(blobId)
      expect(count).toBe(4)
    })

    it('should return 0 for blob with no references', async () => {
      const blobId = 'orphan-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'cold',
        size: 10000,
        checksum: 'sha256:orphan',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // No files created - blob is orphaned
      const count = await extendedMetadata.countBlobReferences(blobId)
      expect(count).toBe(0)
    })
  })

  // ==========================================================================
  // Test: Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle decrement on blob with ref_count = 1', async () => {
      const blobId = 'edge-single-ref'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 100,
        checksum: 'sha256:edge',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Decrement from 1 -> 0
      const shouldDelete = await extendedMetadata.decrementBlobRefCount(blobId)

      // EXPECTED: Should return true
      expect(shouldDelete).toBe(true)

      // EXPECTED: Ref count should be 0
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(0)
    })

    it('should NOT allow ref_count to go negative', async () => {
      const blobId = 'no-negative-ref'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 100,
        checksum: 'sha256:noneg',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Decrement multiple times
      await extendedMetadata.decrementBlobRefCount(blobId)
      await extendedMetadata.decrementBlobRefCount(blobId)
      await extendedMetadata.decrementBlobRefCount(blobId)

      // EXPECTED: Ref count should be 0, not negative
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBeGreaterThanOrEqual(0)
    })

    it('should handle non-existent blob gracefully', async () => {
      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // EXPECTED: Should return null or 0 for non-existent blob
      const refCount = await extendedMetadata.getBlobRefCount('non-existent-blob')
      expect(refCount === null || refCount === 0).toBe(true)
    })

    it('should handle blob with many references efficiently', async () => {
      const blobId = 'many-refs-blob'
      await metadata.registerBlob({
        id: blobId,
        tier: 'hot',
        size: 100,
        checksum: 'sha256:manyrefs',
      })

      const extendedMetadata = metadata as unknown as MetadataStorageWithRefCount

      // Create 100 hard links
      for (let i = 0; i < 100; i++) {
        await metadata.createEntry({
          path: `/manyref-${i}.txt`,
          name: `manyref-${i}.txt`,
          parentId: '0',
          type: 'file',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 100,
          blobId,
          linkTarget: null,
          nlink: 100,
        })
        if (i > 0) {
          await extendedMetadata.incrementBlobRefCount(blobId)
        }
      }

      // EXPECTED: Ref count should be 100
      const refCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(refCount).toBe(100)

      // Delete 50 links
      for (let i = 0; i < 50; i++) {
        await extendedMetadata.decrementBlobRefCount(blobId)
      }

      // EXPECTED: Ref count should be 50
      const newRefCount = await extendedMetadata.getBlobRefCount(blobId)
      expect(newRefCount).toBe(50)
    })
  })
})
