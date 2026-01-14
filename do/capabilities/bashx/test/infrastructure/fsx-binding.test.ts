/**
 * FSX Service Binding Tests
 *
 * These tests verify that FSX service binding works correctly in the vitest
 * environment using the mock FSX service.
 *
 * The FSX binding (env.FSX) provides filesystem operations via the fsx.do
 * service. In production, this is configured in wrangler.toml as:
 *
 *   [[services]]
 *   binding = "FSX"
 *   service = "fsx-do"
 *
 * For tests, we use the mock FSX service from ./mock-fsx.ts which provides
 * an in-memory filesystem implementation.
 *
 * @see src/do/worker.ts - FsxServiceAdapter that uses the FSX binding
 * @see wrangler.toml - FSX service binding configuration
 * @see ./mock-fsx.ts - Mock FSX implementation and test utilities
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FsCapability, Stats, Dirent } from 'fsx.do'
import {
  setupMockFSX,
  cleanupMockFSX,
  createMockFSX,
  createTestFsAdapter,
  type MockFetcher,
  type TestFsAdapter,
} from './mock-fsx.js'

// ============================================================================
// TEST SETUP
// ============================================================================

// Setup mock FSX service before all tests
beforeAll(() => {
  setupMockFSX()
})

// Cleanup after all tests
afterAll(() => {
  cleanupMockFSX()
})

// ============================================================================
// TEST ENVIRONMENT HELPER
// ============================================================================

/**
 * Expected environment interface for bashx-do workers.
 * This matches the Env type defined in src/do/worker.ts
 */
interface TestEnv {
  /** Service binding to fsx-do for filesystem operations */
  FSX: MockFetcher
}

/**
 * Get the test environment.
 * In vitest-pool-workers, env is available via import.meta.env or globalThis.env
 */
function getTestEnv(): TestEnv {
  // vitest-pool-workers should inject env into the global context
  // This will fail if FSX binding is not configured
  const env = (globalThis as unknown as { env?: TestEnv }).env
  if (!env) {
    throw new Error(
      'Test environment not available. ' +
      'FSX service binding requires vitest-pool-workers configuration. ' +
      'See wrangler.toml for service binding setup.'
    )
  }
  if (!env.FSX) {
    throw new Error(
      'FSX service binding not available in test environment. ' +
      'Configure FSX binding in vitest poolOptions.workers.wrangler. ' +
      'Expected env.FSX to be a Fetcher instance.'
    )
  }
  return env
}

// ============================================================================
// FSX SERVICE BINDING TESTS
// ============================================================================

describe('FSX Service Binding', () => {
  describe('Binding Availability', () => {
    it('should have FSX binding available in test environment', () => {
      const env = getTestEnv()

      expect(env.FSX).toBeDefined()
      expect(typeof env.FSX.fetch).toBe('function')
    })

    it('should be able to make RPC calls to FSX service', async () => {
      const env = getTestEnv()

      const response = await env.FSX.fetch('https://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'stat',
          params: { path: '/' },
        }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(result).toBeDefined()
    })
  })

  describe('Test Adapter Integration', () => {
    let fs: TestFsAdapter

    beforeAll(() => {
      // Create a fresh mock FSX and test adapter for this describe block
      const mockFSX = createMockFSX()
      fs = createTestFsAdapter(mockFSX)
    })

    describe('File Operations', () => {
      it('should read a file', async () => {
        const content = await fs.read('/test.txt', { encoding: 'utf-8' })
        expect(content).toBe('test content')
      })

      it('should write a file', async () => {
        await fs.write('/new-file.txt', 'hello world')
        const content = await fs.read('/new-file.txt', { encoding: 'utf-8' })
        expect(content).toBe('hello world')
      })

      it('should check if file exists', async () => {
        const exists = await fs.exists('/test.txt')
        expect(exists).toBe(true)
      })

      it('should return false for non-existent file', async () => {
        const exists = await fs.exists('/does-not-exist.txt')
        expect(exists).toBe(false)
      })

      it('should get file stats', async () => {
        const stats = await fs.stat('/test.txt')
        expect(stats.size).toBeGreaterThanOrEqual(0)
        expect(stats.mtime).toBeInstanceOf(Date)
        expect(typeof stats.isFile).toBe('function')
        expect(typeof stats.isDirectory).toBe('function')
        expect(stats.isFile()).toBe(true)
        expect(stats.isDirectory()).toBe(false)
      })

      it('should delete a file', async () => {
        await fs.write('/to-delete.txt', 'temp')
        await fs.unlink('/to-delete.txt')
        const exists = await fs.exists('/to-delete.txt')
        expect(exists).toBe(false)
      })
    })

    describe('Directory Operations', () => {
      it('should list directory contents', async () => {
        const entries = await fs.list('/')
        expect(Array.isArray(entries)).toBe(true)
      })

      it('should list directory with file types', async () => {
        const entries = await fs.list('/', { withFileTypes: true })
        expect(Array.isArray(entries)).toBe(true)
        if (entries.length > 0) {
          const entry = entries[0] as { name: string; isDirectory(): boolean }
          expect(typeof entry.name).toBe('string')
          expect(typeof entry.isDirectory).toBe('function')
        }
      })

      it('should create a directory', async () => {
        await fs.mkdir('/test-dir')
        const stats = await fs.stat('/test-dir')
        expect(stats.isDirectory()).toBe(true)
      })

      it('should create nested directories recursively', async () => {
        await fs.mkdir('/nested/deep/path', { recursive: true })
        const stats = await fs.stat('/nested/deep/path')
        expect(stats.isDirectory()).toBe(true)
      })

      it('should remove a directory', async () => {
        await fs.mkdir('/to-remove')
        await fs.rmdir('/to-remove')
        const exists = await fs.exists('/to-remove')
        expect(exists).toBe(false)
      })

      it('should remove directory recursively', async () => {
        await fs.mkdir('/parent/child', { recursive: true })
        await fs.write('/parent/child/file.txt', 'content')
        await fs.rmdir('/parent', { recursive: true })
        const exists = await fs.exists('/parent')
        expect(exists).toBe(false)
      })
    })
  })

  describe('Error Handling', () => {
    let fs: TestFsAdapter

    beforeAll(() => {
      // Create a fresh mock FSX for error handling tests
      const mockFSX = createMockFSX()
      fs = createTestFsAdapter(mockFSX)
    })

    it('should throw ENOENT for non-existent file read', async () => {
      await expect(fs.read('/does-not-exist.txt')).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })

    it('should throw ENOENT for non-existent file stat', async () => {
      await expect(fs.stat('/does-not-exist.txt')).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })

    it('should throw EEXIST when creating existing directory without recursive', async () => {
      // First create
      await fs.mkdir('/exists-dir')
      // Second create should fail
      await expect(fs.mkdir('/exists-dir')).rejects.toMatchObject({
        code: 'EEXIST',
      })
    })

    it('should throw ENOTDIR when listing a file', async () => {
      await fs.write('/file.txt', 'content')
      await expect(fs.list('/file.txt')).rejects.toMatchObject({
        code: 'ENOTDIR',
      })
    })

    it('should throw EISDIR when reading a directory', async () => {
      await fs.mkdir('/a-dir')
      await expect(fs.read('/a-dir')).rejects.toMatchObject({
        code: 'EISDIR',
      })
    })
  })
})

// ============================================================================
// TYPE TESTS (compile-time verification)
// ============================================================================

describe('Type Definitions', () => {
  it('should have correct FsCapability interface shape', () => {
    // Compile-time verification that FsCapability has expected methods
    type RequiredMethods = keyof FsCapability

    // These are core methods that must exist
    const expectedMethods: RequiredMethods[] = [
      'read',
      'write',
      'exists',
      'stat',
      'list',
      'mkdir',
      'rmdir',
      'unlink',
    ]

    expect(expectedMethods.length).toBeGreaterThan(0)
  })

  it('should have Stats class with POSIX-like methods', () => {
    // Verify Stats has the expected method signatures
    type StatsMethods = keyof Stats

    const expectedMethods: StatsMethods[] = [
      'isFile',
      'isDirectory',
      'isSymbolicLink',
    ]

    expect(expectedMethods.length).toBeGreaterThan(0)
  })

  it('should have Dirent class with type-checking methods', () => {
    // Verify Dirent has the expected method signatures
    type DirentMethods = keyof Dirent

    const expectedMethods: DirentMethods[] = [
      'name',
      'isFile',
      'isDirectory',
    ]

    expect(expectedMethods.length).toBeGreaterThan(0)
  })
})
