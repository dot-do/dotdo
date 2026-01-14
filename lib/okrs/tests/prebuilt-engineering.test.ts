/**
 * Engineering OKRs Tests
 *
 * TDD red-green-refactor: Tests for pre-built Engineering metrics.
 *
 * Engineering OKRs (owned by Ralph/Tom):
 * - BuildVelocity: Story points per sprint
 * - CodeQuality: Test coverage, lint scores
 * - SystemReliability: Uptime, error rates
 * - ReviewThroughput: Architecture health, review throughput
 *
 * Each metric is defined using defineMetric() with:
 * - name: PascalCase metric name
 * - description: Human-readable description
 * - unit: Unit of measurement ('points', '%', 'score', etc.)
 * - measurement: Async function to compute current value from analytics
 */

import { describe, it, expect } from 'vitest'

// Import the metrics under test (will fail until implemented)
import {
  BuildVelocity,
  CodeQuality,
  SystemReliability,
  ReviewThroughput,
  EngineeringOKRs,
} from '../prebuilt/engineering'

// ============================================================================
// BuildVelocity (Story Points/Sprint) Tests
// ============================================================================

describe('BuildVelocity metric', () => {
  it('has correct name', () => {
    expect(BuildVelocity.name).toBe('BuildVelocity')
  })

  it('has correct description', () => {
    expect(BuildVelocity.description).toBe('Story points delivered per sprint')
  })

  it('has points unit', () => {
    expect(BuildVelocity.unit).toBe('points')
  })

  it('has measurement function', () => {
    expect(typeof BuildVelocity.measurement).toBe('function')
  })

  it('computes velocity from analytics.engineering.storyPointsPerSprint', async () => {
    const mockAnalytics = {
      engineering: { storyPointsPerSprint: 42 },
    }

    const value = await BuildVelocity.measurement(mockAnalytics)
    expect(value).toBe(42)
  })

  it('handles zero velocity (no work done)', async () => {
    const mockAnalytics = {
      engineering: { storyPointsPerSprint: 0 },
    }

    const value = await BuildVelocity.measurement(mockAnalytics)
    expect(value).toBe(0)
  })

  it('handles high velocity sprints', async () => {
    const mockAnalytics = {
      engineering: { storyPointsPerSprint: 120 },
    }

    const value = await BuildVelocity.measurement(mockAnalytics)
    expect(value).toBe(120)
  })
})

// ============================================================================
// CodeQuality (Test Coverage, Lint Scores) Tests
// ============================================================================

describe('CodeQuality metric', () => {
  it('has correct name', () => {
    expect(CodeQuality.name).toBe('CodeQuality')
  })

  it('has correct description', () => {
    expect(CodeQuality.description).toBe('Combined test coverage and lint score')
  })

  it('has percentage unit', () => {
    expect(CodeQuality.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof CodeQuality.measurement).toBe('function')
  })

  it('computes quality from analytics.engineering.codeQualityScore', async () => {
    const mockAnalytics = {
      engineering: { codeQualityScore: 87.5 },
    }

    const value = await CodeQuality.measurement(mockAnalytics)
    expect(value).toBe(87.5)
  })

  it('handles low code quality', async () => {
    const mockAnalytics = {
      engineering: { codeQualityScore: 45 },
    }

    const value = await CodeQuality.measurement(mockAnalytics)
    expect(value).toBe(45)
  })

  it('handles perfect code quality', async () => {
    const mockAnalytics = {
      engineering: { codeQualityScore: 100 },
    }

    const value = await CodeQuality.measurement(mockAnalytics)
    expect(value).toBe(100)
  })
})

// ============================================================================
// SystemReliability (Uptime, Error Rates) Tests
// ============================================================================

describe('SystemReliability metric', () => {
  it('has correct name', () => {
    expect(SystemReliability.name).toBe('SystemReliability')
  })

  it('has correct description', () => {
    expect(SystemReliability.description).toBe('System uptime percentage')
  })

  it('has percentage unit', () => {
    expect(SystemReliability.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof SystemReliability.measurement).toBe('function')
  })

  it('computes reliability from analytics.engineering.uptimePercentage', async () => {
    const mockAnalytics = {
      engineering: { uptimePercentage: 99.95 },
    }

    const value = await SystemReliability.measurement(mockAnalytics)
    expect(value).toBe(99.95)
  })

  it('handles poor uptime', async () => {
    const mockAnalytics = {
      engineering: { uptimePercentage: 95.0 },
    }

    const value = await SystemReliability.measurement(mockAnalytics)
    expect(value).toBe(95.0)
  })

  it('handles perfect uptime (100%)', async () => {
    const mockAnalytics = {
      engineering: { uptimePercentage: 100 },
    }

    const value = await SystemReliability.measurement(mockAnalytics)
    expect(value).toBe(100)
  })

  it('handles SLA targets like 99.99%', async () => {
    const mockAnalytics = {
      engineering: { uptimePercentage: 99.99 },
    }

    const value = await SystemReliability.measurement(mockAnalytics)
    expect(value).toBe(99.99)
  })
})

// ============================================================================
// ReviewThroughput (Architecture Health, Review Throughput) Tests
// ============================================================================

describe('ReviewThroughput metric', () => {
  it('has correct name', () => {
    expect(ReviewThroughput.name).toBe('ReviewThroughput')
  })

  it('has correct description', () => {
    expect(ReviewThroughput.description).toBe('PRs reviewed per week')
  })

  it('has count unit', () => {
    expect(ReviewThroughput.unit).toBe('count')
  })

  it('has measurement function', () => {
    expect(typeof ReviewThroughput.measurement).toBe('function')
  })

  it('computes throughput from analytics.engineering.prsReviewedPerWeek', async () => {
    const mockAnalytics = {
      engineering: { prsReviewedPerWeek: 25 },
    }

    const value = await ReviewThroughput.measurement(mockAnalytics)
    expect(value).toBe(25)
  })

  it('handles zero reviews', async () => {
    const mockAnalytics = {
      engineering: { prsReviewedPerWeek: 0 },
    }

    const value = await ReviewThroughput.measurement(mockAnalytics)
    expect(value).toBe(0)
  })

  it('handles high review throughput', async () => {
    const mockAnalytics = {
      engineering: { prsReviewedPerWeek: 100 },
    }

    const value = await ReviewThroughput.measurement(mockAnalytics)
    expect(value).toBe(100)
  })
})

// ============================================================================
// EngineeringOKRs Collection Tests
// ============================================================================

describe('EngineeringOKRs collection', () => {
  it('exports all four Engineering metrics', () => {
    expect(EngineeringOKRs).toBeDefined()
    expect(Object.keys(EngineeringOKRs)).toHaveLength(4)
  })

  it('includes BuildVelocity', () => {
    expect(EngineeringOKRs.BuildVelocity).toBe(BuildVelocity)
  })

  it('includes CodeQuality', () => {
    expect(EngineeringOKRs.CodeQuality).toBe(CodeQuality)
  })

  it('includes SystemReliability', () => {
    expect(EngineeringOKRs.SystemReliability).toBe(SystemReliability)
  })

  it('includes ReviewThroughput', () => {
    expect(EngineeringOKRs.ReviewThroughput).toBe(ReviewThroughput)
  })

  it('all metrics have consistent structure', () => {
    for (const [key, metric] of Object.entries(EngineeringOKRs)) {
      expect(metric.name).toBe(key)
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })
})

// ============================================================================
// Metric Type Structure Tests
// ============================================================================

describe('Engineering metric structure', () => {
  it('all metrics have required properties', () => {
    const metrics = [BuildVelocity, CodeQuality, SystemReliability, ReviewThroughput]

    for (const metric of metrics) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('description')
      expect(metric).toHaveProperty('unit')
      expect(metric).toHaveProperty('measurement')
      expect(typeof metric.name).toBe('string')
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })

  it('metric names follow PascalCase convention', () => {
    const metrics = [BuildVelocity, CodeQuality, SystemReliability, ReviewThroughput]

    for (const metric of metrics) {
      // PascalCase: starts with uppercase, no spaces/underscores
      expect(metric.name).toMatch(/^[A-Z][a-zA-Z]*$/)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Engineering metrics integration', () => {
  it('all metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      engineering: {
        storyPointsPerSprint: 55,
        codeQualityScore: 92,
        uptimePercentage: 99.9,
        prsReviewedPerWeek: 30,
      },
    }

    expect(await BuildVelocity.measurement(mockAnalytics)).toBe(55)
    expect(await CodeQuality.measurement(mockAnalytics)).toBe(92)
    expect(await SystemReliability.measurement(mockAnalytics)).toBe(99.9)
    expect(await ReviewThroughput.measurement(mockAnalytics)).toBe(30)
  })

  it('metrics work together to assess engineering health', async () => {
    const mockAnalytics = {
      engineering: {
        storyPointsPerSprint: 40,
        codeQualityScore: 85,
        uptimePercentage: 99.5,
        prsReviewedPerWeek: 20,
      },
    }

    // Calculate overall health as average of percentage metrics
    const quality = await CodeQuality.measurement(mockAnalytics)
    const reliability = await SystemReliability.measurement(mockAnalytics)
    const overallHealth = (quality + reliability) / 2

    expect(overallHealth).toBe(92.25) // (85 + 99.5) / 2
  })
})
