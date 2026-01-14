import type {
  RemoteConfig,
  BenchmarkRequest,
  BenchmarkResponse,
  MultiRunResult
} from './remote-types'

export { RemoteConfig, BenchmarkRequest, BenchmarkResponse }

export class RemoteRunner {
  private config: RemoteConfig

  constructor(config: RemoteConfig) {
    this.config = {
      timeout: 30000,
      ...config
    }
  }

  async run(request: BenchmarkRequest): Promise<BenchmarkResponse> {
    const controller = new AbortController()

    // Create timeout promise that rejects
    const timeoutPromise = this.config.timeout
      ? new Promise<never>((_, reject) => {
          setTimeout(() => {
            controller.abort()
            reject(new Error('Remote benchmark timeout exceeded'))
          }, this.config.timeout)
        })
      : null

    // Create fetch promise
    const fetchPromise = fetch(`${this.config.endpoint}/benchmark`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    })

    try {
      // Race between fetch and timeout
      const response = timeoutPromise
        ? await Promise.race([fetchPromise, timeoutPromise])
        : await fetchPromise

      // Clone response to allow reading body multiple times (useful for tests with mocked responses)
      const clonedResponse = response.clone()

      if (!clonedResponse.ok) {
        const error = await clonedResponse.json().catch(() => ({ error: `HTTP ${clonedResponse.status}` }))
        throw new Error((error as { error?: string }).error || `HTTP ${clonedResponse.status}`)
      }

      return (await clonedResponse.json()) as BenchmarkResponse
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Remote benchmark timeout exceeded')
      }
      throw error
    }
  }

  async runMultiple(request: BenchmarkRequest, count: number): Promise<MultiRunResult> {
    const runs: BenchmarkResponse[] = []

    for (let i = 0; i < count; i++) {
      const result = await this.run(request)
      runs.push(result)
    }

    // Aggregate results
    const allSamples = runs.flatMap((r) => r.raw)
    const avgLatency = allSamples.reduce((a, b) => a + b, 0) / allSamples.length
    const minLatency = Math.min(...runs.map((r) => r.metrics.latency.min))
    const maxLatency = Math.max(...runs.map((r) => r.metrics.latency.max))

    return {
      runs,
      aggregated: {
        latency: {
          avg: avgLatency,
          min: minLatency,
          max: maxLatency,
          p50: this.percentile(allSamples, 50),
          p95: this.percentile(allSamples, 95),
          p99: this.percentile(allSamples, 99),
          stdDev: this.stdDev(allSamples)
        }
      }
    }
  }

  private percentile(samples: number[], p: number): number {
    const sorted = [...samples].sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  private stdDev(samples: number[]): number {
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    const squareDiffs = samples.map((s) => Math.pow(s - avg, 2))
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / samples.length)
  }
}
