/**
 * Tests for streaming read endpoint (POST /stream/read)
 *
 * RED phase: These tests verify the stream read endpoint behavior:
 * - POST /stream/read accepts path parameter
 * - Returns file content as stream
 * - Supports Range header for partial reads
 * - Returns 404 for non-existent files
 * - Sets appropriate Content-Type and Content-Length headers
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryStorage,
  createTestFilesystem,
  createRandomBytes,
  MockDurableObjectStub,
} from './test-utils'

describe('Stream Read Endpoint (POST /stream/read)', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('basic streaming', () => {
    it('should accept POST request with path parameter', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
    })

    it('should return file content as stream', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)

      // Read the streamed content
      const content = await response.text()
      expect(content).toBe('Hello, World!')
    })

    it('should return binary file content correctly', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      storage.addFile('/tmp/binary.bin', binaryData)

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/binary.bin' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)

      const arrayBuffer = await response.arrayBuffer()
      const result = new Uint8Array(arrayBuffer)
      expect(result).toEqual(binaryData)
    })

    it('should handle large files (1MB) as stream', async () => {
      const largeData = createRandomBytes(1024 * 1024) // 1MB
      storage.addFile('/tmp/large.bin', largeData)

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/large.bin' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)

      const arrayBuffer = await response.arrayBuffer()
      expect(arrayBuffer.byteLength).toBe(1024 * 1024)
    })

    it('should return empty content for empty files', async () => {
      storage.addFile('/tmp/empty.txt', '')

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/empty.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)

      const content = await response.text()
      expect(content).toBe('')
    })
  })

  describe('Range header support', () => {
    it('should support Range header for partial reads', async () => {
      // File contains "Hello, World!" (13 bytes)
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=0-4',
        },
      })

      expect(response.status).toBe(206) // Partial Content
      const content = await response.text()
      expect(content).toBe('Hello')
    })

    it('should return 206 Partial Content for valid range', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=7-11',
        },
      })

      expect(response.status).toBe(206)
      const content = await response.text()
      expect(content).toBe('World')
    })

    it('should support range with only start (bytes=7-)', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=7-',
        },
      })

      expect(response.status).toBe(206)
      const content = await response.text()
      expect(content).toBe('World!')
    })

    it('should support range from end (bytes=-6)', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=-6',
        },
      })

      expect(response.status).toBe(206)
      const content = await response.text()
      expect(content).toBe('World!')
    })

    it('should set Content-Range header for partial content', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=0-4',
        },
      })

      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Range')).toBe('bytes 0-4/13')
    })

    it('should return 416 Range Not Satisfiable for invalid range', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=100-200', // Beyond file size
        },
      })

      expect(response.status).toBe(416)
      expect(response.headers.get('Content-Range')).toBe('bytes */13')
    })

    it('should handle range on binary files', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
      storage.addFile('/tmp/binary.bin', binaryData)

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/binary.bin' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=2-4',
        },
      })

      expect(response.status).toBe(206)
      const arrayBuffer = await response.arrayBuffer()
      const result = new Uint8Array(arrayBuffer)
      expect(result).toEqual(new Uint8Array([0x02, 0x03, 0x04]))
    })
  })

  describe('error handling', () => {
    it('should return 404 for non-existent files', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/nonexistent/file.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      // Expect 404 Not Found for missing files (HTTP semantics)
      // Current implementation returns 400 with ENOENT code
      expect(response.status).toBe(404)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 when trying to read a directory', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EISDIR')
    })

    it('should return 400 when path is missing', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })

      // Missing path should be a Bad Request
      expect(response.status).toBe(400)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should return 400 for invalid JSON body', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: 'not valid json',
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(400)
    })

    it('should return 403 for path traversal attempts', async () => {
      // Create a stub with a constrained root to test path traversal protection
      const constrainedStub = new MockDurableObjectStub(storage, '/home/user')

      const response = await constrainedStub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/../../../etc/passwd' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(403)
      const error = (await response.json()) as { code: string }
      expect(error.code).toBe('EACCES')
    })
  })

  describe('response headers', () => {
    it('should set Content-Type header to application/octet-stream for unknown extensions', async () => {
      // Create a file with unknown extension to test fallback behavior
      storage.addFile('/tmp/data.unknown', 'binary data')

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/data.unknown' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    })

    it('should set Content-Length header to file size', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Length')).toBe('13') // "Hello, World!".length
    })

    it('should set Accept-Ranges header', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    })

    it('should set Content-Length for partial content', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          Range: 'bytes=0-4',
        },
      })

      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Length')).toBe('5') // "Hello".length
    })

    it('should infer Content-Type for known file extensions', async () => {
      // JSON file
      const jsonResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/data.json' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(jsonResponse.headers.get('Content-Type')).toBe('application/json')

      // Text file
      const txtResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(txtResponse.headers.get('Content-Type')).toBe('text/plain')
    })

    it('should set ETag header', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('ETag')).toBeTruthy()
    })

    it('should set Last-Modified header', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Last-Modified')).toBeTruthy()
    })
  })

  describe('conditional requests', () => {
    it('should return 304 Not Modified for matching If-None-Match', async () => {
      // First request to get ETag
      const firstResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const etag = firstResponse.headers.get('ETag')

      // Second request with If-None-Match
      const secondResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': etag!,
        },
      })

      expect(secondResponse.status).toBe(304)
    })

    it('should return 200 for non-matching If-None-Match', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': '"different-etag"',
        },
      })

      expect(response.status).toBe(200)
    })

    it('should return 412 Precondition Failed for non-matching If-Match', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: {
          'Content-Type': 'application/json',
          'If-Match': '"wrong-etag"',
        },
      })

      expect(response.status).toBe(412)
    })
  })

  describe('streaming behavior', () => {
    it('should return a ReadableStream body', async () => {
      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/hello.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeInstanceOf(ReadableStream)
    })

    it('should be able to read stream in chunks', async () => {
      const largeData = createRandomBytes(64 * 1024) // 64KB
      storage.addFile('/tmp/chunked.bin', largeData)

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/chunked.bin' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)

      // Read stream in chunks
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      // Reconstruct and verify
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      expect(totalLength).toBe(64 * 1024)
    })
  })

  describe('file types', () => {
    it('should handle symlinks by following them', async () => {
      storage.addFile('/home/user/target.txt', 'Target content')
      storage.addSymlink('/home/user/link.txt', '/home/user/target.txt')

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/link.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(200)
      const content = await response.text()
      expect(content).toBe('Target content')
    })

    it('should return 404 for broken symlinks', async () => {
      storage.addSymlink('/home/user/broken.txt', '/nonexistent/target.txt')

      const response = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/broken.txt' }),
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).toBe(404)
    })
  })
})
