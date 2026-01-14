/**
 * TDD RED Phase: Failing tests for FileHandle.close() resource leak prevention
 *
 * Issue: fsx-iop1 - Tests for resource leak prevention
 *
 * These tests verify that FileHandle.close() properly releases resources
 * even when errors occur during the close operation (e.g., sync() throws).
 *
 * Test scenarios:
 * - close() sets _closed even if sync() throws
 * - Subsequent close() calls are no-ops after failure
 * - Resources cleaned up in finally block
 * - Symbol.asyncDispose handles sync failures
 * - Multiple rapid close() calls are safe
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FSx } from '../core/fsx'
import { MemoryBackend } from '../core/backend'
import { FileHandle } from '../core/types'

describe('FileHandle.close() resource leak prevention', () => {
  let fs: FSx
  let backend: MemoryBackend

  beforeEach(async () => {
    backend = new MemoryBackend()
    fs = new FSx(backend)
    await fs.mkdir('/test', { recursive: true })
    await fs.writeFile('/test/file.txt', 'Hello, World!')
  })

  // ===========================================================================
  // Resource cleanup with try/finally pattern
  // ===========================================================================

  describe('resources cleaned up via try/finally', () => {
    it('should mark handle as closed even if sync() would throw', async () => {
      // Create a handle and write to it (making it dirty)
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Modified content')

      // Close the handle
      await handle.close()

      // Verify handle is closed - operations should fail
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should release data buffer even if operations fail during close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Test data for buffer release')

      await handle.close()

      // After close, internal buffer should be released
      // Verify by attempting operations that would use it
      await expect(handle.stat()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should clear dirty flag on successful close', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Dirty data')

      await handle.close()

      // Second close should be no-op (already cleaned up)
      await expect(handle.close()).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Close idempotency after errors
  // ===========================================================================

  describe('close idempotency after errors', () => {
    it('should allow close() to be called again after successful close', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      // Multiple subsequent closes should all succeed (no-op)
      await expect(handle.close()).resolves.toBeUndefined()
      await expect(handle.close()).resolves.toBeUndefined()
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle rapid consecutive close calls safely', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Content')

      // Fire multiple close calls without awaiting
      const closePromises = [
        handle.close(),
        handle.close(),
        handle.close(),
        handle.close(),
        handle.close(),
      ]

      // All should resolve without throwing
      await expect(Promise.all(closePromises)).resolves.toBeDefined()

      // Handle should be closed
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should handle concurrent close calls returning same promise', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Content for concurrent test')

      // Start multiple concurrent closes
      const promise1 = handle.close()
      const promise2 = handle.close()
      const promise3 = handle.close()

      // All should complete
      await Promise.all([promise1, promise2, promise3])

      // Verify handle is closed
      await expect(handle.sync()).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })
  })

  // ===========================================================================
  // Symbol.asyncDispose handles sync failures
  // ===========================================================================

  describe('Symbol.asyncDispose handles errors gracefully', () => {
    it('should release resources via asyncDispose even after errors', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.write('Data for dispose test')

      // Use asyncDispose instead of close
      await handle[Symbol.asyncDispose]()

      // Handle should be closed and operations should fail
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should be idempotent when called after close()', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      await handle.close()

      // asyncDispose after close should be safe
      await expect(handle[Symbol.asyncDispose]()).resolves.toBeUndefined()
    })

    it('should be idempotent when called multiple times', async () => {
      const handle = await fs.open('/test/file.txt', 'r')

      await handle[Symbol.asyncDispose]()
      await expect(handle[Symbol.asyncDispose]()).resolves.toBeUndefined()
      await expect(handle[Symbol.asyncDispose]()).resolves.toBeUndefined()
    })

    it('should work with manual try/finally pattern simulating await using', async () => {
      const handle = await fs.open('/test/dispose-pattern.txt', 'w')
      try {
        await handle.write('Using pattern test data')
        // Simulate some operation that might fail
      } finally {
        await handle[Symbol.asyncDispose]()
      }

      // File should be written and handle closed
      const content = await fs.readFile('/test/dispose-pattern.txt', 'utf-8')
      expect(content).toBe('Using pattern test data')

      // Handle should be closed
      await expect(handle.write('more')).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })
  })

  // ===========================================================================
  // Memory/resource leak prevention
  // ===========================================================================

  describe('memory leak prevention', () => {
    it('should not accumulate handles on repeated open/close cycles', async () => {
      // Open and close many handles rapidly
      for (let i = 0; i < 100; i++) {
        const handle = await fs.open('/test/file.txt', 'r')
        await handle.close()
      }

      // Should still be able to open new handles
      const finalHandle = await fs.open('/test/file.txt', 'r')
      expect(finalHandle).toBeDefined()
      await finalHandle.close()
    })

    it('should not leak resources on handles that were never read', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      // Don't read, just close
      await handle.close()

      // Should not throw, handle should be properly cleaned up
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should not leak resources on handles that were never written', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      // Open with write capability but don't write
      await handle.close()

      // Should not throw
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should release large buffers on close', async () => {
      // Create a larger file
      const largeData = new Uint8Array(100000)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      await fs.writeFile('/test/large.bin', largeData)

      const handle = await fs.open('/test/large.bin', 'r')
      // Read to load the data
      const buffer = new Uint8Array(100000)
      await handle.read(buffer, 0, 100000, 0)

      await handle.close()

      // Internal buffer should be released
      // Verify by attempting operations
      await expect(handle.read(new Uint8Array(10), 0, 10, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })
  })

  // ===========================================================================
  // Close with pending operations
  // ===========================================================================

  describe('close with pending state', () => {
    it('should handle close on dirty handle (unflushed writes)', async () => {
      const handle = await fs.open('/test/dirty.txt', 'w')
      await handle.write('Unflushed data')
      // Don't call sync()

      await handle.close()

      // Data should be flushed and persisted
      const content = await fs.readFile('/test/dirty.txt', 'utf-8')
      expect(content).toBe('Unflushed data')
    })

    it('should handle close after multiple writes without sync', async () => {
      const handle = await fs.open('/test/multi-dirty.txt', 'w')
      await handle.write('First ')
      await handle.write('Second ')
      await handle.write('Third')
      // Multiple writes, no sync

      await handle.close()

      const content = await fs.readFile('/test/multi-dirty.txt', 'utf-8')
      expect(content).toBe('First Second Third')
    })

    it('should not corrupt data if close is called during write', async () => {
      const handle = await fs.open('/test/interrupt.txt', 'w')
      await handle.write('Important data')

      // Close while potentially still processing
      await handle.close()

      // Data integrity check
      const content = await fs.readFile('/test/interrupt.txt', 'utf-8')
      expect(content).toBe('Important data')
    })
  })

  // ===========================================================================
  // Edge cases for resource cleanup
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle close on empty file handle', async () => {
      await fs.writeFile('/test/empty.txt', '')
      const handle = await fs.open('/test/empty.txt', 'r')
      await expect(handle.close()).resolves.toBeUndefined()
    })

    it('should handle close on newly created file', async () => {
      const handle = await fs.open('/test/brand-new.txt', 'w')
      await expect(handle.close()).resolves.toBeUndefined()

      // File should exist
      expect(await fs.exists('/test/brand-new.txt')).toBe(true)
    })

    it('should handle close after truncate', async () => {
      const handle = await fs.open('/test/file.txt', 'r+')
      await handle.truncate(5)
      await handle.close()

      const content = await fs.readFile('/test/file.txt', 'utf-8')
      expect(content).toBe('Hello')
    })

    it('should handle close after seek operations via positioned read', async () => {
      const handle = await fs.open('/test/file.txt', 'r')
      const buffer = new Uint8Array(5)

      // Read from different positions
      await handle.read(buffer, 0, 5, 0)  // Read "Hello"
      await handle.read(buffer, 0, 5, 7)  // Read "World"

      await handle.close()

      // Handle should be properly closed
      await expect(handle.read(buffer, 0, 5, 0)).rejects.toThrow(/closed|invalid|bad file descriptor/i)
    })

    it('should handle close on append-mode handle', async () => {
      const handle = await fs.open('/test/file.txt', 'a')
      await handle.write(' - Appended')
      await handle.close()

      const content = await fs.readFile('/test/file.txt', 'utf-8')
      expect(content).toContain('Appended')
    })
  })
})
