import type { BenchmarkResult } from './types'
import type { Baseline, BaselineConfig, Delta, DeltaEntry } from './baseline-types'
import * as fs from 'fs/promises'

export class BaselineManager {
  private config: BaselineConfig

  constructor(config: BaselineConfig) {
    this.config = config
  }

  async save(
    results: BenchmarkResult[],
    metadata?: { commit?: string; branch?: string; [key: string]: unknown }
  ): Promise<void> {
    const baseline: Baseline = {
      timestamp: new Date().toISOString(),
      results,
      metadata: metadata ?? {}
    }
    await fs.writeFile(this.config.path, JSON.stringify(baseline, null, 2))
  }

  async load(): Promise<Baseline | null> {
    try {
      const content = await fs.readFile(this.config.path, 'utf-8')
      return JSON.parse(content) as Baseline
    } catch {
      return null
    }
  }

  async calculateDelta(current: BenchmarkResult[]): Promise<Delta | null> {
    const baseline = await this.load()
    if (!baseline) {
      return null
    }

    const baselineMap = new Map(baseline.results.map((r) => [r.name, r]))
    const delta: Delta = {}

    for (const result of current) {
      const baselineResult = baselineMap.get(result.name)
      if (!baselineResult) {
        // New benchmark, no baseline to compare
        continue
      }

      const baselineP50 = baselineResult.metrics.latency.p50
      const currentP50 = result.metrics.latency.p50
      const change = (currentP50 - baselineP50) / baselineP50

      delta[result.name] = {
        baselineP50,
        currentP50,
        change
      }
    }

    return delta
  }
}
