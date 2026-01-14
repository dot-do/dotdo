/**
 * Backend Integration Tests for fsx utilities
 *
 * These tests verify that glob, grep, and find utilities properly use
 * the FsBackend interface instead of hardcoded mock filesystems.
 *
 * TDD RED Phase: These tests should FAIL until the utilities are
 * refactored to accept and use FsBackend implementations.
 *
 * @module test/utilities/backend-integration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { glob } from '../../core/glob/glob'
import { grep } from '../../core/grep/grep'
import { find } from '../../core/find/find'
import { MemoryBackend, type FsBackend } from '../../core/backend'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * SpyBackend - A custom FsBackend that tracks all method calls.
 * Used to verify that utilities actually call backend methods.
 */
class SpyBackend extends MemoryBackend {
  public calls: Array<{ method: string; args: unknown[] }> = []

  private track(method: string, args: unknown[]): void {
    this.calls.push({ method, args: [...args] })
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.track('readFile', [path])
    return super.readFile(path)
  }

  async readdir(path: string, options?: Parameters<FsBackend['readdir']>[1]): Promise<string[] | Awaited<ReturnType<FsBackend['readdir']>>> {
    this.track('readdir', [path, options])
    return super.readdir(path, options)
  }

  async stat(path: string): Promise<Awaited<ReturnType<FsBackend['stat']>>> {
    this.track('stat', [path])
    return super.stat(path)
  }

  async exists(path: string): Promise<boolean> {
    this.track('exists', [path])
    return super.exists(path)
  }

  getCallsTo(method: string): Array<{ method: string; args: unknown[] }> {
    return this.calls.filter(c => c.method === method)
  }

  reset(): void {
    this.calls = []
  }
}

/**
 * Helper to set up a test filesystem structure in a MemoryBackend
 */
async function setupTestFilesystem(backend: MemoryBackend): Promise<void> {
  const encoder = new TextEncoder()

  // Create directory structure
  await backend.mkdir('/src', { recursive: true })
  await backend.mkdir('/src/utils', { recursive: true })
  await backend.mkdir('/src/components', { recursive: true })
  await backend.mkdir('/lib', { recursive: true })
  await backend.mkdir('/test', { recursive: true })
  await backend.mkdir('/docs', { recursive: true })

  // Create files with content
  await backend.writeFile('/src/index.ts', encoder.encode('export const main = () => "hello"'))
  await backend.writeFile('/src/utils/helpers.ts', encoder.encode('// TODO: refactor\nexport function helper() { return "help" }'))
  await backend.writeFile('/src/utils/format.ts', encoder.encode('export function format(s: string) { return s.trim() }'))
  await backend.writeFile('/src/components/Button.tsx', encoder.encode('import React from "react"\nexport function Button() { return <button>Click</button> }'))
  await backend.writeFile('/src/components/Modal.tsx', encoder.encode('// TODO: add animations\nexport function Modal() { return <div>Modal</div> }'))
  await backend.writeFile('/lib/index.js', encoder.encode('module.exports = { foo: "bar" }'))
  await backend.writeFile('/lib/utils.js', encoder.encode('function util() { return "util" }'))
  await backend.writeFile('/test/index.test.ts', encoder.encode('import { describe, it } from "vitest"'))
  await backend.writeFile('/test/helpers.test.ts', encoder.encode('import { helper } from "../src/utils/helpers"'))
  await backend.writeFile('/docs/README.md', encoder.encode('# Documentation\n\nThis is the README.'))
  await backend.writeFile('/package.json', encoder.encode('{ "name": "test-project" }'))
  await backend.writeFile('/.gitignore', encoder.encode('node_modules\n.env'))
}

// =============================================================================
// glob() Backend Integration Tests
// =============================================================================

describe('glob() backend integration', () => {
  let backend: SpyBackend

  beforeEach(async () => {
    backend = new SpyBackend()
    await setupTestFilesystem(backend)
    backend.reset() // Clear setup calls
  })

  describe('uses FsBackend.readdir for directory traversal', () => {
    it('should call backend.readdir when traversing directories', async () => {
      // This test verifies glob() uses the backend instead of mock FS
      // It will FAIL until glob() is refactored to accept a backend parameter

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await glob('**/*.ts', { cwd: '/src', backend })

      // Verify the backend was actually used
      const readdirCalls = backend.getCallsTo('readdir')
      expect(readdirCalls.length).toBeGreaterThan(0)
      expect(readdirCalls.some(c => c.args[0] === '/src')).toBe(true)
    })

    it('should find files that exist only in the provided backend', async () => {
      // Add a file that wouldn't exist in the hardcoded mock
      const encoder = new TextEncoder()
      await backend.writeFile('/src/custom-file.ts', encoder.encode('// custom'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await glob('*.ts', { cwd: '/src', backend })

      // This should include our custom file
      expect(result).toContain('custom-file.ts')
      expect(result).toContain('index.ts')
    })

    it('should NOT find files from hardcoded mock when using custom backend', async () => {
      // Create an empty backend
      const emptyBackend = new SpyBackend()
      await emptyBackend.mkdir('/src')

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await glob('**/*.ts', { cwd: '/src', backend: emptyBackend })

      // Should return empty since our backend has no files
      expect(result).toEqual([])
    })
  })

  describe('uses FsBackend.stat for file type detection', () => {
    it('should call backend.stat to determine file types', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      await glob('*', { cwd: '/src', onlyFiles: true, backend })

      // stat should be called to determine if entries are files or directories
      const statCalls = backend.getCallsTo('stat')
      expect(statCalls.length).toBeGreaterThan(0)
    })

    it('should correctly distinguish files from directories using backend', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      const filesOnly = await glob('*', { cwd: '/src', onlyFiles: true, backend })

      // @ts-expect-error - backend parameter doesn't exist yet
      const dirsOnly = await glob('*', { cwd: '/src', onlyDirectories: true, backend })

      expect(filesOnly).toContain('index.ts')
      expect(filesOnly).not.toContain('utils')

      expect(dirsOnly).toContain('utils')
      expect(dirsOnly).toContain('components')
      expect(dirsOnly).not.toContain('index.ts')
    })
  })
})

// =============================================================================
// grep() Backend Integration Tests
// =============================================================================

describe('grep() backend integration', () => {
  let backend: SpyBackend

  beforeEach(async () => {
    backend = new SpyBackend()
    await setupTestFilesystem(backend)
    backend.reset()
  })

  describe('uses FsBackend.readFile for content search', () => {
    it('should call backend.readFile when searching file contents', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await grep({ pattern: 'TODO', path: '/src', recursive: true, backend })

      const readFileCalls = backend.getCallsTo('readFile')
      expect(readFileCalls.length).toBeGreaterThan(0)
    })

    it('should find content that exists only in the provided backend', async () => {
      // Add a file with unique content
      const encoder = new TextEncoder()
      await backend.writeFile('/src/unique.ts', encoder.encode('UNIQUE_MARKER_12345'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await grep({ pattern: 'UNIQUE_MARKER_12345', path: '/src', recursive: true, backend })

      expect(result.matchCount).toBe(1)
      expect(result.matches[0].file).toBe('/src/unique.ts')
    })

    it('should NOT find content from hardcoded mock when using custom backend', async () => {
      // Create a backend with no TODO comments
      const cleanBackend = new SpyBackend()
      await cleanBackend.mkdir('/src')
      const encoder = new TextEncoder()
      await cleanBackend.writeFile('/src/clean.ts', encoder.encode('// No todos here'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await grep({ pattern: 'TODO', path: '/src', recursive: true, backend: cleanBackend })

      // Should find nothing since our backend has no TODOs
      expect(result.matchCount).toBe(0)
    })
  })

  describe('uses FsBackend.readdir for file discovery', () => {
    it('should call backend.readdir when recursively searching', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      await grep({ pattern: 'export', path: '/src', recursive: true, backend })

      const readdirCalls = backend.getCallsTo('readdir')
      expect(readdirCalls.length).toBeGreaterThan(0)
    })

    it('should search only files from the provided backend', async () => {
      // Create a minimal backend with one file
      const minimalBackend = new SpyBackend()
      await minimalBackend.mkdir('/src')
      const encoder = new TextEncoder()
      await minimalBackend.writeFile('/src/only-file.ts', encoder.encode('searchable content here'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await grep({ pattern: 'searchable', path: '/src', recursive: true, backend: minimalBackend })

      expect(result.fileCount).toBe(1)
      expect(result.matches[0].file).toBe('/src/only-file.ts')
    })
  })
})

// =============================================================================
// find() Backend Integration Tests
// =============================================================================

describe('find() backend integration', () => {
  let backend: SpyBackend

  beforeEach(async () => {
    backend = new SpyBackend()
    await setupTestFilesystem(backend)
    backend.reset()
  })

  describe('uses FsBackend.readdir for directory traversal', () => {
    it('should call backend.readdir when traversing filesystem', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await find({ path: '/src', backend })

      const readdirCalls = backend.getCallsTo('readdir')
      expect(readdirCalls.length).toBeGreaterThan(0)
    })

    it('should find entries that exist only in the provided backend', async () => {
      // Add a unique file
      const encoder = new TextEncoder()
      await backend.writeFile('/src/unique-find-test.ts', encoder.encode('content'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await find({ path: '/src', name: 'unique-find-test.ts', backend })

      expect(result.length).toBe(1)
      expect(result[0].path).toBe('/src/unique-find-test.ts')
    })

    it('should NOT find entries from hardcoded mock when using custom backend', async () => {
      // Create backend with completely different structure
      const differentBackend = new SpyBackend()
      await differentBackend.mkdir('/custom')
      const encoder = new TextEncoder()
      await differentBackend.writeFile('/custom/file.txt', encoder.encode('different'))

      // @ts-expect-error - backend parameter doesn't exist yet
      const result = await find({ path: '/', name: '*.ts', backend: differentBackend })

      // Should find no .ts files since our backend has none
      expect(result).toEqual([])
    })
  })

  describe('uses FsBackend.stat for metadata', () => {
    it('should call backend.stat to get file metadata', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      await find({ path: '/src', type: 'f', backend })

      const statCalls = backend.getCallsTo('stat')
      expect(statCalls.length).toBeGreaterThan(0)
    })

    it('should use backend stats for size filtering', async () => {
      // Create files with specific sizes
      const smallBackend = new SpyBackend()
      await smallBackend.mkdir('/data')
      await smallBackend.writeFile('/data/small.txt', new Uint8Array(100))
      await smallBackend.writeFile('/data/large.txt', new Uint8Array(10000))

      // @ts-expect-error - backend parameter doesn't exist yet
      const smallFiles = await find({ path: '/data', size: '-1K', backend: smallBackend })

      // @ts-expect-error - backend parameter doesn't exist yet
      const largeFiles = await find({ path: '/data', size: '+5K', backend: smallBackend })

      expect(smallFiles.some(f => f.path === '/data/small.txt')).toBe(true)
      expect(smallFiles.some(f => f.path === '/data/large.txt')).toBe(false)

      expect(largeFiles.some(f => f.path === '/data/large.txt')).toBe(true)
      expect(largeFiles.some(f => f.path === '/data/small.txt')).toBe(false)
    })

    it('should use backend stats for type filtering', async () => {
      // @ts-expect-error - backend parameter doesn't exist yet
      const files = await find({ path: '/src', type: 'f', backend })

      // @ts-expect-error - backend parameter doesn't exist yet
      const dirs = await find({ path: '/src', type: 'd', backend })

      // Files should include .ts files
      expect(files.some(f => f.path.endsWith('.ts'))).toBe(true)
      expect(files.every(f => f.type === 'file')).toBe(true)

      // Dirs should include utils, components
      expect(dirs.some(d => d.path.includes('utils'))).toBe(true)
      expect(dirs.every(d => d.type === 'directory')).toBe(true)
    })
  })
})

// =============================================================================
// Cross-utility Backend Consistency Tests
// =============================================================================

describe('backend consistency across utilities', () => {
  it('should use the same backend for chained operations', async () => {
    const backend = new SpyBackend()
    await setupTestFilesystem(backend)

    // Add a unique marker
    const encoder = new TextEncoder()
    await backend.writeFile('/src/marker.ts', encoder.encode('CONSISTENCY_TEST_MARKER'))
    backend.reset()

    // Use find to get files, then grep their contents
    // Both should use the same backend

    // @ts-expect-error - backend parameter doesn't exist yet
    const foundFiles = await find({ path: '/src', name: '*.ts', backend })

    expect(foundFiles.some(f => f.path === '/src/marker.ts')).toBe(true)

    // @ts-expect-error - backend parameter doesn't exist yet
    const grepResult = await grep({ pattern: 'CONSISTENCY_TEST_MARKER', path: '/src', recursive: true, backend })

    expect(grepResult.matchCount).toBe(1)
  })

  it('should work with different backend implementations', async () => {
    // Test that utilities work with MemoryBackend
    const memBackend = new MemoryBackend()
    await memBackend.mkdir('/test')
    const encoder = new TextEncoder()
    await memBackend.writeFile('/test/file.ts', encoder.encode('test content'))

    // @ts-expect-error - backend parameter doesn't exist yet
    const globResult = await glob('*.ts', { cwd: '/test', backend: memBackend })

    // @ts-expect-error - backend parameter doesn't exist yet
    const findResult = await find({ path: '/test', name: '*.ts', backend: memBackend })

    // @ts-expect-error - backend parameter doesn't exist yet
    const grepResult = await grep({ pattern: 'test', path: '/test', backend: memBackend })

    expect(globResult).toContain('file.ts')
    expect(findResult.length).toBe(1)
    expect(grepResult.matchCount).toBe(1)
  })
})

// =============================================================================
// Error Handling with Custom Backend
// =============================================================================

describe('error handling with custom backend', () => {
  it('glob should propagate backend errors', async () => {
    const errorBackend = new MemoryBackend()
    // Don't create /nonexistent - it doesn't exist

    // @ts-expect-error - backend parameter doesn't exist yet
    await expect(glob('*.ts', { cwd: '/nonexistent', backend: errorBackend }))
      .rejects.toThrow(/ENOENT|no such/)
  })

  it('grep should propagate backend errors', async () => {
    const errorBackend = new MemoryBackend()

    // @ts-expect-error - backend parameter doesn't exist yet
    await expect(grep({ pattern: 'test', path: '/nonexistent', backend: errorBackend }))
      .rejects.toThrow(/ENOENT|no such/)
  })

  it('find should handle non-existent paths gracefully', async () => {
    const errorBackend = new MemoryBackend()

    // @ts-expect-error - backend parameter doesn't exist yet
    const result = await find({ path: '/nonexistent', backend: errorBackend })

    // find() typically returns empty array for non-existent paths
    expect(result).toEqual([])
  })
})
