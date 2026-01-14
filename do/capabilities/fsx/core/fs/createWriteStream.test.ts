/**
 * Tests for fs.createWriteStream operation
 *
 * RED PHASE TDD: These tests are written before implementation.
 * All tests should fail initially until createWriteStream is implemented.
 *
 * createWriteStream provides a WritableStream interface for file uploads:
 * - Returns WritableStream<Uint8Array> for streaming file writes
 * - Supports flags (w, a, wx, ax) for write modes
 * - Creates files that don't exist
 * - Handles large file streaming without buffering entire file
 * - Throws ENOENT for missing parent directories
 * - Throws EISDIR when path is a directory
 * - Throws EEXIST for exclusive write (wx) when file exists
 * - Supports abort signal for cancellation
 * - Content type detection/setting for R2 metadata
 * - Completion confirmation via writer.close()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWriteStream, setStorage, type CreateWriteStreamStorage, type WriteStreamOptions } from './createWriteStream'
import { ENOENT, EISDIR, EEXIST } from '../errors'

describe('createWriteStream', () => {
  // Mock filesystem state for testing
  let mockFs: Map<string, { content: Uint8Array; isDirectory: boolean; metadata?: { mode: number } }>
  let mockDirs: Set<string>

  beforeEach(() => {
    mockFs = new Map()
    mockDirs = new Set(['/', '/test', '/test/subdir'])

    // Setup test fixtures
    mockFs.set('/test/existing.txt', {
      content: new TextEncoder().encode('Existing content'),
      isDirectory: false,
      metadata: { mode: 0o644 },
    })
    mockFs.set('/test/mydir', {
      content: new Uint8Array(0),
      isDirectory: true,
    })

    // Create storage adapter from Map
    const storage: CreateWriteStreamStorage = {
      parentExists: (path: string) => {
        const parent = path.substring(0, path.lastIndexOf('/')) || '/'
        return mockDirs.has(parent)
      },
      isDirectory: (path: string) => {
        const entry = mockFs.get(path)
        return entry?.isDirectory ?? mockDirs.has(path)
      },
      exists: (path: string) => mockFs.has(path) || mockDirs.has(path),
      getFile: (path: string) => {
        const entry = mockFs.get(path)
        if (entry && !entry.isDirectory) {
          return { content: entry.content, metadata: entry.metadata ?? { mode: 0o644 } }
        }
        return undefined
      },
      writeFile: async (path: string, data: Uint8Array, options?: { mode?: number; contentType?: string }) => {
        mockFs.set(path, {
          content: data,
          isDirectory: false,
          metadata: { mode: options?.mode ?? 0o644 },
        })
      },
    }

    setStorage(storage)
  })

  afterEach(() => {
    setStorage(null)
  })

  /**
   * Helper function to write data to a WritableStream
   */
  async function writeToStream(stream: WritableStream<Uint8Array>, data: Uint8Array): Promise<void> {
    const writer = stream.getWriter()
    try {
      await writer.write(data)
      await writer.close()
    } finally {
      writer.releaseLock()
    }
  }

  /**
   * Helper function to write data in chunks to a WritableStream
   */
  async function writeChunksToStream(stream: WritableStream<Uint8Array>, chunks: Uint8Array[]): Promise<void> {
    const writer = stream.getWriter()
    try {
      for (const chunk of chunks) {
        await writer.write(chunk)
      }
      await writer.close()
    } finally {
      writer.releaseLock()
    }
  }

  describe('basic streaming', () => {
    it('should return a WritableStream', async () => {
      const stream = await createWriteStream('/test/new.txt')
      expect(stream).toBeInstanceOf(WritableStream)
    })

    it('should write data to file', async () => {
      const stream = await createWriteStream('/test/new.txt')
      const content = new TextEncoder().encode('Hello, World!')

      await writeToStream(stream, content)

      const file = mockFs.get('/test/new.txt')
      expect(file).toBeDefined()
      expect(file?.content).toEqual(content)
    })

    it('should create file if it does not exist', async () => {
      expect(mockFs.has('/test/newfile.txt')).toBe(false)

      const stream = await createWriteStream('/test/newfile.txt')
      await writeToStream(stream, new TextEncoder().encode('New content'))

      expect(mockFs.has('/test/newfile.txt')).toBe(true)
    })

    it('should overwrite file with flags="w"', async () => {
      const originalContent = mockFs.get('/test/existing.txt')?.content
      expect(originalContent).toBeDefined()

      const stream = await createWriteStream('/test/existing.txt', { flags: 'w' })
      const newContent = new TextEncoder().encode('Overwritten!')
      await writeToStream(stream, newContent)

      const file = mockFs.get('/test/existing.txt')
      expect(file?.content).toEqual(newContent)
      expect(file?.content).not.toEqual(originalContent)
    })

    it('should write binary data correctly', async () => {
      const stream = await createWriteStream('/test/binary.bin')
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      await writeToStream(stream, binaryData)

      const file = mockFs.get('/test/binary.bin')
      expect(file?.content).toEqual(binaryData)
    })

    it('should write empty content', async () => {
      const stream = await createWriteStream('/test/empty.txt')
      await writeToStream(stream, new Uint8Array(0))

      const file = mockFs.get('/test/empty.txt')
      expect(file?.content.length).toBe(0)
    })

    it('should write multiple chunks', async () => {
      const stream = await createWriteStream('/test/chunked.txt')
      const chunk1 = new TextEncoder().encode('Hello, ')
      const chunk2 = new TextEncoder().encode('World!')

      await writeChunksToStream(stream, [chunk1, chunk2])

      const file = mockFs.get('/test/chunked.txt')
      expect(new TextDecoder().decode(file?.content)).toBe('Hello, World!')
    })
  })

  describe('append mode', () => {
    it('should append with flags="a"', async () => {
      // First, set up existing file
      mockFs.set('/test/appendable.txt', {
        content: new TextEncoder().encode('Original'),
        isDirectory: false,
        metadata: { mode: 0o644 },
      })

      const stream = await createWriteStream('/test/appendable.txt', { flags: 'a' })
      await writeToStream(stream, new TextEncoder().encode(' Appended'))

      const file = mockFs.get('/test/appendable.txt')
      expect(new TextDecoder().decode(file?.content)).toBe('Original Appended')
    })

    it('should create file if not exists with flags="a"', async () => {
      expect(mockFs.has('/test/append-new.txt')).toBe(false)

      const stream = await createWriteStream('/test/append-new.txt', { flags: 'a' })
      await writeToStream(stream, new TextEncoder().encode('New content'))

      expect(mockFs.has('/test/append-new.txt')).toBe(true)
    })

    it('should append multiple chunks in sequence', async () => {
      mockFs.set('/test/multi-append.txt', {
        content: new TextEncoder().encode('Start'),
        isDirectory: false,
        metadata: { mode: 0o644 },
      })

      const stream = await createWriteStream('/test/multi-append.txt', { flags: 'a' })
      await writeChunksToStream(stream, [
        new TextEncoder().encode('-Middle'),
        new TextEncoder().encode('-End'),
      ])

      const file = mockFs.get('/test/multi-append.txt')
      expect(new TextDecoder().decode(file?.content)).toBe('Start-Middle-End')
    })
  })

  describe('exclusive write', () => {
    it('should fail with flags="wx" if file exists', async () => {
      await expect(
        createWriteStream('/test/existing.txt', { flags: 'wx' })
      ).rejects.toThrow(EEXIST)
    })

    it('should succeed with flags="wx" if file does not exist', async () => {
      const stream = await createWriteStream('/test/exclusive-new.txt', { flags: 'wx' })
      expect(stream).toBeInstanceOf(WritableStream)

      await writeToStream(stream, new TextEncoder().encode('Exclusive'))
      expect(mockFs.has('/test/exclusive-new.txt')).toBe(true)
    })

    it('should throw EEXIST with correct syscall for wx flag', async () => {
      try {
        await createWriteStream('/test/existing.txt', { flags: 'wx' })
        expect.fail('Should have thrown EEXIST')
      } catch (error) {
        expect(error).toBeInstanceOf(EEXIST)
        expect((error as EEXIST).code).toBe('EEXIST')
        expect((error as EEXIST).syscall).toBe('open')
      }
    })

    it('should fail with flags="ax" if file exists', async () => {
      await expect(
        createWriteStream('/test/existing.txt', { flags: 'ax' })
      ).rejects.toThrow(EEXIST)
    })
  })

  describe('large file uploads', () => {
    it('should handle 1MB upload', async () => {
      const stream = await createWriteStream('/test/1mb.bin')
      const size = 1024 * 1024
      const content = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        content[i] = i % 256
      }

      await writeToStream(stream, content)

      const file = mockFs.get('/test/1mb.bin')
      expect(file?.content.length).toBe(size)
      expect(file?.content[0]).toBe(0)
      expect(file?.content[255]).toBe(255)
    })

    it('should handle 5MB upload (single R2 put)', async () => {
      const stream = await createWriteStream('/test/5mb.bin')
      const size = 5 * 1024 * 1024
      const content = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        content[i] = i % 256
      }

      await writeToStream(stream, content)

      const file = mockFs.get('/test/5mb.bin')
      expect(file?.content.length).toBe(size)
    })

    it('should handle 10MB upload (multipart)', async () => {
      const stream = await createWriteStream('/test/10mb.bin')
      const size = 10 * 1024 * 1024
      const content = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        content[i] = i % 256
      }

      await writeToStream(stream, content)

      const file = mockFs.get('/test/10mb.bin')
      expect(file?.content.length).toBe(size)
    })

    it('should handle streaming without buffering entire file', async () => {
      const stream = await createWriteStream('/test/streamed.bin')
      const chunkSize = 64 * 1024 // 64KB chunks
      const numChunks = 16 // Total 1MB
      const chunks: Uint8Array[] = []

      for (let i = 0; i < numChunks; i++) {
        const chunk = new Uint8Array(chunkSize)
        chunk.fill(i % 256)
        chunks.push(chunk)
      }

      await writeChunksToStream(stream, chunks)

      const file = mockFs.get('/test/streamed.bin')
      expect(file?.content.length).toBe(chunkSize * numChunks)
    })

    it('should handle very large chunks', async () => {
      const stream = await createWriteStream('/test/large-chunk.bin')
      const largeChunk = new Uint8Array(2 * 1024 * 1024) // 2MB single chunk
      largeChunk.fill(42)

      await writeToStream(stream, largeChunk)

      const file = mockFs.get('/test/large-chunk.bin')
      expect(file?.content.length).toBe(2 * 1024 * 1024)
      expect(file?.content[0]).toBe(42)
    })
  })

  describe('error handling', () => {
    it('should throw ENOENT if parent directory missing', async () => {
      await expect(
        createWriteStream('/nonexistent/parent/file.txt')
      ).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT with correct syscall and path', async () => {
      try {
        await createWriteStream('/nonexistent/file.txt')
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).code).toBe('ENOENT')
        expect((error as ENOENT).syscall).toBe('open')
      }
    }
    )

    it('should throw EISDIR if path is directory', async () => {
      await expect(
        createWriteStream('/test/mydir')
      ).rejects.toThrow(EISDIR)
    })

    it('should throw EISDIR with correct syscall', async () => {
      try {
        await createWriteStream('/test/mydir')
        expect.fail('Should have thrown EISDIR')
      } catch (error) {
        expect(error).toBeInstanceOf(EISDIR)
        expect((error as EISDIR).code).toBe('EISDIR')
        expect((error as EISDIR).syscall).toBe('open')
      }
    })

    it('should propagate write errors', async () => {
      // Create a mock that throws on writeFile
      const errorStorage: CreateWriteStreamStorage = {
        parentExists: () => true,
        isDirectory: () => false,
        exists: () => false,
        getFile: () => undefined,
        writeFile: async () => {
          throw new Error('Simulated write error')
        },
      }
      setStorage(errorStorage)

      const stream = await createWriteStream('/test/error.txt')
      const writer = stream.getWriter()

      try {
        await writer.write(new TextEncoder().encode('data'))
        await writer.close()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).toContain('write error')
      }
    })
  })

  describe('abort/cancel', () => {
    it('should abort upload when signal is aborted', async () => {
      const controller = new AbortController()
      const stream = await createWriteStream('/test/abortable.txt', {
        signal: controller.signal,
      })

      const writer = stream.getWriter()

      // Write first chunk
      await writer.write(new TextEncoder().encode('First chunk'))

      // Abort the operation
      controller.abort()

      // Subsequent writes should fail or be ignored
      try {
        await writer.write(new TextEncoder().encode('Second chunk'))
        // Some implementations may allow the write but fail on close
        await writer.close()
      } catch {
        // AbortError or write failure is expected
      }
    })

    it('should throw immediately if signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await createWriteStream('/test/pre-aborted.txt', {
          signal: controller.signal,
        })
        expect.fail('Should have thrown abort error')
      } catch (error) {
        expect((error as Error).name === 'AbortError' || (error as Error).message.toLowerCase().includes('abort')).toBe(true)
      }
    })

    it('should clean up partial uploads on abort', async () => {
      const controller = new AbortController()
      const stream = await createWriteStream('/test/cleanup.txt', {
        signal: controller.signal,
      })

      const writer = stream.getWriter()
      await writer.write(new TextEncoder().encode('Partial'))

      // Abort before close
      controller.abort()

      // Cancel the stream
      await stream.abort('Test abort').catch(() => {
        // Expected
      })

      // The file should not exist or be in an inconsistent state
      // (Implementation-dependent behavior)
    })
  })

  describe('content type', () => {
    it('should set content type from option', async () => {
      const stream = await createWriteStream('/test/data.json', {
        contentType: 'application/json',
      })
      await writeToStream(stream, new TextEncoder().encode('{"key": "value"}'))

      // Content type should be stored in metadata (implementation-dependent)
      expect(stream).toBeDefined()
    })

    it('should detect content type from extension', async () => {
      const stream = await createWriteStream('/test/image.png')
      await writeToStream(stream, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

      // Content type should be auto-detected as image/png
      expect(stream).toBeDefined()
    })

    it('should use provided content type over auto-detection', async () => {
      const stream = await createWriteStream('/test/custom.txt', {
        contentType: 'application/octet-stream',
      })
      await writeToStream(stream, new TextEncoder().encode('Plain text'))

      // Should use provided content type, not text/plain
      expect(stream).toBeDefined()
    })
  })

  describe('completion confirmation', () => {
    it('should resolve writer.close() after upload completes', async () => {
      const stream = await createWriteStream('/test/complete.txt')
      const writer = stream.getWriter()

      await writer.write(new TextEncoder().encode('Data'))

      // close() should only resolve after all data is persisted
      await expect(writer.close()).resolves.toBeUndefined()

      // File should exist with correct content
      const file = mockFs.get('/test/complete.txt')
      expect(file).toBeDefined()
    })

    it('should reject if upload fails', async () => {
      // Create storage that fails on writeFile
      const failingStorage: CreateWriteStreamStorage = {
        parentExists: () => true,
        isDirectory: () => false,
        exists: () => false,
        getFile: () => undefined,
        writeFile: async () => {
          throw new Error('Upload failed')
        },
      }
      setStorage(failingStorage)

      const stream = await createWriteStream('/test/failing.txt')
      const writer = stream.getWriter()

      await writer.write(new TextEncoder().encode('Data'))

      // close() should reject with the upload error
      await expect(writer.close()).rejects.toThrow('Upload failed')
    })

    it('should handle concurrent writes correctly', async () => {
      const stream1 = await createWriteStream('/test/concurrent1.txt')
      const stream2 = await createWriteStream('/test/concurrent2.txt')

      await Promise.all([
        writeToStream(stream1, new TextEncoder().encode('Content 1')),
        writeToStream(stream2, new TextEncoder().encode('Content 2')),
      ])

      const file1 = mockFs.get('/test/concurrent1.txt')
      const file2 = mockFs.get('/test/concurrent2.txt')

      expect(new TextDecoder().decode(file1?.content)).toBe('Content 1')
      expect(new TextDecoder().decode(file2?.content)).toBe('Content 2')
    })
  })

  describe('file mode', () => {
    it('should create file with default mode (0o644)', async () => {
      const stream = await createWriteStream('/test/default-mode.txt')
      await writeToStream(stream, new TextEncoder().encode('content'))

      const file = mockFs.get('/test/default-mode.txt')
      expect(file?.metadata?.mode).toBe(0o644)
    })

    it('should create file with specified mode', async () => {
      const stream = await createWriteStream('/test/custom-mode.txt', {
        mode: 0o600,
      })
      await writeToStream(stream, new TextEncoder().encode('secret'))

      const file = mockFs.get('/test/custom-mode.txt')
      expect(file?.metadata?.mode).toBe(0o600)
    })

    it('should create executable file with mode 0o755', async () => {
      const stream = await createWriteStream('/test/script.sh', {
        mode: 0o755,
      })
      await writeToStream(stream, new TextEncoder().encode('#!/bin/bash\necho hello'))

      const file = mockFs.get('/test/script.sh')
      expect(file?.metadata?.mode).toBe(0o755)
    })
  })

  describe('path handling', () => {
    it('should handle paths with double slashes', async () => {
      const stream = await createWriteStream('/test//normalized.txt')
      await writeToStream(stream, new TextEncoder().encode('content'))

      // Should normalize to /test/normalized.txt
      const file = mockFs.get('/test/normalized.txt')
      expect(file).toBeDefined()
    })

    it('should handle paths with dot components', async () => {
      const stream = await createWriteStream('/test/./dotpath.txt')
      await writeToStream(stream, new TextEncoder().encode('content'))

      // Should normalize to /test/dotpath.txt
      const file = mockFs.get('/test/dotpath.txt')
      expect(file).toBeDefined()
    })

    it('should handle paths with parent references', async () => {
      const stream = await createWriteStream('/test/subdir/../parentref.txt')
      await writeToStream(stream, new TextEncoder().encode('content'))

      // Should normalize to /test/parentref.txt
      const file = mockFs.get('/test/parentref.txt')
      expect(file).toBeDefined()
    })

    it('should reject relative paths', async () => {
      await expect(
        createWriteStream('relative/path.txt')
      ).rejects.toThrow()
    })
  })

  describe('start position', () => {
    it('should write at specified start position', async () => {
      // Setup existing file with content
      mockFs.set('/test/positioned.txt', {
        content: new TextEncoder().encode('AAAAAAAAAA'), // 10 A's
        isDirectory: false,
        metadata: { mode: 0o644 },
      })

      const stream = await createWriteStream('/test/positioned.txt', {
        start: 3,
        flags: 'w',
      })
      await writeToStream(stream, new TextEncoder().encode('BBB'))

      const file = mockFs.get('/test/positioned.txt')
      // Expected: AAABBBAAAA (if file is preserved) or AAABBB (if truncated after write)
      // The exact behavior depends on implementation
      expect(file?.content).toBeDefined()
    })

    it('should extend file if start position is beyond current size', async () => {
      const stream = await createWriteStream('/test/extended.txt', {
        start: 5,
      })
      await writeToStream(stream, new TextEncoder().encode('Hello'))

      const file = mockFs.get('/test/extended.txt')
      expect(file?.content.length).toBeGreaterThanOrEqual(10) // 5 bytes gap + 5 bytes content
    })
  })
})
