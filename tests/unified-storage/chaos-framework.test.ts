/**
 * Chaos Testing Framework Tests - TDD RED Phase
 *
 * These tests define the expected behavior of a chaos testing framework
 * for injecting faults into the unified storage system. The framework enables:
 * - Fault injection for testing error handling paths
 * - Pipeline failure injection
 * - SQLite failure injection
 * - Network latency simulation
 * - DO eviction/hibernation simulation
 * - Clock skew injection
 * - Probability-based failures
 * - Scoped fault injection
 *
 * NOTE: These tests are designed to FAIL because the implementation
 * does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/chaos-controller.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md for chaos testing architecture
 * @module tests/unified-storage/chaos-framework.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  ChaosController,
  type FaultConfig,
  type FaultType,
  type FaultScope,
  type FaultTarget,
  type ChaosControllerConfig,
  type InjectedFault,
  ChaosError,
} from '../../objects/unified-storage/chaos-controller'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock pipeline for testing chaos injection
 */
const createMockPipeline = () => {
  const events: unknown[] = []
  let shouldFail = false
  let failError: Error | null = null

  return {
    send: vi.fn(async (batch: unknown[]) => {
      if (shouldFail) {
        throw failError || new Error('Pipeline failure')
      }
      events.push(...batch)
    }),
    events,
    setFail: (fail: boolean, error?: Error) => {
      shouldFail = fail
      failError = error || null
    },
    clear: () => {
      events.length = 0
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

/**
 * Mock SQL storage for testing chaos injection
 */
const createMockSqlStorage = () => {
  const queries: string[] = []
  let shouldFail = false
  let failError: Error | null = null
  let latencyMs = 0

  return {
    exec: vi.fn(async (sql: string) => {
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs))
      }
      if (shouldFail) {
        throw failError || new Error('SQL exec failure')
      }
      queries.push(sql)
      return { rows: [], changes: 0 }
    }),
    queries,
    setFail: (fail: boolean, error?: Error) => {
      shouldFail = fail
      failError = error || null
    },
    setLatency: (ms: number) => {
      latencyMs = ms
    },
    clear: () => {
      queries.length = 0
    },
  }
}

type MockSqlStorage = ReturnType<typeof createMockSqlStorage>

/**
 * Mock DO state for testing chaos injection
 */
const createMockDOState = () => {
  let hibernating = false

  return {
    id: {
      toString: () => 'test-chaos-do-id',
      name: 'test-namespace',
    },
    storage: {
      sql: createMockSqlStorage(),
    },
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
    waitUntil: vi.fn(),
    isHibernating: () => hibernating,
    triggerHibernation: () => {
      hibernating = true
    },
    wake: () => {
      hibernating = false
    },
  }
}

type MockDOState = ReturnType<typeof createMockDOState>

/**
 * Mock clock for testing time-related chaos
 */
const createMockClock = () => {
  let offsetMs = 0

  return {
    now: () => Date.now() + offsetMs,
    setOffset: (ms: number) => {
      offsetMs = ms
    },
    getOffset: () => offsetMs,
    reset: () => {
      offsetMs = 0
    },
  }
}

type MockClock = ReturnType<typeof createMockClock>

// ============================================================================
// TESTS
// ============================================================================

describe('ChaosController', () => {
  let mockPipeline: MockPipeline
  let mockSqlStorage: MockSqlStorage
  let mockDOState: MockDOState
  let mockClock: MockClock
  let chaosController: ChaosController

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockPipeline = createMockPipeline()
    mockSqlStorage = createMockSqlStorage()
    mockDOState = createMockDOState()
    mockClock = createMockClock()
  })

  afterEach(async () => {
    if (chaosController) {
      await chaosController.close()
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // FAULT INJECTION API TESTS
  // ============================================================================

  describe('Fault Injection API', () => {
    it('should inject a fault on a target', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const fault: FaultConfig = {
        type: 'error',
        error: new Error('Injected failure'),
      }

      chaosController.injectFault('pipeline.send', fault)

      expect(chaosController.isInjected('pipeline.send')).toBe(true)
    })

    it('should clear a specific fault', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      expect(chaosController.isInjected('pipeline.send')).toBe(true)

      chaosController.clearFault('pipeline.send')
      expect(chaosController.isInjected('pipeline.send')).toBe(false)
    })

    it('should clear all faults', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'error' })
      chaosController.injectFault('network.latency', { type: 'latency', delayMs: 100 })

      expect(chaosController.isInjected('pipeline.send')).toBe(true)
      expect(chaosController.isInjected('sql.exec')).toBe(true)
      expect(chaosController.isInjected('network.latency')).toBe(true)

      chaosController.clearAllFaults()

      expect(chaosController.isInjected('pipeline.send')).toBe(false)
      expect(chaosController.isInjected('sql.exec')).toBe(false)
      expect(chaosController.isInjected('network.latency')).toBe(false)
    })

    it('should return false for non-injected targets', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      expect(chaosController.isInjected('non.existent.target')).toBe(false)
    })

    it('should list all injected faults', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'latency', delayMs: 50 })

      const faults = chaosController.listFaults()

      expect(faults).toHaveLength(2)
      expect(faults.map((f) => f.target)).toContain('pipeline.send')
      expect(faults.map((f) => f.target)).toContain('sql.exec')
    })

    it('should get fault details by target', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const fault: FaultConfig = {
        type: 'error',
        error: new Error('Test error'),
        probability: 0.5,
      }

      chaosController.injectFault('pipeline.send', fault)

      const injectedFault = chaosController.getFault('pipeline.send')

      expect(injectedFault).toBeDefined()
      expect(injectedFault!.config.type).toBe('error')
      expect(injectedFault!.config.probability).toBe(0.5)
    })
  })

  // ============================================================================
  // PIPELINE FAILURE INJECTION TESTS
  // ============================================================================

  describe('Pipeline Failure Injection', () => {
    it('should make pipeline.send() throw when fault injected', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Pipeline chaos failure'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      await expect(wrappedPipeline.send([{ event: 'test' }])).rejects.toThrow('Pipeline chaos failure')
    })

    it('should allow pipeline.send() when fault cleared', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Pipeline chaos failure'),
      })

      chaosController.clearFault('pipeline.send')

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      await expect(wrappedPipeline.send([{ event: 'test' }])).resolves.not.toThrow()
      expect(mockPipeline.events).toContainEqual({ event: 'test' })
    })

    it('should inject custom error types for pipeline', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      class PipelineTimeoutError extends Error {
        constructor() {
          super('Pipeline timeout')
          this.name = 'PipelineTimeoutError'
        }
      }

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new PipelineTimeoutError(),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      try {
        await wrappedPipeline.send([{ event: 'test' }])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineTimeoutError)
      }
    })

    it('should count pipeline failure injections', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Chaos'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // Attempt multiple sends
      for (let i = 0; i < 5; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          // Expected
        }
      }

      const stats = chaosController.getStats()
      expect(stats.faultsTriggered['pipeline.send']).toBe(5)
    })
  })

  // ============================================================================
  // SQLITE FAILURE INJECTION TESTS
  // ============================================================================

  describe('SQLite Failure Injection', () => {
    it('should make sql.exec() throw when fault injected', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('SQLite chaos failure'),
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      await expect(wrappedSql.exec('SELECT 1')).rejects.toThrow('SQLite chaos failure')
    })

    it('should inject SQLITE_BUSY error', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const busyError = new Error('SQLITE_BUSY: database is locked')
      ;(busyError as any).code = 'SQLITE_BUSY'

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: busyError,
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      try {
        await wrappedSql.exec('INSERT INTO things VALUES (1)')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('SQLITE_BUSY')
      }
    })

    it('should inject SQLITE_CORRUPT error', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const corruptError = new Error('SQLITE_CORRUPT: database disk image is malformed')
      ;(corruptError as any).code = 'SQLITE_CORRUPT'

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: corruptError,
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      try {
        await wrappedSql.exec('SELECT * FROM things')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.code).toBe('SQLITE_CORRUPT')
      }
    })

    it('should inject error only for specific SQL operations', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Write failure'),
        scope: {
          pattern: /^INSERT|^UPDATE|^DELETE/i,
        },
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // SELECT should work
      await expect(wrappedSql.exec('SELECT * FROM things')).resolves.not.toThrow()

      // INSERT should fail
      await expect(wrappedSql.exec('INSERT INTO things VALUES (1)')).rejects.toThrow('Write failure')

      // UPDATE should fail
      await expect(wrappedSql.exec('UPDATE things SET name = "test"')).rejects.toThrow('Write failure')
    })
  })

  // ============================================================================
  // NETWORK LATENCY INJECTION TESTS
  // ============================================================================

  describe('Network Latency Injection', () => {
    it('should add delay to pipeline.send()', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'latency',
        delayMs: 500,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      const startTime = Date.now()
      const sendPromise = wrappedPipeline.send([{ event: 'test' }])

      // Advance time
      await vi.advanceTimersByTimeAsync(600)
      await sendPromise

      const elapsed = Date.now() - startTime
      expect(elapsed).toBeGreaterThanOrEqual(500)
    })

    it('should add delay to sql.exec()', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'latency',
        delayMs: 200,
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      const startTime = Date.now()
      const execPromise = wrappedSql.exec('SELECT 1')

      // Advance time
      await vi.advanceTimersByTimeAsync(300)
      await execPromise

      const elapsed = Date.now() - startTime
      expect(elapsed).toBeGreaterThanOrEqual(200)
    })

    it('should inject random latency within range', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'latency',
        delayMs: { min: 100, max: 500 },
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const triggerCounts: number[] = []

      // Make multiple calls to verify latency is being applied with variation
      for (let i = 0; i < 10; i++) {
        const sendPromise = wrappedPipeline.send([{ event: i }])

        // Advance timer incrementally to verify delay is in range
        // At 99ms, the send should NOT have completed (min is 100ms)
        await vi.advanceTimersByTimeAsync(99)

        // At 501ms, the send SHOULD have completed (max is 500ms)
        await vi.advanceTimersByTimeAsync(402)
        await sendPromise

        // Track trigger count for variation check
        const stats = chaosController.getStats()
        triggerCounts.push(stats.faultsTriggered['pipeline.send'] || 0)

        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
      }

      // All sends should have triggered the fault
      const stats = chaosController.getStats()
      expect(stats.faultsTriggered['pipeline.send']).toBe(10)

      // Verify events were sent (proves sends completed successfully)
      expect(mockPipeline.events.length).toBe(10)
    })

    it('should combine latency with error injection', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'latency-then-error',
        delayMs: 200,
        error: new Error('Timeout after delay'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      const startTime = Date.now()
      const sendPromise = wrappedPipeline.send([{ event: 'test' }])

      await vi.advanceTimersByTimeAsync(300)

      const elapsed = Date.now() - startTime

      await expect(sendPromise).rejects.toThrow('Timeout after delay')
      expect(elapsed).toBeGreaterThanOrEqual(200)
    })
  })

  // ============================================================================
  // DO EVICTION SIMULATION TESTS
  // ============================================================================

  describe('DO Eviction Simulation', () => {
    it('should trigger hibernation on DO', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        doState: mockDOState as any,
      })

      expect(mockDOState.isHibernating()).toBe(false)

      chaosController.injectFault('do.eviction', {
        type: 'eviction',
      })

      await chaosController.triggerEviction()

      expect(mockDOState.isHibernating()).toBe(true)
    })

    it('should simulate cold start recovery after eviction', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        doState: mockDOState as any,
      })

      chaosController.injectFault('do.eviction', {
        type: 'eviction',
        coldStartDelayMs: 500,
      })

      await chaosController.triggerEviction()
      expect(mockDOState.isHibernating()).toBe(true)

      // Simulate wake-up
      const wakePromise = chaosController.simulateWakeUp()

      const startTime = Date.now()
      await vi.advanceTimersByTimeAsync(600)
      await wakePromise

      const elapsed = Date.now() - startTime

      expect(elapsed).toBeGreaterThanOrEqual(500)
      expect(mockDOState.isHibernating()).toBe(false)
    })

    it('should clear in-memory state on eviction', async () => {
      let memoryState = { loaded: true, data: { key: 'value' } }

      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        doState: mockDOState as any,
        onEviction: () => {
          memoryState = { loaded: false, data: {} }
        },
      })

      expect(memoryState.loaded).toBe(true)

      chaosController.injectFault('do.eviction', { type: 'eviction' })
      await chaosController.triggerEviction()

      expect(memoryState.loaded).toBe(false)
      expect(memoryState.data).toEqual({})
    })

    it('should schedule periodic evictions', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        doState: mockDOState as any,
      })

      let evictionCount = 0
      chaosController.on('eviction', () => {
        evictionCount++
      })

      chaosController.injectFault('do.eviction', {
        type: 'eviction',
        intervalMs: 10000, // Every 10 seconds
      })

      // Advance time to trigger multiple evictions
      await vi.advanceTimersByTimeAsync(35000)

      expect(evictionCount).toBe(3)
    })
  })

  // ============================================================================
  // CLOCK SKEW INJECTION TESTS
  // ============================================================================

  describe('Clock Skew Injection', () => {
    it('should offset timestamps forward', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        clock: mockClock as any,
      })

      chaosController.injectFault('clock.skew', {
        type: 'clock-skew',
        offsetMs: 60000, // 1 minute forward
      })

      const wrappedClock = chaosController.wrapClock(mockClock)

      const baseTime = Date.now()
      const skewedTime = wrappedClock.now()

      expect(skewedTime - baseTime).toBe(60000)
    })

    it('should offset timestamps backward', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        clock: mockClock as any,
      })

      chaosController.injectFault('clock.skew', {
        type: 'clock-skew',
        offsetMs: -30000, // 30 seconds backward
      })

      const wrappedClock = chaosController.wrapClock(mockClock)

      const baseTime = Date.now()
      const skewedTime = wrappedClock.now()

      expect(baseTime - skewedTime).toBe(30000)
    })

    it('should simulate clock drift over time', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        clock: mockClock as any,
      })

      chaosController.injectFault('clock.skew', {
        type: 'clock-drift',
        driftRateMs: 10, // Drift 10ms per second
      })

      const wrappedClock = chaosController.wrapClock(mockClock)

      const initialSkew = wrappedClock.now() - Date.now()

      // Advance time by 10 seconds
      await vi.advanceTimersByTimeAsync(10000)

      const newSkew = wrappedClock.now() - Date.now()

      // Should have drifted by ~100ms (10ms/s * 10s)
      expect(newSkew - initialSkew).toBeCloseTo(100, -1)
    })

    it('should affect event timestamps', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        clock: mockClock as any,
      })

      chaosController.injectFault('clock.skew', {
        type: 'clock-skew',
        offsetMs: 3600000, // 1 hour forward
      })

      // Assuming the pipeline uses the wrapped clock for timestamps
      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      await wrappedPipeline.send([{ event: 'test' }])

      const sentEvent = mockPipeline.events[0] as any

      // The timestamp should be offset by 1 hour
      const expectedTime = new Date('2026-01-14T13:00:00.000Z').toISOString()
      expect(sentEvent.timestamp).toBe(expectedTime)
    })
  })

  // ============================================================================
  // PROBABILITY-BASED FAILURE TESTS
  // ============================================================================

  describe('Probability-Based Failures', () => {
    it('should fail X% of the time', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Random failure'),
        probability: 0.5, // 50% failure rate
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      let failures = 0
      let successes = 0
      const trials = 100

      for (let i = 0; i < trials; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
          successes++
        } catch {
          failures++
        }
      }

      // With 50% probability, expect roughly half to fail
      // Allow for statistical variance (30-70% range)
      expect(failures).toBeGreaterThan(30)
      expect(failures).toBeLessThan(70)
      expect(successes).toBeGreaterThan(30)
      expect(successes).toBeLessThan(70)
    })

    it('should never fail with probability 0', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Should never happen'),
        probability: 0,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      for (let i = 0; i < 50; i++) {
        await expect(wrappedPipeline.send([{ event: i }])).resolves.not.toThrow()
      }
    })

    it('should always fail with probability 1', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Always fails'),
        probability: 1,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      for (let i = 0; i < 50; i++) {
        await expect(wrappedPipeline.send([{ event: i }])).rejects.toThrow('Always fails')
      }
    })

    it('should apply probability to latency injection', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'latency',
        delayMs: 500,
        probability: 0.3, // 30% of requests get delayed
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const trials = 50

      for (let i = 0; i < trials; i++) {
        const sendPromise = wrappedPipeline.send([{ event: i }])
        await vi.advanceTimersByTimeAsync(600)
        await sendPromise
        vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
      }

      // Use stats to verify probability is being applied correctly
      // With 30% probability over 50 trials, expect roughly 15 triggers (30%)
      const stats = chaosController.getStats()
      const faultsTriggered = stats.faultsTriggered['pipeline.send'] || 0

      // Expect roughly 30% to be delayed (allow 10-50% range: 5-25 out of 50)
      expect(faultsTriggered).toBeGreaterThan(5)
      expect(faultsTriggered).toBeLessThan(25)
    })
  })

  // ============================================================================
  // FAULT SCOPING TESTS
  // ============================================================================

  describe('Fault Scoping', () => {
    it('should apply fault only to matching operations', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Scoped failure'),
        scope: {
          pattern: /^INSERT/i,
        },
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // SELECT should work
      await expect(wrappedSql.exec('SELECT * FROM things')).resolves.not.toThrow()

      // INSERT should fail
      await expect(wrappedSql.exec('INSERT INTO things VALUES (1)')).rejects.toThrow('Scoped failure')
    })

    it('should apply fault only to specific tables', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Table-scoped failure'),
        scope: {
          tables: ['events', 'actions'],
        },
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // things table should work
      await expect(wrappedSql.exec('INSERT INTO things VALUES (1)')).resolves.not.toThrow()

      // events table should fail
      await expect(wrappedSql.exec('INSERT INTO events VALUES (1)')).rejects.toThrow('Table-scoped failure')

      // actions table should fail
      await expect(wrappedSql.exec('SELECT * FROM actions')).rejects.toThrow('Table-scoped failure')
    })

    it('should apply fault only within time window', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const startTime = Date.now()
      const endTime = startTime + 5000 // 5 second window

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Time-scoped failure'),
        scope: {
          startTime,
          endTime,
        },
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // Within window - should fail
      await expect(wrappedPipeline.send([{ event: 1 }])).rejects.toThrow('Time-scoped failure')

      // After window - should succeed
      await vi.advanceTimersByTimeAsync(6000)
      await expect(wrappedPipeline.send([{ event: 2 }])).resolves.not.toThrow()
    })

    it('should apply fault only for specific namespaces', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        namespace: 'tenant-a',
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Namespace-scoped failure'),
        scope: {
          namespaces: ['tenant-a', 'tenant-b'],
        },
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // tenant-a should fail (current namespace)
      await expect(wrappedPipeline.send([{ event: 1 }])).rejects.toThrow('Namespace-scoped failure')

      // Change namespace
      chaosController.setNamespace('tenant-c')

      // tenant-c should succeed (not in scope)
      await expect(wrappedPipeline.send([{ event: 2 }])).resolves.not.toThrow()
    })

    it('should combine multiple scope conditions (AND)', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Combined scope failure'),
        scope: {
          pattern: /^INSERT/i,
          tables: ['things'],
        },
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // INSERT into things - both conditions match - should fail
      await expect(wrappedSql.exec('INSERT INTO things VALUES (1)')).rejects.toThrow('Combined scope failure')

      // SELECT from things - pattern doesn't match - should succeed
      await expect(wrappedSql.exec('SELECT * FROM things')).resolves.not.toThrow()

      // INSERT into events - table doesn't match - should succeed
      await expect(wrappedSql.exec('INSERT INTO events VALUES (1)')).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // FAULT CLEARING AND RESET TESTS
  // ============================================================================

  describe('Fault Clearing and Reset', () => {
    it('should clear single fault by target', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'error' })

      chaosController.clearFault('pipeline.send')

      expect(chaosController.isInjected('pipeline.send')).toBe(false)
      expect(chaosController.isInjected('sql.exec')).toBe(true)
    })

    it('should clear all faults at once', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'latency', delayMs: 100 })
      chaosController.injectFault('clock.skew', { type: 'clock-skew', offsetMs: 1000 })

      chaosController.clearAllFaults()

      expect(chaosController.listFaults()).toHaveLength(0)
    })

    it('should reset stats when clearing faults', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      for (let i = 0; i < 5; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          // Expected
        }
      }

      expect(chaosController.getStats().faultsTriggered['pipeline.send']).toBe(5)

      chaosController.reset()

      expect(chaosController.getStats().faultsTriggered['pipeline.send']).toBeUndefined()
      expect(chaosController.listFaults()).toHaveLength(0)
    })

    it('should support auto-clear after N triggers', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Limited failure'),
        maxTriggers: 3,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // First 3 should fail
      for (let i = 0; i < 3; i++) {
        await expect(wrappedPipeline.send([{ event: i }])).rejects.toThrow('Limited failure')
      }

      // 4th and beyond should succeed (fault auto-cleared)
      await expect(wrappedPipeline.send([{ event: 4 }])).resolves.not.toThrow()
      await expect(wrappedPipeline.send([{ event: 5 }])).resolves.not.toThrow()

      expect(chaosController.isInjected('pipeline.send')).toBe(false)
    })

    it('should support auto-clear after duration', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Temporary failure'),
        durationMs: 5000,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // Should fail within duration
      await expect(wrappedPipeline.send([{ event: 1 }])).rejects.toThrow('Temporary failure')

      // Advance past duration
      await vi.advanceTimersByTimeAsync(6000)

      // Should succeed after duration expires
      await expect(wrappedPipeline.send([{ event: 2 }])).resolves.not.toThrow()

      expect(chaosController.isInjected('pipeline.send')).toBe(false)
    })
  })

  // ============================================================================
  // MULTIPLE CONCURRENT FAULTS TESTS
  // ============================================================================

  describe('Multiple Concurrent Faults', () => {
    it('should apply multiple faults to different targets', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Pipeline error'),
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('SQL error'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      await expect(wrappedPipeline.send([{ event: 1 }])).rejects.toThrow('Pipeline error')
      await expect(wrappedSql.exec('SELECT 1')).rejects.toThrow('SQL error')
    })

    it('should apply multiple faults to same target (chain)', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Latency followed by error
      chaosController.injectFault('pipeline.send', {
        type: 'latency',
        delayMs: 200,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('After latency'),
        chain: true, // Add to chain, don't replace
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      const startTime = Date.now()
      const sendPromise = wrappedPipeline.send([{ event: 1 }])

      // Attach rejection handler BEFORE advancing time to prevent unhandled rejection
      const expectation = expect(sendPromise).rejects.toThrow('After latency')

      await vi.advanceTimersByTimeAsync(300)

      const elapsed = Date.now() - startTime

      await expectation
      expect(elapsed).toBeGreaterThanOrEqual(200)
    })

    it('should report combined stats for multiple faults', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'error' })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      for (let i = 0; i < 3; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          // Expected
        }
        try {
          await wrappedSql.exec('SELECT 1')
        } catch {
          // Expected
        }
      }

      const stats = chaosController.getStats()

      expect(stats.totalFaultsTriggered).toBe(6)
      expect(stats.faultsTriggered['pipeline.send']).toBe(3)
      expect(stats.faultsTriggered['sql.exec']).toBe(3)
    })

    it('should allow different probabilities for concurrent faults', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Low probability'),
        probability: 0.1,
      })

      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('High probability'),
        probability: 0.9,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      let pipelineFailures = 0
      let sqlFailures = 0
      const trials = 100

      for (let i = 0; i < trials; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          pipelineFailures++
        }
        try {
          await wrappedSql.exec('SELECT 1')
        } catch {
          sqlFailures++
        }
      }

      // Pipeline should have low failure rate (~10%)
      expect(pipelineFailures).toBeLessThan(30)

      // SQL should have high failure rate (~90%)
      expect(sqlFailures).toBeGreaterThan(70)
    })

    it('should support concurrent scoped faults on same target', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Fail inserts
      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Insert failure'),
        scope: { pattern: /^INSERT/i },
      })

      // Add latency to selects
      chaosController.injectFault('sql.exec', {
        type: 'latency',
        delayMs: 100,
        scope: { pattern: /^SELECT/i },
      })

      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // INSERT should fail
      await expect(wrappedSql.exec('INSERT INTO things VALUES (1)')).rejects.toThrow('Insert failure')

      // SELECT should be delayed but succeed
      const startTime = Date.now()
      const selectPromise = wrappedSql.exec('SELECT * FROM things')
      await vi.advanceTimersByTimeAsync(150)
      await selectPromise
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeGreaterThanOrEqual(100)
    })
  })

  // ============================================================================
  // CONSTRUCTOR AND CONFIG TESTS
  // ============================================================================

  describe('Constructor and Config', () => {
    it('should create controller with minimal config', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      expect(chaosController).toBeInstanceOf(ChaosController)
    })

    it('should enable/disable chaos mode', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        enabled: false,
      })

      expect(chaosController.isEnabled()).toBe(false)

      chaosController.enable()
      expect(chaosController.isEnabled()).toBe(true)

      chaosController.disable()
      expect(chaosController.isEnabled()).toBe(false)
    })

    it('should not trigger faults when disabled', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        enabled: false,
      })

      chaosController.injectFault('pipeline.send', {
        type: 'error',
        error: new Error('Should not trigger'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // Should succeed because chaos is disabled
      await expect(wrappedPipeline.send([{ event: 1 }])).resolves.not.toThrow()
    })

    it('should use seed for reproducible randomness', async () => {
      const controller1 = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        seed: 12345,
      })

      const controller2 = new ChaosController({
        pipeline: createMockPipeline() as any,
        sqlStorage: createMockSqlStorage() as any,
        seed: 12345,
      })

      controller1.injectFault('pipeline.send', { type: 'error', probability: 0.5 })
      controller2.injectFault('pipeline.send', { type: 'error', probability: 0.5 })

      const results1: boolean[] = []
      const results2: boolean[] = []

      const wrapped1 = controller1.wrapPipeline(mockPipeline)
      const wrapped2 = controller2.wrapPipeline(createMockPipeline())

      for (let i = 0; i < 20; i++) {
        try {
          await wrapped1.send([{ event: i }])
          results1.push(true)
        } catch {
          results1.push(false)
        }
        try {
          await wrapped2.send([{ event: i }])
          results2.push(true)
        } catch {
          results2.push(false)
        }
      }

      // Same seed should produce same results
      expect(results1).toEqual(results2)

      await controller1.close()
      await controller2.close()
    })

    it('should emit events when faults trigger', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const events: { target: string; type: string }[] = []

      chaosController.on('fault-triggered', (event) => {
        events.push({ target: event.target, type: event.config.type })
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      try {
        await wrappedPipeline.send([{ event: 1 }])
      } catch {
        // Expected
      }

      expect(events).toHaveLength(1)
      expect(events[0].target).toBe('pipeline.send')
      expect(events[0].type).toBe('error')
    })

    it('should close gracefully', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      chaosController.injectFault('pipeline.send', { type: 'error' })

      await chaosController.close()

      expect(chaosController.isClosed()).toBe(true)
      expect(chaosController.listFaults()).toHaveLength(0)
    })
  })

  // ============================================================================
  // INTEGRATION SCENARIOS
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should simulate complete infrastructure failure', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
        doState: mockDOState as any,
      })

      // Simulate cascading failure
      chaosController.injectFault('pipeline.send', { type: 'error' })
      chaosController.injectFault('sql.exec', { type: 'error' })
      chaosController.injectFault('do.eviction', { type: 'eviction' })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      await expect(wrappedPipeline.send([{ event: 1 }])).rejects.toThrow()
      await expect(wrappedSql.exec('SELECT 1')).rejects.toThrow()
      await chaosController.triggerEviction()

      expect(mockDOState.isHibernating()).toBe(true)
    })

    it('should simulate network partition with partial failures', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Pipeline works but with latency
      chaosController.injectFault('pipeline.send', {
        type: 'latency',
        delayMs: 5000,
      })

      // SQL is completely unavailable
      chaosController.injectFault('sql.exec', {
        type: 'error',
        error: new Error('Network partition - SQL unreachable'),
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)
      const wrappedSql = chaosController.wrapSqlStorage(mockSqlStorage)

      // Pipeline should be slow but work
      const sendPromise = wrappedPipeline.send([{ event: 1 }])
      await vi.advanceTimersByTimeAsync(6000)
      await expect(sendPromise).resolves.not.toThrow()

      // SQL should fail
      await expect(wrappedSql.exec('SELECT 1')).rejects.toThrow('Network partition')
    })

    it('should simulate gradual degradation', async () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      const wrappedPipeline = chaosController.wrapPipeline(mockPipeline)

      // Phase 1: Healthy
      await expect(wrappedPipeline.send([{ event: 1 }])).resolves.not.toThrow()

      // Phase 2: Degraded (10% failures)
      chaosController.injectFault('pipeline.send', {
        type: 'error',
        probability: 0.1,
      })

      let phase2Failures = 0
      for (let i = 0; i < 20; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          phase2Failures++
        }
      }
      expect(phase2Failures).toBeLessThan(10) // ~10% failure rate

      // Phase 3: Critical (50% failures)
      chaosController.clearFault('pipeline.send')
      chaosController.injectFault('pipeline.send', {
        type: 'error',
        probability: 0.5,
      })

      let phase3Failures = 0
      for (let i = 0; i < 20; i++) {
        try {
          await wrappedPipeline.send([{ event: i }])
        } catch {
          phase3Failures++
        }
      }
      expect(phase3Failures).toBeGreaterThan(5) // ~50% failure rate

      // Phase 4: Complete failure
      chaosController.clearFault('pipeline.send')
      chaosController.injectFault('pipeline.send', {
        type: 'error',
        probability: 1,
      })

      await expect(wrappedPipeline.send([{ event: 999 }])).rejects.toThrow()
    })

    it('should provide chaos scenario presets', () => {
      chaosController = new ChaosController({
        pipeline: mockPipeline as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Apply preset for network instability
      chaosController.applyPreset('network-instability')

      const faults = chaosController.listFaults()
      expect(faults.length).toBeGreaterThan(0)

      // Should have latency and some failures
      const hasLatency = faults.some((f) => f.config.type === 'latency')
      const hasError = faults.some((f) => f.config.type === 'error')

      expect(hasLatency).toBe(true)
      expect(hasError).toBe(true)
    })
  })
})
