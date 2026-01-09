/**
 * Startup - Core business container primitive (TDD RED Phase)
 *
 * These tests define the expected API for the Startup class, which is
 * the primary business container for autonomous businesses in dotdo.
 *
 * Vision: `class AcmeTax extends Startup` - a business container that:
 * - Extends Business with startup-specific lifecycle
 * - Binds Services and Agents
 * - Defines escalation policies
 * - Integrates with Foundation Sprint hooks
 *
 * All tests should FAIL initially as we're defining the API, not implementing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MOCK INFRASTRUCTURE (Reused from do-base.test.ts patterns)
// ============================================================================

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]) {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
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
// TYPE DECLARATIONS FOR EXPECTED STARTUP API
// ============================================================================

/**
 * Service binding configuration
 */
interface ServiceBinding {
  serviceId: string
  name: string
  description?: string
  config?: Record<string, unknown>
}

/**
 * Agent binding configuration
 */
interface AgentBinding {
  agentId: string
  name: string
  role: 'primary' | 'backup' | 'specialist'
  capabilities?: string[]
  mode?: 'autonomous' | 'supervised' | 'manual'
}

/**
 * Escalation rule for sensitive decisions
 */
interface EscalationRule {
  trigger: string
  condition?: (context: Record<string, unknown>) => boolean
  escalateTo: 'human' | 'manager' | string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  timeout?: number
}

/**
 * Escalation policy for the startup
 */
interface StartupEscalationPolicy {
  rules: EscalationRule[]
  defaultEscalation?: string
  auditLog?: boolean
}

/**
 * Foundation Sprint hypothesis
 */
interface FoundingHypothesis {
  customer: string
  problem: string
  solution: string
  differentiation: string
  metrics?: HunchMetrics
}

/**
 * HUNCH metrics for PMF measurement
 */
interface HunchMetrics {
  hairOnFire?: number // 0-10 scale
  usage?: number // DAU/MAU ratio
  nps?: number // -100 to 100
  churn?: number // monthly churn rate
  ltvCac?: number // LTV/CAC ratio
}

/**
 * Foundation Sprint phase
 */
type FoundationSprintPhase = 'ideation' | 'validation' | 'mvp' | 'pmf' | 'growth'

/**
 * Startup configuration
 */
interface StartupConfig {
  name: string
  slug: string
  hypothesis?: FoundingHypothesis
  phase?: FoundationSprintPhase
  settings?: Record<string, unknown>
}

/**
 * Startup lifecycle event
 */
interface StartupLifecycleEvent {
  type: string
  phase: FoundationSprintPhase
  timestamp: Date
  data?: Record<string, unknown>
}

// ============================================================================
// TESTS: CLASS STRUCTURE AND INHERITANCE
// ============================================================================

describe('Startup Class', () => {
  describe('Class Structure and Inheritance', () => {
    it('exports Startup class from objects/Startup.ts', async () => {
      // This test will fail because Startup.ts doesn't exist yet
      const { Startup } = await import('../Startup')
      expect(Startup).toBeDefined()
      expect(typeof Startup).toBe('function')
    })

    it('extends Business class', async () => {
      const { Startup } = await import('../Startup')
      const { Business } = await import('../Business')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const startup = new Startup(mockState, mockEnv)
      expect(startup).toBeInstanceOf(Business)
    })

    it('has static $type property set to "Startup"', async () => {
      const { Startup } = await import('../Startup')

      expect(Startup.$type).toBe('Startup')
    })

    it('inherits from Business which inherits from DO', async () => {
      const { Startup } = await import('../Startup')
      const { DO } = await import('../DO')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const startup = new Startup(mockState, mockEnv)
      expect(startup).toBeInstanceOf(DO)
    })

    it('has $ workflow context from DO base class', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const startup = new Startup(mockState, mockEnv)
      expect(startup.$).toBeDefined()
      expect(typeof startup.$).toBe('object')
    })
  })

  // ==========================================================================
  // TESTS: SERVICE BINDING
  // ==========================================================================

  describe('Service Binding', () => {
    it('has bindService method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.bindService).toBe('function')
    })

    it('bindService accepts service configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const binding: ServiceBinding = {
        serviceId: 'tax-filing-service',
        name: 'Tax Filing Service',
        description: 'Automated tax filing for small businesses',
        config: { region: 'US' },
      }

      await expect(startup.bindService(binding)).resolves.not.toThrow()
    })

    it('getServices returns list of bound services', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindService({
        serviceId: 'service-1',
        name: 'Service One',
      })

      await startup.bindService({
        serviceId: 'service-2',
        name: 'Service Two',
      })

      const services = await startup.getServices()
      expect(services).toHaveLength(2)
      expect(services[0].name).toBe('Service One')
      expect(services[1].name).toBe('Service Two')
    })

    it('unbindService removes a service binding', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindService({
        serviceId: 'service-to-remove',
        name: 'Removable Service',
      })

      await startup.unbindService('service-to-remove')

      const services = await startup.getServices()
      expect(services).toHaveLength(0)
    })

    it('emits service.bound event when service is bound', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const emitSpy = vi.spyOn(startup, 'emit')

      await startup.bindService({
        serviceId: 'new-service',
        name: 'New Service',
      })

      expect(emitSpy).toHaveBeenCalledWith('service.bound', expect.objectContaining({
        serviceId: 'new-service',
      }))
    })
  })

  // ==========================================================================
  // TESTS: AGENT BINDING
  // ==========================================================================

  describe('Agent Binding', () => {
    it('has bindAgent method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.bindAgent).toBe('function')
    })

    it('bindAgent accepts agent configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const binding: AgentBinding = {
        agentId: 'support-agent',
        name: 'Customer Support Agent',
        role: 'primary',
        capabilities: ['customer-service', 'refund-processing'],
        mode: 'autonomous',
      }

      await expect(startup.bindAgent(binding)).resolves.not.toThrow()
    })

    it('getAgents returns list of bound agents', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindAgent({
        agentId: 'agent-1',
        name: 'Primary Agent',
        role: 'primary',
      })

      await startup.bindAgent({
        agentId: 'agent-2',
        name: 'Backup Agent',
        role: 'backup',
      })

      const agents = await startup.getAgents()
      expect(agents).toHaveLength(2)
      expect(agents[0].role).toBe('primary')
      expect(agents[1].role).toBe('backup')
    })

    it('unbindAgent removes an agent binding', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindAgent({
        agentId: 'agent-to-remove',
        name: 'Removable Agent',
        role: 'specialist',
      })

      await startup.unbindAgent('agent-to-remove')

      const agents = await startup.getAgents()
      expect(agents).toHaveLength(0)
    })

    it('getPrimaryAgent returns the primary agent', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindAgent({
        agentId: 'backup-agent',
        name: 'Backup',
        role: 'backup',
      })

      await startup.bindAgent({
        agentId: 'primary-agent',
        name: 'Primary',
        role: 'primary',
      })

      const primary = await startup.getPrimaryAgent()
      expect(primary?.agentId).toBe('primary-agent')
      expect(primary?.role).toBe('primary')
    })

    it('emits agent.bound event when agent is bound', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const emitSpy = vi.spyOn(startup, 'emit')

      await startup.bindAgent({
        agentId: 'new-agent',
        name: 'New Agent',
        role: 'primary',
      })

      expect(emitSpy).toHaveBeenCalledWith('agent.bound', expect.objectContaining({
        agentId: 'new-agent',
      }))
    })
  })

  // ==========================================================================
  // TESTS: ESCALATION POLICY
  // ==========================================================================

  describe('Escalation Policy', () => {
    it('has setEscalationPolicy method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.setEscalationPolicy).toBe('function')
    })

    it('setEscalationPolicy accepts policy configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const policy: StartupEscalationPolicy = {
        rules: [
          {
            trigger: 'large-refund',
            condition: (ctx) => (ctx.amount as number) > 1000,
            escalateTo: 'human',
            priority: 'high',
            timeout: 3600,
          },
          {
            trigger: 'audit-risk',
            escalateTo: 'manager',
            priority: 'urgent',
          },
        ],
        defaultEscalation: 'support-team',
        auditLog: true,
      }

      await expect(startup.setEscalationPolicy(policy)).resolves.not.toThrow()
    })

    it('getEscalationPolicy returns configured policy', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setEscalationPolicy({
        rules: [
          {
            trigger: 'test-trigger',
            escalateTo: 'human',
            priority: 'normal',
          },
        ],
      })

      const policy = await startup.getEscalationPolicy()
      expect(policy).not.toBeNull()
      expect(policy?.rules).toHaveLength(1)
      expect(policy?.rules[0].trigger).toBe('test-trigger')
    })

    it('escalate method triggers escalation flow', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setEscalationPolicy({
        rules: [
          {
            trigger: 'large-refund',
            escalateTo: 'human',
            priority: 'high',
          },
        ],
      })

      const result = await startup.escalate('large-refund', { amount: 5000 })

      expect(result).toBeDefined()
      expect(result.escalatedTo).toBe('human')
      expect(result.trigger).toBe('large-refund')
    })

    it('escalate emits escalation.triggered event', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setEscalationPolicy({
        rules: [
          {
            trigger: 'audit-risk',
            escalateTo: 'manager',
            priority: 'urgent',
          },
        ],
      })

      const emitSpy = vi.spyOn(startup, 'emit')

      await startup.escalate('audit-risk', { reason: 'suspicious activity' })

      expect(emitSpy).toHaveBeenCalledWith('escalation.triggered', expect.objectContaining({
        trigger: 'audit-risk',
      }))
    })

    it('shouldEscalate evaluates escalation conditions', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setEscalationPolicy({
        rules: [
          {
            trigger: 'large-refund',
            condition: (ctx) => (ctx.amount as number) > 1000,
            escalateTo: 'human',
            priority: 'high',
          },
        ],
      })

      // Should escalate - amount > 1000
      expect(await startup.shouldEscalate('large-refund', { amount: 5000 })).toBe(true)

      // Should not escalate - amount <= 1000
      expect(await startup.shouldEscalate('large-refund', { amount: 500 })).toBe(false)
    })
  })

  // ==========================================================================
  // TESTS: FOUNDATION SPRINT LIFECYCLE
  // ==========================================================================

  describe('Foundation Sprint Lifecycle', () => {
    it('has setHypothesis method', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.setHypothesis).toBe('function')
    })

    it('setHypothesis accepts founding hypothesis', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const hypothesis: FoundingHypothesis = {
        customer: 'Small business owners',
        problem: 'Tax filing is complex and time-consuming',
        solution: 'AI-powered automated tax filing',
        differentiation: 'First autonomous tax agent with human escalation',
      }

      await expect(startup.setHypothesis(hypothesis)).resolves.not.toThrow()
    })

    it('getHypothesis returns configured hypothesis', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const hypothesis: FoundingHypothesis = {
        customer: 'Freelancers',
        problem: 'Invoice tracking',
        solution: 'Automated invoicing',
        differentiation: 'AI collections agent',
      }

      await startup.setHypothesis(hypothesis)

      const retrieved = await startup.getHypothesis()
      expect(retrieved?.customer).toBe('Freelancers')
      expect(retrieved?.problem).toBe('Invoice tracking')
    })

    it('has setPhase method for Foundation Sprint phases', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.setPhase).toBe('function')
    })

    it('setPhase transitions between phases', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setPhase('ideation')
      expect(await startup.getPhase()).toBe('ideation')

      await startup.setPhase('validation')
      expect(await startup.getPhase()).toBe('validation')

      await startup.setPhase('mvp')
      expect(await startup.getPhase()).toBe('mvp')
    })

    it('emits phase.changed event on phase transition', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const emitSpy = vi.spyOn(startup, 'emit')

      await startup.setPhase('pmf')

      expect(emitSpy).toHaveBeenCalledWith('phase.changed', expect.objectContaining({
        phase: 'pmf',
      }))
    })

    it('recordMetrics stores HUNCH metrics', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const metrics: HunchMetrics = {
        hairOnFire: 8,
        usage: 0.45,
        nps: 72,
        churn: 0.03,
        ltvCac: 4.5,
      }

      await startup.recordMetrics(metrics)

      const retrieved = await startup.getMetrics()
      expect(retrieved?.hairOnFire).toBe(8)
      expect(retrieved?.nps).toBe(72)
    })

    it('getMetricsHistory returns historical metrics', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.recordMetrics({ nps: 50 })
      await startup.recordMetrics({ nps: 60 })
      await startup.recordMetrics({ nps: 70 })

      const history = await startup.getMetricsHistory()
      expect(history.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ==========================================================================
  // TESTS: EVENT HANDLERS ($.on.Noun.verb pattern)
  // ==========================================================================

  describe('Event Handlers ($.on.Noun.verb)', () => {
    it('$.on.Customer.created registers handler', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const handler = vi.fn()

      // Register handler for Customer.created events
      startup.$.on.Customer.created(handler)

      // Handler should be registered without error
      expect(handler).not.toHaveBeenCalled()
    })

    it('$.on.Agent.escalated registers escalation handler', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const handler = vi.fn()

      startup.$.on.Agent.escalated(handler)

      expect(handler).not.toHaveBeenCalled()
    })

    it('$.on.Service.requested registers service handler', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const handler = vi.fn()

      startup.$.on.Service.requested(handler)

      expect(handler).not.toHaveBeenCalled()
    })

    it('$.on.Startup.phaseChanged registers phase handler', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const handler = vi.fn()

      startup.$.on.Startup.phaseChanged(handler)

      expect(handler).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // TESTS: STARTUP CONFIGURATION
  // ==========================================================================

  describe('Startup Configuration', () => {
    it('configure method accepts StartupConfig', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const config: StartupConfig = {
        name: 'AcmeTax',
        slug: 'acme-tax',
        hypothesis: {
          customer: 'SMBs',
          problem: 'Tax complexity',
          solution: 'AI tax agent',
          differentiation: 'Autonomous with escalation',
        },
        phase: 'validation',
        settings: {
          timezone: 'America/Los_Angeles',
          currency: 'USD',
        },
      }

      await expect(startup.configure(config)).resolves.not.toThrow()
    })

    it('getConfig returns startup configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.configure({
        name: 'TestStartup',
        slug: 'test-startup',
        phase: 'ideation',
      })

      const config = await startup.getConfig()
      expect(config?.name).toBe('TestStartup')
      expect(config?.slug).toBe('test-startup')
      expect(config?.phase).toBe('ideation')
    })

    it('emits startup.configured event', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const emitSpy = vi.spyOn(startup, 'emit')

      await startup.configure({
        name: 'NewStartup',
        slug: 'new-startup',
      })

      expect(emitSpy).toHaveBeenCalledWith('startup.configured', expect.objectContaining({
        name: 'NewStartup',
      }))
    })
  })

  // ==========================================================================
  // TESTS: AUTONOMOUS OPERATIONS
  // ==========================================================================

  describe('Autonomous Operations', () => {
    it('run method starts autonomous operation loop', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.run).toBe('function')
    })

    it('pause method pauses autonomous operations', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.pause).toBe('function')
    })

    it('resume method resumes autonomous operations', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      expect(typeof startup.resume).toBe('function')
    })

    it('getStatus returns operational status', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const status = await startup.getStatus()

      expect(status).toHaveProperty('running')
      expect(status).toHaveProperty('phase')
      expect(status).toHaveProperty('agentCount')
      expect(status).toHaveProperty('serviceCount')
    })

    it('dispatchWork assigns work to bound agents', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindAgent({
        agentId: 'work-agent',
        name: 'Work Agent',
        role: 'primary',
      })

      const result = await startup.dispatchWork({
        type: 'customer-inquiry',
        description: 'Handle customer question',
        input: { customerId: '123', question: 'What is my balance?' },
      })

      expect(result).toHaveProperty('assignedTo')
      expect(result).toHaveProperty('workId')
    })
  })

  // ==========================================================================
  // TESTS: HTTP ENDPOINTS
  // ==========================================================================

  describe('HTTP Endpoints', () => {
    it('/config endpoint returns startup configuration', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.configure({
        name: 'HttpTestStartup',
        slug: 'http-test',
      })

      const request = new Request('http://test/config')
      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.name).toBe('HttpTestStartup')
    })

    it('/services endpoint returns bound services', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindService({
        serviceId: 'svc-1',
        name: 'Test Service',
      })

      const request = new Request('http://test/services')
      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(1)
    })

    it('/agents endpoint returns bound agents', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.bindAgent({
        agentId: 'agt-1',
        name: 'Test Agent',
        role: 'primary',
      })

      const request = new Request('http://test/agents')
      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(1)
    })

    it('/status endpoint returns operational status', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      const request = new Request('http://test/status')
      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('running')
    })

    it('/metrics endpoint returns HUNCH metrics', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.recordMetrics({
        nps: 65,
        churn: 0.05,
      })

      const request = new Request('http://test/metrics')
      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.nps).toBe(65)
    })

    it('/escalate POST endpoint triggers escalation', async () => {
      const { Startup } = await import('../Startup')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const startup = new Startup(mockState, mockEnv)

      await startup.setEscalationPolicy({
        rules: [{
          trigger: 'test-escalation',
          escalateTo: 'human',
          priority: 'normal',
        }],
      })

      const request = new Request('http://test/escalate', {
        method: 'POST',
        body: JSON.stringify({
          trigger: 'test-escalation',
          context: { reason: 'Test' },
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await startup.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('escalatedTo')
    })
  })

  // ==========================================================================
  // TESTS: SUBCLASS PATTERN
  // ==========================================================================

  describe('Subclass Pattern (class AcmeTax extends Startup)', () => {
    it('can be extended as class AcmeTax extends Startup', async () => {
      const { Startup } = await import('../Startup')

      // Define a subclass like the vision shows
      class AcmeTax extends Startup {
        static override readonly $type = 'AcmeTax'

        async calculateTax(income: number): Promise<number> {
          return income * 0.25
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const acmeTax = new AcmeTax(mockState, mockEnv)

      expect(acmeTax).toBeInstanceOf(Startup)
      expect(acmeTax.$type).toBe('AcmeTax')
      expect(await acmeTax.calculateTax(1000)).toBe(250)
    })

    it('subclass inherits service binding', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(typeof myStartup.bindService).toBe('function')
      expect(typeof myStartup.getServices).toBe('function')
    })

    it('subclass inherits agent binding', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(typeof myStartup.bindAgent).toBe('function')
      expect(typeof myStartup.getAgents).toBe('function')
    })

    it('subclass inherits escalation policy', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(typeof myStartup.setEscalationPolicy).toBe('function')
      expect(typeof myStartup.escalate).toBe('function')
    })

    it('subclass inherits Foundation Sprint hooks', async () => {
      const { Startup } = await import('../Startup')

      class MyStartup extends Startup {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const myStartup = new MyStartup(mockState, mockEnv)

      expect(typeof myStartup.setHypothesis).toBe('function')
      expect(typeof myStartup.setPhase).toBe('function')
      expect(typeof myStartup.recordMetrics).toBe('function')
    })
  })
})
