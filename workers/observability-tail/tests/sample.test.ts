/**
 * Observability Tail Sampling Tests
 *
 * Tests for shouldSample function that determines which TailItems
 * should be captured based on error/success sampling rates.
 *
 * @module workers/observability-tail/tests/sample.test
 */

import { describe, it, expect } from 'vitest'
import { shouldSample, type SampleConfig } from '../sample'

// =============================================================================
// Test Helpers
// =============================================================================

interface TestTailItem {
  event: {
    response?: {
      status: number
    }
  }
  exceptions: unknown[]
  outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
}

function createTestItem(overrides: Partial<TestTailItem> = {}): TestTailItem {
  return {
    event: {
      response: {
        status: 200,
      },
    },
    exceptions: [],
    outcome: 'ok',
    ...overrides,
  }
}

// =============================================================================
// shouldSample Tests
// =============================================================================

describe('shouldSample', () => {
  describe('error detection', () => {
    it('identifies exception outcome as error', () => {
      const item = createTestItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      // With errorRate 1.0, errors always sampled
      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies exceededCpu outcome as error', () => {
      const item = createTestItem({ outcome: 'exceededCpu' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies exceededMemory outcome as error', () => {
      const item = createTestItem({ outcome: 'exceededMemory' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies canceled outcome as error', () => {
      const item = createTestItem({ outcome: 'canceled' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies unknown outcome as error', () => {
      const item = createTestItem({ outcome: 'unknown' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies 5xx status as error', () => {
      const item = createTestItem({
        event: { response: { status: 500 } },
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies 502 status as error', () => {
      const item = createTestItem({
        event: { response: { status: 502 } },
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('identifies exceptions array as error', () => {
      const item = createTestItem({
        exceptions: [{ name: 'Error', message: 'test' }],
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('does not identify 4xx as error (uses success rate)', () => {
      const item = createTestItem({
        event: { response: { status: 404 } },
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      // 4xx is not an error, so uses successRate of 0
      expect(shouldSample(item, config)).toBe(false)
    })

    it('does not identify 2xx as error (uses success rate)', () => {
      const item = createTestItem({
        event: { response: { status: 200 } },
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(false)
    })
  })

  describe('rate boundaries', () => {
    it('always samples when rate is 1.0', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 1.0, successRate: 1.0 }

      // Should always return true regardless of random
      expect(shouldSample(item, config, () => 0.0)).toBe(true)
      expect(shouldSample(item, config, () => 0.5)).toBe(true)
      expect(shouldSample(item, config, () => 0.99)).toBe(true)
      expect(shouldSample(item, config, () => 1.0)).toBe(true)
    })

    it('never samples when rate is 0.0', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.0, successRate: 0.0 }

      // Should always return false regardless of random
      expect(shouldSample(item, config, () => 0.0)).toBe(false)
      expect(shouldSample(item, config, () => 0.5)).toBe(false)
      expect(shouldSample(item, config, () => 0.99)).toBe(false)
    })

    it('samples when random < rate', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.5 }

      // random 0.3 < rate 0.5 -> sample
      expect(shouldSample(item, config, () => 0.3)).toBe(true)
    })

    it('does not sample when random >= rate', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.5 }

      // random 0.6 >= rate 0.5 -> no sample
      expect(shouldSample(item, config, () => 0.6)).toBe(false)
    })

    it('handles edge case of random exactly at rate', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.5 }

      // random 0.5 is not < rate 0.5 -> no sample
      expect(shouldSample(item, config, () => 0.5)).toBe(false)
    })
  })

  describe('rate application', () => {
    it('uses errorRate for error conditions', () => {
      const errorItem = createTestItem({ outcome: 'exception' })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(errorItem, config)).toBe(true)
    })

    it('uses successRate for success conditions', () => {
      const successItem = createTestItem()
      const config: SampleConfig = { errorRate: 0.0, successRate: 1.0 }

      expect(shouldSample(successItem, config)).toBe(true)
    })

    it('applies different rates correctly', () => {
      const errorItem = createTestItem({ outcome: 'exception' })
      const successItem = createTestItem()

      // High error rate, low success rate
      const config: SampleConfig = { errorRate: 0.9, successRate: 0.1 }

      // With random = 0.5:
      // Error: 0.5 < 0.9 -> sample
      // Success: 0.5 >= 0.1 -> no sample
      expect(shouldSample(errorItem, config, () => 0.5)).toBe(true)
      expect(shouldSample(successItem, config, () => 0.5)).toBe(false)
    })
  })

  describe('complex scenarios', () => {
    it('treats multiple error indicators correctly', () => {
      // Item with both 5xx status AND exceptions
      const item = createTestItem({
        event: { response: { status: 503 } },
        exceptions: [{ name: 'Error', message: 'timeout' }],
        outcome: 'ok',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('handles missing response', () => {
      const item: TestTailItem = {
        event: {},
        exceptions: [],
        outcome: 'ok',
      }
      const config: SampleConfig = { errorRate: 0.0, successRate: 1.0 }

      // No status, no exceptions, outcome ok -> success
      expect(shouldSample(item, config)).toBe(true)
    })

    it('handles response without status', () => {
      const item: TestTailItem = {
        event: { response: undefined },
        exceptions: [],
        outcome: 'ok',
      }
      const config: SampleConfig = { errorRate: 0.0, successRate: 1.0 }

      expect(shouldSample(item, config)).toBe(true)
    })

    it('prioritizes outcome over status', () => {
      // Non-ok outcome with 200 status
      const item = createTestItem({
        event: { response: { status: 200 } },
        outcome: 'exception',
      })
      const config: SampleConfig = { errorRate: 1.0, successRate: 0.0 }

      // Should be treated as error due to outcome
      expect(shouldSample(item, config)).toBe(true)
    })
  })

  describe('deterministic testing with custom random', () => {
    it('allows deterministic testing with custom random function', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.5 }

      // Sequence of random values
      let callCount = 0
      const randomSequence = [0.1, 0.6, 0.3, 0.8]
      const customRandom = () => randomSequence[callCount++]!

      // 0.1 < 0.5 -> true
      expect(shouldSample(item, config, customRandom)).toBe(true)
      // 0.6 >= 0.5 -> false
      expect(shouldSample(item, config, customRandom)).toBe(false)
      // 0.3 < 0.5 -> true
      expect(shouldSample(item, config, customRandom)).toBe(true)
      // 0.8 >= 0.5 -> false
      expect(shouldSample(item, config, customRandom)).toBe(false)
    })
  })

  describe('statistical distribution', () => {
    it('samples approximately at configured rate', () => {
      const item = createTestItem()
      const config: SampleConfig = { errorRate: 0.5, successRate: 0.3 }

      // Run many samples with pseudo-random values
      let sampled = 0
      const iterations = 1000

      for (let i = 0; i < iterations; i++) {
        // Use deterministic but distributed values
        const randomValue = (i * 7919) % 1000 / 1000
        if (shouldSample(item, config, () => randomValue)) {
          sampled++
        }
      }

      // Should be approximately 30% (success rate)
      const sampleRate = sampled / iterations
      expect(sampleRate).toBeGreaterThan(0.25)
      expect(sampleRate).toBeLessThan(0.35)
    })
  })
})
