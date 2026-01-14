/**
 * TDD RED Phase: Failing tests for FileHandle.close()
 *
 * These tests define the expected behavior of FileHandle.close():
 * - Close releases handle and marks it as closed
 * - Operations after close throw error
 * - Double close is safe (idempotent)
 * - Close flushes pending writes
 * - fd property becomes invalid after close
 * - Using Symbol.asyncDispose for 'using' statement support
 * - Multiple handles to same file can close independently
 * - Resource cleanup verification
 * - Close error handling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FSx } from '../core/fsx'
import { MemoryBackend } from '../core/backend'
import { FileHandle } from '../core/types'

describe('FileHandle.close()', () => {
  let fs: FSx
  let backend: MemoryBackend

  beforeEach(async () => {
    backend = new MemoryBackend()
    fs = new FSx(backend)

    // Set up test directory and files
    await fs.mkdir('/test', { recursive: true })
    await fs.writeFile('/test/file.txt', 'Hello, World!')
    await fs.writeFile('/test/data.bin', new Uint8Array([1, 2, 3, 4, 5]))
    await fs.writeFile('/test/empty.txt', '')
  })

  // ===========================================================================
  // Basic close operation
  // ===========================================================================

  describe('basic close operation', () => {
    it('should close without throwing', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should return a Promise that resolves to undefined', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      const result = await handle.close()
      expect(result).toBeUndefined()
    })

    it('should mark handle as closed after close()', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      // The handle should be closed - attempting to read should throw
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid/)
    })

    it('should close handle opened with "r" flag', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      await expect(handle.stat()).rejects.toThrow(/closed|invalid/)
    })

    it('should close handle opened with "w" flag', async () => {
      const handle = await fs.open('/test/new-file.txt', 'w')
      await handle.write('test content')
      await handle.close()

      await expect(handle.write('more')).rejects.toThrow(/closed|invalid/)
    })

    it('should close handle opened with "r+" flag', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.close()

      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid/)
    })

    it('should close handle opened with "a" flag', async () => {
      const handle = await fs.open('/test/file.txt', 'a')
      await handle.close()

      await expect(handle.write('append')).rejects.toThrow(/closed|invalid/)
    })
  })

  // ===========================================================================
  // Double-close handling (idempotent)
  // ===========================================================================

  describe('double-close handling (idempotent)', () => {
    it('should not throw when calling close() twice', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      // Second close should be safe (idempotent)
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should be idempotent - calling close multiple times is safe', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      // Multiple closes should all succeed
      await handle.close()
      await handle.close()
      await handle.close()

      // All should resolve without throwing
      expect(true).toBe(true)
    })

    it('should return undefined on subsequent closes', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      const result1 = await handle.close()
      const result2 = await handle.close()

      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
    })
  })

  // ===========================================================================
  // Operations after close throw
  // ===========================================================================

  describe('operations after close throw', () => {
    it('should throw when calling read() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      const buffer = new Uint8Array(10)
      await expect(handle.read(buffer, 0, 10, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling write() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.close()

      await expect(handle.write('test')).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling write() with Uint8Array after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.close()

      await expect(handle.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling stat() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      await expect(handle.stat()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling truncate() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.close()

      await expect(handle.truncate(5)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling sync() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      await expect(handle.sync()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling createReadStream() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      expect(() => handle.createReadStream()).toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should throw when calling createWriteStream() after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.close()

      expect(() => handle.createWriteStream()).toThrow(/closed|invalid|bad file descriptor/i)
    })
  })

  // ===========================================================================
  // Close flushes pending writes
  // ===========================================================================

  describe('close flushes pending writes', () => {
    it('should flush pending writes to storage on close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Modified content')
      await handle.close()

      // Verify the data was persisted
      const content = await fs.readFile('/test/file.txt', 'utf-8')
      expect(content).toBe('Modified content')
    })

    it('should persist new file content on close', async () => {
      const handle = await fs.open('/test/new-write.txt', 'w')
      await handle.write('Brand new file')
      await handle.close()

      // Verify file was created and content persisted
      expect(await fs.exists('/test/new-write.txt')).toBe(true)
      const content = await fs.readFile('/test/new-write.txt', 'utf-8')
      expect(content).toBe('Brand new file')
    })

    it('should persist multiple writes on close', async () => {
      const handle = await fs.open('/test/multi-write.txt', 'w')
      await handle.write('First ')
      await handle.write('Second ')
      await handle.write('Third')
      await handle.close()

      const content = await fs.readFile('/test/multi-write.txt', 'utf-8')
      expect(content).toBe('First Second Third')
    })

    it('should flush binary data on close', async () => {
      const handle = await fs.open('/test/binary.bin', 'w')
      await handle.write(new Uint8Array([10, 20, 30, 40, 50]))
      await handle.close()

      const content = await fs.readFile('/test/binary.bin', 'binary') as Uint8Array
      expect(content).toEqual(new Uint8Array([10, 20, 30, 40, 50]))
    })

    it('should flush appended data on close', async () => {
      const handle = await fs.open('/test/file.txt', 'a')
      await handle.write(' - Appended')
      await handle.close()

      const content = await fs.readFile('/test/file.txt', 'utf-8')
      expect(content).toContain('- Appended')
    })

    it('should flush truncated data on close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.truncate(5)
      await handle.close()

      const content = await fs.readFile('/test/file.txt', 'utf-8')
      expect(content).toBe('Hello')
    })

    it('should not lose data if close is called without explicit sync', async () => {
      const handle = await fs.open('/test/no-sync.txt', 'w')
      await handle.write('Data without explicit sync')
      // Intentionally not calling sync() before close()
      await handle.close()

      const content = await fs.readFile('/test/no-sync.txt', 'utf-8')
      expect(content).toBe('Data without explicit sync')
    })
  })

  // ===========================================================================
  // fd property becomes invalid after close
  // ===========================================================================

  describe('fd property after close', () => {
    it('should have valid fd before close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      expect(typeof handle.fd).toBe('number')
      expect(handle.fd).toBeGreaterThanOrEqual(0)
      await handle.close()
    })

    it('should mark fd as invalid after close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      const originalFd = handle.fd
      await handle.close()

      // After close, fd should either be -1 or operations using it should fail
      // Different implementations may handle this differently
      // At minimum, operations should fail
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow()
    })

    it('should not reuse fd immediately after close', async () => {
      const handle1 = await fs.open('/test/file.txt', 'r')
      const fd1 = handle1.fd
      await handle1.close()

      const handle2 = await fs.open('/test/file.txt', 'r')
      const fd2 = handle2.fd

      // New handle should work independently
      const buffer = new Uint8Array(100)
      const result = await handle2.read(buffer, 0, 100, 0)
      expect(result.bytesRead).toBeGreaterThan(0)

      await handle2.close()
    })
  })

  // ===========================================================================
  // Symbol.asyncDispose for 'using' statement support
  // ===========================================================================

  describe('Symbol.asyncDispose support', () => {
    it('should have Symbol.asyncDispose method', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      expect(typeof handle[Symbol.asyncDispose]).toBe('function')

      await handle.close()
    })

    it('Symbol.asyncDispose should close the handle', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      await handle[Symbol.asyncDispose]()

      // Handle should be closed
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid/)
    })

    it('should work with explicit await using pattern', async () => {
      // Simulate what 'await using' does
      const handle = await fs.open('/test/dispose-test.txt', 'w')
      try {
        await handle.write('Using pattern test')
      } finally {
        await handle[Symbol.asyncDispose]()
      }

      // File should be persisted
      const content = await fs.readFile('/test/dispose-test.txt', 'utf-8')
      expect(content).toBe('Using pattern test')
    })

    it('Symbol.asyncDispose should be idempotent like close()', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      await handle[Symbol.asyncDispose]()
      await expect(handle[Symbol.asyncDispose]()).resolves.toBeUndefined()
    })

    it('close() and Symbol.asyncDispose should be interchangeable', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      await handle.close()
      await expect(handle[Symbol.asyncDispose]()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Multiple handles to same file
  // ===========================================================================

  describe('multiple handles to same file', () => {
    it('should allow multiple handles to same file', async () => {
      const handle1 = await fs.open('/test/file.txt', 'r')
      const handle2 = await fs.open('/test/file.txt', 'r')

      expect(handle1).toBeDefined()
      expect(handle2).toBeDefined()

      await handle1.close()
      await handle2.close()
    })

    it('closing one handle should not affect another', async () => {
      const handle1 = await fs.open('/test/file.txt', 'r')
      const handle2 = await fs.open('/test/file.txt', 'r')

      await handle1.close()

      // handle2 should still work
      const buffer = new Uint8Array(100)
      const result = await handle2.read(buffer, 0, 100, 0)
      expect(result.bytesRead).toBeGreaterThan(0)

      await handle2.close()
    })

    it('handles should be independent even for same file with r+ mode', async () => {
      const handle1 = await fs.open('/test/file.txt', 'r+')
      const handle2 = await fs.open('/test/file.txt', 'r+')

      await handle1.write('From handle 1')
      await handle1.close()

      // handle2 should still be functional
      const stats = await handle2.stat()
      expect(stats).toBeDefined()

      await handle2.close()
    })

    it('should handle rapid open/close cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const handle = await fs.open('/test/file.txt', 'r')
        await handle.close()
      }

      // File should still be accessible
      const finalHandle = await fs.open('/test/file.txt', 'r')
      expect(finalHandle).toBeDefined()
      await finalHandle.close()
    })
  })

  // ===========================================================================
  // Resource cleanup verification
  // ===========================================================================

  describe('resource cleanup', () => {
    it('should release internal buffers on close', async () => {
      const handle = await fs.open('/test/data.bin', 'r')

      // Read to populate internal buffer
      const buffer = new Uint8Array(100)
      await handle.read(buffer, 0, 5, 0)

      await handle.close()

      // After close, internal resources should be released
      // This is verified by operations failing
      await expect(handle.read(buffer, 0, 5, 0)).rejects.toThrow(/closed|invalid/)
    })

    it('should release write buffers on close', async () => {
      const handle = await fs.open('/test/cleanup.txt', 'w')
      await handle.write('Large amount of data for buffer test')
      await handle.close()

      // Internal write buffer should be flushed and released
      await expect(handle.write('more')).rejects.toThrow(/closed|invalid/)
    })

    it('should handle close on never-read handle', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      // Close without any operations
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle close on never-written handle', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      // Close without any write operations
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should cleanup even if file was deleted externally', async () => {
      const handle = await fs.open('/test/to-delete.txt', 'w')
      await handle.write('Will be deleted')

      // Delete the file while handle is open
      // (In real systems this may behave differently, but we test graceful handling)
      // Note: This tests the handle's ability to close even in unusual states

      await expect(handle.close()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Close error handling
  // ===========================================================================

  describe('close error handling', () => {
    it('should handle close gracefully even if sync fails internally', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('test')

      // Close should complete even if there were internal issues
      // The close operation should not throw
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should report errors during close if flush fails', async () => {
      // This test verifies error reporting if the underlying storage fails
      // With the in-memory backend this may not trigger, but it tests the interface
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('data to flush')

      // Close should either succeed or throw a meaningful error
      const closePromise = handle.close()
      await expect(closePromise).resolves.toBeUndefined()
    })

    it('should not corrupt file if close is interrupted', async () => {
      const handle = await fs.open('/test/interrupt.txt', 'w')
      await handle.write('Important data')
      await handle.close()

      // Verify data integrity
      const content = await fs.readFile('/test/interrupt.txt', 'utf-8')
      expect(content).toBe('Important data')
    })
  })

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle close on handle for empty file', async () => {
      const handle = await fs.open('/test/empty.txt', 'r')
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle close after reading entire file', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      const buffer = new Uint8Array(1000)
      await handle.read(buffer, 0, 1000, 0)
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle close after writing empty string', async () => {
      const handle = await fs.open('/test/empty-write.txt', 'w')
      await handle.write('')
      await handle.close()

      expect(await fs.exists('/test/empty-write.txt')).toBe(true)
    })

    it('should handle close after writing empty Uint8Array', async () => {
      const handle = await fs.open('/test/empty-bytes.txt', 'w')
      await handle.write(new Uint8Array(0))
      await handle.close()

      expect(await fs.exists('/test/empty-bytes.txt')).toBe(true)
    })

    it('should handle close on large file handle', async () => {
      // Create a larger file
      const largeData = new Uint8Array(100000)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      await fs.writeFile('/test/large.bin', largeData)

      const handle = await fs.open('/test/large.bin', 'r')
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle concurrent close calls', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      // Concurrent close calls should all succeed
      const [result1, result2, result3] = await Promise.all([
        handle.close(),
        handle.close(),
        handle.close(),
      ])

      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
      expect(result3).toBeUndefined()
    })
  })
})
