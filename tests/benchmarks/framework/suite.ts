import { BenchmarkRunner, BenchmarkConfig } from './runner'
import { MetricCollector } from './metrics'
import { CostTracker } from './cost-tracker'
import { BenchmarkResult } from './types'

export interface SuiteConfig {
  name: string
  warmup?: number
  iterations?: number
  timeout?: number
}

export class BenchmarkSuite {
  private name: string
  private benchmarks: Array<{ name: string, fn: () => any | Promise<any>, config?: BenchmarkConfig }> = []
  private config: SuiteConfig
  private suites: BenchmarkSuite[] = []

  constructor(config: SuiteConfig) {
    this.name = config.name
    this.config = config
  }

  bench(name: string, fn: () => any | Promise<any>, config?: BenchmarkConfig): this {
    this.benchmarks.push({ name, fn, config })
    return this
  }

  addSuite(suite: BenchmarkSuite): this {
    this.suites.push(suite)
    return this
  }

  async run(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []

    // Run own benchmarks
    for (const { name, fn, config } of this.benchmarks) {
      const runner = new BenchmarkRunner({
        ...this.config,
        ...config,
        name: `${this.name}.${name}`
      })
      const tracker = new CostTracker()

      const { samples, context } = await runner.run(fn)
      const collector = new MetricCollector(samples)

      results.push({
        name: `${this.name}.${name}`,
        samples,
        metrics: {
          latency: collector.toMetrics(),
          throughput: { opsPerSecond: 1000 / collector.avg, bytesPerSecond: 0 },
          cost: tracker.toMetrics(),
          resources: { peakMemoryMb: 0, storageBytesUsed: 0 }
        },
        context
      })
    }

    // Run nested suites
    for (const suite of this.suites) {
      const suiteResults = await suite.run()
      results.push(...suiteResults)
    }

    return results
  }
}

// Fluent API
export function suite(name: string, config?: Omit<SuiteConfig, 'name'>): BenchmarkSuite {
  return new BenchmarkSuite({ name, ...config })
}
