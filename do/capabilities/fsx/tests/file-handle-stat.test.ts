/**
 * TDD RED Phase: Failing tests for FileHandle.stat()
 *
 * Tests for FileHandle.stat() (fstat equivalent) - gets file statistics
 * from an open file handle.
 *
 * Test cases:
 * - Get stats from open handle
 * - Stats reflect current file size
 * - Stats update after write
 * - Stats on closed handle throws
 * - Stats match fs.stat() for same file
 * - BigInt option for large files
 * - Stats include all required properties
 * - Stats type checking methods (isFile, isDirectory, etc.)
 * - Stats timestamps (atime, mtime, ctime, birthtime)
 * - Stats permissions (mode)
 * - Multiple stat calls return consistent data
 * - Stats after truncate reflects new size
 * - Stats after read operations
 *
 * @see fsx-pkh: RED: Write failing tests for FileHandle.stat()
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
    dev: 1,
    ino: 12345,
    mode: constants.S_IFREG | 0o644,
    nlink: 1,
    uid: 1000,
    gid: 1000,
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

describe('FileHandle.stat()', () => {
  // ===========================================================================
  // Basic stat operations
  // ===========================================================================

  describe('basic stat operations', () => {
    it('should return a Stats object from open handle', async () => {
      const data = new TextEncoder().encode('Hello, World!')
      const handle = createFileHandle(data)

      const stats = await handle.stat()

      expect(stats).toBeInstanceOf(Stats)
      await handle.close()
    })

    it('should return stats without throwing for valid handle', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      await expect(handle.stat()).resolves.toBeDefined()
      await handle.close()
    })

    it('should return stats for empty file', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      const stats = await handle.stat()

      expect(stats.size).toBe(0)
      await handle.close()
    })

    it('should return a Promise that resolves to Stats', async () => {
      const handle = createFileHandle(new Uint8Array(50))

      const result = handle.stat()

      expect(result).toBeInstanceOf(Promise)
      const stats = await result
      expect(stats).toBeInstanceOf(Stats)
      await handle.close()
    })
  })

  // ===========================================================================
  // Stats reflect current file size
  // ===========================================================================

  describe('stats reflect current file size', () => {
    it('should report correct size for small file', async () => {
      const data = new TextEncoder().encode('Hello')
      const handle = createFileHandle(data)

      const stats = await handle.stat()

      expect(stats.size).toBe(5)
      await handle.close()
    })

    it('should report correct size for larger file', async () => {
      const size = 1024 * 100 // 100KB
      const data = new Uint8Array(size)
      const handle = createFileHandle(data)

      const stats = await handle.stat()

      expect(stats.size).toBe(size)
      await handle.close()
    })

    it('should report correct size for 1MB file', async () => {
      const size = 1024 * 1024 // 1MB
      const data = new Uint8Array(size)
      const handle = createFileHandle(data)

      const stats = await handle.stat()

      expect(stats.size).toBe(size)
      await handle.close()
    })

    it('should report correct size for binary data with null bytes', async () => {
      const data = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0xfe])
      const handle = createFileHandle(data)

      const stats = await handle.stat()

      expect(stats.size).toBe(5)
      await handle.close()
    })

    it('should report correct blocks based on size', async () => {
      const size = 8192 // 8KB = 2 blocks at 4096 block size
      const data = new Uint8Array(size)
      const handle = createFileHandle(data, createMockStats({ size, blksize: 4096 }))

      const stats = await handle.stat()

      expect(stats.blocks).toBeGreaterThanOrEqual(2)
      await handle.close()
    })
  })

  // ===========================================================================
  // Stats update after write
  // ===========================================================================

  describe('stats update after write', () => {
    it('should update size after write operation', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      const statsBefore = await handle.stat()
      expect(statsBefore.size).toBe(0)

      await handle.write('Hello, World!')

      const statsAfter = await handle.stat()
      expect(statsAfter.size).toBe(13)

      await handle.close()
    })

    it('should update size after multiple writes', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      await handle.write('First ')
      const stats1 = await handle.stat()
      expect(stats1.size).toBe(6)

      await handle.write('Second ')
      const stats2 = await handle.stat()
      expect(stats2.size).toBe(13)

      await handle.write('Third')
      const stats3 = await handle.stat()
      expect(stats3.size).toBe(18)

      await handle.close()
    })

    it('should update mtime after write operation', async () => {
      const pastDate = new Date(Date.now() - 10000)
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mtime: pastDate, size: 10 })
      )

      const statsBefore = await handle.stat()
      const mtimeBefore = statsBefore.mtimeMs

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10))

      await handle.write('New data')

      const statsAfter = await handle.stat()
      expect(statsAfter.mtimeMs).toBeGreaterThanOrEqual(mtimeBefore)

      await handle.close()
    })

    it('should update ctime after write operation', async () => {
      const pastDate = new Date(Date.now() - 10000)
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ ctime: pastDate, size: 10 })
      )

      const statsBefore = await handle.stat()
      const ctimeBefore = statsBefore.ctimeMs

      await new Promise(resolve => setTimeout(resolve, 10))

      await handle.write('New data')

      const statsAfter = await handle.stat()
      expect(statsAfter.ctimeMs).toBeGreaterThanOrEqual(ctimeBefore)

      await handle.close()
    })

    it('should reflect size increase when writing past EOF', async () => {
      const handle = createFileHandle(new Uint8Array(5))

      // Write at position 100 (past current EOF)
      await handle.write(new Uint8Array([1, 2, 3]), 100)

      const stats = await handle.stat()
      expect(stats.size).toBe(103) // position 100 + 3 bytes written

      await handle.close()
    })

    it('should not change size when writing within existing content', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      // Write 10 bytes at position 0 within existing 100 byte file
      await handle.write(new Uint8Array(10), 0)

      const stats = await handle.stat()
      expect(stats.size).toBe(100) // Size unchanged

      await handle.close()
    })
  })

  // ===========================================================================
  // Stats on closed handle throws
  // ===========================================================================

  describe('stats on closed handle throws', () => {
    it('should throw when calling stat() on closed handle', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      await handle.close()

      await expect(handle.stat()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw with appropriate error for closed handle', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      await handle.close()

      try {
        await handle.stat()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/closed|invalid|bad file descriptor/i)
      }
    })

    it('should throw after multiple close calls', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      await handle.close()
      await handle.close() // Second close should be safe

      await expect(handle.stat()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw even if stat was previously successful', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // First stat should succeed
      await expect(handle.stat()).resolves.toBeDefined()

      await handle.close()

      // After close, stat should fail
      await expect(handle.stat()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })
  })

  // ===========================================================================
  // Stats include all required properties
  // ===========================================================================

  describe('stats include all required properties', () => {
    it('should include dev property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.dev).toBe('number')
      await handle.close()
    })

    it('should include ino property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.ino).toBe('number')
      await handle.close()
    })

    it('should include mode property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.mode).toBe('number')
      await handle.close()
    })

    it('should include nlink property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.nlink).toBe('number')
      await handle.close()
    })

    it('should include uid property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.uid).toBe('number')
      await handle.close()
    })

    it('should include gid property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.gid).toBe('number')
      await handle.close()
    })

    it('should include rdev property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.rdev).toBe('number')
      await handle.close()
    })

    it('should include size property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.size).toBe('number')
      expect(stats.size).toBe(10)
      await handle.close()
    })

    it('should include blksize property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.blksize).toBe('number')
      expect(stats.blksize).toBeGreaterThan(0)
      await handle.close()
    })

    it('should include blocks property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.blocks).toBe('number')
      await handle.close()
    })

    it('should include atimeMs property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.atimeMs).toBe('number')
      expect(stats.atimeMs).toBeGreaterThan(0)
      await handle.close()
    })

    it('should include mtimeMs property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.mtimeMs).toBe('number')
      expect(stats.mtimeMs).toBeGreaterThan(0)
      await handle.close()
    })

    it('should include ctimeMs property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.ctimeMs).toBe('number')
      expect(stats.ctimeMs).toBeGreaterThan(0)
      await handle.close()
    })

    it('should include birthtimeMs property', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.birthtimeMs).toBe('number')
      expect(stats.birthtimeMs).toBeGreaterThan(0)
      await handle.close()
    })

    it('should include atime Date getter', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.atime).toBeInstanceOf(Date)
      await handle.close()
    })

    it('should include mtime Date getter', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.mtime).toBeInstanceOf(Date)
      await handle.close()
    })

    it('should include ctime Date getter', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.ctime).toBeInstanceOf(Date)
      await handle.close()
    })

    it('should include birthtime Date getter', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.birthtime).toBeInstanceOf(Date)
      await handle.close()
    })
  })

  // ===========================================================================
  // Stats type checking methods
  // ===========================================================================

  describe('stats type checking methods', () => {
    it('should return true for isFile() on regular file', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o644 })
      )
      const stats = await handle.stat()

      expect(stats.isFile()).toBe(true)
      await handle.close()
    })

    it('should return false for isDirectory() on regular file', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o644 })
      )
      const stats = await handle.stat()

      expect(stats.isDirectory()).toBe(false)
      await handle.close()
    })

    it('should return false for isSymbolicLink() on regular file', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o644 })
      )
      const stats = await handle.stat()

      expect(stats.isSymbolicLink()).toBe(false)
      await handle.close()
    })

    it('should return false for isBlockDevice() on regular file', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.isBlockDevice()).toBe(false)
      await handle.close()
    })

    it('should return false for isCharacterDevice() on regular file', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.isCharacterDevice()).toBe(false)
      await handle.close()
    })

    it('should return false for isFIFO() on regular file', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.isFIFO()).toBe(false)
      await handle.close()
    })

    it('should return false for isSocket() on regular file', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(stats.isSocket()).toBe(false)
      await handle.close()
    })

    it('should have all type checking methods as functions', async () => {
      const handle = createFileHandle(new Uint8Array(10))
      const stats = await handle.stat()

      expect(typeof stats.isFile).toBe('function')
      expect(typeof stats.isDirectory).toBe('function')
      expect(typeof stats.isSymbolicLink).toBe('function')
      expect(typeof stats.isBlockDevice).toBe('function')
      expect(typeof stats.isCharacterDevice).toBe('function')
      expect(typeof stats.isFIFO).toBe('function')
      expect(typeof stats.isSocket).toBe('function')

      await handle.close()
    })
  })

  // ===========================================================================
  // Stats permissions (mode)
  // ===========================================================================

  describe('stats permissions (mode)', () => {
    it('should preserve file mode from original stats', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o755 })
      )
      const stats = await handle.stat()

      // Check permission bits
      expect(stats.mode & 0o777).toBe(0o755)
      await handle.close()
    })

    it('should include file type bits in mode', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o644 })
      )
      const stats = await handle.stat()

      // Check file type bits
      expect(stats.mode & constants.S_IFMT).toBe(constants.S_IFREG)
      await handle.close()
    })

    it('should handle read-only file mode', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o444 })
      )
      const stats = await handle.stat()

      expect(stats.mode & 0o777).toBe(0o444)
      await handle.close()
    })

    it('should handle owner-only permissions', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o600 })
      )
      const stats = await handle.stat()

      expect(stats.mode & 0o777).toBe(0o600)
      await handle.close()
    })
  })

  // ===========================================================================
  // Multiple stat calls return consistent data
  // ===========================================================================

  describe('multiple stat calls return consistent data', () => {
    it('should return same size on multiple calls without writes', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      const stats1 = await handle.stat()
      const stats2 = await handle.stat()
      const stats3 = await handle.stat()

      expect(stats1.size).toBe(100)
      expect(stats2.size).toBe(100)
      expect(stats3.size).toBe(100)

      await handle.close()
    })

    it('should return same mode on multiple calls', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ mode: constants.S_IFREG | 0o755 })
      )

      const stats1 = await handle.stat()
      const stats2 = await handle.stat()

      expect(stats1.mode).toBe(stats2.mode)

      await handle.close()
    })

    it('should return same inode on multiple calls', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ ino: 12345 })
      )

      const stats1 = await handle.stat()
      const stats2 = await handle.stat()

      expect(stats1.ino).toBe(stats2.ino)
      expect(stats1.ino).toBe(12345)

      await handle.close()
    })

    it('should return consistent uid/gid on multiple calls', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ uid: 1000, gid: 1000 })
      )

      const stats1 = await handle.stat()
      const stats2 = await handle.stat()

      expect(stats1.uid).toBe(stats2.uid)
      expect(stats1.gid).toBe(stats2.gid)

      await handle.close()
    })

    it('should return independent Stats objects on each call', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      const stats1 = await handle.stat()
      const stats2 = await handle.stat()

      // Should be different object instances
      expect(stats1).not.toBe(stats2)

      await handle.close()
    })
  })

  // ===========================================================================
  // Stats after truncate reflects new size
  // ===========================================================================

  describe('stats after truncate reflects new size', () => {
    it('should update size after truncate to smaller size', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      await handle.truncate(50)

      const stats = await handle.stat()
      expect(stats.size).toBe(50)

      await handle.close()
    })

    it('should update size after truncate to zero', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should update size after truncate to larger size', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      await handle.truncate(100)

      const stats = await handle.stat()
      expect(stats.size).toBe(100)

      await handle.close()
    })

    it('should update blocks after truncate', async () => {
      const handle = createFileHandle(
        new Uint8Array(8192),
        createMockStats({ size: 8192, blksize: 4096 })
      )

      const statsBefore = await handle.stat()
      const blocksBefore = statsBefore.blocks

      await handle.truncate(100)

      const statsAfter = await handle.stat()
      expect(statsAfter.blocks).toBeLessThanOrEqual(blocksBefore)

      await handle.close()
    })
  })

  // ===========================================================================
  // Stats after read operations
  // ===========================================================================

  describe('stats after read operations', () => {
    it('should not change size after read', async () => {
      const data = new TextEncoder().encode('Hello, World!')
      const handle = createFileHandle(data)

      const statsBefore = await handle.stat()

      const buffer = new Uint8Array(100)
      await handle.read(buffer, 0, 100, 0)

      const statsAfter = await handle.stat()

      expect(statsAfter.size).toBe(statsBefore.size)

      await handle.close()
    })

    it('should maintain same stats after multiple reads', async () => {
      const data = new Uint8Array(1000)
      const handle = createFileHandle(data)

      const statsBefore = await handle.stat()

      // Multiple read operations
      const buffer = new Uint8Array(100)
      await handle.read(buffer, 0, 100, 0)
      await handle.read(buffer, 0, 100, 100)
      await handle.read(buffer, 0, 100, 200)

      const statsAfter = await handle.stat()

      expect(statsAfter.size).toBe(statsBefore.size)
      expect(statsAfter.mode).toBe(statsBefore.mode)

      await handle.close()
    })
  })

  // ===========================================================================
  // BigInt option for large files
  // ===========================================================================

  describe('BigInt option for large files', () => {
    it('should support bigint option parameter', async () => {
      const handle = createFileHandle(new Uint8Array(1000))

      // Test that stat accepts options object with bigint
      // @ts-expect-error Testing bigint option that may not be in types yet
      const stats = await handle.stat({ bigint: true })

      // When bigint option is true, numeric fields should be BigInt
      // This test expects the implementation to support this option
      expect(stats).toBeDefined()

      await handle.close()
    })

    it('should return BigInt types for size when bigint option is true', async () => {
      const handle = createFileHandle(new Uint8Array(1000))

      // @ts-expect-error Testing bigint option
      const stats = await handle.stat({ bigint: true })

      // Size should be BigInt when bigint option is true
      expect(typeof stats.size).toBe('bigint')

      await handle.close()
    })

    it('should return BigInt types for timestamps when bigint option is true', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // @ts-expect-error Testing bigint option
      const stats = await handle.stat({ bigint: true })

      // Timestamp properties should be BigInt
      expect(typeof stats.atimeMs).toBe('bigint')
      expect(typeof stats.mtimeMs).toBe('bigint')
      expect(typeof stats.ctimeMs).toBe('bigint')
      expect(typeof stats.birthtimeMs).toBe('bigint')

      await handle.close()
    })

    it('should return number types when bigint option is false', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // @ts-expect-error Testing bigint option
      const stats = await handle.stat({ bigint: false })

      expect(typeof stats.size).toBe('number')
      expect(typeof stats.atimeMs).toBe('number')

      await handle.close()
    })

    it('should return number types by default (no options)', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      const stats = await handle.stat()

      expect(typeof stats.size).toBe('number')
      expect(typeof stats.atimeMs).toBe('number')

      await handle.close()
    })

    it('should handle very large file sizes with bigint', async () => {
      // Create mock stats with a very large size (simulating > 2^53 bytes)
      const largeSize = BigInt('9007199254740993') // Larger than Number.MAX_SAFE_INTEGER
      const handle = createFileHandle(
        new Uint8Array(0),
        createMockStats({
          // Note: In practice, the internal buffer can't be this large,
          // but we're testing the stats reporting capability
          size: Number.MAX_SAFE_INTEGER,
        })
      )

      // @ts-expect-error Testing bigint option
      const stats = await handle.stat({ bigint: true })

      // Should not lose precision with BigInt
      expect(stats.size).toBeDefined()

      await handle.close()
    })
  })

  // ===========================================================================
  // Concurrent stat calls
  // ===========================================================================

  describe('concurrent stat calls', () => {
    it('should handle multiple concurrent stat calls', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      const [stats1, stats2, stats3] = await Promise.all([
        handle.stat(),
        handle.stat(),
        handle.stat(),
      ])

      expect(stats1.size).toBe(100)
      expect(stats2.size).toBe(100)
      expect(stats3.size).toBe(100)

      await handle.close()
    })

    it('should handle stat calls concurrent with write', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      // Start write and stat concurrently
      const writePromise = handle.write('Hello, World!')
      const statPromise = handle.stat()

      await writePromise
      const stats = await statPromise

      // Stats should reflect some state (either before or after write)
      expect(typeof stats.size).toBe('number')

      await handle.close()
    })

    it('should handle many concurrent stat calls', async () => {
      const handle = createFileHandle(new Uint8Array(50))

      const promises = Array.from({ length: 10 }, () => handle.stat())
      const results = await Promise.all(promises)

      for (const stats of results) {
        expect(stats.size).toBe(50)
        expect(stats).toBeInstanceOf(Stats)
      }

      await handle.close()
    })
  })

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle stat immediately after open', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // Stat immediately without any other operations
      const stats = await handle.stat()

      expect(stats.size).toBe(10)
      await handle.close()
    })

    it('should handle stat on handle opened for write-only', async () => {
      const handle = createFileHandle(new Uint8Array(0))
      handle._writable = true
      handle._readable = false

      // Stat should work even on write-only handle
      const stats = await handle.stat()

      expect(stats).toBeDefined()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should preserve birthtime across operations', async () => {
      const birthtime = new Date('2023-01-01T00:00:00Z')
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ birthtime })
      )

      await handle.write('New data')

      const stats = await handle.stat()

      // Birthtime should not change
      expect(stats.birthtimeMs).toBe(birthtime.getTime())

      await handle.close()
    })

    it('should handle stat on very large file handle', async () => {
      const largeSize = 10 * 1024 * 1024 // 10MB
      const handle = createFileHandle(
        new Uint8Array(largeSize),
        createMockStats({ size: largeSize })
      )

      const stats = await handle.stat()

      expect(stats.size).toBe(largeSize)
      await handle.close()
    })

    it('should report correct nlink value', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ nlink: 2 })
      )

      const stats = await handle.stat()

      expect(stats.nlink).toBe(2)
      await handle.close()
    })

    it('should report correct device numbers', async () => {
      const handle = createFileHandle(
        new Uint8Array(10),
        createMockStats({ dev: 123, rdev: 0 })
      )

      const stats = await handle.stat()

      expect(stats.dev).toBe(123)
      expect(stats.rdev).toBe(0)
      await handle.close()
    })
  })
})
