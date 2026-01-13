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

  // ==========================================================================
  // TESTS: AGENT COMPOSITION (priya/ralph integration)
  // ==========================================================================

  describe('Agent Composition', () => {
    it('Startup has agents property', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup).toHaveProperty('agents')
      expect(typeof startup.agents).toBe('object')
    })

    it('has priya agent (product manager)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.agents.priya).toBeDefined()
      expect(startup.agents.priya.role).toBe('product')
    })

    it('has ralph agent (engineer)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.agents.ralph).toBeDefined()
      expect(startup.agents.ralph.role).toBe('engineering')
    })

    it('has tom agent (tech lead)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.agents.tom).toBeDefined()
      expect(startup.agents.tom.role).toBe('tech-lead')
    })

    it('has mark agent (marketing)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.agents.mark).toBeDefined()
      expect(startup.agents.mark.role).toBe('marketing')
    })

    it('has sally agent (sales)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.agents.sally).toBeDefined()
      expect(startup.agents.sally.role).toBe('sales')
    })

    it('agents are callable as template literals', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      // Agents should be callable functions (template literal syntax)
      expect(typeof startup.agents.priya).toBe('function')
      expect(typeof startup.agents.ralph).toBe('function')
    })

    it('subclass can add custom agents', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {
        initTeam() {
          this.addAgent('quinn', 'qa')
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)
      myStartup.initTeam()

      expect(myStartup.agents.quinn).toBeDefined()
      expect(myStartup.agents.quinn.role).toBe('qa')
    })
  })

  // ==========================================================================
  // TESTS: WORKFLOW ORCHESTRATION
  // ==========================================================================

  describe('Workflow Orchestration', () => {
    it('Startup has launch() method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.launch).toBe('function')
    })

    it('launch() returns a Promise', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const result = startup.launch()
      expect(result).toBeInstanceOf(Promise)
    })

    it('Startup has setHypothesis() method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.setHypothesis).toBe('function')
    })

    it('can set hypothesis for launch', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setHypothesis('AI-powered code generation will make developers 10x more productive')

      expect(startup.hypothesis).toBe('AI-powered code generation will make developers 10x more productive')
    })

    it('launch() uses priya to define spec', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test hypothesis')

      // Mock priya's response
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec: feature A, feature B')

      const result = await startup.launch()

      // Launch should have called priya to create spec
      expect(result.spec).toBeDefined()
    })

    it('launch() uses ralph to build from spec', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test hypothesis')

      // Mock agents
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(async () => 'app code')

      const result = await startup.launch()

      expect(result.app).toBeDefined()
    })

    it('launch() uses tom for code review', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test hypothesis')

      // Mock agents with tom approving
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(async () => 'app')
      const tomApprove = vi.fn().mockResolvedValue({ approved: true })
      startup.agents.tom.approve = tomApprove

      await startup.launch()

      expect(tomApprove).toHaveBeenCalled()
    })

    it('launch() iterates until tom approves', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test hypothesis')

      // Mock agents with tom rejecting once then approving
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      const ralphMock = vi.fn()
        .mockResolvedValueOnce('app v1')
        .mockResolvedValueOnce('app v2')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(ralphMock)

      let callCount = 0
      startup.agents.tom.approve = vi.fn().mockImplementation(async () => {
        callCount++
        return { approved: callCount >= 2 }
      })

      await startup.launch()

      expect(ralphMock).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // TESTS: STATE PERSISTENCE
  // ==========================================================================

  describe('State Persistence', () => {
    it('persists hypothesis to storage', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setHypothesis('Test hypothesis')

      // Should be persisted to storage
      const stored = await mockState.storage.get('startup:hypothesis')
      expect(stored).toBe('Test hypothesis')
    })

    it('loads hypothesis from storage on init', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      // Pre-populate storage
      await mockState.storage.put('startup:hypothesis', 'Loaded hypothesis')

      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.loadState()

      expect(startup.hypothesis).toBe('Loaded hypothesis')
    })

    it('persists launch state (launched: boolean)', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(startup.launched).toBe(false)

      // Mock successful launch
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(async () => 'app')
      startup.agents.tom.approve = vi.fn().mockResolvedValue({ approved: true })
      vi.spyOn(startup.agents.mark, 'apply').mockImplementation(async () => 'announcement')
      vi.spyOn(startup.agents.sally, 'apply').mockImplementation(async () => 'sales started')

      await startup.setHypothesis('Test')
      await startup.launch()

      expect(startup.launched).toBe(true)
      const stored = await mockState.storage.get('startup:launched')
      expect(stored).toBe(true)
    })

    it('persists team configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.addAgent('quinn', 'qa')

      const stored = await mockState.storage.get('startup:team')
      expect(stored).toContain('quinn')
    })

    it('persists spec after priya generates it', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test')

      // Mock agents
      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'Generated spec: feature list')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(async () => 'app')
      startup.agents.tom.approve = vi.fn().mockResolvedValue({ approved: true })
      vi.spyOn(startup.agents.mark, 'apply').mockImplementation(async () => 'announcement')
      vi.spyOn(startup.agents.sally, 'apply').mockImplementation(async () => 'sales')

      await startup.launch()

      const stored = await mockState.storage.get('startup:spec')
      expect(stored).toContain('Generated spec')
    })
  })

  // ==========================================================================
  // TESTS: ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws if launch() called without hypothesis', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await expect(startup.launch()).rejects.toThrow('hypothesis')
    })

    it('throws if agent not found when adding invalid role', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await expect(startup.addAgent('invalid', 'invalid-role' as any)).rejects.toThrow('role')
    })

    it('handles priya failure gracefully', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test')

      // Mock priya to throw
      vi.spyOn(startup.agents.priya, 'apply').mockRejectedValue(new Error('AI unavailable'))

      await expect(startup.launch()).rejects.toThrow('AI unavailable')
    })

    it('handles ralph build failure', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test')

      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      vi.spyOn(startup.agents.ralph, 'apply').mockRejectedValue(new Error('Build failed'))

      await expect(startup.launch()).rejects.toThrow('Build failed')
    })

    it('limits review iterations to maxReviewIterations', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      startup.maxReviewIterations = 3
      await startup.setHypothesis('Test')

      vi.spyOn(startup.agents.priya, 'apply').mockImplementation(async () => 'spec')
      vi.spyOn(startup.agents.ralph, 'apply').mockImplementation(async () => 'app')

      // Tom never approves
      startup.agents.tom.approve = vi.fn().mockResolvedValue({ approved: false, feedback: 'needs work' })

      await expect(startup.launch()).rejects.toThrow(/iteration|limit|review/i)
    })

    it('emits error event on failure', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)
      await startup.setHypothesis('Test')

      vi.spyOn(startup.agents.priya, 'apply').mockRejectedValue(new Error('AI unavailable'))

      const errorHandler = vi.fn()
      startup.on('launch:error', errorHandler)

      try {
        await startup.launch()
      } catch {
        // expected
      }

      expect(errorHandler).toHaveBeenCalled()
    })
  })
})
