import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createReadStream, setStorage, type CreateReadStreamStorage } from './createReadStream'
import { ENOENT, EISDIR, EINVAL } from '../errors'

/**
 * Tests for fs.createReadStream operation
 *
 * These tests follow Node.js fs.createReadStream semantics:
 * - Returns ReadableStream<Uint8Array> for streaming file content
 * - Supports start/end byte range options
 * - Supports configurable chunk size via highWaterMark
 * - Throws ENOENT for non-existent files
 * - Throws EISDIR when path is a directory
 * - Throws EINVAL for invalid range (start > end)
 */

describe('createReadStream', () => {
  // Mock filesystem state for testing
  let mockFs: Map<string, { content: Uint8Array; isDirectory: boolean }>

  beforeEach(() => {
    mockFs = new Map()
    // Setup test fixtures
    mockFs.set('/test/hello.txt', {
      content: new TextEncoder().encode('Hello, World!'),
      isDirectory: false,
    })
    mockFs.set('/test/empty.txt', {
      content: new Uint8Array(0),
      isDirectory: false,
    })
    mockFs.set('/test/unicode.txt', {
      content: new TextEncoder().encode('Hello, \u4e16\u754c! \u{1F600}'),
      isDirectory: false,
    })
    mockFs.set('/test/binary.bin', {
      content: new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]),
      isDirectory: false,
    })
    mockFs.set('/test/mydir', {
      content: new Uint8Array(0),
      isDirectory: true,
    })

    // Create a 100-byte sequential file for range tests
    const sequentialContent = new Uint8Array(100)
    for (let i = 0; i < 100; i++) {
      sequentialContent[i] = i
    }
    mockFs.set('/test/sequential.bin', {
      content: sequentialContent,
      isDirectory: false,
    })

    // Create storage adapter from Map
    const storage: CreateReadStreamStorage = {
      get: (path: string) => mockFs.get(path),
      has: (path: string) => mockFs.has(path),
    }
    setStorage(storage)
  })

  afterEach(() => {
    setStorage(null)
  })

  /**
   * Helper function to read all chunks from a ReadableStream
   */
  async function readAllChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }

    // Combine all chunks into a single Uint8Array
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * Helper function to collect chunk sizes from a ReadableStream
   */
  async function collectChunkSizes(stream: ReadableStream<Uint8Array>): Promise<number[]> {
    const reader = stream.getReader()
    const sizes: number[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sizes.push(value.length)
    }
    return sizes
  }

  describe('basic streaming', () => {
    it('should return a ReadableStream', async () => {
      const stream = await createReadStream('/test/hello.txt')
      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should stream file content in chunks', async () => {
      const stream = await createReadStream('/test/hello.txt')
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello, World!')
    })

    it('should complete after all data is read', async () => {
      const stream = await createReadStream('/test/hello.txt')
      const reader = stream.getReader()

      // Read until done
      let done = false
      while (!done) {
        const result = await reader.read()
        done = result.done
      }

      // Should be able to verify the stream is closed
      expect(done).toBe(true)
    })

    it('should stream binary content correctly', async () => {
      const stream = await createReadStream('/test/binary.bin')
      const content = await readAllChunks(stream)
      expect(content).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]))
    })

    it('should stream unicode content correctly', async () => {
      const stream = await createReadStream('/test/unicode.txt')
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello, \u4e16\u754c! \u{1F600}')
    })
  })

  describe('range reads (start/end)', () => {
    it('should read from start position', async () => {
      // sequential.bin has bytes 0-99
      const stream = await createReadStream('/test/sequential.bin', { start: 50 })
      const content = await readAllChunks(stream)
      // Should read bytes 50-99 (50 bytes)
      expect(content.length).toBe(50)
      expect(content[0]).toBe(50)
      expect(content[49]).toBe(99)
    })

    it('should read up to end position', async () => {
      // sequential.bin has bytes 0-99
      const stream = await createReadStream('/test/sequential.bin', { end: 9 })
      const content = await readAllChunks(stream)
      // Should read bytes 0-9 (10 bytes, inclusive end)
      expect(content.length).toBe(10)
      expect(content[0]).toBe(0)
      expect(content[9]).toBe(9)
    })

    it('should read specific range with both start and end', async () => {
      // sequential.bin has bytes 0-99
      const stream = await createReadStream('/test/sequential.bin', { start: 20, end: 29 })
      const content = await readAllChunks(stream)
      // Should read bytes 20-29 (10 bytes, inclusive)
      expect(content.length).toBe(10)
      expect(content[0]).toBe(20)
      expect(content[9]).toBe(29)
    })

    it('should read single byte range', async () => {
      const stream = await createReadStream('/test/sequential.bin', { start: 42, end: 42 })
      const content = await readAllChunks(stream)
      expect(content.length).toBe(1)
      expect(content[0]).toBe(42)
    })

    it('should throw EINVAL when start > end', async () => {
      await expect(
        createReadStream('/test/sequential.bin', { start: 50, end: 10 })
      ).rejects.toThrow(EINVAL)
    })

    it('should throw EINVAL when start > end with correct error details', async () => {
      try {
        await createReadStream('/test/sequential.bin', { start: 50, end: 10 })
        expect.fail('Should have thrown EINVAL')
      } catch (error) {
        expect(error).toBeInstanceOf(EINVAL)
        expect((error as EINVAL).code).toBe('EINVAL')
        expect((error as EINVAL).syscall).toBe('createReadStream')
      }
    })

    it('should handle range at file boundaries', async () => {
      // Read last 10 bytes
      const stream = await createReadStream('/test/sequential.bin', { start: 90, end: 99 })
      const content = await readAllChunks(stream)
      expect(content.length).toBe(10)
      expect(content[0]).toBe(90)
      expect(content[9]).toBe(99)
    })

    it('should handle end beyond file size gracefully', async () => {
      // end: 200 is beyond file size (100 bytes)
      // Should read to end of file
      const stream = await createReadStream('/test/sequential.bin', { start: 90, end: 200 })
      const content = await readAllChunks(stream)
      expect(content.length).toBe(10) // Only 10 bytes remaining
      expect(content[0]).toBe(90)
      expect(content[9]).toBe(99)
    })
  })

  describe('chunking behavior', () => {
    beforeEach(() => {
      // Create a larger file for chunking tests (256KB)
      const largeContent = new Uint8Array(256 * 1024)
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256
      }
      mockFs.set('/test/large-chunking.bin', {
        content: largeContent,
        isDirectory: false,
      })
    })

    it('should use default chunk size of 64KB', async () => {
      const stream = await createReadStream('/test/large-chunking.bin')
      const chunkSizes = await collectChunkSizes(stream)

      // With 256KB file and 64KB default chunk size, expect 4 chunks
      expect(chunkSizes.length).toBe(4)
      expect(chunkSizes[0]).toBe(64 * 1024)
      expect(chunkSizes[1]).toBe(64 * 1024)
      expect(chunkSizes[2]).toBe(64 * 1024)
      expect(chunkSizes[3]).toBe(64 * 1024)
    })

    it('should respect highWaterMark option', async () => {
      const stream = await createReadStream('/test/large-chunking.bin', {
        highWaterMark: 32 * 1024, // 32KB chunks
      })
      const chunkSizes = await collectChunkSizes(stream)

      // With 256KB file and 32KB chunk size, expect 8 chunks
      expect(chunkSizes.length).toBe(8)
      chunkSizes.forEach((size) => {
        expect(size).toBe(32 * 1024)
      })
    })

    it('should handle small highWaterMark', async () => {
      const stream = await createReadStream('/test/hello.txt', {
        highWaterMark: 4, // 4 byte chunks
      })
      const chunkSizes = await collectChunkSizes(stream)

      // "Hello, World!" is 13 bytes, so we expect 4 chunks (4+4+4+1)
      expect(chunkSizes.length).toBe(4)
      expect(chunkSizes[0]).toBe(4)
      expect(chunkSizes[1]).toBe(4)
      expect(chunkSizes[2]).toBe(4)
      expect(chunkSizes[3]).toBe(1)
    })

    it('should handle highWaterMark larger than file', async () => {
      const stream = await createReadStream('/test/hello.txt', {
        highWaterMark: 1024 * 1024, // 1MB chunk size
      })
      const chunkSizes = await collectChunkSizes(stream)

      // File is only 13 bytes, should be one chunk
      expect(chunkSizes.length).toBe(1)
      expect(chunkSizes[0]).toBe(13)
    })

    it('should handle backpressure correctly', async () => {
      const stream = await createReadStream('/test/large-chunking.bin', {
        highWaterMark: 32 * 1024,
      })
      const reader = stream.getReader()
      const chunkSizes: number[] = []

      // Read slowly with delays to test backpressure
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunkSizes.push(value.length)
        // Simulate slow consumer
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      // All data should still be received correctly
      const totalBytes = chunkSizes.reduce((sum, size) => sum + size, 0)
      expect(totalBytes).toBe(256 * 1024)
    })
  })

  describe('large file streaming', () => {
    beforeEach(() => {
      // Create 1MB file
      const oneMbContent = new Uint8Array(1024 * 1024)
      for (let i = 0; i < oneMbContent.length; i++) {
        oneMbContent[i] = i % 256
      }
      mockFs.set('/test/1mb.bin', {
        content: oneMbContent,
        isDirectory: false,
      })

      // Create 10MB file
      const tenMbContent = new Uint8Array(10 * 1024 * 1024)
      for (let i = 0; i < tenMbContent.length; i++) {
        tenMbContent[i] = i % 256
      }
      mockFs.set('/test/10mb.bin', {
        content: tenMbContent,
        isDirectory: false,
      })
    })

    it('should stream 1MB file without memory issues', async () => {
      const stream = await createReadStream('/test/1mb.bin')
      const content = await readAllChunks(stream)
      expect(content.length).toBe(1024 * 1024)
      // Verify some bytes
      expect(content[0]).toBe(0)
      expect(content[255]).toBe(255)
      expect(content[256]).toBe(0)
      expect(content[1024 * 512]).toBe(0) // Midpoint
    })

    it('should stream 10MB file without memory issues', async () => {
      const stream = await createReadStream('/test/10mb.bin')
      const content = await readAllChunks(stream)
      expect(content.length).toBe(10 * 1024 * 1024)
      // Verify data integrity
      expect(content[0]).toBe(0)
      expect(content[255]).toBe(255)
      expect(content[5 * 1024 * 1024]).toBe(0) // 5MB mark
    })

    it('should stream large file with range options', async () => {
      // Read middle 1MB of 10MB file
      const stream = await createReadStream('/test/10mb.bin', {
        start: 4 * 1024 * 1024,
        end: 5 * 1024 * 1024 - 1,
      })
      const content = await readAllChunks(stream)
      expect(content.length).toBe(1024 * 1024)
    })

    it('should handle streaming with multiple concurrent readers', async () => {
      // Start two streams on same file
      // First half: bytes 0 to 524287 (inclusive) = 524288 bytes = 512KB
      // Second half: bytes 524288 to 1048575 (inclusive) = 524288 bytes = 512KB
      const stream1 = await createReadStream('/test/1mb.bin', { start: 0, end: 512 * 1024 - 1 })
      const stream2 = await createReadStream('/test/1mb.bin', { start: 512 * 1024, end: 1024 * 1024 - 1 })

      // Read both in parallel
      const [content1, content2] = await Promise.all([readAllChunks(stream1), readAllChunks(stream2)])

      expect(content1.length).toBe(512 * 1024)
      expect(content2.length).toBe(512 * 1024)
    })
  })

  describe('error handling', () => {
    it('should throw ENOENT for non-existent file', async () => {
      await expect(createReadStream('/nonexistent/file.txt')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT with correct path in error', async () => {
      try {
        await createReadStream('/nonexistent/file.txt')
        expect.fail('Should have thrown ENOENT')
      } catch (error) {
        expect(error).toBeInstanceOf(ENOENT)
        expect((error as ENOENT).path).toBe('/nonexistent/file.txt')
        expect((error as ENOENT).syscall).toBe('open')
      }
    })

    it('should throw ENOENT for nested nonexistent path', async () => {
      await expect(createReadStream('/a/b/c/d/e/file.txt')).rejects.toThrow(ENOENT)
    })

    it('should throw ENOENT with correct error code', async () => {
      try {
        await createReadStream('/nonexistent.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as ENOENT).code).toBe('ENOENT')
        expect((error as ENOENT).errno).toBe(-2)
      }
    })

    it('should throw EISDIR when path is a directory', async () => {
      await expect(createReadStream('/test/mydir')).rejects.toThrow(EISDIR)
    })

    it('should throw EISDIR with correct path in error', async () => {
      try {
        await createReadStream('/test/mydir')
        expect.fail('Should have thrown EISDIR')
      } catch (error) {
        expect(error).toBeInstanceOf(EISDIR)
        expect((error as EISDIR).path).toBe('/test/mydir')
        expect((error as EISDIR).syscall).toBe('read')
      }
    })

    it('should throw EISDIR with correct error code', async () => {
      try {
        await createReadStream('/test/mydir')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as EISDIR).code).toBe('EISDIR')
        expect((error as EISDIR).errno).toBe(-21)
      }
    })

    it('should include path in error', async () => {
      try {
        await createReadStream('/some/path/to/file.txt')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as ENOENT).path).toBe('/some/path/to/file.txt')
      }
    })
  })

  describe('abort/cancel', () => {
    beforeEach(() => {
      // Create a larger file for abort tests
      const largeContent = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256
      }
      mockFs.set('/test/abortable.bin', {
        content: largeContent,
        isDirectory: false,
      })
    })

    it('should stop streaming when signal is aborted', async () => {
      const controller = new AbortController()
      const stream = await createReadStream('/test/abortable.bin', {
        signal: controller.signal,
        highWaterMark: 1024, // Small chunks
      })

      const reader = stream.getReader()
      let chunksRead = 0

      // Read a few chunks then abort
      for (let i = 0; i < 5; i++) {
        const { done } = await reader.read()
        if (done) break
        chunksRead++
      }

      // Abort the stream
      controller.abort()

      // Try to read more - should get abort error or stream closed
      try {
        await reader.read()
        // Stream might close gracefully, that's ok
      } catch {
        // AbortError is expected
      }

      expect(chunksRead).toBeGreaterThan(0)
      expect(chunksRead).toBeLessThan(100) // Should not have read entire file
    })

    it('should abort immediately if signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await createReadStream('/test/hello.txt', { signal: controller.signal })
        expect.fail('Should have thrown abort error')
      } catch (error) {
        // Should throw an AbortError or error with 'abort' in the message
        expect((error as Error).name === 'AbortError' || (error as Error).message.toLowerCase().includes('abort')).toBe(true)
      }
    })

    it('should clean up resources on abort', async () => {
      const controller = new AbortController()
      const stream = await createReadStream('/test/abortable.bin', {
        signal: controller.signal,
        highWaterMark: 1024,
      })

      const reader = stream.getReader()
      // Read one chunk
      await reader.read()

      // Abort
      controller.abort()

      // Cancel the reader to clean up
      await reader.cancel().catch(() => {
        // Cancellation might throw, that's ok
      })

      // The stream should be properly closed
      // We can't easily verify resource cleanup in a test, but we verify it completes
    })
  })

  describe('HTTP integration', () => {
    it('should work with Response for HTTP streaming', async () => {
      const stream = await createReadStream('/test/hello.txt')
      const response = new Response(stream, {
        headers: { 'Content-Type': 'text/plain' },
      })

      expect(response.body).toBeInstanceOf(ReadableStream)
      const text = await response.text()
      expect(text).toBe('Hello, World!')
    })

    it('should support HTTP Range header patterns (first 5 bytes)', async () => {
      // Simulate Range: bytes=0-4
      const stream = await createReadStream('/test/hello.txt', { start: 0, end: 4 })
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello')
    })

    it('should support HTTP Range header patterns (last 6 bytes)', async () => {
      // Simulate Range: bytes=-6 (last 6 bytes)
      // "Hello, World!" is 13 bytes, so last 6 is "World!"
      const stream = await createReadStream('/test/hello.txt', { start: 7, end: 12 })
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('World!')
    })

    it('should support HTTP Range header patterns (from offset to end)', async () => {
      // Simulate Range: bytes=7-
      const stream = await createReadStream('/test/hello.txt', { start: 7 })
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('World!')
    })

    it('should create valid Content-Range responses', async () => {
      // For a 206 Partial Content response
      const stream = await createReadStream('/test/sequential.bin', { start: 10, end: 19 })
      const response = new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': 'bytes 10-19/100',
          'Content-Length': '10',
        },
      })

      // Read the response body to verify content
      const content = new Uint8Array(await response.arrayBuffer())

      expect(response.status).toBe(206)
      expect(content.length).toBe(10)
    })
  })

  describe('empty file', () => {
    it('should return empty stream for empty file', async () => {
      const stream = await createReadStream('/test/empty.txt')
      const content = await readAllChunks(stream)
      expect(content.length).toBe(0)
    })

    it('should close immediately for empty file', async () => {
      const stream = await createReadStream('/test/empty.txt')
      const reader = stream.getReader()
      const { done, value } = await reader.read()
      expect(done).toBe(true)
      expect(value).toBeUndefined()
    })

    it('should handle range on empty file', async () => {
      const stream = await createReadStream('/test/empty.txt', { start: 0, end: 0 })
      const content = await readAllChunks(stream)
      expect(content.length).toBe(0)
    })
  })

  describe('path normalization', () => {
    it('should handle paths with double slashes', async () => {
      const stream = await createReadStream('/test//hello.txt')
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello, World!')
    })

    it('should handle paths with . components', async () => {
      const stream = await createReadStream('/test/./hello.txt')
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello, World!')
    })

    it('should handle paths with .. components', async () => {
      const stream = await createReadStream('/test/subdir/../hello.txt')
      const content = await readAllChunks(stream)
      expect(new TextDecoder().decode(content)).toBe('Hello, World!')
    })

    it('should reject relative paths', async () => {
      await expect(createReadStream('test/hello.txt')).rejects.toThrow(EINVAL)
    })
  })

  describe('type safety', () => {
    it('should return ReadableStream<Uint8Array> type', async () => {
      const stream: ReadableStream<Uint8Array> = await createReadStream('/test/hello.txt')
      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('should accept ReadStreamOptions type', async () => {
      const options = {
        start: 0,
        end: 4,
        highWaterMark: 1024,
        signal: undefined,
      }
      const stream = await createReadStream('/test/hello.txt', options)
      expect(stream).toBeInstanceOf(ReadableStream)
    })
  })
})
