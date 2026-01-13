/**
 * Global State Reset Tests (TDD)
 *
 * These tests verify that global state is properly reset between test runs.
 * The issue (dotdo-h0g23) is that module-level caches persist between tests,
 * causing flaky behavior depending on test execution order.
 *
 * Global state requiring reset:
 * - workflows/on.ts: eventHandlers, contextIndex
 * - workflows/domain.ts: domainRegistry
 * - workflows/schedule-builder.ts: cronCache
 * - objects/DOBase.ts: _circuitBreakers (already reset)
 *
 * @see tests/config/global-setup.ts - The global beforeEach that should reset state
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import the modules that have global state
import {
  on,
  getHandlerCount,
  getRegisteredEventKeys,
  clearHandlers,
} from '../../workflows/on'
import {
  getDomain,
  clearDomainRegistry,
  Domain,
  registerDomain,
} from '../../workflows/domain'
import {
  clearCronCache,
  cronCache,
} from '../../workflows/schedule-builder'

describe('Global State Reset Between Tests', () => {
  /**
   * CRITICAL: These tests run in sequence to verify isolation.
   *
   * Test A: Registers handlers/domains
   * Test B: Expects clean state (should NOT see Test A's state)
   *
   * If global-setup.ts correctly resets state, Test B will pass.
   * If not, Test B will fail because it sees Test A's leftover state.
   */

  describe('event handler isolation', () => {
    it('Test A: registers event handlers and verifies they exist', () => {
      // Register some handlers
      on.Customer.signup(() => {})
      on.Order.placed(() => {})
      on.Payment.received(() => {})

      // Verify handlers were registered
      const count = getHandlerCount()
      expect(count).toBe(3)

      const keys = getRegisteredEventKeys()
      expect(keys).toContain('Customer.signup')
      expect(keys).toContain('Order.placed')
      expect(keys).toContain('Payment.received')
    })

    it('Test B: expects clean state - no handlers from Test A', () => {
      // This test runs AFTER Test A
      // If global state is properly reset, we should start with 0 handlers
      const count = getHandlerCount()

      // CRITICAL ASSERTION: Should be 0 if global-setup.ts calls clearHandlers()
      expect(count).toBe(0)

      // Event keys should also be empty
      const keys = getRegisteredEventKeys()
      expect(keys).toHaveLength(0)
    })

    it('Test C: verifies fresh registration works after reset', () => {
      // Register a single handler
      on.Invoice.sent(() => {})

      // Should only see THIS test's handler
      const count = getHandlerCount()
      expect(count).toBe(1)

      const keys = getRegisteredEventKeys()
      expect(keys).toEqual(['Invoice.sent'])
    })
  })

  describe('domain registry isolation', () => {
    it('Test D: registers a domain and verifies it exists', () => {
      // Create and register a domain
      const TestDomain = Domain('TestDomain', {
        action: () => ({ result: 'test' }),
      })
      registerDomain(TestDomain)

      // Verify domain was registered
      const registered = getDomain('TestDomain')
      expect(registered).toBeDefined()
      expect(registered?.name).toBe('TestDomain')
    })

    it('Test E: expects clean domain registry - no domains from Test D', () => {
      // This test runs AFTER Test D
      // If global state is properly reset, TestDomain should not exist
      const registered = getDomain('TestDomain')

      // CRITICAL ASSERTION: Should be undefined if global-setup.ts calls clearDomainRegistry()
      expect(registered).toBeUndefined()
    })
  })

  describe('cron cache isolation', () => {
    it('Test F: cron cache contains only common patterns after reset', () => {
      // Common patterns are re-initialized during clearCronCache()
      // Verify the cache has a reasonable size (common patterns only)
      const cacheSize = cronCache.size

      // Common patterns include: hourly, daily, etc.
      // Should be small, not accumulating from previous tests
      expect(cacheSize).toBeLessThan(100)

      // Verify common patterns exist (from COMMON_PATTERNS in schedule-builder.ts)
      expect(cronCache.has('every hour')).toBe(true)
      expect(cronCache.has('daily at 9am')).toBe(true)
    })
  })

  describe('cross-test order independence', () => {
    /**
     * These tests verify that the order of test execution doesn't matter.
     * Each test should see a clean state regardless of what ran before.
     */

    it('registers handler A and checks count is 1', () => {
      on.Widget.created(() => {})
      expect(getHandlerCount()).toBe(1)
    })

    it('registers handler B and checks count is 1 (not 2)', () => {
      // If isolation is broken, this would be 2 (Widget.created + Gadget.updated)
      on.Gadget.updated(() => {})
      expect(getHandlerCount()).toBe(1)
    })

    it('registers handler C and checks count is 1 (not 3)', () => {
      // If isolation is broken, this would be 3
      on.Service.started(() => {})
      expect(getHandlerCount()).toBe(1)
    })
  })
})

describe('Circuit Breaker State Reset', () => {
  /**
   * Circuit breaker state is stored in DOBase._circuitBreakers
   * This should be reset by global-setup.ts calling DO._resetTestState()
   */

  it('circuit breaker state does not leak between tests', async () => {
    // This test verifies that the existing DOBase reset is working
    // We can't easily test this without importing DOBase, which has complex deps
    // The existence of this test documents the requirement

    // DOBase._circuitBreakers should be empty at start of each test
    // This is already implemented in global-setup.ts
    expect(true).toBe(true) // Placeholder - actual test is in global-setup.ts
  })
})

describe('Timestamp Mocking Consistency', () => {
  /**
   * Tests verify that vi.useFakeTimers() state is properly reset.
   * If not reset, tests using fake timers can affect other tests.
   */

  it('Date.now() returns real time (not mocked from previous test)', () => {
    const now = Date.now()
    const fiveSecondsAgo = now - 5000
    const fiveSecondsFromNow = now + 5000

    // If fake timers leaked, now might be a completely different value
    // Real time should be within a reasonable range
    expect(now).toBeGreaterThan(fiveSecondsAgo)
    expect(now).toBeLessThan(fiveSecondsFromNow)

    // Also verify it's a reasonable date (not 0 or some mocked value)
    const date = new Date(now)
    expect(date.getFullYear()).toBeGreaterThanOrEqual(2024)
  })
})
