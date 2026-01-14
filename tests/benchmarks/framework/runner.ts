import { BenchmarkConfig, BenchmarkContext } from './types'

export { BenchmarkConfig }

export class BenchmarkRunner {
  private config: BenchmarkConfig

  constructor(config: BenchmarkConfig = {}) {
    this.config = {
      warmup: config.warmup ?? 0,
      iterations: config.iterations ?? 10,
      timeout: config.timeout,
      name: config.name,
      store: config.store ?? 'unknown',
      operation: config.operation ?? 'unknown'
    }
  }

  async run<T>(fn: () => T | Promise<T>): Promise<{ samples: number[], context: BenchmarkContext }> {
    const { warmup = 0, iterations = 10, timeout } = this.config
    const samples: number[] = []

    // Warmup phase
    for (let i = 0; i < warmup; i++) {
      await this.executeWithTimeout(fn, timeout)
    }

    // Measured phase
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await this.executeWithTimeout(fn, timeout)
      const end = performance.now()
      samples.push(end - start)
    }

    const context: BenchmarkContext = {
      name: this.config.name,
      store: this.config.store!,
      operation: this.config.operation!,
      datasetSize: 0,
      iterations,
      environment: 'local'
    }

    return { samples, context }
  }

  private async executeWithTimeout<T>(fn: () => T | Promise<T>, timeout?: number): Promise<T> {
    if (!timeout) {
      return await fn()
    }

    return Promise.race([
      Promise.resolve(fn()),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Benchmark timeout exceeded')), timeout)
      )
    ])
  }
}
