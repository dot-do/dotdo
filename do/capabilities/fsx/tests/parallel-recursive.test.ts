/**
 * Tests for parallel recursive directory operations
 *
 * These tests verify that recursive directory operations (rmdir, rm) process
 * subdirectories concurrently using Promise.all rather than sequentially.
 *
 * Issue: fsx-viem (RED) - Tests for parallel processing
 * Issue: fsx-xvsl (GREEN) - Implement Promise.all for parallel processing
 *
 * Current implementation problem:
 * The rmdir method with recursive=true uses synchronous loops:
 *   for (const file of this.files.keys()) {
 *     if (file.startsWith(prefix)) {
 *       this.files.delete(file)
 *     }
 *   }
 *
 * This should be changed to use Promise.all for parallel processing:
 *   await Promise.all(
 *     files.map(file => this.deleteFile(file))
 *   )
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { FSx } from '../core/fsx'
import { MockBackend } from '../core/mock-backend'

/**
 * ParallelTestBackend - Extended MockBackend that tracks parallel execution
 *
 * This backend wraps file/directory deletion operations to track:
 * 1. Whether operations are executed in parallel (concurrent calls)
 * 2. The order and timing of deletions
 * 3. Maximum concurrency achieved
 */
class ParallelTestBackend extends MockBackend {
  public deletionLog: Array<{ path: string; startTime: number; endTime: number }> = []
  public maxConcurrent = 0
  private currentConcurrent = 0
  private operationDelay: number

  constructor(operationDelay = 0) {
    super()
    this.operationDelay = operationDelay
  }

  /**
   * Track concurrent operations for file deletion
   */
  async unlink(path: string): Promise<void> {
    const startTime = performance.now()
    this.currentConcurrent++
    this.maxConcurrent = Math.max(this.maxConcurrent, this.currentConcurrent)

    if (this.operationDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.operationDelay))
    }

    const result = await super.unlink(path)

    this.currentConcurrent--
    this.deletionLog.push({ path, startTime, endTime: performance.now() })
    return result
  }

  reset(): void {
    this.deletionLog = []
    this.maxConcurrent = 0
    this.currentConcurrent = 0
  }
}

describe('Parallel Recursive Directory Operations', () => {
  let backend: MockBackend
  let fsx: FSx

  beforeEach(() => {
    backend = new MockBackend()
    fsx = new FSx(backend)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rmdir recursive correctness', () => {
    it('should delete all files and subdirectories', async () => {
      // Create a directory structure with multiple subdirectories
      await backend.mkdir('/test', { recursive: true })
      await backend.mkdir('/test/a')
      await backend.mkdir('/test/b')
      await backend.mkdir('/test/c')

      // Add files to each subdirectory
      await backend.writeFile('/test/a/file1.txt', new TextEncoder().encode('content1'))
      await backend.writeFile('/test/b/file2.txt', new TextEncoder().encode('content2'))
      await backend.writeFile('/test/c/file3.txt', new TextEncoder().encode('content3'))

      // Execute recursive rmdir
      await backend.rmdir('/test', { recursive: true })

      // Verify all files and directories were deleted
      expect(await backend.exists('/test')).toBe(false)
      expect(await backend.exists('/test/a')).toBe(false)
      expect(await backend.exists('/test/b')).toBe(false)
      expect(await backend.exists('/test/c')).toBe(false)
    })

    it('should complete with 100 children', async () => {
      // Create directory with many children
      await backend.mkdir('/large-test', { recursive: true })

      const childCount = 100
      for (let i = 0; i < childCount; i++) {
        await backend.mkdir(`/large-test/child-${i}`)
        await backend.writeFile(
          `/large-test/child-${i}/file.txt`,
          new TextEncoder().encode(`content-${i}`)
        )
      }

      // Execute recursive deletion
      await backend.rmdir('/large-test', { recursive: true })

      // Verify directory is gone
      expect(await backend.exists('/large-test')).toBe(false)
    })

    it('should handle deeply nested directories', async () => {
      // Create deeply nested structure
      await backend.mkdir('/deep', { recursive: true })
      await backend.mkdir('/deep/level1', { recursive: true })
      await backend.mkdir('/deep/level1/level2', { recursive: true })
      await backend.mkdir('/deep/level1/level2/level3', { recursive: true })

      // Add siblings at each level
      await backend.mkdir('/deep/sibling1')
      await backend.mkdir('/deep/level1/sibling2')
      await backend.mkdir('/deep/level1/level2/sibling3')

      await backend.writeFile('/deep/file1.txt', new TextEncoder().encode('f1'))
      await backend.writeFile('/deep/level1/file2.txt', new TextEncoder().encode('f2'))
      await backend.writeFile('/deep/level1/level2/file3.txt', new TextEncoder().encode('f3'))

      // Execute recursive deletion
      await backend.rmdir('/deep', { recursive: true })

      // Verify complete deletion
      expect(await backend.exists('/deep')).toBe(false)
    })
  })

  describe('rm recursive parallel processing', () => {
    it('should process subdirectories via FSx.rm', async () => {
      // Create structure via FSx
      await fsx.mkdir('/rm-test', { recursive: true })
      await fsx.mkdir('/rm-test/a')
      await fsx.mkdir('/rm-test/b')
      await fsx.mkdir('/rm-test/c')

      await fsx.writeFile('/rm-test/a/file1.txt', 'content1')
      await fsx.writeFile('/rm-test/b/file2.txt', 'content2')
      await fsx.writeFile('/rm-test/c/file3.txt', 'content3')

      // Execute recursive rm
      await fsx.rm('/rm-test', { recursive: true })

      // Verify complete deletion
      expect(await fsx.exists('/rm-test')).toBe(false)
    })

    it('should handle force flag', async () => {
      // Create partial structure
      await fsx.mkdir('/force-test', { recursive: true })
      await fsx.mkdir('/force-test/existing')
      await fsx.writeFile('/force-test/existing/file.txt', 'content')

      // Execute recursive rm with force
      await fsx.rm('/force-test', { recursive: true, force: true })

      // Verify complete deletion
      expect(await fsx.exists('/force-test')).toBe(false)
    })
  })

  describe('parallel execution verification', () => {
    it('should execute file deletions in parallel', async () => {
      const testBackend = new ParallelTestBackend(20) // 20ms delay per operation
      const testFsx = new FSx(testBackend)

      // Create 5 files in a directory
      await testBackend.mkdir('/parallel-test', { recursive: true })
      const fileCount = 5
      for (let i = 0; i < fileCount; i++) {
        await testBackend.writeFile(`/parallel-test/file${i}.txt`, new TextEncoder().encode(`content${i}`))
      }

      testBackend.reset() // Reset tracking

      // Execute recursive deletion
      const startTime = performance.now()
      await testBackend.rmdir('/parallel-test', { recursive: true })
      const duration = performance.now() - startTime

      // Verify deletion
      expect(await testBackend.exists('/parallel-test')).toBe(false)

      // Check that files were deleted
      expect(testBackend.deletionLog.length).toBe(fileCount)

      // Sequential execution would take: fileCount * 20ms = 100ms
      // Parallel execution should take approximately: 20ms + overhead
      // We allow 50% of sequential time as the threshold
      const sequentialTime = fileCount * 20
      const parallelThreshold = sequentialTime * 0.5 // 50ms

      // This test FAILS with sequential implementation and PASSES with parallel
      expect(duration).toBeLessThan(parallelThreshold)
    })

    it('should achieve concurrent execution', async () => {
      const testBackend = new ParallelTestBackend(10) // 10ms delay

      // Create multiple files
      await testBackend.mkdir('/concurrency-test', { recursive: true })
      const fileCount = 10
      for (let i = 0; i < fileCount; i++) {
        await testBackend.writeFile(`/concurrency-test/file${i}.txt`, new TextEncoder().encode(`content${i}`))
      }

      testBackend.reset()

      // Execute
      await testBackend.rmdir('/concurrency-test', { recursive: true })

      // Verify deletion
      expect(await testBackend.exists('/concurrency-test')).toBe(false)

      // With parallel execution, we should see concurrent operations
      // maxConcurrent > 1 indicates parallel execution
      // This test FAILS with sequential implementation (maxConcurrent = 1)
      // and PASSES with parallel implementation (maxConcurrent > 1)
      expect(testBackend.maxConcurrent).toBeGreaterThan(1)
    })

    it('should demonstrate timing overlap in parallel execution', async () => {
      const testBackend = new ParallelTestBackend(15)

      // Create files
      await testBackend.mkdir('/overlap-test', { recursive: true })
      await testBackend.writeFile('/overlap-test/a.txt', new TextEncoder().encode('a'))
      await testBackend.writeFile('/overlap-test/b.txt', new TextEncoder().encode('b'))
      await testBackend.writeFile('/overlap-test/c.txt', new TextEncoder().encode('c'))

      testBackend.reset()

      // Execute
      await testBackend.rmdir('/overlap-test', { recursive: true })

      // Verify deletion
      expect(await testBackend.exists('/overlap-test')).toBe(false)

      // Check for timing overlap - in parallel execution, some operations
      // should have overlapping time ranges
      const log = testBackend.deletionLog
      expect(log.length).toBe(3)

      // Count overlapping pairs
      let overlappingPairs = 0
      for (let i = 0; i < log.length; i++) {
        for (let j = i + 1; j < log.length; j++) {
          const a = log[i]!
          const b = log[j]!
          // Check if time ranges overlap
          if (a.startTime < b.endTime && b.startTime < a.endTime) {
            overlappingPairs++
          }
        }
      }

      // With parallel execution, we expect overlapping operations
      // This test FAILS with sequential (overlappingPairs = 0)
      // and PASSES with parallel (overlappingPairs > 0)
      expect(overlappingPairs).toBeGreaterThan(0)
    })
  })

  describe('error handling in parallel operations', () => {
    it('should complete successfully when all operations succeed', async () => {
      // Create test structure
      await backend.mkdir('/success-test', { recursive: true })
      await backend.mkdir('/success-test/a')
      await backend.mkdir('/success-test/b')
      await backend.mkdir('/success-test/c')

      await backend.writeFile('/success-test/a/file.txt', new TextEncoder().encode('a'))
      await backend.writeFile('/success-test/b/file.txt', new TextEncoder().encode('b'))
      await backend.writeFile('/success-test/c/file.txt', new TextEncoder().encode('c'))

      // Execute - should complete successfully
      await backend.rmdir('/success-test', { recursive: true })

      expect(await backend.exists('/success-test')).toBe(false)
    })

    it('should handle mixed content types', async () => {
      // Create structure with mixed content
      await backend.mkdir('/mixed-test', { recursive: true })
      await backend.mkdir('/mixed-test/dir1')
      await backend.mkdir('/mixed-test/dir2')
      await backend.writeFile('/mixed-test/file.txt', new TextEncoder().encode('content'))
      await backend.writeFile('/mixed-test/dir1/nested.txt', new TextEncoder().encode('nested'))

      // Execute
      await backend.rmdir('/mixed-test', { recursive: true })

      // Verify complete cleanup
      expect(await backend.exists('/mixed-test')).toBe(false)
    })
  })
})
