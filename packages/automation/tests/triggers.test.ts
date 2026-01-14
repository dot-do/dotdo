/**
 * @dotdo/automation - Triggers Tests
 *
 * Tests for n8n-compatible trigger nodes including:
 * - Webhook triggers (HTTP endpoints that receive data)
 * - Cron triggers (scheduled execution)
 * - Polling triggers (periodically check for changes)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WebhookTrigger,
  CronTrigger,
  PollingTrigger,
  type TriggerEvent,
} from '../src'

describe('Automation Triggers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================================
  // WEBHOOK TRIGGER
  // ============================================================================

  describe('WebhookTrigger', () => {
    it('should create a webhook trigger with path', () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/order-created',
        method: 'POST',
      })

      expect(trigger.path).toBe('/webhook/order-created')
      expect(trigger.method).toBe('POST')
    })

    it('should default to POST method', () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/test',
      })

      expect(trigger.method).toBe('POST')
    })

    it('should support GET, POST, PUT, DELETE methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE'] as const

      for (const method of methods) {
        const trigger = new WebhookTrigger({
          path: '/test',
          method,
        })
        expect(trigger.method).toBe(method)
      }
    })

    it('should handle incoming webhook request', async () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/data',
        method: 'POST',
      })

      const request = new Request('http://localhost/webhook/data', {
        method: 'POST',
        body: JSON.stringify({ orderId: '123', amount: 99.99 }),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await trigger.handleRequest(request)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ orderId: '123', amount: 99.99 })
    })

    it('should support query parameters', async () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/callback',
        method: 'GET',
      })

      const request = new Request('http://localhost/webhook/callback?code=abc123&state=xyz')

      const result = await trigger.handleRequest(request)

      expect(result.success).toBe(true)
      expect(result.query).toEqual({ code: 'abc123', state: 'xyz' })
    })

    it('should extract headers from request', async () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/test',
        method: 'POST',
      })

      const request = new Request('http://localhost/webhook/test', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
      })

      const result = await trigger.handleRequest(request)

      expect(result.headers?.['x-custom-header']).toBe('custom-value')
    })

    it('should support authentication validation', async () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/secure',
        method: 'POST',
        authentication: {
          type: 'header',
          header: 'X-API-Key',
          value: 'secret-key-123',
        },
      })

      // Valid request
      const validRequest = new Request('http://localhost/webhook/secure', {
        method: 'POST',
        body: '{}',
        headers: { 'X-API-Key': 'secret-key-123' },
      })

      const validResult = await trigger.handleRequest(validRequest)
      expect(validResult.success).toBe(true)

      // Invalid request
      const invalidRequest = new Request('http://localhost/webhook/secure', {
        method: 'POST',
        body: '{}',
        headers: { 'X-API-Key': 'wrong-key' },
      })

      const invalidResult = await trigger.handleRequest(invalidRequest)
      expect(invalidResult.success).toBe(false)
      expect(invalidResult.error).toContain('authentication')
    })

    it('should emit trigger event', async () => {
      const trigger = new WebhookTrigger({
        path: '/webhook/event',
        method: 'POST',
      })

      const events: TriggerEvent[] = []
      trigger.onTrigger((event) => events.push(event))

      await trigger.handleRequest(
        new Request('http://localhost/webhook/event', {
          method: 'POST',
          body: JSON.stringify({ test: true }),
        })
      )

      expect(events).toHaveLength(1)
      expect(events[0].data).toEqual({ test: true })
      expect(events[0].source).toBe('webhook')
    })
  })

  // ============================================================================
  // CRON TRIGGER
  // ============================================================================

  describe('CronTrigger', () => {
    it('should create a cron trigger with expression', () => {
      const trigger = new CronTrigger({
        expression: '0 9 * * MON',
        timezone: 'America/Los_Angeles',
      })

      expect(trigger.expression).toBe('0 9 * * MON')
      expect(trigger.timezone).toBe('America/Los_Angeles')
    })

    it('should default to UTC timezone', () => {
      const trigger = new CronTrigger({
        expression: '*/5 * * * *',
      })

      expect(trigger.timezone).toBe('UTC')
    })

    it('should parse common cron expressions', () => {
      const expressions = [
        { expr: '*/5 * * * *', desc: 'Every 5 minutes' },
        { expr: '0 * * * *', desc: 'Every hour' },
        { expr: '0 0 * * *', desc: 'Every day at midnight' },
        { expr: '0 9 * * MON-FRI', desc: 'Weekdays at 9am' },
        { expr: '0 0 1 * *', desc: 'First of every month' },
      ]

      for (const { expr } of expressions) {
        const trigger = new CronTrigger({ expression: expr })
        expect(trigger.isValid()).toBe(true)
      }
    })

    it('should calculate next execution time', () => {
      const trigger = new CronTrigger({
        expression: '0 9 * * *', // 9am daily
        timezone: 'UTC',
      })

      const now = new Date('2024-01-15T08:00:00Z')
      const next = trigger.getNextExecution(now)

      expect(next.getUTCHours()).toBe(9)
      expect(next.getUTCMinutes()).toBe(0)
    })

    it('should support start and stop', () => {
      const trigger = new CronTrigger({
        expression: '0 * * * *',
      })

      expect(trigger.isRunning()).toBe(false)

      trigger.start()
      expect(trigger.isRunning()).toBe(true)

      trigger.stop()
      expect(trigger.isRunning()).toBe(false)
    })

    it('should reject invalid cron expressions', () => {
      expect(() => {
        new CronTrigger({
          expression: 'invalid-cron',
        })
      }).toThrow()
    })
  })

  // ============================================================================
  // POLLING TRIGGER
  // ============================================================================

  describe('PollingTrigger', () => {
    it('should create a polling trigger with interval', () => {
      const trigger = new PollingTrigger({
        interval: '5m',
        pollFunction: async () => ({ data: [] }),
      })

      expect(trigger.interval).toBe('5m')
    })

    it('should parse interval durations', () => {
      const intervals = [
        { input: '30s', ms: 30000 },
        { input: '5m', ms: 300000 },
        { input: '1h', ms: 3600000 },
        { input: '1d', ms: 86400000 },
      ]

      for (const { input, ms } of intervals) {
        const trigger = new PollingTrigger({
          interval: input,
          pollFunction: async () => ({ data: [] }),
        })
        expect(trigger.getIntervalMs()).toBe(ms)
      }
    })

    it('should execute poll function at interval', async () => {
      let pollCount = 0

      const trigger = new PollingTrigger({
        interval: '1m',
        pollFunction: async () => {
          pollCount++
          return { data: [{ id: pollCount }] }
        },
      })

      trigger.start()

      // Initial poll
      await vi.advanceTimersByTimeAsync(100)
      expect(pollCount).toBe(1)

      // After 1 minute
      await vi.advanceTimersByTimeAsync(60 * 1000)
      expect(pollCount).toBe(2)

      trigger.stop()
    })

    it('should emit events for new items', async () => {
      let pollCount = 0
      const events: TriggerEvent[] = []

      const trigger = new PollingTrigger({
        interval: '1m',
        pollFunction: async () => {
          pollCount++
          return {
            data: [{ id: `item-${pollCount}` }],
          }
        },
      })

      trigger.onTrigger((event) => events.push(event))
      trigger.start()

      await vi.advanceTimersByTimeAsync(100)

      expect(events).toHaveLength(1)
      expect(events[0].data).toEqual([{ id: 'item-1' }])
      expect(events[0].source).toBe('polling')

      trigger.stop()
    })

    it('should deduplicate items using key function', async () => {
      let pollCount = 0
      const events: TriggerEvent[] = []

      const trigger = new PollingTrigger({
        interval: '1m',
        pollFunction: async () => {
          pollCount++
          // Return same item on subsequent polls
          return {
            data: [
              { id: 'same-item', value: pollCount },
            ],
          }
        },
        deduplicationKey: (item) => (item as { id: string }).id,
      })

      trigger.onTrigger((event) => events.push(event))
      trigger.start()

      // First poll
      await vi.advanceTimersByTimeAsync(100)
      expect(events).toHaveLength(1)

      // Second poll - same item should be deduplicated
      await vi.advanceTimersByTimeAsync(60 * 1000)
      expect(events).toHaveLength(1) // Still 1, not 2

      trigger.stop()
    })
  })

  // ============================================================================
  // TRIGGER LIFECYCLE
  // ============================================================================

  describe('Trigger Lifecycle', () => {
    it('should support multiple listeners', async () => {
      const trigger = new WebhookTrigger({
        path: '/test',
        method: 'POST',
      })

      const events1: TriggerEvent[] = []
      const events2: TriggerEvent[] = []

      trigger.onTrigger((e) => events1.push(e))
      trigger.onTrigger((e) => events2.push(e))

      await trigger.handleRequest(
        new Request('http://localhost/test', {
          method: 'POST',
          body: '{"test": true}',
        })
      )

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(1)
    })

    it('should allow unsubscribing from events', async () => {
      const trigger = new WebhookTrigger({
        path: '/test',
        method: 'POST',
      })

      const events: TriggerEvent[] = []
      const unsubscribe = trigger.onTrigger((e) => events.push(e))

      await trigger.handleRequest(
        new Request('http://localhost/test', {
          method: 'POST',
          body: '{"first": true}',
        })
      )

      unsubscribe()

      await trigger.handleRequest(
        new Request('http://localhost/test', {
          method: 'POST',
          body: '{"second": true}',
        })
      )

      expect(events).toHaveLength(1)
      expect(events[0].data).toEqual({ first: true })
    })

    it('should generate unique trigger IDs', () => {
      const trigger1 = new WebhookTrigger({ path: '/test1', method: 'POST' })
      const trigger2 = new WebhookTrigger({ path: '/test2', method: 'POST' })

      expect(trigger1.id).toBeDefined()
      expect(trigger2.id).toBeDefined()
      expect(trigger1.id).not.toBe(trigger2.id)
    })
  })
})
