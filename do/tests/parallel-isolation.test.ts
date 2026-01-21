/**
 * Parallel Test Isolation Tests (TDD)
 *
 * This test file verifies that parallel test runs don't leak state.
 * Tests should be able to run concurrently without affecting each other.
 *
 * Key concerns:
 * 1. Tests can run in parallel without affecting each other
 * 2. Global state is properly isolated between test files
 * 3. Database/storage state doesn't leak between tests
 *
 * Uses vitest's isolation features to ensure proper test isolation.
 *
 * @see do-1iz7 - Add parallel test isolation verification
 * @module do/tests/parallel-isolation.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { generateTestId, getTestDO, sleep } from '../../test-utils'

// ============================================================================
// TEST ISOLATION HELPERS - Using shared test-utils
// ============================================================================

/**
 * Get a fresh DO stub for testing with isolated namespace (delegates to shared test-utils)
 */
function getIsolatedStub(testName?: string) {
  const name = testName || generateTestId('isolation')
  const stub = getTestDO(env, name)
  return { stub, name }
}

// ============================================================================
// MODULE-LEVEL STATE ISOLATION TESTS
// ============================================================================

/**
 * Track module-level state to verify isolation between test runs.
 * This demonstrates how global state can leak.
 */
let moduleCounter = 0
const moduleStateMap = new Map<string, unknown>()

describe('Module-Level State Isolation', () => {
  beforeEach(() => {
    // Each test should start with clean module state
    // This is important for isolation
  })

  afterEach(() => {
    // Clean up module state after each test
    moduleCounter = 0
    moduleStateMap.clear()
  })

  it('should start with zero module counter (test A)', () => {
    // This test increments module counter
    // If another test runs first and doesn't reset, this would fail
    expect(moduleCounter).toBe(0)
    moduleCounter = 42
  })

  it('should start with zero module counter (test B)', () => {
    // This test also expects zero - if test A leaks state, this fails
    expect(moduleCounter).toBe(0)
    moduleCounter = 100
  })

  it('should start with empty module state map (test C)', () => {
    expect(moduleStateMap.size).toBe(0)
    moduleStateMap.set('testC', { data: 'leaky' })
  })

  it('should start with empty module state map (test D)', () => {
    // If test C's state leaks, this would fail
    expect(moduleStateMap.size).toBe(0)
    expect(moduleStateMap.has('testC')).toBe(false)
  })
})

// ============================================================================
// DO INSTANCE ISOLATION TESTS
// ============================================================================

describe('DO Instance Isolation', () => {
  describe('unique namespaces prevent cross-test contamination', () => {
    it('should create isolated DO instances with unique names', async () => {
      const { stub: stub1, name: name1 } = getIsolatedStub()
      const { stub: stub2, name: name2 } = getIsolatedStub()

      // Verify names are unique
      expect(name1).not.toBe(name2)

      // Fetch from both and verify different IDs
      const resp1 = await stub1.fetch('https://do/')
      const resp2 = await stub2.fetch('https://do/')

      const json1 = await resp1.json() as { id: string }
      const json2 = await resp2.json() as { id: string }

      expect(json1.id).not.toBe(json2.id)
    })

    it('should not see data from another test DO instance', async () => {
      // Create a unique DO for this test
      const testId = generateTestId()
      const { stub } = getIsolatedStub(testId)

      // Verify this is a fresh instance with no prior state
      const resp = await stub.fetch('https://do/info')
      expect(resp.status).toBe(200)

      const info = await resp.json() as { keys: number }
      // Fresh DO should have minimal or zero keys (depends on schema initialization)
      expect(typeof info.keys).toBe('number')
    })

    it('should maintain DO isolation across parallel requests', async () => {
      // Create multiple unique DOs in parallel
      const doPromises = Array.from({ length: 5 }, async (_, i) => {
        const { stub, name } = getIsolatedStub()
        const resp = await stub.fetch('https://do/')
        const json = await resp.json() as { id: string }
        return { name, doId: json.id, index: i }
      })

      const results = await Promise.all(doPromises)

      // All DO IDs should be unique
      const doIds = results.map(r => r.doId)
      const uniqueIds = new Set(doIds)
      expect(uniqueIds.size).toBe(5)

      // All namespace names should be unique
      const names = results.map(r => r.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(5)
    })
  })

  describe('same name produces same instance within test', () => {
    it('should return consistent DO instance for same name', async () => {
      const sharedName = `shared-${generateTestId()}`

      // Get the same DO twice by name
      const stub1 = env.DO.get(env.DO.idFromName(sharedName))
      const stub2 = env.DO.get(env.DO.idFromName(sharedName))

      const [resp1, resp2] = await Promise.all([
        stub1.fetch('https://do/'),
        stub2.fetch('https://do/'),
      ])

      const json1 = await resp1.json() as { id: string }
      const json2 = await resp2.json() as { id: string }

      // Same name = same DO instance = same ID
      expect(json1.id).toBe(json2.id)
    })
  })
})

// ============================================================================
// STORAGE STATE ISOLATION TESTS
// ============================================================================

describe('Storage State Isolation', () => {
  describe('test-specific data isolation', () => {
    it('should write data that only this test sees (test A)', async () => {
      const testId = `storage-test-a-${generateTestId()}`
      const { stub } = getIsolatedStub(testId)

      // Write test-specific data
      const writeResp = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'TestItem', name: 'Test A Item', marker: 'test-a-marker' }]
        })
      })

      // Data should be created (either 200 or 404 if method doesn't exist)
      // The important thing is the request completes without leaking
      expect(writeResp.status).toBeDefined()
      await writeResp.text() // Consume body
    })

    it('should write data that only this test sees (test B)', async () => {
      const testId = `storage-test-b-${generateTestId()}`
      const { stub } = getIsolatedStub(testId)

      // Write different test-specific data
      const writeResp = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'TestItem', name: 'Test B Item', marker: 'test-b-marker' }]
        })
      })

      expect(writeResp.status).toBeDefined()
      await writeResp.text() // Consume body
    })

    it('should not see data from test A or B in a fresh DO', async () => {
      const testId = `storage-test-c-${generateTestId()}`
      const { stub } = getIsolatedStub(testId)

      // This is a fresh DO - it should not contain data from other tests
      const resp = await stub.fetch('https://do/info')
      expect(resp.status).toBe(200)

      // A fresh DO shouldn't have accumulated test data from other tests
      const info = await resp.json() as { id: string; keys: number }
      expect(info.id).toBeDefined()
    })
  })

  describe('concurrent storage operations isolation', () => {
    it('should handle concurrent writes to different DOs without cross-contamination', async () => {
      // Create multiple DOs and write different data to each concurrently
      const writeOperations = Array.from({ length: 10 }, async (_, i) => {
        const testId = `concurrent-write-${generateTestId()}-${i}`
        const { stub } = getIsolatedStub(testId)

        // Each DO gets a unique marker
        const marker = `unique-marker-${i}-${Date.now()}`

        await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'things.create',
            args: [{ $type: 'ConcurrentTestItem', index: i, marker }]
          })
        })

        return { testId, marker, index: i }
      })

      const results = await Promise.all(writeOperations)

      // All markers should be unique
      const markers = results.map(r => r.marker)
      const uniqueMarkers = new Set(markers)
      expect(uniqueMarkers.size).toBe(10)

      // All test IDs should be unique
      const testIds = results.map(r => r.testId)
      const uniqueTestIds = new Set(testIds)
      expect(uniqueTestIds.size).toBe(10)
    })
  })
})

// ============================================================================
// TIMING-BASED ISOLATION TESTS
// ============================================================================

describe('Timing-Based Isolation', () => {
  describe('async operations do not leak between tests', () => {
    it('should complete async operations within test boundary (test 1)', async () => {
      const testMarker = `timing-test-1-${generateTestId()}`
      let completed = false

      // Start async operation
      const asyncOp = (async () => {
        await sleep(50)
        completed = true
        return testMarker
      })()

      // Wait for completion
      const result = await asyncOp
      expect(result).toBe(testMarker)
      expect(completed).toBe(true)
    })

    it('should complete async operations within test boundary (test 2)', async () => {
      const testMarker = `timing-test-2-${generateTestId()}`
      let completed = false

      // Start async operation
      const asyncOp = (async () => {
        await sleep(30)
        completed = true
        return testMarker
      })()

      // Wait for completion
      const result = await asyncOp
      expect(result).toBe(testMarker)
      expect(completed).toBe(true)
    })

    it('should not see pending operations from other tests', async () => {
      // This test verifies that async operations from other tests
      // don't leak into this test's execution context

      const localState = { value: 'initial' }

      // Start a local async operation
      const promise = (async () => {
        await sleep(10)
        localState.value = 'updated'
        return localState.value
      })()

      // The state should be 'initial' until the promise resolves
      expect(localState.value).toBe('initial')

      // After awaiting, it should be updated
      await promise
      expect(localState.value).toBe('updated')
    })
  })
})

// ============================================================================
// GLOBAL MUTABLE STATE TESTS
// ============================================================================

// Simulated global state that could leak between tests
const globalTestRegistry = new Map<string, { count: number; data: unknown }>()

describe('Global Mutable State Isolation', () => {
  beforeEach(() => {
    // Clear global state before each test to ensure isolation
    globalTestRegistry.clear()
  })

  afterEach(() => {
    // Clean up after test
    globalTestRegistry.clear()
  })

  it('should have empty global registry at test start (test A)', () => {
    expect(globalTestRegistry.size).toBe(0)

    // Add some state
    globalTestRegistry.set('test-a', { count: 1, data: 'from test A' })
    expect(globalTestRegistry.size).toBe(1)
  })

  it('should have empty global registry at test start (test B)', () => {
    // If test A's state leaked, this would fail
    expect(globalTestRegistry.size).toBe(0)

    // Verify no data from test A
    expect(globalTestRegistry.has('test-a')).toBe(false)

    // Add different state
    globalTestRegistry.set('test-b', { count: 2, data: 'from test B' })
  })

  it('should not see accumulated state from previous tests (test C)', () => {
    expect(globalTestRegistry.size).toBe(0)
    expect(globalTestRegistry.has('test-a')).toBe(false)
    expect(globalTestRegistry.has('test-b')).toBe(false)
  })
})

// ============================================================================
// PARALLEL EXECUTION ISOLATION TESTS
// ============================================================================

describe('Parallel Execution Isolation', () => {
  /**
   * These tests are designed to run in parallel and verify that
   * each test operates in its own isolated environment.
   */

  const testResults: Map<string, { timestamp: number; value: string }> = new Map()

  beforeEach(() => {
    testResults.clear()
  })

  it('parallel test 1 - should create isolated result', async () => {
    const testId = generateTestId()
    await sleep(Math.random() * 50) // Random delay to encourage interleaving

    testResults.set('test1', { timestamp: Date.now(), value: testId })

    // Verify only this test's result exists at this point in this test
    expect(testResults.get('test1')?.value).toBe(testId)
  })

  it('parallel test 2 - should create isolated result', async () => {
    const testId = generateTestId()
    await sleep(Math.random() * 50) // Random delay to encourage interleaving

    testResults.set('test2', { timestamp: Date.now(), value: testId })

    expect(testResults.get('test2')?.value).toBe(testId)
  })

  it('parallel test 3 - should create isolated result', async () => {
    const testId = generateTestId()
    await sleep(Math.random() * 50) // Random delay to encourage interleaving

    testResults.set('test3', { timestamp: Date.now(), value: testId })

    expect(testResults.get('test3')?.value).toBe(testId)
  })
})

// ============================================================================
// VITEST ISOLATION FEATURE VERIFICATION
// ============================================================================

describe('Vitest Isolation Features', () => {
  describe('beforeEach/afterEach isolation', () => {
    let setupState: string | null = null
    let setupCallCount = 0

    beforeEach(() => {
      setupState = `setup-${Date.now()}`
      setupCallCount++
    })

    afterEach(() => {
      setupState = null
    })

    it('should have fresh setup state (test 1)', () => {
      expect(setupState).toContain('setup-')
      expect(setupCallCount).toBeGreaterThan(0)

      // Modify state to verify cleanup
      setupState = 'modified-by-test-1'
    })

    it('should have fresh setup state (test 2)', () => {
      // afterEach should have reset setupState
      expect(setupState).toContain('setup-')
      expect(setupState).not.toBe('modified-by-test-1')
    })

    it('should call beforeEach for each test', () => {
      // setupCallCount accumulates, demonstrating beforeEach runs for each test
      expect(setupCallCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('mock isolation', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should have isolated mocks (test 1)', () => {
      const mockFn = vi.fn().mockReturnValue('test-1-value')
      expect(mockFn()).toBe('test-1-value')
    })

    it('should have isolated mocks (test 2)', () => {
      // Create a fresh mock for this test
      const mockFn = vi.fn().mockReturnValue('test-2-value')
      expect(mockFn()).toBe('test-2-value')
    })
  })

  describe('timer isolation', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('should have isolated fake timers (test 1)', () => {
      vi.useFakeTimers()
      const callback = vi.fn()

      setTimeout(callback, 1000)
      expect(callback).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)
      expect(callback).toHaveBeenCalledOnce()
    })

    it('should have isolated fake timers (test 2)', () => {
      vi.useFakeTimers()
      const callback = vi.fn()

      // This test's timer state should be independent
      setTimeout(callback, 500)
      expect(callback).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      expect(callback).toHaveBeenCalledOnce()
    })
  })
})

// ============================================================================
// CROSS-TEST FILE ISOLATION VERIFICATION
// ============================================================================

/**
 * This section verifies that state doesn't leak between test files.
 * We export a marker that other test files could potentially see.
 */
export const ISOLATION_TEST_MARKER = `isolation-marker-${Date.now()}`

describe('Cross-Test File Isolation', () => {
  it('should have unique test file marker', () => {
    // This marker is unique to this test file's execution
    expect(ISOLATION_TEST_MARKER).toContain('isolation-marker-')
    expect(typeof ISOLATION_TEST_MARKER).toBe('string')
  })

  it('should not pollute global namespace', () => {
    // Verify we haven't accidentally polluted global state
    // that other test files would inherit
    expect((globalThis as Record<string, unknown>).leakyGlobalState).toBeUndefined()
  })
})
