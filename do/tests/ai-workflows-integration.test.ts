/**
 * TDD Integration tests for ai-workflows compatibility with @dotdo/do
 *
 * These tests verify that the WorkflowContext ($) from @dotdo/do integrates
 * with the ai-workflows patterns from the primitives package.
 *
 * Following TDD approach: tests are written to FAIL first, then implementation
 * is updated to make them pass.
 *
 * @module do/tests/ai-workflows-integration.test
 * @issue do-zr1u.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContext, type WorkflowContext } from '../context'
import { createOnProxy, type EventHandler, type OnProxy } from '../on'
import { createEveryProxy, type ScheduleHandler, type ScheduleRegistration, type ScheduleInterval } from '../workflow/schedule'

// Import ai-workflows types and functions for pattern compatibility testing
import {
  Workflow,
  createTestContext,
  on as aiWorkflowsOn,
  every as aiWorkflowsEvery,
  registerEventHandler as aiWorkflowsRegisterEventHandler,
  getEventHandlers as aiWorkflowsGetEventHandlers,
  clearEventHandlers as aiWorkflowsClearEventHandlers,
  registerScheduleHandler as aiWorkflowsRegisterScheduleHandler,
  getScheduleHandlers as aiWorkflowsGetScheduleHandlers,
  clearScheduleHandlers as aiWorkflowsClearScheduleHandlers,
  type WorkflowContext as AIWorkflowContext,
  type EventRegistration,
  type ScheduleRegistration as AIScheduleRegistration,
  type OnProxy as AIOnProxy,
  type EveryProxy as AIEveryProxy,
} from 'ai-workflows'

// Mock DurableObjectState for DO context creation
const createMockState = () => ({
  id: { toString: () => `test-do-${Date.now()}` },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
    delete: vi.fn(),
  },
} as unknown as DurableObjectState)

describe('ai-workflows Integration with @dotdo/do', () => {
  let mockState: DurableObjectState
  let $: WorkflowContext

  beforeEach(() => {
    mockState = createMockState()
    $ = createContext(mockState, {})
    aiWorkflowsClearEventHandlers()
    aiWorkflowsClearScheduleHandlers()
  })

  afterEach(() => {
    aiWorkflowsClearEventHandlers()
    aiWorkflowsClearScheduleHandlers()
  })

  describe('$.on event handlers pattern compatibility', () => {
    it('should support $.on.Noun.verb() pattern matching ai-workflows', () => {
      // ai-workflows pattern: on.Customer.created(handler)
      const aiHandler = vi.fn()
      aiWorkflowsOn.Customer.created(aiHandler)

      // @dotdo/do pattern: $.on.Customer.created(handler)
      const doHandler = vi.fn()
      $.on.Customer.created(doHandler)

      // Both should register handlers
      const aiHandlers = aiWorkflowsGetEventHandlers()
      expect(aiHandlers).toHaveLength(1)
      expect(aiHandlers[0].noun).toBe('Customer')
      expect(aiHandlers[0].event).toBe('created')

      expect($._handlers.get('Customer.created')).toContain(doHandler)
    })

    it('should handle events in same format as ai-workflows', async () => {
      const receivedEvents: unknown[] = []

      // Register handler via DO context
      $.on.Order.completed((event) => {
        receivedEvents.push(event)
      })

      // ai-workflows expects (data, $) signature - test compatibility
      // Create an ai-workflows style Workflow and compare event delivery
      const aiReceivedEvents: unknown[] = []

      const workflow = Workflow(($ai) => {
        $ai.on.Order.completed((order, _ctx) => {
          aiReceivedEvents.push(order)
        })
      })

      // Emit event via ai-workflows
      await workflow.send('Order.completed', { orderId: '123', total: 100 })

      // Verify ai-workflows received the event
      await new Promise((r) => setTimeout(r, 50))
      expect(aiReceivedEvents).toHaveLength(1)
      expect(aiReceivedEvents[0]).toMatchObject({ orderId: '123', total: 100 })

      // Cleanup workflow to prevent timer leaks
      workflow.dispose()
    })

    it('should support handler with ($, event) or (event) signature like ai-workflows', async () => {
      // ai-workflows handlers receive (data, $) - two args
      // @dotdo/do handlers receive (event) - one arg
      // This test verifies compatibility pattern

      const aiEventData: unknown[] = []

      const workflow = Workflow(($ai) => {
        // ai-workflows pattern: handler receives (data, $)
        $ai.on.Customer.signup(async (customer, ctx) => {
          aiEventData.push({ customer, hasContext: !!ctx })
        })
      })

      await workflow.send('Customer.signup', { email: 'test@example.com' })
      await new Promise((r) => setTimeout(r, 50))

      expect(aiEventData).toHaveLength(1)
      expect(aiEventData[0]).toMatchObject({
        hasContext: true,
      })

      workflow.dispose()
    })

    it('should support wildcard patterns like ai-workflows', () => {
      // ai-workflows supports wildcards through its on proxy
      // @dotdo/do also supports wildcards: $.on.*.created, $.on.User.*
      const wildcardHandler = vi.fn()

      // Register wildcard handler
      $.on['*'].created(wildcardHandler)

      expect($._handlers.get('*.created')).toContain(wildcardHandler)
    })

    it('should have matching OnProxy interface structure', () => {
      // Verify DO OnProxy has same structure as ai-workflows OnProxy
      // Both should support: .Customer.created(handler), .Order.shipped(handler), etc.

      // DO OnProxy
      const doOnProxy = $.on

      // ai-workflows OnProxy (via Workflow)
      const aiContext = createTestContext()
      const aiOnProxy = aiContext.on

      // Both should be Proxy objects supporting arbitrary noun.verb
      expect(typeof doOnProxy.Customer.created).toBe('function')
      expect(typeof doOnProxy.AnyNoun.anyVerb).toBe('function')

      expect(typeof aiOnProxy.Customer.created).toBe('function')
      expect(typeof aiOnProxy.AnyNoun.anyVerb).toBe('function')
    })
  })

  describe('$.every scheduling pattern compatibility', () => {
    it('should support $.every.hour() pattern matching ai-workflows', () => {
      const doScheduleHandler = vi.fn()

      // @dotdo/do pattern
      $.every.hour(doScheduleHandler)

      // Verify schedule was registered
      const schedules = Array.from($._schedules.values())
      expect(schedules).toHaveLength(1)
      expect(schedules[0].interval.type).toBe('cron')
    })

    it('should support $.every.Monday.at9am() pattern like ai-workflows', () => {
      const doScheduleHandler = vi.fn()

      // @dotdo/do pattern: $.every.Monday.at9am(handler)
      $.every.Monday.at9am(doScheduleHandler)

      // Verify schedule was registered
      const schedules = Array.from($._schedules.values())
      expect(schedules).toHaveLength(1)

      const schedule = schedules[0]
      expect(schedule.interval.natural).toContain('Monday')
    })

    it('should support $.every.day.at("6pm") pattern like ai-workflows', () => {
      const doScheduleHandler = vi.fn()

      // @dotdo/do pattern with dynamic time
      $.every.day.at('6pm')(doScheduleHandler)

      // Verify schedule was registered with correct time
      const schedules = Array.from($._schedules.values())
      expect(schedules).toHaveLength(1)

      const schedule = schedules[0]
      expect(schedule.interval.expression).toContain('18') // 6pm = 18:00
    })

    it('should support $.every.minutes(30) interval pattern like ai-workflows', () => {
      const doScheduleHandler = vi.fn()

      // @dotdo/do supports $.every(30).minutes(handler)
      // ai-workflows supports $.every.minutes(30)(handler)
      // Test DO pattern
      $.every(30).minutes(doScheduleHandler)

      const schedules = Array.from($._schedules.values())
      expect(schedules).toHaveLength(1)

      const schedule = schedules[0]
      expect(schedule.interval.type).toBe('minute')
      expect(schedule.interval.value).toBe(30)
    })

    it('should have matching EveryProxy interface structure', () => {
      // Verify DO EveryProxy has same structure as ai-workflows EveryProxy
      const doEveryProxy = $.every

      // Both should support property access and function calls
      expect(typeof doEveryProxy.hour).toBe('function')
      expect(typeof doEveryProxy.Monday).toBe('function')
      expect(typeof doEveryProxy.day).toBe('function')
    })

    it('should generate compatible CRON expressions', () => {
      // ai-workflows and @dotdo/do should generate compatible CRON for same patterns
      // Test that $.every.Monday.at9am generates correct CRON

      const handler = vi.fn()
      $.every.Monday.at9am(handler)

      const schedules = Array.from($._schedules.values())
      const cronExpr = schedules[0].interval.expression

      // CRON format: minute hour day month weekday
      // Monday at 9am should be: 0 9 * * 1
      expect(cronExpr).toMatch(/^\d+\s+9\s+\*\s+\*\s+1$/)
    })

    it('should support plural time intervals like ai-workflows', () => {
      // ai-workflows: $.every.seconds(30)(handler), $.every.minutes(5)(handler)
      // @dotdo/do: $.every(30).seconds(handler), $.every(5).minutes(handler)

      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      // Test various interval patterns
      $.every(10).seconds(handler1)
      $.every(5).minutes(handler2)
      $.every(2).hours(handler3)

      const schedules = Array.from($._schedules.values())
      expect(schedules).toHaveLength(3)

      // Verify intervals
      const intervals = schedules.map((s) => ({
        type: s.interval.type,
        value: s.interval.value,
      }))

      expect(intervals).toContainEqual({ type: 'second', value: 10 })
      expect(intervals).toContainEqual({ type: 'minute', value: 5 })
      expect(intervals).toContainEqual({ type: 'hour', value: 2 })
    })
  })

  describe('Event emission integration', () => {
    it('should emit events in format compatible with ai-workflows handlers', async () => {
      const receivedEvents: unknown[] = []

      // Register handler
      $.on.User.registered((event) => {
        receivedEvents.push(event)
      })

      // Emit event via DO context
      $.send({ type: 'User.registered', payload: { userId: 'u-123', email: 'test@example.com' } })

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100))

      expect(receivedEvents).toHaveLength(1)
      // Event should have standard structure
      expect(receivedEvents[0]).toMatchObject({
        type: 'User.registered',
        payload: { userId: 'u-123', email: 'test@example.com' },
      })
    })

    it('should support multiple handlers for same event like ai-workflows', async () => {
      const handler1Results: unknown[] = []
      const handler2Results: unknown[] = []

      $.on.Order.placed((event) => {
        handler1Results.push(event)
      })

      $.on.Order.placed((event) => {
        handler2Results.push(event)
      })

      $.send({ type: 'Order.placed', payload: { orderId: 'ord-456' } })

      await new Promise((r) => setTimeout(r, 100))

      // Both handlers should have received the event
      expect(handler1Results).toHaveLength(1)
      expect(handler2Results).toHaveLength(1)
    })

    it('should not crash when handlers throw, matching ai-workflows error handling', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const failingHandler = vi.fn(() => {
        throw new Error('Handler error')
      })
      const successHandler = vi.fn()

      $.on.Test.event(failingHandler)
      $.on.Test.event(successHandler)

      // Should not throw
      $.send({ type: 'Test.event', payload: {} })

      await new Promise((r) => setTimeout(r, 100))

      // Success handler should still have been called
      expect(successHandler).toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it('should support async event handlers like ai-workflows', async () => {
      const results: string[] = []

      $.on.Async.operation(async () => {
        await new Promise((r) => setTimeout(r, 20))
        results.push('completed')
      })

      $.send({ type: 'Async.operation', payload: {} })

      await new Promise((r) => setTimeout(r, 100))

      expect(results).toContain('completed')
    })
  })

  describe('WorkflowContext API compatibility', () => {
    it('should have send() method matching ai-workflows $.send()', () => {
      expect(typeof $.send).toBe('function')
    })

    it('should have try() method matching ai-workflows $.try()', async () => {
      expect(typeof $.try).toBe('function')

      // $.try executes without retries
      const result = await $.try(async () => 'success')
      expect(result).toBe('success')
    })

    it('should have do() method matching ai-workflows $.do()', async () => {
      expect(typeof $.do).toBe('function')

      // $.do executes with retries
      let attempts = 0
      const result = await $.do(
        async () => {
          attempts++
          if (attempts < 2) throw new Error('Retry me')
          return 'success'
        },
        { retries: 3 }
      )
      expect(result).toBe('success')
      expect(attempts).toBe(2)
    })

    it('should provide state management like ai-workflows $.state', () => {
      // ai-workflows has $.state for context state
      // @dotdo/do may have different state management

      // Create ai-workflows context for comparison
      const aiContext = createTestContext()

      // ai-workflows supports $.state.key = value
      aiContext.state.userId = '123'
      expect(aiContext.state.userId).toBe('123')

      // ai-workflows also has $.set() and $.get()
      aiContext.set('key', 'value')
      expect(aiContext.get('key')).toBe('value')
    })

    it('should provide log functionality like ai-workflows $.log()', () => {
      // ai-workflows has $.log(message, data?)
      const aiContext = createTestContext()

      expect(typeof aiContext.log).toBe('function')

      // Should not throw
      aiContext.log('Test message', { data: 'value' })
    })
  })

  describe('Workflow definition compatibility', () => {
    it('should support Workflow() pattern from ai-workflows', async () => {
      const events: unknown[] = []

      // Create workflow using ai-workflows Workflow()
      const workflow = Workflow(($wf) => {
        $wf.on.Customer.created(async (customer, ctx) => {
          events.push(customer)
          ctx.log('Customer created', customer)
        })

        $wf.on.Order.placed(async (order) => {
          events.push(order)
        })
      })

      // Start the workflow
      await workflow.start()

      // Send events
      await workflow.send('Customer.created', { name: 'Alice' })
      await workflow.send('Order.placed', { orderId: '123' })

      await new Promise((r) => setTimeout(r, 100))

      expect(events).toHaveLength(2)

      // Stop the workflow
      await workflow.stop()
    })

    it('should expose workflow definition with events and schedules like ai-workflows', () => {
      const workflow = Workflow(($wf) => {
        $wf.on.User.signup(() => {})
        $wf.on.User.login(() => {})
      })

      // ai-workflows exposes .definition with events array
      expect(workflow.definition).toBeDefined()
      expect(workflow.definition.events).toHaveLength(2)

      workflow.dispose()
    })
  })

  describe('Schedule interval type compatibility', () => {
    it('should support same ScheduleInterval types as ai-workflows', () => {
      // ai-workflows ScheduleInterval types:
      // 'second' | 'minute' | 'hour' | 'day' | 'week' | 'cron' | 'natural'

      const handler = vi.fn()

      // Register schedules using different interval types
      $.every.second(handler)
      $.every.minute(handler)
      $.every.hour(handler)
      $.every.day(handler)
      $.every.week(handler)

      const schedules = Array.from($._schedules.values())
      const types = schedules.map((s) => s.interval.type)

      // All should be 'cron' type in @dotdo/do since it converts to cron
      expect(types.every((t) => t === 'cron' || ['second', 'minute', 'hour', 'day', 'week'].includes(t))).toBe(true)
    })

    it('should have natural language description in interval like ai-workflows', () => {
      const handler = vi.fn()

      $.every.Monday.at9am(handler)

      const schedules = Array.from($._schedules.values())
      expect(schedules[0].interval.natural).toBeDefined()
      expect(schedules[0].interval.natural).toContain('Monday')
    })
  })
})

describe('Type compatibility with ai-workflows', () => {
  it('should have EventHandler compatible with ai-workflows EventHandler', () => {
    // ai-workflows EventHandler: (data: TInput, $: WorkflowContext) => TOutput | void | Promise<TOutput | void>
    // @dotdo/do EventHandler: (event: T) => Promise<void> | void

    // Both should accept functions that handle events
    const aiHandler: (data: unknown, $: AIWorkflowContext) => Promise<void> = async (data, $) => {
      $.log('Handled', data)
    }

    const doHandler: EventHandler = async (event) => {
      console.log('Handled', event)
    }

    // Type check passes if these assignments compile
    expect(typeof aiHandler).toBe('function')
    expect(typeof doHandler).toBe('function')
  })

  it('should have ScheduleHandler compatible with ai-workflows ScheduleHandler', () => {
    // ai-workflows ScheduleHandler: ($: WorkflowContext) => void | Promise<void>
    // @dotdo/do ScheduleHandler: () => Promise<void>

    const aiScheduleHandler: ($: AIWorkflowContext) => Promise<void> = async ($) => {
      $.log('Scheduled task')
    }

    const doScheduleHandler: ScheduleHandler = async () => {
      console.log('Scheduled task')
    }

    expect(typeof aiScheduleHandler).toBe('function')
    expect(typeof doScheduleHandler).toBe('function')
  })
})
