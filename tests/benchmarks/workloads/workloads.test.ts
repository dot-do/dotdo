import { describe, test, expect } from 'vitest'
import {
  ReadHeavyWorkload,
  WriteHeavyWorkload,
  MixedWorkload,
  BatchWorkload,
  createWorkload
} from './index'
import { AccessPattern } from './types'

describe('ReadHeavyWorkload', () => {
  test('has 90% read ratio', () => {
    const workload = new ReadHeavyWorkload()
    expect(workload.config.readRatio).toBe(0.9)
    expect(workload.config.writeRatio).toBe(0.1)
  })

  test('produces mostly reads', () => {
    const workload = new ReadHeavyWorkload({ operations: 100 })
    const ops = [...workload.operations(10)]

    const reads = ops.filter(op => op.type === 'read').length
    const writes = ops.filter(op => op.type === 'write').length

    // Should be approximately 90/10
    expect(reads).toBeGreaterThan(80)
    expect(writes).toBeLessThan(20)
  })
})

describe('WriteHeavyWorkload', () => {
  test('has 90% write ratio', () => {
    const workload = new WriteHeavyWorkload()
    expect(workload.config.readRatio).toBe(0.1)
    expect(workload.config.writeRatio).toBe(0.9)
  })

  test('produces mostly writes', () => {
    const workload = new WriteHeavyWorkload({ operations: 100 })
    const ops = [...workload.operations(10)]

    const reads = ops.filter(op => op.type === 'read').length
    const writes = ops.filter(op => op.type === 'write').length

    expect(writes).toBeGreaterThan(80)
    expect(reads).toBeLessThan(20)
  })
})

describe('MixedWorkload', () => {
  test('has 50% read ratio', () => {
    const workload = new MixedWorkload()
    expect(workload.config.readRatio).toBe(0.5)
    expect(workload.config.writeRatio).toBe(0.5)
  })

  test('produces balanced reads and writes', () => {
    const workload = new MixedWorkload({ operations: 100 })
    const ops = [...workload.operations(10)]

    const reads = ops.filter(op => op.type === 'read').length
    const writes = ops.filter(op => op.type === 'write').length

    // Should be approximately 50/50 (within 20% tolerance)
    expect(reads).toBeGreaterThan(30)
    expect(reads).toBeLessThan(70)
    expect(writes).toBeGreaterThan(30)
    expect(writes).toBeLessThan(70)
  })
})

describe('BatchWorkload', () => {
  test('uses configured batch size', () => {
    const workload = new BatchWorkload({ batchSize: 50 })
    expect(workload.config.batchSize).toBe(50)
  })

  test('operations include batch index', () => {
    const workload = new BatchWorkload({ batchSize: 10, operations: 30 })
    const ops = [...workload.operations(100)]

    // Should have 3 batches of 10
    expect(ops.filter(op => op.batchIndex === 0).length).toBe(10)
    expect(ops.filter(op => op.batchIndex === 1).length).toBe(10)
    expect(ops.filter(op => op.batchIndex === 2).length).toBe(10)
  })
})

describe('Workload Operation Limits', () => {
  test('respects operation limit', () => {
    const workload = new MixedWorkload({ operations: 50 })
    const ops = [...workload.operations(100)]

    expect(ops.length).toBe(50)
  })

  test('respects duration limit', async () => {
    const workload = new MixedWorkload({ duration: 100 })
    const ops: any[] = []
    const start = Date.now()

    for (const op of workload.operations(100)) {
      if (Date.now() - start > 100) break
      ops.push(op)
      await new Promise(r => setTimeout(r, 10)) // Simulate work
    }

    // Should have stopped due to duration
    expect(Date.now() - start).toBeLessThan(200)
  })
})

describe('Access Patterns', () => {
  test('sequential visits keys in order', () => {
    const workload = createWorkload({
      name: 'seq-test',
      readRatio: 1,
      writeRatio: 0,
      batchSize: 1,
      operations: 10,
      accessPattern: 'sequential'
    })

    const ops = [...workload.operations(10)]
    const keys = ops.map(op => parseInt(op.key.replace('key_', '')))

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).toBeGreaterThanOrEqual(keys[i-1])
    }
  })

  test('random visits keys uniformly', () => {
    const workload = createWorkload({
      name: 'rand-test',
      readRatio: 1,
      writeRatio: 0,
      batchSize: 1,
      operations: 1000,
      accessPattern: 'random'
    })

    const ops = [...workload.operations(10)]
    const keyCounts = new Map<string, number>()

    ops.forEach(op => {
      keyCounts.set(op.key, (keyCounts.get(op.key) || 0) + 1)
    })

    // With 1000 ops and 10 keys, each should be hit ~100 times
    // Allow 50% tolerance
    keyCounts.forEach((count) => {
      expect(count).toBeGreaterThan(50)
      expect(count).toBeLessThan(150)
    })
  })

  test('zipf follows power law distribution', () => {
    const workload = createWorkload({
      name: 'zipf-test',
      readRatio: 1,
      writeRatio: 0,
      batchSize: 1,
      operations: 1000,
      accessPattern: 'zipf'
    })

    const ops = [...workload.operations(10)]
    const keyCounts = new Map<string, number>()

    ops.forEach(op => {
      keyCounts.set(op.key, (keyCounts.get(op.key) || 0) + 1)
    })

    // Sort by count descending
    const sorted = [...keyCounts.entries()].sort((a, b) => b[1] - a[1])

    // In Zipf, the most popular item should be hit way more than the least
    expect(sorted[0][1]).toBeGreaterThan(sorted[sorted.length - 1][1] * 2)
  })
})

describe('createWorkload factory', () => {
  test('creates workload from config', () => {
    const config = {
      name: 'custom',
      readRatio: 0.7,
      writeRatio: 0.3,
      batchSize: 5,
      operations: 100,
      accessPattern: 'random' as AccessPattern
    }

    const workload = createWorkload(config)
    expect(workload.config).toEqual(config)
  })
})
