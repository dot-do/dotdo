/**
 * TriggerEngine Primitive - Universal Triggers like Zapier/n8n
 *
 * RED phase: These tests define the expected behavior for the TriggerEngine.
 * Tests cover:
 * - WebhookReceiver: HTTP webhooks with HMAC validation
 * - PollingScheduler: Poll APIs with backoff and deduplication
 * - EventBus: Internal event routing and fan-out
 * - TriggerRegistry: Register/discover triggers
 * - TriggerContext: Execution context with metadata
 * - TriggerOutput: Normalized output format
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  WebhookReceiver,
  PollingScheduler,
  EventBus,
  TriggerRegistry,
  TriggerEngine,
  createHmacSignature,
  verifyHmacSignature,
  type Trigger,
  type TriggerConfig,
  type TriggerContext,
  type TriggerOutput,
  type WebhookConfig,
  type PollingConfig,
  type EventHandler,
  type ScheduleConfig,
} from './index'

// =============================================================================
// WebhookReceiver Tests
// =============================================================================

describe('WebhookReceiver', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
  })

  describe('registration', () => {
    it('should register a webhook endpoint', () => {
      receiver.register('/webhooks/github', {
        secret: 'my-secret',
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      expect(receiver.has('/webhooks/github')).toBe(true)
    })

    it('should register multiple webhook endpoints', () => {
      receiver.register('/webhooks/github', { secret: 'gh-secret' })
      receiver.register('/webhooks/stripe', { secret: 'stripe-secret' })

      expect(receiver.has('/webhooks/github')).toBe(true)
      expect(receiver.has('/webhooks/stripe')).toBe(true)
    })

    it('should throw when registering duplicate path', () => {
      receiver.register('/webhooks/github', { secret: 'secret' })

      expect(() => {
        receiver.register('/webhooks/github', { secret: 'secret' })
      }).toThrow('already registered')
    })

    it('should unregister a webhook endpoint', () => {
      receiver.register('/webhooks/github', { secret: 'secret' })
      receiver.unregister('/webhooks/github')

      expect(receiver.has('/webhooks/github')).toBe(false)
    })

    it('should list all registered webhooks', () => {
      receiver.register('/webhooks/github', { secret: 'gh-secret' })
      receiver.register('/webhooks/stripe', { secret: 'stripe-secret' })

      const webhooks = receiver.list()
      expect(webhooks).toHaveLength(2)
      expect(webhooks).toContain('/webhooks/github')
      expect(webhooks).toContain('/webhooks/stripe')
    })
  })

  describe('HMAC signature validation', () => {
    it('should validate SHA-256 HMAC signature', async () => {
      const secret = 'my-webhook-secret'
      const body = JSON.stringify({ event: 'push', ref: 'refs/heads/main' })

      receiver.register('/webhooks/github', {
        secret,
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      const signature = await createHmacSignature(body, secret, 'sha256')
      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${signature}`,
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/github')
      expect(isValid).toBe(true)
    })

    it('should validate SHA-1 HMAC signature', async () => {
      const secret = 'legacy-secret'
      const body = JSON.stringify({ action: 'created' })

      receiver.register('/webhooks/legacy', {
        secret,
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha1',
      })

      const signature = await createHmacSignature(body, secret, 'sha1')
      const request = new Request('https://example.com/webhooks/legacy', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha1=${signature}`,
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/legacy')
      expect(isValid).toBe(true)
    })

    it('should reject invalid signature', async () => {
      const secret = 'my-secret'
      const body = JSON.stringify({ event: 'push' })

      receiver.register('/webhooks/github', {
        secret,
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': 'sha256=invalid-signature',
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/github')
      expect(isValid).toBe(false)
    })

    it('should reject request without signature header', async () => {
      receiver.register('/webhooks/github', {
        secret: 'my-secret',
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body: JSON.stringify({ event: 'push' }),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/github')
      expect(isValid).toBe(false)
    })

    it('should handle empty body', async () => {
      const secret = 'my-secret'

      receiver.register('/webhooks/github', {
        secret,
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      const signature = await createHmacSignature('', secret, 'sha256')
      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body: '',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${signature}`,
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/github')
      expect(isValid).toBe(true)
    })
  })

  describe('replay protection', () => {
    it('should accept unique nonce', async () => {
      receiver.register('/webhooks/replay-protected', {
        secret: 'secret',
        nonceHeader: 'X-Request-Id',
        replayProtection: true,
      })

      const request = new Request('https://example.com/webhooks/replay-protected', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: {
          'X-Request-Id': 'unique-nonce-123',
        },
      })

      const result = await receiver.handle(request, '/webhooks/replay-protected')
      expect(result.success).toBe(true)
    })

    it('should reject duplicate nonce (replay attack)', async () => {
      receiver.register('/webhooks/replay-protected', {
        secret: 'secret',
        nonceHeader: 'X-Request-Id',
        replayProtection: true,
      })

      const nonce = 'duplicate-nonce-456'

      const request1 = new Request('https://example.com/webhooks/replay-protected', {
        method: 'POST',
        body: JSON.stringify({ event: 'test1' }),
        headers: { 'X-Request-Id': nonce },
      })

      const request2 = new Request('https://example.com/webhooks/replay-protected', {
        method: 'POST',
        body: JSON.stringify({ event: 'test2' }),
        headers: { 'X-Request-Id': nonce },
      })

      await receiver.handle(request1, '/webhooks/replay-protected')
      const result = await receiver.handle(request2, '/webhooks/replay-protected')

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/replay|duplicate/i)
    })

    it('should validate timestamp within window', async () => {
      receiver.register('/webhooks/time-protected', {
        secret: 'secret',
        timestampHeader: 'X-Timestamp',
        timestampWindowMs: 5 * 60 * 1000, // 5 minutes
      })

      const now = Date.now()
      const request = new Request('https://example.com/webhooks/time-protected', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: {
          'X-Timestamp': String(now),
        },
      })

      const result = await receiver.handle(request, '/webhooks/time-protected')
      expect(result.success).toBe(true)
    })

    it('should reject timestamp outside window', async () => {
      receiver.register('/webhooks/time-protected', {
        secret: 'secret',
        timestampHeader: 'X-Timestamp',
        timestampWindowMs: 5 * 60 * 1000, // 5 minutes
      })

      const oldTimestamp = Date.now() - 10 * 60 * 1000 // 10 minutes ago
      const request = new Request('https://example.com/webhooks/time-protected', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: {
          'X-Timestamp': String(oldTimestamp),
        },
      })

      const result = await receiver.handle(request, '/webhooks/time-protected')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timestamp|expired/i)
    })
  })

  describe('content type parsing', () => {
    it('should parse JSON body', async () => {
      receiver.register('/webhooks/json', { secret: 'secret' })

      const request = new Request('https://example.com/webhooks/json', {
        method: 'POST',
        body: JSON.stringify({ key: 'value', nested: { a: 1 } }),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/json')
      expect(result.data).toEqual({ key: 'value', nested: { a: 1 } })
    })

    it('should parse form-urlencoded body', async () => {
      receiver.register('/webhooks/form', { secret: 'secret' })

      const request = new Request('https://example.com/webhooks/form', {
        method: 'POST',
        body: 'name=John&age=30',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      const result = await receiver.handle(request, '/webhooks/form')
      expect(result.data).toEqual({ name: 'John', age: '30' })
    })

    it('should handle raw text body', async () => {
      receiver.register('/webhooks/text', { secret: 'secret' })

      const request = new Request('https://example.com/webhooks/text', {
        method: 'POST',
        body: 'plain text content',
        headers: { 'Content-Type': 'text/plain' },
      })

      const result = await receiver.handle(request, '/webhooks/text')
      expect(result.data).toBe('plain text content')
    })
  })

  describe('request handling', () => {
    it('should return TriggerOutput on successful handling', async () => {
      receiver.register('/webhooks/github', {
        secret: 'secret',
      })

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body: JSON.stringify({ action: 'opened', number: 42 }),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/github')

      expect(result).toMatchObject({
        success: true,
        triggerId: expect.any(String),
        timestamp: expect.any(Number),
        source: 'webhook',
        data: { action: 'opened', number: 42 },
      })
    })

    it('should include request metadata in context', async () => {
      receiver.register('/webhooks/github', { secret: 'secret' })

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body: JSON.stringify({ event: 'push' }),
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'abc-123',
        },
      })

      const result = await receiver.handle(request, '/webhooks/github')

      expect(result.context).toMatchObject({
        method: 'POST',
        headers: expect.any(Object),
        path: '/webhooks/github',
      })
      expect(result.context.headers['x-github-event']).toBe('push')
    })

    it('should enforce request body size limits', async () => {
      receiver.register('/webhooks/limited', {
        secret: 'secret',
        maxBodySize: 100, // 100 bytes
      })

      const largeBody = JSON.stringify({ data: 'x'.repeat(200) })
      const request = new Request('https://example.com/webhooks/limited', {
        method: 'POST',
        body: largeBody,
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/limited')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/size|limit|too large/i)
    })
  })
})

// =============================================================================
// PollingScheduler Tests
// =============================================================================

describe('PollingScheduler', () => {
  let scheduler: PollingScheduler

  beforeEach(() => {
    scheduler = new PollingScheduler()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('registration', () => {
    it('should register a polling source', () => {
      scheduler.register('github-issues', {
        url: 'https://api.github.com/repos/owner/repo/issues',
        intervalMs: 60_000,
        headers: { Authorization: 'token abc123' },
      })

      expect(scheduler.has('github-issues')).toBe(true)
    })

    it('should unregister a polling source', () => {
      scheduler.register('github-issues', {
        url: 'https://api.github.com/repos/owner/repo/issues',
        intervalMs: 60_000,
      })
      scheduler.unregister('github-issues')

      expect(scheduler.has('github-issues')).toBe(false)
    })

    it('should list all registered sources', () => {
      scheduler.register('source-1', { url: 'https://api1.com', intervalMs: 60_000 })
      scheduler.register('source-2', { url: 'https://api2.com', intervalMs: 30_000 })

      const sources = scheduler.list()
      expect(sources).toContain('source-1')
      expect(sources).toContain('source-2')
    })
  })

  describe('polling execution', () => {
    it('should poll and return new items', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([
          { id: 1, title: 'Issue 1' },
          { id: 2, title: 'Issue 2' },
        ]))
      )
      global.fetch = mockFetch

      scheduler.register('github-issues', {
        url: 'https://api.github.com/issues',
        intervalMs: 60_000,
        idField: 'id',
      })

      const results = await scheduler.poll('github-issues')

      expect(results).toHaveLength(2)
      expect(results[0].data).toMatchObject({ id: 1, title: 'Issue 1' })
      expect(results[1].data).toMatchObject({ id: 2, title: 'Issue 2' })
    })

    it('should deduplicate already-seen items by ID', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { id: 1, title: 'Issue 1' },
          { id: 2, title: 'Issue 2' },
        ])))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { id: 2, title: 'Issue 2' },
          { id: 3, title: 'Issue 3' },
        ])))
      global.fetch = mockFetch

      scheduler.register('github-issues', {
        url: 'https://api.github.com/issues',
        intervalMs: 60_000,
        idField: 'id',
      })

      const firstPoll = await scheduler.poll('github-issues')
      expect(firstPoll).toHaveLength(2)

      const secondPoll = await scheduler.poll('github-issues')
      expect(secondPoll).toHaveLength(1)
      expect(secondPoll[0].data).toMatchObject({ id: 3, title: 'Issue 3' })
    })

    it('should track cursor/offset state', async () => {
      scheduler.register('paginated-api', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        cursorField: 'cursor',
      })

      await scheduler.setLastState('paginated-api', { cursor: 'abc123', page: 2 })

      const state = await scheduler.getLastState('paginated-api')
      expect(state).toEqual({ cursor: 'abc123', page: 2 })
    })

    it('should return empty array when no new items', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }])))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1 }])))
      global.fetch = mockFetch

      scheduler.register('source', {
        url: 'https://api.example.com/items',
        intervalMs: 60_000,
        idField: 'id',
      })

      await scheduler.poll('source')
      const results = await scheduler.poll('source')

      expect(results).toHaveLength(0)
    })
  })

  describe('rate limiting', () => {
    it('should respect minimum interval between polls', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]')))
      global.fetch = mockFetch

      scheduler.register('rate-limited', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        minIntervalMs: 10_000,
      })

      await scheduler.poll('rate-limited')
      await scheduler.poll('rate-limited') // Should be rate-limited

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should allow poll after interval passes', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]')))
      global.fetch = mockFetch

      scheduler.register('rate-limited', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        minIntervalMs: 10_000,
      })

      await scheduler.poll('rate-limited')
      vi.advanceTimersByTime(15_000)
      await scheduler.poll('rate-limited')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should track per-source rate limits', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]')))
      global.fetch = mockFetch

      scheduler.register('source-1', { url: 'https://api1.com', intervalMs: 60_000, minIntervalMs: 10_000 })
      scheduler.register('source-2', { url: 'https://api2.com', intervalMs: 60_000, minIntervalMs: 10_000 })

      await scheduler.poll('source-1')
      await scheduler.poll('source-2')

      // Both should execute since they're different sources
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('backoff on errors', () => {
    it('should apply exponential backoff on consecutive errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('failing-source', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        maxRetries: 3,
        initialBackoffMs: 1000,
      })

      // First failure
      await expect(scheduler.poll('failing-source')).rejects.toThrow()
      const backoff1 = scheduler.getBackoffMs('failing-source')
      expect(backoff1).toBe(1000)

      // Second failure
      vi.advanceTimersByTime(1000)
      await expect(scheduler.poll('failing-source')).rejects.toThrow()
      const backoff2 = scheduler.getBackoffMs('failing-source')
      expect(backoff2).toBe(2000) // Exponential

      // Third failure
      vi.advanceTimersByTime(2000)
      await expect(scheduler.poll('failing-source')).rejects.toThrow()
      const backoff3 = scheduler.getBackoffMs('failing-source')
      expect(backoff3).toBe(4000)
    })

    it('should reset backoff on successful poll', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(new Response('[]'))
      global.fetch = mockFetch

      scheduler.register('recovering-source', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        initialBackoffMs: 1000,
      })

      await expect(scheduler.poll('recovering-source')).rejects.toThrow()
      expect(scheduler.getBackoffMs('recovering-source')).toBe(1000)

      vi.advanceTimersByTime(1000)
      await scheduler.poll('recovering-source')
      expect(scheduler.getBackoffMs('recovering-source')).toBe(0)
    })

    it('should cap backoff at maximum value', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('API Error'))
      global.fetch = mockFetch

      scheduler.register('failing-source', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        initialBackoffMs: 1000,
        maxBackoffMs: 30_000,
      })

      // Simulate many failures
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(60_000)
        await expect(scheduler.poll('failing-source')).rejects.toThrow()
      }

      expect(scheduler.getBackoffMs('failing-source')).toBeLessThanOrEqual(30_000)
    })
  })

  describe('custom transform', () => {
    it('should apply transform function to poll results', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }))
      )
      global.fetch = mockFetch

      scheduler.register('transformed', {
        url: 'https://api.example.com',
        intervalMs: 60_000,
        transform: (response: unknown) => (response as { items: unknown[] }).items,
        idField: 'id',
      })

      const results = await scheduler.poll('transformed')
      expect(results).toHaveLength(2)
    })
  })
})

// =============================================================================
// EventBus Tests
// =============================================================================

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  describe('basic pub/sub', () => {
    it('should emit and receive events', () => {
      const handler = vi.fn()
      bus.on('user.created', handler)

      bus.emit('user.created', { id: 1, name: 'Alice' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ id: 1, name: 'Alice' }, expect.objectContaining({ timestamp: expect.any(Number) }))
    })

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      bus.on('user.created', handler1)
      bus.on('user.created', handler2)

      bus.emit('user.created', { id: 1 })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('should not call handler for different events', () => {
      const handler = vi.fn()
      bus.on('user.created', handler)

      bus.emit('user.deleted', { id: 1 })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should unsubscribe handler', () => {
      const handler = vi.fn()
      const unsubscribe = bus.on('user.created', handler)

      bus.emit('user.created', { id: 1 })
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()
      bus.emit('user.created', { id: 2 })
      expect(handler).toHaveBeenCalledTimes(1) // Still 1
    })
  })

  describe('once handler', () => {
    it('should fire handler only once', () => {
      const handler = vi.fn()
      bus.once('user.created', handler)

      bus.emit('user.created', { id: 1 })
      bus.emit('user.created', { id: 2 })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ timestamp: expect.any(Number) }))
    })

    it('should return unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = bus.once('user.created', handler)

      unsubscribe()
      bus.emit('user.created', { id: 1 })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('wildcard patterns', () => {
    it('should support wildcard * for single segment', () => {
      const handler = vi.fn()
      bus.on('user.*', handler)

      bus.emit('user.created', { id: 1 })
      bus.emit('user.deleted', { id: 2 })

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('should support wildcard ** for multiple segments', () => {
      const handler = vi.fn()
      bus.on('order.**', handler)

      bus.emit('order.created', { id: 1 })
      bus.emit('order.item.added', { item: 'widget' })
      bus.emit('order.payment.processed', { amount: 100 })

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('should not match unrelated events with wildcard', () => {
      const handler = vi.fn()
      bus.on('user.*', handler)

      bus.emit('order.created', { id: 1 })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('filter expressions', () => {
    it('should filter events with simple predicate', () => {
      const handler = vi.fn()
      bus.on('order.created', handler, {
        filter: (data: unknown) => (data as { amount: number }).amount > 100,
      })

      bus.emit('order.created', { id: 1, amount: 50 })
      bus.emit('order.created', { id: 2, amount: 150 })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ id: 2, amount: 150 }, expect.objectContaining({ timestamp: expect.any(Number) }))
    })

    it('should support JSONPath-like filters', () => {
      const handler = vi.fn()
      bus.on('user.updated', handler, {
        filter: { '$.status': 'active' },
      })

      bus.emit('user.updated', { id: 1, status: 'inactive' })
      bus.emit('user.updated', { id: 2, status: 'active' })

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('fan-out delivery', () => {
    it('should deliver to all matching handlers', () => {
      const handlers = [vi.fn(), vi.fn(), vi.fn()]
      handlers.forEach(h => bus.on('notification.send', h))

      bus.emit('notification.send', { message: 'Hello' })

      handlers.forEach(h => {
        expect(h).toHaveBeenCalledTimes(1)
      })
    })

    it('should continue delivery even if handler throws', () => {
      const handler1 = vi.fn().mockImplementation(() => {
        throw new Error('Handler 1 failed')
      })
      const handler2 = vi.fn()

      bus.on('test.event', handler1)
      bus.on('test.event', handler2)

      // Should not throw
      bus.emit('test.event', { data: 'test' })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })

  describe('event metadata', () => {
    it('should include event metadata when using emitWithMeta', () => {
      const handler = vi.fn()
      bus.on('user.created', handler)

      bus.emitWithMeta('user.created', { id: 1 }, {
        correlationId: 'corr-123',
        source: 'api-service',
      })

      expect(handler).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({
          correlationId: 'corr-123',
          source: 'api-service',
          timestamp: expect.any(Number),
        })
      )
    })
  })

  describe('topic management', () => {
    it('should list all active topics', () => {
      bus.on('user.created', vi.fn())
      bus.on('order.created', vi.fn())
      bus.on('user.deleted', vi.fn())

      const topics = bus.topics()
      expect(topics).toContain('user.created')
      expect(topics).toContain('order.created')
      expect(topics).toContain('user.deleted')
    })

    it('should count subscribers per topic', () => {
      bus.on('user.created', vi.fn())
      bus.on('user.created', vi.fn())
      bus.on('order.created', vi.fn())

      expect(bus.subscriberCount('user.created')).toBe(2)
      expect(bus.subscriberCount('order.created')).toBe(1)
      expect(bus.subscriberCount('nonexistent')).toBe(0)
    })

    it('should clear all handlers for a topic', () => {
      const handler = vi.fn()
      bus.on('user.created', handler)
      bus.off('user.created')

      bus.emit('user.created', { id: 1 })
      expect(handler).not.toHaveBeenCalled()
    })

    it('should clear all handlers', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      bus.on('user.created', h1)
      bus.on('order.created', h2)

      bus.clear()

      bus.emit('user.created', { id: 1 })
      bus.emit('order.created', { id: 1 })

      expect(h1).not.toHaveBeenCalled()
      expect(h2).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// TriggerRegistry Tests
// =============================================================================

describe('TriggerRegistry', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = new TriggerRegistry()
  })

  describe('registration', () => {
    it('should register a webhook trigger', () => {
      registry.register({
        id: 'github-webhook',
        type: 'webhook',
        config: {
          path: '/webhooks/github',
          secret: 'my-secret',
        },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      expect(registry.has('github-webhook')).toBe(true)
    })

    it('should register a polling trigger', () => {
      registry.register({
        id: 'github-issues',
        type: 'polling',
        config: {
          url: 'https://api.github.com/issues',
          intervalMs: 60_000,
        },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'polling' }),
      })

      expect(registry.has('github-issues')).toBe(true)
    })

    it('should register a schedule trigger', () => {
      registry.register({
        id: 'daily-report',
        type: 'schedule',
        config: {
          cron: '0 9 * * *', // Every day at 9am
        },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'schedule' }),
      })

      expect(registry.has('daily-report')).toBe(true)
    })

    it('should register an event trigger', () => {
      registry.register({
        id: 'user-signup',
        type: 'event',
        config: {
          eventName: 'user.created',
        },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'event' }),
      })

      expect(registry.has('user-signup')).toBe(true)
    })

    it('should throw when registering duplicate ID', () => {
      registry.register({
        id: 'my-trigger',
        type: 'webhook',
        config: { path: '/hook' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      expect(() => {
        registry.register({
          id: 'my-trigger',
          type: 'polling',
          config: { url: 'https://api.com', intervalMs: 60000 },
          handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'polling' }),
        })
      }).toThrow(/already registered/i)
    })
  })

  describe('lookup', () => {
    it('should get trigger by ID', () => {
      registry.register({
        id: 'my-trigger',
        type: 'webhook',
        config: { path: '/hook' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      const trigger = registry.get('my-trigger')
      expect(trigger).toBeDefined()
      expect(trigger?.id).toBe('my-trigger')
      expect(trigger?.type).toBe('webhook')
    })

    it('should return undefined for unknown ID', () => {
      expect(registry.get('unknown')).toBeUndefined()
    })

    it('should list all triggers', () => {
      registry.register({
        id: 'trigger-1',
        type: 'webhook',
        config: { path: '/hook1' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })
      registry.register({
        id: 'trigger-2',
        type: 'polling',
        config: { url: 'https://api.com', intervalMs: 60000 },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'polling' }),
      })

      const triggers = registry.list()
      expect(triggers).toHaveLength(2)
    })

    it('should filter triggers by type', () => {
      registry.register({
        id: 'webhook-1',
        type: 'webhook',
        config: { path: '/hook1' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })
      registry.register({
        id: 'polling-1',
        type: 'polling',
        config: { url: 'https://api.com', intervalMs: 60000 },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'polling' }),
      })
      registry.register({
        id: 'webhook-2',
        type: 'webhook',
        config: { path: '/hook2' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      const webhooks = registry.listByType('webhook')
      expect(webhooks).toHaveLength(2)
      expect(webhooks.every(t => t.type === 'webhook')).toBe(true)
    })
  })

  describe('unregistration', () => {
    it('should unregister a trigger', () => {
      registry.register({
        id: 'my-trigger',
        type: 'webhook',
        config: { path: '/hook' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      registry.unregister('my-trigger')
      expect(registry.has('my-trigger')).toBe(false)
    })

    it('should not throw when unregistering unknown ID', () => {
      expect(() => registry.unregister('unknown')).not.toThrow()
    })
  })

  describe('enable/disable', () => {
    it('should disable a trigger', () => {
      registry.register({
        id: 'my-trigger',
        type: 'webhook',
        config: { path: '/hook' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      registry.disable('my-trigger')

      const trigger = registry.get('my-trigger')
      expect(trigger?.enabled).toBe(false)
    })

    it('should enable a disabled trigger', () => {
      registry.register({
        id: 'my-trigger',
        type: 'webhook',
        config: { path: '/hook' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      registry.disable('my-trigger')
      registry.enable('my-trigger')

      const trigger = registry.get('my-trigger')
      expect(trigger?.enabled).toBe(true)
    })

    it('should filter enabled triggers only', () => {
      registry.register({
        id: 'active',
        type: 'webhook',
        config: { path: '/hook1' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })
      registry.register({
        id: 'disabled',
        type: 'webhook',
        config: { path: '/hook2' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })
      registry.disable('disabled')

      const enabled = registry.listEnabled()
      expect(enabled).toHaveLength(1)
      expect(enabled[0].id).toBe('active')
    })
  })

  describe('webhook URL generation', () => {
    it('should generate webhook URL', () => {
      registry.register({
        id: 'github-webhook',
        type: 'webhook',
        config: { path: '/webhooks/github' },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }),
      })

      const url = registry.getWebhookUrl('github-webhook', 'https://api.example.com')
      expect(url).toBe('https://api.example.com/webhooks/github')
    })

    it('should throw for non-webhook trigger', () => {
      registry.register({
        id: 'polling-trigger',
        type: 'polling',
        config: { url: 'https://api.com', intervalMs: 60000 },
        handler: async () => ({ success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'polling' }),
      })

      expect(() => {
        registry.getWebhookUrl('polling-trigger', 'https://api.example.com')
      }).toThrow()
    })
  })
})

// =============================================================================
// TriggerEngine Integration Tests
// =============================================================================

describe('TriggerEngine', () => {
  let engine: TriggerEngine

  beforeEach(() => {
    engine = new TriggerEngine()
  })

  describe('initialization', () => {
    it('should create with default components', () => {
      expect(engine.webhooks).toBeInstanceOf(WebhookReceiver)
      expect(engine.polling).toBeInstanceOf(PollingScheduler)
      expect(engine.events).toBeInstanceOf(EventBus)
      expect(engine.registry).toBeInstanceOf(TriggerRegistry)
    })
  })

  describe('webhook handling', () => {
    it('should register and handle webhook trigger', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: { processed: true } })

      engine.webhook('github', {
        path: '/webhooks/github',
        secret: 'my-secret',
      }, handler)

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        body: JSON.stringify({ action: 'opened' }),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await engine.handleWebhook(request, '/webhooks/github')

      expect(handler).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  describe('event triggering', () => {
    it('should register and fire event trigger', async () => {
      const handler = vi.fn()

      engine.event('user-signup', 'user.created', handler)
      engine.events.emit('user.created', { userId: 123 })

      expect(handler).toHaveBeenCalledWith({ userId: 123 }, expect.objectContaining({ timestamp: expect.any(Number) }))
    })
  })

  describe('trigger execution context', () => {
    it('should pass TriggerContext to handlers', async () => {
      let capturedCtx: TriggerContext | undefined

      engine.webhook('test', { path: '/test' }, async (ctx) => {
        capturedCtx = ctx
        return { success: true, data: null, triggerId: 'test', timestamp: Date.now(), source: 'webhook' }
      })

      const request = new Request('https://example.com/test', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })

      await engine.handleWebhook(request, '/test')

      expect(capturedCtx).toMatchObject({
        triggerId: 'test',
        triggerType: 'webhook',
        timestamp: expect.any(Number),
        data: expect.any(Object),
      })
    })
  })

  describe('metrics and observability', () => {
    it('should track trigger fire counts', async () => {
      engine.webhook('counted', { path: '/counted' }, async () => ({
        success: true,
        data: null,
        triggerId: 'counted',
        timestamp: Date.now(),
        source: 'webhook',
      }))

      const createRequest = () => new Request('https://example.com/counted', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })

      await engine.handleWebhook(createRequest(), '/counted')
      await engine.handleWebhook(createRequest(), '/counted')

      const stats = engine.getStats('counted')
      expect(stats.fireCount).toBe(2)
    })

    it('should track success and failure counts', async () => {
      let shouldFail = false

      engine.webhook('flaky', { path: '/flaky' }, async () => {
        if (shouldFail) {
          throw new Error('Failed!')
        }
        return { success: true, data: null, triggerId: 'flaky', timestamp: Date.now(), source: 'webhook' }
      })

      const createRequest = () => new Request('https://example.com/flaky', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })

      await engine.handleWebhook(createRequest(), '/flaky')
      shouldFail = true
      await engine.handleWebhook(createRequest(), '/flaky').catch(() => {})

      const stats = engine.getStats('flaky')
      expect(stats.successCount).toBe(1)
      expect(stats.failureCount).toBe(1)
    })
  })
})

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('HMAC utilities', () => {
  describe('createHmacSignature', () => {
    it('should create SHA-256 signature', async () => {
      const signature = await createHmacSignature('hello', 'secret', 'sha256')
      expect(signature).toBeDefined()
      expect(typeof signature).toBe('string')
    })

    it('should create SHA-1 signature', async () => {
      const signature = await createHmacSignature('hello', 'secret', 'sha1')
      expect(signature).toBeDefined()
      expect(typeof signature).toBe('string')
    })

    it('should produce consistent signatures', async () => {
      const sig1 = await createHmacSignature('hello', 'secret', 'sha256')
      const sig2 = await createHmacSignature('hello', 'secret', 'sha256')
      expect(sig1).toBe(sig2)
    })

    it('should produce different signatures for different data', async () => {
      const sig1 = await createHmacSignature('hello', 'secret', 'sha256')
      const sig2 = await createHmacSignature('world', 'secret', 'sha256')
      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verifyHmacSignature', () => {
    it('should verify valid signature', async () => {
      const signature = await createHmacSignature('hello', 'secret', 'sha256')
      const isValid = await verifyHmacSignature('hello', 'secret', signature, 'sha256')
      expect(isValid).toBe(true)
    })

    it('should reject invalid signature', async () => {
      const isValid = await verifyHmacSignature('hello', 'secret', 'invalid', 'sha256')
      expect(isValid).toBe(false)
    })

    it('should reject signature for wrong data', async () => {
      const signature = await createHmacSignature('hello', 'secret', 'sha256')
      const isValid = await verifyHmacSignature('world', 'secret', signature, 'sha256')
      expect(isValid).toBe(false)
    })
  })
})
