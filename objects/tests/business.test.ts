/**
 * Business DO Tests - TDD RED Phase
 *
 * Tests for the Business class with pre-configured OKRs for:
 * - Revenue: Track revenue targets (MRR, ARR)
 * - Costs: Track cost management (OpEx, COGS)
 * - Profit: Track profitability (GrossMargin, NetMargin)
 *
 * The Business class extends DO and provides default financial OKRs
 * that are commonly needed for any business.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DO as DOBase } from '../DOBase'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(query: string, ...params: unknown[]) {
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
function createMockDOId(name: string = 'test-business-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-business-id'): DurableObjectState {
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
function createMockEnv() {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

// ============================================================================
// TESTS: BUSINESS CLASS STRUCTURE
// ============================================================================

describe('Business Class', () => {
  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('Class Structure and Inheritance', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('exports Business class from objects/Business.ts', async () => {
      const { Business } = await import('../Business')
      expect(Business).toBeDefined()
      expect(typeof Business).toBe('function')
    })

    it('extends DO class', async () => {
      const { Business } = await import('../Business')
      const { DO } = await import('../DO')

      const business = new Business(mockState, mockEnv)
      expect(business).toBeInstanceOf(DO)
    })

    it('has static $type property set to "Business"', async () => {
      const { Business } = await import('../Business')
      expect(Business.$type).toBe('Business')
    })
  })

  // ==========================================================================
  // TESTS: PRE-CONFIGURED OKRS
  // ==========================================================================

  describe('Pre-configured OKRs', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('has okrs property with pre-configured OKRs', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      expect(business.okrs).toBeDefined()
      expect(typeof business.okrs).toBe('object')
    })

    it('has Revenue OKR pre-configured', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      expect(business.okrs.Revenue).toBeDefined()
      expect(business.okrs.Revenue.objective).toBeDefined()
      expect(typeof business.okrs.Revenue.objective).toBe('string')
    })

    it('Revenue OKR has MRR and ARR key results', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const revenueOKR = business.okrs.Revenue
      expect(revenueOKR.keyResults.length).toBeGreaterThanOrEqual(2)

      const keyResultNames = revenueOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('MRR')
      expect(keyResultNames).toContain('ARR')
    })

    it('has Costs OKR pre-configured', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      expect(business.okrs.Costs).toBeDefined()
      expect(business.okrs.Costs.objective).toBeDefined()
      expect(typeof business.okrs.Costs.objective).toBe('string')
    })

    it('Costs OKR has OpEx and COGS key results', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const costsOKR = business.okrs.Costs
      expect(costsOKR.keyResults.length).toBeGreaterThanOrEqual(2)

      const keyResultNames = costsOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('OpEx')
      expect(keyResultNames).toContain('COGS')
    })

    it('has Profit OKR pre-configured', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      expect(business.okrs.Profit).toBeDefined()
      expect(business.okrs.Profit.objective).toBeDefined()
      expect(typeof business.okrs.Profit.objective).toBe('string')
    })

    it('Profit OKR has GrossMargin and NetMargin key results', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const profitOKR = business.okrs.Profit
      expect(profitOKR.keyResults.length).toBeGreaterThanOrEqual(2)

      const keyResultNames = profitOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames).toContain('GrossMargin')
      expect(keyResultNames).toContain('NetMargin')
    })
  })

  // ==========================================================================
  // TESTS: OKR PROGRESS TRACKING
  // ==========================================================================

  describe('OKR Progress Tracking', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('Revenue OKR tracks progress', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const revenueOKR = business.okrs.Revenue

      expect(typeof revenueOKR.progress).toBe('function')
      expect(typeof revenueOKR.progress()).toBe('number')
    })

    it('Revenue OKR isComplete() returns boolean', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const revenueOKR = business.okrs.Revenue

      expect(typeof revenueOKR.isComplete).toBe('function')
      expect(typeof revenueOKR.isComplete()).toBe('boolean')
    })

    it('Costs OKR tracks progress', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const costsOKR = business.okrs.Costs

      expect(typeof costsOKR.progress).toBe('function')
      expect(typeof costsOKR.progress()).toBe('number')
    })

    it('Costs OKR isComplete() returns boolean', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const costsOKR = business.okrs.Costs

      expect(typeof costsOKR.isComplete).toBe('function')
      expect(typeof costsOKR.isComplete()).toBe('boolean')
    })

    it('Profit OKR tracks progress', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const profitOKR = business.okrs.Profit

      expect(typeof profitOKR.progress).toBe('function')
      expect(typeof profitOKR.progress()).toBe('number')
    })

    it('Profit OKR isComplete() returns boolean', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const profitOKR = business.okrs.Profit

      expect(typeof profitOKR.isComplete).toBe('function')
      expect(typeof profitOKR.isComplete()).toBe('boolean')
    })
  })

  // ==========================================================================
  // TESTS: OKR KEY RESULT UPDATES
  // ==========================================================================

  describe('OKR Key Result Updates', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('Revenue key results can be updated', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const mrrKeyResult = business.okrs.Revenue.keyResults.find((kr) => kr.name === 'MRR')
      expect(mrrKeyResult).toBeDefined()

      const initialProgress = business.okrs.Revenue.progress()

      // Update MRR current value
      mrrKeyResult!.current = mrrKeyResult!.target

      const newProgress = business.okrs.Revenue.progress()
      expect(newProgress).toBeGreaterThan(initialProgress)
    })

    it('Costs key results can be updated', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const opExKeyResult = business.okrs.Costs.keyResults.find((kr) => kr.name === 'OpEx')
      expect(opExKeyResult).toBeDefined()

      const initialProgress = business.okrs.Costs.progress()

      // Update OpEx current value
      opExKeyResult!.current = opExKeyResult!.target

      const newProgress = business.okrs.Costs.progress()
      expect(newProgress).toBeGreaterThan(initialProgress)
    })

    it('Profit key results can be updated', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const grossMarginKeyResult = business.okrs.Profit.keyResults.find((kr) => kr.name === 'GrossMargin')
      expect(grossMarginKeyResult).toBeDefined()

      const initialProgress = business.okrs.Profit.progress()

      // Update GrossMargin current value
      grossMarginKeyResult!.current = grossMarginKeyResult!.target

      const newProgress = business.okrs.Profit.progress()
      expect(newProgress).toBeGreaterThan(initialProgress)
    })
  })

  // ==========================================================================
  // TESTS: SUBCLASS PATTERN
  // ==========================================================================

  describe('Subclass Pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('subclass inherits pre-configured OKRs', async () => {
      const { Business } = await import('../Business')

      class MyBusiness extends Business {
        static override readonly $type = 'MyBusiness'
      }

      const myBusiness = new MyBusiness(mockState, mockEnv)

      expect(myBusiness.okrs.Revenue).toBeDefined()
      expect(myBusiness.okrs.Costs).toBeDefined()
      expect(myBusiness.okrs.Profit).toBeDefined()
    })

    it('subclass can add custom OKRs by extending in constructor', async () => {
      const { Business } = await import('../Business')

      class MyBusiness extends Business {
        static override readonly $type = 'MyBusiness'

        constructor(ctx: DurableObjectState, env: any) {
          super(ctx, env)
          // Add custom OKR after parent initialization
          this.okrs.CustomerGrowth = this.defineOKR({
            objective: 'Grow customer base',
            keyResults: [
              { name: 'TotalCustomers', target: 1000, current: 500 },
              { name: 'MonthlyChurn', target: 5, current: 3, unit: '%' },
            ],
          })
        }
      }

      const myBusiness = new MyBusiness(mockState, mockEnv)

      // Inherited OKRs still work
      expect(myBusiness.okrs.Revenue).toBeDefined()
      expect(myBusiness.okrs.Costs).toBeDefined()
      expect(myBusiness.okrs.Profit).toBeDefined()

      // Custom OKR is added
      expect(myBusiness.okrs.CustomerGrowth).toBeDefined()
      expect(myBusiness.okrs.CustomerGrowth.objective).toBe('Grow customer base')
      expect(myBusiness.okrs.CustomerGrowth.progress()).toBe(55) // avg of 50% and 60%
    })

    it('subclass can override default OKR targets in constructor', async () => {
      const { Business } = await import('../Business')

      class MyBusiness extends Business {
        static override readonly $type = 'MyBusiness'

        constructor(ctx: DurableObjectState, env: any) {
          super(ctx, env)
          // Override Revenue OKR with aggressive targets
          this.okrs.Revenue = this.defineOKR({
            objective: 'Achieve aggressive revenue targets',
            keyResults: [
              { name: 'MRR', target: 100000, current: 0 },
              { name: 'ARR', target: 1200000, current: 0 },
            ],
          })
        }
      }

      const myBusiness = new MyBusiness(mockState, mockEnv)

      // Revenue OKR is overridden with new targets
      expect(myBusiness.okrs.Revenue.objective).toBe('Achieve aggressive revenue targets')
      const mrrKeyResult = myBusiness.okrs.Revenue.keyResults.find((kr) => kr.name === 'MRR')
      expect(mrrKeyResult?.target).toBe(100000)

      // Other OKRs are still inherited
      expect(myBusiness.okrs.Costs).toBeDefined()
      expect(myBusiness.okrs.Profit).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: KEY RESULT UNITS
  // ==========================================================================

  describe('Key Result Units', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('Revenue key results have currency unit', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const mrrKeyResult = business.okrs.Revenue.keyResults.find((kr) => kr.name === 'MRR')
      const arrKeyResult = business.okrs.Revenue.keyResults.find((kr) => kr.name === 'ARR')

      expect(mrrKeyResult?.unit).toBe('$')
      expect(arrKeyResult?.unit).toBe('$')
    })

    it('Costs key results have currency unit', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const opExKeyResult = business.okrs.Costs.keyResults.find((kr) => kr.name === 'OpEx')
      const cogsKeyResult = business.okrs.Costs.keyResults.find((kr) => kr.name === 'COGS')

      expect(opExKeyResult?.unit).toBe('$')
      expect(cogsKeyResult?.unit).toBe('$')
    })

    it('Profit key results have percentage unit', async () => {
      const { Business } = await import('../Business')
      const business = new Business(mockState, mockEnv)

      const grossMarginKeyResult = business.okrs.Profit.keyResults.find((kr) => kr.name === 'GrossMargin')
      const netMarginKeyResult = business.okrs.Profit.keyResults.find((kr) => kr.name === 'NetMargin')

      expect(grossMarginKeyResult?.unit).toBe('%')
      expect(netMarginKeyResult?.unit).toBe('%')
    })
  })
})
