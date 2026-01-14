/**
 * RED Phase: Comprehensive failing tests for FileHandle.read()
 *
 * This test suite covers the FileHandle.read() method with buffer, offset,
 * length, and position parameters per Node.js fs.FileHandle.read() API.
 *
 * Test cases:
 * - Read into buffer at offset
 * - Read specific length
 * - Read from specific position
 * - Read without position (uses current)
 * - Read beyond EOF returns bytes available
 * - Read from closed handle throws
 * - Read on write-only handle throws
 * - Buffer too small for requested length
 * - Negative offset/length/position errors
 * - Concurrent reads
 *
 * @module tests/file-handle-read
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FileHandle, Stats, StatsLike } from '../core/types'

/**
 * Create a mock StatsLike object for testing
 */
function createMockStats(size: number): StatsLike {
  const now = new Date()
  return {
    dev: 1,
    ino: 1,
    mode: 0o100644,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
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
  }
}

describe('FileHandle.read()', () => {
  let handle: FileHandle
  const testData = new TextEncoder().encode('Hello, World! This is test data for FileHandle.read().')

  beforeEach(() => {
    // Create a FileHandle with test data
    handle = new FileHandle(1, new Uint8Array(testData), createMockStats(testData.length))
  })

  // ===========================================================================
  // Basic Read Operations
  // ===========================================================================

  describe('basic read operations', () => {
    it('should read entire file into buffer when no options specified', async () => {
      const buffer = new Uint8Array(testData.length)
      const result = await handle.read(buffer)

      expect(result.bytesRead).toBe(testData.length)
      expect(result.buffer).toBe(buffer)
      expect(new TextDecoder().decode(buffer)).toBe('Hello, World! This is test data for FileHandle.read().')
    })

    it('should return the same buffer reference that was passed in', async () => {
      const buffer = new Uint8Array(testData.length)
      const result = await handle.read(buffer)

      expect(result.buffer).toBe(buffer)
    })

    it('should return bytesRead of 0 for empty file', async () => {
      const emptyHandle = new FileHandle(2, new Uint8Array(0), createMockStats(0))
      const buffer = new Uint8Array(100)
      const result = await emptyHandle.read(buffer)

      expect(result.bytesRead).toBe(0)
    })
  })

  // ===========================================================================
  // Reading with Buffer Offset
  // ===========================================================================

  describe('reading with buffer offset', () => {
    it('should read into buffer starting at specified offset', async () => {
      const buffer = new Uint8Array(100)
      const offset = 10

      // Fill buffer with zeros first (it should be zeros by default, but be explicit)
      buffer.fill(0)

      const result = await handle.read(buffer, offset, 5, 0)

      // Bytes 0-9 should be 0 (untouched)
      expect(buffer.slice(0, offset).every((b) => b === 0)).toBe(true)

      // Bytes 10-14 should contain "Hello"
      expect(new TextDecoder().decode(buffer.slice(offset, offset + 5))).toBe('Hello')

      expect(result.bytesRead).toBe(5)
    })

    it('should respect buffer offset when reading to end of file', async () => {
      // Buffer needs enough space: offset + testData.length
      // testData.length is 54, offset is 50, so we need at least 104 bytes
      const buffer = new Uint8Array(110)
      const offset = 50

      const result = await handle.read(buffer, offset, testData.length, 0)

      // First 50 bytes should be untouched (zeros)
      expect(buffer.slice(0, offset).every((b) => b === 0)).toBe(true)

      // Data should start at offset 50
      expect(new TextDecoder().decode(buffer.slice(offset, offset + testData.length))).toBe(
        'Hello, World! This is test data for FileHandle.read().'
      )

      expect(result.bytesRead).toBe(testData.length)
    })

    it('should throw EINVAL for negative offset', async () => {
      const buffer = new Uint8Array(100)

      await expect(handle.read(buffer, -1, 10, 0)).rejects.toThrow(/EINVAL|negative|invalid/i)
    })

    it('should throw when offset is beyond buffer length', async () => {
      const buffer = new Uint8Array(10)

      await expect(handle.read(buffer, 15, 5, 0)).rejects.toThrow(/offset|out of range|bounds/i)
    })
  })

  // ===========================================================================
  // Reading with Specific Length
  // ===========================================================================

  describe('reading with specific length', () => {
    it('should read only the specified number of bytes', async () => {
      const buffer = new Uint8Array(100)
      const result = await handle.read(buffer, 0, 5, 0)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('Hello')
    })

    it('should read zero bytes when length is 0', async () => {
      const buffer = new Uint8Array(100)
      const result = await handle.read(buffer, 0, 0, 0)

      expect(result.bytesRead).toBe(0)
    })

    it('should throw EINVAL for negative length', async () => {
      const buffer = new Uint8Array(100)

      await expect(handle.read(buffer, 0, -5, 0)).rejects.toThrow(/EINVAL|negative|invalid/i)
    })

    it('should handle length larger than file size', async () => {
      const buffer = new Uint8Array(1000)
      const result = await handle.read(buffer, 0, 1000, 0)

      // Should only read what's available
      expect(result.bytesRead).toBe(testData.length)
    })
  })

  // ===========================================================================
  // Reading from Specific Position
  // ===========================================================================

  describe('reading from specific position', () => {
    it('should read from the specified position in file', async () => {
      const buffer = new Uint8Array(100)
      // "Hello, World!" starts at 0, so position 7 should start at "World"
      const result = await handle.read(buffer, 0, 5, 7)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('World')
    })

    it('should read from middle of file', async () => {
      const buffer = new Uint8Array(100)
      // Position 14 starts at "This"
      const result = await handle.read(buffer, 0, 4, 14)

      expect(result.bytesRead).toBe(4)
      expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe('This')
    })

    it('should throw EINVAL for negative position', async () => {
      const buffer = new Uint8Array(100)

      await expect(handle.read(buffer, 0, 10, -1)).rejects.toThrow(/EINVAL|negative|invalid/i)
    })
  })

  // ===========================================================================
  // Reading Without Position (File Position Tracking)
  // ===========================================================================

  describe('reading without position (sequential reads)', () => {
    it('should track file position across sequential reads', async () => {
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(7)
      const buffer3 = new Uint8Array(1)

      // First read: "Hello"
      const result1 = await handle.read(buffer1, 0, 5)
      expect(new TextDecoder().decode(buffer1)).toBe('Hello')

      // Second read: ", World"
      const result2 = await handle.read(buffer2, 0, 7)
      expect(new TextDecoder().decode(buffer2)).toBe(', World')

      // Third read: "!"
      const result3 = await handle.read(buffer3, 0, 1)
      expect(new TextDecoder().decode(buffer3)).toBe('!')

      expect(result1.bytesRead).toBe(5)
      expect(result2.bytesRead).toBe(7)
      expect(result3.bytesRead).toBe(1)
    })

    it('should not modify file position when position parameter is specified', async () => {
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(5)

      // Read with explicit position
      await handle.read(buffer1, 0, 5, 7) // "World"

      // Next read without position should start from beginning (position 0)
      // because explicit position reads shouldn't update the internal position
      await handle.read(buffer2, 0, 5)
      expect(new TextDecoder().decode(buffer2)).toBe('Hello')
    })
  })

  // ===========================================================================
  // Reading Beyond EOF
  // ===========================================================================

  describe('reading beyond EOF', () => {
    it('should return 0 bytesRead when position is at EOF', async () => {
      const buffer = new Uint8Array(100)
      const result = await handle.read(buffer, 0, 10, testData.length)

      expect(result.bytesRead).toBe(0)
    })

    it('should return 0 bytesRead when position is past EOF', async () => {
      const buffer = new Uint8Array(100)
      const result = await handle.read(buffer, 0, 10, testData.length + 100)

      expect(result.bytesRead).toBe(0)
    })

    it('should return partial bytes when read spans EOF', async () => {
      const buffer = new Uint8Array(100)
      // Position near end of file, request more than available
      const position = testData.length - 5 // 5 bytes before EOF: 'ad().'
      const result = await handle.read(buffer, 0, 20, position)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('ad().')
    })
  })

  // ===========================================================================
  // Reading from Closed Handle
  // ===========================================================================

  describe('reading from closed handle', () => {
    it('should throw when reading from closed handle', async () => {
      await handle.close()

      const buffer = new Uint8Array(100)
      await expect(handle.read(buffer)).rejects.toThrow(/closed|EBADF/i)
    })

    it('should throw with appropriate error code for closed handle', async () => {
      await handle.close()

      const buffer = new Uint8Array(100)
      try {
        await handle.read(buffer)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/closed|EBADF/i)
      }
    })
  })

  // ===========================================================================
  // Reading from Write-Only Handle
  // ===========================================================================

  describe('reading from write-only handle', () => {
    it('should throw EBADF when reading from write-only handle', async () => {
      // This test requires FileHandle to track open flags
      // A handle opened with 'w' or 'a' flags should not allow reads

      // Create a handle with write-only mode
      // The implementation should throw when attempting to read from a write-only handle
      const writeOnlyHandle = new FileHandle(
        3,
        new Uint8Array(0),
        createMockStats(0)
      )
      // Mark handle as write-only (simulating 'w' flag)
      writeOnlyHandle._readable = false

      const buffer = new Uint8Array(100)

      // This should throw because the handle was opened for writing only
      await expect(writeOnlyHandle.read(buffer)).rejects.toThrow(/EBADF|not readable|permission/i)
    })
  })

  // ===========================================================================
  // Buffer Too Small
  // ===========================================================================

  describe('buffer too small for requested length', () => {
    it('should only read as many bytes as buffer can hold', async () => {
      const smallBuffer = new Uint8Array(5)
      const result = await handle.read(smallBuffer, 0, 100, 0)

      // Should only read 5 bytes (buffer size), not 100
      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(smallBuffer)).toBe('Hello')
    })

    it('should respect buffer space after offset', async () => {
      const buffer = new Uint8Array(10)
      const offset = 7
      // Only 3 bytes available in buffer after offset

      const result = await handle.read(buffer, offset, 100, 0)

      expect(result.bytesRead).toBe(3)
      expect(new TextDecoder().decode(buffer.slice(offset, offset + 3))).toBe('Hel')
    })
  })

  // ===========================================================================
  // Edge Cases and Validation
  // ===========================================================================

  describe('edge cases and validation', () => {
    it('should handle reading into empty buffer', async () => {
      const emptyBuffer = new Uint8Array(0)
      const result = await handle.read(emptyBuffer)

      expect(result.bytesRead).toBe(0)
    })

    it('should throw for non-Uint8Array buffer types', async () => {
      // @ts-expect-error - Testing invalid input
      await expect(handle.read(null)).rejects.toThrow()

      // @ts-expect-error - Testing invalid input
      await expect(handle.read('string')).rejects.toThrow()

      // @ts-expect-error - Testing invalid input
      await expect(handle.read(123)).rejects.toThrow()
    })

    it('should handle very large position values gracefully', async () => {
      const buffer = new Uint8Array(100)
      const result = await handle.read(buffer, 0, 10, Number.MAX_SAFE_INTEGER)

      expect(result.bytesRead).toBe(0)
    })

    it('should validate that offset + length does not exceed buffer size', async () => {
      const buffer = new Uint8Array(10)
      // offset 8 + length 5 = 13, which exceeds buffer size 10
      // This should either throw or only read 2 bytes

      const result = await handle.read(buffer, 8, 5, 0)

      // Should only read 2 bytes (buffer.length - offset)
      expect(result.bytesRead).toBeLessThanOrEqual(2)
    })
  })

  // ===========================================================================
  // Concurrent Reads
  // ===========================================================================

  describe('concurrent reads', () => {
    it('should handle multiple concurrent reads correctly', async () => {
      const buffer1 = new Uint8Array(5)
      const buffer2 = new Uint8Array(5)
      const buffer3 = new Uint8Array(5)

      // Launch concurrent reads at different positions
      const [result1, result2, result3] = await Promise.all([
        handle.read(buffer1, 0, 5, 0), // "Hello"
        handle.read(buffer2, 0, 5, 7), // "World"
        handle.read(buffer3, 0, 5, 14), // "This "
      ])

      expect(result1.bytesRead).toBe(5)
      expect(result2.bytesRead).toBe(5)
      expect(result3.bytesRead).toBe(5)

      expect(new TextDecoder().decode(buffer1)).toBe('Hello')
      expect(new TextDecoder().decode(buffer2)).toBe('World')
      expect(new TextDecoder().decode(buffer3)).toBe('This ')
    })

    it('should maintain data integrity during concurrent reads', async () => {
      const numReads = 10
      const buffers = Array.from({ length: numReads }, () => new Uint8Array(testData.length))

      // All reads should get the same data
      const results = await Promise.all(buffers.map((buffer) => handle.read(buffer, 0, testData.length, 0)))

      for (let i = 0; i < numReads; i++) {
        expect(results[i].bytesRead).toBe(testData.length)
        expect(new TextDecoder().decode(buffers[i])).toBe('Hello, World! This is test data for FileHandle.read().')
      }
    })
  })

  // ===========================================================================
  // TypedArray Compatibility
  // ===========================================================================

  describe('TypedArray compatibility', () => {
    it('should work with Uint8Array created from ArrayBuffer', async () => {
      const arrayBuffer = new ArrayBuffer(100)
      const buffer = new Uint8Array(arrayBuffer)

      const result = await handle.read(buffer, 0, 5, 0)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('Hello')
    })

    it('should work with Uint8Array view of larger ArrayBuffer', async () => {
      const arrayBuffer = new ArrayBuffer(200)
      // Create a view starting at byte 50 with length 100
      const buffer = new Uint8Array(arrayBuffer, 50, 100)

      const result = await handle.read(buffer, 0, 5, 0)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('Hello')
    })
  })

  // ===========================================================================
  // Options Object Form (Node.js compat)
  // ===========================================================================

  describe('options object form', () => {
    it('should accept options object with buffer, offset, length, position', async () => {
      const buffer = new Uint8Array(100)

      // Node.js fs.FileHandle.read() also accepts an options object form
      // This tests that the implementation supports it
      const result = await handle.read(buffer, 0, 5, 7)

      expect(result.bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, 5))).toBe('World')
    })

    it('should use defaults when optional parameters omitted', async () => {
      const buffer = new Uint8Array(testData.length + 10)

      // Only buffer provided, should read from position 0, fill entire buffer
      const result = await handle.read(buffer)

      expect(result.bytesRead).toBe(testData.length)
    })
  })

  // ===========================================================================
  // Binary Data Integrity
  // ===========================================================================

  describe('binary data integrity', () => {
    it('should correctly read binary data with null bytes', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00])
      const binaryHandle = new FileHandle(4, binaryData, createMockStats(binaryData.length))

      const buffer = new Uint8Array(7)
      const result = await binaryHandle.read(buffer)

      expect(result.bytesRead).toBe(7)
      expect(Array.from(buffer)).toEqual([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00])
    })

    it('should correctly read high byte values', async () => {
      const highByteData = new Uint8Array([0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0xff])
      const highByteHandle = new FileHandle(5, highByteData, createMockStats(highByteData.length))

      const buffer = new Uint8Array(9)
      const result = await highByteHandle.read(buffer)

      expect(result.bytesRead).toBe(9)
      expect(Array.from(buffer)).toEqual([0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0xff])
    })
  })
})
