/**
 * Segment API Methods Tests
 *
 * TDD RED Phase: Tests for the Segment-compatible API methods.
 *
 * @module @dotdo/compat/analytics/segment-api.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  init,
  getClient,
  reset,
  identify,
  track,
  page,
  screen,
  group,
  alias,
  flush,
} from './segment-api'
import { AnalyticsClient, type BatchPayload } from './analytics'

// ============================================================================
// TEST SETUP
// ============================================================================

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  reset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================================
// INITIALIZATION TESTS
// ============================================================================

describe('init', () => {
  it('should return an AnalyticsClient instance', () => {
    const client = init({ writeKey: 'test-key' })
    expect(client).toBeInstanceOf(AnalyticsClient)
  })

  it('should store client for subsequent API calls', () => {
    const client = init({ writeKey: 'test-key' })
    expect(getClient()).toBe(client)
  })

  it('should replace existing client on re-init', () => {
    const client1 = init({ writeKey: 'key-1' })
    const client2 = init({ writeKey: 'key-2' })
    expect(getClient()).toBe(client2)
    expect(getClient()).not.toBe(client1)
  })

  it('should throw if writeKey is missing', () => {
    expect(() => init({} as any)).toThrow()
  })
})

describe('getClient', () => {
  it('should throw if init not called', () => {
    expect(() => getClient()).toThrow(/not initialized/)
  })

  it('should return client after init', () => {
    init({ writeKey: 'test-key' })
    expect(getClient()).toBeInstanceOf(AnalyticsClient)
  })
})

describe('reset', () => {
  it('should clear the client', () => {
    init({ writeKey: 'test-key' })
    reset()
    expect(() => getClient()).toThrow(/not initialized/)
  })

  it('should destroy the client on reset', async () => {
    const client = init({ writeKey: 'test-key' })
    track('Test Event')
    reset()
    // Client should have flushed on destroy
    expect(mockFetch).toHaveBeenCalled()
  })

  it('should be safe to call multiple times', () => {
    reset()
    reset()
    reset()
    expect(() => getClient()).toThrow()
  })
})

// ============================================================================
// IDENTIFY TESTS
// ============================================================================

describe('identify', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => identify('user-123')).toThrow(/not initialized/)
  })

  describe('with userId', () => {
    it('should set userId on event', async () => {
      identify('user-123', { email: 'test@example.com.ai' })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].userId).toBe('user-123')
    })

    it('should include traits in event', async () => {
      identify('user-123', {
        email: 'test@example.com.ai',
        name: 'Test User',
      })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).traits).toEqual({
        email: 'test@example.com.ai',
        name: 'Test User',
      })
    })

    it('should respect options context', async () => {
      identify('user-123', { email: 'test@example.com.ai' }, {
        context: { ip: '192.168.1.1' },
      })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].context?.ip).toBe('192.168.1.1')
    })

    it('should respect options integrations', async () => {
      identify('user-123', { email: 'test@example.com.ai' }, {
        integrations: { Mixpanel: false },
      })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].integrations?.Mixpanel).toBe(false)
    })

    it('should set type to identify', async () => {
      identify('user-123')
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('identify')
    })
  })

  describe('anonymous identify (traits only)', () => {
    it('should work without userId', async () => {
      identify({ plan: 'premium' })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].userId).toBeUndefined()
      expect((body.batch[0] as any).traits).toEqual({ plan: 'premium' })
    })

    it('should use anonymousId if provided in options', async () => {
      identify({ plan: 'premium' }, { anonymousId: 'anon-123' })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].anonymousId).toBe('anon-123')
    })
  })
})

// ============================================================================
// TRACK TESTS
// ============================================================================

describe('track', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => track('Test Event')).toThrow(/not initialized/)
  })

  it('should set event name', async () => {
    track('Button Clicked')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).event).toBe('Button Clicked')
  })

  it('should include properties', async () => {
    track('Product Viewed', {
      productId: 'prod-123',
      price: 99.99,
    })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).properties).toEqual({
      productId: 'prod-123',
      price: 99.99,
    })
  })

  it('should generate messageId', async () => {
    track('Test Event')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].messageId).toBeDefined()
    expect(typeof body.batch[0].messageId).toBe('string')
  })

  it('should respect integrations routing', async () => {
    track('Test Event', {}, {
      integrations: {
        All: true,
        Mixpanel: false,
        Amplitude: true,
      },
    })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].integrations).toEqual({
      All: true,
      Mixpanel: false,
      Amplitude: true,
    })
  })

  it('should set type to track', async () => {
    track('Test Event')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].type).toBe('track')
  })

  it('should respect anonymousId option', async () => {
    track('Test Event', {}, { anonymousId: 'anon-123' })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].anonymousId).toBe('anon-123')
  })

  it('should respect timestamp option', async () => {
    const ts = '2024-01-15T10:30:00.000Z'
    track('Test Event', {}, { timestamp: ts })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].timestamp).toBe(ts)
  })
})

// ============================================================================
// PAGE TESTS
// ============================================================================

describe('page', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => page()).toThrow(/not initialized/)
  })

  it('should set type to page', async () => {
    page()
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].type).toBe('page')
  })

  describe('with category and name', () => {
    it('should set category', async () => {
      page('Docs', 'Getting Started')
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).category).toBe('Docs')
    })

    it('should set name', async () => {
      page('Docs', 'Getting Started')
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).name).toBe('Getting Started')
    })

    it('should include properties', async () => {
      page('Docs', 'Getting Started', { author: 'John' })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).properties).toEqual({ author: 'John' })
    })
  })

  describe('with just name', () => {
    it('should set name without category', async () => {
      page('Home')
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).name).toBe('Home')
      expect((body.batch[0] as any).category).toBeUndefined()
    })

    it('should include properties as second argument', async () => {
      page('Home', { title: 'Welcome' })
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect((body.batch[0] as any).name).toBe('Home')
      expect((body.batch[0] as any).properties).toEqual({ title: 'Welcome' })
    })
  })

  describe('anonymous page view', () => {
    it('should work without arguments', async () => {
      page()
      await flush()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1].body) as BatchPayload
      expect(body.batch[0].type).toBe('page')
    })
  })

  it('should respect options', async () => {
    page('Home', {}, { anonymousId: 'anon-123' })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].anonymousId).toBe('anon-123')
  })
})

// ============================================================================
// SCREEN TESTS
// ============================================================================

describe('screen', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => screen('Home')).toThrow(/not initialized/)
  })

  it('should set type to screen', async () => {
    screen('Home Screen')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].type).toBe('screen')
  })

  it('should set screen name', async () => {
    screen('Home Screen')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).name).toBe('Home Screen')
  })

  it('should include properties', async () => {
    screen('Home Screen', {
      screenClass: 'HomeViewController',
    })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).properties).toEqual({
      screenClass: 'HomeViewController',
    })
  })

  it('should respect options', async () => {
    screen('Home Screen', {}, { anonymousId: 'anon-123' })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].anonymousId).toBe('anon-123')
  })
})

// ============================================================================
// GROUP TESTS
// ============================================================================

describe('group', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => group('company-123')).toThrow(/not initialized/)
  })

  it('should set type to group', async () => {
    group('company-123')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].type).toBe('group')
  })

  it('should set groupId', async () => {
    group('company-123')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).groupId).toBe('company-123')
  })

  it('should include group traits', async () => {
    group('company-123', {
      name: 'Acme Inc',
      industry: 'Technology',
      employees: 100,
    })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).traits).toEqual({
      name: 'Acme Inc',
      industry: 'Technology',
      employees: 100,
    })
  })

  it('should respect options', async () => {
    group('company-123', {}, { anonymousId: 'anon-123' })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].anonymousId).toBe('anon-123')
  })
})

// ============================================================================
// ALIAS TESTS
// ============================================================================

describe('alias', () => {
  beforeEach(() => {
    init({ writeKey: 'test-key' })
  })

  it('should throw if not initialized', () => {
    reset()
    expect(() => alias('user-123', 'anon-456')).toThrow(/not initialized/)
  })

  it('should set type to alias', async () => {
    alias('user-123', 'anon-456')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].type).toBe('alias')
  })

  it('should set userId', async () => {
    alias('user-123', 'anon-456')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].userId).toBe('user-123')
  })

  it('should set previousId', async () => {
    alias('user-123', 'anon-456')
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect((body.batch[0] as any).previousId).toBe('anon-456')
  })

  it('should respect options', async () => {
    alias('user-123', 'anon-456', {
      integrations: { Mixpanel: false },
    })
    await flush()

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch[0].integrations?.Mixpanel).toBe(false)
  })
})

// ============================================================================
// FLUSH TESTS
// ============================================================================

describe('flush', () => {
  it('should throw if not initialized', async () => {
    await expect(flush()).rejects.toThrow(/not initialized/)
  })

  it('should flush buffered events', async () => {
    init({ writeKey: 'test-key' })
    track('Event 1')
    track('Event 2')

    await flush()

    expect(mockFetch).toHaveBeenCalled()
    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body) as BatchPayload
    expect(body.batch).toHaveLength(2)
  })

  it('should resolve when flush completes', async () => {
    init({ writeKey: 'test-key' })
    track('Test Event')

    const result = await flush()
    expect(result).toBeUndefined() // void return
  })
})
