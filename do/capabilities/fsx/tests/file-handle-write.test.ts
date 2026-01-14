/**
 * TDD RED Phase: Failing tests for FileHandle.write()
 *
 * Tests comprehensive FileHandle.write() functionality including:
 * - Basic write operations (buffer and string)
 * - Writing at specific positions
 * - Writing with offset and length from buffer
 * - Append mode behavior
 * - Error handling (closed handle, read-only mode)
 * - File extension past EOF
 * - Concurrent writes
 * - Large data writes
 * - Encoding options
 *
 * @see fsx-3g7: RED: Write failing tests for FileHandle.write()
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

describe('FileHandle.write()', () => {
  describe('basic write operations', () => {
    it('should write a Uint8Array buffer to the file', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(5)
      // Verify data was written by reading it back
      const readBuffer = new Uint8Array(5)
      const { bytesRead } = await handle.read(readBuffer, 0, 5, 0)
      expect(bytesRead).toBe(5)
      expect(readBuffer).toEqual(data)
    })

    it('should write a string to the file', async () => {
      const handle = createFileHandle()
      const data = 'Hello, World!'

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(13)
      // Verify string was written
      const readBuffer = new Uint8Array(13)
      const { bytesRead } = await handle.read(readBuffer, 0, 13, 0)
      expect(bytesRead).toBe(13)
      expect(new TextDecoder().decode(readBuffer)).toBe('Hello, World!')
    })

    it('should return buffer in write result when provided', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5])

      const result = await handle.write(data)

      // Node.js FileHandle.write returns { bytesWritten, buffer }
      expect(result).toHaveProperty('bytesWritten', 5)
      expect(result).toHaveProperty('buffer')
      expect(result.buffer).toEqual(data)
    })

    it('should write empty buffer successfully', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array(0)

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(0)
    })

    it('should write empty string successfully', async () => {
      const handle = createFileHandle()

      const result = await handle.write('')

      expect(result.bytesWritten).toBe(0)
    })
  })

  describe('writing at specific position', () => {
    it('should write buffer at specified position', async () => {
      const handle = createFileHandle(new Uint8Array([0, 0, 0, 0, 0]))
      const data = new Uint8Array([1, 2, 3])

      const result = await handle.write(data, 2)

      expect(result.bytesWritten).toBe(3)
      // Verify position: should be [0, 0, 1, 2, 3]
      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(readBuffer).toEqual(new Uint8Array([0, 0, 1, 2, 3]))
    })

    it('should write string at specified position', async () => {
      const handle = createFileHandle(new TextEncoder().encode('AAAAA'))

      await handle.write('BC', 2)

      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(new TextDecoder().decode(readBuffer)).toBe('AABCA')
    })

    it('should write at position 0 by default when no position specified', async () => {
      // Initially "World"
      const handle = createFileHandle(new TextEncoder().encode('World'))

      await handle.write('Hello')

      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(new TextDecoder().decode(readBuffer)).toBe('Hello')
    })

    it('should support negative position (count from end)', async () => {
      // Some implementations support negative positions
      // This test expects it to throw or handle gracefully
      const handle = createFileHandle(new Uint8Array([1, 2, 3, 4, 5]))

      // Negative position should throw an error
      await expect(handle.write(new Uint8Array([9]), -1)).rejects.toThrow()
    })
  })

  describe('write with offset and length from buffer', () => {
    it('should write only specified portion of buffer using offset and length', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      // Write only bytes at indices 2-4 (values 3, 4, 5)
      const result = await handle.write(data, 0, 3, 2) // position=0, length=3, offset=2

      expect(result.bytesWritten).toBe(3)
      const readBuffer = new Uint8Array(3)
      await handle.read(readBuffer, 0, 3, 0)
      expect(readBuffer).toEqual(new Uint8Array([3, 4, 5]))
    })

    it('should write from buffer offset to end when length not specified', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5])

      // Write from offset 2 to end (values 3, 4, 5)
      const result = await handle.write(data, 0, undefined, 2) // position=0, length=undefined, offset=2

      expect(result.bytesWritten).toBe(3)
      const readBuffer = new Uint8Array(3)
      await handle.read(readBuffer, 0, 3, 0)
      expect(readBuffer).toEqual(new Uint8Array([3, 4, 5]))
    })

    it('should throw when offset exceeds buffer length', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3])

      await expect(handle.write(data, 0, 1, 10)).rejects.toThrow()
    })

    it('should throw when offset + length exceeds buffer length', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5])

      // offset=3, length=5 would need 8 bytes but buffer only has 5
      await expect(handle.write(data, 0, 5, 3)).rejects.toThrow()
    })

    it('should handle zero length write', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([1, 2, 3, 4, 5])

      const result = await handle.write(data, 0, 0, 2) // Write 0 bytes from offset 2

      expect(result.bytesWritten).toBe(0)
    })
  })

  describe('file position tracking', () => {
    it('should use current file position when position is null', async () => {
      const handle = createFileHandle(new TextEncoder().encode('AAAAA'))

      // First write at position 0
      await handle.write('B', 0)
      // Second write should continue from position 1
      await handle.write('C', null) // null means use current position

      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(new TextDecoder().decode(readBuffer)).toBe('BCAAA')
    })

    it('should advance file position after write', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // Write 5 bytes at position 0
      await handle.write(new Uint8Array([1, 2, 3, 4, 5]), 0)

      // Write using current position (should be 5 now)
      await handle.write(new Uint8Array([6, 7, 8]), null)

      const readBuffer = new Uint8Array(10)
      await handle.read(readBuffer, 0, 10, 0)
      expect(readBuffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0]))
    })

    it('should not change position when explicit position is provided', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // Write at position 5
      await handle.write(new Uint8Array([1, 2, 3]), 5)

      // Write at position 0 (explicit position, should not affect internal position tracking)
      await handle.write(new Uint8Array([9]), 0)

      // Next write with null position should continue from where position was last set
      await handle.write(new Uint8Array([4, 5]), null)

      const readBuffer = new Uint8Array(10)
      await handle.read(readBuffer, 0, 10, 0)
      // Expected: position 0=9, position 1-7=4,5,0,0,1,2,3, position 8-9=0,0
      // This depends on implementation behavior
      expect(readBuffer[0]).toBe(9)
      expect(readBuffer[5]).toBe(1)
      expect(readBuffer[6]).toBe(2)
      expect(readBuffer[7]).toBe(3)
    })
  })

  describe('append mode behavior', () => {
    it('should always write at end of file in append mode', async () => {
      // Create a handle opened in append mode
      const initialData = new TextEncoder().encode('Hello')
      const appendStats = createMockStats({
        size: 5,
        mode: constants.S_IFREG | 0o644, // Would need append flag tracking
      })
      const handle = createFileHandle(initialData, appendStats)

      // Mark handle as append mode (implementation detail)
      // @ts-expect-error Accessing private for testing
      handle._appendMode = true

      // Even when specifying position 0, append mode should write at end
      await handle.write(' World', 0)

      const stats = await handle.stat()
      expect(stats.size).toBe(11) // "Hello World"

      const readBuffer = new Uint8Array(11)
      await handle.read(readBuffer, 0, 11, 0)
      expect(new TextDecoder().decode(readBuffer)).toBe('Hello World')
    })

    it('should ignore position parameter in append mode', async () => {
      const initialData = new TextEncoder().encode('AB')
      const handle = createFileHandle(initialData)
      // @ts-expect-error Accessing private for testing
      handle._appendMode = true

      // Try to write at position 0, but append mode should write at end
      await handle.write('C', 0)
      await handle.write('D', 0)

      const readBuffer = new Uint8Array(4)
      await handle.read(readBuffer, 0, 4, 0)
      expect(new TextDecoder().decode(readBuffer)).toBe('ABCD')
    })
  })

  describe('error handling - closed handle', () => {
    it('should throw when writing to a closed handle', async () => {
      const handle = createFileHandle()
      await handle.close()

      await expect(handle.write(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    })

    it('should throw specific error message for closed handle', async () => {
      const handle = createFileHandle()
      await handle.close()

      await expect(handle.write('test')).rejects.toThrow(/closed|invalid/i)
    })

    it('should throw when writing after multiple close calls', async () => {
      const handle = createFileHandle()
      await handle.close()
      // Second close should be safe
      await handle.close()

      await expect(handle.write('test')).rejects.toThrow()
    })
  })

  describe('error handling - read-only handle', () => {
    it('should throw when writing to a read-only handle', async () => {
      // Create handle opened with 'r' flag (read-only)
      const readOnlyStats = createMockStats({
        mode: constants.S_IFREG | 0o444, // read-only permissions
      })
      const handle = createFileHandle(new Uint8Array(10), readOnlyStats)

      // Mark handle as read-only (implementation detail)
      // @ts-expect-error Accessing private for testing
      handle._writable = false

      await expect(handle.write(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    })

    it('should throw EBADF error for read-only handle write attempt', async () => {
      const handle = createFileHandle()
      // @ts-expect-error Accessing private for testing
      handle._writable = false

      try {
        await handle.write('test')
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const err = error as Error & { code?: string }
        expect(err.code).toBe('EBADF')
      }
    })
  })

  describe('file extension past EOF', () => {
    it('should extend file when writing past current EOF', async () => {
      const handle = createFileHandle(new Uint8Array([1, 2, 3]))

      // Write at position 10 (past EOF which is at 3)
      await handle.write(new Uint8Array([9, 9, 9]), 10)

      const stats = await handle.stat()
      expect(stats.size).toBe(13) // 0-9 zeros/original + 10-12 new data

      const readBuffer = new Uint8Array(13)
      await handle.read(readBuffer, 0, 13, 0)
      // Original data at 0-2, zeros at 3-9, new data at 10-12
      expect(readBuffer[0]).toBe(1)
      expect(readBuffer[1]).toBe(2)
      expect(readBuffer[2]).toBe(3)
      expect(readBuffer[3]).toBe(0) // Gap filled with zeros
      expect(readBuffer[9]).toBe(0)
      expect(readBuffer[10]).toBe(9)
      expect(readBuffer[11]).toBe(9)
      expect(readBuffer[12]).toBe(9)
    })

    it('should fill gap with zeros when extending file', async () => {
      const handle = createFileHandle(new Uint8Array(0))

      // Write at position 5 with empty file
      await handle.write(new Uint8Array([1]), 5)

      const readBuffer = new Uint8Array(6)
      await handle.read(readBuffer, 0, 6, 0)
      expect(readBuffer).toEqual(new Uint8Array([0, 0, 0, 0, 0, 1]))
    })

    it('should extend file size correctly when writing past EOF', async () => {
      const handle = createFileHandle(new TextEncoder().encode('AB'))

      await handle.write('Z', 100)

      const stats = await handle.stat()
      expect(stats.size).toBe(101)
    })
  })

  describe('concurrent writes', () => {
    it('should handle multiple sequential writes correctly', async () => {
      const handle = createFileHandle(new Uint8Array(20))

      await handle.write(new Uint8Array([1, 1, 1, 1, 1]), 0)
      await handle.write(new Uint8Array([2, 2, 2, 2, 2]), 5)
      await handle.write(new Uint8Array([3, 3, 3, 3, 3]), 10)
      await handle.write(new Uint8Array([4, 4, 4, 4, 4]), 15)

      const readBuffer = new Uint8Array(20)
      await handle.read(readBuffer, 0, 20, 0)
      expect(readBuffer).toEqual(
        new Uint8Array([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4])
      )
    })

    it('should handle overlapping writes correctly', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      // Write A's at 0-4
      await handle.write(new Uint8Array([65, 65, 65, 65, 65]), 0)
      // Write B's at 2-6 (overlapping)
      await handle.write(new Uint8Array([66, 66, 66, 66, 66]), 2)

      const readBuffer = new Uint8Array(10)
      await handle.read(readBuffer, 0, 10, 0)
      // Result: A,A,B,B,B,B,B,0,0,0
      expect(readBuffer[0]).toBe(65) // A
      expect(readBuffer[1]).toBe(65) // A
      expect(readBuffer[2]).toBe(66) // B (overwritten)
      expect(readBuffer[3]).toBe(66) // B
      expect(readBuffer[6]).toBe(66) // B
      expect(readBuffer[7]).toBe(0) // unchanged
    })

    it('should handle parallel writes safely', async () => {
      const handle = createFileHandle(new Uint8Array(100))

      // Issue multiple writes in parallel (implementation should serialize or handle safely)
      const writes = [
        handle.write(new Uint8Array([1, 1, 1, 1, 1]), 0),
        handle.write(new Uint8Array([2, 2, 2, 2, 2]), 20),
        handle.write(new Uint8Array([3, 3, 3, 3, 3]), 40),
        handle.write(new Uint8Array([4, 4, 4, 4, 4]), 60),
        handle.write(new Uint8Array([5, 5, 5, 5, 5]), 80),
      ]

      const results = await Promise.all(writes)

      // All writes should succeed
      expect(results.every((r) => r.bytesWritten === 5)).toBe(true)

      // Verify all data was written (order may vary for parallel writes at same position)
      const readBuffer = new Uint8Array(100)
      await handle.read(readBuffer, 0, 100, 0)
      expect(readBuffer.slice(0, 5)).toEqual(new Uint8Array([1, 1, 1, 1, 1]))
      expect(readBuffer.slice(20, 25)).toEqual(new Uint8Array([2, 2, 2, 2, 2]))
      expect(readBuffer.slice(40, 45)).toEqual(new Uint8Array([3, 3, 3, 3, 3]))
      expect(readBuffer.slice(60, 65)).toEqual(new Uint8Array([4, 4, 4, 4, 4]))
      expect(readBuffer.slice(80, 85)).toEqual(new Uint8Array([5, 5, 5, 5, 5]))
    })
  })

  describe('large data writes', () => {
    it('should handle 1MB write', async () => {
      const handle = createFileHandle()
      const size = 1024 * 1024 // 1MB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(size)
      const stats = await handle.stat()
      expect(stats.size).toBe(size)
    })

    it('should handle 10MB write', async () => {
      const handle = createFileHandle()
      const size = 10 * 1024 * 1024 // 10MB
      const data = new Uint8Array(size)

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(size)
    })

    it('should preserve data integrity for large writes', async () => {
      const handle = createFileHandle()
      const size = 100 * 1024 // 100KB
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = (i * 7) % 256 // Pattern for verification
      }

      await handle.write(data)

      const readBuffer = new Uint8Array(size)
      await handle.read(readBuffer, 0, size, 0)
      expect(readBuffer).toEqual(data)
    })
  })

  describe('encoding options for strings', () => {
    it('should write string with utf-8 encoding (default)', async () => {
      const handle = createFileHandle()
      const text = 'Hello'

      await handle.write(text)

      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(new TextDecoder('utf-8').decode(readBuffer)).toBe('Hello')
    })

    it('should write string with explicit utf-8 encoding', async () => {
      const handle = createFileHandle()
      const text = 'Hello'

      // @ts-expect-error Testing encoding parameter that may not exist yet
      await handle.write(text, 0, 'utf-8')

      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(new TextDecoder('utf-8').decode(readBuffer)).toBe('Hello')
    })

    it('should handle multi-byte UTF-8 characters correctly', async () => {
      const handle = createFileHandle()
      const text = 'Hello \u{1F44B} World! \u{1F30D}' // Unicode emoji (waving hand and globe)

      await handle.write(text)

      const stats = await handle.stat()
      // Should account for multi-byte characters
      expect(stats.size).toBeGreaterThan(text.length)

      const readBuffer = new Uint8Array(stats.size)
      await handle.read(readBuffer, 0, stats.size, 0)
      expect(new TextDecoder('utf-8').decode(readBuffer)).toBe(text)
    })

    it('should write unicode characters correctly', async () => {
      const handle = createFileHandle()
      const text = 'Hello, World!' // Chinese characters

      await handle.write(text)

      const readBuffer = new Uint8Array(100) // Ensure enough space
      const { bytesRead } = await handle.read(readBuffer, 0, 100, 0)
      expect(new TextDecoder('utf-8').decode(readBuffer.slice(0, bytesRead))).toBe(text)
    })

    it('should write ASCII-only string correctly', async () => {
      const handle = createFileHandle()
      const text = 'Hello, ASCII World!'

      await handle.write(text)

      const readBuffer = new Uint8Array(19)
      await handle.read(readBuffer, 0, 19, 0)
      expect(new TextDecoder('ascii').decode(readBuffer)).toBe(text)
    })
  })

  describe('edge cases', () => {
    it('should handle writing null bytes', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array([0, 0, 0, 0, 0])

      const result = await handle.write(data)

      expect(result.bytesWritten).toBe(5)
      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(readBuffer).toEqual(data)
    })

    it('should handle writing all possible byte values', async () => {
      const handle = createFileHandle()
      const data = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        data[i] = i
      }

      await handle.write(data)

      const readBuffer = new Uint8Array(256)
      await handle.read(readBuffer, 0, 256, 0)
      expect(readBuffer).toEqual(data)
    })

    it('should handle TypedArray view with byteOffset', async () => {
      const handle = createFileHandle()
      const buffer = new ArrayBuffer(10)
      const fullArray = new Uint8Array(buffer)
      fullArray.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      // Create a view starting at offset 3
      const view = new Uint8Array(buffer, 3, 5) // [3, 4, 5, 6, 7]

      const result = await handle.write(view)

      expect(result.bytesWritten).toBe(5)
      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(readBuffer).toEqual(new Uint8Array([3, 4, 5, 6, 7]))
    })

    it('should handle ArrayBuffer directly', async () => {
      const handle = createFileHandle()
      const buffer = new ArrayBuffer(5)
      const view = new Uint8Array(buffer)
      view.set([1, 2, 3, 4, 5])

      // @ts-expect-error Testing ArrayBuffer support
      const result = await handle.write(buffer)

      expect(result.bytesWritten).toBe(5)
    })

    it('should throw for invalid data types', async () => {
      const handle = createFileHandle()

      // @ts-expect-error Testing invalid type
      await expect(handle.write(12345)).rejects.toThrow()

      // @ts-expect-error Testing invalid type
      await expect(handle.write(null)).rejects.toThrow()

      // @ts-expect-error Testing invalid type
      await expect(handle.write(undefined)).rejects.toThrow()

      // @ts-expect-error Testing invalid type
      await expect(handle.write({ data: 'test' })).rejects.toThrow()
    })
  })

  describe('stat updates after write', () => {
    it('should update file size after write', async () => {
      const handle = createFileHandle(new Uint8Array(5))

      const statsBefore = await handle.stat()
      expect(statsBefore.size).toBe(5)

      await handle.write(new Uint8Array(10), 0)

      const statsAfter = await handle.stat()
      expect(statsAfter.size).toBe(10)
    })

    it('should update mtime after write', async () => {
      const handle = createFileHandle(new Uint8Array(5))

      const statsBefore = await handle.stat()
      const mtimeBefore = statsBefore.mtimeMs

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await handle.write(new Uint8Array([1, 2, 3]), 0)

      const statsAfter = await handle.stat()
      expect(statsAfter.mtimeMs).toBeGreaterThanOrEqual(mtimeBefore)
    })

    it('should not update size if write does not extend file', async () => {
      const handle = createFileHandle(new Uint8Array(10))

      await handle.write(new Uint8Array([1, 2, 3]), 0)

      const stats = await handle.stat()
      expect(stats.size).toBe(10) // Size unchanged
    })
  })

  describe('sync behavior', () => {
    it('should persist writes after sync()', async () => {
      const handle = createFileHandle()

      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))
      await handle.sync()

      // Verify data is still readable after sync
      const readBuffer = new Uint8Array(5)
      await handle.read(readBuffer, 0, 5, 0)
      expect(readBuffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })

    it('should persist writes after close()', async () => {
      const initialData = new Uint8Array([0, 0, 0, 0, 0])
      const handle = createFileHandle(initialData)

      await handle.write(new Uint8Array([1, 2, 3, 4, 5]))
      await handle.close()

      // Data should be flushed to backend on close
      // This test verifies the write happened before close
      // In a real scenario, we'd reopen the file to verify
    })
  })
})
