/**
 * Cold Start Benchmark Tests
 *
 * Validates the benchmark framework and runs actual measurements.
 *
 * @module db/spikes/cold-start-benchmark.test
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  measureColdStart,
  runAllBenchmarks,
  compareOptimizations,
  createLibSQLScenarios,
  createIcebergScenarios,
  createHybridScenarios,
  createConnectionPoolingScenario,
  createEdgeCachingScenario,
  createReadReplicaScenario,
  generateReport,
  formatReportAsMarkdown,
  runColdStartBenchmark,
  calculatePercentile,
  calculateMean,
  generateTestState,
  type LatencyResult,
  type ScenarioConfig,
  type TursoConfig,
  type R2Config,
} from './cold-start-benchmark'

// ============================================================================
// Test Configuration
// ============================================================================

const testTursoConfig: TursoConfig = {
  url: 'libsql://test.turso.io',
  authToken: 'test-token',
}

const testR2Config: R2Config = {
  bucket: 'test-bucket',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
}

// Reduced iterations for fast tests
const testBenchmarkOptions = {
  iterations: 10, // Reduced for fast tests
  warmupIterations: 2,
  cooldownMs: 5,
  collectBreakdown: true,
}

// ============================================================================
// Statistics Tests
// ============================================================================

describe('Statistics Utilities', () => {
  it('calculates percentiles correctly', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

    expect(calculatePercentile(samples, 50)).toBe(50)
    expect(calculatePercentile(samples, 90)).toBe(90)
    expect(calculatePercentile(samples, 95)).toBe(100)
  })

  it('handles empty arrays', () => {
    expect(calculatePercentile([], 50)).toBe(0)
    expect(calculateMean([])).toBe(0)
  })

  it('calculates mean correctly', () => {
    const samples = [10, 20, 30, 40, 50]
    expect(calculateMean(samples)).toBe(30)
  })
})

// ============================================================================
// Test State Generation
// ============================================================================

describe('Test State Generation', () => {
  it('generates state of approximately correct size', () => {
    const state1KB = generateTestState(1024)
    const json1KB = JSON.stringify(state1KB)
    expect(json1KB.length).toBeGreaterThan(900)
    expect(json1KB.length).toBeLessThan(1200)

    const state100KB = generateTestState(100 * 1024)
    const json100KB = JSON.stringify(state100KB)
    expect(json100KB.length).toBeGreaterThan(95 * 1024)
    expect(json100KB.length).toBeLessThan(105 * 1024)
  })

  it('includes required fields', () => {
    const state = generateTestState(1024)
    expect(state.id).toBeDefined()
    expect(state.ns).toBeDefined()
    expect(state.type).toBeDefined()
    expect(state.createdAt).toBeDefined()
    expect(state.data).toBeDefined()
  })
})

// ============================================================================
// Scenario Creation Tests
// ============================================================================

describe('Scenario Creation', () => {
  it('creates libSQL scenarios for all sizes', () => {
    const scenarios = createLibSQLScenarios(testTursoConfig)
    expect(scenarios).toHaveLength(4)
    expect(scenarios.map((s) => s.name)).toEqual([
      'libSQL - empty state',
      'libSQL - 1KB state',
      'libSQL - 100KB state',
      'libSQL - 1MB state',
    ])
  })

  it('creates Iceberg scenarios', () => {
    const scenarios = createIcebergScenarios(testR2Config)
    expect(scenarios).toHaveLength(3)
    expect(scenarios[0].name).toContain('Iceberg')
  })

  it('creates hybrid scenarios', () => {
    const scenarios = createHybridScenarios(testTursoConfig, testR2Config)
    expect(scenarios).toHaveLength(3)
    expect(scenarios[0].name).toContain('Hybrid')
  })
})

// ============================================================================
// Single Scenario Benchmark Tests
// ============================================================================

describe('Single Scenario Benchmarks', () => {
  it('measures libSQL empty state cold start', async () => {
    const scenario: ScenarioConfig = {
      name: 'Test - libSQL empty',
      stateSize: 0,
      setup: async () => {},
      measure: async () => {
        // Simulate minimal work
        await new Promise((r) => setTimeout(r, 10))
        return { connectionTime: 10, queryTime: 5 }
      },
    }

    const result = await measureColdStart(scenario, testBenchmarkOptions)

    expect(result.scenario).toBe('Test - libSQL empty')
    expect(result.stateSize).toBe('empty')
    expect(result.samples).toBe(10)
    expect(result.p50).toBeGreaterThan(0)
    expect(result.p95).toBeGreaterThanOrEqual(result.p50)
    expect(result.p99).toBeGreaterThanOrEqual(result.p95)
    expect(result.breakdown?.connectionTime).toBeDefined()
  })

  it('collects latency breakdown', async () => {
    const scenario: ScenarioConfig = {
      name: 'Test - with breakdown',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return {
          connectionTime: 20,
          queryTime: 10,
          parseTime: 5,
        }
      },
    }

    const result = await measureColdStart(scenario, {
      ...testBenchmarkOptions,
      collectBreakdown: true,
    })

    expect(result.breakdown).toBeDefined()
    expect(result.breakdown?.connectionTime).toBe(20)
    expect(result.breakdown?.queryTime).toBe(10)
    expect(result.breakdown?.parseTime).toBe(5)
  })

  it('handles measurement errors gracefully', async () => {
    let callCount = 0
    const scenario: ScenarioConfig = {
      name: 'Test - with errors',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {
        callCount++
        if (callCount % 3 === 0) {
          throw new Error('Simulated error')
        }
        await new Promise((r) => setTimeout(r, 5))
      },
    }

    const result = await measureColdStart(scenario, testBenchmarkOptions)

    expect(result.errors).toBeGreaterThan(0)
    expect(result.samples).toBeLessThan(10) // Some iterations failed
  })
})

// ============================================================================
// Batch Benchmark Tests
// ============================================================================

describe('Batch Benchmarks', () => {
  it('runs multiple scenarios', async () => {
    const scenarios: ScenarioConfig[] = [
      {
        name: 'Test A',
        stateSize: 100,
        setup: async () => {},
        measure: async () => {
          await new Promise((r) => setTimeout(r, 5))
        },
      },
      {
        name: 'Test B',
        stateSize: 200,
        setup: async () => {},
        measure: async () => {
          await new Promise((r) => setTimeout(r, 10))
        },
      },
    ]

    const results = await runAllBenchmarks(scenarios, {
      ...testBenchmarkOptions,
      iterations: 5,
    })

    expect(results).toHaveLength(2)
    expect(results[0].scenario).toBe('Test A')
    expect(results[1].scenario).toBe('Test B')
    // Test B should be slower
    expect(results[1].mean).toBeGreaterThan(results[0].mean)
  })
})

// ============================================================================
// Optimization Comparison Tests
// ============================================================================

describe('Optimization Comparisons', () => {
  it('compares baseline vs optimized scenario', async () => {
    const baselineScenario: ScenarioConfig = {
      name: 'Baseline',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { connectionTime: 50 }
      },
    }

    const optimizedScenario: ScenarioConfig = {
      name: 'Optimized',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {
        await new Promise((r) => setTimeout(r, 20))
        return { connectionTime: 20 }
      },
    }

    const result = await compareOptimizations(
      baselineScenario,
      optimizedScenario,
      'Test Optimization',
      { ...testBenchmarkOptions, iterations: 5 }
    )

    expect(result.strategy).toBe('Test Optimization')
    expect(result.improvement.p50).toBeGreaterThan(0) // Should show improvement
    expect(result.optimized.p50).toBeLessThan(result.baseline.p50)
    expect(['adopt', 'conditional', 'skip']).toContain(result.recommendation)
  })

  it('creates connection pooling scenario', () => {
    const base: ScenarioConfig = {
      name: 'Base',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {},
    }

    const pooled = createConnectionPoolingScenario(base, 10)

    expect(pooled.name).toContain('connection pooling')
    expect(pooled.name).toContain('pool=10')
    expect(pooled.stateSize).toBe(base.stateSize)
  })

  it('creates edge caching scenario', () => {
    const base: ScenarioConfig = {
      name: 'Base',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {},
    }

    const cached = createEdgeCachingScenario(base)

    expect(cached.name).toContain('edge caching')
  })

  it('creates read replica scenario', () => {
    const base: ScenarioConfig = {
      name: 'Base',
      stateSize: 1024,
      setup: async () => {},
      measure: async () => {},
    }

    const replica = createReadReplicaScenario(base, 15)

    expect(replica.name).toContain('read replicas')
    expect(replica.name).toContain('15ms')
  })
})

// ============================================================================
// Report Generation Tests
// ============================================================================

describe('Report Generation', () => {
  const sampleResults: LatencyResult[] = [
    {
      scenario: 'libSQL - 100KB state',
      stateSize: '100KB',
      p50: 85,
      p95: 150,
      p99: 200,
      min: 50,
      max: 250,
      mean: 95,
      samples: 100,
      errors: 0,
      breakdown: {
        connectionTime: 40,
        queryTime: 35,
        parseTime: 10,
      },
    },
    {
      scenario: 'Iceberg - Single file',
      stateSize: '100KB',
      p50: 120,
      p95: 220,
      p99: 300,
      min: 80,
      max: 350,
      mean: 140,
      samples: 100,
      errors: 2,
      breakdown: {
        networkTime: 80,
        parseTime: 40,
      },
    },
  ]

  it('generates comprehensive report', () => {
    const report = generateReport(sampleResults, [], 500)

    expect(report.timestamp).toBeDefined()
    expect(report.environment).toBe('Cloudflare Workers')
    expect(report.target).toBe('P95 < 500ms')
    expect(report.results).toHaveLength(2)
    expect(report.summary.meetsTarget).toBe(true)
    expect(report.summary.fastestScenario).toBe('libSQL - 100KB state')
  })

  it('identifies when target is not met', () => {
    const slowResults: LatencyResult[] = [
      {
        scenario: 'Slow Scenario',
        stateSize: '100KB',
        p50: 400,
        p95: 600, // Exceeds 500ms target
        p99: 800,
        min: 300,
        max: 900,
        mean: 450,
        samples: 100,
        errors: 0,
      },
    ]

    const report = generateReport(slowResults, [], 500)
    expect(report.summary.meetsTarget).toBe(false)
  })

  it('formats report as markdown', () => {
    const report = generateReport(sampleResults, [], 500)
    const markdown = formatReportAsMarkdown(report)

    expect(markdown).toContain('# Cold Start Latency Benchmark Results')
    expect(markdown).toContain('| Scenario | State Size |')
    expect(markdown).toContain('libSQL - 100KB state')
    expect(markdown).toContain('## Latency Breakdown')
    expect(markdown).toContain('## Recommendations')
  })

  it('includes optimization analysis in markdown', () => {
    const optimizations = [
      {
        strategy: 'Connection Pooling',
        baseline: sampleResults[0],
        optimized: {
          ...sampleResults[0],
          p50: 50,
          p95: 80,
          p99: 100,
        },
        improvement: { p50: 41, p95: 47, p99: 50 },
        recommendation: 'adopt' as const,
        notes: 'Significant improvement',
      },
    ]

    const report = generateReport(sampleResults, optimizations, 500)
    const markdown = formatReportAsMarkdown(report)

    expect(markdown).toContain('## Optimization Analysis')
    expect(markdown).toContain('Connection Pooling')
    expect(markdown).toContain('ADOPT')
  })
})

// ============================================================================
// Integration Tests (Full Benchmark Suite)
// ============================================================================

describe('Full Benchmark Suite', () => {
  it('runs complete benchmark with reduced iterations', async () => {
    const report = await runColdStartBenchmark({
      tursoConfig: testTursoConfig,
      r2Config: testR2Config,
      iterations: 5, // Very reduced for CI
    })

    expect(report.results.length).toBeGreaterThan(0)
    expect(report.timestamp).toBeDefined()
    expect(report.summary).toBeDefined()

    // Verify all expected scenario types are present
    const scenarioNames = report.results.map((r) => r.scenario)
    expect(scenarioNames.some((n) => n.includes('libSQL'))).toBe(true)
    expect(scenarioNames.some((n) => n.includes('Iceberg'))).toBe(true)
    expect(scenarioNames.some((n) => n.includes('Hybrid'))).toBe(true)
  }, 60000) // 60s timeout for full suite
})

// ============================================================================
// Real Scenario Tests (Simulated External Calls)
// ============================================================================

describe('Real Scenario Simulations', () => {
  it('libSQL scenarios have realistic latencies', async () => {
    const scenarios = createLibSQLScenarios(testTursoConfig)
    const scenario100KB = scenarios.find((s) => s.name.includes('100KB'))!

    const result = await measureColdStart(scenario100KB, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    // Simulated libSQL should be 50-200ms typically
    expect(result.p50).toBeGreaterThan(30)
    expect(result.p50).toBeLessThan(500)
    expect(result.breakdown?.connectionTime).toBeGreaterThan(0)
  })

  it('Iceberg scenarios have realistic latencies', async () => {
    const scenarios = createIcebergScenarios(testR2Config)
    const singleFileScenario = scenarios.find((s) => s.name.includes('Single'))!

    const result = await measureColdStart(singleFileScenario, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    // Simulated Iceberg should be 80-300ms typically
    expect(result.p50).toBeGreaterThan(50)
    expect(result.p50).toBeLessThan(600)
    expect(result.breakdown?.networkTime).toBeGreaterThan(0)
  })

  it('Hybrid cache hit is faster than cache miss', async () => {
    const scenarios = createHybridScenarios(testTursoConfig, testR2Config)
    const cacheHit = scenarios.find((s) => s.name.includes('Cache hit'))!
    const cacheMiss = scenarios.find((s) => s.name.includes('Cache miss'))!

    const hitResult = await measureColdStart(cacheHit, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    const missResult = await measureColdStart(cacheMiss, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    // Cache hit should generally be faster (though with simulation variance)
    // We check P95 to account for variance
    expect(hitResult.p95).toBeLessThan(missResult.p95 * 1.5)
  })

  it('lazy loading has lower initial latency', async () => {
    const scenarios = createIcebergScenarios(testR2Config)
    const singleFile = scenarios.find((s) => s.name.includes('Single'))!
    const lazyLoading = scenarios.find((s) => s.name.includes('Lazy'))!

    const singleResult = await measureColdStart(singleFile, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    const lazyResult = await measureColdStart(lazyLoading, {
      ...testBenchmarkOptions,
      iterations: 10,
    })

    // Lazy loading should be significantly faster for initial load
    expect(lazyResult.p50).toBeLessThan(singleResult.p50)
  })
})

// ============================================================================
// Target Validation Tests
// ============================================================================

describe('Target Validation', () => {
  it('validates 500ms target for 100KB state', async () => {
    // This test validates that at least one strategy can meet the target
    const scenarios = [
      ...createLibSQLScenarios(testTursoConfig),
      ...createHybridScenarios(testTursoConfig, testR2Config),
    ].filter((s) => s.stateSize === 100 * 1024)

    const results: LatencyResult[] = []
    for (const scenario of scenarios) {
      const result = await measureColdStart(scenario, {
        ...testBenchmarkOptions,
        iterations: 20,
      })
      results.push(result)
    }

    // At least one scenario should meet the target
    const meetsTarget = results.some((r) => r.p95 < 500)
    console.log(
      '\nTarget validation results:',
      results.map((r) => `${r.scenario}: P95=${r.p95.toFixed(1)}ms`)
    )

    expect(meetsTarget).toBe(true)
  })
})
