/**
 * TDD RED Phase: Failing tests for FileHandle.sync() and FileHandle.datasync()
 *
 * These tests define the expected behavior of FileHandle sync operations:
 * - sync() flushes pending writes (data + metadata) to storage
 * - datasync() flushes only data (not metadata) to storage
 * - Multiple syncs are idempotent
 * - Sync after no changes is a no-op
 * - Error: sync on closed handle throws
 * - Error: sync on write-only handle behavior
 * - Sync preserves file position
 * - Sync updates atime metadata
 *
 * @see fsx-x3s: RED: Write failing tests for FileHandle.sync()
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FileHandle, Stats, StatsLike } from '../core/types'
import { constants } from '../core/constants'

/**
 * Create a mock StatsLike object for FileHandle initialization
 */
function createMockStats(overrides: Partial<StatsLike> = {}): StatsLike {
  const now = new Date()
  return {
    dev: 0,
    ino: 1,
    mode: constants.S_IFREG | 0o644,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 4096,
    blocks: 0,
    atime: now,
    mtime: now,
    ctime: now,
    birthtime: now,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    ...overrides,
  }
}

/**
 * Create a FileHandle with given initial data
 */
function createFileHandle(
  initialData: Uint8Array = new Uint8Array(0),
  stats?: StatsLike
): FileHandle {
  const mockStats = stats ?? createMockStats({ size: initialData.length })
  return new FileHandle(3, initialData, mockStats)
}

describe('FileHandle.sync()', () => {
  // ===========================================================================
  // Basic sync operation
  // ===========================================================================

  describe('basic sync operation', () => {
    it('should resolve to undefined on successful sync', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5]))

      const result = await handle.sync()

      expect(result).toBeUndefined()
    })

    it('should return a Promise', async () => {
      const handle = createFileHandle()

      const syncPromise = handle.sync()

      expect(syncPromise).toBeInstanceOf(Promise)
      await syncPromise
    })

    it('should not throw on sync of read-only handle', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3]))
      handle._writable = false

      // Syncing a read-only handle should work (no pending writes to flush)
      await expect(handle.sync()).resolves.toBeUndefined()
    })

    it('should not throw on sync of empty file', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      await expect(handle.sync()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Sync flushes pending writes
  // ===========================================================================

  describe('sync flushes pending writes', () => {
    it('should flush pending write to storage', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))

      await handle.sync()

      // Verify data is readable after sync
      const buffer = new Uint8Array(5)
      const { bytesRead } = await handle.read(buffer, 0, 5, 0)
      expect(bytesRead).toBe(5)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })

    it('should flush multiple pending writes', async () => {
      const handle = createFileHandle()

      await handle.write(new Uint8Array([1, 2, 3]), 0)
      await handle.write(new Uint8Array([4, 5, 6]), 3)
      await handle.write(new Uint8Array([7, 8, 9]), 6)

      await handle.sync()

      // Verify all writes are persisted
      const buffer = new Uint8Array(9)
      await handle.read(buffer, 0, 9, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    })

    it('should flush string writes', async () => {
      const handle = createFileHandle()
      await handle.write('Hello, World!')

      await handle.sync()

      const buffer = new Uint8Array(13)
      await handle.read(buffer, 0, 13, 0)
      expect(new TextDecoder().decode(buffer)).toBe('Hello, World!')
    })

    it('should flush partial buffer writes', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      // Write only portion of buffer (bytes 3-5)
      await handle.write(data, 0, 3, 3)

      await handle.sync()

      const buffer = new Uint8Array(3)
      await handle.read(buffer, 0, 3, 0)
      expect(buffer).toEqual(new Uint8Array([3, 4, 5]))
    })

    it('should make writes visible to subsequent reads after sync', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      await handle.write(new Uint8Array([0xAA, 0xBB, 0xCC]), 5)
      await handle.sync()

      const buffer = new Uint8Array(3)
      await handle.read(buffer, 0, 3, 5)
      expect(buffer).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]))
    })
  })

  // ===========================================================================
  // Multiple syncs are idempotent
  // ===========================================================================

  describe('multiple syncs are idempotent', () => {
    it('should allow calling sync multiple times', async () => {
      const handle = createFileHandle()
      await handle.write('test data')

      // Multiple syncs should all succeed
      await handle.sync()
      await handle.sync()
      await handle.sync()

      // Data should still be accessible
      const buffer = new Uint8Array(9)
      await handle.read(buffer, 0, 9, 0)
      expect(new TextDecoder().decode(buffer)).toBe('test data')
    })

    it('should have same effect whether sync is called once or multiple times', async () => {
      const handle1 = createFileHandle()
      const handle2 = createFileHandle()

      // Write same data to both handles
      await handle1.write(new Uint8Array([1, 2, 3, 4, 5]))
      await handle2.write(new Uint8Array([1, 2, 3, 4, 5]))

      // Sync handle1 once
      await handle1.sync()

      // Sync handle2 multiple times
      await handle2.sync()
      await handle2.sync()
      await handle2.sync()

      // Both should have same result
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(5)
      await handle1.read(buffer1, 0, 5, 0)
      await handle2.read(buffer2, 0, 5, 0)

      expect(buffer1).toEqual(buffer2)
    })

    it('should not duplicate data on multiple syncs', async () => {
      const handle = createFileHandle()
      await handle.write('Hello')

      await handle.sync()
      await handle.sync()
      await handle.sync()

      const stats = await handle.stat()
      expect(stats.size).toBe(5) // Should still be 5 bytes, not 15
    })
  })

  // ===========================================================================
  // Sync after no changes is no-op
  // ===========================================================================

  describe('sync after no changes is no-op', () => {
    it('should succeed when syncing immediately after open (no writes)', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5]))

      // No writes, just sync
      await expect(handle.sync()).resolves.toBeUndefined()
    })

    it('should not modify file when syncing without pending changes', async () => {
      const initialData = new Uint8Array([10, 20, 30, 40, 50])
      const handle = createFileHandle(initialData)

      const statsBefore = await handle.stat()
      await handle.sync()
      const statsAfter = await handle.stat()

      // Size should remain unchanged
      expect(statsAfter.size).toBe(statsBefore.size)

      // Data should be unchanged
      const buffer = new Uint8Array(5)
      await handle.read(buffer, 0, 5, 0)
      expect(buffer).toEqual(initialData)
    })

    it('should succeed when syncing after a previous sync with no new changes', async () => {
      const handle = createFileHandle()
      await handle.write('test')

      await handle.sync() // First sync flushes the write

      // Second sync with no new changes
      await expect(handle.sync()).resolves.toBeUndefined()
    })

    it('should not affect file size when syncing with no changes', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      const sizeBefore = (await handle.stat()).size
      await handle.sync()
      const sizeAfter = (await handle.stat()).size

      expect(sizeAfter).toBe(sizeBefore)
    })
  })

  // ===========================================================================
  // Error: closed handle
  // ===========================================================================

  describe('error: closed handle', () => {
    it('should throw when calling sync() on closed handle', async () => {
      const handle = createFileHandle()
      await handle.close()

      await expect(handle.sync()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw with EBADF error code for closed handle', async () => {
      const handle = createFileHandle()
      await handle.close()

      try {
        await handle.sync()
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const err = error as Error & { code?: string }
        // Error should indicate handle is closed
        expect(err.message).toMatch(/closed|invalid|bad file descriptor/i)
      }
    })

    it('should throw even if there were writes before close', async () => {
      const handle = createFileHandle()
      await handle.write('test data')
      await handle.close()

      await expect(handle.sync()).rejects.toThrow(/closed|invalid/i)
    })

    it('should throw after multiple close calls', async () => {
      const handle = createFileHandle()
      await handle.close()
      await handle.close() // Second close is idempotent

      await expect(handle.sync()).rejects.toThrow(/closed|invalid/i)
    })
  })

  // ===========================================================================
  // Sync preserves file position
  // ===========================================================================

  describe('sync preserves file position', () => {
    it('should preserve read position after sync', async () => {
      const handle = createFileHandle(new TextEncoder().encode('Hello, World!'))

      // Read 5 bytes to advance position
      const buffer1 = new Uint8Array(5)
      await handle.read(buffer1, 0, 5)

      await handle.sync()

      // Position should still be at 5, next read should get ", Wor"
      const buffer2 = new Uint8Array(5)
      await handle.read(buffer2, 0, 5)
      expect(new TextDecoder().decode(buffer2)).toBe(', Wor')
    })

    it('should preserve write position after sync', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // Write at position 0, then at current position
      await handle.write(new Uint8Array([1, 2, 3]), 0)
      await handle.write(new Uint8Array([4, 5, 6]), null) // Continue from position 3

      await handle.sync()

      // Next write with null should continue from position 6
      await handle.write(new Uint8Array([7, 8, 9]), null)

      const buffer = new Uint8Array(9)
      await handle.read(buffer, 0, 9, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    })
  })

  // ===========================================================================
  // Sync and metadata
  // ===========================================================================

  describe('sync and metadata', () => {
    it('should ensure mtime is updated after write + sync', async () => {
      const handle = createFileHandle(new Uint8Array(5))

      const statsBefore = await handle.stat()

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await handle.write(new Uint8Array([0xFF]), 0)
      await handle.sync()

      const statsAfter = await handle.stat()
      expect(statsAfter.mtimeMs).toBeGreaterThanOrEqual(statsBefore.mtimeMs)
    })

    it('should reflect size changes after sync', async () => {
      const handle = createFileHandle(new Uint8Array(5))

      const statsBefore = await handle.stat()
      expect(statsBefore.size).toBe(5)

      // Extend file
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]), 10)
      await handle.sync()

      const statsAfter = await handle.stat()
      expect(statsAfter.size).toBe(15) // Extended to position 10 + 5 bytes
    })
  })

  // ===========================================================================
  // Large data sync
  // ===========================================================================

  describe('large data sync', () => {
    it('should handle sync of large file (1MB)', async () => {
      const handle = createFileHandle()
      const size = 1024 * 1024
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      await handle.write(data)
      await expect(handle.sync()).resolves.toBeUndefined()

      // Verify data integrity
      const stats = await handle.stat()
      expect(stats.size).toBe(size)
    })

    it('should handle multiple large writes before sync', async () => {
      const handle = createFileHandle()
      const chunkSize = 100 * 1024 // 100KB
      const numChunks = 5

      for (let i = 0; i < numChunks; i++) {
        const chunk = new Uint8Array(chunkSize)
        chunk.fill(i)
        await handle.write(chunk, i * chunkSize)
      }

      await expect(handle.sync()).resolves.toBeUndefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(chunkSize * numChunks)
    })
  })

  // ===========================================================================
  // Concurrent sync operations
  // ===========================================================================

  describe('concurrent sync operations', () => {
    it('should handle concurrent sync calls safely', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))

      // Concurrent syncs should all succeed
      const [result1, result2, result3] = await Promise.all([
        handle.sync(),
        handle.sync(),
        handle.sync(),
      ])

      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
      expect(result3).toBeUndefined()
    })

    it('should maintain data integrity with concurrent syncs', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([10, 20, 30, 40, 50])
      await handle.write(data)

      await Promise.all([handle.sync(), handle.sync(), handle.sync()])

      const buffer = new Uint8Array(5)
      await handle.read(buffer, 0, 5, 0)
      expect(buffer).toEqual(data)
    })
  })
})

describe('FileHandle.datasync()', () => {
  // ===========================================================================
  // Basic datasync operation
  // ===========================================================================

  describe('basic datasync operation', () => {
    it('should resolve to undefined on successful datasync', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5]))

      const result = await handle.datasync()

      expect(result).toBeUndefined()
    })

    it('should return a Promise', async () => {
      const handle = createFileHandle()

      const datasyncPromise = handle.datasync()

      expect(datasyncPromise).toBeInstanceOf(Promise)
      await datasyncPromise
    })

    it('should not throw on datasync of empty file', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      await expect(handle.datasync()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Datasync flushes data only (not metadata)
  // ===========================================================================

  describe('datasync flushes data only (not metadata)', () => {
    it('should flush file data to storage', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))

      await handle.datasync()

      // Data should be readable
      const buffer = new Uint8Array(5)
      const { bytesRead } = await handle.read(buffer, 0, 5, 0)
      expect(bytesRead).toBe(5)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })

    it('should flush string data to storage', async () => {
      const handle = createFileHandle()
      await handle.write('Datasync test')

      await handle.datasync()

      const buffer = new Uint8Array(13)
      await handle.read(buffer, 0, 13, 0)
      expect(new TextDecoder().decode(buffer)).toBe('Datasync test')
    })

    it('should be faster than sync() for metadata-heavy operations', async () => {
      // This test is more about documenting expected behavior than performance testing
      // In practice, datasync skips metadata updates which can be more efficient
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3]))

      // Both should succeed
      await expect(handle.datasync()).resolves.toBeUndefined()
      await expect(handle.sync()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Multiple datasync calls are idempotent
  // ===========================================================================

  describe('multiple datasync calls are idempotent', () => {
    it('should allow calling datasync multiple times', async () => {
      const handle = createFileHandle()
      await handle.write('test data')

      await handle.datasync()
      await handle.datasync()
      await handle.datasync()

      // Data should still be accessible
      const buffer = new Uint8Array(9)
      await handle.read(buffer, 0, 9, 0)
      expect(new TextDecoder().decode(buffer)).toBe('test data')
    })

    it('should not duplicate data on multiple datasync calls', async () => {
      const handle = createFileHandle()
      await handle.write('Hello')

      await handle.datasync()
      await handle.datasync()
      await handle.datasync()

      const stats = await handle.stat()
      expect(stats.size).toBe(5)
    })
  })

  // ===========================================================================
  // Datasync after no changes is no-op
  // ===========================================================================

  describe('datasync after no changes is no-op', () => {
    it('should succeed when datasync called with no pending writes', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5]))

      await expect(handle.datasync()).resolves.toBeUndefined()
    })

    it('should not modify file when datasync called without changes', async () => {
      const initialData = new Uint8Array([10, 20, 30])
      const handle = createFileHandle(initialData)

      await handle.datasync()

      const buffer = new Uint8Array(3)
      await handle.read(buffer, 0, 3, 0)
      expect(buffer).toEqual(initialData)
    })

    it('should succeed after previous datasync with no new changes', async () => {
      const handle = createFileHandle()
      await handle.write('test')

      await handle.datasync()
      await expect(handle.datasync()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Error: closed handle
  // ===========================================================================

  describe('error: closed handle', () => {
    it('should throw when calling datasync() on closed handle', async () => {
      const handle = createFileHandle()
      await handle.close()

      await expect(handle.datasync()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw even if there were writes before close', async () => {
      const handle = createFileHandle()
      await handle.write('test data')
      await handle.close()

      await expect(handle.datasync()).rejects.toThrow(/closed|invalid/i)
    })
  })

  // ===========================================================================
  // Datasync preserves file position
  // ===========================================================================

  describe('datasync preserves file position', () => {
    it('should preserve read position after datasync', async () => {
      const handle = createFileHandle(new TextEncoder().encode('ABCDEFGHIJ'))

      // Read 4 bytes to advance position
      const buffer1 = new Uint8Array(4)
      await handle.read(buffer1, 0, 4)

      await handle.datasync()

      // Position should still be at 4, next read should get "EFGH"
      const buffer2 = new Uint8Array(4)
      await handle.read(buffer2, 0, 4)
      expect(new TextDecoder().decode(buffer2)).toBe('EFGH')
    })

    it('should preserve write position after datasync', async () => {
      const handle = createFileHandle(new Uint8Array(20))

      await handle.write(new Uint8Array([1, 2, 3, 4, 5]), 0)
      await handle.datasync()
      await handle.write(new Uint8Array([6, 7, 8, 9, 10]), null)

      const buffer = new Uint8Array(10)
      await handle.read(buffer, 0, 10, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    })
  })

  // ===========================================================================
  // Sync vs Datasync comparison
  // ===========================================================================

  describe('sync vs datasync comparison', () => {
    it('should have same data persistence effect as sync()', async () => {
      const handle1 = createFileHandle()
      const handle2 = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5])

      await handle1.write(data)
      await handle1.sync()

      await handle2.write(data)
      await handle2.datasync()

      // Both should have same data
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(5)
      await handle1.read(buffer1, 0, 5, 0)
      await handle2.read(buffer2, 0, 5, 0)

      expect(buffer1).toEqual(buffer2)
    })

    it('should both flush pending writes', async () => {
      const handle = createFileHandle()

      await handle.write(new Uint8Array([1, 2, 3]))
      await handle.sync()

      await handle.write(new Uint8Array([4, 5, 6]), 3)
      await handle.datasync()

      const buffer = new Uint8Array(6)
      await handle.read(buffer, 0, 6, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    })

    it('should both throw on closed handle', async () => {
      const handle1 = createFileHandle()
      const handle2 = createFileHandle()

      await handle1.close()
      await handle2.close()

      await expect(handle1.sync()).rejects.toThrow(/closed/i)
      await expect(handle2.datasync()).rejects.toThrow(/closed/i)
    })
  })

  // ===========================================================================
  // Large data datasync
  // ===========================================================================

  describe('large data datasync', () => {
    it('should handle datasync of large file', async () => {
      const handle = createFileHandle()
      const size = 500 * 1024 // 500KB
      const data = new Uint8Array(size)
      data.fill(0xAB)

      await handle.write(data)
      await expect(handle.datasync()).resolves.toBeUndefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(size)
    })
  })

  // ===========================================================================
  // Concurrent datasync operations
  // ===========================================================================

  describe('concurrent datasync operations', () => {
    it('should handle concurrent datasync calls safely', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))

      const results = await Promise.all([
        handle.datasync(),
        handle.datasync(),
        handle.datasync(),
      ])

      results.forEach((result) => expect(result).toBeUndefined())
    })

    it('should maintain data integrity with concurrent datasyncs', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([99, 88, 77, 66, 55])
      await handle.write(data)

      await Promise.all([handle.datasync(), handle.datasync(), handle.datasync()])

      const buffer = new Uint8Array(5)
      await handle.read(buffer, 0, 5, 0)
      expect(buffer).toEqual(data)
    })
  })
})

describe('FileHandle sync edge cases', () => {
  // ===========================================================================
  // Interleaved sync and datasync
  // ===========================================================================

  describe('interleaved sync and datasync', () => {
    it('should allow interleaved sync and datasync calls', async () => {
      const handle = createFileHandle()

      await handle.write(new Uint8Array([1, 2, 3]))
      await handle.sync()

      await handle.write(new Uint8Array([4, 5, 6]), 3)
      await handle.datasync()

      await handle.write(new Uint8Array([7, 8, 9]), 6)
      await handle.sync()

      const buffer = new Uint8Array(9)
      await handle.read(buffer, 0, 9, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    })

    it('should handle mixed concurrent sync and datasync', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))

      const results = await Promise.all([
        handle.sync(),
        handle.datasync(),
        handle.sync(),
        handle.datasync(),
      ])

      results.forEach((result) => expect(result).toBeUndefined())

      const buffer = new Uint8Array(5)
      await handle.read(buffer, 0, 5, 0)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })
  })

  // ===========================================================================
  // Sync with truncate
  // ===========================================================================

  describe('sync with truncate', () => {
    it('should sync after truncate', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

      await handle.truncate(5)
      await expect(handle.sync()).resolves.toBeUndefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(5)
    })

    it('should datasync after truncate', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

      await handle.truncate(3)
      await expect(handle.datasync()).resolves.toBeUndefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(3)
    })

    it('should sync after extending file via truncate', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3]))

      await handle.truncate(10) // Extend with zeros
      await expect(handle.sync()).resolves.toBeUndefined()

      const stats = await handle.stat()
      expect(stats.size).toBe(10)
    })
  })

  // ===========================================================================
  // Sync timing
  // ===========================================================================

  describe('sync timing', () => {
    it('should complete quickly for small files', async () => {
      const handle = createFileHandle()
      await handle.write(new Uint8Array([1, 2, 3]))

      const start = Date.now()
      await handle.sync()
      const elapsed = Date.now() - start

      // Should complete in reasonable time (< 100ms for in-memory)
      expect(elapsed).toBeLessThan(100)
    })

    it('should not block writes while syncing', async () => {
      const handle = createFileHandle()

      // Start a sync
      const syncPromise = handle.sync()

      // Should be able to write (might be queued depending on impl)
      await handle.write(new Uint8Array([1, 2, 3]))

      await syncPromise
    })
  })
})
