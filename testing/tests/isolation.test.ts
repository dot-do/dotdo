/**
 * Test Isolation Verification Tests
 *
 * Verifies that the isolation module correctly detects and prevents
 * shared state leaks between tests.
 *
 * @see do-w5l6 - Add test isolation verification
 * @module testing/tests/isolation.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  takeGlobalStateSnapshot,
  verifyIsolation,
  resetGlobalState,
  createIsolationHooks,
  generateIsolatedTestId,
  withIsolation,
  type GlobalStateSnapshot,
  type IsolationViolation,
  type IsolationConfig,
} from '../isolation'
import { globalTracker, UsageTracker } from '@dotdo/ai'
import { integrationRegistry } from '@dotdo/integrations'
import type { Integration, IntegrationConfig, IntegrationMetadata } from '@dotdo/integrations'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a minimal test integration
 */
function createTestIntegration(name: string): Integration {
  let status: 'uninitialized' | 'ready' | 'error' = 'uninitialized'

  return {
    name,
    version: '1.0.0',
    get status() {
      return status
    },
    metadata: {
      displayName: name,
      description: `Test integration: ${name}`,
      category: 'other',
      requiredConfig: [],
      optionalConfig: [],
    } as IntegrationMetadata,
    async init(_config: IntegrationConfig) {
      status = 'ready'
    },
    async shutdown() {
      status = 'uninitialized'
    },
  }
}

// ============================================================================
// GLOBAL STATE SNAPSHOT TESTS
// ============================================================================

describe('Global State Snapshot', () => {
  beforeEach(async () => {
    // Ensure clean state before each test
    await resetGlobalState()
  })

  afterEach(async () => {
    // Clean up after each test
    await resetGlobalState()
  })

  describe('takeGlobalStateSnapshot', () => {
    it('should capture AI module state', async () => {
      const snapshot = await takeGlobalStateSnapshot({ trackAI: true, trackIntegrations: false })

      expect(snapshot.timestamp).toBeDefined()
      expect(snapshot.ai).toBeDefined()
      expect(snapshot.ai?.globalTrackerRecordsCount).toBe(0)
      expect(snapshot.ai?.globalTrackerBudgetLimit).toBe(Infinity)
    })

    it('should capture changed AI state', async () => {
      // Add some usage
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })
      globalTracker.setBudgetLimit(5.0)

      const snapshot = await takeGlobalStateSnapshot({ trackAI: true, trackIntegrations: false })

      expect(snapshot.ai?.globalTrackerRecordsCount).toBe(1)
      expect(snapshot.ai?.globalTrackerBudgetLimit).toBe(5.0)
    })

    it('should capture integration registry state', async () => {
      const snapshot = await takeGlobalStateSnapshot({ trackAI: false, trackIntegrations: true })

      expect(snapshot.integrations).toBeDefined()
      expect(snapshot.integrations?.registrySize).toBe(0)
      expect(snapshot.integrations?.registryNames).toEqual([])
    })

    it('should capture changed integration state', async () => {
      // Register an integration
      const integration = createTestIntegration('test-snapshot')
      integrationRegistry.register(integration)

      const snapshot = await takeGlobalStateSnapshot({ trackAI: false, trackIntegrations: true })

      expect(snapshot.integrations?.registrySize).toBe(1)
      expect(snapshot.integrations?.registryNames).toContain('test-snapshot')
    })

    it('should capture custom tracked values', async () => {
      let customValue = 42

      const snapshot = await takeGlobalStateSnapshot({
        trackAI: false,
        trackIntegrations: false,
        customTrackers: {
          myValue: () => customValue,
          myArray: () => [1, 2, 3],
        },
      })

      expect(snapshot.custom?.myValue).toBe(42)
      expect(snapshot.custom?.myArray).toEqual([1, 2, 3])
    })
  })

  describe('verifyIsolation', () => {
    it('should detect no violations when state unchanged', async () => {
      const baseline = await takeGlobalStateSnapshot()
      const violations = await verifyIsolation(baseline, { logViolations: false })

      expect(violations).toHaveLength(0)
    })

    it('should detect AI tracker record changes', async () => {
      const baseline = await takeGlobalStateSnapshot()

      // Add usage after baseline
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      const violations = await verifyIsolation(baseline, { logViolations: false })

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.type === 'ai.globalTracker.records')).toBe(true)
    })

    it('should detect AI budget limit changes', async () => {
      const baseline = await takeGlobalStateSnapshot()

      // Change budget limit
      globalTracker.setBudgetLimit(10.0)

      const violations = await verifyIsolation(baseline, { logViolations: false })

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.type === 'ai.globalTracker.budgetLimit')).toBe(true)
    })

    it('should detect integration registry additions', async () => {
      const baseline = await takeGlobalStateSnapshot()

      // Register an integration
      const integration = createTestIntegration('test-verify')
      integrationRegistry.register(integration)

      const violations = await verifyIsolation(baseline, { logViolations: false })

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.type === 'integrations.registry.size')).toBe(true)
    })

    it('should detect custom value changes', async () => {
      let customValue = 'initial'

      const baseline = await takeGlobalStateSnapshot({
        trackAI: false,
        trackIntegrations: false,
        customTrackers: {
          customValue: () => customValue,
        },
      })

      // Change the value
      customValue = 'changed'

      const violations = await verifyIsolation(baseline, {
        trackAI: false,
        trackIntegrations: false,
        customTrackers: {
          customValue: () => customValue,
        },
        logViolations: false,
      })

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.type === 'custom.customValue')).toBe(true)
    })

    it('should throw when configured to throw on violation', async () => {
      const baseline = await takeGlobalStateSnapshot()

      // Add usage to create violation
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      await expect(
        verifyIsolation(baseline, { throwOnViolation: true, logViolations: false })
      ).rejects.toThrow('Test isolation violations detected')
    })
  })
})

// ============================================================================
// RESET GLOBAL STATE TESTS
// ============================================================================

describe('Reset Global State', () => {
  it('should reset AI tracker records', async () => {
    // Add some state
    globalTracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokens: { input: 100, output: 50 },
      cost: 0.001,
      timestamp: Date.now(),
    })

    expect(globalTracker.exportRecords().length).toBe(1)

    await resetGlobalState()

    expect(globalTracker.exportRecords().length).toBe(0)
  })

  it('should reset AI tracker budget limit', async () => {
    globalTracker.setBudgetLimit(5.0)

    expect(globalTracker.getBudgetLimit()).toBe(5.0)

    await resetGlobalState()

    expect(globalTracker.getBudgetLimit()).toBe(Infinity)
  })

  it('should clear integration registry', async () => {
    const integration = createTestIntegration('test-reset')
    integrationRegistry.register(integration)

    expect(integrationRegistry.size).toBe(1)

    await resetGlobalState()

    expect(integrationRegistry.size).toBe(0)
  })

  it('should be idempotent', async () => {
    await resetGlobalState()
    await resetGlobalState()
    await resetGlobalState()

    // Should not throw or cause issues
    expect(globalTracker.exportRecords().length).toBe(0)
    expect(integrationRegistry.size).toBe(0)
  })
})

// ============================================================================
// ISOLATION HOOKS TESTS
// ============================================================================

describe('Isolation Hooks', () => {
  describe('createIsolationHooks', () => {
    it('should create setup and verify functions', () => {
      const hooks = createIsolationHooks()

      expect(hooks.setupIsolation).toBeInstanceOf(Function)
      expect(hooks.verifyIsolation).toBeInstanceOf(Function)
    })

    it('should detect state leaks between setup and verify', async () => {
      const hooks = createIsolationHooks({ logViolations: false })

      await hooks.setupIsolation()

      // Create a state leak
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Verify should detect the leak but not throw by default
      await hooks.verifyIsolation()

      // After verify, state should be reset
      expect(globalTracker.exportRecords().length).toBe(0)
    })

    it('should throw if configured to throw on violations', async () => {
      const hooks = createIsolationHooks({
        logViolations: false,
        throwOnViolation: true,
      })

      await hooks.setupIsolation()

      // Create a state leak
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Verify should throw
      await expect(hooks.verifyIsolation()).rejects.toThrow()
    })

    it('should handle missing baseline gracefully', async () => {
      const hooks = createIsolationHooks({ logViolations: false })

      // Call verify without setup - should not throw
      await expect(hooks.verifyIsolation()).resolves.toBeUndefined()
    })
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  beforeEach(async () => {
    await resetGlobalState()
  })

  afterEach(async () => {
    await resetGlobalState()
  })

  describe('generateIsolatedTestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateIsolatedTestId()
      const id2 = generateIsolatedTestId()

      expect(id1).not.toBe(id2)
    })

    it('should use custom prefix', () => {
      const id = generateIsolatedTestId('my-prefix')

      expect(id).toMatch(/^my-prefix-/)
    })

    it('should include timestamp', () => {
      const before = Date.now()
      const id = generateIsolatedTestId()
      const after = Date.now()

      // Extract timestamp from ID
      const parts = id.split('-')
      const timestamp = parseInt(parts[1], 10)

      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('withIsolation', () => {
    it('should wrap a function with isolation', async () => {
      let executed = false

      const wrappedFn = withIsolation(async () => {
        executed = true
        return 42
      }, { logViolations: false })

      const result = await wrappedFn()

      expect(executed).toBe(true)
      expect(result).toBe(42)
    })

    it('should reset state before running function', async () => {
      // Pollute state
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      let recordsAtStart = -1

      const wrappedFn = withIsolation(async () => {
        recordsAtStart = globalTracker.exportRecords().length
      }, { logViolations: false })

      await wrappedFn()

      // State should have been reset before function ran
      expect(recordsAtStart).toBe(0)
    })

    it('should throw if function leaks state', async () => {
      const wrappedFn = withIsolation(async () => {
        // Create a leak
        globalTracker.record({
          provider: 'openai',
          model: 'gpt-4o',
          tokens: { input: 100, output: 50 },
          cost: 0.001,
          timestamp: Date.now(),
        })
      }, { logViolations: false, throwOnViolation: true })

      await expect(wrappedFn()).rejects.toThrow('Test isolation violations detected')
    })

    it('should reset state even if function throws', async () => {
      // First pollute state
      globalTracker.setBudgetLimit(100)

      const wrappedFn = withIsolation(async () => {
        globalTracker.setBudgetLimit(200)
        throw new Error('Test error')
      }, { logViolations: false, throwOnViolation: false })

      try {
        await wrappedFn()
      } catch {
        // Expected
      }

      // State should still be reset
      expect(globalTracker.getBudgetLimit()).toBe(Infinity)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - REAL ISOLATION SCENARIOS
// ============================================================================

describe('Real Isolation Scenarios', () => {
  beforeEach(async () => {
    await resetGlobalState()
  })

  afterEach(async () => {
    await resetGlobalState()
  })

  describe('AI module isolation', () => {
    it('should isolate usage tracking between simulated requests', async () => {
      // Create isolated trackers (the proper pattern)
      const request1Tracker = new UsageTracker()
      const request2Tracker = new UsageTracker()

      // Request 1 usage
      request1Tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Request 2 should not see Request 1's data
      expect(request2Tracker.getReport().requestCount).toBe(0)
      expect(request1Tracker.getReport().requestCount).toBe(1)
    })

    it('should demonstrate global tracker leakage (and fix)', async () => {
      // First, show the problem: global tracker persists across "requests"
      const baselineSnapshot = await takeGlobalStateSnapshot()
      expect(baselineSnapshot.ai?.globalTrackerRecordsCount).toBe(0)

      // Simulated "Request 1"
      globalTracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        tokens: { input: 100, output: 50 },
        cost: 0.001,
        timestamp: Date.now(),
      })

      // Without reset, "Request 2" sees "Request 1" data (the leak!)
      const midSnapshot = await takeGlobalStateSnapshot()
      expect(midSnapshot.ai?.globalTrackerRecordsCount).toBe(1) // Leaked!

      // The fix: reset between requests
      await resetGlobalState()

      // Now Request 2 has clean state
      const finalSnapshot = await takeGlobalStateSnapshot()
      expect(finalSnapshot.ai?.globalTrackerRecordsCount).toBe(0)
    })
  })

  describe('Integration registry isolation', () => {
    it('should isolate registry between test scenarios', async () => {
      const baselineSnapshot = await takeGlobalStateSnapshot()
      expect(baselineSnapshot.integrations?.registrySize).toBe(0)

      // Test A registers an integration
      const integrationA = createTestIntegration('test-a')
      integrationRegistry.register(integrationA)

      // Verify the leak is detectable
      const violations = await verifyIsolation(baselineSnapshot, { logViolations: false })
      expect(violations.some(v => v.type.includes('integrations'))).toBe(true)

      // Fix: reset state
      await resetGlobalState()

      // Test B starts with clean registry
      expect(integrationRegistry.size).toBe(0)
    })
  })

  describe('Concurrent test simulation', () => {
    it('should handle parallel test execution with unique IDs', async () => {
      // Simulate multiple parallel tests
      const results = await Promise.all(
        Array.from({ length: 5 }, async (_, i) => {
          const testId = generateIsolatedTestId(`parallel-${i}`)
          return { index: i, testId }
        })
      )

      // All test IDs should be unique
      const uniqueIds = new Set(results.map(r => r.testId))
      expect(uniqueIds.size).toBe(5)
    })
  })
})
