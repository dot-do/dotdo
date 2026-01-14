import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  WebhookEngine,
  WebhookDispatcher,
  SignatureGenerator,
  RetryScheduler,
  DeliveryTracker,
  EventFilter,
  PayloadTransformer,
} from './index'
import type {
  WebhookConfig,
  WebhookEvent,
  WebhookSubscription,
  RetryPolicy,
  HttpClient,
  HttpResponse,
} from './types'

// Mock HTTP client for testing
function createMockHttpClient(responses: HttpResponse[] = []): HttpClient {
  let callIndex = 0
  return {
    post: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex] || { status: 200, body: 'OK', headers: {} }
      callIndex++
      return response
    }),
  }
}

describe('WebhookEngine', () => {
  let engine: WebhookEngine
  let mockHttpClient: HttpClient

  beforeEach(() => {
    mockHttpClient = createMockHttpClient()
    engine = new WebhookEngine({ httpClient: mockHttpClient })
  })

  describe('Webhook Registration', () => {
    it('should register a new webhook subscription', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'my-secret-key',
        events: ['user.created', 'user.updated'],
      }

      const subscription = await engine.register(config)

      expect(subscription.id).toBeDefined()
      expect(subscription.config).toEqual(config)
      expect(subscription.status).toBe('active')
      expect(subscription.createdAt).toBeInstanceOf(Date)
    })

    it('should generate unique IDs for each subscription', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const sub1 = await engine.register(config)
      const sub2 = await engine.register(config)

      expect(sub1.id).not.toBe(sub2.id)
    })

    it('should register webhook with custom headers', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
        headers: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token',
        },
      }

      const subscription = await engine.register(config)

      expect(subscription.config.headers).toEqual({
        'X-Custom-Header': 'custom-value',
        Authorization: 'Bearer token',
      })
    })

    it('should allow registering disabled webhooks', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
        enabled: false,
      }

      const subscription = await engine.register(config)

      expect(subscription.status).toBe('disabled')
    })
  })

  describe('Webhook Unregistration', () => {
    it('should unregister an existing webhook', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)
      const result = await engine.unregister(subscription.id)

      expect(result).toBe(true)
    })

    it('should return false when unregistering non-existent webhook', async () => {
      const result = await engine.unregister('non-existent-id')

      expect(result).toBe(false)
    })

    it('should not deliver events to unregistered webhooks', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)
      await engine.unregister(subscription.id)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: { data: 'test' },
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(0)
    })
  })

  describe('Event Triggering', () => {
    it('should trigger event delivery to matching webhooks', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['user.created'],
      }

      await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'user.created',
        payload: { userId: '123' },
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1)
    })

    it('should not trigger events for non-matching event types', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['user.created'],
      }

      await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'order.completed',
        payload: { orderId: '456' },
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(0)
      expect(mockHttpClient.post).not.toHaveBeenCalled()
    })

    it('should trigger to multiple subscribers', async () => {
      mockHttpClient = createMockHttpClient([
        { status: 200, body: 'OK', headers: {} },
        { status: 200, body: 'OK', headers: {} },
        { status: 200, body: 'OK', headers: {} },
      ])
      engine = new WebhookEngine({ httpClient: mockHttpClient })

      const configs: WebhookConfig[] = [
        { url: 'https://example1.com/webhook', secret: 'secret1', events: ['user.created'] },
        { url: 'https://example2.com/webhook', secret: 'secret2', events: ['user.created'] },
        { url: 'https://example3.com/webhook', secret: 'secret3', events: ['order.completed'] },
      ]

      for (const config of configs) {
        await engine.register(config)
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'user.created',
        payload: { userId: '123' },
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(2)
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2)
    })

    it('should skip disabled webhooks', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
        enabled: false,
      }

      await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(0)
    })

    it('should support wildcard event subscriptions', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['*'],
      }

      await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'any.event.type',
        payload: {},
        timestamp: new Date(),
      }

      const results = await engine.trigger(event)

      expect(results).toHaveLength(1)
    })
  })

  describe('Webhook Disable/Enable', () => {
    it('should disable a webhook', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)
      const updated = await engine.disable(subscription.id)

      expect(updated?.status).toBe('disabled')
    })

    it('should enable a disabled webhook', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
        enabled: false,
      }

      const subscription = await engine.register(config)
      const updated = await engine.enable(subscription.id)

      expect(updated?.status).toBe('active')
    })

    it('should return null when enabling non-existent webhook', async () => {
      const result = await engine.enable('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('Delivery History', () => {
    it('should track delivery history for a webhook', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: { data: 'test' },
        timestamp: new Date(),
      }

      await engine.trigger(event)

      const deliveries = await engine.getDeliveries(subscription.id)

      expect(deliveries).toHaveLength(1)
      expect(deliveries[0].webhookId).toBe(subscription.id)
      expect(deliveries[0].eventId).toBe('event-1')
      expect(deliveries[0].success).toBe(true)
    })

    it('should return empty array for webhook with no deliveries', async () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)
      const deliveries = await engine.getDeliveries(subscription.id)

      expect(deliveries).toEqual([])
    })

    it('should track multiple delivery attempts', async () => {
      mockHttpClient = createMockHttpClient([
        { status: 500, body: 'Error', headers: {} },
        { status: 500, body: 'Error', headers: {} },
        { status: 200, body: 'OK', headers: {} },
      ])
      engine = new WebhookEngine({
        httpClient: mockHttpClient,
        retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseDelay: 0 },
      })

      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      await engine.trigger(event)

      const deliveries = await engine.getDeliveries(subscription.id)

      expect(deliveries).toHaveLength(3)
      expect(deliveries[0].attempt).toBe(1)
      expect(deliveries[0].success).toBe(false)
      expect(deliveries[1].attempt).toBe(2)
      expect(deliveries[1].success).toBe(false)
      expect(deliveries[2].attempt).toBe(3)
      expect(deliveries[2].success).toBe(true)
    })
  })

  describe('Manual Retry', () => {
    it('should manually retry a failed delivery', async () => {
      mockHttpClient = createMockHttpClient([
        { status: 500, body: 'Error', headers: {} },
        { status: 200, body: 'OK', headers: {} },
      ])
      engine = new WebhookEngine({
        httpClient: mockHttpClient,
        retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseDelay: 0 },
      })

      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['test'],
      }

      const subscription = await engine.register(config)

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      const [result] = await engine.trigger(event)
      expect(result.success).toBe(false)

      const deliveries = await engine.getDeliveries(subscription.id)
      const retryResult = await engine.retry(deliveries[0].id)

      expect(retryResult.success).toBe(true)
    })

    it('should return error when retrying non-existent delivery', async () => {
      await expect(engine.retry('non-existent')).rejects.toThrow('Delivery not found')
    })
  })
})

describe('SignatureGenerator', () => {
  let generator: SignatureGenerator

  beforeEach(() => {
    generator = new SignatureGenerator()
  })

  describe('HMAC Signature Generation', () => {
    it('should generate SHA-256 HMAC signature', () => {
      const payload = JSON.stringify({ test: 'data' })
      const secret = 'my-secret-key'

      const signature = generator.generate(payload, secret, 'sha256')

      expect(signature.algorithm).toBe('sha256')
      expect(signature.header).toBe('X-Webhook-Signature')
      expect(signature.signature).toMatch(/^sha256=/)
    })

    it('should generate consistent signatures for same input', () => {
      const payload = JSON.stringify({ test: 'data' })
      const secret = 'my-secret-key'

      const sig1 = generator.generate(payload, secret, 'sha256')
      const sig2 = generator.generate(payload, secret, 'sha256')

      expect(sig1.signature).toBe(sig2.signature)
    })

    it('should generate different signatures for different payloads', () => {
      const secret = 'my-secret-key'

      const sig1 = generator.generate(JSON.stringify({ a: 1 }), secret, 'sha256')
      const sig2 = generator.generate(JSON.stringify({ b: 2 }), secret, 'sha256')

      expect(sig1.signature).not.toBe(sig2.signature)
    })

    it('should generate different signatures for different secrets', () => {
      const payload = JSON.stringify({ test: 'data' })

      const sig1 = generator.generate(payload, 'secret1', 'sha256')
      const sig2 = generator.generate(payload, 'secret2', 'sha256')

      expect(sig1.signature).not.toBe(sig2.signature)
    })
  })

  describe('Signature Verification', () => {
    it('should verify a valid signature', () => {
      const payload = JSON.stringify({ test: 'data' })
      const secret = 'my-secret-key'

      const signature = generator.generate(payload, secret, 'sha256')
      const isValid = generator.verify(payload, secret, signature.signature)

      expect(isValid).toBe(true)
    })

    it('should reject an invalid signature', () => {
      const payload = JSON.stringify({ test: 'data' })
      const secret = 'my-secret-key'

      const isValid = generator.verify(payload, secret, 'sha256=invalid-signature')

      expect(isValid).toBe(false)
    })

    it('should reject signature with wrong secret', () => {
      const payload = JSON.stringify({ test: 'data' })

      const signature = generator.generate(payload, 'correct-secret', 'sha256')
      const isValid = generator.verify(payload, 'wrong-secret', signature.signature)

      expect(isValid).toBe(false)
    })

    it('should reject tampered payload', () => {
      const originalPayload = JSON.stringify({ test: 'data' })
      const tamperedPayload = JSON.stringify({ test: 'tampered' })
      const secret = 'my-secret-key'

      const signature = generator.generate(originalPayload, secret, 'sha256')
      const isValid = generator.verify(tamperedPayload, secret, signature.signature)

      expect(isValid).toBe(false)
    })
  })
})

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher
  let mockHttpClient: HttpClient

  beforeEach(() => {
    mockHttpClient = createMockHttpClient()
    dispatcher = new WebhookDispatcher(mockHttpClient)
  })

  describe('Successful Delivery', () => {
    it('should deliver webhook successfully', async () => {
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        config: {
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['test'],
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: { data: 'test' },
        timestamp: new Date(),
      }

      const result = await dispatcher.deliver(subscription, event)

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(1)
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Signature': expect.stringMatching(/^sha256=/),
          }),
        })
      )
    })

    it('should include custom headers in request', async () => {
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        config: {
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['test'],
          headers: {
            'X-Custom': 'value',
          },
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      await dispatcher.deliver(subscription, event)

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom': 'value',
          }),
        })
      )
    })
  })

  describe('Failed Delivery with Retry', () => {
    it('should retry on 5xx errors', async () => {
      mockHttpClient = createMockHttpClient([
        { status: 500, body: 'Error', headers: {} },
        { status: 503, body: 'Unavailable', headers: {} },
        { status: 200, body: 'OK', headers: {} },
      ])
      dispatcher = new WebhookDispatcher(mockHttpClient, {
        maxAttempts: 3,
        backoff: 'fixed',
        baseDelay: 0,
      })

      const subscription: WebhookSubscription = {
        id: 'sub-1',
        config: {
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['test'],
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      const result = await dispatcher.deliver(subscription, event)

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
      expect(mockHttpClient.post).toHaveBeenCalledTimes(3)
    })

    it('should not retry on 4xx errors', async () => {
      mockHttpClient = createMockHttpClient([{ status: 400, body: 'Bad Request', headers: {} }])
      dispatcher = new WebhookDispatcher(mockHttpClient, {
        maxAttempts: 3,
        backoff: 'fixed',
        baseDelay: 0,
      })

      const subscription: WebhookSubscription = {
        id: 'sub-1',
        config: {
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['test'],
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      const result = await dispatcher.deliver(subscription, event)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1)
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1)
    })

    it('should stop retrying after max attempts', async () => {
      mockHttpClient = createMockHttpClient([
        { status: 500, body: 'Error', headers: {} },
        { status: 500, body: 'Error', headers: {} },
        { status: 500, body: 'Error', headers: {} },
      ])
      dispatcher = new WebhookDispatcher(mockHttpClient, {
        maxAttempts: 3,
        backoff: 'fixed',
        baseDelay: 0,
      })

      const subscription: WebhookSubscription = {
        id: 'sub-1',
        config: {
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['test'],
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const event: WebhookEvent = {
        id: 'event-1',
        type: 'test',
        payload: {},
        timestamp: new Date(),
      }

      const result = await dispatcher.deliver(subscription, event)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(result.lastError).toBeDefined()
    })
  })
})

describe('RetryScheduler', () => {
  let scheduler: RetryScheduler

  describe('Exponential Backoff', () => {
    beforeEach(() => {
      scheduler = new RetryScheduler({
        maxAttempts: 5,
        backoff: 'exponential',
        baseDelay: 1000,
      })
    })

    it('should calculate exponential delays', () => {
      expect(scheduler.getDelay(1)).toBe(1000) // 1000 * 2^0
      expect(scheduler.getDelay(2)).toBe(2000) // 1000 * 2^1
      expect(scheduler.getDelay(3)).toBe(4000) // 1000 * 2^2
      expect(scheduler.getDelay(4)).toBe(8000) // 1000 * 2^3
    })

    it('should respect max delay', () => {
      scheduler = new RetryScheduler({
        maxAttempts: 10,
        backoff: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000,
      })

      expect(scheduler.getDelay(5)).toBe(5000) // Would be 16000, capped at 5000
    })

    it('should determine if retry is allowed', () => {
      expect(scheduler.shouldRetry(1)).toBe(true)
      expect(scheduler.shouldRetry(4)).toBe(true)
      expect(scheduler.shouldRetry(5)).toBe(false)
    })
  })

  describe('Linear Backoff', () => {
    beforeEach(() => {
      scheduler = new RetryScheduler({
        maxAttempts: 5,
        backoff: 'linear',
        baseDelay: 1000,
      })
    })

    it('should calculate linear delays', () => {
      expect(scheduler.getDelay(1)).toBe(1000) // 1000 * 1
      expect(scheduler.getDelay(2)).toBe(2000) // 1000 * 2
      expect(scheduler.getDelay(3)).toBe(3000) // 1000 * 3
    })
  })

  describe('Fixed Backoff', () => {
    beforeEach(() => {
      scheduler = new RetryScheduler({
        maxAttempts: 5,
        backoff: 'fixed',
        baseDelay: 1000,
      })
    })

    it('should return fixed delays', () => {
      expect(scheduler.getDelay(1)).toBe(1000)
      expect(scheduler.getDelay(2)).toBe(1000)
      expect(scheduler.getDelay(3)).toBe(1000)
    })
  })

  describe('Custom Delays', () => {
    it('should use custom delay array when provided', () => {
      scheduler = new RetryScheduler({
        maxAttempts: 4,
        backoff: 'exponential',
        baseDelay: 1000,
        delays: [100, 500, 2000, 10000],
      })

      expect(scheduler.getDelay(1)).toBe(100)
      expect(scheduler.getDelay(2)).toBe(500)
      expect(scheduler.getDelay(3)).toBe(2000)
      expect(scheduler.getDelay(4)).toBe(10000)
    })
  })
})

describe('DeliveryTracker', () => {
  let tracker: DeliveryTracker

  beforeEach(() => {
    tracker = new DeliveryTracker()
  })

  it('should track a delivery attempt', () => {
    const delivery = tracker.track({
      webhookId: 'webhook-1',
      eventId: 'event-1',
      attempt: 1,
      status: 200,
      response: 'OK',
      duration: 150,
      success: true,
    })

    expect(delivery.id).toBeDefined()
    expect(delivery.webhookId).toBe('webhook-1')
    expect(delivery.success).toBe(true)
  })

  it('should retrieve deliveries by webhook ID', () => {
    tracker.track({
      webhookId: 'webhook-1',
      eventId: 'event-1',
      attempt: 1,
      status: 200,
      response: 'OK',
      duration: 100,
      success: true,
    })
    tracker.track({
      webhookId: 'webhook-1',
      eventId: 'event-2',
      attempt: 1,
      status: 200,
      response: 'OK',
      duration: 100,
      success: true,
    })
    tracker.track({
      webhookId: 'webhook-2',
      eventId: 'event-3',
      attempt: 1,
      status: 200,
      response: 'OK',
      duration: 100,
      success: true,
    })

    const deliveries = tracker.getByWebhookId('webhook-1')

    expect(deliveries).toHaveLength(2)
    expect(deliveries.every((d) => d.webhookId === 'webhook-1')).toBe(true)
  })

  it('should retrieve delivery by ID', () => {
    const delivery = tracker.track({
      webhookId: 'webhook-1',
      eventId: 'event-1',
      attempt: 1,
      status: 200,
      response: 'OK',
      duration: 100,
      success: true,
    })

    const retrieved = tracker.getById(delivery.id)

    expect(retrieved).toEqual(delivery)
  })

  it('should track failed deliveries with error', () => {
    const delivery = tracker.track({
      webhookId: 'webhook-1',
      eventId: 'event-1',
      attempt: 1,
      status: 500,
      response: 'Internal Server Error',
      duration: 200,
      success: false,
      error: 'Server returned 500',
    })

    expect(delivery.success).toBe(false)
    expect(delivery.error).toBe('Server returned 500')
  })
})

describe('EventFilter', () => {
  let filter: EventFilter

  beforeEach(() => {
    filter = new EventFilter()
  })

  it('should match exact event types', () => {
    const subscription: WebhookSubscription = {
      id: 'sub-1',
      config: {
        url: 'https://example.com',
        secret: 'secret',
        events: ['user.created', 'user.updated'],
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const event: WebhookEvent = {
      id: 'event-1',
      type: 'user.created',
      payload: {},
      timestamp: new Date(),
    }

    expect(filter.matches(event, subscription)).toBe(true)
  })

  it('should not match non-subscribed events', () => {
    const subscription: WebhookSubscription = {
      id: 'sub-1',
      config: {
        url: 'https://example.com',
        secret: 'secret',
        events: ['user.created'],
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const event: WebhookEvent = {
      id: 'event-1',
      type: 'order.completed',
      payload: {},
      timestamp: new Date(),
    }

    expect(filter.matches(event, subscription)).toBe(false)
  })

  it('should match wildcard subscriptions', () => {
    const subscription: WebhookSubscription = {
      id: 'sub-1',
      config: {
        url: 'https://example.com',
        secret: 'secret',
        events: ['*'],
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const event: WebhookEvent = {
      id: 'event-1',
      type: 'any.event.type',
      payload: {},
      timestamp: new Date(),
    }

    expect(filter.matches(event, subscription)).toBe(true)
  })

  it('should match prefix wildcards', () => {
    const subscription: WebhookSubscription = {
      id: 'sub-1',
      config: {
        url: 'https://example.com',
        secret: 'secret',
        events: ['user.*'],
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(
      filter.matches(
        { id: '1', type: 'user.created', payload: {}, timestamp: new Date() },
        subscription
      )
    ).toBe(true)
    expect(
      filter.matches(
        { id: '2', type: 'user.updated', payload: {}, timestamp: new Date() },
        subscription
      )
    ).toBe(true)
    expect(
      filter.matches(
        { id: '3', type: 'order.created', payload: {}, timestamp: new Date() },
        subscription
      )
    ).toBe(false)
  })

  it('should filter disabled webhooks', () => {
    const subscription: WebhookSubscription = {
      id: 'sub-1',
      config: {
        url: 'https://example.com',
        secret: 'secret',
        events: ['user.created'],
      },
      status: 'disabled',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const event: WebhookEvent = {
      id: 'event-1',
      type: 'user.created',
      payload: {},
      timestamp: new Date(),
    }

    expect(filter.matches(event, subscription)).toBe(false)
  })
})

describe('PayloadTransformer', () => {
  let transformer: PayloadTransformer

  beforeEach(() => {
    transformer = new PayloadTransformer()
  })

  it('should return default payload format', () => {
    const event: WebhookEvent = {
      id: 'event-1',
      type: 'user.created',
      payload: { userId: '123', name: 'John' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const result = transformer.transform(event)

    expect(result).toEqual({
      id: 'event-1',
      type: 'user.created',
      data: { userId: '123', name: 'John' },
      timestamp: '2024-01-01T00:00:00.000Z',
    })
  })

  it('should apply custom transformer', () => {
    const event: WebhookEvent = {
      id: 'event-1',
      type: 'user.created',
      payload: { userId: '123' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    transformer.register('webhook-1', (e) => ({
      custom: true,
      eventType: e.type,
      payload: e.payload,
    }))

    const result = transformer.transform(event, 'webhook-1')

    expect(result).toEqual({
      custom: true,
      eventType: 'user.created',
      payload: { userId: '123' },
    })
  })

  it('should use default transformer when no custom one exists', () => {
    const event: WebhookEvent = {
      id: 'event-1',
      type: 'test',
      payload: { data: 'test' },
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const result = transformer.transform(event, 'non-existent-webhook')

    expect(result).toEqual({
      id: 'event-1',
      type: 'test',
      data: { data: 'test' },
      timestamp: '2024-01-01T00:00:00.000Z',
    })
  })

  it('should unregister custom transformer', () => {
    const event: WebhookEvent = {
      id: 'event-1',
      type: 'test',
      payload: {},
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    transformer.register('webhook-1', () => ({ custom: true }))
    expect(transformer.transform(event, 'webhook-1')).toEqual({ custom: true })

    transformer.unregister('webhook-1')
    expect(transformer.transform(event, 'webhook-1')).toEqual({
      id: 'event-1',
      type: 'test',
      data: {},
      timestamp: '2024-01-01T00:00:00.000Z',
    })
  })
})
