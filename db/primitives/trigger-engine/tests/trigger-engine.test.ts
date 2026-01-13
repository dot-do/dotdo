/**
 * TriggerEngine tests
 *
 * TDD RED phase: These tests define the expected behavior of TriggerEngine.
 * TriggerEngine provides a unified trigger system for automation:
 * - WebhookReceiver - Inbound webhook handling with signature validation
 * - PollingScheduler - Rate-limited polling with state tracking
 * - EventBus - DO-native pub/sub with filtering
 * - TriggerRegistry - Register/unregister/list triggers
 *
 * @module db/primitives/trigger-engine/tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createTriggerEngine,
  type TriggerEngine,
  type TriggerConfig,
  type WebhookTriggerConfig,
  type PollingTriggerConfig,
  type EventTriggerConfig,
  type ScheduleTriggerConfig,
  type TriggerEvent,
  type TriggerStatus,
  type SignatureValidator,
  type WebhookPayload,
  type PollingResult,
  type TriggerEngineOptions,
} from '../index'
import { TestMetricsCollector } from '../../observability'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestEngine(options?: TriggerEngineOptions): TriggerEngine {
  return createTriggerEngine(options)
}

/**
 * Helper to wait for a short duration
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Helper to collect events from a trigger
 */
async function collectEvents(
  engine: TriggerEngine,
  triggerId: string,
  count: number,
  timeoutMs: number = 1000
): Promise<TriggerEvent[]> {
  const events: TriggerEvent[] = []
  const iterator = engine.subscribe(triggerId)
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout collecting events')), timeoutMs)
  )

  try {
    for (let i = 0; i < count; i++) {
      const result = await Promise.race([iterator.next(), timeoutPromise])
      if (result.done) break
      events.push(result.value)
    }
  } catch {
    // Timeout - return what we have
  }

  return events
}

// ============================================================================
// TRIGGER ENGINE CORE
// ============================================================================

describe('TriggerEngine', () => {
  describe('core functionality', () => {
    it('should create a trigger engine instance', () => {
      const engine = createTestEngine()

      expect(engine).toBeDefined()
      expect(typeof engine.register).toBe('function')
      expect(typeof engine.unregister).toBe('function')
      expect(typeof engine.list).toBe('function')
      expect(typeof engine.get).toBe('function')
      expect(typeof engine.enable).toBe('function')
      expect(typeof engine.disable).toBe('function')
    })

    it('should register and list triggers', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'webhook-1',
        type: 'webhook',
        name: 'GitHub Webhook',
        webhook: {
          path: '/webhooks/github',
          methods: ['POST'],
        },
      })

      const triggers = await engine.list()

      expect(triggers).toHaveLength(1)
      expect(triggers[0].id).toBe('webhook-1')
      expect(triggers[0].name).toBe('GitHub Webhook')
    })

    it('should get a trigger by id', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'trigger-1',
        type: 'webhook',
        name: 'Test Trigger',
        webhook: { path: '/test' },
      })

      const trigger = await engine.get('trigger-1')

      expect(trigger).not.toBeNull()
      expect(trigger?.id).toBe('trigger-1')
      expect(trigger?.name).toBe('Test Trigger')
    })

    it('should return null for non-existent trigger', async () => {
      const engine = createTestEngine()

      const trigger = await engine.get('non-existent')

      expect(trigger).toBeNull()
    })

    it('should unregister triggers', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'to-remove',
        type: 'webhook',
        name: 'To Remove',
        webhook: { path: '/remove' },
      })

      await engine.unregister('to-remove')

      const trigger = await engine.get('to-remove')
      expect(trigger).toBeNull()
    })

    it('should throw when registering duplicate trigger id', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'duplicate',
        type: 'webhook',
        name: 'First',
        webhook: { path: '/first' },
      })

      await expect(
        engine.register({
          id: 'duplicate',
          type: 'webhook',
          name: 'Second',
          webhook: { path: '/second' },
        })
      ).rejects.toThrow(/already exists/)
    })

    it('should enable and disable triggers', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'toggle',
        type: 'webhook',
        name: 'Toggle',
        webhook: { path: '/toggle' },
      })

      await engine.disable('toggle')
      let trigger = await engine.get('toggle')
      expect(trigger?.status).toBe('disabled')

      await engine.enable('toggle')
      trigger = await engine.get('toggle')
      expect(trigger?.status).toBe('active')
    })

    it('should filter triggers by type', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'wh-1',
        type: 'webhook',
        name: 'Webhook 1',
        webhook: { path: '/wh1' },
      })

      await engine.register({
        id: 'poll-1',
        type: 'polling',
        name: 'Polling 1',
        polling: {
          interval: 60000,
          fetcher: async () => ({ data: [] }),
        },
      })

      const webhooks = await engine.list({ type: 'webhook' })
      const polling = await engine.list({ type: 'polling' })

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].id).toBe('wh-1')
      expect(polling).toHaveLength(1)
      expect(polling[0].id).toBe('poll-1')
    })

    it('should filter triggers by status', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'active-1',
        type: 'webhook',
        name: 'Active',
        webhook: { path: '/active' },
      })

      await engine.register({
        id: 'disabled-1',
        type: 'webhook',
        name: 'Disabled',
        webhook: { path: '/disabled' },
      })
      await engine.disable('disabled-1')

      const active = await engine.list({ status: 'active' })
      const disabled = await engine.list({ status: 'disabled' })

      expect(active).toHaveLength(1)
      expect(active[0].id).toBe('active-1')
      expect(disabled).toHaveLength(1)
      expect(disabled[0].id).toBe('disabled-1')
    })
  })

  // ============================================================================
  // WEBHOOK TRIGGERS
  // ============================================================================

  describe('webhook triggers', () => {
    it('should handle incoming webhook requests', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'github-webhook',
        type: 'webhook',
        name: 'GitHub Events',
        webhook: {
          path: '/webhooks/github',
          methods: ['POST'],
        },
        handler,
      })

      const payload: WebhookPayload = {
        headers: { 'content-type': 'application/json' },
        body: { event: 'push', ref: 'refs/heads/main' },
        method: 'POST',
        path: '/webhooks/github',
      }

      await engine.handleWebhook(payload)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'webhook',
          triggerId: 'github-webhook',
          payload: payload.body,
        })
      )
    })

    it('should match webhooks by path', async () => {
      const engine = createTestEngine()
      const githubHandler = vi.fn()
      const slackHandler = vi.fn()

      await engine.register({
        id: 'github',
        type: 'webhook',
        name: 'GitHub',
        webhook: { path: '/webhooks/github' },
        handler: githubHandler,
      })

      await engine.register({
        id: 'slack',
        type: 'webhook',
        name: 'Slack',
        webhook: { path: '/webhooks/slack' },
        handler: slackHandler,
      })

      await engine.handleWebhook({
        method: 'POST',
        path: '/webhooks/github',
        body: { test: 'github' },
        headers: {},
      })

      expect(githubHandler).toHaveBeenCalledTimes(1)
      expect(slackHandler).not.toHaveBeenCalled()
    })

    it('should validate webhook signatures', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      const validator: SignatureValidator = {
        validate: async (payload, signature, secret) => {
          return signature === 'valid-signature'
        },
        headerName: 'x-hub-signature-256',
      }

      await engine.register({
        id: 'secure-webhook',
        type: 'webhook',
        name: 'Secure Webhook',
        webhook: {
          path: '/webhooks/secure',
          secret: 'my-secret',
          signatureValidator: validator,
        },
        handler,
      })

      // Valid signature
      await engine.handleWebhook({
        method: 'POST',
        path: '/webhooks/secure',
        body: { data: 'test' },
        headers: { 'x-hub-signature-256': 'valid-signature' },
      })

      expect(handler).toHaveBeenCalledTimes(1)

      // Invalid signature
      await expect(
        engine.handleWebhook({
          method: 'POST',
          path: '/webhooks/secure',
          body: { data: 'test' },
          headers: { 'x-hub-signature-256': 'invalid-signature' },
        })
      ).rejects.toThrow(/signature/i)

      expect(handler).toHaveBeenCalledTimes(1) // Still only called once
    })

    it('should reject webhooks to disabled triggers', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'disabled-webhook',
        type: 'webhook',
        name: 'Disabled',
        webhook: { path: '/webhooks/disabled' },
        handler,
      })

      await engine.disable('disabled-webhook')

      await expect(
        engine.handleWebhook({
          method: 'POST',
          path: '/webhooks/disabled',
          body: {},
          headers: {},
        })
      ).rejects.toThrow(/disabled|not found/i)

      expect(handler).not.toHaveBeenCalled()
    })

    it('should support method filtering', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'post-only',
        type: 'webhook',
        name: 'POST Only',
        webhook: {
          path: '/webhooks/post-only',
          methods: ['POST'],
        },
        handler,
      })

      // GET should fail
      await expect(
        engine.handleWebhook({
          method: 'GET',
          path: '/webhooks/post-only',
          body: null,
          headers: {},
        })
      ).rejects.toThrow(/method not allowed/i)

      // POST should work
      await engine.handleWebhook({
        method: 'POST',
        path: '/webhooks/post-only',
        body: { test: true },
        headers: {},
      })

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should support path parameters', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'dynamic-path',
        type: 'webhook',
        name: 'Dynamic Path',
        webhook: {
          path: '/webhooks/:provider/:action',
        },
        handler,
      })

      await engine.handleWebhook({
        method: 'POST',
        path: '/webhooks/github/push',
        body: { data: 'test' },
        headers: {},
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { provider: 'github', action: 'push' },
        })
      )
    })

    it('should return 404 for unmatched webhooks', async () => {
      const engine = createTestEngine()

      await expect(
        engine.handleWebhook({
          method: 'POST',
          path: '/webhooks/unknown',
          body: {},
          headers: {},
        })
      ).rejects.toThrow(/not found/i)
    })

    it('should include request metadata in event', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'metadata-test',
        type: 'webhook',
        name: 'Metadata Test',
        webhook: { path: '/webhooks/meta' },
        handler,
      })

      await engine.handleWebhook({
        method: 'POST',
        path: '/webhooks/meta',
        body: { key: 'value' },
        headers: {
          'x-request-id': 'req-123',
          'user-agent': 'test-agent',
        },
        query: { param1: 'value1' },
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'x-request-id': 'req-123' }),
            query: { param1: 'value1' },
          }),
        })
      )
    })
  })

  // ============================================================================
  // POLLING TRIGGERS
  // ============================================================================

  describe('polling triggers', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should execute polling at specified intervals', async () => {
      const engine = createTestEngine()
      const fetcher = vi.fn().mockResolvedValue({ data: [{ id: 1 }], cursor: 'cursor-1' })
      const handler = vi.fn()

      await engine.register({
        id: 'poll-1',
        type: 'polling',
        name: 'Poll Test',
        polling: {
          interval: 60000, // 1 minute
          fetcher,
        },
        handler,
      })

      await engine.startPolling('poll-1')

      // Initial poll
      await vi.advanceTimersByTimeAsync(0)
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Advance 1 minute
      await vi.advanceTimersByTimeAsync(60000)
      expect(fetcher).toHaveBeenCalledTimes(2)

      // Advance another minute
      await vi.advanceTimersByTimeAsync(60000)
      expect(fetcher).toHaveBeenCalledTimes(3)

      await engine.stopPolling('poll-1')
    })

    it('should maintain polling state between calls', async () => {
      const engine = createTestEngine()
      const fetcher = vi.fn<[], Promise<PollingResult>>()
        .mockResolvedValueOnce({ data: [{ id: 1 }], cursor: 'cursor-1' })
        .mockResolvedValueOnce({ data: [{ id: 2 }], cursor: 'cursor-2' })
        .mockResolvedValueOnce({ data: [{ id: 3 }], cursor: 'cursor-3' })

      await engine.register({
        id: 'stateful-poll',
        type: 'polling',
        name: 'Stateful Poll',
        polling: {
          interval: 1000,
          fetcher,
        },
      })

      await engine.startPolling('stateful-poll')

      await vi.advanceTimersByTimeAsync(0)
      expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined }))

      await vi.advanceTimersByTimeAsync(1000)
      expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' }))

      await vi.advanceTimersByTimeAsync(1000)
      expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' }))

      await engine.stopPolling('stateful-poll')
    })

    it('should respect rate limits', async () => {
      const engine = createTestEngine()
      const fetcher = vi.fn().mockResolvedValue({ data: [], cursor: null })

      await engine.register({
        id: 'rate-limited',
        type: 'polling',
        name: 'Rate Limited',
        polling: {
          interval: 100,
          fetcher,
          rateLimit: {
            maxRequests: 3,
            windowMs: 1000,
          },
        },
      })

      await engine.startPolling('rate-limited')

      // First 3 requests should work
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      expect(fetcher).toHaveBeenCalledTimes(3)

      // 4th request should be rate limited (at t=300)
      await vi.advanceTimersByTimeAsync(100)
      expect(fetcher).toHaveBeenCalledTimes(3) // Still 3 - blocked until window reset

      // At t=400, still blocked (window started at t=0)
      await vi.advanceTimersByTimeAsync(100)
      expect(fetcher).toHaveBeenCalledTimes(3) // Still 3

      // After window resets at t=1000, should execute again
      // Time remaining: 1000 - 400 = 600ms to reach window reset
      await vi.advanceTimersByTimeAsync(600)
      // Now at t=1000, window resets and we should get another request
      expect(fetcher).toHaveBeenCalledTimes(4)

      await engine.stopPolling('rate-limited')
    })

    it('should handle polling errors with backoff', async () => {
      const engine = createTestEngine()
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ data: [{ id: 1 }], cursor: 'ok' })

      await engine.register({
        id: 'backoff-test',
        type: 'polling',
        name: 'Backoff Test',
        polling: {
          interval: 1000,
          fetcher,
          backoff: {
            initialDelay: 1000,
            maxDelay: 30000,
            multiplier: 2,
          },
        },
      })

      await engine.startPolling('backoff-test')

      // First call fails
      await vi.advanceTimersByTimeAsync(0)
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Wait for backoff (1000ms)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetcher).toHaveBeenCalledTimes(2)

      // Wait for backoff (2000ms due to multiplier)
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetcher).toHaveBeenCalledTimes(3)

      await engine.stopPolling('backoff-test')
    })

    it('should call handler for each new item', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()
      const fetcher = vi.fn().mockResolvedValue({
        data: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
        cursor: 'c1',
      })

      await engine.register({
        id: 'handler-test',
        type: 'polling',
        name: 'Handler Test',
        polling: { interval: 1000, fetcher },
        handler,
      })

      await engine.startPolling('handler-test')
      await vi.advanceTimersByTimeAsync(0)

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({
        type: 'polling',
        triggerId: 'handler-test',
        payload: { id: 1, name: 'Item 1' },
      }))
      expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({
        payload: { id: 2, name: 'Item 2' },
      }))

      await engine.stopPolling('handler-test')
    })

    it('should deduplicate items using dedupeKey', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], cursor: 'c1' })
        .mockResolvedValueOnce({ data: [{ id: 2 }, { id: 3 }], cursor: 'c2' })

      await engine.register({
        id: 'dedupe-test',
        type: 'polling',
        name: 'Dedupe Test',
        polling: {
          interval: 1000,
          fetcher,
          dedupeKey: (item) => item.id.toString(),
          dedupeWindowMs: 60000,
        },
        handler,
      })

      await engine.startPolling('dedupe-test')

      await vi.advanceTimersByTimeAsync(0)
      expect(handler).toHaveBeenCalledTimes(2) // items 1 and 2

      await vi.advanceTimersByTimeAsync(1000)
      expect(handler).toHaveBeenCalledTimes(3) // only item 3 (id 2 was deduplicated)

      await engine.stopPolling('dedupe-test')
    })

    it('should stop polling on demand', async () => {
      const engine = createTestEngine()
      const fetcher = vi.fn().mockResolvedValue({ data: [], cursor: null })

      await engine.register({
        id: 'stop-test',
        type: 'polling',
        name: 'Stop Test',
        polling: { interval: 1000, fetcher },
      })

      await engine.startPolling('stop-test')
      await vi.advanceTimersByTimeAsync(2500) // 3 calls
      expect(fetcher).toHaveBeenCalledTimes(3)

      await engine.stopPolling('stop-test')
      await vi.advanceTimersByTimeAsync(2000)
      expect(fetcher).toHaveBeenCalledTimes(3) // No more calls
    })

    it('should update trigger status when polling starts/stops', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'status-test',
        type: 'polling',
        name: 'Status Test',
        polling: {
          interval: 1000,
          fetcher: vi.fn().mockResolvedValue({ data: [], cursor: null }),
        },
      })

      let trigger = await engine.get('status-test')
      expect(trigger?.status).toBe('active')

      await engine.startPolling('status-test')
      trigger = await engine.get('status-test')
      expect(trigger?.pollingStatus).toBe('running')

      await engine.stopPolling('status-test')
      trigger = await engine.get('status-test')
      expect(trigger?.pollingStatus).toBe('stopped')
    })
  })

  // ============================================================================
  // EVENT TRIGGERS
  // ============================================================================

  describe('event triggers', () => {
    it('should subscribe to events with exact channel match', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'event-1',
        type: 'event',
        name: 'User Events',
        event: {
          channel: 'user.created',
        },
        handler,
      })

      await engine.emit('user.created', { userId: '123', email: 'test@example.com' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          triggerId: 'event-1',
          payload: { userId: '123', email: 'test@example.com' },
        })
      )
    })

    it('should support wildcard channel patterns', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'wildcard-event',
        type: 'event',
        name: 'All User Events',
        event: {
          channel: 'user.*',
        },
        handler,
      })

      await engine.emit('user.created', { action: 'created' })
      await engine.emit('user.updated', { action: 'updated' })
      await engine.emit('order.created', { action: 'order' }) // Should not match

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('should support event filtering', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'filtered-event',
        type: 'event',
        name: 'High Value Orders',
        event: {
          channel: 'order.created',
          filter: (payload) => payload.amount > 100,
        },
        handler,
      })

      await engine.emit('order.created', { orderId: '1', amount: 50 })
      await engine.emit('order.created', { orderId: '2', amount: 150 })
      await engine.emit('order.created', { orderId: '3', amount: 200 })

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({ orderId: '2' }),
      }))
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({ orderId: '3' }),
      }))
    })

    it('should support multiple channels per trigger', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'multi-channel',
        type: 'event',
        name: 'Multi Channel',
        event: {
          channels: ['user.created', 'user.deleted'],
        },
        handler,
      })

      await engine.emit('user.created', { id: 1 })
      await engine.emit('user.updated', { id: 2 }) // Should not match
      await engine.emit('user.deleted', { id: 3 })

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('should not trigger disabled event subscriptions', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'disabled-event',
        type: 'event',
        name: 'Disabled',
        event: { channel: 'test.event' },
        handler,
      })

      await engine.disable('disabled-event')
      await engine.emit('test.event', { data: 'test' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should support event metadata', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'metadata-event',
        type: 'event',
        name: 'With Metadata',
        event: { channel: 'test.event' },
        handler,
      })

      await engine.emit('test.event', { data: 'test' }, {
        correlationId: 'corr-123',
        source: 'api',
        timestamp: Date.now(),
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            correlationId: 'corr-123',
            source: 'api',
          }),
        })
      )
    })
  })

  // ============================================================================
  // SCHEDULE TRIGGERS
  // ============================================================================

  describe('schedule triggers', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should trigger on cron schedule', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'cron-trigger',
        type: 'schedule',
        name: 'Every Minute',
        schedule: {
          cron: '* * * * *', // Every minute
        },
        handler,
      })

      await engine.startSchedule('cron-trigger')

      // Advance 3 minutes
      await vi.advanceTimersByTimeAsync(60000 * 3)

      expect(handler).toHaveBeenCalledTimes(3)

      await engine.stopSchedule('cron-trigger')
    })

    it('should include schedule metadata in event', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'schedule-meta',
        type: 'schedule',
        name: 'Schedule Meta',
        schedule: {
          cron: '*/5 * * * *',
        },
        handler,
      })

      await engine.startSchedule('schedule-meta')
      await vi.advanceTimersByTimeAsync(5 * 60000)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule',
          triggerId: 'schedule-meta',
          metadata: expect.objectContaining({
            scheduledTime: expect.any(Number),
            cron: '*/5 * * * *',
          }),
        })
      )

      await engine.stopSchedule('schedule-meta')
    })

    it('should support timezone configuration', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'tz-trigger',
        type: 'schedule',
        name: 'With Timezone',
        schedule: {
          cron: '0 9 * * *', // 9 AM
          timezone: 'America/New_York',
        },
        handler,
      })

      const trigger = await engine.get('tz-trigger')
      expect(trigger?.schedule?.timezone).toBe('America/New_York')
    })

    it('should stop schedule on demand', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'stop-schedule',
        type: 'schedule',
        name: 'Stop Schedule',
        schedule: { cron: '* * * * *' },
        handler,
      })

      await engine.startSchedule('stop-schedule')
      await vi.advanceTimersByTimeAsync(60000 * 2) // 2 executions

      await engine.stopSchedule('stop-schedule')
      await vi.advanceTimersByTimeAsync(60000 * 3) // Should not add more

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  // ============================================================================
  // EVENT SUBSCRIPTION (ASYNC ITERATOR)
  // ============================================================================

  describe('event subscription', () => {
    it('should provide async iterator for trigger events', async () => {
      vi.useRealTimers()
      const engine = createTestEngine()

      await engine.register({
        id: 'iterable-trigger',
        type: 'webhook',
        name: 'Iterable',
        webhook: { path: '/iterable' },
      })

      const iterator = engine.subscribe('iterable-trigger')

      // Queue up some events
      setTimeout(async () => {
        await engine.handleWebhook({
          method: 'POST',
          path: '/iterable',
          body: { event: 1 },
          headers: {},
        })
        await engine.handleWebhook({
          method: 'POST',
          path: '/iterable',
          body: { event: 2 },
          headers: {},
        })
      }, 10)

      const events = await collectEvents(engine, 'iterable-trigger', 2, 500)

      expect(events).toHaveLength(2)
      expect(events[0].payload).toEqual({ event: 1 })
      expect(events[1].payload).toEqual({ event: 2 })
    })

    it('should unsubscribe when iterator is returned', async () => {
      vi.useRealTimers()
      const engine = createTestEngine()

      await engine.register({
        id: 'unsub-test',
        type: 'webhook',
        name: 'Unsub Test',
        webhook: { path: '/unsub' },
      })

      const iterator = engine.subscribe('unsub-test')

      // Clean up
      await iterator.return?.()

      // Should not receive events after unsubscribe
      const stats = await engine.getStats('unsub-test')
      expect(stats.activeSubscribers).toBe(0)
    })
  })

  // ============================================================================
  // TRIGGER STATISTICS
  // ============================================================================

  describe('trigger statistics', () => {
    it('should track invocation count', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'stats-trigger',
        type: 'webhook',
        name: 'Stats',
        webhook: { path: '/stats' },
      })

      await engine.handleWebhook({ method: 'POST', path: '/stats', body: { n: 1 }, headers: {} })
      await engine.handleWebhook({ method: 'POST', path: '/stats', body: { n: 2 }, headers: {} })
      await engine.handleWebhook({ method: 'POST', path: '/stats', body: { n: 3 }, headers: {} })

      const stats = await engine.getStats('stats-trigger')

      expect(stats.invocationCount).toBe(3)
    })

    it('should track last invocation time', async () => {
      vi.useRealTimers()
      const engine = createTestEngine()

      await engine.register({
        id: 'time-trigger',
        type: 'webhook',
        name: 'Time',
        webhook: { path: '/time' },
      })

      const before = Date.now()
      await engine.handleWebhook({ method: 'POST', path: '/time', body: {}, headers: {} })
      const after = Date.now()

      const stats = await engine.getStats('time-trigger')

      expect(stats.lastInvocationAt).toBeGreaterThanOrEqual(before)
      expect(stats.lastInvocationAt).toBeLessThanOrEqual(after)
    })

    it('should track error count', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'error-trigger',
        type: 'webhook',
        name: 'Error',
        webhook: { path: '/error' },
        handler: vi.fn().mockRejectedValue(new Error('Handler error')),
      })

      // These should fail but be caught
      try {
        await engine.handleWebhook({ method: 'POST', path: '/error', body: {}, headers: {} })
      } catch {}
      try {
        await engine.handleWebhook({ method: 'POST', path: '/error', body: {}, headers: {} })
      } catch {}

      const stats = await engine.getStats('error-trigger')

      expect(stats.errorCount).toBe(2)
    })

    it('should track average latency', async () => {
      vi.useRealTimers()
      const engine = createTestEngine()

      await engine.register({
        id: 'latency-trigger',
        type: 'webhook',
        name: 'Latency',
        webhook: { path: '/latency' },
        handler: vi.fn().mockImplementation(async () => {
          await delay(10)
        }),
      })

      await engine.handleWebhook({ method: 'POST', path: '/latency', body: {}, headers: {} })
      await engine.handleWebhook({ method: 'POST', path: '/latency', body: {}, headers: {} })

      const stats = await engine.getStats('latency-trigger')

      expect(stats.averageLatencyMs).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // OBSERVABILITY
  // ============================================================================

  describe('observability', () => {
    it('should record metrics for webhook invocations', async () => {
      const metrics = new TestMetricsCollector()
      const engine = createTestEngine({ metrics })

      await engine.register({
        id: 'metrics-wh',
        type: 'webhook',
        name: 'Metrics Webhook',
        webhook: { path: '/metrics' },
      })

      await engine.handleWebhook({ method: 'POST', path: '/metrics', body: {}, headers: {} })

      expect(metrics.getCounterTotal('trigger.invocations')).toBe(1)
      expect(metrics.getLatencies('trigger.handler.latency').length).toBeGreaterThan(0)
    })

    it('should record metrics for polling', async () => {
      vi.useFakeTimers()
      const metrics = new TestMetricsCollector()
      const engine = createTestEngine({ metrics })

      await engine.register({
        id: 'metrics-poll',
        type: 'polling',
        name: 'Metrics Poll',
        polling: {
          interval: 1000,
          fetcher: vi.fn().mockResolvedValue({ data: [1, 2], cursor: null }),
        },
      })

      await engine.startPolling('metrics-poll')
      await vi.advanceTimersByTimeAsync(0)

      expect(metrics.getCounterTotal('trigger.polling.fetched')).toBeGreaterThan(0)

      await engine.stopPolling('metrics-poll')
      vi.useRealTimers()
    })

    it('should record error metrics', async () => {
      const metrics = new TestMetricsCollector()
      const engine = createTestEngine({ metrics })

      await engine.register({
        id: 'error-metrics',
        type: 'webhook',
        name: 'Error Metrics',
        webhook: { path: '/err' },
        handler: vi.fn().mockRejectedValue(new Error('fail')),
      })

      try {
        await engine.handleWebhook({ method: 'POST', path: '/err', body: {}, headers: {} })
      } catch {}

      expect(metrics.getCounterTotal('trigger.errors')).toBe(1)
    })
  })

  // ============================================================================
  // CLEANUP AND SHUTDOWN
  // ============================================================================

  describe('cleanup and shutdown', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should stop all polling and schedules on close', async () => {
      const engine = createTestEngine()
      const pollFetcher = vi.fn().mockResolvedValue({ data: [], cursor: null })
      const scheduleHandler = vi.fn()

      await engine.register({
        id: 'poll-cleanup',
        type: 'polling',
        name: 'Poll Cleanup',
        polling: { interval: 1000, fetcher: pollFetcher },
      })

      await engine.register({
        id: 'schedule-cleanup',
        type: 'schedule',
        name: 'Schedule Cleanup',
        schedule: { cron: '* * * * *' },
        handler: scheduleHandler,
      })

      await engine.startPolling('poll-cleanup')
      await engine.startSchedule('schedule-cleanup')

      await vi.advanceTimersByTimeAsync(60000)
      const pollCalls = pollFetcher.mock.calls.length
      const scheduleCalls = scheduleHandler.mock.calls.length

      await engine.close()

      await vi.advanceTimersByTimeAsync(120000)

      // No additional calls after close
      expect(pollFetcher).toHaveBeenCalledTimes(pollCalls)
      expect(scheduleHandler).toHaveBeenCalledTimes(scheduleCalls)
    })

    it('should reject operations after close', async () => {
      const engine = createTestEngine()
      await engine.close()

      await expect(engine.register({
        id: 'after-close',
        type: 'webhook',
        name: 'After Close',
        webhook: { path: '/closed' },
      })).rejects.toThrow(/closed/i)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty polling results', async () => {
      vi.useFakeTimers()
      const engine = createTestEngine()
      const handler = vi.fn()
      const fetcher = vi.fn().mockResolvedValue({ data: [], cursor: null })

      await engine.register({
        id: 'empty-poll',
        type: 'polling',
        name: 'Empty Poll',
        polling: { interval: 1000, fetcher },
        handler,
      })

      await engine.startPolling('empty-poll')
      await vi.advanceTimersByTimeAsync(3000)

      expect(fetcher).toHaveBeenCalledTimes(4)
      expect(handler).not.toHaveBeenCalled()

      await engine.stopPolling('empty-poll')
      vi.useRealTimers()
    })

    it('should handle concurrent webhook requests', async () => {
      const engine = createTestEngine()
      const handler = vi.fn().mockImplementation(async () => {
        await delay(10)
      })

      await engine.register({
        id: 'concurrent-wh',
        type: 'webhook',
        name: 'Concurrent',
        webhook: { path: '/concurrent' },
        handler,
      })

      // Fire 10 concurrent requests
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          engine.handleWebhook({
            method: 'POST',
            path: '/concurrent',
            body: { n: i },
            headers: {},
          })
        )
      )

      expect(handler).toHaveBeenCalledTimes(10)
    })

    it('should handle special characters in trigger ids', async () => {
      const engine = createTestEngine()

      await engine.register({
        id: 'trigger:with:colons',
        type: 'webhook',
        name: 'Special ID',
        webhook: { path: '/special' },
      })

      const trigger = await engine.get('trigger:with:colons')
      expect(trigger).not.toBeNull()
    })

    it('should handle JSON body in webhook', async () => {
      const engine = createTestEngine()
      const handler = vi.fn()

      await engine.register({
        id: 'json-wh',
        type: 'webhook',
        name: 'JSON',
        webhook: { path: '/json' },
        handler,
      })

      const complexBody = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        nullValue: null,
        unicode: 'Hello World',
      }

      await engine.handleWebhook({
        method: 'POST',
        path: '/json',
        body: complexBody,
        headers: { 'content-type': 'application/json' },
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: complexBody,
        })
      )
    })
  })
})
