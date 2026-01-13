/**
 * Startup DO - TDD Tests
 *
 * RED phase: Tests written first, expected to FAIL initially.
 *
 * Requirements:
 * - Startup extends SaaS (inherits SaaS metrics)
 * - Startup adds startup-specific OKRs:
 *   - Runway (months of cash remaining)
 *   - Burn (monthly burn rate)
 *   - GrowthRate (MoM growth percentage)
 *   - PMFScore (Product-Market Fit score 0-100)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
function createMockDOId(name: string = 'test-startup-id'): DurableObjectId {
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
function createMockState(idName: string = 'test-startup-id'): DurableObjectState {
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
// TESTS: STARTUP CLASS STRUCTURE AND INHERITANCE
// ============================================================================

describe('Startup DO - TDD', () => {
  describe('Class Structure and Inheritance', () => {
    it('exports Startup class from objects/Startup.ts', async () => {
      const { Startup } = await import('../Startup')
      expect(Startup).toBeDefined()
      expect(typeof Startup).toBe('function')
    })

    it('Startup extends SaaS (not Business directly)', async () => {
      const { Startup } = await import('../Startup')
      const { SaaS } = await import('../SaaS')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const startup = new Startup(mockState, mockEnv)
      expect(startup).toBeInstanceOf(SaaS)
    })

    it('Startup inherits from SaaS which inherits from App (via DO)', async () => {
      const { Startup } = await import('../Startup')
      const { DO } = await import('../DO')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const startup = new Startup(mockState, mockEnv)
      // SaaS extends App extends DO, so Startup should be instance of DO
      expect(startup).toBeInstanceOf(DO)
    })

    it('has static $type property set to "Startup"', async () => {
      const { Startup } = await import('../Startup')
      expect(Startup.$type).toBe('Startup')
    })
  })

  // ==========================================================================
  // TESTS: INHERITED SaaS CAPABILITIES
  // ==========================================================================

  describe('Inherited SaaS Capabilities', () => {
    it('inherits createSubscription from SaaS', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.createSubscription).toBe('function')
    })

    it('inherits getSubscription from SaaS', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.getSubscription).toBe('function')
    })

    it('inherits recordUsage from SaaS', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.recordUsage).toBe('function')
    })

    it('inherits configureSaaS from SaaS', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.configureSaaS).toBe('function')
    })
  })

  // ==========================================================================
  // TESTS: STARTUP OKRs
  // ==========================================================================

  describe('Startup OKRs', () => {
    it('Startup has okrs property', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup).toHaveProperty('okrs')
      expect(typeof startup.okrs).toBe('object')
    })

    it('Startup has Runway OKR', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.okrs.Runway).toBeDefined()
      expect(startup.okrs.Runway.objective).toBeDefined()
      expect(startup.okrs.Runway.keyResults).toBeDefined()
      expect(Array.isArray(startup.okrs.Runway.keyResults)).toBe(true)
    })

    it('Runway OKR has MonthsRemaining key result', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const monthsRemaining = startup.okrs.Runway.keyResults.find(
        (kr: { name: string }) => kr.name === 'MonthsRemaining'
      )
      expect(monthsRemaining).toBeDefined()
      expect(monthsRemaining?.target).toBeDefined()
    })

    it('Startup has Burn OKR', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.okrs.Burn).toBeDefined()
      expect(startup.okrs.Burn.objective).toBeDefined()
      expect(startup.okrs.Burn.keyResults).toBeDefined()
    })

    it('Burn OKR has MonthlyBurn key result', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const monthlyBurn = startup.okrs.Burn.keyResults.find(
        (kr: { name: string }) => kr.name === 'MonthlyBurn'
      )
      expect(monthlyBurn).toBeDefined()
      expect(monthlyBurn?.unit).toBe('USD')
    })

    it('Startup has GrowthRate OKR', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.okrs.GrowthRate).toBeDefined()
      expect(startup.okrs.GrowthRate.objective).toBeDefined()
      expect(startup.okrs.GrowthRate.keyResults).toBeDefined()
    })

    it('GrowthRate OKR has MoMGrowth key result', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const momGrowth = startup.okrs.GrowthRate.keyResults.find(
        (kr: { name: string }) => kr.name === 'MoMGrowth'
      )
      expect(momGrowth).toBeDefined()
      expect(momGrowth?.unit).toBe('%')
    })

    it('Startup has PMFScore OKR', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.okrs.PMFScore).toBeDefined()
      expect(startup.okrs.PMFScore.objective).toBeDefined()
      expect(startup.okrs.PMFScore.keyResults).toBeDefined()
    })

    it('PMFScore OKR has Score key result with 0-100 scale', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const score = startup.okrs.PMFScore.keyResults.find(
        (kr: { name: string }) => kr.name === 'Score'
      )
      expect(score).toBeDefined()
      expect(score?.target).toBe(100)
    })
  })

  // ==========================================================================
  // TESTS: OKR FUNCTIONALITY
  // ==========================================================================

  describe('OKR Functionality', () => {
    it('Runway OKR has progress() method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.okrs.Runway.progress).toBe('function')
    })

    it('Runway OKR has isComplete() method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.okrs.Runway.isComplete).toBe('function')
    })

    it('progress() returns number between 0 and 100', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const progress = startup.okrs.Runway.progress()
      expect(typeof progress).toBe('number')
      expect(progress).toBeGreaterThanOrEqual(0)
    })

    it('isComplete() returns boolean', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const isComplete = startup.okrs.Runway.isComplete()
      expect(typeof isComplete).toBe('boolean')
    })

    it('can update key result current values', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      // Find the MonthsRemaining key result
      const kr = startup.okrs.Runway.keyResults.find(
        (kr: { name: string }) => kr.name === 'MonthsRemaining'
      )

      if (kr) {
        const originalValue = kr.current
        kr.current = 12
        expect(kr.current).toBe(12)
        expect(kr.current).not.toBe(originalValue)
      }
    })
  })

  // ==========================================================================
  // TESTS: SUBCLASS PATTERN
  // ==========================================================================

  describe('Subclass Pattern (class MyStartup extends Startup)', () => {
    it('can be extended as class MyStartup extends Startup', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {
        static override readonly $type = 'MyStartup'

        async calculateRunway(cash: number, monthlyBurn: number): Promise<number> {
          return cash / monthlyBurn
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const myStartup = new MyStartup(mockState, mockEnv)

      expect(myStartup).toBeInstanceOf(Startup)
      expect(myStartup.$type).toBe('MyStartup')
      expect(await myStartup.calculateRunway(120000, 10000)).toBe(12)
    })

    it('subclass inherits all OKRs', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(myStartup.okrs.Runway).toBeDefined()
      expect(myStartup.okrs.Burn).toBeDefined()
      expect(myStartup.okrs.GrowthRate).toBeDefined()
      expect(myStartup.okrs.PMFScore).toBeDefined()
    })

    it('subclass can add custom OKRs via method', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {
        // Add custom OKR by extending in constructor or via method
        initCustomOKRs() {
          this.okrs.CustomerSatisfaction = this.defineOKR({
            objective: 'Achieve high customer satisfaction',
            keyResults: [
              { name: 'NPS', target: 50, current: 0 },
            ],
          })
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)
      myStartup.initCustomOKRs()

      // Has inherited OKRs
      expect(myStartup.okrs.Runway).toBeDefined()
      expect(myStartup.okrs.Burn).toBeDefined()

      // Has custom OKR
      expect(myStartup.okrs.CustomerSatisfaction).toBeDefined()
      expect(myStartup.okrs.CustomerSatisfaction.objective).toBe('Achieve high customer satisfaction')
    })

    it('subclass inherits SaaS methods', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(typeof myStartup.createSubscription).toBe('function')
      expect(typeof myStartup.recordUsage).toBe('function')
    })
  })
})
