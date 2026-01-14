/**
 * FSx Decoupling Tests
 *
 * These tests verify that the core FSx class is decoupled from
 * Cloudflare Durable Object types and accepts only the FsBackend interface.
 *
 * The core package (@dotdo/fsx) should have ZERO Cloudflare-specific types
 * in its public API, enabling use in Node.js, browsers, and other runtimes.
 *
 * @see fsx-ji8t - RED: FSx decoupling from DO types tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FSx, FsBackend, MemoryBackend } from '../../core/index.js'

// =============================================================================
// Test 1: FSx constructor accepts FsBackend interface
// =============================================================================

describe('FSx constructor accepts FsBackend interface', () => {
  it('should accept MemoryBackend as constructor argument', () => {
    const backend = new MemoryBackend()

    // This should work: FSx accepts FsBackend
    // FAILING: Currently FSx expects DurableObjectNamespace | DurableObjectStub
    const fsx = new FSx(backend)

    expect(fsx).toBeInstanceOf(FSx)
  })

  it('should accept any object implementing FsBackend interface', () => {
    // Create a minimal FsBackend implementation
    const customBackend: FsBackend = {
      readFile: async () => new Uint8Array(),
      writeFile: async () => ({ bytesWritten: 0, tier: 'hot' as const }),
      unlink: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      mkdir: async () => {},
      rmdir: async () => {},
      readdir: async () => [],
      stat: async () => {
        const { Stats } = await import('../../core/types.js')
        return new Stats({
          dev: 0,
          ino: 0,
          mode: 0o644,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: 0,
          blksize: 4096,
          blocks: 0,
          atimeMs: Date.now(),
          mtimeMs: Date.now(),
          ctimeMs: Date.now(),
          birthtimeMs: Date.now(),
        })
      },
      lstat: async () => {
        const { Stats } = await import('../../core/types.js')
        return new Stats({
          dev: 0,
          ino: 0,
          mode: 0o644,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: 0,
          blksize: 4096,
          blocks: 0,
          atimeMs: Date.now(),
          mtimeMs: Date.now(),
          ctimeMs: Date.now(),
          birthtimeMs: Date.now(),
        })
      },
      exists: async () => false,
      chmod: async () => {},
      chown: async () => {},
      utimes: async () => {},
      symlink: async () => {},
      link: async () => {},
      readlink: async () => '',
    }

    // FAILING: Currently FSx expects DurableObjectNamespace | DurableObjectStub
    const fsx = new FSx(customBackend)

    expect(fsx).toBeInstanceOf(FSx)
  })
})

// =============================================================================
// Test 2: FSx does NOT depend on DurableObjectStub types
// =============================================================================

describe('FSx does NOT depend on DurableObjectStub types', () => {
  it('should NOT have stub property exposed', () => {
    const backend = new MemoryBackend()
    const fsx = new FSx(backend) as unknown as Record<string, unknown>

    // The FSx class should not expose any 'stub' property
    // FAILING: Currently FSx has a private 'stub: DurableObjectStub' field
    expect(fsx).not.toHaveProperty('stub')
  })

  it('should work without any Durable Object bindings', async () => {
    const backend = new MemoryBackend()
    const fsx = new FSx(backend)

    // Basic operations should work with just a backend
    // FAILING: Currently FSx.writeFile calls this.stub.fetch()
    await fsx.writeFile('/test.txt', 'Hello, World!')
    const content = await fsx.readFile('/test.txt')

    expect(content).toBe('Hello, World!')
  })

  it('should NOT call fetch() on the backend', async () => {
    let fetchCalled = false

    // Create a backend that tracks if fetch is called
    const backend = new MemoryBackend()

    // Monkey-patch to detect if FSx tries to treat backend as a stub
    ;(backend as unknown as Record<string, unknown>).fetch = () => {
      fetchCalled = true
      return Promise.resolve(new Response('{}'))
    }

    const fsx = new FSx(backend)

    // This should NOT call fetch - it should call backend methods directly
    // FAILING: Currently FSx calls this.stub.fetch() for all operations
    try {
      await fsx.exists('/test')
    } catch {
      // Expected to fail currently
    }

    expect(fetchCalled).toBe(false)
  })
})

// =============================================================================
// Test 3: Core package has zero Cloudflare-specific types in public API
// =============================================================================

describe('Core package has zero Cloudflare-specific types in public API', () => {
  it('should not export DurableObjectStub type', async () => {
    const coreExports = await import('../../core/index.js')

    // Check that no Cloudflare-specific types are exported
    expect(coreExports).not.toHaveProperty('DurableObjectStub')
    expect(coreExports).not.toHaveProperty('DurableObjectNamespace')
    expect(coreExports).not.toHaveProperty('DurableObjectId')
  })

  it('should not have DurableObject types in FSxOptions', () => {
    // FSxOptions should not reference any Cloudflare types
    // This is a compile-time check - if it compiles, it passes
    const options: import('../../core/index.js').FSxOptions = {
      defaultMode: 0o644,
      defaultDirMode: 0o755,
    }

    expect(options).toBeDefined()
  })

  it('FSx constructor type should accept FsBackend, not DurableObjectStub', () => {
    // This test verifies the constructor signature at runtime
    // FAILING: Currently the constructor signature is:
    //   constructor(binding: DurableObjectNamespace | DurableObjectStub, options?: FSxOptions)
    // It should be:
    //   constructor(backend: FsBackend, options?: FSxOptions)

    const backend = new MemoryBackend()

    // If this compiles and runs, the type is correct
    // Currently FAILING because FSx doesn't accept FsBackend
    const fsx = new FSx(backend)

    // Verify FSx was constructed successfully
    expect(fsx).toBeInstanceOf(FSx)
    expect(typeof fsx.readFile).toBe('function')
    expect(typeof fsx.writeFile).toBe('function')
  })
})

// =============================================================================
// Test 4: MemoryBackend satisfies FsBackend interface
// =============================================================================

describe('MemoryBackend satisfies FsBackend interface', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = new MemoryBackend()
  })

  it('should implement all required FsBackend methods', () => {
    // Verify all required methods exist
    expect(typeof backend.readFile).toBe('function')
    expect(typeof backend.writeFile).toBe('function')
    expect(typeof backend.unlink).toBe('function')
    expect(typeof backend.rename).toBe('function')
    expect(typeof backend.copyFile).toBe('function')
    expect(typeof backend.mkdir).toBe('function')
    expect(typeof backend.rmdir).toBe('function')
    expect(typeof backend.readdir).toBe('function')
    expect(typeof backend.stat).toBe('function')
    expect(typeof backend.lstat).toBe('function')
    expect(typeof backend.exists).toBe('function')
    expect(typeof backend.chmod).toBe('function')
    expect(typeof backend.chown).toBe('function')
    expect(typeof backend.utimes).toBe('function')
    expect(typeof backend.symlink).toBe('function')
    expect(typeof backend.link).toBe('function')
    expect(typeof backend.readlink).toBe('function')
  })

  it('should implement optional tiering methods', () => {
    // Optional methods for tiered storage
    expect(typeof backend.getTier).toBe('function')
    expect(typeof backend.promote).toBe('function')
    expect(typeof backend.demote).toBe('function')
  })

  it('should be assignable to FsBackend type', () => {
    // TypeScript compile-time check: MemoryBackend should satisfy FsBackend
    const fsBackend: FsBackend = backend

    expect(fsBackend).toBe(backend)
  })

  it('should work with FSx when FSx accepts FsBackend', async () => {
    // This test will PASS only when FSx is refactored to accept FsBackend
    // FAILING: Currently FSx expects DurableObjectStub

    const fsx = new FSx(backend)

    // Create a directory
    await fsx.mkdir('/data', { recursive: true })

    // Write a file
    await fsx.writeFile('/data/test.txt', 'Test content')

    // Read it back
    const content = await fsx.readFile('/data/test.txt')
    expect(content).toBe('Test content')

    // Check it exists
    const exists = await fsx.exists('/data/test.txt')
    expect(exists).toBe(true)

    // Get stats
    const stats = await fsx.stat('/data/test.txt')
    expect(stats.isFile()).toBe(true)
    expect(stats.size).toBe(12) // 'Test content'.length
  })
})

// =============================================================================
// Test 5: Integration - Full workflow with FsBackend
// =============================================================================

describe('Integration: Full workflow with FsBackend', () => {
  it('should support complete file operations workflow', async () => {
    const backend = new MemoryBackend()

    // FAILING: FSx doesn't accept FsBackend yet
    const fsx = new FSx(backend)

    // Create directory structure
    await fsx.mkdir('/project/src', { recursive: true })
    await fsx.mkdir('/project/tests', { recursive: true })

    // Write multiple files
    await fsx.writeFile('/project/src/index.ts', 'export const hello = "world"')
    await fsx.writeFile('/project/src/utils.ts', 'export function add(a: number, b: number) { return a + b }')
    await fsx.writeFile('/project/tests/index.test.ts', 'import { hello } from "../src"')

    // Read directory
    const srcFiles = await fsx.readdir('/project/src')
    expect(srcFiles).toContain('index.ts')
    expect(srcFiles).toContain('utils.ts')

    // Rename file
    await fsx.rename('/project/src/utils.ts', '/project/src/helpers.ts')

    // Verify rename
    const updatedSrcFiles = await fsx.readdir('/project/src')
    expect(updatedSrcFiles).toContain('helpers.ts')
    expect(updatedSrcFiles).not.toContain('utils.ts')

    // Copy file
    await fsx.copyFile('/project/src/index.ts', '/project/src/index.backup.ts')

    // Delete original
    await fsx.unlink('/project/src/index.ts')

    // Restore from backup
    await fsx.rename('/project/src/index.backup.ts', '/project/src/index.ts')

    // Final verification
    const finalContent = await fsx.readFile('/project/src/index.ts')
    expect(finalContent).toBe('export const hello = "world"')
  })
})
