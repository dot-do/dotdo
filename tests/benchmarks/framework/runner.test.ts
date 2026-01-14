import { describe, test, expect, vi } from 'vitest'
import { BenchmarkRunner, BenchmarkConfig } from './runner'

describe('BenchmarkRunner', () => {
  test('executes fn with warmup iterations', async () => {
    const fn = vi.fn()
    const runner = new BenchmarkRunner({ warmup: 3, iterations: 5 })
    await runner.run(fn)
    expect(fn).toHaveBeenCalledTimes(8) // 3 warmup + 5 measured
  })

  test('executes fn with measured iterations', async () => {
    const fn = vi.fn()
    const runner = new BenchmarkRunner({ iterations: 10 })
    const result = await runner.run(fn)
    expect(result.samples.length).toBe(10)
  })

  test('collects timing samples in milliseconds', async () => {
    const fn = () => { /* sync */ }
    const runner = new BenchmarkRunner({ iterations: 5 })
    const result = await runner.run(fn)
    result.samples.forEach(s => {
      expect(typeof s).toBe('number')
      expect(s).toBeGreaterThanOrEqual(0)
    })
  })

  test('handles async functions', async () => {
    const fn = async () => { await new Promise(r => setTimeout(r, 1)) }
    const runner = new BenchmarkRunner({ iterations: 3 })
    const result = await runner.run(fn)
    expect(result.samples.length).toBe(3)
    result.samples.forEach(s => expect(s).toBeGreaterThanOrEqual(1))
  })

  test('respects timeout and throws', async () => {
    const fn = async () => { await new Promise(r => setTimeout(r, 100)) }
    const runner = new BenchmarkRunner({ iterations: 10, timeout: 50 })
    await expect(runner.run(fn)).rejects.toThrow(/timeout/i)
  })

  test('includes context in result', async () => {
    const runner = new BenchmarkRunner({
      iterations: 5,
      name: 'test-bench',
      store: 'document',
      operation: 'create'
    })
    const result = await runner.run(() => {})
    expect(result.context.name).toBe('test-bench')
    expect(result.context.store).toBe('document')
    expect(result.context.operation).toBe('create')
  })
})
