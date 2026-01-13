/**
 * DO OKR Framework Tests
 *
 * RED TDD: These tests exercise the OKR (Objectives and Key Results) framework
 * for the base DO class. Tests are written FIRST before implementation.
 *
 * The OKR framework allows DOs to define and track goals with key results:
 * - okrs property on DO instances
 * - defineOKR() method for typed OKR creation
 * - Key results with target/current values
 * - PascalCase metric names for consistency
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import { DO as DOBase } from '../DOBase'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// Type declarations for tests
interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

// ============================================================================
// OKR TYPE DEFINITIONS (for test reference)
// ============================================================================

/**
 * Key Result definition with target and current values
 */
interface KeyResult {
  name: string
  target: number
  current: number
  unit?: string
}

/**
 * OKR (Objective and Key Results) definition
 */
interface OKR {
  objective: string
  keyResults: KeyResult[]
  progress(): number
  isComplete(): boolean
}

/**
 * OKR Definition input for defineOKR()
 */
interface OKRDefinition {
  objective: string
  keyResults: Array<{
    name: string
    target: number
    current?: number
    unit?: string
  }>
}

// ============================================================================
// TESTS: OKR FRAMEWORK
// ============================================================================

describe('DO OKR Framework', () => {
  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('okrs property', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: DO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new DO(mockState, mockEnv)
    })

    it('DO instance has okrs property', () => {
      expect(doInstance).toHaveProperty('okrs')
    })

    it('okrs is empty object by default', () => {
      expect(doInstance.okrs).toBeDefined()
      expect(typeof doInstance.okrs).toBe('object')
      expect(Object.keys(doInstance.okrs)).toHaveLength(0)
    })

    it('okrs is an object (not null or undefined)', () => {
      expect(doInstance.okrs).not.toBeNull()
      expect(doInstance.okrs).not.toBeUndefined()
    })
  })

  describe('defineOKR() method', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: DO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new DO(mockState, mockEnv)
    })

    it('defineOKR method exists on DO', () => {
      expect(typeof doInstance.defineOKR).toBe('function')
    })

    it('defineOKR() returns typed OKR object', () => {
      const okr = doInstance.defineOKR({
        objective: 'Increase revenue',
        keyResults: [
          { name: 'MRR', target: 10000 },
          { name: 'Customers', target: 100 },
        ],
      })

      expect(okr).toBeDefined()
      expect(okr.objective).toBe('Increase revenue')
      expect(okr.keyResults).toHaveLength(2)
    })

    it('defineOKR() returns OKR with keyResults having target/current values', () => {
      const okr = doInstance.defineOKR({
        objective: 'Grow user base',
        keyResults: [
          { name: 'ActiveUsers', target: 1000, current: 250 },
          { name: 'DailySignups', target: 50, current: 10 },
        ],
      })

      expect(okr.keyResults[0]!.target).toBe(1000)
      expect(okr.keyResults[0]!.current).toBe(250)
      expect(okr.keyResults[1]!.target).toBe(50)
      expect(okr.keyResults[1]!.current).toBe(10)
    })

    it('defineOKR() defaults current to 0 if not provided', () => {
      const okr = doInstance.defineOKR({
        objective: 'Launch MVP',
        keyResults: [{ name: 'FeaturesComplete', target: 10 }],
      })

      expect(okr.keyResults[0]!.current).toBe(0)
    })

    it('defineOKR() preserves optional unit property', () => {
      const okr = doInstance.defineOKR({
        objective: 'Improve performance',
        keyResults: [
          { name: 'ResponseTime', target: 100, unit: 'ms' },
          { name: 'Uptime', target: 99.9, unit: '%' },
        ],
      })

      expect(okr.keyResults[0]!.unit).toBe('ms')
      expect(okr.keyResults[1]!.unit).toBe('%')
    })
  })

  describe('OKR progress calculation', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: DO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new DO(mockState, mockEnv)
    })

    it('OKR has progress() method', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [{ name: 'Metric', target: 100 }],
      })

      expect(typeof okr.progress).toBe('function')
    })

    it('progress() returns 0 when no progress made', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 0 },
          { name: 'Metric2', target: 50, current: 0 },
        ],
      })

      expect(okr.progress()).toBe(0)
    })

    it('progress() returns 100 when all targets met', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 100 },
          { name: 'Metric2', target: 50, current: 50 },
        ],
      })

      expect(okr.progress()).toBe(100)
    })

    it('progress() calculates average across key results', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 50 }, // 50% progress
          { name: 'Metric2', target: 100, current: 100 }, // 100% progress
        ],
      })

      // Average of 50% and 100% = 75%
      expect(okr.progress()).toBe(75)
    })

    it('OKR has isComplete() method', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [{ name: 'Metric', target: 100 }],
      })

      expect(typeof okr.isComplete).toBe('function')
    })

    it('isComplete() returns false when not all targets met', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 100 },
          { name: 'Metric2', target: 50, current: 25 },
        ],
      })

      expect(okr.isComplete()).toBe(false)
    })

    it('isComplete() returns true when all targets met or exceeded', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 150 },
          { name: 'Metric2', target: 50, current: 50 },
        ],
      })

      expect(okr.isComplete()).toBe(true)
    })
  })

  describe('Subclass OKR extension pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('subclass can extend okrs with custom metrics', () => {
      // Create a custom DO subclass with OKRs
      class MyApp extends DO {
        override okrs = {
          ...super.okrs,
          Revenue: this.defineOKR({
            objective: 'Achieve revenue targets',
            keyResults: [
              { name: 'MRR', target: 10000, current: 5000 },
              { name: 'ARR', target: 120000, current: 60000 },
            ],
          }),
        }
      }

      const appInstance = new MyApp(mockState, mockEnv)

      expect(appInstance.okrs.Revenue).toBeDefined()
      expect(appInstance.okrs.Revenue.objective).toBe('Achieve revenue targets')
      expect(appInstance.okrs.Revenue.keyResults).toHaveLength(2)
    })

    it('metrics are accessible via okrs.MetricName (PascalCase)', () => {
      class MyApp extends DO {
        override okrs = {
          ...super.okrs,
          CustomerGrowth: this.defineOKR({
            objective: 'Grow customer base',
            keyResults: [{ name: 'TotalCustomers', target: 1000, current: 500 }],
          }),
        }
      }

      const appInstance = new MyApp(mockState, mockEnv)

      // PascalCase metric access
      expect(appInstance.okrs.CustomerGrowth).toBeDefined()
      expect(appInstance.okrs.CustomerGrowth.progress()).toBe(50)
    })

    it('multiple OKRs can coexist', () => {
      class MyStartup extends DO {
        override okrs = {
          ...super.okrs,
          Revenue: this.defineOKR({
            objective: 'Hit revenue targets',
            keyResults: [{ name: 'MRR', target: 10000 }],
          }),
          Growth: this.defineOKR({
            objective: 'Achieve growth metrics',
            keyResults: [{ name: 'Users', target: 1000 }],
          }),
          Quality: this.defineOKR({
            objective: 'Maintain quality standards',
            keyResults: [{ name: 'Uptime', target: 99.9 }],
          }),
        }
      }

      const instance = new MyStartup(mockState, mockEnv)

      expect(Object.keys(instance.okrs)).toHaveLength(3)
      expect(instance.okrs.Revenue).toBeDefined()
      expect(instance.okrs.Growth).toBeDefined()
      expect(instance.okrs.Quality).toBeDefined()
    })
  })

  describe('OKR key result updates', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: DO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new DO(mockState, mockEnv)
    })

    it('key result current value can be updated', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [{ name: 'Metric', target: 100, current: 0 }],
      })

      // Update the current value
      okr.keyResults[0]!.current = 50

      expect(okr.keyResults[0]!.current).toBe(50)
      expect(okr.progress()).toBe(50)
    })

    it('progress updates as key results are updated', () => {
      const okr = doInstance.defineOKR({
        objective: 'Test objective',
        keyResults: [
          { name: 'Metric1', target: 100, current: 0 },
          { name: 'Metric2', target: 100, current: 0 },
        ],
      })

      expect(okr.progress()).toBe(0)

      // Update first metric to 50%
      okr.keyResults[0]!.current = 50
      expect(okr.progress()).toBe(25) // Average of 50% and 0%

      // Update second metric to 100%
      okr.keyResults[1]!.current = 100
      expect(okr.progress()).toBe(75) // Average of 50% and 100%

      // Complete first metric
      okr.keyResults[0]!.current = 100
      expect(okr.progress()).toBe(100)
      expect(okr.isComplete()).toBe(true)
    })
  })

  describe('Edge cases', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let doInstance: DO

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      doInstance = new DO(mockState, mockEnv)
    })

    it('handles OKR with no key results', () => {
      const okr = doInstance.defineOKR({
        objective: 'Empty objective',
        keyResults: [],
      })

      expect(okr.keyResults).toHaveLength(0)
      // With no key results, consider it complete
      expect(okr.isComplete()).toBe(true)
      expect(okr.progress()).toBe(100)
    })

    it('handles progress over 100% (exceeding targets)', () => {
      const okr = doInstance.defineOKR({
        objective: 'Overachieve',
        keyResults: [{ name: 'Metric', target: 100, current: 200 }],
      })

      // Progress should cap at 100 or show actual value
      expect(okr.progress()).toBeGreaterThanOrEqual(100)
    })

    it('handles zero target gracefully', () => {
      const okr = doInstance.defineOKR({
        objective: 'Zero target edge case',
        keyResults: [{ name: 'Metric', target: 0, current: 0 }],
      })

      // Should not throw - treat zero target as complete
      expect(() => okr.progress()).not.toThrow()
      expect(okr.isComplete()).toBe(true)
    })
  })
})
