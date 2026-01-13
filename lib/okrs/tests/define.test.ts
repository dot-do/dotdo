/**
 * OKR Define Functions Tests
 *
 * Tests for defineOKR() and defineMetric() functions following TDD red-green-refactor.
 *
 * Requirements:
 * - defineOKR() returns OKR object with objective and keyResults
 * - defineOKR() returned OKR has progress() method
 * - defineOKR() returned OKR has isComplete() method
 * - defineMetric() returns Metric with name and optional measurement function
 * - progress() calculates average completion across keyResults
 */

import { describe, it, expect } from 'vitest'

// Import the functions under test (will fail until implemented)
import { defineOKR, defineMetric } from '../define'
import type { KeyResult } from '../types'

// ============================================================================
// defineOKR() Tests
// ============================================================================

describe('defineOKR()', () => {
  it('returns an OKR object with objective string', () => {
    const okr = defineOKR({
      objective: 'Increase user engagement',
      keyResults: [],
    })

    expect(okr.objective).toBe('Increase user engagement')
    expect(typeof okr.objective).toBe('string')
  })

  it('returns an OKR object with keyResults array', () => {
    const okr = defineOKR({
      objective: 'Launch MVP',
      keyResults: [
        { metric: 'ActiveUsers', target: 1000, current: 500 },
        { metric: 'Revenue', target: 10000, current: 7500 },
      ],
    })

    expect(Array.isArray(okr.keyResults)).toBe(true)
    expect(okr.keyResults.length).toBe(2)
    expect(okr.keyResults[0].metric).toBe('ActiveUsers')
    expect(okr.keyResults[1].metric).toBe('Revenue')
  })

  it('defaults current to 0 when not provided in keyResults', () => {
    const okr = defineOKR({
      objective: 'Scale the business',
      keyResults: [
        { metric: 'MRR', target: 50000 },
        { metric: 'Customers', target: 100, current: 25 },
      ],
    })

    expect(okr.keyResults[0].current).toBe(0)
    expect(okr.keyResults[1].current).toBe(25)
  })

  it('returns an OKR with progress() method', () => {
    const okr = defineOKR({
      objective: 'Test objective',
      keyResults: [],
    })

    expect(typeof okr.progress).toBe('function')
  })

  it('returns an OKR with isComplete() method', () => {
    const okr = defineOKR({
      objective: 'Test objective',
      keyResults: [],
    })

    expect(typeof okr.isComplete).toBe('function')
  })

  it('preserves measurement function in keyResults', () => {
    const measureRevenue = () => 8000

    const okr = defineOKR({
      objective: 'Grow revenue',
      keyResults: [
        { metric: 'Revenue', target: 10000, current: 5000, measurement: measureRevenue },
      ],
    })

    expect(okr.keyResults[0].measurement).toBe(measureRevenue)
    expect(okr.keyResults[0].measurement!()).toBe(8000)
  })
})

// ============================================================================
// progress() Method Tests
// ============================================================================

describe('progress() method', () => {
  it('returns 0 when there are no keyResults', () => {
    const okr = defineOKR({
      objective: 'Empty objective',
      keyResults: [],
    })

    expect(okr.progress()).toBe(0)
  })

  it('calculates progress as average completion across keyResults', () => {
    const okr = defineOKR({
      objective: 'Test objective',
      keyResults: [
        { metric: 'Metric1', target: 100, current: 50 },  // 50% complete
        { metric: 'Metric2', target: 100, current: 100 }, // 100% complete
      ],
    })

    // Average of 50% and 100% = 75%
    expect(okr.progress()).toBe(0.75)
  })

  it('handles single keyResult', () => {
    const okr = defineOKR({
      objective: 'Single KR',
      keyResults: [
        { metric: 'SingleMetric', target: 200, current: 100 },
      ],
    })

    expect(okr.progress()).toBe(0.5)
  })

  it('returns progress as a value between 0 and 1', () => {
    const okr = defineOKR({
      objective: 'Progress bounds',
      keyResults: [
        { metric: 'InProgress', target: 100, current: 25 },
      ],
    })

    const progress = okr.progress()
    expect(progress).toBeGreaterThanOrEqual(0)
    expect(progress).toBeLessThanOrEqual(1)
  })

  it('caps progress at 1 when current exceeds target', () => {
    const okr = defineOKR({
      objective: 'Exceeded target',
      keyResults: [
        { metric: 'Overachiever', target: 100, current: 150 },
      ],
    })

    expect(okr.progress()).toBe(1)
  })

  it('handles zero target gracefully', () => {
    const okr = defineOKR({
      objective: 'Zero target',
      keyResults: [
        { metric: 'ErrorCount', target: 0, current: 0 },
      ],
    })

    // When target is 0 and current is 0, consider it complete
    expect(okr.progress()).toBe(1)
  })

  it('calculates progress with decimal values', () => {
    const okr = defineOKR({
      objective: 'Decimal test',
      keyResults: [
        { metric: 'Percentage', target: 100, current: 33.33 },
      ],
    })

    expect(okr.progress()).toBeCloseTo(0.3333, 4)
  })

  it('calculates correct average with multiple varying completions', () => {
    const okr = defineOKR({
      objective: 'Multi KR',
      keyResults: [
        { metric: 'KR1', target: 100, current: 0 },    // 0%
        { metric: 'KR2', target: 100, current: 25 },   // 25%
        { metric: 'KR3', target: 100, current: 50 },   // 50%
        { metric: 'KR4', target: 100, current: 100 },  // 100%
      ],
    })

    // Average: (0 + 25 + 50 + 100) / 4 = 43.75%
    expect(okr.progress()).toBe(0.4375)
  })
})

// ============================================================================
// isComplete() Method Tests
// ============================================================================

describe('isComplete() method', () => {
  it('returns true when all keyResults are at or above target', () => {
    const okr = defineOKR({
      objective: 'Completed objective',
      keyResults: [
        { metric: 'KR1', target: 100, current: 100 },
        { metric: 'KR2', target: 50, current: 75 },
      ],
    })

    expect(okr.isComplete()).toBe(true)
  })

  it('returns false when any keyResult is below target', () => {
    const okr = defineOKR({
      objective: 'Incomplete objective',
      keyResults: [
        { metric: 'KR1', target: 100, current: 100 },
        { metric: 'KR2', target: 100, current: 99 },
      ],
    })

    expect(okr.isComplete()).toBe(false)
  })

  it('returns true for empty keyResults', () => {
    const okr = defineOKR({
      objective: 'No KRs',
      keyResults: [],
    })

    // No KRs means nothing to complete
    expect(okr.isComplete()).toBe(true)
  })

  it('returns false when current is 0 and target is positive', () => {
    const okr = defineOKR({
      objective: 'Not started',
      keyResults: [
        { metric: 'Unstarted', target: 100 },
      ],
    })

    expect(okr.isComplete()).toBe(false)
  })

  it('handles zero target correctly', () => {
    const okr = defineOKR({
      objective: 'Zero bugs',
      keyResults: [
        { metric: 'BugCount', target: 0, current: 0 },
      ],
    })

    expect(okr.isComplete()).toBe(true)
  })
})

// ============================================================================
// defineMetric() Tests
// ============================================================================

describe('defineMetric()', () => {
  it('returns a Metric object with name', () => {
    const metric = defineMetric({
      name: 'MonthlyActiveUsers',
    })

    expect(metric.name).toBe('MonthlyActiveUsers')
  })

  it('returns a Metric without measurement when not provided', () => {
    const metric = defineMetric({
      name: 'SimpleMetric',
    })

    expect(metric.measurement).toBeUndefined()
  })

  it('returns a Metric with measurement function when provided', () => {
    const measure = () => 42

    const metric = defineMetric({
      name: 'MeasuredMetric',
      measurement: measure,
    })

    expect(metric.measurement).toBe(measure)
    expect(metric.measurement!()).toBe(42)
  })

  it('supports async measurement functions', async () => {
    const asyncMeasure = async () => {
      return Promise.resolve(100)
    }

    const metric = defineMetric({
      name: 'AsyncMetric',
      measurement: asyncMeasure,
    })

    const result = await metric.measurement!()
    expect(result).toBe(100)
  })

  it('allows measurement to return decimal values', () => {
    const metric = defineMetric({
      name: 'Percentage',
      measurement: () => 99.99,
    })

    expect(metric.measurement!()).toBe(99.99)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: defineOKR with defineMetric', () => {
  it('can use defineMetric in keyResults', () => {
    const revenueMetric = defineMetric({
      name: 'Revenue',
      measurement: () => 50000,
    })

    const okr = defineOKR({
      objective: 'Hit revenue targets',
      keyResults: [
        {
          metric: revenueMetric.name,
          target: 100000,
          current: 50000,
          measurement: revenueMetric.measurement,
        },
      ],
    })

    expect(okr.keyResults[0].metric).toBe('Revenue')
    expect(okr.keyResults[0].measurement!()).toBe(50000)
    expect(okr.progress()).toBe(0.5)
  })
})

// ============================================================================
// Type Safety Tests (compile-time verification)
// ============================================================================

describe('Type safety', () => {
  it('defineOKR config requires objective and keyResults', () => {
    // This test verifies compile-time type safety
    const okr = defineOKR({
      objective: 'Required fields test',
      keyResults: [],
    })

    expect(okr.objective).toBeDefined()
    expect(okr.keyResults).toBeDefined()
  })

  it('defineMetric config requires name', () => {
    // This test verifies compile-time type safety
    const metric = defineMetric({
      name: 'RequiredName',
    })

    expect(metric.name).toBeDefined()
  })
})
