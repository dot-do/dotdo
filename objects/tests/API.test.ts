/**
 * API DO Tests
 *
 * RED TDD: Tests for API Durable Object that extends DigitalBusiness
 * and adds API-specific OKRs: APICalls, Latency, ErrorRate
 *
 * Developer platform metrics for API-based businesses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { API } from '../API'
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
function createMockDOId(name: string = 'test-api-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-api-id'): DurableObjectState {
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
// TESTS: API DO CLASS
// ============================================================================

describe('API DO', () => {
  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('inheritance hierarchy', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('API extends DigitalBusiness', () => {
      expect(apiInstance).toBeInstanceOf(DigitalBusiness)
    })

    it('API has $type of "API"', () => {
      expect(API.$type).toBe('API')
    })
  })

  describe('inherited OKRs from DigitalBusiness', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('API has okrs property', () => {
      expect(apiInstance).toHaveProperty('okrs')
    })

    it('API inherits Revenue OKR from Business', () => {
      expect(apiInstance.okrs.Revenue).toBeDefined()
      expect(apiInstance.okrs.Revenue.objective).toBeDefined()
    })

    it('API inherits Costs OKR from Business', () => {
      expect(apiInstance.okrs.Costs).toBeDefined()
      expect(apiInstance.okrs.Costs.objective).toBeDefined()
    })

    it('API inherits Profit OKR from Business', () => {
      expect(apiInstance.okrs.Profit).toBeDefined()
      expect(apiInstance.okrs.Profit.objective).toBeDefined()
    })

    it('API inherits Traffic OKR from DigitalBusiness', () => {
      expect(apiInstance.okrs.Traffic).toBeDefined()
      expect(apiInstance.okrs.Traffic.objective).toBeDefined()
    })

    it('API inherits Conversion OKR from DigitalBusiness', () => {
      expect(apiInstance.okrs.Conversion).toBeDefined()
      expect(apiInstance.okrs.Conversion.objective).toBeDefined()
    })

    it('API inherits Engagement OKR from DigitalBusiness', () => {
      expect(apiInstance.okrs.Engagement).toBeDefined()
      expect(apiInstance.okrs.Engagement.objective).toBeDefined()
    })
  })

  describe('API-specific OKRs', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('API has APICalls OKR', () => {
      expect(apiInstance.okrs.APICalls).toBeDefined()
      expect(apiInstance.okrs.APICalls.objective).toBeDefined()
      expect(apiInstance.okrs.APICalls.keyResults.length).toBeGreaterThan(0)
    })

    it('APICalls OKR has appropriate key results', () => {
      const apiCallsOKR = apiInstance.okrs.APICalls
      const keyResultNames = apiCallsOKR.keyResults.map((kr) => kr.name)
      // Should have key results tracking API call volume
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('API has Latency OKR', () => {
      expect(apiInstance.okrs.Latency).toBeDefined()
      expect(apiInstance.okrs.Latency.objective).toBeDefined()
      expect(apiInstance.okrs.Latency.keyResults.length).toBeGreaterThan(0)
    })

    it('Latency OKR tracks response times', () => {
      const latencyOKR = apiInstance.okrs.Latency
      const keyResultNames = latencyOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })

    it('API has ErrorRate OKR', () => {
      expect(apiInstance.okrs.ErrorRate).toBeDefined()
      expect(apiInstance.okrs.ErrorRate.objective).toBeDefined()
      expect(apiInstance.okrs.ErrorRate.keyResults.length).toBeGreaterThan(0)
    })

    it('ErrorRate OKR tracks API errors', () => {
      const errorRateOKR = apiInstance.okrs.ErrorRate
      const keyResultNames = errorRateOKR.keyResults.map((kr) => kr.name)
      expect(keyResultNames.length).toBeGreaterThan(0)
    })
  })

  describe('OKR progress tracking', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('all API OKRs have progress() method', () => {
      const apiOKRs = ['APICalls', 'Latency', 'ErrorRate']
      for (const okrName of apiOKRs) {
        expect(typeof apiInstance.okrs[okrName].progress).toBe('function')
      }
    })

    it('all API OKRs have isComplete() method', () => {
      const apiOKRs = ['APICalls', 'Latency', 'ErrorRate']
      for (const okrName of apiOKRs) {
        expect(typeof apiInstance.okrs[okrName].isComplete).toBe('function')
      }
    })

    it('progress starts at 0 by default', () => {
      // All OKRs should have current = 0 by default
      expect(apiInstance.okrs.APICalls.progress()).toBe(0)
    })
  })

  describe('complete OKR set', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('API has all expected OKRs (9 total)', () => {
      // From Business: Revenue, Costs, Profit (3)
      // From DigitalBusiness: Traffic, Conversion, Engagement (3)
      // From API: APICalls, Latency, ErrorRate (3)
      // Total: 9 OKRs
      const expectedOKRs = [
        // Business OKRs
        'Revenue',
        'Costs',
        'Profit',
        // DigitalBusiness OKRs
        'Traffic',
        'Conversion',
        'Engagement',
        // API OKRs
        'APICalls',
        'Latency',
        'ErrorRate',
      ]

      for (const okrName of expectedOKRs) {
        expect(apiInstance.okrs[okrName]).toBeDefined()
      }
    })

    it('API OKRs count matches expected', () => {
      // 3 from Business + 3 from DigitalBusiness + 3 from API = 9
      expect(Object.keys(apiInstance.okrs).length).toBe(9)
    })
  })

  describe('developer platform metrics', () => {
    let mockState: DurableObjectState
    let mockEnv: Env
    let apiInstance: API

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
      apiInstance = new API(mockState, mockEnv)
    })

    it('APICalls OKR tracks total and daily API calls', () => {
      const apiCallsOKR = apiInstance.okrs.APICalls
      const keyResultNames = apiCallsOKR.keyResults.map((kr) => kr.name)

      // Should track various API call metrics
      expect(keyResultNames.some(name =>
        name.toLowerCase().includes('call') ||
        name.toLowerCase().includes('request')
      )).toBe(true)
    })

    it('Latency OKR tracks p50/p95/p99 latencies', () => {
      const latencyOKR = apiInstance.okrs.Latency
      const keyResultNames = latencyOKR.keyResults.map((kr) => kr.name)

      // Should track various percentile latencies
      expect(keyResultNames.some(name =>
        name.toLowerCase().includes('latency') ||
        name.toLowerCase().includes('p50') ||
        name.toLowerCase().includes('p95') ||
        name.toLowerCase().includes('p99') ||
        name.includes('Avg')
      )).toBe(true)
    })

    it('ErrorRate OKR tracks error percentages', () => {
      const errorRateOKR = apiInstance.okrs.ErrorRate
      const keyResultNames = errorRateOKR.keyResults.map((kr) => kr.name)

      // Should track error rates
      expect(keyResultNames.some(name =>
        name.toLowerCase().includes('error') ||
        name.toLowerCase().includes('rate') ||
        name.toLowerCase().includes('4xx') ||
        name.toLowerCase().includes('5xx')
      )).toBe(true)
    })
  })

  describe('user subclass pattern', () => {
    let mockState: DurableObjectState
    let mockEnv: Env

    beforeEach(() => {
      mockState = createMockState()
      mockEnv = createMockEnv()
    })

    it('user can extend API and inherit all OKRs', () => {
      class MyAPI extends API {}

      const myApi = new MyAPI(mockState, mockEnv)

      // Should have all inherited OKRs
      expect(myApi.okrs.Revenue).toBeDefined()
      expect(myApi.okrs.Traffic).toBeDefined()
      expect(myApi.okrs.APICalls).toBeDefined()
      expect(myApi.okrs.Latency).toBeDefined()
      expect(myApi.okrs.ErrorRate).toBeDefined()
    })

    it('user can extend API and add custom OKRs via constructor', () => {
      class MyAPI extends API {
        constructor(ctx: DurableObjectState, env: Env) {
          super(ctx, env)
          // Add custom OKR after construction
          this.okrs.CustomMetric = this.defineOKR({
            objective: 'Track custom metric',
            keyResults: [{ name: 'Value', target: 100, current: 0 }],
          })
        }
      }

      const myApi = new MyAPI(mockState, mockEnv)

      // Should have all inherited OKRs plus custom
      expect(myApi.okrs.Revenue).toBeDefined()
      expect(myApi.okrs.APICalls).toBeDefined()
      expect(myApi.okrs.CustomMetric).toBeDefined()
      expect(Object.keys(myApi.okrs).length).toBe(10) // 9 + 1 custom
    })
  })
})
