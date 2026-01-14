import { LatencyMetrics } from './types'

export class MetricCollector {
  private samples: number[]
  private sorted: number[]

  constructor(samples: number[]) {
    this.samples = samples
    this.sorted = [...samples].sort((a, b) => a - b)
  }

  get p50(): number {
    return this.percentile(50)
  }

  get p95(): number {
    return this.percentile(95)
  }

  get p99(): number {
    return this.percentile(99)
  }

  get min(): number {
    if (this.samples.length === 0) return 0
    return this.sorted[0]
  }

  get max(): number {
    if (this.samples.length === 0) return 0
    return this.sorted[this.sorted.length - 1]
  }

  get avg(): number {
    if (this.samples.length === 0) return 0
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }

  get stdDev(): number {
    if (this.samples.length === 0) return 0
    const avg = this.avg
    const squareDiffs = this.samples.map(s => Math.pow(s - avg, 2))
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / this.samples.length)
  }

  get confidenceInterval95(): { lower: number, upper: number } {
    if (this.samples.length < 2) return { lower: this.avg, upper: this.avg }
    const z = 1.96 // 95% CI
    const margin = z * (this.stdDev / Math.sqrt(this.samples.length))
    return { lower: this.avg - margin, upper: this.avg + margin }
  }

  private percentile(p: number): number {
    if (this.samples.length === 0) return 0
    if (this.samples.length === 1) return this.sorted[0]

    const n = this.sorted.length
    // Use linear interpolation with (n-1) range
    const index = (p / 100) * (n - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)

    if (lower === upper) return this.sorted[lower]

    const fraction = index - lower
    const result = this.sorted[lower] + fraction * (this.sorted[upper] - this.sorted[lower])

    // Round to avoid floating point precision issues when fraction is very small
    if (fraction < 0.1) {
      return this.sorted[lower]
    }
    if (fraction > 0.9) {
      return this.sorted[upper]
    }

    return result
  }

  toMetrics(): LatencyMetrics {
    return {
      p50: this.p50,
      p95: this.p95,
      p99: this.p99,
      min: this.min,
      max: this.max,
      avg: this.avg,
      stdDev: this.stdDev,
      ci95: this.confidenceInterval95
    }
  }
}
