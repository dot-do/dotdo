import { describe, test, expect, beforeEach } from 'vitest'
import { CostTracker, CostMetrics } from './cost-tracker'

describe('CostTracker', () => {
  let tracker: CostTracker

  beforeEach(() => {
    tracker = new CostTracker()
  })

  test('tracks row writes', () => {
    tracker.trackWrite(10)
    tracker.trackWrite(5)
    expect(tracker.rowWrites).toBe(15)
  })

  test('tracks row reads', () => {
    tracker.trackRead(100)
    tracker.trackRead(50)
    expect(tracker.rowReads).toBe(150)
  })

  test('tracks storage bytes', () => {
    tracker.trackStorage(1024)
    expect(tracker.storageBytes).toBe(1024)
  })

  test('calculates write cost at $1/M', () => {
    tracker.trackWrite(1_000_000)
    expect(tracker.estimatedCost).toBeCloseTo(1.0, 2)
  })

  test('calculates read cost at $0.001/M', () => {
    tracker.trackRead(1_000_000)
    expect(tracker.estimatedCost).toBeCloseTo(0.001, 4)
  })

  test('calculates storage cost at $0.20/GB', () => {
    tracker.trackStorage(1024 * 1024 * 1024) // 1GB
    expect(tracker.estimatedCost).toBeCloseTo(0.20, 2)
  })

  test('calculates combined cost', () => {
    tracker.trackWrite(500_000)   // $0.50
    tracker.trackRead(1_000_000)  // $0.001
    tracker.trackStorage(512 * 1024 * 1024) // 0.5GB = $0.10
    expect(tracker.estimatedCost).toBeCloseTo(0.601, 3)
  })

  test('resets counters', () => {
    tracker.trackWrite(100)
    tracker.trackRead(100)
    tracker.reset()
    expect(tracker.rowWrites).toBe(0)
    expect(tracker.rowReads).toBe(0)
    expect(tracker.estimatedCost).toBe(0)
  })

  test('returns metrics object', () => {
    tracker.trackWrite(1000)
    tracker.trackRead(5000)
    tracker.trackStorage(1024)

    const metrics = tracker.toMetrics()
    expect(metrics).toEqual({
      rowWrites: 1000,
      rowReads: 5000,
      storageBytes: 1024,
      storageGb: expect.any(Number),
      estimatedCost: expect.any(Number),
      breakdown: {
        writeCost: expect.any(Number),
        readCost: expect.any(Number),
        storageCost: expect.any(Number)
      }
    })
  })

  test('wraps function and tracks operations', async () => {
    const mockDb = {
      exec: (sql: string) => {
        if (sql.includes('INSERT')) return { changes: 5 }
        if (sql.includes('SELECT')) return { rows: Array(10).fill({}) }
        return {}
      }
    }

    const wrapped = tracker.wrap(mockDb)
    wrapped.exec('INSERT INTO test VALUES (...)')
    wrapped.exec('SELECT * FROM test')

    expect(tracker.rowWrites).toBe(5)
    expect(tracker.rowReads).toBe(10)
  })
})
