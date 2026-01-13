/**
 * DigitalBusiness DO Tests - TDD RED Phase
 *
 * Tests for DigitalBusiness DO subclass that extends Business with
 * digital metrics OKRs: Traffic, Conversion, Engagement.
 *
 * Pattern:
 * ```typescript
 * class MyApp extends DigitalBusiness {
 *   // Inherits: Revenue, Costs, Profit from Business
 *   // Adds: Traffic, Conversion, Engagement
 * }
 * ```
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
function createMockEnv() {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
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
// TESTS: DigitalBusiness Class Structure
// ============================================================================

describe('DigitalBusiness DO', () => {
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

    it('exports DigitalBusiness class from objects/DigitalBusiness.ts', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')
      expect(DigitalBusiness).toBeDefined()
      expect(typeof DigitalBusiness).toBe('function')
    })

    it('extends Business class', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')
      const { Business } = await import('../Business')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance).toBeInstanceOf(Business)
    })

    it('has static $type property set to "DigitalBusiness"', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      expect(DigitalBusiness.$type).toBe('DigitalBusiness')
    })

    it('inherits from Business which inherits from DO', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')
      const { DO } = await import('../DO')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance).toBeInstanceOf(DO)
    })

    it('has $ workflow context from DO base class', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.$).toBeDefined()
      expect(typeof instance.$).toBe('object')
    })
  })

  // ==========================================================================
  // TESTS: OKR Properties
  // ==========================================================================

  describe('OKR Properties', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('has okrs property', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance).toHaveProperty('okrs')
      expect(typeof instance.okrs).toBe('object')
    })

    it('has Revenue OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Revenue).toBeDefined()
      expect(instance.okrs.Revenue.objective).toBe('Grow revenue')
    })

    it('Revenue OKR has TotalRevenue key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const revenueKeyResult = instance.okrs.Revenue.keyResults.find(kr => kr.name === 'TotalRevenue')
      expect(revenueKeyResult).toBeDefined()
      expect(revenueKeyResult!.target).toBeGreaterThan(0)
    })

    it('has Costs OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Costs).toBeDefined()
      expect(instance.okrs.Costs.objective).toBe('Optimize costs')
    })

    it('has Profit OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Profit).toBeDefined()
      expect(instance.okrs.Profit.objective).toBe('Maximize profit')
    })

    it('has Traffic OKR (digital-specific)', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Traffic).toBeDefined()
      expect(instance.okrs.Traffic.objective).toBe('Increase website traffic')
    })

    it('Traffic OKR has PageViews key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const pageViewsKeyResult = instance.okrs.Traffic.keyResults.find(kr => kr.name === 'PageViews')
      expect(pageViewsKeyResult).toBeDefined()
    })

    it('Traffic OKR has UniqueVisitors key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const uniqueVisitorsKeyResult = instance.okrs.Traffic.keyResults.find(kr => kr.name === 'UniqueVisitors')
      expect(uniqueVisitorsKeyResult).toBeDefined()
    })

    it('has Conversion OKR (digital-specific)', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Conversion).toBeDefined()
      expect(instance.okrs.Conversion.objective).toBe('Improve conversion rates')
    })

    it('Conversion OKR has OverallConversion key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const conversionKeyResult = instance.okrs.Conversion.keyResults.find(kr => kr.name === 'OverallConversion')
      expect(conversionKeyResult).toBeDefined()
      expect(conversionKeyResult!.unit).toBe('%')
    })

    it('has Engagement OKR (digital-specific)', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Engagement).toBeDefined()
      expect(instance.okrs.Engagement.objective).toBe('Boost user engagement')
    })

    it('Engagement OKR has SessionDuration key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const sessionDurationKeyResult = instance.okrs.Engagement.keyResults.find(kr => kr.name === 'SessionDuration')
      expect(sessionDurationKeyResult).toBeDefined()
      expect(sessionDurationKeyResult!.unit).toBe('seconds')
    })

    it('Engagement OKR has DAUMAURatio key result', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const dauMauKeyResult = instance.okrs.Engagement.keyResults.find(kr => kr.name === 'DAUMAURatio')
      expect(dauMauKeyResult).toBeDefined()
      expect(dauMauKeyResult!.unit).toBe('%')
    })
  })

  // ==========================================================================
  // TESTS: OKR Progress Calculation
  // ==========================================================================

  describe('OKR Progress Calculation', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('Traffic OKR has progress() method', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(typeof instance.okrs.Traffic.progress).toBe('function')
    })

    it('Conversion OKR has progress() method', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(typeof instance.okrs.Conversion.progress).toBe('function')
    })

    it('Engagement OKR has progress() method', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(typeof instance.okrs.Engagement.progress).toBe('function')
    })

    it('Traffic OKR has isComplete() method', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(typeof instance.okrs.Traffic.isComplete).toBe('function')
    })

    it('progress starts at 0 for Traffic OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Traffic.progress()).toBe(0)
    })

    it('progress starts at 0 for Conversion OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Conversion.progress()).toBe(0)
    })

    it('progress starts at 0 for Engagement OKR', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      expect(instance.okrs.Engagement.progress()).toBe(0)
    })

    it('key results can be updated to track progress', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)
      const pageViewsKr = instance.okrs.Traffic.keyResults.find(kr => kr.name === 'PageViews')

      // Update current value
      pageViewsKr!.current = pageViewsKr!.target / 2

      // Progress should reflect the update
      expect(instance.okrs.Traffic.progress()).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // TESTS: Subclass Extension Pattern
  // ==========================================================================

  describe('Subclass Extension Pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('can be extended as class MyApp extends DigitalBusiness', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      class MyApp extends DigitalBusiness {
        static override readonly $type = 'MyApp'

        async getCustomMetric(): Promise<number> {
          return 42
        }
      }

      const instance = new MyApp(mockState, mockEnv)

      expect(instance).toBeInstanceOf(DigitalBusiness)
      expect(instance.$type).toBe('MyApp')
      expect(await instance.getCustomMetric()).toBe(42)
    })

    it('subclass inherits all six OKRs', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      class MyEcommerce extends DigitalBusiness {
        static override readonly $type = 'MyEcommerce'
      }

      const instance = new MyEcommerce(mockState, mockEnv)

      // Business OKRs
      expect(instance.okrs.Revenue).toBeDefined()
      expect(instance.okrs.Costs).toBeDefined()
      expect(instance.okrs.Profit).toBeDefined()

      // Digital-specific OKRs
      expect(instance.okrs.Traffic).toBeDefined()
      expect(instance.okrs.Conversion).toBeDefined()
      expect(instance.okrs.Engagement).toBeDefined()
    })

    it('subclass can add custom OKRs by extending in constructor', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')
      const { OKR } = await import('../DOBase')

      class MySaas extends DigitalBusiness {
        static override readonly $type = 'MySaas'

        constructor(ctx: DurableObjectState, env: ReturnType<typeof createMockEnv>) {
          super(ctx, env)
          // Add custom OKR after construction
          ;(this.okrs as Record<string, OKR>).Retention = this.defineOKR({
            objective: 'Maximize customer retention',
            keyResults: [
              { name: 'ChurnRate', target: 5, unit: '%' },
              { name: 'NPS', target: 50 },
            ],
          })
        }
      }

      const instance = new MySaas(mockState, mockEnv)

      // Has inherited OKRs
      expect(instance.okrs.Traffic).toBeDefined()
      expect(instance.okrs.Revenue).toBeDefined()

      // Has custom OKR
      expect((instance.okrs as Record<string, typeof OKR>).Retention).toBeDefined()
      expect((instance.okrs as Record<string, typeof OKR>).Retention.objective).toBe('Maximize customer retention')
    })

    it('subclass inherits Business methods (getConfig, setConfig)', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      class MyStore extends DigitalBusiness {}

      const instance = new MyStore(mockState, mockEnv)

      expect(typeof instance.getConfig).toBe('function')
      expect(typeof instance.setConfig).toBe('function')
    })

    it('subclass inherits Business app/member management', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      class MyPortal extends DigitalBusiness {}

      const instance = new MyPortal(mockState, mockEnv)

      expect(typeof instance.createApp).toBe('function')
      expect(typeof instance.listApps).toBe('function')
      expect(typeof instance.listMembers).toBe('function')
      expect(typeof instance.addMember).toBe('function')
    })
  })

  // ==========================================================================
  // TESTS: HTTP Endpoints
  // ==========================================================================

  describe('HTTP Endpoints', () => {
    let mockState: DurableObjectState
    let mockEnv: ReturnType<typeof createMockEnv>

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('/okrs endpoint returns all OKRs', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)

      const request = new Request('http://test/okrs')
      const response = await instance.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as Record<string, unknown>

      expect(data).toHaveProperty('Revenue')
      expect(data).toHaveProperty('Costs')
      expect(data).toHaveProperty('Profit')
      expect(data).toHaveProperty('Traffic')
      expect(data).toHaveProperty('Conversion')
      expect(data).toHaveProperty('Engagement')
    })

    it('/okrs/Traffic endpoint returns Traffic OKR details', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)

      const request = new Request('http://test/okrs/Traffic')
      const response = await instance.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as { objective: string; keyResults: unknown[]; progress: number }

      expect(data.objective).toBe('Increase website traffic')
      expect(data.keyResults).toBeDefined()
      expect(typeof data.progress).toBe('number')
    })

    it('inherits /config endpoint from Business', async () => {
      const { DigitalBusiness } = await import('../DigitalBusiness')

      const instance = new DigitalBusiness(mockState, mockEnv)

      await instance.setConfig({
        name: 'Test Digital Biz',
        slug: 'test-digital-biz',
      })

      const request = new Request('http://test/config')
      const response = await instance.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as { name: string }
      expect(data.name).toBe('Test Digital Biz')
    })
  })
})
