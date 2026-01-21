/**
 * Comprehensive Workflow Tests (do-sz5a)
 *
 * Tests for do/workflow/*.ts modules:
 * 1. Alarm scheduling and triggering (alarm.ts)
 * 2. WorkflowContext methods (context.ts)
 * 3. Event system pub/sub (event-system.ts)
 * 4. Schedule DSL parsing (schedule.ts)
 *
 * @module do/tests/workflow-comprehensive.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import { createContext, type WorkflowContext } from '../context'
import { EventSystem, createEventSystem, type EventPayload } from '../workflow/event-system'
import {
  createEveryProxy,
  getSchedules,
  getScheduleCount,
  clearSchedules,
  executeSchedule,
  type ScheduleRegistration,
} from '../workflow/schedule'
import {
  calculateNextRunTime,
  calculateNextCronTime,
  calculateNextAlarmTime,
  executeSchedules,
  executeOneTimeAlarms,
  createAlarmStore,
  serializeAlarmStore,
  deserializeAlarmStore,
  type AlarmStore,
  type AlarmMetadata,
} from '../workflow/alarm'
import {
  createOnProxy,
  matchHandlers,
  invokeHandlers,
  getEventTypes,
  getHandlerCount,
  clearHandlers,
  clearAllHandlers,
  type EventHandler,
  type RetryOptions,
} from '../workflow/events'
import {
  validateCronExpression,
  validateCronField,
  validateTimeString,
  CronValidationError,
  containsDangerousPatterns,
} from '../workflow/cron-validation'

// ============================================================================
// SECTION 1: ALARM SCHEDULING AND TRIGGERING TESTS
// ============================================================================

describe('Alarm Scheduling and Triggering', () => {
  describe('AlarmStore management', () => {
    it('should create an empty alarm store', () => {
      const store = createAlarmStore()

      expect(store.alarms).toBeInstanceOf(Map)
      expect(store.oneTimeAlarms).toBeInstanceOf(Map)
      expect(store.oneTimeHandlers).toBeInstanceOf(Map)
      expect(store.alarms.size).toBe(0)
      expect(store.oneTimeAlarms.size).toBe(0)
      expect(store.oneTimeHandlers.size).toBe(0)
    })

    it('should serialize alarm store correctly', () => {
      const store = createAlarmStore()

      // Add recurring alarm
      store.alarms.set('test-alarm', {
        id: 'test-alarm',
        nextRun: Date.now() + 60000,
        recurring: true,
        interval: { type: 'hour' },
      })

      // Add one-time alarm
      store.oneTimeAlarms.set('one-time', {
        id: 'one-time',
        runAt: Date.now() + 30000,
        handlerRef: 'handler-ref',
      })

      const serialized = serializeAlarmStore(store)

      expect(serialized.alarms).toHaveLength(1)
      expect(serialized.alarms[0].id).toBe('test-alarm')
      expect(serialized.oneTimeAlarms).toHaveLength(1)
      expect(serialized.oneTimeAlarms[0].id).toBe('one-time')
    })

    it('should deserialize alarm store correctly', () => {
      const store = createAlarmStore()
      const data = {
        alarms: [
          { id: 'alarm-1', nextRun: Date.now() + 60000, recurring: true, interval: { type: 'hour' as const } },
          { id: 'alarm-2', nextRun: Date.now() + 120000, recurring: true, interval: { type: 'day' as const } },
        ],
        oneTimeAlarms: [
          { id: 'one-time-1', runAt: Date.now() + 30000, handlerRef: 'ref-1' },
        ],
      }

      deserializeAlarmStore(data, store)

      expect(store.alarms.size).toBe(2)
      expect(store.alarms.get('alarm-1')).toBeDefined()
      expect(store.alarms.get('alarm-2')).toBeDefined()
      expect(store.oneTimeAlarms.size).toBe(1)
      // Handlers should NOT be restored (documented limitation)
      expect(store.oneTimeHandlers.size).toBe(0)
    })

    it('should handle null/undefined data during deserialization', () => {
      const store = createAlarmStore()

      deserializeAlarmStore(null, store)
      expect(store.alarms.size).toBe(0)

      deserializeAlarmStore(undefined, store)
      expect(store.alarms.size).toBe(0)

      deserializeAlarmStore({}, store)
      expect(store.alarms.size).toBe(0)
    })
  })

  describe('calculateNextRunTime', () => {
    const baseTime = new Date('2026-01-20T10:00:00Z').getTime()

    it('should calculate next time for second intervals', () => {
      const next = calculateNextRunTime({ type: 'second', value: 30 }, baseTime)
      expect(next).toBe(baseTime + 30 * 1000)
    })

    it('should calculate next time for minute intervals', () => {
      const next = calculateNextRunTime({ type: 'minute', value: 5 }, baseTime)
      expect(next).toBe(baseTime + 5 * 60 * 1000)
    })

    it('should calculate next time for hour intervals', () => {
      const next = calculateNextRunTime({ type: 'hour', value: 2 }, baseTime)
      expect(next).toBe(baseTime + 2 * 60 * 60 * 1000)
    })

    it('should calculate next time for day intervals', () => {
      const next = calculateNextRunTime({ type: 'day', value: 3 }, baseTime)
      expect(next).toBe(baseTime + 3 * 24 * 60 * 60 * 1000)
    })

    it('should calculate next time for week intervals', () => {
      const next = calculateNextRunTime({ type: 'week', value: 1 }, baseTime)
      expect(next).toBe(baseTime + 7 * 24 * 60 * 60 * 1000)
    })

    it('should default to 1 if value not specified', () => {
      const next = calculateNextRunTime({ type: 'hour' }, baseTime)
      expect(next).toBe(baseTime + 1 * 60 * 60 * 1000)
    })

    it('should use cron expression when type is cron', () => {
      const next = calculateNextRunTime(
        { type: 'cron', expression: '0 * * * *' },
        baseTime
      )
      // Should be next hour boundary
      expect(next).toBeGreaterThan(baseTime)
    })
  })

  describe('calculateNextCronTime', () => {
    it('should calculate next hourly time', () => {
      const now = new Date('2026-01-20T10:30:00Z').getTime()
      const next = calculateNextCronTime('0 * * * *', now)

      const nextDate = new Date(next)
      expect(nextDate.getMinutes()).toBe(0)
      expect(next).toBeGreaterThan(now)
    })

    it('should handle every 15 minutes', () => {
      const now = new Date('2026-01-20T10:05:00Z').getTime()
      const next = calculateNextCronTime('*/15 * * * *', now)

      const nextDate = new Date(next)
      expect(nextDate.getMinutes() % 15).toBe(0)
      expect(next).toBeGreaterThan(now)
    })

    it('should handle specific days of week', () => {
      const now = new Date('2026-01-20T10:00:00Z').getTime() // Monday
      const next = calculateNextCronTime('0 9 * * 1', now) // Monday 9am

      const nextDate = new Date(next)
      expect(nextDate.getDay()).toBe(1) // Monday
      expect(nextDate.getHours()).toBe(9)
      expect(next).toBeGreaterThan(now)
    })

    it('should handle weekday ranges (1-5)', () => {
      const now = new Date('2026-01-18T22:00:00Z').getTime() // Saturday evening
      const next = calculateNextCronTime('0 8 * * 1-5', now)

      const nextDate = new Date(next)
      expect(nextDate.getDay()).toBeGreaterThanOrEqual(1)
      expect(nextDate.getDay()).toBeLessThanOrEqual(5)
      expect(nextDate.getHours()).toBe(8)
    })

    it('should handle lists in minute field', () => {
      const now = new Date('2026-01-20T10:05:00Z').getTime()
      const next = calculateNextCronTime('0,15,30,45 * * * *', now)

      const nextDate = new Date(next)
      expect([0, 15, 30, 45]).toContain(nextDate.getMinutes())
      expect(next).toBeGreaterThan(now)
    })

    it('should handle 6-part cron expressions with seconds', () => {
      const now = new Date('2026-01-20T10:00:30Z').getTime()
      const next = calculateNextCronTime('0 0 * * * *', now) // 0 seconds, 0 minutes

      expect(next).toBeGreaterThan(now)
    })
  })

  describe('calculateNextAlarmTime', () => {
    it('should return null for empty schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()

      const next = calculateNextAlarmTime(schedules, store)
      expect(next).toBeNull()
    })

    it('should return earliest time among multiple schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()
      const handler = async () => {}

      schedules.set('soon', {
        interval: { type: 'minute', value: 5 },
        handler,
        source: '',
      })
      schedules.set('later', {
        interval: { type: 'hour', value: 1 },
        handler,
        source: '',
      })

      const now = Date.now()
      const next = calculateNextAlarmTime(schedules, store)

      // Should be the 5-minute schedule (sooner)
      expect(next).not.toBeNull()
      expect(next!).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 1000)
    })

    it('should consider one-time alarms', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()
      const handler = async () => {}

      // Recurring schedule in 1 hour
      schedules.set('recurring', {
        interval: { type: 'hour', value: 1 },
        handler,
        source: '',
      })

      // One-time alarm in 5 minutes
      const now = Date.now()
      store.oneTimeAlarms.set('one-time', {
        id: 'one-time',
        runAt: now + 5 * 60 * 1000,
        handlerRef: 'ref',
      })

      const next = calculateNextAlarmTime(schedules, store)

      // Should pick the one-time alarm (sooner)
      expect(next).not.toBeNull()
      expect(next!).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 1000)
    })
  })

  describe('executeSchedules', () => {
    it('should execute all schedule handlers', async () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()
      const executed: string[] = []

      schedules.set('s1', {
        interval: { type: 'hour' },
        handler: async () => { executed.push('s1') },
        source: '',
      })
      schedules.set('s2', {
        interval: { type: 'hour' },
        handler: async () => { executed.push('s2') },
        source: '',
      })

      const results = await executeSchedules(schedules, store)

      expect(executed).toContain('s1')
      expect(executed).toContain('s2')
      expect(results).toHaveLength(2)
      expect(results.every(r => r.success)).toBe(true)
    })

    it('should handle handler errors gracefully', async () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()
      const executed: string[] = []

      schedules.set('failing', {
        interval: { type: 'hour' },
        handler: async () => { throw new Error('Test error') },
        source: '',
      })
      schedules.set('passing', {
        interval: { type: 'hour' },
        handler: async () => { executed.push('passing') },
        source: '',
      })

      const results = await executeSchedules(schedules, store)

      expect(executed).toContain('passing')
      expect(results).toHaveLength(2)
      expect(results.find(r => r.id === 'failing')?.success).toBe(false)
      expect(results.find(r => r.id === 'passing')?.success).toBe(true)
    })

    it('should update alarm metadata after execution', async () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const store = createAlarmStore()

      const schedule: ScheduleRegistration = {
        interval: { type: 'hour', value: 1 },
        handler: async () => {},
        source: '',
      }
      schedules.set('test', schedule)

      // Initialize metadata
      store.alarms.set('test', {
        id: 'test',
        nextRun: Date.now(),
        recurring: true,
        interval: { type: 'hour', value: 1 },
      })

      await executeSchedules(schedules, store)

      const metadata = store.alarms.get('test')
      expect(metadata?.lastRun).toBeDefined()
      expect(metadata?.nextRun).toBeGreaterThan(Date.now())
    })
  })

  describe('executeOneTimeAlarms', () => {
    it('should execute due one-time alarms', async () => {
      const store = createAlarmStore()
      let executed = false

      const now = Date.now()
      store.oneTimeAlarms.set('test', {
        id: 'test',
        runAt: now - 1000, // In the past (due)
        handlerRef: 'test',
      })
      store.oneTimeHandlers.set('test', async () => {
        executed = true
      })

      const results = await executeOneTimeAlarms(store)

      expect(executed).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
    })

    it('should not execute future one-time alarms', async () => {
      const store = createAlarmStore()
      let executed = false

      const now = Date.now()
      store.oneTimeAlarms.set('test', {
        id: 'test',
        runAt: now + 60000, // In the future
        handlerRef: 'test',
      })
      store.oneTimeHandlers.set('test', async () => {
        executed = true
      })

      const results = await executeOneTimeAlarms(store)

      expect(executed).toBe(false)
      expect(results).toHaveLength(0)
    })

    it('should remove one-time alarm after execution', async () => {
      const store = createAlarmStore()

      store.oneTimeAlarms.set('test', {
        id: 'test',
        runAt: Date.now() - 1000,
        handlerRef: 'test',
      })
      store.oneTimeHandlers.set('test', async () => {})

      await executeOneTimeAlarms(store)

      expect(store.oneTimeAlarms.has('test')).toBe(false)
      expect(store.oneTimeHandlers.has('test')).toBe(false)
    })

    it('should handle missing handlers gracefully (silent failure)', async () => {
      const store = createAlarmStore()

      // Alarm metadata but no handler (simulates DO restart)
      store.oneTimeAlarms.set('orphaned', {
        id: 'orphaned',
        runAt: Date.now() - 1000,
        handlerRef: 'orphaned',
      })
      // Note: NOT setting oneTimeHandlers

      const results = await executeOneTimeAlarms(store)

      // Should return empty (handler not found, silently skipped)
      expect(results).toHaveLength(0)
      // Alarm should be cleaned up
      expect(store.oneTimeAlarms.has('orphaned')).toBe(false)
    })
  })
})

// ============================================================================
// SECTION 2: WORKFLOWCONTEXT METHODS TESTS
// ============================================================================

describe('WorkflowContext Methods', () => {
  let $: WorkflowContext
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = {
      id: { toString: () => 'test-context-id' } as DurableObjectId,
      storage: {
        get: async () => undefined,
        put: async () => {},
        list: async () => new Map(),
        delete: async () => true,
        deleteAll: async () => {},
      },
      blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
      waitUntil: () => {},
    } as unknown as DurableObjectState

    $ = createContext(mockState, {})
  })

  describe('send() - Fire-and-forget events', () => {
    it('should emit events asynchronously', async () => {
      $.send({ type: 'test.event', payload: { data: 'test' } })

      await new Promise(r => setTimeout(r, 50))

      const events = await $._events.query({ type: 'test.event' })
      expect(events).toHaveLength(1)
      expect(events[0].payload).toEqual({ data: 'test' })
    })

    it('should invoke registered handlers', async () => {
      let handlerCalled = false

      $.on.test.event(() => {
        handlerCalled = true
      })

      $.send({ type: 'test.event' })

      await new Promise(r => setTimeout(r, 50))
      expect(handlerCalled).toBe(true)
    })

    it('should support wildcard handlers', async () => {
      let nounWildcardCalled = false
      let verbWildcardCalled = false
      let globalWildcardCalled = false

      $.on.test['*'](() => { nounWildcardCalled = true })
      $.on['*'].event(() => { verbWildcardCalled = true })
      $.on['*']['*'](() => { globalWildcardCalled = true })

      $.send({ type: 'test.event' })

      await new Promise(r => setTimeout(r, 100))

      expect(nounWildcardCalled).toBe(true)
      expect(verbWildcardCalled).toBe(true)
      expect(globalWildcardCalled).toBe(true)
    })

    it('should not throw when handlers error', async () => {
      $.on.test.event(() => {
        throw new Error('Handler error')
      })

      // Should not throw
      $.send({ type: 'test.event' })

      await new Promise(r => setTimeout(r, 50))
      // Test passes if no exception thrown
    })
  })

  describe('try() - Single attempt', () => {
    it('should execute action and return result', async () => {
      const result = await $.try(async () => 'success')
      expect(result).toBe('success')
    })

    it('should propagate errors without retries', async () => {
      let attempts = 0

      await expect($.try(async () => {
        attempts++
        throw new Error('Test error')
      })).rejects.toThrow('Test error')

      expect(attempts).toBe(1)
    })

    it('should work with synchronous-like async actions', async () => {
      const result = await $.try(async () => {
        return 42
      })
      expect(result).toBe(42)
    })
  })

  describe('do() - Durable with retries', () => {
    it('should succeed on first attempt if no errors', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        return 'success'
      })

      expect(result).toBe('success')
      expect(attempts).toBe(1)
    })

    it('should retry on transient errors', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Transient error')
          ;(error as any).retryable = true
          throw error
        }
        return 'success after retries'
      }, { retries: 5 })

      expect(result).toBe('success after retries')
      expect(attempts).toBe(3)
    })

    it('should fail after max retries', async () => {
      let attempts = 0

      await expect($.do(async () => {
        attempts++
        const error = new Error('Always fails')
        ;(error as any).retryable = true
        throw error
      }, { retries: 2 })).rejects.toThrow('Always fails')

      expect(attempts).toBe(3) // Initial + 2 retries
    })

    it('should respect timeout option', async () => {
      await expect($.do(async () => {
        await new Promise(r => setTimeout(r, 1000))
        return 'done'
      }, { timeout: 50, retries: 0 })).rejects.toThrow('timed out')
    })

    it('should use exponential backoff by default', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        const error = new Error('fail')
        ;(error as any).retryable = true
        throw error
      }, { retries: 2, backoff: 'exponential' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Verify delays increase
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms
      }
      if (timestamps.length >= 3) {
        const gap2 = timestamps[2] - timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms (exponential)
      }
    })

    it('should support linear backoff', async () => {
      let attempts = 0
      const timestamps: number[] = []

      await expect($.do(async () => {
        timestamps.push(Date.now())
        attempts++
        const error = new Error('fail')
        ;(error as any).retryable = true
        throw error
      }, { retries: 2, backoff: 'linear' })).rejects.toThrow()

      expect(attempts).toBe(3)
      // Linear backoff uses consistent delays
    })
  })

  describe('on - Event handler registration', () => {
    it('should register handlers via Proxy', () => {
      const handler = () => {}
      $.on.Customer.signup(handler)

      expect($._handlers.get('Customer.signup')).toContain(handler)
    })

    it('should support multiple handlers for same event', () => {
      const h1 = () => {}
      const h2 = () => {}

      $.on.Order.placed(h1)
      $.on.Order.placed(h2)

      expect($._handlers.get('Order.placed')).toHaveLength(2)
    })

    it('should support any noun/verb combination', () => {
      $.on.CustomEntity.customVerb(() => {})
      $.on.AnotherThing.anotherAction(() => {})

      expect($._handlers.has('CustomEntity.customVerb')).toBe(true)
      expect($._handlers.has('AnotherThing.anotherAction')).toBe(true)
    })
  })

  describe('every - Scheduling DSL', () => {
    it('should have every proxy available', () => {
      expect($.every).toBeDefined()
    })

    it('should register schedules', () => {
      $.every.hour(async () => {})

      expect($._schedules.size).toBe(1)
    })

    it('should support various patterns', () => {
      $.every.minute(async () => {})
      $.every.day(async () => {})
      $.every.Monday(async () => {})
      $.every(5).minutes(async () => {})

      expect($._schedules.size).toBe(4)
    })
  })

  describe('Internal state', () => {
    it('should have _events store', () => {
      expect($._events).toBeDefined()
      expect(typeof $._events.emit).toBe('function')
    })

    it('should have _handlers map', () => {
      expect($._handlers).toBeInstanceOf(Map)
    })

    it('should have _schedules map', () => {
      expect($._schedules).toBeInstanceOf(Map)
    })

    it('should have _stubCache map', () => {
      expect($._stubCache).toBeInstanceOf(Map)
    })
  })
})

// ============================================================================
// SECTION 3: EVENT SYSTEM PUB/SUB TESTS
// ============================================================================

describe('Event System Pub/Sub', () => {
  let eventSystem: EventSystem

  beforeEach(() => {
    eventSystem = new EventSystem()
  })

  describe('Handler Registration', () => {
    it('should register handlers via on.Noun.verb pattern', () => {
      eventSystem.on.Customer.signup(() => {})

      expect(eventSystem.getHandlerCount('Customer.signup')).toBe(1)
      expect(eventSystem.hasHandlers('Customer.signup')).toBe(true)
    })

    it('should support wildcard noun handlers', () => {
      eventSystem.on['*'].created(() => {})

      expect(eventSystem.hasHandlers('*.created')).toBe(true)
      expect(eventSystem.hasMatchingHandlers('Customer.created')).toBe(true)
      expect(eventSystem.hasMatchingHandlers('Order.created')).toBe(true)
    })

    it('should support wildcard verb handlers', () => {
      eventSystem.on.Customer['*'](() => {})

      expect(eventSystem.hasHandlers('Customer.*')).toBe(true)
      expect(eventSystem.hasMatchingHandlers('Customer.signup')).toBe(true)
      expect(eventSystem.hasMatchingHandlers('Customer.deleted')).toBe(true)
    })

    it('should support global wildcard handlers', () => {
      eventSystem.on['*']['*'](() => {})

      expect(eventSystem.hasHandlers('*.*')).toBe(true)
      expect(eventSystem.hasMatchingHandlers('Any.event')).toBe(true)
    })

    it('should track total handler count', () => {
      eventSystem.on.Order.placed(() => {})
      eventSystem.on.Order.placed(() => {})
      eventSystem.on.Customer.signup(() => {})

      expect(eventSystem.getTotalHandlerCount()).toBe(3)
    })
  })

  describe('Event Emission', () => {
    it('should invoke handlers on emit', async () => {
      const handler = vi.fn()
      eventSystem.on.Order.placed(handler)

      await eventSystem.emit({ type: 'Order.placed', data: { orderId: '123' } })

      expect(handler).toHaveBeenCalled()
    })

    it('should invoke all matching handlers', async () => {
      const exactHandler = vi.fn()
      const wildcardHandler = vi.fn()
      const globalHandler = vi.fn()

      eventSystem.on.Order.placed(exactHandler)
      eventSystem.on.Order['*'](wildcardHandler)
      eventSystem.on['*']['*'](globalHandler)

      await eventSystem.emit({ type: 'Order.placed' })

      expect(exactHandler).toHaveBeenCalled()
      expect(wildcardHandler).toHaveBeenCalled()
      expect(globalHandler).toHaveBeenCalled()
    })

    it('should pass event data to handlers', async () => {
      let receivedEvent: EventPayload | null = null
      eventSystem.on.Test.event((event) => {
        receivedEvent = event as EventPayload
      })

      await eventSystem.emit({ type: 'Test.event', data: { key: 'value' } })

      expect(receivedEvent).toBeDefined()
      expect(receivedEvent!.data).toEqual({ key: 'value' })
    })

    it('should return invocation results', async () => {
      const success = vi.fn()
      const failure = vi.fn(() => { throw new Error('Handler failed') })

      eventSystem.on.Test.event(success)
      eventSystem.on.Test.event(failure)

      const result = await eventSystem.emit({ type: 'Test.event' })

      expect(result.succeeded).toHaveLength(1)
      expect(result.failed).toHaveLength(1)
    })

    it('should support async handlers', async () => {
      let asyncCompleted = false
      eventSystem.on.Async.handler(async () => {
        await new Promise(r => setTimeout(r, 10))
        asyncCompleted = true
      })

      await eventSystem.emit({ type: 'Async.handler' })

      expect(asyncCompleted).toBe(true)
    })
  })

  describe('Emit Listeners', () => {
    it('should notify listeners before handlers', async () => {
      const order: string[] = []

      eventSystem.onEmit(() => {
        order.push('listener')
      })

      eventSystem.on.Test.event(() => {
        order.push('handler')
      })

      await eventSystem.emit({ type: 'Test.event' })

      expect(order).toEqual(['listener', 'handler'])
    })

    it('should support unsubscribing', async () => {
      const listener = vi.fn()
      const unsubscribe = eventSystem.onEmit(listener)

      await eventSystem.emit({ type: 'Test.first' })
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()

      await eventSystem.emit({ type: 'Test.second' })
      expect(listener).toHaveBeenCalledTimes(1) // Still 1
    })

    it('should continue if listener throws', async () => {
      const handler = vi.fn()

      eventSystem.onEmit(() => {
        throw new Error('Listener error')
      })
      eventSystem.on.Test.event(handler)

      await eventSystem.emit({ type: 'Test.event' })

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Handler Matching', () => {
    it('should return exact match handlers', () => {
      const handler = vi.fn()
      eventSystem.on.Customer.signup(handler)

      const handlers = eventSystem.getMatchingHandlers('Customer.signup')
      expect(handlers).toContain(handler)
    })

    it('should match in order of specificity', () => {
      const exact = vi.fn()
      const nounWild = vi.fn()
      const verbWild = vi.fn()
      const global = vi.fn()

      eventSystem.on.Customer.signup(exact)
      eventSystem.on.Customer['*'](nounWild)
      eventSystem.on['*'].signup(verbWild)
      eventSystem.on['*']['*'](global)

      const handlers = eventSystem.getMatchingHandlers('Customer.signup')

      expect(handlers).toContain(exact)
      expect(handlers).toContain(nounWild)
      expect(handlers).toContain(verbWild)
      expect(handlers).toContain(global)
    })
  })

  describe('Handler Management', () => {
    it('should clear handlers for specific event', () => {
      eventSystem.on.Order.placed(() => {})
      eventSystem.on.Customer.signup(() => {})

      eventSystem.clearHandlers('Order.placed')

      expect(eventSystem.hasHandlers('Order.placed')).toBe(false)
      expect(eventSystem.hasHandlers('Customer.signup')).toBe(true)
    })

    it('should clear all handlers', () => {
      eventSystem.on.Order.placed(() => {})
      eventSystem.on.Customer.signup(() => {})

      eventSystem.clearAllHandlers()

      expect(eventSystem.getTotalHandlerCount()).toBe(0)
    })

    it('should list all event types', () => {
      eventSystem.on.Order.placed(() => {})
      eventSystem.on.Customer.signup(() => {})
      eventSystem.on['*'].created(() => {})

      const types = eventSystem.getEventTypes()

      expect(types).toContain('Order.placed')
      expect(types).toContain('Customer.signup')
      expect(types).toContain('*.created')
    })
  })

  describe('Retry Configuration', () => {
    it('should have default retry options', () => {
      const defaults = eventSystem.getDefaultRetryOptions()

      expect(defaults.maxRetries).toBe(5)
      expect(defaults.backoff).toBe('exponential')
      expect(defaults.initialDelay).toBe(100)
    })

    it('should allow setting default retry options', () => {
      eventSystem.setDefaultRetryOptions({
        maxRetries: 3,
        backoff: 'linear',
        initialDelay: 50,
      })

      const defaults = eventSystem.getDefaultRetryOptions()

      expect(defaults.maxRetries).toBe(3)
      expect(defaults.backoff).toBe('linear')
      expect(defaults.initialDelay).toBe(50)
    })

    it('should accept custom retry options on emit', async () => {
      let attempts = 0
      eventSystem.on.Test.event(() => {
        attempts++
        if (attempts < 3) {
          const error = new Error('Transient')
          ;(error as any).retriable = true
          throw error
        }
      })

      await eventSystem.emit(
        { type: 'Test.event' },
        { maxRetries: 3, backoff: 'linear', initialDelay: 10 }
      )

      expect(attempts).toBe(3)
    })
  })

  describe('Factory Function', () => {
    it('should create EventSystem via createEventSystem()', () => {
      const es = createEventSystem()
      expect(es).toBeInstanceOf(EventSystem)
    })

    it('should accept options in factory', () => {
      const es = createEventSystem({
        defaultRetryOptions: {
          maxRetries: 10,
        },
      })

      expect(es.getDefaultRetryOptions().maxRetries).toBe(10)
    })
  })
})

// ============================================================================
// SECTION 4: SCHEDULE DSL PARSING TESTS
// ============================================================================

describe('Schedule DSL Parsing', () => {
  let schedules: Map<string, ScheduleRegistration>
  let every: ReturnType<typeof createEveryProxy>

  beforeEach(() => {
    schedules = new Map()
    every = createEveryProxy(schedules)
  })

  describe('Time Unit Patterns', () => {
    it('should parse every.second', () => {
      every.second(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('* * * * * *')
    })

    it('should parse every.minute', () => {
      every.minute(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('* * * * *')
    })

    it('should parse every.hour', () => {
      every.hour(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 * * * *')
    })

    it('should parse every.day', () => {
      every.day(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * *')
    })

    it('should parse every.week', () => {
      every.week(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 0')
    })
  })

  describe('Day of Week Patterns', () => {
    it('should parse every.Monday', () => {
      every.Monday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 1')
    })

    it('should parse every.Friday', () => {
      every.Friday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 5')
    })

    it('should parse every.Sunday', () => {
      every.Sunday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 0')
    })

    it('should parse every.weekday', () => {
      every.weekday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 1-5')
    })

    it('should parse every.weekend', () => {
      every.weekend(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * 0,6')
    })
  })

  describe('Time-specific Patterns', () => {
    it('should parse every.Monday.at9am', () => {
      every.Monday.at9am(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 9 * * 1')
      expect(schedule.interval.natural).toBe('Monday.at9am')
    })

    it('should parse every.Friday.at5pm', () => {
      every.Friday.at5pm(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 17 * * 5')
    })

    it('should parse every.day.at("6pm")', () => {
      every.day.at('6pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 18 * * *')
    })

    it('should parse every.Monday.at("3:45pm")', () => {
      every.Monday.at('3:45pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('45 15 * * 1')
    })

    it('should parse midnight time', () => {
      every.day.atmidnight(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 0 * * *')
    })

    it('should parse noon time', () => {
      every.day.atnoon(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 12 * * *')
    })
  })

  describe('Numeric Interval Patterns', () => {
    it('should parse every(5).minutes', () => {
      every(5).minutes(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.type).toBe('minute')
      expect(schedule.interval.value).toBe(5)
      expect(schedule.interval.natural).toBe('5 minutes')
    })

    it('should parse every(30).seconds', () => {
      every(30).seconds(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.type).toBe('second')
      expect(schedule.interval.value).toBe(30)
    })

    it('should parse every(2).hours', () => {
      every(2).hours(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.type).toBe('hour')
      expect(schedule.interval.value).toBe(2)
    })

    it('should parse every(3).days', () => {
      every(3).days(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.type).toBe('day')
      expect(schedule.interval.value).toBe(3)
    })

    it('should parse every(2).weeks', () => {
      every(2).weeks(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.type).toBe('week')
      expect(schedule.interval.value).toBe(2)
    })
  })

  describe('Complex Patterns', () => {
    it('should parse every.week.on.Friday.at("3pm")', () => {
      every.week.on.Friday.at('3pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 15 * * 5')
    })

    it('should parse every.weekday.at8am', () => {
      every.weekday.at8am(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval.expression).toBe('0 8 * * 1-5')
    })
  })

  describe('Helper Functions', () => {
    it('should get all registered schedules', () => {
      every.hour(async () => {})
      every.day(async () => {})

      const result = getSchedules(schedules)
      expect(result).toHaveLength(2)
    })

    it('should get schedule count', () => {
      expect(getScheduleCount(schedules)).toBe(0)

      every.hour(async () => {})
      expect(getScheduleCount(schedules)).toBe(1)

      every.day(async () => {})
      expect(getScheduleCount(schedules)).toBe(2)
    })

    it('should clear all schedules', () => {
      every.hour(async () => {})
      every.day(async () => {})

      clearSchedules(schedules)

      expect(schedules.size).toBe(0)
    })

    it('should execute specific schedule by ID', async () => {
      let executed = false
      every.hour(async () => { executed = true })

      const scheduleId = Array.from(schedules.keys())[0]
      await executeSchedule(scheduleId, schedules)

      expect(executed).toBe(true)
    })

    it('should throw on non-existent schedule ID', async () => {
      await expect(executeSchedule('non-existent', schedules)).rejects.toThrow('Schedule not found')
    })
  })

  describe('Time String Validation', () => {
    it('should validate valid time strings', () => {
      expect(() => validateTimeString('9am')).not.toThrow()
      expect(() => validateTimeString('3:45pm')).not.toThrow()
      expect(() => validateTimeString('15:30')).not.toThrow()
      expect(() => validateTimeString('12:00am')).not.toThrow()
    })

    it('should reject invalid time strings', () => {
      expect(() => validateTimeString('invalid')).toThrow()
      expect(() => validateTimeString('25:00')).toThrow()
      expect(() => validateTimeString('13:00am')).toThrow()
      expect(() => validateTimeString('')).toThrow()
    })

    it('should reject injection attempts', () => {
      expect(() => validateTimeString('9am; rm -rf /')).toThrow()
      expect(() => validateTimeString('9am && cat /etc/passwd')).toThrow()
      expect(() => validateTimeString('$HOME/9am')).toThrow()
    })

    it('should parse 12-hour format correctly', () => {
      expect(validateTimeString('12:00am')).toEqual({ hour: 0, minute: 0 })
      expect(validateTimeString('12:00pm')).toEqual({ hour: 12, minute: 0 })
      expect(validateTimeString('11:59pm')).toEqual({ hour: 23, minute: 59 })
    })

    it('should parse 24-hour format correctly', () => {
      expect(validateTimeString('00:00')).toEqual({ hour: 0, minute: 0 })
      expect(validateTimeString('23:59')).toEqual({ hour: 23, minute: 59 })
      expect(validateTimeString('15:30')).toEqual({ hour: 15, minute: 30 })
    })
  })

  describe('CRON Expression Validation', () => {
    it('should validate valid CRON expressions', () => {
      expect(() => validateCronExpression('0 9 * * 1')).not.toThrow()
      expect(() => validateCronExpression('*/15 * * * *')).not.toThrow()
      expect(() => validateCronExpression('0 0 1 * *')).not.toThrow()
      expect(() => validateCronExpression('0,30 9-17 * * *')).not.toThrow()
    })

    it('should reject invalid field counts', () => {
      expect(() => validateCronExpression('0 9 * *')).toThrow() // 4 fields
      expect(() => validateCronExpression('0 9 * * * *')).toThrow() // 6 fields
    })

    it('should reject out-of-range values', () => {
      expect(() => validateCronExpression('60 9 * * *')).toThrow() // minute > 59
      expect(() => validateCronExpression('0 25 * * *')).toThrow() // hour > 23
      expect(() => validateCronExpression('0 9 32 * *')).toThrow() // day > 31
      expect(() => validateCronExpression('0 9 * 13 *')).toThrow() // month > 12
      expect(() => validateCronExpression('0 9 * * 8')).toThrow() // weekday > 7
    })

    it('should reject injection attempts', () => {
      expect(() => validateCronExpression('0 9 * * * ; rm -rf /')).toThrow()
      expect(() => validateCronExpression('$(whoami) 9 * * *')).toThrow()
    })
  })

  describe('CRON Field Validation', () => {
    it('should validate wildcards', () => {
      expect(() => validateCronField('minute', '*')).not.toThrow()
      expect(() => validateCronField('hour', '*')).not.toThrow()
    })

    it('should validate ranges', () => {
      expect(() => validateCronField('minute', '0-30')).not.toThrow()
      expect(() => validateCronField('hour', '9-17')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '1-5')).not.toThrow()
    })

    it('should reject invalid ranges', () => {
      expect(() => validateCronField('minute', '30-10')).toThrow() // end < start
      expect(() => validateCronField('minute', '-5-10')).toThrow() // negative
    })

    it('should validate steps', () => {
      expect(() => validateCronField('minute', '*/5')).not.toThrow()
      expect(() => validateCronField('hour', '*/2')).not.toThrow()
    })

    it('should reject invalid steps', () => {
      expect(() => validateCronField('minute', '*/0')).toThrow() // zero step
      expect(() => validateCronField('minute', '*/-1')).toThrow() // negative step
    })

    it('should validate lists', () => {
      expect(() => validateCronField('minute', '0,15,30,45')).not.toThrow()
      expect(() => validateCronField('dayOfWeek', '1,3,5')).not.toThrow()
    })

    it('should reject invalid lists', () => {
      expect(() => validateCronField('minute', '0,60,30')).toThrow() // out of range
      expect(() => validateCronField('minute', '0,,30')).toThrow() // empty item
    })
  })

  describe('Dangerous Pattern Detection', () => {
    it('should detect shell metacharacters', () => {
      expect(containsDangerousPatterns(';')).toBe(true)
      expect(containsDangerousPatterns('&')).toBe(true)
      expect(containsDangerousPatterns('|')).toBe(true)
      expect(containsDangerousPatterns('`')).toBe(true)
      expect(containsDangerousPatterns('$')).toBe(true)
    })

    it('should detect control characters', () => {
      expect(containsDangerousPatterns('\x00')).toBe(true) // null byte
      expect(containsDangerousPatterns('\x1f')).toBe(true) // control char
    })

    it('should detect unicode injection', () => {
      expect(containsDangerousPatterns('\u200B')).toBe(true) // zero-width space
      expect(containsDangerousPatterns('\u202E')).toBe(true) // RTL override
    })

    it('should allow safe characters', () => {
      expect(containsDangerousPatterns('0 9 * * 1')).toBe(false)
      expect(containsDangerousPatterns('*/15')).toBe(false)
      expect(containsDangerousPatterns('1-5')).toBe(false)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Real DO via Miniflare
// ============================================================================

describe('Integration Tests - Real DO', () => {
  function generateTestId(): string {
    return `workflow-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  describe('Schedule registration in real DO', () => {
    it('should register schedules via $.every in real DO context', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})
        $.every.day(async () => {})

        return getScheduleCount($._schedules)
      })

      expect(scheduleCount).toBe(2)
    })

    it('should execute handlers when alarm fires', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const executed = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let wasExecuted = false

        $.every.hour(async () => {
          wasExecuted = true
        })

        await instance.alarm()

        return wasExecuted
      })

      expect(executed).toBe(true)
    })
  })

  describe('Event handling in real DO', () => {
    it('should register and invoke event handlers', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let eventReceived = false

        $.on.Test.event(() => {
          eventReceived = true
        })

        $.send({ type: 'Test.event', payload: { data: 'test' } })

        // Wait for async processing
        await new Promise(r => setTimeout(r, 50))

        return eventReceived
      })

      expect(result).toBe(true)
    })
  })
})
