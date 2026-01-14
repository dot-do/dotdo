// Wrapper to make our framework work with vitest bench
import { BenchmarkRunner } from './runner'
import { bench as vitestBench, describe } from 'vitest'

export function createBenchmark(name: string, fn: () => any | Promise<any>, config?: { iterations?: number }) {
  // For vitest bench mode, use native bench
  if (typeof vitestBench !== 'undefined') {
    return vitestBench(name, fn)
  }

  // Fallback to our runner for non-bench mode
  return async () => {
    const runner = new BenchmarkRunner({ name, iterations: config?.iterations ?? 100 })
    return runner.run(fn)
  }
}

export { describe }
