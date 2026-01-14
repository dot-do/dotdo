import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { record, type BenchmarkResult } from '../reporter'
import * as fs from 'node:fs'
import * as path from 'node:path'

const RESULTS_DIR = path.join(__dirname, '../../results')

describe('record', () => {
  const testResultFile = () => {
    const date = new Date().toISOString().split('T')[0]
    return path.join(RESULTS_DIR, `${date}-benchmarks.jsonl`)
  }

  // Clean up test files after each test
  afterEach(() => {
    const file = testResultFile()
    if (fs.existsSync(file)) {
      // Read existing content and remove test entries
      const content = fs.readFileSync(file, 'utf-8')
      const lines = content.split('\n').filter((line) => {
        if (!line.trim()) return false
        try {
          const result = JSON.parse(line)
          return !result.name?.startsWith('test-benchmark')
        } catch {
          return true
        }
      })
      if (lines.length > 0) {
        fs.writeFileSync(file, lines.join('\n') + '\n')
      } else {
        fs.unlinkSync(file)
      }
    }
  })

  const createMockResult = (name: string): BenchmarkResult => ({
    name,
    target: 'test.perf.do',
    iterations: 10,
    stats: {
      p50: 100,
      p95: 150,
      p99: 200,
      min: 50,
      max: 250,
      mean: 110,
      stddev: 30,
    },
    samples: [50, 75, 100, 100, 100, 100, 150, 150, 200, 250],
    timestamp: new Date().toISOString(),
    config: {
      warmup: 2,
      coldStart: false,
    },
  })

  it('should create results file if it does not exist', () => {
    const result = createMockResult('test-benchmark-create')
    record(result)

    const file = testResultFile()
    expect(fs.existsSync(file)).toBe(true)
  })

  it('should append single result as JSONL', () => {
    const result = createMockResult('test-benchmark-single')
    record(result)

    const file = testResultFile()
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    const parsed = JSON.parse(lastLine)

    expect(parsed.name).toBe('test-benchmark-single')
    expect(parsed.stats.p50).toBe(100)
  })

  it('should append multiple results when given array', () => {
    const results = [createMockResult('test-benchmark-multi-1'), createMockResult('test-benchmark-multi-2'), createMockResult('test-benchmark-multi-3')]

    record(results)

    const file = testResultFile()
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n')

    // Find our test results
    const testResults = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed.name?.startsWith('test-benchmark-multi')
      } catch {
        return false
      }
    })

    expect(testResults.length).toBe(3)
  })

  it('should include all required fields in recorded result', () => {
    const result = createMockResult('test-benchmark-fields')
    record(result)

    const file = testResultFile()
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    const parsed = JSON.parse(lastLine)

    expect(parsed).toHaveProperty('name')
    expect(parsed).toHaveProperty('target')
    expect(parsed).toHaveProperty('iterations')
    expect(parsed).toHaveProperty('stats')
    expect(parsed).toHaveProperty('samples')
    expect(parsed).toHaveProperty('timestamp')
  })

  it('should preserve optional fields like colo and metadata', () => {
    const result: BenchmarkResult = {
      ...createMockResult('test-benchmark-optional'),
      colo: 'SJC',
      colosServed: ['SJC', 'SJC', 'LAX'],
      metadata: {
        datasetSize: 1000,
        shardCount: 4,
      },
    }

    record(result)

    const file = testResultFile()
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    const parsed = JSON.parse(lastLine)

    expect(parsed.colo).toBe('SJC')
    expect(parsed.colosServed).toEqual(['SJC', 'SJC', 'LAX'])
    expect(parsed.metadata.datasetSize).toBe(1000)
  })

  it('should use correct date format in filename', () => {
    const result = createMockResult('test-benchmark-date')
    record(result)

    const date = new Date().toISOString().split('T')[0]
    const expectedFile = path.join(RESULTS_DIR, `${date}-benchmarks.jsonl`)
    expect(fs.existsSync(expectedFile)).toBe(true)
  })

  it('should append to existing file without overwriting', () => {
    const result1 = createMockResult('test-benchmark-append-1')
    const result2 = createMockResult('test-benchmark-append-2')

    record(result1)
    record(result2)

    const file = testResultFile()
    const content = fs.readFileSync(file, 'utf-8')
    const testResults = content
      .trim()
      .split('\n')
      .filter((line) => {
        try {
          const parsed = JSON.parse(line)
          return parsed.name?.startsWith('test-benchmark-append')
        } catch {
          return false
        }
      })

    expect(testResults.length).toBe(2)
  })

  it('should handle empty array gracefully', () => {
    // Should not throw or create empty lines
    expect(() => record([])).not.toThrow()
  })
})
