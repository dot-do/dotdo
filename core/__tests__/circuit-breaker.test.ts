/**
 * Circuit Breaker Persistence Tests - RED Phase
 *
 * Issue: do-ioi8 [RED] Circuit breaker persistence tests
 *
 * These tests verify that circuit breaker state persists across DO eviction
 * and can be recovered from corrupted state. The tests are written in TDD style
 * and are expected to FAIL initially as the persistence features are not yet
 * implemented.
 *
 * Circuit Breaker State Machine:
 * - CLOSED: Normal operation, tracking failures
 * - OPEN: Failing fast after threshold exceeded
 * - HALF-OPEN: Allowing probe calls after reset timeout
 *
 * Persistence Requirements:
 * 1. Circuit state persists to SQLite storage
 * 2. State can be restored after DO eviction/restart
 * 3. Configurable thresholds per operation/endpoint
 * 4. State transitions are logged for debugging
 * 5. Corrupted state should recover gracefully
 *
 * @see do-ioi8 - Circuit breaker persistence tests
 * @module core/__tests__/circuit-breaker.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types
// =============================================================================

/**
 * Persisted circuit breaker state stored in SQLite
 */
interface PersistedCircuitState {
  /** Circuit breaker identifier (operation/endpoint name) */
  id: string
  /** Current state: 'closed', 'open', or 'half_open' */
  state: 'closed' | 'open' | 'half_open'
  /** Number of consecutive failures */
  failure_count: number
  /** Number of consecutive successes (for half-open to closed transition) */
  success_count: number
  /** Timestamp when circuit was last opened */
  opened_at: number | null
  /** Timestamp of last failure */
  last_failure_at: number | null
  /** Timestamp of last state update */
  updated_at: number
  /** Configured failure threshold */
  failure_threshold: number
  /** Configured reset timeout in ms */
  reset_timeout_ms: number
}

/**
 * Circuit breaker configuration options
 */
interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number
  /** Time in ms before transitioning from open to half-open */
  resetTimeout: number
  /** Whether to persist state to storage */
  persist?: boolean
}

/**
 * DOCore stub interface with circuit breaker methods
 */
interface DOCoreCircuitBreakerStub {
  // Circuit breaker management
  createCircuitBreaker(id: string, config: CircuitBreakerConfig): Promise<{ success: boolean }>
  getCircuitBreakerState(id: string): Promise<PersistedCircuitState | null>
  recordCircuitFailure(id: string): Promise<{ state: string; failure_count: number }>
  recordCircuitSuccess(id: string): Promise<{ state: string; success_count: number }>
  resetCircuitBreaker(id: string): Promise<{ success: boolean }>

  // Direct state manipulation for testing
  setCircuitBreakerState(id: string, state: Partial<PersistedCircuitState>): Promise<void>

  // Persistence operations
  getAllCircuitBreakers(): Promise<PersistedCircuitState[]>
  clearAllCircuitBreakers(): Promise<void>

  // Lifecycle
  prepareHibernate(): Promise<void>
  wake(): Promise<void>

  // State manager access for direct SQLite verification
  getState(): {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<boolean>
    list(options?: { prefix?: string }): Promise<Record<string, unknown>>
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore stub for testing circuit breaker persistence
 */
function getDOStub(name: string): DOCoreCircuitBreakerStub {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id) as unknown as DOCoreCircuitBreakerStub
}

// =============================================================================
// 1. CIRCUIT BREAKER STATE PERSISTENCE
// =============================================================================

describe('Circuit Breaker Persistence', () => {
  describe('State persistence to SQLite storage', () => {
    it('should persist circuit breaker state when created', async () => {
      const stub = getDOStub('cb-persist-test-1')

      // Create a circuit breaker with persistence enabled
      await stub.createCircuitBreaker('external-api', {
        failureThreshold: 3,
        resetTimeout: 30000,
        persist: true,
      })

      // Verify state is persisted to storage
      const state = await stub.getCircuitBreakerState('external-api')

      expect(state).toBeDefined()
      expect(state?.id).toBe('external-api')
      expect(state?.state).toBe('closed')
      expect(state?.failure_count).toBe(0)
      expect(state?.failure_threshold).toBe(3)
      expect(state?.reset_timeout_ms).toBe(30000)
    })

    it('should persist state to SQLite directly', async () => {
      const stub = getDOStub('cb-persist-test-2')

      await stub.createCircuitBreaker('db-connection', {
        failureThreshold: 5,
        resetTimeout: 60000,
        persist: true,
      })

      // Verify via direct SQLite state access
      const stateManager = stub.getState()
      const storedState = await stateManager.get('circuit:db-connection')

      expect(storedState).toBeDefined()
      expect((storedState as PersistedCircuitState).state).toBe('closed')
    })

    it('should update persisted state on failure recording', async () => {
      const stub = getDOStub('cb-persist-test-3')

      await stub.createCircuitBreaker('payment-service', {
        failureThreshold: 3,
        resetTimeout: 30000,
        persist: true,
      })

      // Record a failure
      await stub.recordCircuitFailure('payment-service')

      // Verify persisted state is updated
      const state = await stub.getCircuitBreakerState('payment-service')

      expect(state?.failure_count).toBe(1)
      expect(state?.last_failure_at).toBeDefined()
      expect(state?.last_failure_at).toBeGreaterThan(0)
    })

    it('should persist open state after threshold exceeded', async () => {
      const stub = getDOStub('cb-persist-test-4')

      await stub.createCircuitBreaker('notification-api', {
        failureThreshold: 3,
        resetTimeout: 10000,
        persist: true,
      })

      // Record failures to exceed threshold
      await stub.recordCircuitFailure('notification-api')
      await stub.recordCircuitFailure('notification-api')
      await stub.recordCircuitFailure('notification-api')

      // Verify circuit is now open and persisted
      const state = await stub.getCircuitBreakerState('notification-api')

      expect(state?.state).toBe('open')
      expect(state?.failure_count).toBe(3)
      expect(state?.opened_at).toBeDefined()
      expect(state?.opened_at).toBeGreaterThan(0)
    })
  })

  describe('State recovery across DO eviction', () => {
    it('should restore circuit state after DO hibernation and wake', async () => {
      const stub = getDOStub('cb-recovery-test-1')

      // Create and open a circuit
      await stub.createCircuitBreaker('test-service', {
        failureThreshold: 2,
        resetTimeout: 30000,
        persist: true,
      })

      await stub.recordCircuitFailure('test-service')
      await stub.recordCircuitFailure('test-service')

      // Verify circuit is open
      const beforeHibernate = await stub.getCircuitBreakerState('test-service')
      expect(beforeHibernate?.state).toBe('open')

      // Simulate DO eviction (hibernation)
      await stub.prepareHibernate()

      // Wake up DO
      await stub.wake()

      // Circuit state should be restored
      const afterWake = await stub.getCircuitBreakerState('test-service')

      expect(afterWake?.state).toBe('open')
      expect(afterWake?.failure_count).toBe(2)
      expect(afterWake?.opened_at).toBe(beforeHibernate?.opened_at)
    })

    it('should restore multiple circuit breakers after recovery', async () => {
      const stub = getDOStub('cb-recovery-test-2')

      // Create multiple circuit breakers
      await stub.createCircuitBreaker('service-a', {
        failureThreshold: 3,
        resetTimeout: 30000,
        persist: true,
      })

      await stub.createCircuitBreaker('service-b', {
        failureThreshold: 5,
        resetTimeout: 60000,
        persist: true,
      })

      // Open service-a, leave service-b closed
      await stub.recordCircuitFailure('service-a')
      await stub.recordCircuitFailure('service-a')
      await stub.recordCircuitFailure('service-a')

      // Simulate DO eviction and wake
      await stub.prepareHibernate()
      await stub.wake()

      // Verify both circuits restored correctly
      const stateA = await stub.getCircuitBreakerState('service-a')
      const stateB = await stub.getCircuitBreakerState('service-b')

      expect(stateA?.state).toBe('open')
      expect(stateA?.failure_count).toBe(3)

      expect(stateB?.state).toBe('closed')
      expect(stateB?.failure_count).toBe(0)
    })

    it('should preserve opened_at timestamp across recovery', async () => {
      const stub = getDOStub('cb-recovery-test-3')

      await stub.createCircuitBreaker('timed-service', {
        failureThreshold: 1,
        resetTimeout: 60000,
        persist: true,
      })

      // Open the circuit
      await stub.recordCircuitFailure('timed-service')

      const beforeHibernate = await stub.getCircuitBreakerState('timed-service')
      const openedAtBefore = beforeHibernate?.opened_at

      // Simulate DO eviction and wake
      await stub.prepareHibernate()
      await stub.wake()

      const afterWake = await stub.getCircuitBreakerState('timed-service')

      // Opened timestamp should be preserved exactly
      expect(afterWake?.opened_at).toBe(openedAtBefore)
    })
  })
})

// =============================================================================
// 2. CIRCUIT STATE TRANSITIONS
// =============================================================================

describe('Circuit Breaker State Transitions', () => {
  describe('Circuit opens after N failures', () => {
    it('should remain closed below failure threshold', async () => {
      const stub = getDOStub('cb-transition-test-1')

      await stub.createCircuitBreaker('api-endpoint', {
        failureThreshold: 5,
        resetTimeout: 30000,
        persist: true,
      })

      // Record 4 failures (below threshold of 5)
      for (let i = 0; i < 4; i++) {
        await stub.recordCircuitFailure('api-endpoint')
      }

      const state = await stub.getCircuitBreakerState('api-endpoint')

      expect(state?.state).toBe('closed')
      expect(state?.failure_count).toBe(4)
    })

    it('should open circuit exactly at failure threshold', async () => {
      const stub = getDOStub('cb-transition-test-2')

      await stub.createCircuitBreaker('exact-threshold', {
        failureThreshold: 3,
        resetTimeout: 30000,
        persist: true,
      })

      // Record exactly 3 failures
      await stub.recordCircuitFailure('exact-threshold')
      await stub.recordCircuitFailure('exact-threshold')

      // Still closed
      let state = await stub.getCircuitBreakerState('exact-threshold')
      expect(state?.state).toBe('closed')

      // Third failure opens circuit
      await stub.recordCircuitFailure('exact-threshold')

      state = await stub.getCircuitBreakerState('exact-threshold')
      expect(state?.state).toBe('open')
    })

    it('should record opened_at timestamp when opening', async () => {
      const stub = getDOStub('cb-transition-test-3')

      const beforeCreate = Date.now()

      await stub.createCircuitBreaker('timestamp-test', {
        failureThreshold: 1,
        resetTimeout: 30000,
        persist: true,
      })

      await stub.recordCircuitFailure('timestamp-test')

      const afterFailure = Date.now()

      const state = await stub.getCircuitBreakerState('timestamp-test')

      expect(state?.opened_at).toBeGreaterThanOrEqual(beforeCreate)
      expect(state?.opened_at).toBeLessThanOrEqual(afterFailure + 100)
    })
  })

  describe('Circuit half-opens after timeout', () => {
    it('should transition to half-open after reset timeout', async () => {
      const stub = getDOStub('cb-halfopen-test-1')

      await stub.createCircuitBreaker('halfopen-service', {
        failureThreshold: 1,
        resetTimeout: 100, // Short timeout for testing
        persist: true,
      })

      // Open the circuit
      await stub.recordCircuitFailure('halfopen-service')

      let state = await stub.getCircuitBreakerState('halfopen-service')
      expect(state?.state).toBe('open')

      // Manually advance the opened_at to simulate time passing
      // (In a real test, we might use fake timers)
      const pastOpenedAt = Date.now() - 200 // 200ms ago, past 100ms timeout
      await stub.setCircuitBreakerState('halfopen-service', {
        opened_at: pastOpenedAt,
      })

      // Trigger state check (e.g., by attempting an operation)
      // The circuit should recognize the timeout has passed
      state = await stub.getCircuitBreakerState('halfopen-service')

      // After timeout, state should be half-open when checked
      expect(state?.state).toBe('half_open')
    })

    it('should persist half-open state', async () => {
      const stub = getDOStub('cb-halfopen-test-2')

      await stub.createCircuitBreaker('persist-halfopen', {
        failureThreshold: 1,
        resetTimeout: 50,
        persist: true,
      })

      // Open circuit and advance past timeout
      await stub.recordCircuitFailure('persist-halfopen')

      const pastTime = Date.now() - 100
      await stub.setCircuitBreakerState('persist-halfopen', {
        opened_at: pastTime,
        state: 'half_open',
      })

      // Verify via direct storage access
      const stateManager = stub.getState()
      const storedState = await stateManager.get('circuit:persist-halfopen')

      expect((storedState as PersistedCircuitState).state).toBe('half_open')
    })
  })

  describe('Circuit closes after successful probe', () => {
    it('should close circuit on successful probe in half-open state', async () => {
      const stub = getDOStub('cb-close-test-1')

      await stub.createCircuitBreaker('probe-test', {
        failureThreshold: 2,
        resetTimeout: 100,
        persist: true,
      })

      // Set up half-open state directly
      await stub.setCircuitBreakerState('probe-test', {
        state: 'half_open',
        failure_count: 2,
        opened_at: Date.now() - 200,
      })

      // Record a success (probe succeeds)
      await stub.recordCircuitSuccess('probe-test')

      const state = await stub.getCircuitBreakerState('probe-test')

      expect(state?.state).toBe('closed')
      expect(state?.failure_count).toBe(0)
      expect(state?.success_count).toBe(1)
    })

    it('should reset failure count when closing from half-open', async () => {
      const stub = getDOStub('cb-close-test-2')

      await stub.createCircuitBreaker('reset-count-test', {
        failureThreshold: 3,
        resetTimeout: 100,
        persist: true,
      })

      // Set up half-open state with accumulated failures
      await stub.setCircuitBreakerState('reset-count-test', {
        state: 'half_open',
        failure_count: 3,
        opened_at: Date.now() - 200,
      })

      // Successful probe
      await stub.recordCircuitSuccess('reset-count-test')

      const state = await stub.getCircuitBreakerState('reset-count-test')

      expect(state?.state).toBe('closed')
      expect(state?.failure_count).toBe(0)
    })

    it('should re-open circuit on failed probe in half-open state', async () => {
      const stub = getDOStub('cb-close-test-3')

      await stub.createCircuitBreaker('failed-probe-test', {
        failureThreshold: 2,
        resetTimeout: 100,
        persist: true,
      })

      // Set up half-open state
      await stub.setCircuitBreakerState('failed-probe-test', {
        state: 'half_open',
        failure_count: 2,
        opened_at: Date.now() - 200,
      })

      // Record a failure (probe fails)
      await stub.recordCircuitFailure('failed-probe-test')

      const state = await stub.getCircuitBreakerState('failed-probe-test')

      expect(state?.state).toBe('open')
      expect(state?.opened_at).toBeGreaterThan(0) // New opened_at timestamp
    })
  })
})

// =============================================================================
// 3. CONFIGURABLE THRESHOLDS PER OPERATION
// =============================================================================

describe('Configurable Thresholds', () => {
  describe('Per-operation/endpoint tracking', () => {
    it('should track failures independently per circuit breaker', async () => {
      const stub = getDOStub('cb-config-test-1')

      await stub.createCircuitBreaker('api-v1', {
        failureThreshold: 3,
        resetTimeout: 30000,
        persist: true,
      })

      await stub.createCircuitBreaker('api-v2', {
        failureThreshold: 5,
        resetTimeout: 60000,
        persist: true,
      })

      // Record failures for each independently
      await stub.recordCircuitFailure('api-v1')
      await stub.recordCircuitFailure('api-v1')

      await stub.recordCircuitFailure('api-v2')

      const stateV1 = await stub.getCircuitBreakerState('api-v1')
      const stateV2 = await stub.getCircuitBreakerState('api-v2')

      expect(stateV1?.failure_count).toBe(2)
      expect(stateV2?.failure_count).toBe(1)
    })

    it('should support different thresholds per operation', async () => {
      const stub = getDOStub('cb-config-test-2')

      // Critical service with low threshold
      await stub.createCircuitBreaker('critical-db', {
        failureThreshold: 2,
        resetTimeout: 10000,
        persist: true,
      })

      // Non-critical service with high threshold
      await stub.createCircuitBreaker('analytics', {
        failureThreshold: 10,
        resetTimeout: 60000,
        persist: true,
      })

      // Record 2 failures for each
      await stub.recordCircuitFailure('critical-db')
      await stub.recordCircuitFailure('critical-db')

      await stub.recordCircuitFailure('analytics')
      await stub.recordCircuitFailure('analytics')

      const criticalState = await stub.getCircuitBreakerState('critical-db')
      const analyticsState = await stub.getCircuitBreakerState('analytics')

      // Critical should be open (threshold = 2)
      expect(criticalState?.state).toBe('open')

      // Analytics should still be closed (threshold = 10)
      expect(analyticsState?.state).toBe('closed')
    })

    it('should persist configuration with state', async () => {
      const stub = getDOStub('cb-config-test-3')

      await stub.createCircuitBreaker('configured-service', {
        failureThreshold: 7,
        resetTimeout: 45000,
        persist: true,
      })

      const state = await stub.getCircuitBreakerState('configured-service')

      expect(state?.failure_threshold).toBe(7)
      expect(state?.reset_timeout_ms).toBe(45000)
    })
  })

  describe('Success count tracking', () => {
    it('should reset failure count on success in closed state', async () => {
      const stub = getDOStub('cb-success-test-1')

      await stub.createCircuitBreaker('intermittent-service', {
        failureThreshold: 5,
        resetTimeout: 30000,
        persist: true,
      })

      // Record some failures
      await stub.recordCircuitFailure('intermittent-service')
      await stub.recordCircuitFailure('intermittent-service')

      let state = await stub.getCircuitBreakerState('intermittent-service')
      expect(state?.failure_count).toBe(2)

      // Record success - should reset consecutive failure count
      await stub.recordCircuitSuccess('intermittent-service')

      state = await stub.getCircuitBreakerState('intermittent-service')
      expect(state?.failure_count).toBe(0)
      expect(state?.success_count).toBe(1)
    })
  })
})

// =============================================================================
// 4. STATE TRANSITION LOGGING
// =============================================================================

describe('State Transition Logging', () => {
  it('should log state transitions for debugging', async () => {
    const stub = getDOStub('cb-logging-test-1')

    await stub.createCircuitBreaker('logged-service', {
      failureThreshold: 2,
      resetTimeout: 100,
      persist: true,
    })

    // Open the circuit
    await stub.recordCircuitFailure('logged-service')
    await stub.recordCircuitFailure('logged-service')

    const state = await stub.getCircuitBreakerState('logged-service')

    // Should have updated_at timestamp
    expect(state?.updated_at).toBeDefined()
    expect(state?.updated_at).toBeGreaterThan(0)
  })

  it('should update updated_at on every state change', async () => {
    const stub = getDOStub('cb-logging-test-2')

    await stub.createCircuitBreaker('timestamp-tracking', {
      failureThreshold: 3,
      resetTimeout: 30000,
      persist: true,
    })

    const afterCreate = (await stub.getCircuitBreakerState('timestamp-tracking'))?.updated_at

    // Small delay to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 10))

    await stub.recordCircuitFailure('timestamp-tracking')

    const afterFailure = (await stub.getCircuitBreakerState('timestamp-tracking'))?.updated_at

    expect(afterFailure).toBeGreaterThan(afterCreate!)
  })
})

// =============================================================================
// 5. RECOVERY FROM CORRUPTED STATE
// =============================================================================

describe('Corrupted State Recovery', () => {
  it('should handle missing circuit breaker gracefully', async () => {
    const stub = getDOStub('cb-corrupt-test-1')

    // Try to get a non-existent circuit breaker
    const state = await stub.getCircuitBreakerState('non-existent-service')

    expect(state).toBeNull()
  })

  it('should handle corrupted state by resetting to closed', async () => {
    const stub = getDOStub('cb-corrupt-test-2')

    // Manually write corrupted data to storage
    const stateManager = stub.getState()
    await stateManager.set('circuit:corrupted-service', {
      // Invalid/corrupted state object
      state: 'invalid-state',
      failure_count: 'not-a-number',
    })

    // Attempting to use the corrupted circuit should recover gracefully
    // Either by returning null or by resetting to a valid state
    const state = await stub.getCircuitBreakerState('corrupted-service')

    // Should either be null (not found) or reset to valid closed state
    if (state !== null) {
      expect(['closed', 'open', 'half_open']).toContain(state.state)
      expect(typeof state.failure_count).toBe('number')
    }
  })

  it('should handle partial state recovery', async () => {
    const stub = getDOStub('cb-corrupt-test-3')

    // Write partial state (missing some fields)
    const stateManager = stub.getState()
    await stateManager.set('circuit:partial-service', {
      id: 'partial-service',
      state: 'open',
      // Missing failure_count, opened_at, etc.
    })

    const state = await stub.getCircuitBreakerState('partial-service')

    // Should handle gracefully - either return null or fill in defaults
    if (state !== null) {
      expect(state.failure_count).toBeDefined()
      expect(state.reset_timeout_ms).toBeDefined()
    }
  })

  it('should recover from NaN timestamps', async () => {
    const stub = getDOStub('cb-corrupt-test-4')

    const stateManager = stub.getState()
    await stateManager.set('circuit:nan-timestamps', {
      id: 'nan-timestamps',
      state: 'open',
      failure_count: 3,
      success_count: 0,
      opened_at: NaN,
      last_failure_at: undefined,
      updated_at: NaN,
      failure_threshold: 3,
      reset_timeout_ms: 30000,
    })

    const state = await stub.getCircuitBreakerState('nan-timestamps')

    // Should handle NaN gracefully
    if (state !== null) {
      expect(Number.isNaN(state.opened_at)).toBe(false)
      expect(Number.isNaN(state.updated_at)).toBe(false)
    }
  })
})

// =============================================================================
// 6. LISTING AND MANAGEMENT
// =============================================================================

describe('Circuit Breaker Management', () => {
  it('should list all circuit breakers', async () => {
    const stub = getDOStub('cb-list-test-1')

    await stub.createCircuitBreaker('service-1', {
      failureThreshold: 3,
      resetTimeout: 30000,
      persist: true,
    })

    await stub.createCircuitBreaker('service-2', {
      failureThreshold: 5,
      resetTimeout: 60000,
      persist: true,
    })

    const allBreakers = await stub.getAllCircuitBreakers()

    expect(allBreakers.length).toBe(2)
    expect(allBreakers.map(b => b.id)).toContain('service-1')
    expect(allBreakers.map(b => b.id)).toContain('service-2')
  })

  it('should clear all circuit breakers', async () => {
    const stub = getDOStub('cb-clear-test-1')

    await stub.createCircuitBreaker('to-clear-1', {
      failureThreshold: 3,
      resetTimeout: 30000,
      persist: true,
    })

    await stub.createCircuitBreaker('to-clear-2', {
      failureThreshold: 5,
      resetTimeout: 60000,
      persist: true,
    })

    await stub.clearAllCircuitBreakers()

    const allBreakers = await stub.getAllCircuitBreakers()

    expect(allBreakers.length).toBe(0)
  })

  it('should reset a specific circuit breaker', async () => {
    const stub = getDOStub('cb-reset-test-1')

    await stub.createCircuitBreaker('resettable', {
      failureThreshold: 2,
      resetTimeout: 30000,
      persist: true,
    })

    // Open the circuit
    await stub.recordCircuitFailure('resettable')
    await stub.recordCircuitFailure('resettable')

    let state = await stub.getCircuitBreakerState('resettable')
    expect(state?.state).toBe('open')

    // Reset it
    await stub.resetCircuitBreaker('resettable')

    state = await stub.getCircuitBreakerState('resettable')
    expect(state?.state).toBe('closed')
    expect(state?.failure_count).toBe(0)
    expect(state?.opened_at).toBeNull()
  })
})

// =============================================================================
// 7. EDGE CASES
// =============================================================================

describe('Circuit Breaker Edge Cases', () => {
  it('should handle rapid successive failures', async () => {
    const stub = getDOStub('cb-edge-test-1')

    await stub.createCircuitBreaker('rapid-fail', {
      failureThreshold: 100,
      resetTimeout: 30000,
      persist: true,
    })

    // Record 100 failures rapidly
    const promises = []
    for (let i = 0; i < 100; i++) {
      promises.push(stub.recordCircuitFailure('rapid-fail'))
    }
    await Promise.all(promises)

    const state = await stub.getCircuitBreakerState('rapid-fail')

    expect(state?.state).toBe('open')
    expect(state?.failure_count).toBe(100)
  })

  it('should handle circuit breaker with threshold of 1', async () => {
    const stub = getDOStub('cb-edge-test-2')

    await stub.createCircuitBreaker('single-failure', {
      failureThreshold: 1,
      resetTimeout: 30000,
      persist: true,
    })

    // Single failure should open circuit
    await stub.recordCircuitFailure('single-failure')

    const state = await stub.getCircuitBreakerState('single-failure')

    expect(state?.state).toBe('open')
    expect(state?.failure_count).toBe(1)
  })

  it('should handle very long circuit breaker IDs', async () => {
    const stub = getDOStub('cb-edge-test-3')

    const longId = 'a'.repeat(500)

    await stub.createCircuitBreaker(longId, {
      failureThreshold: 3,
      resetTimeout: 30000,
      persist: true,
    })

    await stub.recordCircuitFailure(longId)

    const state = await stub.getCircuitBreakerState(longId)

    expect(state?.id).toBe(longId)
    expect(state?.failure_count).toBe(1)
  })

  it('should handle special characters in circuit breaker ID', async () => {
    const stub = getDOStub('cb-edge-test-4')

    const specialId = 'api/v1/users:create:endpoint'

    await stub.createCircuitBreaker(specialId, {
      failureThreshold: 3,
      resetTimeout: 30000,
      persist: true,
    })

    await stub.recordCircuitFailure(specialId)

    const state = await stub.getCircuitBreakerState(specialId)

    expect(state?.id).toBe(specialId)
    expect(state?.failure_count).toBe(1)
  })
})
