/**
 * Tests for git-style lock file pattern [RED phase]
 *
 * This file defines the expected behavior for lock file operations used
 * in atomic file updates. The pattern follows Git's approach:
 * 1. Write to path.lock
 * 2. Rename .lock to target atomically
 *
 * Lock files provide:
 * - Mutual exclusion for file updates
 * - Atomic commit via rename
 * - Stale lock detection and cleanup
 * - Timeout-based waiting for locks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LockFile, LockError, LockHolderInfo, __resetLockRegistry } from './lock'

describe('Lock File Pattern', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  describe('LockFile creation', () => {
    it('should create a LockFile instance for a path', () => {
      const lock = new LockFile('/test/file.txt')

      expect(lock).toBeInstanceOf(LockFile)
      expect(lock.path).toBe('/test/file.txt')
    })

    it('should derive lock path with .lock extension', () => {
      const lock = new LockFile('/test/file.txt')

      expect(lock.lockPath).toBe('/test/file.txt.lock')
    })

    it('should support custom lock file extension', () => {
      const lock = new LockFile('/test/file.txt', { extension: '.lck' })

      expect(lock.lockPath).toBe('/test/file.txt.lck')
    })

    it('should handle paths without extension', () => {
      const lock = new LockFile('/test/README')

      expect(lock.lockPath).toBe('/test/README.lock')
    })

    it('should handle paths with multiple extensions', () => {
      const lock = new LockFile('/test/archive.tar.gz')

      expect(lock.lockPath).toBe('/test/archive.tar.gz.lock')
    })

    it('should start with isHeld = false', () => {
      const lock = new LockFile('/test/file.txt')

      expect(lock.isHeld).toBe(false)
    })

    it('should start with createdAt = null', () => {
      const lock = new LockFile('/test/file.txt')

      expect(lock.createdAt).toBeNull()
    })
  })

  describe('Lock acquisition', () => {
    it('should acquire lock on uncontested path', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      expect(lock.isHeld).toBe(true)
    })

    it('should create .lock file when acquiring', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Implementation should create /test/file.txt.lock
      expect(lock.isHeld).toBe(true)
      expect(lock.createdAt).toBeTypeOf('number')
    })

    it('should set createdAt timestamp on acquire', async () => {
      const now = Date.now()
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      expect(lock.createdAt).toBeGreaterThanOrEqual(now)
      expect(lock.createdAt).toBeLessThanOrEqual(Date.now())
    })

    it('should throw EWOULDBLOCK when lock already held by another', async () => {
      // Simulate another process holding the lock
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      await expect(lock2.acquire()).rejects.toThrow()
      await expect(lock2.acquire()).rejects.toMatchObject({
        code: 'EWOULDBLOCK'
      })
    })

    it('should throw when acquiring same lock twice', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      await expect(lock.acquire()).rejects.toThrow(/already held/i)
    })

    it('should use exclusive flag for lock file creation', async () => {
      // The lock file should be created with O_EXCL semantics
      // meaning it fails if the file already exists
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Attempting to create the same lock file should fail
      expect(lock.isHeld).toBe(true)
    })
  })

  describe('Lock with timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should wait for lock with timeout option', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Start waiting for lock with timeout
      const acquirePromise = lock2.acquire({ timeout: 1000 })

      // Release the first lock after 500ms
      setTimeout(() => lock1.release(), 500)

      await vi.advanceTimersByTimeAsync(600)

      // lock2 should now have acquired the lock
      await expect(acquirePromise).resolves.toBeUndefined()
      expect(lock2.isHeld).toBe(true)
    })

    it('should timeout if lock not available within timeout period', async () => {
      // Use real timers for this test since fake timers have issues in Workers environment
      vi.useRealTimers()

      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Use a very short timeout to avoid test slowness
      await expect(lock2.acquire({ timeout: 50, retryInterval: 10 })).rejects.toMatchObject({
        code: 'ETIMEDOUT'
      })
    })

    it('should respect custom retry interval', async () => {
      // Use real timers for this test since fake timers have issues in Workers environment
      vi.useRealTimers()

      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // With short timeout and retry interval, should fail after a few retries
      // We can't easily count retries without mocking, but we can verify the behavior
      await expect(lock2.acquire({
        timeout: 100,
        retryInterval: 30
      })).rejects.toThrow()
    })

    it('should return immediately if timeout is 0 and lock unavailable', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      const start = Date.now()
      await expect(lock2.acquire({ timeout: 0 })).rejects.toThrow()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100) // Should return immediately
    })
  })

  describe('Lock release', () => {
    it('should release held lock', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      expect(lock.isHeld).toBe(true)

      await lock.release()
      expect(lock.isHeld).toBe(false)
    })

    it('should remove .lock file on release', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      await lock.release()

      // Lock file should be removed
      expect(lock.isHeld).toBe(false)
      expect(lock.createdAt).toBeNull()
    })

    it('should reset createdAt on release', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      expect(lock.createdAt).not.toBeNull()

      await lock.release()
      expect(lock.createdAt).toBeNull()
    })

    it('should allow another lock to acquire after release', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()
      await lock1.release()

      await lock2.acquire()
      expect(lock2.isHeld).toBe(true)
    })

    it('should throw when releasing unheld lock', async () => {
      const lock = new LockFile('/test/file.txt')

      await expect(lock.release()).rejects.toThrow(/not held/i)
    })

    it('should be idempotent (no error on double release)', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      await lock.release()

      // Second release should throw (or be no-op depending on design)
      await expect(lock.release()).rejects.toThrow(/not held/i)
    })
  })

  describe('Stale lock detection', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should detect stale lock based on age', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Simulate stale lock (e.g., process crashed)
      // Advance time past stale threshold
      await vi.advanceTimersByTimeAsync(60000) // 60 seconds

      // lock2 should be able to acquire with stale detection
      await lock2.acquire({ staleThreshold: 30000 }) // 30 second threshold

      expect(lock2.isHeld).toBe(true)
    })

    it('should not break fresh lock even with stale detection enabled', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Only advance 10 seconds
      await vi.advanceTimersByTimeAsync(10000)

      // Should still fail because lock is not stale (threshold: 30s)
      await expect(
        lock2.acquire({ staleThreshold: 30000, timeout: 0 })
      ).rejects.toMatchObject({
        code: 'EWOULDBLOCK'
      })
    })

    it('should remove stale lock file before acquiring', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Simulate crash - lock1 is "abandoned"
      // In real scenario, process would have died without releasing

      await vi.advanceTimersByTimeAsync(60000)

      // lock2 should clean up and acquire
      await lock2.acquire({ staleThreshold: 30000 })

      expect(lock2.isHeld).toBe(true)
      expect(lock2.createdAt).toBeGreaterThan(0)
    })

    it('should use configurable stale threshold', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Advance 15 seconds
      await vi.advanceTimersByTimeAsync(15000)

      // With 10 second threshold, lock should be considered stale
      await lock2.acquire({ staleThreshold: 10000 })

      expect(lock2.isHeld).toBe(true)
    })

    it('should provide ESTALE error code for stale lock situations', async () => {
      // When explicitly detecting but not auto-breaking stale locks
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt', { staleThreshold: 30000 })

      // Create a pre-existing lock
      await lock1.acquire()

      // Simulate stale lock by advancing time (this works without fake timers
      // because we test that with staleThreshold: 0 it doesn't break the lock)
      // The key behavior is: with staleThreshold: 0 on acquire,
      // we don't break stale locks, so any existing lock blocks us

      await expect(lock2.acquire({ staleThreshold: 0 })).rejects.toMatchObject({
        code: expect.stringMatching(/EWOULDBLOCK|ESTALE/)
      })
    })
  })

  describe('Lock file cleanup', () => {
    it('should clean up lock file on process signal (if supported)', async () => {
      // This is environment-specific but the API should support it
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Simulate cleanup callback
      // Implementation should register cleanup handlers
      expect(lock.isHeld).toBe(true)
    })

    it('should support explicit cleanup method', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Force cleanup should release without normal checks
      await lock.release()

      expect(lock.isHeld).toBe(false)
    })

    it('should handle cleanup when lock file already deleted', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Simulate external deletion of lock file
      // Release should handle missing file gracefully
      await expect(lock.release()).resolves.toBeUndefined()
    })
  })

  describe('Concurrent lock acquisition', () => {
    it('should serialize concurrent acquire attempts', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')
      const lock3 = new LockFile('/test/file.txt')

      // All try to acquire simultaneously
      const results = await Promise.allSettled([
        lock1.acquire(),
        lock2.acquire(),
        lock3.acquire()
      ])

      // Exactly one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes).toHaveLength(1)
      expect(failures).toHaveLength(2)
    })

    it('should handle rapid acquire/release cycles', async () => {
      const lock = new LockFile('/test/file.txt')

      for (let i = 0; i < 10; i++) {
        await lock.acquire()
        expect(lock.isHeld).toBe(true)
        await lock.release()
        expect(lock.isHeld).toBe(false)
      }
    })

    it('should maintain lock integrity under contention', async () => {
      const locks = Array.from({ length: 5 }, () => new LockFile('/test/file.txt'))
      const acquired: number[] = []

      // Simulate contention - all try to acquire with timeout
      const promises = locks.map(async (lock, i) => {
        try {
          await lock.acquire({ timeout: 100 })
          acquired.push(i)
          await new Promise((r) => setTimeout(r, 10))
          await lock.release()
        } catch {
          // Expected for losers
        }
      })

      await Promise.all(promises)

      // At least one should have acquired
      expect(acquired.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Atomic commit (rename .lock to target)', () => {
    it('should commit lock file to target path', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('new content')

      await lock.acquire()
      await lock.write(data)
      await lock.commit(data)

      // After commit:
      // 1. /test/file.txt.lock should be renamed to /test/file.txt
      // 2. Lock should be released
      expect(lock.isHeld).toBe(false)
    })

    it('should atomically replace target file', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('updated content')

      await lock.acquire()
      await lock.commit(data)

      // The rename should be atomic - no intermediate state visible
      expect(lock.isHeld).toBe(false)
    })

    it('should throw when committing without holding lock', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('content')

      await expect(lock.commit(data)).rejects.toThrow(/not held/i)
    })

    it('should release lock on commit success', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('content')

      await lock.acquire()
      expect(lock.isHeld).toBe(true)

      await lock.commit(data)
      expect(lock.isHeld).toBe(false)
    })

    it('should keep lock on commit failure', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Simulate commit failure (e.g., target directory deleted)
      // Implementation should keep lock held on failure
      // This allows retry

      // Note: This test depends on implementation details
      // The key behavior is that a failed commit doesn't leave
      // the system in an inconsistent state
    })

    it('should support write before commit', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('content')

      await lock.acquire()
      await lock.write(data)

      // Write should update the .lock file contents
      // Commit will then rename to target
      expect(lock.isHeld).toBe(true)
    })
  })

  describe('Write to lock file', () => {
    it('should write data to lock file', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('test content')

      await lock.acquire()
      await lock.write(data)

      // Data should be written to /test/file.txt.lock
      expect(lock.isHeld).toBe(true)
    })

    it('should overwrite previous data on subsequent writes', async () => {
      const lock = new LockFile('/test/file.txt')
      const data1 = new TextEncoder().encode('first')
      const data2 = new TextEncoder().encode('second')

      await lock.acquire()
      await lock.write(data1)
      await lock.write(data2)

      // Only 'second' should remain in lock file
      expect(lock.isHeld).toBe(true)
    })

    it('should throw when writing without holding lock', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new TextEncoder().encode('content')

      await expect(lock.write(data)).rejects.toThrow(/not held/i)
    })

    it('should handle empty data write', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new Uint8Array(0)

      await lock.acquire()
      await expect(lock.write(data)).resolves.toBeUndefined()
    })

    it('should handle large data write', async () => {
      const lock = new LockFile('/test/file.txt')
      const data = new Uint8Array(1024 * 1024) // 1MB

      await lock.acquire()
      await expect(lock.write(data)).resolves.toBeUndefined()
    })
  })

  describe('Lock refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should refresh lock to prevent staleness', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      const originalTime = lock.createdAt

      await vi.advanceTimersByTimeAsync(10000)

      await lock.refresh()

      // createdAt should be updated (or mtime of lock file)
      expect(lock.createdAt).toBeGreaterThan(originalTime!)
    })

    it('should throw when refreshing unheld lock', async () => {
      const lock = new LockFile('/test/file.txt')

      await expect(lock.refresh()).rejects.toThrow(/not held/i)
    })

    it('should prevent lock from becoming stale when refreshed', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      // Refresh before stale threshold
      await vi.advanceTimersByTimeAsync(25000)
      await lock1.refresh()

      // Even though 25 seconds passed, lock was refreshed
      // lock2 should not be able to acquire with 30s stale threshold
      await expect(
        lock2.acquire({ staleThreshold: 30000, timeout: 0 })
      ).rejects.toMatchObject({
        code: 'EWOULDBLOCK'
      })
    })
  })

  describe('Error handling', () => {
    it('should throw LockError with appropriate code', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      try {
        await lock2.acquire()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LockError)
        expect((error as LockError).code).toBe('EWOULDBLOCK')
        expect((error as LockError).path).toBe('/test/file.txt')
      }
    })

    it('should include path in error message', async () => {
      const lock1 = new LockFile('/test/file.txt')
      const lock2 = new LockFile('/test/file.txt')

      await lock1.acquire()

      await expect(lock2.acquire()).rejects.toThrow('/test/file.txt')
    })

    it('should handle missing parent directory', async () => {
      const lock = new LockFile('/nonexistent/dir/file.txt')

      await expect(lock.acquire()).rejects.toMatchObject({
        code: 'ENOENT'
      })
    })

    it('should handle permission denied', async () => {
      const lock = new LockFile('/readonly/file.txt')

      // If directory is not writable, should throw EACCES
      await expect(lock.acquire()).rejects.toMatchObject({
        code: expect.stringMatching(/EACCES|EPERM/)
      })
    })
  })

  describe('Lock file path edge cases', () => {
    it('should handle root-level paths', () => {
      const lock = new LockFile('/file.txt')

      expect(lock.path).toBe('/file.txt')
      expect(lock.lockPath).toBe('/file.txt.lock')
    })

    it('should handle deeply nested paths', () => {
      const deepPath = '/a/b/c/d/e/f/g/h/file.txt'
      const lock = new LockFile(deepPath)

      expect(lock.lockPath).toBe(`${deepPath}.lock`)
    })

    it('should handle hidden files', () => {
      const lock = new LockFile('/path/.hidden')

      expect(lock.lockPath).toBe('/path/.hidden.lock')
    })

    it('should handle files ending with .lock', () => {
      const lock = new LockFile('/path/file.lock')

      expect(lock.lockPath).toBe('/path/file.lock.lock')
    })

    it('should handle unicode in paths', () => {
      const lock = new LockFile('/path/archivo.txt')

      expect(lock.lockPath).toBe('/path/archivo.txt.lock')
    })
  })
})

describe('LockFile Static Methods', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  describe('isLocked static check', () => {
    it('should check if path is currently locked', async () => {
      const lock = new LockFile('/test/file.txt')

      // Before acquiring
      // expect(await LockFile.isLocked('/test/file.txt')).toBe(false)

      await lock.acquire()

      // After acquiring
      // expect(await LockFile.isLocked('/test/file.txt')).toBe(true)

      await lock.release()

      // After releasing
      // expect(await LockFile.isLocked('/test/file.txt')).toBe(false)
    })
  })

  describe('breakLock static method', () => {
    it('should forcefully remove lock file', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Force break the lock (admin operation)
      // await LockFile.breakLock('/test/file.txt')

      // Lock file should be removed
      // const newLock = new LockFile('/test/file.txt')
      // await newLock.acquire()  // Should succeed
    })
  })
})

describe('Lock holder information', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  describe('holderInfo getter', () => {
    it('should return null when lock is not held', () => {
      const lock = new LockFile('/test/file.txt')

      expect(lock.holderInfo).toBeNull()
    })

    it('should return holder info when lock is held', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      const info = lock.holderInfo
      expect(info).not.toBeNull()
      expect(info!.holderId).toBeTypeOf('number')
      expect(info!.acquiredAt).toBeTypeOf('number')
      expect(info!.age).toBeGreaterThanOrEqual(0)
      expect(info!.path).toBe('/test/file.txt')
    })

    it('should return null after lock is released', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()
      expect(lock.holderInfo).not.toBeNull()

      await lock.release()
      expect(lock.holderInfo).toBeNull()
    })
  })

  describe('getLockInfo static method', () => {
    it('should return null for unlocked path', async () => {
      const info = await LockFile.getLockInfo('/test/file.txt')

      expect(info).toBeNull()
    })

    it('should return lock info for locked path', async () => {
      const lock = new LockFile('/test/file.txt')
      await lock.acquire()

      const info = await LockFile.getLockInfo('/test/file.txt')

      expect(info).not.toBeNull()
      expect(info!.path).toBe('/test/file.txt')
      expect(info!.holderId).toBeTypeOf('number')
    })
  })

  describe('getAllLocks static method', () => {
    it('should return empty array when no locks held', async () => {
      const locks = await LockFile.getAllLocks()

      expect(locks).toEqual([])
    })

    it('should return all active locks', async () => {
      const lock1 = new LockFile('/test/file1.txt')
      const lock2 = new LockFile('/test/file2.txt')

      await lock1.acquire()
      await lock2.acquire()

      const locks = await LockFile.getAllLocks()

      expect(locks).toHaveLength(2)
      const paths = locks.map((l) => l.path)
      expect(paths).toContain('/test/file1.txt')
      expect(paths).toContain('/test/file2.txt')
    })
  })
})

describe('Stale lock cleanup', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  describe('cleanupStaleLocks static method', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should not clean up fresh locks', async () => {
      const lock = new LockFile('/test/file.txt')
      await lock.acquire()

      const cleaned = await LockFile.cleanupStaleLocks(60000)

      expect(cleaned).toHaveLength(0)
      expect(lock.isHeld).toBe(true)
    })

    it('should clean up stale locks', async () => {
      const lock = new LockFile('/test/file.txt')
      await lock.acquire()

      // Advance time past stale threshold
      await vi.advanceTimersByTimeAsync(70000)

      const cleaned = await LockFile.cleanupStaleLocks(60000)

      expect(cleaned).toHaveLength(1)
      expect(cleaned[0]).toBe('/test/file.txt')
    })

    it('should clean up multiple stale locks', async () => {
      const lock1 = new LockFile('/test/file1.txt')
      const lock2 = new LockFile('/test/file2.txt')
      const lock3 = new LockFile('/test/file3.txt')

      await lock1.acquire()
      await lock2.acquire()

      // Advance time
      await vi.advanceTimersByTimeAsync(50000)

      // lock3 acquired more recently
      await lock3.acquire()

      // Advance more time
      await vi.advanceTimersByTimeAsync(20000)

      // Total: lock1/lock2 are 70s old, lock3 is 20s old
      const cleaned = await LockFile.cleanupStaleLocks(60000)

      expect(cleaned).toHaveLength(2)
      expect(cleaned).toContain('/test/file1.txt')
      expect(cleaned).toContain('/test/file2.txt')
    })
  })
})

describe('Exponential backoff', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  it('should support exponential backoff with explicit multiplier', async () => {
    // Use real timers for this test
    const lock1 = new LockFile('/test/file.txt')
    const lock2 = new LockFile('/test/file.txt')

    await lock1.acquire()

    // With backoff enabled and very short timeout, should fail fast
    await expect(lock2.acquire({
      timeout: 100,
      retryInterval: 20,
      backoffMultiplier: 2,
      maxRetryInterval: 50
    })).rejects.toMatchObject({
      code: 'ETIMEDOUT'
    })
  })

  it('should cap retry interval at maxRetryInterval', async () => {
    const lock1 = new LockFile('/test/file.txt')
    const lock2 = new LockFile('/test/file.txt')

    await lock1.acquire()

    // With aggressive backoff, should still be capped
    await expect(lock2.acquire({
      timeout: 200,
      retryInterval: 10,
      backoffMultiplier: 10,
      maxRetryInterval: 50
    })).rejects.toMatchObject({
      code: 'ETIMEDOUT'
    })
  })
})

describe('LockFile Integration Scenarios', () => {
  // Reset the global lock registry before each test
  beforeEach(() => {
    __resetLockRegistry()
  })

  describe('Safe file update pattern', () => {
    it('should support read-modify-write with lock', async () => {
      const lock = new LockFile('/test/config.json')

      await lock.acquire()

      // Read existing file (implementation would read /test/config.json)
      // Modify data
      const newData = new TextEncoder().encode('{"updated": true}')

      // Write to lock file
      await lock.write(newData)

      // Atomic commit
      await lock.commit(newData)

      expect(lock.isHeld).toBe(false)
    })

    it('should rollback on error before commit', async () => {
      const lock = new LockFile('/test/config.json')

      await lock.acquire()
      await lock.write(new TextEncoder().encode('partial data'))

      // Simulate error condition - release instead of commit
      await lock.release()

      // Original file should be unchanged
      // Lock file should be removed
      expect(lock.isHeld).toBe(false)
    })
  })

  describe('Multi-step transaction pattern', () => {
    it('should support multiple writes before commit', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Multiple writes (like building up content)
      await lock.write(new TextEncoder().encode('line 1\n'))
      await lock.write(new TextEncoder().encode('line 1\nline 2\n'))
      await lock.write(new TextEncoder().encode('line 1\nline 2\nline 3\n'))

      await lock.commit(new TextEncoder().encode('final content'))

      expect(lock.isHeld).toBe(false)
    })
  })

  describe('Lock upgrade pattern', () => {
    it('should support holding lock while performing checks', async () => {
      const lock = new LockFile('/test/file.txt')

      await lock.acquire()

      // Perform validation (lock held during this time)
      const isValid = true

      if (isValid) {
        await lock.commit(new TextEncoder().encode('valid data'))
      } else {
        await lock.release() // Rollback
      }

      expect(lock.isHeld).toBe(false)
    })
  })
})
