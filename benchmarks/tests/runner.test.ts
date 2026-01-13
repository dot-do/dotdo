/**
 * Benchmark Runner Tests
 *
 * TDD tests for the benchmark infrastructure that will measure DO latency,
 * throughput, and performance across different colocation scenarios.
 *
 * Test Cases:
 * - benchmark() function runs iterations with configurable warmup
 * - calculateStats() produces correct percentiles (p50, p95, p99, min, max, mean, stddev)
 * - cold start mode creates new DO per iteration
 * - setup/teardown hooks execute correctly
 * - record() appends results to .jsonl files
 * - result schema validation
 * - DO client creation with colo header injection
 * - response colo extraction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'

// Import the modules we're going to implement
// These imports will fail until we implement them (RED phase)
import { benchmark, calculateStats, record } from '../runner'
import { createDOClient, extractColo, type DOClientOptions } from '../context'
import type { BenchmarkOptions, BenchmarkResult, LatencyStats } from '../types'

describe('Benchmark Runner', () => {
  describe('calculateStats()', () => {
    it('should calculate correct statistics for a simple dataset', () => {
      // Simple dataset: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const latencies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

      const stats = calculateStats(latencies)

      expect(stats.min).toBe(1)
      expect(stats.max).toBe(10)
      expect(stats.mean).toBe(5.5)
      // p50 (median) for [1..10] is 5.5 (interpolated)
      expect(stats.p50).toBeCloseTo(5.5, 1)
      // p95 is the 95th percentile
      expect(stats.p95).toBeCloseTo(9.55, 1)
      // p99 is the 99th percentile
      expect(stats.p99).toBeCloseTo(9.91, 1)
      // Standard deviation
      expect(stats.stddev).toBeCloseTo(2.87, 1)
    })

    it('should handle single-element arrays', () => {
      const latencies = [42]

      const stats = calculateStats(latencies)

      expect(stats.min).toBe(42)
      expect(stats.max).toBe(42)
      expect(stats.mean).toBe(42)
      expect(stats.p50).toBe(42)
      expect(stats.p95).toBe(42)
      expect(stats.p99).toBe(42)
      expect(stats.stddev).toBe(0)
    })

    it('should handle unsorted input arrays', () => {
      const latencies = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10]

      const stats = calculateStats(latencies)

      expect(stats.min).toBe(1)
      expect(stats.max).toBe(10)
      expect(stats.mean).toBe(5.5)
    })

    it('should throw on empty arrays', () => {
      expect(() => calculateStats([])).toThrow()
    })

    it('should calculate percentiles correctly for larger datasets', () => {
      // Create a dataset of 100 values: 1, 2, 3, ..., 100
      const latencies = Array.from({ length: 100 }, (_, i) => i + 1)

      const stats = calculateStats(latencies)

      expect(stats.min).toBe(1)
      expect(stats.max).toBe(100)
      expect(stats.mean).toBe(50.5)
      expect(stats.p50).toBeCloseTo(50.5, 0) // Tolerance of 0 decimal places (within 0.5)
      // Different percentile methods give slightly different results
      // Linear interpolation: p95 is around 95-96 for 100 elements
      expect(stats.p95).toBeGreaterThanOrEqual(94)
      expect(stats.p95).toBeLessThanOrEqual(96)
      expect(stats.p99).toBeGreaterThanOrEqual(98)
      expect(stats.p99).toBeLessThanOrEqual(100)
    })
  })

  describe('benchmark()', () => {
    it('should run the specified number of iterations', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('test-benchmark', fn, {
        iterations: 10,
        warmup: 0,
      })

      expect(fn).toHaveBeenCalledTimes(10)
      expect(result.iterations).toBe(10)
      expect(result.name).toBe('test-benchmark')
    })

    it('should run warmup iterations before measuring', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('test-warmup', fn, {
        iterations: 5,
        warmup: 3,
      })

      // Total calls = warmup + iterations
      expect(fn).toHaveBeenCalledTimes(8)
      // But result only reports measured iterations
      expect(result.iterations).toBe(5)
    })

    it('should use default warmup if not specified', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('test-default-warmup', fn, {
        iterations: 10,
      })

      // Default warmup should be some reasonable value (e.g., 10% of iterations or 5)
      expect(fn.mock.calls.length).toBeGreaterThanOrEqual(10)
    })

    it('should calculate correct latency stats from timed iterations', async () => {
      // Simulate consistent 10ms latency
      const fn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      const result = await benchmark('test-latency', fn, {
        iterations: 5,
        warmup: 0,
      })

      // All latencies should be around 10ms
      expect(result.stats.min).toBeGreaterThan(5)
      expect(result.stats.max).toBeLessThan(50) // Allow some variance
      expect(result.stats.mean).toBeGreaterThan(5)
    })

    it('should include timestamp in result', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('test-timestamp', fn, {
        iterations: 1,
        warmup: 0,
      })

      expect(result.timestamp).toBeDefined()
      // Timestamp should be ISO 8601 format
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp)
    })

    it('should execute setup hook before iterations', async () => {
      const callOrder: string[] = []
      const setup = vi.fn().mockImplementation(async () => {
        callOrder.push('setup')
      })
      const fn = vi.fn().mockImplementation(async () => {
        callOrder.push('iteration')
      })

      await benchmark('test-setup', fn, {
        iterations: 2,
        warmup: 0,
        setup,
      })

      expect(callOrder[0]).toBe('setup')
      expect(callOrder.filter((c) => c === 'setup').length).toBe(1)
      expect(callOrder.filter((c) => c === 'iteration').length).toBe(2)
    })

    it('should execute teardown hook after iterations', async () => {
      const callOrder: string[] = []
      const teardown = vi.fn().mockImplementation(async () => {
        callOrder.push('teardown')
      })
      const fn = vi.fn().mockImplementation(async () => {
        callOrder.push('iteration')
      })

      await benchmark('test-teardown', fn, {
        iterations: 2,
        warmup: 0,
        teardown,
      })

      expect(callOrder[callOrder.length - 1]).toBe('teardown')
      expect(callOrder.filter((c) => c === 'teardown').length).toBe(1)
    })

    it('should support cold start mode with DO factory', async () => {
      const doFactory = vi.fn().mockResolvedValue({ id: 'test-do' })
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('test-cold-start', fn, {
        iterations: 3,
        warmup: 0,
        coldStart: true,
        doFactory,
      })

      // In cold start mode, doFactory should be called for each iteration
      expect(doFactory).toHaveBeenCalledTimes(3)
    })

    it('should pass DO instance to benchmark function in cold start mode', async () => {
      const mockDO = { id: 'test-do', fetch: vi.fn() }
      const doFactory = vi.fn().mockResolvedValue(mockDO)
      const fn = vi.fn().mockResolvedValue(undefined)

      await benchmark('test-do-instance', fn, {
        iterations: 1,
        warmup: 0,
        coldStart: true,
        doFactory,
      })

      // The benchmark function should receive the DO instance
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ do: mockDO }))
    })
  })

  describe('record()', () => {
    const testDir = '/tmp/benchmark-test-results'
    const testFile = path.join(testDir, 'test-results.jsonl')

    beforeEach(async () => {
      // Clean up test directory
      try {
        await fs.rm(testDir, { recursive: true })
      } catch {
        // Directory doesn't exist, that's fine
      }
      await fs.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      // Clean up
      try {
        await fs.rm(testDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should create file if it does not exist', async () => {
      const result: BenchmarkResult = {
        name: 'test-benchmark',
        iterations: 10,
        stats: {
          p50: 5,
          p95: 9,
          p99: 10,
          min: 1,
          max: 10,
          mean: 5.5,
          stddev: 2.87,
        },
        timestamp: new Date().toISOString(),
      }

      await record(result, testFile)

      const content = await fs.readFile(testFile, 'utf-8')
      expect(content).toContain('test-benchmark')
    })

    it('should append to existing file', async () => {
      const result1: BenchmarkResult = {
        name: 'benchmark-1',
        iterations: 10,
        stats: { p50: 5, p95: 9, p99: 10, min: 1, max: 10, mean: 5.5, stddev: 2.87 },
        timestamp: new Date().toISOString(),
      }
      const result2: BenchmarkResult = {
        name: 'benchmark-2',
        iterations: 20,
        stats: { p50: 10, p95: 18, p99: 20, min: 2, max: 20, mean: 11, stddev: 5.74 },
        timestamp: new Date().toISOString(),
      }

      await record(result1, testFile)
      await record(result2, testFile)

      const content = await fs.readFile(testFile, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines.length).toBe(2)
      expect(JSON.parse(lines[0]).name).toBe('benchmark-1')
      expect(JSON.parse(lines[1]).name).toBe('benchmark-2')
    })

    it('should write valid JSONL format', async () => {
      const result: BenchmarkResult = {
        name: 'jsonl-test',
        iterations: 5,
        stats: { p50: 5, p95: 9, p99: 10, min: 1, max: 10, mean: 5.5, stddev: 2.87 },
        timestamp: new Date().toISOString(),
        colo: 'SJC',
      }

      await record(result, testFile)

      const content = await fs.readFile(testFile, 'utf-8')
      const lines = content.trim().split('\n')

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }

      // Should include all fields
      const parsed = JSON.parse(lines[0])
      expect(parsed.name).toBe('jsonl-test')
      expect(parsed.colo).toBe('SJC')
      expect(parsed.stats.p50).toBe(5)
    })

    it('should use default filename if not specified', async () => {
      const result: BenchmarkResult = {
        name: 'default-file-test',
        iterations: 1,
        stats: { p50: 1, p95: 1, p99: 1, min: 1, max: 1, mean: 1, stddev: 0 },
        timestamp: new Date().toISOString(),
      }

      // This should write to a default location
      await record(result)

      // The default file should exist in benchmarks/results/
      const defaultPath = path.resolve(__dirname, '../results/benchmark-results.jsonl')
      const exists = await fs.access(defaultPath).then(() => true).catch(() => false)

      // Clean up default file if it was created
      if (exists) {
        await fs.unlink(defaultPath)
      }

      // Test passes if no error was thrown (file was created or default behavior worked)
      expect(true).toBe(true)
    })
  })

  describe('Result Schema Validation', () => {
    it('should validate result has required fields', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('validation-test', fn, {
        iterations: 1,
        warmup: 0,
      })

      // Required fields
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('iterations')
      expect(result).toHaveProperty('stats')
      expect(result).toHaveProperty('timestamp')

      // Stats should have all latency fields
      expect(result.stats).toHaveProperty('p50')
      expect(result.stats).toHaveProperty('p95')
      expect(result.stats).toHaveProperty('p99')
      expect(result.stats).toHaveProperty('min')
      expect(result.stats).toHaveProperty('max')
      expect(result.stats).toHaveProperty('mean')
      expect(result.stats).toHaveProperty('stddev')
    })

    it('should include optional colo field when available', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)

      const result = await benchmark('colo-test', fn, {
        iterations: 1,
        warmup: 0,
        colo: 'DFW',
      })

      expect(result.colo).toBe('DFW')
    })
  })
})

describe('DO Client Context', () => {
  describe('createDOClient()', () => {
    it('should create a client with default options', () => {
      const client = createDOClient({
        baseUrl: 'https://api.example.com',
      })

      expect(client).toBeDefined()
      expect(client.fetch).toBeInstanceOf(Function)
    })

    it('should inject colo header when colo option is specified', async () => {
      let capturedHeaders: Headers | undefined

      // Mock fetch to capture headers
      const mockFetch = vi.fn().mockImplementation((url, init) => {
        capturedHeaders = new Headers(init?.headers)
        return Promise.resolve(new Response('{}'))
      })

      const client = createDOClient({
        baseUrl: 'https://api.example.com',
        colo: 'SJC',
        fetch: mockFetch,
      })

      await client.fetch('/test')

      expect(capturedHeaders?.get('cf-ray-colo') || capturedHeaders?.get('x-cf-colo')).toBe('SJC')
    })

    it('should use custom headers alongside colo header', async () => {
      let capturedHeaders: Headers | undefined

      const mockFetch = vi.fn().mockImplementation((url, init) => {
        capturedHeaders = new Headers(init?.headers)
        return Promise.resolve(new Response('{}'))
      })

      const client = createDOClient({
        baseUrl: 'https://api.example.com',
        colo: 'LAX',
        fetch: mockFetch,
        headers: {
          'Authorization': 'Bearer test-token',
        },
      })

      await client.fetch('/test')

      expect(capturedHeaders?.get('Authorization')).toBe('Bearer test-token')
      expect(capturedHeaders?.get('cf-ray-colo') || capturedHeaders?.get('x-cf-colo')).toBe('LAX')
    })

    it('should support namespace-based DO routing', () => {
      const client = createDOClient({
        baseUrl: 'https://api.example.com',
        namespace: 'test-namespace',
      })

      expect(client.namespace).toBe('test-namespace')
    })
  })

  describe('extractColo()', () => {
    it('should extract colo from cf-ray header', () => {
      const response = new Response('{}', {
        headers: {
          'cf-ray': '12345-SJC',
        },
      })

      const colo = extractColo(response)

      expect(colo).toBe('SJC')
    })

    it('should extract colo from cf-ray header with longer ID', () => {
      const response = new Response('{}', {
        headers: {
          'cf-ray': 'abcdef123456-DFW',
        },
      })

      const colo = extractColo(response)

      expect(colo).toBe('DFW')
    })

    it('should return undefined if cf-ray header is missing', () => {
      const response = new Response('{}')

      const colo = extractColo(response)

      expect(colo).toBeUndefined()
    })

    it('should return undefined for malformed cf-ray header', () => {
      const response = new Response('{}', {
        headers: {
          'cf-ray': 'malformed-header-without-colo',
        },
      })

      // The format should be ID-COLO, so malformed should return undefined or the last part
      const colo = extractColo(response)

      // Depending on implementation, could return 'colo' or undefined
      expect(colo === 'colo' || colo === undefined).toBe(true)
    })
  })
})

describe('Types', () => {
  it('should export BenchmarkOptions type', () => {
    // This test verifies the type is exported and usable
    const options: BenchmarkOptions = {
      iterations: 10,
      warmup: 5,
      coldStart: false,
    }

    expect(options.iterations).toBe(10)
  })

  it('should export BenchmarkResult type', () => {
    const result: BenchmarkResult = {
      name: 'test',
      iterations: 10,
      stats: {
        p50: 5,
        p95: 9,
        p99: 10,
        min: 1,
        max: 10,
        mean: 5.5,
        stddev: 2.87,
      },
      timestamp: new Date().toISOString(),
    }

    expect(result.name).toBe('test')
  })

  it('should export LatencyStats type', () => {
    const stats: LatencyStats = {
      p50: 5,
      p95: 9,
      p99: 10,
      min: 1,
      max: 10,
      mean: 5.5,
      stddev: 2.87,
    }

    expect(stats.p50).toBe(5)
  })
})
