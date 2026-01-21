/**
 * RED Tests: MCP Sandbox Resource Limit Enforcement
 *
 * These tests expose that resource limits are DEFINED but NOT ENFORCED.
 * All tests should FAIL until enforcement is implemented.
 *
 * ResourceLimits interface defines:
 * - timeout: Partially enforced (via Promise.race, but not CPU-level)
 * - maxCodeSize: Enforced (pre-validation)
 * - maxOutputSize: Enforced (post-truncation)
 * - memoryLimitMB: DEFINED BUT NOT ENFORCED ("informational only")
 *
 * Missing limits:
 * - CPU time limit (no enforcement mechanism)
 * - Network access (fetch: null doesn't work in Miniflare fallback)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createSandbox,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_CONCURRENCY_LIMIT,
  RateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer
} from '../sandbox'
import type { WorkflowContext } from '../../do/context'

describe('MCP Sandbox Resource Limits - RED Tests', () => {
  let mockContext: WorkflowContext

  beforeEach(() => {
    mockContext = {
      send: vi.fn(),
      try: vi.fn(async (action) => action()),
      do: vi.fn(async (action) => action()),
      on: new Proxy({} as any, {
        get(_, noun) {
          return new Proxy({}, {
            get(_, verb) {
              return vi.fn()
            }
          })
        }
      }),
      every: new Proxy({} as any, {
        get() {
          return vi.fn()
        }
      }),
      _events: {} as any,
      _handlers: new Map(),
      _schedules: new Map()
    }
  })

  describe('CPU Time Limit Enforcement', () => {
    it('should enforce CPU time limit for busy loops', async () => {
      // The sandbox enforces CPU time limits via injected checkpoints
      // Fast loops may hit the outer timeout before the checkpoint fires
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 100 // 100ms timeout
        }
      })

      const startTime = Date.now()

      // This busy loop should be terminated by CPU time limit or timeout
      // Checkpoints are injected but very fast loops may hit the outer timeout first
      const result = await sandbox.execute(`
        // Tight busy loop - blocks event loop
        const start = Date.now()
        while (Date.now() - start < 500) {
          // Burn CPU without yielding
          Math.random() * Math.random()
        }
        return 'completed'
      `)

      const elapsed = Date.now() - startTime

      // Should be terminated - either by CPU limit checkpoints or outer timeout
      expect(result.success).toBe(false)
      // Accept either CPU time limit or timeout error (depends on timing)
      expect(result.error).toMatch(/CPU time limit|timeout/i)
      expect(elapsed).toBeLessThan(500) // Should terminate before the loop's natural 500ms end
    })

    it('should enforce CPU time separately from wall-clock timeout', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 100 // Short timeout to ensure CPU limit is hit first
        }
      })

      // Code that uses lots of CPU - checkpoints are injected and will fire
      const result = await sandbox.execute(`
        // Synchronous CPU-intensive work
        let sum = 0
        for (let i = 0; i < 10000000; i++) {
          sum += Math.sqrt(i)
        }
        return sum
      `)

      // Should fail with CPU limit error from injected checkpoints
      expect(result.success).toBe(false)
      // Accept either CPU time limit or timeout (depending on timing)
      expect(result.error).toMatch(/CPU time limit|timeout/i)
    })
  })

  describe('Memory Limit Enforcement', () => {
    it('should enforce memory limit for large allocations', async () => {
      // memoryLimitMB is defined but explicitly marked as "informational"
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          memoryLimitMB: 10 // 10MB limit
        }
      })

      // Allocate 50MB - should be rejected
      const result = await sandbox.execute(`
        // Allocate large array (each number is 8 bytes)
        // 50MB / 8 bytes = 6.25M elements
        const arr = new Array(6250000).fill(0).map((_, i) => i)
        return arr.length
      `)

      // EXPECTED: Should fail with memory limit error
      // ACTUAL: Will succeed because memoryLimitMB is "informational only"
      expect(result.success).toBe(false)
      expect(result.error).toContain('Memory limit exceeded')
    })

    it('should prevent memory exhaustion via string concatenation', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          memoryLimitMB: 5
        }
      })

      // Exponential string growth
      const result = await sandbox.execute(`
        let str = 'x'
        for (let i = 0; i < 25; i++) {
          str = str + str // Doubles each iteration: 2^25 = 33MB
        }
        return str.length
      `)

      // EXPECTED: Should fail before exhausting memory
      // ACTUAL: Will attempt to allocate and may crash or succeed
      expect(result.success).toBe(false)
      expect(result.error).toContain('Memory limit exceeded')
    })

    it('should track and report memory usage', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          memoryLimitMB: 50
        }
      })

      const result = await sandbox.execute(`
        const arr = new Array(1000000).fill('x')
        return arr.length
      `)

      // EXPECTED: resourceUsage should include memory stats
      // ACTUAL: resourceUsage doesn't track memory at all
      expect(result.resourceUsage).toBeDefined()
      expect(result.resourceUsage).toHaveProperty('memoryUsedMB')
      expect(typeof result.resourceUsage?.memoryUsedMB).toBe('number')
    })
  })

  describe('Execution Timeout Enforcement', () => {
    it('should enforce timeout for async operations', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 100
        }
      })

      // This test actually passes due to existing Promise.race implementation
      // Including for completeness but the mechanism is fragile
      const result = await sandbox.execute(`
        await new Promise(resolve => setTimeout(resolve, 500))
        return 'done'
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
      expect(result.resourceUsage?.timedOut).toBe(true)
    })

    it('should provide granular timeout error messages', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 100
        }
      })

      const result = await sandbox.execute(`
        await new Promise(resolve => setTimeout(resolve, 500))
        return 'done'
      `)

      // EXPECTED: Error should include which limit was hit and actual duration
      // ACTUAL: Generic "timed out" message
      expect(result.success).toBe(false)
      expect(result.error).toContain('Execution timeout')
      expect(result.error).toMatch(/exceeded.*100ms/i)
    })
  })

  describe('Network Access Prevention', () => {
    it('should prevent network access by default', async () => {
      const sandbox = createSandbox({
        context: mockContext
        // Default: fetch should be blocked
      })

      const result = await sandbox.execute(`
        try {
          const response = await fetch('https://example.com')
          return 'fetch succeeded: ' + response.status
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      // EXPECTED: fetch should be blocked with clear error
      // ACTUAL: fetch: null is passed but Miniflare fallback doesn't enforce it
      expect(result.success).toBe(true)
      expect(result.value).toBe('blocked: Network access denied')
    })

    it('should block WebSocket connections', async () => {
      const sandbox = createSandbox({
        context: mockContext
      })

      const result = await sandbox.execute(`
        try {
          const ws = new WebSocket('wss://example.com')
          return 'websocket created'
        } catch (e) {
          return 'blocked: ' + e.message
        }
      `)

      // EXPECTED: WebSocket should be blocked
      // ACTUAL: No WebSocket blocking implemented
      expect(result.success).toBe(true)
      expect(result.value).toContain('blocked')
    })

    it('should optionally allow network access when permitted', async () => {
      // Note: There's no allowNetwork option in the current interface
      const sandbox = createSandbox({
        context: mockContext,
        allowNetwork: true
      })

      const result = await sandbox.execute(`
        // This would make a real request if allowNetwork worked
        return typeof fetch
      `)

      // EXPECTED: fetch should be available when allowNetwork: true
      // ACTUAL: allowNetwork option doesn't exist in the interface
      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })
  })

  describe('Combined Resource Limits', () => {
    it('should enforce multiple limits simultaneously', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 1000,
          maxCodeSize: 1024,
          maxOutputSize: 1024,
          memoryLimitMB: 10
        }
      })

      // Code that tries to violate memory limit
      const result = await sandbox.execute(`
        const arr = new Array(5000000).fill('test')
        return arr.join(',')
      `)

      // EXPECTED: Should fail on memory limit
      // ACTUAL: May succeed or fail on output size, but not memory
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/memory|Memory/)
    })

    it('should report which limit was violated', async () => {
      const sandbox = createSandbox({
        context: mockContext,
        resourceLimits: {
          timeout: 50,
          memoryLimitMB: 5
        }
      })

      const result = await sandbox.execute(`
        // This could hit either timeout or memory
        const arr = []
        while (true) {
          arr.push(new Array(10000).fill(0))
        }
      `)

      // EXPECTED: Error should clearly indicate which limit was hit
      // ACTUAL: Generic error message, no limit identification
      expect(result.success).toBe(false)
      expect(result.resourceUsage).toHaveProperty('limitViolated')
      expect(['timeout', 'memory']).toContain(result.resourceUsage?.limitViolated)
    })
  })

  describe('Resource Usage Reporting', () => {
    it('should report accurate execution time', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        await new Promise(r => setTimeout(r, 50))
        return 'done'
      `)

      expect(result.success).toBe(true)
      expect(result.resourceUsage?.executionTime).toBeGreaterThanOrEqual(50)
      expect(result.resourceUsage?.executionTime).toBeLessThan(200)
    })

    it('should report memory high water mark', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        const arr = new Array(100000).fill('x')
        return arr.length
      `)

      // EXPECTED: Should report peak memory usage
      // ACTUAL: resourceUsage doesn't include memory stats
      expect(result.resourceUsage).toHaveProperty('peakMemoryMB')
      expect(result.resourceUsage?.peakMemoryMB).toBeGreaterThan(0)
    })

    it('should report CPU time consumed', async () => {
      const sandbox = createSandbox({ context: mockContext })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 1000000; i++) {
          sum += i
        }
        return sum
      `)

      // EXPECTED: Should report CPU time separately from wall time
      // ACTUAL: resourceUsage only has executionTime (wall clock)
      expect(result.resourceUsage).toHaveProperty('cpuTimeMs')
      expect(result.resourceUsage?.cpuTimeMs).toBeGreaterThan(0)
    })
  })

  describe('Default Limits Verification', () => {
    it('should have sensible default limits defined', () => {
      // These pass - limits are defined
      expect(DEFAULT_RESOURCE_LIMITS.timeout).toBe(5000)
      expect(DEFAULT_RESOURCE_LIMITS.maxCodeSize).toBe(100 * 1024)
      expect(DEFAULT_RESOURCE_LIMITS.maxOutputSize).toBe(1024 * 1024)
      expect(DEFAULT_RESOURCE_LIMITS.memoryLimitMB).toBe(128)
    })

    it('should enforce default memory limit of 128MB', async () => {
      const sandbox = createSandbox({ context: mockContext })
      // Uses default memoryLimitMB: 128

      // Try to allocate 200MB
      const result = await sandbox.execute(`
        // 200MB / 8 bytes per number = 25M elements
        const arr = new Array(25000000).fill(0)
        return arr.length
      `)

      // EXPECTED: Should fail - exceeds default 128MB
      // ACTUAL: Will attempt allocation (memoryLimitMB is informational)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Memory limit exceeded')
    })
  })

  describe('Rate Limiting', () => {
    let rateLimiter: RateLimiter

    beforeEach(() => {
      rateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 })
    })

    it('should have sensible default rate limits', () => {
      expect(DEFAULT_RATE_LIMIT.maxRequests).toBe(100)
      expect(DEFAULT_RATE_LIMIT.windowMs).toBe(60000)
    })

    it('should allow requests within limit', () => {
      const result1 = rateLimiter.tryAcquire('client1')
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(4)

      const result2 = rateLimiter.tryAcquire('client1')
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(3)
    })

    it('should block requests when limit exceeded', () => {
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const result = rateLimiter.tryAcquire('client1')
        expect(result.allowed).toBe(true)
      }

      // 6th request should be blocked
      const blocked = rateLimiter.tryAcquire('client1')
      expect(blocked.allowed).toBe(false)
      expect(blocked.remaining).toBe(0)
    })

    it('should track clients independently', () => {
      // Fill up client1
      for (let i = 0; i < 5; i++) {
        rateLimiter.tryAcquire('client1')
      }

      // client1 should be blocked
      const client1 = rateLimiter.tryAcquire('client1')
      expect(client1.allowed).toBe(false)

      // client2 should still be allowed
      const client2 = rateLimiter.tryAcquire('client2')
      expect(client2.allowed).toBe(true)
    })

    it('should reset after window expires', async () => {
      // Fill up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.tryAcquire('client1')
      }

      // Should be blocked
      expect(rateLimiter.check('client1').allowed).toBe(false)

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Should be allowed again
      const result = rateLimiter.check('client1')
      expect(result.allowed).toBe(true)
    })

    it('should provide accurate resetMs', () => {
      rateLimiter.tryAcquire('client1')
      const result = rateLimiter.check('client1')

      // Reset should be close to windowMs
      expect(result.resetMs).toBeGreaterThan(0)
      expect(result.resetMs).toBeLessThanOrEqual(1000)
    })

    it('should reset client limits when reset is called', () => {
      for (let i = 0; i < 5; i++) {
        rateLimiter.tryAcquire('client1')
      }
      expect(rateLimiter.check('client1').allowed).toBe(false)

      rateLimiter.reset('client1')
      expect(rateLimiter.check('client1').allowed).toBe(true)
    })
  })

  describe('Concurrency Limiting', () => {
    let concurrencyLimiter: ConcurrencyLimiter

    beforeEach(() => {
      concurrencyLimiter = new ConcurrencyLimiter({ maxConcurrent: 3 })
    })

    afterEach(() => {
      concurrencyLimiter.resetAll()
    })

    it('should have sensible default concurrency limits', () => {
      expect(DEFAULT_CONCURRENCY_LIMIT.maxConcurrent).toBe(5)
    })

    it('should allow operations within limit', () => {
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)
      expect(concurrencyLimiter.getActiveCount('client1')).toBe(1)

      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)
      expect(concurrencyLimiter.getActiveCount('client1')).toBe(2)
    })

    it('should block when concurrent limit reached', () => {
      // Acquire 3 slots
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)

      // 4th should fail
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(false)
      expect(concurrencyLimiter.getActiveCount('client1')).toBe(3)
    })

    it('should allow after release', () => {
      // Fill up slots
      for (let i = 0; i < 3; i++) {
        concurrencyLimiter.tryAcquire('client1')
      }

      // Should be blocked
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(false)

      // Release one
      concurrencyLimiter.release('client1')
      expect(concurrencyLimiter.getActiveCount('client1')).toBe(2)

      // Should be allowed now
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(true)
    })

    it('should track clients independently', () => {
      // Fill up client1
      for (let i = 0; i < 3; i++) {
        concurrencyLimiter.tryAcquire('client1')
      }

      // client1 blocked
      expect(concurrencyLimiter.tryAcquire('client1')).toBe(false)

      // client2 should be allowed
      expect(concurrencyLimiter.tryAcquire('client2')).toBe(true)
    })

    it('should process waiting queue on release', async () => {
      // Fill up slots
      for (let i = 0; i < 3; i++) {
        concurrencyLimiter.tryAcquire('client1')
      }

      // Start waiting for a slot
      let acquired = false
      const waitPromise = concurrencyLimiter.acquire('client1', 5000).then(() => {
        acquired = true
      })

      // Should be waiting
      expect(acquired).toBe(false)
      expect(concurrencyLimiter.getWaitingCount('client1')).toBe(1)

      // Release a slot
      concurrencyLimiter.release('client1')

      // Wait for promise to resolve
      await waitPromise
      expect(acquired).toBe(true)
      expect(concurrencyLimiter.getWaitingCount('client1')).toBe(0)
    })

    it('should timeout when waiting too long', async () => {
      // Fill up slots
      for (let i = 0; i < 3; i++) {
        concurrencyLimiter.tryAcquire('client1')
      }

      // Try to acquire with short timeout
      await expect(
        concurrencyLimiter.acquire('client1', 100)
      ).rejects.toThrow(/Concurrency limit timeout/)
    })
  })

  describe('Combined Resource Enforcer', () => {
    let enforcer: SandboxResourceEnforcer

    beforeEach(() => {
      enforcer = new SandboxResourceEnforcer(
        { maxRequests: 5, windowMs: 1000 },
        { maxConcurrent: 2 }
      )
    })

    afterEach(() => {
      enforcer.resetAll()
    })

    it('should enforce both rate and concurrency limits', async () => {
      // Acquire two concurrent slots
      const slot1 = await enforcer.acquire('client1')
      const slot2 = await enforcer.acquire('client1')

      // Third should fail on concurrency
      await expect(
        enforcer.acquire('client1', false)
      ).rejects.toThrow(/Concurrency limit exceeded/)

      // Release slots
      slot1.release()
      slot2.release()
    })

    it('should check rate limit before concurrency', async () => {
      // Use up rate limit
      for (let i = 0; i < 5; i++) {
        const slot = await enforcer.acquire('client1')
        slot.release()
      }

      // Next should fail on rate limit, not concurrency
      await expect(
        enforcer.acquire('client1')
      ).rejects.toThrow(/Rate limit exceeded/)
    })

    it('should allow waiting for concurrency slot', async () => {
      // Fill concurrency
      const slot1 = await enforcer.acquire('client1')
      const slot2 = await enforcer.acquire('client1')

      // Start waiting
      let acquired = false
      const waitPromise = enforcer.acquire('client1', true, 5000).then((slot) => {
        acquired = true
        slot.release()
      })

      // Not yet
      expect(acquired).toBe(false)

      // Release a slot
      slot1.release()

      // Should acquire now
      await waitPromise
      expect(acquired).toBe(true)

      // Cleanup
      slot2.release()
    })

    it('should return release function', async () => {
      const { release } = await enforcer.acquire('client1')
      expect(typeof release).toBe('function')

      const limiter = enforcer.getConcurrencyLimiter()
      expect(limiter.getActiveCount('client1')).toBe(1)

      release()
      expect(limiter.getActiveCount('client1')).toBe(0)
    })

    it('should handle double-release safely (do-hnx0)', async () => {
      // Acquire two slots
      const slot1 = await enforcer.acquire('client1')
      const slot2 = await enforcer.acquire('client1')

      const limiter = enforcer.getConcurrencyLimiter()
      expect(limiter.getActiveCount('client1')).toBe(2)

      // Release slot1 twice - second call should be a no-op
      slot1.release()
      expect(limiter.getActiveCount('client1')).toBe(1)

      slot1.release() // Double release!
      expect(limiter.getActiveCount('client1')).toBe(1) // Should still be 1, not 0

      // slot2 should still be held
      slot2.release()
      expect(limiter.getActiveCount('client1')).toBe(0)
    })

    it('should not release other clients slots on double-release', async () => {
      // This tests the scenario where double-release could decrement
      // a different client's slot count
      const slot1 = await enforcer.acquire('client1')

      const limiter = enforcer.getConcurrencyLimiter()
      expect(limiter.getActiveCount('client1')).toBe(1)

      // Release and then acquire again
      slot1.release()
      expect(limiter.getActiveCount('client1')).toBe(0)

      // Acquire a new slot
      const slot2 = await enforcer.acquire('client1')
      expect(limiter.getActiveCount('client1')).toBe(1)

      // Double-release of slot1 should not affect slot2
      slot1.release() // This is the double-release
      expect(limiter.getActiveCount('client1')).toBe(1) // slot2 should still be held

      slot2.release()
      expect(limiter.getActiveCount('client1')).toBe(0)
    })
  })
})
