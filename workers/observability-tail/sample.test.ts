/**
 * Tail Worker Sampling Logic Tests
 *
 * Tests for the sampling decision logic that determines
 * which TailItems should be captured for observability.
 *
 * @module workers/observability-tail/sample.test
 */

import { describe, it, expect } from 'vitest'
import { shouldSample, type SampleConfig } from './sample'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTailItem(overrides: {
  outcome?: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
  status?: number
  exceptions?: readonly unknown[]
} = {}) {
  return {
    event: overrides.status !== undefined
      ? { response: { status: overrides.status } }
      : {},
    exceptions: overrides.exceptions ?? [],
    outcome: overrides.outcome ?? 'ok',
  }
}

// ============================================================================
// Error Condition Detection Tests
// ============================================================================

describe('Error Condition Detection', () => {
  describe('Outcome-based Errors', () => {
    it('detects exception outcome as error', () => {
      const item = createTailItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects exceededCpu outcome as error', () => {
      const item = createTailItem({ outcome: 'exceededCpu' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects exceededMemory outcome as error', () => {
      const item = createTailItem({ outcome: 'exceededMemory' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects canceled outcome as error', () => {
      const item = createTailItem({ outcome: 'canceled' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects unknown outcome as error', () => {
      const item = createTailItem({ outcome: 'unknown' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('ok outcome is not an error', () => {
      const item = createTailItem({ outcome: 'ok' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      // successRate is 0.0, so non-errors are never sampled
      expect(shouldSample(item, config)).toBe(false)
    })
  })

  describe('Status-based Errors', () => {
    it('detects 500 status as error', () => {
      const item = createTailItem({ outcome: 'ok', status: 500 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects 502 status as error', () => {
      const item = createTailItem({ outcome: 'ok', status: 502 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects 503 status as error', () => {
      const item = createTailItem({ outcome: 'ok', status: 503 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('detects 504 status as error', () => {
      const item = createTailItem({ outcome: 'ok', status: 504 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('200 status is not an error', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('201 status is not an error', () => {
      const item = createTailItem({ outcome: 'ok', status: 201 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('204 status is not an error', () => {
      const item = createTailItem({ outcome: 'ok', status: 204 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('400 status is not an error (client error)', () => {
      const item = createTailItem({ outcome: 'ok', status: 400 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('404 status is not an error (client error)', () => {
      const item = createTailItem({ outcome: 'ok', status: 404 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('499 status is not an error', () => {
      const item = createTailItem({ outcome: 'ok', status: 499 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })
  })

  describe('Exception-based Errors', () => {
    it('detects non-empty exceptions array as error', () => {
      const item = createTailItem({
        outcome: 'ok',
        exceptions: [{ name: 'Error', message: 'Test error' }],
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('empty exceptions array is not an error', () => {
      const item = createTailItem({ outcome: 'ok', exceptions: [] })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })

    it('handles multiple exceptions', () => {
      const item = createTailItem({
        outcome: 'ok',
        exceptions: [
          { name: 'Error1', message: 'First error' },
          { name: 'Error2', message: 'Second error' },
        ],
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })
  })

  describe('Combined Error Conditions', () => {
    it('outcome error takes precedence', () => {
      const item = createTailItem({ outcome: 'exception', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('status error with ok outcome is still error', () => {
      const item = createTailItem({ outcome: 'ok', status: 500, exceptions: [] })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('exceptions with ok outcome and 200 status is error', () => {
      const item = createTailItem({
        outcome: 'ok',
        status: 200,
        exceptions: [{ name: 'Error', message: 'Caught exception' }],
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })
  })
})

// ============================================================================
// Sampling Rate Tests
// ============================================================================

describe('Sampling Rate', () => {
  describe('Error Rate', () => {
    it('always samples errors when errorRate is 1.0', () => {
      const item = createTailItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      // Should always sample
      for (let i = 0; i < 10; i++) {
        expect(shouldSample(item, config)).toBe(true)
      }
    })

    it('never samples errors when errorRate is 0.0', () => {
      const item = createTailItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 0.0, successRate: 1.0 }

      // Should never sample
      for (let i = 0; i < 10; i++) {
        expect(shouldSample(item, config)).toBe(false)
      }
    })

    it('samples errors based on errorRate', () => {
      const item = createTailItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.0 }

      // With fixed random value below rate, should sample
      expect(shouldSample(item, config, () => 0.3)).toBe(true)

      // With fixed random value above rate, should not sample
      expect(shouldSample(item, config, () => 0.7)).toBe(false)
    })
  })

  describe('Success Rate', () => {
    it('always samples successes when successRate is 1.0', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 0.0, successRate: 1.0 }

      for (let i = 0; i < 10; i++) {
        expect(shouldSample(item, config)).toBe(true)
      }
    })

    it('never samples successes when successRate is 0.0', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      for (let i = 0; i < 10; i++) {
        expect(shouldSample(item, config)).toBe(false)
      }
    })

    it('samples successes based on successRate', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.5 }

      // With fixed random value below rate, should sample
      expect(shouldSample(item, config, () => 0.3)).toBe(true)

      // With fixed random value above rate, should not sample
      expect(shouldSample(item, config, () => 0.7)).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('handles rate exactly at 0.5', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.5 }

      // Random at exactly 0.5 should NOT sample (< not <=)
      expect(shouldSample(item, config, () => 0.5)).toBe(false)

      // Random just below 0.5 should sample
      expect(shouldSample(item, config, () => 0.499)).toBe(true)
    })

    it('handles rate of 0.0 with random at 0.0', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 0.0, successRate: 0.0 }

      expect(shouldSample(item, config, () => 0.0)).toBe(false)
    })

    it('handles rate of 1.0 with random at 1.0', () => {
      const item = createTailItem({ outcome: 'ok', status: 200 })
      const config: SampleConfig = { errorRate: 1.0, successRate: 1.0 }

      // 1.0 rate should always sample regardless of random
      expect(shouldSample(item, config, () => 1.0)).toBe(true)
    })
  })
})

// ============================================================================
// Custom Random Function Tests
// ============================================================================

describe('Custom Random Function', () => {
  it('uses provided random function', () => {
    const item = createTailItem({ outcome: 'ok', status: 200 })
    const config: SampleConfig = { errorRate: 0.0, successRate: 0.5 }

    // Random always returns 0.1, should always sample
    expect(shouldSample(item, config, () => 0.1)).toBe(true)
    expect(shouldSample(item, config, () => 0.1)).toBe(true)
    expect(shouldSample(item, config, () => 0.1)).toBe(true)
  })

  it('uses default Math.random when not provided', () => {
    const item = createTailItem({ outcome: 'ok', status: 200 })
    const config: SampleConfig = { errorRate: 0.0, successRate: 0.5 }

    // Without custom random, uses Math.random - result will vary
    // Just verify it runs without error
    const result = shouldSample(item, config)
    expect(typeof result).toBe('boolean')
  })

  it('supports deterministic testing with fixed sequence', () => {
    const item = createTailItem({ outcome: 'ok', status: 200 })
    const config: SampleConfig = { errorRate: 0.0, successRate: 0.5 }

    let callCount = 0
    const sequence = [0.3, 0.7, 0.2, 0.8]
    const deterministicRandom = () => sequence[callCount++ % sequence.length]

    expect(shouldSample(item, config, deterministicRandom)).toBe(true)  // 0.3 < 0.5
    expect(shouldSample(item, config, deterministicRandom)).toBe(false) // 0.7 >= 0.5
    expect(shouldSample(item, config, deterministicRandom)).toBe(true)  // 0.2 < 0.5
    expect(shouldSample(item, config, deterministicRandom)).toBe(false) // 0.8 >= 0.5
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('handles missing response in event', () => {
    const item = {
      event: {},
      exceptions: [],
      outcome: 'ok' as const,
    }
    const config: SampleConfig = { errorRate: 1.0, successRate: 0.5 }

    // Should not throw, just treat as non-error
    expect(() => shouldSample(item, config, () => 0.3)).not.toThrow()
  })

  it('handles undefined event', () => {
    const item = {
      event: undefined,
      exceptions: [],
      outcome: 'ok' as const,
    }
    const config: SampleConfig = { errorRate: 1.0, successRate: 0.5 }

    expect(() => shouldSample(item, config, () => 0.3)).not.toThrow()
  })

  it('handles readonly exceptions array', () => {
    const exceptions: readonly unknown[] = Object.freeze([
      { name: 'Error', message: 'Test' },
    ])
    const item = {
      event: {},
      exceptions,
      outcome: 'ok' as const,
    }
    const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

    expect(shouldSample(item, config)).toBe(true)
  })
})

// ============================================================================
// Configuration Validation Tests
// ============================================================================

describe('Configuration Validation', () => {
  it('accepts valid configuration', () => {
    const config: SampleConfig = {
      errorRate: 0.5,
      successRate: 0.1,
    }

    expect(config.errorRate).toBe(0.5)
    expect(config.successRate).toBe(0.1)
  })

  it('accepts zero rates', () => {
    const config: SampleConfig = {
      errorRate: 0.0,
      successRate: 0.0,
    }

    expect(config.errorRate).toBe(0.0)
    expect(config.successRate).toBe(0.0)
  })

  it('accepts 100% rates', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 1.0,
    }

    expect(config.errorRate).toBe(1.0)
    expect(config.successRate).toBe(1.0)
  })

  it('handles different error and success rates', () => {
    const config: SampleConfig = {
      errorRate: 1.0,  // Always sample errors
      successRate: 0.01, // Sample 1% of successes
    }

    const errorItem = createTailItem({ outcome: 'exception' })
    const successItem = createTailItem({ outcome: 'ok', status: 200 })

    expect(shouldSample(errorItem, config)).toBe(true)
    expect(shouldSample(successItem, config, () => 0.005)).toBe(true)
    expect(shouldSample(successItem, config, () => 0.02)).toBe(false)
  })
})

// ============================================================================
// Real-world Scenario Tests
// ============================================================================

describe('Real-world Scenarios', () => {
  it('production config: sample all errors, 1% of successes', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.01,
    }

    // All errors should be sampled
    expect(shouldSample(createTailItem({ outcome: 'exception' }), config)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 500 }), config)).toBe(true)

    // Only ~1% of successes
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config, () => 0.005)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config, () => 0.02)).toBe(false)
  })

  it('development config: sample everything', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 1.0,
    }

    expect(shouldSample(createTailItem({ outcome: 'exception' }), config)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 500 }), config)).toBe(true)
  })

  it('quiet config: only sample errors', () => {
    const config: SampleConfig = {
      errorRate: 1.0,
      successRate: 0.0,
    }

    expect(shouldSample(createTailItem({ outcome: 'exception' }), config)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config)).toBe(false)
  })

  it('disabled config: sample nothing', () => {
    const config: SampleConfig = {
      errorRate: 0.0,
      successRate: 0.0,
    }

    expect(shouldSample(createTailItem({ outcome: 'exception' }), config)).toBe(false)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config)).toBe(false)
  })

  it('high-traffic config: 10% errors, 0.1% successes', () => {
    const config: SampleConfig = {
      errorRate: 0.1,
      successRate: 0.001,
    }

    // Random below threshold
    expect(shouldSample(createTailItem({ outcome: 'exception' }), config, () => 0.05)).toBe(true)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config, () => 0.0005)).toBe(true)

    // Random above threshold
    expect(shouldSample(createTailItem({ outcome: 'exception' }), config, () => 0.2)).toBe(false)
    expect(shouldSample(createTailItem({ outcome: 'ok', status: 200 }), config, () => 0.01)).toBe(false)
  })
})
