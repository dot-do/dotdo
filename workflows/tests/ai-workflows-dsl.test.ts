/**
 * AI Workflows DSL Integration Tests (RED Phase)
 *
 * TDD tests for integrating digital-workers with ai-workflows DSL:
 * - $.notify, $.approve, $.ask, $.decide, $.do
 *
 * These tests verify the integration between the workflow DSL ($) and
 * Worker (Agent/Human) instances for AI-driven workflow orchestration.
 *
 * Test Coverage:
 * 1. Worker Actions Registration: Worker.notify, Worker.ask, Worker.approve, Worker.decide, Worker.do
 * 2. Convenience API: $.notify(), $.ask(), $.approve(), $.decide()
 * 3. Workflow Integration: Durable actions, response awaiting, $.on handlers
 * 4. Transport Bridge: Channel-to-transport mapping, worker address resolution
 *
 * NO MOCKS - uses real workflow context primitives.
 * Tests are RED (failing) - implementation comes in GREEN phase.
 *
 * @see dotdo-2wrru - [RED] AI Workflows DSL Integration - Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerWorkerActions,
  withWorkers,
  createWorkerContext,
  type WorkerTarget,
  type WorkerContextAPI,
  type NotifyResult,
  type AskResult,
  type ApprovalResult,
  type DecisionResult,
  type WorkResult,
} from '../worker-dsl'
import { Domain, registerDomain, clearDomainRegistry, resolveHandler } from '../domain'
import { clearHandlers, getRegisteredHandlers } from '../on'
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal mock WorkflowContext for testing
 */
function createMockContext(): WorkflowContext {
  const state: Record<string, unknown> = {}
  const actions: Array<{ action: string; data: unknown; options?: unknown }> = []

  return {
    track: () => {},
    send: () => 'event-id',
    try: async <T>(action: string, data: unknown) => {
      actions.push({ action, data })
      return { success: true } as T
    },
    do: async <T>(action: string, data: unknown, options?: unknown) => {
      actions.push({ action, data, options })
      return { success: true, durable: true } as T
    },
    on: new Proxy({}, {
      get: () => new Proxy({}, {
        get: () => () => {},
      }),
    }) as WorkflowContext['on'],
    every: {} as WorkflowContext['every'],
    state,
    ai: (() => Promise.resolve('')) as WorkflowContext['ai'],
    write: (() => Promise.resolve({})) as WorkflowContext['write'],
    summarize: (() => Promise.resolve('')) as WorkflowContext['summarize'],
    list: (() => Promise.resolve([])) as WorkflowContext['list'],
    extract: (() => Promise.resolve({ entities: [], raw: '' })) as WorkflowContext['extract'],
    is: (() => Promise.resolve(false)) as WorkflowContext['is'],
    decide: () => (() => Promise.resolve('')) as ReturnType<WorkflowContext['decide']>,
    branch: async () => {},
    checkout: async () => {},
    merge: async () => {},
    log: () => {},
    user: null,
    // Noun accessors
    Customer: () => ({}) as ReturnType<WorkflowContext['Customer']>,
    Invoice: () => ({}) as ReturnType<WorkflowContext['Invoice']>,
    Order: () => ({}) as ReturnType<WorkflowContext['Order']>,
    Payment: () => ({}) as ReturnType<WorkflowContext['Payment']>,
    Startup: () => ({}) as ReturnType<WorkflowContext['Startup']>,
    User: () => ({}) as ReturnType<WorkflowContext['User']>,
  }
}

/**
 * Create a test worker target
 */
function createWorkerTarget(id: string, kind: 'agent' | 'human' = 'agent'): WorkerTarget {
  return {
    id,
    kind,
    name: id,
    channels: [{ type: 'slack', target: `#${id}` }],
  }
}

// ============================================================================
// 1. registerWorkerActions Tests
// ============================================================================

describe('registerWorkerActions', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should register Worker.notify action', () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'notify'])
    expect(handler).toBeDefined()
    expect(typeof handler?.fn).toBe('function')
  })

  it('should register Worker.ask action', () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'ask'])
    expect(handler).toBeDefined()
    expect(typeof handler?.fn).toBe('function')
  })

  it('should register Worker.approve action', () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'approve'])
    expect(handler).toBeDefined()
    expect(typeof handler?.fn).toBe('function')
  })

  it('should register Worker.decide action', () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'decide'])
    expect(handler).toBeDefined()
    expect(typeof handler?.fn).toBe('function')
  })

  it('should register Worker.do action', () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'do'])
    expect(handler).toBeDefined()
    expect(typeof handler?.fn).toBe('function')
  })
})

// ============================================================================
// 2. withWorkers Convenience API Tests
// ============================================================================

describe('withWorkers($)', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should provide $.notify(target, message)', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    expect(typeof worker$.notify).toBe('function')

    const target = createWorkerTarget('warehouse')
    const result = await worker$.notify(target, 'New order received')

    expect(result).toBeDefined()
    expect(result.sent).toBe(true)
  })

  it('should provide $.ask(target, question, schema)', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    expect(typeof worker$.ask).toBe('function')

    const target = createWorkerTarget('analyst')
    const result = await worker$.ask<{ answer: string }>(
      target,
      'What is the quarterly revenue?',
      { type: 'object', properties: { answer: { type: 'string' } } }
    )

    expect(result).toBeDefined()
    expect(result.response).toBeDefined()
  })

  it('should provide $.approve(request, target, options)', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    expect(typeof worker$.approve).toBe('function')

    const target = createWorkerTarget('manager', 'human')
    const result = await worker$.approve(
      'Approve expense report #123',
      target,
      { timeout: '24h' }
    )

    expect(result).toBeDefined()
    expect(typeof result.approved).toBe('boolean')
  })

  it('should provide $.decide(options)', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    expect(typeof worker$.decide).toBe('function')

    const target = createWorkerTarget('router')
    const result = await worker$.decide(
      target,
      'Which department should handle this ticket?',
      ['sales', 'support', 'engineering']
    )

    expect(result).toBeDefined()
    expect(result.choice).toBeDefined()
  })

  it('should provide $.work(target, task) for executing tasks', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    expect(typeof worker$.work).toBe('function')

    const target = createWorkerTarget('shipping')
    const result = await worker$.work(target, {
      type: 'ship-order',
      description: 'Ship order #456',
      input: { orderId: '456' },
    })

    expect(result).toBeDefined()
    expect(result.success).toBeDefined()
  })
})

// ============================================================================
// 3. Workflow Integration Tests
// ============================================================================

describe('Workflow Integration', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should handle Worker.notify as durable action', async () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'notify'])
    expect(handler).toBeDefined()

    const target = createWorkerTarget('warehouse')
    const result = await handler!.fn(
      { target, message: 'Order ready for pickup' },
      {},
      $
    )

    // Should have invoked $.do for durability
    expect(result).toBeDefined()
    expect(result.sent).toBe(true)
  })

  it('should handle Worker.ask with response awaiting', async () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'ask'])
    expect(handler).toBeDefined()

    const target = createWorkerTarget('analyst')
    const result = await handler!.fn(
      {
        target,
        question: 'What is the status?',
        schema: { type: 'object', properties: { status: { type: 'string' } } },
      },
      {},
      $
    )

    expect(result).toBeDefined()
    expect(result.response).toBeDefined()
  })

  it('should handle Worker.approve with approval result', async () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'approve'])
    expect(handler).toBeDefined()

    const target = createWorkerTarget('manager', 'human')
    const result = await handler!.fn(
      {
        target,
        request: 'Approve budget increase',
        options: { timeout: '48h' },
      },
      {},
      $
    )

    expect(result).toBeDefined()
    expect(typeof result.approved).toBe('boolean')
    expect(result.approver).toBeDefined()
  })

  it('should integrate with $.on handlers', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const handlersCalled: string[] = []

    // Simulate event handler integration
    const orderHandler = async (event: { id: string }) => {
      const warehouse = createWorkerTarget('warehouse')
      await worker$.notify(warehouse, `New order: ${event.id}`)
      handlersCalled.push('notify')

      const manager = createWorkerTarget('manager', 'human')
      const approval = await worker$.approve(`Ship order ${event.id}`, manager)
      handlersCalled.push('approve')

      if (approval.approved) {
        const shipping = createWorkerTarget('shipping')
        await worker$.work(shipping, {
          type: 'ship',
          description: `Ship order ${event.id}`,
          input: { orderId: event.id },
        })
        handlersCalled.push('work')
      }
    }

    await orderHandler({ id: 'order-123' })

    expect(handlersCalled).toContain('notify')
    expect(handlersCalled).toContain('approve')
  })

  it('should handle Worker.decide with decision result', async () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'decide'])
    expect(handler).toBeDefined()

    const target = createWorkerTarget('router')
    const result = await handler!.fn(
      {
        target,
        question: 'Route this request',
        options: ['sales', 'support', 'engineering'],
      },
      {},
      $
    )

    expect(result).toBeDefined()
    expect(result.choice).toBeDefined()
    expect(result.reasoning).toBeDefined()
  })

  it('should handle Worker.do with task execution result', async () => {
    const $ = createMockContext()
    registerWorkerActions($)

    const handler = resolveHandler(['Worker', 'do'])
    expect(handler).toBeDefined()

    const target = createWorkerTarget('processor')
    const result = await handler!.fn(
      {
        target,
        task: {
          type: 'process-data',
          description: 'Process the batch',
          input: { batchId: 'batch-001' },
        },
      },
      {},
      $
    )

    expect(result).toBeDefined()
    expect(result.success).toBeDefined()
  })
})

// ============================================================================
// 4. Transport Bridge Tests
// ============================================================================

describe('Transport Bridge', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should map channels to transports', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const target: WorkerTarget = {
      id: 'sales-team',
      kind: 'human',
      name: 'Sales Team',
      channels: [
        { type: 'slack', target: '#sales' },
        { type: 'email', target: 'sales@company.com' },
      ],
    }

    // Should route through configured channels
    const result = await worker$.notify(target, 'New lead assigned')

    expect(result.sent).toBe(true)
    expect(result.channels).toBeDefined()
  })

  it('should resolve worker addresses', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target = createWorkerTarget('analyst')

    // Should resolve worker address from target
    const address = ctx.resolveAddress(target)

    expect(address).toBeDefined()
    expect(address.workerId).toBe('analyst')
  })

  it('should send via configured transports', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target: WorkerTarget = {
      id: 'support',
      kind: 'human',
      name: 'Support Team',
      channels: [
        { type: 'slack', target: '#support' },
      ],
    }

    // Should use the configured transport
    const result = await ctx.sendNotification(target, 'Urgent ticket')

    expect(result.transport).toBe('slack')
    expect(result.delivered).toBe(true)
  })

  it('should fallback through channel priority', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target: WorkerTarget = {
      id: 'on-call',
      kind: 'human',
      name: 'On-Call Engineer',
      channels: [
        { type: 'slack', target: '@oncall' },
        { type: 'sms', target: '+1234567890' },
        { type: 'email', target: 'oncall@company.com' },
      ],
    }

    // Should try channels in order
    const result = await ctx.sendNotification(target, 'System alert', {
      priority: 'high',
      requireAck: true,
    })

    expect(result.delivered).toBe(true)
    expect(result.channelUsed).toBeDefined()
  })

  it('should support RPC-style worker invocation', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target = createWorkerTarget('ralph', 'agent')

    // Should generate RPC call to worker DO
    const result = await ctx.invokeWorker(target, 'ask', {
      question: 'What is the status?',
    })

    expect(result).toBeDefined()
  })

  it('should batch independent worker calls', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const priya = createWorkerTarget('priya', 'agent')
    const mark = createWorkerTarget('mark', 'agent')
    const sally = createWorkerTarget('sally', 'agent')

    // Independent calls should be batchable
    const results = await ctx.batchInvoke([
      { target: priya, action: 'ask', params: { question: 'Features?' } },
      { target: mark, action: 'ask', params: { question: 'Marketing?' } },
      { target: sally, action: 'ask', params: { question: 'Sales?' } },
    ])

    expect(results).toHaveLength(3)
    expect(results.every(r => r.success)).toBe(true)
  })
})

// ============================================================================
// 5. Worker Target Types Tests
// ============================================================================

describe('Worker Target Types', () => {
  it('should support agent workers', () => {
    const agent = createWorkerTarget('ralph', 'agent')

    expect(agent.kind).toBe('agent')
    expect(agent.id).toBe('ralph')
  })

  it('should support human workers', () => {
    const human = createWorkerTarget('nathan', 'human')

    expect(human.kind).toBe('human')
    expect(human.id).toBe('nathan')
  })

  it('should support channel configuration', () => {
    const target: WorkerTarget = {
      id: 'team-lead',
      kind: 'human',
      name: 'Team Lead',
      channels: [
        { type: 'slack', target: '@lead' },
        { type: 'email', target: 'lead@company.com' },
      ],
      preferences: {
        timezone: 'America/New_York',
        workingHours: { start: '09:00', end: '17:00' },
      },
    }

    expect(target.channels.length).toBe(2)
    expect(target.preferences?.timezone).toBe('America/New_York')
  })

  it('should support metadata on worker targets', () => {
    const target: WorkerTarget = {
      id: 'specialized-agent',
      kind: 'agent',
      name: 'Specialized Agent',
      channels: [],
      metadata: {
        model: 'claude-opus-4-5-20251101',
        systemPrompt: 'You are a specialized agent...',
        temperature: 0.7,
      },
    }

    expect(target.metadata?.model).toBe('claude-opus-4-5-20251101')
  })
})

// ============================================================================
// 6. Durable Action Semantics Tests
// ============================================================================

describe('Durable Action Semantics', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should use $.do for durable notify', async () => {
    const doActions: Array<{ action: string; data: unknown }> = []
    const $ = createMockContext()
    $.do = async (action, data) => {
      doActions.push({ action, data })
      return { success: true, durable: true }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('warehouse')

    await worker$.notify(target, 'Important message', { durable: true })

    expect(doActions.length).toBeGreaterThan(0)
    expect(doActions[0].action).toContain('Worker')
  })

  it('should use $.try for non-durable notify', async () => {
    const tryActions: Array<{ action: string; data: unknown }> = []
    const $ = createMockContext()
    $.try = async (action, data) => {
      tryActions.push({ action, data })
      return { success: true }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('warehouse')

    await worker$.notify(target, 'Quick message', { durable: false })

    expect(tryActions.length).toBeGreaterThan(0)
  })

  it('should default to durable for approve', async () => {
    const doActions: Array<{ action: string; data: unknown }> = []
    const $ = createMockContext()
    $.do = async (action, data) => {
      doActions.push({ action, data })
      return { approved: true, approver: 'manager' }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('manager', 'human')

    await worker$.approve('Budget approval', target)

    // Approval should always be durable
    expect(doActions.length).toBeGreaterThan(0)
  })

  it('should default to durable for decide', async () => {
    const doActions: Array<{ action: string; data: unknown }> = []
    const $ = createMockContext()
    $.do = async (action, data) => {
      doActions.push({ action, data })
      return { choice: 'option-a', reasoning: 'Best fit' }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('router')

    await worker$.decide(target, 'Choose path', ['option-a', 'option-b'])

    // Decision should always be durable
    expect(doActions.length).toBeGreaterThan(0)
  })

  it('should preserve step IDs for replay', async () => {
    const doOptions: Array<{ stepId?: string }> = []
    const $ = createMockContext()
    $.do = async (action, data, options) => {
      doOptions.push({ stepId: options?.stepId })
      return { success: true }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('processor')

    await worker$.work(target, {
      type: 'process',
      description: 'Process data',
      input: {},
    }, { stepId: 'step-1' })

    expect(doOptions[0].stepId).toBe('step-1')
  })

  it('should emit events after durable actions', async () => {
    const sentEvents: Array<{ event: string; data: unknown }> = []
    const $ = createMockContext()
    $.send = (event, data) => {
      sentEvents.push({ event, data })
      return 'event-id'
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('worker')

    await worker$.notify(target, 'Test message', { durable: true })

    expect(sentEvents.some(e => e.event.includes('notify'))).toBe(true)
  })
})

// ============================================================================
// 7. Named Agent Integration Tests
// ============================================================================

describe('Named Agent Integration', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should provide shortcuts for named agents', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    // Named agent shortcuts should be available
    expect(worker$.priya).toBeDefined()
    expect(worker$.ralph).toBeDefined()
    expect(worker$.tom).toBeDefined()
    expect(worker$.mark).toBeDefined()
    expect(worker$.sally).toBeDefined()
    expect(worker$.quinn).toBeDefined()
  })

  it('should use named agent for $.priya.ask()', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const result = await worker$.priya.ask('Define the MVP')

    expect(result).toBeDefined()
    expect(result.response).toBeDefined()
  })

  it('should use named agent for $.ralph.do()', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const result = await worker$.ralph.do({
      type: 'implement',
      description: 'Build the feature',
      input: { spec: 'Feature spec' },
    })

    expect(result).toBeDefined()
    expect(result.success).toBeDefined()
  })

  it('should use named agent for $.tom.approve()', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const result = await worker$.tom.approve('Review this PR')

    expect(result).toBeDefined()
    expect(typeof result.approved).toBe('boolean')
  })

  it('should use named agent for $.mark.notify()', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const result = await worker$.mark.notify('Product launched!')

    expect(result).toBeDefined()
    expect(result.sent).toBe(true)
  })

  it('should use named agent for $.quinn.decide()', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const result = await worker$.quinn.decide('Test strategy', ['unit', 'integration', 'e2e'])

    expect(result).toBeDefined()
    expect(result.choice).toBeDefined()
  })
})

// ============================================================================
// 8. Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should throw when worker target is not found', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target: WorkerTarget = {
      id: 'nonexistent-worker',
      kind: 'agent',
      name: 'Nonexistent',
      channels: [],
    }

    await expect(
      ctx.invokeWorker(target, 'ask', { question: 'Hello?' })
    ).rejects.toThrow('Worker not found')
  })

  it('should handle transport failures gracefully', async () => {
    const $ = createMockContext()
    const ctx = createWorkerContext($)

    const target: WorkerTarget = {
      id: 'unreachable',
      kind: 'human',
      name: 'Unreachable Worker',
      channels: [
        { type: 'slack', target: '#broken-channel' },
      ],
    }

    const result = await ctx.sendNotification(target, 'Test', {
      onError: 'continue',
    })

    expect(result.delivered).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should timeout long-running worker operations', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const target = createWorkerTarget('slow-worker')

    await expect(
      worker$.work(target, {
        type: 'long-task',
        description: 'Very long task',
        input: {},
      }, { timeout: 100 })
    ).rejects.toThrow('timeout')
  })

  it('should validate required parameters', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    const target = createWorkerTarget('validator')

    await expect(
      worker$.ask(target, '', {}) // Empty question
    ).rejects.toThrow('Question is required')
  })

  it('should retry transient failures', async () => {
    const $ = createMockContext()
    let attempts = 0
    $.do = async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('Transient failure')
      }
      return { success: true }
    }

    const worker$ = withWorkers($)
    const target = createWorkerTarget('flaky-worker')

    const result = await worker$.work(target, {
      type: 'retry-task',
      description: 'Task with retries',
      input: {},
    }, { maxRetries: 3 })

    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  })
})

// ============================================================================
// 9. Workflow Orchestration Tests
// ============================================================================

describe('Workflow Orchestration', () => {
  beforeEach(() => {
    clearDomainRegistry()
    clearHandlers()
  })

  it('should support sequential worker operations', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)
    const log: string[] = []

    // Sequential workflow: spec -> implement -> review -> announce
    const spec = await worker$.priya.ask('Define MVP')
    log.push('priya.ask')

    const code = await worker$.ralph.do({
      type: 'implement',
      description: 'Build based on spec',
      input: { spec },
    })
    log.push('ralph.do')

    const review = await worker$.tom.approve('Review implementation')
    log.push('tom.approve')

    if (review.approved) {
      await worker$.mark.notify('Product ready for launch!')
      log.push('mark.notify')
    }

    expect(log).toEqual(['priya.ask', 'ralph.do', 'tom.approve', 'mark.notify'])
  })

  it('should support parallel worker operations', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)

    // Parallel research phase
    const [productSpec, marketingPlan, salesStrategy] = await Promise.all([
      worker$.priya.ask('What features?'),
      worker$.mark.ask('What messaging?'),
      worker$.sally.ask('What segments?'),
    ])

    expect(productSpec).toBeDefined()
    expect(marketingPlan).toBeDefined()
    expect(salesStrategy).toBeDefined()
  })

  it('should support approval loops', async () => {
    const $ = createMockContext()
    let approvalAttempts = 0
    $.do = async () => {
      approvalAttempts++
      return {
        approved: approvalAttempts >= 2,
        approver: 'tom',
        feedback: approvalAttempts < 2 ? 'Needs work' : 'LGTM',
      }
    }

    const worker$ = withWorkers($)

    let implementation = { version: 1 }
    let approved = false

    while (!approved) {
      const review = await worker$.tom.approve('Review this')
      if (review.approved) {
        approved = true
      } else {
        // Revise based on feedback
        implementation = { version: implementation.version + 1 }
      }
    }

    expect(approved).toBe(true)
    expect(approvalAttempts).toBe(2)
  })

  it('should support conditional worker invocation', async () => {
    const $ = createMockContext()
    const worker$ = withWorkers($)
    const log: string[] = []

    const urgency = 'high'

    if (urgency === 'high') {
      await worker$.notify(createWorkerTarget('on-call'), 'Urgent issue!')
      log.push('notified-on-call')
    } else {
      await worker$.notify(createWorkerTarget('support'), 'New ticket')
      log.push('notified-support')
    }

    expect(log).toEqual(['notified-on-call'])
  })

  it('should support worker result chaining', async () => {
    const $ = createMockContext()
    $.do = async (action, data: unknown) => {
      const input = data as { params?: { previousResult?: unknown } }
      if (input.params?.previousResult) {
        return { chained: true, from: input.params.previousResult }
      }
      return { initialResult: 'first' }
    }

    const worker$ = withWorkers($)

    const first = await worker$.priya.ask('Initial question')
    const second = await worker$.ralph.do({
      type: 'process',
      description: 'Process first result',
      input: { previousResult: first },
    })

    expect(second).toBeDefined()
  })
})
