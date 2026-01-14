import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { benchmark, type BenchmarkConfig, type BenchmarkResult } from '../runner'
import type { BenchmarkContext } from '../context'

describe('benchmark', () => {
  beforeEach(() => {
    // Mock global fetch for all tests
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          headers: { 'cf-ray': '123-SJC' },
        })
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('should run specified number of iterations', async () => {
    let count = 0
    const config: BenchmarkConfig = {
      name: 'test-iterations',
      target: 'test.perf.do',
      iterations: 5,
      run: async () => {
        count++
      },
    }

    await benchmark(config)
    expect(count).toBe(5)
  })

  it('should execute warmup iterations before recording', async () => {
    const calls: string[] = []

    const config: BenchmarkConfig = {
      name: 'test-warmup',
      target: 'test.perf.do',
      iterations: 3,
      warmup: 2,
      run: async (_, iteration) => {
        calls.push(`run-${iteration}`)
      },
    }

    const result = await benchmark(config)

    // Warmup calls should happen (but not recorded)
    expect(calls).toContain('run-0')
    expect(calls).toContain('run-1')
    // Regular iterations
    expect(calls).toContain('run-2')
    expect(calls).toContain('run-3')
    expect(calls).toContain('run-4')
    // Result should only have 3 samples (not 5)
    expect(result.samples.length).toBe(3)
  })

  it('should call setup before iterations', async () => {
    const order: string[] = []

    const config: BenchmarkConfig = {
      name: 'test-setup',
      target: 'test.perf.do',
      iterations: 2,
      setup: async () => {
        order.push('setup')
      },
      run: async () => {
        order.push('run')
      },
    }

    await benchmark(config)

    expect(order[0]).toBe('setup')
    expect(order.filter((o) => o === 'run').length).toBe(2)
  })

  it('should call teardown after iterations', async () => {
    const order: string[] = []

    const config: BenchmarkConfig = {
      name: 'test-teardown',
      target: 'test.perf.do',
      iterations: 2,
      run: async () => {
        order.push('run')
      },
      teardown: async () => {
        order.push('teardown')
      },
    }

    await benchmark(config)

    expect(order[order.length - 1]).toBe('teardown')
  })

  it('should provide context to run function', async () => {
    let capturedContext: BenchmarkContext | null = null

    const config: BenchmarkConfig = {
      name: 'test-context',
      target: 'test.perf.do',
      iterations: 1,
      run: async (ctx) => {
        capturedContext = ctx
      },
    }

    await benchmark(config)

    expect(capturedContext).not.toBeNull()
    expect(capturedContext!.target).toBe('test.perf.do')
    expect(typeof capturedContext!.fetch).toBe('function')
  })

  it('should measure latency for each iteration', async () => {
    const config: BenchmarkConfig = {
      name: 'test-latency',
      target: 'test.perf.do',
      iterations: 3,
      run: async () => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 10))
      },
    }

    const result = await benchmark(config)

    expect(result.samples.length).toBe(3)
    result.samples.forEach((sample) => {
      expect(sample).toBeGreaterThan(0)
      expect(sample).toBeGreaterThanOrEqual(10) // At least 10ms
    })
  })

  it('should calculate stats from samples', async () => {
    const config: BenchmarkConfig = {
      name: 'test-stats',
      target: 'test.perf.do',
      iterations: 5,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }

    const result = await benchmark(config)

    expect(result.stats).toBeDefined()
    expect(result.stats.p50).toBeGreaterThan(0)
    expect(result.stats.p95).toBeGreaterThan(0)
    expect(result.stats.p99).toBeGreaterThan(0)
    expect(result.stats.min).toBeGreaterThan(0)
    expect(result.stats.max).toBeGreaterThan(0)
    expect(result.stats.mean).toBeGreaterThan(0)
    expect(typeof result.stats.stddev).toBe('number')
  })

  it('should include metadata in result', async () => {
    const config: BenchmarkConfig = {
      name: 'test-metadata',
      target: 'test.perf.do',
      iterations: 3,
      datasetSize: 1000,
      shardCount: 4,
      run: async () => {},
    }

    const result = await benchmark(config)

    expect(result.name).toBe('test-metadata')
    expect(result.target).toBe('test.perf.do')
    expect(result.iterations).toBe(3)
    expect(result.timestamp).toBeDefined()
    expect(result.config).toBeDefined()
    expect(result.config?.datasetSize).toBe(1000)
    expect(result.config?.shardCount).toBe(4)
  })

  it('should track colos served', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        const colo = callCount % 2 === 0 ? 'LAX' : 'SJC'
        return Promise.resolve(
          new Response('{}', {
            headers: { 'cf-ray': `${callCount}-${colo}` },
          })
        )
      })
    )

    const config: BenchmarkConfig = {
      name: 'test-colos',
      target: 'test.perf.do',
      iterations: 4,
      run: async (ctx) => {
        await ctx.fetch('/api/test')
      },
    }

    const result = await benchmark(config)

    expect(result.colosServed).toBeDefined()
    expect(result.colosServed!.length).toBe(4)
  })

  it('should pass colo header when specified', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const config: BenchmarkConfig = {
      name: 'test-colo-header',
      target: 'test.perf.do',
      iterations: 1,
      colo: 'SJC',
      run: async (ctx) => {
        await ctx.fetch('/api/test')
      },
    }

    await benchmark(config)

    const calls = mockFetch.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const [, init] = calls[calls.length - 1]
    expect(init.headers['cf-ipcolo']).toBe('SJC')
  })

  it('should pass custom headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const config: BenchmarkConfig = {
      name: 'test-custom-headers',
      target: 'test.perf.do',
      iterations: 1,
      headers: {
        Authorization: 'Bearer test-token',
        'X-Custom': 'value',
      },
      run: async (ctx) => {
        await ctx.fetch('/api/test')
      },
    }

    await benchmark(config)

    const calls = mockFetch.mock.calls
    const [, init] = calls[calls.length - 1]
    expect(init.headers['Authorization']).toBe('Bearer test-token')
    expect(init.headers['X-Custom']).toBe('value')
  })

  it('should handle run function errors gracefully', async () => {
    const config: BenchmarkConfig = {
      name: 'test-error',
      target: 'test.perf.do',
      iterations: 3,
      run: async (_, iteration) => {
        if (iteration === 1) {
          throw new Error('Simulated error')
        }
      },
    }

    // Should not throw, but should record the error
    const result = await benchmark(config)

    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('should support coldStart mode', async () => {
    let fetchCalls = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCalls++
      return Promise.resolve(
        new Response('{}', {
          headers: { 'cf-ray': `${fetchCalls}-SJC` },
        })
      )
    })
    vi.stubGlobal('fetch', mockFetch)

    const config: BenchmarkConfig = {
      name: 'test-cold-start',
      target: 'test.perf.do',
      iterations: 3,
      coldStart: true,
      run: async (ctx) => {
        await ctx.fetch('/api/test')
      },
    }

    const result = await benchmark(config)

    expect(result.config?.coldStart).toBe(true)
    // Cold start should use unique DO instances (implementation detail)
  })

  it('should return valid BenchmarkResult structure', async () => {
    const config: BenchmarkConfig = {
      name: 'test-result-structure',
      target: 'test.perf.do',
      iterations: 3,
      warmup: 1,
      run: async () => {},
    }

    const result = await benchmark(config)

    // Validate result structure
    expect(result).toMatchObject({
      name: 'test-result-structure',
      target: 'test.perf.do',
      iterations: 3,
    })
    expect(result.stats).toMatchObject({
      p50: expect.any(Number),
      p95: expect.any(Number),
      p99: expect.any(Number),
      min: expect.any(Number),
      max: expect.any(Number),
      mean: expect.any(Number),
      stddev: expect.any(Number),
    })
    expect(Array.isArray(result.samples)).toBe(true)
    expect(typeof result.timestamp).toBe('string')
  })

  it('should provide iteration number to run function', async () => {
    const iterations: number[] = []

    const config: BenchmarkConfig = {
      name: 'test-iteration-number',
      target: 'test.perf.do',
      iterations: 5,
      run: async (_, iteration) => {
        iterations.push(iteration)
      },
    }

    await benchmark(config)

    expect(iterations).toEqual([0, 1, 2, 3, 4])
  })
})
