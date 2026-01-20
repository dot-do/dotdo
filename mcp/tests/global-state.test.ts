// TDD test for do-1oer: Fix global mutable state in resource registry
// RED: Tests demonstrating state leakage between requests in Workers environment
//
// Problem: Global mutable state (globalEnforcer) in sandbox.ts causes issues
// where multiple requests share module scope in Workers runtime.
//
// Solution: Use createScopedResourceEnforcer() to create isolated enforcers
// per DO instance or request context.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  RateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer,
  getGlobalResourceEnforcer,
  setGlobalResourceEnforcer,
  createScopedResourceEnforcer
} from '../sandbox'

describe('Global State Leakage (do-1oer)', () => {
  describe('RED: RateLimiter state leakage between requests', () => {
    it('should NOT share rate limit state between independent requests', () => {
      // Scenario: Two different tenant requests hit the same Worker
      // They should NOT share rate limiting state

      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 })

      // Tenant A makes 2 requests (exhausting their limit)
      limiter.record('tenant-a')
      limiter.record('tenant-a')
      const checkA = limiter.check('tenant-a')
      expect(checkA.allowed).toBe(false)

      // Tenant B should have their own independent limit
      const checkB = limiter.check('tenant-b')
      expect(checkB.allowed).toBe(true) // This passes - separate by clientId

      // But if we share the same limiter instance globally...
      // The state persists between request lifecycles
    })

    it('should demonstrate global enforcer persistence across simulated requests', () => {
      // This test simulates the problem: global state persists

      // Request 1: Get global enforcer and use it
      const enforcer1 = getGlobalResourceEnforcer()
      const rateLimiter = enforcer1.getRateLimiter()

      // Exhaust rate limit for client-x
      for (let i = 0; i < 100; i++) {
        rateLimiter.record('client-x')
      }

      // Request 2: A "new" request gets the SAME global enforcer
      const enforcer2 = getGlobalResourceEnforcer()

      // BUG: enforcer1 === enforcer2 (same instance!)
      // The rate limit state from request 1 leaked into request 2
      expect(enforcer1).toBe(enforcer2) // This proves they're the same instance

      const check = enforcer2.getRateLimiter().check('client-x')
      expect(check.allowed).toBe(false) // Rate limit from "previous request" leaked!
    })

    it('should isolate state when using request-scoped enforcers', () => {
      // SOLUTION: Create a new enforcer per request/DO instance

      // Simulated Request 1
      const enforcer1 = new SandboxResourceEnforcer()
      for (let i = 0; i < 100; i++) {
        enforcer1.getRateLimiter().record('client-x')
      }
      const check1 = enforcer1.getRateLimiter().check('client-x')
      expect(check1.allowed).toBe(false) // Rate limited

      // Simulated Request 2 - fresh enforcer
      const enforcer2 = new SandboxResourceEnforcer()
      const check2 = enforcer2.getRateLimiter().check('client-x')
      expect(check2.allowed).toBe(true) // Not rate limited - isolated state!

      // These are different instances
      expect(enforcer1).not.toBe(enforcer2)
    })
  })

  describe('RED: ConcurrencyLimiter state leakage', () => {
    it('should demonstrate concurrency state leakage via global enforcer', () => {
      // Request 1: Acquire all concurrency slots
      const enforcer1 = getGlobalResourceEnforcer()
      const concurrencyLimiter = enforcer1.getConcurrencyLimiter()

      // Take all 5 slots for client-y
      for (let i = 0; i < 5; i++) {
        concurrencyLimiter.tryAcquire('client-y')
      }

      // Request 2: Same global enforcer
      const enforcer2 = getGlobalResourceEnforcer()

      // BUG: Can't acquire slot because state leaked from request 1
      const acquired = enforcer2.getConcurrencyLimiter().tryAcquire('client-y')
      expect(acquired).toBe(false) // Leaked state blocks new request!
    })
  })

  describe('RED: Global enforcer singleton behavior', () => {
    let originalEnforcer: SandboxResourceEnforcer | null

    beforeEach(() => {
      // Save original state
      originalEnforcer = getGlobalResourceEnforcer()
    })

    afterEach(() => {
      // Restore/cleanup
      setGlobalResourceEnforcer(null)
    })

    it('should return the same instance on multiple calls', () => {
      setGlobalResourceEnforcer(null) // Reset

      const first = getGlobalResourceEnforcer()
      const second = getGlobalResourceEnforcer()

      // This is the PROBLEM - it's a singleton
      expect(first).toBe(second)
    })

    it('should allow manual cleanup via setGlobalResourceEnforcer(null)', () => {
      const before = getGlobalResourceEnforcer()
      before.getRateLimiter().record('test-client')

      // Manual cleanup
      setGlobalResourceEnforcer(null)

      const after = getGlobalResourceEnforcer()
      expect(after).not.toBe(before)

      // State was cleaned up
      const check = after.getRateLimiter().check('test-client')
      expect(check.allowed).toBe(true)
    })
  })

  describe('GREEN: Request-scoped enforcer pattern', () => {
    it('should create isolated enforcers per request context', () => {
      // This is the CORRECT pattern: create enforcer per request/DO

      class MockDOWithScopedEnforcer {
        private enforcer: SandboxResourceEnforcer

        constructor() {
          // Each DO instance gets its own enforcer
          this.enforcer = new SandboxResourceEnforcer()
        }

        getEnforcer(): SandboxResourceEnforcer {
          return this.enforcer
        }
      }

      // Simulated parallel requests to different DO instances
      const do1 = new MockDOWithScopedEnforcer()
      const do2 = new MockDOWithScopedEnforcer()

      // DO1's rate limiting
      for (let i = 0; i < 100; i++) {
        do1.getEnforcer().getRateLimiter().record('user-1')
      }

      // DO2 is unaffected
      const check = do2.getEnforcer().getRateLimiter().check('user-1')
      expect(check.allowed).toBe(true)
    })

    it('should maintain state within a single DO lifecycle', () => {
      // Within a single DO, state SHOULD persist (this is correct behavior)

      const enforcer = new SandboxResourceEnforcer({
        maxRequests: 5,
        windowMs: 60000
      })

      // Same DO instance, multiple sandbox executions
      for (let i = 0; i < 5; i++) {
        enforcer.getRateLimiter().record('internal-user')
      }

      // Should be rate limited within the DO's lifetime
      const check = enforcer.getRateLimiter().check('internal-user')
      expect(check.allowed).toBe(false)
    })
  })

  describe('GREEN: DO-scoped enforcer integration', () => {
    it('should support dependency injection of enforcer', () => {
      // The createSandboxTool should accept an optional enforcer
      // Instead of using global state

      const customEnforcer = new SandboxResourceEnforcer({
        maxRequests: 10,
        windowMs: 1000
      })

      // Verify custom config is used
      const limiter = customEnforcer.getRateLimiter()

      // Should allow 10 requests
      for (let i = 0; i < 10; i++) {
        const result = limiter.tryAcquire('test')
        expect(result.allowed).toBe(true)
      }

      // 11th should fail
      const result = limiter.tryAcquire('test')
      expect(result.allowed).toBe(false)
    })
  })
})

describe('Cleanup between requests', () => {
  afterEach(() => {
    // Always clean up global state after tests
    setGlobalResourceEnforcer(null)
  })

  it('should support explicit cleanup for testing', () => {
    const enforcer = getGlobalResourceEnforcer()
    enforcer.getRateLimiter().record('test')

    // Clean up
    setGlobalResourceEnforcer(null)

    // Fresh state
    const fresh = getGlobalResourceEnforcer()
    const check = fresh.getRateLimiter().check('test')
    expect(check.allowed).toBe(true)
  })
})

describe('GREEN: createScopedResourceEnforcer (preferred pattern)', () => {
  it('should create isolated enforcer instances', () => {
    const enforcer1 = createScopedResourceEnforcer()
    const enforcer2 = createScopedResourceEnforcer()

    // Each call creates a new instance
    expect(enforcer1).not.toBe(enforcer2)
  })

  it('should accept custom rate limit configuration', () => {
    const enforcer = createScopedResourceEnforcer({
      maxRequests: 3,
      windowMs: 1000
    })

    const limiter = enforcer.getRateLimiter()

    // Should allow exactly 3 requests
    expect(limiter.tryAcquire('test').allowed).toBe(true)
    expect(limiter.tryAcquire('test').allowed).toBe(true)
    expect(limiter.tryAcquire('test').allowed).toBe(true)
    expect(limiter.tryAcquire('test').allowed).toBe(false)
  })

  it('should accept custom concurrency configuration', () => {
    const enforcer = createScopedResourceEnforcer(undefined, {
      maxConcurrent: 2
    })

    const limiter = enforcer.getConcurrencyLimiter()

    // Should allow exactly 2 concurrent
    expect(limiter.tryAcquire('test')).toBe(true)
    expect(limiter.tryAcquire('test')).toBe(true)
    expect(limiter.tryAcquire('test')).toBe(false)

    // Release one
    limiter.release('test')
    expect(limiter.tryAcquire('test')).toBe(true)
  })

  it('should isolate state between DO instances (simulated)', () => {
    // Simulate two DO instances each with their own enforcer
    class SimulatedDO {
      private enforcer: SandboxResourceEnforcer

      constructor() {
        this.enforcer = createScopedResourceEnforcer({ maxRequests: 2, windowMs: 60000 })
      }

      executeWithRateLimit(clientId: string): boolean {
        const result = this.enforcer.getRateLimiter().tryAcquire(clientId)
        return result.allowed
      }
    }

    const do1 = new SimulatedDO()
    const do2 = new SimulatedDO()

    // DO1 exhausts rate limit for user-a
    expect(do1.executeWithRateLimit('user-a')).toBe(true)
    expect(do1.executeWithRateLimit('user-a')).toBe(true)
    expect(do1.executeWithRateLimit('user-a')).toBe(false) // Rate limited

    // DO2 is completely isolated - user-a can still execute
    expect(do2.executeWithRateLimit('user-a')).toBe(true)
    expect(do2.executeWithRateLimit('user-a')).toBe(true)
    expect(do2.executeWithRateLimit('user-a')).toBe(false) // Now rate limited in DO2
  })

  it('should work with async acquire for queuing', async () => {
    const enforcer = createScopedResourceEnforcer(undefined, { maxConcurrent: 1 })

    // Acquire the only slot
    await enforcer.acquire('test', false)

    // Try to acquire with wait - should fail with short timeout
    try {
      await enforcer.acquire('test', true, 50) // 50ms timeout
      expect.fail('Should have thrown timeout error')
    } catch (error) {
      expect((error as Error).message).toContain('timeout')
    }
  })
})

describe('REFACTOR: Documentation of deprecated vs preferred patterns', () => {
  afterEach(() => {
    setGlobalResourceEnforcer(null)
  })

  it('deprecated: getGlobalResourceEnforcer shares state (DON\'T USE)', () => {
    // This test documents the problematic behavior
    const e1 = getGlobalResourceEnforcer()
    const e2 = getGlobalResourceEnforcer()

    // Same instance = shared state = BUG
    expect(e1).toBe(e2)
  })

  it('preferred: createScopedResourceEnforcer isolates state (USE THIS)', () => {
    // This test documents the correct pattern
    const e1 = createScopedResourceEnforcer()
    const e2 = createScopedResourceEnforcer()

    // Different instances = isolated state = CORRECT
    expect(e1).not.toBe(e2)
  })
})
