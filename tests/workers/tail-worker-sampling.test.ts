import { describe, it, expect } from 'vitest'

/**
 * Tail Worker Sampling Logic Tests (RED Phase)
 *
 * These tests verify the shouldSample function that determines which TailItems
 * to capture for observability purposes.
 *
 * Sampling Rules:
 * - 100% capture rate for errors (outcome !== 'ok', status >= 500, has exceptions)
 * - Configurable capture rate for success (default 10%)
 *
 * Implementation requirements:
 * - Create workers/observability-tail/sample.ts with the shouldSample function
 * - Define SampleConfig interface
 * - Export from workers/observability-tail/index.ts
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

// These imports should fail until the implementation exists
import { shouldSample, type SampleConfig } from '../../workers/observability-tail/sample'

// Mock TailItem interface based on Cloudflare Workers types
interface TailItem {
  readonly scriptName?: string
  readonly event:
    | {
        readonly request?: {
          readonly url: string
          readonly method: string
        }
        readonly response?: {
          readonly status: number
        }
      }
    | ScheduledEvent
    | AlarmEvent
    | QueueEvent
    | EmailEvent
    | TailEvent
  readonly eventTimestamp: number | null
  readonly logs: readonly TailLog[]
  readonly exceptions: readonly TailException[]
  readonly outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
}

interface TailLog {
  readonly timestamp: number
  readonly level: string
  readonly message: readonly unknown[]
}

interface TailException {
  readonly timestamp: number
  readonly name: string
  readonly message: string
}

// Simplified event types for testing
interface ScheduledEvent {
  readonly cron: string
}

interface AlarmEvent {
  readonly scheduledTime: Date
}

interface QueueEvent {
  readonly batchSize: number
}

interface EmailEvent {
  readonly rawEmail: string
}

interface TailEvent {
  readonly consumedEvents: readonly TailItem[]
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a minimal TailItem for testing with the given overrides
 */
function createTailItem(overrides: Partial<TailItem> = {}): TailItem {
  return {
    scriptName: 'test-worker',
    event: {
      request: {
        url: 'https://example.com/api/test',
        method: 'GET',
      },
      response: {
        status: 200,
      },
    },
    eventTimestamp: Date.now(),
    logs: [],
    exceptions: [],
    outcome: 'ok',
    ...overrides,
  }
}

/**
 * Creates a TailItem with an exception
 */
function createExceptionTailItem(exception: Partial<TailException> = {}): TailItem {
  return createTailItem({
    exceptions: [
      {
        timestamp: Date.now(),
        name: 'Error',
        message: 'Something went wrong',
        ...exception,
      },
    ],
  })
}

/**
 * Creates a TailItem with a 5xx status code
 */
function createServerErrorTailItem(status: number = 500): TailItem {
  return createTailItem({
    event: {
      request: {
        url: 'https://example.com/api/test',
        method: 'GET',
      },
      response: {
        status,
      },
    },
  })
}

/**
 * Creates a default SampleConfig
 */
function createDefaultConfig(): SampleConfig {
  return {
    errorRate: 1.0,
    successRate: 0.1,
  }
}

// ============================================================================
// Error Condition Tests - Always Sample
// ============================================================================

describe('shouldSample - Error Conditions (Always Sample)', () => {
  it('should always sample when outcome is "exception"', () => {
    const item = createTailItem({ outcome: 'exception' })
    const config = createDefaultConfig()

    // Even with random returning 1.0 (highest), should still sample
    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when outcome is "exceededCpu"', () => {
    const item = createTailItem({ outcome: 'exceededCpu' })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when outcome is "exceededMemory"', () => {
    const item = createTailItem({ outcome: 'exceededMemory' })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when outcome is "canceled"', () => {
    const item = createTailItem({ outcome: 'canceled' })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when outcome is "unknown"', () => {
    const item = createTailItem({ outcome: 'unknown' })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when status >= 500', () => {
    const item = createServerErrorTailItem(500)
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when status is 502 (Bad Gateway)', () => {
    const item = createServerErrorTailItem(502)
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when status is 503 (Service Unavailable)', () => {
    const item = createServerErrorTailItem(503)
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when status is 599 (highest server error)', () => {
    const item = createServerErrorTailItem(599)
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when exceptions array is not empty', () => {
    const item = createExceptionTailItem()
    const config = createDefaultConfig()

    // Even with random returning 1.0 (highest), should still sample
    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should always sample when multiple exceptions are present', () => {
    const item = createTailItem({
      exceptions: [
        { timestamp: Date.now(), name: 'TypeError', message: 'First error' },
        { timestamp: Date.now(), name: 'RangeError', message: 'Second error' },
      ],
    })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })
})

// ============================================================================
// Success Condition Tests - Configurable Rate
// ============================================================================

describe('shouldSample - Success Conditions (Configurable Rate)', () => {
  it('should sample successful request when random < successRate (10%)', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config = createDefaultConfig() // successRate: 0.1

    // Random returns 0.05, which is < 0.1, so should sample
    const result = shouldSample(item, config, () => 0.05)

    expect(result).toBe(true)
  })

  it('should not sample successful request when random >= successRate (10%)', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config = createDefaultConfig() // successRate: 0.1

    // Random returns 0.15, which is >= 0.1, so should not sample
    const result = shouldSample(item, config, () => 0.15)

    expect(result).toBe(false)
  })

  it('should sample at boundary when random equals successRate', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config = createDefaultConfig() // successRate: 0.1

    // Random returns exactly 0.1 - edge case, typically should not sample
    const result = shouldSample(item, config, () => 0.1)

    expect(result).toBe(false)
  })

  it('should always sample successful requests when successRate is 100%', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 1.0,
    }

    // Even with random returning 0.99 (very high), should sample at 100%
    const result = shouldSample(item, config, () => 0.99)

    expect(result).toBe(true)
  })

  it('should never sample successful requests when successRate is 0%', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.0,
    }

    // Even with random returning 0.0 (lowest), should not sample at 0%
    const result = shouldSample(item, config, () => 0.0)

    expect(result).toBe(false)
  })

  it('should sample successful requests at 50% rate correctly', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.5,
    }

    // Random 0.3 < 0.5, should sample
    expect(shouldSample(item, config, () => 0.3)).toBe(true)

    // Random 0.7 >= 0.5, should not sample
    expect(shouldSample(item, config, () => 0.7)).toBe(false)
  })

  it('should not sample 4xx errors at success rate (they are client errors, not server errors)', () => {
    const item = createTailItem({
      event: {
        request: { url: 'https://example.com/api/test', method: 'GET' },
        response: { status: 404 },
      },
      outcome: 'ok',
    })
    const config = createDefaultConfig()

    // With random > successRate, should not sample
    const result = shouldSample(item, config, () => 0.5)

    expect(result).toBe(false)
  })
})

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('shouldSample - Default Configuration', () => {
  it('should use 100% error rate by default', () => {
    const item = createTailItem({ outcome: 'exception' })
    const config = createDefaultConfig()

    expect(config.errorRate).toBe(1.0)
    expect(shouldSample(item, config, () => 1.0)).toBe(true)
  })

  it('should use 10% success rate by default', () => {
    const config = createDefaultConfig()

    expect(config.successRate).toBe(0.1)
  })
})

// ============================================================================
// Deterministic Sampling Tests (Seeded Random)
// ============================================================================

describe('shouldSample - Deterministic Sampling with Seeded Random', () => {
  it('should produce consistent results with same random seed', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config = createDefaultConfig()

    // Same random value should produce same result
    const seedValue = 0.05
    const result1 = shouldSample(item, config, () => seedValue)
    const result2 = shouldSample(item, config, () => seedValue)

    expect(result1).toBe(result2)
  })

  it('should use Math.random when no random function provided', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 1.0, // 100% so we always get true
    }

    // Without seeded random, should still work
    const result = shouldSample(item, config)

    expect(typeof result).toBe('boolean')
  })

  it('should allow testing of specific sampling scenarios', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.25,
    }

    // Test exactly at 25% threshold
    expect(shouldSample(item, config, () => 0.24)).toBe(true)
    expect(shouldSample(item, config, () => 0.25)).toBe(false)
    expect(shouldSample(item, config, () => 0.26)).toBe(false)
  })
})

// ============================================================================
// Error Rate Configuration Tests
// ============================================================================

describe('shouldSample - Error Rate Configuration', () => {
  it('should respect custom error rate for outcome errors', () => {
    const item = createTailItem({ outcome: 'exception' })
    const config: SampleConfig = {
      errorRate: 0.5, // 50% error sampling
      successRate: 0.1,
    }

    // With errorRate at 0.5, random 0.3 < 0.5 should sample
    expect(shouldSample(item, config, () => 0.3)).toBe(true)

    // With errorRate at 0.5, random 0.7 >= 0.5 should not sample
    expect(shouldSample(item, config, () => 0.7)).toBe(false)
  })

  it('should respect custom error rate for status >= 500', () => {
    const item = createServerErrorTailItem(500)
    const config: SampleConfig = {
      errorRate: 0.5,
      successRate: 0.1,
    }

    expect(shouldSample(item, config, () => 0.3)).toBe(true)
    expect(shouldSample(item, config, () => 0.7)).toBe(false)
  })

  it('should respect custom error rate for exceptions', () => {
    const item = createExceptionTailItem()
    const config: SampleConfig = {
      errorRate: 0.5,
      successRate: 0.1,
    }

    expect(shouldSample(item, config, () => 0.3)).toBe(true)
    expect(shouldSample(item, config, () => 0.7)).toBe(false)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('shouldSample - Edge Cases', () => {
  it('should handle TailItem without response (scheduled event)', () => {
    const item = createTailItem({
      event: {
        cron: '0 * * * *',
      } as ScheduledEvent,
      outcome: 'ok',
    })
    const config = createDefaultConfig()

    // Without response, should use success rate
    const result = shouldSample(item, config, () => 0.05)

    expect(result).toBe(true)
  })

  it('should handle TailItem without request (alarm event)', () => {
    const item = createTailItem({
      event: {
        scheduledTime: new Date(),
      } as AlarmEvent,
      outcome: 'ok',
    })
    const config = createDefaultConfig()

    const result = shouldSample(item, config, () => 0.05)

    expect(result).toBe(true)
  })

  it('should prioritize outcome over status when both indicate error', () => {
    const item = createTailItem({
      event: {
        request: { url: 'https://example.com', method: 'GET' },
        response: { status: 500 },
      },
      outcome: 'exception',
    })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.1,
    }

    // Both conditions are errors, should definitely sample
    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(true)
  })

  it('should treat status 499 as success (not server error)', () => {
    const item = createTailItem({
      event: {
        request: { url: 'https://example.com', method: 'GET' },
        response: { status: 499 },
      },
      outcome: 'ok',
    })
    const config = createDefaultConfig()

    // 499 is not >= 500, so should use success rate
    const result = shouldSample(item, config, () => 0.5)

    expect(result).toBe(false)
  })

  it('should handle empty exceptions array as success', () => {
    const item = createTailItem({
      exceptions: [],
      outcome: 'ok',
    })
    const config = createDefaultConfig()

    // Empty exceptions array, should use success rate
    const result = shouldSample(item, config, () => 0.5)

    expect(result).toBe(false)
  })

  it('should sample at 0% when random returns exactly 0', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.1,
    }

    // Random 0.0 < 0.1, should sample
    const result = shouldSample(item, config, () => 0.0)

    expect(result).toBe(true)
  })

  it('should not sample when random returns 1.0 and rate < 1.0', () => {
    const item = createTailItem({ outcome: 'ok' })
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.99,
    }

    // Random 1.0 >= 0.99, should not sample (edge case: Math.random() never returns 1.0, but test defensively)
    const result = shouldSample(item, config, () => 1.0)

    expect(result).toBe(false)
  })
})

// ============================================================================
// Integration-style Tests
// ============================================================================

describe('shouldSample - Integration Scenarios', () => {
  it('should correctly sample a batch of mixed TailItems', () => {
    const config = createDefaultConfig()
    const alwaysSample = () => 0.0 // Always sample
    const neverSample = () => 1.0 // Never sample (for success rate)

    const items: TailItem[] = [
      createTailItem({ outcome: 'ok' }), // Success
      createTailItem({ outcome: 'exception' }), // Error - always sample
      createServerErrorTailItem(503), // 5xx - always sample
      createExceptionTailItem(), // Has exception - always sample
      createTailItem({ outcome: 'ok' }), // Success
    ]

    // With neverSample random, only errors should be sampled
    const results = items.map((item) => shouldSample(item, config, neverSample))

    expect(results).toEqual([
      false, // Success - not sampled at random 1.0
      true, // Exception outcome - always sampled
      true, // 503 status - always sampled
      true, // Has exceptions - always sampled
      false, // Success - not sampled at random 1.0
    ])
  })

  it('should sample all items when success rate is 100%', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 1.0,
    }

    const items: TailItem[] = [
      createTailItem({ outcome: 'ok' }),
      createTailItem({ outcome: 'ok' }),
      createTailItem({ outcome: 'ok' }),
    ]

    const results = items.map((item) => shouldSample(item, config, () => 0.99))

    expect(results).toEqual([true, true, true])
  })

  it('should sample no success items when success rate is 0%', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.0,
    }

    const items: TailItem[] = [
      createTailItem({ outcome: 'ok' }),
      createTailItem({ outcome: 'ok' }),
      createExceptionTailItem(), // Error - still sampled
    ]

    const results = items.map((item) => shouldSample(item, config, () => 0.0))

    expect(results).toEqual([
      false, // Success - not sampled at 0%
      false, // Success - not sampled at 0%
      true, // Error - sampled at error rate
    ])
  })
})
