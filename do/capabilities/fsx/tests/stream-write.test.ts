/**
 * Tests for Stream Write Endpoint - POST /stream/write
 *
 * TDD RED phase: These tests define the expected behavior for the stream write
 * endpoint. Tests should fail until the implementation is complete.
 *
 * Tests verify:
 * - POST /stream/write accepts path and data
 * - Creates file entry in files table
 * - Stores blob data in blobs table
 * - Updates existing files (overwrites)
 * - Returns file metadata after write
 * - Handles X-FSX-Mode and X-FSX-Flags headers
 *
 * @module tests/stream-write
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createTestFilesystem, InMemoryStorage, MockDurableObjectStub } from './test-utils'

// ============================================================================
// Stream Write Endpoint Tests
// ============================================================================

describe('Stream Write Endpoint - POST /stream/write', () => {
  let stub: MockDurableObjectStub
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    stub = new MockDurableObjectStub(storage)
  })

  // ==========================================================================
  // Basic Write Operations
  // ==========================================================================

  describe('basic write operations', () => {
    it('should accept path via X-FSx-Path header and write data', async () => {
      const content = 'Hello, World!'
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/test.txt',
        },
        body: new TextEncoder().encode(content),
      })

      expect(response.status).toBe(200)
      const result = await response.json() as { success: boolean; path: string }
      expect(result.success).toBe(true)
      expect(result.path).toBe('/home/user/test.txt')
    })

    it('should create file that can be read back via stat', async () => {
      const content = 'Test content for verification'
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/verify.txt',
        },
        body: new TextEncoder().encode(content),
      })

      // Verify file exists via stat RPC
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/verify.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { size: number }
      expect(stats.size).toBe(content.length)
    })

    it('should write binary data correctly', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/binary.bin',
        },
        body: binaryData.buffer,
      })

      expect(response.status).toBe(200)

      // Verify file exists and has correct size
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/binary.bin' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { size: number }
      expect(stats.size).toBe(binaryData.length)
    })

    it('should write empty file', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/empty.txt',
        },
        body: new ArrayBuffer(0),
      })

      expect(response.status).toBe(200)

      // Verify file exists with size 0
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/empty.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { size: number }
      expect(stats.size).toBe(0)
    })

    it('should write large file (1MB)', async () => {
      const largeData = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/large.bin',
        },
        body: largeData.buffer,
      })

      expect(response.status).toBe(200)

      // Verify file exists with correct size
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/large.bin' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { size: number }
      expect(stats.size).toBe(1024 * 1024)
    })
  })

  // ==========================================================================
  // File Entry Creation
  // ==========================================================================

  describe('file entry creation in files table', () => {
    it('should create file entry with correct size', async () => {
      const content = 'Hello, World!'
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/sized.txt' },
        body: new TextEncoder().encode(content),
      })

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/sized.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { size: number }
      expect(stats.size).toBe(content.length)
    })

    it('should set timestamps on file creation', async () => {
      const before = Date.now()
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/timestamped.txt' },
        body: new TextEncoder().encode('content'),
      })
      const after = Date.now()

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/timestamped.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { mtime: number; ctime: number; birthtime: number }
      expect(stats.mtime).toBeGreaterThanOrEqual(before)
      expect(stats.mtime).toBeLessThanOrEqual(after)
      expect(stats.ctime).toBeGreaterThanOrEqual(before)
      expect(stats.ctime).toBeLessThanOrEqual(after)
      expect(stats.birthtime).toBeGreaterThanOrEqual(before)
      expect(stats.birthtime).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // File Content Verification via Read
  // ==========================================================================

  describe('file content storage and retrieval', () => {
    it('should store content that can be read back correctly', async () => {
      const content = 'Exact content to verify'
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/readable.txt' },
        body: new TextEncoder().encode(content),
      })

      // Read file content back via stream/read
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/readable.txt' }),
      })

      expect(readResponse.status).toBe(200)
      const readContent = await readResponse.text()
      expect(readContent).toBe(content)
    })

    it('should store binary content that can be read back correctly', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/binary-verify.bin' },
        body: binaryData.buffer,
      })

      // Read file content back via stream/read
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/binary-verify.bin' }),
      })

      expect(readResponse.status).toBe(200)
      const readBuffer = await readResponse.arrayBuffer()
      expect(new Uint8Array(readBuffer)).toEqual(binaryData)
    })
  })

  // ==========================================================================
  // File Updates (Overwrite)
  // ==========================================================================

  describe('updating existing files (overwrite)', () => {
    it('should overwrite existing file content', async () => {
      // First write
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/overwrite.txt' },
        body: new TextEncoder().encode('original content'),
      })

      // Second write (overwrite)
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/overwrite.txt' },
        body: new TextEncoder().encode('new content'),
      })

      // Read file content back
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/overwrite.txt' }),
      })

      expect(readResponse.status).toBe(200)
      const content = await readResponse.text()
      expect(content).toBe('new content')
    })

    it('should update file size on overwrite', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/resize.txt' },
        body: new TextEncoder().encode('short'),
      })

      const statBefore = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/resize.txt' },
        }),
      })
      const sizeBefore = ((await statBefore.json()) as { size: number }).size
      expect(sizeBefore).toBe(5)

      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/resize.txt' },
        body: new TextEncoder().encode('much longer content now'),
      })

      const statAfter = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/resize.txt' },
        }),
      })
      const sizeAfter = ((await statAfter.json()) as { size: number }).size
      expect(sizeAfter).toBe(23)
    })

    it('should update mtime on overwrite', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/mtime.txt' },
        body: new TextEncoder().encode('original'),
      })

      const statBefore = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/mtime.txt' },
        }),
      })
      const mtimeBefore = ((await statBefore.json()) as { mtime: number }).mtime

      // Small delay to ensure time difference
      await new Promise((r) => setTimeout(r, 10))

      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/mtime.txt' },
        body: new TextEncoder().encode('updated'),
      })

      const statAfter = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/mtime.txt' },
        }),
      })
      const mtimeAfter = ((await statAfter.json()) as { mtime: number }).mtime
      expect(mtimeAfter).toBeGreaterThanOrEqual(mtimeBefore)
    })

    it('should preserve birthtime on overwrite', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/birthtime.txt' },
        body: new TextEncoder().encode('original'),
      })

      const statBefore = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/birthtime.txt' },
        }),
      })
      const birthtimeBefore = ((await statBefore.json()) as { birthtime: number }).birthtime

      await new Promise((r) => setTimeout(r, 10))

      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/birthtime.txt' },
        body: new TextEncoder().encode('updated'),
      })

      const statAfter = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/birthtime.txt' },
        }),
      })
      const birthtimeAfter = ((await statAfter.json()) as { birthtime: number }).birthtime
      expect(birthtimeAfter).toBe(birthtimeBefore)
    })
  })

  // ==========================================================================
  // Response Metadata
  // ==========================================================================

  describe('response file metadata', () => {
    it('should return success: true on successful write', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/success.txt' },
        body: new TextEncoder().encode('content'),
      })

      const result = await response.json() as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('should return path in response', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/pathed.txt' },
        body: new TextEncoder().encode('content'),
      })

      const result = await response.json() as { path: string }
      expect(result.path).toBe('/home/user/pathed.txt')
    })

    it('should return size in response', async () => {
      const content = 'Known length content'
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/sizeresponse.txt' },
        body: new TextEncoder().encode(content),
      })

      const result = await response.json() as { size: number }
      expect(result.size).toBe(content.length)
    })

    it('should return mode in response', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/moderesponse.txt',
          'X-FSx-Options': JSON.stringify({ mode: 0o755 }),
        },
        body: new TextEncoder().encode('content'),
      })

      const result = await response.json() as { mode: number }
      expect(result.mode).toBe(0o755)
    })

    it('should return created: true for new files', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/brandnew.txt' },
        body: new TextEncoder().encode('new file'),
      })

      const result = await response.json() as { created: boolean }
      expect(result.created).toBe(true)
    })

    it('should return created: false for updated files', async () => {
      // Create first
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/existing.txt' },
        body: new TextEncoder().encode('original'),
      })

      // Update
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/existing.txt' },
        body: new TextEncoder().encode('updated'),
      })

      const result = await response.json() as { created: boolean }
      expect(result.created).toBe(false)
    })

    it('should return mtime in response', async () => {
      const before = Date.now()
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/mtimeresponse.txt' },
        body: new TextEncoder().encode('content'),
      })
      const after = Date.now()

      const result = await response.json() as { mtime: number }
      expect(result.mtime).toBeGreaterThanOrEqual(before)
      expect(result.mtime).toBeLessThanOrEqual(after)
    })
  })

  // ==========================================================================
  // X-FSx-Mode Header
  // ==========================================================================

  describe('X-FSx-Mode header handling', () => {
    it('should set default mode 0o644 when mode not specified', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/defaultmode.txt' },
        body: new TextEncoder().encode('content'),
      })

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/defaultmode.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { mode: number }
      // Check permission bits (mask off file type bits)
      expect(stats.mode & 0o777).toBe(0o644)
    })

    it('should set custom mode from X-FSx-Options', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/custommode.txt',
          'X-FSx-Options': JSON.stringify({ mode: 0o600 }),
        },
        body: new TextEncoder().encode('secret content'),
      })

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/custommode.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { mode: number }
      expect(stats.mode & 0o777).toBe(0o600)
    })

    it('should handle executable mode 0o755', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/executable.sh',
          'X-FSx-Options': JSON.stringify({ mode: 0o755 }),
        },
        body: new TextEncoder().encode('#!/bin/bash\necho hello'),
      })

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/executable.sh' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { mode: number }
      expect(stats.mode & 0o777).toBe(0o755)
    })

    it('should handle read-only mode 0o444', async () => {
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/readonly.txt',
          'X-FSx-Options': JSON.stringify({ mode: 0o444 }),
        },
        body: new TextEncoder().encode('read only content'),
      })

      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/readonly.txt' },
        }),
      })

      expect(statResponse.status).toBe(200)
      const stats = await statResponse.json() as { mode: number }
      expect(stats.mode & 0o777).toBe(0o444)
    })
  })

  // ==========================================================================
  // X-FSx-Flags Header
  // ==========================================================================

  describe('X-FSx-Flags header handling', () => {
    it('should handle write flag "w" (default, create or truncate)', async () => {
      // Create initial file
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/writeflag.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'w' }),
        },
        body: new TextEncoder().encode('initial content'),
      })

      // Write again with 'w' flag should truncate
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/writeflag.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'w' }),
        },
        body: new TextEncoder().encode('new'),
      })

      // Read file content back
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/writeflag.txt' }),
      })

      expect(readResponse.status).toBe(200)
      const content = await readResponse.text()
      expect(content).toBe('new')
    })

    it('should handle append flag "a"', async () => {
      // Create initial file
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/appendflag.txt' },
        body: new TextEncoder().encode('Hello'),
      })

      // Append with 'a' flag
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/appendflag.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'a' }),
        },
        body: new TextEncoder().encode(', World!'),
      })

      // Read file content back
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/appendflag.txt' }),
      })

      expect(readResponse.status).toBe(200)
      const content = await readResponse.text()
      expect(content).toBe('Hello, World!')
    })

    it('should handle exclusive create flag "wx"', async () => {
      // Create first file
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/exclusive.txt' },
        body: new TextEncoder().encode('original'),
      })

      // Try to write with 'wx' flag - should fail
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/exclusive.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'wx' }),
        },
        body: new TextEncoder().encode('should fail'),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EEXIST')
    })

    it('should handle exclusive append flag "ax"', async () => {
      // Create first file
      await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/exclusiveappend.txt' },
        body: new TextEncoder().encode('original'),
      })

      // Try to write with 'ax' flag - should fail
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/exclusiveappend.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'ax' }),
        },
        body: new TextEncoder().encode('should fail'),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EEXIST')
    })

    it('should successfully create new file with "wx" flag', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/newexclusive.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'wx' }),
        },
        body: new TextEncoder().encode('exclusive content'),
      })

      expect(response.status).toBe(200)

      // Verify file was created
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/newexclusive.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })

    it('should successfully create new file with "ax" flag', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/newappendexclusive.txt',
          'X-FSx-Options': JSON.stringify({ flag: 'ax' }),
        },
        body: new TextEncoder().encode('append content'),
      })

      expect(response.status).toBe(200)

      // Verify file was created
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/newappendexclusive.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 400 when path is missing', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {},
        body: new TextEncoder().encode('content'),
      })

      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('EINVAL')
    })

    it('should return 404 when parent directory does not exist', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/nonexistent/dir/file.txt' },
        body: new TextEncoder().encode('content'),
      })

      expect(response.status).toBe(404)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('ENOENT')
    })

    it('should return error for invalid JSON in X-FSx-Options', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: {
          'X-FSx-Path': '/home/user/badjson.txt',
          'X-FSx-Options': 'not valid json',
        },
        body: new TextEncoder().encode('content'),
      })

      expect(response.status).toBe(400)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle file at root directory', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/rootfile.txt' },
        body: new TextEncoder().encode('root content'),
      })

      expect(response.status).toBe(200)

      // Verify file exists
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/rootfile.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })

    it('should handle file with special characters in name', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/file-with.special_chars.txt' },
        body: new TextEncoder().encode('content'),
      })

      expect(response.status).toBe(200)

      // Verify file exists
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/file-with.special_chars.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })

    it('should handle file with unicode name', async () => {
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/\u6587\u4EF6.txt' },
        body: new TextEncoder().encode('unicode content'),
      })

      expect(response.status).toBe(200)

      // Verify file exists
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/\u6587\u4EF6.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })

    it('should handle binary data with null bytes', async () => {
      const nullData = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00])
      const response = await stub.fetch('http://fsx.do/stream/write', {
        method: 'POST',
        headers: { 'X-FSx-Path': '/home/user/nullbytes.bin' },
        body: nullData.buffer,
      })

      expect(response.status).toBe(200)

      // Read back and verify
      const readResponse = await stub.fetch('http://fsx.do/stream/read', {
        method: 'POST',
        body: JSON.stringify({ path: '/home/user/nullbytes.bin' }),
      })

      expect(readResponse.status).toBe(200)
      const readBuffer = await readResponse.arrayBuffer()
      expect(new Uint8Array(readBuffer)).toEqual(nullData)
    })

    it('should handle rapid successive writes to same file', async () => {
      const writes = []
      for (let i = 0; i < 5; i++) {
        writes.push(
          stub.fetch('http://fsx.do/stream/write', {
            method: 'POST',
            headers: { 'X-FSx-Path': '/home/user/rapid.txt' },
            body: new TextEncoder().encode(`content ${i}`),
          })
        )
      }

      const responses = await Promise.all(writes)
      responses.forEach((r) => expect(r.status).toBe(200))

      // File should exist
      const statResponse = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/home/user/rapid.txt' },
        }),
      })
      expect(statResponse.status).toBe(200)
    })
  })
})
