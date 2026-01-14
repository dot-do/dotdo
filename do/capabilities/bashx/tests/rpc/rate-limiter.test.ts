/**
 * Rate Limiter Tests
 *
 * Tests for RPC rate limiting functionality.
 * Verifies request counting, window management, statistics, and ShellApi wrapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  RateLimiter,
  RateLimitedShellApi,
  RateLimitError,
  withRateLimit,
  createRateLimiter,
  type RateLimitConfig,
  type RateLimitStats,
} from '../../src/rpc/rate-limiter.js'
import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
} from '../../core/rpc/types.js'

// ============================================================================
// Mock ShellApi for testing
// ============================================================================

class MockShellApi implements ShellApi {
  execCalls: Array<{ command: string; options?: ShellExecOptions }> = []
  spawnCalls: Array<{ command: string; options?: ShellSpawnOptions }> = []

  async exec(command: string, options?: ShellExecOptions): Promise<ShellResult> {
    this.execCalls.push({ command, options })
    return {
      stdout: `executed: ${command}`,
      stderr: '',
      exitCode: 0,
    }
  }

  spawn(command: string, options?: ShellSpawnOptions): ShellStream {
    this.spawnCalls.push({ command, options })
    // Return a minimal mock stream
    return {
      pid: 12345,
      write: vi.fn(),
      closeStdin: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => vi.fn()),
      onStderr: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      wait: vi.fn(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      ),
      [Symbol.dispose]: vi.fn(),
    }
  }

  reset(): void {
    this.execCalls = []
    this.spawnCalls = []
  }
}

// ============================================================================
// RateLimiter Tests
// ============================================================================

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('allow()', () => {
    it('should return true within limit', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(true)
    })

    it('should return false when limit exceeded', () => {
      const limiter = new RateLimiter({ maxRequests: 3 })

      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(false) // 4th request
      expect(limiter.allow()).toBe(false) // 5th request
    })

    it('should track current requests correctly', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      limiter.allow()
      limiter.allow()

      const stats = limiter.getStats()
      expect(stats.currentRequests).toBe(2)
    })

    it('should increment totalRequests on success', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      limiter.allow()
      limiter.allow()
      limiter.allow()

      const stats = limiter.getStats()
      expect(stats.totalRequests).toBe(3)
    })

    it('should increment totalRejected on failure', () => {
      const limiter = new RateLimiter({ maxRequests: 2 })

      limiter.allow() // accepted
      limiter.allow() // accepted
      limiter.allow() // rejected
      limiter.allow() // rejected

      const stats = limiter.getStats()
      expect(stats.totalRequests).toBe(2)
      expect(stats.totalRejected).toBe(2)
    })
  })

  describe('Window reset', () => {
    it('should reset window after windowMs', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })

      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(false) // limit reached

      // Advance time past window
      vi.advanceTimersByTime(1001)

      expect(limiter.allow()).toBe(true) // new window
      expect(limiter.allow()).toBe(true)
      expect(limiter.allow()).toBe(false) // limit reached again
    })

    it('should use 1000ms as default window', () => {
      const limiter = new RateLimiter({ maxRequests: 2 })

      limiter.allow()
      limiter.allow()
      expect(limiter.allow()).toBe(false)

      vi.advanceTimersByTime(999)
      expect(limiter.allow()).toBe(false) // still in window

      vi.advanceTimersByTime(2)
      expect(limiter.allow()).toBe(true) // new window
    })

    it('should reset currentRequests to 0 on window reset', () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 })

      limiter.allow()
      limiter.allow()
      expect(limiter.getStats().currentRequests).toBe(2)

      vi.advanceTimersByTime(1001)
      limiter.allow()

      expect(limiter.getStats().currentRequests).toBe(1)
    })

    it('should update windowStart on reset', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })
      const initialStart = limiter.getStats().windowStart

      vi.advanceTimersByTime(1500)
      limiter.allow()

      const newStart = limiter.getStats().windowStart
      expect(newStart).toBeGreaterThan(initialStart)
    })
  })

  describe('acquire()', () => {
    it('should not throw when within limit', () => {
      const limiter = new RateLimiter({
        maxRequests: 5,
        onLimitExceeded: 'throw',
      })

      expect(() => limiter.acquire()).not.toThrow()
      expect(() => limiter.acquire()).not.toThrow()
    })

    it('should throw RateLimitError when limit exceeded with throw mode', () => {
      const limiter = new RateLimiter({
        maxRequests: 2,
        onLimitExceeded: 'throw',
      })

      limiter.acquire()
      limiter.acquire()

      expect(() => limiter.acquire()).toThrow(RateLimitError)
    })

    it('should use custom error message', () => {
      const limiter = new RateLimiter({
        maxRequests: 1,
        onLimitExceeded: 'throw',
        errorMessage: 'Too many requests!',
      })

      limiter.acquire()

      expect(() => limiter.acquire()).toThrow('Too many requests!')
    })

    it('should include stats in RateLimitError', () => {
      const limiter = new RateLimiter({
        maxRequests: 1,
        onLimitExceeded: 'throw',
      })

      limiter.acquire()

      try {
        limiter.acquire()
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError)
        const error = e as RateLimitError
        expect(error.stats).toBeDefined()
        expect(error.stats.totalRequests).toBe(1)
        expect(error.stats.totalRejected).toBe(1)
      }
    })

    it('should silently return with drop mode', () => {
      const limiter = new RateLimiter({
        maxRequests: 1,
        onLimitExceeded: 'drop',
      })

      limiter.acquire()
      expect(() => limiter.acquire()).not.toThrow()
    })

    it('should default to throw mode', () => {
      const limiter = new RateLimiter({ maxRequests: 1 })

      limiter.acquire()
      expect(() => limiter.acquire()).toThrow(RateLimitError)
    })
  })

  describe('getStats()', () => {
    it('should return correct initial stats', () => {
      const limiter = new RateLimiter({ maxRequests: 10 })

      const stats = limiter.getStats()
      expect(stats.currentRequests).toBe(0)
      expect(stats.totalRequests).toBe(0)
      expect(stats.totalRejected).toBe(0)
      expect(stats.windowStart).toBeGreaterThan(0)
    })

    it('should return accurate stats after requests', () => {
      const limiter = new RateLimiter({ maxRequests: 3 })

      limiter.allow()
      limiter.allow()
      limiter.allow()
      limiter.allow() // rejected

      const stats = limiter.getStats()
      expect(stats.currentRequests).toBe(3)
      expect(stats.totalRequests).toBe(3)
      expect(stats.totalRejected).toBe(1)
    })
  })

  describe('remaining()', () => {
    it('should return maxRequests initially', () => {
      const limiter = new RateLimiter({ maxRequests: 10 })

      expect(limiter.remaining()).toBe(10)
    })

    it('should decrement as requests are made', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      limiter.allow()
      expect(limiter.remaining()).toBe(4)

      limiter.allow()
      expect(limiter.remaining()).toBe(3)
    })

    it('should never return negative', () => {
      const limiter = new RateLimiter({ maxRequests: 2 })

      limiter.allow()
      limiter.allow()
      limiter.allow() // rejected
      limiter.allow() // rejected

      expect(limiter.remaining()).toBe(0)
    })

    it('should reset after window expires', () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 })

      limiter.allow()
      limiter.allow()
      expect(limiter.remaining()).toBe(3)

      vi.advanceTimersByTime(1001)

      expect(limiter.remaining()).toBe(5)
    })
  })

  describe('reset()', () => {
    it('should reset all counters', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      limiter.allow()
      limiter.allow()
      limiter.allow()

      limiter.reset()

      const stats = limiter.getStats()
      expect(stats.currentRequests).toBe(0)
      expect(stats.totalRequests).toBe(0)
      expect(stats.totalRejected).toBe(0)
    })

    it('should reset window start', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })
      const initialStart = limiter.getStats().windowStart

      vi.advanceTimersByTime(5000)
      limiter.reset()

      const newStart = limiter.getStats().windowStart
      expect(newStart).toBeGreaterThan(initialStart)
    })
  })

  describe('release()', () => {
    it('should be a no-op (for future extension)', () => {
      const limiter = new RateLimiter({ maxRequests: 5 })

      limiter.allow()
      const before = limiter.getStats()

      limiter.release()
      const after = limiter.getStats()

      expect(before.currentRequests).toBe(after.currentRequests)
    })
  })
})

// ============================================================================
// RateLimitError Tests
// ============================================================================

describe('RateLimitError', () => {
  it('should have correct name', () => {
    const stats: RateLimitStats = {
      currentRequests: 10,
      windowStart: Date.now(),
      totalRequests: 100,
      totalRejected: 10,
    }
    const error = new RateLimitError('Test error', stats)

    expect(error.name).toBe('RateLimitError')
  })

  it('should have correct code', () => {
    const stats: RateLimitStats = {
      currentRequests: 0,
      windowStart: Date.now(),
      totalRequests: 0,
      totalRejected: 0,
    }
    const error = new RateLimitError('Test', stats)

    // Now uses unified error code from BashxRateLimitError
    expect(error.code).toBe('RATE_LIMIT_ERROR')
  })

  it('should store stats', () => {
    const stats: RateLimitStats = {
      currentRequests: 5,
      windowStart: 1234567890,
      totalRequests: 100,
      totalRejected: 20,
    }
    const error = new RateLimitError('Test', stats)

    expect(error.stats).toEqual(stats)
  })

  it('should be instanceof Error', () => {
    const stats: RateLimitStats = {
      currentRequests: 0,
      windowStart: Date.now(),
      totalRequests: 0,
      totalRejected: 0,
    }
    const error = new RateLimitError('Test', stats)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RateLimitError)
  })
})

// ============================================================================
// RateLimitedShellApi Tests
// ============================================================================

describe('RateLimitedShellApi', () => {
  let mockApi: MockShellApi
  let rateLimitedApi: RateLimitedShellApi

  beforeEach(() => {
    vi.useFakeTimers()
    mockApi = new MockShellApi()
    rateLimitedApi = new RateLimitedShellApi(mockApi, {
      maxRequests: 5,
      windowMs: 1000,
      onLimitExceeded: 'throw',
    })
  })

  describe('exec()', () => {
    it('should delegate to underlying api', async () => {
      const result = await rateLimitedApi.exec('ls -la')

      expect(mockApi.execCalls).toHaveLength(1)
      expect(mockApi.execCalls[0].command).toBe('ls -la')
      expect(result.stdout).toBe('executed: ls -la')
    })

    it('should pass options to underlying api', async () => {
      const options: ShellExecOptions = { cwd: '/tmp', timeout: 5000 }
      await rateLimitedApi.exec('pwd', options)

      expect(mockApi.execCalls[0].options).toEqual(options)
    })

    it('should rate limit exec calls', async () => {
      // Use up the limit
      await rateLimitedApi.exec('cmd1')
      await rateLimitedApi.exec('cmd2')
      await rateLimitedApi.exec('cmd3')
      await rateLimitedApi.exec('cmd4')
      await rateLimitedApi.exec('cmd5')

      // 6th call should throw
      await expect(rateLimitedApi.exec('cmd6')).rejects.toThrow(RateLimitError)
    })

    it('should allow exec after window resets', async () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        await rateLimitedApi.exec(`cmd${i}`)
      }

      // Wait for window to reset
      vi.advanceTimersByTime(1001)

      // Should succeed now
      await expect(rateLimitedApi.exec('newcmd')).resolves.toBeDefined()
    })
  })

  describe('spawn()', () => {
    it('should delegate to underlying api', () => {
      const stream = rateLimitedApi.spawn('tail -f log.txt')

      expect(mockApi.spawnCalls).toHaveLength(1)
      expect(mockApi.spawnCalls[0].command).toBe('tail -f log.txt')
      expect(stream.pid).toBe(12345)
    })

    it('should pass options to underlying api', () => {
      const options: ShellSpawnOptions = { cwd: '/var/log' }
      rateLimitedApi.spawn('tail', options)

      expect(mockApi.spawnCalls[0].options).toEqual(options)
    })

    it('should rate limit spawn calls', () => {
      // Use up the limit
      rateLimitedApi.spawn('cmd1')
      rateLimitedApi.spawn('cmd2')
      rateLimitedApi.spawn('cmd3')
      rateLimitedApi.spawn('cmd4')
      rateLimitedApi.spawn('cmd5')

      // 6th call should throw
      expect(() => rateLimitedApi.spawn('cmd6')).toThrow(RateLimitError)
    })

    it('should share rate limit with exec', async () => {
      await rateLimitedApi.exec('cmd1')
      await rateLimitedApi.exec('cmd2')
      rateLimitedApi.spawn('cmd3')
      rateLimitedApi.spawn('cmd4')
      await rateLimitedApi.exec('cmd5')

      // 6th call (spawn) should throw
      expect(() => rateLimitedApi.spawn('cmd6')).toThrow(RateLimitError)
    })
  })

  describe('getStats()', () => {
    it('should return rate limiter stats', async () => {
      await rateLimitedApi.exec('cmd1')
      await rateLimitedApi.exec('cmd2')

      const stats = rateLimitedApi.getStats()
      expect(stats.currentRequests).toBe(2)
      expect(stats.totalRequests).toBe(2)
    })
  })

  describe('remaining()', () => {
    it('should return remaining requests', async () => {
      expect(rateLimitedApi.remaining()).toBe(5)

      await rateLimitedApi.exec('cmd1')
      expect(rateLimitedApi.remaining()).toBe(4)

      await rateLimitedApi.exec('cmd2')
      expect(rateLimitedApi.remaining()).toBe(3)
    })
  })

  describe('reset()', () => {
    it('should reset the rate limiter', async () => {
      await rateLimitedApi.exec('cmd1')
      await rateLimitedApi.exec('cmd2')
      await rateLimitedApi.exec('cmd3')

      rateLimitedApi.reset()

      expect(rateLimitedApi.remaining()).toBe(5)
      expect(rateLimitedApi.getStats().currentRequests).toBe(0)
    })
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('withRateLimit()', () => {
  it('should create a RateLimitedShellApi', () => {
    const mockApi = new MockShellApi()
    const wrapped = withRateLimit(mockApi, { maxRequests: 10 })

    expect(wrapped).toBeInstanceOf(RateLimitedShellApi)
  })

  it('should apply rate limiting', async () => {
    const mockApi = new MockShellApi()
    const wrapped = withRateLimit(mockApi, {
      maxRequests: 2,
      onLimitExceeded: 'throw',
    })

    await wrapped.exec('cmd1')
    await wrapped.exec('cmd2')

    await expect(wrapped.exec('cmd3')).rejects.toThrow(RateLimitError)
  })
})

describe('createRateLimiter()', () => {
  it('should create a standalone RateLimiter', () => {
    const limiter = createRateLimiter({ maxRequests: 10 })

    expect(limiter).toBeInstanceOf(RateLimiter)
  })

  it('should use provided config', () => {
    const limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 5000,
      onLimitExceeded: 'drop',
    })

    limiter.allow()
    limiter.allow()
    limiter.allow()

    // With 'drop' mode, this should not throw
    expect(() => limiter.acquire()).not.toThrow()
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should handle burst traffic then recover', async () => {
    const mockApi = new MockShellApi()
    const api = withRateLimit(mockApi, {
      maxRequests: 3,
      windowMs: 1000,
      onLimitExceeded: 'throw',
    })

    // First burst - should succeed
    await api.exec('cmd1')
    await api.exec('cmd2')
    await api.exec('cmd3')

    // Limit reached
    await expect(api.exec('cmd4')).rejects.toThrow(RateLimitError)

    // Wait half window - still limited
    vi.advanceTimersByTime(500)
    await expect(api.exec('cmd5')).rejects.toThrow(RateLimitError)

    // Wait past window - should recover
    vi.advanceTimersByTime(600)
    await api.exec('cmd6') // Should succeed
    expect(mockApi.execCalls).toHaveLength(4)
  })

  it('should handle mixed exec and spawn', async () => {
    const mockApi = new MockShellApi()
    const api = withRateLimit(mockApi, {
      maxRequests: 4,
      onLimitExceeded: 'throw',
    })

    await api.exec('exec1')
    api.spawn('spawn1')
    await api.exec('exec2')
    api.spawn('spawn2')

    // All 4 slots used
    expect(() => api.spawn('spawn3')).toThrow(RateLimitError)
    await expect(api.exec('exec3')).rejects.toThrow(RateLimitError)
  })

  it('should accumulate stats across windows', async () => {
    const mockApi = new MockShellApi()
    const api = withRateLimit(mockApi, {
      maxRequests: 2,
      windowMs: 1000,
      onLimitExceeded: 'throw',
    })

    // Window 1
    await api.exec('cmd1')
    await api.exec('cmd2')
    try {
      await api.exec('cmd3')
    } catch (_) {
      /* expected */
    }

    // Window 2
    vi.advanceTimersByTime(1001)
    await api.exec('cmd4')

    const stats = api.getStats()
    expect(stats.totalRequests).toBe(3)
    expect(stats.totalRejected).toBe(1)
    expect(stats.currentRequests).toBe(1) // Only cmd4 in current window
  })
})
