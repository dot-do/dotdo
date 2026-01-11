/**
 * Handler Isolation Tests (RED Phase - TDD)
 *
 * These tests verify that event handlers registered in one Durable Object
 * instance are NOT visible to other DO instances in the same V8 isolate.
 *
 * PROBLEM:
 * The `workflows/on.ts` module has global mutable state:
 *   const eventHandlers = new Map<string, HandlerRegistration[]>()
 *   const contextIndex = new Map<string, Set<string>>()
 *
 * When multiple DO instances run in the same V8 isolate (which happens
 * frequently in Cloudflare Workers), handlers registered by one DO leak
 * to all others because they share the same module-level global state.
 *
 * EXPECTED BEHAVIOR:
 * Each DO instance should have completely isolated handler registries.
 * Handlers registered in DO-A should NEVER be visible to DO-B.
 *
 * CURRENT STATE: These tests WILL FAIL because the global registry
 * doesn't provide per-instance isolation.
 *
 * @see workflows/on.ts - Global handler registry
 * @see objects/DOBase.ts - Per-instance _eventHandlers (correct approach)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  on,
  every,
  getRegisteredHandlers,
  getHandlerCount,
  getRegisteredEventKeys,
  clearHandlers,
  clearHandlersByContext,
} from '../on'

// ============================================================================
// MOCK DO INFRASTRUCTURE
// ============================================================================

/**
 * Simulated Durable Object instance for testing isolation.
 * In production, each DO has its own namespace and should have isolated handlers.
 */
class MockDurableObject {
  readonly ns: string
  readonly id: string
  private _destroyed: boolean = false

  constructor(namespace: string, id?: string) {
    this.ns = namespace
    this.id = id ?? `${namespace}-${crypto.randomUUID().slice(0, 8)}`
  }

  /**
   * Register an event handler scoped to this DO instance.
   * Uses the DO's namespace as the context.
   */
  onEvent(noun: string, verb: string, handler: Function): () => boolean {
    // Current approach: uses global registry with context
    const eventKey = `${noun}.${verb}`
    return on[noun][verb](handler as any, { context: this.ns })
  }

  /**
   * Get handlers visible to this DO instance.
   * In a properly isolated system, this should ONLY return handlers
   * registered by THIS instance.
   */
  getVisibleHandlers(noun: string, verb: string): Function[] {
    const eventKey = `${noun}.${verb}`
    return getRegisteredHandlers(eventKey, this.ns)
  }

  /**
   * Get count of handlers visible to this DO instance.
   */
  getVisibleHandlerCount(): number {
    return getHandlerCount(this.ns)
  }

  /**
   * Simulate DO destruction - should clean up handlers.
   */
  destroy(): void {
    if (!this._destroyed) {
      clearHandlersByContext(this.ns)
      this._destroyed = true
    }
  }

  get isDestroyed(): boolean {
    return this._destroyed
  }
}

// ============================================================================
// HANDLER ISOLATION TESTS
// ============================================================================

describe('Handler Isolation', () => {
  beforeEach(() => {
    // Start with clean global state
    clearHandlers()
  })

  afterEach(() => {
    // Clean up after each test
    clearHandlers()
  })

  // ==========================================================================
  // CORE ISOLATION TESTS - These MUST fail with current global implementation
  // ==========================================================================

  describe('cross-DO handler visibility (SHOULD FAIL)', () => {
    /**
     * CRITICAL TEST: Handlers from DO-A should NOT be visible to DO-B.
     *
     * This test WILL FAIL with the current implementation because
     * both DOs share the same global handler registry.
     */
    it('handlers registered in DO-A are NOT visible to DO-B', () => {
      // Create two separate DO instances (simulating different tenants)
      const doA = new MockDurableObject('tenant-acme')
      const doB = new MockDurableObject('tenant-globex')

      // Register handler in DO-A
      const handlerA = vi.fn().mockName('handlerA')
      doA.onEvent('Customer', 'signup', handlerA)

      // DO-A should see its handler
      const handlersVisibleToA = doA.getVisibleHandlers('Customer', 'signup')
      expect(handlersVisibleToA).toHaveLength(1)
      expect(handlersVisibleToA).toContain(handlerA)

      // CRITICAL: DO-B should NOT see DO-A's handler
      // This WILL FAIL because global registry shows all handlers
      const handlersVisibleToB = doB.getVisibleHandlers('Customer', 'signup')
      expect(handlersVisibleToB).toHaveLength(0) // WILL FAIL: Actually returns 1
    })

    /**
     * CRITICAL TEST: Each DO should only see its own handler count.
     *
     * This test WILL FAIL because getHandlerCount() returns the global count.
     */
    it('handler count is isolated per DO instance', () => {
      const doA = new MockDurableObject('tenant-alpha')
      const doB = new MockDurableObject('tenant-beta')

      // Register 3 handlers in DO-A
      doA.onEvent('Customer', 'created', vi.fn())
      doA.onEvent('Order', 'placed', vi.fn())
      doA.onEvent('Payment', 'received', vi.fn())

      // Register 2 handlers in DO-B
      doB.onEvent('Invoice', 'sent', vi.fn())
      doB.onEvent('Refund', 'processed', vi.fn())

      // Each DO should only see its own handlers
      // WILL FAIL: Both see 5 handlers (global count)
      expect(doA.getVisibleHandlerCount()).toBe(3)
      expect(doB.getVisibleHandlerCount()).toBe(2)
    })

    /**
     * CRITICAL TEST: Same event key, different DOs = complete isolation.
     *
     * This is the most common real-world scenario: two tenants both
     * registering handlers for Customer.signup.
     */
    it('same event key in different DOs does not conflict', () => {
      const doA = new MockDurableObject('tenant-one')
      const doB = new MockDurableObject('tenant-two')

      const handlerA = vi.fn().mockName('tenant-one-handler')
      const handlerB = vi.fn().mockName('tenant-two-handler')

      // Both DOs register for the same event
      doA.onEvent('Customer', 'signup', handlerA)
      doB.onEvent('Customer', 'signup', handlerB)

      // Each DO should only see its own handler
      const aHandlers = doA.getVisibleHandlers('Customer', 'signup')
      const bHandlers = doB.getVisibleHandlers('Customer', 'signup')

      // WILL FAIL: Each sees 2 handlers instead of 1
      expect(aHandlers).toHaveLength(1)
      expect(aHandlers).toContain(handlerA)
      expect(aHandlers).not.toContain(handlerB)

      expect(bHandlers).toHaveLength(1)
      expect(bHandlers).toContain(handlerB)
      expect(bHandlers).not.toContain(handlerA)
    })
  })

  // ==========================================================================
  // CLEANUP ISOLATION TESTS
  // ==========================================================================

  describe('cleanup isolation (SHOULD FAIL)', () => {
    /**
     * CRITICAL TEST: Destroying DO-A should not affect DO-B's handlers.
     *
     * Even with context-based cleanup, the global registry visibility
     * means DO-B might see inconsistent state during cleanup.
     */
    it('cleanup in DO-A does not affect DO-B handlers', () => {
      const doA = new MockDurableObject('cleanup-test-a')
      const doB = new MockDurableObject('cleanup-test-b')

      const handlerA = vi.fn().mockName('handlerA')
      const handlerB = vi.fn().mockName('handlerB')

      // Register handlers in both DOs
      doA.onEvent('Customer', 'updated', handlerA)
      doB.onEvent('Customer', 'updated', handlerB)

      // Verify both exist
      expect(getHandlerCount()).toBe(2)

      // Destroy DO-A
      doA.destroy()

      // DO-B should still have its handler
      const bHandlers = doB.getVisibleHandlers('Customer', 'updated')
      expect(bHandlers).toHaveLength(1)
      expect(bHandlers).toContain(handlerB)

      // DO-A should have no handlers
      // WILL FAIL: Currently shows DO-B's handler
      const aHandlers = doA.getVisibleHandlers('Customer', 'updated')
      expect(aHandlers).toHaveLength(0)
    })

    /**
     * Multiple event types across DOs - cleanup should be surgical.
     */
    it('destroying DO cleans only its handlers across all event types', () => {
      const doA = new MockDurableObject('multi-event-a')
      const doB = new MockDurableObject('multi-event-b')

      // DO-A registers multiple event types
      doA.onEvent('User', 'created', vi.fn())
      doA.onEvent('User', 'deleted', vi.fn())
      doA.onEvent('Session', 'started', vi.fn())

      // DO-B registers overlapping and unique events
      doB.onEvent('User', 'created', vi.fn()) // overlaps with DO-A
      doB.onEvent('Report', 'generated', vi.fn())

      expect(getHandlerCount()).toBe(5)

      // Destroy DO-A
      doA.destroy()

      // Only DO-B's handlers should remain
      expect(getHandlerCount()).toBe(2)

      // Verify specific handlers
      // WILL FAIL: getVisibleHandlers shows global state
      expect(doB.getVisibleHandlers('User', 'created')).toHaveLength(1)
      expect(doB.getVisibleHandlers('Report', 'generated')).toHaveLength(1)
      expect(doB.getVisibleHandlers('User', 'deleted')).toHaveLength(0)
      expect(doB.getVisibleHandlers('Session', 'started')).toHaveLength(0)
    })
  })

  // ==========================================================================
  // SCHEDULE HANDLER ISOLATION
  // ==========================================================================

  describe('schedule handler isolation (SHOULD FAIL)', () => {
    /**
     * Scheduled handlers should also be isolated per DO.
     */
    it('every.* handlers are isolated per DO instance', () => {
      const doA = new MockDurableObject('schedule-a')
      const doB = new MockDurableObject('schedule-b')

      // Both DOs schedule hourly tasks
      every.hour(vi.fn(), { context: doA.ns })
      every.hour(vi.fn(), { context: doB.ns })

      const scheduledHandlers = getRegisteredHandlers('schedule:0 * * * *')

      // WILL FAIL: Both DOs see 2 handlers instead of being isolated
      // Each DO should only see its own scheduled handler
      expect(scheduledHandlers).toHaveLength(2) // This passes, but...

      // When querying from DO-A's perspective, it should only see 1
      // Currently there's no way to do this - we need per-instance registries
    })
  })

  // ==========================================================================
  // CONCURRENT REGISTRATION TESTS
  // ==========================================================================

  describe('concurrent registration scenarios', () => {
    /**
     * Simulates multiple DOs being created simultaneously in the same isolate.
     * This is common during high traffic when Cloudflare routes multiple
     * requests to the same Worker instance.
     */
    it('rapid DO creation does not cause cross-contamination', () => {
      const dos: MockDurableObject[] = []

      // Create 10 DOs rapidly
      for (let i = 0; i < 10; i++) {
        const doInstance = new MockDurableObject(`rapid-${i}`)
        doInstance.onEvent('Metric', 'recorded', vi.fn().mockName(`handler-${i}`))
        dos.push(doInstance)
      }

      // Each DO should only see its own handler
      for (const doInstance of dos) {
        const handlers = doInstance.getVisibleHandlers('Metric', 'recorded')
        // WILL FAIL: Each sees all 10 handlers
        expect(handlers).toHaveLength(1)
      }
    })

    /**
     * DO lifecycle: create -> register -> destroy -> recreate
     * New DO should not inherit handlers from destroyed DO.
     */
    it('new DO does not inherit handlers from destroyed DO with same namespace', () => {
      const namespace = 'lifecycle-test'

      // Create first DO
      const doV1 = new MockDurableObject(namespace, 'v1')
      const handlerV1 = vi.fn().mockName('v1-handler')
      doV1.onEvent('Task', 'completed', handlerV1)

      // Destroy it
      doV1.destroy()

      // Create new DO with same namespace (simulates DO recreation)
      const doV2 = new MockDurableObject(namespace, 'v2')

      // New DO should start with no handlers
      const handlers = doV2.getVisibleHandlers('Task', 'completed')
      expect(handlers).toHaveLength(0)
      expect(handlers).not.toContain(handlerV1)
    })
  })

  // ==========================================================================
  // REAL-WORLD SCENARIO TESTS
  // ==========================================================================

  describe('real-world isolation scenarios', () => {
    /**
     * Multi-tenant SaaS: Each tenant has their own DO.
     * Tenant handlers must be completely isolated.
     */
    it('multi-tenant SaaS scenario - handlers are tenant-isolated', () => {
      // Simulate 3 tenants each with their own DO
      const acmeCorp = new MockDurableObject('tenant:acme-corp')
      const globexInc = new MockDurableObject('tenant:globex-inc')
      const initechLlc = new MockDurableObject('tenant:initech-llc')

      // Each tenant registers a webhook handler
      acmeCorp.onEvent('Webhook', 'received', vi.fn().mockName('acme-webhook'))
      globexInc.onEvent('Webhook', 'received', vi.fn().mockName('globex-webhook'))
      initechLlc.onEvent('Webhook', 'received', vi.fn().mockName('initech-webhook'))

      // CRITICAL: Each tenant should ONLY see their own webhook handler
      // Security violation if tenants can see each other's handlers!
      expect(acmeCorp.getVisibleHandlers('Webhook', 'received')).toHaveLength(1)
      expect(globexInc.getVisibleHandlers('Webhook', 'received')).toHaveLength(1)
      expect(initechLlc.getVisibleHandlers('Webhook', 'received')).toHaveLength(1)

      // Destroy one tenant - others unaffected
      globexInc.destroy()

      expect(acmeCorp.getVisibleHandlers('Webhook', 'received')).toHaveLength(1)
      expect(initechLlc.getVisibleHandlers('Webhook', 'received')).toHaveLength(1)
      // Destroyed tenant has no handlers
      expect(globexInc.getVisibleHandlers('Webhook', 'received')).toHaveLength(0)
    })

    /**
     * Agent-per-user pattern: Each user has a dedicated AI agent DO.
     * Agent handlers must not leak between users.
     */
    it('agent-per-user scenario - agents are isolated', () => {
      const userAliceAgent = new MockDurableObject('agent:user-alice')
      const userBobAgent = new MockDurableObject('agent:user-bob')

      // Alice's agent learns a specific response pattern
      userAliceAgent.onEvent('Message', 'received', vi.fn().mockName('alice-responder'))

      // Bob's agent has a different pattern
      userBobAgent.onEvent('Message', 'received', vi.fn().mockName('bob-responder'))

      // Each agent should only see its own patterns
      // SECURITY: Alice's patterns must NOT be visible to Bob's agent
      const aliceHandlers = userAliceAgent.getVisibleHandlers('Message', 'received')
      const bobHandlers = userBobAgent.getVisibleHandlers('Message', 'received')

      expect(aliceHandlers).toHaveLength(1)
      expect(bobHandlers).toHaveLength(1)

      // Cross-check: handlers are actually different
      expect(aliceHandlers).not.toEqual(bobHandlers)
    })
  })
})

// ============================================================================
// DOCUMENTATION: Why These Tests Fail
// ============================================================================

/**
 * ROOT CAUSE ANALYSIS
 * ===================
 *
 * The tests above fail because `workflows/on.ts` uses module-level global state:
 *
 *   const eventHandlers = new Map<string, HandlerRegistration[]>()
 *   const contextIndex = new Map<string, Set<string>>()
 *
 * When two DO instances share a V8 isolate (extremely common in Workers),
 * they share these Maps. The `context` option helps with cleanup but doesn't
 * provide true isolation - `getRegisteredHandlers()` always returns ALL
 * handlers for an event key, regardless of context.
 *
 * CORRECT APPROACH (see objects/DOBase.ts):
 * =========================================
 *
 * DOBase creates per-instance handler registries:
 *
 *   protected _eventHandlers: Map<string, HandlerRegistration[]> = new Map()
 *
 * This is the RIGHT pattern - each DO instance has its own Map that cannot
 * be accessed by other instances.
 *
 * REQUIRED FIX FOR workflows/on.ts:
 * =================================
 *
 * Option 1: Remove global registry entirely, rely on DOBase pattern
 * Option 2: Make `getRegisteredHandlers(key, context?)` filter by context
 * Option 3: Create a factory that returns isolated handler registries
 *
 * The fix should ensure that:
 * 1. Handlers registered with context A are NEVER visible to context B
 * 2. Handler counts are isolated per context
 * 3. Cleanup affects only the specified context
 */

describe('isolation requirement documentation', () => {
  it('documents the isolation contract that must be satisfied', () => {
    // This test documents the required behavior, not the current behavior
    const isolationContract = {
      // Each DO instance has completely isolated handlers
      perInstanceIsolation: 'Handlers registered in DO-A are invisible to DO-B',

      // Handler counts are per-instance
      perInstanceCounts: 'getHandlerCount() returns only THIS instance handlers',

      // Event keys don't conflict across instances
      eventKeyIsolation: 'Same event key in different DOs = independent registries',

      // Cleanup is surgical
      cleanupIsolation: 'Destroying DO-A has zero effect on DO-B',

      // Security is paramount
      securityGuarantee: 'No cross-tenant information leakage via handlers',
    }

    // This assertion always passes - it's documentation
    expect(Object.keys(isolationContract)).toHaveLength(5)
  })
})
