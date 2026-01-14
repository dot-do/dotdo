/**
 * OKR Types Tests
 *
 * These tests define the expected type structure for OKR (Objectives and Key Results).
 * Following TDD red-green-refactor: write failing tests first, then implement.
 *
 * Requirements:
 * - Objective: has name (string) and keyResults (KeyResult[])
 * - KeyResult: has metric (string), target (number), current (number)
 * - KeyResult.measurement: optional function reference
 * - Metric names: PascalCase convention (type enforcement)
 */

import { describe, it, expect } from 'vitest'

// Import the types under test (will fail until implemented)
import type { Objective, KeyResult, Metric, PascalCase } from '../types'

// ============================================================================
// Objective Type Tests
// ============================================================================

describe('Objective type', () => {
  it('has name property of type string', () => {
    const objective: Objective = {
      name: 'Increase user engagement',
      keyResults: [],
    }

    expect(objective.name).toBe('Increase user engagement')
    expect(typeof objective.name).toBe('string')
  })

  it('has keyResults property of type KeyResult[]', () => {
    const objective: Objective = {
      name: 'Improve product quality',
      keyResults: [
        { metric: 'BugCount', target: 0, current: 10 },
        { metric: 'TestCoverage', target: 90, current: 75 },
      ],
    }

    expect(Array.isArray(objective.keyResults)).toBe(true)
    expect(objective.keyResults.length).toBe(2)
  })

  it('allows empty keyResults array', () => {
    const objective: Objective = {
      name: 'Strategic goal with no KRs yet',
      keyResults: [],
    }

    expect(objective.keyResults).toEqual([])
  })
})

// ============================================================================
// KeyResult Type Tests
// ============================================================================

describe('KeyResult type', () => {
  it('has metric property of type string', () => {
    const kr: KeyResult = {
      metric: 'MonthlyActiveUsers',
      target: 10000,
      current: 5000,
    }

    expect(kr.metric).toBe('MonthlyActiveUsers')
    expect(typeof kr.metric).toBe('string')
  })

  it('has target property of type number', () => {
    const kr: KeyResult = {
      metric: 'Revenue',
      target: 1000000,
      current: 750000,
    }

    expect(kr.target).toBe(1000000)
    expect(typeof kr.target).toBe('number')
  })

  it('has current property of type number', () => {
    const kr: KeyResult = {
      metric: 'CustomerSatisfaction',
      target: 95,
      current: 87,
    }

    expect(kr.current).toBe(87)
    expect(typeof kr.current).toBe('number')
  })

  it('has optional measurement property', () => {
    // KeyResult without measurement
    const krWithoutMeasurement: KeyResult = {
      metric: 'ResponseTime',
      target: 100,
      current: 150,
    }

    expect(krWithoutMeasurement.measurement).toBeUndefined()

    // KeyResult with measurement function reference
    const measureResponseTime = () => 120
    const krWithMeasurement: KeyResult = {
      metric: 'ResponseTime',
      target: 100,
      current: 150,
      measurement: measureResponseTime,
    }

    expect(krWithMeasurement.measurement).toBe(measureResponseTime)
    expect(typeof krWithMeasurement.measurement).toBe('function')
  })

  it('measurement can be a function that returns a number', () => {
    const measureUptime = () => 99.9
    const kr: KeyResult = {
      metric: 'Uptime',
      target: 99.99,
      current: 99.5,
      measurement: measureUptime,
    }

    expect(kr.measurement!()).toBe(99.9)
  })

  it('measurement can be an async function', async () => {
    const measureFromAPI = async () => {
      // Simulates async data fetch
      return Promise.resolve(42)
    }

    const kr: KeyResult = {
      metric: 'APILatency',
      target: 50,
      current: 60,
      measurement: measureFromAPI,
    }

    const result = await kr.measurement!()
    expect(result).toBe(42)
  })
})

// ============================================================================
// Metric Type Tests (PascalCase Convention)
// ============================================================================

describe('Metric type', () => {
  it('is a branded string type for PascalCase names', () => {
    // Metric should be usable as a string but enforce PascalCase at the type level
    const metric: Metric = 'MonthlyActiveUsers' as Metric

    expect(metric).toBe('MonthlyActiveUsers')
    expect(typeof metric).toBe('string')
  })

  it('can be used in KeyResult metric field', () => {
    const metric: Metric = 'ConversionRate' as Metric
    const kr: KeyResult = {
      metric,
      target: 5,
      current: 3.5,
    }

    expect(kr.metric).toBe('ConversionRate')
  })
})

// ============================================================================
// PascalCase Type Helper Tests
// ============================================================================

describe('PascalCase type helper', () => {
  it('accepts PascalCase strings', () => {
    // These should all be valid PascalCase
    const valid1: PascalCase = 'MonthlyActiveUsers' as PascalCase
    const valid2: PascalCase = 'Revenue' as PascalCase
    const valid3: PascalCase = 'CustomerSatisfactionScore' as PascalCase

    expect(valid1).toBe('MonthlyActiveUsers')
    expect(valid2).toBe('Revenue')
    expect(valid3).toBe('CustomerSatisfactionScore')
  })

  // Note: TypeScript type checking happens at compile time
  // These tests verify runtime behavior; compile-time enforcement is in types.ts
})

// ============================================================================
// Full OKR Object Creation Tests
// ============================================================================

describe('Creating typed OKR objects', () => {
  it('creates a complete Objective with KeyResults', () => {
    const objective: Objective = {
      name: 'Launch MVP successfully',
      keyResults: [
        {
          metric: 'ActiveUsers',
          target: 1000,
          current: 0,
        },
        {
          metric: 'NPS',
          target: 50,
          current: 0,
        },
        {
          metric: 'Revenue',
          target: 10000,
          current: 0,
          measurement: () => 0,
        },
      ],
    }

    expect(objective.name).toBe('Launch MVP successfully')
    expect(objective.keyResults.length).toBe(3)
    expect(objective.keyResults[0].metric).toBe('ActiveUsers')
    expect(objective.keyResults[2].measurement).toBeDefined()
  })

  it('matches the design doc pattern', () => {
    // Pattern from design doc:
    // const AI = AI({
    //   okr: {
    //     objective: 'What we want to achieve',
    //     keyResults: [{
    //       metric: 'What we measure (PascalCase)',
    //       target: 'Target value (number)',
    //       current: 'Current value (number)',
    //       measurement: 'How to measure (function reference)',
    //     }],
    //   },
    // })

    const okr: Objective = {
      name: 'What we want to achieve',
      keyResults: [
        {
          metric: 'WhatWeMeasure',
          target: 100,
          current: 50,
          measurement: () => 50,
        },
      ],
    }

    expect(okr.name).toBe('What we want to achieve')
    expect(okr.keyResults[0].metric).toBe('WhatWeMeasure')
    expect(okr.keyResults[0].target).toBe(100)
    expect(okr.keyResults[0].current).toBe(50)
    expect(typeof okr.keyResults[0].measurement).toBe('function')
  })

  it('allows multiple objectives', () => {
    const objectives: Objective[] = [
      {
        name: 'Improve retention',
        keyResults: [
          { metric: 'ChurnRate', target: 5, current: 12 },
        ],
      },
      {
        name: 'Increase revenue',
        keyResults: [
          { metric: 'MRR', target: 100000, current: 75000 },
          { metric: 'ARPU', target: 50, current: 35 },
        ],
      },
    ]

    expect(objectives.length).toBe(2)
    expect(objectives[0].keyResults.length).toBe(1)
    expect(objectives[1].keyResults.length).toBe(2)
  })
})

// ============================================================================
// Type Inference Tests
// ============================================================================

describe('Type inference', () => {
  it('infers KeyResult type from object literal', () => {
    // Type should be inferred correctly
    const kr = {
      metric: 'TestMetric',
      target: 100,
      current: 50,
    } satisfies KeyResult

    expect(kr.metric).toBe('TestMetric')
    expect(kr.target).toBe(100)
    expect(kr.current).toBe(50)
  })

  it('infers Objective type from object literal', () => {
    const objective = {
      name: 'Test Objective',
      keyResults: [
        { metric: 'Metric1', target: 10, current: 5 },
      ],
    } satisfies Objective

    expect(objective.name).toBe('Test Objective')
    expect(objective.keyResults[0].metric).toBe('Metric1')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  it('handles zero values for target and current', () => {
    const kr: KeyResult = {
      metric: 'ErrorCount',
      target: 0,
      current: 0,
    }

    expect(kr.target).toBe(0)
    expect(kr.current).toBe(0)
  })

  it('handles negative current values (for metrics like NPS)', () => {
    const kr: KeyResult = {
      metric: 'NPS',
      target: 50,
      current: -10,
    }

    expect(kr.current).toBe(-10)
  })

  it('handles decimal values', () => {
    const kr: KeyResult = {
      metric: 'ConversionRate',
      target: 5.5,
      current: 3.14159,
    }

    expect(kr.target).toBe(5.5)
    expect(kr.current).toBe(3.14159)
  })

  it('handles very long metric names', () => {
    const kr: KeyResult = {
      metric: 'AverageMonthlyRecurringRevenuePerActiveSubscribedUser',
      target: 100,
      current: 75,
    }

    expect(kr.metric).toBe('AverageMonthlyRecurringRevenuePerActiveSubscribedUser')
  })

  it('handles single character metric names', () => {
    const kr: KeyResult = {
      metric: 'X',
      target: 1,
      current: 0,
    }

    expect(kr.metric).toBe('X')
  })
})
