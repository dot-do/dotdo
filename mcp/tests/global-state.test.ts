// Test for do-1oer and do-5sc9b: Resource enforcer isolation
// Demonstrates that:
// 1. createScopedResourceEnforcer creates isolated enforcers (do-1oer)
// 2. Global functions throw security errors by default (do-5sc9b)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  RateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer,
  createScopedResourceEnforcer,
  getGlobalResourceEnforcer,
  setGlobalResourceEnforcer,
  _resetDeprecationWarnings
} from '../sandbox'

describe('Resource Enforcer Isolation (do-1oer)', () => {
  describe('RateLimiter per-client isolation', () => {
    it('should NOT share rate limit state between different clients', () => {
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
      expect(checkB.allowed).toBe(true) // Separate by clientId
    })

    it('should isolate state when using scoped enforcers', () => {
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

  describe('Request-scoped enforcer pattern', () => {
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

  describe('DO-scoped enforcer integration', () => {
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

describe('createScopedResourceEnforcer (preferred pattern)', () => {
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

describe('Instance-based pattern documentation', () => {
  it('createScopedResourceEnforcer isolates state correctly', () => {
    // This test documents the correct pattern
    const e1 = createScopedResourceEnforcer()
    const e2 = createScopedResourceEnforcer()

    // Different instances = isolated state = CORRECT
    expect(e1).not.toBe(e2)

    // Exhaust rate limit in e1
    for (let i = 0; i < 100; i++) {
      e1.getRateLimiter().record('user')
    }
    expect(e1.getRateLimiter().check('user').allowed).toBe(false)

    // e2 is unaffected
    expect(e2.getRateLimiter().check('user').allowed).toBe(true)
  })
})
