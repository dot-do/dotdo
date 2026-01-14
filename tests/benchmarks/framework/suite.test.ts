import { describe, test, expect } from 'vitest'
import { BenchmarkSuite, suite } from './suite'

describe('BenchmarkSuite', () => {
  test('runs single benchmark', async () => {
    const s = suite('TestSuite', { iterations: 3 })
      .bench('fast', () => {})

    const results = await s.run()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('TestSuite.fast')
    expect(results[0].samples).toHaveLength(3)
  })

  test('runs multiple benchmarks', async () => {
    const s = suite('Multi')
      .bench('one', () => {})
      .bench('two', () => {})
      .bench('three', () => {})

    const results = await s.run()
    expect(results).toHaveLength(3)
  })

  test('supports nested suites', async () => {
    const child = suite('Child').bench('op', () => {})
    const parent = suite('Parent')
      .bench('op', () => {})
      .addSuite(child)

    const results = await parent.run()
    expect(results).toHaveLength(2)
    expect(results.map(r => r.name)).toContain('Parent.op')
    expect(results.map(r => r.name)).toContain('Child.op')
  })

  test('inherits config from suite', async () => {
    const s = suite('ConfigTest', { iterations: 5 })
      .bench('op', () => {})

    const results = await s.run()
    expect(results[0].samples).toHaveLength(5)
  })

  test('benchmark config overrides suite config', async () => {
    const s = suite('Override', { iterations: 5 })
      .bench('op', () => {}, { iterations: 2 })

    const results = await s.run()
    expect(results[0].samples).toHaveLength(2)
  })
})
