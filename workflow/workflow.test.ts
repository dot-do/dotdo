/**
 * @module workflow/workflow.test.ts
 *
 * Failing tests for WorkflowContext ($)
 *
 * This file defines the expected behavior of the WorkflowContext system
 * before implementation. All tests should FAIL until the corresponding
 * implementation is complete.
 *
 * Test Areas:
 * 1. Event Handlers ($.on)
 * 2. Scheduling DSL ($.every)
 * 3. Durable Execution ($.do, $.try, $.send)
 * 4. Cross-DO RPC ($.Customer(id).method())
 * 5. Cascade Execution (code -> gen -> agentic -> human tiers)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the WorkflowContext factory (to be implemented)
import { createWorkflowContext, type WorkflowContext } from './workflow-context'

// ============================================================================
// 1. EVENT HANDLERS ($.on)
// ============================================================================

describe('Event Handlers ($.on)', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createWorkflowContext()
  })

  describe('$.on.Noun.verb(handler)', () => {
    it('registers a handler for Customer.signup', () => {
      const handler = vi.fn()

      $.on.Customer.signup(handler)

      // Handler should be registered
      const registeredHandlers = $.getRegisteredHandlers('Customer.signup')
      expect(registeredHandlers).toHaveLength(1)
      expect(registeredHandlers[0]).toBe(handler)
    })

    it('registers a handler for Payment.failed', () => {
      const handler = vi.fn()

      $.on.Payment.failed(handler)

      const registeredHandlers = $.getRegisteredHandlers('Payment.failed')
      expect(registeredHandlers).toHaveLength(1)
    })

    it('allows multiple handlers for the same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      $.on.Customer.signup(handler1)
      $.on.Customer.signup(handler2)

      const registeredHandlers = $.getRegisteredHandlers('Customer.signup')
      expect(registeredHandlers).toHaveLength(2)
    })

    it('returns unsubscribe function', () => {
      const handler = vi.fn()

      const unsubscribe = $.on.Customer.signup(handler)

      expect(typeof unsubscribe).toBe('function')

      // After unsubscribe, handler should be removed
      unsubscribe()
      const registeredHandlers = $.getRegisteredHandlers('Customer.signup')
      expect(registeredHandlers).toHaveLength(0)
    })
  })

  describe('wildcard matching ($.on.*.verb)', () => {
    it('matches any noun with $.on.*.created', () => {
      const handler = vi.fn()

      $.on['*'].created(handler)

      // Should match Customer.created
      const customerHandlers = $.matchHandlers('Customer.created')
      expect(customerHandlers).toContain(handler)

      // Should match Order.created
      const orderHandlers = $.matchHandlers('Order.created')
      expect(orderHandlers).toContain(handler)

      // Should NOT match Customer.signup (different verb)
      const signupHandlers = $.matchHandlers('Customer.signup')
      expect(signupHandlers).not.toContain(handler)
    })

    it('matches any verb with $.on.Customer.*', () => {
      const handler = vi.fn()

      $.on.Customer['*'](handler)

      // Should match Customer.created
      expect($.matchHandlers('Customer.created')).toContain(handler)

      // Should match Customer.signup
      expect($.matchHandlers('Customer.signup')).toContain(handler)

      // Should NOT match Order.created (different noun)
      expect($.matchHandlers('Order.created')).not.toContain(handler)
    })

    it('matches all events with $.on.*.*', () => {
      const handler = vi.fn()

      $.on['*']['*'](handler)

      // Should match everything
      expect($.matchHandlers('Customer.signup')).toContain(handler)
      expect($.matchHandlers('Order.created')).toContain(handler)
      expect($.matchHandlers('Payment.failed')).toContain(handler)
    })
  })

  describe('event dispatch', () => {
    it('handler receives event with correct structure', async () => {
      const handler = vi.fn()
      $.on.Customer.signup(handler)

      await $.dispatch('Customer.signup', {
        name: 'Alice',
        email: 'alice@example.com'
      })

      expect(handler).toHaveBeenCalledTimes(1)

      const event = handler.mock.calls[0][0]
      expect(event).toMatchObject({
        type: 'Customer.signup',
        subject: 'Customer',
        object: 'signup',
        data: { name: 'Alice', email: 'alice@example.com' },
      })
      expect(event.timestamp).toBeInstanceOf(Date)
      expect(typeof event.id).toBe('string')
    })

    it('dispatches to multiple handlers in order', async () => {
      const order: number[] = []

      $.on.Customer.signup(() => order.push(1))
      $.on.Customer.signup(() => order.push(2))
      $.on.Customer.signup(() => order.push(3))

      await $.dispatch('Customer.signup', {})

      expect(order).toEqual([1, 2, 3])
    })

    it('handles async handlers correctly', async () => {
      const results: string[] = []

      $.on.Customer.signup(async () => {
        await new Promise(r => setTimeout(r, 10))
        results.push('async')
      })
      $.on.Customer.signup(() => {
        results.push('sync')
      })

      await $.dispatch('Customer.signup', {})

      expect(results).toContain('async')
      expect(results).toContain('sync')
    })
  })
})

// ============================================================================
// 2. SCHEDULING DSL ($.every)
// ============================================================================

describe('Scheduling DSL ($.every)', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createWorkflowContext()
  })

  describe('$.every.Day.atTime(handler)', () => {
    it('$.every.Monday.at9am registers with correct CRON', () => {
      const handler = vi.fn()

      $.every.Monday.at9am(handler)

      const schedule = $.getSchedule('0 9 * * 1')
      expect(schedule).toBeDefined()
      expect(schedule.handler).toBe(handler)
    })

    it('$.every.Friday.at5pm registers with correct CRON', () => {
      const handler = vi.fn()

      $.every.Friday.at5pm(handler)

      const schedule = $.getSchedule('0 17 * * 5')
      expect(schedule).toBeDefined()
    })

    it('$.every.day.at6am registers daily schedule', () => {
      const handler = vi.fn()

      $.every.day.at6am(handler)

      // Daily = * for day of week
      const schedule = $.getSchedule('0 6 * * *')
      expect(schedule).toBeDefined()
    })
  })

  describe('$.every.day.at(time)(handler)', () => {
    it('$.every.day.at("6pm") registers correctly', () => {
      const handler = vi.fn()

      $.every.day.at('6pm')(handler)

      const schedule = $.getSchedule('0 18 * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every.day.at("9:30am") supports minutes', () => {
      const handler = vi.fn()

      $.every.day.at('9:30am')(handler)

      const schedule = $.getSchedule('30 9 * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every.day.at("noon") supports named times', () => {
      const handler = vi.fn()

      $.every.day.at('noon')(handler)

      const schedule = $.getSchedule('0 12 * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every.day.at("midnight") supports midnight', () => {
      const handler = vi.fn()

      $.every.day.at('midnight')(handler)

      const schedule = $.getSchedule('0 0 * * *')
      expect(schedule).toBeDefined()
    })
  })

  describe('interval schedules', () => {
    it('$.every.hour registers hourly schedule', () => {
      const handler = vi.fn()

      $.every.hour(handler)

      const schedule = $.getSchedule('0 * * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every.minute registers every minute', () => {
      const handler = vi.fn()

      $.every.minute(handler)

      const schedule = $.getSchedule('* * * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every(5).minutes registers every 5 minutes', () => {
      const handler = vi.fn()

      $.every(5).minutes(handler)

      const schedule = $.getSchedule('*/5 * * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every(2).hours registers every 2 hours', () => {
      const handler = vi.fn()

      $.every(2).hours(handler)

      const schedule = $.getSchedule('0 */2 * * *')
      expect(schedule).toBeDefined()
    })

    it('$.every(30).seconds registers sub-minute interval', () => {
      const handler = vi.fn()

      $.every(30).seconds(handler)

      // Sub-minute schedules use a custom format or alarm-based scheduling
      const schedule = $.getSchedule('every:30s')
      expect(schedule).toBeDefined()
    })
  })

  describe('one-time scheduling', () => {
    it('$.at(ISO date) schedules one-time execution', () => {
      const handler = vi.fn()
      const futureDate = '2024-12-25T00:00:00Z'

      $.at(futureDate)(handler)

      const schedule = $.getOneTimeSchedule(futureDate)
      expect(schedule).toBeDefined()
      expect(schedule.handler).toBe(handler)
    })

    it('$.at(Date object) works with Date instances', () => {
      const handler = vi.fn()
      const date = new Date('2024-12-25T00:00:00Z')

      $.at(date)(handler)

      const schedule = $.getOneTimeSchedule(date.toISOString())
      expect(schedule).toBeDefined()
    })
  })

  describe('schedule returns unsubscribe', () => {
    it('can cancel scheduled handler', () => {
      const handler = vi.fn()

      const cancel = $.every.Monday.at9am(handler)

      expect(typeof cancel).toBe('function')

      cancel()

      const schedule = $.getSchedule('0 9 * * 1')
      expect(schedule).toBeUndefined()
    })
  })
})

// ============================================================================
// 3. DURABLE EXECUTION ($.do, $.try, $.send)
// ============================================================================

describe('Durable Execution', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createWorkflowContext()
  })

  describe('$.send(event) - fire-and-forget', () => {
    it('emits event without waiting for handlers', () => {
      const eventId = $.send('Customer.signup', { email: 'test@example.com' })

      // send returns immediately with an event ID
      expect(typeof eventId).toBe('string')
      expect(eventId).toMatch(/^evt_/)
    })

    it('does not throw on handler errors', async () => {
      $.on.Customer.signup(() => {
        throw new Error('Handler crashed')
      })

      // Should not throw
      expect(() => {
        $.send('Customer.signup', { email: 'test@example.com' })
      }).not.toThrow()
    })

    it('returns event ID for tracking', () => {
      const eventId = $.send('Order.created', { orderId: '123' })

      expect(eventId).toBeDefined()
      expect(typeof eventId).toBe('string')
    })
  })

  describe('$.try(action) - single attempt', () => {
    it('executes action once and returns result', async () => {
      const action = vi.fn().mockResolvedValue({ success: true })

      const result = await $.try(action)

      expect(action).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ success: true })
    })

    it('does not retry on failure', async () => {
      const action = vi.fn().mockRejectedValue(new Error('Failed'))

      await expect($.try(action)).rejects.toThrow('Failed')
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('does not persist to action log', async () => {
      const action = vi.fn().mockResolvedValue('done')

      await $.try(action)

      const actionLog = $.getActionLog()
      expect(actionLog).toHaveLength(0)
    })

    it('supports timeout option', async () => {
      const slowAction = vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 1000))
        return 'done'
      })

      await expect(
        $.try(slowAction, { timeout: 50 })
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('$.do(action) - durable with retries', () => {
    it('executes action and returns result', async () => {
      const action = vi.fn().mockResolvedValue({ data: 'result' })

      const result = await $.do(action)

      expect(result).toEqual({ data: 'result' })
    })

    it('retries on failure with exponential backoff', async () => {
      const action = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success')

      const result = await $.do(action, { maxRetries: 3 })

      expect(action).toHaveBeenCalledTimes(3)
      expect(result).toBe('success')
    })

    it('persists action to log before execution', async () => {
      const action = vi.fn().mockResolvedValue('done')

      await $.do(action, { stepId: 'step-1' })

      const actionLog = $.getActionLog()
      expect(actionLog).toContainEqual(
        expect.objectContaining({
          stepId: 'step-1',
          status: 'completed',
        })
      )
    })

    it('respects maxRetries option', async () => {
      const action = vi.fn().mockRejectedValue(new Error('Always fails'))

      await expect(
        $.do(action, { maxRetries: 2 })
      ).rejects.toThrow('Always fails')

      expect(action).toHaveBeenCalledTimes(2)
    })

    it('replays from persisted log on restart', async () => {
      // First execution
      const result1 = await $.do(() => 'computed-value', { stepId: 'idempotent-1' })

      // Simulate restart with same stepId
      const result2 = await $.do(() => 'different-value', { stepId: 'idempotent-1' })

      // Should return cached value, not re-execute
      expect(result1).toBe('computed-value')
      expect(result2).toBe('computed-value')
    })

    it('records error details on final failure', async () => {
      const action = vi.fn().mockRejectedValue(new Error('Permanent failure'))

      await expect(
        $.do(action, { stepId: 'failing-step', maxRetries: 1 })
      ).rejects.toThrow()

      const actionLog = $.getActionLog()
      const entry = actionLog.find(a => a.stepId === 'failing-step')
      expect(entry).toMatchObject({
        status: 'failed',
        error: expect.objectContaining({
          message: 'Permanent failure',
        }),
      })
    })
  })

  describe('durability semantics matrix', () => {
    it('track() is fire-and-forget without persistence', () => {
      // $.track for telemetry - no return value, swallows errors
      expect(() => $.track('pageview', { path: '/home' })).not.toThrow()

      // Should not appear in action log
      const log = $.getActionLog()
      expect(log).toHaveLength(0)
    })

    it('send() is durable event emission with ID', () => {
      const eventId = $.send('Order.shipped', { orderId: '123' })

      // Returns trackable ID
      expect(eventId).toMatch(/^evt_/)

      // Should be in event log
      const events = $.getEventLog()
      expect(events).toContainEqual(
        expect.objectContaining({
          id: eventId,
          type: 'Order.shipped',
        })
      )
    })
  })
})

// ============================================================================
// 4. CROSS-DO RPC ($.Customer(id).method())
// ============================================================================

describe('Cross-DO RPC', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createWorkflowContext({
      // Mock stub resolver for testing
      stubResolver: (noun: string, id: string) => ({
        notify: vi.fn().mockResolvedValue({ sent: true }),
        ship: vi.fn().mockResolvedValue({ trackingNumber: 'TRACK123' }),
        getStatus: vi.fn().mockResolvedValue({ status: 'active' }),
      }),
    })
  })

  describe('$.Noun(id) accessor', () => {
    it('$.Customer(id) returns a domain proxy', () => {
      const proxy = $.Customer('cust-123')

      expect(proxy).toBeDefined()
      expect(typeof proxy).toBe('object')
    })

    it('$.Order(id) returns a domain proxy', () => {
      const proxy = $.Order('order-456')

      expect(proxy).toBeDefined()
    })

    it('proxy provides RPC method access', () => {
      const proxy = $.Customer('cust-123')

      expect(typeof proxy.notify).toBe('function')
      expect(typeof proxy.getStatus).toBe('function')
    })
  })

  describe('RPC method calls', () => {
    it('$.Customer(id).notify() returns promise', async () => {
      const result = await $.Customer('cust-123').notify('Hello!')

      expect(result).toEqual({ sent: true })
    })

    it('$.Order(id).ship() executes cross-DO call', async () => {
      const result = await $.Order('order-456').ship()

      expect(result).toEqual({ trackingNumber: 'TRACK123' })
    })

    it('passes arguments to remote method', async () => {
      const stubResolver = vi.fn().mockReturnValue({
        sendEmail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
      })

      $ = createWorkflowContext({ stubResolver })

      await $.Customer('cust-123').sendEmail({
        template: 'welcome',
        subject: 'Hello!',
      })

      expect(stubResolver).toHaveBeenCalledWith('Customer', 'cust-123')
    })

    it('resolves to remote return value', async () => {
      $ = createWorkflowContext({
        stubResolver: () => ({
          calculate: vi.fn().mockResolvedValue(42),
        }),
      })

      const result = await $.Invoice('inv-789').calculate()

      expect(result).toBe(42)
    })
  })

  describe('error handling', () => {
    it('propagates remote errors', async () => {
      $ = createWorkflowContext({
        stubResolver: () => ({
          fail: vi.fn().mockRejectedValue(new Error('Remote error')),
        }),
      })

      await expect(
        $.Customer('cust-123').fail()
      ).rejects.toThrow('Remote error')
    })

    it('handles network timeouts', async () => {
      $ = createWorkflowContext({
        stubResolver: () => ({
          slow: vi.fn().mockImplementation(
            () => new Promise(r => setTimeout(r, 10000))
          ),
        }),
        rpcTimeout: 100,
      })

      await expect(
        $.Customer('cust-123').slow()
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('RPC promise pipelining', () => {
    it('supports chained property access', async () => {
      $ = createWorkflowContext({
        stubResolver: () => ({
          getProfile: vi.fn().mockResolvedValue({
            name: 'Alice',
            email: 'alice@example.com',
          }),
        }),
      })

      // Pipeline: resolve, then access .email
      const email = await $.Customer('cust-123').getProfile().email

      expect(email).toBe('alice@example.com')
    })

    it('supports method chaining', async () => {
      $ = createWorkflowContext({
        stubResolver: () => ({
          getItems: vi.fn().mockResolvedValue([
            { name: 'Item 1', price: 10 },
            { name: 'Item 2', price: 20 },
          ]),
        }),
      })

      // Pipeline: resolve, then call .map()
      const names = await $.Order('order-123')
        .getItems()
        .map((item: { name: string }) => item.name)

      expect(names).toEqual(['Item 1', 'Item 2'])
    })
  })
})

// ============================================================================
// 5. CASCADE EXECUTION
// ============================================================================

describe('Cascade Execution', () => {
  let $: WorkflowContext

  beforeEach(() => {
    $ = createWorkflowContext()
  })

  describe('$.cascade(task) tier execution', () => {
    it('tries code tier first for deterministic functions', async () => {
      const codeHandler = vi.fn().mockResolvedValue('code-result')

      const result = await $.cascade({
        task: 'calculate-total',
        tiers: {
          code: codeHandler,
          generative: vi.fn(),
          agentic: vi.fn(),
          human: vi.fn(),
        },
      })

      expect(result.value).toBe('code-result')
      expect(result.tier).toBe('code')
      expect(codeHandler).toHaveBeenCalled()
    })

    it('escalates to generative tier when code tier fails', async () => {
      const genHandler = vi.fn().mockResolvedValue({
        value: 'generated-result',
        confidence: 0.95,
      })

      const result = await $.cascade({
        task: 'write-description',
        tiers: {
          code: vi.fn().mockResolvedValue({ confidence: 0.2 }), // Low confidence
          generative: genHandler,
          agentic: vi.fn(),
          human: vi.fn(),
        },
        confidenceThreshold: 0.8,
      })

      expect(result.tier).toBe('generative')
      expect(genHandler).toHaveBeenCalled()
    })

    it('escalates to agentic tier for complex reasoning', async () => {
      const agenticHandler = vi.fn().mockResolvedValue({
        value: 'agentic-result',
        confidence: 0.9,
        reasoning: ['step 1', 'step 2'],
      })

      const result = await $.cascade({
        task: 'complex-decision',
        tiers: {
          code: vi.fn().mockRejectedValue(new Error('Not implemented')),
          generative: vi.fn().mockResolvedValue({ confidence: 0.3 }),
          agentic: agenticHandler,
          human: vi.fn(),
        },
        confidenceThreshold: 0.8,
      })

      expect(result.tier).toBe('agentic')
      expect(agenticHandler).toHaveBeenCalled()
    })

    it('escalates to human tier when agentic fails', async () => {
      const humanHandler = vi.fn().mockResolvedValue({
        value: 'human-approved',
        approvedBy: 'alice@example.com',
      })

      const result = await $.cascade({
        task: 'approve-refund',
        tiers: {
          code: vi.fn().mockRejectedValue(new Error('No rule')),
          generative: vi.fn().mockResolvedValue({ confidence: 0.2 }),
          agentic: vi.fn().mockResolvedValue({ confidence: 0.4 }),
          human: humanHandler,
        },
        confidenceThreshold: 0.8,
      })

      expect(result.tier).toBe('human')
      expect(humanHandler).toHaveBeenCalled()
    })
  })

  describe('confidence-based escalation', () => {
    it('uses default threshold of 0.8', async () => {
      const result = await $.cascade({
        task: 'classify-email',
        tiers: {
          code: vi.fn().mockResolvedValue({ value: 'spam', confidence: 0.75 }),
          generative: vi.fn().mockResolvedValue({ value: 'spam', confidence: 0.95 }),
        },
      })

      // 0.75 < 0.8, so should escalate
      expect(result.tier).toBe('generative')
    })

    it('respects custom threshold', async () => {
      const result = await $.cascade({
        task: 'classify-email',
        confidenceThreshold: 0.5,
        tiers: {
          code: vi.fn().mockResolvedValue({ value: 'spam', confidence: 0.6 }),
          generative: vi.fn().mockResolvedValue({ value: 'spam', confidence: 0.95 }),
        },
      })

      // 0.6 > 0.5, so should NOT escalate
      expect(result.tier).toBe('code')
    })

    it('stops at first tier meeting threshold', async () => {
      const agenticHandler = vi.fn()

      const result = await $.cascade({
        task: 'something',
        confidenceThreshold: 0.7,
        tiers: {
          code: vi.fn().mockResolvedValue({ value: 'x', confidence: 0.5 }),
          generative: vi.fn().mockResolvedValue({ value: 'y', confidence: 0.85 }),
          agentic: agenticHandler,
        },
      })

      expect(result.tier).toBe('generative')
      expect(agenticHandler).not.toHaveBeenCalled()
    })
  })

  describe('tier metadata tracking', () => {
    it('records execution path', async () => {
      const result = await $.cascade({
        task: 'test-task',
        tiers: {
          code: vi.fn().mockResolvedValue({ confidence: 0.1 }),
          generative: vi.fn().mockResolvedValue({ confidence: 0.2 }),
          agentic: vi.fn().mockResolvedValue({ value: 'done', confidence: 0.9 }),
        },
        confidenceThreshold: 0.8,
      })

      expect(result.executionPath).toEqual(['code', 'generative', 'agentic'])
      expect(result.attempts).toBe(3)
    })

    it('tracks timing per tier', async () => {
      const result = await $.cascade({
        task: 'timed-task',
        tiers: {
          code: vi.fn().mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10))
            return { confidence: 0.1 }
          }),
          generative: vi.fn().mockResolvedValue({ value: 'ok', confidence: 0.9 }),
        },
        confidenceThreshold: 0.8,
      })

      expect(result.timing).toBeDefined()
      expect(result.timing.code).toBeGreaterThan(0)
      expect(result.timing.generative).toBeGreaterThan(0)
    })

    it('includes confidence scores from each tier', async () => {
      const result = await $.cascade({
        task: 'scored-task',
        tiers: {
          code: vi.fn().mockResolvedValue({ confidence: 0.3 }),
          generative: vi.fn().mockResolvedValue({ confidence: 0.6 }),
          agentic: vi.fn().mockResolvedValue({ value: 'final', confidence: 0.95 }),
        },
        confidenceThreshold: 0.8,
      })

      expect(result.confidenceScores).toEqual({
        code: 0.3,
        generative: 0.6,
        agentic: 0.95,
      })
    })
  })

  describe('human tier integration', () => {
    it('creates approval queue entry', async () => {
      const queueEntry = { id: 'approval-123', status: 'pending' }
      const humanHandler = vi.fn().mockResolvedValue({
        value: 'approved',
        queueEntry,
      })

      const result = await $.cascade({
        task: 'needs-approval',
        tiers: {
          human: humanHandler,
        },
        skipAutomation: true, // Go directly to human
      })

      expect(result.queueEntry).toEqual(queueEntry)
    })

    it('supports timeout for human approval', async () => {
      const humanHandler = vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 1000))
        return { value: 'approved' }
      })

      await expect(
        $.cascade({
          task: 'urgent-approval',
          tiers: {
            human: humanHandler,
          },
          skipAutomation: true,
          timeout: 50,
        })
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('error handling in cascade', () => {
    it('continues to next tier on error', async () => {
      const genHandler = vi.fn().mockResolvedValue({ value: 'recovered', confidence: 0.9 })

      const result = await $.cascade({
        task: 'error-task',
        tiers: {
          code: vi.fn().mockRejectedValue(new Error('Code tier crashed')),
          generative: genHandler,
        },
        confidenceThreshold: 0.8,
      })

      expect(result.tier).toBe('generative')
      expect(genHandler).toHaveBeenCalled()
    })

    it('throws if all tiers fail', async () => {
      await expect(
        $.cascade({
          task: 'all-fail',
          tiers: {
            code: vi.fn().mockRejectedValue(new Error('Code fail')),
            generative: vi.fn().mockRejectedValue(new Error('Gen fail')),
            agentic: vi.fn().mockRejectedValue(new Error('Agent fail')),
          },
        })
      ).rejects.toThrow(/all tiers failed/i)
    })

    it('records errors from each failed tier', async () => {
      try {
        await $.cascade({
          task: 'error-tracking',
          tiers: {
            code: vi.fn().mockRejectedValue(new Error('Code error')),
            generative: vi.fn().mockRejectedValue(new Error('Gen error')),
          },
        })
      } catch (error: any) {
        expect(error.tierErrors).toEqual({
          code: expect.objectContaining({ message: 'Code error' }),
          generative: expect.objectContaining({ message: 'Gen error' }),
        })
      }
    })
  })
})

// ============================================================================
// HELPER TYPES (for test clarity - implementation will provide real types)
// ============================================================================

// Minimal type stubs for tests - real implementation will be comprehensive
declare module './workflow-context' {
  export interface WorkflowContext {
    // Event handlers
    on: {
      [noun: string]: {
        [verb: string]: (handler: (event: any) => void | Promise<void>) => () => void
      }
    }
    getRegisteredHandlers(eventKey: string): Function[]
    matchHandlers(eventKey: string): Function[]
    dispatch(eventKey: string, data: unknown): Promise<void>

    // Scheduling
    every: ScheduleBuilder & ((n: number) => IntervalBuilder)
    at(date: string | Date): (handler: () => void) => () => void
    getSchedule(cron: string): { handler: Function } | undefined
    getOneTimeSchedule(date: string): { handler: Function } | undefined

    // Execution
    send(event: string, data: unknown): string
    try<T>(action: () => Promise<T>, options?: { timeout?: number }): Promise<T>
    do<T>(action: () => Promise<T>, options?: { stepId?: string; maxRetries?: number }): Promise<T>
    track(event: string, data: unknown): void
    getActionLog(): Array<{ stepId: string; status: string; error?: { message: string } }>
    getEventLog(): Array<{ id: string; type: string }>

    // Cross-DO RPC
    [noun: string]: (id: string) => DomainProxy

    // Cascade
    cascade(options: CascadeOptions): Promise<CascadeResult>
  }

  interface ScheduleBuilder {
    Monday: TimeBuilder
    Tuesday: TimeBuilder
    Wednesday: TimeBuilder
    Thursday: TimeBuilder
    Friday: TimeBuilder
    Saturday: TimeBuilder
    Sunday: TimeBuilder
    day: TimeBuilder
    hour: (handler: () => void) => () => void
    minute: (handler: () => void) => () => void
  }

  interface TimeBuilder {
    at9am: (handler: () => void) => () => void
    at5pm: (handler: () => void) => () => void
    at6am: (handler: () => void) => () => void
    at(time: string): (handler: () => void) => () => void
  }

  interface IntervalBuilder {
    minutes: (handler: () => void) => () => void
    hours: (handler: () => void) => () => void
    seconds: (handler: () => void) => () => void
  }

  interface DomainProxy {
    [method: string]: (...args: unknown[]) => Promise<any> & { [key: string]: any }
  }

  interface CascadeOptions {
    task: string
    tiers: {
      code?: Function
      generative?: Function
      agentic?: Function
      human?: Function
    }
    confidenceThreshold?: number
    skipAutomation?: boolean
    timeout?: number
  }

  interface CascadeResult {
    value: unknown
    tier: 'code' | 'generative' | 'agentic' | 'human'
    confidence?: number
    executionPath?: string[]
    attempts?: number
    timing?: Record<string, number>
    confidenceScores?: Record<string, number>
    queueEntry?: unknown
  }

  export interface CreateContextOptions {
    stubResolver?: (noun: string, id: string) => Record<string, Function>
    rpcTimeout?: number
  }

  export function createWorkflowContext(options?: CreateContextOptions): WorkflowContext
}
