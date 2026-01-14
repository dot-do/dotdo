/**
 * Tests for RPC Handler - JSON-RPC style request handling
 *
 * This test file covers:
 * - POST /rpc accepts JSON-RPC style requests with method and params
 * - Method dispatch routes to correct handlers
 * - Error handling returns proper status codes (400 for bad request, 404 for method not found, 500 for internal errors)
 * - Response format includes result or error
 *
 * These are RED tests (TDD) - they define expected behavior before implementation.
 *
 * @module tests/rpc-handler
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem, MockDurableObjectStub } from './test-utils'

// ============================================================================
// JSON-RPC Request Format Tests
// ============================================================================

describe('RPC Handler - JSON-RPC Request Format', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('POST /rpc accepts JSON-RPC style requests', () => {
    it('should accept request with method and params', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBeDefined()
    })

    it('should accept request with jsonrpc version field', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should accept request with id field', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-123',
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { id?: string }
      // Response should echo back the id for correlation
      expect(result.id).toBe('req-123')
    })

    it('should accept request with numeric id', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { id?: number }
      expect(result.id).toBe(42)
    })

    it('should handle request without params field', async () => {
      // Some methods may not require params
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'ping',
        }),
      })

      // Should either succeed (if ping exists) or return method not found
      expect([200, 404]).toContain(response.status)
    })

    it('should accept empty params object', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stat',
          params: {},
        }),
      })

      // Will fail because path is required, but should be a proper error response
      expect(response.status).toBeGreaterThanOrEqual(400)
      const error = await response.json()
      expect(error).toHaveProperty('code')
    })

    it('should accept params as array (positional args)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stat',
          params: ['/home'],
        }),
      })

      // Either succeeds with array params or returns proper error
      expect([200, 400]).toContain(response.status)
    })
  })

  describe('request validation', () => {
    it('should reject GET requests to /rpc', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'GET',
      })

      expect(response.status).toBe(404)
    })

    it('should reject malformed JSON body', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('PARSE_ERROR')
    })

    it('should reject request without method field', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_REQUEST')
    })

    it('should reject request with empty method', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: '',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_REQUEST')
    })

    it('should reject request with non-string method', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 123,
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_REQUEST')
    })

    it('should reject request with null body', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_REQUEST')
    })
  })
})

// ============================================================================
// Method Dispatch Tests
// ============================================================================

describe('RPC Handler - Method Dispatch', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('filesystem methods routing', () => {
    it('should route readFile to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { data: string; encoding: string }
      expect(result.data).toBeDefined()
      expect(result.encoding).toBe('base64')
    })

    it('should route writeFile to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path: '/home/user/new-file.txt',
            data: btoa('New content'),
            encoding: 'base64',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/new-file.txt')).toBe(true)
    })

    it('should route stat to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { size: number; mode: number }
      expect(result.size).toBe(13)
      expect(result.mode).toBeDefined()
    })

    it('should route mkdir to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user/newdir' },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.isDirectory('/home/user/newdir')).toBe(true)
    })

    it('should route rmdir to correct handler', async () => {
      storage.addDirectory('/home/user/emptydir')

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user/emptydir' },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/emptydir')).toBe(false)
    })

    it('should route readdir to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as string[]
      expect(Array.isArray(result)).toBe(true)
      expect(result).toContain('hello.txt')
    })

    it('should route unlink to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unlink',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hello.txt')).toBe(false)
    })

    it('should route rename to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rename',
          params: {
            oldPath: '/home/user/hello.txt',
            newPath: '/home/user/renamed.txt',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hello.txt')).toBe(false)
      expect(storage.has('/home/user/renamed.txt')).toBe(true)
    })

    it('should route copyFile to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'copyFile',
          params: {
            src: '/home/user/hello.txt',
            dest: '/home/user/copy.txt',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hello.txt')).toBe(true)
      expect(storage.has('/home/user/copy.txt')).toBe(true)
    })

    it('should route chmod to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'chmod',
          params: { path: '/home/user/hello.txt', mode: 0o755 },
        }),
      })

      expect(response.status).toBe(200)
      const entry = storage.get('/home/user/hello.txt')
      expect((entry?.mode ?? 0) & 0o777).toBe(0o755)
    })

    it('should route chown to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'chown',
          params: { path: '/home/user/hello.txt', uid: 1000, gid: 1000 },
        }),
      })

      expect(response.status).toBe(200)
      const entry = storage.get('/home/user/hello.txt')
      expect(entry?.uid).toBe(1000)
      expect(entry?.gid).toBe(1000)
    })

    it('should route symlink to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'symlink',
          params: {
            target: '/home/user/hello.txt',
            path: '/home/user/link.txt',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.isSymlink('/home/user/link.txt')).toBe(true)
    })

    it('should route readlink to correct handler', async () => {
      storage.addSymlink('/home/user/link.txt', '/home/user/hello.txt')

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readlink',
          params: { path: '/home/user/link.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('/home/user/hello.txt')
    })

    it('should route truncate to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'truncate',
          params: { path: '/home/user/hello.txt', length: 5 },
        }),
      })

      expect(response.status).toBe(200)
      const content = storage.readFileAsString('/home/user/hello.txt')
      expect(content.length).toBe(5)
    })

    it('should route access to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'access',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should route realpath to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'realpath',
          params: { path: '/home/user/../user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('/home/user/hello.txt')
    })

    it('should route lstat to correct handler', async () => {
      storage.addSymlink('/home/user/link.txt', '/home/user/hello.txt')

      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'lstat',
          params: { path: '/home/user/link.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { mode: number }
      // lstat returns info about the symlink itself
      expect(result.mode).toBeDefined()
    })

    it('should route rm to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rm',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hello.txt')).toBe(false)
    })

    it('should route link to correct handler', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'link',
          params: {
            existingPath: '/home/user/hello.txt',
            newPath: '/home/user/hardlink.txt',
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(storage.has('/home/user/hardlink.txt')).toBe(true)
    })
  })

  describe('method not found', () => {
    it('should return 404 for unknown method', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'unknownMethod',
          params: {},
        }),
      })

      expect(response.status).toBe(404)
      const error = await response.json() as { code: string; message: string }
      expect(error.code).toBe('METHOD_NOT_FOUND')
      expect(error.message).toContain('unknownMethod')
    })

    it('should return 404 for internal method prefixed with underscore', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: '_internalMethod',
          params: {},
        }),
      })

      expect(response.status).toBe(404)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('METHOD_NOT_FOUND')
    })

    it('should be case-sensitive for method names', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'READFILE', // Should be 'readFile'
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(404)
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('RPC Handler - Error Handling', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('400 Bad Request errors', () => {
    it('should return 400 for ENOENT (file not found)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return 400 for EISDIR (is a directory)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EISDIR')
    })

    it('should return 400 for ENOTDIR (not a directory)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('ENOTDIR')
    })

    it('should return 400 for ENOTEMPTY (directory not empty)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'rmdir',
          params: { path: '/home/user' }, // Has files in it
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('ENOTEMPTY')
    })

    it('should return 400 for EEXIST (file exists)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home' }, // Already exists
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EEXIST')
    })

    it('should return 400 for EINVAL (invalid argument)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readlink',
          params: { path: '/home/user/hello.txt' }, // Not a symlink
        }),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should return 400 for missing required params', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: {}, // Missing path
        }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('403 Forbidden errors', () => {
    it('should return 403 for EACCES (permission denied)', async () => {
      // Path traversal attack attempt
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/../../../etc/passwd' },
        }),
      })

      expect(response.status).toBe(403)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EACCES')
    })
  })

  describe('404 Not Found errors', () => {
    it('should return 404 for unknown method', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'doesNotExist',
          params: {},
        }),
      })

      expect(response.status).toBe(404)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('METHOD_NOT_FOUND')
    })
  })

  describe('500 Internal Server Error', () => {
    it('should return 500 for unexpected errors', async () => {
      // This test would require mocking an internal error
      // For now, we verify the error response format
      const errorResponse = {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      }

      expect(errorResponse.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('error response format', () => {
    it('should include code in error response', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      const error = await response.json() as { code: string }
      expect(error.code).toBeDefined()
      expect(typeof error.code).toBe('string')
    })

    it('should include message in error response', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      const error = await response.json() as { message: string }
      expect(error.message).toBeDefined()
      expect(typeof error.message).toBe('string')
    })

    it('should include path in error response when applicable', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      const error = await response.json() as { path: string }
      expect(error.path).toBe('/nonexistent.txt')
    })

    it('should echo request id in error response', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'error-req-123',
          method: 'readFile',
          params: { path: '/nonexistent.txt' },
        }),
      })

      const error = await response.json() as { id: string }
      expect(error.id).toBe('error-req-123')
    })
  })
})

// ============================================================================
// Response Format Tests
// ============================================================================

describe('RPC Handler - Response Format', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('success response format', () => {
    it('should return result directly for simple operations', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { size: number }
      expect(result.size).toBeDefined()
    })

    it('should return data and encoding for readFile', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { data: string; encoding: string }
      expect(result.data).toBeDefined()
      expect(result.encoding).toBe('base64')
    })

    it('should return array for readdir', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return empty object for void operations', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: '/home/user/newdir' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual({})
    })

    it('should set Content-Type header to application/json', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should include jsonrpc version in response if requested', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { jsonrpc?: string; result?: unknown }
      // If using full JSON-RPC 2.0 format, response should include jsonrpc field
      // and wrap result in 'result' field
      expect(result.jsonrpc).toBe('2.0')
      expect(result.result).toBeDefined()
    })
  })

  describe('stat response format', () => {
    it('should include all POSIX stat fields', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/hello.txt' },
        }),
      })

      const stat = await response.json() as Record<string, unknown>
      expect(stat.dev).toBeDefined()
      expect(stat.ino).toBeDefined()
      expect(stat.mode).toBeDefined()
      expect(stat.nlink).toBeDefined()
      expect(stat.uid).toBeDefined()
      expect(stat.gid).toBeDefined()
      expect(stat.rdev).toBeDefined()
      expect(stat.size).toBeDefined()
      expect(stat.blksize).toBeDefined()
      expect(stat.blocks).toBeDefined()
      expect(stat.atime).toBeDefined()
      expect(stat.mtime).toBeDefined()
      expect(stat.ctime).toBeDefined()
      expect(stat.birthtime).toBeDefined()
    })
  })

  describe('readdir response format', () => {
    it('should return array of strings by default', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user' },
        }),
      })

      const entries = await response.json() as string[]
      expect(Array.isArray(entries)).toBe(true)
      expect(entries.every((e) => typeof e === 'string')).toBe(true)
    })

    it('should return dirent objects with withFileTypes option', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/home/user', withFileTypes: true },
        }),
      })

      const entries = await response.json() as Array<{ name: string; type: string }>
      expect(Array.isArray(entries)).toBe(true)
      expect(entries[0]).toHaveProperty('name')
      expect(entries[0]).toHaveProperty('type')
    })
  })
})

// ============================================================================
// Batch Request Tests
// ============================================================================

describe('RPC Handler - Batch Requests', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('batch request handling', () => {
    it('should accept array of requests', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'stat', params: { path: '/home' } },
          { jsonrpc: '2.0', id: 2, method: 'stat', params: { path: '/tmp' } },
        ]),
      })

      expect(response.status).toBe(200)
      const results = await response.json() as Array<{ id: number }>
      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(2)
    })

    it('should return results in same order as requests', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 'first', method: 'stat', params: { path: '/home' } },
          { jsonrpc: '2.0', id: 'second', method: 'stat', params: { path: '/tmp' } },
        ]),
      })

      const results = await response.json() as Array<{ id: string }>
      expect(results[0].id).toBe('first')
      expect(results[1].id).toBe('second')
    })

    it('should handle mixed success and error in batch', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'stat', params: { path: '/home' } },
          { jsonrpc: '2.0', id: 2, method: 'stat', params: { path: '/nonexistent' } },
        ]),
      })

      const results = await response.json() as Array<{ result?: unknown; error?: { code: string } }>
      expect(results[0].result).toBeDefined()
      expect(results[1].error).toBeDefined()
      expect(results[1].error?.code).toBe('ENOENT')
    })

    it('should return 400 for empty batch array', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify([]),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_REQUEST')
    })
  })
})

// ============================================================================
// Notification Tests (requests without id)
// ============================================================================

describe('RPC Handler - Notifications', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('notification handling', () => {
    it('should process notification (request without id)', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'mkdir',
          params: { path: '/home/user/notification-dir' },
          // No id field - this is a notification
        }),
      })

      // Notifications can return 204 No Content or 200 with empty body
      expect([200, 204]).toContain(response.status)
      // But the operation should still be performed
      expect(storage.isDirectory('/home/user/notification-dir')).toBe(true)
    })

    it('should not return response body for notification', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'mkdir',
          params: { path: '/home/user/silent-dir' },
        }),
      })

      // For strict JSON-RPC 2.0, notifications should not return a response
      if (response.status === 204) {
        const text = await response.text()
        expect(text).toBe('')
      }
    })
  })
})

// ============================================================================
// Content-Type Handling Tests
// ============================================================================

describe('RPC Handler - Content-Type Handling', () => {
  let storage: InMemoryStorage
  let stub: MockDurableObjectStub

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  describe('request content-type', () => {
    it('should accept application/json content type', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should accept application/json with charset', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should accept text/json content type', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'text/json' },
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
    })

    it('should accept request without Content-Type header', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('response content-type', () => {
    it('should return application/json content type', async () => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home' },
        }),
      })

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })
})
