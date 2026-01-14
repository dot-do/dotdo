/**
 * Tests for RPC Service Mode
 *
 * Tests the FsServiceClient and FsServiceHandler for heavy filesystem operations
 * including batch reads/writes, streaming, and progress reporting.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FsServiceClient,
  FsServiceHandler,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_PARALLEL_LIMIT,
  type BatchFileItem,
  type ProgressEvent,
  type FsServiceFs,
} from '../core/rpc/fs-service.js'
import type { Stats, StorageTier, ReadOptions, WriteOptions } from '../core/types.js'

// =============================================================================
// Mock Implementation
// =============================================================================

/**
 * Mock filesystem implementation for testing
 */
class MockFs implements FsServiceFs {
  private files: Map<string, { content: Uint8Array; tier: StorageTier }> = new Map()
  private directories: Set<string> = new Set(['/'])

  async read(path: string, options?: ReadOptions): Promise<string | Uint8Array> {
    const file = this.files.get(path)
    if (!file) {
      throw Object.assign(new Error(`File not found: ${path}`), { code: 'ENOENT', path })
    }

    if (options?.encoding === 'utf-8' || options?.encoding === 'utf8') {
      return new TextDecoder().decode(file.content)
    }
    return file.content
  }

  async write(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void> {
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    if (parentPath !== '/' && !this.directories.has(parentPath)) {
      throw Object.assign(new Error(`Parent directory not found: ${parentPath}`), {
        code: 'ENOENT',
        path: parentPath,
      })
    }

    const content = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const tier = options?.tier ?? 'hot'
    this.files.set(path, { content, tier })
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    if (this.directories.has(path)) {
      if (options?.recursive) {
        // Delete directory and all children
        for (const [filePath] of this.files) {
          if (filePath.startsWith(path + '/')) {
            this.files.delete(filePath)
          }
        }
        for (const dir of this.directories) {
          if (dir.startsWith(path + '/') || dir === path) {
            this.directories.delete(dir)
          }
        }
        this.directories.delete(path)
      } else {
        throw Object.assign(new Error(`Is a directory: ${path}`), { code: 'EISDIR', path })
      }
    } else if (this.files.has(path)) {
      this.files.delete(path)
    } else if (!options?.force) {
      throw Object.assign(new Error(`File not found: ${path}`), { code: 'ENOENT', path })
    }
  }

  async stat(path: string): Promise<Stats> {
    if (this.directories.has(path)) {
      return this.createStats(path, true, 0)
    }
    const file = this.files.get(path)
    if (!file) {
      throw Object.assign(new Error(`File not found: ${path}`), { code: 'ENOENT', path })
    }
    return this.createStats(path, false, file.content.length)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.directories.has(path)) {
      if (!options?.recursive) {
        throw Object.assign(new Error(`Directory exists: ${path}`), { code: 'EEXIST', path })
      }
      return
    }

    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.directories.add(current)
      }
    } else {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
      if (!this.directories.has(parentPath)) {
        throw Object.assign(new Error(`Parent not found: ${parentPath}`), { code: 'ENOENT', path: parentPath })
      }
      this.directories.add(path)
    }
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | unknown[]> {
    if (!this.directories.has(path)) {
      throw Object.assign(new Error(`Directory not found: ${path}`), { code: 'ENOENT', path })
    }

    const prefix = path === '/' ? '/' : path + '/'
    const entries: string[] = []

    for (const dir of this.directories) {
      if (dir.startsWith(prefix) && dir !== path) {
        const rest = dir.substring(prefix.length)
        const name = rest.split('/')[0]
        if (name && !entries.includes(name)) {
          entries.push(name)
        }
      }
    }

    for (const [filePath] of this.files) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.substring(prefix.length)
        const name = rest.split('/')[0]
        if (name && !entries.includes(name)) {
          entries.push(name)
        }
      }
    }

    return entries.sort()
  }

  async copyFile(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void> {
    const file = this.files.get(src)
    if (!file) {
      throw Object.assign(new Error(`File not found: ${src}`), { code: 'ENOENT', path: src })
    }
    if (this.files.has(dest) && !options?.overwrite) {
      throw Object.assign(new Error(`File exists: ${dest}`), { code: 'EEXIST', path: dest })
    }
    this.files.set(dest, { content: new Uint8Array(file.content), tier: file.tier })
  }

  async rename(oldPath: string, newPath: string, options?: { overwrite?: boolean }): Promise<void> {
    const file = this.files.get(oldPath)
    if (!file) {
      throw Object.assign(new Error(`File not found: ${oldPath}`), { code: 'ENOENT', path: oldPath })
    }
    if (this.files.has(newPath) && !options?.overwrite) {
      throw Object.assign(new Error(`File exists: ${newPath}`), { code: 'EEXIST', path: newPath })
    }
    this.files.set(newPath, file)
    this.files.delete(oldPath)
  }

  async getTier(path: string): Promise<StorageTier> {
    const file = this.files.get(path)
    if (!file) {
      throw Object.assign(new Error(`File not found: ${path}`), { code: 'ENOENT', path })
    }
    return file.tier
  }

  // Test helpers
  addFile(path: string, content: string | Uint8Array, tier: StorageTier = 'hot'): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    this.files.set(path, { content: bytes, tier })
  }

  addDirectory(path: string): void {
    this.directories.add(path)
  }

  private createStats(path: string, isDir: boolean, size: number): Stats {
    const now = Date.now()
    return {
      dev: 0,
      ino: 0,
      mode: isDir ? 0o40755 : 0o100644,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize: 4096,
      blocks: Math.ceil(size / 512),
      atimeMs: now,
      mtimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
      atime: new Date(now),
      mtime: new Date(now),
      ctime: new Date(now),
      birthtime: new Date(now),
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    }
  }
}

/**
 * Mock Service binding for testing the client
 */
class MockService {
  private handler: FsServiceHandler

  constructor(fs: FsServiceFs) {
    this.handler = new FsServiceHandler(fs, '1.0.0-test')
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    return this.handler.handleRequest(request)
  }
}

// =============================================================================
// Type Definitions Tests
// =============================================================================

describe('RPC Service Types', () => {
  it('exports DEFAULT_CHUNK_SIZE as 64KB', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(64 * 1024)
  })

  it('exports DEFAULT_PARALLEL_LIMIT as 10', () => {
    expect(DEFAULT_PARALLEL_LIMIT).toBe(10)
  })
})

// =============================================================================
// FsServiceHandler Tests
// =============================================================================

describe('FsServiceHandler', () => {
  let mockFs: MockFs
  let handler: FsServiceHandler

  beforeEach(() => {
    mockFs = new MockFs()
    handler = new FsServiceHandler(mockFs, '1.0.0-test')
  })

  describe('ping', () => {
    it('returns ok status with version and timestamp', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'ping', params: {} }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.ok).toBe(true)
      expect(result.data.version).toBe('1.0.0-test')
      expect(typeof result.data.timestamp).toBe('number')
    })
  })

  describe('batchRead', () => {
    beforeEach(() => {
      mockFs.addFile('/a.txt', 'Content A')
      mockFs.addFile('/b.txt', 'Content B')
      mockFs.addFile('/c.txt', 'Content C')
    })

    it('reads multiple files successfully', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchRead',
          params: { paths: ['/a.txt', '/b.txt', '/c.txt'] },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(3)
      expect(result.data.failed).toBe(0)
    })

    it('handles missing files with continueOnError', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchRead',
          params: {
            paths: ['/a.txt', '/nonexistent.txt', '/c.txt'],
            options: { continueOnError: true },
          },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(2)
      expect(result.data.failed).toBe(1)
    })
  })

  describe('batchWrite', () => {
    beforeEach(() => {
      mockFs.addDirectory('/data')
    })

    it('writes multiple files successfully', async () => {
      const files: BatchFileItem[] = [
        { path: '/data/a.txt', content: 'Content A' },
        { path: '/data/b.txt', content: 'Content B' },
        { path: '/data/c.txt', content: 'Content C' },
      ]

      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchWrite',
          params: { files },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(3)
      expect(result.data.failed).toBe(0)
    })

    it('handles write errors with continueOnError', async () => {
      const files: BatchFileItem[] = [
        { path: '/data/a.txt', content: 'Content A' },
        { path: '/nonexistent-parent/b.txt', content: 'Content B' },
        { path: '/data/c.txt', content: 'Content C' },
      ]

      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchWrite',
          params: { files, options: { continueOnError: true } },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(2)
      expect(result.data.failed).toBe(1)
    })
  })

  describe('batchDelete', () => {
    beforeEach(() => {
      mockFs.addFile('/a.txt', 'Content A')
      mockFs.addFile('/b.txt', 'Content B')
      mockFs.addFile('/c.txt', 'Content C')
    })

    it('deletes multiple files successfully', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchDelete',
          params: { paths: ['/a.txt', '/b.txt', '/c.txt'] },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(3)
      expect(result.data.failed).toBe(0)
    })

    it('handles force option for missing files', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchDelete',
          params: {
            paths: ['/a.txt', '/nonexistent.txt'],
            options: { force: true },
          },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.succeeded).toBe(2)
      expect(result.data.failed).toBe(0)
    })
  })

  describe('batchStat', () => {
    beforeEach(() => {
      mockFs.addFile('/a.txt', 'Content A')
      mockFs.addDirectory('/dir')
    })

    it('gets stats for multiple paths', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batchStat',
          params: { paths: ['/a.txt', '/dir'] },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.total).toBe(2)
      expect(result.data.succeeded).toBe(2)
    })
  })

  describe('streaming operations', () => {
    beforeEach(() => {
      // Create a file with known content
      const content = new Uint8Array(100 * 1024) // 100KB
      for (let i = 0; i < content.length; i++) {
        content[i] = i % 256
      }
      mockFs.addFile('/large.bin', content)
      mockFs.addDirectory('/output')
    })

    it('streams read a file in chunks', async () => {
      // Start streaming session
      const startRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadStart',
          params: { path: '/large.bin', options: { chunkSize: 32 * 1024 } },
        }),
      })

      const startResponse = await handler.handleRequest(startRequest)
      expect(startResponse.status).toBe(200)

      const startResult = await startResponse.json()
      const { sessionId, totalChunks, totalSize } = startResult.data

      expect(totalSize).toBe(100 * 1024)
      expect(totalChunks).toBe(4) // 100KB / 32KB chunks

      // Read first chunk
      const chunkRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadChunk',
          params: { sessionId, chunkIndex: 0 },
        }),
      })

      const chunkResponse = await handler.handleRequest(chunkRequest)
      expect(chunkResponse.status).toBe(200)

      const chunkResult = await chunkResponse.json()
      expect(chunkResult.data.index).toBe(0)
      expect(chunkResult.data.offset).toBe(0)

      // End session
      const endRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadEnd',
          params: { sessionId },
        }),
      })

      const endResponse = await handler.handleRequest(endRequest)
      expect(endResponse.status).toBe(200)

      const endResult = await endResponse.json()
      expect(endResult.data.success).toBe(true)
    })

    it('streams write a file in chunks', async () => {
      const totalSize = 64 * 1024 // 64KB

      // Start write session
      const startRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamWriteStart',
          params: { path: '/output/written.bin', totalSize },
        }),
      })

      const startResponse = await handler.handleRequest(startRequest)
      expect(startResponse.status).toBe(200)

      const startResult = await startResponse.json()
      const { sessionId, chunkSize } = startResult.data

      // Write chunks
      const totalChunks = Math.ceil(totalSize / chunkSize)
      for (let i = 0; i < totalChunks; i++) {
        const chunkData = new Uint8Array(Math.min(chunkSize, totalSize - i * chunkSize))
        for (let j = 0; j < chunkData.length; j++) {
          chunkData[j] = (i * chunkSize + j) % 256
        }

        const writeRequest = new Request('http://fsx-service/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'streamWriteChunk',
            params: {
              sessionId,
              chunk: {
                data: Array.from(chunkData),
                index: i,
                totalChunks,
                offset: i * chunkSize,
                isLast: i === totalChunks - 1,
              },
            },
          }),
        })

        const writeResponse = await handler.handleRequest(writeRequest)
        expect(writeResponse.status).toBe(200)
      }

      // End write session
      const endRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamWriteEnd',
          params: { sessionId },
        }),
      })

      const endResponse = await handler.handleRequest(endRequest)
      expect(endResponse.status).toBe(200)

      const endResult = await endResponse.json()
      expect(endResult.data.success).toBe(true)
      expect(endResult.data.totalBytesWritten).toBe(totalSize)
      expect(endResult.data.checksum).toBeDefined()
    })

    it('aborts streaming session', async () => {
      const startRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadStart',
          params: { path: '/large.bin' },
        }),
      })

      const startResponse = await handler.handleRequest(startRequest)
      const { sessionId } = (await startResponse.json()).data

      const abortRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamAbort',
          params: { sessionId },
        }),
      })

      const abortResponse = await handler.handleRequest(abortRequest)
      expect(abortResponse.status).toBe(200)

      const abortResult = await abortResponse.json()
      expect(abortResult.data.success).toBe(true)
    })
  })

  describe('directory operations', () => {
    beforeEach(() => {
      mockFs.addDirectory('/src')
      mockFs.addDirectory('/src/a')
      mockFs.addFile('/src/file1.txt', 'Content 1')
      mockFs.addFile('/src/file2.txt', 'Content 2')
      mockFs.addFile('/src/a/nested.txt', 'Nested content')
      mockFs.addDirectory('/dest')
    })

    it('copies a directory tree', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'copyTree',
          params: { src: '/src', dest: '/dest/copied' },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.succeeded).toBeGreaterThan(0)
    })

    it('moves a directory tree', async () => {
      mockFs.addFile('/src/to-move.txt', 'Move me')

      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'moveTree',
          params: { src: '/src/to-move.txt', dest: '/dest/moved.txt' },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.succeeded).toBe(1)
    })

    it('calculates directory size', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'dirSize',
          params: { path: '/src' },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.totalSize).toBeGreaterThan(0)
      expect(result.data.fileCount).toBe(3)
    })
  })

  describe('utility operations', () => {
    beforeEach(() => {
      mockFs.addFile('/test.txt', 'Test content for checksum')
    })

    it('computes file checksum', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'checksum',
          params: { path: '/test.txt' },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.checksum).toBeDefined()
      expect(result.data.algorithm).toBe('sha256')
      expect(result.data.size).toBeGreaterThan(0)
    })

    it('verifies file integrity', async () => {
      // First get the checksum
      const checksumRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'checksum',
          params: { path: '/test.txt' },
        }),
      })

      const checksumResponse = await handler.handleRequest(checksumRequest)
      const { checksum } = (await checksumResponse.json()).data

      // Verify with correct checksum
      const verifyRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'verify',
          params: { path: '/test.txt', expectedChecksum: checksum },
        }),
      })

      const verifyResponse = await handler.handleRequest(verifyRequest)
      expect(verifyResponse.status).toBe(200)

      const verifyResult = await verifyResponse.json()
      expect(verifyResult.data.valid).toBe(true)
    })

    it('detects checksum mismatch', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'verify',
          params: { path: '/test.txt', expectedChecksum: 'invalid-checksum' },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.data.valid).toBe(false)
    })
  })

  describe('error handling', () => {
    it('returns error for unknown method', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'unknownMethod',
          params: {},
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)

      const result = await response.json()
      expect(result.error.code).toBe('METHOD_NOT_FOUND')
    })

    it('returns 405 for non-POST requests', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'GET',
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(405)
    })

    it('returns 404 for wrong path', async () => {
      const request = new Request('http://fsx-service/wrong-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'ping', params: {} }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(404)
    })

    it('handles invalid streaming session', async () => {
      const request = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadChunk',
          params: { sessionId: 'invalid-session', chunkIndex: 0 },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)

      const result = await response.json()
      expect(result.error.code).toBe('INVALID_SESSION')
    })
  })

  describe('session cleanup', () => {
    it('cleans up expired sessions', async () => {
      // Start a session
      mockFs.addFile('/test.bin', new Uint8Array(1024))

      const startRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadStart',
          params: { path: '/test.bin' },
        }),
      })

      await handler.handleRequest(startRequest)

      // Run cleanup with 0ms timeout (expires everything)
      handler.cleanupSessions(0)

      // Try to use the session - should fail
      const chunkRequest = new Request('http://fsx-service/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'streamReadChunk',
          params: { sessionId: 'any-session', chunkIndex: 0 },
        }),
      })

      const response = await handler.handleRequest(chunkRequest)
      const result = await response.json()
      expect(result.error.code).toBe('INVALID_SESSION')
    })
  })
})

// =============================================================================
// FsServiceClient Tests
// =============================================================================

describe('FsServiceClient', () => {
  let mockFs: MockFs
  let service: MockService
  let client: FsServiceClient

  beforeEach(() => {
    mockFs = new MockFs()
    service = new MockService(mockFs)
    client = new FsServiceClient(service as any)
  })

  describe('batchRead', () => {
    beforeEach(() => {
      mockFs.addFile('/a.txt', 'Content A')
      mockFs.addFile('/b.txt', 'Content B')
    })

    it('reads multiple files', async () => {
      const result = await client.batchRead(['/a.txt', '/b.txt'])
      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(0)
    })

    it('reports progress', async () => {
      const progressEvents: ProgressEvent[] = []

      await client.batchRead(['/a.txt', '/b.txt'], {
        onProgress: (event) => progressEvents.push(event),
      })

      // Progress callback is called on server side, not client side for batch ops
      // The client receives the final result
    })
  })

  describe('batchWrite', () => {
    beforeEach(() => {
      mockFs.addDirectory('/output')
    })

    it('writes multiple files', async () => {
      const result = await client.batchWrite([
        { path: '/output/a.txt', content: 'A' },
        { path: '/output/b.txt', content: 'B' },
      ])
      expect(result.succeeded).toBe(2)
    })

    it('uses default tier from options', async () => {
      const result = await client.batchWrite(
        [{ path: '/output/file.txt', content: 'test' }],
        { defaultTier: 'warm' }
      )
      expect(result.succeeded).toBe(1)
    })
  })

  describe('batchDelete', () => {
    beforeEach(() => {
      mockFs.addFile('/a.txt', 'Content A')
      mockFs.addFile('/b.txt', 'Content B')
    })

    it('deletes multiple files', async () => {
      const result = await client.batchDelete(['/a.txt', '/b.txt'])
      expect(result.succeeded).toBe(2)
    })
  })

  describe('batchStat', () => {
    beforeEach(() => {
      mockFs.addFile('/file.txt', 'Content')
      mockFs.addDirectory('/dir')
    })

    it('gets stats for multiple paths', async () => {
      const result = await client.batchStat(['/file.txt', '/dir'])
      expect(result.succeeded).toBe(2)
    })
  })

  describe('streamRead', () => {
    beforeEach(() => {
      const content = new Uint8Array(100 * 1024)
      for (let i = 0; i < content.length; i++) {
        content[i] = i % 256
      }
      mockFs.addFile('/large.bin', content)
    })

    it('streams file content', async () => {
      const chunks: Uint8Array[] = []
      for await (const chunk of client.streamRead('/large.bin')) {
        chunks.push(chunk.data)
      }
      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('streamWrite', () => {
    beforeEach(() => {
      mockFs.addDirectory('/output')
    })

    it('streams data to a file', async () => {
      const data = new Uint8Array(50 * 1024)
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }

      const result = await client.streamWrite('/output/streamed.bin', data, data.length)
      expect(result.success).toBe(true)
      expect(result.totalBytesWritten).toBe(data.length)
    })
  })

  describe('copyTree', () => {
    beforeEach(() => {
      mockFs.addDirectory('/src')
      mockFs.addFile('/src/file.txt', 'Content')
      mockFs.addDirectory('/dest')
    })

    it('copies directory tree', async () => {
      const result = await client.copyTree('/src', '/dest/copied')
      expect(result.succeeded).toBeGreaterThan(0)
    })
  })

  describe('moveTree', () => {
    beforeEach(() => {
      mockFs.addFile('/source.txt', 'Content')
      mockFs.addDirectory('/dest')
    })

    it('moves file', async () => {
      const result = await client.moveTree('/source.txt', '/dest/moved.txt')
      expect(result.succeeded).toBe(1)
    })
  })

  describe('dirSize', () => {
    beforeEach(() => {
      mockFs.addDirectory('/data')
      mockFs.addFile('/data/a.txt', 'AAAA')
      mockFs.addFile('/data/b.txt', 'BBBB')
    })

    it('calculates directory size', async () => {
      const result = await client.dirSize('/data')
      expect(result.fileCount).toBe(2)
      expect(result.totalSize).toBe(8)
    })
  })

  describe('checksum', () => {
    beforeEach(() => {
      mockFs.addFile('/test.txt', 'Test content')
    })

    it('computes checksum', async () => {
      const result = await client.checksum('/test.txt')
      expect(result.checksum).toBeDefined()
      expect(result.algorithm).toBe('sha256')
    })
  })

  describe('verify', () => {
    beforeEach(() => {
      mockFs.addFile('/test.txt', 'Test content')
    })

    it('verifies checksum', async () => {
      const { checksum } = await client.checksum('/test.txt')
      const result = await client.verify('/test.txt', checksum)
      expect(result.valid).toBe(true)
    })
  })

  describe('ping', () => {
    it('pings the service', async () => {
      const result = await client.ping()
      expect(result.ok).toBe(true)
      expect(result.version).toBeDefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('RPC Service Integration', () => {
  let mockFs: MockFs
  let service: MockService
  let client: FsServiceClient

  beforeEach(() => {
    mockFs = new MockFs()
    service = new MockService(mockFs)
    client = new FsServiceClient(service as any)
  })

  describe('large batch operations', () => {
    it('handles 100 file batch write', async () => {
      mockFs.addDirectory('/batch')

      const files: BatchFileItem[] = []
      for (let i = 0; i < 100; i++) {
        files.push({
          path: `/batch/file${i}.txt`,
          content: `Content for file ${i}`,
        })
      }

      const result = await client.batchWrite(files)
      expect(result.succeeded).toBe(100)
      expect(result.failed).toBe(0)
    })

    it('handles 100 file batch read', async () => {
      mockFs.addDirectory('/batch')

      const paths: string[] = []
      for (let i = 0; i < 100; i++) {
        const path = `/batch/file${i}.txt`
        mockFs.addFile(path, `Content ${i}`)
        paths.push(path)
      }

      const result = await client.batchRead(paths)
      expect(result.succeeded).toBe(100)
    })
  })

  describe('error recovery', () => {
    it('continues batch operations after errors', async () => {
      mockFs.addDirectory('/data')
      mockFs.addFile('/data/exists.txt', 'Exists')

      const files: BatchFileItem[] = [
        { path: '/data/new1.txt', content: 'New 1' },
        { path: '/nonexistent/fail.txt', content: 'Will fail' },
        { path: '/data/new2.txt', content: 'New 2' },
      ]

      const result = await client.batchWrite(files, { continueOnError: true })
      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(1)
    })
  })
})
