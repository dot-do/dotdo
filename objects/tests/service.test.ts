/**
 * Service - AI-delivered Services-as-Software DO subclass (TDD RED Phase)
 *
 * These tests define the expected API for the Service class, which extends
 * Business for AI-delivered Services-as-Software businesses.
 *
 * Vision: `class MyAgency extends Service` - a service container that:
 * - Extends Business with service-specific lifecycle
 * - AI agents deliver the service
 * - Humans escalate when needed
 * - Service-specific OKRs for tracking performance
 *
 * Service-specific OKRs:
 * - TasksCompleted - Work items delivered
 * - QualityScore - Output quality (human or AI-rated)
 * - ResponseTime - Time to first action
 * - DeliveryTime - Time to completion
 * - CustomerSatisfaction - Service CSAT
 * - HumanEscalationRate - % requiring human intervention
 * - CostPerTask - Efficiency metric
 * - CapacityUtilization - Agent workload
 *
 * All tests should FAIL initially as we're defining the API, not implementing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// MOCK INFRASTRUCTURE (Reused from Startup.test.ts patterns)
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
function createMockDOId(name: string = 'test-service-id'): DurableObjectId {
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
function createMockState(idName: string = 'test-service-id'): DurableObjectState {
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
// TYPE DECLARATIONS FOR EXPECTED SERVICE API
// ============================================================================

/**
 * Service configuration
 */
interface ServiceConfig {
  name: string
  slug: string
  description?: string
  plan?: 'free' | 'pro' | 'enterprise'
  settings?: Record<string, unknown>
  pricingModel?: PricingModel
}

/**
 * Pricing model for the service
 */
interface PricingModel {
  type: 'per-task' | 'subscription' | 'usage-based' | 'hybrid'
  basePrice?: number
  pricePerTask?: number
  currency?: string
  tiers?: PricingTier[]
}

/**
 * Pricing tier for tiered pricing
 */
interface PricingTier {
  name: string
  minTasks?: number
  maxTasks?: number
  pricePerTask: number
}

/**
 * Task definition for service work
 */
interface ServiceTask {
  taskId: string
  type: string
  description: string
  input: Record<string, unknown>
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  deadline?: Date
  metadata?: Record<string, unknown>
}

/**
 * Task result after completion
 */
interface TaskResult {
  taskId: string
  status: 'completed' | 'failed' | 'escalated'
  output?: Record<string, unknown>
  qualityScore?: number
  responseTimeMs?: number
  deliveryTimeMs?: number
  cost?: number
  escalatedTo?: string
  completedAt: Date
}

/**
 * Agent assignment for task execution
 */
interface AgentAssignment {
  agentId: string
  name: string
  role: 'primary' | 'backup' | 'specialist'
  capabilities?: string[]
  currentLoad?: number
  maxLoad?: number
}

/**
 * Service metrics snapshot
 */
interface ServiceMetrics {
  tasksCompleted: number
  tasksFailed: number
  tasksEscalated: number
  averageQualityScore: number
  averageResponseTimeMs: number
  averageDeliveryTimeMs: number
  humanEscalationRate: number
  averageCostPerTask: number
  capacityUtilization: number
  totalRevenue: number
}

/**
 * Escalation configuration
 */
interface ServiceEscalationConfig {
  qualityThreshold?: number // Escalate if quality below this
  maxRetries?: number
  escalationTargets: Array<{
    target: string
    priority: 'low' | 'normal' | 'high' | 'urgent'
  }>
}

// ============================================================================
// TESTS: CLASS STRUCTURE AND INHERITANCE
// ============================================================================

describe('Service Class', () => {
  describe('Class Structure and Inheritance', () => {
    it('exports Service class from objects/Service.ts', async () => {
      // This test will fail because Service.ts doesn't exist yet
      const { Service } = await import('../Service')
      expect(Service).toBeDefined()
      expect(typeof Service).toBe('function')
    })

    it('extends Business class', async () => {
      const { Service } = await import('../Service')
      const { Business } = await import('../Business')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const service = new Service(mockState, mockEnv)
      expect(service).toBeInstanceOf(Business)
    })

    it('has static $type property set to "Service"', async () => {
      const { Service } = await import('../Service')

      expect(Service.$type).toBe('Service')
    })

    it('inherits from Business which inherits from DO', async () => {
      const { Service } = await import('../Service')
      const { DO } = await import('../DO')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const service = new Service(mockState, mockEnv)
      expect(service).toBeInstanceOf(DO)
    })

    it('has $ workflow context from DO base class', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const service = new Service(mockState, mockEnv)
      expect(service.$).toBeDefined()
      expect(typeof service.$).toBe('object')
    })
  })

  // ==========================================================================
  // TESTS: SERVICE-SPECIFIC OKRs
  // ==========================================================================

  describe('Service-Specific OKRs', () => {
    it('has okrs property with service-specific OKRs', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs).toBeDefined()
      expect(typeof service.okrs).toBe('object')
    })

    it('has TasksCompleted OKR for work items delivered', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.TasksCompleted).toBeDefined()
      expect(service.okrs.TasksCompleted.objective).toContain('task')
    })

    it('has QualityScore OKR for output quality', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.QualityScore).toBeDefined()
      expect(service.okrs.QualityScore.objective).toContain('quality')
    })

    it('has ResponseTime OKR for time to first action', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.ResponseTime).toBeDefined()
      expect(service.okrs.ResponseTime.objective).toContain('response')
    })

    it('has DeliveryTime OKR for time to completion', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.DeliveryTime).toBeDefined()
      expect(service.okrs.DeliveryTime.objective).toContain('delivery')
    })

    it('has CustomerSatisfaction OKR for service CSAT', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.CustomerSatisfaction).toBeDefined()
      expect(service.okrs.CustomerSatisfaction.objective).toContain('satisfaction')
    })

    it('has HumanEscalationRate OKR for escalation tracking', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.HumanEscalationRate).toBeDefined()
      expect(service.okrs.HumanEscalationRate.objective).toContain('escalation')
    })

    it('has CostPerTask OKR for efficiency tracking', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.CostPerTask).toBeDefined()
      expect(service.okrs.CostPerTask.objective).toContain('cost')
    })

    it('has CapacityUtilization OKR for agent workload', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(service.okrs.CapacityUtilization).toBeDefined()
      expect(service.okrs.CapacityUtilization.objective).toContain('capacity')
    })

    it('all OKRs have progress() and isComplete() methods', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      for (const okrName of Object.keys(service.okrs)) {
        const okr = service.okrs[okrName]
        expect(typeof okr.progress).toBe('function')
        expect(typeof okr.isComplete).toBe('function')
      }
    })
  })

  // ==========================================================================
  // TESTS: TASK MANAGEMENT
  // ==========================================================================

  describe('Task Management', () => {
    it('has submitTask method', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(typeof service.submitTask).toBe('function')
    })

    it('submitTask accepts task configuration and returns taskId', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const task: ServiceTask = {
        taskId: 'task-123',
        type: 'content-generation',
        description: 'Generate blog post about AI',
        input: { topic: 'AI in healthcare' },
        priority: 'normal',
      }

      const result = await service.submitTask(task)
      expect(result).toBeDefined()
      expect(result.taskId).toBe('task-123')
    })

    it('getTask returns task by id', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'task-456',
        type: 'data-analysis',
        description: 'Analyze sales data',
        input: { dataSource: 'sales-2024' },
      })

      const task = await service.getTask('task-456')
      expect(task).toBeDefined()
      expect(task?.taskId).toBe('task-456')
      expect(task?.type).toBe('data-analysis')
    })

    it('listTasks returns all submitted tasks', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'task-1',
        type: 'type-a',
        description: 'Task A',
        input: {},
      })

      await service.submitTask({
        taskId: 'task-2',
        type: 'type-b',
        description: 'Task B',
        input: {},
      })

      const tasks = await service.listTasks()
      expect(tasks).toHaveLength(2)
    })

    it('listTasks supports filtering by status', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'task-pending',
        type: 'work',
        description: 'Pending task',
        input: {},
      })

      const pendingTasks = await service.listTasks({ status: 'pending' })
      expect(pendingTasks.length).toBeGreaterThan(0)
      expect(pendingTasks.every((t) => t.status === 'pending')).toBe(true)
    })

    it('completeTask records task result', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'task-to-complete',
        type: 'work',
        description: 'Task to complete',
        input: {},
      })

      const result = await service.completeTask('task-to-complete', {
        status: 'completed',
        output: { result: 'success' },
        qualityScore: 0.95,
      })

      expect(result.status).toBe('completed')
      expect(result.qualityScore).toBe(0.95)
    })

    it('emits task.submitted event when task is submitted', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const emitSpy = vi.spyOn(service, 'emit')

      await service.submitTask({
        taskId: 'new-task',
        type: 'work',
        description: 'New task',
        input: {},
      })

      expect(emitSpy).toHaveBeenCalledWith(
        'task.submitted',
        expect.objectContaining({
          taskId: 'new-task',
        })
      )
    })

    it('emits task.completed event when task is completed', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'complete-task',
        type: 'work',
        description: 'Task to complete',
        input: {},
      })

      const emitSpy = vi.spyOn(service, 'emit')

      await service.completeTask('complete-task', {
        status: 'completed',
        output: {},
      })

      expect(emitSpy).toHaveBeenCalledWith(
        'task.completed',
        expect.objectContaining({
          taskId: 'complete-task',
        })
      )
    })
  })

  // ==========================================================================
  // TESTS: AGENT ASSIGNMENT
  // ==========================================================================

  describe('Agent Assignment', () => {
    it('has assignAgent method', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(typeof service.assignAgent).toBe('function')
    })

    it('assignAgent adds agent to service', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'agent-1',
        name: 'Content Writer',
        role: 'primary',
        capabilities: ['writing', 'editing'],
        maxLoad: 10,
      })

      const agents = await service.getAssignedAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].agentId).toBe('agent-1')
    })

    it('getAssignedAgents returns all assigned agents', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'agent-1',
        name: 'Primary Agent',
        role: 'primary',
      })

      await service.assignAgent({
        agentId: 'agent-2',
        name: 'Backup Agent',
        role: 'backup',
      })

      const agents = await service.getAssignedAgents()
      expect(agents).toHaveLength(2)
    })

    it('unassignAgent removes agent from service', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'agent-to-remove',
        name: 'Temp Agent',
        role: 'specialist',
      })

      await service.unassignAgent('agent-to-remove')

      const agents = await service.getAssignedAgents()
      expect(agents).toHaveLength(0)
    })

    it('getAvailableAgent returns agent with lowest load', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'busy-agent',
        name: 'Busy Agent',
        role: 'primary',
        currentLoad: 8,
        maxLoad: 10,
      })

      await service.assignAgent({
        agentId: 'free-agent',
        name: 'Free Agent',
        role: 'backup',
        currentLoad: 2,
        maxLoad: 10,
      })

      const available = await service.getAvailableAgent()
      expect(available?.agentId).toBe('free-agent')
    })

    it('updateAgentLoad updates agent workload', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'load-agent',
        name: 'Load Agent',
        role: 'primary',
        currentLoad: 5,
        maxLoad: 10,
      })

      await service.updateAgentLoad('load-agent', 7)

      const agents = await service.getAssignedAgents()
      const agent = agents.find((a) => a.agentId === 'load-agent')
      expect(agent?.currentLoad).toBe(7)
    })
  })

  // ==========================================================================
  // TESTS: HUMAN ESCALATION
  // ==========================================================================

  describe('Human Escalation', () => {
    it('has setEscalationConfig method', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(typeof service.setEscalationConfig).toBe('function')
    })

    it('setEscalationConfig configures escalation rules', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const config: ServiceEscalationConfig = {
        qualityThreshold: 0.7,
        maxRetries: 3,
        escalationTargets: [{ target: 'human-reviewer', priority: 'high' }],
      }

      await expect(service.setEscalationConfig(config)).resolves.not.toThrow()
    })

    it('escalateTask escalates task to human', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setEscalationConfig({
        escalationTargets: [{ target: 'human-reviewer', priority: 'normal' }],
      })

      await service.submitTask({
        taskId: 'task-to-escalate',
        type: 'complex-work',
        description: 'Complex task requiring human review',
        input: {},
      })

      const result = await service.escalateTask('task-to-escalate', {
        reason: 'AI confidence too low',
      })

      expect(result.escalatedTo).toBeDefined()
      expect(result.status).toBe('escalated')
    })

    it('emits task.escalated event when task is escalated', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setEscalationConfig({
        escalationTargets: [{ target: 'human', priority: 'normal' }],
      })

      await service.submitTask({
        taskId: 'escalate-event-task',
        type: 'work',
        description: 'Task for escalation event test',
        input: {},
      })

      const emitSpy = vi.spyOn(service, 'emit')

      await service.escalateTask('escalate-event-task', {
        reason: 'Test escalation',
      })

      expect(emitSpy).toHaveBeenCalledWith(
        'task.escalated',
        expect.objectContaining({
          taskId: 'escalate-event-task',
        })
      )
    })

    it('tracks escalation rate in metrics', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setEscalationConfig({
        escalationTargets: [{ target: 'human', priority: 'normal' }],
      })

      // Submit and complete some tasks
      for (let i = 0; i < 10; i++) {
        await service.submitTask({
          taskId: `task-${i}`,
          type: 'work',
          description: `Task ${i}`,
          input: {},
        })
      }

      // Complete 8 normally
      for (let i = 0; i < 8; i++) {
        await service.completeTask(`task-${i}`, { status: 'completed', output: {} })
      }

      // Escalate 2
      for (let i = 8; i < 10; i++) {
        await service.escalateTask(`task-${i}`, { reason: 'Test' })
      }

      const metrics = await service.getServiceMetrics()
      expect(metrics.humanEscalationRate).toBeCloseTo(0.2, 1) // 20% escalation rate
    })
  })

  // ==========================================================================
  // TESTS: PRICING MODEL
  // ==========================================================================

  describe('Pricing Model', () => {
    it('has setPricingModel method', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(typeof service.setPricingModel).toBe('function')
    })

    it('setPricingModel accepts per-task pricing', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const pricing: PricingModel = {
        type: 'per-task',
        pricePerTask: 5.0,
        currency: 'USD',
      }

      await expect(service.setPricingModel(pricing)).resolves.not.toThrow()
    })

    it('setPricingModel accepts subscription pricing', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const pricing: PricingModel = {
        type: 'subscription',
        basePrice: 99.0,
        currency: 'USD',
      }

      await expect(service.setPricingModel(pricing)).resolves.not.toThrow()
    })

    it('setPricingModel accepts tiered pricing', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const pricing: PricingModel = {
        type: 'usage-based',
        tiers: [
          { name: 'starter', minTasks: 0, maxTasks: 100, pricePerTask: 2.0 },
          { name: 'growth', minTasks: 101, maxTasks: 500, pricePerTask: 1.5 },
          { name: 'scale', minTasks: 501, pricePerTask: 1.0 },
        ],
        currency: 'USD',
      }

      await expect(service.setPricingModel(pricing)).resolves.not.toThrow()
    })

    it('getPricingModel returns configured pricing', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setPricingModel({
        type: 'per-task',
        pricePerTask: 10.0,
        currency: 'EUR',
      })

      const pricing = await service.getPricingModel()
      expect(pricing?.type).toBe('per-task')
      expect(pricing?.pricePerTask).toBe(10.0)
      expect(pricing?.currency).toBe('EUR')
    })

    it('calculateTaskCost returns cost for a task', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setPricingModel({
        type: 'per-task',
        pricePerTask: 5.0,
      })

      const cost = await service.calculateTaskCost('task-123')
      expect(cost).toBe(5.0)
    })
  })

  // ==========================================================================
  // TESTS: SERVICE METRICS
  // ==========================================================================

  describe('Service Metrics', () => {
    it('has getServiceMetrics method', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      expect(typeof service.getServiceMetrics).toBe('function')
    })

    it('getServiceMetrics returns comprehensive metrics', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const metrics = await service.getServiceMetrics()

      expect(metrics).toHaveProperty('tasksCompleted')
      expect(metrics).toHaveProperty('tasksFailed')
      expect(metrics).toHaveProperty('tasksEscalated')
      expect(metrics).toHaveProperty('averageQualityScore')
      expect(metrics).toHaveProperty('averageResponseTimeMs')
      expect(metrics).toHaveProperty('averageDeliveryTimeMs')
      expect(metrics).toHaveProperty('humanEscalationRate')
      expect(metrics).toHaveProperty('averageCostPerTask')
      expect(metrics).toHaveProperty('capacityUtilization')
      expect(metrics).toHaveProperty('totalRevenue')
    })

    it('metrics update as tasks are completed', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      // Submit and complete a task
      await service.submitTask({
        taskId: 'metrics-task',
        type: 'work',
        description: 'Task for metrics test',
        input: {},
      })

      await service.completeTask('metrics-task', {
        status: 'completed',
        output: {},
        qualityScore: 0.9,
        responseTimeMs: 100,
        deliveryTimeMs: 5000,
      })

      const metrics = await service.getServiceMetrics()
      expect(metrics.tasksCompleted).toBe(1)
      expect(metrics.averageQualityScore).toBe(0.9)
    })

    it('recordQualityRating records human rating for task', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'rated-task',
        type: 'work',
        description: 'Task to be rated',
        input: {},
      })

      await service.completeTask('rated-task', {
        status: 'completed',
        output: {},
      })

      await service.recordQualityRating('rated-task', {
        rating: 4.5,
        ratedBy: 'human-reviewer',
        feedback: 'Good work',
      })

      const task = await service.getTask('rated-task')
      expect(task?.humanRating).toBe(4.5)
    })
  })

  // ==========================================================================
  // TESTS: SERVICE CONFIGURATION
  // ==========================================================================

  describe('Service Configuration', () => {
    it('configure method accepts ServiceConfig', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const config: ServiceConfig = {
        name: 'Content Agency',
        slug: 'content-agency',
        description: 'AI-powered content creation service',
        plan: 'pro',
        pricingModel: {
          type: 'per-task',
          pricePerTask: 10.0,
        },
      }

      await expect(service.configure(config)).resolves.not.toThrow()
    })

    it('getConfig returns service configuration', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.configure({
        name: 'Design Studio',
        slug: 'design-studio',
        description: 'AI design services',
      })

      const config = await service.getConfig()
      expect(config?.name).toBe('Design Studio')
      expect(config?.slug).toBe('design-studio')
    })

    it('emits service.configured event', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const emitSpy = vi.spyOn(service, 'emit')

      await service.configure({
        name: 'New Service',
        slug: 'new-service',
      })

      expect(emitSpy).toHaveBeenCalledWith(
        'service.configured',
        expect.objectContaining({
          name: 'New Service',
        })
      )
    })
  })

  // ==========================================================================
  // TESTS: HTTP ENDPOINTS
  // ==========================================================================

  describe('HTTP Endpoints', () => {
    it('/config endpoint returns service configuration', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.configure({
        name: 'HttpTestService',
        slug: 'http-test',
      })

      const request = new Request('http://test/config')
      const response = await service.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.name).toBe('HttpTestService')
    })

    it('/tasks endpoint returns all tasks', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.submitTask({
        taskId: 'http-task',
        type: 'work',
        description: 'Task for HTTP test',
        input: {},
      })

      const request = new Request('http://test/tasks')
      const response = await service.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(1)
    })

    it('/tasks POST submits a new task', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const request = new Request('http://test/tasks', {
        method: 'POST',
        body: JSON.stringify({
          taskId: 'posted-task',
          type: 'work',
          description: 'Posted task',
          input: {},
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await service.fetch(request)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.taskId).toBe('posted-task')
    })

    it('/agents endpoint returns assigned agents', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.assignAgent({
        agentId: 'http-agent',
        name: 'HTTP Test Agent',
        role: 'primary',
      })

      const request = new Request('http://test/agents')
      const response = await service.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(1)
    })

    it('/metrics endpoint returns service metrics', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      const request = new Request('http://test/metrics')
      const response = await service.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('tasksCompleted')
    })

    it('/pricing endpoint returns pricing model', async () => {
      const { Service } = await import('../Service')

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const service = new Service(mockState, mockEnv)

      await service.setPricingModel({
        type: 'per-task',
        pricePerTask: 25.0,
      })

      const request = new Request('http://test/pricing')
      const response = await service.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pricePerTask).toBe(25.0)
    })
  })

  // ==========================================================================
  // TESTS: SUBCLASS PATTERN
  // ==========================================================================

  describe('Subclass Pattern (class MyAgency extends Service)', () => {
    it('can be extended as class MyAgency extends Service', async () => {
      const { Service } = await import('../Service')

      // Define a subclass like the vision shows
      class ContentAgency extends Service {
        static override readonly $type = 'ContentAgency'

        async generateContent(topic: string): Promise<string> {
          return `Content about ${topic}`
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()

      const agency = new ContentAgency(mockState, mockEnv)

      expect(agency).toBeInstanceOf(Service)
      expect(agency.$type).toBe('ContentAgency')
      expect(await agency.generateContent('AI')).toBe('Content about AI')
    })

    it('subclass inherits task management', async () => {
      const { Service } = await import('../Service')

      class MyAgency extends Service {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const agency = new MyAgency(mockState, mockEnv)

      expect(typeof agency.submitTask).toBe('function')
      expect(typeof agency.completeTask).toBe('function')
      expect(typeof agency.listTasks).toBe('function')
    })

    it('subclass inherits agent assignment', async () => {
      const { Service } = await import('../Service')

      class MyAgency extends Service {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const agency = new MyAgency(mockState, mockEnv)

      expect(typeof agency.assignAgent).toBe('function')
      expect(typeof agency.getAssignedAgents).toBe('function')
      expect(typeof agency.getAvailableAgent).toBe('function')
    })

    it('subclass inherits escalation capabilities', async () => {
      const { Service } = await import('../Service')

      class MyAgency extends Service {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const agency = new MyAgency(mockState, mockEnv)

      expect(typeof agency.setEscalationConfig).toBe('function')
      expect(typeof agency.escalateTask).toBe('function')
    })

    it('subclass inherits pricing model', async () => {
      const { Service } = await import('../Service')

      class MyAgency extends Service {}

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const agency = new MyAgency(mockState, mockEnv)

      expect(typeof agency.setPricingModel).toBe('function')
      expect(typeof agency.getPricingModel).toBe('function')
      expect(typeof agency.calculateTaskCost).toBe('function')
    })

    it('subclass can add custom OKRs', async () => {
      const { Service } = await import('../Service')

      // Define a subclass that adds custom OKRs
      class MyAgency extends Service {
        // Custom OKRs specific to this agency
        customOkrs = {
          ContentQuality: this.defineOKR({
            objective: 'Maintain high content quality',
            keyResults: [
              { name: 'ReadabilityScore', target: 90, current: 85 },
              { name: 'EngagementRate', target: 0.15, current: 0.12 },
            ],
          }),
        }
      }

      const mockState = createMockState()
      const mockEnv = createMockEnv()
      const agency = new MyAgency(mockState, mockEnv)

      // Custom OKRs are defined
      expect(agency.customOkrs.ContentQuality).toBeDefined()
      expect(agency.customOkrs.ContentQuality.objective).toBe('Maintain high content quality')

      // Inherited service OKRs are still available
      expect(agency.okrs.TasksCompleted).toBeDefined()
      expect(agency.okrs.QualityScore).toBeDefined()
    })
  })
})
