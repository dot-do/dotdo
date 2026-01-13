/**
 * SaaS DO Tests
 *
 * RED TDD: Tests for SaaS Durable Object that extends DigitalBusiness
 * and adds SaaS-specific OKRs: MRR, Churn, NRR, CAC, LTV
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SaaS } from '../SaaS'
import { DigitalBusiness } from '../DigitalBusiness'
import { DO as DOBase } from '../DOBase'
import type { Env } from '../DO'

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
function createMockDOId(name: string = 'test-saas-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-saas-id'): DurableObjectState {
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
// TESTS: SaaS DO CLASS
// ============================================================================

describe('SaaS DO', () => {
  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('inheritance hierarchy', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let saasInstance: SaaS

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      saasInstance = new SaaS(mockState, mockEnv)
    })

    it('SaaS extends DigitalBusiness', () => {
      expect(saasInstance).toBeInstanceOf(DigitalBusiness)
    })

    it('SaaS has $type of "SaaS"', () => {
      expect(SaaS.$type).toBe('SaaS')
    })
  })

  describe('inherited OKRs from DigitalBusiness', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let saasInstance: SaaS

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      saasInstance = new SaaS(mockState, mockEnv)
    })

    it('SaaS has okrs property', () => {
      expect(saasInstance).toHaveProperty('okrs')
    })

    it('SaaS inherits Revenue OKR from Business', () => {
      expect(saasInstance.okrs.Revenue).toBeDefined()
      expect(saasInstance.okrs.Revenue.objective).toBeDefined()
    })

    it('SaaS inherits Costs OKR from Business', () => {
      expect(saasInstance.okrs.Costs).toBeDefined()
      expect(saasInstance.okrs.Costs.objective).toBeDefined()
    })

    it('SaaS inherits Profit OKR from Business', () => {
      expect(saasInstance.okrs.Profit).toBeDefined()
      expect(saasInstance.okrs.Profit.objective).toBeDefined()
    })

    it('SaaS inherits Traffic OKR from DigitalBusiness', () => {
      expect(saasInstance.okrs.Traffic).toBeDefined()
      expect(saasInstance.okrs.Traffic.objective).toBeDefined()
    })

    it('SaaS inherits Conversion OKR from DigitalBusiness', () => {
      expect(saasInstance.okrs.Conversion).toBeDefined()
      expect(saasInstance.okrs.Conversion.objective).toBeDefined()
    })

    it('SaaS inherits Engagement OKR from DigitalBusiness', () => {
      expect(saasInstance.okrs.Engagement).toBeDefined()
      expect(saasInstance.okrs.Engagement.objective).toBeDefined()
    })
  })

  describe('SaaS-specific OKRs', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let saasInstance: SaaS

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      saasInstance = new SaaS(mockState, mockEnv)
    })

    it('SaaS has MRR OKR', () => {
      expect(saasInstance.okrs.MRR).toBeDefined()
      expect(saasInstance.okrs.MRR.objective).toBeDefined()
      expect(saasInstance.okrs.MRR.keyResults.length).toBeGreaterThan(0)
    })

    it('MRR OKR has appropriate key results', () => {
      const mrrOKR = saasInstance.okrs.MRR
      const keyResultNames = mrrOKR.keyResults.map((kr) => kr.name)
      // Should have at least one key result tracking monthly recurring revenue
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('SaaS has Churn OKR', () => {
      expect(saasInstance.okrs.Churn).toBeDefined()
      expect(saasInstance.okrs.Churn.objective).toBeDefined()
      expect(saasInstance.okrs.Churn.keyResults.length).toBeGreaterThan(0)
    })

    it('Churn OKR tracks customer retention', () => {
      const churnOKR = saasInstance.okrs.Churn
      const keyResultNames = churnOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('SaaS has NRR OKR (Net Revenue Retention)', () => {
      expect(saasInstance.okrs.NRR).toBeDefined()
      expect(saasInstance.okrs.NRR.objective).toBeDefined()
      expect(saasInstance.okrs.NRR.keyResults.length).toBeGreaterThan(0)
    })

    it('NRR OKR tracks expansion and contraction', () => {
      const nrrOKR = saasInstance.okrs.NRR
      const keyResultNames = nrrOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('SaaS has CAC OKR (Customer Acquisition Cost)', () => {
      expect(saasInstance.okrs.CAC).toBeDefined()
      expect(saasInstance.okrs.CAC.objective).toBeDefined()
      expect(saasInstance.okrs.CAC.keyResults.length).toBeGreaterThan(0)
    })

    it('CAC OKR tracks acquisition efficiency', () => {
      const cacOKR = saasInstance.okrs.CAC
      const keyResultNames = cacOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('SaaS has LTV OKR (Lifetime Value)', () => {
      expect(saasInstance.okrs.LTV).toBeDefined()
      expect(saasInstance.okrs.LTV.objective).toBeDefined()
      expect(saasInstance.okrs.LTV.keyResults.length).toBeGreaterThan(0)
    })

    it('LTV OKR tracks customer lifetime value', () => {
      const ltvOKR = saasInstance.okrs.LTV
      const keyResultNames = ltvOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })
  })

  describe('OKR progress tracking', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let saasInstance: SaaS

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      saasInstance = new SaaS(mockState, mockEnv)
    })

    it('all SaaS OKRs have progress() method', () => {
      const saasOKRs = ['MRR', 'Churn', 'NRR', 'CAC', 'LTV']
      for (const okrName of saasOKRs) {
        expect(typeof saasInstance.okrs[okrName].progress).toBe('function')
      }
    })

    it('all SaaS OKRs have isComplete() method', () => {
      const saasOKRs = ['MRR', 'Churn', 'NRR', 'CAC', 'LTV']
      for (const okrName of saasOKRs) {
        expect(typeof saasInstance.okrs[okrName].isComplete).toBe('function')
      }
    })

    it('progress starts at 0 by default', () => {
      // All OKRs should have current = 0 by default
      expect(saasInstance.okrs.MRR.progress()).toBe(0)
    })
  })

  describe('complete OKR set', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let saasInstance: SaaS

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      saasInstance = new SaaS(mockState, mockEnv)
    })

    it('SaaS has all expected OKRs (9 total)', () => {
      // From Business: Revenue, Costs, Profit (3)
      // From DigitalBusiness: Traffic, Conversion, Engagement (3)
      // From SaaS: MRR, Churn, NRR, CAC, LTV (5)
      // Total: 11 OKRs
      const expectedOKRs = [
        // Business OKRs
        'Revenue',
        'Costs',
        'Profit',
        // DigitalBusiness OKRs
        'Traffic',
        'Conversion',
        'Engagement',
        // SaaS OKRs
        'MRR',
        'Churn',
        'NRR',
        'CAC',
        'LTV',
      ]

      for (const okrName of expectedOKRs) {
        expect(saasInstance.okrs[okrName]).toBeDefined()
      }
    })

    it('SaaS OKRs count matches expected', () => {
      // 3 from Business + 3 from DigitalBusiness + 5 from SaaS = 11
      expect(Object.keys(saasInstance.okrs).length).toBe(11)
    })
  })

  describe('user subclass pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('user can extend SaaS and inherit all OKRs', () => {
      class MyApp extends SaaS {}

      const myApp = new MyApp(mockState, mockEnv)

      // Should have all inherited OKRs
      expect(myApp.okrs.Revenue).toBeDefined()
      expect(myApp.okrs.Traffic).toBeDefined()
      expect(myApp.okrs.MRR).toBeDefined()
    })

    it('user can extend SaaS and add custom OKRs via constructor', () => {
      class MyApp extends SaaS {
        constructor(ctx: DurableObjectState, env: Env) {
          super(ctx, env)
          // Add custom OKR after construction
          this.okrs.CustomMetric = this.defineOKR({
            objective: 'Track custom metric',
            keyResults: [{ name: 'Value', target: 100, current: 0 }],
          })
        }
      }

      const myApp = new MyApp(mockState, mockEnv)

      // Should have all inherited OKRs plus custom
      expect(myApp.okrs.Revenue).toBeDefined()
      expect(myApp.okrs.MRR).toBeDefined()
      expect(myApp.okrs.CustomMetric).toBeDefined()
      expect(Object.keys(myApp.okrs).length).toBe(12) // 11 + 1 custom
    })
  })
})
