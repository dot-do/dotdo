/**
 * Analytics Client Core Tests
 *
 * TDD RED Phase: These tests define the expected behavior
 * for the AnalyticsClient class.
 *
 * Test Coverage:
 * - Constructor and configuration
 * - Event methods (track, identify, page, screen, group, alias)
 * - Buffer management (enqueue, size, limits)
 * - Flush behavior (manual, auto-batch, auto-interval)
 * - Lifecycle (destroy, cleanup)
 * - Helper functions (generateMessageId, generateTimestamp)
 *
 * @module @dotdo/compat/analytics/analytics.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AnalyticsClient,
  generateMessageId,
  generateTimestamp,
  type AnalyticsConfig,
  type BatchPayload,
} from './analytics'

// ============================================================================
// TEST SETUP
// ============================================================================

// Mock fetch for HTTP calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const defaultConfig: AnalyticsConfig = {
  writeKey: 'test-write-key',
  batchSize: 20,
  flushInterval: 10000,
}

// ============================================================================
// CONSTRUCTOR TESTS
// ============================================================================

describe('AnalyticsClient', () => {
  describe('constructor', () => {
    it('should create client with required writeKey', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })
      expect(client).toBeInstanceOf(AnalyticsClient)
    })

    it('should throw if writeKey is missing', () => {
      expect(() => new AnalyticsClient({} as AnalyticsConfig)).toThrow()
    })

    it('should throw if writeKey is empty', () => {
      expect(() => new AnalyticsClient({ writeKey: '' })).toThrow()
    })

    it('should use default batchSize of 20', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })
      // Fill buffer to trigger auto-flush at 20
      for (let i = 0; i < 19; i++) {
        client.enqueue({
          type: 'track',
          event: `Event ${i}`,
          anonymousId: 'anon-123',
        } as any)
      }
      expect(mockFetch).not.toHaveBeenCalled()

      client.enqueue({
        type: 'track',
        event: 'Event 20',
        anonymousId: 'anon-123',
      } as any)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should use default flushInterval of 10000ms', () => {
      const client = new AnalyticsClient({ writeKey: 'test-key' })
      client.enqueue({
        type: 'track',
        event: 'Test',
        anonymousId: 'anon-123',
      } as any)

      vi.advanceTimersByTime(9999)
      expect(mockFetch).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should accept custom batchSize', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        batchSize: 5,
      })

      for (let i = 0; i < 5; i++) {
        client.enqueue({
          type: 'track',
          event: `Event ${i}`,
          anonymousId: 'anon-123',
        } as any)
      }
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should accept custom flushInterval', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        flushInterval: 5000,
      })

      client.enqueue({
        type: 'track',
        event: 'Test',
        anonymousId: 'anon-123',
      } as any)

      vi.advanceTimersByTime(5000)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should accept custom endpoint', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        endpoint: 'https://custom.endpoint.com/v1/batch',
      })

      client.enqueue({
        type: 'track',
        event: 'Test',
        anonymousId: 'anon-123',
      } as any)

      client.flush()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.endpoint.com/v1/batch',
        expect.any(Object)
      )
    })

    it('should accept defaultContext', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        defaultContext: {
          app: { name: 'TestApp', version: '1.0.0' },
        },
      })

      client.track({
        event: 'Test Event',
        anonymousId: 'anon-123',
      })

      client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].context?.app?.name).toBe('TestApp')
    })

    it('should initialize with empty buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      expect(client.getBufferSize()).toBe(0)
    })
  })

  // ============================================================================
  // EVENT METHOD TESTS
  // ============================================================================

  describe('track', () => {
    it('should add track event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.track({
        event: 'Button Clicked',
        userId: 'user-123',
      })
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to track', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.track({
        event: 'Button Clicked',
        userId: 'user-123',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('track')
    })

    it('should include event name', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.track({
        event: 'Product Viewed',
        userId: 'user-123',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).event).toBe('Product Viewed')
    })

    it('should include properties', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.track({
        event: 'Product Viewed',
        userId: 'user-123',
        properties: {
          productId: 'prod-456',
          price: 99.99,
        },
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).properties).toEqual({
        productId: 'prod-456',
        price: 99.99,
      })
    })
  })

  describe('identify', () => {
    it('should add identify event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.identify({
        userId: 'user-123',
        traits: {
          email: 'test@example.com',
        },
      })
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to identify', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.identify({
        userId: 'user-123',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('identify')
    })

    it('should include traits', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.identify({
        userId: 'user-123',
        traits: {
          email: 'test@example.com',
          name: 'Test User',
        },
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).traits).toEqual({
        email: 'test@example.com',
        name: 'Test User',
      })
    })
  })

  describe('page', () => {
    it('should add page event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.page({
        anonymousId: 'anon-123',
        name: 'Home',
      })
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to page', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.page({
        anonymousId: 'anon-123',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('page')
    })

    it('should include category and name', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.page({
        anonymousId: 'anon-123',
        category: 'Docs',
        name: 'Getting Started',
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).category).toBe('Docs')
      expect((body.batch[0] as any).name).toBe('Getting Started')
    })

    it('should work without arguments', () => {
      const client = new AnalyticsClient(defaultConfig)
      // page() can be called with no arguments for default page tracking
      client.page()
      expect(client.getBufferSize()).toBe(1)
    })
  })

  describe('screen', () => {
    it('should add screen event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.screen({
        anonymousId: 'anon-123',
        name: 'Home Screen',
      } as any)
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to screen', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.screen({
        anonymousId: 'anon-123',
        name: 'Home Screen',
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('screen')
    })
  })

  describe('group', () => {
    it('should add group event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.group({
        userId: 'user-123',
        groupId: 'company-456',
      })
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to group', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.group({
        userId: 'user-123',
        groupId: 'company-456',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('group')
    })

    it('should include groupId', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.group({
        userId: 'user-123',
        groupId: 'company-456',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).groupId).toBe('company-456')
    })

    it('should include traits', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.group({
        userId: 'user-123',
        groupId: 'company-456',
        traits: {
          name: 'Acme Inc',
          employees: 100,
        },
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).traits).toEqual({
        name: 'Acme Inc',
        employees: 100,
      })
    })
  })

  describe('alias', () => {
    it('should add alias event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.alias({
        userId: 'user-123',
        previousId: 'anon-456',
      })
      expect(client.getBufferSize()).toBe(1)
    })

    it('should set type to alias', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.alias({
        userId: 'user-123',
        previousId: 'anon-456',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('alias')
    })

    it('should include userId and previousId', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.alias({
        userId: 'user-123',
        previousId: 'anon-456',
      })

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).userId).toBe('user-123')
      expect((body.batch[0] as any).previousId).toBe('anon-456')
    })
  })

  // ============================================================================
  // BUFFER MANAGEMENT TESTS
  // ============================================================================

  describe('enqueue', () => {
    it('should add event to buffer', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
      } as any)
      expect(client.getBufferSize()).toBe(1)
    })

    it('should auto-generate messageId if missing', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].messageId).toBeDefined()
      expect(typeof body.batch[0].messageId).toBe('string')
    })

    it('should preserve provided messageId', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
        messageId: 'custom-msg-id',
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].messageId).toBe('custom-msg-id')
    })

    it('should auto-generate timestamp if missing', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].timestamp).toBeDefined()
      // Should be ISO timestamp
      expect(() => new Date(body.batch[0].timestamp!)).not.toThrow()
    })

    it('should preserve provided timestamp', async () => {
      const timestamp = '2024-01-15T10:30:00.000Z'
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
        timestamp,
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].timestamp).toBe(timestamp)
    })

    it('should merge default context', async () => {
      const client = new AnalyticsClient({
        ...defaultConfig,
        defaultContext: {
          app: { name: 'TestApp' },
        },
      })

      client.enqueue({
        type: 'track',
        event: 'Test Event',
        anonymousId: 'anon-123',
        context: {
          locale: 'en-US',
        },
      } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].context?.app?.name).toBe('TestApp')
      expect(body.batch[0].context?.locale).toBe('en-US')
    })

    it('should trigger auto-flush when batchSize reached', () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        batchSize: 3,
      })

      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)
      client.enqueue({ type: 'track', event: 'E2', anonymousId: 'a' } as any)
      expect(mockFetch).not.toHaveBeenCalled()

      client.enqueue({ type: 'track', event: 'E3', anonymousId: 'a' } as any)
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('getBufferSize', () => {
    it('should return 0 for new client', () => {
      const client = new AnalyticsClient(defaultConfig)
      expect(client.getBufferSize()).toBe(0)
    })

    it('should return correct count after enqueue', () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)
      client.enqueue({ type: 'track', event: 'E2', anonymousId: 'a' } as any)
      expect(client.getBufferSize()).toBe(2)
    })

    it('should return 0 after flush', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)
      await client.flush()
      expect(client.getBufferSize()).toBe(0)
    })
  })

  // ============================================================================
  // FLUSH BEHAVIOR TESTS
  // ============================================================================

  describe('flush', () => {
    it('should send buffered events via HTTP', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.flush()

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should send to default Segment endpoint', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.flush()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.segment.io'),
        expect.any(Object)
      )
    })

    it('should include writeKey in payload', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.writeKey).toBe('test-write-key')
    })

    it('should include sentAt timestamp', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.sentAt).toBeDefined()
      expect(() => new Date(body.sentAt)).not.toThrow()
    })

    it('should include batch array', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)
      client.enqueue({ type: 'track', event: 'E2', anonymousId: 'a' } as any)

      await client.flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch).toHaveLength(2)
    })

    it('should clear buffer after successful send', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)
      expect(client.getBufferSize()).toBe(1)

      await client.flush()

      expect(client.getBufferSize()).toBe(0)
    })

    it('should return success result on success', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      const result = await client.flush()

      expect(result.success).toBe(true)
    })

    it('should return error result on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      const result = await client.flush()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should retry on failure up to maxRetries', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true })

      const client = new AnalyticsClient({
        ...defaultConfig,
        maxRetries: 3,
      })
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      // Start flush but don't await yet - we need to advance timers for retry delays
      const flushPromise = client.flush()

      // Advance timers to allow retry delays to complete (100ms + 200ms = 300ms for exponential backoff)
      // Use advanceTimersByTimeAsync to avoid infinite loop from resetFlushTimer
      await vi.advanceTimersByTimeAsync(500)

      const result = await flushPromise

      expect(result.success).toBe(true)
      expect(result.retriesUsed).toBe(2)
    })

    it('should not send if buffer is empty', async () => {
      const client = new AnalyticsClient(defaultConfig)

      await client.flush()

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should trigger on flushInterval timer', async () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        flushInterval: 5000,
      })
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      expect(mockFetch).not.toHaveBeenCalled()

      vi.advanceTimersByTime(5000)

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should reset timer after manual flush', async () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        flushInterval: 5000,
      })
      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)

      vi.advanceTimersByTime(3000)
      await client.flush()

      client.enqueue({ type: 'track', event: 'E2', anonymousId: 'a' } as any)

      vi.advanceTimersByTime(3000)
      expect(mockFetch).toHaveBeenCalledTimes(1) // Only manual flush

      vi.advanceTimersByTime(2000)
      expect(mockFetch).toHaveBeenCalledTimes(2) // Timer flush
    })
  })

  // ============================================================================
  // LIFECYCLE TESTS
  // ============================================================================

  describe('destroy', () => {
    it('should stop flush timer', async () => {
      const client = new AnalyticsClient({
        writeKey: 'test-key',
        flushInterval: 5000,
      })
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.destroy()

      vi.advanceTimersByTime(5000)
      // Should have been called once by destroy's flush, not by timer
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should flush remaining events', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'E1', anonymousId: 'a' } as any)
      client.enqueue({ type: 'track', event: 'E2', anonymousId: 'a' } as any)

      await client.destroy()

      expect(mockFetch).toHaveBeenCalled()
      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch).toHaveLength(2)
    })

    it('should not flush if buffer is empty', async () => {
      const client = new AnalyticsClient(defaultConfig)

      await client.destroy()

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should reject new events after destroy', async () => {
      const client = new AnalyticsClient(defaultConfig)

      await client.destroy()

      expect(() => {
        client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)
      }).toThrow()
    })

    it('should be idempotent (safe to call multiple times)', async () => {
      const client = new AnalyticsClient(defaultConfig)
      client.enqueue({ type: 'track', event: 'Test', anonymousId: 'a' } as any)

      await client.destroy()
      await client.destroy()
      await client.destroy()

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('generateMessageId', () => {
  it('should return a string', () => {
    const id = generateMessageId()
    expect(typeof id).toBe('string')
  })

  it('should return unique values', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateMessageId())
    }
    expect(ids.size).toBe(100)
  })

  it('should return non-empty string', () => {
    const id = generateMessageId()
    expect(id.length).toBeGreaterThan(0)
  })
})

describe('generateTimestamp', () => {
  it('should return ISO 8601 format', () => {
    const ts = generateTimestamp()
    expect(() => new Date(ts)).not.toThrow()
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('should return current time', () => {
    const before = Date.now()
    const ts = generateTimestamp()
    const after = Date.now()

    const tsTime = new Date(ts).getTime()
    expect(tsTime).toBeGreaterThanOrEqual(before)
    expect(tsTime).toBeLessThanOrEqual(after)
  })
})
