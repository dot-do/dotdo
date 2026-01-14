import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createEventSink,
  initEventSink,
  sendEvents,
  sendEvent,
  hasEventsBinding,
  event,
  routingEvent,
  usageEvent,
  rpcEvent,
  thingCreatedEvent,
  sessionStartedEvent,
  pageViewedEvent,
  vitalsEvent,
  errorEvent,
  workerInvokedEvent,
  browserConnectedEvent,
  identifyEvent,
  trackEvent,
  PipelineEventSink,
  HttpEventSink,
  EVENTS_ENDPOINT,
  MAX_BATCH_SIZE,
  type Pipeline,
  type EventsEnv,
} from '../pipeline'

describe('Events Pipeline', () => {
  describe('createEventSink', () => {
    it('returns PipelineEventSink when EVENTS binding exists', () => {
      const mockPipeline: Pipeline = { send: vi.fn() }
      const env: EventsEnv = { EVENTS: mockPipeline }

      const sink = createEventSink(env)

      expect(sink).toBeInstanceOf(PipelineEventSink)
    })

    it('returns HttpEventSink when no EVENTS binding', () => {
      const sink = createEventSink({})
      expect(sink).toBeInstanceOf(HttpEventSink)
    })

    it('returns HttpEventSink when env is undefined', () => {
      const sink = createEventSink(undefined)
      expect(sink).toBeInstanceOf(HttpEventSink)
    })
  })

  describe('hasEventsBinding', () => {
    it('returns true when EVENTS binding exists', () => {
      const mockPipeline: Pipeline = { send: vi.fn() }
      const env: EventsEnv = { EVENTS: mockPipeline }

      expect(hasEventsBinding(env)).toBe(true)
    })

    it('returns false when no EVENTS binding', () => {
      expect(hasEventsBinding({})).toBe(false)
    })

    it('returns false when env is undefined', () => {
      expect(hasEventsBinding(undefined)).toBe(false)
    })
  })

  describe('PipelineEventSink', () => {
    it('sends events to pipeline', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      const events = [event('Test.event', { source: 'test' })]
      await sink.send(events)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(mockSend).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ verb: 'Test.event', source: 'test', timestamp: expect.any(String) }),
        ])
      )
    })

    it('adds timestamp if missing', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      await sink.send([{ verb: 'Test.event', source: 'test', timestamp: '' }])

      const sentEvents = mockSend.mock.calls[0][0]
      expect(sentEvents[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('preserves existing timestamp', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      const timestamp = '2024-01-14T12:00:00.000Z'
      await sink.send([{ verb: 'Test.event', source: 'test', timestamp }])

      const sentEvents = mockSend.mock.calls[0][0]
      expect(sentEvents[0].timestamp).toBe(timestamp)
    })

    it('does nothing for empty events array', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      await sink.send([])

      expect(mockSend).not.toHaveBeenCalled()
    })

    it('batches large event arrays', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      // Create more than MAX_BATCH_SIZE events
      const events = Array.from({ length: MAX_BATCH_SIZE + 100 }, (_, i) =>
        event('Test.event', { source: 'test', index: i })
      )

      await sink.send(events)

      // Should be called twice (one full batch + remainder)
      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend.mock.calls[0][0]).toHaveLength(MAX_BATCH_SIZE)
      expect(mockSend.mock.calls[1][0]).toHaveLength(100)
    })
  })

  describe('HttpEventSink', () => {
    let originalFetch: typeof fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('sends events via HTTP POST', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      globalThis.fetch = mockFetch

      const sink = new HttpEventSink()
      await sink.send([event('Test.event', { source: 'test' })])

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        EVENTS_ENDPOINT,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body[0]).toMatchObject({ verb: 'Test.event', source: 'test' })
    })

    it('uses custom endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      globalThis.fetch = mockFetch

      const customEndpoint = 'https://custom.example.com/events'
      const sink = new HttpEventSink(customEndpoint)
      await sink.send([event('Test.event', { source: 'test' })])

      expect(mockFetch).toHaveBeenCalledWith(customEndpoint, expect.any(Object))
    })

    it('handles HTTP errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      globalThis.fetch = mockFetch
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sink = new HttpEventSink()
      await sink.send([event('Test.event', { source: 'test' })])

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP error'))
      consoleSpy.mockRestore()
    })

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      globalThis.fetch = mockFetch
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sink = new HttpEventSink()
      await sink.send([event('Test.event', { source: 'test' })])

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('does nothing for empty events array', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      globalThis.fetch = mockFetch

      const sink = new HttpEventSink()
      await sink.send([])

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('Event Factory - Generic', () => {
    it('creates event with Noun.event verb and flat fields', () => {
      const ev = event('Customer.created', {
        source: 'tenant-123',
        customerId: 'cust-456',
        name: 'Acme Corp',
      })

      expect(ev.verb).toBe('Customer.created')
      expect(ev.source).toBe('tenant-123')
      expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(ev.customerId).toBe('cust-456')
      expect(ev.name).toBe('Acme Corp')
    })
  })

  describe('Event Factories - Typed', () => {
    describe('routingEvent', () => {
      it('creates Request.routed event with required fields', () => {
        const ev = routingEvent({
          source: 'api-router',
          requestId: 'req-123',
          pathname: '/api/customers',
          method: 'GET',
          targetBinding: 'DO',
          durationMs: 5,
        })

        expect(ev.verb).toBe('Request.routed')
        expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(ev.source).toBe('api-router')
        expect(ev.requestId).toBe('req-123')
        expect(ev.pathname).toBe('/api/customers')
        expect(ev.method).toBe('GET')
        expect(ev.targetBinding).toBe('DO')
        expect(ev.durationMs).toBe(5)
      })

      it('includes optional fields', () => {
        const ev = routingEvent({
          source: 'api-router',
          requestId: 'req-123',
          pathname: '/api/customers',
          method: 'GET',
          targetBinding: 'REPLICA_DO',
          isReplica: true,
          consistencyMode: 'eventual',
          durationMs: 5,
          colo: 'SJC',
          region: 'wnam',
          replicaRegion: 'us-west-2',
        })

        expect(ev.colo).toBe('SJC')
        expect(ev.region).toBe('wnam')
        expect(ev.replicaRegion).toBe('us-west-2')
      })
    })

    describe('usageEvent', () => {
      it('creates Usage.recorded event with required fields', () => {
        const ev = usageEvent({
          source: 'api-gateway',
          requestId: 'req-123',
          endpoint: '/api/customers',
          method: 'GET',
          statusCode: 200,
          latencyMs: 50,
          cost: 1,
        })

        expect(ev.verb).toBe('Usage.recorded')
        expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(ev.source).toBe('api-gateway')
        expect(ev.requestId).toBe('req-123')
        expect(ev.statusCode).toBe(200)
        expect(ev.latencyMs).toBe(50)
        expect(ev.cost).toBe(1)
      })

      it('includes optional fields', () => {
        const ev = usageEvent({
          source: 'api-gateway',
          requestId: 'req-123',
          endpoint: '/api/customers',
          method: 'GET',
          statusCode: 200,
          latencyMs: 50,
          cost: 1,
          userId: 'user-456',
          apiKeyId: 'key-789',
          tenantId: 'acme',
        })

        expect(ev.userId).toBe('user-456')
        expect(ev.apiKeyId).toBe('key-789')
        expect(ev.tenantId).toBe('acme')
      })
    })

    describe('rpcEvent', () => {
      it('creates RPC.called event with required fields', () => {
        const ev = rpcEvent({
          source: 'rpc-gateway',
          requestId: 'req-123',
          service: 'CustomerService',
          method: 'getCustomer',
          status: 'ok',
          durationMs: 10,
          costUnits: 1,
        })

        expect(ev.verb).toBe('RPC.called')
        expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(ev.service).toBe('CustomerService')
        expect(ev.method).toBe('getCustomer')
        expect(ev.status).toBe('ok')
        expect(ev.durationMs).toBe(10)
        expect(ev.costUnits).toBe(1)
      })

      it('includes optional token counts', () => {
        const ev = rpcEvent({
          source: 'rpc-gateway',
          requestId: 'req-123',
          service: 'AIService',
          method: 'generate',
          status: 'ok',
          durationMs: 1000,
          costUnits: 10,
          inputTokens: 100,
          outputTokens: 500,
        })

        expect(ev.inputTokens).toBe(100)
        expect(ev.outputTokens).toBe(500)
      })
    })

    describe('thingCreatedEvent', () => {
      it('creates dynamic Noun.created event', () => {
        const ev = thingCreatedEvent({
          source: 'tenant-123',
          thingId: 'cust-456',
          thingType: 'Customer',
          name: 'Acme Corp',
        })

        expect(ev.verb).toBe('Customer.created')
        expect(ev.source).toBe('tenant-123')
        expect(ev.thingId).toBe('cust-456')
        expect(ev.thingType).toBe('Customer')
        expect(ev.name).toBe('Acme Corp')
      })
    })

    describe('sessionStartedEvent', () => {
      it('creates Session.started event', () => {
        const ev = sessionStartedEvent({
          source: 'browser-sdk',
          sessionId: 'sess-123',
          userId: 'user-456',
          userAgent: 'Mozilla/5.0',
        })

        expect(ev.verb).toBe('Session.started')
        expect(ev.sessionId).toBe('sess-123')
        expect(ev.userId).toBe('user-456')
      })
    })

    describe('pageViewedEvent', () => {
      it('creates Page.viewed event', () => {
        const ev = pageViewedEvent({
          source: 'browser-sdk',
          sessionId: 'sess-123',
          pathname: '/dashboard',
          title: 'Dashboard',
        })

        expect(ev.verb).toBe('Page.viewed')
        expect(ev.pathname).toBe('/dashboard')
        expect(ev.title).toBe('Dashboard')
      })
    })

    describe('vitalsEvent', () => {
      it('creates Vitals.measured event', () => {
        const ev = vitalsEvent({
          source: 'browser-sdk',
          sessionId: 'sess-123',
          pathname: '/dashboard',
          metric: 'LCP',
          value: 2500,
          rating: 'good',
        })

        expect(ev.verb).toBe('Vitals.measured')
        expect(ev.metric).toBe('LCP')
        expect(ev.value).toBe(2500)
        expect(ev.rating).toBe('good')
      })
    })

    describe('errorEvent', () => {
      it('creates Error.caught event', () => {
        const ev = errorEvent({
          source: 'browser-sdk',
          errorType: 'TypeError',
          message: 'Cannot read property x of undefined',
          sessionId: 'sess-123',
        })

        expect(ev.verb).toBe('Error.caught')
        expect(ev.errorType).toBe('TypeError')
        expect(ev.message).toBe('Cannot read property x of undefined')
      })
    })

    describe('workerInvokedEvent', () => {
      it('creates Worker.invoked event', () => {
        const ev = workerInvokedEvent({
          source: 'api-worker',
          requestId: 'req-123',
          method: 'GET',
          pathname: '/api/users',
          statusCode: 200,
          durationMs: 45,
          colo: 'SJC',
        })

        expect(ev.verb).toBe('Worker.invoked')
        expect(ev.statusCode).toBe(200)
        expect(ev.durationMs).toBe(45)
        expect(ev.colo).toBe('SJC')
      })
    })

    describe('browserConnectedEvent', () => {
      it('creates Browser.connected event', () => {
        const ev = browserConnectedEvent({
          source: 'browser-do',
          browserId: 'browser-123',
          sessionId: 'sess-456',
        })

        expect(ev.verb).toBe('Browser.connected')
        expect(ev.browserId).toBe('browser-123')
        expect(ev.sessionId).toBe('sess-456')
      })
    })

    describe('identifyEvent', () => {
      it('creates User.identified event (Segment-style)', () => {
        const ev = identifyEvent({
          source: 'analytics-sdk',
          userId: 'user-123',
          anonymousId: 'anon-456',
          traits: JSON.stringify({ plan: 'enterprise' }),
        })

        expect(ev.verb).toBe('User.identified')
        expect(ev.userId).toBe('user-123')
        expect(ev.traits).toBe('{"plan":"enterprise"}')
      })
    })

    describe('trackEvent', () => {
      it('creates Action.tracked event (Segment-style)', () => {
        const ev = trackEvent({
          source: 'analytics-sdk',
          eventName: 'Button Clicked',
          userId: 'user-123',
          properties: JSON.stringify({ buttonId: 'submit' }),
        })

        expect(ev.verb).toBe('Action.tracked')
        expect(ev.actionName).toBe('Button Clicked')
        expect(ev.properties).toBe('{"buttonId":"submit"}')
      })
    })
  })

  describe('Global Sink Functions', () => {
    let originalFetch: typeof fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('sendEvents uses HTTP fallback by default', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>

      await sendEvents([event('Test.event', { source: 'test' })])

      expect(mockFetch).toHaveBeenCalledWith(EVENTS_ENDPOINT, expect.any(Object))
    })

    it('sendEvent sends single event', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>

      await sendEvent(event('Test.event', { source: 'test' }))

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body).toHaveLength(1)
    })

    it('initEventSink configures pipeline binding', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }

      initEventSink({ EVENTS: mockPipeline })
      await sendEvents([event('Test.event', { source: 'test' })])

      expect(mockSend).toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('Flat Fields Constraint', () => {
    it('all event fields are primitives (no nested objects)', () => {
      const ev = event('Customer.created', {
        source: 'tenant-123',
        customerId: 'cust-456',
        name: 'Acme Corp',
        count: 42,
        active: true,
        empty: null,
      })

      // Verify all values are primitives
      for (const [key, value] of Object.entries(ev)) {
        expect(['string', 'number', 'boolean', 'undefined'].includes(typeof value) || value === null).toBe(true)
      }
    })
  })
})
