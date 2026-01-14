import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createEventSink,
  initEventSink,
  sendEvents,
  sendEvent,
  hasEventsBinding,
  routingEvent,
  usageEvent,
  rpcEvent,
  genericEvent,
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

      const events = [{ type: 'test', data: 'value' }]
      await sink.send(events)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(mockSend).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'test', data: 'value', timestamp: expect.any(Number) }),
        ])
      )
    })

    it('adds timestamp if missing', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      await sink.send([{ type: 'test' }])

      const sentEvents = mockSend.mock.calls[0][0]
      expect(sentEvents[0].timestamp).toBeTypeOf('number')
    })

    it('preserves existing timestamp', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }
      const sink = new PipelineEventSink(mockPipeline)

      const timestamp = 1234567890
      await sink.send([{ type: 'test', timestamp }])

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
      const events = Array.from({ length: MAX_BATCH_SIZE + 100 }, (_, i) => ({
        type: 'test',
        index: i,
      }))

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
      await sink.send([{ type: 'test' }])

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
      expect(body[0]).toMatchObject({ type: 'test' })
    })

    it('uses custom endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      globalThis.fetch = mockFetch

      const customEndpoint = 'https://custom.example.com/events'
      const sink = new HttpEventSink(customEndpoint)
      await sink.send([{ type: 'test' }])

      expect(mockFetch).toHaveBeenCalledWith(customEndpoint, expect.any(Object))
    })

    it('handles HTTP errors gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      globalThis.fetch = mockFetch
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sink = new HttpEventSink()
      await sink.send([{ type: 'test' }])

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP error'))
      consoleSpy.mockRestore()
    })

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      globalThis.fetch = mockFetch
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const sink = new HttpEventSink()
      await sink.send([{ type: 'test' }])

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

  describe('Event Factories', () => {
    describe('routingEvent', () => {
      it('creates routing event with required fields', () => {
        const event = routingEvent({
          requestId: 'req-123',
          pathname: '/api/customers',
          method: 'GET',
          targetBinding: 'DO',
          isReplica: false,
          consistencyMode: 'eventual',
          durationMs: 5,
        })

        expect(event.type).toBe('routing')
        expect(event.timestamp).toBeTypeOf('number')
        expect(event.requestId).toBe('req-123')
        expect(event.pathname).toBe('/api/customers')
        expect(event.method).toBe('GET')
        expect(event.targetBinding).toBe('DO')
        expect(event.isReplica).toBe(false)
        expect(event.consistencyMode).toBe('eventual')
        expect(event.durationMs).toBe(5)
      })

      it('includes optional fields', () => {
        const event = routingEvent({
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

        expect(event.colo).toBe('SJC')
        expect(event.region).toBe('wnam')
        expect(event.replicaRegion).toBe('us-west-2')
      })
    })

    describe('usageEvent', () => {
      it('creates usage event with required fields', () => {
        const event = usageEvent({
          requestId: 'req-123',
          endpoint: '/api/customers',
          method: 'GET',
          statusCode: 200,
          latencyMs: 50,
          cost: 1,
        })

        expect(event.type).toBe('usage')
        expect(event.timestamp).toBeTypeOf('number')
        expect(event.requestId).toBe('req-123')
        expect(event.statusCode).toBe(200)
        expect(event.latencyMs).toBe(50)
        expect(event.cost).toBe(1)
      })

      it('includes optional fields', () => {
        const event = usageEvent({
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

        expect(event.userId).toBe('user-456')
        expect(event.apiKeyId).toBe('key-789')
        expect(event.tenantId).toBe('acme')
      })
    })

    describe('rpcEvent', () => {
      it('creates RPC event with required fields', () => {
        const event = rpcEvent({
          requestId: 'req-123',
          service: 'CustomerService',
          method: 'getCustomer',
          status: 'ok',
          durationMs: 10,
          costUnits: 1,
        })

        expect(event.type).toBe('rpc')
        expect(event.timestamp).toBeTypeOf('number')
        expect(event.service).toBe('CustomerService')
        expect(event.method).toBe('getCustomer')
        expect(event.status).toBe('ok')
        expect(event.durationMs).toBe(10)
        expect(event.costUnits).toBe(1)
      })

      it('includes optional token counts', () => {
        const event = rpcEvent({
          requestId: 'req-123',
          service: 'AIService',
          method: 'generate',
          status: 'ok',
          durationMs: 1000,
          costUnits: 10,
          inputTokens: 100,
          outputTokens: 500,
        })

        expect(event.inputTokens).toBe(100)
        expect(event.outputTokens).toBe(500)
      })
    })

    describe('genericEvent', () => {
      it('creates generic event with custom type', () => {
        const event = genericEvent('custom', { foo: 'bar', count: 42 })

        expect(event.type).toBe('custom')
        expect(event.timestamp).toBeTypeOf('number')
        expect(event.foo).toBe('bar')
        expect(event.count).toBe(42)
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

      await sendEvents([{ type: 'test' }])

      expect(mockFetch).toHaveBeenCalledWith(EVENTS_ENDPOINT, expect.any(Object))
    })

    it('sendEvent sends single event', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>

      await sendEvent({ type: 'test' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body).toHaveLength(1)
    })

    it('initEventSink configures pipeline binding', async () => {
      const mockSend = vi.fn().mockResolvedValue(undefined)
      const mockPipeline: Pipeline = { send: mockSend }

      initEventSink({ EVENTS: mockPipeline })
      await sendEvents([{ type: 'test' }])

      expect(mockSend).toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })
})
