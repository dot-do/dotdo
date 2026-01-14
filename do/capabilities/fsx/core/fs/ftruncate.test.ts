/**
 * Tests for FileHandle.truncate() (RED phase - should fail)
 *
 * FileHandle.truncate() should:
 * - Truncate file to smaller size
 * - Truncate file to larger size (extends with zeros)
 * - Truncate file to current size (no-op)
 * - Truncate file to 0
 * - Throw EBADF on closed handle
 * - Throw EBADF on read-only handle
 * - Handle file position correctly after truncate
 *
 * This is the ftruncate equivalent for file handles, as opposed to
 * the path-based truncate() function in truncate.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend } from '../mock-backend'

describe('FileHandle.truncate()', () => {
  let backend: MockBackend

  beforeEach(async () => {
    backend = new MockBackend()

    // Set up test filesystem
    await backend.mkdir('/test')

    // Regular file with content "Hello, World!" (13 bytes)
    const testContent = new TextEncoder().encode('Hello, World!')
    await backend.writeFile('/test/file.txt', testContent)

    // Binary file with specific content
    const binaryContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await backend.writeFile('/test/binary.bin', binaryContent)

    // Empty file
    await backend.writeFile('/test/empty.txt', new Uint8Array(0))

    // Large file (1KB)
    const largeContent = new Uint8Array(1024).fill(0x42)
    await backend.writeFile('/test/large.bin', largeContent)
  })

  // ===========================================================================
  // Truncate to smaller size
  // ===========================================================================

  describe('truncate to smaller size', () => {
    it('should truncate file to smaller size', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await handle.truncate(5)

      const stats = await handle.stat()
      expect(stats.size).toBe(5)

      // Verify content is truncated correctly
      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(5)
      expect(new TextDecoder().decode(buffer.slice(0, bytesRead))).toBe('Hello')

      await handle.close()
    })

    it('should truncate binary file to 1 byte', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      await handle.truncate(1)

      const stats = await handle.stat()
      expect(stats.size).toBe(1)

      // Verify first byte is preserved
      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(1)
      expect(buffer[0]).toBe(1)

      await handle.close()
    })

    it('should truncate large file to 100 bytes', async () => {
      const handle = await backend.open('/test/large.bin', 'r+')

      await handle.truncate(100)

      const stats = await handle.stat()
      expect(stats.size).toBe(100)

      // Verify content is preserved up to truncation point
      const buffer = new Uint8Array(100)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(100)
      for (let i = 0; i < 100; i++) {
        expect(buffer[i]).toBe(0x42)
      }

      await handle.close()
    })

    it('should truncate to half of original size', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      await handle.truncate(5) // Half of 10 bytes

      const stats = await handle.stat()
      expect(stats.size).toBe(5)

      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(5)
      expect(buffer.slice(0, bytesRead)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))

      await handle.close()
    })
  })

  // ===========================================================================
  // Truncate to larger size (zero-fill)
  // ===========================================================================

  describe('truncate to larger size (zero-fill)', () => {
    it('should extend file with zero bytes', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await handle.truncate(20) // Extend from 13 to 20 bytes

      const stats = await handle.stat()
      expect(stats.size).toBe(20)

      // Read entire file and verify
      const buffer = new Uint8Array(20)
      const { bytesRead } = await handle.read(buffer, 0, 20, 0)
      expect(bytesRead).toBe(20)

      // Original content should be preserved
      expect(new TextDecoder().decode(buffer.slice(0, 13))).toBe('Hello, World!')

      // Extended bytes should be zeros
      for (let i = 13; i < 20; i++) {
        expect(buffer[i]).toBe(0)
      }

      await handle.close()
    })

    it('should extend empty file with zero bytes', async () => {
      const handle = await backend.open('/test/empty.txt', 'r+')

      await handle.truncate(10)

      const stats = await handle.stat()
      expect(stats.size).toBe(10)

      // All bytes should be zeros
      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, 10, 0)
      expect(bytesRead).toBe(10)
      expect(buffer).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))

      await handle.close()
    })

    it('should extend binary file to 100 bytes', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      await handle.truncate(100)

      const stats = await handle.stat()
      expect(stats.size).toBe(100)

      const buffer = new Uint8Array(100)
      const { bytesRead } = await handle.read(buffer, 0, 100, 0)
      expect(bytesRead).toBe(100)

      // Original 10 bytes should be preserved
      for (let i = 0; i < 10; i++) {
        expect(buffer[i]).toBe(i + 1)
      }

      // Extended bytes should be zeros
      for (let i = 10; i < 100; i++) {
        expect(buffer[i]).toBe(0)
      }

      await handle.close()
    })

    it('should extend file to 1MB', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      const targetSize = 1024 * 1024 // 1MB
      await handle.truncate(targetSize)

      const stats = await handle.stat()
      expect(stats.size).toBe(targetSize)

      // Verify original content
      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, 10, 0)
      expect(bytesRead).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(buffer[i]).toBe(i + 1)
      }

      // Verify some zero-filled bytes at the end
      const endBuffer = new Uint8Array(10)
      await handle.read(endBuffer, 0, 10, targetSize - 10)
      expect(endBuffer).toEqual(new Uint8Array(10).fill(0))

      await handle.close()
    })
  })

  // ===========================================================================
  // Truncate to 0
  // ===========================================================================

  describe('truncate to 0', () => {
    it('should truncate file to 0 bytes', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(0)

      await handle.close()
    })

    it('should truncate binary file to 0 bytes', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should truncate large file to 0 bytes', async () => {
      const handle = await backend.open('/test/large.bin', 'r+')

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should truncate already empty file to 0 (no-op)', async () => {
      const handle = await backend.open('/test/empty.txt', 'r+')

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should truncate with default length of 0', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Call truncate without argument (should default to 0)
      await handle.truncate()

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })
  })

  // ===========================================================================
  // Truncate at current size (no-op)
  // ===========================================================================

  describe('truncate at current size (no-op)', () => {
    it('should leave file unchanged when truncating to same size', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // "Hello, World!" is 13 bytes
      await handle.truncate(13)

      const stats = await handle.stat()
      expect(stats.size).toBe(13)

      const buffer = new Uint8Array(1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(new TextDecoder().decode(buffer.slice(0, bytesRead))).toBe('Hello, World!')

      await handle.close()
    })

    it('should leave binary file unchanged when truncating to same size', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      await handle.truncate(10)

      const stats = await handle.stat()
      expect(stats.size).toBe(10)

      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      expect(bytesRead).toBe(10)
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

      await handle.close()
    })

    it('should leave empty file unchanged when truncating to 0', async () => {
      const handle = await backend.open('/test/empty.txt', 'r+')

      await handle.truncate(0)

      const stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })
  })

  // ===========================================================================
  // Position handling after truncate
  // ===========================================================================

  describe('position handling after truncate', () => {
    it('should reset position if it is past new EOF', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Read to advance position to end (position = 13)
      const buffer = new Uint8Array(1024)
      await handle.read(buffer, 0, buffer.length)

      // Truncate to 5 bytes (position should be adjusted)
      await handle.truncate(5)

      // Write should write at end, not past it
      const writeData = new TextEncoder().encode('X')
      await handle.write(writeData)

      // Read back to verify
      const result = new Uint8Array(10)
      const { bytesRead } = await handle.read(result, 0, 10, 0)

      // File should be "HelloX" (5 bytes from truncate + 1 byte written)
      expect(bytesRead).toBe(6)
      expect(new TextDecoder().decode(result.slice(0, bytesRead))).toBe('HelloX')

      await handle.close()
    })

    it('should preserve position if it is within new bounds', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Read 3 bytes to advance position to 3
      const buffer = new Uint8Array(3)
      await handle.read(buffer, 0, 3)
      expect(new TextDecoder().decode(buffer)).toBe('Hel')

      // Truncate to 10 bytes (position 3 should be preserved)
      await handle.truncate(10)

      // Continue reading from position 3
      const buffer2 = new Uint8Array(7)
      const { bytesRead } = await handle.read(buffer2, 0, 7)
      expect(bytesRead).toBe(7)
      expect(new TextDecoder().decode(buffer2)).toBe('lo, Wor')

      await handle.close()
    })

    it('should handle position at exact truncation boundary', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      // Read 5 bytes to move position to 5
      const buffer = new Uint8Array(5)
      await handle.read(buffer, 0, 5)

      // Truncate to exactly 5 bytes (position is at EOF)
      await handle.truncate(5)

      // Reading should return 0 bytes (at EOF)
      const buffer2 = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer2, 0, 10)
      expect(bytesRead).toBe(0)

      // Writing should append at position 5
      await handle.write(new Uint8Array([99]))

      const stats = await handle.stat()
      expect(stats.size).toBe(6)

      await handle.close()
    })

    it('should handle extend with position past original EOF', async () => {
      const handle = await backend.open('/test/binary.bin', 'r+')

      // Read entire file to move position to 10 (EOF)
      const buffer = new Uint8Array(20)
      await handle.read(buffer, 0, 20)

      // Extend file to 20 bytes
      await handle.truncate(20)

      // Position should still be at 10, read should return 10 zero bytes
      const buffer2 = new Uint8Array(20)
      const { bytesRead } = await handle.read(buffer2, 0, 20)
      expect(bytesRead).toBe(10) // Read from position 10 to end (position 20)
      expect(buffer2.slice(0, 10)).toEqual(new Uint8Array(10).fill(0))

      await handle.close()
    })
  })

  // ===========================================================================
  // Error: closed handle
  // ===========================================================================

  describe('error: closed handle', () => {
    it('should throw EBADF when truncating on closed handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')
      await handle.close()

      await expect(handle.truncate(5)).rejects.toThrow(/EBADF|closed/)
    })

    it('should throw error with descriptive message for closed handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')
      await handle.close()

      try {
        await handle.truncate(0)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/closed|EBADF/)
      }
    })
  })

  // ===========================================================================
  // Error: read-only handle
  // ===========================================================================

  describe('error: read-only handle', () => {
    it("should throw EBADF when truncating on handle opened with 'r'", async () => {
      const handle = await backend.open('/test/file.txt', 'r')

      await expect(handle.truncate(5)).rejects.toThrow(/EBADF|read-only|not permitted/)

      await handle.close()
    })

    it('should throw error with descriptive message for read-only handle', async () => {
      const handle = await backend.open('/test/file.txt', 'r')

      try {
        await handle.truncate(0)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/read-only|EBADF|not permitted/)
      }

      await handle.close()
    })

    it('should throw EBADF for read-only handle opened with O_RDONLY', async () => {
      const handle = await backend.open('/test/file.txt', '0') // O_RDONLY = 0

      await expect(handle.truncate(5)).rejects.toThrow(/EBADF|read-only|not permitted/)

      await handle.close()
    })
  })

  // ===========================================================================
  // Truncate with different flags
  // ===========================================================================

  describe('truncate with different access modes', () => {
    it("should allow truncate on handle opened with 'w'", async () => {
      const handle = await backend.open('/test/newfile.txt', 'w')

      await handle.write(new TextEncoder().encode('Test content'))
      await handle.truncate(4)

      const stats = await handle.stat()
      expect(stats.size).toBe(4)

      await handle.close()

      // Verify via separate read
      const content = await backend.readFile('/test/newfile.txt')
      expect(new TextDecoder().decode(content)).toBe('Test')
    })

    it("should allow truncate on handle opened with 'w+'", async () => {
      const handle = await backend.open('/test/file.txt', 'w+')

      // File is truncated on open with 'w+', write new content
      await handle.write(new TextEncoder().encode('New content here'))

      await handle.truncate(3)

      const stats = await handle.stat()
      expect(stats.size).toBe(3)

      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, 10, 0)
      expect(new TextDecoder().decode(buffer.slice(0, bytesRead))).toBe('New')

      await handle.close()
    })

    it("should allow truncate on handle opened with 'a'", async () => {
      const handle = await backend.open('/test/file.txt', 'a')

      // Append mode allows truncate
      await handle.truncate(5)

      const stats = await handle.stat()
      expect(stats.size).toBe(5)

      await handle.close()

      // Verify via separate read
      const content = await backend.readFile('/test/file.txt')
      expect(new TextDecoder().decode(content)).toBe('Hello')
    })

    it("should allow truncate on handle opened with 'a+'", async () => {
      const handle = await backend.open('/test/file.txt', 'a+')

      await handle.truncate(7)

      const stats = await handle.stat()
      expect(stats.size).toBe(7)

      const buffer = new Uint8Array(10)
      const { bytesRead } = await handle.read(buffer, 0, 10, 0)
      expect(new TextDecoder().decode(buffer.slice(0, bytesRead))).toBe('Hello, ')

      await handle.close()
    })
  })

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle negative length by throwing EINVAL', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      await expect(handle.truncate(-1)).rejects.toThrow(/EINVAL|negative|invalid/)

      await handle.close()
    })

    it('should handle very large length values', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Large but reasonable size (10MB)
      await handle.truncate(10 * 1024 * 1024)

      const stats = await handle.stat()
      expect(stats.size).toBe(10 * 1024 * 1024)

      await handle.close()
    })

    it('should handle non-integer length by truncating to integer', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // 5.7 should truncate to 5 (Math.floor behavior)
      await handle.truncate(5.7)

      const stats = await handle.stat()
      expect(stats.size).toBe(5)

      await handle.close()
    })

    it('should update mtime after truncate', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')
      const statsBefore = await handle.stat()
      const mtimeBefore = statsBefore.mtimeMs

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await handle.truncate(5)

      const statsAfter = await handle.stat()
      expect(statsAfter.mtimeMs).toBeGreaterThanOrEqual(mtimeBefore)

      await handle.close()
    })

    it('should return undefined on successful truncate', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      const result = await handle.truncate(5)

      expect(result).toBeUndefined()

      await handle.close()
    })

    it('should handle multiple truncates in sequence', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Shrink
      await handle.truncate(10)
      let stats = await handle.stat()
      expect(stats.size).toBe(10)

      // Extend
      await handle.truncate(20)
      stats = await handle.stat()
      expect(stats.size).toBe(20)

      // Shrink again
      await handle.truncate(5)
      stats = await handle.stat()
      expect(stats.size).toBe(5)

      // To zero
      await handle.truncate(0)
      stats = await handle.stat()
      expect(stats.size).toBe(0)

      await handle.close()
    })

    it('should handle truncate immediately after open', async () => {
      const handle = await backend.open('/test/file.txt', 'r+')

      // Truncate without any read/write first
      await handle.truncate(3)

      const stats = await handle.stat()
      expect(stats.size).toBe(3)

      await handle.close()
    })
  })

  // ===========================================================================
  // Consistency with path-based truncate
  // ===========================================================================

  describe('consistency with fs.truncate()', () => {
    it('should produce same result as path-based truncate for shrink', async () => {
      // Create two identical files
      const content = new TextEncoder().encode('Same content here')
      await backend.writeFile('/test/fileA.txt', content)
      await backend.writeFile('/test/fileB.txt', content)

      // Truncate via handle
      const handle = await backend.open('/test/fileA.txt', 'r+')
      await handle.truncate(4)
      await handle.close()

      // Read both files and compare
      const resultA = await backend.readFile('/test/fileA.txt')

      // Should both be "Same"
      expect(new TextDecoder().decode(resultA)).toBe('Same')
    })

    it('should produce same result as path-based truncate for extend', async () => {
      const content = new TextEncoder().encode('Hi')
      await backend.writeFile('/test/fileA.txt', content)

      // Truncate via handle to extend
      const handle = await backend.open('/test/fileA.txt', 'r+')
      await handle.truncate(5)
      await handle.close()

      const resultA = await backend.readFile('/test/fileA.txt')
      expect(resultA.length).toBe(5)
      expect(resultA).toEqual(new Uint8Array([72, 105, 0, 0, 0])) // "Hi" + 3 zeros
    })
  })
})
